'use client';

import { useEffect, useRef } from 'react';

/**
 * Die bewegte Kulisse der oeffentlichen Profilseite.
 *
 * ## Warum eine eigene Komponente und kein `div` in der Ansicht
 *
 * Wegen der zwei Dinge, die nur im Browser gehen: die Parallaxe zur
 * Mausbewegung und das Anhalten, wenn die Seite nicht sichtbar ist. Beides
 * setzt ausschliesslich CSS-Variablen und Klassen - es rendert nichts neu
 * und ruft kein `setState`.
 *
 * Die Bewegung selbst steht weiter in `profil-themes.css`, als
 * CSS-Animation auf `transform` und `opacity`. JavaScript liefert hier nur
 * zwei Zahlen dazu.
 *
 * ## Fuenf Lagen
 *
 * Vorher waren es drei, und das war zu wenig fuer eine Tiefe, die man
 * bemerkt. Die Lagen sind leer und `aria-hidden` - ein Screenreader soll
 * keine fuenf leeren Kaesten vorlesen.
 */
export function ProfilKulisse({ kulisse }: { kulisse: string }): React.JSX.Element {
  const knoten = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = knoten.current;
    if (!element) {
      return;
    }

    /*
     * Wer reduzierte Bewegung verlangt, bekommt gar keine Zeiger-Reaktion.
     *
     * Nicht nur abgeschwaecht: die Einstellung ist eine Aussage darueber,
     * dass Bewegung stoert - und eine Kulisse, die dem Zeiger folgt, ist
     * Bewegung, auch wenn die Keyframes stillstehen.
     */
    const ruhe = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (ruhe.matches) {
      return;
    }

    /*
     * Auf Geraeten ohne Zeiger gibt es nichts zu verfolgen.
     *
     * `pointer: fine` ist die Frage nach einer Maus oder einem Trackpad. Auf
     * dem Telefon liefe sonst ein Listener, der nie feuert - und bei jeder
     * Beruehrung ein Sprung der Kulisse, den niemand wollte.
     */
    if (!window.matchMedia('(pointer: fine)').matches) {
      return;
    }

    let angefordert = 0;
    let zielX = 0;
    let zielY = 0;

    /*
     * Geschrieben wird im Animationsrahmen, nicht im Ereignis.
     *
     * `mousemove` feuert oefter als der Bildschirm zeichnet. Ohne diese
     * Drosselung setzte der Browser dieselbe Variable mehrfach je Bild und
     * rechnete jedes Mal Stil neu.
     */
    const schreiben = (): void => {
      angefordert = 0;
      element.style.setProperty('--pt-maus-x', zielX.toFixed(3));
      element.style.setProperty('--pt-maus-y', zielY.toFixed(3));
    };

    const bewegt = (ereignis: MouseEvent): void => {
      // Von -1 bis 1, gemessen an der Fenstermitte.
      zielX = (ereignis.clientX / window.innerWidth) * 2 - 1;
      zielY = (ereignis.clientY / window.innerHeight) * 2 - 1;
      if (angefordert === 0) {
        angefordert = window.requestAnimationFrame(schreiben);
      }
    };

    /*
     * Und anhalten, wenn niemand hinsieht.
     *
     * Eine Kulisse, die in einem Hintergrundtab weiterlaeuft, kostet Strom
     * fuer nichts. Browser drosseln Animationen dort zwar, aber nicht
     * zuverlaessig und nicht auf null.
     */
    const sichtbarkeit = (): void => {
      element.classList.toggle('pt-kulisse--ruht', document.hidden);
    };

    window.addEventListener('mousemove', bewegt, { passive: true });
    document.addEventListener('visibilitychange', sichtbarkeit);

    return () => {
      window.removeEventListener('mousemove', bewegt);
      document.removeEventListener('visibilitychange', sichtbarkeit);
      if (angefordert !== 0) {
        window.cancelAnimationFrame(angefordert);
      }
    };
  }, []);

  return (
    <div ref={knoten} className={`pt-kulisse ${kulisse}`} aria-hidden="true">
      <div className="pt-lage pt-lage-1" />
      <div className="pt-lage pt-lage-2" />
      <div className="pt-lage pt-lage-3" />
      <div className="pt-lage pt-lage-4" />
      <div className="pt-lage pt-lage-5" />
    </div>
  );
}
