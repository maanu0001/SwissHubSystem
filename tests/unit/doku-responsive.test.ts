import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Dass beide Dokumentationen auf einem Telefon lesbar bleiben.
 *
 * ## Woran es lag
 *
 * Die Lesespalte war auf einem iPhone rund 100px breit - ein Wort pro Zeile.
 * Nicht, weil die Schrift zu gross war, sondern weil neben dem Artikel eine
 * Randspalte stand, die niemand sah: «Auf dieser Seite» versteckte sich
 * selbst (`hidden xl:block`), ihr Wrapper aber blieb ein Flex-Kind mit
 * `w-56 shrink-0`. Ein Element, das sich nur selbst unsichtbar macht, gibt
 * seinen Platz nicht zurueck. Von 390px gingen 32px Seitenrand und 224px an
 * diese leere Spalte - der Rest war der Text.
 *
 * ## Warum daraus ein Test wird
 *
 * Der Fehler ist im Code unauffaellig: zwei korrekte Klassen an zwei
 * verschiedenen Stellen, die zusammen etwas Falsches ergeben. Keine Warnung,
 * kein Build-Fehler, und auf dem Rechner des Entwicklers sieht alles richtig
 * aus - er hat ja den breiten Bildschirm. Gemessen wurde der Fix im Browser
 * auf acht Viewports; was hier steht, haelt die Klassen fest, die diese
 * Messung bestanden haben, damit die leere Spalte nicht unbemerkt
 * zurueckkommt.
 */

const KOMPONENTEN = join(process.cwd(), 'apps/web/src/modules/docs/components');

const lies = (datei: string): string => readFileSync(join(KOMPONENTEN, datei), 'utf8');

const alleKomponenten = (): { datei: string; quelle: string }[] =>
  readdirSync(KOMPONENTEN)
    .filter((name) => name.endsWith('.tsx'))
    .map((datei) => ({ datei, quelle: lies(datei) }));

/**
 * Die Klassen eines Elements, gesucht ueber sein oeffnendes Tag.
 *
 * Bewusst der Rohtext und keine geparste Liste: geprueft wird auch, ob eine
 * Breitenangabe ein Breakpoint-Praefix traegt, und das ist Teil des
 * Klassennamens.
 *
 * Das Tag muss die Zeile beginnen. Ohne diesen Anker las der Test den
 * Kommentar ueber dem Element mit, der den alten Stand zitiert - und war
 * prompt rot, obwohl der Code stimmte. Ein Test ueber Quelltext sieht
 * Prosa und JSX gleich; der Unterschied muss im Muster stehen.
 */
function klassenVon(quelle: string, tag: string): string {
  const treffer = new RegExp(`^\\s*<${tag}\\b[^>]*className="([^"]*)"`, 'mu').exec(quelle);
  expect(treffer, `<${tag}> mit className nicht gefunden`).not.toBeNull();
  return treffer?.[1] ?? '';
}

/** Utilities ohne `sm:`/`lg:`/`xl:`/`2xl:` - also die, die auf dem Telefon gelten. */
function mobileUtilities(klassen: string): string[] {
  return klassen.split(/\s+/u).filter((klasse) => klasse.length > 0 && !klasse.includes(':'));
}

describe('Doku mobil: die Randspalte belegt keinen Platz', () => {
  it('versteckt die Randspalte am Wrapper, nicht nur in ihrem Inhalt', () => {
    const aside = klassenVon(lies('seite.tsx'), 'aside');

    // Der Kern des Fehlers. `hidden` muss am Element haengen, das im Flex
    // steht - sonst bleibt der Platz reserviert, auch wenn nichts zu sehen
    // ist.
    expect(mobileUtilities(aside)).toContain('hidden');
  });

  it('gibt der Randspalte keine Breite, die vor ihrem Breakpoint gilt', () => {
    const aside = klassenVon(lies('seite.tsx'), 'aside');

    // `w-56 shrink-0` ohne Praefix war die zweite Haelfte: 224px, die nie
    // nachgeben. Jede Breiten- und Schrumpfregel braucht ein Praefix, damit
    // sie erst greift, wenn die Spalte auch sichtbar ist.
    const ohnePraefix = mobileUtilities(aside).filter((klasse) =>
      /^(?:w-|min-w-|basis-|shrink-0$|flex-none$)/u.test(klasse),
    );
    expect(ohnePraefix).toEqual([]);
  });

  it('stapelt Artikel und Randspalte, solange beide nicht nebeneinander passen', () => {
    const quelle = lies('seite.tsx');

    // `flex` allein ist eine Zeile - auch auf 360px. Die Richtung muss
    // ausdruecklich erst am Breakpoint kippen.
    expect(quelle).toContain('flex-col 2xl:flex-row');
    // Und der Abstand zwischen den Spalten gehoert an denselben Breakpoint,
    // sonst steht gestapelt eine Luecke ohne zweite Spalte.
    expect(quelle).toContain('2xl:gap-8');
  });

  it('haelt Randspalte und ihren Inhalt auf demselben Breakpoint', () => {
    // Liefen die beiden auseinander, waere die Spalte entweder wieder leer
    // und breit oder sichtbar ohne Platz.
    expect(klassenVon(lies('seite.tsx'), 'aside')).toContain('2xl:block');
    expect(lies('auf-dieser-seite.tsx')).toContain('hidden 2xl:block');
  });

  it('laesst die linke Navigationsspalte unter lg keine Breite reservieren', () => {
    const quelle = lies('werk-ansicht.tsx');

    // Dieselbe Bauart eine Ebene hoeher: bis `lg` sind Suche und
    // Inhalts-Knopf eine normale Zeile, erst darueber eine feste Spalte.
    expect(quelle).toContain('flex-col gap-4 lg:flex-row');
    expect(quelle).toContain('lg:w-64 lg:shrink-0');
    expect(quelle).not.toMatch(/className="[^"]*\bw-64 shrink-0/u);
  });
});

describe('Doku mobil: die Lesespalte nutzt die Breite', () => {
  it('begrenzt den Fliesstext nicht auf eine Zeichenzahl', () => {
    // §6: ein `max-w-[40ch]` oder `prose` haette denselben Effekt wie die
    // leere Randspalte - nur freiwillig. `max-w-3xl` (768px) darf bleiben,
    // es bindet erst weit oberhalb jedes Telefons.
    for (const { datei, quelle } of alleKomponenten()) {
      expect(quelle, datei).not.toMatch(/max-w-\[\d+(?:ch|rem|em)\]/u);
      expect(quelle, datei).not.toMatch(/\bprose\b/u);
    }
  });

  it('loest Enge nicht durch Verkleinern', () => {
    // Ausdruecklich ausgeschlossen: ein skalierter Desktop ist kein mobiles
    // Layout, er macht nur die Schrift unlesbar.
    for (const { datei, quelle } of alleKomponenten()) {
      expect(quelle, datei).not.toMatch(/scale-\[?\d/u);
      expect(quelle, datei).not.toMatch(/transform:\s*scale/u);
    }
  });

  it('erlaubt jedem Flex-Kind, schmaler als sein Inhalt zu werden', () => {
    const seite = lies('seite.tsx');
    // Ohne `min-w-0` ist die Mindestbreite eines Flex-Kindes sein Inhalt -
    // ein langer Pfad in einem Codeblock zieht dann die Seite auf.
    expect(seite).toContain('w-full min-w-0');
    expect(lies('werk-ansicht.tsx')).toContain('min-w-0 flex-1');
  });
});

describe('Doku mobil: Schriftgroessen', () => {
  it('setzt Titel und Fliesstext auf dem Telefon groesser als auf dem Rechner', () => {
    const seite = lies('seite.tsx');

    // §5: H1 um 32px, Fliesstext 16px. Die `sm:`-Variante ist die kleinere -
    // das ist Absicht und kein Dreher: mobil steht der Text allein auf der
    // Breite, auf dem Rechner in einer Spalte neben zwei Navigationen.
    expect(seite).toContain('text-[2rem]');
    expect(seite).toContain('sm:text-2xl');
    expect(lies('blocks.tsx')).toContain('text-base leading-7');
  });

  it('gibt den Startseiten denselben Titel-Sprung wie den Detailseiten', () => {
    // Sonst schrumpft die Schrift beim Klick auf eine Kachel.
    expect(lies('werk-ansicht.tsx')).toContain('text-[2rem]');
  });
});

describe('Doku mobil: Breadcrumb, Schubfach, Suche', () => {
  it('zeigt auf dem Telefon einen kurzen Zurueck-Pfad statt drei Stufen', () => {
    const seite = lies('seite.tsx');

    // Der volle Pfad «Werk › Kategorie › Seite» braucht auf 360px drei
    // Zeilen, bevor die Ueberschrift kommt. Mobil steht deshalb nur der Weg
    // zurueck; §24 - gekuerzt wird das Label, nicht der Inhalt.
    expect(seite).toMatch(/className="[^"]*\bsm:hidden"/u);
    expect(seite).toContain('hidden min-w-0 flex-wrap items-center gap-1 text-xs sm:flex');
  });

  it('schliesst das Schubfach per ESC und gibt den Fokus zurueck', () => {
    const navigation = lies('doku-navigation.tsx');

    expect(navigation).toContain('aria-modal="true"');
    expect(navigation).toContain("'Escape'");
    // Ohne gesperrten Hintergrund scrollt unter dem offenen Schubfach die
    // Seite mit - auf einem Telefon verliert man damit die Leseposition.
    expect(navigation).toMatch(/overflow\s*=\s*'hidden'|overflow:\s*'hidden'/u);
    // Der Fokus muss zurueck auf den Knopf, sonst steht er nach dem
    // Schliessen am Seitenanfang.
    expect(navigation).toMatch(/knopf\.current\??\.focus\(\)/u);
  });

  it('schliesst das Schubfach auch beim Wechsel der Seite', () => {
    // Der Browser-Zurueck-Knopf loest keinen Klick aus. Ohne diesen Effekt
    // bliebe das Schubfach ueber der neuen Seite stehen.
    expect(lies('doku-navigation.tsx')).toMatch(
      /useEffect\(\(\) => \{\s*setOffen\(false\);\s*\}, \[pfad\]\)/u,
    );
  });

  it('beruecksichtigt die Safe Area des iPhones', () => {
    // §21: ohne das liegt der unterste Eintrag unter der Home-Leiste.
    expect(lies('doku-navigation.tsx')).toContain('env(safe-area-inset-bottom)');
  });

  it('haengt die Trefferliste als Overlay an das Suchfeld', () => {
    const suche = lies('doku-suche.tsx');

    // Im Fluss zog die Liste die Zeile aus Suchfeld und Inhalts-Knopf auf
    // halbe Bildschirmhoehe auf, bevor der Artikel anfing. `inset-x-0`
    // bindet die Breite ans Feld, `max-h` plus eigenes Scrollen haelt sie
    // im Viewport.
    expect(suche).toContain('absolute inset-x-0 top-full');
    expect(suche).toContain('max-h-[min(60vh,28rem)]');
    expect(suche).toContain('overflow-y-auto');
  });
});

describe('Doku mobil: breite Inhalte scrollen in sich', () => {
  it('haelt die Tabelle in ihrem Kasten', () => {
    const blocks = lies('blocks.tsx');

    // Die Tabelle hat eine Mindestbreite - sonst wird aus vier Spalten
    // Buchstabensalat. Diese Breite darf aber nur den inneren Kasten
    // aufziehen, nicht die Seite: `max-w-full` aussen, `overflow-x-auto`
    // innen.
    expect(blocks).toContain('w-full min-w-0 max-w-full overflow-hidden');
    expect(blocks).toContain('overflow-x-auto');
  });

  it('haelt den Codeblock in seinem Kasten', () => {
    const code = lies('code-block.tsx');
    expect(code).toContain('max-w-full overflow-x-auto');
  });

  it('bricht lange Tokens nur im Code um, nicht im Fliesstext', () => {
    const blocks = lies('blocks.tsx');

    // §13: `overflow-wrap: anywhere` im Fliesstext trennt mitten im Wort.
    // Nur technische Tokens - Pfade, Variablennamen - brauchen das.
    const stellen = [...blocks.matchAll(/\[overflow-wrap:anywhere\]/gu)];
    expect(stellen.length).toBeGreaterThan(0);
    expect(blocks).toMatch(/<code[^>]*\[overflow-wrap:anywhere\]/u);
  });
});

describe('Doku mobil: ein Layout fuer beide Werke', () => {
  it('fuehrt alle vier Doku-Routen ueber denselben Wrapper', () => {
    // §23: keine zwei getrennten CSS-Fixes. Wenn eine Route ihr eigenes
    // Raster baut, gilt jeder Fix hier nur noch fuer die Haelfte.
    const basis = join(process.cwd(), 'apps/web/src/app/(app)/system/docs');
    const routen = [
      'entwickler/page.tsx',
      'team/page.tsx',
      'entwickler/[...pfad]/page.tsx',
      'team/[...pfad]/page.tsx',
    ];

    for (const route of routen) {
      const quelle = readFileSync(join(basis, route), 'utf8');
      expect(quelle, route).toContain("from '@/modules/docs/components/werk-ansicht'");
      expect(quelle, route).not.toMatch(/className=/u);
    }
  });
});
