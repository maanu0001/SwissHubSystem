import { AUDIT_ACTIONS, prisma, recordAudit } from '@swisshub/database';
import type { EmojiAntrag, EmojiHerkunft } from '@swisshub/database';
import { discord } from '@swisshub/discord';
import { AppError, sanitizeText } from '@swisshub/shared';
import { createLogger } from '@swisshub/logger';
import { getModuleSettings, isModuleEnabled } from '../module-state';
import { pruefeBild, pruefsummeVon } from './bild';
import { EMOJI_MODULE_ID, type EmojiSettings } from './config';
import { fuegeEmojiHinzu } from './katalog';
import { pruefeEmojiName } from './name';
import { platzUebersicht, pruefePlatz } from './plaetze';
import { legeAb, liesAb, raeumeAuf } from './speicher';

const log = createLogger('emoji:antrag');

/**
 * Vorschläge: einreichen, entscheiden, abstimmen.
 *
 * ## Warum ein Vorschlag überhaupt ein Datensatz ist
 *
 * Weil er sonst eine Nachricht in einem Kanal wäre, und Nachrichten
 * verschwinden nach oben. Ein Datensatz hat einen Zustand, und der Zustand
 * beantwortet die Frage, die sonst niemand beantworten kann: «Was ist aus
 * meinem Vorschlag geworden?»
 *
 * ## Die Zustandskette
 *
 *     OFFEN ──entscheiden──> ANGENOMMEN
 *       │   └──entscheiden──> ABGELEHNT
 *       └──vorlegen──> ABSTIMMUNG ──Ziel erreicht──> ANGENOMMEN
 *                           │      └──Frist vorbei──> ABGELAUFEN
 *                           └──entscheiden──> ANGENOMMEN / ABGELEHNT
 *
 * `ABGELAUFEN` ist **nicht** `ABGELEHNT`. Eine Abstimmung, die das Ziel nicht
 * erreicht, hat nichts entschieden - das Team kann danach immer noch
 * entscheiden. Beides gleich zu benennen wäre eine Ablehnung, die niemand
 * ausgesprochen hat.
 *
 * ## Warum jeder Übergang ein bedingtes `updateMany` ist
 *
 * Weil zwei Moderatoren denselben Knopf im selben Moment drücken können, und
 * weil die zehnte Stimme und ein Klick auf «Annehmen» zusammenfallen können.
 * `updateMany({ where: { id, status: <erwartet> } })` liefert `count === 1`
 * genau für den, der gewonnen hat - alle anderen bekommen `0` und machen
 * nichts. Lesen, prüfen, schreiben wäre genau hier die Lücke.
 */

export const EMOJI_ANTRAG_OFFEN = ['OFFEN', 'ABSTIMMUNG'] as const;

async function settingsOderFehler(): Promise<EmojiSettings> {
  if (!(await isModuleEnabled(EMOJI_MODULE_ID))) {
    throw new AppError('CONFLICT', { userMessage: 'Das Emoji-Modul ist derzeit ausgeschaltet.' });
  }
  return getModuleSettings<EmojiSettings>(EMOJI_MODULE_ID);
}

export interface EinreichenEingabe {
  name: string;
  bytes: Uint8Array;
  antragstellerId: string;
  herkunft: EmojiHerkunft;
  /** Die geprüfte Quelladresse oder der Anzeigename der Datei - nur Technik. */
  herkunftNotiz?: string | null;
  begruendung?: string | null;
}

export interface EinreichenErgebnis {
  ok: boolean;
  grund?: string;
  antrag?: EmojiAntrag;
  hinweis?: string;
}

/**
 * Einen Vorschlag einreichen.
 *
 * Geprüft wird in der Reihenfolge, in der es jemandem hilft: erst der Name und
 * das Bild (beides kann die Person ändern), dann die Doppelung (das Bild gibt
 * es schon), dann die Grenzen (zu viele offene, kein Platz). Die teuerste
 * Prüfung - der Platzstand, der Discord fragt - steht hinten.
 */
export async function reicheEin(eingabe: EinreichenEingabe): Promise<EinreichenErgebnis> {
  const settings = await settingsOderFehler();
  if (!settings.antraegeAktiv) {
    return { ok: false, grund: 'Vorschläge sind derzeit ausgeschaltet.' };
  }

  const name = pruefeEmojiName(eingabe.name);
  if (!name.ok) {
    return { ok: false, grund: name.grund };
  }

  const bild = pruefeBild(eingabe.bytes);
  if (!bild.ok || !bild.art) {
    return { ok: false, grund: bild.grund };
  }

  const pruefsumme = pruefsummeVon(eingabe.bytes);
  const [vorhandene, dubletteBild, dubletteName, offeneEigene] = await Promise.all([
    discord.emojis.list(),
    /*
     * Dasselbe Bild schon einmal vorgeschlagen?
     *
     * Geprüft über die Prüfsumme der Bytes, nicht über einen Bildvergleich:
     * der wäre teuer und würde bei einem verlustfrei umkodierten Bild
     * trotzdem versagen. Dieselbe Datei zweimal ist der häufige Fall - zwei
     * Leute schicken dasselbe aus demselben Chat.
     */
    prisma.emojiAntrag.findFirst({
      where: { pruefsumme, status: { in: ['OFFEN', 'ABSTIMMUNG', 'ANGENOMMEN'] } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.emojiAntrag.findFirst({ where: { name: name.name, status: { in: ['OFFEN', 'ABSTIMMUNG'] } } }),
    prisma.emojiAntrag.count({
      where: { antragstellerId: eingabe.antragstellerId, status: { in: ['OFFEN', 'ABSTIMMUNG'] } },
    }),
  ]);

  if (vorhandene.some((emoji) => emoji.name.toLowerCase() === name.name)) {
    return { ok: false, grund: `«${name.name}» gibt es auf dem Server schon.` };
  }
  if (dubletteBild) {
    return {
      ok: false,
      grund:
        dubletteBild.status === 'ANGENOMMEN'
          ? `Dieses Bild liegt schon als «${dubletteBild.emojiName ?? dubletteBild.name}» auf dem Server.`
          : `Dieses Bild ist schon als «${dubletteBild.name}» vorgeschlagen.`,
    };
  }
  if (dubletteName) {
    return { ok: false, grund: `Für «${name.name}» läuft schon ein Vorschlag.` };
  }
  if (offeneEigene >= settings.maxOffeneJeMitglied) {
    return {
      ok: false,
      grund: `Du hast schon ${offeneEigene} offene Vorschläge. Warte, bis über einen entschieden ist.`,
    };
  }

  const platz = pruefePlatz(await platzUebersicht(), bild.animiert ?? false, settings.reservePlaetze);
  if (!platz.ok) {
    return { ok: false, grund: platz.grund };
  }

  const dateiName = await legeAb(eingabe.bytes, bild.art);
  const antrag = await prisma.emojiAntrag.create({
    data: {
      name: name.name,
      pruefsumme,
      dateiName,
      mimeTyp: bild.art,
      bytes: eingabe.bytes.length,
      animiert: bild.animiert ?? false,
      breite: bild.breite ?? null,
      hoehe: bild.hoehe ?? null,
      herkunft: eingabe.herkunft,
      herkunftNotiz: eingabe.herkunftNotiz ? sanitizeText(eingabe.herkunftNotiz, 300) : null,
      begruendung: eingabe.begruendung ? sanitizeText(eingabe.begruendung, 500) : null,
      antragstellerId: eingabe.antragstellerId,
    },
  });

  await recordAudit({
    action: AUDIT_ACTIONS.EMOJI_REQUESTED,
    module: EMOJI_MODULE_ID,
    actorDiscordId: eingabe.antragstellerId,
    targetLabel: antrag.name,
    success: true,
    metadata: { antragId: antrag.id, animiert: antrag.animiert, herkunft: antrag.herkunft },
  });

  return { ok: true, antrag, ...(bild.hinweis ? { hinweis: bild.hinweis } : {}) };
}

export interface EntscheidungsErgebnis {
  ok: boolean;
  grund?: string;
  antrag?: EmojiAntrag;
  /** Gesetzt, wenn der Vorschlag angenommen wurde und das Emoji entstand. */
  emojiId?: string;
}

/**
 * Einen Vorschlag annehmen.
 *
 * ## Die Reihenfolge ist der ganze Punkt
 *
 * Erst wird der Vorschlag **beansprucht** (`OFFEN`/`ABSTIMMUNG` → `ANGENOMMEN`),
 * dann hochgeladen. Umgekehrt - erst hochladen, dann umschreiben - würden zwei
 * gleichzeitige Klicks zwei Emojis erzeugen, und das zweite scheiterte am
 * Namen, nachdem das erste schon da ist.
 *
 * Scheitert der Upload, geht der Zustand zurück auf `OFFEN`. Ein Vorschlag, der
 * als angenommen gilt und nirgends liegt, wäre der schlimmere Zustand: niemand
 * würde ihn noch einmal ansehen.
 */
export async function nimmAn(antragId: string, akteurDiscordId: string): Promise<EntscheidungsErgebnis> {
  await settingsOderFehler();

  const vorher = await prisma.emojiAntrag.findUnique({ where: { id: antragId } });
  if (!vorher) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diesen Vorschlag gibt es nicht.' });
  }

  const beansprucht = await prisma.emojiAntrag.updateMany({
    where: { id: antragId, status: { in: [...EMOJI_ANTRAG_OFFEN] } },
    data: { status: 'ANGENOMMEN', entschiedenVon: akteurDiscordId, entschiedenAm: new Date() },
  });
  if (beansprucht.count !== 1) {
    // Schon entschieden. Idempotent: wer zweimal klickt, bekommt keinen Fehler.
    return {
      ok: false,
      grund: 'Über diesen Vorschlag ist schon entschieden.',
      antrag: (await prisma.emojiAntrag.findUnique({ where: { id: antragId } })) ?? undefined,
    };
  }

  return legeAufDiscordAb(antragId, akteurDiscordId, 'ANGENOMMEN');
}

/**
 * Den beanspruchten Vorschlag auf Discord ablegen.
 *
 * Gemeinsamer Teil von «annehmen» und «Abstimmung erreicht das Ziel»: beide
 * haben den Vorschlag vorher beansprucht, und beide müssen bei einem
 * Fehlschlag denselben Weg zurück gehen.
 */
async function legeAufDiscordAb(
  antragId: string,
  akteurDiscordId: string,
  weg: 'ANGENOMMEN' | 'ABSTIMMUNG',
): Promise<EntscheidungsErgebnis> {
  const antrag = await prisma.emojiAntrag.findUniqueOrThrow({ where: { id: antragId } });
  const bytes = await liesAb(antrag.dateiName);

  if (!bytes) {
    await zurueckAufOffen(antragId);
    return {
      ok: false,
      grund: 'Die Bilddatei zu diesem Vorschlag ist nicht mehr da. Er muss neu eingereicht werden.',
    };
  }

  const ergebnis = await fuegeEmojiHinzu({
    name: antrag.name,
    bytes,
    akteurDiscordId,
    herkunftNotiz: antrag.herkunftNotiz,
    // Die Reserve gilt: ein angenommener Vorschlag ist kein Team-Emoji.
    ohneReserve: false,
  });

  if (!ergebnis.ok || !ergebnis.emoji) {
    await zurueckAufOffen(antragId);
    return { ok: false, grund: ergebnis.grund };
  }

  const fertig = await prisma.emojiAntrag.update({
    where: { id: antragId },
    data: { emojiId: ergebnis.emoji.id, emojiName: ergebnis.emoji.name },
  });

  await recordAudit({
    action: weg === 'ABSTIMMUNG' ? AUDIT_ACTIONS.EMOJI_VOTE_PASSED : AUDIT_ACTIONS.EMOJI_REQUEST_ACCEPTED,
    module: EMOJI_MODULE_ID,
    actorDiscordId: akteurDiscordId,
    targetDiscordId: antrag.antragstellerId,
    targetLabel: ergebnis.emoji.name,
    success: true,
    metadata: { antragId, emojiId: ergebnis.emoji.id, weg },
  });

  // Die Bytes liegen jetzt bei Discord. Eine zweite Kopie hier wäre Speicher
  // für nichts - der Eintrag nennt die Emoji-Kennung.
  await raeumeAuf(antrag.dateiName);

  return { ok: true, antrag: fertig, emojiId: ergebnis.emoji.id };
}

/** Zurück auf Anfang, nachdem ein Upload gescheitert ist. */
async function zurueckAufOffen(antragId: string): Promise<void> {
  await prisma.emojiAntrag.update({
    where: { id: antragId },
    data: { status: 'OFFEN', entschiedenVon: null, entschiedenAm: null },
  });
  log.warn('Vorschlag zurück auf OFFEN - Upload gescheitert', { antragId });
}

/** Einen Vorschlag ablehnen. Der Grund geht an die Person, nicht ins Nichts. */
export async function lehneAb(
  antragId: string,
  akteurDiscordId: string,
  grund?: string | null,
): Promise<EntscheidungsErgebnis> {
  await settingsOderFehler();

  const vorher = await prisma.emojiAntrag.findUnique({ where: { id: antragId } });
  if (!vorher) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diesen Vorschlag gibt es nicht.' });
  }

  const beansprucht = await prisma.emojiAntrag.updateMany({
    where: { id: antragId, status: { in: [...EMOJI_ANTRAG_OFFEN] } },
    data: {
      status: 'ABGELEHNT',
      entschiedenVon: akteurDiscordId,
      entschiedenAm: new Date(),
      ablehnungsGrund: grund ? sanitizeText(grund, 500) : null,
    },
  });
  if (beansprucht.count !== 1) {
    return { ok: false, grund: 'Über diesen Vorschlag ist schon entschieden.' };
  }

  await recordAudit({
    action: AUDIT_ACTIONS.EMOJI_REQUEST_REJECTED,
    module: EMOJI_MODULE_ID,
    actorDiscordId: akteurDiscordId,
    targetDiscordId: vorher.antragstellerId,
    targetLabel: vorher.name,
    success: true,
    metadata: { antragId, grund: grund ?? null },
  });

  // Abgelehnt heisst: die Bytes brauchen wir nicht mehr. Der Eintrag bleibt -
  // «Was ist aus meinem Vorschlag geworden?» soll beantwortbar bleiben.
  await raeumeAuf(vorher.dateiName);

  return {
    ok: true,
    antrag: (await prisma.emojiAntrag.findUnique({ where: { id: antragId } })) ?? undefined,
  };
}

export { legeAufDiscordAb as legeBeanspruchtenAntragAb };
