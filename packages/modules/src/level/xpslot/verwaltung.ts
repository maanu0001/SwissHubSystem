import {
  AUDIT_ACTIONS,
  prisma,
  recordAudit,
  type XpSlotStatus,
  type XpSlotSymbol,
  type XpSlotSymbolRole,
} from '@swisshub/database';
import { conflict, notFound } from '@swisshub/shared';
import { z } from 'zod';
import { LEVEL_MODULE_ID } from '../config';
import { leseKonfiguration, rtpVon, sorgeFuerKonfiguration } from './konfiguration';
import { rtpLage, spielbar, type RtpErgebnis } from './rtp';
import { KNOPF_STIL_KEYS } from './vorgaben';
import { loescheSymbolbild } from './klang-speicher';

/**
 * Die Verwaltung des Slots.
 *
 * ## Was sich einstellen laesst - und was nicht
 *
 * Einstellbar ist jede Zahl und jedes Bild. **Nicht** einstellbar ist die
 * Rolle eines Symbols, die Zahl der Walzen, die Zahl der Linien und ihr
 * Verlauf. Das sind Aussagen ueber das Spiel; wer sie aendert, aendert nicht
 * eine Einstellung, sondern braucht Code - Auswertungsregeln, eine Zeile in
 * der Infotafel, eine Zeile in der RTP-Rechnung.
 *
 * ## Warum fast nichts gesperrt wird
 *
 * Eine Quote von 91 Prozent ist ein strenger Automat und kein Defekt, und
 * eine von 96 eine freigebige Phase. Gewarnt wird deshalb viel,
 * **gesperrt** nur, was mathematisch nicht aufgeht: eine Konfiguration ohne
 * ziehbares Symbol, eine Bonusrunde, die im Mittel nicht endet, oder ein
 * Einsatzraster, mit dem sich nicht spielen laesst. Wer jede Abweichung
 * sperrt, hat ein Dashboard, in dem sich nichts mehr einstellen laesst.
 */

export interface SlotAkteur {
  discordId: string;
  username?: string | null;
}

// ---------------------------------------------------------------------------
// Konfiguration
// ---------------------------------------------------------------------------

export const konfigSchema = z.object({
  einsaetze: z.array(z.number().int().min(1).max(1_000_000)).min(1).max(12),
  minEinsatz: z.number().int().min(1).max(1_000_000),
  maxEinsatz: z.number().int().min(1).max(1_000_000),
  jackpotMultiplikator: z.number().int().min(1).max(100_000),
  jackpotNurEcht: z.boolean(),
  wildErsetztAlles: z.boolean(),
  bonusAusloeser: z.number().int().min(2).max(6),
  bonusFreispiele: z.number().int().min(0).max(100),
  leiter1: z.number().int().min(0).max(200),
  leiter2: z.number().int().min(0).max(300),
  gambleChance1Bp: z.number().int().min(0).max(10_000),
  gambleChance2Bp: z.number().int().min(0).max(10_000),
  retriggerSpins: z.number().int().min(0).max(25),
  stickyWilds: z.boolean(),
  premiumAktiv: z.boolean(),
  maxGewinnMultiplikator: z.number().int().min(0).max(1_000_000),
  maxTagesverlust: z.number().int().min(0).max(100_000_000),
  maxTagesgewinn: z.number().int().min(0).max(100_000_000),
  maxSpinsJeSitzung: z.number().int().min(0).max(100_000),
  sitzungspauseSekunden: z.number().int().min(0).max(86_400),
  autoSpinZahlen: z.array(z.number().int().min(1).max(100)).min(1).max(6),
  tierGross: z.number().int().min(1).max(10_000),
  tierMega: z.number().int().min(1).max(100_000),
});

export type KonfigEingabe = z.infer<typeof konfigSchema>;

export const designSchema = z.object({
  hintergrundPfad: z.string().max(200).nullable(),
  hintergrundUrl: z.string().max(1000).nullable(),
  logoPfad: z.string().max(200).nullable(),
  logoUrl: z.string().max(1000).nullable(),
  akzentfarbe: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/u, 'Bitte eine Hex-Farbe wie #83060a.')
    .nullable(),
  overlay: z.number().int().min(0).max(100),
  glow: z.number().int().min(0).max(100),
  knopfStil: z.string().refine((wert) => KNOPF_STIL_KEYS.includes(wert), 'Diesen Stil gibt es nicht.'),
  soundPackId: z.string().min(1).nullable(),
});

export type DesignEingabe = z.infer<typeof designSchema>;

export const feedSchema = z.object({
  kanalId: z
    .string()
    .regex(/^\d{17,20}$/u, 'Das ist keine Discord-Kanalkennung.')
    .nullable(),
  bigWin: z.boolean(),
  jackpot: z.boolean(),
  premium: z.boolean(),
});

export type FeedEingabe = z.infer<typeof feedSchema>;

/** Prueft, was unabhaengig von der Quote nicht aufgehen kann. */
function pruefeKonfig(eingabe: KonfigEingabe): void {
  if (eingabe.minEinsatz > eingabe.maxEinsatz) {
    throw conflict('Der kleinste Einsatz liegt über dem grössten.');
  }
  const spielbareEinsaetze = eingabe.einsaetze.filter(
    (wert) => wert >= eingabe.minEinsatz && wert <= eingabe.maxEinsatz,
  );
  if (spielbareEinsaetze.length === 0) {
    throw conflict(
      'Kein eingestellter Einsatz liegt zwischen dem kleinsten und dem grössten - es liesse sich nicht spielen.',
    );
  }
  if (eingabe.tierGross >= eingabe.tierMega) {
    throw conflict('Die Mega-Schwelle muss über der Big-Win-Schwelle liegen.');
  }
  if (eingabe.leiter1 > 0 && eingabe.leiter1 <= eingabe.bonusFreispiele) {
    throw conflict('Die erste Risikostufe muss mehr Freispiele bringen als die garantierten.');
  }
  if (eingabe.leiter2 > 0 && eingabe.leiter2 <= eingabe.leiter1) {
    throw conflict('Die zweite Risikostufe muss mehr Freispiele bringen als die erste.');
  }
}

export async function speichereKonfig(eingabe: KonfigEingabe, akteur: SlotAkteur): Promise<RtpErgebnis> {
  pruefeKonfig(eingabe);
  await sorgeFuerKonfiguration();

  await prisma.xpSlotConfig.update({
    where: { id: 'default' },
    data: {
      betTiers: [...eingabe.einsaetze].sort((a, b) => a - b),
      minBet: eingabe.minEinsatz,
      maxBet: eingabe.maxEinsatz,
      jackpotMultiplier: eingabe.jackpotMultiplikator,
      jackpotPureOnly: eingabe.jackpotNurEcht,
      wildSubstitutesAll: eingabe.wildErsetztAlles,
      bonusTriggerCount: eingabe.bonusAusloeser,
      bonusBaseFreespins: eingabe.bonusFreispiele,
      bonusLadder1: eingabe.leiter1,
      bonusLadder2: eingabe.leiter2,
      gambleChance1Bp: eingabe.gambleChance1Bp,
      gambleChance2Bp: eingabe.gambleChance2Bp,
      retriggerSpins: eingabe.retriggerSpins,
      stickyWilds: eingabe.stickyWilds,
      premiumEnabled: eingabe.premiumAktiv,
      maxWinMultiplier: eingabe.maxGewinnMultiplikator,
      maxDailyLoss: eingabe.maxTagesverlust,
      maxDailyWin: eingabe.maxTagesgewinn,
      maxSpinsPerSession: eingabe.maxSpinsJeSitzung,
      sessionCooldownSeconds: eingabe.sitzungspauseSekunden,
      autoSpinCounts: [...eingabe.autoSpinZahlen].sort((a, b) => a - b),
      tierBigMultiplier: eingabe.tierGross,
      tierMegaMultiplier: eingabe.tierMega,
      updatedByDiscordId: akteur.discordId,
    },
  });

  const konfiguration = await leseKonfiguration();
  const rtp = rtpVon(konfiguration);
  if (!spielbar(rtp)) {
    // Die Pruefung kommt nach dem Schreiben, weil sie die vollstaendige
    // Konfiguration braucht - Symbole eingeschlossen. Darum wird hier
    // zurueckgewiesen und nicht nachtraeglich korrigiert: der Fehler ist dem
    // Aufrufer zu melden, und der Status bleibt, was er war.
    throw conflict(rtp.fehler.join(' '));
  }

  await recordAudit({
    action: AUDIT_ACTIONS.XP_SLOT_CONFIG_UPDATED,
    module: LEVEL_MODULE_ID,
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username ?? null,
    targetLabel: 'Spielregeln',
    success: true,
    metadata: { rtp: Number(rtp.rtp.toFixed(4)), lage: rtpLage(rtp.rtp) },
  });
  return rtp;
}

export async function speichereDesign(eingabe: DesignEingabe, akteur: SlotAkteur): Promise<void> {
  await sorgeFuerKonfiguration();
  if (eingabe.soundPackId) {
    const vorhanden = await prisma.xpSlotSoundPack.count({ where: { id: eingabe.soundPackId } });
    if (vorhanden === 0) {
      throw notFound('Dieses Sound-Paket gibt es nicht.');
    }
  }

  await prisma.xpSlotConfig.update({
    where: { id: 'default' },
    data: {
      backgroundPath: eingabe.hintergrundPfad,
      backgroundUrl: eingabe.hintergrundUrl,
      logoPath: eingabe.logoPfad,
      logoUrl: eingabe.logoUrl,
      accentColor: eingabe.akzentfarbe,
      overlayOpacity: eingabe.overlay,
      glowStrength: eingabe.glow,
      spinButtonStyle: eingabe.knopfStil,
      activeSoundPackId: eingabe.soundPackId,
      updatedByDiscordId: akteur.discordId,
    },
  });

  await recordAudit({
    action: AUDIT_ACTIONS.XP_SLOT_CONFIG_UPDATED,
    module: LEVEL_MODULE_ID,
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username ?? null,
    targetLabel: 'Design und Klänge',
    success: true,
    metadata: { soundPackId: eingabe.soundPackId },
  });
}

export async function speichereFeed(eingabe: FeedEingabe, akteur: SlotAkteur): Promise<void> {
  await sorgeFuerKonfiguration();
  await prisma.xpSlotConfig.update({
    where: { id: 'default' },
    data: {
      feedChannelId: eingabe.kanalId,
      feedBigWin: eingabe.bigWin,
      feedJackpot: eingabe.jackpot,
      feedPremium: eingabe.premium,
      updatedByDiscordId: akteur.discordId,
    },
  });
  await recordAudit({
    action: AUDIT_ACTIONS.XP_SLOT_CONFIG_UPDATED,
    module: LEVEL_MODULE_ID,
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username ?? null,
    targetLabel: 'Gewinn-Feed',
    success: true,
    metadata: { kanal: eingabe.kanalId, bigWin: eingabe.bigWin, jackpot: eingabe.jackpot },
  });
}

/**
 * Setzt den Status.
 *
 * `ACTIVE` geht nur, wenn die Konfiguration spielbar ist - ein Slot, der
 * «aktiv» heisst und bei jedem Spin abweist, ist schlimmer als einer, der
 * abgeschaltet dasteht.
 */
export async function setzeStatus(
  status: XpSlotStatus,
  hinweis: string | null,
  akteur: SlotAkteur,
): Promise<void> {
  await sorgeFuerKonfiguration();
  if (status === 'ACTIVE') {
    const rtp = rtpVon(await leseKonfiguration());
    if (!spielbar(rtp)) {
      throw conflict(`So lässt sich nicht spielen: ${rtp.fehler.join(' ')}`);
    }
  }

  const vorher = await prisma.xpSlotConfig.findUniqueOrThrow({ where: { id: 'default' } });
  await prisma.xpSlotConfig.update({
    where: { id: 'default' },
    data: {
      status,
      maintenanceNote: hinweis?.trim() || null,
      updatedByDiscordId: akteur.discordId,
    },
  });

  await recordAudit({
    action: AUDIT_ACTIONS.XP_SLOT_STATUS_CHANGED,
    module: LEVEL_MODULE_ID,
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username ?? null,
    targetLabel: status,
    success: true,
    metadata: { vorher: vorher.status, hinweis: hinweis?.trim() || null },
  });
}

// ---------------------------------------------------------------------------
// Symbole und Auszahlungen
// ---------------------------------------------------------------------------

export const symbolSchema = z.object({
  key: z.string().min(1).max(40),
  name: z.string().min(1).max(60),
  aktiv: z.boolean(),
  gewicht: z.number().int().min(0).max(1000),
  glow: z.boolean(),
  beschreibungFehlt: z.boolean().optional(),
  auszahlung3: z.number().int().min(0).max(10_000_000),
  auszahlung4: z.number().int().min(0).max(10_000_000),
  auszahlung5: z.number().int().min(0).max(10_000_000),
  premiumTage3: z.number().int().min(0).max(365),
  premiumTage4: z.number().int().min(0).max(365),
  premiumTage5: z.number().int().min(0).max(365),
});

export type SymbolEingabe = z.infer<typeof symbolSchema>;

/**
 * Speichert ein Symbol - alles aussser dem Bild.
 *
 * Die Rolle kommt nicht aus der Eingabe - sie steht im Code und bleibt.
 *
 * ## Warum hier kein Bild steht
 *
 * Weil zwei Oberflaechen dieselbe Zeile bearbeiten: die Symbolkarte und die
 * Premiumkarte. Beide schickten den vollen Datensatz, und beide schickten
 * dabei die Bildreferenz mit, die beim Seitenaufbau gueltig war. Wer ein
 * Symbol hochlud und danach auf der anderen Karte speicherte, schrieb damit
 * den alten Stand zurueck - und weil die ersetzte Datei mitgeloescht wurde,
 * war die neue PNG nicht bloss unverlinkt, sondern weg. Das ist der Grund,
 * aus dem ein Upload «nach dem Speichern wieder verschwand».
 *
 * Das Bild hat deshalb genau einen Besitzer: `setzeSymbolbild`. Diese
 * Funktion kann es nicht mehr anfassen, auch nicht versehentlich, auch nicht
 * aus einem veralteten Formular. Ein Feld, das niemand aus zweiter Hand
 * schreiben kann, kann auch niemand aus zweiter Hand verlieren.
 */
export async function speichereSymbol(
  eingabe: SymbolEingabe,
  akteur: SlotAkteur,
): Promise<{ symbol: XpSlotSymbol; rtp: RtpErgebnis }> {
  const vorher = await prisma.xpSlotSymbol.findUnique({ where: { key: eingabe.key } });
  if (!vorher) {
    throw notFound('Dieses Symbol gibt es nicht.');
  }

  const symbol = await prisma.xpSlotSymbol.update({
    where: { key: eingabe.key },
    data: {
      name: eingabe.name.trim(),
      active: eingabe.aktiv,
      weight: eingabe.gewicht,
      glow: eingabe.glow,
      payout3Bp: eingabe.auszahlung3,
      payout4Bp: eingabe.auszahlung4,
      payout5Bp: eingabe.auszahlung5,
      premiumDays3: eingabe.premiumTage3,
      premiumDays4: eingabe.premiumTage4,
      premiumDays5: eingabe.premiumTage5,
    },
  });

  const konfiguration = await leseKonfiguration();
  const rtp = rtpVon(konfiguration);
  if (!spielbar(rtp)) {
    throw conflict(rtp.fehler.join(' '));
  }

  await recordAudit({
    action: AUDIT_ACTIONS.XP_SLOT_SYMBOL_UPDATED,
    module: LEVEL_MODULE_ID,
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username ?? null,
    targetLabel: `${symbol.name} (${symbol.key})`,
    success: true,
    metadata: {
      gewicht: symbol.weight,
      aktiv: symbol.active,
      auszahlung: [symbol.payout3Bp, symbol.payout4Bp, symbol.payout5Bp],
      rtp: Number(rtp.rtp.toFixed(4)),
    },
  });

  return { symbol, rtp };
}

export const symbolBildSchema = z.object({
  key: z.string().min(1).max(40),
  bildPfad: z.string().max(200).nullable(),
  bildUrl: z.string().max(1000).nullable(),
});

export type SymbolBildEingabe = z.infer<typeof symbolBildSchema>;

/**
 * Nur das Bild eines Symbols - und sofort.
 *
 * ## Der Fehler, den das behebt
 *
 * Ein hochgeladenes Symbol kam nicht an. Nachgemessen: die Datei lag im
 * Upload-Verzeichnis, der Auslieferungspfad stimmte, die Vorschau zeigte das
 * neue Bild - und nach dem Neuladen stand das alte da. Die Ursache war kein
 * verlorenes Byte, sondern ein zweiter Schritt: der Upload schrieb die
 * Referenz in den **Formularzustand** des Browsers, und in die Datenbank kam
 * sie erst, wenn jemand ausserdem «Speichern» drueckte. Die Erfolgsmeldung
 * sagte das sogar - «Bild hochgeladen. Noch speichern.» -, nur ist eine
 * Kachel mit acht Symbolen und zwoelf Feldern kein Ort, an dem man eine
 * solche Fussnote liest.
 *
 * Jetzt ist der Upload der Speichervorgang. Diese Funktion schreibt
 * ausschliesslich die Bildreferenz; Gewicht, Auszahlungen und Name bleiben,
 * wie sie sind, auch wenn im Formular daneben gerade etwas anderes steht.
 *
 * ## Warum ohne RTP-Pruefung
 *
 * Weil ein Bild die Auszahlung nicht veraendert. `speichereSymbol` prueft die
 * Spielbarkeit, und das ist dort richtig - hier waere es eine Sperre, die ein
 * Symbolbild von einer Gewichtung abhaengig macht, die jemand anders
 * eingestellt hat.
 */
export async function setzeSymbolbild(eingabe: SymbolBildEingabe, akteur: SlotAkteur): Promise<XpSlotSymbol> {
  const vorher = await prisma.xpSlotSymbol.findUnique({ where: { key: eingabe.key } });
  if (!vorher) {
    throw notFound('Dieses Symbol gibt es nicht.');
  }

  const symbol = await prisma.xpSlotSymbol.update({
    where: { key: eingabe.key },
    data: { imagePath: eingabe.bildPfad, imageUrl: eingabe.bildUrl },
  });

  // Die ersetzte Datei geht mit: eine Datei ohne Zeile ist Muell im
  // Upload-Verzeichnis, und der Name ist zufaellig - niemand findet sie
  // spaeter wieder.
  if (vorher.imagePath && vorher.imagePath !== symbol.imagePath) {
    await loescheSymbolbild(vorher.imagePath);
  }

  await recordAudit({
    action: AUDIT_ACTIONS.XP_SLOT_SYMBOL_UPDATED,
    module: LEVEL_MODULE_ID,
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username ?? null,
    targetLabel: `${symbol.name} (${symbol.key})`,
    success: true,
    metadata: {
      bild: symbol.imagePath ?? symbol.imageUrl ?? 'Standard',
      vorher: vorher.imagePath ?? vorher.imageUrl ?? 'Standard',
    },
  });

  return symbol;
}

/** Nur die Auszahlungen, fuer die Paytable-Ansicht. */
export const paytableSchema = z.object({
  zeilen: z
    .array(
      z.object({
        key: z.string().min(1).max(40),
        auszahlung3: z.number().int().min(0).max(10_000_000),
        auszahlung4: z.number().int().min(0).max(10_000_000),
        auszahlung5: z.number().int().min(0).max(10_000_000),
        premiumTage3: z.number().int().min(0).max(365),
        premiumTage4: z.number().int().min(0).max(365),
        premiumTage5: z.number().int().min(0).max(365),
      }),
    )
    .min(1)
    .max(20),
  jackpotMultiplikator: z.number().int().min(1).max(100_000),
});

export type PaytableEingabe = z.infer<typeof paytableSchema>;

export async function speicherePaytable(eingabe: PaytableEingabe, akteur: SlotAkteur): Promise<RtpErgebnis> {
  const vorhandene = await prisma.xpSlotSymbol.findMany({ select: { key: true } });
  const bekannt = new Set(vorhandene.map((zeile) => zeile.key));
  for (const zeile of eingabe.zeilen) {
    if (!bekannt.has(zeile.key)) {
      throw notFound(`Das Symbol «${zeile.key}» gibt es nicht.`);
    }
  }

  await prisma.$transaction(async (tx) => {
    for (const zeile of eingabe.zeilen) {
      await tx.xpSlotSymbol.update({
        where: { key: zeile.key },
        data: {
          payout3Bp: zeile.auszahlung3,
          payout4Bp: zeile.auszahlung4,
          payout5Bp: zeile.auszahlung5,
          premiumDays3: zeile.premiumTage3,
          premiumDays4: zeile.premiumTage4,
          premiumDays5: zeile.premiumTage5,
        },
      });
    }
    await tx.xpSlotConfig.update({
      where: { id: 'default' },
      data: { jackpotMultiplier: eingabe.jackpotMultiplikator, updatedByDiscordId: akteur.discordId },
    });
  });

  const rtp = rtpVon(await leseKonfiguration());
  if (!spielbar(rtp)) {
    throw conflict(rtp.fehler.join(' '));
  }

  await recordAudit({
    action: AUDIT_ACTIONS.XP_SLOT_PAYTABLE_UPDATED,
    module: LEVEL_MODULE_ID,
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username ?? null,
    targetLabel: 'Auszahlungstabelle',
    success: true,
    metadata: {
      jackpot: eingabe.jackpotMultiplikator,
      rtp: Number(rtp.rtp.toFixed(4)),
      lage: rtpLage(rtp.rtp),
    },
  });
  return rtp;
}

export const ROLLEN_LABEL: Record<XpSlotSymbolRole, string> = {
  NORMAL: 'Gewöhnlich',
  WILD: 'Wild (ersetzt)',
  SCATTER: 'Bonus (löst aus)',
  JACKPOT: 'Jackpot-Logo',
  PREMIUM: 'Premium (zahlt Tage)',
};
