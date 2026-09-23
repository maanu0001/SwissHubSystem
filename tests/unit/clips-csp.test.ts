import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EINBETTUNGS_HOSTS } from '@swisshub/modules/clips/provider';

/**
 * Die Content Security Policy kennt genau die Hosts, die eingebettet werden.
 *
 * ## Warum das ein Test ist und kein gemeinsamer Import
 *
 * Die Middleware laeuft in der Edge-Laufzeit und darf die Modul-Schicht mit
 * ihrer Datenbankanbindung nicht laden. Die Liste steht deshalb zweimal -
 * einmal dort, einmal in `provider.ts`.
 *
 * Zwei Listen laufen auseinander, sobald jemand einen Anbieter ergaenzt. Die
 * Folge waere still: die Adresse entstuende, der Rahmen bliebe leer, und
 * niemand wuesste warum. Dieser Test macht daraus einen roten Lauf.
 *
 * Geprueft wird in beide Richtungen - auch ein Host, der **nur** in der
 * Policy steht, ist ein Fehler: er waere eine Freigabe ohne Anlass.
 */
const middleware = readFileSync(
  fileURLToPath(new URL('../../apps/web/src/middleware.ts', import.meta.url)),
  'utf8',
);

function hostsAusPolicy(): string[] {
  const treffer = /const EINBETTUNGS_HOSTS = \[([\s\S]*?)\] as const;/u.exec(middleware);
  if (!treffer) {
    throw new Error('In der Middleware steht keine Liste `EINBETTUNGS_HOSTS` mehr.');
  }
  return [...treffer[1]!.matchAll(/'([^']+)'/gu)].map((eintrag) => eintrag[1]!);
}

describe('Content Security Policy fuer eingebettete Clips', () => {
  it('fuehrt dieselben Hosts wie der Clip-Anbieter', () => {
    expect(hostsAusPolicy().sort()).toEqual([...EINBETTUNGS_HOSTS].sort());
  });

  it('setzt `frame-src` - sonst greift `default-src self` und der Rahmen bleibt leer', () => {
    expect(middleware).toMatch(/frame-src 'self' \$\{EINBETTUNGS_HOSTS\.join\(' '\)\}/u);
  });

  it('gibt keinen Rahmen fuer beliebige https-Adressen frei', () => {
    /*
     * `frame-src https:` oder `frame-src *` waere die Einladung, irgendeine
     * Seite in einem Rahmen auf unserer Adresse zu zeigen - und ein Rahmen
     * fuellt den Schirm. Geprueft wird die Zeile selbst, nicht die Datei:
     * die Liste darunter enthaelt naturgemaess `https://`.
     */
    const zeile = middleware
      .split('\n')
      .map((eintrag) => eintrag.trim())
      // Nur die Anweisung selbst, nicht der Kommentar darueber, der sie erklaert.
      .find((eintrag) => eintrag.includes('frame-src') && !eintrag.startsWith('*'));
    expect(zeile).toBeDefined();
    expect(zeile).not.toMatch(/\bhttps:(?!\/\/)/u);
    expect(zeile).not.toContain('*');
  });

  it('haelt jeden freigegebenen Host auf https', () => {
    for (const host of hostsAusPolicy()) {
      expect(host.startsWith('https://')).toBe(true);
    }
  });
});
