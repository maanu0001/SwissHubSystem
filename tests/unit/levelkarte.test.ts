import { describe, expect, it } from 'vitest';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  PRESTIGE_CARD_HEIGHT,
  PRESTIGE_TEXTFARBE,
  STANDARD_TEXTFARBE,
  formatXp,
  kuerzeAufBreite,
  messeText,
  normalisiereTextfarbe,
  pruefeKartenkontrast,
  renderLevelCardSvg,
} from '@swisshub/modules/level/karte';

/**
 * Die Levelkarte.
 *
 * Geprueft wird hier nicht, ob die Karte huebsch ist - das entscheidet kein
 * Test. Geprueft wird, was daran nachweisbar ist: dass jede Angabe darauf
 * steht, dass die Schriftvermessung stimmt, dass eine gewaehlte Farbe
 * tatsaechlich alle Texte erreicht, und dass nichts aus einem Anzeigenamen
 * heraus in das SVG gelangt, was dort anders gelesen wuerde.
 */

/** Eine Karte bauen, mit Voreinstellungen fuer alles Unwesentliche. */
function karte(teile: Partial<Parameters<typeof renderLevelCardSvg>[0]> = {}): string {
  return renderLevelCardSvg({ displayName: 'maanu', xp: 12_600, rank: 7, ...teile });
}

/** Die Werte aller `fill`-Angaben an `<text>`-Elementen. */
function textfarben(svg: string): string[] {
  const farben: string[] = [];
  for (const treffer of svg.matchAll(/<text[^>]*?fill="([^"]+)"/gu)) {
    if (treffer[1] && treffer[1] !== 'none') {
      farben.push(treffer[1]);
    }
  }
  return farben;
}

describe('Schriftvermessung nach DejaVu Sans', () => {
  it('kennt den Unterschied zwischen breiten und schmalen Zeichen', () => {
    /*
     * Der Grund, warum die Tabelle existiert. Vorher wurde mit einer
     * mittleren Zeichenbreite gerechnet - fuer beide Zeichenketten unten
     * also mit demselben Wert, obwohl die eine fast doppelt so breit ist.
     */
    const breit = messeText('WWWWWW', 38);
    const schmal = messeText('iiiiii', 38);
    expect(breit).toBeGreaterThan(schmal * 1.8);
  });

  it('misst die Schriftgrade linear', () => {
    expect(messeText('Test', 40)).toBeCloseTo(messeText('Test', 20) * 2, 5);
  });

  it('misst den fetten Schnitt breiter als den normalen', () => {
    expect(messeText('Anzeigename', 38, true)).toBeGreaterThan(messeText('Anzeigename', 38, false));
  });

  it('zählt ein Zeichen ausserhalb der Grundebene einmal', () => {
    // «🎮» besteht aus zwei UTF-16-Einheiten. Ueber `length` gezaehlt waere
    // es zweimal so breit, wie es wird.
    expect(messeText('🎮', 38)).toBeCloseTo(messeText('🎮🎮', 38) / 2, 5);
  });

  it('kürzt genau so weit, wie der Platz reicht', () => {
    const grenze = 300;
    const gekuerzt = kuerzeAufBreite('EinSehrLangerAnzeigenameOhneEnde', grenze, 38, true);

    expect(gekuerzt.endsWith('…')).toBe(true);
    expect(messeText(gekuerzt, 38, true)).toBeLessThanOrEqual(grenze);
    // Und nicht zu frueh: ein Zeichen mehr passte nicht mehr.
    const einsMehr = `${gekuerzt.slice(0, -1)}X…`;
    expect(messeText(einsMehr, 38, true)).toBeGreaterThan(grenze - messeText('X', 38, true));
  });

  it('lässt einen passenden Namen unangetastet', () => {
    expect(kuerzeAufBreite('maanu', 500, 38, true)).toBe('maanu');
  });

  it('kürzt breite und schmale Namen unterschiedlich weit', () => {
    const breit = kuerzeAufBreite('WWWWWWWWWWWWWWWWWWWW', 200, 38, true);
    const schmal = kuerzeAufBreite('iiiiiiiiiiiiiiiiiiii', 200, 38, true);
    expect([...schmal].length).toBeGreaterThan([...breit].length);
  });
});

describe('Farbe prüfen und normalisieren', () => {
  it.each([
    ['#ff9f1c', '#FF9F1C'],
    ['FF9F1C', '#FF9F1C'],
    ['  #f0a  ', '#FF00AA'],
    ['#FFF', '#FFFFFF'],
  ])('macht aus %s die Farbe %s', (eingabe, erwartet) => {
    expect(normalisiereTextfarbe(eingabe)).toBe(erwartet);
  });

  it.each([
    ['red'],
    ['rgb(255,0,0)'],
    ['url(#boese)'],
    ['#12345'],
    ['#GGGGGG'],
    [''],
    ['#FF9F1C; fill:url(#x)'],
  ])('weist %s zurück', (eingabe) => {
    expect(normalisiereTextfarbe(eingabe)).toBeNull();
  });

  it('weist auch null und undefined zurück', () => {
    expect(normalisiereTextfarbe(null)).toBeNull();
    expect(normalisiereTextfarbe(undefined)).toBeNull();
  });

  it('hält Weiss und Gold für gut lesbar', () => {
    expect(pruefeKartenkontrast(STANDARD_TEXTFARBE).stufe).toBe('gut');
    expect(pruefeKartenkontrast(PRESTIGE_TEXTFARBE).stufe).toBe('gut');
  });

  it('warnt vor einer Farbe, die auf der Karte untergeht', () => {
    const befund = pruefeKartenkontrast('#2A0A0C');
    expect(befund.stufe).toBe('kritisch');
    expect(befund.hinweis).toBeTruthy();
    // Und sagt dazu, dass die Farbe trotzdem verwendet wird.
    expect(befund.hinweis).toContain('trotzdem');
  });

  it('rechnet nicht mit dem Mittelwert der Kanäle', () => {
    /*
     * Dunkelblau und Dunkelgruen haben denselben Zahlenwert in ihrem
     * jeweiligen Kanal. Fuer das Auge ist Gruen deutlich heller - eine
     * Rechnung ohne Gewichtung hielte beide fuer gleich lesbar.
     */
    expect(pruefeKartenkontrast('#008000').verhaeltnis).toBeGreaterThan(
      pruefeKartenkontrast('#000080').verhaeltnis * 1.5,
    );
  });
});

describe('Was auf der Karte steht', () => {
  it('zeigt weiterhin jede Angabe, die sie vorher zeigte', () => {
    const svg = karte({ displayName: 'maanu', xp: 12_600, rank: 7 });

    expect(svg).toContain('maanu');
    expect(svg).toContain('>18<'); // Level
    expect(svg).toContain('Rang #7');
    expect(svg).toContain('12’600 XP'); // XP mit Schweizer Trennung
    expect(svg).toContain('13’680 XP'); // die XP des naechsten Levels
    expect(svg).toContain('2 %'); // Fortschritt
  });

  it('behält die Masse der bisherigen Karte', () => {
    expect(karte()).toContain(`width="${CARD_WIDTH}" height="${CARD_HEIGHT}"`);
    expect(karte({ xp: 500_000, maxLevelTotalXp: 500_000 })).toContain(
      `width="${CARD_WIDTH}" height="${PRESTIGE_CARD_HEIGHT}"`,
    );
  });

  it('nennt im Höchstlevel keine nächste Stufe', () => {
    const svg = karte({ xp: 500_000, maxLevelTotalXp: 500_000 });
    expect(svg).toContain('Höchstlevel');
    expect(svg).not.toContain('Nächstes Level');
    expect(svg).toContain('100 %');
  });

  it('beschreibt sich für Screenreader mit allen Werten', () => {
    const svg = karte({ displayName: 'maanu', xp: 12_600, rank: 7 });
    const label = /aria-label="([^"]+)"/u.exec(svg)?.[1] ?? '';
    expect(label).toContain('maanu');
    expect(label).toContain('Level 18');
    expect(label).toContain('Rang 7');
  });

  it('rechnet den Fortschritt nicht um', () => {
    // Die Balkenbreite folgt dem Fortschritt und nicht umgekehrt.
    const halb = karte({ xp: 13_130 }); // genau zwischen 12'580 und 13'680
    expect(halb).toContain('50 %');
  });
});

describe('Die gewählte Textfarbe', () => {
  it('erreicht sämtliche Texte der Karte, nicht nur den Namen', () => {
    const svg = karte({ textColor: '#39FF14' });
    const farben = textfarben(svg);

    expect(farben.length).toBeGreaterThanOrEqual(5);
    expect(new Set(farben)).toEqual(new Set(['#39FF14']));
  });

  it('gilt auch im Höchstlevel', () => {
    // Gold ist dort die Voreinstellung - aber eben nur die Voreinstellung.
    const svg = karte({ xp: 500_000, maxLevelTotalXp: 500_000, textColor: '#7DD3FC' });
    expect(new Set(textfarben(svg))).toEqual(new Set(['#7DD3FC']));
  });

  it('fällt ohne Angabe auf Weiss zurück - und im Höchstlevel auf Gold', () => {
    expect(new Set(textfarben(karte()))).toEqual(new Set([STANDARD_TEXTFARBE]));
    expect(new Set(textfarben(karte({ xp: 500_000, maxLevelTotalXp: 500_000 })))).toEqual(
      new Set([PRESTIGE_TEXTFARBE]),
    );
  });

  it('behandelt eine leere und eine ungültige Angabe wie keine Angabe', () => {
    /*
     * Der Fall nach der Migration: bestehende Karten haben keine Farbe. Und
     * der Fall, in dem trotz aller Pruefung etwas anderes in der Spalte
     * steht - die Karte darf das nicht in ihr SVG uebernehmen.
     */
    for (const roh of [null, undefined, '', 'red', 'url(#x)']) {
      expect(new Set(textfarben(karte({ textColor: roh })))).toEqual(new Set([STANDARD_TEXTFARBE]));
    }
  });

  it('normalisiert eine kurze Angabe wie die Oberfläche', () => {
    expect(new Set(textfarben(karte({ textColor: 'f0a' })))).toEqual(new Set(['#FF00AA']));
  });

  it('setzt hinter dunkle Schrift einen hellen Saum und umgekehrt', () => {
    // Der Saum ist das, was die Schrift auch vor einem hellen Bild lesbar
    // haelt, ohne die gewaehlte Farbe anzutasten.
    expect(karte({ textColor: '#1A1A2E' })).toContain('stroke="#F2F2F4"');
    expect(karte({ textColor: '#FFFFFF' })).toContain('stroke="#08080A"');
  });
});

describe('Was aus einem Anzeigenamen nicht werden darf', () => {
  it('maskiert spitze Klammern und Anführungszeichen', () => {
    const svg = karte({ displayName: '<script>alert(1)</script>' });
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
  });

  it('maskiert auch im Beschreibungstext', () => {
    const svg = karte({ displayName: 'a"b' });
    const label = /aria-label="([^"]*)"/u.exec(svg)?.[1] ?? '';
    expect(label).not.toContain('"');
  });

  it('maskiert eine Bildadresse', () => {
    const svg = karte({ bannerSrc: 'https://example.test/a.png?a=1&b=2' });
    expect(svg).toContain('a=1&amp;b=2');
  });

  it('lässt kein unmaskiertes Sonderzeichen ins SVG', () => {
    const svg = karte({
      displayName: 'Ñoël «Züri» ✦ <b>&</b> "x" \'y\'',
      bannerSrc: 'https://example.test/a.png?a=1&b=2',
    });

    // Jedes «&» im Dokument gehört zu einer Entität - sonst bricht der Parser
    // in librsvg ab, und der Bot schickt gar kein Bild.
    expect(svg.replace(/&(?:amp|lt|gt|quot|apos|#\d+);/gu, '')).not.toContain('&');
    expect(svg).not.toContain('<b>');
  });

  it('bleibt ein ausgeglichenes Dokument', () => {
    /*
     * Kein vollwertiger Parser, aber die Zusage, auf die es ankommt: jedes
     * geoeffnete Element wird geschlossen, und zwar in der richtigen
     * Reihenfolge. Genau daran scheitert ein SVG, in das ein Anzeigename
     * eine eigene Klammer geschmuggelt hat.
     */
    const svg = karte({ displayName: '</text><script>x</script><text>' });
    const stapel: string[] = [];

    for (const treffer of svg.matchAll(/<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/gu)) {
      const [, schliessend, name, rest, selbstschliessend] = treffer;
      if (name === undefined) {
        continue;
      }
      if (schliessend) {
        expect(stapel.pop(), `</${name}> ohne passendes Öffnen`).toBe(name);
      } else if (!selbstschliessend && !rest?.trimEnd().endsWith('/')) {
        stapel.push(name);
      }
    }

    expect(stapel).toEqual([]);
    // Und der eingeschmuggelte Text steht als Text da, nicht als Element.
    expect(svg).not.toContain('<script>');
  });
});

describe('Ränder des Layouts', () => {
  it.each([
    ['sehr langer Name', 'EinAussergewöhnlichLangerAnzeigenameOhneJedesEnde2026'],
    ['nur breite Zeichen', 'WWWWWWWWWWWWWWWWWWWWWWWWWWWW'],
    ['nur schmale Zeichen', 'iiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii'],
    ['Sonderzeichen', 'Ñoël «Züri» ✦ Игорь'],
    ['ein Zeichen', 'x'],
    ['Leerzeichen aussen', '   Randfall   '],
  ])('setzt den Namen bei %s in den verfügbaren Platz', (_name, anzeigename) => {
    const svg = karte({ displayName: anzeigename });
    // Der gesetzte Name steht im ersten fetten Text der Karte.
    const gesetzt = /font-size="38" font-weight="bold"[^>]*>([^<]*)</u.exec(svg)?.[1] ?? '';
    expect(gesetzt.length).toBeGreaterThan(0);
    // Textanfang bei x=196, rechter Rand bei 866, dazu die Levelmarke.
    expect(messeText(gesetzt, 38, true)).toBeLessThanOrEqual(866 - 196);
  });

  it.each([0, 1, 5, 12_600, 999_999, 98_765_432])('kommt mit %d XP zurecht', (xp) => {
    const svg = karte({ xp, maxLevelTotalXp: 1_000_000_000 });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain(formatXp(xp));
  });

  it('zeichnet bei einem Prozent keinen verformten Balken', () => {
    /*
     * Ein Prozent von 670 Bildpunkten sind knapp sieben - schmaler als der
     * Radius der abgerundeten Enden. Gezeichnet wuerde dann ein Tropfen.
     */
    const svg = karte({ xp: 12_600 });
    const fuellung = [...svg.matchAll(/<rect x="196" y="150" width="(\d+)"/gu)].map((t) => Number(t[1]));
    const schmalste = Math.min(...fuellung.filter((wert) => wert < 600));
    expect(schmalste).toBeGreaterThanOrEqual(13);
  });

  it('kommt ohne Avatar und ohne Hintergrundbild aus', () => {
    const svg = karte({ avatarSrc: null, bannerSrc: null });
    expect(svg).not.toContain('<image');
    expect(svg).toContain('<circle');
  });
});
