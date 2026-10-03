/**
 * Welche Ereignisse eines Projekts in seinen Discord-Kanal gehen.
 *
 * ## Warum eine Liste und keine zwoelf Schalter in der Tabelle
 *
 * Weil ein dreizehntes Ereignis sonst eine Migration braeuchte. Hier steht
 * der Katalog, in der Projektzeile stehen die gewaehlten Schluessel. Ein
 * Schluessel, den dieser Katalog nicht kennt, wird beim Lesen verworfen - ein
 * zurueckgebautes Ereignis ist damit kein Fehlerfall, sondern eine Zeile
 * weniger.
 *
 * ## Warum nicht jedes Ereignis zur Vorgabe gehoert
 *
 * Ein Kanal, der bei jedem Kommentar und jeder verschobenen Frist piept, wird
 * stummgeschaltet - und dann kommt auch das Wichtige nicht mehr an. Die
 * Vorgabe sind die drei Dinge, die man ohne das Board wissen will: eine neue
 * Aufgabe, eine erledigte, eine blockierte. Alles Weitere schaltet das Team
 * selbst dazu.
 *
 * ## Warum Farben je Ereignis
 *
 * Damit man im Kanal am Rand sieht, worum es geht, bevor man liest. Es sind
 * bewusst wenige und gedeckte: das Rot des Hauses fuer den Normalfall, Gruen
 * fuer Erledigtes, Gelb fuer Blockiertes, Grau fuer Organisatorisches. Kein
 * Farbkreis, der aussieht wie eine Statusampel, die es nicht gibt.
 */

/** Das Rot des Hauses - wie in jedem anderen Embed. */
const ROT = 0xe02630;
const GRUEN = 0x3ba55d;
const GELB = 0xe5a50a;
const GRAU = 0x6b7280;

export interface Ereignisart {
  key: string;
  label: string;
  /** Wozu es gehoert - nur fuer die Gruppierung in der Oberflaeche. */
  gruppe: 'Aufgaben' | 'Fristen' | 'Projekt';
  farbe: number;
  /** Teil der Vorgabe fuer ein neues Projekt? */
  vorgabe: boolean;
}

export const WORKSPACE_EREIGNISSE: readonly Ereignisart[] = [
  { key: 'task.created', label: 'Aufgabe erstellt', gruppe: 'Aufgaben', farbe: ROT, vorgabe: true },
  { key: 'task.assigned', label: 'Aufgabe zugeteilt', gruppe: 'Aufgaben', farbe: ROT, vorgabe: false },
  {
    key: 'task.started',
    label: 'Aufgabe in Arbeit',
    gruppe: 'Aufgaben',
    farbe: GRAU,
    vorgabe: false,
  },
  { key: 'task.blocked', label: 'Aufgabe blockiert', gruppe: 'Aufgaben', farbe: GELB, vorgabe: true },
  { key: 'task.done', label: 'Aufgabe abgeschlossen', gruppe: 'Aufgaben', farbe: GRUEN, vorgabe: true },
  {
    key: 'task.reopened',
    label: 'Aufgabe wieder geöffnet',
    gruppe: 'Aufgaben',
    farbe: GELB,
    vorgabe: false,
  },
  { key: 'task.comment', label: 'Kommentar hinzugefügt', gruppe: 'Aufgaben', farbe: GRAU, vorgabe: false },
  { key: 'due.set', label: 'Frist gesetzt', gruppe: 'Fristen', farbe: GRAU, vorgabe: false },
  { key: 'due.changed', label: 'Frist geändert', gruppe: 'Fristen', farbe: GRAU, vorgabe: false },
  { key: 'due.cleared', label: 'Frist entfernt', gruppe: 'Fristen', farbe: GRAU, vorgabe: false },
  {
    key: 'milestone.done',
    label: 'Meilenstein erreicht',
    gruppe: 'Projekt',
    farbe: GRUEN,
    vorgabe: true,
  },
  { key: 'project.status', label: 'Projektstatus geändert', gruppe: 'Projekt', farbe: GRAU, vorgabe: false },
  { key: 'project.done', label: 'Projekt abgeschlossen', gruppe: 'Projekt', farbe: GRUEN, vorgabe: true },
] as const;

export type EreignisSchluessel = (typeof WORKSPACE_EREIGNISSE)[number]['key'];

const NACH_SCHLUESSEL = new Map(WORKSPACE_EREIGNISSE.map((eintrag) => [eintrag.key, eintrag]));

/** Kennt der Katalog diesen Schluessel? */
export function istEreignis(wert: string): boolean {
  return NACH_SCHLUESSEL.has(wert);
}

export function ereignisart(key: string): Ereignisart | null {
  return NACH_SCHLUESSEL.get(key) ?? null;
}

/** Die Vorgabe fuer ein neues Projekt. */
export function vorgabeEreignisse(): string[] {
  return WORKSPACE_EREIGNISSE.filter((eintrag) => eintrag.vorgabe).map((eintrag) => eintrag.key);
}

/**
 * Macht aus einer Eingabe eine saubere Auswahl.
 *
 * Unbekanntes fliegt raus, Dubletten auch, und die Reihenfolge ist die des
 * Katalogs - so sieht die gespeicherte Liste immer gleich aus, egal in
 * welcher Reihenfolge die Haken gesetzt wurden.
 */
export function sortiereEreignisse(werte: readonly string[]): string[] {
  const gewaehlt = new Set(werte);
  return WORKSPACE_EREIGNISSE.filter((eintrag) => gewaehlt.has(eintrag.key)).map((eintrag) => eintrag.key);
}
