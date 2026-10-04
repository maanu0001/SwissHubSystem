import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_workspace_beteiligte');

/**
 * Die Beteiligten eines Projekts.
 *
 * ## Was hier geprueft wird
 *
 * Nicht, dass sich eine Zeile schreiben laesst - das waere ein Test der
 * Datenbank. Sondern die vier Zusagen, die das Panel «Beteiligte» macht und
 * die eine Oberflaeche nicht nachholen kann:
 *
 *   - **Hinzufuegen und Entfernen** bleiben erhalten, auch einzeln.
 *   - **Keine Duplikate**: dieselbe Person zweimal ist eine Person.
 *   - **Der Verlauf sagt, was passiert ist** - und schweigt, wenn nichts
 *     passiert ist. Ein Verlauf, der jedes geoeffnete Formular protokolliert,
 *     ist nach einer Woche unlesbar.
 *   - **Beteiligte sehen das Projekt**, auch wenn es auf `PRIVATE` steht -
 *     und zwar serverseitig, im `where` der Abfrage. Eine Oberflaeche, die
 *     ein Projekt nur nicht anzeigt, versteckt es nicht: die Kennung steht in
 *     jeder Adresse.
 */
const { prisma } = await import('@swisshub/database');
const { workspace } = await import('@swisshub/modules');

const GUILD = '000000000000000055';
const ANNA = '100000000000000051';
const BEN = '100000000000000052';
const CARLA = '100000000000000053';

/** Wer alles sieht - die globale Berechtigung, nicht eine Mitgliedschaft. */
const ALLES = { discordId: ANNA, darfAlles: true } as const;
/** Ein gewoehnliches Mitglied ohne Sonderrecht. */
const nur = (discordId: string) => ({ discordId, darfAlles: false }) as const;

async function leeren(): Promise<void> {
  await prisma.workspaceActivity.deleteMany({});
  await prisma.workspaceTaskAssignee.deleteMany({});
  await prisma.workspaceTask.deleteMany({});
  await prisma.workspaceProjectMember.deleteMany({});
  await prisma.workspaceProject.deleteMany({});
}

async function projekt(sichtbarkeit: 'TEAM' | 'PRIVATE' = 'TEAM'): Promise<string> {
  const angelegt = await workspace.erstelleProjekt(GUILD, ANNA, {
    titel: 'Turnier Herbst',
    sichtbarkeit,
  });
  return angelegt.id;
}

async function beteiligte(projectId: string): Promise<Array<{ discordId: string; rolle: string }>> {
  const zeilen = await prisma.workspaceProjectMember.findMany({
    where: { projectId },
    orderBy: { discordId: 'asc' },
    select: { discordId: true, rolle: true },
  });
  return zeilen;
}

describeWithDatabase('Workspace: Beteiligte', () => {
  beforeAll(async () => {
    await pushSchema();
  });

  beforeEach(async () => {
    await leeren();
  });

  it('macht die anlegende Person zur Projektleitung', async () => {
    const projectId = await projekt();
    expect(await beteiligte(projectId)).toEqual([{ discordId: ANNA, rolle: 'LEAD' }]);
  });

  it('nimmt jemanden dazu und wieder heraus', async () => {
    const projectId = await projekt();

    await workspace.setzeMitglieder(projectId, ANNA, [
      { discordId: ANNA, rolle: 'LEAD' },
      { discordId: BEN, rolle: 'MEMBER' },
    ]);
    expect(await beteiligte(projectId)).toEqual([
      { discordId: ANNA, rolle: 'LEAD' },
      { discordId: BEN, rolle: 'MEMBER' },
    ]);

    await workspace.setzeMitglieder(projectId, ANNA, [{ discordId: ANNA, rolle: 'LEAD' }]);
    expect(await beteiligte(projectId)).toEqual([{ discordId: ANNA, rolle: 'LEAD' }]);
  });

  it('macht aus derselben Person keine zwei Zeilen', async () => {
    const projectId = await projekt();

    await workspace.setzeMitglieder(projectId, ANNA, [
      { discordId: ANNA, rolle: 'LEAD' },
      { discordId: BEN, rolle: 'MEMBER' },
      // Zweimal dieselbe Kennung - das Formular kann das nicht schicken, eine
      // Server Action schon: sie ist ein oeffentlicher Endpunkt.
      { discordId: BEN, rolle: 'LEAD' },
    ]);

    const liste = await beteiligte(projectId);
    expect(liste).toHaveLength(2);
    // Die letzte Angabe gewinnt - eine Entscheidung, aber eine eindeutige.
    expect(liste.find((eintrag) => eintrag.discordId === BEN)?.rolle).toBe('LEAD');
  });

  it('stuft eine beteiligte Person um, ohne sie zu verlieren', async () => {
    const projectId = await projekt();
    await workspace.setzeMitglieder(projectId, ANNA, [
      { discordId: ANNA, rolle: 'LEAD' },
      { discordId: BEN, rolle: 'MEMBER' },
    ]);

    // Unterstuetzung wird Projektleitung - mehrere Leitungen sind erlaubt.
    await workspace.setzeMitglieder(projectId, ANNA, [
      { discordId: ANNA, rolle: 'LEAD' },
      { discordId: BEN, rolle: 'LEAD' },
    ]);
    expect(await beteiligte(projectId)).toEqual([
      { discordId: ANNA, rolle: 'LEAD' },
      { discordId: BEN, rolle: 'LEAD' },
    ]);

    // Und zurueck - die Person bleibt dabei, nur die Rolle wechselt.
    await workspace.setzeMitglieder(projectId, ANNA, [
      { discordId: ANNA, rolle: 'LEAD' },
      { discordId: BEN, rolle: 'MEMBER' },
    ]);
    expect(await beteiligte(projectId)).toEqual([
      { discordId: ANNA, rolle: 'LEAD' },
      { discordId: BEN, rolle: 'MEMBER' },
    ]);

    const eintrag = await prisma.workspaceActivity.findFirstOrThrow({
      where: { art: 'project.member' },
      orderBy: { createdAt: 'desc' },
    });
    expect(eintrag.detail).toContain('1× Rolle geändert');
    // Umstufen ist weder ein Zugang noch ein Abgang.
    expect(eintrag.detail).not.toContain('hinzugefügt');
    expect(eintrag.detail).not.toContain('entfernt');
  });

  it('verlangt mindestens eine Projektleitung', async () => {
    const projectId = await projekt();
    await expect(
      workspace.setzeMitglieder(projectId, ANNA, [{ discordId: BEN, rolle: 'MEMBER' }]),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    // Und der Stand von vorher steht noch.
    expect(await beteiligte(projectId)).toEqual([{ discordId: ANNA, rolle: 'LEAD' }]);
  });

  it('schreibt in den Verlauf, was sich geändert hat', async () => {
    const projectId = await projekt();
    await prisma.workspaceActivity.deleteMany({});

    await workspace.setzeMitglieder(projectId, ANNA, [
      { discordId: ANNA, rolle: 'LEAD' },
      { discordId: BEN, rolle: 'MEMBER' },
    ]);

    const eintrag = await prisma.workspaceActivity.findFirstOrThrow({
      where: { art: 'project.member' },
      orderBy: { createdAt: 'desc' },
    });
    // Der Vorgang in Worten statt nur die Zahl danach: «2 Mitglieder»
    // beantwortet nicht die Frage, die man dem Verlauf stellt.
    expect(eintrag.detail).toContain('1 hinzugefügt');
    expect(eintrag.detail).toContain('jetzt 2');
  });

  it('schweigt, wenn sich nichts ändert', async () => {
    const projectId = await projekt();
    await prisma.workspaceActivity.deleteMany({});

    // Derselbe Stand noch einmal - ein geöffnetes und wieder geschlossenes
    // Formular darf keinen Eintrag erzeugen.
    await workspace.setzeMitglieder(projectId, ANNA, [{ discordId: ANNA, rolle: 'LEAD' }]);

    expect(await prisma.workspaceActivity.count({ where: { art: 'project.member' } })).toBe(0);
  });

  it('lässt Beteiligte ein privates Projekt sehen - und sonst niemanden', async () => {
    const projectId = await projekt('PRIVATE');
    await workspace.setzeMitglieder(projectId, ANNA, [
      { discordId: ANNA, rolle: 'LEAD' },
      { discordId: BEN, rolle: 'MEMBER' },
    ]);

    /*
     * Geprueft wird die Liste **und** die Einzelansicht.
     *
     * Die Liste traegt den Filter im `where`; die Einzelansicht prueft die
     * Kennung. Beides muss dasselbe sagen, sonst ist die Kennung aus der
     * Adresse der Weg ins Projekt - und genau das ist die Luecke, die eine
     * Sichtbarkeit niemandem verzeiht.
     */
    expect((await workspace.ladeProjekte(GUILD, nur(BEN))).map((zeile) => zeile.projekt.id)).toEqual([
      projectId,
    ]);
    expect(await workspace.ladeProjekt(projectId, nur(BEN))).not.toBeNull();

    expect(await workspace.ladeProjekte(GUILD, nur(CARLA))).toHaveLength(0);
    expect(await workspace.ladeProjekt(projectId, nur(CARLA))).toBeNull();

    /*
     * Die Verwaltung sieht es trotzdem - und das ist Absicht.
     *
     * `darfAlles` haengt an `settingsManage`. Ohne diesen Weg gaebe es
     * private Projekte, an die niemand mehr herankommt, sobald ihre
     * Beteiligten den Server verlassen haben. Es ist kein Loch in der
     * Sichtbarkeit, sondern eine Berechtigung - und deshalb steht sie hier
     * im selben Test wie die Sperre.
     */
    expect((await workspace.ladeProjekte(GUILD, ALLES)).map((zeile) => zeile.projekt.id)).toEqual([
      projectId,
    ]);
    expect(await workspace.ladeProjekt(projectId, { discordId: CARLA, darfAlles: true })).not.toBeNull();
  });

  it('nimmt dem Entfernten die Sicht auf das private Projekt', async () => {
    const projectId = await projekt('PRIVATE');
    await workspace.setzeMitglieder(projectId, ANNA, [
      { discordId: ANNA, rolle: 'LEAD' },
      { discordId: BEN, rolle: 'MEMBER' },
    ]);
    expect(await workspace.ladeProjekt(projectId, nur(BEN))).not.toBeNull();

    await workspace.setzeMitglieder(projectId, ANNA, [{ discordId: ANNA, rolle: 'LEAD' }]);

    // Kein Zwischenschritt, kein Zwischenspeicher: wer draussen ist, sieht es
    // nicht mehr.
    expect(await workspace.ladeProjekt(projectId, nur(BEN))).toBeNull();
    expect(await workspace.ladeProjekte(GUILD, nur(BEN))).toHaveLength(0);
  });

  it('erbt die Sichtbarkeit auf die Aufgaben des Projekts', async () => {
    const projectId = await projekt('PRIVATE');
    await workspace.setzeMitglieder(projectId, ANNA, [
      { discordId: ANNA, rolle: 'LEAD' },
      { discordId: BEN, rolle: 'MEMBER' },
    ]);
    await workspace.erstelleAufgabe(GUILD, ANNA, { titel: 'Geheim', projectId });

    // Beteiligte sehen die Aufgabe, Fremde nicht - sonst waere das Board die
    // Luecke, durch die der Titel jeder privaten Aufgabe zu lesen waere.
    expect(await workspace.ladeAufgaben(GUILD, nur(BEN))).toHaveLength(1);
    expect(await workspace.ladeAufgaben(GUILD, nur(CARLA))).toHaveLength(0);
  });

  /*
   * Beteiligte und Sichtbarkeit sind zwei Dinge.
   *
   * Das ist die Zusage, die am leichtesten lautlos kaputtgeht: eine Zeile in
   * `setzeMitglieder`, die «damit es funktioniert» die Sichtbarkeit mitzieht,
   * und schon weitet jedes Hinzufuegen den Zugriff auf ein Projekt aus, das
   * ausdruecklich nicht fuer alle gedacht war. Darum steht hier nicht nur,
   * was passiert, sondern auch, was **nicht** passiert.
   */
  it('ändert beim Hinzufügen und Entfernen die Sichtbarkeit nicht', async () => {
    for (const sichtbarkeit of ['TEAM', 'PRIVATE'] as const) {
      await leeren();
      const id = await projekt(sichtbarkeit);
      const vorher = await prisma.workspaceProject.findUniqueOrThrow({
        where: { id },
        select: { visibility: true, visibleRoleIds: true },
      });

      await workspace.setzeMitglieder(id, ANNA, [
        { discordId: ANNA, rolle: 'LEAD' },
        { discordId: BEN, rolle: 'MEMBER' },
      ]);
      await workspace.setzeMitglieder(id, ANNA, [{ discordId: ANNA, rolle: 'LEAD' }]);

      const nachher = await prisma.workspaceProject.findUniqueOrThrow({
        where: { id },
        select: { visibility: true, visibleRoleIds: true },
      });
      expect(nachher.visibility, sichtbarkeit).toBe(vorher.visibility);
      expect(nachher.visibleRoleIds, sichtbarkeit).toEqual(vorher.visibleRoleIds);
    }
  });

  it('lässt die freigegebenen Rollen eines Gruppenprojekts unberührt', async () => {
    /*
     * `SELECTED_GROUPS` ist der Fall, in dem es am meisten weh taete: dort
     * steht eine Liste von Rollen, und wer sie beim Beteiligen verliert,
     * sperrt eine ganze Gruppe aus, ohne es zu merken.
     */
    const angelegt = await workspace.erstelleProjekt(GUILD, ANNA, {
      titel: 'Gruppenprojekt',
      sichtbarkeit: 'SELECTED_GROUPS',
      sichtbarFuerRollen: ['200000000000000001', '200000000000000002'],
    });

    await workspace.setzeMitglieder(angelegt.id, ANNA, [
      { discordId: ANNA, rolle: 'LEAD' },
      { discordId: CARLA, rolle: 'MEMBER' },
    ]);

    const zeile = await prisma.workspaceProject.findUniqueOrThrow({
      where: { id: angelegt.id },
      select: { visibility: true, visibleRoleIds: true },
    });
    expect(zeile.visibility).toBe('SELECTED_GROUPS');
    expect([...zeile.visibleRoleIds].sort()).toEqual(['200000000000000001', '200000000000000002']);
  });

  it('schreibt in setzeMitglieder keine Sichtbarkeit', async () => {
    /*
     * Dasselbe am Quelltext, und zwar mit Absicht doppelt: der Test oben
     * faellt erst auf, wenn jemand eine bestimmte Sichtbarkeit setzt. Dieser
     * hier faellt auf, sobald die Funktion das Feld ueberhaupt anfasst - auch
     * wenn sie denselben Wert hineinschreibt und damit zufaellig gruen
     * bleibt.
     */
    const quelle = readFileSync('packages/modules/src/workspace/projekte.ts', 'utf8');
    const anfang = quelle.indexOf('export async function setzeMitglieder');
    expect(anfang).toBeGreaterThan(-1);
    const naechste = quelle.indexOf('\nexport ', anfang + 10);
    const block = quelle
      .slice(anfang, naechste === -1 ? undefined : naechste)
      .replace(/\/\*[\s\S]*?\*\//gu, '')
      .replace(/^\s*\/\/.*$/gmu, '');
    expect(block).not.toContain('visibility');
    expect(block).not.toContain('visibleRoleIds');
  });

  it('erlaubt mehrere Projektleitungen', async () => {
    /*
     * Ausdruecklich erlaubt: ein Projekt kann zwei Personen haben, die es
     * fuehren. Eine Pruefung, die beim Zweiten abbricht, waere eine Regel,
     * die niemand verlangt hat - und sie faellt erst auf, wenn jemand sie
     * braucht.
     */
    const projectId = await projekt();
    await workspace.setzeMitglieder(projectId, ANNA, [
      { discordId: ANNA, rolle: 'LEAD' },
      { discordId: BEN, rolle: 'LEAD' },
      { discordId: CARLA, rolle: 'MEMBER' },
    ]);

    const liste = await beteiligte(projectId);
    expect(liste.filter((eintrag) => eintrag.rolle === 'LEAD').map((eintrag) => eintrag.discordId)).toEqual([
      ANNA,
      BEN,
    ]);
    expect(liste.filter((eintrag) => eintrag.rolle === 'MEMBER')).toHaveLength(1);
  });

  it('nimmt jemanden direkt mit der gewaehlten Rolle auf', async () => {
    /*
     * ## Warum das eine eigene Zusage ist
     *
     * In der Oberflaeche kam jede neue Person als «Unterstuetzung» herein und
     * musste danach umgestuft werden - zwei Schritte fuer eine Entscheidung,
     * die man beim Hinzufuegen schon getroffen hat. Die Rolle steht jetzt
     * ueber der Liste und gilt fuer den naechsten Klick.
     *
     * Hier wird geprueft, dass der Dienst das auch kann: eine Person kommt
     * **als** Projektleitung herein, nicht erst danach.
     */
    const projectId = await projekt();
    await workspace.setzeMitglieder(projectId, ANNA, [
      { discordId: ANNA, rolle: 'LEAD' },
      { discordId: BEN, rolle: 'LEAD' },
    ]);
    expect(await beteiligte(projectId)).toEqual([
      { discordId: ANNA, rolle: 'LEAD' },
      { discordId: BEN, rolle: 'LEAD' },
    ]);
  });

  it('stellt die Rolle in der Oberflaeche vor das Hinzufuegen', () => {
    /*
     * Das Panel ist eine Client-Komponente mit Formularzustand; sie laesst
     * sich hier nicht bedienen. Nachgesehen wird darum das eine, was die
     * Zusage ausmacht: dass das Hinzufuegen die **gewaehlte** Rolle nimmt und
     * nicht eine feste Vorgabe.
     */
    const quelle = readFileSync('apps/web/src/modules/workspace/components/projekt-steuerung.tsx', 'utf8');
    expect(quelle).toContain('const [neueRolle, setNeueRolle]');
    expect(quelle).toContain('ws-neue-rolle');
    expect(quelle).toContain('{ discordId, rolle: neueRolle }');
    // Die alte Form: jede neue Person kam fest als Unterstuetzung herein.
    expect(quelle).not.toMatch(/\{ discordId, rolle: 'MEMBER' \}/u);
  });

  it('kennt bei zuständigen Personen gar keine Rolle', () => {
    /*
     * ## Warum das ein Test ist
     *
     * Weil «alle Beteiligten sind verantwortlich» eine Aussage ueber das
     * Datenmodell ist und nicht ueber die Oberflaeche. Gaebe es eine
     * Rollenspalte an der Aufgabe, waere sie irgendwann gefuellt - und dann
     * gibt es Besitzer und Helfer, obwohl es die nicht geben soll.
     *
     * Projektrollen bleiben davon unberuehrt: dort gibt es Projektleitung
     * und Unterstuetzung, und das ist eine andere Tabelle.
     */
    const schema = readFileSync('packages/database/prisma/schema.prisma', 'utf8');
    const anfang = schema.indexOf('model WorkspaceTaskAssignee');
    expect(anfang).toBeGreaterThan(-1);
    const block = schema.slice(anfang, schema.indexOf('\n}', anfang));
    expect(block).not.toMatch(/\brolle\b/u);
    expect(block).not.toMatch(/\brole\b/iu);

    // Und der Dienst nimmt nur Kennungen - keine Paare mit Rolle.
    const dienst = readFileSync('packages/modules/src/workspace/aufgaben.ts', 'utf8');
    expect(dienst).toMatch(
      /export async function setzeZustaendige\(\s*taskId: string,\s*\w+: string,\s*\w+: readonly string\[\]/u,
    );
  });

  it('macht die anlegende Person zur ersten zuständigen Person', async () => {
    const id = await projekt();
    const aufgabe = await workspace.erstelleAufgabe(GUILD, BEN, {
      titel: 'Plakate drucken',
      projectId: id,
    });

    const zustaendige = await prisma.workspaceTaskAssignee.findMany({
      where: { taskId: aufgabe.id },
      select: { discordId: true },
    });
    expect(zustaendige.map((zeile) => zeile.discordId)).toEqual([BEN]);
  });

  it('nimmt zuständige Personen dazu, heraus - und sich selbst heraus', async () => {
    const id = await projekt();
    const aufgabe = await workspace.erstelleAufgabe(GUILD, BEN, {
      titel: 'Plakate drucken',
      projectId: id,
    });

    await workspace.setzeZustaendige(aufgabe.id, BEN, [BEN, CARLA]);
    const zuZweit = await prisma.workspaceTaskAssignee.findMany({
      where: { taskId: aufgabe.id },
      select: { discordId: true },
      orderBy: { discordId: 'asc' },
    });
    expect(zuZweit.map((zeile) => zeile.discordId)).toEqual([BEN, CARLA]);

    // Und sich selbst wieder heraus - die Aufgabe bleibt, sie gehoert jetzt Carla.
    await workspace.setzeZustaendige(aufgabe.id, BEN, [CARLA]);
    const alleine = await prisma.workspaceTaskAssignee.findMany({
      where: { taskId: aufgabe.id },
      select: { discordId: true },
    });
    expect(alleine.map((zeile) => zeile.discordId)).toEqual([CARLA]);
  });

  it('macht aus derselben zuständigen Person keine zwei Zeilen', async () => {
    const id = await projekt();
    const aufgabe = await workspace.erstelleAufgabe(GUILD, BEN, {
      titel: 'Plakate drucken',
      projectId: id,
      zustaendige: [CARLA, CARLA, ' ' + CARLA + ' '],
    });
    const zeilen = await prisma.workspaceTaskAssignee.findMany({ where: { taskId: aufgabe.id } });
    expect(zeilen).toHaveLength(1);
  });

  it('zeigt die Aufgabe in «Meine Aufgaben», solange man zuständig ist', async () => {
    const id = await projekt();
    const aufgabe = await workspace.erstelleAufgabe(GUILD, BEN, {
      titel: 'Plakate drucken',
      projectId: id,
      zustaendige: [BEN],
    });

    const meine = async (wer: string): Promise<string[]> =>
      (await workspace.ladeAufgaben(GUILD, ALLES, { zustaendig: wer })).map((eintrag) => eintrag.aufgabe.id);

    expect(await meine(BEN)).toContain(aufgabe.id);
    expect(await meine(CARLA)).not.toContain(aufgabe.id);

    // Dazu: jetzt steht sie bei beiden.
    await workspace.setzeZustaendige(aufgabe.id, BEN, [BEN, CARLA]);
    expect(await meine(BEN)).toContain(aufgabe.id);
    expect(await meine(CARLA)).toContain(aufgabe.id);

    // Heraus: und bei Ben nicht mehr.
    await workspace.setzeZustaendige(aufgabe.id, BEN, [CARLA]);
    expect(await meine(BEN)).not.toContain(aufgabe.id);
    expect(await meine(CARLA)).toContain(aufgabe.id);
  });
});
