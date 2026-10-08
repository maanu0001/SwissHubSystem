import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Die Geometrie des mobilen Drawers.
 *
 * ## Der Fehler, den diese Datei festnagelt
 *
 * Gemeldet war: «die Sidebar bewegt sich auf dem Handy sichtbar und wirkt
 * wiggly». Am gebauten Server nachgemessen, auf 360, 390, 430 und 820 Pixel
 * Breite und auf vier verschiedenen Seiten - jedes Mal dasselbe Bild:
 *
 *   linke Kante:  7,6 Pixel Weg waehrend des Oeffnens
 *   Breite:      15,2 Pixel
 *   Hoehe:    42 bis 59 Pixel, je nach Geraet
 *
 * Die Ursache war eine geerbte Klasse. `DialogContent` stand mittig und kam
 * mit `zoom-in-95` herein - von 95 auf 100 Prozent, aus der eigenen Mitte
 * heraus. Der Drawer ueberschrieb die Position (`left-0 top-0 translate-x-0`),
 * und das wirkte auch: `tailwind-merge` kennt `left-*` und `translate-*` als
 * Konflikt. `zoom-in-95` hat aber keine Gegenklasse, die man danebenschreiben
 * koennte - es blieb stehen. Ein linksbuendiges Panel ueber die volle Hoehe,
 * das aus seiner Mitte waechst, bewegt dabei jede Kante und jeden Text.
 *
 * ## Was hier gehalten wird
 *
 * Nicht Pixel - die haengen vom Geraet ab und waeren der fragile Test, den
 * niemand will. Gehalten wird die **Art** der Bewegung und die Art, wie die
 * Geometrie ausgedrueckt ist.
 */

const WURZEL = process.cwd();

/**
 * Der Quelltext ohne seine Kommentare.
 *
 * Weil hier gehalten wird, was der Code **tut**, und die Kommentare daneben
 * erklaeren, was er nicht mehr tut - sie nennen `zoom-in-95` und `h-dvh`
 * beim Namen. Ohne diesen Schnitt pruefte der Test die Prosa und faende
 * genau die Woerter, deren Abwesenheit er zusichern soll.
 */
function ohneKommentare(pfad: string): string {
  return readFileSync(join(WURZEL, pfad), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/(^|[^:])\/\/.*$/gmu, '$1');
}

const DIALOG = ohneKommentare('apps/web/src/components/ui/dialog.tsx');
const DRAWER = ohneKommentare('apps/web/src/components/layout/mobile-nav.tsx');

/** Der Klassenblock einer benannten Geometrie. */
function geometrie(name: string): string {
  const treffer = new RegExp(`${name}:\\s*\\n?\\s*'([^']*)'`, 'u').exec(DIALOG);
  expect(treffer, `Geometrie ${name} fehlt in dialog.tsx`).not.toBeNull();
  return treffer?.[1] ?? '';
}

describe('Drawer: die Bewegung ist eine Verschiebung, keine Vergroesserung', () => {
  it('zoomt nicht', () => {
    expect(geometrie('drawer')).not.toContain('zoom-in');
    expect(geometrie('drawer')).not.toContain('zoom-out');
    expect(DRAWER).not.toContain('zoom-in');
  });

  it('schiebt von links herein', () => {
    expect(geometrie('drawer')).toContain('slide-in-from-left');
    expect(geometrie('drawer')).toContain('slide-out-to-left');
  });

  it('laesst die mittige Geometrie unveraendert', () => {
    // Jeder andere Dialog im System haengt daran. Der Drawer bekommt eine
    // eigene Variante, damit sich an ihnen nichts aendert.
    const mitte = geometrie('zentriert');
    expect(mitte).toContain('-translate-x-1/2');
    expect(mitte).toContain('-translate-y-1/2');
    expect(mitte).toContain('zoom-in-95');
    expect(mitte).toContain('max-w-lg');
  });
});

describe('Drawer: die Hoehe haengt an keiner Adressleiste', () => {
  it('verankert oben und unten statt eine Viewport-Hoehe zu rechnen', () => {
    /*
     * `dvh` wird neu aufgeloest, waehrend die Adressleiste in iOS Safari ein-
     * und ausfaehrt - der Drawer aenderte dann waehrend des Scrollens seine
     * Hoehe. `inset-y-0` loest der Browser einmal auf.
     */
    expect(geometrie('drawer')).toContain('inset-y-0');
    expect(DRAWER).not.toContain('h-dvh');
    expect(DRAWER).not.toMatch(/h-\[\d+[sdl]?vh\]/u);
  });

  it('misst die Breite nicht in vw', () => {
    // `vw` zaehlt eine Bildlaufleiste mit, die es auf dem Telefon gar nicht
    // gibt, und ergibt auf fast jedem Geraet eine gebrochene Pixelzahl.
    expect(DRAWER).not.toContain('vw]');
    expect(DRAWER).toContain('max-w-[calc(100%-3rem)]');
  });

  it('haelt die Bildlaufrinne frei', () => {
    // Sonst waere die nutzbare Breite auf einer kurzen Seite acht Pixel
    // groesser als auf einer langen - und die Navigation je Seite anders.
    expect(DRAWER).toContain('[scrollbar-gutter:stable]');
  });

  it('respektiert die Aussparung links und unten', () => {
    // Quer gehalten liegt die Notch ueber der linken Kante des Drawers.
    // `max()` und nie `calc(... + ...)`: ohne Aussparung bleibt es beim
    // normalen Abstand, mit Aussparung gewinnt sie.
    expect(DRAWER).toContain('env(safe-area-inset-left)');
    expect(DRAWER).toContain('env(safe-area-inset-bottom)');
    expect(DRAWER).not.toMatch(/calc\(\s*[\d.]+rem\s*\+\s*env\(safe-area/u);
  });
});

describe('Dialog: die Geometrie ist eine benannte Entscheidung', () => {
  it('bietet genau die drei Faelle an, die es gibt', () => {
    expect(DIALOG).toContain("'zentriert' | 'oben' | 'drawer'");
  });

  it('laesst die Kommandopalette ihre Position nicht uebermalen', () => {
    /*
     * `top-[15%] translate-y-0` neben `-translate-y-1/2` ist heute richtig -
     * aber nur, weil die eine Klasse im Stylesheet weiter unten steht als die
     * andere. Mit einem Namen haengt es an nichts mehr.
     */
    const palette = ohneKommentare('apps/web/src/components/layout/command-palette.tsx');
    expect(palette).toContain('geometrie="oben"');
    expect(palette).not.toContain('translate-y-0');
    expect(geometrie('oben')).toContain('top-[15%]');
    expect(geometrie('oben')).toContain('-translate-x-1/2');
  });
});
