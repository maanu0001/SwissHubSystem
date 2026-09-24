import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Welche Seiten ohne Anmeldung erreichbar sind - und dass es dabei bleibt.
 *
 * ## Warum das eine Pruefung braucht
 *
 * Die Anmeldung liegt in SwissHub nicht in der Middleware, sondern im
 * Layout von `(app)`. Was daneben liegt, ist damit oeffentlich - und zwar
 * ohne dass irgendwo «oeffentlich» steht. Ein neuer Ordner neben `(app)`
 * ist deshalb eine Entscheidung mit Folgen, die beim Anlegen wie eine
 * Ordnerstruktur aussieht.
 *
 * Die Liste unten ist die Gegenprobe: was hier nicht steht, soll nicht
 * oeffentlich sein. Wer eine Route hinzufuegt, muss sie eintragen - und
 * dabei einmal daruebernachdenken.
 *
 * ## Und die Gegenrichtung
 *
 * `/u/[slug]` darf **nicht** anfangen, eine Anmeldung zu verlangen. Ein
 * `requireMember()` dort waere das Ende der geteilten Profil-Links, und es
 * faellt niemandem auf, solange alle Entwickler angemeldet sind.
 */
const APP = join(process.cwd(), 'apps/web/src/app');

/** Oberste Ordner neben `(app)`, die bewusst ohne Anmeldung auskommen. */
const OEFFENTLICH = new Set([
  '403',
  'access-denied',
  'api',
  'discord-unavailable',
  'entbannung',
  'leaderboard',
  'login',
  'premium',
  'setup',
  'turniere',
  'u',
  'wrapped',
  'wrapped-buehne',
]);

function oberste(): string[] {
  return readdirSync(APP).filter((name) => statSync(join(APP, name)).isDirectory() && !name.startsWith('('));
}

function dateienUnter(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const voll = join(dir, name);
    return statSync(voll).isDirectory() ? dateienUnter(voll) : [voll];
  });
}

/** Block- und Zeilenkommentare entfernen. */
function ohneKommentare(quelle: string): string {
  return quelle.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');
}

describe('Oeffentliche Routen', () => {
  it('hat neben der geschuetzten Gruppe nur bekannte Bereiche', () => {
    for (const ordner of oberste()) {
      expect(
        OEFFENTLICH.has(ordner),
        `«${ordner}» liegt neben (app) und ist damit ohne Anmeldung erreichbar. ` +
          'Ist das beabsichtigt? Dann hier eintragen.',
      ).toBe(true);
    }
  });

  it('verlangt auf der oeffentlichen Profilseite keine Anmeldung', () => {
    for (const datei of dateienUnter(join(APP, 'u'))) {
      // Ohne Kommentare: der Kopf der Seite erklaert ausfuehrlich, warum
      // dort **kein** `requireMember()` steht - und loeste den Test aus.
      const quelle = ohneKommentare(readFileSync(datei, 'utf8'));
      const name = relative(APP, datei).split(sep).join('/');
      expect(quelle, `${name} verlangt eine Anmeldung`).not.toMatch(/requireMember\s*\(/u);
      expect(quelle, `${name} verlangt eine Berechtigung`).not.toMatch(/requirePagePermission\s*\(/u);
    }
  });

  it('zeigt den Teilen-Knopf auch bei noch nicht oeffentlichem Profil', () => {
    /*
     * Der Fehler, der die ganze Funktion unsichtbar machte.
     *
     * Der Knopf hing an `oeffentlicherSlug`, und den gibt es nur bei einem
     * bereits oeffentlichen Profil. Wer teilen wollte, musste also schon
     * geteilt haben - und wer nicht wusste, dass es die Funktion gibt, fand
     * die Einstellung nicht, weil sie im Editor unter «Privatsphaere»
     * liegt.
     *
     * Geprueft wird deshalb beides: dass der Knopf nicht mehr an einem Slug
     * haengt, und dass es den Weg zur Einstellung gibt.
     */
    const hero = readFileSync(
      join(process.cwd(), 'apps/web/src/modules/profile/components/profil-hero.tsx'),
      'utf8',
    );
    const knopf = readFileSync(
      join(process.cwd(), 'apps/web/src/modules/profile/components/teilen-knopf.tsx'),
      'utf8',
    );

    expect(hero, 'Der Knopf haengt wieder am Slug').not.toMatch(
      /ansicht\.eigenes && ansicht\.oeffentlicherSlug/u,
    );
    expect(hero).toContain('ProfilFreigebenKnopf');
    expect(knopf).toContain('abschnitt=privatsphaere');
  });

  it('laesst die oeffentliche Profilseite nicht ewig alt werden', () => {
    const quelle = readFileSync(join(APP, 'u/[slug]/page.tsx'), 'utf8');
    // Ohne `revalidate` zeigte die Seite nach einer Profilaenderung beliebig
    // lange den alten Stand.
    expect(quelle).toMatch(/export const revalidate = \d+/u);
  });
});
