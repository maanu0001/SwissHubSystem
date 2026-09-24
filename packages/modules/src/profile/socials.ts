import { z } from 'zod';

/**
 * Konten auf anderen Plattformen.
 *
 * ## Die eine Regel, auf der alles beruht
 *
 * **Gespeichert wird eine Kennung, nie eine Adresse.** Die Adresse baut diese
 * Datei daraus. Wer eine vollstaendige Adresse eintippen koennte, koennte
 * darin etwas anderes eintippen - `javascript:`, eine fremde Domain, eine
 * Weiterleitung. Aus «nvidia» kann hier nur `twitch.tv/nvidia` werden.
 *
 * Deshalb pruefen die Muster unten nicht «ist das eine gueltige URL», sondern
 * «ist das ein Benutzername dieser Plattform». Das ist enger und genau
 * deshalb sicher.
 *
 * ## Selbst angegeben ist nicht verifiziert
 *
 * Niemand weist hier nach, dass ihm ein Konto gehoert. Die Anzeige sagt das
 * auch: `verified` ist heute immer `false`, und ein Haken erscheint nur, wo
 * er tatsaechlich etwas bedeutet. Ein eingetippter Name als «verknuepftes
 * Konto» auszugeben waere eine Behauptung, die niemand geprueft hat.
 */

export interface SocialPlattform {
  key: string;
  label: string;
  /** Was in der Eingabe steht - «Benutzername», «Steam-ID», «Riot ID». */
  eingabeLabel: string;
  platzhalter: string;
  /**
   * Was als Kennung durchgeht.
   *
   * Bewusst je Plattform und nicht einmal fuer alle: Steam erlaubt andere
   * Zeichen als Riot, und ein gemeinsames «alles ausser boesem» waere
   * entweder zu eng oder wertlos.
   */
  muster: RegExp;
  maxLaenge: number;
  /** Baut die oeffentliche Adresse - oder `null`, wenn es keine gibt. */
  adresse: (handle: string) => string | null;
  /** Kurzer Hinweis im Editor. */
  hilfe?: string;
}

const PLATTFORMEN: readonly SocialPlattform[] = [
  {
    key: 'twitch',
    label: 'Twitch',
    eingabeLabel: 'Kanalname',
    platzhalter: 'swisshub',
    muster: /^[A-Za-z0-9_]{3,25}$/u,
    maxLaenge: 25,
    adresse: (h) => `https://twitch.tv/${h}`,
  },
  {
    key: 'youtube',
    label: 'YouTube',
    eingabeLabel: 'Handle',
    platzhalter: '@swisshub',
    muster: /^@?[A-Za-z0-9._-]{3,30}$/u,
    maxLaenge: 31,
    adresse: (h) => `https://youtube.com/${h.startsWith('@') ? h : `@${h}`}`,
    hilfe: 'Der Handle, der mit @ beginnt - nicht die Kanal-ID.',
  },
  {
    key: 'steam',
    label: 'Steam',
    eingabeLabel: 'Profilname oder ID',
    platzhalter: '76561198000000000',
    muster: /^[A-Za-z0-9_-]{2,32}$/u,
    maxLaenge: 32,
    /*
     * Eine 17-stellige Zahl ist eine SteamID64 und gehoert hinter `/profiles/`;
     * alles andere ist eine Vanity-URL und gehoert hinter `/id/`. Beides unter
     * denselben Pfad zu stellen fuehrte bei einem der beiden ins Leere.
     */
    adresse: (h) =>
      /^\d{17}$/u.test(h) ? `https://steamcommunity.com/profiles/${h}` : `https://steamcommunity.com/id/${h}`,
  },
  {
    key: 'faceit',
    label: 'FACEIT',
    eingabeLabel: 'Nickname',
    platzhalter: 'swisshub',
    muster: /^[A-Za-z0-9._-]{3,24}$/u,
    maxLaenge: 24,
    adresse: (h) => `https://www.faceit.com/en/players/${h}`,
  },
  {
    key: 'riot',
    label: 'Riot ID',
    eingabeLabel: 'Riot ID',
    platzhalter: 'Name#TAG',
    muster: /^[^\s#]{3,16}#[A-Za-z0-9]{2,5}$/u,
    maxLaenge: 22,
    // Riot hat keine oeffentliche Profilseite zu einer Riot ID. Ein Link auf
    // einen Drittanbieter waere eine Empfehlung, die niemand ausgesprochen hat.
    adresse: () => null,
    hilfe: 'Name und Tag, z.B. Spieler#EUW1. Es entsteht kein Link - Riot hat keine öffentliche Profilseite.',
  },
  {
    key: 'epic',
    label: 'Epic Games',
    eingabeLabel: 'Anzeigename',
    platzhalter: 'swisshub',
    muster: /^[A-Za-z0-9._ -]{3,32}$/u,
    maxLaenge: 32,
    adresse: () => null,
  },
  {
    key: 'battlenet',
    label: 'Battle.net',
    eingabeLabel: 'BattleTag',
    platzhalter: 'Name#1234',
    muster: /^[^\s#]{3,12}#\d{4,6}$/u,
    maxLaenge: 19,
    adresse: () => null,
  },
  {
    key: 'xbox',
    label: 'Xbox',
    eingabeLabel: 'Gamertag',
    platzhalter: 'SwissHub',
    muster: /^[A-Za-z0-9 ]{3,15}$/u,
    maxLaenge: 15,
    adresse: () => null,
  },
  {
    key: 'psn',
    label: 'PlayStation',
    eingabeLabel: 'PSN-ID',
    platzhalter: 'swisshub',
    muster: /^[A-Za-z0-9_-]{3,16}$/u,
    maxLaenge: 16,
    adresse: () => null,
  },
  {
    key: 'nintendo',
    label: 'Nintendo',
    eingabeLabel: 'Freundescode',
    platzhalter: 'SW-1234-5678-9012',
    muster: /^SW-\d{4}-\d{4}-\d{4}$/u,
    maxLaenge: 17,
    adresse: () => null,
  },
];

const NACH_KEY = new Map(PLATTFORMEN.map((p) => [p.key, p]));

export function alleSocialPlattformen(): readonly SocialPlattform[] {
  return PLATTFORMEN;
}

export function socialPlattform(key: string): SocialPlattform | undefined {
  return NACH_KEY.get(key);
}

/** Die erlaubten Schluessel - als Zod-Aufzaehlung fuer Eingabepruefungen. */
export const socialPlattformSchema = z.enum(PLATTFORMEN.map((p) => p.key) as [string, ...string[]]);

/**
 * Eine Eingabe pruefen und normalisieren.
 *
 * Gibt `null` zurueck, wenn die Plattform unbekannt ist oder die Kennung
 * nicht zu ihr passt. Der Aufrufer entscheidet, ob das ein Fehler ist oder
 * ein leeres Feld.
 */
export function pruefeHandle(plattform: string, roh: string): string | null {
  const definition = NACH_KEY.get(plattform);
  if (!definition) {
    return null;
  }
  const handle = roh.trim();
  if (handle.length === 0 || handle.length > definition.maxLaenge) {
    return null;
  }
  return definition.muster.test(handle) ? handle : null;
}

export interface SocialAnzeige {
  plattform: string;
  label: string;
  handle: string;
  /** `null`, wenn die Plattform keine oeffentliche Profilseite hat. */
  adresse: string | null;
  verifiziert: boolean;
}

/**
 * Eine gespeicherte Angabe zum Anzeigen aufbereiten.
 *
 * Noch einmal geprueft, obwohl beim Schreiben schon geprueft wurde: die
 * Spalte ist aelter als der naechste Stand des Codes, und was hier
 * herauskommt, landet in einem `href`.
 */
export function zeigeSocial(plattform: string, handle: string, verifiziert: boolean): SocialAnzeige | null {
  const definition = NACH_KEY.get(plattform);
  if (!definition) {
    return null;
  }
  const geprueft = pruefeHandle(plattform, handle);
  if (!geprueft) {
    return null;
  }

  const adresse = definition.adresse(geprueft);
  return {
    plattform: definition.key,
    label: definition.label,
    handle: geprueft,
    // Der Gürtel zum Hosenträger: selbst wenn die Registry je etwas anderes
    // baute, geht nur eine https-Adresse hinaus.
    adresse: adresse && adresse.startsWith('https://') ? adresse : null,
    verifiziert,
  };
}
