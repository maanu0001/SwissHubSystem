import { Prisma, prisma, recordAudit, AUDIT_ACTIONS } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { AppError } from '@swisshub/shared';
import { getModuleSettings, isModuleEnabled } from '../module-state';
import { CLIPS_MODULE_ID, type ClipsSettings } from './config';
import { inDerWoche, kalenderwoche } from './woche';
import { meldeEreignis } from '../automation/emit';
import type { ClipCompetition, ClipCompetitionStatus } from '@swisshub/database';

const log = createLogger('clips:wettbewerb');

/**
 * Der Lebenslauf einer Runde.
 *
 * ## Warum die Datenbank entscheidet und nicht ein Zeitgeber
 *
 * Eine Runde dauert eine Woche. Ein `setTimeout` ueber eine Woche ist nach
 * dem ersten Neustart weg, und Neustarts gibt es bei jedem Deployment. Was
 * gilt, steht deshalb in Spalten: `submissionEndsAt`, `votingEndsAt`. Ein
 * Durchgang vergleicht sie mit der Serverzeit und holt nach, was faellig ist.
 *
 * Daraus folgt die wichtigste Eigenschaft: **es gibt keinen verpassten
 * Uebergang.** War die Anwendung von 19:55 bis 20:10 aus, laeuft der erste
 * Durchgang um 20:10 und findet eine Runde, deren Voting um 20:00 endete.
 * Sie wird dann finalisiert - nicht frueher, aber auch nicht nie.
 *
 * ## Warum FINALIZING ein eigener Zustand ist
 *
 * Damit zwei gleichzeitige Durchgaenge nicht beide finalisieren. Der Wechsel
 * von VOTING auf FINALIZING ist ein bedingtes `updateMany`: wer die Zeile als
 * Erster von VOTING wegbewegt, hat den Zuschlag. Der andere sieht null
 * geaenderte Zeilen und hoert auf.
 */

export interface RundenZeiten {
  submissionStartsAt: Date;
  submissionEndsAt: Date;
  votingStartsAt: Date;
  votingEndsAt: Date;
}

/**
 * Die Zeiten einer Woche aus den Einstellungen.
 *
 * Das Voting beginnt, wo die Einreichungen enden - eine Luecke dazwischen
 * waere eine Phase ohne Namen, in der niemand etwas tun kann.
 */
export function zeitenFuerWoche(
  woche: ReturnType<typeof kalenderwoche>,
  settings: ClipsSettings,
): RundenZeiten {
  const submissionStartsAt = inDerWoche(
    woche,
    settings.submissionStartDay,
    settings.submissionStartHour,
    settings.submissionStartMinute,
  );
  const submissionEndsAt = inDerWoche(
    woche,
    settings.submissionEndDay,
    settings.submissionEndHour,
    settings.submissionEndMinute,
  );
  const votingEndsAt = inDerWoche(
    woche,
    settings.votingEndDay,
    settings.votingEndHour,
    settings.votingEndMinute,
  );
  return { submissionStartsAt, submissionEndsAt, votingStartsAt: submissionEndsAt, votingEndsAt };
}

/**
 * Die Runde dieser Woche - anlegen, falls es sie noch nicht gibt.
 *
 * Idempotent ueber den Schluessel `2026-W39`: ein zweiter Lauf trifft auf die
 * Eindeutigkeitsbedingung und liefert die vorhandene Runde. Es braucht dafuer
 * keine Sperre und kein Nachsehen-und-dann-Anlegen, das zwischen beiden
 * Schritten danebengehen kann.
 */
export async function holeOderErstelleRunde(guildId: string, jetzt = new Date()): Promise<ClipCompetition> {
  const settings = await getModuleSettings<ClipsSettings>(CLIPS_MODULE_ID);
  const woche = kalenderwoche(jetzt);
  const zeiten = zeitenFuerWoche(woche, settings);

  const vorhanden = await prisma.clipCompetition.findUnique({
    where: { guildId_key: { guildId, key: woche.key } },
  });
  if (vorhanden) {
    return vorhanden;
  }

  // Die laufende Nummer ist die naechste je Server - sichtbar als
  // «Clip of the Week #39», unabhaengig von der Kalenderwoche.
  const letzte = await prisma.clipCompetition.findFirst({
    where: { guildId },
    orderBy: { number: 'desc' },
    select: { number: true },
  });

  try {
    const neu = await prisma.clipCompetition.create({
      data: {
        guildId,
        key: woche.key,
        number: (letzte?.number ?? 0) + 1,
        status: jetzt >= zeiten.submissionStartsAt ? 'SUBMISSION' : 'DRAFT',
        ...zeiten,
        // Die Regeln als Abschrift: wer spaeter die Stimmenzahl aendert, soll
        // damit keine laufende Runde umschreiben.
        votesPerMember: settings.votesPerMember,
        submissionsPerMember: settings.submissionsPerMember,
        allowSelfVote: settings.allowSelfVote,
        showVoteCounts: settings.showVoteCounts,
      },
    });

    await recordAudit({
      action: AUDIT_ACTIONS.CLIP_COMPETITION_CREATED,
      module: CLIPS_MODULE_ID,
      targetLabel: `Clip of the Week #${neu.number}`,
      metadata: { competitionId: neu.id, key: neu.key, number: neu.number },
    });
    log.info('Clip-Runde eröffnet', { key: neu.key, number: neu.number });
    return neu;
  } catch (error) {
    /*
     * Zwei Durchgaenge zugleich.
     *
     * P2002 heisst: jemand war schneller. Das ist kein Fehler, sondern genau
     * das, was die Eindeutigkeit verhindern soll - die vorhandene Runde wird
     * geholt und zurueckgegeben.
     */
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const doch = await prisma.clipCompetition.findUnique({
        where: { guildId_key: { guildId, key: woche.key } },
      });
      if (doch) {
        return doch;
      }
    }
    throw error;
  }
}

export interface UebergangsErgebnis {
  eroeffnet: string[];
  zumVoting: string[];
  finalisiert: string[];
}

/**
 * Faellige Uebergaenge nachholen.
 *
 * Laeuft im Minutentakt und ist zugleich die Wiederherstellung nach einer
 * Unterbrechung: er fragt nicht «ist gerade etwas passiert», sondern «was ist
 * laut Uhr faellig». Beides zu trennen hiesse, zwei Wege zu haben, die
 * auseinanderlaufen koennen.
 */
export async function fuehreUebergaengeAus(guildId: string, jetzt = new Date()): Promise<UebergangsErgebnis> {
  const ergebnis: UebergangsErgebnis = { eroeffnet: [], zumVoting: [], finalisiert: [] };

  // DRAFT → SUBMISSION
  const zuEroeffnen = await prisma.clipCompetition.findMany({
    where: { guildId, status: 'DRAFT', submissionStartsAt: { lte: jetzt } },
    select: { id: true },
  });
  for (const runde of zuEroeffnen) {
    if (await setzeStatus(runde.id, 'DRAFT', 'SUBMISSION')) {
      ergebnis.eroeffnet.push(runde.id);
    }
  }

  // SUBMISSION → VOTING
  const zumVoting = await prisma.clipCompetition.findMany({
    where: { guildId, status: 'SUBMISSION', votingStartsAt: { lte: jetzt } },
    select: { id: true },
  });
  for (const runde of zumVoting) {
    if (await setzeStatus(runde.id, 'SUBMISSION', 'VOTING')) {
      ergebnis.zumVoting.push(runde.id);
      const gewechselt = await prisma.clipCompetition.findUnique({ where: { id: runde.id } });
      if (gewechselt) {
        await meldeEreignis(
          'clips.voting_started',
          {
            competitionId: gewechselt.id,
            key: gewechselt.key,
            nummer: gewechselt.number,
            clips: await prisma.clipCompetitionEntry.count({
              where: { competitionId: gewechselt.id, status: 'APPROVED' },
            }),
            endetAm: gewechselt.votingEndsAt.toISOString(),
          },
          { guildId, entityId: gewechselt.id },
        );
      }
    }
  }

  // VOTING → FINALIZING → COMPLETED
  const zuSchliessen = await prisma.clipCompetition.findMany({
    where: { guildId, status: { in: ['VOTING', 'FINALIZING'] }, votingEndsAt: { lte: jetzt } },
    select: { id: true, status: true },
  });
  for (const runde of zuSchliessen) {
    const abgeschlossen = await finalisiere(runde.id, { quelle: 'scheduler', jetzt });
    if (abgeschlossen) {
      ergebnis.finalisiert.push(runde.id);
    }
  }

  return ergebnis;
}

/**
 * Den Zustand wechseln - aber nur aus dem erwarteten heraus.
 *
 * Bedingt auf den Vorzustand: laeuft derselbe Durchgang zweimal oder zwei
 * Arbeiter gleichzeitig, aendert genau einer etwas. Der andere bekommt null
 * und weiss damit, dass er nichts zu tun hat.
 */
async function setzeStatus(
  id: string,
  von: ClipCompetitionStatus,
  nach: ClipCompetitionStatus,
): Promise<boolean> {
  const { count } = await prisma.clipCompetition.updateMany({
    where: { id, status: von },
    data: { status: nach },
  });
  if (count > 0) {
    log.info('Clip-Runde gewechselt', { id, von, nach });
  }
  return count > 0;
}

export interface FinalisierungsOptionen {
  quelle: 'scheduler' | 'manuell';
  actorDiscordId?: string | null;
  actorUsername?: string | null;
  jetzt?: Date;
}

/**
 * Eine Runde abschliessen.
 *
 * Dieselbe Funktion fuer den Durchgang und fuer den Knopf in der Verwaltung -
 * eine zweite waere eine zweite Regel, wer gewinnt.
 *
 * ## Idempotent
 *
 * Der erste Schritt ist der bedingte Wechsel auf FINALIZING. Kommt er nicht
 * durch, ist die Runde bereits abgeschlossen oder jemand anderes ist dabei;
 * dann wird `false` zurueckgegeben und nichts getan. Ein zweiter Aufruf
 * setzt also keinen zweiten Gewinner und loest keine zweite Ankuendigung aus.
 *
 * ## Der Gleichstand
 *
 * Deterministisch: mehr Stimmen gewinnt, bei Gleichstand der frueher
 * eingereichte Clip. Kein Zufall - ein Ergebnis, das niemand nachrechnen
 * kann, ist bei einem Wettbewerb das Letzte, was man will.
 */
/** Nach dieser Zeit gilt ein begonnener Abschluss als steckengeblieben. */
const STECKEN_MS = 5 * 60 * 1000;

export async function finalisiere(competitionId: string, optionen: FinalisierungsOptionen): Promise<boolean> {
  const jetzt = optionen.jetzt ?? new Date();

  /*
   * Den Abschluss belegen.
   *
   * `FINALIZING` ist das Schild «hier arbeitet schon jemand». Es muss
   * deshalb aus `VOTING` heraus belegt werden und nicht aus sich selbst:
   * stuende `FINALIZING` in der Bedingung, kaemen fuenf gleichzeitige
   * Durchgaenge alle durch - jeder saehe das Schild, das der erste gerade
   * aufgestellt hat, und liefe weiter. Genau das war der Fall, bis ein Test
   * mit fuenf gleichzeitigen Aufrufen vier Gewinner ergab.
   *
   * Der zweite Zweig ist die Genesung: bricht ein Durchgang zwischen dem
   * Schild und dem Abschluss ab - Neustart, Verbindungsabbruch -, bliebe die
   * Runde sonst fuer immer auf `FINALIZING` stehen. Nach `STECKEN_MS` darf
   * sie deshalb erneut belegt werden. Die Frist ist grosszuegiger als jeder
   * Abschluss dauert und kuerzer als eine Runde.
   */
  const { count } = await prisma.clipCompetition.updateMany({
    where: {
      id: competitionId,
      OR: [
        { status: 'VOTING' },
        { status: 'FINALIZING', updatedAt: { lt: new Date(jetzt.getTime() - STECKEN_MS) } },
      ],
    },
    data: { status: 'FINALIZING' },
  });
  if (count === 0) {
    return false;
  }

  const teilnahmen = await prisma.clipCompetitionEntry.findMany({
    where: { competitionId, status: 'APPROVED' },
    select: { id: true, submittedAt: true, _count: { select: { votes: true } } },
  });

  const rangfolge = [...teilnahmen].sort((a, b) => {
    if (b._count.votes !== a._count.votes) {
      return b._count.votes - a._count.votes;
    }
    // Gleichstand: wer frueher eingereicht hat, steht vorn. Bei exakt
    // gleichem Zeitpunkt entscheidet die Kennung - damit die Reihenfolge
    // ueberhaupt festliegt und nicht von der Datenbank abhaengt.
    if (a.submittedAt.getTime() !== b.submittedAt.getTime()) {
      return a.submittedAt.getTime() - b.submittedAt.getTime();
    }
    return a.id.localeCompare(b.id);
  });

  /*
   * Ein Gewinner ohne Stimme ist keiner.
   *
   * Nimmt in einer Woche niemand an der Abstimmung teil, steht an erster
   * Stelle der Rangfolge trotzdem jemand - die frueheste Einreichung, mit
   * null Stimmen. Diesen Clip zum «Clip of the Week» zu erklaeren und die
   * Person dafuer auf Discord zu erwaehnen, waere eine Auszeichnung, die
   * niemand vergeben hat. Die Raenge werden trotzdem geschrieben: die Runde
   * ist abgeschlossen, und das Ergebnis lautet dann «keiner».
   */
  const gewinner = (rangfolge[0]?._count.votes ?? 0) > 0 ? (rangfolge[0] ?? null) : null;

  await prisma.$transaction([
    ...rangfolge.map((eintrag, index) =>
      prisma.clipCompetitionEntry.update({
        where: { id: eintrag.id },
        data: { finalRank: index + 1, finalVoteCount: eintrag._count.votes },
      }),
    ),
    prisma.clipCompetition.update({
      where: { id: competitionId },
      data: {
        status: 'COMPLETED',
        finalizedAt: jetzt,
        winnerEntryId: gewinner?.id ?? null,
      },
    }),
  ]);

  const runde = await prisma.clipCompetition.findUnique({ where: { id: competitionId } });
  await recordAudit({
    action: AUDIT_ACTIONS.CLIP_COMPETITION_FINALIZED,
    module: CLIPS_MODULE_ID,
    actorDiscordId: optionen.actorDiscordId ?? null,
    actorUsername: optionen.actorUsername ?? null,
    targetLabel: `Clip of the Week #${runde?.number ?? '?'}`,
    metadata: {
      competitionId,
      quelle: optionen.quelle,
      teilnahmen: rangfolge.length,
      winnerEntryId: gewinner?.id ?? null,
      votes: gewinner?._count.votes ?? 0,
    },
  });

  if (gewinner && runde) {
    const eintrag = await prisma.clipCompetitionEntry.findUnique({
      where: { id: gewinner.id },
      include: { clip: { select: { id: true, title: true } } },
    });
    if (eintrag) {
      await meldeEreignis(
        'clips.winner',
        {
          competitionId,
          key: runde.key,
          nummer: runde.number,
          entryId: eintrag.id,
          clipId: eintrag.clipId,
          titel: eintrag.clip.title,
          discordId: eintrag.submittedByDiscordId,
          stimmen: gewinner._count.votes,
        },
        {
          guildId: runde.guildId,
          subjectId: eintrag.submittedByDiscordId,
          entityId: competitionId,
        },
      );
    }
  }

  log.info('Clip-Runde abgeschlossen', { competitionId, teilnahmen: rangfolge.length });
  return true;
}

/** Eine Runde abbrechen. Das Ergebnis bleibt leer, die Clips bleiben. */
export async function brichAb(
  competitionId: string,
  actor: { discordId: string; username?: string | null },
  grund?: string | null,
): Promise<boolean> {
  const { count } = await prisma.clipCompetition.updateMany({
    where: { id: competitionId, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
    data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledByDiscordId: actor.discordId },
  });
  if (count === 0) {
    return false;
  }

  // Nach dem Wechsel gelesen, damit im Protokoll steht, *welche* Runde es
  // war - ohne das stand auf dem Dashboard nur «hat die Clip-Runde
  // abgebrochen», und welche, musste man im Metadatenfeld nachsehen.
  const runde = await prisma.clipCompetition.findUnique({
    where: { id: competitionId },
    select: { number: true, key: true },
  });

  await recordAudit({
    action: AUDIT_ACTIONS.CLIP_COMPETITION_CANCELLED,
    module: CLIPS_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username ?? null,
    targetLabel: runde ? `Clip of the Week #${runde.number}` : null,
    metadata: {
      competitionId,
      ...(runde ? { key: runde.key, nummer: runde.number } : {}),
      ...(grund ? { grund } : {}),
    },
  });
  return true;
}

/** Die Phasen, in die eine abgebrochene Runde zurueckkehren kann. */
export type ReaktivierungsZiel = Extract<ClipCompetitionStatus, 'DRAFT' | 'SUBMISSION' | 'VOTING'>;

/** Warum eine Runde sich nicht wieder aktivieren laesst. */
export type ReaktivierungsHindernis = 'NICHT_ABGEBROCHEN' | 'ANDERE_WOCHE' | 'FRISTEN_ABGELAUFEN';

export interface ReaktivierungsLage {
  moeglich: boolean;
  hindernis?: ReaktivierungsHindernis;
  /** In welchen Zustand die Runde zurueckkehrt - aus dem Zeitplan, nicht geraten. */
  ziel?: ReaktivierungsZiel;
  /** Wann diese Phase endet. Unveraendert aus dem urspruenglichen Plan. */
  phaseEndetAm?: Date;
}

/** Was `reaktivierungsLage` von einer Runde wissen muss. */
export type ReaktivierbareRunde = Pick<
  ClipCompetition,
  | 'key'
  | 'status'
  | 'cancelledAt'
  | 'finalizedAt'
  | 'winnerEntryId'
  | 'submissionStartsAt'
  | 'votingStartsAt'
  | 'votingEndsAt'
>;

/**
 * Darf diese Runde wieder aktiviert werden - und als was?
 *
 * Eine reine Funktion, und zwar mit Absicht: dieselbe Antwort entscheidet, ob
 * der Knopf ueberhaupt erscheint, was im Bestaetigungsdialog steht und ob die
 * Aktion durchgeht. Zwei Regeln waeren zwei Gelegenheiten, auseinanderzulaufen -
 * und die unangenehme Variante davon ist ein Knopf, der sichtbar ist und dann
 * nicht funktioniert.
 *
 * ## Drei Bedingungen
 *
 * **Abgebrochen, ausdruecklich.** Geprueft wird der gespeicherte Zustand und
 * nicht das Etikett in der Tabelle: `CANCELLED` **und** ein gesetztes
 * `cancelledAt` - so schreibt es `brichAb`. Zusaetzlich muessen `finalizedAt`
 * und `winnerEntryId` leer sein. Eine normal beendete Runde hat beides und
 * kommt hier deshalb unter keinen Umstaenden durch; ein Gewinner, der einmal
 * feststand, darf nicht wieder zur Disposition stehen.
 *
 * **In ihrer eigenen Woche.** Der Schluessel der Runde traegt die
 * Kalenderwoche samt ISO-Jahr. Er wird mit der Woche des Augenblicks
 * verglichen - beides in Zuercher Zeit, nach ISO 8601. Damit stimmt auch der
 * Jahreswechsel: der 31. Dezember 2025 gehoert zu `2026-W01`, und eine Runde
 * mit diesem Schluessel laesst sich an diesem Tag wieder aktivieren, an
 * Silvester des Vorjahres dagegen nicht.
 *
 * **Es ist noch etwas offen.** Das Ziel ergibt sich aus dem urspruenglichen
 * Zeitplan, nicht aus dem Zustand vor dem Abbruch und nicht aus der Gegenwart:
 * es sind dieselben Schwellen, die auch `fuehreUebergaengeAus` verwendet. Die
 * Fristen werden dabei nicht verschoben - eine am Samstag wieder aktivierte
 * Runde endet am Sonntag, so wie sie es ohne den Abbruch getan haette.
 *
 * Sind alle Fristen abgelaufen, bleibt es beim Abbruch. Die Runde als offene
 * Einreichungsphase neu zu starten, hiesse eine Frist zu erfinden, die es nie
 * gab; sie in die Auswertung zu schieben, hiesse einen Gewinner aus einem
 * Wettbewerb zu kueren, den jemand abgesagt hat.
 */
export function reaktivierungsLage(runde: ReaktivierbareRunde, jetzt = new Date()): ReaktivierungsLage {
  if (
    runde.status !== 'CANCELLED' ||
    runde.cancelledAt === null ||
    runde.finalizedAt !== null ||
    runde.winnerEntryId !== null
  ) {
    return { moeglich: false, hindernis: 'NICHT_ABGEBROCHEN' };
  }

  if (kalenderwoche(jetzt).key !== runde.key) {
    return { moeglich: false, hindernis: 'ANDERE_WOCHE' };
  }

  if (jetzt < runde.submissionStartsAt) {
    return { moeglich: true, ziel: 'DRAFT', phaseEndetAm: runde.submissionStartsAt };
  }
  if (jetzt < runde.votingStartsAt) {
    return { moeglich: true, ziel: 'SUBMISSION', phaseEndetAm: runde.votingStartsAt };
  }
  if (jetzt < runde.votingEndsAt) {
    return { moeglich: true, ziel: 'VOTING', phaseEndetAm: runde.votingEndsAt };
  }
  return { moeglich: false, hindernis: 'FRISTEN_ABGELAUFEN' };
}

export type ReaktivierungsErgebnis =
  | { ok: true; ziel: ReaktivierungsZiel; phaseEndetAm: Date; nummer: number; key: string }
  | { ok: false; hindernis: ReaktivierungsHindernis };

/**
 * Eine abgebrochene Runde wieder aktivieren.
 *
 * ## Atomar
 *
 * Der Zustandswechsel ist ein bedingtes `updateMany` auf genau die Merkmale,
 * die `reaktivierungsLage` geprueft hat. Zwischen dem Lesen und dem Schreiben
 * kann sich die Runde noch bewegen - jemand anderes drueckt denselben Knopf,
 * ein zweiter Tab war langsamer. Wer die Zeile als Erster aus `CANCELLED`
 * herausbewegt, hat den Zuschlag; der Zweite sieht null geaenderte Zeilen.
 *
 * Der Zeitplan steht in unveraenderlichen Spalten, deshalb darf das Ziel aus
 * dem vorher gelesenen Stand kommen: es kann sich dazwischen nicht aendern.
 *
 * ## Idempotent
 *
 * Ein zweiter Aufruf trifft auf eine Runde, die nicht mehr `CANCELLED` ist,
 * aendert nichts und schreibt nichts ins Protokoll. Es entstehen dadurch
 * weder ein zweiter Wettbewerbseintrag - den verhindert ohnehin der
 * eindeutige Wochenschluessel - noch doppelte Ankuendigungen: die haengen an
 * `startMessageId` und `votingMessageId`, und die bleiben stehen.
 *
 * Stimmen und Gewinner bleiben unberuehrt. Die Runde kehrt in ihre Phase
 * zurueck, mit allem, was bis zum Abbruch geschehen war.
 */
export async function reaktiviere(
  competitionId: string,
  actor: { discordId: string; username?: string | null },
  jetzt = new Date(),
): Promise<ReaktivierungsErgebnis> {
  const runde = await prisma.clipCompetition.findUnique({ where: { id: competitionId } });
  if (!runde) {
    return { ok: false, hindernis: 'NICHT_ABGEBROCHEN' };
  }

  const lage = reaktivierungsLage(runde, jetzt);
  if (!lage.moeglich || !lage.ziel || !lage.phaseEndetAm) {
    return { ok: false, hindernis: lage.hindernis ?? 'NICHT_ABGEBROCHEN' };
  }

  const { count } = await prisma.clipCompetition.updateMany({
    where: {
      id: competitionId,
      status: 'CANCELLED',
      cancelledAt: { not: null },
      finalizedAt: null,
      winnerEntryId: null,
    },
    /*
     * Der Abbruch wird geloescht, nicht behalten.
     *
     * Ein `cancelledAt` an einer laufenden Runde waere eine Angabe, die
     * nicht mehr stimmt - und der naechste, der darauf prueft, laege falsch.
     * Was war, steht im Protokoll: der Abbruch als eigener Eintrag und
     * darunter dieser hier, samt Zeitpunkt und Urheber des Abbruchs.
     */
    data: { status: lage.ziel, cancelledAt: null, cancelledByDiscordId: null },
  });
  if (count === 0) {
    return { ok: false, hindernis: 'NICHT_ABGEBROCHEN' };
  }

  await recordAudit({
    action: AUDIT_ACTIONS.CLIP_COMPETITION_REOPENED,
    module: CLIPS_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username ?? null,
    targetLabel: `Clip of the Week #${runde.number}`,
    metadata: {
      competitionId,
      key: runde.key,
      nummer: runde.number,
      ziel: lage.ziel,
      phaseEndetAm: lage.phaseEndetAm.toISOString(),
      abgebrochenAm: runde.cancelledAt?.toISOString() ?? null,
      abgebrochenVon: runde.cancelledByDiscordId,
    },
  });

  log.info('Clip-Runde wieder aktiviert', { competitionId, key: runde.key, ziel: lage.ziel });
  return { ok: true, ziel: lage.ziel, phaseEndetAm: lage.phaseEndetAm, nummer: runde.number, key: runde.key };
}

/** Die Runde, um die es gerade geht - oder `null`. */
export async function aktuelleRunde(guildId: string): Promise<ClipCompetition | null> {
  return prisma.clipCompetition.findFirst({
    where: { guildId, status: { in: ['SUBMISSION', 'VOTING', 'FINALIZING'] } },
    orderBy: { number: 'desc' },
  });
}

/**
 * Die Runde fuer die Anzeige.
 *
 * Laeuft keine, wird die zuletzt abgeschlossene gezeigt - eine Seite, die
 * zwischen Sonntagabend und Montagfrueh leer ist, sieht kaputt aus, obwohl
 * gerade nur nichts laeuft.
 */
export async function rundeFuerAnzeige(guildId: string): Promise<ClipCompetition | null> {
  return (
    (await aktuelleRunde(guildId)) ??
    prisma.clipCompetition.findFirst({
      where: { guildId, status: 'COMPLETED' },
      orderBy: { number: 'desc' },
    })
  );
}

/** Sicherstellen, dass das Modul eingeschaltet ist. */
export async function verlangeModul(): Promise<void> {
  if (!(await isModuleEnabled(CLIPS_MODULE_ID))) {
    throw new AppError('FORBIDDEN', { userMessage: 'Clip of the Week ist derzeit ausgeschaltet.' });
  }
}
