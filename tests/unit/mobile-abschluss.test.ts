import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Drei Kleinigkeiten, die am gebauten Server auffielen.
 *
 * Sie haben nichts miteinander zu tun ausser dem Anlass - und keine von
 * ihnen gehoert in eine der Dateien, die sie betreffen: es sind
 * Eigenschaften, die aus dem Zusammenspiel entstehen.
 */

const WURZEL = process.cwd();
const lies = (pfad: string): string => readFileSync(join(WURZEL, pfad), 'utf8');

/**
 * Derselbe Quelltext, ohne seine Kommentare.
 *
 * Weil die Kommentare erklaeren, was der Code **nicht mehr** tut, und dabei
 * `max-age=0` und `immutable` beim Namen nennen. Ohne diesen Schnitt pruefte
 * der Test die Prosa und faende genau die Woerter, deren Abwesenheit er
 * zusichern soll.
 */
const ohneKommentare = (pfad: string): string =>
  lies(pfad)
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/(^|[^:])\/\/.*$/gmu, '$1');

describe('Das Kreuz im Dialog ist anfassbar', () => {
  /*
   * Gemessen auf 390 Pixel Breite: 16 x 16 Pixel. Das war das Symbol selbst -
   * die Schaltflaeche hatte keine Flaeche darueber hinaus. Zum Vergleich: die
   * Knoepfe der Kopfzeile sind 40 x 40.
   *
   * Es betrifft **jeden** Dialog im System, nicht nur den Drawer, weil die
   * Schaltflaeche in `DialogContent` steckt.
   */
  const DIALOG = ohneKommentare('apps/web/src/components/ui/dialog.tsx');

  it('gibt der Schaltflaeche eine eigene Flaeche', () => {
    const schliessen = /<DialogPrimitive\.Close[\s\S]*?>/u.exec(DIALOG)?.[0] ?? '';
    expect(schliessen).toContain('size-10');
    expect(schliessen).toContain('place-items-center');
  });

  it('laesst das Symbol optisch stehen, wo es stand', () => {
    /*
     * `right-4` plus ein 16 Pixel breites Symbol hiess: Mitte 24 Pixel von
     * der Ecke. `right-1` plus 40 Pixel Flaeche ergibt 4 + 20 = 24. Dieselbe
     * Stelle, dreimal so viel zum Treffen.
     */
    const schliessen = /<DialogPrimitive\.Close[\s\S]*?>/u.exec(DIALOG)?.[0] ?? '';
    expect(schliessen).toContain('right-1 top-1');
    expect(DIALOG).toContain('<X className="size-4" />');
  });
});

describe('Mitgelieferte Mediendateien duerfen zwischengespeichert werden', () => {
  /*
   * Next gibt allem unter `public/` `Cache-Control: public, max-age=0`.
   * Gemessen: das Markenzeichen wurde auf jeder Seite zweimal angefragt, und
   * der XP-Slot bringt achtzehn WAV-Dateien mit - auf einer Mobilverbindung
   * achtzehn Umlaeufe, bevor der erste Klang spielt.
   */
  const CONFIG = ohneKommentare('apps/web/next.config.ts');

  it('nennt alle drei Ordner unter public', () => {
    for (const ordner of ['/schriften/:path*', '/xp-slot/:path*', '/branding/:path*']) {
      expect(CONFIG, ordner).toContain(ordner);
    }
  });

  it('setzt fuer jeden eine Lebensdauer ueber null', () => {
    const regeln = [...CONFIG.matchAll(/max-age=(\d+)/gu)].map((m) => Number(m[1]));
    expect(regeln.length).toBeGreaterThanOrEqual(3);
    for (const wert of regeln) {
      expect(wert).toBeGreaterThan(0);
    }
  });

  it('verspricht nichts, was es nicht halten kann', () => {
    // `immutable` hiesse: dieser Name bekommt nie einen anderen Inhalt. Die
    // Namen haengen aber nicht am Inhalt - `swisshub-logo-32.png` heisst nach
    // einem Austausch genauso.
    const bereich = CONFIG.slice(CONFIG.indexOf('async headers()'));
    expect(bereich).not.toContain('immutable');
  });
});

describe('Die letzte Auffanglinie existiert', () => {
  it('faengt auch einen Fehler im Wurzel-Layout', () => {
    /*
     * `error.tsx` faengt alles unterhalb des Wurzel-Layouts. Scheitert das
     * Layout selbst, zeigte Next bisher seine eigene Seite: eine weisse
     * Flaeche mit «Application error: a client-side exception has occurred».
     */
    const global = ohneKommentare('apps/web/src/app/global-error.tsx');
    expect(global).toContain("'use client'");
    // Sie muss `<html>` und `<body>` selbst mitbringen - das Layout, auf das
    // sie sonst baute, ist genau das, was gerade nicht funktioniert hat.
    expect(global).toContain('<html');
    expect(global).toContain('<body');
    // Keine technischen Einzelheiten, nur die Referenz - dieselbe Regel wie
    // in `error.tsx`.
    expect(global).toContain('error.digest');
    expect(global).not.toContain('error.stack');
    expect(global).not.toContain('error.message');
  });
});
