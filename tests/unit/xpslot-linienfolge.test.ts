import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { level } from '@swisshub/modules';
import {
  LINIEN_ZEITEN,
  linienfolge,
  type FolgeLage,
  type LinienTrefferSicht,
} from '@/modules/level/xpslot/components/linienfolge';

/**
 * Jede gewonnene Linie wird genau einmal gezeigt.
 *
 * ## Die Gleichung, um die es geht
 *
 * Das Konzept verlangt sie ausdruecklich: liefert der Server N Gewinnlinien,
 * zeigt die Oberflaeche N Linien, spielt N Linienklaenge und schreibt N
 * XP-Schilder. Nicht N-1, nicht N+1, und nicht abhaengig vom Animationstiming.
 *
 *     linienfolge(treffer, lage).schritte.length === treffer.length
 *
 * Alle drei Zahlen haengen an derselben Liste: die Oberflaeche laeuft einmal
 * ueber `schritte` und setzt je Schritt die sichtbare Linie (Linie + Schild)
 * und meldet `winLineShown` (Klang). Wer diese Gleichung haelt, haelt alle
 * drei.
 *
 * ## Der Fehler, den dieser Test festnagelt
 *
 * Vorher entschied eine Zeile in der Oberflaeche:
 *
 *     const einzelneLinien = spin.treffer.length > 1 && !schnell && !wenigerBewegung;
 *
 * und der Gegenzweig griff nur bei **genau einer** Linie. Mit Quick Spin und
 * vier Gewinnlinien war beides falsch - keine Linie, kein Schild, kein Klang.
 * Darum probiert dieser Test jede Lage durch, nicht nur die ruhige.
 */

/**
 * Die Lagen, in denen die Reihe vollstaendig laufen muss.
 *
 * `uebersprungen` ist hier ueberall falsch - der Sprung ist die eine
 * Ausnahme, und er hat seinen eigenen Abschnitt weiter unten. Die Stufe ist
 * `normal`: ohne grosse Meldung, damit diese Tests nur die Anzahl messen.
 */
const LAGEN: FolgeLage[] = [
  { schnell: false, wenigerBewegung: false, bonusAusgeloest: false, uebersprungen: false, stufe: 'normal' },
  { schnell: true, wenigerBewegung: false, bonusAusgeloest: false, uebersprungen: false, stufe: 'normal' },
  { schnell: false, wenigerBewegung: true, bonusAusgeloest: false, uebersprungen: false, stufe: 'normal' },
  { schnell: true, wenigerBewegung: true, bonusAusgeloest: false, uebersprungen: false, stufe: 'normal' },
  { schnell: false, wenigerBewegung: false, bonusAusgeloest: true, uebersprungen: false, stufe: 'normal' },
  { schnell: true, wenigerBewegung: true, bonusAusgeloest: true, uebersprungen: false, stufe: 'normal' },
];

/** Die ruhige Lage, mit einer Stufe nach Wahl. */
const ruhig = (teile: Partial<FolgeLage> = {}): FolgeLage => ({
  schnell: false,
  wenigerBewegung: false,
  bonusAusgeloest: false,
  uebersprungen: false,
  stufe: 'normal',
  ...teile,
});

const bezeichnung = (lage: FolgeLage): string =>
  [
    lage.schnell ? 'Quick Spin' : 'normal',
    lage.wenigerBewegung ? 'weniger Bewegung' : 'volle Bewegung',
    lage.bonusAusgeloest ? 'mit Bonus' : 'ohne Bonus',
  ].join(' / ');

/** N Treffer mit unterschiedlichen Linien und Stufen. */
function treffer(anzahl: number): LinienTrefferSicht[] {
  const stufen: level.xpslot.Gewinnstufe[] = ['klein', 'normal', 'gross', 'mega', 'jackpot'];
  return Array.from({ length: anzahl }, (_, index) => ({
    linie: index,
    stufe: stufen[index % stufen.length]!,
  }));
}

describe('XP-Slot Gewinnlinien-Folge', () => {
  for (const anzahl of [1, 2, 3, 5, 8, 10]) {
    for (const lage of LAGEN) {
      it(`zeigt ${anzahl} Linien bei ${bezeichnung(lage)}`, () => {
        const folge = linienfolge(treffer(anzahl), lage);

        // Die Anzahl: genau N Schritte - also N Linien, N Schilder, N Klaenge.
        expect(folge.schritte).toHaveLength(anzahl);
        // Die Reihenfolge: die des Servers, unveraendert.
        expect(folge.schritte.map((schritt) => schritt.linie)).toEqual(
          treffer(anzahl).map((eintrag) => eintrag.linie),
        );
        // Die Stufen: je Linie ihre eigene, nicht die des ganzen Spins.
        expect(folge.schritte.map((schritt) => schritt.stufe)).toEqual(
          treffer(anzahl).map((eintrag) => eintrag.stufe),
        );
        // Keine Linie doppelt.
        expect(new Set(folge.schritte.map((schritt) => schritt.linie)).size).toBe(anzahl);
        // Und kein zusaetzlicher Gesamtklang: er waere einer zu viel.
        expect(folge.gesamtklang).toBe(false);
      });
    }
  }

  it('zeigt bei zehn Linien in jeder Lage dieselben zehn', () => {
    const erwartet = treffer(10).map((eintrag) => eintrag.linie);
    for (const lage of LAGEN) {
      expect(linienfolge(treffer(10), lage).schritte.map((schritt) => schritt.linie)).toEqual(erwartet);
    }
  });

  it('spielt ohne Gewinnlinie den Gesamtklang', () => {
    const folge = linienfolge([], ruhig());
    expect(folge.schritte).toHaveLength(0);
    expect(folge.gesamtklang).toBe(true);
  });

  it('ueberlaesst dem Bonus seinen Klang, auch ohne Gewinnlinie', () => {
    const folge = linienfolge([], ruhig({ bonusAusgeloest: true }));
    expect(folge.gesamtklang).toBe(false);
  });

  it('haelt dieselbe Linie nicht doppelt zusammen, wenn der Server sie doppelt schickt', () => {
    /*
     * Der Server tut das nicht - je Linie gibt es einen Treffer. Aber wenn,
     * dann ist es seine Aussage und nicht unsere: entdoppelt wird hier
     * nichts, weil nur er wissen kann, was ein Duplikat waere.
     */
    const folge = linienfolge(
      [
        { linie: 3, stufe: 'klein' },
        { linie: 3, stufe: 'klein' },
      ],
      ruhig(),
    );
    expect(folge.schritte).toHaveLength(2);
  });

  it('verkuerzt die Anzeige im Quick Spin, ohne eine Linie zu verlieren', () => {
    const gelassen = linienfolge(treffer(4), ruhig());
    const knapp = linienfolge(treffer(4), ruhig({ schnell: true }));
    expect(gelassen.dauerMs).toBe(LINIEN_ZEITEN.ruhig);
    expect(knapp.dauerMs).toBe(LINIEN_ZEITEN.knapp);
    expect(knapp.dauerMs).toBeLessThan(gelassen.dauerMs);
    expect(knapp.schritte).toHaveLength(gelassen.schritte.length);
  });

  it('laesst dem Bonusklang Platz vor der ersten Linie', () => {
    const mitBonus = linienfolge(treffer(2), ruhig({ bonusAusgeloest: true }));
    const ohne = linienfolge(treffer(2), ruhig());
    expect(mitBonus.vorlaufMs).toBe(LINIEN_ZEITEN.vorlauf);
    expect(ohne.vorlaufMs).toBe(0);
  });
});

/**
 * Und dass die Oberflaeche sich an den Plan haelt.
 *
 * Die Gleichung oben gilt fuer die Funktion. Sie gilt fuer das Spiel nur,
 * solange die Oberflaeche nichts anderes tut - also keine zweite
 * Fallunterscheidung ueber Quick Spin oder reduzierte Bewegung aufmacht und
 * die Linien in einer Schleife ueber `schritte` zeigt. Genau das wird hier
 * gelesen.
 */
describe('XP-Slot Spieloberflaeche haelt sich an den Plan', () => {
  const quelle = readFileSync('apps/web/src/modules/level/xpslot/components/spiel.tsx', 'utf8');
  /** Ohne Kommentare, damit keine Erklaerung als Code zaehlt. */
  const code = quelle.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '');

  it('entscheidet die Linienfolge mit linienfolge()', () => {
    expect(code).toContain('const folge = linienfolge(spin.treffer, {');
  });

  it('laeuft einmal ueber die Schritte des Plans', () => {
    expect(code).toContain('for (const schritt of folge.schritte) {');
    expect(code).toContain("melde({ art: 'winLineShown', stufe: schritt.stufe });");
    expect(code).toContain('setSichtbareLinie(schritt.linie);');
  });

  it('kennt kein einzelneLinien mehr', () => {
    // Die Zeile, die vier Linien im Quick Spin verschluckt hat.
    expect(code).not.toContain('einzelneLinien');
  });

  it('macht die Zahl der Linien von keinem Animationszustand abhaengig', () => {
    // Zwischen Plan und Schleife darf nichts stehen, das `schnell` oder
    // `wenigerBewegung` noch einmal befragt.
    const anfang = code.indexOf('const folge = linienfolge(');
    const ende = code.indexOf('for (const schritt of folge.schritte)');
    expect(anfang).toBeGreaterThan(0);
    expect(ende).toBeGreaterThan(anfang);
    // Hinter dem Aufruf selbst: dort stehen die beiden Angaben als Lage, und
    // dort gehoeren sie hin. Danach darf sie niemand mehr befragen.
    const nachPlan = code.indexOf('});', anfang) + 3;
    const dazwischen = code.slice(nachPlan, ende);
    expect(dazwischen).not.toMatch(/\bschnell\b/u);
    expect(dazwischen).not.toMatch(/\bwenigerBewegung\b/u);
  });

  it('meldet den Abschluss und gibt die Buehne wieder frei', () => {
    expect(code).toContain('setSichtbareLinie(null);');
    expect(code).toContain("melde({ art: 'allLinesFinished' });");
  });

  it('zeigt den Gesamtgewinn erst nach der Reihe', () => {
    /*
     * `sichtbareLinie === null` genuegte dafuer nicht: `null` heisst vor der
     * Reihe «noch keine Linie» und nach ihr «alle». Jetzt haengt die Summe an
     * `alleZellen`, und das ist nur das zweite der beiden.
     */
    expect(code).toContain('!laufend.some(Boolean) && alleZellen');
  });

  it('hebt vor der Reihe keine einzige Gewinnzelle hervor', () => {
    /*
     * ## Der Fehler, den das festnagelt
     *
     * Zwischen Walzenstopp und erster Linie leuchteten alle Gewinnfelder
     * gemeinsam auf - 170 Millisekunden lang stand das ganze Ergebnis da,
     * bevor die Reihe es erzaehlte. Die Hervorhebung muss deshalb zwei Dinge
     * unterscheiden: «diese eine Linie» und «ausdruecklich alle».
     */
    expect(code).toContain('if (sichtbareLinie !== null) {');
    expect(code).toContain('return alleZellen ? ergebnis.treffer.flatMap((treffer) => treffer.zellen) : [];');
    // Und am Spinanfang steht beides auf null bzw. aus.
    expect(code).toContain('setAlleZellen(false);');
    expect(code).toContain('setGrosseMeldung(null);');
  });

  it('beendet beim Sprung die Reihe und zeigt alles auf einmal', () => {
    // Der Sprung wird gemerkt, bevor der Hebel zurueckgesetzt wird.
    expect(code).toContain('const uebersprungen = uebersprungenRef.current;');
    expect(code).toContain('uebersprungen,');
    expect(code).toContain('if (folge.sofortAlle) {');
    // Auch ein Sprung mitten in der Reihe beendet sie.
    expect(code).toContain('if (uebersprungenRef.current) {\n          break;');
  });

  it('zeigt die grosse Meldung nach der Reihe', () => {
    expect(code).toContain('if (folge.meldung) {');
    expect(code).toContain('setGrosseMeldung({ stufe: folge.meldung, gewinn: spin.gewinn });');
    expect(code).toContain('await warte(folge.meldungMs);');
    expect(code).toContain('<GrosserGewinn');
  });

  it('wartet in der Reihe ohne Sprungmoeglichkeit', () => {
    // Der Sprung ist nach dem Walzenstopp verbraucht: `warte`, nicht
    // `warteOderSpringe` - sonst waere Skip Spin gleich Skip Winning Lines.
    expect(code).toContain('await warte(folge.dauerMs);');
    expect(code).not.toContain('warteOderSpringe(folge.dauerMs)');
  });
});

/**
 * Der Sprung, die grosse Meldung und die Klaenge - am Plan gemessen.
 *
 * Alles drei sind Aussagen ueber **eine** Entscheidung, und sie steht in
 * `linienfolge`. Was die Oberflaeche daraus macht, ist eine Schleife und ein
 * paar `setState`; was sie machen **darf**, steht hier.
 */
describe('XP-Slot: Sprung, grosse Meldung, Klaenge', () => {
  it('laesst beim Sprung die Reihe weg und zeigt alles auf einmal', () => {
    const folge = linienfolge(treffer(5), ruhig({ uebersprungen: true }));
    expect(folge.schritte).toHaveLength(0);
    expect(folge.sofortAlle).toBe(true);
  });

  it('spielt beim Sprung genau einen Klang statt einer Kette', () => {
    const folge = linienfolge(treffer(5), ruhig({ uebersprungen: true, stufe: 'gross' }));
    // Ein Gesamtklang - und keine Fanfare obendrauf.
    expect(folge.gesamtklang).toBe(true);
    expect(folge.abschlussklang).toBeNull();
  });

  it('zeigt beim Sprung trotzdem die grosse Meldung', () => {
    for (const stufe of ['gross', 'mega', 'jackpot'] as const) {
      const folge = linienfolge(treffer(3), ruhig({ uebersprungen: true, stufe }));
      expect(folge.meldung, stufe).toBe(stufe);
    }
  });

  it('kuendigt die grosse Meldung nur ab Big Win an', () => {
    for (const stufe of ['keine', 'klein', 'normal'] as const) {
      expect(linienfolge(treffer(2), ruhig({ stufe })).meldung, stufe).toBeNull();
    }
    for (const stufe of ['gross', 'mega', 'jackpot'] as const) {
      expect(linienfolge(treffer(2), ruhig({ stufe })).meldung, stufe).toBe(stufe);
    }
  });

  it('laesst Mega und Jackpot laenger stehen als Big Win', () => {
    const big = linienfolge(treffer(2), ruhig({ stufe: 'gross' }));
    const mega = linienfolge(treffer(2), ruhig({ stufe: 'mega' }));
    const jackpot = linienfolge(treffer(2), ruhig({ stufe: 'jackpot' }));
    expect(big.meldungMs).toBe(LINIEN_ZEITEN.meldung);
    expect(mega.meldungMs).toBe(LINIEN_ZEITEN.meldungStark);
    expect(jackpot.meldungMs).toBe(LINIEN_ZEITEN.meldungStark);
    expect(mega.meldungMs).toBeGreaterThan(big.meldungMs);
  });

  it('spielt die Fanfare nach der Reihe - aber nicht als Echo', () => {
    // Vier Linien, Gesamtstufe gross: die Fanfare gehoert dem ganzen Spin.
    const viele = linienfolge(treffer(4), ruhig({ stufe: 'gross' }));
    expect(viele.abschlussklang).toBe('gross');

    /*
     * Eine Linie, und ihre Stufe ist die des Spins: diese Linie hat den Klang
     * schon gespielt. Ein zweites Mal waere kein zweiter Gewinn.
     */
    const einzeln = linienfolge([{ linie: 0, stufe: 'gross' }], ruhig({ stufe: 'gross' }));
    expect(einzeln.abschlussklang).toBeNull();

    // Eine Linie mit anderer Stufe als der Spin - dann fehlt die Fanfare nicht.
    const anders = linienfolge([{ linie: 0, stufe: 'klein' }], ruhig({ stufe: 'gross' }));
    expect(anders.abschlussklang).toBe('gross');
  });

  it('haelt die Anzahl der Linien auch mit grosser Meldung', () => {
    // Die Meldung kommt dazu; sie ersetzt keine Linie.
    for (const stufe of ['gross', 'mega', 'jackpot'] as const) {
      expect(linienfolge(treffer(7), ruhig({ stufe })).schritte, stufe).toHaveLength(7);
    }
  });
});
