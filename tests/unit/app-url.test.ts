import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { appBaseUrl, appUrl } from '@swisshub/config';
import { systemRoutes } from '@swisshub/shared';

/**
 * Eine Adresse, eine Stelle.
 *
 * ## Der Fehler, den es dazu brauchte
 *
 * `appUrl()` **ohne Argument** bedeutet den Pfad `/` und liefert deshalb
 * `https://host/` - mit Schraegstrich am Ende. An acht Stellen stand daraus
 * gebaut `${appUrl()}/u/manu`, und heraus kam `https://host//u/manu`.
 *
 * Betroffen war nicht nur die Anzeige:
 *
 *  - der **QR-Code** auf der Gamer Card trug diese Adresse. Auf einer
 *    gedruckten Karte ist das nicht mehr zu korrigieren.
 *  - die **Rueckadresse fuer Twitch** (`/api/streamer/twitch/callback`).
 *    Twitch vergleicht sie zeichengenau mit der hinterlegten.
 *  - die **Discord-Ankuendigungen** des Streamer Hubs.
 *
 * ## Warum kein `replace('//', '/')`
 *
 * Weil das `https://` zerstoert. Die Antwort ist nicht, eine falsch gebaute
 * Zeichenkette hinterher zu reparieren, sondern sie richtig zu bauen: den
 * Pfad als Argument, an genau einer Stelle zusammengesetzt.
 */

const WURZEL = process.cwd();

/*
 * Gegen die eingestellte Basis, nicht gegen einen festen Hostnamen.
 *
 * Welche Adresse das System hat, ist eine Einstellung; was dieser Test prueft,
 * ist die **Form** dessen, was daraus gebaut wird. Ein Test, der
 * `https://system.swisshub.gg` erwartet, prueft die Testumgebung.
 */
const BASIS = appBaseUrl();

describe('appUrl', () => {
  it('haengt den Pfad ohne doppelten Schraegstrich an', () => {
    expect(appUrl('/u/manu')).toBe(`${BASIS}/u/manu`);
  });

  it('nimmt einen Pfad auch ohne fuehrenden Schraegstrich', () => {
    expect(appUrl('u/manu')).toBe(`${BASIS}/u/manu`);
  });

  it('zieht doppelte Schraegstriche im Pfad zusammen', () => {
    /*
     * Fuer einen Crawler ist `//u/manu` eine **andere** Adresse als `/u/manu`.
     * Zwei Adressen fuer eine Seite sind ein Problem, das niemand sieht.
     */
    expect(appUrl('//u/manu')).toBe(`${BASIS}/u/manu`);
    expect(appUrl('/u//manu')).toBe(`${BASIS}/u/manu`);
  });

  it('gibt ohne Argument die Startseite mit Schraegstrich', () => {
    // Das war schon immer so und bleibt so: `appUrl()` ist der Pfad `/`.
    expect(appUrl()).toBe(`${BASIS}/`);
  });

  it('gibt die Basis ohne abschliessenden Schraegstrich', () => {
    expect(BASIS.endsWith('/')).toBe(false);
    // Und daraus laesst sich wieder etwas bauen, ohne dass es doppelt wird.
    expect(`${appBaseUrl()}${systemRoutes.oeffentlichesProfil('manu')}`).toBe(`${BASIS}/u/manu`);
  });

  it('haelt genau die zwei Schraegstriche von https:// - und keine weiteren', () => {
    for (const pfad of ['/u/manu', 'u/manu', '//u/manu', '/', '/api/streamer/twitch/callback']) {
      const adresse = appUrl(pfad);
      expect(adresse.split('//'), `${pfad} ergibt ${adresse}`).toHaveLength(2);
    }
  });
});

describe('Die oeffentliche Profiladresse', () => {
  it('entsteht an einer Stelle', () => {
    expect(systemRoutes.oeffentlichesProfil('manu')).toBe('/u/manu');
    expect(systemRoutes.oeffentlichesProfilKarte('manu')).toBe('/u/manu/karte');
  });

  it('kodiert, was kodiert gehoert', () => {
    /*
     * Ein Slug ist auf `[a-z0-9-]` geprueft, bevor er gespeichert wird - die
     * Kodierung ist die zweite Sicherung, fuer den Fall, dass diese Funktion
     * einmal einen ungeprueften Wert bekommt.
     */
    expect(systemRoutes.oeffentlichesProfil('a/b')).toBe('/u/a%2Fb');
    expect(systemRoutes.oeffentlichesProfil('a b')).toBe('/u/a%20b');
  });

  it('ergibt mit appUrl genau eine gueltige Adresse', () => {
    const adresse = appUrl(systemRoutes.oeffentlichesProfil('manu'));
    expect(adresse).toBe(`${BASIS}/u/manu`);
    expect(adresse.split('//')).toHaveLength(2);
  });
});

/** Alle TypeScript-Dateien unter `apps/` und `packages/`. */
function quelldateien(): string[] {
  const gefunden: string[] = [];
  const gehe = (verzeichnis: string): void => {
    for (const name of readdirSync(verzeichnis)) {
      if (name === 'node_modules' || name === '.next' || name === 'dist') {
        continue;
      }
      const pfad = join(verzeichnis, name);
      if (statSync(pfad).isDirectory()) {
        gehe(pfad);
      } else if (/\.tsx?$/u.test(name)) {
        gefunden.push(pfad);
      }
    }
  };
  gehe(join(WURZEL, 'apps'));
  gehe(join(WURZEL, 'packages'));
  return gefunden;
}

describe('Die Form, die den Fehler gemacht hat', () => {
  const DATEIEN = quelldateien();

  it('findet ueberhaupt Quelldateien', () => {
    expect(DATEIEN.length).toBeGreaterThan(200);
  });

  it('setzt nirgends mehr etwas hinter `appUrl()` zusammen', () => {
    /*
     * `${appUrl()}…` ist die Form, aus der der doppelte Schraegstrich
     * entstand. Sie ist hier verboten - nicht weil sie haesslich waere,
     * sondern weil sie **immer** falsch ist: `appUrl()` endet auf einen
     * Schraegstrich, und was folgt, beginnt mit einem.
     *
     * Wer die Basis wirklich braucht, nimmt `appBaseUrl()`.
     */
    const treffer: string[] = [];
    for (const datei of DATEIEN) {
      const quelle = readFileSync(datei, 'utf8');
      /*
       * Zwei Dateien duerfen die Form nennen: diese hier und die, die sie
       * verbietet. Eine Regel, die ihre eigene Begruendung nicht aufschreiben
       * darf, ist eine Regel ohne Begruendung.
       */
      if (datei.endsWith('app-url.test.ts') || datei.endsWith(join('config', 'src', 'app.ts'))) {
        continue;
      }
      if (/\$\{appUrl\(\)\}./u.test(quelle)) {
        treffer.push(datei.slice(WURZEL.length + 1));
      }
    }
    expect(treffer, `Diese Dateien bauen eine Adresse hinter appUrl():\n${treffer.join('\n')}`).toEqual([]);
  });

  it('setzt die oeffentliche Profiladresse nirgends von Hand zusammen', () => {
    /*
     * `/u/${slug}` stand an neun Stellen, mal mit Kodierung, mal ohne.
     * Erlaubt bleibt der Literal-Pfad dort, wo es um die **Route** geht und
     * nicht um eine Adresse: `robots.ts` gibt `/u/` frei, und
     * `revalidatePath('/u/[slug]', 'page')` nennt das Routenmuster.
     */
    const treffer: string[] = [];
    for (const datei of DATEIEN) {
      const quelle = readFileSync(datei, 'utf8');
      if (datei.endsWith('routes.ts') || datei.endsWith('app-url.test.ts')) {
        continue;
      }
      for (const zeile of quelle.split('\n')) {
        // Nur echte Zusammensetzungen, keine Kommentare und keine Muster.
        if (/^\s*[/*]/u.test(zeile)) {
          continue;
        }
        if (/`\/u\/\$\{/u.test(zeile)) {
          treffer.push(`${datei.slice(WURZEL.length + 1)}: ${zeile.trim()}`);
        }
      }
    }
    expect(treffer, `Diese Stellen bauen /u/ selbst:\n${treffer.join('\n')}`).toEqual([]);
  });
});
