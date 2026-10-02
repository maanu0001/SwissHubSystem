import { describe, expect, it } from 'vitest';
import { heller, istFarbe, normalisiereFarbe } from '@swisshub/shared';

/**
 * Farbwerte aus fremder Hand.
 *
 * ## Was hier tatsaechlich geprueft wird
 *
 * Nicht «erkennt `#fff`» - das ist der leichte Teil. Sondern die Zusicherung,
 * an der die Sicherheit haengt: **es gibt keinen Weg, durch den eine Eingabe
 * unveraendert in die Ausgabe gelangt.** Der Rueckgabewert ist `#` plus sechs
 * Hexziffern oder `null`, immer.
 *
 * Das ist nicht Theorie. Dieser Wert landet in einem `style`-Attribut einer
 * Komponente, die der Server zu einem PNG rendert. Waere er durchreichbar,
 * waere `red; background-image: url(https://…)` ein Abruf einer fremden Adresse
 * durch unseren Server - ausgeloest von dem, der die Einstellung tippt.
 */
describe('normalisiereFarbe: was angenommen wird', () => {
  it.each([
    ['#83060a', '#83060a'],
    ['#83060A', '#83060a'],
    ['  #83060a  ', '#83060a'],
    ['#fff', '#ffffff'],
    ['#F0A', '#ff00aa'],
    ['rgb(131, 6, 10)', '#83060a'],
    ['rgb(131,6,10)', '#83060a'],
    ['RGB(0, 0, 0)', '#000000'],
    ['rgb(255 255 255)', '#ffffff'],
  ])('%s wird %s', (eingabe, erwartet) => {
    expect(normalisiereFarbe(eingabe)).toBe(erwartet);
  });
});

describe('normalisiereFarbe: was null ergibt', () => {
  it.each([
    ['', 'leer heisst «Standardfarbe», nicht Schwarz'],
    ['   ', 'nur Leerzeichen ebenso'],
    ['83060a', 'ohne Raute'],
    ['#8306', 'vier Ziffern sind keine Kurzform'],
    ['#83060ag', 'ein Buchstabe, der keine Hexziffer ist'],
    ['#83060a0', 'sieben Ziffern'],
    ['darkred', 'Farbnamen sind nicht erlaubt'],
    ['rgb(300, 0, 0)', '300 ist kein Kanal und auch nicht «fast 255»'],
    ['rgb(1, 2)', 'zwei Kanaele sind keine Farbe'],
    ['rgba(1, 2, 3, 0.5)', 'Transparenz gibt es hier nicht'],
    ['hsl(0, 100%, 50%)', 'HSL ist nicht vorgesehen'],
  ])('%s ergibt null - %s', (eingabe) => {
    expect(normalisiereFarbe(eingabe)).toBeNull();
    expect(istFarbe(eingabe)).toBe(false);
  });

  it('ergibt null fuer null und undefined', () => {
    expect(normalisiereFarbe(null)).toBeNull();
    expect(normalisiereFarbe(undefined)).toBeNull();
  });
});

describe('normalisiereFarbe: nichts kommt unveraendert durch', () => {
  it.each([
    'red; background-image: url(https://example.invalid/pixel.png)',
    '#fff; position: fixed',
    'url(https://example.invalid/a.png)',
    'var(--etwas)',
    '#000000"><script>alert(1)</script>',
    'expression(alert(1))',
    '#83060a;',
    '#83060a #000000',
  ])('%s ergibt null statt einer Zeichenkette mit Beiwerk', (angriff) => {
    expect(normalisiereFarbe(angriff)).toBeNull();
  });

  it('gibt ausschliesslich #rrggbb oder null zurueck - fuer jede Eingabe', () => {
    const eingaben = [
      '#83060a',
      '#fff',
      'rgb(1,2,3)',
      'red',
      '',
      'rgb(999,0,0)',
      'url(x)',
      '#83060a; color: red',
      '\n#fff\n',
      'RGB( 10 , 20 , 30 )',
    ];
    for (const eingabe of eingaben) {
      const ergebnis = normalisiereFarbe(eingabe);
      if (ergebnis !== null) {
        expect(ergebnis).toMatch(/^#[0-9a-f]{6}$/u);
      }
    }
  });
});

/**
 * Der hellere Ton.
 *
 * Aufgehellt und nicht abgedunkelt, weil der Grund der Grafiken dunkel ist. Bei
 * einer dunklen Markenfarbe - Marineblau, Flaschengruen - waere ein noch
 * dunklerer Akzent darin verschwunden.
 */
describe('heller: der zweite Ton', () => {
  it('bleibt eine gueltige Farbe', () => {
    expect(heller('#83060a')).toMatch(/^#[0-9a-f]{6}$/u);
  });

  it('wird heller und nicht dunkler - fuer jeden Kanal', () => {
    const quelle = '#102030';
    const ziel = heller(quelle);
    for (const start of [1, 3, 5]) {
      const vorher = Number.parseInt(quelle.slice(start, start + 2), 16);
      const nachher = Number.parseInt(ziel.slice(start, start + 2), 16);
      expect(nachher).toBeGreaterThan(vorher);
    }
  });

  it('laesst Weiss Weiss - es gibt nichts Helleres', () => {
    expect(heller('#ffffff')).toBe('#ffffff');
  });

  it('macht aus Schwarz einen sichtbaren Grauton statt Weiss', () => {
    const ton = heller('#000000');
    expect(ton).not.toBe('#000000');
    expect(ton).not.toBe('#ffffff');
  });

  it('ergibt bei anteil 1 Weiss und bei 0 die Ausgangsfarbe', () => {
    expect(heller('#83060a', 1)).toBe('#ffffff');
    expect(heller('#83060a', 0)).toBe('#83060a');
  });

  it('nimmt auch eine Kurzform an', () => {
    expect(heller('#000')).toBe(heller('#000000'));
  });
});
