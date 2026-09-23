import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Die Pruefungen des Abbilds bleiben Pruefungen.
 *
 * ## Worum es geht
 *
 * `next build` uebersetzt und prueft danach die Typen - im selben Prozess.
 * Auf dem Server ist der Heap auf 1536 MB begrenzt, und genau daran ist ein
 * Deployment gescheitert: «Ineffective mark-compacts near heap limit», nach
 * erfolgreicher Uebersetzung.
 *
 * Das Abbild setzt deshalb `SWISSHUB_SPLIT_BUILD_CHECKS=1` und fuehrt Lint
 * und Typpruefung **vorher** aus, jede in einem eigenen Prozess.
 *
 * ## Warum das ein Test ist
 *
 * Die Abmachung besteht aus zwei Teilen in zwei Dateien. Faellt der eine weg
 * - jemand raeumt die «doppelten» Schritte aus dem Dockerfile -, bleibt der
 * andere stehen, und das Abbild baut ab dann ohne jede Typpruefung. Das faellt
 * niemandem auf, bis ein Typfehler in Produktion landet.
 *
 * Deshalb steht hier: wer abschaltet, muss vorher geprueft haben.
 */
const lies = (pfad: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${pfad}`, import.meta.url)), 'utf8');

const dockerfile = lies('Dockerfile');
const nextConfig = lies('apps/web/next.config.ts');

describe('Pruefungen im Docker-Abbild', () => {
  it('schaltet die Pruefung in `next build` nur hinter einer Variablen ab', () => {
    /*
     * Ohne die Variable bleibt alles wie bisher - ein `npm run build` auf
     * einem Entwicklungsrechner prueft weiterhin selbst. Stuende
     * `ignoreBuildErrors: true` unbedingt da, waere es das Verstecken von
     * Fehlern und nicht ihr Verschieben.
     */
    expect(nextConfig).toContain("process.env.SWISSHUB_SPLIT_BUILD_CHECKS === '1'");
    expect(nextConfig).toMatch(
      /geteilteBuildPruefung\s*\n?\s*\?\s*\{\s*typescript:\s*\{\s*ignoreBuildErrors:\s*true/u,
    );
    // Nirgends bedingungslos.
    const unbedingt = /^\s*typescript:\s*\{\s*ignoreBuildErrors:\s*true/mu;
    expect(nextConfig).not.toMatch(unbedingt);
  });

  it('prueft im Abbild ausdruecklich, bevor es die Pruefung im Build abschaltet', () => {
    const lintZeile = dockerfile.indexOf('RUN npm run lint');
    const tscWurzel = dockerfile.indexOf('RUN npx tsc -p tsconfig.json --noEmit');
    const tscWeb = dockerfile.indexOf('RUN npx tsc -p apps/web/tsconfig.json --noEmit');
    const variable = dockerfile.indexOf('ENV SWISSHUB_SPLIT_BUILD_CHECKS=1');
    const build = dockerfile.indexOf('RUN npm run build --workspace @swisshub/web');

    for (const [name, stelle] of Object.entries({ lintZeile, tscWurzel, tscWeb, variable, build })) {
      expect(stelle, `${name} fehlt im Dockerfile`).toBeGreaterThan(-1);
    }

    // Reihenfolge: erst pruefen, dann abschalten, dann bauen.
    expect(lintZeile).toBeLessThan(variable);
    expect(tscWurzel).toBeLessThan(variable);
    expect(tscWeb).toBeLessThan(variable);
    expect(variable).toBeLessThan(build);
  });

  it('behaelt die Heap-Grenze - sie ist der Grund fuer die Aufteilung', () => {
    /*
     * Der Server hat 2 GB. Die Grenze einfach hochzusetzen hiesse, den Build
     * ins Auslagern zu schicken - und dann scheitert er nicht, er steht.
     */
    expect(dockerfile).toMatch(/ENV NODE_OPTIONS=--max-old-space-size=(\d+)/u);
    const treffer = /ENV NODE_OPTIONS=--max-old-space-size=(\d+)/u.exec(dockerfile);
    expect(Number(treffer?.[1])).toBeLessThanOrEqual(1536);
  });
});
