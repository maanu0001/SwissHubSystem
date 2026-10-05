import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Wer im Workspace was sieht - und wer wählbar ist.
 *
 * ## Warum das ein Quelltexttest ist
 *
 * Weil die Zusage eine über **eine Stelle** ist: jede Liste, jede Detailseite
 * und jede Server Action im Workspace entscheidet die Sichtbarkeit über
 * denselben `WorkspaceBetrachter`, und dessen `darfAlles` entsteht genau
 * einmal - in `workspaceBetrachter()`. Das Verhalten dahinter prüft
 * `tests/integration/workspace-sichtbarkeit.test.ts` gegen eine echte
 * Datenbank; hier steht, dass niemand einen zweiten Weg aufmacht.
 */
const lies = (pfad: string): string => readFileSync(pfad, 'utf8');
const daten = lies('apps/web/src/modules/workspace/daten.ts');
const sichtbarkeit = lies('packages/modules/src/workspace/sichtbarkeit.ts');

describe('Workspace: Administration und Moderation sehen alles', () => {
  it('nennt die Berechtigungen zentral und ohne Kennungen', () => {
    expect(daten).toContain('export const WORKSPACE_VOLLZUGRIFF');
    expect(daten).toContain('workspace.WORKSPACE_PERMISSIONS.settingsManage');
    expect(daten).toContain('moderation.MODERATION_PERMISSIONS.execute');
    // Keine hartkodierten Discord-Kennungen - das wäre eine zweite Wahrheit.
    expect(daten).not.toMatch(/['"]\d{17,20}['"]/u);
  });

  it('entscheidet `darfAlles` genau an dieser Liste', () => {
    expect(daten).toContain(
      'darfAlles: WORKSPACE_VOLLZUGRIFF.some((berechtigung) => can(context, berechtigung))',
    );
  });

  it('wirkt serverseitig in jeder Abfrage und nicht in der Oberfläche', () => {
    /*
     * `darfAlles` ist kein Anzeigeschalter: es ist der `where`-Teil. Ein
     * Projekt, das jemand nicht sehen darf, kommt nicht aus der Datenbank -
     * und eine direkte Adresse endet in «gibt es nicht».
     */
    for (const stelle of [
      'export async function projektFilter',
      'export async function aufgabenFilter',
      'export async function sichereProjektSicht',
      'export async function sichereAufgabenSicht',
      'export function darfProjektSehen',
    ]) {
      expect(sichtbarkeit, stelle).toContain(stelle);
    }
    // Jede dieser Stellen hat denselben kurzen Weg für den Vollzugriff.
    expect([...sichtbarkeit.matchAll(/betrachter\.darfAlles/gu)].length).toBeGreaterThanOrEqual(5);
  });

  it('lässt normale Mitglieder bei ihren Regeln', () => {
    // Ohne Vollzugriff bleibt es bei TEAM, eigener Beteiligung und Rollen.
    expect(sichtbarkeit).toContain("{ visibility: 'TEAM' }");
    expect(sichtbarkeit).toContain('members: { some: { discordId: betrachter.discordId } }');
    expect(sichtbarkeit).toContain("visibility: 'SELECTED_GROUPS' as const");
  });
});

describe('Workspace: Administration und Moderation sind wählbar', () => {
  it('nimmt sie in die Suchmenge der Beteiligten auf', () => {
    expect(daten).toContain('const WORKSPACE_BETEILIGUNG');
    expect(daten).toContain('workspace.WORKSPACE_PERMISSIONS.view,\n  ...WORKSPACE_VOLLZUGRIFF,');
    expect(daten).toContain('traegerSuche(WORKSPACE_BETEILIGUNG, begriff');
  });

  it('macht aus einer Rolle keine Beteiligung', () => {
    /*
     * Wählbar heisst nicht beteiligt. Eingetragen wird in
     * `setzeMitglieder`/`setzeZustaendige` - und nur, was jemand einträgt.
     */
    for (const datei of ['projekte.ts', 'aufgaben.ts']) {
      const kern = lies(`packages/modules/src/workspace/${datei}`);
      expect(kern, datei).not.toMatch(/moderation\.execute/u);
      expect(kern, datei).not.toMatch(/MODERATION_PERMISSIONS/u);
    }
  });

  it('prüft mehrere Berechtigungen in einem Lauf', () => {
    const traeger = lies('packages/modules/src/traeger.ts');
    expect(traeger).toContain('permission: string | readonly string[]');
    expect(traeger).toContain('hasAnyPermission(aufloesung, [...permission])');
  });
});

describe('Workspace: alle Beteiligten sind sichtbar', () => {
  const abzeichen = lies('apps/web/src/modules/workspace/components/abzeichen.tsx');
  const projekt = lies('apps/web/src/modules/workspace/components/projekt-steuerung.tsx');
  const aufgabe = lies('apps/web/src/modules/workspace/components/aufgabe-beteiligte.tsx');

  it('kürzt die Avatarreihe nicht mehr auf vier', () => {
    expect(abzeichen).toContain('{kennungen.map((discordId) => {');
    expect(abzeichen).not.toContain('kennungen.slice(0, max)');
    // Und kein «+3» mehr.
    expect(abzeichen).not.toContain('+{weitere}');
    // Dafür darf die Reihe umbrechen.
    expect(abzeichen).toContain('flex flex-wrap items-center gap-1');
  });

  it('listet in beiden Kacheln jede beteiligte Person', () => {
    // Die Liste ist eine Abbildung des ganzen Stands, ohne Fenster davor.
    expect(projekt).toContain('{stand.map((eintrag) => {');
    expect(aufgabe).toContain('{stand.map((discordId) => {');
    for (const quelle of [projekt, aufgabe]) {
      expect(quelle).not.toMatch(/stand\.slice\(/u);
      expect(quelle).not.toMatch(/weitere/u);
    }
  });
});

describe('Workspace: der Riegel der Seiten kennt dieselbe Menge', () => {
  /**
   * Der Fehler, den dieser Block festnagelt.
   *
   * `darfAlles` entscheidet, **welche Zeilen** jemand sieht - nicht, **ob die
   * Seite aufgeht**. Das entschied `requirePagePermission(workspace.view)`,
   * und ein Moderator, der diese Berechtigung nie zugewiesen bekam, kam gar
   * nicht erst hinein: am gebauten Server gemessen eine Projektliste ohne das
   * private Projekt, ein leeres Board, ein Projektdetail ohne Inhalt.
   *
   * Beide Fragen haengen jetzt an `WORKSPACE_ZUGANG`. Dass eine neue Seite
   * wieder den einzelnen Schluessel nimmt, faellt hier auf.
   */
  const SEITEN = [
    'board/page.tsx',
    'meine/page.tsx',
    'page.tsx',
    'projekte/page.tsx',
    'projekte/[projectId]/page.tsx',
    'vorlagen/page.tsx',
    'planung/page.tsx',
    'aufgaben/[taskId]/page.tsx',
    'archiv/page.tsx',
  ];

  it('nennt die Zugangsmenge an einer Stelle', () => {
    expect(daten).toContain('export const WORKSPACE_ZUGANG');
    // Dieselbe Menge wie fuer die Beteiligtensuche - nicht eine zweite Liste.
    expect(daten).toContain('const WORKSPACE_BETEILIGUNG: readonly string[] = WORKSPACE_ZUGANG;');
  });

  it('prüft sie auf jeder Seite des Moduls', () => {
    for (const seite of SEITEN) {
      const quelle = lies(`apps/web/src/app/(app)/workspace/${seite}`);
      expect(quelle, seite).toContain('await requirePagePermission(WORKSPACE_ZUGANG)');
      expect(quelle, seite).not.toContain('requirePagePermission(workspace.WORKSPACE_PERMISSIONS.view)');
    }
  });

  it('prüft sie auch an der Anhang-Adresse', () => {
    /*
     * Eine Adresse ist keine Seite: wer die Aufgabe sehen darf, muss ihren
     * Anhang oeffnen koennen, sonst liefert die Vorschau 403.
     */
    const route = lies('apps/web/src/app/api/workspace/anhang/[anhangId]/route.ts');
    expect(route).toContain('WORKSPACE_ZUGANG.some((berechtigung) => can(context, berechtigung))');
  });
});
