import { Prisma, prisma, recordAudit, AUDIT_ACTIONS } from '@swisshub/database';
import { discord as defaultDiscord, type DiscordGateway } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { AppError, sanitizeText } from '@swisshub/shared';
import { getModuleSettings } from '../module-state';
import { meldeEreignis } from '../automation/emit';
import { kuendigeClipAn } from './ankuendigung';
import { CLIPS_MODULE_ID, type ClipsSettings } from './config';
import { erkenneClip, erkenneUpload } from './provider';
import { VIDEO_NAME_MUSTER, listeVideos, loescheVideo, videoAlterMs } from './video-speicher';
import { aktuelleRunde, verlangeModul } from './wettbewerb';
import type { ClipCompetition, ClipReportReason } from '@swisshub/database';

const log = createLogger('clips:service');

/**
 * Einreichen, moderieren, abstimmen.
 *
 * Jede Pruefung steht hier und nicht in der Oberflaeche. Die Oberflaeche
 * entscheidet, was sie zeigt; was geschieht, entscheidet diese Datei - sonst
 * waere jeder Knopf, den jemand umgeht, eine Luecke.
 */

export interface Handelnder {
  discordId: string;
  username?: string | null;
  displayName?: string | null;
  avatarHash?: string | null;
}

/** Die Gruende, aus denen ein Clip abgelehnt wird. */
export const ABLEHNUNGSGRUENDE = [
  { key: 'INAPPROPRIATE', label: 'Unpassender Inhalt' },
  { key: 'NO_GAMING', label: 'Kein Gaming-Bezug' },
  { key: 'BROKEN', label: 'Clip funktioniert nicht' },
  { key: 'RIGHTS', label: 'Rechte unklar' },
  { key: 'DUPLICATE', label: 'Mehrfach eingereicht' },
  { key: 'OTHER', label: 'Sonstiges' },
] as const;

export type Ablehnungsgrund = (typeof ABLEHNUNGSGRUENDE)[number]['key'];

const GRUND_TEXT = new Map<string, string>(ABLEHNUNGSGRUENDE.map((e) => [e.key, e.label]));

// --- Einreichen -------------------------------------------------------------

export interface EinreichungsEingabe {
  /**
   * Die Adresse bei Twitch, YouTube oder Medal.
   *
   * Entweder das **oder** `upload` - nie beides. Als zwei optionale Felder
   * statt als Union, weil jede bestehende Aufrufstelle `url` übergibt und
   * eine Union jede davon zu einer Änderung machen würde, ohne dass an einer
   * einzigen etwas anderes gemeint wäre.
   */
  url?: string | null;
  /**
   * Eine bereits abgelegte Clipdatei.
   *
   * Die Datei liegt zu diesem Zeitpunkt schon im Upload-Verzeichnis: sie
   * musste geprüft werden, um ihren Container zu kennen, und geprüft heisst
   * gelesen. Wer diesen Weg benutzt, ist dafür verantwortlich, die Datei
   * wieder zu löschen, wenn `reicheEin` wirft - siehe die Server Action.
   */
  upload?: { dateiname: string; container: 'mp4' | 'webm' } | null;
  titel: string;
  beschreibung?: string | null;
  gameId?: string | null;
  gameName?: string | null;
}

/**
 * Darf diese Person jetzt etwas einreichen?
 *
 * Genau die Bedingungen, die nichts mit dem Clip selbst zu tun haben:
 * laufende Runde, offene Einreichungen, Serverzeit vor dem Schluss, eigenes
 * Kontingent nicht aufgebraucht. Gibt die Runde zurück, damit der Aufrufer
 * sie nicht erneut holen muss.
 *
 * ## Warum das eine eigene Funktion ist
 *
 * Wegen der Uploads. Eine hochgeladene Datei muss **gelesen** werden, um ihren
 * Container zu kennen, und damit liegt sie auf der Platte, bevor `reicheEin`
 * je etwas prüfen kann. Ohne diese Vorprüfung wäre «Runde geschlossen» eine
 * Antwort, die erst nach 100 MB Schreiben kommt - und fünf Versuche je zehn
 * Minuten wären ein halbes Gigabyte für nichts.
 *
 * Die Server Action fragt deshalb **zuerst** hier und liest die Datei erst
 * danach. `reicheEin` fragt trotzdem noch einmal: zwischen Vorprüfung und
 * Einreichung liegt der Upload, und in dieser Zeit kann die Runde schliessen.
 */
export async function pruefeEinreichungsfenster(
  guildId: string,
  discordId: string,
  jetzt = new Date(),
): Promise<ClipCompetition> {
  await verlangeModul();

  const runde = await aktuelleRunde(guildId);
  if (!runde) {
    throw new AppError('CONFLICT', { userMessage: 'Zurzeit läuft keine Runde.' });
  }
  if (runde.status !== 'SUBMISSION') {
    throw new AppError('CONFLICT', {
      userMessage:
        runde.status === 'VOTING'
          ? 'Die Einreichungen für diese Runde sind geschlossen - es wird bereits abgestimmt.'
          : 'Die Einreichungen für diese Runde sind geschlossen.',
    });
  }
  /*
   * Die Serverzeit entscheidet, nicht der Zustand allein.
   *
   * Zwischen dem Ende der Einreichungen und dem naechsten Durchgang liegt
   * hoechstens eine Minute. In dieser Minute steht die Runde noch auf
   * SUBMISSION - eine Einreichung waere dann nach Ablauf angenommen.
   */
  if (jetzt >= runde.submissionEndsAt) {
    throw new AppError('CONFLICT', { userMessage: 'Die Einreichungen für diese Runde sind geschlossen.' });
  }

  const eigene = await prisma.clipCompetitionEntry.count({
    where: {
      competitionId: runde.id,
      submittedByDiscordId: discordId,
      status: { in: ['PENDING', 'APPROVED'] },
    },
  });
  if (eigene >= runde.submissionsPerMember) {
    throw new AppError('CONFLICT', {
      userMessage:
        runde.submissionsPerMember === 1
          ? 'Du hast für diese Runde bereits einen Clip eingereicht.'
          : `Du hast für diese Runde bereits ${runde.submissionsPerMember} Clips eingereicht.`,
    });
  }

  return runde;
}

/**
 * Einen Clip ins Rennen schicken.
 *
 * Fuenf Bedingungen, in dieser Reihenfolge - die guenstigste zuerst, damit
 * eine abgelehnte Einreichung nicht erst die Datenbank belastet:
 *
 *   1. Modul an, Runde laeuft, Einreichungen offen
 *   2. die Adresse ist ein Clip eines erlaubten Anbieters
 *   3. das eigene Einreichungskonto ist nicht aufgebraucht
 *   4. der Clip steht nicht schon in dieser Runde
 *   5. dann erst wird geschrieben
 *
 * Der Clip selbst entsteht unabhaengig vom Wettbewerb. Das ist Absicht: er
 * soll spaeter auch ausserhalb dieser Runde auffindbar sein.
 */
export async function reicheEin(
  guildId: string,
  actor: Handelnder,
  eingabe: EinreichungsEingabe,
  jetzt = new Date(),
): Promise<{ clipId: string; entryId: string; competition: ClipCompetition }> {
  const runde = await pruefeEinreichungsfenster(guildId, actor.discordId, jetzt);

  /*
   * Woher der Clip kommt, entscheidet sich hier - und nur hier.
   *
   * Beide Wege enden in einem `ErkannterClip`, und alles danach - Titel,
   * Kontingent, Spiel, `upsert`, Teilnahme, Moderation, Abstimmung, Finale,
   * Hall of Fame - sieht keinen Unterschied. Das ist der Grund, warum der
   * Upload überhaupt so gebaut ist: eine zweite Einreichungsfunktion für
   * Dateien wäre eine zweite Stelle, an der Kontingent und Rundenschluss
   * geprüft werden müssten.
   */
  const erkannt = eingabe.upload
    ? erkenneUpload(eingabe.upload.dateiname, eingabe.upload.container)
    : erkenneClip(eingabe.url ?? '');

  const titel = sanitizeText(eingabe.titel, 120).trim();
  if (titel.length < 3) {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Gib deinem Clip einen kurzen Titel.' });
  }
  const beschreibung = eingabe.beschreibung ? sanitizeText(eingabe.beschreibung, 500).trim() : null;

  const spiel = await loeseSpielAuf(eingabe.gameId ?? null, eingabe.gameName ?? null);

  try {
    const ergebnis = await prisma.$transaction(async (tx) => {
      /*
       * Der Clip.
       *
       * `upsert` auf (guildId, provider, externalId): denselben Clip gibt es
       * je Server einmal. Wurde er frueher schon eingereicht, wird er
       * wiederverwendet - und eine frueher ausgesprochene Ablehnung wird
       * dabei **nicht** geloescht, sondern der Clip wandert zurueck auf
       * PENDING. Die Moderation entscheidet neu.
       */
      const clip = await tx.clip.upsert({
        where: {
          guildId_provider_externalId: {
            guildId,
            provider: erkannt.provider,
            externalId: erkannt.externalId,
          },
        },
        create: {
          guildId,
          submittedByDiscordId: actor.discordId,
          submittedByUsername: actor.username ?? null,
          submittedByDisplayName: actor.displayName ?? null,
          submittedByAvatarHash: actor.avatarHash ?? null,
          sourceType: erkannt.sourceType,
          provider: erkannt.provider,
          externalId: erkannt.externalId,
          canonicalUrl: erkannt.canonicalUrl,
          embedUrl: erkannt.embedUrl,
          thumbnailUrl: erkannt.thumbnailUrl,
          title: titel,
          description: beschreibung,
          gameId: spiel.gameId,
          gameName: spiel.gameName,
          status: 'PENDING',
        },
        update: {
          title: titel,
          description: beschreibung,
          gameId: spiel.gameId,
          gameName: spiel.gameName,
          status: 'PENDING',
          rejectedAt: null,
          rejectedByDiscordId: null,
          rejectionReason: null,
          rejectionNote: null,
          removedAt: null,
          removedByDiscordId: null,
        },
      });

      /*
       * Die Teilnahme.
       *
       * Steht der Clip schon in dieser Runde, entscheidet sein bisheriger
       * Ausgang, was jetzt geschieht:
       *
       *   PENDING / APPROVED - er ist bereits dabei. Nichts zu tun.
       *   REJECTED           - ein neuer Anlauf. Wer den Ausschnitt
       *                        korrigiert, soll es erneut versuchen koennen;
       *                        die Moderation entscheidet neu.
       *   REMOVED            - die Moderation hat ihn aus der Runde
       *                        genommen. Das laesst sich nicht dadurch
       *                        aufheben, dass man ihn nochmals einreicht.
       */
      const vorhanden = await tx.clipCompetitionEntry.findUnique({
        where: { competitionId_clipId: { competitionId: runde.id, clipId: clip.id } },
      });

      if (vorhanden?.status === 'REMOVED') {
        throw new AppError('CONFLICT', {
          userMessage: 'Dieser Clip wurde aus der laufenden Runde genommen.',
        });
      }
      if (vorhanden && vorhanden.status !== 'REJECTED') {
        throw new AppError('CONFLICT', {
          userMessage: 'Dieser Clip wurde für diese Runde bereits eingereicht.',
        });
      }

      const entry = vorhanden
        ? await tx.clipCompetitionEntry.update({
            where: { id: vorhanden.id },
            data: { status: 'PENDING', submittedByDiscordId: actor.discordId, approvedAt: null },
          })
        : await tx.clipCompetitionEntry.create({
            data: {
              competitionId: runde.id,
              clipId: clip.id,
              submittedByDiscordId: actor.discordId,
              status: 'PENDING',
            },
          });

      return { clipId: clip.id, entryId: entry.id, competition: runde };
    });

    /*
     * Gemeldet wird nach der Transaktion, nicht darin.
     *
     * Ein Ereignis in einer Transaktion zu melden hiesse, es auch dann zu
     * melden, wenn die Transaktion danach zurueckgerollt wird - eine Meldung
     * ueber eine Einreichung, die es nicht gibt. `meldeEreignis` wirft nie;
     * die Einreichung steht bereits.
     */
    await meldeEreignis(
      'clips.submitted',
      {
        clipId: ergebnis.clipId,
        entryId: ergebnis.entryId,
        competitionId: runde.id,
        titel,
        discordId: actor.discordId,
        provider: erkannt.provider,
      },
      { guildId, actorId: actor.discordId, subjectId: actor.discordId, entityId: ergebnis.entryId },
    );

    await recordAudit({
      action: AUDIT_ACTIONS.CLIP_SUBMITTED,
      module: CLIPS_MODULE_ID,
      actorDiscordId: actor.discordId,
      actorUsername: actor.username ?? null,
      targetLabel: titel,
      metadata: {
        clipId: ergebnis.clipId,
        entryId: ergebnis.entryId,
        competitionId: runde.id,
        provider: erkannt.provider,
      },
    });

    return ergebnis;
  } catch (error) {
    // P2002 auf (competitionId, clipId): der Clip steht schon in dieser Runde.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError('CONFLICT', {
        userMessage: 'Dieser Clip wurde für diese Runde bereits eingereicht.',
      });
    }
    throw error;
  }
}

/** Das Spiel aus dem zentralen Katalog - oder ein Freitext als Rueckfall. */
async function loeseSpielAuf(
  gameId: string | null,
  gameName: string | null,
): Promise<{ gameId: string | null; gameName: string | null }> {
  if (gameId) {
    const spiel = await prisma.game.findUnique({
      where: { id: gameId },
      select: { id: true, name: true },
    });
    if (spiel) {
      return { gameId: spiel.id, gameName: null };
    }
  }
  const frei = gameName ? sanitizeText(gameName, 60).trim() : '';
  return { gameId: null, gameName: frei.length > 0 ? frei : null };
}

// --- Moderation -------------------------------------------------------------

/**
 * Einen Clip freigeben.
 *
 * `gateway` ist ausschliesslich fuer Tests da - im Betrieb ist es der
 * gemeinsame Zugang. Ohne diese Naht muesste ein Test entweder gegen Discord
 * senden oder die Vorstellung des Clips ungeprueft lassen.
 */
export async function gibFrei(
  entryId: string,
  actor: Handelnder,
  gateway: DiscordGateway = defaultDiscord,
): Promise<void> {
  const eintrag = await prisma.clipCompetitionEntry.findUnique({
    where: { id: entryId },
    include: { clip: true, competition: true },
  });
  if (!eintrag) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Einreichung gibt es nicht.' });
  }
  if (eintrag.status === 'APPROVED') {
    return;
  }

  const jetzt = new Date();
  await prisma.$transaction([
    prisma.clipCompetitionEntry.update({
      where: { id: entryId },
      data: { status: 'APPROVED', approvedAt: jetzt },
    }),
    prisma.clip.update({
      where: { id: eintrag.clipId },
      data: {
        status: 'APPROVED',
        approvedAt: jetzt,
        approvedByDiscordId: actor.discordId,
        rejectedAt: null,
        rejectionReason: null,
        rejectionNote: null,
      },
    }),
  ]);

  await recordAudit({
    action: AUDIT_ACTIONS.CLIP_APPROVED,
    module: CLIPS_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username ?? null,
    targetDiscordId: eintrag.submittedByDiscordId,
    targetLabel: eintrag.clip.title,
    metadata: { clipId: eintrag.clipId, entryId, competitionId: eintrag.competitionId },
  });
  await meldeEreignis(
    'clips.approved',
    {
      clipId: eintrag.clipId,
      entryId,
      competitionId: eintrag.competitionId,
      titel: eintrag.clip.title,
      discordId: eintrag.submittedByDiscordId,
    },
    {
      guildId: eintrag.competition.guildId,
      actorId: actor.discordId,
      subjectId: eintrag.submittedByDiscordId,
      entityId: entryId,
    },
  );
  // Optional: den Clip einzeln vorstellen. Standardmaessig aus.
  await kuendigeClipAn(eintrag.clip, gateway);
  log.info('Clip freigegeben', { entryId, clipId: eintrag.clipId });
}

/** Einen Clip ablehnen - mit Grund. */
export async function lehneAb(
  entryId: string,
  actor: Handelnder,
  grund: Ablehnungsgrund,
  notiz?: string | null,
): Promise<void> {
  const eintrag = await prisma.clipCompetitionEntry.findUnique({
    where: { id: entryId },
    include: { clip: true },
  });
  if (!eintrag) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Einreichung gibt es nicht.' });
  }
  if (!GRUND_TEXT.has(grund)) {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Bitte einen Grund auswählen.' });
  }
  const text = notiz ? sanitizeText(notiz, 300).trim() : null;
  if (grund === 'OTHER' && (!text || text.length < 3)) {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Bitte kurz begründen.' });
  }

  const jetzt = new Date();
  await prisma.$transaction([
    prisma.clipCompetitionEntry.update({ where: { id: entryId }, data: { status: 'REJECTED' } }),
    prisma.clip.update({
      where: { id: eintrag.clipId },
      data: {
        status: 'REJECTED',
        rejectedAt: jetzt,
        rejectedByDiscordId: actor.discordId,
        rejectionReason: grund,
        rejectionNote: text,
      },
    }),
  ]);

  /*
   * Bei einer hochgeladenen Datei: weg damit.
   *
   * Ein abgelehnter Clip wird nie wieder gezeigt - und «unpassender Inhalt»
   * ist der häufigste Ablehnungsgrund. Ihn auf der Platte zu behalten wäre
   * eine Kopie von genau dem, was die Moderation entfernt hat.
   *
   * Ein neuer Anlauf bleibt möglich: er wäre ein neuer Upload mit neuem
   * Namen. Die Datei des abgelehnten Versuchs wird dafür nicht gebraucht.
   *
   * Nur beim Ablehnen, nicht beim Herausnehmen aus der Runde: dort bleibt der
   * Clip selbst gültig und kann in einer späteren Runde wieder antreten.
   *
   * Nach der Transaktion und ohne `await` auf ein Ergebnis: eine Datei, die
   * sich nicht löschen lässt, darf die Ablehnung nicht zurückrollen.
   */
  if (eintrag.clip.sourceType === 'UPLOAD' && VIDEO_NAME_MUSTER.test(eintrag.clip.externalId)) {
    await loescheVideo(eintrag.clip.externalId);
  }

  await recordAudit({
    action: AUDIT_ACTIONS.CLIP_REJECTED,
    module: CLIPS_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username ?? null,
    targetDiscordId: eintrag.submittedByDiscordId,
    targetLabel: eintrag.clip.title,
    metadata: { clipId: eintrag.clipId, entryId, grund, ...(text ? { notiz: text } : {}) },
  });

  await meldeEreignis(
    'clips.rejected',
    {
      clipId: eintrag.clipId,
      entryId,
      competitionId: eintrag.competitionId,
      titel: eintrag.clip.title,
      discordId: eintrag.submittedByDiscordId,
      grund,
      notiz: text,
    },
    { actorId: actor.discordId, subjectId: eintrag.submittedByDiscordId, entityId: entryId },
  );
}

/**
 * Einen bereits freigegebenen Clip aus der Runde nehmen.
 *
 * Der Clip selbst bleibt - er ist eine Sache fuer sich. Nur seine Teilnahme
 * endet. War er der Gewinner einer abgeschlossenen Runde, bleibt das
 * Ergebnis stehen: eine stillschweigend neu bestimmte Gewinnerin waere eine
 * Geschichtsfaelschung. Wer das aendern will, laesst die Runde neu
 * abschliessen - ausdruecklich und mit Eintrag im Protokoll.
 */
export async function nimmAusRunde(entryId: string, actor: Handelnder, grund?: string | null): Promise<void> {
  const eintrag = await prisma.clipCompetitionEntry.findUnique({
    where: { id: entryId },
    include: { clip: true, competition: true },
  });
  if (!eintrag) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Einreichung gibt es nicht.' });
  }

  await prisma.clipCompetitionEntry.update({
    where: { id: entryId },
    data: {
      status: 'REMOVED',
      removedAt: new Date(),
      removedByDiscordId: actor.discordId,
      removalReason: grund ? sanitizeText(grund, 300) : null,
    },
  });

  await recordAudit({
    action: AUDIT_ACTIONS.CLIP_REMOVED,
    module: CLIPS_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username ?? null,
    targetLabel: eintrag.clip.title,
    metadata: {
      clipId: eintrag.clipId,
      entryId,
      competitionId: eintrag.competitionId,
      warGewinner: eintrag.competition.winnerEntryId === entryId,
    },
  });
}

// --- Abstimmen --------------------------------------------------------------

export interface StimmErgebnis {
  gesetzt: boolean;
  /** Wie viele Stimmen noch übrig sind. */
  verbleibend: number;
  /** Stimmen auf diesen Clip - nur, wenn sie gezeigt werden dürfen. */
  stimmen: number | null;
}

/**
 * Eine Stimme vergeben.
 *
 * ## Warum das nicht ohne Datenbankbedingung geht
 *
 * Zwei Klicks kurz hintereinander - ein Doppelklick, zwei Tabs - laufen beide
 * durch jede Pruefung, bevor einer von beiden schreibt. Eine Pruefung «hat er
 * schon gestimmt?» sagt dann zweimal nein.
 *
 * Deshalb entscheidet die Eindeutigkeitsbedingung
 * `(competitionId, entryId, voterDiscordId)`: beide schreiben, genau einer
 * kommt durch, der andere bekommt P2002 - und das ist hier kein Fehler,
 * sondern die Antwort «schon gestimmt».
 *
 * Das Stimmenkonto zaehlt innerhalb derselben Transaktion, und die Zeile der
 * Runde wird dabei gesperrt: ohne diese Sperre koennten zwei Stimmen auf
 * **verschiedene** Clips gleichzeitig gezaehlt werden und beide die letzte
 * freie Stimme verbrauchen.
 */
export async function stimmeAb(
  guildId: string,
  actor: Handelnder,
  entryId: string,
  jetzt = new Date(),
): Promise<StimmErgebnis> {
  await verlangeModul();

  const eintrag = await prisma.clipCompetitionEntry.findUnique({
    where: { id: entryId },
    include: { competition: true },
  });
  if (!eintrag || eintrag.competition.guildId !== guildId) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diesen Clip gibt es nicht.' });
  }
  const runde = eintrag.competition;

  if (runde.status !== 'VOTING') {
    throw new AppError('CONFLICT', {
      userMessage:
        runde.status === 'SUBMISSION'
          ? 'Das Voting hat noch nicht begonnen.'
          : 'Das Voting für diese Runde ist beendet.',
    });
  }
  // Serverzeit, nicht die des Browsers.
  if (jetzt < runde.votingStartsAt) {
    throw new AppError('CONFLICT', { userMessage: 'Das Voting hat noch nicht begonnen.' });
  }
  if (jetzt >= runde.votingEndsAt) {
    throw new AppError('CONFLICT', { userMessage: 'Das Voting für diese Runde ist beendet.' });
  }
  if (eintrag.status !== 'APPROVED') {
    throw new AppError('CONFLICT', { userMessage: 'Dieser Clip steht nicht zur Abstimmung.' });
  }
  if (!runde.allowSelfVote && eintrag.submittedByDiscordId === actor.discordId) {
    throw new AppError('FORBIDDEN', { userMessage: 'Für den eigenen Clip kannst du nicht stimmen.' });
  }

  try {
    const verbleibend = await prisma.$transaction(async (tx) => {
      /*
       * Die Runde sperren.
       *
       * Das Stimmenkonto gilt je Runde, nicht je Clip - die Bedingung auf
       * `ClipVote` schuetzt also nicht davor, dass jemand mit einer
       * verbleibenden Stimme gleichzeitig zwei verschiedene Clips waehlt.
       * Diese Sperre stellt die beiden Vorgaenge hintereinander.
       */
      await tx.$queryRaw`SELECT "id" FROM "ClipCompetition" WHERE "id" = ${runde.id} FOR UPDATE`;

      const schon = await tx.clipVote.count({
        where: { competitionId: runde.id, voterDiscordId: actor.discordId },
      });
      if (schon >= runde.votesPerMember) {
        throw new AppError('CONFLICT', {
          userMessage: 'Du hast deine Stimmen für diese Runde bereits vergeben.',
        });
      }

      await tx.clipVote.create({
        data: { competitionId: runde.id, entryId, voterDiscordId: actor.discordId },
      });

      return runde.votesPerMember - (schon + 1);
    });

    return {
      gesetzt: true,
      verbleibend,
      stimmen: runde.showVoteCounts ? await zaehleStimmen(entryId) : null,
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError('CONFLICT', { userMessage: 'Für diesen Clip hast du bereits gestimmt.' });
    }
    throw error;
  }
}

/**
 * Eine Stimme zuruecknehmen.
 *
 * Erlaubt, solange abgestimmt wird: wer sich vertippt oder spaeter einen
 * besseren Clip findet, soll seine Stimme umsetzen koennen. Nach dem Ende
 * nicht mehr - dort ist das Ergebnis Geschichte.
 */
export async function nimmStimmeZurueck(
  guildId: string,
  actor: Handelnder,
  entryId: string,
  jetzt = new Date(),
): Promise<StimmErgebnis> {
  const eintrag = await prisma.clipCompetitionEntry.findUnique({
    where: { id: entryId },
    include: { competition: true },
  });
  if (!eintrag || eintrag.competition.guildId !== guildId) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diesen Clip gibt es nicht.' });
  }
  const runde = eintrag.competition;
  if (runde.status !== 'VOTING' || jetzt >= runde.votingEndsAt) {
    throw new AppError('CONFLICT', { userMessage: 'Das Voting für diese Runde ist beendet.' });
  }

  await prisma.clipVote.deleteMany({
    where: { competitionId: runde.id, entryId, voterDiscordId: actor.discordId },
  });

  const schon = await prisma.clipVote.count({
    where: { competitionId: runde.id, voterDiscordId: actor.discordId },
  });
  return {
    gesetzt: false,
    verbleibend: runde.votesPerMember - schon,
    stimmen: runde.showVoteCounts ? await zaehleStimmen(entryId) : null,
  };
}

const zaehleStimmen = (entryId: string): Promise<number> => prisma.clipVote.count({ where: { entryId } });

/** Wie viele Stimmen jemand in dieser Runde noch hat. */
export async function verbleibendeStimmen(
  competition: Pick<ClipCompetition, 'id' | 'votesPerMember'>,
  discordId: string,
): Promise<number> {
  const schon = await prisma.clipVote.count({
    where: { competitionId: competition.id, voterDiscordId: discordId },
  });
  return Math.max(0, competition.votesPerMember - schon);
}

// --- Melden -----------------------------------------------------------------

/** Einen Clip melden. Eine Meldung je Person und Clip. */
export async function melde(
  clipId: string,
  actor: Handelnder,
  reason: ClipReportReason,
  notiz?: string | null,
): Promise<void> {
  const clip = await prisma.clip.findUnique({ where: { id: clipId }, select: { id: true, title: true } });
  if (!clip) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diesen Clip gibt es nicht.' });
  }

  try {
    await prisma.clipReport.create({
      data: {
        clipId,
        reporterDiscordId: actor.discordId,
        reason,
        note: notiz ? sanitizeText(notiz, 300) : null,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      // Schon gemeldet. Kein Fehler - die Meldung liegt beim Team.
      return;
    }
    throw error;
  }

  await recordAudit({
    action: AUDIT_ACTIONS.CLIP_REPORTED,
    module: CLIPS_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username ?? null,
    targetLabel: clip.title,
    metadata: { clipId, reason },
  });
}

/** Eine Meldung als bearbeitet markieren. */
export async function erledigeMeldungen(clipId: string, actor: Handelnder): Promise<number> {
  const { count } = await prisma.clipReport.updateMany({
    where: { clipId, resolvedAt: null },
    data: { resolvedAt: new Date(), resolvedByDiscordId: actor.discordId },
  });
  if (count > 0) {
    await recordAudit({
      action: AUDIT_ACTIONS.CLIP_REPORT_RESOLVED,
      module: CLIPS_MODULE_ID,
      actorDiscordId: actor.discordId,
      actorUsername: actor.username ?? null,
      metadata: { clipId, anzahl: count },
    });
  }
  return count;
}

/** Die Einstellungen des Moduls. */
export const clipEinstellungen = (): Promise<ClipsSettings> =>
  getModuleSettings<ClipsSettings>(CLIPS_MODULE_ID);

export { GRUND_TEXT as ABLEHNUNGSGRUND_TEXT };

/**
 * Dateien löschen, zu denen es keinen Clip gibt.
 *
 * ## Woher solche Dateien kommen
 *
 * Eine Clipdatei muss geschrieben werden, bevor die Einreichung sie prüfen
 * kann - geprüft heisst gelesen. Der Upload-Endpunkt löscht sie deshalb
 * selbst, wenn die Einreichung danach scheitert. Was er nicht abdeckt, ist der
 * Abbruch dazwischen: ein Neustart, ein abgebrochener Prozess, ein Timeout des
 * Reverse Proxy. Dann liegt eine Datei da, deren Namen niemand mehr kennt.
 *
 * Einzeln ist das belanglos. Über Monate ist es der Grund, warum eine Platte
 * voll ist und niemand sagen kann, wovon - und ein volles Dateisystem nimmt
 * die Datenbank mit.
 *
 * ## Die Frist
 *
 * Eine Datei wird erst nach einer Stunde als verwaist behandelt. Ohne diese
 * Frist würde ein Durchgang, der zufällig mitten in einem laufenden Upload
 * fällt, die Datei unter der Einreichung wegziehen - der Vorgang hat die Datei
 * dann schon geschrieben, aber der Clip steht noch nicht.
 *
 * ## Läuft auf dem bestehenden Takt
 *
 * `runClipsTick` ruft das mit. Kein zweiter Zeitplan, kein eigener Dienst: es
 * gibt genau einen Wecker für dieses Modul, und er läuft ohnehin jede Minute.
 */
const WAISENFRIST_MS = 60 * 60 * 1000;

export async function raeumeVerwaisteVideos(jetzt = new Date()): Promise<number> {
  const dateien = await listeVideos();
  if (dateien.length === 0) {
    return 0;
  }

  /*
   * Eine Abfrage für alle, nicht eine je Datei.
   *
   * `externalId` ist bei Uploads der Dateiname. Bei zweihundert Dateien wären
   * zweihundert Abfragen je Minute - eine Aufräumarbeit, die mehr kostet als
   * das, was sie aufräumt.
   */
  const bekannt = new Set(
    (
      await prisma.clip.findMany({
        where: { sourceType: 'UPLOAD', externalId: { in: dateien } },
        select: { externalId: true },
      })
    ).map((clip) => clip.externalId),
  );

  let geloescht = 0;
  for (const datei of dateien) {
    if (bekannt.has(datei)) {
      continue;
    }
    const alter = await videoAlterMs(datei, jetzt);
    if (alter === null || alter < WAISENFRIST_MS) {
      continue;
    }
    await loescheVideo(datei);
    geloescht += 1;
  }

  if (geloescht > 0) {
    log.info('Verwaiste Clipdateien geloescht', { geloescht, gepruef: dateien.length });
  }
  return geloescht;
}
