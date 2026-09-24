import { z } from 'zod';

/**
 * Was zu welchem Spiel im Profil stehen darf.
 *
 * ## Das Problem, das diese Datei loest
 *
 * «Rang» heisst in Counter-Strike etwas anderes als in League of Legends, und
 * «Main» gibt es in Rocket League gar nicht. Ein gemeinsames Formular fuer
 * alle Spiele waere entweder leer oder falsch.
 *
 * Der naheliegende Ausweg - eine JSON-Spalte, in die die Oberflaeche schreibt,
 * was sie fuer richtig haelt - ist der schlechtere. Dann steht in der
 * Datenbank, was irgendwann einmal ein Formular gesendet hat, und niemand
 * weiss mehr, was davon noch gilt. Eine Rangliste darueber waere Raten.
 *
 * Hier legt stattdessen **die Registry** fest, welche Felder ein Spiel hat,
 * welche Werte erlaubt sind und wie sie heissen. Die JSON-Spalte ist der
 * Speicher; die Regel steht hier.
 *
 * ## Wie ein Spiel dazukommt
 *
 * Ein Eintrag in `SPIELFELDER`, angelegt ueber `felder(...)`. Kein
 * Schemawechsel, keine Migration - genau das war die Vorgabe.
 *
 * Der Schluessel ist der **normalisierte Spielname** und nicht die Kennung
 * aus dem Katalog: die Kennung ist je Installation eine andere, der Name ist
 * ueberall derselbe. Ein Spiel ohne Eintrag bekommt einfach keine
 * spielabhaengigen Felder - das ist kein Fehler, sondern der Normalfall fuer
 * die meisten Spiele.
 *
 * ## Versionierung
 *
 * `VERSION` steht in jeder geschriebenen Zeile (`fieldsVersion`). Wird ein
 * Feld spaeter entfernt oder anders gedeutet, laesst sich am Wert erkennen,
 * was noch zu lesen ist, statt es zu raten.
 */

/** Die aktuelle Fassung dieser Registry. */
export const SPIELFELDER_VERSION = 1;

/** Ein Feld: entweder freie Eingabe mit Grenzen oder eine Auswahl. */
export type Feldart = 'text' | 'auswahl' | 'mehrfachauswahl';

export interface Feld {
  key: string;
  label: string;
  art: Feldart;
  /** Kurze Erklaerung unter dem Eingabefeld. */
  hilfe?: string;
  /** Bei Auswahlfeldern: die erlaubten Werte, in Anzeigereihenfolge. */
  optionen?: readonly string[];
  /** Bei Textfeldern: Hoechstlaenge. */
  maxLaenge?: number;
  /** Bei Mehrfachauswahl: wie viele hoechstens. */
  maxAnzahl?: number;
  /** Im Kartenkopf hervorheben - das, was man zuerst sehen will. */
  hervorgehoben?: boolean;
}

export interface Spielfelder {
  /** Normalisierter Spielname, siehe `spielSchluessel`. */
  schluessel: string;
  felder: readonly Feld[];
}

/**
 * Der Schluessel zu einem Spielnamen.
 *
 * Kleingeschrieben, ohne Satzzeichen, ohne doppelte Leerzeichen - damit
 * «Counter-Strike 2», «counter strike 2» und «Counter‑Strike 2» dasselbe
 * Spiel treffen.
 */
export function spielSchluessel(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/gu, '')
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();
}

function felder(name: string, liste: readonly Feld[]): Spielfelder {
  return { schluessel: spielSchluessel(name), felder: liste };
}

const CS2 = felder('Counter-Strike 2', [
  {
    key: 'premier',
    label: 'Premier-Rating',
    art: 'text',
    maxLaenge: 6,
    hilfe: 'Die Zahl aus dem Premier-Modus, z.B. 14350.',
    hervorgehoben: true,
  },
  {
    key: 'faceit',
    label: 'FACEIT-Level',
    art: 'auswahl',
    optionen: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
    hervorgehoben: true,
  },
  {
    key: 'rolle',
    label: 'Bevorzugte Rolle',
    art: 'auswahl',
    optionen: ['Entry', 'Support', 'AWP', 'IGL', 'Lurker', 'Anchor'],
  },
  {
    key: 'maps',
    label: 'Lieblingsmaps',
    art: 'mehrfachauswahl',
    maxAnzahl: 3,
    optionen: ['Mirage', 'Inferno', 'Nuke', 'Overpass', 'Ancient', 'Anubis', 'Vertigo', 'Dust II', 'Train'],
  },
  {
    key: 'modus',
    label: 'Bevorzugter Modus',
    art: 'auswahl',
    optionen: ['Premier', 'Competitive', 'Wingman', 'FACEIT', 'Casual'],
  },
]);

const VALORANT = felder('Valorant', [
  {
    key: 'rang',
    label: 'Aktueller Rang',
    art: 'auswahl',
    hervorgehoben: true,
    optionen: ['Iron', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Ascendant', 'Immortal', 'Radiant'],
  },
  {
    key: 'rolle',
    label: 'Bevorzugte Rolle',
    art: 'auswahl',
    optionen: ['Duelist', 'Initiator', 'Controller', 'Sentinel'],
    hervorgehoben: true,
  },
  {
    key: 'agents',
    label: 'Main Agents',
    art: 'mehrfachauswahl',
    maxAnzahl: 3,
    optionen: [
      'Jett',
      'Reyna',
      'Raze',
      'Phoenix',
      'Yoru',
      'Neon',
      'Iso',
      'Sova',
      'Breach',
      'Skye',
      'KAY/O',
      'Fade',
      'Gekko',
      'Brimstone',
      'Omen',
      'Viper',
      'Astra',
      'Harbor',
      'Clove',
      'Killjoy',
      'Cypher',
      'Sage',
      'Chamber',
      'Deadlock',
      'Vyse',
    ],
  },
]);

const LOL = felder('League of Legends', [
  {
    key: 'rang',
    label: 'Rang',
    art: 'auswahl',
    hervorgehoben: true,
    optionen: [
      'Iron',
      'Bronze',
      'Silver',
      'Gold',
      'Platinum',
      'Emerald',
      'Diamond',
      'Master',
      'Grandmaster',
      'Challenger',
    ],
  },
  {
    key: 'positionen',
    label: 'Bevorzugte Positionen',
    art: 'mehrfachauswahl',
    maxAnzahl: 2,
    optionen: ['Top', 'Jungle', 'Mid', 'Bot', 'Support'],
    hervorgehoben: true,
  },
  {
    key: 'champions',
    label: 'Main Champions',
    art: 'text',
    maxLaenge: 60,
    hilfe: 'Bis zu drei, mit Komma getrennt.',
  },
]);

const ROCKET_LEAGUE = felder('Rocket League', [
  {
    key: 'rang',
    label: 'Rang',
    art: 'auswahl',
    hervorgehoben: true,
    optionen: [
      'Bronze',
      'Silver',
      'Gold',
      'Platinum',
      'Diamond',
      'Champion',
      'Grand Champion',
      'Supersonic Legend',
    ],
  },
  {
    key: 'modus',
    label: 'Bevorzugter Modus',
    art: 'auswahl',
    optionen: ['1v1', '2v2', '3v3', 'Hoops', 'Rumble', 'Dropshot', 'Snow Day'],
    hervorgehoben: true,
  },
]);

const MINECRAFT = felder('Minecraft', [
  {
    key: 'edition',
    label: 'Edition',
    art: 'auswahl',
    optionen: ['Java', 'Bedrock', 'Beides'],
    hervorgehoben: true,
  },
  {
    key: 'stil',
    label: 'Spielstil',
    art: 'auswahl',
    optionen: ['Survival', 'Creative', 'Redstone', 'Building', 'PvP', 'Speedrun'],
    hervorgehoben: true,
  },
  {
    key: 'modi',
    label: 'Lieblingsmodi',
    art: 'mehrfachauswahl',
    maxAnzahl: 3,
    optionen: ['Vanilla', 'Modpacks', 'SkyBlock', 'Bedwars', 'Hardcore', 'Minigames'],
  },
]);

/** Alle Spiele mit eigenen Feldern, nach Schluessel. */
const SPIELFELDER = new Map<string, Spielfelder>(
  [CS2, VALORANT, LOL, ROCKET_LEAGUE, MINECRAFT].map((eintrag) => [eintrag.schluessel, eintrag]),
);

/**
 * Die Felder zu einem Spielnamen - oder eine leere Liste.
 *
 * Leer ist kein Fehler: die meisten Spiele im Katalog haben keine eigenen
 * Felder, und ein Profil dazu besteht dann aus Plattform, Notiz und Cover.
 */
export function felderFuer(spielName: string): readonly Feld[] {
  return SPIELFELDER.get(spielSchluessel(spielName))?.felder ?? [];
}

export function hatSpielfelder(spielName: string): boolean {
  return felderFuer(spielName).length > 0;
}

/**
 * Ein Zod-Schema fuer die Felder eines Spiels.
 *
 * Erzeugt aus der Registry, nicht daneben geschrieben: eine zweite Fassung
 * der Regeln waere die Stelle, an der Formular und Pruefung auseinanderlaufen.
 * Jedes Feld ist optional - ein Profil ohne Angaben ist ein gueltiges Profil.
 */
export function schemaFuer(spielName: string): z.ZodType<Record<string, unknown>> {
  const liste = felderFuer(spielName);
  if (liste.length === 0) {
    // Ein Spiel ohne Registry-Eintrag bekommt keine Felder - und damit auch
    // keine, die jemand von Hand in die Anfrage schreiben koennte.
    return z.object({}).strict();
  }

  const form: Record<string, z.ZodTypeAny> = {};
  for (const feld of liste) {
    if (feld.art === 'text') {
      form[feld.key] = z
        .string()
        .trim()
        .max(feld.maxLaenge ?? 40)
        .optional();
    } else if (feld.art === 'auswahl') {
      form[feld.key] = z.enum(feld.optionen as [string, ...string[]]).optional();
    } else {
      form[feld.key] = z
        .array(z.enum(feld.optionen as [string, ...string[]]))
        .max(feld.maxAnzahl ?? 5)
        .optional();
    }
  }

  /*
   * `strict()`: ein Feld, das die Registry nicht kennt, wird zurueckgewiesen
   * statt stillschweigend mitgespeichert. Sonst waere die JSON-Spalte doch
   * wieder offen - nur mit einem Schema davor, das wegsieht.
   */
  return z.object(form).strict();
}

/**
 * Gespeicherte Felder zum Anzeigen aufbereiten.
 *
 * Was die Registry heute nicht mehr kennt, faellt still weg. Der umgekehrte
 * Weg - anzeigen, was dasteht - hiesse, ein entferntes Feld noch Monate
 * spaeter im Profil zu haben, und ein umbenanntes mit dem alten Namen.
 */
export interface AngezeigtesFeld {
  key: string;
  label: string;
  wert: string;
  hervorgehoben: boolean;
}

export function zeigeFelder(spielName: string, gespeichert: unknown): AngezeigtesFeld[] {
  if (typeof gespeichert !== 'object' || gespeichert === null) {
    return [];
  }
  const daten = gespeichert as Record<string, unknown>;

  const ausgabe: AngezeigtesFeld[] = [];
  for (const feld of felderFuer(spielName)) {
    const roh = daten[feld.key];
    if (roh === undefined || roh === null || roh === '') {
      continue;
    }
    const wert = Array.isArray(roh) ? roh.filter((x) => typeof x === 'string').join(', ') : String(roh);
    if (wert.length === 0) {
      continue;
    }
    ausgabe.push({
      key: feld.key,
      label: feld.label,
      wert,
      hervorgehoben: feld.hervorgehoben === true,
    });
  }
  return ausgabe;
}
