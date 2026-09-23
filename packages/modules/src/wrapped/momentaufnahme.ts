import { AUDIT_ACTIONS, prisma, recordAudit } from '@swisshub/database';
import type { Prisma } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { AppError } from '@swisshub/shared';
import { getModuleSettings } from '../module-state';
import { WRAPPED_MODULE_ID, type WrappedSettings } from './config';
import { verlangeKampagne, szenenEinstellungen, zeitraumVon } from './kampagne';
import { ermittleQuellen, sammleDaten } from './resolver';
import { baueGeschichte } from './szenen';
import type { WrappedCampaign, WrappedGenerationRun } from '@swisshub/database';
import type { WrappedDaten } from './daten';
import type { ResolverKontext } from './resolver';

const log = createLogger('wrapped:momentaufnahme');

/**
 * Die Momentaufnahmen - einmal rechnen, dann festschreiben.
 *
 * ## Warum in Stapeln und nicht am Stueck
 *
 * Sechstausend Mitglieder, je ein gutes Dutzend Abfragen: am Stueck waere
 * das eine Transaktion, die die Datenbank minutenlang belegt, und ein
 * Neustart mittendrin faenge von vorne an. In Stapeln ist es eine Folge
 * kurzer Durchgaenge - jeder fuer sich abgeschlossen, jeder fuer sich
 * wiederholbar.
 *
 * ## Warum ein Zeiger und kein Zaehler
 *
 * `cursor` haelt die zuletzt bearbeitete Discord-Kennung fest, und der
 * naechste Stapel beginnt dahinter. Ein Zaehler («bei 2400 weitermachen»)
 * waere falsch, sobald zwischendurch jemand dazukommt oder wegfaellt - dann
 * verschoebe sich die Liste, und ein Teil bliebe uebersprungen.
 *
 * ## Warum ein Fehler nur eine Person betrifft
 *
 * Jede Momentaufnahme laeuft fuer sich. Wenn eine scheitert - eine
 * kaputte Zeile, ein Zeitueberlauf -, wird sie vermerkt und der Stapel
 * laeuft weiter. Ein Durchgang, der beim ersten Fehler stehenbleibt, waere
 * bei sechstausend Personen praktisch nie fertig.
 */

export interface DurchgangFortschritt {
  runId: string;
  status: WrappedGenerationRun['status'];
  total: number;
  processed: number;
  created: number;
  skipped: number;
  failed: number;
  /** Anteil zwischen 0 und 1. */
  anteil: number;
}

interface Kandidat {
  discordId: string;
  messages: number;
  voiceSeconds: number;
  activeDays: number;
}

/**
 * Wer ueberhaupt einen Rueckblick bekommt.
 *
 * ## Die Regel
 *
 * Mindestens **eine** der drei Schwellen muss erreicht sein - aktive Tage,
 * Nachrichten oder Sprachminuten. Ein Oder und kein Und: wer 200 Stunden im
 * Voice sass und nie etwas geschrieben hat, hat eine Geschichte.
 *
 * ## Warum ueberhaupt eine Schwelle
 *
 * Weil ein Rueckblick auf drei Nachrichten kein Geschenk ist, sondern eine
 * Quittung. Wer im Dezember dazukam und zweimal hallo gesagt hat, bekommt
 * lieber nichts als eine Seite voller Nullen.
 *
 * ## Warum keine Bots
 *
 * Der Musikbot hat 4'000 Stunden Sprachzeit. Er braucht keinen Rueckblick,
 * und er wuerde jede Rangfolge verzerren, in der er auftaucht.
 */
async function ladeKandidaten(
  campaign: WrappedCampaign,
  nach: string | null,
  limit: number,
): Promise<Kandidat[]> {
  const zeilen = await prisma.$queryRaw<
    Array<{ discordId: string; messages: number; voiceSeconds: number; activeDays: number }>
  >`
    SELECT d."discordId" AS "discordId",
           COALESCE(SUM(d."messages"), 0)::int AS "messages",
           COALESCE(SUM(d."voiceSeconds"), 0)::int AS "voiceSeconds",
           COUNT(*) FILTER (WHERE d."messages" > 0 OR d."voiceSeconds" > 0)::int AS "activeDays"
      FROM "AnalyticsUserDaily" d
      LEFT JOIN "AnalyticsMemberProfile" p
        ON p."guildId" = d."guildId" AND p."discordId" = d."discordId"
     WHERE d."guildId" = ${campaign.guildId}
       AND d."day" >= ${campaign.periodStart}
       AND d."day" < ${campaign.periodEnd}
       AND COALESCE(p."isBot", false) = false
       AND (${nach}::text IS NULL OR d."discordId" > ${nach}::text)
     GROUP BY d."discordId"
    HAVING COUNT(*) FILTER (WHERE d."messages" > 0 OR d."voiceSeconds" > 0) >= ${campaign.minActiveDays}
        OR COALESCE(SUM(d."messages"), 0) >= ${campaign.minMessages}
        OR COALESCE(SUM(d."voiceSeconds"), 0) >= ${campaign.minVoiceMinutes * 60}
     ORDER BY d."discordId" ASC
     LIMIT ${limit}
  `;
  return zeilen;
}

/**
 * Die aktivsten Mitglieder des Zeitraums - als Vorschlag fuer die Vorschau.
 *
 * Dieselbe Abfrage wie oben, nur nach Aktivitaet statt nach Kennung
 * sortiert und ohne Schwellen: das Studio soll auch dann jemanden
 * vorschlagen koennen, wenn die Schwellen streng stehen. Wer hier steht,
 * hat am meisten zu zeigen - und genau daran prueft man die Gestaltung.
 *
 * Nur lesend. Diese Funktion ist Teil der Vorschau und darf es bleiben.
 */
export async function aktivsteKandidaten(
  campaign: WrappedCampaign,
  limit = 8,
): Promise<Array<{ discordId: string; name: string | null; activeDays: number }>> {
  return prisma.$queryRaw<Array<{ discordId: string; name: string | null; activeDays: number }>>`
    SELECT d."discordId" AS "discordId",
           COALESCE(MAX(p."displayName"), MAX(p."username")) AS "name",
           COUNT(*) FILTER (WHERE d."messages" > 0 OR d."voiceSeconds" > 0)::int AS "activeDays"
      FROM "AnalyticsUserDaily" d
      LEFT JOIN "AnalyticsMemberProfile" p
        ON p."guildId" = d."guildId" AND p."discordId" = d."discordId"
     WHERE d."guildId" = ${campaign.guildId}
       AND d."day" >= ${campaign.periodStart}
       AND d."day" < ${campaign.periodEnd}
       AND COALESCE(p."isBot", false) = false
     GROUP BY d."discordId"
     ORDER BY "activeDays" DESC, d."discordId" ASC
     LIMIT ${limit}
  `;
}

/** Wie viele Personen ein Durchgang zu bearbeiten hat. */
export async function zaehleKandidaten(campaign: WrappedCampaign): Promise<number> {
  const [zeile] = await prisma.$queryRaw<Array<{ anzahl: bigint }>>`
    SELECT COUNT(*)::bigint AS "anzahl" FROM (
      SELECT d."discordId"
        FROM "AnalyticsUserDaily" d
        LEFT JOIN "AnalyticsMemberProfile" p
          ON p."guildId" = d."guildId" AND p."discordId" = d."discordId"
       WHERE d."guildId" = ${campaign.guildId}
         AND d."day" >= ${campaign.periodStart}
         AND d."day" < ${campaign.periodEnd}
         AND COALESCE(p."isBot", false) = false
       GROUP BY d."discordId"
      HAVING COUNT(*) FILTER (WHERE d."messages" > 0 OR d."voiceSeconds" > 0) >= ${campaign.minActiveDays}
          OR COALESCE(SUM(d."messages"), 0) >= ${campaign.minMessages}
          OR COALESCE(SUM(d."voiceSeconds"), 0) >= ${campaign.minVoiceMinutes * 60}
    ) AS kandidaten
  `;
  return Number(zeile?.anzahl ?? 0);
}

/**
 * Einen Durchgang beginnen.
 *
 * Laeuft bereits einer, wird er zurueckgegeben statt ein zweiter angelegt:
 * zwei gleichzeitige Durchgaenge derselben Kampagne wuerden einander die
 * Zeilen unter den Fuessen wegschreiben.
 */
export async function starteDurchgang(
  campaignId: string,
  actor: { discordId: string; username?: string | null },
): Promise<WrappedGenerationRun> {
  const campaign = await verlangeKampagne(campaignId);
  if (campaign.status === 'PUBLISHED' || campaign.status === 'ARCHIVED') {
    throw new AppError('CONFLICT', {
      userMessage:
        'Für einen veröffentlichten Rückblick lassen sich die Momentaufnahmen nicht neu erzeugen - sie stehen bereits.',
    });
  }

  const laufend = await prisma.wrappedGenerationRun.findFirst({
    where: { campaignId, status: { in: ['QUEUED', 'RUNNING'] } },
    orderBy: { createdAt: 'desc' },
  });
  if (laufend) {
    return laufend;
  }

  const total = await zaehleKandidaten(campaign);
  const run = await prisma.wrappedGenerationRun.create({
    data: { campaignId, status: 'QUEUED', total, startedByDiscordId: actor.discordId },
  });

  await prisma.wrappedCampaign.updateMany({
    where: { id: campaignId, status: { in: ['DRAFT', 'READY'] } },
    data: { status: 'PREPARING' },
  });

  await recordAudit({
    action: AUDIT_ACTIONS.WRAPPED_GENERATION_STARTED,
    module: WRAPPED_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username ?? null,
    targetLabel: campaign.title,
    metadata: { campaignId, runId: run.id, total },
  });
  log.info('Wrapped-Durchgang gestartet', { campaignId, runId: run.id, total });
  return run;
}

interface FehlerEintrag {
  discordId: string;
  message: string;
}

/**
 * Einen Stapel abarbeiten.
 *
 * Gibt zurueck, ob es noch etwas zu tun gibt. Der Aufrufer - der Job des
 * Bots - ruft so lange nach, bis `false` kommt.
 */
export async function verarbeiteStapel(
  runId: string,
): Promise<{ weiter: boolean; fortschritt: DurchgangFortschritt }> {
  const run = await prisma.wrappedGenerationRun.findUnique({ where: { id: runId } });
  if (!run || run.status === 'COMPLETED' || run.status === 'CANCELLED' || run.status === 'FAILED') {
    return { weiter: false, fortschritt: fortschrittVon(run) };
  }

  const campaign = await verlangeKampagne(run.campaignId);
  const settings = await getModuleSettings<WrappedSettings>(WRAPPED_MODULE_ID);
  const zeitraum = zeitraumVon(campaign);

  /*
   * Quellen und Szeneneinstellung einmal je Stapel.
   *
   * Sie gelten fuer alle Personen gleichermassen. Sie je Person zu holen
   * waere bei hundert Personen hundertmal dieselbe Abfrage.
   */
  const [quellen, einstellungen] = await Promise.all([
    ermittleQuellen(campaign.guildId, zeitraum),
    szenenEinstellungen(campaign.id),
  ]);
  const kontext: ResolverKontext = { guildId: campaign.guildId, zeitraum, quellen };

  const kandidaten = await ladeKandidaten(campaign, run.cursor, settings.batchSize);
  if (kandidaten.length === 0) {
    const fertig = await prisma.wrappedGenerationRun.update({
      where: { id: runId },
      data: { status: 'COMPLETED', finishedAt: new Date() },
    });
    await prisma.wrappedCampaign.updateMany({
      where: { id: campaign.id, status: 'PREPARING' },
      data: { status: 'READY' },
    });
    await recordAudit({
      action: AUDIT_ACTIONS.WRAPPED_GENERATION_FINISHED,
      module: WRAPPED_MODULE_ID,
      actorDiscordId: run.startedByDiscordId,
      targetLabel: campaign.title,
      metadata: {
        campaignId: campaign.id,
        runId,
        created: fertig.created,
        skipped: fertig.skipped,
        failed: fertig.failed,
      },
    });
    log.info('Wrapped-Durchgang abgeschlossen', { runId, created: fertig.created, failed: fertig.failed });
    return { weiter: false, fortschritt: fortschrittVon(fertig) };
  }

  if (run.status === 'QUEUED') {
    await prisma.wrappedGenerationRun.update({
      where: { id: runId },
      data: { status: 'RUNNING', startedAt: new Date() },
    });
  }

  let created = 0;
  let skipped = 0;
  const fehler: FehlerEintrag[] = [];

  for (const kandidat of kandidaten) {
    try {
      const daten = await sammleDaten(kontext, kandidat.discordId);
      const sceneKeys = baueGeschichte(daten, einstellungen);

      /*
       * Zu duenn fuer eine Geschichte.
       *
       * Die Eignungsschwelle oben laesst jemanden durch, der an fuenf Tagen
       * da war. Bleiben danach nur Intro, Typ und Finale uebrig, ist das
       * keine Geschichte - dann lieber gar keine. Gezaehlt wird als
       * «uebersprungen», nicht als Fehler: es ist eine Entscheidung, kein
       * Missgeschick.
       */
      const erzaehlend = sceneKeys.filter(
        (key) => key !== 'intro' && key !== 'finale' && key !== 'archetype',
      );
      if (erzaehlend.length === 0) {
        skipped += 1;
        continue;
      }

      await schreibeMomentaufnahme(campaign.id, kandidat.discordId, daten, sceneKeys);
      created += 1;
    } catch (error) {
      fehler.push({
        discordId: kandidat.discordId,
        message: error instanceof Error ? error.message : String(error),
      });
      log.warn('Momentaufnahme gescheitert', { discordId: kandidat.discordId, error });
    }
  }

  const bisherige = Array.isArray(run.errors) ? (run.errors as unknown as FehlerEintrag[]) : [];
  const aktualisiert = await prisma.wrappedGenerationRun.update({
    where: { id: runId },
    data: {
      processed: { increment: kandidaten.length },
      created: { increment: created },
      skipped: { increment: skipped },
      failed: { increment: fehler.length },
      cursor: kandidaten[kandidaten.length - 1]?.discordId ?? run.cursor,
      errors: [...bisherige, ...fehler].slice(0, settings.maxErrors) as unknown as Prisma.InputJsonValue,
    },
  });

  return { weiter: true, fortschritt: fortschrittVon(aktualisiert) };
}

/** Eine einzelne Momentaufnahme schreiben - oder ersetzen. */
async function schreibeMomentaufnahme(
  campaignId: string,
  discordId: string,
  daten: WrappedDaten,
  sceneKeys: string[],
): Promise<void> {
  const nutzdaten = daten as unknown as Prisma.InputJsonValue;
  await prisma.wrappedSnapshot.upsert({
    where: { campaignId_discordId: { campaignId, discordId } },
    create: {
      campaignId,
      discordId,
      username: daten.person.username,
      displayName: daten.person.displayName,
      avatarHash: daten.person.avatarHash,
      data: nutzdaten,
      sceneKeys,
      archetype: daten.archetyp.key,
    },
    update: {
      username: daten.person.username,
      displayName: daten.person.displayName,
      avatarHash: daten.person.avatarHash,
      data: nutzdaten,
      sceneKeys,
      archetype: daten.archetyp.key,
      generatedAt: new Date(),
    },
  });
}

function fortschrittVon(run: WrappedGenerationRun | null): DurchgangFortschritt {
  if (!run) {
    return {
      runId: '',
      status: 'CANCELLED',
      total: 0,
      processed: 0,
      created: 0,
      skipped: 0,
      failed: 0,
      anteil: 1,
    };
  }
  return {
    runId: run.id,
    status: run.status,
    total: run.total,
    processed: run.processed,
    created: run.created,
    skipped: run.skipped,
    failed: run.failed,
    anteil: run.total > 0 ? Math.min(1, run.processed / run.total) : run.status === 'COMPLETED' ? 1 : 0,
  };
}

/** Den laufenden oder zuletzt gelaufenen Durchgang einer Kampagne. */
export const letzterDurchgang = (campaignId: string): Promise<WrappedGenerationRun | null> =>
  prisma.wrappedGenerationRun.findFirst({ where: { campaignId }, orderBy: { createdAt: 'desc' } });

export async function brichDurchgangAb(runId: string): Promise<void> {
  await prisma.wrappedGenerationRun.updateMany({
    where: { id: runId, status: { in: ['QUEUED', 'RUNNING'] } },
    data: { status: 'CANCELLED', finishedAt: new Date() },
  });
}

/**
 * Die Momentaufnahme einer Person.
 *
 * Der einzige Weg zu den Daten eines veroeffentlichten Rueckblicks. Wer hier
 * nichts findet, bekommt nichts - und nicht etwa eine live gerechnete
 * Ersatzgeschichte, die morgen anders aussieht.
 */
export async function ladeMomentaufnahme(
  campaignId: string,
  discordId: string,
): Promise<{ daten: WrappedDaten; sceneKeys: string[]; generatedAt: Date } | null> {
  const zeile = await prisma.wrappedSnapshot.findUnique({
    where: { campaignId_discordId: { campaignId, discordId } },
  });
  if (!zeile) {
    return null;
  }
  return {
    daten: zeile.data as unknown as WrappedDaten,
    sceneKeys: zeile.sceneKeys,
    generatedAt: zeile.generatedAt,
  };
}

/** Die Fehler eines Durchgangs, lesbar aufbereitet. */
export function fehlerVon(run: WrappedGenerationRun | null): FehlerEintrag[] {
  return Array.isArray(run?.errors) ? (run.errors as unknown as FehlerEintrag[]) : [];
}
