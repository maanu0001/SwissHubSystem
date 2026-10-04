import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Die drei gemessenen Leistungsursachen - und dass sie behoben bleiben.
 *
 * ## Warum am Quelltext und nicht als Benchmark
 *
 * Weil eine Zahl auf dieser Maschine nichts darüber sagt, wie es auf einem
 * iPad läuft, und weil eine Schranke wie «unter 16 ms» in einem Container mit
 * Software-Rendering entweder immer oder nie hält. Was sich dagegen eindeutig
 * prüfen lässt, ist die **Ursache**: ob der Code noch das tut, was gemessen
 * zu viel war.
 *
 * ## Was gemessen wurde
 *
 * Im Browser, gegen den gebauten Server, mit drei Spins:
 *
 *   - **207 erzwungene Layoutberechnungen je Spin** (`getBoundingClientRect`,
 *     davon 150 auf `.slot-walze` und 50 auf `.slot-walzen`). Ursache: die
 *     Ref-Rückrufe der Walzen wurden **inline** erzeugt, also bei jedem
 *     Rendern neu. React hängt einen Ref dann ab und neu an - und in diesem
 *     Rückruf stand die Messung.
 *   - **23 Klangdateien, geholt während des ersten Spins.** Ursache: gebaut
 *     wurde erst nach der Freigabe, und die fällt im ersten Spin. Dekodieren
 *     läuft im Hauptfaden.
 *   - **dreissig Compositor-Ebenen mit je einem Weichzeichner** auf dem
 *     laufenden Band: `will-change: transform` stand auf jedem
 *     `.slot-zelle__bild`, der Blur ebenfalls je Bild.
 *
 * Jede dieser drei Ursachen hat hier ihren Test.
 *
 * ## Und die Runde danach, mit Blick auf iPhone und iPad
 *
 * Gemessen wurde mit dem Chrome DevTools Protocol auf vier Ansichten
 * (iPhone 390x844 bei DPR 3, iPad hoch und quer bei DPR 2, Desktop), je ein
 * Aufwaermspin und drei gemessene Spins:
 *
 *   - **18 bis 45 Compositor-Ebenen** auf der Buehne, davon 17 bis 43
 *     groesser als 400 px². Bewegen tun sich fuenf: die Baender. Also steht
 *     `will-change` nur noch dort.
 *   - **239 bis 645 Paints und 136 bis 352 ms Paintzeit je Spin** mit dem
 *     Weichzeichner auf dem Band. Ein Filter auf einer bewegten Ebene wird
 *     in **jedem** Bild neu gerastert - richtig gegen die Ebenenzahl, falsch
 *     gegen die Paintzeit. Der Smear liegt jetzt still auf dem Walzenfenster.
 *   - **rund zweihundert Bildpaints je Spin** aus dem Auf- und Abbau der
 *     Lagen: `laeuft ? <Band/> : <Stand/>` baute bei jedem Start und jedem
 *     Stopp sechs Bilder ab und drei auf, fuenfmal je Spin. Beide Lagen
 *     stehen jetzt dauerhaft; umgeschaltet wird mit `visibility`.
 *   - **vierzig Weckrufe je Sekunde mitten im Walzenlauf**: die Tonblenden
 *     liefen ueber `setInterval` mit 25 ms, und der `reel_loop` blendet bei
 *     jedem Spin ein und aus. Blenden sind jetzt Rampen auf dem Audiofaden
 *     (`tonmotor.ts`, geprueft in `xpslot-tonmotor.test.ts`).
 *
 * Was sich **nicht** bestaetigt hat und darum auch nicht umgesetzt wurde:
 * Prozent-Keyframes anstelle von `var()` in `@keyframes slot-lauf` (die
 * Vermutung, Blink koenne solche Animationen nicht komponieren) und
 * `contain: paint` als Ursache fehlender Ebenenbildung. Beide A/B-Laeufe
 * lagen innerhalb der Streuung von rund 1,5x, die dieser Container ohnehin
 * hat.
 */

const lies = (pfad: string): string => readFileSync(pfad, 'utf8');
const ohneKommentare = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');
const ohneCssKommentare = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//gu, '');

const WALZEN = 'apps/web/src/modules/level/xpslot/components/walzen.tsx';
/*
 * Der reine Walzenbaum - seit dem Schnitt eine eigene, DOM-freie Datei.
 *
 * Sie laesst sich im Test rendern, und genau das tut
 * `xpslot-walzenaufbau.test.ts`. Hier wird sie gelesen, weil die Zusage
 * «die Gewinnlinie misst nicht» eine Aussage ueber **diese** Datei ist:
 * `walzen.tsx` darf messen, der Baum darf es nicht.
 */
const WALZENBILD = 'apps/web/src/modules/level/xpslot/components/walzenbild.tsx';
const KLANG = 'apps/web/src/modules/level/xpslot/components/klang.ts';
const MELDUNG = 'apps/web/src/modules/level/xpslot/components/meldung.tsx';
const RAD = 'apps/web/src/modules/level/xpslot/components/rad.tsx';
const SPIEL = 'apps/web/src/modules/level/xpslot/components/spiel.tsx';
const CSS = 'apps/web/src/modules/level/xpslot/xpslot.css';

describe('Layoutmessungen der Walzen', () => {
  const quelle = ohneKommentare(lies(WALZEN));

  it('erzeugt die Ref-Rückrufe einmal und nicht bei jedem Rendern', () => {
    /*
     * Der Kern: eine gemerkte Liste von Rückrufen, einer je Walze.
     * `walzenRef(2)` muss bei jedem Rendern dieselbe Funktion liefern,
     * sonst hängt React den Ref ab und neu an.
     */
    expect(quelle).toMatch(/const rueckrufe = useMemo\(/u);
    expect(quelle).toContain('walzenEls.current[walze] = element');
    expect(quelle).toMatch(/const walzenRef = useCallback\(\s*\(walze: number\) => rueckrufe\[walze\]/u);
    // Die alte Form: eine Funktion, die bei jedem Aufruf eine neue zurückgibt.
    expect(quelle).not.toMatch(/\(walze: number\) => \(element: HTMLDivElement \| null\) => \{/u);
  });

  it('messt gebündelt im nächsten Bild statt sofort im Rückruf', () => {
    expect(quelle).toContain('const planen = useCallback');
    expect(quelle).toContain('window.requestAnimationFrame');
    // Mehrere Anlässe im selben Bild ergeben eine Messung.
    expect(quelle).toMatch(/if \(bild\.current !== 0\) \{\s*return;/u);
    expect(quelle).toContain('window.cancelAnimationFrame(bild.current)');
    // Die Rückrufe melden eine Messung an - sie messen nicht selbst.
    expect(quelle).not.toMatch(/element\) \{\s*messen\(\);/u);
  });

  it('beobachtet den Rahmen und nicht jede Walze einzeln', () => {
    /*
     * Die Zellgroesse haengt an der Breite des Rahmens (`cqw`) - eine Walze
     * kann sich nicht ohne ihn aendern. Fuenf Beobachter waeren fuenf
     * Rueckrufe je Aenderung, fuer dieselbe Aussage.
     */
    expect(quelle).toContain('beobachter.observe(rahmenRef.current)');
    expect(quelle).not.toMatch(/for \(const element of walzenEls\.current\)/u);
  });
});

describe('Klänge liegen vor dem ersten Spin bereit', () => {
  const quelle = ohneKommentare(lies(KLANG));

  it('baut die Stimmen ohne Freigabe - geladen werden darf immer', () => {
    const baue = quelle.slice(quelle.indexOf('const baue = useCallback'), quelle.indexOf('const hole ='));
    expect(baue).toContain("typeof window === 'undefined'");
    // Genau das war der Fehler: ohne Freigabe entstand keine Stimme, also
    // lud auch nichts vor.
    expect(baue).not.toContain('freigegebenRef.current');
    expect(baue).toContain("element.preload = 'auto'");
  });

  it('prüft die Freigabe beim Abspielen - dort gehört sie hin', () => {
    const spiele = quelle.slice(
      quelle.indexOf('const spiele = useCallback'),
      quelle.indexOf('const starteSchleife ='),
    );
    expect(spiele).toMatch(/if \(!freigegebenRef\.current\) \{\s*return;/u);
    const schleife = quelle.slice(
      quelle.indexOf('const starteSchleife = useCallback'),
      quelle.indexOf('const stoppeSchleife ='),
    );
    expect(schleife).toMatch(/if \(!freigegebenRef\.current\) \{\s*return;/u);
  });

  it('lädt direkt nach dem Rendern vor - alle Slots, Musik zuletzt', () => {
    /*
     * Der Effekt darf nicht an `freigegeben` haengen - sonst laeuft er erst
     * im ersten Spin, und genau dann sind die dreiundzwanzig Dateien im
     * Netz, waehrend die Walzen laufen.
     *
     * Und er darf nicht auf einen Zeitgeber warten: ein
     * `requestIdleCallback` stand hier, und der Browser-Smoke klickte
     * schneller, als er feuerte - die Musik lag damit immer noch im Netz,
     * waehrend die Walzen liefen.
     */
    const vorladen = quelle.slice(quelle.indexOf('const reihe = [...nachSlot.keys()]'));
    const effekt = vorladen.slice(0, vorladen.indexOf('}, ['));
    expect(effekt).toContain('MUSIK_SLOTS.has(links)');
    // Beide Wege laden vor: der Motor seine Puffer, der Rueckfallweg seine
    // Stimmen. Keiner von beiden darf auf den ersten Spin warten.
    expect(effekt).toContain('motor.lade(slot, adresse)');
    expect(effekt).toContain('hole(slot)');
    const abhaengigkeiten = vorladen.slice(vorladen.indexOf('}, ['), vorladen.indexOf('}, [') + 40);
    expect(abhaengigkeiten).not.toContain('freigegeben,');
    expect(quelle).not.toContain('requestIdleCallback');
  });
});

describe('Ebenen und Filter auf der Bühne', () => {
  const css = ohneCssKommentare(lies(CSS));

  it('setzt will-change nur auf die fuenf Baender und auf kein Symbol', () => {
    /*
     * ## Warum das strenger ist als vorher
     *
     * Hier stand einmal `will-change` auf jedem Symbolbild - dreissig
     * Ebenen. Danach nur noch auf den Treffer- und Klebezellen, was besser
     * war, aber immer noch eine Ebene je Symbol anlegt. Gemessen waren 18
     * bis 45 Compositor-Ebenen auf der Buehne; bewegen tun sich fuenf.
     *
     * Also: genau eine Regel im ganzen Stylesheet traegt `will-change`, und
     * das ist die des Bands.
     */
    const traeger = [...css.matchAll(/([^{}]+)\{([^}]*)\}/gu)]
      .filter((treffer) => (treffer[2] ?? '').includes('will-change'))
      .map((treffer) => (treffer[1] ?? '').trim().split(/\s*,\s*/u))
      .flat()
      .map((auswahl) => auswahl.replace(/\s+/gu, ' ').trim())
      .sort();

    /*
     * Genau zwei Stellen im ganzen Stylesheet - und beide sind benannt:
     *
     *  - `.slot-band`: die fuenf bewegten Baender. Darum geht es hier.
     *  - `.slot-rad__scheibe`: die Scheibe des Risiko-Rads. Sie dreht Bild
     *    fuer Bild aus `rad.tsx`, sie ist ein einzelnes Element, und sie
     *    steht auf einem anderen Bildschirm als die Walzen.
     *
     * Kommt eine dritte dazu, ist das die Frage, die dieser Test stellen
     * soll: welche Ebene wird da befoerdert, und bewegt sie sich wirklich?
     */
    expect(traeger).toEqual(['.slot-band', '.slot-rad__scheibe']);

    // Und keine Zelle, kein Bild, kein Text traegt es noch.
    expect(css).not.toMatch(/\.slot-zelle[^{]*\{[^}]*will-change/u);
  });

  it('legt keinen Filter auf das bewegte Band - der Smear steht still', () => {
    /*
     * ## Die Geschichte dieses Tests
     *
     * Er pruefte zuerst, dass der Weichzeichner **nicht** auf jedem der
     * dreissig Symbolbilder sitzt, sondern einmal auf dem Band. Das war
     * richtig gegen die Ebenenzahl und falsch gegen die Paintzeit: ein
     * Filter auf einer Ebene, die sich bewegt, muss in **jedem** Bild neu
     * gerastert werden, und die Animation faellt damit aus dem Compositor
     * zurueck auf den Hauptfaden. Gemessen: 239 bis 645 Paints und 136 bis
     * 352 ms Paintzeit je Spin.
     *
     * Die Aussage ist deshalb jetzt die naechststrengere: auf dem Bewegten
     * liegt **gar kein** Filter. Den Eindruck von Geschwindigkeit macht eine
     * stehende Lage auf dem Walzenfenster - sie wird einmal gezeichnet und
     * danach nur noch mitkomponiert.
     */
    const bandbloecke = [...css.matchAll(/\.slot-band[^{]*\{([^}]*)\}/gu)].map((t) => t[1] ?? '');
    expect(bandbloecke.length).toBeGreaterThan(0);
    for (const block of bandbloecke) {
      // `filter: none` darf stehen - das ist das Abschalten selbst, und
      // genau damit wird das Leuchten vom laufenden Band genommen.
      const ohneAbschalter = block.replace(/filter:\s*none\s*;/gu, '');
      expect(ohneAbschalter).not.toContain('filter:');
      expect(ohneAbschalter).not.toContain('box-shadow');
    }

    // Das Band traegt `opacity` - eine Compositor-Eigenschaft, die nichts
    // neu rastert.
    expect(css).toMatch(/\.slot-band \{[^}]*opacity: 0\.92/u);

    // Und die stehende Schlierenlage liegt auf dem Fenster, nicht im Band.
    expect(css).toMatch(/\.slot-walze:not\(\.slot-walze--stopp\)::before \{/u);

    // Das Leuchten wird auf dem laufenden Band unterdrueckt: ein Glow um ein
    // Symbol, das mit ueber tausend Pixeln je Sekunde durchrauscht, ist
    // Rechenzeit ohne Aussage. Im Stillstand bleibt es vollstaendig.
    expect(css).toMatch(
      /\.slot-band \.slot-zelle--glow \.slot-zelle__bild,\s*\.slot-band \.slot-zelle--glow \.slot-zelle__text \{\s*filter: none;/u,
    );
  });

  it('kapselt die Walze, damit ihr Lauf nicht den Rest der Seite neu malt', () => {
    expect(css).toMatch(/\.slot-walze \{[^}]*contain: strict/u);
    expect(css).toMatch(/\.slot-walzen \{[^}]*contain: layout/u);
    expect(css).toMatch(/\.slot-buehne \{[^}]*contain: layout/u);
    expect(css).toMatch(/\.slot-buehne \{[^}]*isolation: isolate/u);
  });

  it('haelt die Nebenbewegungen an, solange die Walzen laufen - und nur solange', () => {
    /*
     * Pausiert, nicht entfernt. Ein pulsender Hintergrund und ein
     * Freispielschild, die waehrend des Spins stillstehen, kosten nichts und
     * fehlen niemandem; abgeschaltet waeren sie eine Designverschlechterung
     * und damit kein erlaubter Performancefix.
     */
    expect(css).toMatch(
      /\.slot-buehne--dreht \.slot-buehne__puls,\s*\.slot-buehne--dreht \.slot-frei-schild \{\s*animation-play-state: paused;/u,
    );
    expect(css).not.toMatch(/\.slot-buehne--dreht[^}]*display:\s*none/u);
  });

  it('nimmt auf schwachen Geräten Nebeneffekte weg, aber nichts vom Spiel', () => {
    const block = css.slice(css.indexOf('@media (max-width: 820px), (hover: none) and (pointer: coarse)'));
    const bis = block.slice(0, block.length);
    expect(bis).toContain('.slot-buehne__puls');
    expect(bis).toContain('backdrop-filter: none');
    expect(bis).toContain('.slot-partikel span:nth-child(2n)');
    /*
     * Was nicht angefasst werden darf: der Walzenlauf, die Gewinnlinie, der
     * Stopp. Eine billige Mobilfassung war ausdruecklich nicht gewollt.
     */
    expect(bis).not.toMatch(/\.slot-band\s*\{[^}]*animation:\s*none/u);
    expect(bis).not.toMatch(/\.slot-linie[^}]*display:\s*none/u);
    expect(bis).not.toMatch(/\.slot-walze--stopp[^}]*animation:\s*none/u);
  });
});

describe('Kein Bild kostet einen React-Durchlauf', () => {
  /**
   * ## Die Regel
   *
   * Der Spielstand darf React benutzen - er ist Zustand, und Zustand gehoert
   * dorthin. Die **Bewegung** darf es nicht: ein `setState` je Bild heisst
   * ein Render je Bild, und ein Render je Bild heisst Stilneuberechnung und
   * Abgleich fuer den ganzen Teilbaum, sechzig Mal in der Sekunde, waehrend
   * daneben eine CSS-Animation laeuft.
   *
   * Darum wird hier nachgesehen, dass jede Schleife, die Bild fuer Bild
   * laeuft, ihr Ergebnis **direkt** schreibt: in `textContent`, in eine
   * Stileigenschaft, ueber eine Referenz. Ein `set...` darf am Ende stehen,
   * wenn die Bewegung fertig ist - einmal, nicht sechzig Mal.
   */
  it('zaehlt den Gewinn im DOM hoch und nicht im Zustand', () => {
    const quelle = ohneKommentare(lies(MELDUNG));
    const block = quelle.slice(quelle.indexOf('export function Hochzaehlen'));
    const ende = block.indexOf('\nexport ', 1);
    const zaehler = ende > 0 ? block.slice(0, ende) : block;

    expect(zaehler).toContain('requestAnimationFrame');
    expect(zaehler).toContain('element.textContent =');
    /*
     * Hier stand `useState` plus `setWert` in der rAF-Schleife: 650 ms
     * Hochzaehlen waren rund vierzig Renderdurchlaeufe, und sie fielen
     * genau in den Moment, in dem die Gewinnlinien laufen.
     */
    expect(zaehler).not.toContain('useState');
    expect(zaehler).not.toMatch(/set[A-Z]\w*\(/u);
  });

  it('dreht das Rad ueber eine Referenz und meldet nur das Stehen an React', () => {
    const quelle = ohneKommentare(lies(RAD));
    const schleife = quelle.slice(
      quelle.indexOf('let bild = requestAnimationFrame'),
      quelle.indexOf('return () => cancelAnimationFrame(bild)'),
    );
    expect(schleife).toContain('zeichne(');
    // Genau ein Zustandswechsel, und der steht hinter dem letzten Bild.
    expect([...schleife.matchAll(/set[A-Z]\w*\(/gu)]).toHaveLength(1);
    expect(schleife).toContain('setSteht(true)');
  });
});

describe('Die Gewinnlinie misst nicht, sie bekommt gesagt', () => {
  const quelle = ohneKommentare(lies(WALZEN));
  const baum = ohneKommentare(lies(WALZENBILD));

  it('liest die Geometrie nur in der gebuendelten Messung - nirgends sonst', () => {
    /*
     * ## Warum das zaehlt
     *
     * Eine Linie wird nach dem Stopp gezeigt, mehrere nacheinander, jede mit
     * ihrem XP-Schild. Wuerde dabei gemessen, waere das ein erzwungenes
     * Layout mitten in der Abfolge - und zwar genau dann, wenn daneben noch
     * die Trefferzellen pulsen und die Summe hochzaehlt.
     *
     * Die Punkte liegen deshalb schon vor: `mitten` und `kasten` kommen aus
     * der Messung, die beim Groessenwechsel laeuft, und `Gewinnlinie` wie
     * `LinienSchild` bekommen sie als Eigenschaften herein.
     */
    const stellen = [...quelle.matchAll(/getBoundingClientRect/gu)];
    expect(stellen).toHaveLength(2);

    const messen = quelle.slice(
      quelle.indexOf('const messen = useCallback'),
      quelle.indexOf('const bild = useRef'),
    );
    expect([...messen.matchAll(/getBoundingClientRect/gu)]).toHaveLength(2);

    /*
     * Und im Baum **kein einziges** Mal.
     *
     * Das ist nicht nur eine Zaehlung: `walzenbild.tsx` uebersetzt mit
     * `lib: ES2022` und ohne DOM-Bibliothek - ein `getBoundingClientRect`
     * darin wuerde schon den Typcheck brechen. Genau deshalb liegt der
     * Schnitt dort, wo er liegt.
     */
    expect(baum).not.toContain('getBoundingClientRect');

    // Die beiden Linienbauteile rechnen aus ihren Eigenschaften.
    const linie = baum.slice(
      baum.indexOf('export function Gewinnlinie'),
      baum.indexOf('function LinienSchild'),
    );
    const schild = baum.slice(baum.indexOf('function LinienSchild'));
    for (const teil of [linie, schild]) {
      expect(teil.length).toBeGreaterThan(0);
      // Die Punkte kommen aus `mitten` - also aus der Messung von vorher.
      expect(teil).toContain('mitten[index]');
      // Und ohne Masse wird nichts gezeichnet, statt durch null zu teilen.
      expect(teil).toContain('kasten.breite <= 0 || kasten.hoehe <= 0');
    }
  });
});

describe('Kein Netzzugriff und kein Dekodieren im Spin', () => {
  it('laedt und dekodiert die Symbolbilder vor dem ersten Spin', () => {
    /*
     * `decode()` ist der Teil, der leicht fehlt. Ein `new Image()` mit
     * gesetztem `src` **laedt** die Datei, aber dekodiert sie erst, wenn sie
     * gebraucht wird - und das ist der erste Spin, im Hauptfaden, mitten in
     * der Animation. `decode()` zieht diese Arbeit auf den Moment vor, in
     * dem nichts animiert.
     */
    const quelle = ohneKommentare(lies(SPIEL));
    expect(quelle).toContain('new window.Image()');
    expect(quelle).toContain('bild.src = adresse');
    expect(quelle).toContain('bild.decode?.()');
    // Ohne Freigabe-Bedingung: Vorladen braucht keine Nutzergeste.
    const effekt = quelle.slice(quelle.indexOf('for (const symbol of ansicht.symbole)'));
    expect(effekt.slice(0, effekt.indexOf('}, ['))).not.toContain('freigegeben');
  });

  it('spielt Klaenge aus vorbereiteten Puffern - kein Element je Walzenstopp', () => {
    /*
     * Der Motor steht in `tonmotor.ts` und ist dort mit einer Attrappe
     * geprueft (`xpslot-tonmotor.test.ts`): ein Kontext, Puffer statt
     * Dateien, ein Knoten je Klang, Rampen statt Zeitgeber. Hier wird nur
     * nachgesehen, dass `klang.ts` ihn auch **zuerst** fragt - sonst laege
     * der ganze Aufwand daneben.
     */
    const quelle = ohneKommentare(lies(KLANG));
    for (const name of ['const spiele = useCallback', 'const starteSchleife = useCallback']) {
      const block = quelle.slice(quelle.indexOf(name));
      const motorStelle = block.indexOf('motor?.hat(slot)');
      const elementStelle = block.indexOf('hole(slot)');
      expect(motorStelle).toBeGreaterThan(-1);
      expect(elementStelle).toBeGreaterThan(-1);
      expect(motorStelle).toBeLessThan(elementStelle);
    }
    // Und der Kontext wacht aus der Geste auf, nicht aus einem Effekt.
    const freigeben = quelle.slice(quelle.indexOf('const freigeben = useCallback'));
    expect(freigeben.slice(0, freigeben.indexOf('}, ['))).toContain('motorRef.current?.wecke()');
  });
});
