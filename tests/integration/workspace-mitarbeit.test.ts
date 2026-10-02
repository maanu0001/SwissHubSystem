import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_workspace_mitarbeit');

/**
 * Kommentare, Erwähnungen, Checklisten, Links und Anhänge.
 *
 * ## Was hier tatsächlich geprüft wird
 *
 * Die Stellen, an denen fremde Eingabe auf etwas trifft, das sie nicht
 * entscheiden darf:
 *
 *   - Eine **Erwähnung** wird aus dem Rumpf abgeleitet und nicht mitgeschickt.
 *     Eine mitgeschickte Liste könnte vom Text abweichen - und tut es, sobald
 *     jemand sie von Hand schickt.
 *   - Eine **Adresse** darf nur `http` oder `https` sein. `javascript:` wäre
 *     ausführbarer Code im `href`, `data:` eine Seite im Kleid der eigenen.
 *   - **Positionen** in der Checkliste kommen vom Server, nicht aus dem
 *     Formular: zwei gleichzeitige Einträge hätten sonst dieselbe Zahl.
 *   - Ein **fremder Kommentar** lässt sich nicht löschen.
 */
const { prisma } = await import('@swisshub/database');
const { workspace } = await import('@swisshub/modules');
const { AppError } = await import('@swisshub/shared');

const GUILD = '000000000000000001';
const ANNA = '100000000000000001';
const BEN = '100000000000000002';

async function leeren(): Promise<void> {
  await prisma.workspaceComment.deleteMany({});
  await prisma.workspaceChecklistItem.deleteMany({});
  await prisma.workspaceLink.deleteMany({});
  await prisma.workspaceAttachment.deleteMany({});
  await prisma.workspaceActivity.deleteMany({});
  await prisma.workspaceTaskAssignee.deleteMany({});
  await prisma.workspaceTask.deleteMany({});
  await prisma.workspaceProjectMember.deleteMany({});
  await prisma.workspaceProject.deleteMany({});
}

async function eineAufgabe(): Promise<string> {
  const aufgabe = await workspace.erstelleAufgabe(GUILD, ANNA, { titel: 'Testaufgabe' });
  return aufgabe.id;
}

describeWithDatabase('Workspace - Mitarbeit', () => {
  beforeAll(async () => {
    await pushSchema();
  });

  beforeEach(async () => {
    await leeren();
  });

  it('liest die Erwähnungen aus dem Rumpf', async () => {
    const taskId = await eineAufgabe();
    const kommentar = await workspace.schreibeKommentar(taskId, ANNA, `Kannst du das übernehmen, <@${BEN}>?`);
    expect(kommentar.mentions).toEqual([BEN]);
  });

  it('zählt dieselbe Erwähnung einmal und begrenzt die Zahl', () => {
    expect(workspace.erwaehnungenAus(`<@${BEN}> und nochmal <@${BEN}>`)).toEqual([BEN]);

    // Zwanzig Erwähnungen in einem Kommentar sind eine Durchsage, und zwanzig
    // Meldungen daraus der Grund, warum danach niemand auf die Glocke schaut.
    const viele = Array.from(
      { length: 20 },
      (_, i) => `<@1000000000000000${String(i).padStart(2, '0')}>`,
    ).join(' ');
    expect(workspace.erwaehnungenAus(viele)).toHaveLength(10);
  });

  it('nimmt eine erfundene Erwähnung nicht als solche', () => {
    // Nur Discords eigene Form zählt. «@ben» ist Text, und Text bleibt Text -
    // sonst wäre jede E-Mail-Adresse im Kommentar eine Erwähnung.
    expect(workspace.erwaehnungenAus('@ben schau mal, ben@example.com')).toEqual([]);
    expect(workspace.erwaehnungenAus('<@42>')).toEqual([]);
  });

  it('lehnt einen leeren Kommentar ab', async () => {
    const taskId = await eineAufgabe();
    await expect(workspace.schreibeKommentar(taskId, ANNA, '   ')).rejects.toThrow(/leer/u);
  });

  it('hält einen Kommentar im Verlauf fest', async () => {
    const taskId = await eineAufgabe();
    await workspace.schreibeKommentar(taskId, ANNA, 'Erledigt bis Freitag.');
    const verlauf = await workspace.ladeVerlauf({ taskId });
    expect(verlauf.map((eintrag) => eintrag.art)).toContain('task.comment');
  });

  it('lässt fremde Kommentare in Ruhe', async () => {
    const taskId = await eineAufgabe();
    const kommentar = await workspace.schreibeKommentar(taskId, ANNA, 'Meine Begründung.');

    const fehler = await workspace.loescheKommentar(kommentar.id, BEN).then(
      () => null,
      (grund: unknown) => grund,
    );
    expect(fehler).toBeInstanceOf(AppError);
    expect((fehler as InstanceType<typeof AppError>).code).toBe('FORBIDDEN');
    expect(await prisma.workspaceComment.count()).toBe(1);

    // Den eigenen schon.
    await workspace.loescheKommentar(kommentar.id, ANNA);
    expect(await prisma.workspaceComment.count()).toBe(0);
  });

  it('vergibt die Positionen der Checkliste selbst', async () => {
    const taskId = await eineAufgabe();
    await workspace.ergaenzeChecklistenpunkt(taskId, ANNA, 'Erstens');
    await workspace.ergaenzeChecklistenpunkt(taskId, ANNA, 'Zweitens');
    await workspace.ergaenzeChecklistenpunkt(taskId, ANNA, 'Drittens');

    const punkte = await workspace.ladeCheckliste(taskId);
    expect(punkte.map((punkt) => punkt.text)).toEqual(['Erstens', 'Zweitens', 'Drittens']);
    expect(punkte.map((punkt) => punkt.position)).toEqual([0, 1, 2]);
  });

  it('hakt ab und öffnet wieder', async () => {
    const taskId = await eineAufgabe();
    const punkt = await workspace.ergaenzeChecklistenpunkt(taskId, ANNA, 'Schritt');
    expect((await workspace.hakeAb(punkt.id, true)).erledigt).toBe(true);
    expect((await workspace.hakeAb(punkt.id, false)).erledigt).toBe(false);
  });

  it('zählt die Checkliste in die Aufgabenansicht', async () => {
    const taskId = await eineAufgabe();
    const eins = await workspace.ergaenzeChecklistenpunkt(taskId, ANNA, 'A');
    await workspace.ergaenzeChecklistenpunkt(taskId, ANNA, 'B');
    await workspace.hakeAb(eins.id, true);

    const ansicht = await workspace.ladeAufgabe(taskId);
    expect(ansicht?.checklisteGesamt).toBe(2);
    expect(ansicht?.checklisteOffen).toBe(1);
  });

  it('lässt nur http und https als Adresse durch', () => {
    expect(workspace.pruefeUrl('https://example.com/pfad')).toBe('https://example.com/pfad');
    expect(workspace.pruefeUrl('  http://example.com  ')).toBe('http://example.com/');

    for (const boese of [
      'javascript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
      'file:///etc/passwd',
      'vbscript:msgbox(1)',
      'kein-schema-ueberhaupt',
      '',
    ]) {
      expect(() => workspace.pruefeUrl(boese), boese).toThrow();
    }
  });

  it('lehnt Zugangsdaten in der Adresse ab', () => {
    // Gültiges URL-Format - und trotzdem nichts, was in einer geteilten Liste
    // stehen soll: das Passwort wäre danach für jeden im Team lesbar.
    expect(() => workspace.pruefeUrl('https://nutzer:geheim@example.com')).toThrow(/Zugangsdaten/u);
  });

  it('speichert die normalisierte Adresse und nicht die Eingabe', async () => {
    const taskId = await eineAufgabe();
    const link = await workspace.ergaenzeLink({ taskId }, ANNA, 'Doku', 'HTTPS://Example.COM/a');
    // Was der Parser gelesen hat, nicht was getippt wurde - sonst könnte in der
    // Datenbank etwas stehen, das der Browser anders liest.
    expect(link.url).toBe('https://example.com/a');
  });

  it('nimmt die Adresse als Beschriftung, wenn keine angegeben ist', async () => {
    const taskId = await eineAufgabe();
    const link = await workspace.ergaenzeLink({ taskId }, ANNA, '   ', 'https://example.com/x');
    expect(link.title).toBe('https://example.com/x');
  });

  it('hängt einen Link an ein Projekt', async () => {
    const projekt = await workspace.erstelleProjekt(GUILD, ANNA, { titel: 'Mit Links' });
    await workspace.ergaenzeLink({ projectId: projekt.id }, ANNA, 'Design', 'https://example.com/d');

    expect(await workspace.ladeLinks({ projectId: projekt.id })).toHaveLength(1);
    // Und nicht an einer beliebigen Aufgabe.
    const taskId = await eineAufgabe();
    expect(await workspace.ladeLinks({ taskId })).toHaveLength(0);
  });

  it('nimmt keinen Link an eine Aufgabe, die es nicht gibt', async () => {
    await expect(
      workspace.ergaenzeLink({ taskId: 'gibtsnicht' }, ANNA, 'X', 'https://example.com'),
    ).rejects.toThrow(/gibt es nicht/u);
  });

  it('weist eine Datei ab, die kein Bild ist', async () => {
    const taskId = await eineAufgabe();
    /*
     * Der Inhalt entscheidet, nicht der gemeldete Typ.
     *
     * Eine als PNG deklarierte HTML-Datei fällt an den Magic Bytes durch -
     * genau dort, wo sie durchfallen muss, nämlich vor dem Schreiben.
     */
    const html = new TextEncoder().encode('<html><script>alert(1)</script></html>');
    await expect(
      workspace.ergaenzeAnhang({ taskId }, ANNA, {
        bytes: html,
        mimeTyp: 'image/png',
        name: 'bild.png',
      }),
    ).rejects.toThrow(/PNG, JPG und WEBP/u);
    expect(await prisma.workspaceAttachment.count()).toBe(0);
  });

  it('nennt die zentrale Obergrenze und nicht eine eigene', async () => {
    const { branding } = await import('@swisshub/modules');
    // Keine eigene Zahl: eine zweite Obergrenze wäre die, die beim naechsten
    // Mal nicht mitgeaendert wird.
    expect(workspace.ANHANG_MAX_BYTES).toBe(branding.MAX_UPLOAD_BYTES);
  });
});
