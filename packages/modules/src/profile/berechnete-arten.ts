import { AUDIT_ACTIONS, prisma, recordAudit } from '@swisshub/database';
import { AppError, sanitizeText } from '@swisshub/shared';
import {
  AUSZEICHNUNGS_SYMBOLE,
  MESSWERTE,
  alleAuszeichnungsArten,
  auszeichnungsArt,
  type AuszeichnungsArt,
  type Stufe,
} from './auszeichnungen';

/**
 * Die gerechneten Auszeichnungen verwalten.
 *
 * ## Die Aufteilung
 *
 * Der **Bauplan** steht im Code: welcher Messwert gezaehlt wird, ist eine
 * Aussage ueber die Datenquellen dieses Systems. Die **Darstellung und eine
 * Zahl** stehen in der Datenbank: Beschriftung, Beschreibung, Symbol, Stufe,
 * Schwellenwert, aktiv.
 *
 * Damit gibt es kein Feld, ueber das ein Ausdruck in die Auswertung gelangen
 * koennte. Wer den Schwellenwert von «Seriensieger» von drei auf fuenf
 * setzt, aendert eine Zahl in einem Zahlenfeld - mehr ist da nicht.
 *
 * ## Warum ein fehlender Eintrag «unveraendert» heisst
 *
 * Weil sonst jede Vorgabe zweimal stuende: einmal im Code und einmal als
 * Kopie in der Datenbank. Kopien laufen auseinander - ein spaeter
 * verbesserter Beschreibungstext erreichte dann niemanden mehr, der die
 * Auszeichnung nie angefasst hat.
 *
 * ## Warum es kein Loeschen gibt
 *
 * Eine gerechnete Auszeichnung laesst sich nicht loeschen, ohne die Regel zu
 * loeschen, die sie erzeugt - und die steht im Code. Was es gibt, ist
 * **Abschalten**: sie wird nicht mehr gerechnet und erscheint in keinem
 * Profil. Dabei geht nichts verloren, denn es war nie etwas gespeichert: die
 * Auszeichnung entsteht aus Turnieren, Clips und dem Level, und die bleiben.
 * Wer sie wieder einschaltet, bekommt genau dasselbe Bild wie vorher.
 *
 * Das ist der Unterschied zu den verleihbaren Arten nebenan: dort haengt an
 * jeder Definition eine Liste von Verleihungen, und ein Loeschen wuerde sie
 * heimatlos machen. Hier haengt nichts.
 */

/** Eine gerechnete Art, wie die Verwaltung sie sieht. */
export interface BerechneteArtAnsicht {
  key: string;
  label: string;
  beschreibung: string;
  symbol: string;
  stufe: Stufe;
  /** `true`, wenn sie gerechnet und angezeigt wird. */
  aktiv: boolean;
  archiviert: boolean;
  /** Ob an dieser Art ueberhaupt eine Zahl einzustellen ist. */
  schwelleEinstellbar: boolean;
  /** Der wirksame Schwellenwert - `null` bei Ja-Nein-Merkmalen. */
  schwelle: number | null;
  /** Der Vorgabewert aus dem Code - fuer «zuruecksetzen». */
  schwelleVorgabe: number | null;
  /** Was gezaehlt wird, in Worten. */
  messwert: string | null;
  einheit: string | null;
  /** Weicht irgendetwas von der Vorgabe ab? */
  angepasst: boolean;
}

/** Was sich aendern laesst. */
export interface BerechneteArtEingabe {
  label: string;
  beschreibung: string;
  symbol: string;
  stufe: Stufe;
  /** Nur bei Schwellenbedingungen; sonst wird sie stillschweigend verworfen. */
  schwelle?: number | null;
  aktiv: boolean;
}

const STUFEN: readonly Stufe[] = ['bronze', 'silber', 'gold'];

/** Der wirksame Zustand aller gerechneten Arten - Code plus Verwaltung. */
export async function berechneteArten(
  optionen: { mitArchivierten?: boolean } = {},
): Promise<AuszeichnungsArt[]> {
  const zeilen = await prisma.computedAwardOverride.findMany();
  const nachKey = new Map(zeilen.map((zeile) => [zeile.key, zeile]));

  return alleAuszeichnungsArten().flatMap((art) => {
    const zeile = nachKey.get(art.key);
    if (!zeile) {
      return [art];
    }
    if (zeile.archivedAt && !optionen.mitArchivierten) {
      // Archiviert wirkt wie abgeschaltet - sie wird nicht gerechnet.
      return [{ ...art, aus: true }];
    }

    /*
     * Die Schwelle wirkt nur dort, wo es eine gibt.
     *
     * Ein Wert an einem Ja-Nein-Merkmal ist keine Einstellung, sondern ein
     * Missverstaendnis - er wird hier verworfen statt irgendwo unten still
     * etwas zu veraendern.
     */
    const bedingung =
      art.bedingung.art === 'schwelle' && zeile.threshold !== null
        ? { ...art.bedingung, wert: zeile.threshold }
        : art.bedingung;

    return [
      {
        ...art,
        label: zeile.label ?? art.label,
        beschreibung: zeile.description ?? art.beschreibung,
        symbol: zeile.symbol ?? art.symbol,
        stufe: (zeile.tier as Stufe | null) ?? art.stufe,
        bedingung,
        aus: !zeile.enabled || zeile.archivedAt !== null,
      },
    ];
  });
}

/** Dieselbe Liste, aufbereitet fuer die Verwaltungsoberflaeche. */
export async function berechneteArtenZurVerwaltung(): Promise<BerechneteArtAnsicht[]> {
  const zeilen = await prisma.computedAwardOverride.findMany();
  const nachKey = new Map(zeilen.map((zeile) => [zeile.key, zeile]));

  return alleAuszeichnungsArten().map((art) => {
    const zeile = nachKey.get(art.key);
    const schwelleEinstellbar = art.bedingung.art === 'schwelle';
    const vorgabe = art.bedingung.art === 'schwelle' ? art.bedingung.wert : null;
    const messwert = art.bedingung.art === 'schwelle' ? MESSWERTE[art.bedingung.messwert] : null;

    return {
      key: art.key,
      label: zeile?.label ?? art.label,
      beschreibung: zeile?.description ?? art.beschreibung,
      symbol: zeile?.symbol ?? art.symbol,
      stufe: (zeile?.tier as Stufe | null) ?? art.stufe,
      aktiv: zeile ? zeile.enabled && zeile.archivedAt === null : true,
      archiviert: zeile?.archivedAt != null,
      schwelleEinstellbar,
      schwelle: schwelleEinstellbar ? (zeile?.threshold ?? vorgabe) : null,
      schwelleVorgabe: vorgabe,
      messwert: messwert?.label ?? null,
      einheit: messwert?.einheit ?? null,
      angepasst: zeile !== undefined,
    };
  });
}

/** Die Art aus dem Code - oder ein Fehler, wenn es sie nicht gibt. */
function verlangeArt(key: string): AuszeichnungsArt {
  const art = auszeichnungsArt(key);
  if (!art) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese gerechnete Auszeichnung gibt es nicht.' });
  }
  return art;
}

/**
 * Eine gerechnete Auszeichnung anpassen.
 *
 * Geprueft wird dasselbe wie bei den verleihbaren Arten: das Symbol muss aus
 * der festen Liste stammen, die Stufe aus den drei erlaubten. Dazu die
 * Schwelle - eine Zahl zwischen eins und einer Million, und nur dort, wo es
 * eine Schwelle gibt.
 */
export async function aendereBerechneteArt(
  key: string,
  eingabe: BerechneteArtEingabe,
  akteur: { discordId: string; username?: string | null },
): Promise<void> {
  const art = verlangeArt(key);

  const label = sanitizeText(eingabe.label, 60);
  const beschreibung = sanitizeText(eingabe.beschreibung, 200);
  if (label.length < 2) {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Bitte eine Bezeichnung angeben.' });
  }
  if (beschreibung.length < 3) {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Bitte eine Beschreibung angeben.' });
  }
  if (!AUSZEICHNUNGS_SYMBOLE.includes(eingabe.symbol)) {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Dieses Symbol gibt es nicht.' });
  }
  if (!STUFEN.includes(eingabe.stufe)) {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Diese Stufe gibt es nicht.' });
  }

  let schwelle: number | null = null;
  if (art.bedingung.art === 'schwelle' && eingabe.schwelle != null) {
    if (!Number.isInteger(eingabe.schwelle) || eingabe.schwelle < 1 || eingabe.schwelle > 1_000_000) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: 'Der Schwellenwert muss eine ganze Zahl zwischen 1 und 1 000 000 sein.',
      });
    }
    schwelle = eingabe.schwelle;
  }

  const vorher = await prisma.computedAwardOverride.findUnique({ where: { key } });
  const daten = {
    label,
    description: beschreibung,
    symbol: eingabe.symbol,
    tier: eingabe.stufe,
    threshold: schwelle,
    enabled: eingabe.aktiv,
    archivedAt: null,
    updatedByDiscordId: akteur.discordId,
  };
  await prisma.computedAwardOverride.upsert({ where: { key }, create: { key, ...daten }, update: daten });

  /*
   * Kein Abgleichlauf danach.
   *
   * Gerechnete Auszeichnungen werden nirgends gespeichert - sie entstehen
   * bei jeder Anzeige neu aus Turnieren, Clips und dem Level. Ein
   * geaenderter Schwellenwert wirkt deshalb sofort und ueberall, und es gibt
   * nichts nachzuziehen. Genau das ist der Grund, weshalb sie von Anfang an
   * nicht in einer Tabelle stehen.
   */
  await recordAudit({
    action: AUDIT_ACTIONS.PROFILE_COMPUTED_AWARD_EDITED,
    module: 'members',
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username ?? null,
    targetLabel: label,
    metadata: {
      key,
      vorher: vorher
        ? { label: vorher.label, stufe: vorher.tier, schwelle: vorher.threshold, aktiv: vorher.enabled }
        : 'Vorgabe',
      nachher: { label, stufe: eingabe.stufe, schwelle, aktiv: eingabe.aktiv },
    },
  });
}

/**
 * Eine gerechnete Auszeichnung aus der Verwaltung nehmen.
 *
 * Das ist die Antwort auf «loeschen», und sie ist ehrlicher: die Regel
 * bleibt im Code, sie wird nur nicht mehr gerechnet. Bestehende Profile
 * zeigen sie ab sofort nicht mehr - gespeichert war sie dort ohnehin nie.
 */
export async function archiviereBerechneteArt(
  key: string,
  akteur: { discordId: string; username?: string | null },
): Promise<void> {
  const art = verlangeArt(key);
  const daten = {
    enabled: false,
    archivedAt: new Date(),
    updatedByDiscordId: akteur.discordId,
  };
  await prisma.computedAwardOverride.upsert({ where: { key }, create: { key, ...daten }, update: daten });

  await recordAudit({
    action: AUDIT_ACTIONS.PROFILE_COMPUTED_AWARD_ARCHIVED,
    module: 'members',
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username ?? null,
    targetLabel: art.label,
    metadata: { key },
  });
}

/** Zurueck in die Verwaltung - und wieder gerechnet. */
export async function holeBerechneteArtZurueck(
  key: string,
  akteur: { discordId: string; username?: string | null },
): Promise<void> {
  const art = verlangeArt(key);
  await prisma.computedAwardOverride.update({
    where: { key },
    data: { enabled: true, archivedAt: null, updatedByDiscordId: akteur.discordId },
  });

  await recordAudit({
    action: AUDIT_ACTIONS.PROFILE_COMPUTED_AWARD_RESTORED,
    module: 'members',
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username ?? null,
    targetLabel: art.label,
    metadata: { key },
  });
}

/**
 * Alle Anpassungen einer Art verwerfen - zurueck auf die Vorgabe aus dem Code.
 *
 * Der Weg zurueck muss es geben, sonst waere jede Aenderung endgueltig: ohne
 * ihn liesse sich «war frueher besser» nur durch Abtippen der alten Werte
 * beheben, und niemand weiss nach einem halben Jahr noch, wie sie lauteten.
 */
export async function setzeBerechneteArtZurueck(
  key: string,
  akteur: { discordId: string; username?: string | null },
): Promise<void> {
  const art = verlangeArt(key);
  await prisma.computedAwardOverride.deleteMany({ where: { key } });

  await recordAudit({
    action: AUDIT_ACTIONS.PROFILE_COMPUTED_AWARD_RESET,
    module: 'members',
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username ?? null,
    targetLabel: art.label,
    metadata: { key },
  });
}
