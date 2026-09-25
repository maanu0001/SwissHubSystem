import type { backup } from '@swisshub/modules';

/**
 * Wie Backup-Zahlen und -Zeiten dargestellt werden.
 *
 * Getrennt von den Seiten, weil dieselben Formate an sechs Stellen vorkommen -
 * und weil eine Formatierung, die nur im JSX steht, beim naechsten Mal
 * geringfuegig anders aussieht.
 */

/** Bytes lesbar. `null` und 0 werden unterschieden: 0 ist eine Aussage. */
export function bytesLesbar(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) {
    return '–';
  }
  if (bytes === 0) {
    return '0 B';
  }
  const einheiten = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let wert = bytes;
  let index = 0;
  while (wert >= 1024 && index < einheiten.length - 1) {
    wert /= 1024;
    index += 1;
  }
  return `${wert.toFixed(wert < 10 && index > 0 ? 1 : 0)} ${einheiten[index]}`;
}

/** Eine Dauer in Sekunden als «4 min 12 s». */
export function dauerLesbar(sekunden: number | null | undefined): string {
  if (sekunden === null || sekunden === undefined || Number.isNaN(sekunden)) {
    return '–';
  }
  if (sekunden < 60) {
    return `${Math.round(sekunden)} s`;
  }
  const minuten = Math.floor(sekunden / 60);
  if (minuten < 60) {
    const rest = Math.round(sekunden % 60);
    return rest === 0 ? `${minuten} min` : `${minuten} min ${rest} s`;
  }
  const stunden = Math.floor(minuten / 60);
  return `${stunden} h ${minuten % 60} min`;
}

/**
 * Wie lange her.
 *
 * Bei einer Sicherung ist «vor 4 Stunden» die Auskunft, auf die es ankommt -
 * nicht der Zeitstempel. Der steht daneben, weil man ihn fuer eine
 * Wiederherstellung braucht.
 */
export function vorWieLange(zeit: string | Date | null | undefined): string {
  if (!zeit) {
    return 'nie';
  }
  const wert = typeof zeit === 'string' ? new Date(zeit) : zeit;
  if (Number.isNaN(wert.getTime())) {
    return 'unbekannt';
  }
  const sekunden = Math.floor((Date.now() - wert.getTime()) / 1000);
  if (sekunden < 0) {
    return 'in der Zukunft';
  }
  if (sekunden < 90) {
    return 'gerade eben';
  }
  if (sekunden < 3600) {
    return `vor ${Math.floor(sekunden / 60)} min`;
  }
  if (sekunden < 86_400) {
    const stunden = Math.floor(sekunden / 3600);
    return `vor ${stunden} ${stunden === 1 ? 'Stunde' : 'Stunden'}`;
  }
  const tage = Math.floor(sekunden / 86_400);
  return `vor ${tage} ${tage === 1 ? 'Tag' : 'Tagen'}`;
}

/** Ein Zeitpunkt in Schweizer Schreibweise, mit Sekunden. */
export function zeitLesbar(zeit: string | Date | null | undefined): string {
  if (!zeit) {
    return '–';
  }
  const wert = typeof zeit === 'string' ? new Date(zeit) : zeit;
  if (Number.isNaN(wert.getTime())) {
    return String(zeit);
  }
  return wert.toLocaleString('de-CH', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * Der Zeitpunkt in der Form, die `swisshub-recovery --zeit` versteht.
 *
 * Bewusst genau diese Form: sie wird im Recovery Center zum Kopieren
 * angezeigt, und wer sie abschreibt, soll keinen Fehler machen koennen. Das
 * Muster in `ZEITPUNKT_MUSTER` laesst genau sie zu.
 */
export function zeitFuerBefehl(zeit: string | Date | null | undefined): string {
  if (!zeit) {
    return '';
  }
  const wert = typeof zeit === 'string' ? new Date(zeit) : zeit;
  if (Number.isNaN(wert.getTime())) {
    return '';
  }
  const zweistellig = (zahl: number): string => String(zahl).padStart(2, '0');
  const versatzMinuten = -wert.getTimezoneOffset();
  const vorzeichen = versatzMinuten >= 0 ? '+' : '-';
  const versatz = Math.abs(versatzMinuten);
  return (
    `${wert.getFullYear()}-${zweistellig(wert.getMonth() + 1)}-${zweistellig(wert.getDate())} ` +
    `${zweistellig(wert.getHours())}:${zweistellig(wert.getMinutes())}:${zweistellig(wert.getSeconds())}` +
    `${vorzeichen}${zweistellig(Math.floor(versatz / 60))}:${zweistellig(versatz % 60)}`
  );
}

/** Beschriftungen der Lauf-Arten. */
export const LAUF_LABEL: Record<string, string> = {
  'db-full': 'Datenbank, vollständig',
  'db-diff': 'Datenbank, differentiell',
  'db-incr': 'Datenbank, inkrementell',
  'db-logisch': 'Datenbank, logischer Export',
  einrichten: 'Einrichtung',
  dateien: 'Uploads',
  konfiguration: 'Konfiguration',
  geheimnisse: 'Wiederherstellungspaket',
  extern: 'Externe Übertragung',
  aufraeumen: 'Aufbewahrung',
  wal: 'WAL-Archivierung',
  verify: 'Prüfung (Stufen 1–4)',
  'restore-test': 'Restore-Test (Stufen 5–6)',
};

export function laufLabel(art: string): string {
  return LAUF_LABEL[art] ?? art;
}

/** Was ein backup.Wiederherstellungspunkt schützt. */
export const ART_LABEL: Record<string, string> = {
  datenbank: 'Datenbank',
  dateien: 'Uploads',
  konfiguration: 'Konfiguration',
  schluessel: 'Wiederherstellungspaket',
};

export function artLabel(art: string): string {
  return ART_LABEL[art] ?? art;
}

/**
 * Wie eine Sicherung im Repository steht - und ob sie den Serververlust
 * überlebt.
 *
 * Der Unterschied ist der wichtigste in der ganzen Übersicht: ein Punkt, der
 * nur in Repository 1 liegt, liegt auf demselben Rechner, der gesichert wird.
 */
export function repoLabel(repo: number | null | undefined): { text: string; extern: boolean } {
  if (repo === 2) {
    return { text: 'lokal und extern', extern: true };
  }
  return { text: 'nur lokal', extern: false };
}

/**
 * Das gemessene RPO in Worten.
 *
 * Ausdrücklich «gemessen» und nie «garantiert»: der Wert kommt aus dem letzten
 * Restore-Test beziehungsweise aus dem Abstand der WAL-Archivierung. Eine
 * Zusage wäre er erst, wenn sie jemand geprüft hätte - und genau das tut der
 * Restore-Test, für genau diesen einen Zeitpunkt.
 */
export function rpoLesbar(sekunden: number | null | undefined): string {
  if (sekunden === null || sekunden === undefined) {
    return 'nicht gemessen';
  }
  if (sekunden < 0) {
    return 'unbekannt';
  }
  if (sekunden < 120) {
    return `${sekunden} s`;
  }
  if (sekunden < 7200) {
    return `${Math.round(sekunden / 60)} min`;
  }
  return `${(sekunden / 3600).toFixed(1)} h`;
}

/** Der jüngste erfolgreiche Lauf einer Art. */
export function letzterErfolg(laeufe: backup.BackupLauf[], arten: string[]): backup.BackupLauf | null {
  return laeufe.find((lauf) => lauf.status === 'erfolg' && arten.includes(lauf.art)) ?? null;
}

/** Der jüngste fehlgeschlagene Lauf, gleich welcher Art. */
export function letzterFehlschlag(laeufe: backup.BackupLauf[]): backup.BackupLauf | null {
  return laeufe.find((lauf) => lauf.status === 'fehler') ?? null;
}

/**
 * Die backup.Wiederherstellungspunkte, die ein Administrator wirklich auswählen kann.
 *
 * Inkrementelle Punkte ohne ihren Vorgänger sind unbrauchbar, und ein Punkt in
 * einem Repository, das nicht erreichbar ist, ebenso. Gefiltert wird hier
 * nicht - angezeigt wird alles, mit dem Zustand daneben. Wer auswählt, soll
 * sehen, was es gibt, und nicht eine bereinigte Liste, die eine Entscheidung
 * schon getroffen hat.
 */
export function nachArt(
  punkte: backup.Wiederherstellungspunkt[],
): Record<string, backup.Wiederherstellungspunkt[]> {
  const ergebnis: Record<string, backup.Wiederherstellungspunkt[]> = {};
  for (const punkt of punkte) {
    (ergebnis[punkt.art] ??= []).push(punkt);
  }
  return ergebnis;
}
