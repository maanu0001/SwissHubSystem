/**
 * Wie gefaehrlich ist eine Migration?
 *
 * ==========================================================================
 * WOZU DAS GEBRAUCHT WIRD
 * ==========================================================================
 *
 * Die Deployment-Pipeline soll vor einer Migration sicherstellen, dass ein
 * gueltiger Wiederherstellungspunkt vorliegt. Das kostet Zeit - ein
 * zusaetzliches Basis-Backup dauert Minuten.
 *
 * Es bei JEDEM Deployment zu tun, waere falsch: die meisten Deployments
 * aendern nur Quelltext. Ein Backup vor einer Aenderung an einer
 * React-Komponente schuetzt vor nichts und macht das Ausrollen so langsam,
 * dass irgendwann jemand den Schritt abschaltet. Eine Sicherung, die
 * abgeschaltet wird, weil sie im Weg ist, ist keine.
 *
 * Es NIE zu tun, waere ebenso falsch: eine Migration, die eine Spalte
 * loescht, ist nicht rueckgaengig zu machen. Ein Git-Rollback stellt kein
 * altes Schema wieder her - er aendert nur den Quelltext.
 *
 * Diese Datei entscheidet dazwischen. Sie liest das SQL und sagt, ob die
 * Migration vorwaertskompatibel ist.
 *
 * ==========================================================================
 * WAS «VORWAERTSKOMPATIBEL» HIER HEISST
 * ==========================================================================
 *
 * Eine Migration ist vorwaertskompatibel, wenn die VORHERIGE Fassung der
 * Anwendung mit dem NEUEN Schema noch laufen koennte. Praktisch heisst das:
 * sie nimmt nichts weg und erzwingt nichts.
 *
 *   Vorwaertskompatibel:   CREATE TABLE, ADD COLUMN (nullable oder mit
 *                          Standardwert), CREATE INDEX, neue Enum-Werte
 *   NICHT:                 DROP TABLE, DROP COLUMN, RENAME, SET NOT NULL
 *                          ohne Standardwert, Typwechsel, DELETE, UPDATE
 *
 * Die zweite Gruppe braucht einen Wiederherstellungspunkt. Die erste nicht -
 * bei ihr genuegt ein Git-Rollback, um zurueckzukommen.
 *
 * ==========================================================================
 * WARUM EINE MUSTERPRUEFUNG UND KEIN SQL-PARSER
 * ==========================================================================
 *
 * Ein vollstaendiger PostgreSQL-Parser waere genauer und waere hier die
 * falsche Wahl: er muesste jede Erweiterung der Syntax mitverfolgen, und ein
 * Parser, der eine unbekannte Konstruktion nicht versteht, gibt im Zweifel
 * «unbedenklich» zurueck.
 *
 * Diese Pruefung tut das Gegenteil. Sie kennt die gefaehrlichen Muster, und
 * was sie NICHT erkennt, stuft sie als `unbekannt` ein - was wie
 * `destruktiv` behandelt wird. Falsch positiv kostet ein Backup; falsch
 * negativ kostet Daten.
 * ==========================================================================
 */

export type Bewertung = 'vorwaertskompatibel' | 'destruktiv' | 'unbekannt';

export interface MigrationsBefund {
  /** Verzeichnisname der Migration, z.B. `20261002090000_restore_freigabe`. */
  name: string;
  bewertung: Bewertung;
  /** Welche Muster gegriffen haben - fuer eine verstaendliche Begruendung. */
  gruende: string[];
  /** Die Anweisungen, die als unbekannt gelten. */
  unbekannt: string[];
}

/**
 * Die gefaehrlichen Muster.
 *
 * Jedes mit einem Satz, was daran das Problem ist - die Pipeline gibt ihn aus,
 * und ein Hinweis ohne Begruendung wird ignoriert.
 */
const DESTRUKTIV: ReadonlyArray<readonly [RegExp, string]> = [
  [
    /\bDROP\s+TABLE\b/iu,
    'DROP TABLE löscht Daten unwiederbringlich. Ein Git-Rollback bringt die Tabelle nicht zurück.',
  ],
  [
    /\bDROP\s+COLUMN\b/iu,
    'DROP COLUMN löscht den Inhalt dieser Spalte. Er steht danach nur noch in einer Sicherung.',
  ],
  [
    /\bDROP\s+(TYPE|SCHEMA|DATABASE|VIEW|MATERIALIZED\s+VIEW|SEQUENCE)\b/iu,
    'Ein DROP auf ein Datenbankobjekt nimmt etwas weg, das die vorherige Anwendungsfassung braucht.',
  ],
  [
    /\bRENAME\s+(TO|COLUMN)\b/iu,
    'Ein Umbenennen bricht die vorherige Anwendungsfassung sofort: sie sucht den alten Namen.',
  ],
  [
    /\bALTER\s+TABLE\b[\s\S]*?\bALTER\s+COLUMN\b[\s\S]*?\bTYPE\b/iu,
    'Ein Typwechsel kann Werte verlieren (Kürzen, Rundung) und ist nicht umkehrbar.',
  ],
  [
    /\bSET\s+NOT\s+NULL\b/iu,
    'SET NOT NULL scheitert an bestehenden NULL-Werten oder erzwingt eine Vorbelegung. Die vorherige Fassung schreibt weiterhin NULL.',
  ],
  [/\bDELETE\s+FROM\b/iu, 'Ein DELETE in einer Migration verändert Daten, nicht nur das Schema.'],
  [/\bTRUNCATE\b/iu, 'TRUNCATE leert eine Tabelle vollständig.'],
  [
    // `^UPDATE` und nicht `\bUPDATE`.
    //
    // Der Unterschied ist nicht kosmetisch: `\bUPDATE` traf auch das UPDATE in
    // `ON UPDATE CASCADE`, und damit galt praktisch jede Migration mit einem
    // Fremdschluessel als datenveraendernd. Eine Pruefung, die bei allem
    // anspringt, sagt nichts mehr - und der Schritt, den sie ausloest, wird
    // dann abgeschaltet.
    //
    // Die Anweisungen sind schon einzeln zerlegt, also steht ein echtes UPDATE
    // am Anfang. `WITH ... UPDATE` bleibt unerkannt und faellt damit unter
    // `unbekannt`, was wie destruktiv behandelt wird.
    /^UPDATE\s+/iu,
    'Ein UPDATE in einer Migration schreibt Daten um. Der vorherige Stand steht danach nur in einer Sicherung.',
  ],
  [
    // Ein Rueckschreiben in eine neue Tabelle ist die gewoehnliche Form einer
    // Datenumstellung. Sie ist nicht destruktiv im Sinne von «loescht», aber
    // sie ist auch nicht vorwaertskompatibel: die vorherige Anwendungsfassung
    // kennt die Zieltabelle nicht, und die Umstellung laesst sich nicht
    // zurueckdrehen.
    /^INSERT\s+INTO\b[\s\S]*\bSELECT\b/iu,
    'Ein INSERT ... SELECT stellt Daten um. Zurückdrehen lässt sich das nur aus einer Sicherung.',
  ],
  [
    /\bDROP\s+CONSTRAINT\b/iu,
    'Ein weggefallener Constraint lässt Daten zu, die die vorherige Fassung nicht erwartet.',
  ],
  [
    // Ein Index zu loeschen ist fuer die Richtigkeit meist harmlos - er kostet
    // nur Geschwindigkeit. Meist: war es ein UNIQUE-Index, faellt damit eine
    // Zusicherung weg, und das steht im `DROP INDEX "name"` nicht drin.
    //
    // Hier wird deshalb die vorsichtige Richtung gewaehlt. Der Preis ist ein
    // zusaetzliches Backup, der Preis der anderen Richtung sind Daten.
    /^DROP\s+INDEX\b/iu,
    'Ein DROP INDEX kann eine Eindeutigkeitszusicherung entfernen. Aus der Anweisung allein ist nicht zu sehen, ob der Index UNIQUE war.',
  ],
  [
    // Eine neue Spalte mit NOT NULL und OHNE Standardwert scheitert an jeder
    // bestehenden Zeile. Sie steht deshalb hier und nicht bei den
    // unbedenklichen ADD COLUMN - und weil die destruktiven Muster zuerst
    // geprueft werden, gewinnt dieses.
    /^ALTER\s+TABLE\b[\s\S]*\bADD\s+COLUMN\b(?:(?!\bDEFAULT\b)[\s\S])*\bNOT\s+NULL\b(?:(?!\bDEFAULT\b)[\s\S])*$/iu,
    'Eine neue Spalte mit NOT NULL und ohne Standardwert scheitert an bestehenden Zeilen - und die vorherige Anwendungsfassung schreibt weiterhin nichts hinein.',
  ],
  [/\bDROP\s+(NOT\s+NULL|DEFAULT)\b/iu, 'Eine weggefallene Zusicherung ändert, was die Anwendung vorfindet.'],
];

/**
 * Die unbedenklichen Muster.
 *
 * Eine Anweisung, die hier passt UND auf kein destruktives Muster, gilt als
 * vorwaertskompatibel. Alles andere ist `unbekannt`.
 */
const UNBEDENKLICH: ReadonlyArray<RegExp> = [
  /^CREATE\s+(UNIQUE\s+)?INDEX\b/iu,
  /^CREATE\s+TABLE\b/iu,
  /^CREATE\s+TYPE\b/iu,
  /^CREATE\s+(OR\s+REPLACE\s+)?(VIEW|FUNCTION|TRIGGER)\b/iu,
  /^CREATE\s+EXTENSION\b/iu,
  /^CREATE\s+SEQUENCE\b/iu,
  // Eine Spalte hinzufuegen ist unbedenklich, SOLANGE sie nullbar ist oder
  // einen Standardwert hat. `SET NOT NULL` oben faengt den anderen Fall.
  /^ALTER\s+TABLE\b[\s\S]*\bADD\s+COLUMN\b/iu,
  // Ein neuer Enum-Wert nimmt nichts weg.
  /^ALTER\s+TYPE\b[\s\S]*\bADD\s+VALUE\b/iu,
  // Ein zusaetzlicher Constraint kann scheitern, aber er loescht nichts -
  // und ein gescheiterter Constraint laesst die Migration abbrechen, bevor
  // etwas geschrieben wurde.
  /^ALTER\s+TABLE\b[\s\S]*\bADD\s+CONSTRAINT\b/iu,
  /^ALTER\s+TABLE\b[\s\S]*\bALTER\s+COLUMN\b[\s\S]*\bSET\s+DEFAULT\b/iu,
  // Ein INSERT mit festen Werten legt Zeilen an und nimmt nichts weg.
  // `INSERT ... SELECT` ist oben ausdruecklich anders bewertet, und die
  // destruktiven Muster werden zuerst geprueft - die Reihenfolge traegt hier.
  /^INSERT\s+INTO\b/iu,
  /^COMMENT\s+ON\b/iu,
  /^ALTER\s+SEQUENCE\b/iu,
  /^CREATE\s+SCHEMA\b/iu,
  /^SET\b/iu,
  /^SELECT\b/iu,
  /^GRANT\b/iu,
];

/**
 * SQL in Anweisungen zerlegen.
 *
 * Kommentare weg, an Semikolons trennen. Bewusst einfach - und mit einer
 * Vorsichtsmassnahme, die noetig ist: ein Semikolon INNERHALB einer
 * Zeichenkette oder eines `$$`-Blocks (Funktionskoerper) wuerde falsch
 * trennen. Ein falsch getrenntes Stueck landet dann als `unbekannt`, und
 * `unbekannt` wird wie `destruktiv` behandelt. Der Fehler geht damit in die
 * vorsichtige Richtung.
 */
export function anweisungen(sql: string): string[] {
  const ohneKommentare = sql
    // Zeilenkommentare.
    .replace(/--[^\n]*/gu, ' ')
    // Blockkommentare.
    .replace(/\/\*[\s\S]*?\*\//gu, ' ');

  const ergebnis: string[] = [];
  let aktuell = '';
  let inZeichenkette = false;
  let inDollar = false;

  for (let index = 0; index < ohneKommentare.length; index += 1) {
    const zeichen = ohneKommentare[index] as string;

    if (!inDollar && zeichen === "'") {
      // Ein verdoppeltes Anfuehrungszeichen ist ein Zeichen, kein Ende.
      if (inZeichenkette && ohneKommentare[index + 1] === "'") {
        aktuell += "''";
        index += 1;
        continue;
      }
      inZeichenkette = !inZeichenkette;
      aktuell += zeichen;
      continue;
    }

    if (!inZeichenkette && zeichen === '$' && ohneKommentare[index + 1] === '$') {
      inDollar = !inDollar;
      aktuell += '$$';
      index += 1;
      continue;
    }

    if (zeichen === ';' && !inZeichenkette && !inDollar) {
      const getrimmt = aktuell.trim();
      if (getrimmt !== '') {
        ergebnis.push(getrimmt);
      }
      aktuell = '';
      continue;
    }

    aktuell += zeichen;
  }

  const rest = aktuell.trim();
  if (rest !== '') {
    ergebnis.push(rest);
  }
  return ergebnis;
}

/** Eine einzelne Migration bewerten. */
export function bewerteMigration(name: string, sql: string): MigrationsBefund {
  const gruende: string[] = [];
  const unbekannt: string[] = [];

  for (const anweisung of anweisungen(sql)) {
    const einzeilig = anweisung.replace(/\s+/gu, ' ').trim();
    if (einzeilig === '') {
      continue;
    }

    let destruktiv = false;
    for (const [muster, grund] of DESTRUKTIV) {
      if (muster.test(einzeilig)) {
        destruktiv = true;
        if (!gruende.includes(grund)) {
          gruende.push(grund);
        }
      }
    }
    if (destruktiv) {
      continue;
    }

    if (!UNBEDENKLICH.some((muster) => muster.test(einzeilig))) {
      // Nicht erkannt heisst nicht harmlos. Eine Anweisung, die keines der
      // bekannten Muster trifft, gilt als unbekannt - und unbekannt wird wie
      // destruktiv behandelt.
      unbekannt.push(einzeilig.slice(0, 160));
    }
  }

  const bewertung: Bewertung =
    gruende.length > 0 ? 'destruktiv' : unbekannt.length > 0 ? 'unbekannt' : 'vorwaertskompatibel';

  return { name, bewertung, gruende, unbekannt };
}

export interface GesamtBefund {
  befunde: MigrationsBefund[];
  /**
   * Braucht dieses Deployment einen Wiederherstellungspunkt?
   *
   * `true`, sobald eine Migration destruktiv oder unbekannt ist. Bei einer
   * leeren Liste `false` - ein Deployment ohne neue Migration aendert kein
   * Schema.
   */
  brauchtRecoveryPoint: boolean;
  /** Ein Satz, den die Pipeline ausgeben kann. */
  zusammenfassung: string;
}

export function bewerteMigrationen(migrationen: ReadonlyArray<{ name: string; sql: string }>): GesamtBefund {
  const befunde = migrationen.map((eintrag) => bewerteMigration(eintrag.name, eintrag.sql));
  const heikel = befunde.filter((befund) => befund.bewertung !== 'vorwaertskompatibel');

  if (migrationen.length === 0) {
    return {
      befunde,
      brauchtRecoveryPoint: false,
      zusammenfassung:
        'Keine neue Migration. Dieses Deployment ändert das Schema nicht - ein zusätzlicher ' +
        'Wiederherstellungspunkt ist dafür nicht nötig, und ein Git-Rollback genügt, um ' +
        'zurückzukommen.',
    };
  }

  if (heikel.length === 0) {
    return {
      befunde,
      brauchtRecoveryPoint: false,
      zusammenfassung:
        `${migrationen.length} neue Migration(en), alle vorwärtskompatibel: sie nehmen nichts weg ` +
        'und erzwingen nichts. Die vorherige Anwendungsfassung könnte mit diesem Schema noch ' +
        'laufen, ein Git-Rollback genügt also.',
    };
  }

  return {
    befunde,
    brauchtRecoveryPoint: true,
    zusammenfassung:
      `${heikel.length} von ${migrationen.length} Migration(en) sind nicht vorwärtskompatibel. ` +
      'Ein Git-Rollback stellt kein altes Datenbankschema wieder her - vor dieser Migration ' +
      'braucht es einen geprüften Wiederherstellungspunkt.',
  };
}
