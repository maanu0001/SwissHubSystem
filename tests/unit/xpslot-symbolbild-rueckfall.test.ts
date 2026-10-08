import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { branding } from '@swisshub/modules';

/**
 * Ein Slot-Symbol ist nie leer - und ein Upload scheitert nie stumm.
 *
 * ## Was gemeldet war
 *
 * «Obwohl die Bildadresse korrekt gesetzt ist, werden die Symbole nicht
 * angezeigt. Bilder als PNG hochladen kann ich auch noch nicht.» Dazu ein
 * Bildschirmfoto: dreizehn Zellen mit dem Fragezeichen des Browsers, eine
 * heile. Die heile war das mitgelieferte Symbol; die uebrigen trugen eine
 * Adresse.
 *
 * ## Die beiden Ursachen
 *
 * **Anzeige.** Es gab nirgends ein `onError`. Laedt ein Bild nicht - fremder
 * Server weg, Einbetten verboten, HTML statt Bild, Tippfehler -, blieb das
 * kaputte Feld stehen. Der Rueckfall auf das mitgelieferte Symbol griff nur,
 * wenn **gar keine** Referenz da war.
 *
 * **Upload.** Die Verwaltung rief `antwort.json()` ohne zu pruefen, was
 * ankam, und ohne `catch` darum. Antwortete etwas anderes als diese Route,
 * warf `json()`, und es geschah gar nichts: keine Meldung, kein Hinweis.
 * Dazu eine Byte-Grenze von 12 MB - eine quadratische PNG mit Transparenz
 * ist bei 2048 Pixeln bereits genau so gross.
 */

const WURZEL = process.cwd();
const lies = (pfad: string): string => readFileSync(join(WURZEL, pfad), 'utf8');

const ohneKommentare = (pfad: string): string =>
  lies(pfad)
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/(^|[^:])\/\/.*$/gmu, '$1');

const GRAFIK = 'apps/web/src/modules/level/xpslot/components/symbol-grafik.tsx';

describe('Symbolbild: der Rueckfall liegt im Browser, weil nur er es weiss', () => {
  it('faengt den Ladefehler ab', () => {
    const quelle = ohneKommentare(GRAFIK);
    expect(quelle).toContain('onError');
  });

  it('sieht beim Anhaengen nach, statt nur auf `onError` zu warten', () => {
    /*
     * Das war der eigentliche Grund, warum ein erster Anlauf nichts aenderte.
     * Die Walzen kommen vom Server; der Browser laedt die Bilder, bevor React
     * laeuft. Gemessen am gebauten Server: die `error`-Ereignisse fielen 603
     * Millisekunden nach dem Aufruf, siebenmal - vor der Hydrierung. React
     * spielt abgelaufene Ereignisse nicht nach, der Handler wartete also auf
     * etwas, das schon vorbei war. Von 45 Zellen blieben 6 kaputt.
     *
     * Ein `ref`, das `complete` ohne Breite findet, deckt diese Luecke ab.
     * Nimmt jemand die Pruefung weg, kommt der Fehler genau so zurueck.
     */
    const quelle = ohneKommentare(GRAFIK);
    expect(quelle).toContain('complete');
    expect(quelle).toContain('naturalWidth');
    expect(quelle).toMatch(/ref=\{nachsehen\}/u);
  });

  it('vermerkt die Kandidatenadresse und nicht die vom Browser aufgeloeste', () => {
    /*
     * `currentSrc` ist absolut (`http://host/xp-slot/...`), die
     * Kandidatenliste fuehrt relative Pfade. Wird das vermischt, passt der
     * Vermerk nie und die Zelle bleibt auf der kaputten Stufe stehen - der
     * Rueckfall waere wirkungslos, obwohl er vorhanden aussieht.
     */
    const quelle = ohneKommentare(GRAFIK);
    expect(quelle).not.toContain('currentSrc');
  });

  it('nimmt dann das mitgelieferte Symbol', () => {
    const quelle = ohneKommentare(GRAFIK);
    expect(quelle).toContain('STANDARD_SYMBOLE');
    // Erst das eigene, dann das mitgelieferte - in dieser Reihenfolge.
    expect(quelle).toMatch(/\[eigen,\s*standard\]/u);
  });

  it('bleibt beim Namen, wenn auch das mitgelieferte fehlt', () => {
    const quelle = ohneKommentare(GRAFIK);
    expect(quelle).toContain('slot-zelle__text');
  });

  it('merkt sich gescheiterte Adressen und nicht Stufen', () => {
    /*
     * Sonst muesste die Komponente neu eingehaengt werden, sobald jemand eine
     * neue Adresse eintraegt - und eine kaputte wuerde bei jedem Rendern
     * erneut geholt.
     */
    const quelle = ohneKommentare(GRAFIK);
    expect(quelle).toContain('gescheitert.includes');
  });

  it('wird von Walze, Verwaltung und Gewinntafel benutzt', () => {
    for (const datei of [
      'apps/web/src/modules/level/xpslot/components/walzenbild.tsx',
      'apps/web/src/modules/level/xpslot/components/verwaltung.tsx',
      'apps/web/src/modules/level/xpslot/components/infotafel.tsx',
    ]) {
      expect(ohneKommentare(datei), datei).toContain('SymbolGrafik');
      // Kein blankes `img` mit einer Symbolquelle daneben - sonst gaebe es
      // wieder eine Stelle ohne Rueckfall.
      expect(ohneKommentare(datei), datei).not.toMatch(/<img[^>]*src=\{bild\}/u);
    }
  });

  it('sagt in der Verwaltung, wenn eine Adresse nicht laedt', () => {
    // «Gespeichert» und «gespeichert, laedt aber nicht» sahen gleich aus.
    const verwaltung = lies('apps/web/src/modules/level/xpslot/components/verwaltung.tsx');
    expect(verwaltung).toContain('Adresse laedt nicht');
    expect(verwaltung).toContain('onFehler');
  });
});

describe('Symbol-Upload: nichts scheitert stumm', () => {
  const VERWALTUNG = 'apps/web/src/modules/level/xpslot/components/verwaltung.tsx';

  it('sieht nach, was ankam, bevor es als JSON gelesen wird', () => {
    const quelle = ohneKommentare(VERWALTUNG);
    expect(quelle).toContain("antwort.headers.get('content-type')");
    expect(quelle).toContain('application/json');
  });

  it('nennt beim rohen 413 des Proxy eine Zahl', () => {
    const quelle = lies(VERWALTUNG);
    expect(quelle).toContain('Die Datei ist zu gross. Maximal erlaubt:');
    expect(quelle).toContain('antwort.status === 413');
  });

  it('faengt jeden anderen Fehler ab, statt die Zusage abbrechen zu lassen', () => {
    // `finally` allein setzt nur den Ladezustand zurueck - die Person sieht
    // einen Knopf, der aufhoert zu drehen, und sonst nichts.
    const quelle = ohneKommentare(VERWALTUNG);
    expect(quelle).toMatch(/\}\s*catch\s*\(fehler\)\s*\{/u);
    expect(quelle).toContain('Der Upload ist gescheitert');
  });

  it('nennt dieselbe Zahl wie die Grenztabelle', () => {
    const quelle = lies(VERWALTUNG);
    const genannt = /const SYMBOL_MAX_MB = (\d+);/u.exec(quelle)?.[1];
    expect(Number(genannt) * 1024 * 1024).toBe(branding.UPLOAD_GRENZEN.slotsymbol.maxBytes);
  });
});

describe('Symbolbilder duerfen so gross sein, wie sie aus dem Programm kommen', () => {
  it('nimmt eine quadratische PNG mit Transparenz in 2048 Pixeln an', () => {
    /*
     * Nachgemessen: eine nicht komprimierbare PNG mit 2048 Pixeln
     * Kantenlaenge ist 16,0 MB mit Transparenz und genau 12,0 MB ohne. Die
     * alte Grenze lag bei 12 MB und damit punktgenau auf dem Normalfall.
     * Das ist kein Missbrauch, das ist ein Symbol aus einem
     * Grafikprogramm.
     */
    expect(branding.UPLOAD_GRENZEN.slotsymbol.maxBytes).toBeGreaterThan(12 * 1024 * 1024);
  });

  it('laesst auch 4096 Pixel Kantenlaenge zu', () => {
    expect(branding.UPLOAD_GRENZEN.slotsymbol.maxSize).toBeGreaterThanOrEqual(4096);
  });
});
