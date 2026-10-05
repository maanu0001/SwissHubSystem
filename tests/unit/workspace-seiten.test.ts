import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Die Seiten des Workspace - strukturell geprüft.
 *
 * ## Warum ein Test, der Quelltext liest
 *
 * Weil die Eigenschaften, um die es hier geht, nicht am gerenderten Ergebnis
 * hängen, sondern daran, **dass** etwas im Quelltext steht. Eine Seite ohne
 * `requirePagePermission` sieht in der Vorschau genauso aus wie eine mit - der
 * Unterschied zeigt sich erst, wenn jemand ohne Berechtigung sie öffnet. Und
 * genau dann will niemand es zum ersten Mal merken.
 *
 * Geprüft wird deshalb:
 *
 *   - **Jede** Seite verlangt `workspace.view`. Die Modulnavigation ist
 *     Darstellung; die Berechtigung muss an jeder Seite einzeln stehen.
 *   - Keine Seite setzt einen zweiten Seitentitel. Den Modulnamen rendert die
 *     Kopfzeile aus der Module Registry schon als `h1`.
 *   - Jede Seite ist dynamisch. Eine statisch gebaute Seite zeigte den Stand
 *     vom Build - bei einem Board ist das keine Ansicht, sondern ein Bild.
 *   - Die Navigation zeigt nur auf Seiten, die es gibt.
 */

const ohneKommentare = (quelle: string): string =>
  quelle.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');

const SEITEN = globSync('apps/web/src/app/(app)/workspace/**/page.tsx', { cwd: process.cwd() }).sort();

describe('Workspace-Seiten', () => {
  it('findet die Seiten', () => {
    // Fände das Muster nichts, wären alle Prüfungen unten leer - ein Wächter,
    // der schweigt, weil er nichts zu prüfen bekam.
    expect(SEITEN.length).toBeGreaterThanOrEqual(6);
  });

  it.each(SEITEN)('%s verlangt workspace.view', (seite) => {
    const quelle = ohneKommentare(readFileSync(join(process.cwd(), seite), 'utf8'));
    expect(quelle).toContain('requirePagePermission(workspace.WORKSPACE_PERMISSIONS.view)');
  });

  it.each(SEITEN)('%s setzt keinen zweiten Modultitel', (seite) => {
    const quelle = ohneKommentare(readFileSync(join(process.cwd(), seite), 'utf8'));
    expect(quelle).not.toContain('PageHeader');
    // Ein `<h1>` auf einer Modulseite wäre der Modulname zum zweiten Mal.
    expect(quelle).not.toMatch(/<h1[\s>]/u);
  });

  it.each(SEITEN)('%s wird bei jedem Aufruf gerechnet', (seite) => {
    const quelle = ohneKommentare(readFileSync(join(process.cwd(), seite), 'utf8'));
    expect(quelle).toContain("export const dynamic = 'force-dynamic'");
  });

  it.each(SEITEN)('%s zeigt die Modulnavigation', (seite) => {
    const quelle = ohneKommentare(readFileSync(join(process.cwd(), seite), 'utf8'));
    // Ohne sie ist die Seite eine Sackgasse: die Seitenleiste führt auf genau
    // einen Eintrag, die übrigen Bereiche brauchen einen Weg von hier aus.
    expect(quelle).toContain('<ModulNavigation');
  });

  it('verlinkt in der Navigation nur Seiten, die es gibt', () => {
    const navigation = readFileSync(
      join(process.cwd(), 'apps/web/src/modules/workspace/navigation.ts'),
      'utf8',
    );
    const routen = [...navigation.matchAll(/systemRoutes\.(workspace\w*)\(\)/gu)].map(
      (treffer) => treffer[1]!,
    );
    expect(routen.length).toBeGreaterThan(3);

    const dateiFuer: Record<string, string> = {
      workspace: 'apps/web/src/app/(app)/workspace/page.tsx',
      workspaceMeine: 'apps/web/src/app/(app)/workspace/meine/page.tsx',
      workspaceBoard: 'apps/web/src/app/(app)/workspace/board/page.tsx',
      workspaceProjekte: 'apps/web/src/app/(app)/workspace/projekte/page.tsx',
      workspaceArchiv: 'apps/web/src/app/(app)/workspace/archiv/page.tsx',
      workspacePlanung: 'apps/web/src/app/(app)/workspace/planung/page.tsx',
      workspaceVorlagen: 'apps/web/src/app/(app)/workspace/vorlagen/page.tsx',
    };

    for (const route of new Set(routen)) {
      const datei = dateiFuer[route];
      expect(datei, `${route} ist in diesem Test nicht zugeordnet`).toBeTypeOf('string');
      expect(SEITEN, `Die Navigation führt auf ${route}, aber die Seite fehlt`).toContain(datei!);
    }
  });

  it('prüft in jeder Server Action die Berechtigung oder das Projekt', () => {
    const quelle = ohneKommentare(
      readFileSync(join(process.cwd(), 'apps/web/src/modules/workspace/actions.ts'), 'utf8'),
    );
    const aktionen = [...quelle.matchAll(/name: '(workspace\.[\w.]+)'/gu)].map((t) => t[1]!);
    expect(aktionen.length).toBeGreaterThanOrEqual(10);

    // Jede Aktion nennt eine Berechtigung. Die beiden Projektaktionen nennen
    // `view` als Boden und prüfen die Projektleitung zusätzlich im Rumpf -
    // `projects.edit` deckt alle Projekte, die Leitung nur ihr eigenes.
    const bloecke = quelle.split('export const ').slice(1);
    for (const block of bloecke) {
      expect(block).toMatch(/permission: workspace\.WORKSPACE_PERMISSIONS\.\w+/u);
      expect(block).toContain('rateLimit:');
    }
    expect(quelle).toContain('pruefeProjektzugriff');
  });

  it('nimmt die Kennung des Handelnden nie aus dem Formular', () => {
    const quelle = readFileSync(join(process.cwd(), 'apps/web/src/modules/workspace/actions.ts'), 'utf8');
    /*
     * Der Handelnde ist immer `ctx.user.discordId`.
     *
     * Ein `akteurDiscordId` im Zod-Schema wäre die Möglichkeit, im Namen eines
     * anderen einzutragen - und zwar eine, die man beim Lesen des Formulars
     * nicht sieht, weil das Feld dort nicht vorkommt.
     */
    expect(quelle).not.toMatch(/akteur\w*:\s*z\./u);
    expect(quelle).not.toMatch(/actorDiscordId:\s*z\./u);
  });
});

/**
 * Die Kachel «Beteiligte» - an beiden Stellen und mit derselben Bedeutung.
 *
 * ## Warum das hier und nicht im Browser steht
 *
 * Weil es Aussagen über die Struktur sind: dass es die Kachel gibt, dass sie
 * an Projekt und Aufgabe gleich heisst, und dass die Rollen nur im Projekt
 * vorkommen. Zwei Namen für eine Liste - «Beteiligte» im Projekt,
 * «Zuständig» an der Aufgabe - waren genau der Grund, weshalb beide für zwei
 * verschiedene Dinge gehalten wurden.
 */
describe('Workspace: Beteiligte', () => {
  const lies = (pfad: string): string => ohneKommentare(readFileSync(pfad, 'utf8'));

  const PROJEKTSEITE = 'apps/web/src/app/(app)/workspace/projekte/[projectId]/page.tsx';
  const AUFGABENSEITE = 'apps/web/src/app/(app)/workspace/aufgaben/[taskId]/page.tsx';
  const LABELS = 'apps/web/src/modules/workspace/labels.ts';
  const PICKER = 'apps/web/src/modules/workspace/components/zustaendig-wahl.tsx';
  const AUFGABE_BETEILIGTE = 'apps/web/src/modules/workspace/components/aufgabe-beteiligte.tsx';
  const AUFGABE_STEUERUNG = 'apps/web/src/modules/workspace/components/aufgabe-steuerung.tsx';

  it('trägt die Kachel in Projekt und Aufgabe', () => {
    expect(lies(PROJEKTSEITE)).toContain('<Panel title="Beteiligte"');
    expect(lies(AUFGABENSEITE)).toContain('<Panel title="Beteiligte"');
  });

  it('nennt die beiden Projektrollen Projektleitung und Unterstützung', () => {
    const labels = lies(LABELS);
    expect(labels).toContain("LEAD: 'Projektleitung'");
    expect(labels).toContain("MEMBER: 'Unterstützung'");
    // «Mitglied» klang nach Zugehoerigkeit und damit nach Berechtigung.
    expect(labels).not.toContain("MEMBER: 'Mitglied'");
  });

  it('kennt an der Aufgabe keine Rollen - alle sind verantwortlich', () => {
    const kachel = lies(AUFGABE_BETEILIGTE);
    expect(kachel).toContain('workspaceZustaendigeSetzenAction');
    // Keine Projektrolle an der Aufgabe.
    expect(kachel).not.toContain('WorkspaceMemberRole');
    expect(kachel).not.toContain('Projektleitung');
    expect(lies(AUFGABENSEITE)).toContain('Alle Beteiligten sind verantwortlich.');
  });

  it('speichert an der Aufgabe je Handlung sofort - ohne Speicherknopf', () => {
    /*
     * ## Was hier vorher stand
     *
     * `expect(kachel).toContain('Beteiligte speichern')`. Die Kachel war
     * eine Wolke aus Haekchen mit einem Speicherknopf darunter, und der
     * hatte einen Grund: bei «A raus, B rein» entstand sonst zwischendurch
     * eine Aufgabe ohne Beteiligte.
     *
     * Jetzt ist es ein Hinzufuegen und ein Entfernen je Klick, und damit
     * stellt sich die Frage nicht mehr - der Zwischenzustand entsteht nur,
     * wenn jemand ihn ausdruecklich herstellt. Der Preis des Knopfes war,
     * dass man ihn vergessen konnte; das faellt weg.
     *
     * Die Zusage ist deshalb jetzt die umgekehrte: **kein** Speicherknopf,
     * und jede der beiden Handlungen ruft fuer sich.
     */
    const kachel = lies(AUFGABE_BETEILIGTE);
    expect(kachel).not.toContain('Beteiligte speichern');
    expect(kachel).toContain('const hinzufuegen = ()');
    expect(kachel).toContain('const entfernen = (discordId: string)');
    /*
     * Beide gehen ueber denselben Speicherweg, und zwar genau zweimal:
     * einmal aus `hinzufuegen`, einmal aus `entfernen`. Die Action nimmt die
     * ganze Liste und nicht einen Unterschied - eine Liste ist ein Zustand,
     * und zwei gleichzeitige Aenderungen koennen sich dabei nicht halb
     * ueberlagern.
     */
    expect([...kachel.matchAll(/ speichere\(/gu)]).toHaveLength(2);
  });

  it('hat die Beteiligten aus «Ändern» herausgelöst', () => {
    /*
     * Dort standen sie neben Status, Prioritaet und dem Loeschknopf. «Wer
     * macht das» ist aber die erste Frage an eine Aufgabe und nicht eine
     * unter vielen Einstellungen.
     */
    const steuerung = lies(AUFGABE_STEUERUNG);
    expect(steuerung).not.toContain('ZustaendigWahl');
    expect(steuerung).not.toContain('workspaceZustaendigeSetzenAction');
  });

  it('beschriftet den Picker überall gleich', () => {
    const picker = lies(PICKER);
    expect(picker).toContain("beschriftung = 'Beteiligte'");
    expect(picker).toContain('{beschriftung}');
    expect(picker).not.toContain('>Zuständig<');
  });

  it('sagt in der Projektkachel, dass die Rollen keine Berechtigungen sind', () => {
    const projekt = lies('apps/web/src/modules/workspace/components/projekt-steuerung.tsx');
    expect(projekt).toContain('keine Discord-Rollen');
    expect(projekt).toContain('wer mitarbeitet');
  });
});
