import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { moduleIdForPermission } from '@swisshub/modules';
import { workspace } from '@swisshub/modules';

/**
 * Die Sicherheitseigenschaften des Workspace - am Quelltext geprüft.
 *
 * ## Warum am Quelltext und nicht am Verhalten
 *
 * Weil die Eigenschaften, um die es hier geht, **Abwesenheiten** sind: kein
 * `dangerouslySetInnerHTML`, keine Gilde aus dem Formular, keine Kennung des
 * Handelnden aus der Eingabe. Eine Abwesenheit lässt sich nicht durch einen
 * Aufruf nachweisen - man kann nur zeigen, dass es keine Stelle gibt, an der
 * sie verletzt wird. Genau das tut dieser Test, und zwar über **alle** Dateien
 * des Moduls, auch die, die es morgen gibt.
 *
 * Die Verhaltenstests stehen daneben in `tests/integration/workspace-*.test.ts`.
 */

const ohneKommentare = (quelle: string): string =>
  quelle.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');

const lies = (datei: string): string => ohneKommentare(readFileSync(join(process.cwd(), datei), 'utf8'));

const KERN = globSync('packages/modules/src/workspace/*.ts', { cwd: process.cwd() }).sort();
const WEB = [
  ...globSync('apps/web/src/modules/workspace/**/*.{ts,tsx}', { cwd: process.cwd() }),
  ...globSync('apps/web/src/app/(app)/workspace/**/*.tsx', { cwd: process.cwd() }),
  ...globSync('apps/web/src/app/api/workspace/**/*.ts', { cwd: process.cwd() }),
].sort();

const AKTIONEN = lies('apps/web/src/modules/workspace/actions.ts');

describe('Workspace - Sicherheit', () => {
  it('findet die Dateien des Moduls', () => {
    // Faende das Muster nichts, waeren alle Pruefungen unten leer.
    expect(KERN.length).toBeGreaterThanOrEqual(8);
    expect(WEB.length).toBeGreaterThanOrEqual(12);
  });

  it('setzt nirgends HTML aus fremder Hand in die Seite', () => {
    /*
     * Kommentare, Beschreibungen und Anzeigenamen kommen von Menschen.
     *
     * Dargestellt werden sie als React-Elemente - der Markdown-Darsteller
     * erzeugt Elemente und kein HTML. `dangerouslySetInnerHTML` wäre der eine
     * Weg, auf dem fremdes Markup doch in die Seite käme, und er kommt im
     * ganzen Modul nicht vor.
     */
    for (const datei of WEB) {
      expect(lies(datei), datei).not.toContain('dangerouslySetInnerHTML');
    }
  });

  it('nimmt die Gilde und den Handelnden nie aus der Eingabe', () => {
    /*
     * Beide kommen serverseitig: die Gilde aus `resolveGuildId`, der Handelnde
     * aus der Sitzung. Ein Feld dafür im Zod-Schema wäre eine Mass-Assignment-
     * Lücke, die man beim Lesen des Formulars nicht sieht - das Feld kommt dort
     * ja nicht vor.
     */
    expect(AKTIONEN).not.toMatch(/guildId:\s*z\./u);
    expect(AKTIONEN).not.toMatch(/akteur\w*:\s*z\./u);
    expect(AKTIONEN).not.toMatch(/actorDiscordId:\s*z\./u);
    expect(AKTIONEN).not.toMatch(/createdByDiscordId:\s*z\./u);
    expect(AKTIONEN).not.toMatch(/uploadedByDiscordId:\s*z\./u);
    expect(AKTIONEN).not.toMatch(/authorDiscordId:\s*z\./u);
    expect(AKTIONEN).toContain('ctx.user.discordId');
  });

  it('nimmt auch im Upload-Endpunkt den Handelnden aus der Sitzung', () => {
    const route = lies('apps/web/src/app/api/workspace/upload/route.ts');
    expect(route).toContain('context.user.discordId');
    // Die ganze Kette, nicht nur die Berechtigung: eine Datei ist ein
    // schreibender Vorgang wie jeder andere.
    expect(route).toContain('assertMembership');
    expect(route).toContain('verifyCsrfToken');
    expect(route).toContain('enforceRateLimit');
    expect(route).toContain('assertPermission');
  });

  it('schützt den Anhang-Endpunkt mit derselben Berechtigung wie die Seite', () => {
    /*
     * Eine Adresse ist keine Seite.
     *
     * Wer den Link weitergibt, gäbe den Anhang sonst an jeden weiter, der
     * angemeldet ist - das Modul ist intern, und intern heisst auch hier
     * intern.
     */
    const route = lies('apps/web/src/app/api/workspace/anhang/[anhangId]/route.ts');
    expect(route).toContain('WORKSPACE_PERMISSIONS.view');
    expect(route).toContain('status: 403');
    // Der Content-Type wird gesetzt, nicht abgeleitet, und `nosniff` verbietet
    // dem Browser das Raten: eine hochgeladene Datei kann nie als Skript
    // ausgeliefert werden.
    expect(route).toContain("'X-Content-Type-Options': 'nosniff'");
  });

  it('gibt jeder schreibenden Aktion eine Berechtigung und eine Ratengrenze', () => {
    const bloecke = AKTIONEN.split('export const ').slice(1);
    expect(bloecke.length).toBeGreaterThanOrEqual(19);
    for (const block of bloecke) {
      const name = block.slice(0, block.indexOf(' '));
      expect(block, name).toMatch(/permission: workspace\.WORKSPACE_PERMISSIONS\.\w+/u);
      expect(block, name).toMatch(/rateLimit: 'workspace\w+'/u);
    }
  });

  it('prüft bei Projektaktionen zusätzlich die Zuständigkeit', () => {
    /*
     * `projects.edit` deckt **alle** Projekte, die Projektleitung nur ihr
     * eigenes. Das lässt sich nicht als eine feste Berechtigung ausdrücken -
     * deshalb die zweite Prüfung im Rumpf, und zwar serverseitig.
     */
    expect(AKTIONEN).toContain('pruefeProjektzugriff');
    expect(lies('packages/modules/src/workspace/projekte.ts')).toContain(
      'export async function darfBearbeiten',
    );
  });

  it('prüft auf den Detailseiten die Gilde des Datensatzes', () => {
    /*
     * Die Kennung steht in der Adresse, und eine Adresse kommt aus fremder
     * Hand. Ohne diese Prüfung wäre sie ein Weg in ein Projekt einer anderen
     * Gilde - ein IDOR, und zwar einer, den niemand bemerkt, weil die Seite
     * ganz normal aussieht.
     */
    for (const datei of [
      'apps/web/src/app/(app)/workspace/projekte/[projectId]/page.tsx',
      'apps/web/src/app/(app)/workspace/aufgaben/[taskId]/page.tsx',
    ]) {
      const quelle = lies(datei);
      expect(quelle, datei).toContain('guildId');
      expect(quelle, datei).toContain('notFound()');
    }
  });

  it('prüft im Kern, dass ein Projekt zur Gilde gehört', () => {
    const aufgaben = lies('packages/modules/src/workspace/aufgaben.ts');
    // Die Projektkennung kommt aus einem Auswahlfeld, also aus einem Formular.
    expect(aufgaben).toContain('async function pruefeProjekt');
    expect(aufgaben).toMatch(/findFirst\(\{\s*where: \{ id: projectId, guildId \}/u);
  });

  it('lässt nur echte Discord-Kennungen als Zuständige durch', () => {
    const aufgaben = lies('packages/modules/src/workspace/aufgaben.ts');
    expect(aufgaben).toMatch(/\/\^\\d\{16,20\}\$\/u/u);
  });

  it('prüft Adressen serverseitig und nicht im Zod-Schema', () => {
    const mitarbeit = lies('packages/modules/src/workspace/mitarbeit.ts');
    expect(mitarbeit).toContain('export function pruefeUrl');
    // Positive Liste: nur http und https kommen durch. Eine Sperrliste
    // («kein javascript:») waere die Bauart, bei der das naechste Schema fehlt.
    expect(mitarbeit).toContain("adresse.protocol !== 'http:'");
    expect(mitarbeit).toContain("adresse.protocol !== 'https:'");
    // Die Aktion prueft die Adresse nicht selbst - zwei Pruefungen waeren zwei
    // Meinungen darueber, was zulaessig ist.
    expect(AKTIONEN).not.toContain('z.string().url()');
  });

  it('nimmt Anhänge nur über die zentrale Upload-Infrastruktur', () => {
    const mitarbeit = lies('packages/modules/src/workspace/mitarbeit.ts');
    expect(mitarbeit).toContain('storeLogoUpload');
    expect(mitarbeit).toContain('MAX_UPLOAD_BYTES');
    // Kein eigenes Schreiben auf die Platte, kein eigener Dateiname: der Name
    // aus dem Browser wird nie verwendet.
    for (const datei of KERN) {
      const quelle = lies(datei);
      expect(quelle, datei).not.toContain('node:fs');
      expect(quelle, datei).not.toContain('writeFile');
    }
  });

  it('kennt neun Berechtigungen, zwei davon eingriffsstark', () => {
    const schluessel = Object.values(workspace.WORKSPACE_PERMISSIONS);
    expect(schluessel).toHaveLength(9);
    // Alle unter demselben Praefix - daran haengt die Zuordnung zum Modul und
    // damit der Testmodus-Riegel.
    for (const key of schluessel) {
      expect(key.startsWith('workspace.'), key).toBe(true);
      expect(moduleIdForPermission(key), key).toBe(workspace.WORKSPACE_MODULE_ID);
    }

    const kritisch = workspace.workspaceModule.permissions
      .filter((eintrag) => eintrag.critical)
      .map((eintrag) => eintrag.key);
    // Archivieren und Loeschen - die beiden, die etwas aus dem Blickfeld
    // nehmen. Alles andere ist Alltagsarbeit.
    expect(kritisch.sort()).toEqual(
      [workspace.WORKSPACE_PERMISSIONS.projectsArchive, workspace.WORKSPACE_PERMISSIONS.tasksDelete].sort(),
    );
  });

  it('ist standardmässig aus und steht unter System', () => {
    // Ein internes Modul schaltet sich nicht von selbst auf jedem Server ein.
    expect(workspace.workspaceModule.defaultEnabled).toBe(false);
    expect(workspace.workspaceModule.navigation[0]?.group).toBe('system');
  });

  it('hat kein Loeschen fuer Projekte', () => {
    /*
     * An einem Projekt haengen Aufgaben, Kommentare und ein halbes Jahr
     * Verlauf. Es gibt deshalb `archiviere` und `holeZurueck` - und bewusst
     * keine Funktion, die ein Projekt wegwirft.
     */
    const projekte = lies('packages/modules/src/workspace/projekte.ts');
    expect(projekte).toContain('export async function archiviere');
    expect(projekte).not.toMatch(/workspaceProject\.delete\(/u);
    for (const datei of KERN) {
      expect(lies(datei), datei).not.toMatch(/workspaceProject\.delete\(/u);
    }
  });

  it('benutzt den bestehenden Scheduler und keinen Timer', () => {
    for (const datei of KERN) {
      const quelle = lies(datei);
      expect(quelle, datei).not.toContain('setTimeout');
      expect(quelle, datei).not.toContain('setInterval');
    }
    const jobs = lies('apps/bot/src/jobs.ts');
    expect(jobs).toContain("name: 'workspace-erinnerungen'");
    expect(jobs).toContain('workspace.verschickeErinnerungen()');
  });

  it('zieht keine Web- oder Next-Abhängigkeit in den Modulkern', () => {
    for (const datei of KERN) {
      const quelle = lies(datei);
      expect(quelle, datei).not.toContain("from 'next");
      expect(quelle, datei).not.toContain("from 'react");
      expect(quelle, datei).not.toContain('@/');
    }
  });

  it('verknüpft andere Module nur über Metadaten', () => {
    /*
     * `linkedModuleId` ist eine Zeichenkette ohne Relation - ein Deep Link und
     * keine technische Kopplung. Eine Fremdschlüsselbeziehung auf ein anderes
     * Modul wäre die Stelle, an der sich die beiden künftig nur noch zusammen
     * ändern lassen.
     */
    const schema = readFileSync(join(process.cwd(), 'packages/database/prisma/schema.prisma'), 'utf8');
    const workspaceTeil = schema.slice(schema.indexOf('model WorkspaceProject'));
    expect(workspaceTeil).toContain('linkedModuleId String?');
    expect(workspaceTeil).not.toMatch(/linkedModuleId\s+String\s+@relation/u);
  });
});
