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
     * Level haengt und ausdruecklich NICHT an `premium`, sind es sechs
     * Premium-Designs und eines mit Levelbindung - zusammen sieben, die
     * nicht jedem offenstehen.
     *
     * Die sechste Premium-Gestaltung ist «Schichtglas». Dass die Zahl hier
     * fest steht und nicht `>= 5` heisst, ist Absicht: ein Theme, das
     * versehentlich `premium: true` bekommt, waere sonst still fuer
     * Abonnenten offen, und genau das soll auffallen.
     */
    const fordernd = ALLE.filter((theme) => theme.premium || theme.mindestLevel !== null);
    expect(fordernd.length).toBeGreaterThanOrEqual(7);
    expect(ALLE.filter((theme) => theme.premium).length).toBe(6);
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

  it('bewegt in jedem gesperrten Design mindestens vier Lagen', () => {
    /*
     * Der Vorwurf war «zu statisch», und er traf zu: drei Lagen, davon eine
     * ohne Animation, ergaben ein Bild, das man fuer ein Standbild halten
     * konnte. Jetzt fuenf Lagen je Design, und mindestens vier davon
     * bewegen sich.
     */
    for (const theme of ALLE.filter((t) => t.premium || t.mindestLevel !== null)) {
      const klasse = theme.kulisse;
      const bewegte = [1, 2, 3, 4, 5].filter((nummer) => {
        const regel = CSS.slice(CSS.indexOf(`.${klasse} .pt-lage-${nummer} {`));
        const block = regel.slice(0, regel.indexOf('}'));
        return block.includes('animation:');
      });
      expect(bewegte.length, `${theme.id} bewegt nur ${bewegte.length} Lagen`).toBeGreaterThanOrEqual(4);
    }
  });

  it('gibt jedem Design eine eigene Bewegungssprache', () => {
    /*
     * Sechs Designs mit demselben Keyframe waeren sechs Farbvarianten. Jedes
     * gesperrte Design muss mindestens eine Bewegung benutzen, die kein
     * anderes benutzt - sonst unterscheidet es sich nur im Farbton.
     */
    const jeTheme = new Map<string, Set<string>>();
    for (const theme of ALLE.filter((t) => t.premium || t.mindestLevel !== null)) {
      const ab = CSS.indexOf(`.${theme.kulisse} .pt-lage-1 {`);
      const bis = CSS.indexOf('/* ---', ab + 10);
      const block = CSS.slice(ab, bis === -1 ? undefined : bis);
      const namen = [...block.matchAll(/animation:\s*([a-z-]+)/gu)].map((m) => m[1] as string);
      jeTheme.set(theme.id, new Set(namen));
    }

    for (const [id, eigene] of jeTheme) {
      const andere = new Set([...jeTheme].filter(([k]) => k !== id).flatMap(([, s]) => [...s]));
      const einzig = [...eigene].filter((name) => !andere.has(name));
      expect(einzig.length, `${id} hat keine eigene Bewegung`).toBeGreaterThanOrEqual(1);
    }
  });

  it('reagiert auf den Zeiger, ohne die Animation zu stoeren', () => {
    /*
     * Die Parallaxe sitzt auf `translate`, die Keyframes auf `transform`.
     * Beides auf `transform` hiesse, dass eines das andere ueberschreibt -
     * und je nach Reihenfolge waere entweder die Maus oder die Animation
     * wirkungslos.
     */
    expect(CSS).toContain('--pt-maus-x');
    expect(CSS).toContain('--pt-maus-y');
    expect(CSS).toMatch(/translate:\s*calc\(var\(--pt-maus-x\)/u);
    // Und die Tiefe je Lage - sonst waere es keine Parallaxe, sondern ein Schub.
    for (const nummer of [1, 2, 3, 4, 5]) {
      expect(CSS).toMatch(new RegExp(`\\.pt-lage-${nummer} \\{\\s*--pt-tiefe:`, 'u'));
    }
  });

  it('haelt die Kulisse an, wenn niemand hinsieht', () => {
    expect(CSS).toContain('.pt-kulisse--ruht .pt-lage');
    expect(CSS).toContain('animation-play-state: paused');
  });

  it('schaltet bei reduzierter Bewegung auch die Zeiger-Parallaxe ab', () => {
    const block = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(block).toMatch(/translate:\s*none\s*!important/u);
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

describe('Schichtglas - das achte Design', () => {
  const OEFFENTLICH = readFileSync(
    join(process.cwd(), 'apps/web/src/modules/profile/profil-oeffentlich.css'),
    'utf8',
  );
  const theme = themes.profilTheme('schichtglas');

  it('ist ein gewoehnliches Premium-Design', () => {
    /*
     * `premium: true`, `mindestLevel: null`. Es haengt am Abonnement wie die
     * fuenf davor - nicht am Level. Alles andere waere ein zweites Prestige.
     */
    expect(theme.premium).toBe(true);
    expect(theme.mindestLevel).toBeNull();
  });

  it('steht Premium-Mitgliedern offen und anderen nicht', () => {
    expect(themes.themeFreigeschaltet(theme, { hatPremium: true, level: 1 })).toBe(true);
    expect(themes.themeFreigeschaltet(theme, { hatPremium: false, level: 99 })).toBe(false);
  });

  it('faellt ohne Abonnement auf das Standarddesign zurueck', () => {
    // Die Wahl bleibt gespeichert, die Wirkung endet - wie bei den uebrigen.
    expect(themes.wirksamesTheme('schichtglas', { hatPremium: false, level: 50 }).id).toBe('classic');
    expect(themes.wirksamesTheme('schichtglas', { hatPremium: true, level: 1 }).id).toBe('schichtglas');
  });

  it('laesst die Prestige-Regel unberuehrt', () => {
    /*
     * Der Satz, der bei jedem neuen Design zu pruefen ist. Prestige haengt
     * ausschliesslich am Level; ein sechstes Premium-Design darf daran nichts
     * aendern - auch nicht versehentlich ueber eine gemeinsame Pruefung.
     */
    const prestige = themes.profilTheme('prestige');
    expect(prestige.premium).toBe(false);
    expect(prestige.mindestLevel).toBe(themes.PRESTIGE_MINDESTLEVEL);
    expect(themes.themeFreigeschaltet(prestige, { hatPremium: true, level: 30 })).toBe(false);
    expect(themes.themeFreigeschaltet(prestige, { hatPremium: false, level: 31 })).toBe(true);
  });

  it('bringt eine eigene Anordnung und ein eigenes Muster mit', () => {
    /*
     * Der Unterschied zwischen einem Design und einer Farbvariante. Beide
     * Werte sind neu - keiner der sieben davor benutzt sie.
     */
    expect(theme.komposition).toBe('schichten');
    expect(theme.muster).toBe('glas');

    const andere = ALLE.filter((eintrag) => eintrag.id !== 'schichtglas');
    expect(andere.some((eintrag) => eintrag.komposition === 'schichten')).toBe(false);
    expect(andere.some((eintrag) => eintrag.muster === 'glas')).toBe(false);
  });

  it('hat eine Kulisse, die es im Stylesheet auch gibt', () => {
    expect(theme.kulisse).toBe('pt-schichtglas');
    // Fuenf Lagen, wie bei den uebrigen aufwendigen Designs.
    for (const lage of [1, 2, 3, 4, 5]) {
      expect(CSS, `Lage ${lage} fehlt`).toContain(`.pt-schichtglas .pt-lage-${lage}`);
    }
  });

  it('bewegt nur transform und opacity', () => {
    /*
     * Beides laeuft auf dem Compositor: kein Layout, kein Neuzeichnen. Eine
     * Kulisse, die `background-position` oder `width` animiert, kostet auf
     * einem Telefon jede Bildwiederholung - und das dauerhaft, denn die
     * Kulisse steht immer.
     */
    const bloecke = [...CSS.matchAll(/@keyframes (pt-glas-[a-z-]+)\s*\{([\s\S]*?)\n\}/gu)];
    expect(bloecke.length, 'Keine Schichtglas-Keyframes gefunden').toBeGreaterThanOrEqual(3);

    for (const [, name, koerper] of bloecke) {
      const eigenschaften = [...(koerper ?? '').matchAll(/^\s{4}([a-z-]+):/gmu)].map((treffer) => treffer[1]);
      for (const eigenschaft of eigenschaften) {
        expect(['transform', 'opacity'], `${name} bewegt ${eigenschaft}`).toContain(eigenschaft);
      }
    }
  });

  it('steht still, wenn jemand weniger Bewegung will', () => {
    /*
     * Die globale Regel haelt jede Lage an. Zusaetzlich muss die Lichtkante
     * **verschwinden** und nicht stehenbleiben: ein heller Streifen, der
     * mitten im Bild parkt, waere kein Standbild, das gut aussieht.
     */
    const block = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(block).toMatch(/animation:\s*none\s*!important/u);
    expect(block).toContain('.pt-schichtglas .pt-lage-3');
    expect(block).toContain('.pt-schichtglas .pt-lage-5');
  });

  it('bringt die Anordnung und das Muster auch im Stylesheet der Seite mit', () => {
    expect(OEFFENTLICH).toContain('.po-schichten-layout .po-inhalt');
    expect(OEFFENTLICH).toContain('.po-glas .po-karte::before');
  });

  it('staffelt erst ab Tabletbreite - auf dem Telefon stehen die Ebenen untereinander', () => {
    /*
     * Ein Versatz von 2.5rem auf 375 Pixel Breite waere ein Abschnitt, der
     * rechts nicht mehr hinpasst. Der Versatz steht deshalb in der
     * Medienabfrage; die Glaskante bleibt auf jeder Breite.
     */
    const ab = OEFFENTLICH.indexOf('.po-schichten-layout .po-inhalt');
    const abschnitt = OEFFENTLICH.slice(ab, ab + 1800);
    const versatz = abschnitt.indexOf('margin-inline: 0 2.5rem');
    const medien = abschnitt.indexOf('@media (min-width: 900px)');
    expect(medien).toBeGreaterThan(-1);
    expect(versatz).toBeGreaterThan(medien);
  });
});
