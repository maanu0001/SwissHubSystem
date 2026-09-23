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
  await recordAudit({
    action: AUDIT_ACTIONS.CLIP_COMPETITION_CANCELLED,
    module: CLIPS_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username ?? null,
    metadata: { competitionId, ...(grund ? { grund } : {}) },
  });
  return true;
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
