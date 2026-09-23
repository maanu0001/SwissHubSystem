import { formatSwissNumber } from '@swisshub/shared';
import type { WrappedDaten } from './daten';

/**
 * Texte mit Platzhaltern - und sonst nichts.
 *
 * ## Warum nicht einfach eine Template-Sprache
 *
 * Weil das Studio diese Texte bearbeitbar macht. Alles, was dort eingegeben
 * werden kann, landet spaeter auf dem Bildschirm eines Mitglieds. Eine
 * Sprache mit Ausdruecken waere damit eine Sprache, die jemand mit
 * Bearbeitungsrecht ausfuehren darf - und «nur das Team hat das Recht» ist
 * kein Sicherheitskonzept, sondern eine Hoffnung.
 *
 * Deshalb: **eine Erlaubnisliste von Platzhaltern.** `{{voiceHours}}` wird
 * ersetzt. Alles andere bleibt stehen, wie es dasteht - auch `{{beliebig}}`,
 * das faellt beim Korrekturlesen auf. Kein `eval`, keine Bedingungen, keine
 * Schleifen, keine Funktionsaufrufe, kein HTML.
 *
 * Das Ergebnis ist ein reiner Text und wird von React als solcher gerendert -
 * also ohnehin maskiert.
 */

export type PlatzhalterWerte = Record<string, string>;

/**
 * Die erlaubten Platzhalter.
 *
 * Bewusst knapp: jeder einzelne ist eine Zusage darueber, was ein Text
 * enthalten darf. Nichts davon ist personenbezogen ueber die Person hinaus,
 * die den Rueckblick sieht - fremde Namen kommen hier nicht vor.
 */
export const PLATZHALTER = [
  { key: 'displayName', label: 'Anzeigename', beispiel: 'Manuel' },
  { key: 'year', label: 'Jahr', beispiel: '2026' },
  { key: 'voiceHours', label: 'Sprachstunden', beispiel: '187' },
  { key: 'voiceChannel', label: 'Lieblingskanal', beispiel: 'Gaming 1' },
  { key: 'messageCount', label: 'Nachrichten', beispiel: "4'821" },
  { key: 'activeDays', label: 'Aktive Tage', beispiel: '286' },
  { key: 'level', label: 'Level am Ende', beispiel: '38' },
  { key: 'clipWins', label: 'Clip-Siege', beispiel: '2' },
  { key: 'topGame', label: 'Häufigstes Spiel', beispiel: 'Counter-Strike 2' },
  { key: 'primeTime', label: 'Prime Time', beispiel: '22:00' },
  { key: 'archetype', label: 'Typ', beispiel: 'The Voice Resident' },
] as const;

export type PlatzhalterKey = (typeof PLATZHALTER)[number]['key'];

export const PLATZHALTER_KEYS: ReadonlySet<string> = new Set(PLATZHALTER.map((eintrag) => eintrag.key));

/** Die Stunde mit der meisten Sprachzeit - Grundlage der Prime Time. */
export function primeTimeStunde(hours: number[]): number | null {
  let beste = -1;
  let index: number | null = null;
  hours.forEach((wert, position) => {
    if (wert > beste) {
      beste = wert;
      index = position;
    }
  });
  return beste > 0 ? index : null;
}

/** Die Werte, mit denen ein Text gefuellt wird. */
export function platzhalterWerte(daten: WrappedDaten, archetypLabel: string): PlatzhalterWerte {
  const stunde = primeTimeStunde(daten.voice.hours);
  return {
    displayName: daten.person.displayName ?? daten.person.username ?? 'Du',
    year: String(daten.period.year),
    voiceHours: formatSwissNumber(Math.round(daten.voice.seconds / 3600)),
    voiceChannel: daten.voice.topChannels[0]?.name ?? '—',
    messageCount: formatSwissNumber(daten.messages.total),
    activeDays: formatSwissNumber(daten.aktivitaet.activeDays),
    level: String(daten.level?.levelEnd ?? 0),
    clipWins: String(daten.clips.wins),
    topGame: daten.spiele.top[0]?.name ?? '—',
    primeTime: stunde === null ? '—' : `${String(stunde).padStart(2, '0')}:00`,
    archetype: archetypLabel,
  };
}

/**
 * Einen Text fuellen.
 *
 * Ersetzt wird genau `{{name}}` mit einem Namen aus der Erlaubnisliste.
 * Leerzeichen innerhalb der Klammern sind erlaubt - `{{ year }}` ist
 * dasselbe wie `{{year}}`, weil beim Tippen ohnehin beides entsteht.
 */
export function fuelleVorlage(text: string, werte: PlatzhalterWerte): string {
  return text.replace(/\{\{\s*([A-Za-z]+)\s*\}\}/gu, (ganzes, name: string) =>
    PLATZHALTER_KEYS.has(name) ? (werte[name] ?? ganzes) : ganzes,
  );
}

export interface VorlagenPruefung {
  gueltig: boolean;
  /** Platzhalter, die es nicht gibt - eine Warnung, kein Fehler. */
  unbekannt: string[];
  fehler: string[];
}

/**
 * Einen eingegebenen Text pruefen, bevor er gespeichert wird.
 *
 * Abgelehnt wird, was nach Auszeichnung aussieht: spitze Klammern koennten
 * in einer spaeteren Fassung als HTML gelesen werden, und ein Text, der
 * heute harmlos gerendert wird, soll nicht darauf angewiesen sein.
 * Unbekannte Platzhalter werden gemeldet, aber nicht abgelehnt - ein Tippfehler
 * ist eine Sache fuers Korrekturlesen, keine fuer eine Fehlermeldung.
 */
export function pruefeVorlage(text: string, maxLaenge = 280): VorlagenPruefung {
  const fehler: string[] = [];

  if (text.length > maxLaenge) {
    fehler.push(`Höchstens ${maxLaenge} Zeichen.`);
  }
  if (/[<>]/u.test(text)) {
    fehler.push('Spitze Klammern sind nicht erlaubt.');
  }
  if (/\{\{\s*[^}]*[^A-Za-z\s}][^}]*\}\}/u.test(text)) {
    fehler.push('Platzhalter dürfen nur aus Buchstaben bestehen.');
  }

  const unbekannt = [...text.matchAll(/\{\{\s*([A-Za-z]+)\s*\}\}/gu)]
    .map((treffer) => treffer[1]!)
    .filter((name) => !PLATZHALTER_KEYS.has(name));

  return { gueltig: fehler.length === 0, unbekannt: [...new Set(unbekannt)], fehler };
}
