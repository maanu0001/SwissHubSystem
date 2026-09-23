import { AUDIT_ACTIONS, prisma, recordAudit } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { AppError } from '@swisshub/shared';
import { zuercherMitternacht } from '../analytics/zeit';
import { WRAPPED_SZENEN } from './szenen';
import { STANDARD_INTRO, STANDARD_OUTRO } from './texte';
import { pruefeVorlage } from './vorlage';
import { WRAPPED_MODULE_ID } from './config';
import type { WrappedCampaign, WrappedCampaignStatus, WrappedScene } from '@swisshub/database';
import type { WrappedZeitraum } from './resolver';
import type { SzenenEinstellung } from './szenen';

const log = createLogger('wrapped:kampagne');

/**
 * Die Kampagne - ein Zeitraum und sein Weg zur Veroeffentlichung.
 *
 * ## Der Zustandsablauf
 *
 *   DRAFT  ──►  PREPARING  ──►  READY  ──►  PUBLISHED  ──►  ARCHIVED
 *     ▲              │            │
 *     └──────────────┴────────────┘
 *
 * Zurueck geht es nur bis `READY`; aus `PUBLISHED` fuehrt kein stiller Weg
 * heraus. Wer eine veroeffentlichte Kampagne zurueckzieht, tut das
 * ausdruecklich, und es steht im Protokoll.
 *
 * ## Warum die Uebergaenge hier stehen
 *
 * Weil sonst jeder Aufrufer selbst entscheiden muesste, ob ein Wechsel
 * erlaubt ist - und einer davon wuerde es falsch machen. Hier gibt es eine
 * Tabelle, und was nicht darin steht, geschieht nicht.
 */

const ERLAUBTE_WECHSEL: Record<WrappedCampaignStatus, WrappedCampaignStatus[]> = {
  /*
   * Auch ein Entwurf darf ins Archiv.
   *
   * Zuerst fuehrte nur aus `PUBLISHED` ein Weg dorthin. Damit liess sich
   * ein aufgegebener Entwurf nie wieder aus der Liste bekommen - er stand
   * dort fuer immer, und beim naechsten Jahr suchte man den richtigen
   * zwischen drei falschen. Aufgeben ist ein gueltiger Ausgang.
   *
   * `PREPARING` bleibt ausgenommen: waehrend ein Durchgang laeuft, schreibt
   * er weiter in eine Kampagne, die man gerade wegraeumen wollte. Wer sie
   * loswerden will, bricht erst den Durchgang ab.
   */
  DRAFT: ['PREPARING', 'ARCHIVED'],
  PREPARING: ['READY', 'DRAFT'],
  READY: ['PUBLISHED', 'DRAFT', 'PREPARING', 'ARCHIVED'],
  PUBLISHED: ['ARCHIVED', 'READY'],
  ARCHIVED: [],
};

export function wechselErlaubt(von: WrappedCampaignStatus, nach: WrappedCampaignStatus): boolean {
  return ERLAUBTE_WECHSEL[von].includes(nach);
}

/** Der Zeitraum eines Kalenderjahres in Zuercher Zeit, als UTC-Grenzen. */
export function jahresZeitraum(jahr: number): WrappedZeitraum {
  return {
    start: zuercherMitternacht(`${jahr}-01-01`),
    end: zuercherMitternacht(`${jahr + 1}-01-01`),
    year: jahr,
  };
}

export function zeitraumVon(
  campaign: Pick<WrappedCampaign, 'periodStart' | 'periodEnd' | 'displayYear'>,
): WrappedZeitraum {
  return { start: campaign.periodStart, end: campaign.periodEnd, year: campaign.displayYear };
}

export interface Handelnder {
  discordId: string;
  username?: string | null;
}

// --- Anlegen und Aendern ----------------------------------------------------

export interface KampagneEingabe {
  key: string;
  title: string;
  displayYear: number;
  periodStart: Date;
  periodEnd: Date;
}

/**
 * Eine Kampagne anlegen - samt Szenen in ihrer Vorgabereihenfolge.
 *
 * Die Szenenzeilen entstehen sofort mit: ein Szenen-Editor, der erst beim
 * ersten Speichern Zeilen anlegt, haette bis dahin nichts zu zeigen und
 * muesste die Registry ein zweites Mal kennen.
 */
export async function erstelleKampagne(
  guildId: string,
  actor: Handelnder,
  eingabe: KampagneEingabe,
): Promise<WrappedCampaign> {
  if (eingabe.periodEnd <= eingabe.periodStart) {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Das Ende muss nach dem Beginn liegen.' });
  }

  const vorhanden = await prisma.wrappedCampaign.findUnique({
    where: { guildId_key: { guildId, key: eingabe.key } },
  });
  if (vorhanden) {
    throw new AppError('CONFLICT', { userMessage: `Für «${eingabe.key}» gibt es bereits einen Rückblick.` });
  }

  const campaign = await prisma.wrappedCampaign.create({
    data: {
      guildId,
      key: eingabe.key,
      title: eingabe.title,
      displayYear: eingabe.displayYear,
      periodStart: eingabe.periodStart,
      periodEnd: eingabe.periodEnd,
      introText: STANDARD_INTRO,
      outroText: STANDARD_OUTRO,
      createdByDiscordId: actor.discordId,
      updatedByDiscordId: actor.discordId,
      scenes: {
        create: WRAPPED_SZENEN.map((szene) => ({
          sceneKey: szene.key,
          enabled: szene.standardAktiv,
          position: szene.position,
        })),
      },
    },
  });

  await recordAudit({
    action: AUDIT_ACTIONS.WRAPPED_CAMPAIGN_CREATED,
    module: WRAPPED_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username ?? null,
    targetLabel: campaign.title,
    metadata: { campaignId: campaign.id, key: campaign.key, year: campaign.displayYear },
  });
  log.info('Wrapped-Kampagne angelegt', { key: campaign.key });
  return campaign;
}

export interface KampagneAenderung {
  title?: string;
  displayYear?: number;
  periodStart?: Date;
  periodEnd?: Date;
  introText?: string | null;
  outroText?: string | null;
  shareCardsEnabled?: boolean;
  announceEnabled?: boolean;
  announcementChannelId?: string | null;
  minActiveDays?: number;
  minMessages?: number;
  minVoiceMinutes?: number;
}

/**
 * Eine Kampagne aendern.
 *
 * Nach der Veroeffentlichung sind die Stellschrauben gesperrt, die das
 * Ergebnis verschieben wuerden - Zeitraum, Jahr, Mindestaktivitaet. Die
 * Momentaufnahmen sind dann bereits geschrieben; ein geaenderter Zeitraum
 * wuerde eine Kampagne ergeben, deren Zahlen nicht mehr zu ihrer Beschriftung
 * passen. Texte und Ankuendigung bleiben aenderbar: ein Tippfehler soll sich
 * korrigieren lassen.
 */
export async function aendereKampagne(
  campaignId: string,
  actor: Handelnder,
  aenderung: KampagneAenderung,
): Promise<WrappedCampaign> {
  const campaign = await verlangeKampagne(campaignId);
  const festgeschrieben = campaign.status === 'PUBLISHED' || campaign.status === 'ARCHIVED';

  const gesperrt = [
    'displayYear',
    'periodStart',
    'periodEnd',
    'minActiveDays',
    'minMessages',
    'minVoiceMinutes',
  ];
  if (festgeschrieben && gesperrt.some((feld) => aenderung[feld as keyof KampagneAenderung] !== undefined)) {
    throw new AppError('CONFLICT', {
      userMessage:
        'Zeitraum und Mindestaktivität lassen sich nach der Veröffentlichung nicht mehr ändern - die Momentaufnahmen stehen bereits.',
    });
  }

  for (const [feld, text] of [
    ['introText', aenderung.introText],
    ['outroText', aenderung.outroText],
  ] as const) {
    if (typeof text === 'string' && text.length > 0) {
      const pruefung = pruefeVorlage(text);
      if (!pruefung.gueltig) {
        throw new AppError('VALIDATION_FAILED', {
          userMessage: `${feld === 'introText' ? 'Intro' : 'Outro'}: ${pruefung.fehler.join(' ')}`,
        });
      }
    }
  }

  const start = aenderung.periodStart ?? campaign.periodStart;
  const ende = aenderung.periodEnd ?? campaign.periodEnd;
  if (ende <= start) {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Das Ende muss nach dem Beginn liegen.' });
  }

  const aktualisiert = await prisma.wrappedCampaign.update({
    where: { id: campaignId },
    data: { ...aenderung, updatedByDiscordId: actor.discordId },
  });

  await recordAudit({
    action: AUDIT_ACTIONS.WRAPPED_CAMPAIGN_UPDATED,
    module: WRAPPED_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username ?? null,
    targetLabel: aktualisiert.title,
    metadata: { campaignId, felder: Object.keys(aenderung) },
  });
  return aktualisiert;
}

/** Die Szenen einer Kampagne setzen - Reihenfolge und An/Aus in einem Zug. */
export async function setzeSzenen(
  campaignId: string,
  actor: Handelnder,
  szenen: SzenenEinstellung[],
): Promise<void> {
  const campaign = await verlangeKampagne(campaignId);
  if (campaign.status === 'PUBLISHED' || campaign.status === 'ARCHIVED') {
    /*
     * Nach der Veroeffentlichung steht die Reihenfolge in den
     * Momentaufnahmen. Sie hier zu aendern haette keine Wirkung auf
     * bestehende Rueckblicke - und genau diese stille Wirkungslosigkeit
     * waere die schlechteste Antwort.
     */
    throw new AppError('CONFLICT', {
      userMessage: 'Die Szenen einer veröffentlichten Kampagne lassen sich nicht mehr ändern.',
    });
  }

  const bekannt = new Set(WRAPPED_SZENEN.map((szene) => szene.key));
  const gefiltert = szenen.filter((szene) => bekannt.has(szene.sceneKey));

  await prisma.$transaction(
    gefiltert.map((szene) =>
      prisma.wrappedScene.upsert({
        where: { campaignId_sceneKey: { campaignId, sceneKey: szene.sceneKey } },
        create: {
          campaignId,
          sceneKey: szene.sceneKey,
          enabled: szene.enabled,
          position: szene.position,
        },
        update: { enabled: szene.enabled, position: szene.position },
      }),
    ),
  );

  await recordAudit({
    action: AUDIT_ACTIONS.WRAPPED_SCENES_UPDATED,
    module: WRAPPED_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username ?? null,
    targetLabel: campaign.title,
    metadata: {
      campaignId,
      aktiv: gefiltert.filter((szene) => szene.enabled).map((szene) => szene.sceneKey),
    },
  });
}

// --- Lesen ------------------------------------------------------------------

export async function verlangeKampagne(campaignId: string): Promise<WrappedCampaign> {
  const campaign = await prisma.wrappedCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diesen Rückblick gibt es nicht.' });
  }
  return campaign;
}

export const szenenEinstellungen = async (campaignId: string): Promise<SzenenEinstellung[]> => {
  const zeilen = await prisma.wrappedScene.findMany({
    where: { campaignId },
    orderBy: { position: 'asc' },
  });
  return zeilen.map((zeile: WrappedScene) => ({
    sceneKey: zeile.sceneKey,
    enabled: zeile.enabled,
    position: zeile.position,
  }));
};

/** Alle Kampagnen eines Servers, neueste zuerst. */
export const listeKampagnen = (guildId: string): Promise<WrappedCampaign[]> =>
  prisma.wrappedCampaign.findMany({ where: { guildId }, orderBy: { displayYear: 'desc' } });

/**
 * Der Rueckblick, den ein Mitglied gerade sehen darf.
 *
 * Genau einer: der zuletzt veroeffentlichte. Archivierte bleiben ueber ihre
 * eigene Adresse erreichbar, draengen sich aber nicht mehr auf.
 */
export const aktuelleVeroeffentlichung = (guildId: string): Promise<WrappedCampaign | null> =>
  prisma.wrappedCampaign.findFirst({
    where: { guildId, status: 'PUBLISHED' },
    orderBy: { publishedAt: 'desc' },
  });

// --- Veroeffentlichen -------------------------------------------------------

export interface Freigabepruefung {
  bereit: boolean;
  blocker: string[];
  hinweise: string[];
  snapshots: number;
  szenen: number;
}

/**
 * Darf diese Kampagne veroeffentlicht werden?
 *
 * Die Pruefung trennt zwei Dinge, die gern vermischt werden: **Blocker**
 * verhindern die Veroeffentlichung, **Hinweise** sind Dinge, die jemand
 * wissen sollte, bevor er den Knopf drueckt. Eine Kampagne ohne Clip-Daten
 * ist kein Fehler - eine ohne Szenen schon.
 */
export async function pruefeFreigabe(campaignId: string): Promise<Freigabepruefung> {
  const campaign = await verlangeKampagne(campaignId);
  const blocker: string[] = [];
  const hinweise: string[] = [];

  const [szenen, snapshots, laufend] = await Promise.all([
    prisma.wrappedScene.count({ where: { campaignId, enabled: true } }),
    prisma.wrappedSnapshot.count({ where: { campaignId } }),
    prisma.wrappedGenerationRun.count({ where: { campaignId, status: { in: ['QUEUED', 'RUNNING'] } } }),
  ]);

  if (campaign.status === 'PUBLISHED') {
    blocker.push('Dieser Rückblick ist bereits veröffentlicht.');
  }
  if (campaign.status === 'ARCHIVED') {
    blocker.push('Dieser Rückblick ist archiviert.');
  }
  if (szenen === 0) {
    blocker.push('Es ist keine einzige Szene eingeschaltet.');
  }
  if (campaign.periodEnd <= campaign.periodStart) {
    blocker.push('Der Zeitraum ist ungültig.');
  }
  if (laufend > 0) {
    blocker.push('Es läuft gerade ein Durchgang für die Momentaufnahmen.');
  }
  if (snapshots === 0) {
    blocker.push('Es gibt noch keine Momentaufnahmen. Erst erzeugen, dann veröffentlichen.');
  }

  const letzterLauf = await prisma.wrappedGenerationRun.findFirst({
    where: { campaignId },
    orderBy: { createdAt: 'desc' },
  });
  if (letzterLauf && letzterLauf.failed > 0) {
    hinweise.push(
      `Beim letzten Durchgang sind ${letzterLauf.failed} Momentaufnahmen gescheitert. Sie fehlen den betroffenen Mitgliedern.`,
    );
  }
  if (campaign.announceEnabled && !campaign.announcementChannelId) {
    hinweise.push('Die Ankündigung ist eingeschaltet, aber es ist kein Kanal gewählt.');
  }
  if (campaign.periodEnd > new Date()) {
    hinweise.push('Der Zeitraum ist noch nicht vorbei - die Zahlen werden sich weiter verändern.');
  }

  return { bereit: blocker.length === 0, blocker, hinweise, snapshots, szenen };
}

/** Die Kampagne veroeffentlichen. */
export async function veroeffentliche(campaignId: string, actor: Handelnder): Promise<WrappedCampaign> {
  const pruefung = await pruefeFreigabe(campaignId);
  if (!pruefung.bereit) {
    throw new AppError('CONFLICT', { userMessage: pruefung.blocker.join(' ') });
  }

  /*
   * Bedingt auf den Vorzustand.
   *
   * Zwei gleichzeitige Klicks - oder ein doppelter - veroeffentlichen sonst
   * zweimal, und die Ankuendigung ginge zweimal heraus. Genau einer kommt
   * hier durch.
   */
  const { count } = await prisma.wrappedCampaign.updateMany({
    where: { id: campaignId, status: { in: ['READY', 'PREPARING', 'DRAFT'] } },
    data: { status: 'PUBLISHED', publishedAt: new Date(), updatedByDiscordId: actor.discordId },
  });
  if (count === 0) {
    throw new AppError('CONFLICT', { userMessage: 'Dieser Rückblick ist bereits veröffentlicht.' });
  }

  const campaign = await verlangeKampagne(campaignId);
  await recordAudit({
    action: AUDIT_ACTIONS.WRAPPED_PUBLISHED,
    module: WRAPPED_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username ?? null,
    targetLabel: campaign.title,
    metadata: { campaignId, snapshots: pruefung.snapshots, szenen: pruefung.szenen },
  });
  log.info('Wrapped veröffentlicht', { campaignId, key: campaign.key });
  return campaign;
}

/** Zurueckziehen - ausdruecklich und im Protokoll. */
export async function ziehZurueck(campaignId: string, actor: Handelnder, grund: string): Promise<void> {
  const { count } = await prisma.wrappedCampaign.updateMany({
    where: { id: campaignId, status: 'PUBLISHED' },
    data: { status: 'READY', publishedAt: null, updatedByDiscordId: actor.discordId },
  });
  if (count === 0) {
    throw new AppError('CONFLICT', { userMessage: 'Dieser Rückblick ist nicht veröffentlicht.' });
  }
  await recordAudit({
    action: AUDIT_ACTIONS.WRAPPED_UNPUBLISHED,
    module: WRAPPED_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username ?? null,
    metadata: { campaignId, grund },
  });
}

/**
 * Eine Kampagne ins Archiv legen.
 *
 * Aus jedem Zustand, aus dem die Tabelle oben es erlaubt - also aus einem
 * Entwurf, einer fertigen und einer veroeffentlichten Kampagne, aber nicht
 * waehrend ein Durchgang laeuft.
 *
 * Bedingtes `updateMany` statt lesen-pruefen-schreiben: zwei gleichzeitige
 * Aufrufe wuerden sonst beide die Pruefung bestehen und beide schreiben.
 * So gewinnt genau einer, und der zweite bekommt eine ehrliche Absage.
 */
export async function archiviere(campaignId: string, actor: Handelnder): Promise<void> {
  const erlaubt = (Object.keys(ERLAUBTE_WECHSEL) as WrappedCampaignStatus[]).filter((zustand) =>
    ERLAUBTE_WECHSEL[zustand].includes('ARCHIVED'),
  );
  const { count } = await prisma.wrappedCampaign.updateMany({
    where: { id: campaignId, status: { in: erlaubt } },
    data: { status: 'ARCHIVED', archivedAt: new Date(), updatedByDiscordId: actor.discordId },
  });
  if (count === 0) {
    throw new AppError('CONFLICT', {
      userMessage:
        'Dieser Rückblick lässt sich gerade nicht archivieren - er ist bereits archiviert, oder es läuft noch ein Durchgang.',
    });
  }
  await recordAudit({
    action: AUDIT_ACTIONS.WRAPPED_ARCHIVED,
    module: WRAPPED_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username ?? null,
    metadata: { campaignId },
  });
}
