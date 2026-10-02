import { AUDIT_ACTIONS, prisma, recordAudit } from '@swisshub/database';
import type { Prisma } from '@swisshub/database';
import { AppError, normalisiereFarbe, sanitizeText } from '@swisshub/shared';
import { createLogger } from '@swisshub/logger';
import type { FragtAbstimmung, FragtEntwurf, FragtFragetyp } from '@swisshub/database';
import { FRAGT_MODULE_ID } from './config';
import { ausSnapshot, type Ergebnis } from './ergebnis';
import { fragetyp } from './typen';
import type { Handelnder } from './bibliothek';

const log = createLogger('fragt:entwurf');

/**
 * Der Social-Media-Entwurf.
 *
 * ## Was bearbeitbar ist und was nicht
 *
 * Bearbeitbar: Ueberschrift, Untertitel, Aufruf, welche Folien mitkommen, in
 * welcher Reihenfolge, welche Vorlage, welches Format, welches Bild.
 *
 * **Nicht bearbeitbar: die Zahlen.** Sie stehen nirgends in diesem Modell. Der
 * Renderer holt sie aus `FragtAbstimmung.ergebnis` - dem Schnappschuss, der
 * beim Schliessen festgeschrieben wurde. Es gibt also keinen Weg, eine 42 in
 * eine 68 zu aendern, und zwar nicht, weil es verboten waere, sondern weil das
 * Feld nicht existiert.
 *
 * Das ist der Kern von «Echte Abstimmungszahlen dürfen nicht frei
 * manipulierbar sein»: eine Pruefung liesse sich vergessen, eine fehlende
 * Spalte nicht.
 */

/** Die Folienarten eines Carousels. */
export const FOLIEN_ARTEN = ['frage', 'gewinner', 'verteilung', 'duell', 'cta'] as const;
export type FolienArt = (typeof FOLIEN_ARTEN)[number];

/** Die drei Vorlagen fuer ein einzelnes Bild. */
export const VORLAGEN = ['winner', 'results', 'duel'] as const;
export type Vorlage = (typeof VORLAGEN)[number];

/** Die drei Ausgabeformate. */
export const FORMATE = ['story', 'feed', 'quadrat'] as const;
export type Format = (typeof FORMATE)[number];

/**
 * Das Zeichen oben links auf einer Folie.
 *
 * Dieselben drei Woerter wie in `fragtSettingsSchema.exportLogo` - und
 * ausdruecklich dieselben: der Entwurf uebersteuert die Moduleinstellung, und
 * eine Wahl, die es nur an einer der beiden Stellen gibt, waere eine, die beim
 * Uebersteuern verschwindet.
 *
 * **Nie ein Pfad.** Was das Wort bedeutet, entscheidet `folienMarke`; ein
 * manipulierter Logopfad kann deshalb nicht entstehen, weil es keinen gibt.
 */
export const EXPORT_LOGO_WAHLEN = ['signet', 'serverlogo', 'keins'] as const;
export type ExportLogoWahl = (typeof EXPORT_LOGO_WAHLEN)[number];

/**
 * Farbe, Zeichen und Zusatztext eines einzelnen Exports.
 *
 * ## Warum `null` nicht «leer» heisst, sondern «wie im Modul»
 *
 * Diese drei Werte gab es bisher nur als Moduleinstellungen, gueltig fuer
 * jeden Export. Sie gehoeren jetzt auch an den Entwurf - aber die
 * Moduleinstellung bleibt die Vorgabe und wird nicht ersetzt: wer im Studio
 * nichts einstellt, bekommt weiterhin die Serverfarbe, und ein bestehender
 * Entwurf sieht aus wie vorher.
 *
 * `null` ist deshalb ein eigener Zustand und kein Synonym fuer «nichts
 * anzeigen». Fuer «kein Zeichen» gibt es das Wort `keins`, fuer «kein
 * Zusatztext» die leere Zeichenkette - beides sind Entscheidungen und werden
 * als solche gespeichert.
 *
 * Aufgeloest wird das in `folienMarke` (WebApp), an einer Stelle fuer die
 * Vorschau, das Einzelbild und das ZIP.
 */
export interface ExportMarke {
  /** `#rrggbb`, oder `null` fuer die Modulfarbe. */
  exportAkzentfarbe: string | null;
  /** Eines von `EXPORT_LOGO_WAHLEN`, oder `null` fuer die Moduleinstellung. */
  exportLogo: ExportLogoWahl | null;
  /** Fusszeile; `''` heisst ausdruecklich keine, `null` heisst «wie im Modul». */
  exportZusatztext: string | null;
}

export interface FolienEintrag {
  art: FolienArt;
  aktiv: boolean;
  position: number;
}

/**
 * Welche Folien ein Carousel bekommt.
 *
 * ## Warum das vom Fragetyp abhaengt
 *
 * Ein Entweder-oder hat zwei Antworten. Eine Folie «der Gewinner» und daneben
 * eine Folie «die Verteilung» zeigten beide dasselbe: zwei Balken, einer
 * laenger. Die Aufgabe sagt es selbst - keine kuenstliche Streckung auf vier
 * Folien, wenn weniger besser aussieht.
 *
 * Also: bei zwei Antworten drei Folien mit der Duell-Komposition in der Mitte,
 * bei mehr Antworten vier.
 */
export function folienVorschlag(typ: FragtFragetyp): FolienEintrag[] {
  const zweiAntworten = fragetyp(typ).maxOptionen === 2;

  const arten: FolienArt[] = zweiAntworten
    ? ['frage', 'duell', 'cta']
    : ['frage', 'gewinner', 'verteilung', 'cta'];

  return arten.map((art, index) => ({ art, aktiv: true, position: index }));
}

/** Die Folien aus dem JSON lesen - robust gegen alte oder kaputte Eintraege. */
export function leseFolien(rohdaten: unknown, typ: FragtFragetyp): FolienEintrag[] {
  if (!Array.isArray(rohdaten)) {
    return folienVorschlag(typ);
  }
  const gelesen: FolienEintrag[] = [];
  for (const eintrag of rohdaten) {
    if (typeof eintrag !== 'object' || eintrag === null) {
      continue;
    }
    const kandidat = eintrag as Partial<FolienEintrag>;
    if (
      typeof kandidat.art === 'string' &&
      (FOLIEN_ARTEN as readonly string[]).includes(kandidat.art) &&
      typeof kandidat.position === 'number'
    ) {
      gelesen.push({
        art: kandidat.art as FolienArt,
        aktiv: kandidat.aktiv !== false,
        position: kandidat.position,
      });
    }
  }
  // Nichts Brauchbares gelesen: der Vorschlag ist besser als eine leere Liste,
  // die im Studio wie ein Fehler aussieht.
  return gelesen.length > 0 ? gelesen.sort((a, b) => a.position - b.position) : folienVorschlag(typ);
}

/**
 * Nach dem Schliessen einen Entwurf anlegen.
 *
 * Die Texte sind Vorschlaege, keine Behauptungen: die Ueberschrift ist die
 * Frage, der Untertitel nennt die Zahl der Stimmen, der Aufruf lädt auf Discord
 * ein. Wer das anders will, aendert es im Studio.
 *
 * `upsert` auf die eindeutige Abstimmung: ein zweiter Aufruf - etwa weil der
 * Abschluss nach einem Neustart wiederholt wird - ueberschreibt keinen Entwurf,
 * den jemand schon bearbeitet hat.
 */
export async function erstelleEntwurf(
  abstimmung: FragtAbstimmung,
  ergebnis: Ergebnis,
): Promise<FragtEntwurf> {
  const vorhanden = await prisma.fragtEntwurf.findUnique({ where: { abstimmungId: abstimmung.id } });
  if (vorhanden) {
    return vorhanden;
  }

  const angaben = fragetyp(abstimmung.typ);
  const folien = folienVorschlag(abstimmung.typ);

  const untertitel =
    ergebnis.gesamt === 0
      ? 'Diesmal hat niemand abgestimmt.'
      : ergebnis.gewinner
        ? `${ergebnis.gewinner.label} · ${ergebnis.gewinner.prozent} %`
        : `Gleichstand bei ${ergebnis.gesamt} ${ergebnis.gesamt === 1 ? 'Stimme' : 'Stimmen'}.`;

  const entwurf = await prisma.fragtEntwurf.create({
    data: {
      abstimmungId: abstimmung.id,
      status: 'OFFEN',
      vorlage: angaben.vorlage,
      format: 'story',
      ueberschrift: abstimmung.frageText,
      untertitel,
      cta: 'Was hättest du gewählt? Diskutiere mit uns auf Discord.',
      folien: folien as unknown as Prisma.InputJsonValue,
    },
  });

  log.info('Social-Media-Entwurf angelegt', {
    abstimmungId: abstimmung.id,
    entwurfId: entwurf.id,
    vorlage: angaben.vorlage,
    folien: folien.length,
  });
  return entwurf;
}

export interface EntwurfEingabe {
  vorlage?: Vorlage;
  format?: Format;
  ueberschrift?: string;
  untertitel?: string | null;
  cta?: string;
  folien?: FolienEintrag[];
  medienDatei?: string | null;
  /** Soll die absolute Stimmenzahl auf der Grafik stehen? Prozente immer. */
  stimmenZeigen?: boolean;
  /**
   * Farbe dieses Exports. `null` setzt auf die Modulfarbe zurueck.
   *
   * Nicht uebergeben heisst «unveraendert», `null` heisst «zuruecksetzen».
   * Das sind zwei Dinge, und `undefined` gegen `null` ist der einzige Weg, sie
   * in einem Teil-Update auseinanderzuhalten.
   */
  exportAkzentfarbe?: string | null;
  /** Zeichen dieses Exports. `null` setzt auf die Moduleinstellung zurueck. */
  exportLogo?: ExportLogoWahl | null;
  /** Zusatztext dieses Exports. `null` setzt auf die Moduleinstellung zurueck. */
  exportZusatztext?: string | null;
}

/**
 * Den Entwurf bearbeiten.
 *
 * Ein finalisierter Entwurf laesst sich nicht mehr aendern - das ist der Sinn
 * von «finalisiert»: ab dort ist der Export das, was gepostet wird, und ein
 * spaeter geaenderter Text hiesse, dass die Datei auf dem Telefon und der
 * Eintrag hier nicht mehr dasselbe sagen.
 */
export async function bearbeiteEntwurf(entwurfId: string, eingabe: EntwurfEingabe): Promise<FragtEntwurf> {
  const vorhanden = await prisma.fragtEntwurf.findUnique({
    where: { id: entwurfId },
    include: { abstimmung: true },
  });
  if (!vorhanden) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diesen Entwurf gibt es nicht.' });
  }
  if (vorhanden.status !== 'OFFEN') {
    throw new AppError('CONFLICT', {
      userMessage:
        vorhanden.status === 'VEROEFFENTLICHT'
          ? 'Dieser Entwurf ist als veröffentlicht markiert und lässt sich nicht mehr ändern.'
          : 'Dieser Entwurf ist abgeschlossen. Gib ihn wieder frei, um ihn zu ändern.',
    });
  }

  return prisma.fragtEntwurf.update({
    where: { id: entwurfId },
    data: {
      ...(eingabe.vorlage ? { vorlage: eingabe.vorlage } : {}),
      ...(eingabe.format ? { format: eingabe.format } : {}),
      ...(eingabe.ueberschrift !== undefined
        ? { ueberschrift: sanitizeText(eingabe.ueberschrift, 240).trim() }
        : {}),
      ...(eingabe.untertitel !== undefined
        ? { untertitel: eingabe.untertitel ? sanitizeText(eingabe.untertitel, 240).trim() || null : null }
        : {}),
      ...(eingabe.cta !== undefined ? { cta: sanitizeText(eingabe.cta, 200).trim() } : {}),
      ...(eingabe.folien
        ? { folien: normalisiereFolien(eingabe.folien) as unknown as Prisma.InputJsonValue }
        : {}),
      ...(eingabe.medienDatei !== undefined ? { medienDatei: eingabe.medienDatei } : {}),
      ...(eingabe.stimmenZeigen !== undefined ? { stimmenZeigen: eingabe.stimmenZeigen } : {}),
      /*
       * Farbe, Zeichen und Zusatztext - geprueft beim Schreiben.
       *
       * Nicht erst beim Zeichnen: was in der Spalte steht, soll gueltig sein.
       * `folienMarke` prueft die Farbe trotzdem noch einmal, weil sie dort
       * auch aus den Moduleinstellungen kommen kann - zwei Pruefungen fuer
       * zwei Quellen, nicht zwei Pruefungen aus Misstrauen.
       *
       * Eine ungueltige Farbe wird zu `null` und damit zur Modulfarbe, nicht
       * zu einem Fehler: `#ff00` ist ein Tippfehler in einem Farbfeld, und
       * eine Fehlermeldung, die das ganze Speichern verwirft, verliert dabei
       * die Texte daneben.
       */
      ...(eingabe.exportAkzentfarbe !== undefined
        ? { exportAkzentfarbe: normalisiereFarbe(eingabe.exportAkzentfarbe) }
        : {}),
      ...(eingabe.exportLogo !== undefined
        ? {
            exportLogo: (EXPORT_LOGO_WAHLEN as readonly string[]).includes(eingabe.exportLogo ?? '')
              ? eingabe.exportLogo
              : null,
          }
        : {}),
      ...(eingabe.exportZusatztext !== undefined
        ? {
            exportZusatztext:
              eingabe.exportZusatztext === null ? null : sanitizeText(eingabe.exportZusatztext, 80).trim(),
          }
        : {}),
    },
  });
}

/**
 * Folien ordnen und von Doppeleintraegen befreien.
 *
 * Die Positionen werden neu vergeben, statt die uebergebenen zu uebernehmen:
 * eine Oberflaeche, die zweimal Position 2 schickt, soll keine Reihenfolge
 * erzeugen, die beim naechsten Laden anders aussieht.
 */
function normalisiereFolien(folien: FolienEintrag[]): FolienEintrag[] {
  const gesehen = new Set<FolienArt>();
  return folien
    .filter((folie) => {
      if (gesehen.has(folie.art)) {
        return false;
      }
      gesehen.add(folie.art);
      return true;
    })
    .sort((links, rechts) => links.position - rechts.position)
    .map((folie, index) => ({ art: folie.art, aktiv: folie.aktiv, position: index }));
}

/** Abschliessen - ab hier ist der Entwurf der Export. */
export async function finalisiereEntwurf(entwurfId: string, actor: Handelnder): Promise<FragtEntwurf> {
  const entwurf = await prisma.fragtEntwurf.findUnique({
    where: { id: entwurfId },
    include: { abstimmung: true },
  });
  if (!entwurf) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diesen Entwurf gibt es nicht.' });
  }
  if (entwurf.status === 'VEROEFFENTLICHT') {
    throw new AppError('CONFLICT', { userMessage: 'Dieser Entwurf ist schon veröffentlicht.' });
  }

  const aktualisiert = await prisma.fragtEntwurf.update({
    where: { id: entwurfId },
    data: { status: 'FINALISIERT', createdByDiscordId: entwurf.createdByDiscordId ?? actor.discordId },
  });

  await recordAudit({
    action: AUDIT_ACTIONS.FRAGT_DRAFT_FINALIZED,
    module: FRAGT_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username ?? null,
    targetLabel: entwurf.abstimmung.frageText,
    metadata: { entwurfId, abstimmungId: entwurf.abstimmungId, vorlage: entwurf.vorlage },
  });

  return aktualisiert;
}

/**
 * Einen Entwurf loeschen.
 *
 * ## Was dabei verschwindet und was nicht
 *
 * Verschwindet: die Zeile `FragtEntwurf` - Vorlage, Format, Texte, die
 * Folienreihenfolge, Farbe, Zeichen, Zusatztext. Das ist redaktionelle Arbeit
 * an einer Grafik, und sie wegzuwerfen ist eine Entscheidung wie jede andere.
 *
 * Bleibt: die **Abstimmung** und damit das Ergebnis. Ein Entwurf ist die
 * Gestaltung eines Ergebnisses, nicht das Ergebnis selbst; wer die Grafik neu
 * anfangen will, soll dabei nicht die Zahlen verlieren. Ein neuer Entwurf
 * entsteht danach ueber `erstelleEntwurf`, aus demselben Schnappschuss.
 *
 * Bleibt ebenfalls: die **Mediendatei**. `medienDatei` ist ein Dateiname aus
 * der zentralen Medienverwaltung, kein Besitz dieses Entwurfs - dasselbe Bild
 * kann an einer Frage und an einem anderen Entwurf haengen. Was hier
 * aufgeraeumt wird, ist die Zuordnung; die Datei verwaltet die
 * Medienverwaltung, und sie dort mitzuloeschen waere ein Datenverlust an einer
 * Stelle, die niemand angesehen hat.
 *
 * ## Warum auch ein veroeffentlichter Entwurf gehen darf
 *
 * `bearbeiteEntwurf` weist einen veroeffentlichten Entwurf ab, und das ist
 * richtig: was auf Instagram steht, soll nicht nachtraeglich anders hier
 * stehen. Loeschen ist der andere Fall - es behauptet nichts, es raeumt auf.
 * Dass der Eintrag einmal bestand, haelt das Protokoll fest.
 */
export async function loescheEntwurf(entwurfId: string, actor: Handelnder): Promise<void> {
  const entwurf = await prisma.fragtEntwurf.findUnique({
    where: { id: entwurfId },
    include: { abstimmung: { select: { id: true, frageText: true } } },
  });
  if (!entwurf) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diesen Entwurf gibt es nicht (mehr).' });
  }

  await prisma.fragtEntwurf.delete({ where: { id: entwurfId } });

  await recordAudit({
    action: AUDIT_ACTIONS.FRAGT_DRAFT_DELETED,
    module: FRAGT_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username ?? null,
    targetLabel: entwurf.abstimmung.frageText,
    metadata: {
      entwurfId,
      abstimmungId: entwurf.abstimmungId,
      status: entwurf.status,
      vorlage: entwurf.vorlage,
    },
  });

  log.info('Entwurf gelöscht', { entwurfId, abstimmungId: entwurf.abstimmungId });
}

/** Wieder freigeben - solange nicht als veroeffentlicht markiert. */
export async function gibEntwurfFrei(entwurfId: string): Promise<FragtEntwurf> {
  const entwurf = await prisma.fragtEntwurf.findUnique({ where: { id: entwurfId } });
  if (!entwurf) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diesen Entwurf gibt es nicht.' });
  }
  if (entwurf.status === 'VEROEFFENTLICHT') {
    throw new AppError('CONFLICT', {
      userMessage:
        'Dieser Entwurf ist als veröffentlicht markiert. Was auf Instagram steht, lässt sich hier nicht zurückholen.',
    });
  }
  return prisma.fragtEntwurf.update({ where: { id: entwurfId }, data: { status: 'OFFEN' } });
}

/**
 * Von Hand gepostet - hier so festhalten.
 *
 * Das Modul postet **nicht** selbst auf Instagram. Es gibt keine
 * Zugangsdaten, keinen Endpunkt und keinen Job dafuer; ein Entwurf zu
 * erzeugen ist keine Veroeffentlichung. Diese Markierung ist die
 * Buchhaltung dazu: sie sagt, dass es jemand getan hat, damit die Uebersicht
 * «noch nicht exportiert» richtig zaehlen kann.
 */
export async function markiereVeroeffentlicht(entwurfId: string, actor: Handelnder): Promise<FragtEntwurf> {
  const entwurf = await prisma.fragtEntwurf.findUnique({
    where: { id: entwurfId },
    include: { abstimmung: true },
  });
  if (!entwurf) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diesen Entwurf gibt es nicht.' });
  }

  const aktualisiert = await prisma.fragtEntwurf.update({
    where: { id: entwurfId },
    data: { status: 'VEROEFFENTLICHT', veroeffentlichtAt: new Date() },
  });

  await recordAudit({
    action: AUDIT_ACTIONS.FRAGT_DRAFT_MARKED_PUBLISHED,
    module: FRAGT_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username ?? null,
    targetLabel: entwurf.abstimmung.frageText,
    metadata: { entwurfId, abstimmungId: entwurf.abstimmungId },
  });

  return aktualisiert;
}

/**
 * Alles, was der Renderer braucht - Texte **und** die festgeschriebenen Zahlen.
 *
 * Eine Funktion und nicht zwei: der Renderer soll die Zahlen nicht selbst
 * beschaffen koennen, sonst gaebe es einen zweiten Weg, an sie zu kommen, und
 * einer der beiden waere irgendwann der ungeprueste.
 */
export interface EntwurfsDaten {
  entwurf: FragtEntwurf;
  abstimmung: FragtAbstimmung;
  /** Das Ergebnis aus dem Schnappschuss - `null`, wenn keiner lesbar ist. */
  ergebnis: Ergebnis | null;
  folien: FolienEintrag[];
}

export async function holeEntwurfsDaten(entwurfId: string): Promise<EntwurfsDaten | null> {
  const entwurf = await prisma.fragtEntwurf.findUnique({
    where: { id: entwurfId },
    include: { abstimmung: true },
  });
  if (!entwurf) {
    return null;
  }
  return {
    entwurf,
    abstimmung: entwurf.abstimmung,
    ergebnis: ausSnapshot(entwurf.abstimmung.ergebnis),
    folien: leseFolien(entwurf.folien, entwurf.abstimmung.typ),
  };
}

export async function holeEntwurfZuAbstimmung(abstimmungId: string): Promise<FragtEntwurf | null> {
  return prisma.fragtEntwurf.findUnique({ where: { abstimmungId } });
}
