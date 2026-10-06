/**
 * Das Inhaltsmodell der internen Dokumentation.
 *
 * ## Warum Daten und nicht Markdown
 *
 * Die Doku soll suchbar, verlinkbar und pruefbar sein. Markdown waere dafuer
 * ein Zwischenschritt: erst Text, dann ein Parser, dann wieder eine Struktur -
 * und die Struktur ist, worauf Inhaltsverzeichnis, Suche und Ankerpruefung
 * zugreifen. Im Repository gibt es ausserdem keine Markdown-Infrastruktur;
 * MDX haette eine Kette aus Parser, Transformern und Syntax-Hervorhebung
 * nachgezogen, nur um am Ende dieselben Bloecke zu erzeugen.
 *
 * Also direkt die Struktur. Der Gewinn ist nicht die Ersparnis, sondern was
 * dadurch pruefbar wird: dass jeder Anker eindeutig ist, dass kein interner
 * Link ins Leere zeigt, dass kein Slug zweimal vorkommt. Ein Test liest diese
 * Daten und beantwortet das; einem Markdown-Ordner muesste man es ansehen.
 *
 * ## Was hier bewusst fehlt
 *
 * Freies HTML. Ein Block kann nur sein, was dieser Typ vorsieht - sonst waere
 * die Doku eine zweite Oberflaeche mit eigenem Aussehen, und genau das soll
 * sie nicht sein. Neue Darstellungsformen kommen als neuer Blocktyp dazu,
 * einmal, mit einer Darstellung im Renderer.
 */

/** Die Sprachen, fuer die es eine Hervorhebung gibt. */
export type CodeSprache = 'ts' | 'tsx' | 'bash' | 'sql' | 'prisma' | 'json' | 'text';

/** Der Ton eines Hinweises. Fuenf, und mehr sollen es nicht werden. */
export type HinweisTon = 'info' | 'tipp' | 'wichtig' | 'achtung' | 'admin';

/**
 * Ein Inhaltsblock.
 *
 * Fliesstext steht in `text`-Feldern und darf drei Auszeichnungen tragen:
 * `` `code` ``, `**fett**` und `[Beschriftung](/pfad)`. Mehr nicht - siehe
 * `inline.ts`. Wer eine Tabelle braucht, nimmt den Tabellenblock; wer eine
 * Liste braucht, den Listenblock. Das haelt die Darstellung an einer Stelle.
 */
export type DokuBlock =
  | { art: 'absatz'; text: string }
  | { art: 'liste'; geordnet?: boolean; punkte: readonly string[] }
  | { art: 'code'; sprache: CodeSprache; inhalt: string; titel?: string }
  | { art: 'tabelle'; kopf: readonly string[]; zeilen: readonly (readonly string[])[] }
  | { art: 'hinweis'; ton: HinweisTon; titel?: string; text: string }
  | { art: 'schritte'; punkte: readonly { titel: string; text?: string }[] }
  /**
   * Ein Ablauf als Kette von Stationen.
   *
   * Browser → Route → Pruefung → Aktion → Datenbank. Gezeichnet mit HTML und
   * CSS, nicht mit einer Diagramm-Bibliothek: fuer eine Kette von fuenf
   * Kaesten waere eine Laufzeitabhaengigkeit der falsche Preis, und ein
   * Diagramm, das erst im Browser gerendert wird, ist auf dem Telefon ein
   * Ladebalken.
   */
  | { art: 'fluss'; stationen: readonly { label: string; detail?: string }[] }
  /** Eine Begriffsliste - Name links, Erklaerung rechts. */
  | { art: 'felder'; eintraege: readonly { name: string; text: string }[] }
  /**
   * Der Knopf «Modul oeffnen».
   *
   * `permission` ist kein Riegel, sondern die Frage, ob der Knopf ueberhaupt
   * erscheint: wer das Modul nicht oeffnen darf, bekommt keinen Knopf, der
   * ihn auf eine 403-Seite schickt. Der Riegel sitzt wie immer auf der
   * Zielseite.
   */
  | { art: 'modulknopf'; href: string; label: string; permission: string };

/**
 * Ein Abschnitt einer Seite - eine Ueberschrift mit Inhalt.
 *
 * `anker` ist der stabile Teil der Adresse: `…/permissions#registry`. Er wird
 * nicht aus dem Titel abgeleitet, sondern hingeschrieben - ein umbenannter
 * Titel soll einen verschickten Link nicht brechen.
 */
export interface DokuAbschnitt {
  anker: string;
  titel: string;
  blocks: readonly DokuBlock[];
  /** Unterabschnitte (H3). Eine Ebene tiefer, und dann ist Schluss. */
  unter?: readonly DokuUnterabschnitt[];
}

export interface DokuUnterabschnitt {
  anker: string;
  titel: string;
  blocks: readonly DokuBlock[];
}

/** Eine Dokumentationsseite. */
export interface DokuSeite {
  /** Ohne fuehrenden Schraegstrich, z.B. `module/xp-slot`. */
  slug: string;
  titel: string;
  /** Ein Satz. Steht in Schnellzugriffen, Suchergebnissen und unter dem Titel. */
  kurz: string;
  /**
   * Wozu diese Seite gehoert - z.B. «Level-System».
   *
   * Ein Bereich und keine Person: Namen im Quelltext veralten mit dem
   * naechsten Rollenwechsel, ein Bereich nicht.
   */
  bereich?: string;
  /**
   * Wann der Inhalt zuletzt geprueft wurde, als `JJJJ-MM-TT`.
   *
   * Von Hand gepflegt und nicht aus Git gelesen. Die Dateizeit eines
   * Containers ist die Zeit des Checkouts, nicht die der Aenderung, und eine
   * Git-Abfrage zur Laufzeit waere eine Abhaengigkeit, die in Produktion
   * nichts zu gewinnen hat. Eine Zahl, die jemand bewusst setzt, ist hier
   * ehrlicher als eine, die automatisch falsch ist.
   */
  aktualisiert: string;
  abschnitte: readonly DokuAbschnitt[];
}

export interface DokuKategorie {
  id: string;
  titel: string;
  seiten: readonly DokuSeite[];
}

/** Eine der beiden Dokumentationen. */
export interface DokuWerk {
  id: 'entwickler' | 'team';
  titel: string;
  /** Kurztext der Startseite, eine Zeile. */
  kurz: string;
  /** Basisadresse, z.B. `/system/docs/entwickler`. */
  basis: string;
  /** Die Berechtigung, die diese Dokumentation oeffnet. */
  permission: string;
  kategorien: readonly DokuKategorie[];
}
