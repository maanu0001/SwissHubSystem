import { prisma } from '@swisshub/database';
import type { EmojiAntrag, EmojiAntragStatus } from '@swisshub/database';
import { getModuleSettings } from '../module-state';
import { EMOJI_MODULE_ID, type EmojiSettings } from './config';
import { ladeKatalog, type KatalogEintrag } from './katalog';
import { platzUebersicht, type PlatzUebersicht } from './plaetze';
import { erlaubteHostsAus } from './herkunft';

/**
 * Was der Emoji-Bereich zeigt.
 *
 * ## Sechs Bereiche, eine Abfrage
 *
 * Die Seite zeigt Plätze, offene Vorschläge, laufende Abstimmungen, den
 * Katalog, den Verlauf und die Grenzen der Einrichtung. Das naive Vorgehen -
 * je Bereich eine eigene Serverfunktion - wären sechs Runden und zweimal
 * dieselbe Discord-Abfrage. Hier wird einmal geladen und zusammengesetzt.
 *
 * ## Warum der Verlauf aus dem Audit Log kommt
 *
 * Weil es ihn schon gibt. Eine eigene `EmojiVerlauf`-Tabelle wäre ein zweites
 * Protokoll neben dem zentralen - mit eigener Aufbewahrung, eigener Ansicht
 * und der Möglichkeit, dass beide verschiedene Dinge behaupten. Gefiltert auf
 * `module: 'emoji'` steht hier derselbe Verlauf, den das Audit Log zeigt.
 */

export interface AntragAnsicht {
  id: string;
  name: string;
  status: EmojiAntragStatus;
  animiert: boolean;
  bytes: number;
  breite: number | null;
  hoehe: number | null;
  /** Nur die technische Herkunft - keine Aussage über Rechte. */
  herkunft: EmojiAntrag['herkunft'];
  herkunftNotiz: string | null;
  begruendung: string | null;
  antragstellerId: string;
  erstelltAm: Date;
  /** Abstimmung, falls eine läuft oder lief. */
  stimmen: number;
  stimmenZiel: number | null;
  abstimmungEndetAm: Date | null;
  entschiedenVon: string | null;
  entschiedenAm: Date | null;
  ablehnungsGrund: string | null;
  emojiId: string | null;
  emojiName: string | null;
  /** Liegt die Bilddatei noch? Nach der Annahme wird sie aufgeräumt. */
  bildVerfuegbar: boolean;
}

export interface VerlaufsEintrag {
  id: string;
  action: string;
  createdAt: Date;
  actorDiscordId: string | null;
  targetLabel: string | null;
  success: boolean;
}

export interface EinrichtungsBefund {
  /** Vorschläge sind eingeschaltet, aber kein Moderationskanal gesetzt. */
  ohneModerationskanal: boolean;
  /** Abstimmung ist eingeschaltet, aber kein Kanal gesetzt. */
  ohneAbstimmungskanal: boolean;
  /** Import ist ausgeschaltet, weil keine Hosts freigegeben sind. */
  ohneImport: boolean;
  /** Die freigegebenen Hosts - damit das Dashboard sie nennen kann. */
  erlaubteHosts: string[];
}

export interface EmojiBereich {
  plaetze: PlatzUebersicht;
  katalog: KatalogEintrag[];
  offene: AntragAnsicht[];
  abstimmungen: AntragAnsicht[];
  entschieden: AntragAnsicht[];
  verlauf: VerlaufsEintrag[];
  einstellungen: EmojiSettings;
  einrichtung: EinrichtungsBefund;
}

function zuAnsicht(
  antrag: EmojiAntrag & { _count?: { stimmen: number } },
  stimmen: number,
): AntragAnsicht {
  return {
    id: antrag.id,
    name: antrag.name,
    status: antrag.status,
    animiert: antrag.animiert,
    bytes: antrag.bytes,
    breite: antrag.breite,
    hoehe: antrag.hoehe,
    herkunft: antrag.herkunft,
    herkunftNotiz: antrag.herkunftNotiz,
    begruendung: antrag.begruendung,
    antragstellerId: antrag.antragstellerId,
    erstelltAm: antrag.createdAt,
    stimmen,
    stimmenZiel: antrag.stimmenZiel,
    abstimmungEndetAm: antrag.abstimmungEndetAm,
    entschiedenVon: antrag.entschiedenVon,
    entschiedenAm: antrag.entschiedenAm,
    ablehnungsGrund: antrag.ablehnungsGrund,
    emojiId: antrag.emojiId,
    emojiName: antrag.emojiName,
    /*
     * Ein angenommener Vorschlag hat seine Kopie verloren - und das ist
     * richtig so. Das Flag sagt der Oberfläche, dass sie kein Vorschaubild
     * anfordern soll, statt ein kaputtes Bild zu zeigen.
     */
    bildVerfuegbar: antrag.status === 'OFFEN' || antrag.status === 'ABSTIMMUNG',
  };
}

/** Alles, was die Seite braucht. */
export async function ladeBereich(): Promise<EmojiBereich> {
  const [plaetze, katalog, antraege, verlauf, einstellungen] = await Promise.all([
    platzUebersicht(),
    ladeKatalog(),
    prisma.emojiAntrag.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { _count: { select: { stimmen: true } } },
    }),
    prisma.auditLog.findMany({
      where: { module: EMOJI_MODULE_ID },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        action: true,
        createdAt: true,
        actorDiscordId: true,
        targetLabel: true,
        success: true,
      },
    }),
    getModuleSettings<EmojiSettings>(EMOJI_MODULE_ID),
  ]);

  const ansichten = antraege.map((antrag) => zuAnsicht(antrag, antrag._count.stimmen));
  const hosts = erlaubteHostsAus(einstellungen.erlaubteHosts);

  return {
    plaetze,
    katalog,
    offene: ansichten.filter((antrag) => antrag.status === 'OFFEN'),
    abstimmungen: ansichten.filter((antrag) => antrag.status === 'ABSTIMMUNG'),
    entschieden: ansichten.filter(
      (antrag) => antrag.status !== 'OFFEN' && antrag.status !== 'ABSTIMMUNG',
    ),
    verlauf,
    einstellungen,
    einrichtung: {
      /*
       * Was fehlt, steht oben auf der Seite.
       *
       * Vorschläge ohne Moderationskanal funktionieren - sie landen nur im
       * Dashboard und nicht auf Discord. Das ist eine Entscheidung und ein
       * Versehen zugleich; der Hinweis macht den Unterschied sichtbar, ohne
       * etwas zu verbieten.
       */
      ohneModerationskanal:
        einstellungen.antraegeAktiv && einstellungen.moderationChannelId.trim().length === 0,
      ohneAbstimmungskanal:
        einstellungen.abstimmungAktiv && einstellungen.abstimmungChannelId.trim().length === 0,
      ohneImport: hosts.length === 0,
      erlaubteHosts: hosts,
    },
  };
}

/** Die eigenen Vorschläge eines Mitglieds - für «was ist daraus geworden?». */
export async function ladeEigeneAntraege(discordId: string): Promise<AntragAnsicht[]> {
  const antraege = await prisma.emojiAntrag.findMany({
    where: { antragstellerId: discordId },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { _count: { select: { stimmen: true } } },
  });
  return antraege.map((antrag) => zuAnsicht(antrag, antrag._count.stimmen));
}

/** Ein einzelner Vorschlag. */
export async function ladeAntrag(antragId: string): Promise<AntragAnsicht | null> {
  const antrag = await prisma.emojiAntrag.findUnique({
    where: { id: antragId },
    include: { _count: { select: { stimmen: true } } },
  });
  return antrag ? zuAnsicht(antrag, antrag._count.stimmen) : null;
}
