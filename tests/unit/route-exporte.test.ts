import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Was eine Route exportieren darf.
 *
 * ## Woran es lag
 *
 * `api/streamer/twitch/start/route.ts` exportierte `rueckwegAdresse` - eine
 * gemeinsame Hilfsfunktion, die der Rückweg von dort importierte. Das ist
 * sauberer Code und für Next verboten: eine Route darf **nur** Handler und
 * bekannte Konfigurationsfelder exportieren.
 *
 *     Type error: Route "…/start/route.ts" does not match the required types
 *     of a Next.js Route.
 *       "rueckwegAdresse" is not a valid Route export field.
 *
 * Gemerkt hat es niemand, weil `npx tsc --noEmit` es nicht sieht: es ist eine
 * Regel von Next und keine von TypeScript. Aufgefallen ist es erst in
 * `next build` - und dort erst **nach** dem Übersetzen, also am Ende einer
 * langen Minute, in der alles gut aussah.
 *
 * Dieser Test braucht dafür Millisekunden. Er liest den Quelltext; eine Route
 * auszuführen wäre hier unnötig, weil es um die Form der Exporte geht und nicht
 * um ihr Verhalten.
 */

const APP = join(process.cwd(), 'apps/web/src/app');

/**
 * Was Next annimmt.
 *
 * Die Handler, die Segment-Konfiguration und `generateStaticParams`. Steht ein
 * Name hier nicht, lehnt `next build` die Route ab - unabhängig davon, wie
 * sinnvoll der Export wäre.
 */
const ERLAUBT = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
  'dynamic',
  'dynamicParams',
  'revalidate',
  'fetchCache',
  'runtime',
  'preferredRegion',
  'maxDuration',
  'generateStaticParams',
  'experimental_ppr',
  // Veraltet, aber von Next weiterhin erlaubt.
  'config',
]);

function routen(verzeichnis: string): string[] {
  return readdirSync(verzeichnis).flatMap((name) => {
    const voll = join(verzeichnis, name);
    if (statSync(voll).isDirectory()) {
      return routen(voll);
    }
    return name === 'route.ts' || name === 'route.tsx' ? [voll] : [];
  });
}

/** Block- und Zeilenkommentare entfernen. */
function ohneKommentare(quelle: string): string {
  return quelle.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');
}

/**
 * Die Namen, die eine Datei exportiert.
 *
 * Gelesen werden `export const|let|var|function|async function|class` und
 * `export { … }`. Ein `export default` kommt in einer Route nicht vor und wäre
 * ohnehin erlaubt-oder-nicht nach derselben Liste.
 */
function exportierteNamen(quelle: string): string[] {
  const rumpf = ohneKommentare(quelle);
  const namen: string[] = [];

  for (const treffer of rumpf.matchAll(
    /^export\s+(?:declare\s+)?(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gmu,
  )) {
    if (treffer[1]) {
      namen.push(treffer[1]);
    }
  }

  for (const treffer of rumpf.matchAll(/^export\s*\{([^}]*)\}/gmu)) {
    for (const teil of (treffer[1] ?? '').split(',')) {
      // `a as b` exportiert `b`.
      const name = teil
        .trim()
        .split(/\s+as\s+/u)
        .pop()
        ?.trim();
      if (name && name.length > 0) {
        namen.push(name);
      }
    }
  }

  return namen;
}

describe('Next-Routen: nur erlaubte Exporte', () => {
  const dateien = routen(APP);

  it('findet überhaupt Routen', () => {
    // Sonst prüft dieser Test still nichts - der schlimmste Zustand für einen
    // Test, der eine Regel absichern soll.
    expect(dateien.length).toBeGreaterThan(10);
  });

  it.each(dateien.map((pfad) => [relative(process.cwd(), pfad), pfad] as const))(
    '%s exportiert nur, was Next annimmt',
    (anzeige, pfad) => {
      const unerlaubt = exportierteNamen(readFileSync(pfad, 'utf8')).filter((name) => !ERLAUBT.has(name));
      expect(
        unerlaubt,
        `${anzeige} exportiert ${unerlaubt.join(', ')}. ` +
          'Eine Route darf nur Handler und Segment-Konfiguration exportieren - ' +
          'Gemeinsames gehört in eine eigene Datei daneben.',
      ).toEqual([]);
    },
  );
});
