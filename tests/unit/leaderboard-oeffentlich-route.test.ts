import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Die öffentliche Rangliste ist wirklich öffentlich.
 *
 * Und sie bleibt es nur, solange sie ausserhalb der geschützten
 * Routengruppe liegt und keine Berechtigung prüft. Beides lässt sich hier
 * festhalten, ohne einen Browser zu starten - anders als die Frage, ob sie
 * hübsch aussieht.
 */
const WURZEL = process.cwd();
const lies = (pfad: string): string => readFileSync(join(WURZEL, pfad), 'utf8');
const ohneKommentare = (quelle: string): string =>
  quelle.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');

const seite = lies('apps/web/src/app/leaderboard/page.tsx');
const layout = lies('apps/web/src/app/leaderboard/layout.tsx');
const rang = lies('apps/web/src/app/leaderboard/rang.tsx');
const css = lies('apps/web/src/app/globals.css');

describe('Öffentliche Route', () => {
  it('liegt ausserhalb der geschützten Routengruppe', () => {
    // `(app)` trägt das Layout mit der Anmeldepflicht. Was dort liegt, ist
    // nicht öffentlich - egal, was die Seite selbst tut.
    expect(existsSync(join(WURZEL, 'apps/web/src/app/leaderboard/page.tsx'))).toBe(true);
    expect(existsSync(join(WURZEL, 'apps/web/src/app/(app)/leaderboard'))).toBe(false);
  });

  it('verlangt keine Berechtigung und keine Anmeldung', () => {
    const code = ohneKommentare(seite);
    expect(code).not.toContain('requirePagePermission');
    expect(code).not.toContain('requireAuthContext');
    expect(code).not.toContain('redirect(');
  });

  it('nutzt die Anmeldung höchstens, um den Knopf zu beschriften', () => {
    // Das Layout darf wissen, ob jemand angemeldet ist - abhängen darf die
    // Seite davon nicht. `getOptionalAuthContext` erzwingt nichts.
    expect(layout).toContain('getOptionalAuthContext');
    expect(ohneKommentare(layout)).not.toContain('requirePagePermission');
  });

  it('zeigt nicht die Verwaltungsnavigation', () => {
    expect(seite).not.toContain('LevelSectionNav');
    expect(layout).not.toContain('Sidebar');
  });
});

describe('Keine zweite Level-Logik', () => {
  it('holt die Rangliste über die zentrale Projektion', () => {
    expect(seite).toContain('level.getPublicLeaderboard(');
  });

  it('rechnet in der Seite weder XP noch Level', () => {
    const code = ohneKommentare(seite) + ohneKommentare(rang);
    for (const verboten of ['levelFromXp', 'xpForLevel', 'prisma.', 'levelProfile']) {
      expect(code, `«${verboten}» gehört nicht in die Anzeige`).not.toContain(verboten);
    }
  });

  it('gibt nur die Felder der Projektion aus', () => {
    // Der Typ kommt aus `getPublicLeaderboard` - wer ein Feld anzeigen will,
    // das dort nicht steht, bekommt einen Typfehler statt eines Lecks.
    expect(rang).toContain("Awaited<ReturnType<typeof level.getPublicLeaderboard>>['entries'][number]");
  });
});

describe('Aktualität', () => {
  it('rechnet bei jedem Aufruf neu', () => {
    // Eine Rangliste aus dem Cache zeigt jemanden auf Rang 4, der längst auf
    // 3 steht.
    expect(seite).toContain("export const dynamic = 'force-dynamic'");
    expect(seite).not.toContain('export const revalidate');
    expect(seite).not.toContain('unstable_cache');
  });
});

describe('Hintergrundanimation', () => {
  it('läuft ohne Canvas und ohne JavaScript', () => {
    const kulisse = lies('apps/web/src/app/leaderboard/kulisse.tsx');
    expect(kulisse).not.toContain('canvas');
    expect(kulisse).not.toContain('useEffect');
    expect(kulisse).not.toContain("'use client'");
    expect(kulisse).not.toContain('requestAnimationFrame');
  });

  it('bewegt nur, was der Compositor bewegen kann', () => {
    // `transform`, `opacity` und `background-position` lösen kein Layout aus.
    const bloecke = css.slice(css.indexOf('@keyframes lb-raster-lauf'));
    expect(bloecke).toMatch(/background-position/u);
    expect(bloecke).toMatch(/transform: translate3d/u);
    expect(bloecke).not.toMatch(/\n\s{4}(width|height|top|left):/u);
  });

  it('steht still bei reduzierter Bewegung', () => {
    const teil = css.slice(css.indexOf('.lb-raster'));
    expect(teil).toContain('@media (prefers-reduced-motion: reduce)');
    const block = teil.slice(teil.indexOf('@media (prefers-reduced-motion: reduce)'));
    for (const klasse of ['.lb-raster', '.lb-licht-a', '.lb-licht-b']) {
      expect(block).toContain(klasse);
    }
    expect(block).toContain('animation: none');
  });
});

describe('Mobil', () => {
  it('stapelt die ersten drei statt sie nebeneinander zu quetschen', () => {
    expect(seite).toContain('grid-cols-1');
    expect(seite).toContain('sm:grid-cols-3');
  });

  it('bringt den ersten Platz erst ab «sm» in die Mitte', () => {
    // Auf dem Telefon: 1, 2, 3 von oben nach unten - wie man eine Rangliste
    // liest.
    expect(seite).toContain("eintrag.rank === 1 && 'sm:order-2'");
    expect(seite).toContain("eintrag.rank === 2 && 'sm:order-1'");
  });

  it('zwingt die Ranking-Zeile nicht ins Querscrollen', () => {
    // Auf schmalen Geräten steht die XP-Zahl unter dem Namen statt in einer
    // eigenen Spalte, und der Name darf kürzen statt zu drängen.
    expect(rang).toContain('sm:hidden');
    expect(rang).toContain('hidden shrink-0 items-center gap-6 sm:flex');
    expect(rang).toContain('min-w-0 flex-1');
    expect(rang).toContain('truncate');
  });

  it('lässt die Ränge nicht springen', () => {
    expect(rang).toContain('tabular-nums');
  });
});

describe('Der Weg zum System', () => {
  it('verlinkt ohne ausgeschriebene Domain', () => {
    /*
     * Diese Seite liegt selbst auf dem System. Eine ausgeschriebene Domain
     * wäre eine zweite Stelle, die beim nächsten Umzug falsch wird - die
     * Adresse steht zentral in der Konfiguration.
     */
    expect(seite).toContain('href="/"');
    expect(seite).not.toContain('system.swisshub.gg');
    expect(layout).not.toContain('system.swisshub.gg');
  });

  it('nennt die Marke aus der zentralen Konfiguration', () => {
    expect(seite).toContain("from '@swisshub/config/client'");
    expect(seite).toContain('{branding.name}');
  });
});
