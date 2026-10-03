import {
  AUDIT_ACTIONS,
  prisma,
  recordAudit,
  type XpSlotEvent,
  type XpSlotStatus,
  type XpSlotSymbol,
  type XpSlotSymbolRole,
} from '@swisshub/database';
import { conflict, notFound } from '@swisshub/shared';
import { z } from 'zod';
import { LEVEL_MODULE_ID } from '../config';
import {
  bonusAnnahmen,
  eventSymbolSchema,
  eventUeberschreibungSchema,
  leseKonfiguration,
  rtpVon,
  sorgeFuerKonfiguration,
  spielregeln,
  wirksameWerte,
  type EventSymbolWerte,
  type EventUeberschreibung,
} from './konfiguration';
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
 * Eine Quote von 91 Prozent ist ein strenger Automat und kein Defekt; ein
 * Event darf bewusst grosszuegiger sein. Gewarnt wird deshalb viel,
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
  if (status === 'ACTIVE' || status === 'EVENT_ONLY') {
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
  bildPfad: z.string().max(200).nullable(),
  bildUrl: z.string().max(1000).nullable(),
  auszahlung3: z.number().int().min(0).max(10_000_000),
  auszahlung4: z.number().int().min(0).max(10_000_000),
  auszahlung5: z.number().int().min(0).max(10_000_000),
  premiumTage3: z.number().int().min(0).max(365),
  premiumTage4: z.number().int().min(0).max(365),
  premiumTage5: z.number().int().min(0).max(365),
});

export type SymbolEingabe = z.infer<typeof symbolSchema>;

/**
 * Speichert ein Symbol.
 *
 * Die Rolle kommt nicht aus der Eingabe - sie steht im Code und bleibt. Das
 * Bild wird ersetzt, und das alte geloescht; eine Datei ohne Zeile ist Muell
 * im Upload-Verzeichnis.
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
      imagePath: eingabe.bildPfad,
      imageUrl: eingabe.bildUrl,
      payout3Bp: eingabe.auszahlung3,
      payout4Bp: eingabe.auszahlung4,
      payout5Bp: eingabe.auszahlung5,
      premiumDays3: eingabe.premiumTage3,
      premiumDays4: eingabe.premiumTage4,
      premiumDays5: eingabe.premiumTage5,
    },
  });

  if (vorher.imagePath && vorher.imagePath !== symbol.imagePath) {
    await loescheSymbolbild(vorher.imagePath);
  }

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

// ---------------------------------------------------------------------------
// Eventmodus
// ---------------------------------------------------------------------------

export const eventSchema = z.object({
  name: z.string().min(2).max(80),
  beschreibung: z.string().max(500).nullable(),
  von: z.date().nullable(),
  bis: z.date().nullable(),
  soundPackId: z.string().min(1).nullable(),
  ueberschreibungen: eventUeberschreibungSchema,
  symbolwerte: eventSymbolSchema,
});

export type EventEingabe = z.infer<typeof eventSchema>;

export async function legeEventAn(eingabe: EventEingabe, akteur: SlotAkteur): Promise<XpSlotEvent> {
  pruefeZeitraum(eingabe);
  const event = await prisma.xpSlotEvent.create({
    data: {
      name: eingabe.name.trim(),
      description: eingabe.beschreibung?.trim() || null,
      startsAt: eingabe.von,
      endsAt: eingabe.bis,
      soundPackId: eingabe.soundPackId,
      overrides: eingabe.ueberschreibungen,
      symbolOverrides: eingabe.symbolwerte,
      createdByDiscordId: akteur.discordId,
    },
  });
  await recordAudit({
    action: AUDIT_ACTIONS.XP_SLOT_EVENT_CREATED,
    module: LEVEL_MODULE_ID,
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username ?? null,
    targetLabel: event.name,
    success: true,
    metadata: { eventId: event.id },
  });
  return event;
}

export async function aendereEvent(
  eventId: string,
  eingabe: EventEingabe,
  akteur: SlotAkteur,
): Promise<XpSlotEvent> {
  pruefeZeitraum(eingabe);
  const vorhanden = await prisma.xpSlotEvent.findUnique({ where: { id: eventId } });
  if (!vorhanden) {
    throw notFound('Diesen Eventmodus gibt es nicht.');
  }

  const event = await prisma.xpSlotEvent.update({
    where: { id: eventId },
    data: {
      name: eingabe.name.trim(),
      description: eingabe.beschreibung?.trim() || null,
      startsAt: eingabe.von,
      endsAt: eingabe.bis,
      soundPackId: eingabe.soundPackId,
      overrides: eingabe.ueberschreibungen,
      symbolOverrides: eingabe.symbolwerte,
    },
  });

  /*
   * Ein laufendes Event, das gerade geaendert wurde, muss weiter spielbar
   * sein. Sonst stuende der Slot nach einem Tippfehler still, ohne dass
   * jemand merkt, woran es liegt.
   */
  if (event.active) {
    const pruefung = await pruefeEvent(event.id);
    if (!pruefung.ok) {
      throw conflict(`So liesse sich nicht spielen: ${pruefung.fehler.join(' ')}`);
    }
  }

  await recordAudit({
    action: AUDIT_ACTIONS.XP_SLOT_EVENT_UPDATED,
    module: LEVEL_MODULE_ID,
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username ?? null,
    targetLabel: event.name,
    success: true,
    metadata: { eventId },
  });
  return event;
}

function pruefeZeitraum(eingabe: EventEingabe): void {
  if (eingabe.von && eingabe.bis && eingabe.von >= eingabe.bis) {
    throw conflict('Das Ende liegt vor dem Anfang.');
  }
}

export interface EventPruefung {
  ok: boolean;
  fehler: string[];
  warnungen: string[];
  rtp: RtpErgebnis | null;
}

/**
 * Prueft, ob ein Event aktiviert werden darf.
 *
 * ## Was blockiert und was warnt
 *
 * **Blockiert** wird, was mathematisch nicht aufgeht oder worauf das Spiel
 * nicht laufen kann: kein ziehbares Symbol, eine Bonusrunde ohne Ende, ein
 * Einsatzraster, mit dem sich nicht spielen laesst, ein fehlendes Sound-Paket,
 * ein Symbolbild, das es nicht gibt, eine unbekannte Symbolkennung. Dazu
 * Premium ohne Premium-Auszahlungen - ein Premiumsymbol, das keine Tage gibt,
 * ist eine Niete mit Premiumbild.
 *
 * **Gewarnt** wird bei einer Quote ausserhalb der Zielspanne, bei fehlenden
 * Klaengen und bei einem lohnenden Risiko. Alles davon kann gewollt sein.
 */
export async function pruefeEvent(eventId: string): Promise<EventPruefung> {
  const event = await prisma.xpSlotEvent.findUnique({ where: { id: eventId } });
  if (!event) {
    throw notFound('Diesen Eventmodus gibt es nicht.');
  }

  const fehler: string[] = [];
  const warnungen: string[] = [];

  const ueber = eventUeberschreibungSchema.safeParse(event.overrides ?? {});
  if (!ueber.success) {
    fehler.push('Die Überschreibungen dieses Events passen nicht zum Schema und würden ignoriert.');
  }
  const symbolwerte = eventSymbolSchema.safeParse(event.symbolOverrides ?? {});
  if (!symbolwerte.success) {
    fehler.push('Die Symbolwerte dieses Events passen nicht zum Schema und würden ignoriert.');
  }
  if (!ueber.success || !symbolwerte.success) {
    return { ok: false, fehler, warnungen, rtp: null };
  }

  const [config, symbole] = await Promise.all([
    prisma.xpSlotConfig.findUniqueOrThrow({ where: { id: 'default' } }),
    prisma.xpSlotSymbol.findMany({ orderBy: { order: 'asc' } }),
  ]);

  // Unbekannte Symbolkennungen: eine Ueberschreibung, die niemanden trifft.
  const bekannt = new Set(symbole.map((zeile) => zeile.key));
  for (const key of Object.keys(symbolwerte.data)) {
    if (!bekannt.has(key)) {
      fehler.push(`Die Symbolkennung «${key}» gibt es nicht.`);
    }
  }

  // Das Sound-Paket muss existieren.
  if (event.soundPackId) {
    const paket = await prisma.xpSlotSoundPack.findUnique({
      where: { id: event.soundPackId },
      include: { sounds: true },
    });
    if (!paket) {
      fehler.push('Das Sound-Paket dieses Events gibt es nicht mehr.');
    } else if (paket.sounds.length === 0) {
      warnungen.push('Das Sound-Paket dieses Events enthält keinen einzigen Klang.');
    }
  }

  // Die Bilder muessen vorhanden sein - geprueft wird der Name, nicht die Datei:
  // eine Dateipruefung liefe im Bot gegen ein nur lesbar gemountetes Volume.
  const { SYMBOLBILD_MUSTER } = await import('./klang-speicher');
  for (const [key, werte] of Object.entries(symbolwerte.data)) {
    if (werte.bildPfad && !SYMBOLBILD_MUSTER.test(werte.bildPfad)) {
      fehler.push(`Das Bild für «${key}» trägt keinen Namen, den diese Anwendung erzeugt hat.`);
    }
  }

  const wirksam = wirksameWerte({ ...config, status: config.status }, event);
  const regeln = spielregeln(symbole, wirksam, event);
  const rtp = rtpVon({ regeln, bonus: bonusAnnahmen(wirksam) });

  fehler.push(...rtp.fehler);

  if (
    wirksam.einsaetze.filter((wert) => wert >= wirksam.minEinsatz && wert <= wirksam.maxEinsatz).length === 0
  ) {
    fehler.push('Kein Einsatz dieses Events liegt zwischen dem kleinsten und dem grössten.');
  }
  if (wirksam.premiumAktiv) {
    const premium = regeln.symbole.find((symbol) => symbol.rolle === 'PREMIUM');
    if (!premium || premium.gewicht === 0) {
      fehler.push('Premium ist eingeschaltet, aber das Premiumsymbol liegt nicht auf den Walzen.');
    } else if (premium.premiumTage.every((tage) => tage === 0)) {
      fehler.push('Premium ist eingeschaltet, aber das Premiumsymbol gibt keine Tage.');
    }
  }
  if (wirksam.jackpotMultiplikator > 0) {
    const jackpot = regeln.symbole.find((symbol) => symbol.rolle === 'JACKPOT');
    if (!jackpot || jackpot.gewicht === 0) {
      warnungen.push('Es gibt einen Jackpot-Multiplikator, aber das Logo liegt nicht auf den Walzen.');
    }
  }

  const lage = rtpLage(rtp.rtp);
  if (lage === 'zu_tief') {
    warnungen.push(
      `Die Quote dieses Events liegt bei ${(rtp.rtp * 100).toFixed(1)} Prozent und damit unter der Zielspanne von 92 bis 95 Prozent.`,
    );
  }
  if (lage === 'zu_hoch') {
    warnungen.push(
      `Die Quote dieses Events liegt bei ${(rtp.rtp * 100).toFixed(1)} Prozent und damit über der Zielspanne von 92 bis 95 Prozent.`,
    );
  }
  warnungen.push(...rtp.hinweise);

  return { ok: fehler.length === 0, fehler, warnungen, rtp };
}

/**
 * Aktiviert ein Event - und beendet das vorherige.
 *
 * Es laeuft immer hoechstens eines: zwei Events, die beide Gewichte
 * ueberschreiben, waeren eine Reihenfolge, die niemand festgelegt hat.
 */
export async function aktiviereEvent(eventId: string, akteur: SlotAkteur): Promise<EventPruefung> {
  const pruefung = await pruefeEvent(eventId);
  if (!pruefung.ok) {
    throw conflict(pruefung.fehler.join(' '));
  }

  await prisma.$transaction(async (tx) => {
    await tx.xpSlotEvent.updateMany({
      where: { active: true, id: { not: eventId } },
      data: { active: false, deactivatedAt: new Date() },
    });
    await tx.xpSlotEvent.update({
      where: { id: eventId },
      data: { active: true, activatedAt: new Date(), deactivatedAt: null },
    });
  });

  const event = await prisma.xpSlotEvent.findUniqueOrThrow({ where: { id: eventId } });
  await recordAudit({
    action: AUDIT_ACTIONS.XP_SLOT_EVENT_ACTIVATED,
    module: LEVEL_MODULE_ID,
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username ?? null,
    targetLabel: event.name,
    success: true,
    metadata: {
      eventId,
      rtp: pruefung.rtp ? Number(pruefung.rtp.rtp.toFixed(4)) : null,
      warnungen: pruefung.warnungen,
    },
  });
  return pruefung;
}

export async function beendeEvent(eventId: string, akteur: SlotAkteur): Promise<void> {
  const event = await prisma.xpSlotEvent.findUnique({ where: { id: eventId } });
  if (!event) {
    throw notFound('Diesen Eventmodus gibt es nicht.');
  }
  await prisma.xpSlotEvent.update({
    where: { id: eventId },
    data: { active: false, deactivatedAt: new Date() },
  });
  await recordAudit({
    action: AUDIT_ACTIONS.XP_SLOT_EVENT_DEACTIVATED,
    module: LEVEL_MODULE_ID,
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username ?? null,
    targetLabel: event.name,
    success: true,
    metadata: { eventId },
  });
}

/**
 * Beendet Events, deren Zeitraum vorbei ist.
 *
 * Laeuft im Scheduler. Der Slot braucht das nicht - `laufendesEvent` prueft
 * den Zeitraum selbst, ein abgelaufenes Event wirkt also nie. Diese Funktion
 * ist fuer die **Anzeige** und fuer das Protokoll: ohne sie stuende in der
 * Verwaltung dauerhaft «aktiv» an einem Event, das nichts mehr tut.
 */
export async function beendeAbgelaufeneEvents(jetzt = new Date()): Promise<number> {
  const faellig = await prisma.xpSlotEvent.findMany({
    where: { active: true, endsAt: { not: null, lte: jetzt } },
  });
  for (const event of faellig) {
    await prisma.xpSlotEvent.update({
      where: { id: event.id },
      data: { active: false, deactivatedAt: jetzt },
    });
    await recordAudit({
      action: AUDIT_ACTIONS.XP_SLOT_EVENT_DEACTIVATED,
      module: LEVEL_MODULE_ID,
      actorDiscordId: null,
      actorUsername: null,
      targetLabel: event.name,
      success: true,
      metadata: { eventId: event.id, grund: 'Zeitraum abgelaufen' },
    });
  }
  return faellig.length;
}

/** Alle Events, fuer die Verwaltung. */
export async function eventListe(): Promise<
  Array<{
    id: string;
    name: string;
    beschreibung: string | null;
    aktiv: boolean;
    von: Date | null;
    bis: Date | null;
    soundPackId: string | null;
    ueberschreibungen: EventUeberschreibung;
    symbolwerte: EventSymbolWerte;
    laeuft: boolean;
  }>
> {
  const jetzt = new Date();
  const zeilen = await prisma.xpSlotEvent.findMany({ orderBy: [{ active: 'desc' }, { createdAt: 'desc' }] });
  return zeilen.map((zeile) => ({
    id: zeile.id,
    name: zeile.name,
    beschreibung: zeile.description,
    aktiv: zeile.active,
    von: zeile.startsAt,
    bis: zeile.endsAt,
    soundPackId: zeile.soundPackId,
    ueberschreibungen: eventUeberschreibungSchema.safeParse(zeile.overrides ?? {}).data ?? {},
    symbolwerte: eventSymbolSchema.safeParse(zeile.symbolOverrides ?? {}).data ?? {},
    laeuft:
      zeile.active && (!zeile.startsAt || zeile.startsAt <= jetzt) && (!zeile.endsAt || zeile.endsAt > jetzt),
  }));
}

/** Die Rolle eines Symbols in Worten - fuer die Verwaltung und die Infotafel. */
export const ROLLEN_LABEL: Record<XpSlotSymbolRole, string> = {
  NORMAL: 'Gewöhnlich',
  WILD: 'Wild (ersetzt)',
  SCATTER: 'Bonus (löst aus)',
  JACKPOT: 'Jackpot-Logo',
  PREMIUM: 'Premium (zahlt Tage)',
};
