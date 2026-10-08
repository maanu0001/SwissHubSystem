import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KOPF_GRUPPE, KOPF_KNOPF, KOPF_SYMBOL } from '@/lib/kopfzeile-geometrie';

/**
 * Die Geometrie der mobilen Kopfzeile.
 *
 * ## Was gemessen war, bevor es diese Datei gab
 *
 * Auf acht Seiten und fuenf Bildschirmen stand die Kopfzeile ueberall
 * gleich - sie wanderte nicht. Was je Seite anders aussah, war der Titel,
 * und zwar weil er nur bekam, was die vier Bedienelemente uebrig liessen:
 * 42 Pixel auf 360, 72 auf 390. Aus «Dashboard» wurde «Das…».
 *
 * ## Warum das hier und nicht im Browser geprueft wird
 *
 * Eine Messung im Browser braucht einen Server, eine Sitzung und eine
 * Datenbank; sie lief einmal und steht im Bericht. Was bleiben muss, ist die
 * **Bauart**, aus der die gemessenen Zahlen folgen: feste Zonen aussen, eine
 * nachgebende Mitte, eine Geometrie fuer alle Bedienelemente. Genau das
 * laesst sich am Quelltext festhalten, und zwar ohne dass ein Pixel-Vergleich
 * bei der naechsten Schriftaktualisierung umfaellt.
 */

const LAYOUT = join(process.cwd(), 'apps/web/src/components/layout');

/**
 * Der Quelltext einer Layoutdatei - **ohne** Kommentare.
 *
 * Das ist kein Detail, sondern der Grund, aus dem der erste Entwurf dieser
 * Datei nichts bewies: die Kommentare ueber den Klassen nennen die Klassen,
 * um zu erklaeren, warum sie dort stehen. Eine Zusicherung auf «enthaelt
 * h-14» war damit auch dann erfuellt, wenn im Code `min-h` stand und nur der
 * Kommentar noch `h-14` sagte. Aufgefallen ist es bei der Gegenprobe - der
 * eingebaute Fehler liess den Test gruen.
 */
const lies = (datei: string): string =>
  readFileSync(join(LAYOUT, datei), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/^\s*\/\/.*$/gmu, '');

/** Die Klassen eines Elements, gesucht ueber sein oeffnendes Tag am Zeilenanfang. */
function klassenVon(quelle: string, tag: string): string {
  const treffer = new RegExp(`^\\s*<${tag}\\b[^>]*className="([^"]*)"`, 'mu').exec(quelle);
  expect(treffer, `<${tag}> mit className nicht gefunden`).not.toBeNull();
  return treffer?.[1] ?? '';
}

describe('Kopfzeile: eine Geometrie für alle Bedienelemente', () => {
  it('gibt jedem Knopf dieselbe Fläche, denselben Radius, dasselbe Symbol', () => {
    // 40x40 und ein Radius. Vorher: 40 mit `rounded-lg`, 40 mit `rounded-lg`,
    // 36 mit `rounded-xl` und ein 82 breiter Kasten mit `rounded-xl`.
    expect(KOPF_KNOPF).toContain('size-10');
    expect(KOPF_KNOPF).toContain('rounded-lg');
    expect(KOPF_SYMBOL).toBe('size-5');
  });

  it('lässt kein Bedienelement nachgeben', () => {
    /*
     * Der eigentliche Punkt, nicht die Groesse.
     *
     * Ohne `shrink-0` geben die Knoepfe nach, sobald der Seitentitel lang
     * wird - und dann wandert die rechte Haelfte je nach Route. Mit
     * `shrink-0` kann genau eines nachgeben: der Titel, und der soll es.
     */
    expect(KOPF_KNOPF).toContain('shrink-0');
    expect(KOPF_GRUPPE).toContain('shrink-0');
  });

  it('benutzt die gemeinsamen Werte in allen vier Bedienelementen', () => {
    // Menue, Suche, Glocke holen die Klassen aus derselben Datei. Das Profil
    // ist kein quadratischer Knopf (Avatar plus Pfeil), traegt aber dieselbe
    // Hoehe und denselben Radius.
    for (const datei of ['mobile-nav.tsx', 'command-palette.tsx', 'notification-bell.tsx']) {
      expect(lies(datei), datei).toContain('KOPF_KNOPF');
    }
    const profil = lies('user-menu.tsx');
    expect(profil).toContain('h-10');
    expect(profil).toContain('shrink-0');
    expect(profil).toContain('rounded-lg');
  });
});

describe('Kopfzeile: feste Zonen, nachgebende Mitte', () => {
  const kopf = lies('app-header.tsx');

  it('hält auf dem Telefon eine Höhe und kein Mindestmass', () => {
    /*
     * `min-h-[4.5rem]` plus Innenabstand ergab 75 Pixel mobil und 77 ab `sm`:
     * die Hoehe kam aus dem Inhalt. Ein Mindestmass, das der Inhalt
     * ueberschreitet, ist keine Vorgabe mehr.
     */
    expect(kopf).toContain('h-14');
    // Ab `sm` bleibt die zweizeilige Fassung - dort steht die Beschreibung.
    expect(kopf).toContain('sm:min-h-[4.5rem]');
  });

  it('gibt der Mitte den Rest und lässt nur sie nachgeben', () => {
    expect(kopf).toContain('min-w-0 flex-1');
    expect(kopf).toMatch(/<h1[^>]*className="truncate/u);
  });

  it('hält den Titel einzeilig', () => {
    // Zwei Zeilen wuerden die Hoehe aendern - und zwar je nach Seitenname.
    const titel = klassenVon(kopf, 'h1');
    expect(titel).toContain('truncate');
    expect(titel).not.toContain('line-clamp');
    expect(titel).not.toContain('whitespace-normal');
  });

  it('rechnet die Safe Area nicht zum normalen Rand dazu', () => {
    /*
     * `max()` und nicht `calc(... + ...)`: ohne Aussparung ist der Wert null
     * und es bleibt beim normalen Rand; mit Aussparung gewinnt sie. Addiert
     * stuende die Kopfzeile auf dem iPhone quer doppelt so weit innen.
     */
    expect(kopf).toContain('max(0.75rem,env(safe-area-inset-left))');
    expect(kopf).toContain('env(safe-area-inset-top)');
    expect(kopf).not.toMatch(/calc\([^)]*env\(safe-area/u);
  });

  it('korrigiert nichts per Transform oder negativem Rand', () => {
    // Beides verschiebt etwas, ohne dass das Layout davon weiss - und beides
    // faellt bei der naechsten Aenderung an anderer Stelle auf die Fuesse.
    expect(kopf).not.toMatch(/\b-m[trblxy]?-/u);
    expect(kopf).not.toContain('scale(');
    expect(kopf).not.toContain('translate(');
  });
});

describe('Kopfzeile: zugängliche Namen', () => {
  it('vergibt «Suchen und navigieren» genau einmal', () => {
    /*
     * Beide Such-Knoepfe trugen diesen Namen, und je nach Breite ist einer
     * unsichtbar. Eine Vorlesehilfe fand damit zwei gleichnamige Schalter,
     * von denen einer nicht erreichbar war. Der Knopf mit sichtbarem Text
     * braucht keine eigene Beschriftung.
     */
    const treffer = lies('command-palette.tsx').match(/aria-label="Suchen und navigieren"/gu) ?? [];
    expect(treffer).toHaveLength(1);
  });
});

describe('Inhaltsbereich: dieselbe Aussparung wie die Kopfzeile', () => {
  const schale = lies('app-shell.tsx');

  it('haelt den Inhalt quer aus der Aussparung heraus', () => {
    /*
     * Quer gehalten liegt die Notch links oder rechts **neben** dem Inhalt:
     * unter `lg` ist die Seitenleiste ausgeblendet, der Inhalt nimmt die
     * volle Breite, und bei `px-4` begann er 16 Pixel vom Rand - also
     * darunter. Die Kopfzeile hatte das geloest, der Inhalt nicht.
     */
    expect(schale).toContain('max(1rem,env(safe-area-inset-left))');
    expect(schale).toContain('max(1rem,env(safe-area-inset-right))');
    expect(schale).toContain('env(safe-area-inset-bottom)');
  });

  it('addiert die Aussparung nicht zum normalen Rand', () => {
    // Dieselbe Regel wie in der Kopfzeile: `max()`, nie `calc(... + ...)`.
    expect(schale).not.toMatch(/calc\([^)]*env\(safe-area/u);
  });

  it('setzt oben und unten getrennt statt ueber `py`', () => {
    // `py-6` und `pb-[...]` haben dieselbe Spezifitaet - welches gewinnt,
    // entscheidet die Reihenfolge im Stylesheet, nicht die im Attribut.
    expect(schale).toContain('pt-6');
    expect(schale).not.toContain('py-6');
  });

  it('behaelt die bisherigen Abstaende dort, wo es keine Aussparung gibt', () => {
    // 16 / 24 / 32 Pixel - genau die Werte, die vorher gemessen wurden.
    expect(schale).toContain('sm:pl-[max(1.5rem,env(safe-area-inset-left))]');
    expect(schale).toContain('lg:pl-[max(2rem,env(safe-area-inset-left))]');
  });
});

describe('Drawer: feste Breite, kein Verschieben des Inhalts', () => {
  const nav = lies('mobile-nav.tsx');

  it('misst die Breite am Bildschirm und nicht am Text', () => {
    /*
     * Eine feste Breite mit einer Obergrenze fuer schmale Geraete - nicht
     * eine, die mit dem laengsten Eintrag waechst.
     *
     * Die Obergrenze war `max-w-[85vw]`. `vw` zaehlt eine Bildlaufleiste mit,
     * die es auf dem Telefon gar nicht gibt, und ergibt auf fast jedem Geraet
     * eine gebrochene Pixelzahl; Prozent bezieht sich auf das, was der
     * Browser tatsaechlich hat. Was diese Zusicherung bewacht, ist
     * unveraendert: eine Breite, die nicht am Inhalt haengt.
     */
    expect(nav).toContain('w-[19rem]');
    expect(nav).toContain('max-w-[calc(100%-3rem)]');
  });

  it('liegt über dem Inhalt, statt ihn zur Seite zu schieben', () => {
    /*
     * Ein Dialog mit eigener Ebene. Waere es ein Geschwister im Fluss, ruckte
     * die ganze Seite beim Oeffnen zur Seite.
     *
     * Die Verankerung stand frueher als `left-0 top-0` im `className` und
     * uebermalte damit die mittige Vorgabe. Sie steht jetzt als benannte
     * Geometrie in `dialog.tsx` - siehe `drawer-geometrie.test.ts`, wo auch
     * steht, warum: die Position liess sich uebermalen, der Auftritt nicht.
     */
    expect(nav).toContain('DialogContent');
    expect(nav).toContain('geometrie="drawer"');
  });
});
