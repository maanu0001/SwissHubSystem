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
    // «+1 · jetzt 2» statt nur «2 Mitglieder»: die Zahl danach beantwortet
    // nicht die Frage, die man dem Verlauf stellt.
    expect(eintrag.detail).toContain('+1');
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
});
