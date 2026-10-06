import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  hasPermission,
  isKnownPermission,
  resolvePermissions,
  type RolePermissionMapping,
} from '@swisshub/permissions';
import { listModuleDefinitions, moduleViewPermissionFor } from '@swisshub/modules';
import { WERKE } from '../../apps/web/src/modules/docs/werk';

/**
 * Wer die Dokumentation sehen darf - und dass die Adresse allein nicht genügt.
 *
 * ## Zwei getrennte Fragen
 *
 * Die erste ist eine Entscheidung der Permission Engine: trägt diese Rolle den
 * Schlüssel? Die zweite ist eine Eigenschaft der Routen: steht dort ein
 * serverseitiger Riegel? §71 verlangt beides, und das zweite ist das, was ohne
 * Test unbemerkt wegfallen kann - eine Navigation, die den Eintrag versteckt,
 * sieht genauso aus wie eine, die ihn sperrt.
 *
 * Deshalb liest der zweite Teil die Routendateien. Das ist eine statische
 * Prüfung und kein Ersatz für einen Aufruf gegen den gebauten Server; sie
 * fängt aber genau den Fall, der in der Praxis passiert: eine neue Doku-Route
 * ohne `requirePagePermission`.
 */

const TEAM_ROLLE = '900000000000009001';
const DEV_ROLLE = '900000000000009002';
const MITGLIED_ROLLE = '900000000000009003';

const erlaube = (discordRoleId: string, permission: string): RolePermissionMapping => ({
  discordRoleId,
  permission,
  effect: 'ALLOW',
});

const verweigere = (discordRoleId: string, permission: string): RolePermissionMapping => ({
  discordRoleId,
  permission,
  effect: 'DENY',
});

const loese = (mappings: RolePermissionMapping[], roleIds: string[]) =>
  resolvePermissions({ discordId: '900000000000009099', roleIds, isOwner: false }, mappings);

const TEAM = 'system.docs.team.view';
const DEV = 'system.docs.developer.view';

describe('Doku-Berechtigungen', () => {
  it('kennt beide Schlüssel', () => {
    expect(isKnownPermission(TEAM)).toBe(true);
    expect(isKnownPermission(DEV)).toBe(true);
  });

  it('lässt die Team-Doku für die Team-Rolle zu', () => {
    const aufloesung = loese([erlaube(TEAM_ROLLE, TEAM)], [TEAM_ROLLE]);
    expect(hasPermission(aufloesung, TEAM)).toBe(true);
  });

  it('verweigert sie ohne Zuweisung', () => {
    const aufloesung = loese([erlaube(TEAM_ROLLE, TEAM)], [MITGLIED_ROLLE]);
    expect(hasPermission(aufloesung, TEAM)).toBe(false);
    expect(hasPermission(aufloesung, DEV)).toBe(false);
  });

  it('hält die beiden Werke getrennt', () => {
    /*
     * Der Grund für zwei Schlüssel statt eines: die Team-Doku soll das ganze
     * Team lesen, die Entwickler-Doku nicht zwingend. Ein gemeinsamer
     * Schlüssel hätte beides an dieselbe Entscheidung gehängt.
     */
    const nurTeam = loese([erlaube(TEAM_ROLLE, TEAM)], [TEAM_ROLLE]);
    expect(hasPermission(nurTeam, TEAM)).toBe(true);
    expect(hasPermission(nurTeam, DEV)).toBe(false);

    const nurDev = loese([erlaube(DEV_ROLLE, DEV)], [DEV_ROLLE]);
    expect(hasPermission(nurDev, DEV)).toBe(true);
    expect(hasPermission(nurDev, TEAM)).toBe(false);
  });

  it('lässt sich mit admin.full öffnen', () => {
    const aufloesung = loese([erlaube(TEAM_ROLLE, 'admin.full')], [TEAM_ROLLE]);
    expect(hasPermission(aufloesung, TEAM)).toBe(true);
    expect(hasPermission(aufloesung, DEV)).toBe(true);
  });

  it('eine Verweigerung schlägt Vollzugriff', () => {
    const aufloesung = loese(
      [erlaube(TEAM_ROLLE, 'admin.full'), verweigere(MITGLIED_ROLLE, DEV)],
      [TEAM_ROLLE, MITGLIED_ROLLE],
    );
    expect(hasPermission(aufloesung, TEAM)).toBe(true);
    expect(hasPermission(aufloesung, DEV)).toBe(false);
  });

  it('verlangt keine zusätzliche Modulberechtigung', () => {
    /*
     * `requirePagePermission` fordert neben der Berechtigung auch «Modul
     * sehen», sofern es für den Schlüssel eines gibt. Für die Doku gibt es
     * keines - sonst bräuchte das Team zwei Häkchen für eine Seite, und das
     * zweite wäre eines, das niemand mit der Doku in Verbindung bringt.
     */
    expect(moduleViewPermissionFor(TEAM)).toBeNull();
    expect(moduleViewPermissionFor(DEV)).toBeNull();
  });
});

describe('Doku-Navigation', () => {
  const eintraege = listModuleDefinitions().flatMap((definition) => definition.navigation ?? []);

  it('führt beide Werke als letzte Einträge der Systemgruppe', () => {
    const system = eintraege
      .filter((eintrag) => eintrag.group === 'system')
      .sort((a, b) => a.order - b.order);

    expect(system.at(-2)?.href).toBe('/system/docs/entwickler');
    expect(system.at(-1)?.href).toBe('/system/docs/team');
  });

  it('hängt jeden Eintrag an die Berechtigung seines Werks', () => {
    for (const werk of WERKE) {
      const eintrag = eintraege.find((kandidat) => kandidat.href === werk.basis);
      expect(eintrag, werk.basis).toBeDefined();
      expect(eintrag!.permission).toBe(werk.permission);
    }
  });
});

describe('Doku-Routen', () => {
  const lies = (pfad: string): string =>
    readFileSync(join(process.cwd(), 'apps/web/src/app/(app)/system/docs', pfad), 'utf8');

  const ROUTEN: readonly [string, string][] = [
    ['entwickler/page.tsx', DEV],
    ['entwickler/[...pfad]/page.tsx', DEV],
    ['team/page.tsx', TEAM],
    ['team/[...pfad]/page.tsx', TEAM],
  ];

  it.each(ROUTEN)('%s prüft serverseitig', (pfad, _permission) => {
    expect(lies(pfad)).toContain('requirePagePermission(');
  });

  it.each(ROUTEN)('%s prüft die Berechtigung seines Werks', (pfad, permission) => {
    const quelle = lies(pfad);
    const werk = WERKE.find((kandidat) => kandidat.permission === permission)!;
    const konstante = werk.id === 'team' ? 'TEAM_DOKU' : 'ENTWICKLER_DOKU';
    // Die Route nennt nicht den Schlüssel als Zeichenkette, sondern das Werk -
    // so kann die Route nicht gegen eine andere Berechtigung pruefen als die,
    // unter der ihr Eintrag in der Navigation steht.
    expect(quelle).toContain(`requirePagePermission(${konstante}.permission)`);
  });

  it('die Kapitelroute endet bei unbekanntem Pfad in notFound', () => {
    for (const [pfad] of ROUTEN.filter(([p]) => p.includes('[...pfad]'))) {
      const quelle = lies(pfad);
      expect(quelle).toContain('notFound()');

      /*
       * Gemessen wird im Rumpf der Seitenfunktion, nicht in der ganzen Datei.
       * Beide Namen kommen auch in den Kommentaren vor - ein Vergleich über
       * die Datei hätte eine Erklärung mit der Umsetzung verwechselt und wäre
       * rot geworden, obwohl der Code stimmt.
       */
      const rumpf = quelle.slice(quelle.indexOf('export default async function'));
      expect(rumpf).toContain('requirePagePermission(');
      expect(rumpf.indexOf('requirePagePermission(')).toBeLessThan(rumpf.indexOf('notFound()'));
    }
  });

  it('die Not-Found-Seite bietet Rückweg und Suche', () => {
    const quelle = lies('not-found.tsx');
    expect(quelle).toContain('Dokumentationsseite nicht gefunden');
    expect(quelle).toContain('DokuSuche');
    expect(quelle).toContain('werk.basis');
  });
});

describe('Doku-Modulknöpfe', () => {
  const komponente = readFileSync(
    join(process.cwd(), 'apps/web/src/modules/docs/components/blocks.tsx'),
    'utf8',
  );

  it('zeigt einen Modulknopf nur mit Berechtigung', () => {
    /*
     * §61. Der Knopf war zuerst ohne Pruefung gerendert - ein Teammitglied
     * ohne «Premium vergeben» haette «Premium vergeben» gesehen und waere in
     * einer Fehlermeldung gelandet. Das ist schlimmer als ein fehlender
     * Knopf: es sieht wie ein Angebot aus.
     */
    const fall = komponente.slice(komponente.indexOf("case 'modulknopf':"));
    const rueckgabe = fall.indexOf('return (');
    const pruefung = fall.indexOf('darf?.(block.permission)');
    expect(pruefung).toBeGreaterThanOrEqual(0);
    expect(pruefung).toBeLessThan(rueckgabe);
    expect(fall.slice(pruefung, rueckgabe)).toContain('return null');
  });

  it('zeigt ohne Prädikat keinen Knopf', () => {
    // Die vorsichtige Richtung: `darf?.()` ergibt `undefined`, und `!undefined`
    // ist wahr - ein Aufrufer, der das Praedikat vergisst, zeigt einen Knopf
    // zu wenig statt einen zu viel.
    expect(komponente).toContain('if (!darf?.(block.permission))');
  });

  it('die Seite löst die Berechtigung einmal auf und reicht sie durch', () => {
    const seite = readFileSync(join(process.cwd(), 'apps/web/src/modules/docs/components/seite.tsx'), 'utf8');
    expect(seite).toContain('await requireAuth()');
    expect((seite.match(/darf=\{darf\}/gu) ?? []).length).toBeGreaterThanOrEqual(2);
    expect((seite.match(/requireAuth\(\)/gu) ?? []).length).toBe(1);
  });

  it('der Kontexthinweis in den Modulen prüft ebenfalls', () => {
    const link = readFileSync(
      join(process.cwd(), 'apps/web/src/modules/docs/components/doku-link.tsx'),
      'utf8',
    );
    expect(link).toContain('can(context, TEAM_DOKU.permission)');
    // Und er zeigt nichts, wenn das Kapitel nicht existiert - ein toter Link
    // mitten in einem Modul ist schlimmer als kein Hinweis.
    expect(link).toContain('if (!treffer) return null');
  });
});
