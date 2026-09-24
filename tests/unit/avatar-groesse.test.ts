import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Warum der Avatar seine Groesse ueber eine Variable bekommt.
 *
 * `DiscordAvatar` setzte `width` und `height` als Inline-Stil. Ein Aufrufer,
 * der `size-20 sm:size-24` danebenschrieb, bekam davon nichts: der Inline-Stil
 * schlaegt jede Klasse, und zwar lautlos. Im Profilkopf stand der Avatar
 * dadurch auf jedem Bildschirm gleich gross - auf dem Handy 96 Pixel, wo 80
 * gemeint waren. Gemessen im Browser, nicht vermutet.
 *
 * Seitdem traegt das Element `--avatar-eigen` (die Vorgabe aus `size`) und
 * liest `var(--avatar-size, var(--avatar-eigen))`. Ein Elternteil kann
 * `--avatar-size` je Breakpoint setzen und gewinnt dann - ohne gegen einen
 * Inline-Stil anzukommen.
 *
 * Diese Pruefung haelt beides fest, weil beides beim naechsten Umbau
 * versehentlich zurueckfaellt: ein `style={{ width: size }}` sieht harmlos
 * aus, und `ring-1` im Avatar sieht nach Sorgfalt aus.
 */
const AVATAR = readFileSync(join(process.cwd(), 'apps/web/src/components/shared/discord-avatar.tsx'), 'utf8');
const HERO = readFileSync(
  join(process.cwd(), 'apps/web/src/modules/profile/components/profil-hero.tsx'),
  'utf8',
);

describe('Avatar-Groesse', () => {
  it('setzt die Kantenlaenge nicht als Inline-Stil', () => {
    /*
     * Gemeint ist genau der Rueckfall: `width: size` im `style` des
     * Containers. Nicht gemeint sind die `width`/`height`-Attribute am
     * `<img>` - die reservieren den Platz, solange das Bild laedt, und
     * gehoeren dorthin - und auch nicht der Statuspunkt, der seine eigene
     * Groesse aus `size` ableitet.
     */
    expect(AVATAR).not.toMatch(/\b(width|height)\s*:\s*size\b/u);
  });

  it('liest die Groesse aus der Variable, mit der eigenen als Rueckfall', () => {
    expect(AVATAR).toContain('size-[var(--avatar-size,var(--avatar-eigen))]');
    expect(AVATAR).toContain("'--avatar-eigen'");
  });

  it('laesst sich den eigenen Rand abschalten', () => {
    // Ohne das Kennzeichen gaebe es im Profilkopf zwei Ringe ineinander.
    expect(AVATAR).toMatch(/ring\s*&&\s*'ring-1 ring-border'/u);
  });
});

describe('Profilkopf', () => {
  it('legt genau einen Ring um den Avatar', () => {
    expect(HERO).toContain('ring={false}');
    expect(HERO).toMatch(/ring-2 ring-\[hsl\(var\(--profil-akzent\)/u);
  });

  it('setzt die Groesse je Breakpoint ueber die Variable', () => {
    expect(HERO).toContain('[--avatar-size:80px]');
    expect(HERO).toContain('sm:[--avatar-size:96px]');
  });

  it('haelt Avatar und Ring in einem Flex-Kasten', () => {
    /*
     * `flex` und nicht `block`: der Avatar ist ein Inline-Element, und in
     * einem Blockkasten entstuende unter ihm die Luecke fuer die Grundlinie.
     * Der Kasten waere dann hoeher als breit - und `rounded-full` machte
     * daraus ein Oval.
     */
    expect(HERO).toMatch(/className="flex rounded-full p-1 ring-2/u);
  });
});
