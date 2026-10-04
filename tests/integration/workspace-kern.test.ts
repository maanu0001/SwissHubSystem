import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_workspace_kern');

/**
 * Der Kern des Workspace: Projekte und Aufgaben.
 *
 * ## Was hier tatsächlich geprüft wird
 *
 * Nicht «lässt sich ein Projekt anlegen» - das wäre ein Test der Datenbank.
 * Sondern die Entscheidungen, die der Dienst trifft und die eine Oberfläche
 * nicht nachholen kann:
 *
 *   - Ein **Statuswechsel mit veralteter Erwartung** scheitert. Das ist der
 *     Fall «zwei Leute, ein Board», und er ist der Grund, warum ein Zug seinen
 *     Ausgangsstatus mitbringt.
 *   - Ein **archiviertes Projekt** verschwindet aus den Standardansichten,
 *     bleibt aber samt Aufgaben vorhanden. Löschen gibt es nicht.
 *   - Der **Fortschritt** rechnet abgebrochene Aufgaben nicht mit. Sonst
 *     stiege er, indem man Arbeit wegwirft.
 *   - Eine **fremde Projektkennung** kommt nicht durch. Die Kennung stammt aus
 *     einem Formular, also aus fremder Hand.
 *   - Eine **verschobene Frist** leert den Erinnerungsmerker. Ohne das kommt
 *     zur neuen Frist keine Meldung, und niemand merkt es.
 *
 * ## Warum gegen eine echte Datenbank
 *
 * Weil die Nebenläufigkeitsprüfung in der `WHERE`-Bedingung eines `UPDATE`
 * steckt. Eine Attrappe würde den `if`-Zweig prüfen, den es hier gerade nicht
 * gibt - und damit genau das nicht, worauf es ankommt.
 */
const { prisma } = await import('@swisshub/database');
const { workspace } = await import('@swisshub/modules');
const { AppError } = await import('@swisshub/shared');

const GUILD = '000000000000000001';
const ANNA = '100000000000000001';
const BEN = '100000000000000002';

/*
 * Ein Betrachter, der alles sehen darf.
 *
 * Diese Datei prueft nicht die Sichtbarkeit - das tut
 * `workspace-sichtbarkeit.test.ts`. Hier soll die Sichtbarkeit nichts
 * veraendern, und `darfAlles` ist die klarste Art, das zu sagen: ohne sie
 * haengt jede Zeile dieser Datei zusaetzlich an den Discord-Rollen einer
 * Attrappe.
 */
const ALLES = { discordId: ANNA, darfAlles: true } as const;

async function leeren(): Promise<void> {
  await prisma.workspaceActivity.deleteMany({});
  await prisma.workspaceTaskAssignee.deleteMany({});
  await prisma.workspaceTask.deleteMany({});
  await prisma.workspaceProjectMember.deleteMany({});
  await prisma.workspaceProject.deleteMany({});
  await prisma.auditLog.deleteMany({});
}

describeWithDatabase('Workspace - Projekte und Aufgaben', () => {
  beforeAll(async () => {
    await pushSchema();
  });

  beforeEach(async () => {
    await leeren();
  });

  it('macht den Anleger zur Projektleitung', async () => {
    const projekt = await workspace.erstelleProjekt(GUILD, ANNA, { titel: 'Winter Cup' });

    const mitglieder = await prisma.workspaceProjectMember.findMany({
      where: { projectId: projekt.id },
    });
    expect(mitglieder).toHaveLength(1);
    expect(mitglieder[0]?.discordId).toBe(ANNA);
    expect(mitglieder[0]?.rolle).toBe('LEAD');

    // Ohne diese Zeile dürfte das Projekt niemand bearbeiten ausser den
    // Trägern der globalen Berechtigung - auch der nicht, der es angelegt hat.
    expect(await workspace.darfBearbeiten(projekt.id, ANNA, false)).toBe(true);
    expect(await workspace.darfBearbeiten(projekt.id, BEN, false)).toBe(false);
    expect(await workspace.darfBearbeiten(projekt.id, BEN, true)).toBe(true);
  });

  it('lehnt ein Zieldatum vor dem Start ab', async () => {
    await expect(
      workspace.erstelleProjekt(GUILD, ANNA, {
        titel: 'Rückwärts',
        startAt: new Date('2026-06-01T00:00:00Z'),
        dueAt: new Date('2026-05-01T00:00:00Z'),
      }),
    ).rejects.toThrow(/Zieldatum liegt vor dem Start/u);
  });

  it('wandelt einen Farbwert um statt ihn durchzureichen', async () => {
    const projekt = await workspace.erstelleProjekt(GUILD, ANNA, {
      titel: 'Farbe',
      akzent: 'red; background-image: url(https://fremd.example/x.png)',
    });
    // Nicht bereinigt, sondern umgewandelt: was keine Farbe ist, wird `null`.
    expect(projekt.accent).toBeNull();

    const zweites = await workspace.erstelleProjekt(GUILD, ANNA, { titel: 'Kurz', akzent: '#F0A' });
    expect(zweites.accent).toBe('#ff00aa');
  });

  it('verlangt mindestens eine Projektleitung', async () => {
    const projekt = await workspace.erstelleProjekt(GUILD, ANNA, { titel: 'Ohne Leitung' });

    await expect(
      workspace.setzeMitglieder(projekt.id, ANNA, [{ discordId: BEN, rolle: 'MEMBER' }]),
    ).rejects.toThrow(/mindestens eine Projektleitung/u);

    await workspace.setzeMitglieder(projekt.id, ANNA, [
      { discordId: BEN, rolle: 'LEAD' },
      { discordId: ANNA, rolle: 'MEMBER' },
    ]);
    expect(await workspace.darfBearbeiten(projekt.id, BEN, false)).toBe(true);
    expect(await workspace.darfBearbeiten(projekt.id, ANNA, false)).toBe(false);
  });

  it('nimmt eine fremde Projektkennung nicht an', async () => {
    const fremdes = await workspace.erstelleProjekt('000000000000000999', ANNA, { titel: 'Fremd' });

    await expect(
      workspace.erstelleAufgabe(GUILD, ANNA, { titel: 'Eingeschmuggelt', projectId: fremdes.id }),
    ).rejects.toThrow(/gibt es nicht/u);
  });

  it('hängt keine Aufgabe in ein archiviertes Projekt', async () => {
    const projekt = await workspace.erstelleProjekt(GUILD, ANNA, { titel: 'Vorbei' });
    await workspace.archiviere(projekt.id, ANNA);

    await expect(
      workspace.erstelleAufgabe(GUILD, ANNA, { titel: 'Nachzügler', projectId: projekt.id }),
    ).rejects.toThrow(/archiviert/u);
  });

  it('weist einen Statuswechsel mit veralteter Erwartung ab', async () => {
    const aufgabe = await workspace.erstelleAufgabe(GUILD, ANNA, { titel: 'Karte' });

    // Anna zieht die Karte nach «In Arbeit».
    await workspace.setzeStatus(aufgabe.id, ANNA, 'IN_PROGRESS', { erwarteterStatus: 'OPEN' });

    // Ben hatte sie noch auf «Offen» gesehen und zieht sie nach «Erledigt».
    // Sein Zug ist kein Verschieben mehr, sondern ein Zurückdrehen.
    //
    // Geprüft wird die Meldung, die im Browser ankommt - nicht die interne:
    // `Error.message` trägt bei einem `AppError` den Text fürs Log, und ein
    // Test darauf hätte offen gelassen, ob der Nutzer überhaupt erfährt, was
    // mit seinem Zug passiert ist.
    const konflikt = await workspace.setzeStatus(aufgabe.id, BEN, 'DONE', { erwarteterStatus: 'OPEN' }).then(
      () => null,
      (fehler: unknown) => fehler,
    );
    expect(konflikt).toBeInstanceOf(AppError);
    expect((konflikt as InstanceType<typeof AppError>).code).toBe('CONFLICT');
    expect((konflikt as InstanceType<typeof AppError>).userMessage).toMatch(/zwischenzeitlich/u);

    const nachher = await prisma.workspaceTask.findUniqueOrThrow({ where: { id: aufgabe.id } });
    expect(nachher.status).toBe('IN_PROGRESS');
  });

  it('lässt einen Statuswechsel ohne Erwartung durch', async () => {
    const aufgabe = await workspace.erstelleAufgabe(GUILD, ANNA, { titel: 'Aus dem Formular' });
    await workspace.setzeStatus(aufgabe.id, ANNA, 'IN_PROGRESS');
    const nachher = await workspace.setzeStatus(aufgabe.id, ANNA, 'DONE');
    expect(nachher.status).toBe('DONE');
  });

  it('führt doneAt mit dem Status', async () => {
    const aufgabe = await workspace.erstelleAufgabe(GUILD, ANNA, { titel: 'Hin und zurück' });
    expect(aufgabe.doneAt).toBeNull();

    const erledigt = await workspace.setzeStatus(aufgabe.id, ANNA, 'DONE');
    expect(erledigt.doneAt).toBeInstanceOf(Date);

    // Wieder geöffnet: das alte Datum muss weg, sonst stünde die Aufgabe in
    // jeder Auswertung als an diesem Tag erledigt.
    const offen = await workspace.setzeStatus(aufgabe.id, ANNA, 'OPEN');
    expect(offen.doneAt).toBeNull();
  });

  it('rechnet abgebrochene Aufgaben nicht in den Fortschritt', async () => {
    const projekt = await workspace.erstelleProjekt(GUILD, ANNA, { titel: 'Fortschritt' });
    const eine = await workspace.erstelleAufgabe(GUILD, ANNA, {
      titel: 'Fertig',
      projectId: projekt.id,
    });
    const zwei = await workspace.erstelleAufgabe(GUILD, ANNA, {
      titel: 'Weg',
      projectId: projekt.id,
    });
    await workspace.setzeStatus(eine.id, ANNA, 'DONE');
    await workspace.setzeStatus(zwei.id, ANNA, 'CANCELLED');

    const ansicht = await workspace.ladeProjekt(projekt.id, ALLES);
    // Eine zählende Aufgabe, und die ist fertig - nicht zwei von zwei und
    // nicht eine von zwei.
    expect(ansicht?.fortschritt).toEqual({ gesamt: 1, erledigt: 1, prozent: 100 });
  });

  it('rechnet den Fortschritt der Liste in einer Abfrage', async () => {
    const eins = await workspace.erstelleProjekt(GUILD, ANNA, { titel: 'Eins' });
    const zwei = await workspace.erstelleProjekt(GUILD, ANNA, { titel: 'Zwei' });
    const a = await workspace.erstelleAufgabe(GUILD, ANNA, { titel: 'A', projectId: eins.id });
    await workspace.erstelleAufgabe(GUILD, ANNA, { titel: 'B', projectId: eins.id });
    await workspace.erstelleAufgabe(GUILD, ANNA, { titel: 'C', projectId: zwei.id });
    await workspace.setzeStatus(a.id, ANNA, 'DONE');

    const liste = await workspace.ladeProjekte(GUILD, ALLES);
    const nachTitel = new Map(liste.map((zeile) => [zeile.projekt.title, zeile]));
    expect(nachTitel.get('Eins')?.fortschritt.prozent).toBe(50);
    expect(nachTitel.get('Eins')?.offeneAufgaben).toBe(1);
    expect(nachTitel.get('Zwei')?.fortschritt.prozent).toBe(0);
    expect(nachTitel.get('Zwei')?.offeneAufgaben).toBe(1);
  });

  it('archiviert statt zu löschen und holt zurück', async () => {
    const projekt = await workspace.erstelleProjekt(GUILD, ANNA, { titel: 'Sommer Cup' });
    await workspace.erstelleAufgabe(GUILD, ANNA, { titel: 'Anhang', projectId: projekt.id });

    await workspace.archiviere(projekt.id, ANNA);

    // Aus den Standardansichten verschwunden …
    expect(await workspace.ladeProjekte(GUILD, ALLES)).toHaveLength(0);
    // … aber im Archiv, und Status und Merker laufen nicht auseinander.
    const archiv = await workspace.ladeProjekte(GUILD, ALLES, { archiviert: true });
    expect(archiv).toHaveLength(1);
    expect(archiv[0]?.projekt.status).toBe('ARCHIVED');
    expect(archiv[0]?.projekt.archivedByDiscordId).toBe(ANNA);
    // Die Aufgaben sind noch da - nur nicht mehr in der Standardliste.
    expect(await prisma.workspaceTask.count({ where: { projectId: projekt.id } })).toBe(1);
    expect(await workspace.ladeAufgaben(GUILD, ALLES)).toHaveLength(0);
    expect(await workspace.ladeAufgaben(GUILD, ALLES, { mitArchivierten: true })).toHaveLength(1);

    // Zweimal archivieren ändert nichts und wirft nicht.
    const nochmal = await workspace.archiviere(projekt.id, ANNA);
    expect(nochmal.archivedAt).toEqual(archiv[0]?.projekt.archivedAt);

    const zurueck = await workspace.holeZurueck(projekt.id, ANNA);
    expect(zurueck.archivedAt).toBeNull();
    expect(zurueck.status).toBe('ACTIVE');
    expect(await workspace.ladeAufgaben(GUILD, ALLES)).toHaveLength(1);
  });

  it('lässt eine Aufgabe ohne Projekt in der Standardansicht stehen', async () => {
    // Sie ist nicht archiviert - sie hat nur kein Projekt. Ohne die
    // Sonderbehandlung fiele sie aus jeder Liste.
    await workspace.erstelleAufgabe(GUILD, ANNA, { titel: 'Freischwebend' });
    const liste = await workspace.ladeAufgaben(GUILD, ALLES);
    expect(liste.map((zeile) => zeile.aufgabe.title)).toEqual(['Freischwebend']);
  });

  it('leert den Erinnerungsmerker, wenn die Frist sich verschiebt', async () => {
    const aufgabe = await workspace.erstelleAufgabe(GUILD, ANNA, {
      titel: 'Mit Frist',
      dueAt: new Date('2026-07-01T10:00:00Z'),
      reminder: 'ONE_DAY',
    });
    await prisma.workspaceTask.update({
      where: { id: aufgabe.id },
      data: { reminderSentAt: new Date('2026-06-30T08:00:00Z') },
    });

    const verschoben = await workspace.setzeFrist(aufgabe.id, ANNA, new Date('2026-08-01T10:00:00Z'));
    // Bliebe der Merker stehen, käme zur neuen Frist keine Erinnerung.
    expect(verschoben.reminderSentAt).toBeNull();

    // Auch über den allgemeinen Änderungsweg.
    await prisma.workspaceTask.update({
      where: { id: aufgabe.id },
      data: { reminderSentAt: new Date('2026-07-31T08:00:00Z') },
    });
    const erneut = await workspace.aendereAufgabe(aufgabe.id, ANNA, {
      dueAt: new Date('2026-09-01T10:00:00Z'),
    });
    expect(erneut.reminderSentAt).toBeNull();
  });

  it('lässt den Erinnerungsmerker stehen, wenn die Frist gleich bleibt', async () => {
    const frist = new Date('2026-07-01T10:00:00Z');
    const aufgabe = await workspace.erstelleAufgabe(GUILD, ANNA, { titel: 'Gleich', dueAt: frist });
    const gesendet = new Date('2026-06-30T08:00:00Z');
    await prisma.workspaceTask.update({
      where: { id: aufgabe.id },
      data: { reminderSentAt: gesendet },
    });

    // Nur der Titel ändert sich. Würde der Merker hier mitgeleert, käme zur
    // selben Frist eine zweite Erinnerung.
    const nachher = await workspace.aendereAufgabe(aufgabe.id, ANNA, { titel: 'Umbenannt' });
    expect(nachher.reminderSentAt).toEqual(gesendet);
  });

  it('ändert nur die mitgegebenen Felder', async () => {
    const aufgabe = await workspace.erstelleAufgabe(GUILD, ANNA, {
      titel: 'Vollständig',
      beschreibung: 'Ein Text',
      prioritaet: 'HIGH',
      tags: ['Turnier'],
    });

    const nachher = await workspace.aendereAufgabe(aufgabe.id, ANNA, { titel: 'Neuer Titel' });
    expect(nachher.title).toBe('Neuer Titel');
    // `undefined` heisst unverändert - sonst löschte jedes Teilformular, was
    // es nicht anzeigt.
    expect(nachher.description).toBe('Ein Text');
    expect(nachher.priority).toBe('HIGH');
    expect(nachher.tags).toEqual(['turnier']);

    // `null` heisst leeren.
    const geleert = await workspace.aendereAufgabe(aufgabe.id, ANNA, { beschreibung: null });
    expect(geleert.description).toBeNull();
  });

  it('normalisiert Tags und wirft Doppel weg', async () => {
    const aufgabe = await workspace.erstelleAufgabe(GUILD, ANNA, {
      titel: 'Tags',
      tags: ['Turnier', 'turnier', '  CS2  ', ''],
    });
    expect(aufgabe.tags).toEqual(['turnier', 'cs2']);
  });

  it('nimmt nur echte Discord-Kennungen als Zuständige', async () => {
    const aufgabe = await workspace.erstelleAufgabe(GUILD, ANNA, {
      titel: 'Zuständig',
      zustaendige: [ANNA, 'kein-snowflake', '42', ANNA],
    });
    const zustaendige = await prisma.workspaceTaskAssignee.findMany({
      where: { taskId: aufgabe.id },
    });
    expect(zustaendige.map((eintrag) => eintrag.discordId)).toEqual([ANNA]);
  });

  it('ersetzt die Zuständigen und hält den Verlauf fest', async () => {
    const aufgabe = await workspace.erstelleAufgabe(GUILD, ANNA, { titel: 'Umhängen' });
    await workspace.setzeZustaendige(aufgabe.id, ANNA, [BEN]);
    await workspace.setzeZustaendige(aufgabe.id, ANNA, [ANNA]);

    const zustaendige = await prisma.workspaceTaskAssignee.findMany({
      where: { taskId: aufgabe.id },
    });
    expect(zustaendige.map((eintrag) => eintrag.discordId)).toEqual([ANNA]);

    const verlauf = await workspace.ladeVerlauf({ taskId: aufgabe.id }, ALLES);
    expect(verlauf.filter((eintrag) => eintrag.art === 'task.assignee')).toHaveLength(2);
  });

  it('sortiert nach Frist, dann nach Priorität', async () => {
    const bald = await workspace.erstelleAufgabe(GUILD, ANNA, {
      titel: 'Morgen',
      dueAt: new Date('2026-07-02T10:00:00Z'),
      prioritaet: 'LOW',
    });
    const spaeter = await workspace.erstelleAufgabe(GUILD, ANNA, {
      titel: 'Nächste Woche',
      dueAt: new Date('2026-07-09T10:00:00Z'),
      prioritaet: 'URGENT',
    });
    const ohne = await workspace.erstelleAufgabe(GUILD, ANNA, {
      titel: 'Irgendwann',
      prioritaet: 'URGENT',
    });

    const liste = await workspace.ladeAufgaben(GUILD, ALLES);
    // Ein Termin morgen geht einer wichtigen Aufgabe ohne Datum vor, und was
    // keine Frist hat, steht hinten statt die Liste zu füllen.
    expect(liste.map((zeile) => zeile.aufgabe.id)).toEqual([bald.id, spaeter.id, ohne.id]);
  });

  it('filtert nach Zuständigkeit und nach «niemand zuständig»', async () => {
    const meine = await workspace.erstelleAufgabe(GUILD, ANNA, {
      titel: 'Meine',
      zustaendige: [ANNA],
    });
    const fremde = await workspace.erstelleAufgabe(GUILD, ANNA, {
      titel: 'Bens',
      zustaendige: [BEN],
    });
    /*
     * Ausdruecklich niemand - und zwar mit leerer Liste.
     *
     * Ohne Angabe ist seit der Umstellung die anlegende Person zustaendig:
     * `undefined` heisst «nicht gesagt» und ergibt die Vorgabe, `[]` heisst
     * «niemand» und bleibt so. Dieser Fall prueft die zweite Haelfte davon;
     * die erste steht im Fall darunter.
     */
    const offen = await workspace.erstelleAufgabe(GUILD, ANNA, { titel: 'Niemand', zustaendige: [] });

    expect(
      (await workspace.ladeAufgaben(GUILD, ALLES, { zustaendig: ANNA })).map((z) => z.aufgabe.id),
    ).toEqual([meine.id]);
    expect(
      (await workspace.ladeAufgaben(GUILD, ALLES, { ohneZustaendige: true })).map((z) => z.aufgabe.id),
    ).toEqual([offen.id]);
    expect(await workspace.ladeAufgaben(GUILD, ALLES, { zustaendig: BEN })).toHaveLength(1);
    expect((await workspace.ladeAufgaben(GUILD, ALLES, { zustaendig: BEN }))[0]?.aufgabe.id).toBe(fremde.id);
  });

  it('macht ohne Angabe die anlegende Person zuständig', async () => {
    const aufgabe = await workspace.erstelleAufgabe(GUILD, ANNA, { titel: 'Notiert' });

    /*
     * Die haeufigste Aufgabe ist «ich mache das». Eine Aufgabe, die man sich
     * notiert und danach unter «Meine Aufgaben» nicht findet, legt man zweimal
     * an - und darum ist die Vorgabe die anlegende Person.
     */
    const zeilen = await workspace.ladeAufgaben(GUILD, ALLES, { zustaendig: ANNA });
    expect(zeilen.map((zeile) => zeile.aufgabe.id)).toContain(aufgabe.id);
    expect(zeilen.find((zeile) => zeile.aufgabe.id === aufgabe.id)?.zustaendige).toEqual([ANNA]);

    // Und sie laesst sich abwaehlen - die Vorgabe ist keine Fessel.
    await workspace.setzeZustaendige(aufgabe.id, ANNA, []);
    expect(
      (await workspace.ladeAufgaben(GUILD, ALLES, { ohneZustaendige: true })).map((z) => z.aufgabe.id),
    ).toContain(aufgabe.id);
  });

  it('schreibt den Verlauf, aber nicht jeden Zug ins Audit Log', async () => {
    const aufgabe = await workspace.erstelleAufgabe(GUILD, ANNA, { titel: 'Verlauf' });
    await workspace.setzeStatus(aufgabe.id, ANNA, 'IN_PROGRESS');
    await workspace.setzeStatus(aufgabe.id, ANNA, 'DONE');
    await workspace.setzePrioritaet(aufgabe.id, ANNA, 'HIGH');

    const verlauf = await workspace.ladeVerlauf({ taskId: aufgabe.id }, ALLES);
    expect(verlauf.map((eintrag) => eintrag.art)).toEqual([
      'task.priority',
      'task.done',
      'task.status',
      'task.created',
    ]);

    // Im Audit Log steht das Anlegen - nicht jeder Statuswechsel. Ein Board
    // mit fünfzig Zügen am Tag machte das Audit Log unlesbar.
    const audit = await prisma.auditLog.findMany({ orderBy: { sequence: 'asc' } });
    expect(audit.map((zeile) => zeile.action)).toEqual(['WORKSPACE_TASK_CREATED']);
  });

  it('löscht eine Aufgabe und hält das im Audit Log fest', async () => {
    const aufgabe = await workspace.erstelleAufgabe(GUILD, ANNA, { titel: 'Tippfehler' });
    await workspace.loescheAufgabe(aufgabe.id, ANNA);

    expect(await prisma.workspaceTask.findUnique({ where: { id: aufgabe.id } })).toBeNull();
    const audit = await prisma.auditLog.findMany({ orderBy: { sequence: 'asc' } });
    expect(audit.map((zeile) => zeile.action)).toContain('WORKSPACE_TASK_DELETED');
  });

  it('findet ein Projekt über Titel und Tag', async () => {
    await workspace.erstelleProjekt(GUILD, ANNA, {
      titel: 'Winter Cup 2026',
      tags: ['Turnier'],
    });
    await workspace.erstelleProjekt(GUILD, ANNA, { titel: 'Sponsoring Acme' });

    expect(await workspace.ladeProjekte(GUILD, ALLES, { suche: 'winter' })).toHaveLength(1);
    expect(await workspace.ladeProjekte(GUILD, ALLES, { suche: 'Turnier' })).toHaveLength(1);
    expect(await workspace.ladeProjekte(GUILD, ALLES, { suche: 'nichts' })).toHaveLength(0);
  });

  it('verlangt einen Titel', async () => {
    await expect(workspace.erstelleProjekt(GUILD, ANNA, { titel: '   ' })).rejects.toThrow(
      /braucht einen Titel/u,
    );
    await expect(workspace.erstelleAufgabe(GUILD, ANNA, { titel: '' })).rejects.toThrow(
      /braucht einen Titel/u,
    );
  });
});
