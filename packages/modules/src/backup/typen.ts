/**
 * Die Formen, in denen die Backup-Anlage ihren Zustand ablegt.
 *
 * Sie entsprechen genau den JSON-Dateien unter
 * `/var/lib/swisshub-backup/state/`, die `deploy/backup/bin/*` schreiben. Die
 * WebApp liest sie und schreibt sie nie.
 *
 * WARUM DER ZUSTAND IN DATEIEN LIEGT UND NICHT IN DIESER DATENBANK
 *
 * Der Ernstfall ist der, in dem die Datenbank kaputt ist. Das ist der Moment,
 * in dem jemand wissen muss, welche Sicherungen es gibt und bis wohin sie
 * zurueckreichen. Eine Backup-Uebersicht, die dafuer die Datenbank braeuchte,
 * antwortete genau dann nicht, wenn man sie braucht.
 *
 * Jedes Feld ist deshalb optional: die Dateien werden von aussen geschrieben,
 * und eine fehlende oder alte Datei ist ein normaler Zustand, den die
 * Oberflaeche zeigen koennen muss - nicht ein Fehler, der sie abstuerzen
 * laesst.
 */

/** Ein einzelner Lauf, wie ihn `laeufe.jsonl` festhaelt. */
export interface BackupLauf {
  id: string;
  /** `db-full`, `db-diff`, `db-incr`, `dateien`, `konfiguration`, `extern`, `verify`, `restore-test`, ... */
  art: string;
  status: 'erfolg' | 'fehler' | 'uebersprungen' | (string & {});
  beginn: string;
  dauer_s: number;
  bytes: number;
  ziel: string;
  meldung: string;
}

/** Ein Wiederherstellungspunkt - Datenbank, Dateien, Konfiguration oder Schluessel. */
export interface Wiederherstellungspunkt {
  art: 'datenbank' | 'dateien' | 'konfiguration' | 'schluessel' | (string & {});
  /** Bei der Datenbank `full`/`diff`/`incr`, bei Restic `snapshot`. */
  typ: string | null;
  kennung: string | null;
  beginn: string | null;
  ende: string | null;
  /** Was er im Repository belegt. */
  bytes: number | null;
  /** Bei der Datenbank: die Groesse der Datenbank selbst. */
  bytes_datenbank?: number | null;
  wal_von?: string | null;
  wal_bis?: string | null;
  /**
   * Der Datenbankzeitpunkt, zu dem eine Dateisicherung gehoert.
   *
   * Damit laesst sich ein zusammenpassendes Paar waehlen statt zweimal
   * unabhaengig zu raten - siehe `passendeDateisicherung`.
   */
  db_zeitpunkt?: string | null;
  pfade?: string[];
  /**
   * In welchem Repository er liegt. 1 = lokal, 2 = extern.
   *
   * Der Unterschied ist der wichtigste in der ganzen Liste: ein Punkt, der nur
   * in Repository 1 liegt, ueberlebt den Verlust des Servers nicht.
   */
  repo: number;
  postgres?: string | null;
  verschluesselt: boolean;
  /** Worauf ein inkrementeller Punkt aufbaut. Ohne den Vorgaenger unbrauchbar. */
  baut_auf?: string | null;
}

export interface WiederherstellungspunkteZustand {
  erhoben?: string;
  aeltester?: string | null;
  jungster?: string | null;
  wal_von?: string | null;
  wal_bis?: string | null;
  postgres?: string | null;
  anzahl?: number;
  punkte?: Wiederherstellungspunkt[];
  fehler?: string;
}

/** Der Zustand der WAL-Archivierung. Daran haengt der erreichbare RPO. */
export interface WalZustand {
  zeit?: string;
  archive_mode?: string;
  wal_level?: string;
  archiviert?: number;
  gescheitert?: number;
  letzte_wal?: string | null;
  letzte_zeit?: string | null;
  /** Wie alt die jungste archivierte WAL-Datei ist. Der gemessene RPO. */
  abstand_s?: number;
  letzter_fehler_wal?: string | null;
  letzter_fehler_zeit?: string | null;
}

export interface Befund {
  stufe?: number;
  name?: string;
  kennung?: string;
  ergebnis?: 'erfolg' | 'warnung' | 'fehler' | (string & {});
  text: string;
}

/** Das Ergebnis der Pruefstufen 1 bis 4. */
export interface VerifyZustand {
  zeit?: string;
  tief?: string;
  dauer_s?: number;
  gesamt?: 'erfolg' | 'warnung' | 'fehler' | (string & {});
  fehler?: number;
  warnungen?: number;
  befunde?: Befund[];
}

/** Das Ergebnis der Pruefstufen 5 und 6 - der einzige Nachweis, der zaehlt. */
export interface RestoreTestZustand {
  zeit?: string;
  ergebnis?: 'erfolg' | 'fehler' | (string & {});
  repo?: number;
  zielzeit?: string;
  dauer_restore_s?: number;
  dauer_gesamt_s?: number;
  /** Gemessen, nicht angestrebt. `null`, wenn nicht messbar. */
  gemessenes_rpo_s?: number | null;
  fehler?: number;
  pruefungen?: Array<{ name: string; ergebnis: string; text: string }>;
  hinweis?: string;
}

/**
 * Der Zustand der Schluesselsicherung.
 *
 * `master_key_kennung` sind die ersten acht Zeichen eines SHA-256 ueber den
 * Hauptschluessel - dieselbe Rechnung wie `keyId()` in
 * `packages/secrets/src/crypto.ts`. Damit laesst sich beantworten, ob der
 * GESICHERTE Schluessel derselbe ist, mit dem die Anwendung gerade
 * verschluesselt, OHNE dass irgendwo ein Schluesselwert erscheint.
 *
 * Genau das soll das Dashboard koennen: erkennen, ob die benoetigten
 * Schluessel gesichert sind, ohne ihre Werte zu zeigen.
 */
export interface GeheimnisseZustand {
  zeit?: string;
  paket?: string;
  bytes?: number;
  master_key_kennung?: string;
  empfaenger?: number;
  in_repository?: string;
  anleitung_enthalten?: boolean;
}

export interface ExternZustand {
  zeit?: string;
  ziel?: string;
  status?: 'erfolg' | 'fehler' | (string & {});
}

export interface MonitorZustand {
  zeit?: string;
  gesamt?: 'ok' | 'warnung' | 'kritisch' | (string & {});
  fehler?: number;
  warnungen?: number;
  befunde?: Array<{ stufe: string; kennung: string; text: string }>;
}

export interface LetzterLauf {
  id?: string;
  zeit?: string;
  dauer_s?: number;
  bytes?: number;
  meldung?: string;
}

export interface WiederherstellungZustand {
  zeit?: string;
  zielzeit?: string;
  repo?: number;
  dauer_datenbank_s?: number;
  dauer_gesamt_s?: number;
  validiert?: boolean;
  freigegeben?: boolean;
  freigegeben_am?: string;
}

/** Alles, was `swisshub-backup status` zusammenfasst. */
export interface BackupZustand {
  /** `false`, wenn das Zustandsverzeichnis nicht erreichbar ist. */
  erreichbar: boolean;
  /** Warum nicht - fuer eine verstaendliche Meldung in der Oberflaeche. */
  grund?: string;
  wiederherstellungspunkte?: WiederherstellungspunkteZustand;
  wal?: WalZustand;
  verify?: VerifyZustand;
  'restore-test'?: RestoreTestZustand;
  geheimnisse?: GeheimnisseZustand;
  'geheimnisse-geprueft'?: { zeit?: string; paket?: string; ergebnis?: string };
  extern?: ExternZustand;
  monitor?: MonitorZustand;
  dateien?: { zeit?: string; db_zeitpunkt?: string; snapshot?: string; kennzahlen?: Record<string, number> };
  'letzte-wiederherstellung'?: WiederherstellungZustand;
  'letzter-alarm'?: { zeit?: string; stufe?: string; kennung?: string; text?: string };
  laeufe?: BackupLauf[];
  /** `letzter-erfolg-<art>` und `letzter-fehler-<art>`. */
  [schluessel: string]: unknown;
}

/** Eine Anforderung an den Controller, so wie sie im Eingang landet. */
export interface ControllerAnforderung {
  operation: ControllerOperation;
  /** Nur bei Operationen, die einen Zeitpunkt annehmen. */
  zeitpunkt?: string;
  angefordert_von?: string;
  angefordert_am?: string;
}

/**
 * Die Operationen, die der Controller ausfuehrt.
 *
 * Diese Liste ist die Spiegelung von `OPERATIONEN` in
 * `deploy/backup/bin/swisshub-backup-controller`. Sie muss damit
 * uebereinstimmen - `tests/unit/backup-controller-operationen.test.ts` prueft
 * das, indem es den Controller selbst nach seiner Liste fragt.
 *
 * WAS HIER AUSDRUECKLICH NICHT STEHT: ein produktiver Restore. Er ist keine
 * Operation, die die WebApp ausloesen kann - auch nicht, wenn jemand sie
 * vollstaendig uebernimmt. Er laeuft ueber `swisshub-recovery` auf der
 * Kommandozeile, von einem Menschen, mit einer Freigabe.
 */
export const CONTROLLER_OPERATIONEN = [
  'status',
  'punkte',
  'backup-datenbank',
  'backup-datenbank-voll',
  'backup-dateien',
  'backup-konfiguration',
  'backup-geheimnisse',
  'backup-extern',
  'pruefen',
  'pruefen-tief',
  'restore-test',
  'restore-probelauf',
] as const;

export type ControllerOperation = (typeof CONTROLLER_OPERATIONEN)[number];

/** Das Ergebnis einer Anforderung, wie der Controller es ablegt. */
export interface ControllerErgebnis {
  kennung: string;
  operation: ControllerOperation | null;
  beschreibung?: string;
  status: 'laeuft' | 'erfolg' | 'fehler' | 'abgelehnt' | (string & {});
  rueckgabe?: number;
  begonnen?: string;
  beendet?: string;
  dauer_s?: number;
  angefordert_von?: string | null;
  meldung?: string;
}
