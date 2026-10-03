import { prisma, AUDIT_ACTIONS, recordAudit } from '@swisshub/database';
import { appUrl } from '@swisshub/config';
import { z } from 'zod';
import { LEVEL_MODULE_ID } from '../config';
import { sorgeFuerKonfiguration } from './konfiguration';
import { BEFEHL_VORGABEN } from './vorgaben';

/**
 * Das Embed von `/xp-slot`.
 *
 * ## Was hier konfiguriert wird - und was nicht
 *
 * **Nur Inhalt und Aussehen**: Titel, Text, Farbe, Knopfbeschriftung,
 * Fusszeile, Bilder. Ob der Befehl ueberhaupt laeuft und wer ihn benutzen
 * darf, bleibt bei der zentralen Command- und Rollenverwaltung. Ein zweiter
 * Riegel hier waere eine zweite Wahrheit: jemand schaltet den Befehl dort
 * frei, er geht trotzdem nicht, und niemand findet den Grund.
 *
 * `aktiv` ist deshalb ausdruecklich **kein** zweiter Befehlsschalter, sondern
 * die Antwort auf «soll der Befehl ein gestaltetes Embed schicken oder die
 * schlichte Vorgabe». Aus ist aus im Sinne von: nimm die Vorgaben.
 *
 * ## Warum die Adresse nicht konfigurierbar ist
 *
 * Weil sie aus `appUrl` kommt und damit auf jedem Server stimmt. Ein Feld zum
 * Eintippen waere ein Feld, in dem irgendwann eine alte Domain steht.
 *
 * ## Warum leere Felder nicht gespeichert werden
 *
 * Ein geleertes Feld ist die Rueckkehr zur Vorgabe, nicht ein leeres Embed.
 * Darum wird Leeres zu `null`, und `null` loest beim Lesen die Vorgabe aus.
 */

/** Was der Bot zum Rendern braucht - immer vollstaendig, nie leer. */
export interface BefehlsEmbed {
  aktiv: boolean;
  titel: string;
  beschreibung: string;
  /** Als Zahl, wie Discord sie will. */
  farbe: number;
  knopf: string;
  fusszeile: string | null;
  thumbnailUrl: string | null;
  bildUrl: string | null;
  /** Die Adresse des Knopfs - immer aus `appUrl`, nie aus der Datenbank. */
  adresse: string;
}

/** Was die Verwaltung bearbeitet - leer heisst «Vorgabe». */
export interface BefehlsEingabe {
  aktiv: boolean;
  titel: string;
  beschreibung: string;
  farbe: string;
  knopf: string;
  fusszeile: string;
  thumbnailUrl: string;
  bildUrl: string;
}

const farbMuster = /^#[0-9a-f]{6}$/iu;

/**
 * Nur `https`, und nur, wenn ueberhaupt etwas dasteht.
 *
 * Discord laedt das Bild selbst nach; eine `http`-Adresse waere eine
 * unverschluesselte Anfrage von Discords Servern aus, und `data:` oder
 * `javascript:` haben in einem Embed nichts zu suchen.
 */
const bildAdresse = z
  .string()
  .trim()
  .max(500)
  .refine((wert) => wert === '' || /^https:\/\//u.test(wert), {
    message: 'Bildadressen müssen mit https:// beginnen.',
  });

export const befehlSchema = z.object({
  aktiv: z.boolean(),
  titel: z.string().trim().max(240),
  beschreibung: z.string().trim().max(2000),
  farbe: z
    .string()
    .trim()
    .refine((wert) => wert === '' || farbMuster.test(wert), {
      message: 'Die Farbe braucht die Form #rrggbb.',
    }),
  knopf: z.string().trim().max(60),
  fusszeile: z.string().trim().max(240),
  thumbnailUrl: bildAdresse,
  bildUrl: bildAdresse,
});

/** Leer bleibt leer - und leer heisst beim Lesen «Vorgabe». */
function alsWert(text: string): string | null {
  const sauber = text.trim();
  return sauber === '' ? null : sauber;
}

/** `#rrggbb` als Zahl, wie Discord die Farbe erwartet. */
export function farbzahl(hex: string): number {
  const sauber = hex.trim();
  if (!farbMuster.test(sauber)) {
    return farbzahl(BEFEHL_VORGABEN.farbe);
  }
  return Number.parseInt(sauber.slice(1), 16);
}

/**
 * Was der Bot schickt.
 *
 * Faellt in jedem Feld einzeln auf die Vorgabe zurueck - nicht erst, wenn die
 * ganze Zeile fehlt. Wer nur den Titel aendert, behaelt den Vorgabetext
 * darunter, statt ein Embed mit einem Titel und sonst nichts zu bekommen.
 */
export async function befehlsEmbed(): Promise<BefehlsEmbed> {
  const config = await prisma.xpSlotConfig.findUnique({ where: { id: 'default' } }).catch(() => null);
  const adresse = appUrl('/level/xp-slot');

  /*
   * Ohne Konfigurationszeile die reine Vorgabe.
   *
   * Das ist der Fall «frisch installiert» und der Fall «Datenbank gerade nicht
   * erreichbar». In beiden soll `/xp-slot` eine brauchbare Nachricht schicken
   * und nicht scheitern - der Befehl ist eine Einladung, kein Buchungsvorgang.
   */
  if (!config || !config.commandEnabled) {
    return {
      aktiv: config?.commandEnabled ?? true,
      titel: BEFEHL_VORGABEN.titel,
      beschreibung: BEFEHL_VORGABEN.beschreibung,
      farbe: farbzahl(BEFEHL_VORGABEN.farbe),
      knopf: BEFEHL_VORGABEN.knopf,
      fusszeile: BEFEHL_VORGABEN.fusszeile,
      thumbnailUrl: null,
      bildUrl: null,
      adresse,
    };
  }

  return {
    aktiv: true,
    titel: config.commandTitle ?? BEFEHL_VORGABEN.titel,
    beschreibung: config.commandDescription ?? BEFEHL_VORGABEN.beschreibung,
    farbe: farbzahl(config.commandColor ?? BEFEHL_VORGABEN.farbe),
    knopf: config.commandButtonLabel ?? BEFEHL_VORGABEN.knopf,
    fusszeile: config.commandFooter ?? BEFEHL_VORGABEN.fusszeile,
    thumbnailUrl: config.commandThumbnailUrl,
    bildUrl: config.commandImageUrl,
    adresse,
  };
}

/** Was die Verwaltung anzeigt - leere Felder heissen «Vorgabe». */
export async function befehlsEinstellungen(): Promise<BefehlsEingabe> {
  const config = await prisma.xpSlotConfig.findUnique({ where: { id: 'default' } });
  return {
    aktiv: config?.commandEnabled ?? true,
    titel: config?.commandTitle ?? '',
    beschreibung: config?.commandDescription ?? '',
    farbe: config?.commandColor ?? '',
    knopf: config?.commandButtonLabel ?? '',
    fusszeile: config?.commandFooter ?? '',
    thumbnailUrl: config?.commandThumbnailUrl ?? '',
    bildUrl: config?.commandImageUrl ?? '',
  };
}

export interface BefehlsAkteur {
  discordId: string;
  username?: string | null;
}

/** Speichert das Embed. Leere Felder werden zu `null` - also zur Vorgabe. */
export async function speichereBefehl(eingabe: BefehlsEingabe, akteur: BefehlsAkteur): Promise<void> {
  const geprueft = befehlSchema.parse(eingabe);

  // Wie bei jedem anderen Speichern in der Slot-Verwaltung: erst die Zeile
  // sicherstellen. Auf einem frisch aufgesetzten Server gibt es sie noch
  // nicht, und ein `update` darauf waere ein Fehler, den niemand versteht.
  await sorgeFuerKonfiguration();

  await prisma.xpSlotConfig.update({
    where: { id: 'default' },
    data: {
      commandEnabled: geprueft.aktiv,
      commandTitle: alsWert(geprueft.titel),
      commandDescription: alsWert(geprueft.beschreibung),
      commandColor: alsWert(geprueft.farbe),
      commandButtonLabel: alsWert(geprueft.knopf),
      commandFooter: alsWert(geprueft.fusszeile),
      commandThumbnailUrl: alsWert(geprueft.thumbnailUrl),
      commandImageUrl: alsWert(geprueft.bildUrl),
    },
  });

  await recordAudit({
    action: AUDIT_ACTIONS.XP_SLOT_CONFIG_UPDATED,
    module: LEVEL_MODULE_ID,
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username ?? null,
    targetLabel: '/xp-slot Nachricht',
    success: true,
    metadata: {
      aktiv: geprueft.aktiv,
      // Nur, **ob** etwas eigenes dasteht - der Text selbst gehoert nicht in
      // die Pruefspur, er steht in der Konfiguration.
      eigeneFelder: Object.entries({
        titel: geprueft.titel,
        beschreibung: geprueft.beschreibung,
        farbe: geprueft.farbe,
        knopf: geprueft.knopf,
        fusszeile: geprueft.fusszeile,
      })
        .filter(([, wert]) => wert.trim() !== '')
        .map(([name]) => name),
    },
  });
}
