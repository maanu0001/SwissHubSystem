import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isKnownPermission } from '@swisshub/permissions';
import { listModuleDefinitions } from '@swisshub/modules';
import {
  alleAnker,
  alleLinkZiele,
  alleSeiten,
  inhaltsverzeichnis,
  seitenHref,
  seiteZu,
} from '../../apps/web/src/modules/docs/register';
import { ENTWICKLER_DOKU, TEAM_DOKU, WERKE } from '../../apps/web/src/modules/docs/werk';
import type { DokuBlock, DokuWerk } from '../../apps/web/src/modules/docs/typen';

/**
 * Was an der Dokumentation maschinell prüfbar ist.
 *
 * ## Warum das überhaupt geht
 *
 * Weil die Inhalte Daten sind und kein Markdown. Eine Wand aus `.md`-Dateien
 * kann man nicht fragen, ob ein Anker doppelt vorkommt oder ob ein Link ins
 * Leere zeigt - man merkt es, wenn jemand klickt. Hier liest der Test
 * dieselben Strukturen, aus denen die Seite gebaut wird.
 *
 * ## Was er nicht prüft
 *
 * Ob der Inhalt stimmt. Dass ein Absatz das Richtige über die Permission
 * Engine sagt, kann kein Test wissen. Geprüft wird, was mechanisch falsch
 * sein kann: doppelte Adressen, tote Links, Verweise auf Berechtigungen, die
 * es nicht gibt, und Routen, die nicht existieren.
 */

/** Alle Seitenrouten der WebApp, aus dem Dateisystem gelesen. */
function appRouten(): Set<string> {
  const wurzel = join(process.cwd(), 'apps/web/src/app/(app)');
  const routen = new Set<string>();

  const lauf = (verzeichnis: string, pfad: string): void => {
    for (const eintrag of readdirSync(verzeichnis)) {
      const voll = join(verzeichnis, eintrag);
      if (eintrag === 'page.tsx') {
        routen.add(pfad === '' ? '/' : pfad);
        continue;
      }
      if (!statSync(voll).isDirectory()) continue;
      // Routengruppen wie `(app)` erscheinen nicht in der Adresse.
      const teil = eintrag.startsWith('(') ? '' : `/${eintrag}`;
      lauf(voll, `${pfad}${teil}`);
    }
  };

  lauf(wurzel, '');
  return routen;
}

/** Jeder Block eines Werks, flach. */
function alleBlocks(werk: DokuWerk): DokuBlock[] {
  return alleSeiten(werk).flatMap(({ seite }) =>
    seite.abschnitte.flatMap((abschnitt) => [
      ...abschnitt.blocks,
      ...(abschnitt.unter ?? []).flatMap((unter) => unter.blocks),
    ]),
  );
}

describe('Dokumentation: Struktur', () => {
  it('kennt beide Werke mit ihrer Berechtigung', () => {
    expect(WERKE.map((werk) => werk.id)).toEqual(['entwickler', 'team']);
    for (const werk of WERKE) {
      expect(isKnownPermission(werk.permission)).toBe(true);
      expect(werk.basis).toBe(`/system/docs/${werk.id}`);
      expect(werk.kategorien.length).toBeGreaterThan(0);
    }
  });

  it('hat keine leeren Kategorien und keine leeren Seiten', () => {
    for (const werk of WERKE) {
      for (const kategorie of werk.kategorien) {
        expect(kategorie.seiten.length, `${werk.id}/${kategorie.id}`).toBeGreaterThan(0);
        for (const seite of kategorie.seiten) {
          expect(seite.abschnitte.length, `${werk.id}/${seite.slug}`).toBeGreaterThan(0);
          expect(seite.titel.length, `${werk.id}/${seite.slug}`).toBeGreaterThan(0);
          expect(seite.kurz.length, `${werk.id}/${seite.slug}`).toBeGreaterThan(0);
          for (const abschnitt of seite.abschnitte) {
            expect(abschnitt.blocks.length, `${werk.id}/${seite.slug}#${abschnitt.anker}`).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it.each(WERKE.map((werk) => [werk.id, werk] as const))('%s: Slugs sind eindeutig', (_id, werk) => {
    const slugs = alleSeiten(werk).map(({ seite }) => seite.slug);
    expect(slugs.length).toBeGreaterThan(0);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it.each(WERKE.map((werk) => [werk.id, werk] as const))('%s: Anker sind eindeutig', (_id, werk) => {
    const anker = alleAnker(werk);
    const doppelt = anker.filter((eintrag, i) => anker.indexOf(eintrag) !== i);
    expect(doppelt).toEqual([]);
  });

  it.each(WERKE.map((werk) => [werk.id, werk] as const))(
    '%s: jede Seite ist über ihren Slug auffindbar',
    (_id, werk) => {
      for (const { seite } of alleSeiten(werk)) {
        const treffer = seiteZu(werk, seite.slug);
        expect(treffer?.seite.slug, seite.slug).toBe(seite.slug);
        expect(seitenHref(werk, seite)).toBe(`${werk.basis}/${seite.slug}`);
      }
    },
  );

  it('kennt keinen unbekannten Slug', () => {
    expect(seiteZu(TEAM_DOKU, 'gibt-es-nicht')).toBeNull();
    expect(seiteZu(ENTWICKLER_DOKU, 'gibt-es-nicht')).toBeNull();
    // Ein Slug des einen Werks darf im anderen nicht aufgehen.
    expect(seiteZu(TEAM_DOKU, 'architektur')).toBeNull();
    expect(seiteZu(ENTWICKLER_DOKU, 'moderation')).toBeNull();
  });
});

describe('Dokumentation: Inhaltsverzeichnis', () => {
  it('nennt jeden Abschnitt und jeden Unterabschnitt in Reihenfolge', () => {
    const { seite } = alleSeiten(TEAM_DOKU).find(({ seite: s }) => s.slug === 'level-system')!;
    const toc = inhaltsverzeichnis(seite);

    expect(toc.map((eintrag) => eintrag.anker)).toContain('xp-slot');
    expect(toc.map((eintrag) => eintrag.anker)).toContain('xp-slot-verwalten');

    const xpSlot = toc.findIndex((eintrag) => eintrag.anker === 'xp-slot');
    const verwalten = toc.findIndex((eintrag) => eintrag.anker === 'xp-slot-verwalten');
    expect(verwalten).toBeGreaterThan(xpSlot);
    expect(toc[xpSlot]!.ebene).toBe(2);
    expect(toc[verwalten]!.ebene).toBe(3);
  });

  it('gibt für jede Seite mindestens einen Eintrag', () => {
    for (const werk of WERKE) {
      for (const { seite } of alleSeiten(werk)) {
        expect(inhaltsverzeichnis(seite).length, `${werk.id}/${seite.slug}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('Dokumentation: Links', () => {
  const routen = appRouten();

  it('findet die Routen der Anwendung', () => {
    // Gegenprobe: ohne diese Zusicherung könnte die Linkprüfung unten gegen
    // eine leere Menge laufen und nichts sagen.
    expect(routen.has('/dashboard')).toBe(true);
    expect(routen.has('/system/docs/entwickler')).toBe(true);
    expect(routen.size).toBeGreaterThan(100);
  });

  it.each(WERKE.map((werk) => [werk.id, werk] as const))(
    '%s: jeder interne Link zeigt auf eine echte Route',
    (_id, werk) => {
      const ziele = alleLinkZiele(werk).filter((ziel) => ziel.startsWith('/'));
      const kaputt = ziele.filter((ziel) => {
        const ohneAnker = ziel.split('#')[0]!;
        if (routen.has(ohneAnker)) return false;
        // Dynamische Segmente: /members/[discordId] trägt /members/123.
        for (const route of routen) {
          if (!route.includes('[')) continue;
          const muster = new RegExp(
            `^${route.replace(/\[\.\.\.[^\]]+\]/gu, '.+').replace(/\[[^\]]+\]/gu, '[^/]+')}$`,
            'u',
          );
          if (muster.test(ohneAnker)) return false;
        }
        return true;
      });
      expect(kaputt).toEqual([]);
    },
  );

  it.each(WERKE.map((werk) => [werk.id, werk] as const))(
    '%s: jeder Modulknopf nennt eine echte Berechtigung',
    (_id, werk) => {
      const knoepfe = alleBlocks(werk).filter(
        (block): block is Extract<DokuBlock, { art: 'modulknopf' }> => block.art === 'modulknopf',
      );
      /*
       * Kein `length > 0` hier: nach §61 bietet nur die Team-Doku Knöpfe, und
       * der Test darunter haelt das fest. Die Zahl steht dort, wo sie etwas
       * bedeutet - hier wird geprueft, was an einem vorhandenen Knopf stimmen
       * muss.
       */
      const unbekannt = knoepfe
        .filter((knopf) => !isKnownPermission(knopf.permission))
        .map((knopf) => `${knopf.href} -> ${knopf.permission}`);
      expect(unbekannt).toEqual([]);
    },
  );

  it('die Team-Doku bietet Modulknöpfe, die Entwickler-Doku nicht', () => {
    const team = alleBlocks(TEAM_DOKU).filter((block) => block.art === 'modulknopf');
    const entwickler = alleBlocks(ENTWICKLER_DOKU).filter((block) => block.art === 'modulknopf');
    expect(team.length).toBeGreaterThanOrEqual(10);
    expect(entwickler).toEqual([]);
  });
});

describe('Doku: Modultabelle', () => {
  /*
   * Die Tabelle in der Entwickler-Doku nennt je Modul ID, Prefix, Anzahl der
   * Berechtigungen und ob es ein Kernbereich ist. Vier Angaben, die alle
   * veralten, sobald ein Modul dazukommt oder ein Recht wegfällt - und zwar
   * lautlos: eine falsche Zahl in einer Tabelle sieht aus wie eine richtige.
   *
   * Massgeblich ist `definition.permissions` - das, was das Modul selbst
   * anmeldet. Nicht die globale Registry nach `module`-Feld gefiltert: dort
   * steht ein Schlüssel auch dann unter einem Modul, wenn ein anderes ihn
   * anbietet (die Einstellungen etwa reichen `system.docs.*` mit, die in der
   * Registry zu `core` gehören).
   */
  const ZEILE = /\['([^']+)', '`([a-zA-Z]+)`', '`([a-zA-Z]+)`', '(\d+)', '(Kern|Modul)'\]/gu;

  const quelle = readFileSync(
    join(process.cwd(), 'apps/web/src/modules/docs/inhalt/entwickler/module.ts'),
    'utf8',
  );
  const zeilen = [...quelle.matchAll(ZEILE)];
  const defs = listModuleDefinitions();

  it('nennt jedes Modul genau einmal', () => {
    expect(zeilen).toHaveLength(defs.length);
    const ids = zeilen.map((zeile) => zeile[2]);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(defs.map((definition) => definition.id).sort());
  });

  it('nennt für jedes Modul Name, Prefix, Rechteanzahl und Art korrekt', () => {
    const nachId = new Map(defs.map((definition) => [definition.id, definition]));
    const abweichungen: string[] = [];

    for (const [, name, id, prefix, anzahl, art] of zeilen) {
      const definition = nachId.get(id!);
      if (!definition) {
        abweichungen.push(`${id}: kein solches Modul`);
        continue;
      }
      if (name !== definition.name) abweichungen.push(`${id}: Name «${name}» statt «${definition.name}»`);
      if (prefix !== definition.permissionPrefix) {
        abweichungen.push(`${id}: Prefix ${prefix} statt ${definition.permissionPrefix}`);
      }
      if (Number(anzahl) !== definition.permissions.length) {
        abweichungen.push(`${id}: ${anzahl} Rechte statt ${definition.permissions.length}`);
      }
      if ((art === 'Kern') !== (definition.core ?? false)) {
        abweichungen.push(`${id}: ${art} statt ${definition.core ? 'Kern' : 'Modul'}`);
      }
    }

    expect(abweichungen).toEqual([]);
  });

  it('erwähnt kein entferntes Modul', () => {
    // `spielersuche` wurde entfernt. Eine Doku, die es noch beschreibt, ist
    // schlimmer als keine - sie schickt jemanden nach einer Seite suchen.
    expect(quelle.toLowerCase()).not.toContain('spielersuche');
  });
});

describe('Doku: Abschnitte ohne Inhalt', () => {
  it('kein Abschnitt besteht nur aus einem Modulknopf', () => {
    /*
     * Ein Modulknopf verschwindet ohne Berechtigung (§61). Ist er der einzige
     * Block seines Abschnitts, bleibt eine Überschrift ohne Inhalt stehen -
     * samt Eintrag in «Auf dieser Seite», der auf nichts zeigt.
     *
     * Gefunden wurde das nicht hier, sondern am gebauten Server: zwei Seiten
     * hatten einen Abschnitt «Kalender öffnen» bzw. «Berechtigungen öffnen»
     * mit genau einem Knopf darin. Für den Grossteil des Teams waren das zwei
     * leere Kapitel. Die Knöpfe stehen jetzt in den Abschnitten, zu deren
     * Inhalt sie gehören.
     */
    const leer: string[] = [];

    for (const werk of WERKE) {
      for (const { seite } of alleSeiten(werk)) {
        const abschnitte = [
          ...seite.abschnitte.map((abschnitt) => ({ anker: abschnitt.anker, blocks: abschnitt.blocks })),
          ...seite.abschnitte.flatMap((abschnitt) =>
            (abschnitt.unter ?? []).map((unter) => ({ anker: unter.anker, blocks: unter.blocks })),
          ),
        ];
        for (const abschnitt of abschnitte) {
          const ohneKnopf = abschnitt.blocks.filter((block) => block.art !== 'modulknopf');
          if (ohneKnopf.length === 0) {
            leer.push(`${werk.id}/${seite.slug}#${abschnitt.anker}`);
          }
        }
      }
    }

    expect(leer).toEqual([]);
  });
});
