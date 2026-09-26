import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Die Buehne der oeffentlichen Profilseite.
 *
 * ## Warum das ueberhaupt geprueft wird
 *
 * Die naheliegende Abkuerzung bei «sechs verschiedene Designs» ist ein
 * Layout mit sechs Farben. Von aussen faellt das erst auf, wenn man zwei
 * Profile nebeneinanderhaelt - und dann ist es gebaut.
 *
 * Geprueft wird deshalb, **dass sie sich unterscheiden**: jede Anordnung
 * genau einmal vergeben, und keine zwei Themes mit derselben Kombination
 * aus Anordnung, Kante, Avatar, Muster und Schrift.
 *
 * Dazu die zwei Zusagen, die ein Blick nicht zuverlaessig entscheidet:
 * dass jede Klasse, die die Registry nennt, in der CSS-Datei existiert -
 * ein fehlender Klassenname faellt sonst nur bei genau dem einen Theme auf,
 * das ihn braucht - und dass `prefers-reduced-motion` alles abschaltet.
 */
const themes = await import('@swisshub/modules/profil/profil-themes');

const CSS = readFileSync(join(process.cwd(), 'apps/web/src/modules/profile/profil-oeffentlich.css'), 'utf8');
const SEITE = readFileSync(
  join(process.cwd(), 'apps/web/src/modules/profile/components/oeffentlich/oe-seite.tsx'),
  'utf8',
);

const ALLE = themes.alleProfilThemes();
/*
 * Die Designs, die nicht jedem offenstehen.
 *
 * Nicht `theme.premium` allein: Prestige haengt am Level und ausdruecklich
 * NICHT am Abonnement, waere mit dem alten Filter also herausgefallen - und
 * genau dieses Design soll am gruendlichsten gestaltet sein.
 */
const PREMIUM = ALLE.filter((theme) => theme.premium || theme.mindestLevel !== null);

describe('Buehne: die Themes unterscheiden sich', () => {
  it('bringt mindestens sechs gesperrte Designs mit', () => {
    expect(PREMIUM.length).toBeGreaterThanOrEqual(6);
  });

  it('vergibt jede Anordnung genau einmal', () => {
    /*
     * Zwei Themes mit derselben Anordnung waeren zwei Themes mit derselben
     * Seite in einer anderen Farbe - genau das, was hier nicht entstehen
     * soll.
     */
    const kompositionen = ALLE.map((theme) => theme.komposition);
    expect(new Set(kompositionen).size).toBe(ALLE.length);
  });

  it('gibt keinen zwei Themes dieselbe Kombination', () => {
    const fingerabdruecke = ALLE.map((theme) =>
      [theme.komposition, theme.kante, theme.avatar, theme.muster, theme.schrift].join('/'),
    );
    expect(new Set(fingerabdruecke).size).toBe(ALLE.length);
  });

  it('unterscheidet die Premium-Designs in mindestens drei Merkmalen paarweise', () => {
    /*
     * Nicht nur «irgendwo anders», sondern **deutlich** anders. Zwei
     * Designs, die sich in einem einzigen Merkmal unterscheiden, sind fuer
     * jemanden, der sie nacheinander ansieht, dasselbe Design.
     */
    for (const a of PREMIUM) {
      for (const b of PREMIUM) {
        if (a.id === b.id) {
          continue;
        }
        const merkmale: Array<[unknown, unknown]> = [
          [a.komposition, b.komposition],
          [a.kante, b.kante],
          [a.avatar, b.avatar],
          [a.muster, b.muster],
          [a.schrift, b.schrift],
          [a.tokens?.['--profil-akzent'], b.tokens?.['--profil-akzent']],
          [a.tokens?.['--profil-flaeche'], b.tokens?.['--profil-flaeche']],
          [a.kulisse, b.kulisse],
          [a.bannerVerlauf, b.bannerVerlauf],
        ];
        const anders = merkmale.filter(([links, rechts]) => links !== rechts).length;
        expect(anders, `${a.id} gegen ${b.id}`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe('Buehne: jede Klasse existiert', () => {
  it('kennt zu jeder Anordnung ein Layout', () => {
    for (const theme of ALLE) {
      expect(CSS, theme.id).toContain(`.po-${theme.komposition}-layout`);
    }
  });

  it('kennt zu jeder Kantenform eine Regel', () => {
    for (const theme of ALLE) {
      expect(CSS, theme.id).toContain(`.po-${theme.kante}`);
    }
  });

  it('kennt zu jeder Avatarform eine Regel', () => {
    for (const theme of ALLE) {
      expect(CSS, theme.id).toContain(`.po-avatar-${theme.avatar}`);
    }
  });

  it('kennt zu jedem Muster eine Regel', () => {
    for (const theme of ALLE) {
      expect(CSS, theme.id).toContain(`.po-${theme.muster} .po-karte::before`);
    }
  });

  it('kennt zu jeder Schrift eine Regel', () => {
    for (const theme of ALLE) {
      expect(CSS, theme.id).toContain(`.po-${theme.schrift} .po-name`);
    }
  });
});

describe('Buehne: Bewegung und Barrierefreiheit', () => {
  it('bewegt ausschliesslich transform und opacity', () => {
    /*
     * Alles andere zwingt den Browser zum Neuzeichnen - auf dem Telefon
     * ist das der Unterschied zwischen fluessig und ruckelig.
     */
    const bloecke = CSS.match(/@keyframes[\s\S]*?\n\}/gu) ?? [];
    expect(bloecke.length).toBeGreaterThan(0);
    for (const block of bloecke) {
      const eigenschaften = [...block.matchAll(/^\s{4}([a-z-]+):/gmu)].map((treffer) => treffer[1]);
      for (const eigenschaft of eigenschaften) {
        expect(['transform', 'opacity'], block.slice(0, 40)).toContain(eigenschaft);
      }
    }
  });

  it('schaltet bei reduzierter Bewegung alles ab', () => {
    const block = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(block).toContain('.po-auftritt');
    expect(block).toContain('animation: none');
    expect(block).toContain('.po-hebt');
  });

  it('hebt nur dort, wo es einen Zeiger gibt', () => {
    // Ein Hover-Zustand bleibt auf dem Telefon nach dem Tippen kleben.
    expect(CSS).toContain('@media (hover: hover)');
  });

  it('nimmt schmalen Geraeten die Einrueckungen', () => {
    const block = CSS.slice(CSS.indexOf('@media (max-width: 899px)'));
    expect(block).toContain('margin-inline: 0');
  });
});

describe('Buehne: die oeffentliche Seite ist eine eigene', () => {
  it('rendert nicht die interne Profilansicht', () => {
    /*
     * Der Kern der Trennung. Die interne Ansicht lebt neben Akte und
     * Dashboard und soll dorthin passen; die oeffentliche ist das, was ein
     * Besucher sieht. Eine Komponente fuer beides kann beides halb.
     */
    const seitenDatei = readFileSync(join(process.cwd(), 'apps/web/src/app/u/[slug]/page.tsx'), 'utf8');
    expect(seitenDatei).toContain('OeffentlicheProfilseite');
    expect(seitenDatei).not.toContain('ProfilAnsicht');
  });

  it('setzt die Klassen aus der Registry statt eigener Entscheidungen', () => {
    expect(SEITE).toContain('`po-${buehne.komposition}-layout`');
    expect(SEITE).toContain('`po-${buehne.kante}`');
    expect(SEITE).toContain('`po-${buehne.muster}`');
    expect(SEITE).toContain('`po-${buehne.schrift}`');
  });

  it('prueft keine Sichtbarkeit mehr', () => {
    /*
     * Das hat `ladeOeffentlichesProfil` erledigt. Eine zweite Pruefung
     * hier waere zu spaet - die Daten stuenden dann schon im HTML - und
     * eine zweite Stelle mit derselben Regel.
     */
    expect(SEITE).not.toContain('visibility');
    expect(SEITE).not.toContain('PUBLIC');
  });
});
