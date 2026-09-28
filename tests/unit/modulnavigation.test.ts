import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ModulNavigation } from '../../apps/web/src/components/shared/modul-navigation';

/**
 * Die Unternavigation gehoert allen Modulen.
 *
 * ## Was vorher war
 *
 * Elf Leisten fuer dieselbe Frage. `modul-navigation.tsx` fuer Streamer Hub,
 * Wrapped und «SwissHub fragt» - und daneben zehn eigene `section-nav.tsx` in
 * Analytics, Jail, Kommunikation, Level, Moderation, Musik, Premium, Tickets,
 * Turnieren und Voice.
 *
 * Nicht zehnmal dasselbe: drei Gestalten. Reiter mit Unterstrich, Pillen ueber
 * einer Linie, und ein Segmentschalter in einem Kasten mit Ring. Wer von der
 * Moderation in die Musik wechselte, wechselte auch die Bedienung.
 *
 * ## Was dieser Test festhaelt
 *
 * Dass keine zwoelfte entsteht. Eine Modulleiste darf ihre Bereiche
 * uebersetzen - sie darf sie nicht selbst zeichnen. Geprueft wird deshalb
 * beides: dass jede Leiste die gemeinsame Komponente benutzt, und dass keine
 * von ihnen wieder eigene Reiter-Klassen mitbringt.
 */

const WURZEL = process.cwd();
const MODULE = join(WURZEL, 'apps/web/src/modules');

/** Alle Modul-Navigationsdateien - gefunden, nicht aufgezaehlt. */
function leisten(): { modul: string; pfad: string; quelle: string }[] {
  const gefunden: { modul: string; pfad: string; quelle: string }[] = [];
  for (const modul of readdirSync(MODULE)) {
    const pfad = join(MODULE, modul, 'components/section-nav.tsx');
    try {
      gefunden.push({ modul, pfad, quelle: readFileSync(pfad, 'utf8') });
    } catch {
      // Nicht jedes Modul hat eine Unternavigation - das ist in Ordnung.
    }
  }
  return gefunden;
}

const LEISTEN = leisten();

describe('Modulnavigation', () => {
  it('findet ueberhaupt Leisten', () => {
    /*
     * Ohne diese Pruefung waere ein umbenanntes Verzeichnis ein Test, der
     * nichts mehr prueft und trotzdem gruen ist.
     */
    expect(LEISTEN.length).toBeGreaterThanOrEqual(8);
  });

  it('laesst jede Modulleiste die gemeinsame Komponente benutzen', () => {
    for (const { modul, quelle } of LEISTEN) {
      expect(quelle, `${modul} benutzt ModulNavigation nicht`).toContain(
        "from '@/components/shared/modul-navigation'",
      );
      expect(quelle, `${modul} rendert ModulNavigation nicht`).toContain('<ModulNavigation');
    }
  });

  it('laesst keine Modulleiste eigene Reiter zeichnen', () => {
    /*
     * Die Merkmale, an denen die alten Leisten zu erkennen waren: ein
     * eigener `<nav>`, ein eigener aktiver Zustand, eigene Klassen fuer
     * Reiter. Wer sie wieder einfuehrt, baut die zwoelfte Leiste.
     *
     * Tickets darf `usePathname` behalten: es hebt damit sein Zahnrad hervor,
     * nicht einen Reiter. Die Reiter selbst kommen auch dort aus der
     * gemeinsamen Komponente.
     */
    for (const { modul, quelle } of LEISTEN) {
      expect(quelle, `${modul} zeichnet einen eigenen <nav>`).not.toMatch(/<nav[\s>]/u);
      expect(quelle, `${modul} bringt eigene Reiter-Klassen mit`).not.toContain('bg-primary/15');
      if (modul !== 'tickets') {
        expect(quelle, `${modul} entscheidet den aktiven Zustand selbst`).not.toContain('usePathname');
      }
    }
  });
});

/*
 * `usePathname` gibt es ausserhalb von Next nicht. Fuer die Tests unten zaehlt
 * nicht, welchen Pfad es liefert, sondern was die Leiste daraus macht - also
 * wird es auf einen festen Wert gesetzt.
 *
 * `vi.hoisted`, weil `vi.mock` an den Anfang der Datei gezogen wird: eine
 * gewoehnliche Konstante waere dort noch nicht da.
 */
const pfad = vi.hoisted(() => ({ wert: '/musik/sessions' }));
vi.mock('next/navigation', () => ({ usePathname: (): string => pfad.wert }));

describe('Die gemeinsame Leiste selbst', () => {
  /*
   * Bei jedem Aufruf neu laden.
   *
   * Die Leiste liest `usePathname` beim Rendern; ein zwischengespeichertes
   * Modul waere kein Problem, aber ein Import je Test macht sichtbar, dass
   * jeder Fall fuer sich steht.
   */
  const laden = async (): Promise<{ ModulNavigation: typeof ModulNavigation }> => ({
    ModulNavigation,
  });

  const EINTRAEGE = [
    { href: '/musik', label: 'Player' },
    { href: '/musik/sessions', label: 'Sessions' },
    { href: '/musik/verlauf', label: 'Verlauf' },
  ];

  it('erkennt den aktiven Bereich am Pfad, wenn die Seite nichts sagt', async () => {
    const { ModulNavigation } = await laden();
    const html = renderToStaticMarkup(
      createElement(ModulNavigation, { eintraege: EINTRAEGE, label: 'Musik-Bereiche' }),
    );

    // Genau einer ist die aktuelle Seite - nicht keiner und nicht zwei.
    expect(html.match(/aria-current="page"/gu)).toHaveLength(1);
    expect(html).toMatch(/aria-current="page"[^>]*>(?:(?!<\/a>).)*Sessions/u);
  });

  it('nimmt den laengsten passenden Bereich, nicht den ersten', async () => {
    /*
     * `/musik` ist ein Praefix von `/musik/sessions`. Eine Praefixpruefung
     * ohne «laengster Treffer» wuerde beide hervorheben - und die Leiste
     * behauptete, man sei an zwei Orten zugleich.
     */
    const { ModulNavigation } = await laden();
    const html = renderToStaticMarkup(
      createElement(ModulNavigation, { eintraege: EINTRAEGE, label: 'Musik-Bereiche' }),
    );
    expect(html).not.toMatch(/aria-current="page"[^>]*>(?:(?!<\/a>).)*Player/u);
  });

  it('haelt eine Unterseite beim Bereich, zu dem sie gehoert', async () => {
    // `/musik/sessions/17` ist keine eigene Auswahl - der Reiter bleibt stehen.
    pfad.wert = '/musik/sessions/17';
    const { ModulNavigation } = await laden();
    const html = renderToStaticMarkup(
      createElement(ModulNavigation, { eintraege: EINTRAEGE, label: 'Musik-Bereiche' }),
    );
    expect(html.match(/aria-current="page"/gu)).toHaveLength(1);
    pfad.wert = '/musik/sessions';
  });

  it('laesst die Seite entscheiden, wenn sie es tut', async () => {
    /*
     * Der Weg, den Streamer Hub, Wrapped und «SwissHub fragt» gehen: die
     * Seite weiss, wo sie steht, und sagt es. Das schlaegt den Pfad - sonst
     * koennte eine Detailseite keinen Reiter hervorheben.
     */
    const { ModulNavigation } = await laden();
    const html = renderToStaticMarkup(
      createElement(ModulNavigation, {
        eintraege: [
          { key: 'a', href: '/x/a', label: 'Aaa' },
          { key: 'b', href: '/x/b', label: 'Bbb' },
        ],
        aktiv: 'b',
        label: 'Test',
      }),
    );
    expect(html).toMatch(/aria-current="page"[^>]*>(?:(?!<\/a>).)*Bbb/u);
  });

  it('zeigt keine Leiste mit einem einzigen Bereich', async () => {
    const { ModulNavigation } = await laden();
    const html = renderToStaticMarkup(
      createElement(ModulNavigation, { eintraege: [EINTRAEGE[0]!], label: 'Test' }),
    );
    expect(html).toBe('');
  });

  it('laesst eine Null weg und zeigt eine Zahl', async () => {
    const { ModulNavigation } = await laden();
    const mitNull = renderToStaticMarkup(
      createElement(ModulNavigation, {
        eintraege: [
          { href: '/a', label: 'Aaa', badge: 0 },
          { href: '/b', label: 'Bbb', badge: 3 },
        ],
        label: 'Test',
      }),
    );
    // Eine Null ist keine Nachricht.
    expect(mitNull).not.toMatch(/>0</u);
    expect(mitNull).toMatch(/>3</u);
  });

  it('macht einen deaktivierten Bereich nicht anklickbar', async () => {
    const { ModulNavigation } = await laden();
    const html = renderToStaticMarkup(
      createElement(ModulNavigation, {
        eintraege: [
          { href: '/a', label: 'Aaa' },
          { href: '/b', label: 'Bbb', deaktiviert: true },
        ],
        label: 'Test',
      }),
    );
    expect(html).toContain('aria-disabled="true"');
    // Kein Link auf den gesperrten Bereich.
    expect(html).not.toContain('href="/b"');
  });

  it('gibt jedem Reiter ein Ziel, das sich auf dem Telefon treffen laesst', async () => {
    /*
     * 44 Pixel. Darunter wird eine Reiterzeile auf einem Telefon zur
     * Geduldsprobe - und das ist das Geraet, auf dem die meisten das System
     * benutzen.
     */
    const { ModulNavigation } = await laden();
    const html = renderToStaticMarkup(
      createElement(ModulNavigation, { eintraege: EINTRAEGE, label: 'Test' }),
    );
    expect(html).toContain('min-h-11');
    // Und ein sichtbarer Fokus - Tastaturbedienung ist keine Zugabe.
    expect(html).toContain('focus-visible:ring-2');
  });
});
