/**
 * Der Vertrag der Tonausgabe - ohne Browser.
 *
 * ## Warum das eine eigene Datei ist
 *
 * Weil die Zuordnung «welches Ereignis klingt wie» pruefbar sein soll, und
 * zwar ohne Browser. `klang.ts` selbst kann das nicht leisten: es fasst
 * `window`, `localStorage` und `HTMLAudioElement` an, und das Projekt
 * uebersetzt Tests ohne die DOM-Bibliothek - zu Recht, denn ein Modulkern,
 * der versehentlich `document` anfasst, soll daran scheitern.
 *
 * Hier stehen deshalb nur die Formen: was ein Klangeintrag ist, was die
 * Einstellungen sind, und welche Funktionen eine Tonausgabe anbietet. Ein
 * Test kann damit eine Attrappe bauen, die der echten Ausgabe **typgleich**
 * ist, und `klangereignisse.ts` kann gegen den Vertrag arbeiten, ohne die
 * Umsetzung zu kennen.
 *
 * `klang.ts` gibt diese Formen weiter nach draussen - wer die Tonausgabe
 * benutzt, muss nicht wissen, dass ihr Vertrag woanders steht.
 */

export interface KlangEintrag {
  slot: string;
  /** Die hochgeladene Datei - oder `null` fuer den mitgelieferten Klang. */
  dateiname: string | null;
  lautstaerke: number;
  musik: boolean;
}

export interface KlangEinstellungen {
  musikAn: boolean;
  effekteAn: boolean;
  /** 0 bis 100. */
  musikLaut: number;
  effekteLaut: number;
}

/** Ohne Blende - fuer den Fall, dass eine Bewegung hart aufhoert. */
export interface SchleifenOptionen {
  sofort?: boolean;
}

export interface Tonausgabe {
  einstellungen: KlangEinstellungen;
  setzeEinstellungen: (werte: Partial<KlangEinstellungen>) => void;
  /** Darf schon Ton kommen? */
  freigegeben: boolean;
  /** Nach der ersten Beruehrung aufrufen. Mehrfach aufrufen ist harmlos. */
  freigeben: () => void;
  /** Spielt einen Klang an. Still, wenn es ihn nicht gibt. */
  spiele: (slot: string) => void;
  /** Startet eine Schleife - eingeblendet, wenn nicht `sofort`. */
  starteSchleife: (slot: string, optionen?: SchleifenOptionen) => void;
  /** Beendet eine Schleife - ausgeblendet, wenn nicht `sofort`. */
  stoppeSchleife: (slot: string, optionen?: SchleifenOptionen) => void;
  /** Ein Slot mit Datei? Fuer die Vorschau in der Verwaltung. */
  vorhanden: (slot: string) => boolean;
}
