'use client';

import { useCallback, useState } from 'react';
import { STANDARD_SYMBOLE, quelle } from '../adressen';

/** Woran ein Symbolbild gescheitert ist - oder `null`, wenn alles passt. */
export type Bildfehler = 'datei' | 'adresse';

export interface SymbolQuelle {
  key: string;
  name?: string;
  bildPfad: string | null;
  bildUrl: string | null;
}

/**
 * Das Bild eines Slot-Symbols - mit Rueckfall, wenn es nicht laedt.
 *
 * ## Der Fehler, den das behebt
 *
 * Gemeldet war: «obwohl die Bildadresse korrekt gesetzt ist, werden die
 * Symbole nicht angezeigt» - im Bildschirmfoto dreizehn leere Kaesten mit dem
 * Fragezeichen des Browsers und ein einziges heiles Symbol. Das heile war das
 * mitgelieferte; die uebrigen trugen eine Adresse.
 *
 * Eine Adresse kann aus Gruenden scheitern, die diese Anwendung nicht kennt
 * und nie kennen wird: der fremde Server ist weg, er verbietet das Einbetten,
 * er antwortet mit einer HTML-Seite statt eines Bildes, der Tippfehler faellt
 * erst beim Laden auf. **Serverseitig laesst sich das nicht pruefen** - ob ein
 * Bild im Browser des Spielers ankommt, weiss nur dieser Browser.
 *
 * Also wird es dort beantwortet. Scheitert das eigene Bild, nimmt die Zelle
 * das mitgelieferte; scheitert auch das, bleibt der Name. Ein Symbol ist damit
 * nie leer - und genau das war verlangt.
 *
 * ## Warum `onError` allein den Fehler nicht behebt
 *
 * Das war der eigentliche Grund, warum ein erster Anlauf nichts aenderte. Die
 * Walzen werden auf dem Server gerendert; das Markup steht im Browser, bevor
 * React laeuft. Der Browser beginnt sofort zu laden und meldet den Fehlschlag
 * sofort - gemessen 603 Millisekunden nach dem Seitenaufruf, siebenmal, lange
 * bevor React hydriert hat und seinen `onError`-Handler an das Bild haengen
 * konnte. React spielt bereits abgelaufene Ereignisse nicht nach. Der Handler
 * wartet also auf ein Ereignis, das es schon gegeben hat.
 *
 * Deshalb wird beim Anhaengen des Elements zusaetzlich **nachgesehen**: ein
 * Bild, das `complete` meldet, aber keine Breite hat, ist fertig geladen und
 * leer - also gescheitert. Das deckt genau die Luecke zwischen Seitenaufruf
 * und Hydrierung ab, in der kein Handler existiert. `onError` bleibt fuer
 * alles danach: ein Bild, das die Verwaltung spaeter eintraegt, scheitert
 * waehrend React laeuft.
 *
 * Die Pruefung ist bewusst `naturalWidth === 0` und nicht `complete` allein:
 * `complete` ist auch bei einem aus dem Cache geladenen, heilen Bild wahr. Und
 * sie ist fuer die mitgelieferten SVGs unbedenklich - die tragen `width` und
 * `height`, melden also eine echte Breite. Nachgemessen: von 45 Zellen traf
 * die Pruefung genau die sechs kaputten, keine einzige SVG-Zelle.
 *
 * ## Warum eine Liste und kein Schalter
 *
 * `gescheitert` sammelt **Adressen**, nicht Stufen. Traegt jemand eine neue
 * Adresse ein, steht sie nicht in der Liste und wird versucht - ohne dass die
 * Komponente neu eingehaengt werden muesste. Eine alte, kaputte Adresse bleibt
 * derweil als gescheitert vermerkt und wird kein zweites Mal geholt.
 *
 * ## Was es nicht kostet
 *
 * Nichts, solange nichts scheitert: ohne Fehler aendert sich der Zustand nie,
 * und die Zelle rendert genau einmal. Die Pruefung beim Anhaengen liest zwei
 * Eigenschaften, die der Browser schon kennt - kein Layout, kein Dekodieren.
 */
export function SymbolGrafik({
  symbol,
  className,
  onFehler,
}: {
  symbol: SymbolQuelle;
  className?: string;
  /** Wird gerufen, wenn eine Stufe scheitert - fuer Hinweise in der Verwaltung. */
  onFehler?: (art: Bildfehler) => void;
}): React.JSX.Element {
  const [gescheitert, setGescheitert] = useState<readonly string[]>([]);

  const eigen = quelle(symbol.bildPfad, symbol.bildUrl);
  const standard = STANDARD_SYMBOLE[symbol.key] ?? null;
  const kandidaten = [eigen, standard].filter((wert): wert is string => Boolean(wert));
  const aktuell = kandidaten.find((wert) => !gescheitert.includes(wert)) ?? null;

  const melde = useCallback(
    (adresse: string): void => {
      if (adresse === eigen) {
        onFehler?.(symbol.bildPfad ? 'datei' : 'adresse');
      }
      setGescheitert((vorher) => (vorher.includes(adresse) ? vorher : [...vorher, adresse]));
    },
    [eigen, onFehler, symbol.bildPfad],
  );

  // Laeuft beim Anhaengen und nach jedem Adresswechsel. Direkt nach einem
  // Wechsel ist `complete` falsch - der Browser laedt erst -, es gibt also
  // keinen Fehlalarm fuer ein Bild, das noch unterwegs ist.
  //
  // Vermerkt wird `aktuell` aus dem Abschluss und nicht `bild.currentSrc`:
  // der Browser loest dort zur absoluten Adresse auf
  // (`http://host/xp-slot/...`), waehrend die Kandidatenliste relative Pfade
  // fuehrt. Der Vermerk haette nie gepasst, die Zelle waere auf der kaputten
  // Stufe stehen geblieben.
  const nachsehen = useCallback(
    (bild: HTMLImageElement | null): void => {
      if (!bild || !aktuell || !bild.complete || bild.naturalWidth > 0) return;
      melde(aktuell);
    },
    [aktuell, melde],
  );

  if (!aktuell) {
    return <span className="slot-zelle__text">{symbol.name ?? '?'}</span>;
  }

  return (
    // Bewusst `img` und nicht `next/image`: die Datei kommt aus einem Route
    // Handler mit eigenem Cache-Kopf, und eine fremde Adresse gehoert dem
    // Optimierer von Next gar nicht.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={nachsehen}
      className={className}
      src={aktuell}
      alt={symbol.name ?? ''}
      draggable={false}
      onError={() => melde(aktuell)}
    />
  );
}
