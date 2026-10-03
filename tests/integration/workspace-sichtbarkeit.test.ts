import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_workspace_sicht');

/**
 * Wer welches Projekt sieht - und was alles daran haengt.
 *
 * ## Warum das ein eigener, langer Test ist
 *
 * Weil ein verstecktes Projekt an **vielen** Stellen nicht versteckt sein
 * muesste, um offen zu sein. Die Projektseite zu sperren genuegt nicht: der
 * Titel einer Aufgabe steht im Board, die Frist im Kalender, der Kommentar in
 * der Aufgabenansicht, der Verlauf unter beidem, und die Kacheln zaehlen alles
 * mit. Jede dieser Stellen ist eine eigene Abfrage, und jede davon ist hier
 * eine eigene Zusage.
 *
 * ## Warum «nicht gefunden» und nicht «verboten»
 *
 * Weil «verboten» bestaetigt, dass es das Projekt gibt. Bei einem privaten
 * Projekt ist genau das die Auskunft, die niemand bekommen soll. Die Tests
 * unten verlangen deshalb `NOT_FOUND` beziehungsweise `null` - nicht
 * `FORBIDDEN`.
 */
const { prisma } = await import('@swisshub/database');
const { workspace } = await import('@swisshub/modules');
const { setDiscordGateway } = await import('@swisshub/discord');

const GUILD = '000000000000000009';
const ANNA = '100000000000000011';
const BEN = '100000000000000012';
const CHRIS = '100000000000000013';
const TEAMROLLE = '900000000000000021';

/** Anna ist Mitglied und Leitung, Ben traegt die Teamrolle, Chris nichts. */
function rollenAttrappe() {
  const gateway = {
    members: {
      get: vi.fn(async (discordId: string) => ({
        discordId,
        username: 'tester',
        displayName: 'Tester',
        globalName: null,
        nickname: null,
        avatarHash: null,
        isBot: false,
        roleIds: discordId === BEN ? [TEAMROLLE] : [],
        joinedAt: new Date(),
        accountCreatedAt: new Date('2020-01-01'),
        boosting: false,
        timedOutUntil: null,
      })),
      setRoles: vi.fn(),
    },
    channels: { list: vi.fn(async () => []), send: vi.fn(async () => ({ id: '1', channelId: '2' })) },
    roles: { list: vi.fn(async () => []), add: vi.fn(), remove: vi.fn() },
    guild: { get: vi.fn(async () => ({ id: GUILD, name: 'SwissHub', ownerId: '9' })) },
    bot: { identity: vi.fn(async () => ({ discordId: '5', username: 'Bot' })) },
  };
  return gateway;
}

const SICHT = {
  anna: { discordId: ANNA, darfAlles: false },
  ben: { discordId: BEN, darfAlles: false },
  chris: { discordId: CHRIS, darfAlles: false },
  verwaltung: { discordId: CHRIS, darfAlles: true },
} as const;

describeWithDatabase('Workspace: Projektsichtbarkeit', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.workspaceActivity.deleteMany({});
    await prisma.workspaceComment.deleteMany({});
    await prisma.workspaceChecklistItem.deleteMany({});
    await prisma.workspaceLink.deleteMany({});
    await prisma.workspaceAttachment.deleteMany({});
    await prisma.workspaceMilestone.deleteMany({});
    await prisma.workspaceTaskAssignee.deleteMany({});
    await prisma.workspaceTask.deleteMany({});
    await prisma.workspaceProjectMember.deleteMany({});
    await prisma.workspaceProject.deleteMany({});
    await prisma.auditLog.deleteMany({});
    setDiscordGateway(rollenAttrappe() as never);
  });

  /** Ein Projekt mit Aufgabe, Kommentar, Meilenstein - alles daran haengend. */
  async function projektMit(sichtbarkeit: 'TEAM' | 'SELECTED_GROUPS' | 'PRIVATE', rollen: string[] = []) {
    const projekt = await workspace.erstelleProjekt(GUILD, ANNA, {
      titel: 'Geheimsache',
      sichtbarkeit,
      sichtbarFuerRollen: rollen,
    });
    const aufgabe = await workspace.erstelleAufgabe(GUILD, ANNA, {
      titel: 'Vertraulich planen',
      projectId: projekt.id,
      dueAt: new Date('2026-06-15T12:00:00Z'),
    });
    await workspace.schreibeKommentar(aufgabe.id, ANNA, 'Nur fürs Projektteam.');
    const meilenstein = await workspace.ergaenzeMeilenstein(projekt.id, ANNA, {
      titel: 'Abgabe',
      dueAt: new Date('2026-06-20T12:00:00Z'),
    });
    return { projekt, aufgabe, meilenstein };
  }

  // --- TEAM: die Vorgabe aendert nichts ------------------------------------

  it('zeigt ein Projekt mit Vorgabe allen mit Workspace-Zugang', async () => {
    const { projekt, aufgabe } = await projektMit('TEAM');

    // Chris ist weder Mitglied noch traegt er eine Rolle - und sieht trotzdem
    // alles. Das ist bei einem internen Werkzeug der Normalfall.
    expect((await workspace.ladeProjekt(projekt.id, SICHT.chris))?.projekt.id).toBe(projekt.id);
    expect((await workspace.ladeAufgabe(aufgabe.id, SICHT.chris))?.aufgabe.id).toBe(aufgabe.id);
    expect((await workspace.ladeProjekte(GUILD, SICHT.chris)).map((e) => e.projekt.id)).toContain(projekt.id);
  });

  it('legt ein neues Projekt mit der Vorgabe TEAM an', async () => {
    const projekt = await workspace.erstelleProjekt(GUILD, ANNA, { titel: 'Ohne Angabe' });
    // Niemand verliert den Zugang zu einem Projekt, das er gestern noch sah.
    expect(projekt.visibility).toBe('TEAM');
    expect(projekt.visibleRoleIds).toEqual([]);
  });

  // --- PRIVATE: nur die Mitglieder -----------------------------------------

  it('versteckt ein privates Projekt vor allen ausser den Mitgliedern', async () => {
    const { projekt } = await projektMit('PRIVATE');

    expect((await workspace.ladeProjekt(projekt.id, SICHT.anna))?.projekt.id).toBe(projekt.id);
    // `null`, nicht ein Fehler: die Seite macht daraus ein 404, und das ist
    // dieselbe Antwort wie fuer ein Projekt, das es nicht gibt.
    expect(await workspace.ladeProjekt(projekt.id, SICHT.chris)).toBeNull();
    expect((await workspace.ladeProjekte(GUILD, SICHT.chris)).map((e) => e.projekt.id)).not.toContain(
      projekt.id,
    );
  });

  it('versteckt auch die Aufgaben, Kommentare, Termine und den Verlauf', async () => {
    const { projekt, aufgabe } = await projektMit('PRIVATE');

    /*
     * Die eigentliche Zusage. Die Projektseite zu sperren genuegt nicht: jede
     * dieser Abfragen ist ein eigener Weg zum Titel, zur Frist, zum Text.
     */
    expect(await workspace.ladeAufgabe(aufgabe.id, SICHT.chris)).toBeNull();
    expect((await workspace.ladeAufgaben(GUILD, SICHT.chris)).map((e) => e.aufgabe.id)).not.toContain(
      aufgabe.id,
    );
    const board = await workspace.ladeBoard(GUILD, SICHT.chris);
    expect(
      Object.values(board)
        .flat()
        .map((karte) => karte.id),
    ).not.toContain(aufgabe.id);

    await expect(workspace.ladeKommentare(aufgabe.id, SICHT.chris)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(workspace.ladeCheckliste(aufgabe.id, SICHT.chris)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(workspace.ladeMeilensteine(projekt.id, SICHT.chris)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(workspace.ladeVerlauf({ projectId: projekt.id }, SICHT.chris)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(workspace.ladeLinks({ projectId: projekt.id }, SICHT.chris)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(workspace.ladeAnhaenge({ taskId: aufgabe.id }, SICHT.chris)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    // Der Kalender zeigt Aufgaben, Meilensteine **und** Projektziele - drei
    // Wege, von denen keiner offen bleiben darf.
    const termine = await workspace.ladeTermine(
      GUILD,
      SICHT.chris,
      new Date('2026-06-01T00:00:00Z'),
      new Date('2026-07-01T00:00:00Z'),
    );
    expect(termine).toEqual([]);
  });

  it('zaehlt ein privates Projekt in den Kacheln nicht mit', async () => {
    await projektMit('PRIVATE');

    /*
     * Eine Zahl ist eine Auskunft. «Eine ueberfaellige Aufgabe» verraet, dass
     * es eine gibt - auch wenn sie nirgends anklickbar ist.
     */
    const fremd = await workspace.ladeUebersichtszahlen(GUILD, SICHT.chris, {
      jetzt: new Date('2026-08-01T12:00:00Z'),
    });
    expect(fremd.aktiveProjekte).toBe(0);
    expect(fremd.ueberfaellig).toBe(0);

    const mitglied = await workspace.ladeUebersichtszahlen(GUILD, SICHT.anna, {
      jetzt: new Date('2026-08-01T12:00:00Z'),
    });
    expect(mitglied.aktiveProjekte).toBe(1);
    expect(mitglied.ueberfaellig).toBe(1);
  });

  it('nimmt ein Projektmitglied mit, auch ohne Rolle und ohne Leitung', async () => {
    const { projekt, aufgabe } = await projektMit('PRIVATE');
    // Anna bleibt Leitung - `setzeMitglieder` verlangt mindestens eine, und
    // zu Recht: ein Projekt ohne Leitung darf niemand mehr bearbeiten.
    await workspace.setzeMitglieder(projekt.id, ANNA, [
      { discordId: ANNA, rolle: 'LEAD' },
      { discordId: CHRIS, rolle: 'MEMBER' },
    ]);

    // Jemanden zu einem Projekt hinzuzufuegen, das er nicht sehen kann, waere
    // die absurdere Variante von «privat».
    expect((await workspace.ladeProjekt(projekt.id, SICHT.chris))?.projekt.id).toBe(projekt.id);
    expect((await workspace.ladeAufgabe(aufgabe.id, SICHT.chris))?.aufgabe.id).toBe(aufgabe.id);
  });

  // --- SELECTED_GROUPS: die Rollen entscheiden -----------------------------

  it('zeigt ein Gruppenprojekt den Traegern der Rolle', async () => {
    const { projekt, aufgabe } = await projektMit('SELECTED_GROUPS', [TEAMROLLE]);

    // Ben traegt die Rolle, Chris nicht - und die Rollen kommen aus Discord,
    // nicht aus der Eingabe des Aufrufers.
    expect((await workspace.ladeProjekt(projekt.id, SICHT.ben))?.projekt.id).toBe(projekt.id);
    expect((await workspace.ladeAufgabe(aufgabe.id, SICHT.ben))?.aufgabe.id).toBe(aufgabe.id);
    expect(await workspace.ladeProjekt(projekt.id, SICHT.chris)).toBeNull();
  });

  it('verlangt mindestens eine Rolle, wenn Gruppen gewaehlt sind', async () => {
    /*
     * `SELECTED_GROUPS` ohne Rollen ist ein privates Projekt, das sich nicht
     * so nennt. Das sieht nach Versehen aus und wird abgewiesen - wer nur die
     * Mitglieder will, waehlt `PRIVATE`.
     */
    await expect(
      workspace.erstelleProjekt(GUILD, ANNA, {
        titel: 'Halb entschieden',
        sichtbarkeit: 'SELECTED_GROUPS',
        sichtbarFuerRollen: [],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('wirft eine Rollenliste weg, die zu keiner Gruppenwahl gehoert', async () => {
    const projekt = await workspace.erstelleProjekt(GUILD, ANNA, {
      titel: 'Offen',
      sichtbarkeit: 'TEAM',
      sichtbarFuerRollen: [TEAMROLLE],
    });
    // Eine Angabe, die nichts tut, bleibt nicht stehen: sie waere eine
    // Erklaerung fuer ein Verhalten, das es nicht gibt.
    expect(projekt.visibleRoleIds).toEqual([]);
  });

  // --- Die Verwaltung ------------------------------------------------------

  it('laesst die Modulverwaltung an ein verwaistes privates Projekt', async () => {
    const { projekt, aufgabe } = await projektMit('PRIVATE');

    /*
     * Sonst gaebe es Projekte, die niemand mehr aufraeumen kann, sobald ihre
     * Mitglieder den Server verlassen haben. `darfAlles` haengt an
     * `settingsManage` - nicht an `projectsEdit`, sonst waere die Sichtbarkeit
     * eine Anzeigeeinstellung.
     */
    expect((await workspace.ladeProjekt(projekt.id, SICHT.verwaltung))?.projekt.id).toBe(projekt.id);
    expect((await workspace.ladeAufgabe(aufgabe.id, SICHT.verwaltung))?.aufgabe.id).toBe(aufgabe.id);
  });

  // --- Die Suche ------------------------------------------------------------

  it('findet mit der Suche nichts, was ohne sie verborgen ist', async () => {
    await projektMit('PRIVATE');

    /*
     * Die gefaehrlichste Stelle des Filters. Die Suche bringt ihr eigenes `OR`
     * mit; stuende es auf derselben Ebene wie das `OR` der Sichtbarkeit,
     * ueberschriebe es dieses - und die Suche waere der Weg an der
     * Sichtbarkeit vorbei. Beide Teile sehen fuer sich richtig aus.
     */
    expect(await workspace.ladeProjekte(GUILD, SICHT.chris, { suche: 'Geheim' })).toEqual([]);
    expect(
      (await workspace.ladeProjekte(GUILD, SICHT.anna, { suche: 'Geheim' })).map((e) => e.projekt.title),
    ).toEqual(['Geheimsache']);

    expect(await workspace.ladeAufgaben(GUILD, SICHT.chris, { suche: 'Vertraulich' })).toEqual([]);
    expect(
      (await workspace.ladeAufgaben(GUILD, SICHT.anna, { suche: 'Vertraulich' })).map((e) => e.aufgabe.title),
    ).toEqual(['Vertraulich planen']);
  });

  // --- Aufgaben ohne Projekt ------------------------------------------------

  it('laesst eine Aufgabe ohne Projekt fuer alle sichtbar', async () => {
    const frei = await workspace.erstelleAufgabe(GUILD, ANNA, { titel: 'Gehoert niemandem' });

    // Nicht alles ist ein Projekt - und eine projektlose Aufgabe hat keine
    // Sichtbarkeit zu erben.
    expect((await workspace.ladeAufgabe(frei.id, SICHT.chris))?.aufgabe.id).toBe(frei.id);
    expect((await workspace.ladeAufgaben(GUILD, SICHT.chris)).map((e) => e.aufgabe.id)).toContain(frei.id);
  });

  // --- Der Kanal -----------------------------------------------------------

  it('lehnt eine Kanalkennung ab, die es auf diesem Server nicht gibt', async () => {
    /*
     * Die Kennung kommt aus einem Formular und koennte jeden Kanal nennen, den
     * Discord kennt - auch einen auf einem fremden Server. Geprueft wird gegen
     * die Kanalliste der Gilde; die Attrappe liefert eine leere.
     */
    await expect(
      workspace.erstelleProjekt(GUILD, ANNA, {
        titel: 'Mit fremdem Kanal',
        discordChannelId: '900000000000000099',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('nimmt kein Projekt ohne Kanal uebel', async () => {
    const projekt = await workspace.erstelleProjekt(GUILD, ANNA, { titel: 'Ohne Kanal' });
    // Ohne Kanal passiert nichts - und das ist die Vorgabe, nicht ein Mangel.
    expect(projekt.discordChannelId).toBeNull();
  });
});

/**
 * Die Discord-Meldung je Projekt.
 *
 * Geprueft wird, **ob** gesendet wird und ob die Nachricht niemanden anpingt -
 * nicht, was Discord daraus macht. Die Attrappe haelt die Aufrufe fest.
 */
describeWithDatabase('Workspace: Meldung in den Projektkanal', () => {
  const KANAL = '800000000000000031';

  function kanalAttrappe() {
    const gesendet: Array<{ channelId: string; nutzlast: Record<string, unknown> }> = [];
    const gateway = {
      members: {
        get: vi.fn(async (discordId: string) => ({
          discordId,
          username: 'tester',
          displayName: 'Tester',
          globalName: null,
          nickname: null,
          avatarHash: null,
          isBot: false,
          roleIds: [] as string[],
          joinedAt: new Date(),
          accountCreatedAt: new Date('2020-01-01'),
          boosting: false,
          timedOutUntil: null,
        })),
        setRoles: vi.fn(),
      },
      channels: {
        // Ein Textkanal - sonst lehnt das Modul die Kennung ab.
        list: vi.fn(async () => [
          { id: KANAL, name: 'projekt-kanal', type: 0, parentId: null, position: 0, nsfw: false },
        ]),
        send: vi.fn(async (channelId: string, nutzlast: Record<string, unknown>) => {
          gesendet.push({ channelId, nutzlast });
          return { id: '1', channelId };
        }),
      },
      roles: { list: vi.fn(async () => []), add: vi.fn(), remove: vi.fn() },
      guild: { get: vi.fn(async () => ({ id: GUILD, name: 'SwissHub', ownerId: '9' })) },
      bot: { identity: vi.fn(async () => ({ discordId: '5', username: 'Bot' })) },
    };
    return { gateway, gesendet };
  }

  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.workspaceActivity.deleteMany({});
    await prisma.workspaceMilestone.deleteMany({});
    await prisma.workspaceTaskAssignee.deleteMany({});
    await prisma.workspaceTask.deleteMany({});
    await prisma.workspaceProjectMember.deleteMany({});
    await prisma.workspaceProject.deleteMany({});
  });

  it('meldet neue und erledigte Aufgaben sowie erreichte Meilensteine', async () => {
    const attrappe = kanalAttrappe();
    setDiscordGateway(attrappe.gateway as never);

    const projekt = await workspace.erstelleProjekt(GUILD, ANNA, {
      titel: 'Turnier Herbst',
      discordChannelId: KANAL,
    });
    const aufgabe = await workspace.erstelleAufgabe(GUILD, ANNA, {
      titel: 'Teams einladen',
      projectId: projekt.id,
    });
    expect(attrappe.gesendet).toHaveLength(1);
    expect(attrappe.gesendet[0]?.channelId).toBe(KANAL);

    /*
     * Kein Ping - und das ist keine Kleinigkeit: der Titel kommt aus einem
     * Formular, und «@everyone fragen» loeste sonst genau das aus.
     */
    expect(attrappe.gesendet[0]?.nutzlast.allowedMentions).toEqual({ parse: [] });

    await workspace.setzeStatus(aufgabe.id, ANNA, 'DONE');
    expect(attrappe.gesendet).toHaveLength(2);

    const meilenstein = await workspace.ergaenzeMeilenstein(projekt.id, ANNA, {
      titel: 'Abgabe',
      dueAt: new Date('2026-06-20T12:00:00Z'),
    });
    await workspace.aendereMeilenstein(meilenstein.id, ANNA, { erledigt: true });
    expect(attrappe.gesendet).toHaveLength(3);
  });

  it('schweigt bei den uebrigen Statuswechseln', async () => {
    const attrappe = kanalAttrappe();
    setDiscordGateway(attrappe.gateway as never);
    const projekt = await workspace.erstelleProjekt(GUILD, ANNA, {
      titel: 'Turnier Herbst',
      discordChannelId: KANAL,
    });
    const aufgabe = await workspace.erstelleAufgabe(GUILD, ANNA, {
      titel: 'Teams einladen',
      projectId: projekt.id,
    });
    attrappe.gesendet.length = 0;

    // «Offen → In Arbeit» ist der Alltag. Dafuer eine Nachricht zu schicken
    // hiesse, den Kanal mit dem Board zu verwechseln.
    await workspace.setzeStatus(aufgabe.id, ANNA, 'IN_PROGRESS');
    expect(attrappe.gesendet).toEqual([]);
  });

  it('schweigt ohne eingetragenen Kanal', async () => {
    const attrappe = kanalAttrappe();
    setDiscordGateway(attrappe.gateway as never);
    const projekt = await workspace.erstelleProjekt(GUILD, ANNA, { titel: 'Ohne Kanal' });

    await workspace.erstelleAufgabe(GUILD, ANNA, { titel: 'Irgendwas', projectId: projekt.id });

    // Ohne Kanal passiert nichts: ein Werkzeug, das unaufgefordert in einen
    // Kanal schreibt, waere eine Entscheidung, die niemand getroffen hat.
    expect(attrappe.gesendet).toEqual([]);
  });

  it('bricht die Aufgabe nicht ab, wenn Discord nicht mitspielt', async () => {
    const attrappe = kanalAttrappe();
    setDiscordGateway(attrappe.gateway as never);
    const projekt = await workspace.erstelleProjekt(GUILD, ANNA, {
      titel: 'Turnier Herbst',
      discordChannelId: KANAL,
    });
    attrappe.gateway.channels.send = vi.fn(async () => {
      throw new Error('Discord antwortet nicht');
    });

    /*
     * Das Projekt ist das Wesentliche, die Meldung die Beigabe. Dass eine
     * Aufgabe nicht entsteht, weil die Nachricht darueber nicht durchkam, waere
     * der falsche Handel.
     */
    const aufgabe = await workspace.erstelleAufgabe(GUILD, ANNA, {
      titel: 'Trotzdem da',
      projectId: projekt.id,
    });
    expect((await workspace.ladeAufgabe(aufgabe.id, SICHT.anna))?.aufgabe.title).toBe('Trotzdem da');
  });
});
