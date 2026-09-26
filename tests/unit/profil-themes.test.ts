import { describe, expect, it } from 'vitest';

/**
 * Die Profil-Themes.
 *
 * ## Was hier wirklich geprüft wird
 *
 * Nicht, ob sie schön sind - das entscheidet ein Blick auf die Seite.
 * Sondern drei Dinge, die ein Blick **nicht** zuverlässig entscheidet:
 *
 *   - **Dass sie sich unterscheiden.** Die naheliegende Abkürzung wären
 *     sechs identische Hintergründe mit einer anderen Akzentfarbe. Von
 *     aussen fällt das erst auf, wenn man zwei nebeneinanderhält.
 *   - **Dass die Bewegung existiert.** Ein Theme, dessen Kulisse in der
 *     CSS-Datei fehlt, rendert drei leere Kästen - und sieht aus wie ein
 *     dunkles Standarddesign.
 *   - **Dass `prefers-reduced-motion` alles abschaltet.** Eine einzige
 *     vergessene Animation genügt, um jemandem Übelkeit zu bereiten.
 */
const themes = await import('@swisshub/modules/profil/profil-themes');
const { readFileSync } = await import('node:fs');
const { join } = await import('node:path');

const CSS = readFileSync(join(process.cwd(), 'apps/web/src/modules/profile/profil-themes.css'), 'utf8');

const ALLE = themes.alleProfilThemes();

describe('Theme-Registry', () => {
  it('kennt ein Standarddesign und mehrere gesperrte Designs', () => {
    expect(themes.STANDARD_THEME.id).toBe('classic');
    expect(themes.STANDARD_THEME.premium).toBe(false);
    expect(themes.STANDARD_THEME.mindestLevel).toBeNull();

    /*
     * Gezaehlt wird «fordert etwas», nicht «premium».
     *
     * Vorher stand hier `theme.premium` und die Zahl 6. Seit Prestige am
     * Level haengt und ausdruecklich NICHT an `premium`, sind es fuenf
     * Premium-Designs und eines mit Levelbindung - zusammen weiterhin
     * sechs, die nicht jedem offenstehen.
     */
    const fordernd = ALLE.filter((theme) => theme.premium || theme.mindestLevel !== null);
    expect(fordernd.length).toBeGreaterThanOrEqual(6);
    expect(ALLE.filter((theme) => theme.premium).length).toBe(5);
    expect(ALLE.filter((theme) => theme.mindestLevel !== null).length).toBe(1);
  });

  it('fällt bei einem unbekannten Schlüssel sicher auf den Standard zurück', () => {
    // Der Fall: ein Theme wird zurückgezogen, der Schlüssel steht noch in
    // der Datenbank. Das Profil muss lesbar bleiben.
    expect(themes.profilTheme('gibt-es-nicht').id).toBe('classic');
    expect(themes.profilTheme(null).id).toBe('classic');
    expect(themes.profilTheme(undefined).id).toBe('classic');
    expect(themes.profilTheme('').id).toBe('classic');
    expect(themes.istProfilTheme('gibt-es-nicht')).toBe(false);
  });

  it('lässt das Standarddesign die Wahl des Mitglieds unangetastet', () => {
    // `tokens: null` heisst: nichts überschreiben. Akzent und Flächenton
    // aus dem Editor gelten weiter - der Standard ist kein Rückschritt.
    expect(themes.STANDARD_THEME.tokens).toBeNull();
    expect(themes.STANDARD_THEME.bannerVerlauf).toBeNull();
  });
});

describe('Die Themes unterscheiden sich wirklich', () => {
  const premium = ALLE.filter((theme) => theme.premium);

  it('gibt jedem Theme eine eigene Kulisse', () => {
    const kulissen = new Set(ALLE.map((theme) => theme.kulisse));
    expect(kulissen.size, 'Zwei Themes teilen sich eine Kulisse').toBe(ALLE.length);
  });

  it('gibt jedem Premium-Theme eine eigene Farbwelt - nicht nur einen anderen Akzent', () => {
    for (const theme of premium) {
      const tokens = theme.tokens!;
      // Vier Variablen, nicht eine: wer nur den Akzent tauscht, hat kein
      // Theme gebaut, sondern eine Farbe gewählt.
      expect(Object.keys(tokens).length, `${theme.id}: zu wenige Tokens`).toBeGreaterThanOrEqual(4);
      expect(tokens['--profil-flaeche'], `${theme.id}: keine eigene Fläche`).toBeTruthy();
    }

    const flaechen = new Set(premium.map((theme) => theme.tokens!['--profil-flaeche']));
    expect(flaechen.size, 'Zwei Premium-Themes haben denselben Flächenton').toBe(premium.length);

    const akzente = new Set(premium.map((theme) => theme.tokens!['--profil-akzent']));
    expect(akzente.size, 'Zwei Premium-Themes haben denselben Akzent').toBe(premium.length);
  });

  it('bringt zu jedem Premium-Theme ein eigenes Banner mit', () => {
    // Sonst sass ein dunkelroter Bannerkopf in einem türkisen Profil.
    const verlaeufe = new Set(premium.map((theme) => theme.bannerVerlauf));
    expect(verlaeufe.size).toBe(premium.length);
    for (const theme of premium) {
      expect(theme.bannerVerlauf, `${theme.id}: kein Banner`).toBeTruthy();
    }
  });
});

describe('Die Animationen', () => {
  it.each(ALLE.map((theme) => [theme.id, theme] as const))(
    '%s hat eine Kulisse in der CSS-Datei',
    (_id, theme) => {
      expect(CSS, `${theme.kulisse} fehlt in profil-themes.css`).toContain(`.${theme.kulisse} `);
    },
  );

  it.each(ALLE.filter((theme) => theme.premium).map((theme) => [theme.id, theme] as const))(
    '%s bewegt sich tatsächlich',
    (_id, theme) => {
      // Der Abschnitt dieses Themes muss mindestens eine `animation`
      // tragen - ein Premium-Theme ohne Bewegung wäre ein Farbverlauf.
      const abschnitt = CSS.split(`.${theme.kulisse} `).slice(1).join('\n');
      expect(abschnitt, `${theme.id} ist statisch`).toMatch(/animation:/u);
    },
  );

  it('animiert ausschliesslich transform und opacity', () => {
    /*
     * Jede andere Eigenschaft - `top`, `width`, eine Farbe - erzwingt in
     * jedem Bild Layout oder Paint. Bei einer Seite, die minutenlang offen
     * liegt, ist das der Unterschied zwischen ein paar Prozent GPU und
     * einem warmen Telefon.
     */
    const rahmen = CSS.match(/@keyframes[\s\S]*?\n\}/gu) ?? [];
    expect(rahmen.length).toBeGreaterThan(5);

    for (const block of rahmen) {
      const eigenschaften = [...block.matchAll(/^\s{4}([a-z-]+):/gmu)].map((treffer) => treffer[1]);
      for (const eigenschaft of eigenschaften) {
        expect(['transform', 'opacity'], `@keyframes animiert «${eigenschaft}»`).toContain(eigenschaft);
      }
    }
  });

  it('schaltet bei reduzierter Bewegung jede Animation ab', () => {
    expect(CSS).toContain('@media (prefers-reduced-motion: reduce)');
    const block = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(block).toMatch(/animation:\s*none\s*!important/u);
  });

  it('nimmt auf schmalen Geräten Last weg', () => {
    expect(CSS).toContain('@media (max-width: 640px)');
  });
});

describe('Premium entscheidet über die Wirkung, nicht über die Wahl', () => {
  /** Jemand mit Abonnement, aber ohne erspieltes Level. */
  const nurPremium = { hatPremium: true, level: 0 };
  const nichts = { hatPremium: false, level: 0 };

  it('zeigt ein Premium-Theme nur mit aktivem Abonnement', () => {
    expect(themes.wirksamesTheme('crimson', nurPremium).id).toBe('crimson');
    expect(themes.wirksamesTheme('crimson', nichts).id).toBe('classic');
  });

  it('lässt das Standarddesign auch ohne Abonnement gelten', () => {
    expect(themes.wirksamesTheme(null, nichts).id).toBe('classic');
    expect(themes.wirksamesTheme('classic', nichts).id).toBe('classic');
  });

  it('gibt dieselbe Wahl nach der Rückkehr wieder frei', () => {
    /*
     * Der Ablauf, um den es geht: gewählt, Abonnement endet, Abonnement
     * kommt zurück. Die gespeicherte Wahl wird nie angefasst - sie wirkt
     * einfach wieder. Deshalb braucht es keinen Zeitgeber, der beim
     * Ablaufen aufräumt, und niemand muss neu wählen.
     */
    const gespeichert = 'crimson';
    expect(themes.wirksamesTheme(gespeichert, nurPremium).id).toBe('crimson');
    expect(themes.wirksamesTheme(gespeichert, nichts).id).toBe('classic');
    expect(themes.wirksamesTheme(gespeichert, nurPremium).id).toBe('crimson');
  });
});

/**
 * Prestige haengt am Level und an nichts sonst.
 *
 * Der Kern der Anforderung: es soll erspielt sein. Kein Abonnement, keine
 * Adminrolle, keine Moderationsrolle und keine allgemeine
 * Theme-Berechtigung darf daran vorbeiführen - und ein manipulierter Request
 * schon gar nicht.
 *
 * Geprueft wird die reine Funktion. Dass der Server sie auch wirklich fragt,
 * steht im Integrationstest `profil-theme-premium.test.ts`.
 */
describe('Prestige: erspielt, nicht gekauft', () => {
  const PRESTIGE = themes.PRESTIGE_MINDESTLEVEL;

  it('ist auf Level 30 gesperrt', () => {
    expect(themes.wirksamesTheme('prestige', { hatPremium: false, level: 30 }).id).toBe('classic');
  });

  it('ist auf Level 31 freigeschaltet', () => {
    expect(themes.wirksamesTheme('prestige', { hatPremium: false, level: 31 }).id).toBe('prestige');
  });

  it('verlangt genau die dokumentierte Grenze', () => {
    expect(PRESTIGE).toBe(31);
    expect(themes.profilTheme('prestige').mindestLevel).toBe(PRESTIGE);
  });

  it('bleibt Premium-Abonnenten ohne Level verschlossen', () => {
    // Der wichtigste Fall: bezahlen hilft hier nicht.
    expect(themes.wirksamesTheme('prestige', { hatPremium: true, level: 30 }).id).toBe('classic');
  });

  it('haengt nicht am Premium-Kennzeichen', () => {
    /*
     * Waere `premium: true` gesetzt, nähme Prestige die ODER-Verknüpfung der
     * Premium-Pruefung mit und stände jedem Abonnenten und jedem
     * Teammitglied offen. Genau das soll nicht sein.
     */
    expect(themes.profilTheme('prestige').premium).toBe(false);
  });

  it('ist das einzige Design mit Levelbindung', () => {
    const mitLevel = themes
      .alleProfilThemes()
      .filter((theme) => theme.mindestLevel !== null)
      .map((theme) => theme.id);
    expect(mitLevel).toEqual(['prestige']);
  });

  it('nimmt die Wirkung weg, wenn das Level verloren geht - behaelt aber die Wahl', () => {
    /*
     * XP-Verfall kann unter 31 zurückfallen. Die gespeicherte Wahl bleibt;
     * nur die Wirkung endet, und sie kommt beim Wiedererreichen zurück.
     */
    const gespeichert = 'prestige';
    expect(themes.wirksamesTheme(gespeichert, { hatPremium: false, level: 35 }).id).toBe('prestige');
    expect(themes.wirksamesTheme(gespeichert, { hatPremium: false, level: 29 }).id).toBe('classic');
    expect(themes.wirksamesTheme(gespeichert, { hatPremium: false, level: 35 }).id).toBe('prestige');
  });

  it('prueft beide Voraussetzungen mit UND, nicht mit ODER', () => {
    /*
     * Ein gedachtes Design, das beides fordert, darf mit nur einem davon
     * nicht durchkommen. Die Regel steht in `themeFreigeschaltet`.
     */
    const beides = { ...themes.profilTheme('prestige'), premium: true };
    expect(themes.themeFreigeschaltet(beides, { hatPremium: true, level: 30 })).toBe(false);
    expect(themes.themeFreigeschaltet(beides, { hatPremium: false, level: 31 })).toBe(false);
    expect(themes.themeFreigeschaltet(beides, { hatPremium: true, level: 31 })).toBe(true);
  });
});
