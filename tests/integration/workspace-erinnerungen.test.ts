import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';
/*
 * Nur der Typ, statisch importiert.
 *
 * Die Laufzeitwerte kommen unten über `await import` - so verlangt es der
 * Testaufbau, weil die Datenbankumgebung vorher stehen muss. Ein Typ aus einer
 * so geholten Konstante ist aber kein Namensraum: `Partial<workspace.X>` würde
 * `tsc` zu Recht ablehnen, auch wenn der Test läuft.
 */
import type { workspace as WorkspaceTypen } from '@swisshub/modules';

useTestSchema('test_workspace_erinnerungen');

/**
 * Erinnerungen an Fristen - und die Meldungen daraus.
 *
 * ## Was hier tatsächlich geprüft wird
 *
 * Der Reminder ist die Stelle, an der am meisten schiefgehen kann, ohne dass es
 * jemandem auffällt - eine ausgefallene Erinnerung sieht aus wie ein Tag ohne
 * Fristen. Geprüft wird deshalb:
 *
 *   - Die **Vorwarnzeit** trifft den richtigen Tag, auch an den Rändern.
 *   - Ein **zweiter Lauf** schickt nichts nach. Ohne den Merker käme bei einem
 *     Viertelstundentakt eine Meldung je Viertelstunde bis zur Frist.
 *   - Ein **Neustart** hilft nichts: der Merker steht in der Datenbank, nicht
 *     im Prozess. Das ist der Unterschied zu einem `setTimeout`.
 *   - Eine **verschobene Frist** erinnert erneut - weil der Merker dort geleert
 *     wird.
 *   - Der **Modulschalter** und der **Erinnerungsschalter** halten alles an.
 *   - Aus der Erinnerung entsteht eine **Zeile in der Glocke**, und zwar bei
 *     der zuständigen Person.
 */
const { prisma, clearRevisionCaches } = await import('@swisshub/database');
const { automation, workspace, setModuleSettings, setModuleEnabled } = await import('@swisshub/modules');

/** Die Automation Engine - siehe `modulAn`. */
const AUTOMATION_MODULE_ID = automation.AUTOMATION_MODULE_ID;

const GUILD = '000000000000000001';
const ANNA = '100000000000000001';
const BEN = '100000000000000002';

async function leeren(): Promise<void> {
  await prisma.notification.deleteMany({});
  await prisma.workspaceActivity.deleteMany({});
  await prisma.workspaceTaskAssignee.deleteMany({});
  await prisma.workspaceTask.deleteMany({});
  await prisma.workspaceProjectMember.deleteMany({});
  await prisma.workspaceProject.deleteMany({});
  await prisma.auditLog.deleteMany({});
}

/**
 * Das Modul an, Erinnerungen an - der Ausgangszustand jedes Tests.
 *
 * Alle Werte ausdrücklich und nicht über den bestehenden Stand gelegt: das
 * Testschema wird zwischen Läufen wiederverwendet, und `leeren()` fasst die
 * Moduleinstellungen nicht an. Ein `{...bisher}` würde eine Einstellung, die
 * ein früherer Lauf gesetzt hat, in den nächsten tragen - und der Test wäre
 * davon abhängig, wie oft er schon gelaufen ist.
 *
 * Die Automation Engine läuft mit, weil `meldeEreignis` nur dann echte
 * Ereigniskennungen vergibt. Ohne sie greift der Ersatzschlüssel aus Art,
 * Objekt und **Minute** - und zwei Erinnerungen, die in der Wirklichkeit zehn
 * Tage auseinanderliegen, fielen im Test in dieselbe Minute und damit
 * zusammen. Das wäre eine Eigenschaft des Tests, nicht des Reminders.
 */
async function modulAn(werte: Partial<WorkspaceTypen.WorkspaceSettings> = {}): Promise<void> {
  await setModuleEnabled(AUTOMATION_MODULE_ID, true, ANNA);
  await setModuleEnabled(workspace.WORKSPACE_MODULE_ID, true, ANNA);
  await setModuleSettings(
    workspace.WORKSPACE_MODULE_ID,
    { baldFaelligTage: 3, erinnerungenAktiv: true, meldeBlockiert: false, ...werte },
    ANNA,
  );
  clearRevisionCaches();
}

describeWithDatabase('Workspace - Erinnerungen', () => {
  beforeAll(async () => {
    await pushSchema();
  });

  beforeEach(async () => {
    await leeren();
    await modulAn();
  });

  it('erinnert, sobald die Vorwarnzeit erreicht ist', async () => {
    const aufgabe = await workspace.erstelleAufgabe(GUILD, ANNA, {
      titel: 'Grafik abgeben',
      dueAt: new Date('2026-06-10T12:00:00Z'),
      reminder: 'THREE_DAYS',
      zustaendige: [BEN],
    });

    // Vier Tage vorher: noch nicht dran.
    expect(
      (await workspace.verschickeErinnerungen({ jetzt: new Date('2026-06-06T08:00:00Z') })).gemeldet,
    ).toBe(0);
    expect(
      (await prisma.workspaceTask.findUniqueOrThrow({ where: { id: aufgabe.id } })).reminderSentAt,
    ).toBeNull();

    // Drei Tage vorher: dran.
    expect(
      (await workspace.verschickeErinnerungen({ jetzt: new Date('2026-06-07T08:00:00Z') })).gemeldet,
    ).toBe(1);
    expect(
      (await prisma.workspaceTask.findUniqueOrThrow({ where: { id: aufgabe.id } })).reminderSentAt,
    ).toBeInstanceOf(Date);
  });

  it('schickt nichts zweimal - auch nach einem Neustart nicht', async () => {
    await workspace.erstelleAufgabe(GUILD, ANNA, {
      titel: 'Einmal',
      dueAt: new Date('2026-06-10T12:00:00Z'),
      reminder: 'ONE_DAY',
      zustaendige: [BEN],
    });

    const jetzt = new Date('2026-06-09T13:00:00Z');
    expect((await workspace.verschickeErinnerungen({ jetzt })).gemeldet).toBe(1);
    // Zweiter Lauf, dritter Lauf, und einer eine Stunde später: nichts mehr.
    expect((await workspace.verschickeErinnerungen({ jetzt })).gemeldet).toBe(0);
    expect(
      (await workspace.verschickeErinnerungen({ jetzt: new Date('2026-06-09T14:00:00Z') })).gemeldet,
    ).toBe(0);

    /*
     * Der Neustart.
     *
     * Es gibt nichts zurückzusetzen - genau das ist der Punkt. Der Merker steht
     * an der Aufgabe und nicht in einem Timer, und deshalb überlebt er einen
     * Deploy. Ein `setTimeout` hätte die Erinnerung beim Neustart verloren;
     * hier wäre das Gegenteil der Fehler, nämlich sie ein zweites Mal zu
     * schicken.
     */
    expect(
      (await workspace.verschickeErinnerungen({ jetzt: new Date('2026-06-10T08:00:00Z') })).gemeldet,
    ).toBe(0);
    // Gezaehlt werden die Fristmeldungen: die Zuweisung an Ben ist eine eigene
    // Meldung und gehoert nicht in diese Zahl.
    expect(await prisma.notification.count({ where: { kind: 'workspace.frist' } })).toBe(1);
  });

  it('erinnert nach einer verschobenen Frist erneut', async () => {
    const aufgabe = await workspace.erstelleAufgabe(GUILD, ANNA, {
      titel: 'Verschoben',
      dueAt: new Date('2026-06-10T12:00:00Z'),
      reminder: 'ONE_DAY',
      zustaendige: [BEN],
    });
    expect(
      (await workspace.verschickeErinnerungen({ jetzt: new Date('2026-06-09T13:00:00Z') })).gemeldet,
    ).toBe(1);

    // Neue Frist: der Merker wird dort geleert, also erinnert es wieder.
    await workspace.setzeFrist(aufgabe.id, ANNA, new Date('2026-06-20T12:00:00Z'));
    expect(
      (await workspace.verschickeErinnerungen({ jetzt: new Date('2026-06-19T13:00:00Z') })).gemeldet,
    ).toBe(1);
    expect(await prisma.notification.count({ where: { kind: 'workspace.frist' } })).toBe(2);
  });

  it('erinnert jeden Zuständigen einzeln', async () => {
    await workspace.erstelleAufgabe(GUILD, ANNA, {
      titel: 'Zu zweit',
      dueAt: new Date('2026-06-10T12:00:00Z'),
      reminder: 'ON_DUE_DATE',
      zustaendige: [ANNA, BEN],
    });

    const ergebnis = await workspace.verschickeErinnerungen({
      jetzt: new Date('2026-06-10T08:00:00Z'),
    });
    expect(ergebnis.gemeldet).toBe(2);

    // Je Person eine Zeile - und zwar bei beiden. Ohne Akteur im Ereignis,
    // weil niemand es ausgelöst hat: sonst würde die Verteilung die Meldung an
    // den «Täter» unterdrücken.
    // Nach Art gefiltert: die Zuweisung an Ben ist eine eigene Meldung und
    // gehoert nicht in diese Zahl.
    const empfaenger = (
      await prisma.notification.findMany({
        where: { kind: 'workspace.frist' },
        select: { recipientDiscordId: true },
      })
    ).map((zeile) => zeile.recipientDiscordId);
    expect(empfaenger.sort()).toEqual([ANNA, BEN]);
  });

  it('zählt eine Aufgabe ohne Zuständige getrennt und schickt nichts', async () => {
    /*
     * `zustaendige: []` ausdruecklich.
     *
     * Ohne Angabe ist inzwischen die anlegende Person zustaendig - so soll es
     * beim Anlegen im Formular sein. Eine Aufgabe, fuer die wirklich niemand
     * zustaendig ist, muss deshalb die leere Liste mitgeben, und genau diese
     * Aufgabe prueft dieser Test.
     */
    await workspace.erstelleAufgabe(GUILD, ANNA, {
      titel: 'Niemand',
      dueAt: new Date('2026-06-10T12:00:00Z'),
      reminder: 'ON_DUE_DATE',
      zustaendige: [],
    });

    const ergebnis = await workspace.verschickeErinnerungen({
      jetzt: new Date('2026-06-10T08:00:00Z'),
    });
    expect(ergebnis).toEqual({ gemeldet: 0, ohneZustaendige: 1 });
    expect(await prisma.notification.count({ where: { kind: 'workspace.frist' } })).toBe(0);
  });

  it('lässt Aufgaben ohne Erinnerung und erledigte in Ruhe', async () => {
    await workspace.erstelleAufgabe(GUILD, ANNA, {
      titel: 'Ohne Erinnerung',
      dueAt: new Date('2026-06-10T12:00:00Z'),
      zustaendige: [BEN],
    });
    const erledigt = await workspace.erstelleAufgabe(GUILD, ANNA, {
      titel: 'Schon fertig',
      dueAt: new Date('2026-06-10T12:00:00Z'),
      reminder: 'ONE_WEEK',
      zustaendige: [BEN],
    });
    await workspace.setzeStatus(erledigt.id, ANNA, 'DONE');

    const ergebnis = await workspace.verschickeErinnerungen({
      jetzt: new Date('2026-06-10T08:00:00Z'),
    });
    expect(ergebnis).toEqual({ gemeldet: 0, ohneZustaendige: 0 });
  });

  it('lässt Aufgaben archivierter Projekte in Ruhe', async () => {
    const projekt = await workspace.erstelleProjekt(GUILD, ANNA, { titel: 'Vorbei' });
    await workspace.erstelleAufgabe(GUILD, ANNA, {
      titel: 'Im Archiv',
      projectId: projekt.id,
      dueAt: new Date('2026-06-10T12:00:00Z'),
      reminder: 'ON_DUE_DATE',
      zustaendige: [BEN],
    });
    await workspace.archiviere(projekt.id, ANNA);

    const ergebnis = await workspace.verschickeErinnerungen({
      jetzt: new Date('2026-06-10T08:00:00Z'),
    });
    expect(ergebnis.gemeldet).toBe(0);
  });

  it('schweigt, wenn die Erinnerungen abgeschaltet sind', async () => {
    await workspace.erstelleAufgabe(GUILD, ANNA, {
      titel: 'Still',
      dueAt: new Date('2026-06-10T12:00:00Z'),
      reminder: 'ON_DUE_DATE',
      zustaendige: [BEN],
    });

    await modulAn({ erinnerungenAktiv: false });
    expect(
      (await workspace.verschickeErinnerungen({ jetzt: new Date('2026-06-10T08:00:00Z') })).gemeldet,
    ).toBe(0);
    // Und der Merker bleibt leer: nach dem Einschalten soll die Erinnerung
    // noch kommen können, statt stillschweigend verbraucht zu sein.
    const aufgabe = await prisma.workspaceTask.findFirstOrThrow();
    expect(aufgabe.reminderSentAt).toBeNull();

    await modulAn();
    expect(
      (await workspace.verschickeErinnerungen({ jetzt: new Date('2026-06-10T08:00:00Z') })).gemeldet,
    ).toBe(1);
  });

  it('schweigt, wenn das Modul aus ist', async () => {
    await workspace.erstelleAufgabe(GUILD, ANNA, {
      titel: 'Modul aus',
      dueAt: new Date('2026-06-10T12:00:00Z'),
      reminder: 'ON_DUE_DATE',
      zustaendige: [BEN],
    });

    await setModuleEnabled(workspace.WORKSPACE_MODULE_ID, false, ANNA);
    clearRevisionCaches();
    expect(
      (await workspace.verschickeErinnerungen({ jetzt: new Date('2026-06-10T08:00:00Z') })).gemeldet,
    ).toBe(0);
  });

  it('meldet eine Zuweisung an den Zuständigen und nicht an sich selbst', async () => {
    // Anna weist Ben zu: Ben bekommt die Meldung.
    const aufgabe = await workspace.erstelleAufgabe(GUILD, ANNA, {
      titel: 'Für Ben',
      zustaendige: [BEN],
    });
    expect(aufgabe.id).toBeTypeOf('string');

    const meldungen = await prisma.notification.findMany();
    expect(meldungen).toHaveLength(1);
    expect(meldungen[0]?.recipientDiscordId).toBe(BEN);
    expect(meldungen[0]?.kind).toBe('workspace.zugewiesen');
    // Der Deep Link zeigt auf die Aufgabe - auf eine Seite, die derselbe
    // Empfänger auch öffnen darf.
    expect(meldungen[0]?.route).toBe(`/workspace/aufgaben/${aufgabe.id}`);
  });

  it('meldet eine Selbstzuweisung nicht', async () => {
    await workspace.erstelleAufgabe(GUILD, ANNA, { titel: 'Für mich', zustaendige: [ANNA] });
    // Niemand muss erfahren, dass er sich selbst etwas zugewiesen hat.
    expect(await prisma.notification.count()).toBe(0);
  });

  it('meldet eine Erwähnung an die genannte Person', async () => {
    const aufgabe = await workspace.erstelleAufgabe(GUILD, ANNA, { titel: 'Mit Kommentar' });
    await workspace.schreibeKommentar(aufgabe.id, ANNA, `Schau mal, <@${BEN}>`);

    const meldungen = await prisma.notification.findMany({ where: { kind: 'workspace.erwaehnt' } });
    expect(meldungen).toHaveLength(1);
    expect(meldungen[0]?.recipientDiscordId).toBe(BEN);
    expect(meldungen[0]?.body).toContain('Schau mal');
  });

  it('meldet die eigene Erwähnung nicht', async () => {
    const aufgabe = await workspace.erstelleAufgabe(GUILD, ANNA, { titel: 'Selbstgespräch' });
    await workspace.schreibeKommentar(aufgabe.id, ANNA, `Notiz an <@${ANNA}>`);
    expect(await prisma.notification.count()).toBe(0);
  });

  it('meldet «blockiert» nur, wenn die Einstellung es verlangt', async () => {
    const aufgabe = await workspace.erstelleAufgabe(GUILD, ANNA, {
      titel: 'Haengt',
      zustaendige: [BEN],
    });
    await prisma.notification.deleteMany({});

    // Vorgabe aus: kein Wort.
    await workspace.setzeStatus(aufgabe.id, ANNA, 'BLOCKED');
    expect(await prisma.notification.count()).toBe(0);

    await modulAn({ meldeBlockiert: true });

    await workspace.setzeStatus(aufgabe.id, ANNA, 'OPEN');
    await workspace.setzeStatus(aufgabe.id, ANNA, 'BLOCKED');
    const meldungen = await prisma.notification.findMany({ where: { kind: 'workspace.blockiert' } });
    expect(meldungen).toHaveLength(1);
    expect(meldungen[0]?.recipientDiscordId).toBe(BEN);
  });
});
