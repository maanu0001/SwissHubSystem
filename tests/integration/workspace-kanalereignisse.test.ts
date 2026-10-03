import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_workspace_kanal');

/**
 * Was im Projektkanal landet - und was nicht.
 *
 * ## Warum diese Datei gegen eine echte Datenbank und einen echten Versand läuft
 *
 * Weil die drei Riegel (Kanal eingetragen, Schalter an, Art ausgewählt) in der
 * Abfrage auf die Projektzeile stecken. Eine Attrappe prüfte die `if`-Kette
 * und nicht die Bedingung, auf die es ankommt. Und weil die interessanteste
 * Zusage lautet: **ein gescheiterter Versand darf die Aufgabe nicht umwerfen**
 * - das lässt sich nur prüfen, indem man den Versand wirklich scheitern lässt
 * und danach die Aufgabe sucht.
 *
 * ## Was bewusst nicht geprüft wird
 *
 * Wie das Embed aussieht. Felder und Farben sind Gestaltung; ein Test darauf
 * wäre eine zweite Fassung desselben Textes und bräche bei jeder
 * Formulierung. Geprüft wird, **dass** etwas kommt, **was** für ein Ereignis
 * es ist und **welche** Aufgabe gemeint ist.
 */
const { prisma } = await import('@swisshub/database');
const { workspace } = await import('@swisshub/modules');
const { createMockGateway, setDiscordGateway } = await import('@swisshub/discord');

const GUILD = '000000000000000077';
const ANNA = '100000000000000071';
const BEN = '100000000000000072';
const KANAL = '700000000000000001';

const ALLES = { discordId: ANNA, darfAlles: true } as const;

/** Ein Zugang, der mitschreibt - und auf Wunsch scheitert. */
function attrappe(scheitern = false) {
  const gesendet: Array<{ channelId: string; payload: Record<string, unknown> }> = [];
  const echt = createMockGateway();
  const gateway = {
    ...echt,
    channels: {
      ...echt.channels,
      send: vi.fn(async (channelId: string, payload: Record<string, unknown>) => {
        if (scheitern) {
          throw new Error('Kanal nicht erreichbar');
        }
        gesendet.push({ channelId, payload });
        return { id: `msg-${gesendet.length}`, channelId };
      }),
    },
  } as unknown as ReturnType<typeof createMockGateway>;
  return { gateway, gesendet };
}

/** Der Autorname des Embeds ist die Ereignisart - daran wird es erkannt. */
function arten(gesendet: Array<{ payload: Record<string, unknown> }>): string[] {
  return gesendet.map((eintrag) => {
    const embeds = eintrag.payload.embeds as Array<{ author?: { name?: string } }> | undefined;
    return embeds?.[0]?.author?.name ?? '';
  });
}

async function projektMit(ereignisse: readonly string[], updates = true): Promise<string> {
  const projekt = await workspace.erstelleProjekt(GUILD, ANNA, {
    titel: 'Turnier Herbst',
    discordChannelId: KANAL,
    discordUpdates: updates,
    discordEvents: ereignisse,
  });
  return projekt.id;
}

describeWithDatabase('Workspace: Ereignisse im Projektkanal', () => {
  beforeAll(async () => {
    await pushSchema();
  });

  beforeEach(async () => {
    // `pushSchema` leert nicht - jede Zeile dieser Datei muss frisch anfangen,
    // sonst erbt der naechste Test die Meldungen des vorigen.
    await prisma.workspaceTaskAssignee.deleteMany({});
    await prisma.workspaceComment.deleteMany({});
    await prisma.workspaceActivity.deleteMany({});
    await prisma.workspaceTask.deleteMany({});
    await prisma.workspaceProjectMember.deleteMany({});
    await prisma.workspaceProject.deleteMany({});
    await prisma.notification.deleteMany({});
    await prisma.auditLog.deleteMany({});
    workspace.vergissMeldungen();
    setDiscordGateway(createMockGateway());
  });

  afterAll(() => {
    setDiscordGateway(createMockGateway());
  });

  it('meldet eine neue Aufgabe, wenn die Art gewählt ist', async () => {
    const { gateway, gesendet } = attrappe();
    setDiscordGateway(gateway);

    const projectId = await projektMit(['task.created']);
    await workspace.erstelleAufgabe(GUILD, ANNA, { titel: 'Server aufsetzen', projectId });

    expect(gesendet).toHaveLength(1);
    expect(gesendet[0]?.channelId).toBe(KANAL);
    expect(arten(gesendet)).toEqual(['Aufgabe erstellt']);
  });

  it('schweigt, wenn die Art nicht gewählt ist', async () => {
    const { gateway, gesendet } = attrappe();
    setDiscordGateway(gateway);

    // Der Kanal ist da, der Schalter ist an - nur diese eine Art fehlt.
    const projectId = await projektMit(['task.done']);
    await workspace.erstelleAufgabe(GUILD, ANNA, { titel: 'Still bleiben', projectId });

    expect(gesendet).toHaveLength(0);
  });

  it('schweigt, wenn der Hauptschalter aus ist - auch bei gewählter Art', async () => {
    const { gateway, gesendet } = attrappe();
    setDiscordGateway(gateway);

    const projectId = await projektMit(['task.created'], false);
    await workspace.erstelleAufgabe(GUILD, ANNA, { titel: 'Auch still', projectId });

    expect(gesendet).toHaveLength(0);
  });

  it('meldet Zuteilung, Arbeitsbeginn und Abschluss als eigene Arten', async () => {
    const { gateway, gesendet } = attrappe();
    setDiscordGateway(gateway);

    const projectId = await projektMit(['task.assigned', 'task.started', 'task.done']);
    const aufgabe = await workspace.erstelleAufgabe(GUILD, ANNA, { titel: 'Grafik bauen', projectId });

    await workspace.setzeZustaendige(aufgabe.id, ANNA, [BEN]);
    await workspace.setzeStatus(aufgabe.id, BEN, 'IN_PROGRESS');
    await workspace.setzeStatus(aufgabe.id, BEN, 'DONE');

    expect(arten(gesendet)).toEqual(['Aufgabe zugeteilt', 'Aufgabe in Arbeit', 'Aufgabe abgeschlossen']);
  });

  it('unterscheidet Frist gesetzt, geändert und entfernt', async () => {
    const { gateway, gesendet } = attrappe();
    setDiscordGateway(gateway);

    const projectId = await projektMit(['due.set', 'due.changed', 'due.cleared']);
    const aufgabe = await workspace.erstelleAufgabe(GUILD, ANNA, { titel: 'Frist', projectId });

    await workspace.setzeFrist(aufgabe.id, ANNA, new Date('2026-11-01T10:00:00Z'));
    await workspace.setzeFrist(aufgabe.id, ANNA, new Date('2026-11-08T10:00:00Z'));
    await workspace.setzeFrist(aufgabe.id, ANNA, null);

    expect(arten(gesendet)).toEqual(['Frist gesetzt', 'Frist geändert', 'Frist entfernt']);
  });

  it('meldet den Abschluss eines Projekts als eigene Art', async () => {
    const { gateway, gesendet } = attrappe();
    setDiscordGateway(gateway);

    const projectId = await projektMit(['project.status', 'project.done']);
    await workspace.aendereProjekt(projectId, ANNA, { status: 'ACTIVE' });
    await workspace.aendereProjekt(projectId, ANNA, { status: 'COMPLETED' });

    expect(arten(gesendet)).toEqual(['Projektstatus geändert', 'Projekt abgeschlossen']);
  });

  it('lässt die Aufgabe bestehen, wenn Discord nicht erreichbar ist', async () => {
    const { gateway, gesendet } = attrappe(true);
    setDiscordGateway(gateway);

    const projectId = await projektMit(['task.created']);
    const aufgabe = await workspace.erstelleAufgabe(GUILD, ANNA, { titel: 'Trotzdem da', projectId });

    expect(gesendet).toHaveLength(0);
    // Das Entscheidende: die Aufgabe existiert, obwohl der Versand warf.
    const gespeichert = await prisma.workspaceTask.findUnique({ where: { id: aufgabe.id } });
    expect(gespeichert?.title).toBe('Trotzdem da');

    // Und der Fehlschlag steht am Projekt, nicht nur im Serverprotokoll.
    const projekt = await prisma.workspaceProject.findUniqueOrThrow({ where: { id: projectId } });
    expect(projekt.discordFehlerAt).not.toBeNull();
    expect(projekt.discordFehlerText).toContain('nicht erreichbar');
  });

  it('räumt den vermerkten Fehler weg, sobald wieder etwas durchgeht', async () => {
    const schlecht = attrappe(true);
    setDiscordGateway(schlecht.gateway);
    const projectId = await projektMit(['task.created']);
    await workspace.erstelleAufgabe(GUILD, ANNA, { titel: 'Erste', projectId });
    expect(
      (await prisma.workspaceProject.findUniqueOrThrow({ where: { id: projectId } })).discordFehlerAt,
    ).not.toBeNull();

    const gut = attrappe();
    setDiscordGateway(gut.gateway);
    workspace.vergissMeldungen();
    await workspace.erstelleAufgabe(GUILD, ANNA, { titel: 'Zweite', projectId });

    const projekt = await prisma.workspaceProject.findUniqueOrThrow({ where: { id: projectId } });
    expect(projekt.discordFehlerAt).toBeNull();
    expect(projekt.discordFehlerText).toBeNull();
  });

  it('schickt bei zwei schnellen gleichen Wechseln nur eine Meldung', async () => {
    const { gateway, gesendet } = attrappe();
    setDiscordGateway(gateway);

    const projectId = await projektMit(['task.started']);
    const aufgabe = await workspace.erstelleAufgabe(GUILD, ANNA, { titel: 'Hin und her', projectId });

    /*
     * Hin, zurueck, wieder hin - innerhalb von Sekunden.
     *
     * Das ist der Mensch, der eine Karte im Board sucht und dabei zweimal
     * danebengreift. Im Kanal soll davon eine Zeile stehen und nicht drei.
     */
    await workspace.setzeStatus(aufgabe.id, ANNA, 'IN_PROGRESS');
    await workspace.setzeStatus(aufgabe.id, ANNA, 'OPEN');
    await workspace.setzeStatus(aufgabe.id, ANNA, 'IN_PROGRESS');

    expect(gesendet).toHaveLength(1);
  });

  it('erwähnt niemanden wirklich - Pings bleiben aus', async () => {
    const { gateway, gesendet } = attrappe();
    setDiscordGateway(gateway);

    const projectId = await projektMit(['task.assigned']);
    const aufgabe = await workspace.erstelleAufgabe(GUILD, ANNA, { titel: 'Zuweisen', projectId });
    await workspace.setzeZustaendige(aufgabe.id, ANNA, [BEN]);

    /*
     * `<@id>` steht im Text - das ist gewollt, es zeigt den Namen. Die
     * Benachrichtigung verhindert `allowedMentions`. Ohne diese Zeile waere
     * jede Zuweisung ein Ping, und bei zehn Aufgaben am Tag schaltet man den
     * Kanal stumm.
     */
    const payload = gesendet[0]?.payload as { allowedMentions?: { parse?: string[] } };
    expect(payload.allowedMentions?.parse).toEqual([]);
  });

  it('wirft unbekannte Ereignisschlüssel beim Speichern weg', async () => {
    const projectId = await projektMit(['task.created', 'gibt.es.nicht']);
    const projekt = await prisma.workspaceProject.findUniqueOrThrow({ where: { id: projectId } });
    expect(projekt.discordEvents).toEqual(['task.created']);
  });

  it('gibt einem neuen Projekt die Vorgabe des Katalogs', async () => {
    const projekt = await workspace.erstelleProjekt(GUILD, ANNA, {
      titel: 'Ohne eigene Wahl',
      discordChannelId: KANAL,
    });
    const gespeichert = await prisma.workspaceProject.findUniqueOrThrow({ where: { id: projekt.id } });
    expect(gespeichert.discordEvents).toEqual(workspace.vorgabeEreignisse());
    expect(gespeichert.discordEvents).toContain('task.created');
    // Kommentare sind ausdruecklich **nicht** in der Vorgabe - sonst ist der
    // Kanal nach einer Woche ein zweiter Kommentarverlauf.
    expect(gespeichert.discordEvents).not.toContain('task.comment');
  });

  it('zeigt eine zugewiesene Aufgabe unter «Meine Aufgaben» - bei allen Beteiligten', async () => {
    const projectId = await projektMit([]);
    const aufgabe = await workspace.erstelleAufgabe(GUILD, ANNA, { titel: 'Gemeinsam', projectId });

    await workspace.setzeZustaendige(aufgabe.id, ANNA, [ANNA, BEN]);

    const meineAnna = await workspace.ladeAufgaben(GUILD, ALLES, { zustaendig: ANNA });
    const meineBen = await workspace.ladeAufgaben(
      GUILD,
      { discordId: BEN, darfAlles: true },
      { zustaendig: BEN },
    );
    expect(meineAnna.map((eintrag) => eintrag.aufgabe.id)).toContain(aufgabe.id);
    expect(meineBen.map((eintrag) => eintrag.aufgabe.id)).toContain(aufgabe.id);

    // Und wieder weg, sobald jemand nicht mehr zuständig ist.
    await workspace.setzeZustaendige(aufgabe.id, ANNA, [BEN]);
    const nachher = await workspace.ladeAufgaben(GUILD, ALLES, { zustaendig: ANNA });
    expect(nachher.map((eintrag) => eintrag.aufgabe.id)).not.toContain(aufgabe.id);
  });
  it('meldet der zuständigen Person in ihrer Glocke - nicht sich selbst', async () => {
    const projectId = await projektMit([]);
    const aufgabe = await workspace.erstelleAufgabe(GUILD, ANNA, { titel: 'Zu zweit', projectId });

    await workspace.setzeZustaendige(aufgabe.id, ANNA, [ANNA, BEN]);

    const meldungen = await prisma.notification.findMany({ where: { kind: 'workspace.zugewiesen' } });
    /*
     * Die bestehende Glocke, kein eigener Postweg: `meldeEreignis` geht durch
     * denselben Dienst wie jede andere Meldung des Systems, und die Regel
     * dafuer steht in der Regelliste der Benachrichtigungen.
     *
     * Und nur an Ben: wer sich selbst zuteilt, weiss es schon. Eine Meldung
     * darueber waere die erste, die man abschaltet - und dann sind die
     * anderen gleich mit weg.
     */
    expect(meldungen.map((eintrag) => eintrag.recipientDiscordId)).toEqual([BEN]);
  });

  it('teilt niemanden zweimal zu', async () => {
    const { gateway, gesendet } = attrappe();
    setDiscordGateway(gateway);

    const projectId = await projektMit(['task.assigned']);
    const aufgabe = await workspace.erstelleAufgabe(GUILD, ANNA, { titel: 'Einmal reicht', projectId });

    await workspace.setzeZustaendige(aufgabe.id, ANNA, [BEN]);
    // Dieselbe Zuteilung noch einmal - sie ist keine Aenderung.
    await workspace.setzeZustaendige(aufgabe.id, ANNA, [BEN]);

    const zeilen = await prisma.workspaceTaskAssignee.findMany({ where: { taskId: aufgabe.id } });
    expect(zeilen).toHaveLength(1);
    // Und kein zweiter Protokolleintrag, keine zweite Glockenmeldung, keine
    // zweite Kanalmeldung: der zweite Aufruf endet, bevor etwas passiert.
    expect(await prisma.auditLog.count({ where: { action: 'WORKSPACE_TASK_ASSIGNED' } })).toBe(1);
    expect(await prisma.notification.count({ where: { kind: 'workspace.zugewiesen' } })).toBe(1);
    expect(arten(gesendet)).toEqual(['Aufgabe zugeteilt']);
  });
});
