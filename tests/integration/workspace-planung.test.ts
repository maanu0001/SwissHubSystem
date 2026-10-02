import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_workspace_planung');

/**
 * Planung, Meilensteine und Vorlagen.
 *
 * ## Was hier tatsächlich geprüft wird
 *
 *   - Die **relative Frist** rechnet vom Zieldatum und nicht vom Anlegen. Das
 *     ist der ganze Sinn einer Vorlage: ein Turnier in drei Monaten hätte sonst
 *     alle Fristen in der nächsten Woche.
 *   - Der **Zeitraum** ist links geschlossen und rechts offen. Sonst stünde ein
 *     Termin um Mitternacht in zwei Monaten.
 *   - Die **Standardvorlagen** legen sich nur einmal an - ein Team, das
 *     «Turnier» umgebaut hat, bekommt seine Fassung nicht überschrieben.
 *   - Aus einer Vorlage entsteht ein **gewöhnliches** Projekt: die Aufgaben
 *     sind Kopien, und wer darin streicht, ändert die Vorlage nicht.
 */
const { prisma } = await import('@swisshub/database');
const { workspace } = await import('@swisshub/modules');

const GUILD = '000000000000000001';
const ANNA = '100000000000000001';

async function leeren(): Promise<void> {
  await prisma.workspaceActivity.deleteMany({});
  await prisma.workspaceMilestone.deleteMany({});
  await prisma.workspaceTemplateTask.deleteMany({});
  await prisma.workspaceTemplate.deleteMany({});
  await prisma.workspaceTaskAssignee.deleteMany({});
  await prisma.workspaceTask.deleteMany({});
  await prisma.workspaceProjectMember.deleteMany({});
  await prisma.workspaceProject.deleteMany({});
  await prisma.auditLog.deleteMany({});
}

describeWithDatabase('Workspace - Planung und Vorlagen', () => {
  beforeAll(async () => {
    await pushSchema();
  });

  beforeEach(async () => {
    await leeren();
  });

  it('rechnet relative Fristen vom Zieldatum', () => {
    const ziel = new Date('2026-08-15T00:00:00Z');
    // Negativ heisst «davor» - bei einem Turnier ist fast alles davor.
    expect(workspace.fristAus(ziel, -14)?.toISOString()).toBe('2026-08-01T12:00:00.000Z');
    expect(workspace.fristAus(ziel, 0)?.toISOString()).toBe('2026-08-15T12:00:00.000Z');
    expect(workspace.fristAus(ziel, 7)?.toISOString()).toBe('2026-08-22T12:00:00.000Z');
    // Ohne Zieldatum oder ohne Angabe: keine Frist, nicht heute.
    expect(workspace.fristAus(null, -14)).toBeNull();
    expect(workspace.fristAus(ziel, null)).toBeNull();
  });

  it('rechnet über eine Monatsgrenze hinweg', () => {
    // 21 Tage vor dem 5. Januar ist der 15. Dezember des Vorjahres - und nicht
    // ein Tag im Januar mit negativer Nummer.
    const frist = workspace.fristAus(new Date('2027-01-05T00:00:00Z'), -21);
    expect(frist?.toISOString().slice(0, 10)).toBe('2026-12-15');
  });

  it('legt die vier Standardvorlagen an, und zwar einmal', async () => {
    expect(await workspace.legeStandardvorlagenAn(GUILD, ANNA)).toBe(4);
    // Zweiter Aufruf: nichts dazu. Sonst hätte ein Team nach drei Klicks zwölf
    // Vorlagen mit denselben Namen.
    expect(await workspace.legeStandardvorlagenAn(GUILD, ANNA)).toBe(0);

    const vorlagen = await workspace.ladeVorlagen(GUILD);
    expect(vorlagen.map((vorlage) => vorlage.name).sort()).toEqual([
      'IRL Event',
      'Social Media Kampagne',
      'Sponsoring',
      'Turnier',
    ]);
    // Jede bringt Schritte mit - eine Vorlage ohne Schritte wäre keine.
    for (const vorlage of vorlagen) {
      expect(vorlage.tasks.length, vorlage.name).toBeGreaterThan(5);
    }
  });

  it('bewahrt die eigene Fassung einer umgebauten Vorlage', async () => {
    await workspace.erstelleVorlage(GUILD, ANNA, {
      name: 'Turnier',
      projektTitel: 'Unser Turnier',
      aufgaben: [{ titel: 'Nur ein Schritt' }],
    });

    // Drei statt vier: «Turnier» gibt es schon, und zwar in der Fassung des
    // Teams.
    expect(await workspace.legeStandardvorlagenAn(GUILD, ANNA)).toBe(3);
    const turnier = (await workspace.ladeVorlagen(GUILD)).find((v) => v.name === 'Turnier');
    expect(turnier?.tasks).toHaveLength(1);
  });

  it('legt die Schritte einer Vorlage in der angegebenen Reihenfolge ab', async () => {
    const vorlage = await workspace.erstelleVorlage(GUILD, ANNA, {
      name: 'Reihenfolge',
      projektTitel: 'P',
      aufgaben: [{ titel: 'Erstens' }, { titel: 'Zweitens' }, { titel: 'Drittens' }],
    });
    const geladen = (await workspace.ladeVorlagen(GUILD)).find((v) => v.id === vorlage.id);
    expect(geladen?.tasks.map((a) => a.title)).toEqual(['Erstens', 'Zweitens', 'Drittens']);
    expect(geladen?.tasks.map((a) => a.position)).toEqual([0, 1, 2]);
  });

  it('macht aus einer Vorlage ein gewöhnliches Projekt mit gerechneten Fristen', async () => {
    const vorlage = await workspace.erstelleVorlage(GUILD, ANNA, {
      name: 'Kleines Turnier',
      projektTitel: 'Turnier',
      aufgaben: [
        { titel: 'Regelwerk', prioritaet: 'HIGH', faelligNachTagen: -21 },
        { titel: 'Durchführen', prioritaet: 'URGENT', faelligNachTagen: 0 },
        { titel: 'Rückblick', faelligNachTagen: 7 },
        { titel: 'Irgendwann' },
      ],
    });

    const projekt = await workspace.erstelleAusVorlage(vorlage.id, ANNA, {
      titel: 'Winter Cup 2026',
      zielAm: new Date('2026-12-05T00:00:00Z'),
    });

    expect(projekt.title).toBe('Winter Cup 2026');
    expect(projekt.status).toBe('PLANNED');
    expect(projekt.dueAt?.toISOString().slice(0, 10)).toBe('2026-12-05');

    const aufgaben = await workspace.ladeAufgaben(GUILD, { projectId: projekt.id });
    expect(aufgaben).toHaveLength(4);
    const nachTitel = new Map(
      aufgaben.map((zeile) => [zeile.aufgabe.title, zeile.aufgabe.dueAt?.toISOString().slice(0, 10) ?? null]),
    );
    expect(nachTitel.get('Regelwerk')).toBe('2026-11-14');
    expect(nachTitel.get('Durchführen')).toBe('2026-12-05');
    expect(nachTitel.get('Rückblick')).toBe('2026-12-12');
    // Kein Wert in der Vorlage heisst keine Frist - und nicht «am Zieltag».
    expect(nachTitel.get('Irgendwann')).toBeNull();

    // Wer anlegt, leitet - wie bei jedem anderen Projekt auch.
    const mitglieder = await prisma.workspaceProjectMember.findMany({
      where: { projectId: projekt.id },
    });
    expect(mitglieder).toHaveLength(1);
    expect(mitglieder[0]?.rolle).toBe('LEAD');
  });

  it('gibt den Aufgaben ohne Zieldatum keine Fristen', async () => {
    const vorlage = await workspace.erstelleVorlage(GUILD, ANNA, {
      name: 'Ohne Ziel',
      projektTitel: 'P',
      aufgaben: [
        { titel: 'A', faelligNachTagen: -7 },
        { titel: 'B', faelligNachTagen: 0 },
      ],
    });
    const projekt = await workspace.erstelleAusVorlage(vorlage.id, ANNA, { zielAm: null });

    const aufgaben = await workspace.ladeAufgaben(GUILD, { projectId: projekt.id });
    // Lieber keine Frist als zwei falsche, gerechnet auf den Tag des Anlegens.
    expect(aufgaben.every((zeile) => zeile.aufgabe.dueAt === null)).toBe(true);
  });

  it('löst eine Vorlage nicht mit dem Projekt mit', async () => {
    const vorlage = await workspace.erstelleVorlage(GUILD, ANNA, {
      name: 'Bleibt',
      projektTitel: 'P',
      aufgaben: [{ titel: 'A' }, { titel: 'B' }],
    });
    const projekt = await workspace.erstelleAusVorlage(vorlage.id, ANNA, {});

    // Eine Aufgabe im Projekt streichen ändert die Vorlage nicht - die
    // Aufgaben sind Kopien und keine Verknüpfung.
    const aufgaben = await workspace.ladeAufgaben(GUILD, { projectId: projekt.id });
    await workspace.loescheAufgabe(aufgaben[0]!.aufgabe.id, ANNA);

    const geladen = (await workspace.ladeVorlagen(GUILD)).find((v) => v.id === vorlage.id);
    expect(geladen?.tasks).toHaveLength(2);
  });

  it('archiviert eine Vorlage statt sie zu löschen', async () => {
    const vorlage = await workspace.erstelleVorlage(GUILD, ANNA, {
      name: 'Alt',
      projektTitel: 'P',
      aufgaben: [{ titel: 'A' }],
    });
    await workspace.archiviereVorlage(vorlage.id, ANNA);

    expect(await workspace.ladeVorlagen(GUILD)).toHaveLength(0);
    expect(await workspace.ladeVorlagen(GUILD, { archiviert: true })).toHaveLength(1);

    await workspace.holeVorlageZurueck(vorlage.id);
    expect(await workspace.ladeVorlagen(GUILD)).toHaveLength(1);
  });

  it('nimmt Aufgaben, Meilensteine und Projektziele in einen Zeitraum', async () => {
    const projekt = await workspace.erstelleProjekt(GUILD, ANNA, {
      titel: 'Juni-Projekt',
      dueAt: new Date('2026-06-30T12:00:00Z'),
    });
    await workspace.ergaenzeMeilenstein(projekt.id, ANNA, {
      titel: 'Anmeldung offen',
      dueAt: new Date('2026-06-10T12:00:00Z'),
    });
    await workspace.erstelleAufgabe(GUILD, ANNA, {
      titel: 'Grafik',
      projectId: projekt.id,
      dueAt: new Date('2026-06-15T12:00:00Z'),
    });
    // Ausserhalb des Zeitraums - darf nicht auftauchen.
    await workspace.erstelleAufgabe(GUILD, ANNA, {
      titel: 'Juli',
      projectId: projekt.id,
      dueAt: new Date('2026-07-02T12:00:00Z'),
    });

    const termine = await workspace.ladeTermine(
      GUILD,
      new Date('2026-06-01T00:00:00Z'),
      new Date('2026-07-01T00:00:00Z'),
    );

    expect(termine.map((termin) => termin.titel)).toEqual(['Anmeldung offen', 'Grafik', 'Juni-Projekt']);
    expect(termine.map((termin) => termin.art)).toEqual(['meilenstein', 'aufgabe', 'projektziel']);
  });

  it('behandelt den Zeitraum links geschlossen und rechts offen', async () => {
    await workspace.erstelleAufgabe(GUILD, ANNA, {
      titel: 'Erster',
      dueAt: new Date('2026-06-01T00:00:00Z'),
    });
    await workspace.erstelleAufgabe(GUILD, ANNA, {
      titel: 'Letzter',
      dueAt: new Date('2026-07-01T00:00:00Z'),
    });

    const termine = await workspace.ladeTermine(
      GUILD,
      new Date('2026-06-01T00:00:00Z'),
      new Date('2026-07-01T00:00:00Z'),
    );
    // Der Erste gehört in den Juni, der 1. Juli nicht - sonst stünde ein
    // Termin um Mitternacht in zwei Monaten.
    expect(termine.map((termin) => termin.titel)).toEqual(['Erster']);
  });

  it('sortiert gleichtägige Termine vom Groben zum Feinen', async () => {
    const projekt = await workspace.erstelleProjekt(GUILD, ANNA, {
      titel: 'Gleicher Tag',
      dueAt: new Date('2026-06-10T12:00:00Z'),
    });
    await workspace.ergaenzeMeilenstein(projekt.id, ANNA, {
      titel: 'Meilenstein',
      dueAt: new Date('2026-06-10T12:00:00Z'),
    });
    await workspace.erstelleAufgabe(GUILD, ANNA, {
      titel: 'Aufgabe',
      projectId: projekt.id,
      dueAt: new Date('2026-06-10T12:00:00Z'),
    });

    const termine = await workspace.ladeTermine(
      GUILD,
      new Date('2026-06-01T00:00:00Z'),
      new Date('2026-07-01T00:00:00Z'),
    );
    // Ein Meilenstein steht über den Aufgaben, die darauf zulaufen - das ist
    // die Reihenfolge, in der man den Tag liest.
    expect(termine.map((termin) => termin.art)).toEqual(['projektziel', 'meilenstein', 'aufgabe']);
  });

  it('blendet Erledigte auf Wunsch aus', async () => {
    const projekt = await workspace.erstelleProjekt(GUILD, ANNA, { titel: 'Mit Erledigtem' });
    const aufgabe = await workspace.erstelleAufgabe(GUILD, ANNA, {
      titel: 'Fertig',
      projectId: projekt.id,
      dueAt: new Date('2026-06-15T12:00:00Z'),
    });
    await workspace.setzeStatus(aufgabe.id, ANNA, 'DONE');
    const meilenstein = await workspace.ergaenzeMeilenstein(projekt.id, ANNA, {
      titel: 'Erreicht',
      dueAt: new Date('2026-06-12T12:00:00Z'),
    });
    await workspace.aendereMeilenstein(meilenstein.id, ANNA, { erledigt: true });

    const von = new Date('2026-06-01T00:00:00Z');
    const bis = new Date('2026-07-01T00:00:00Z');
    expect(await workspace.ladeTermine(GUILD, von, bis)).toHaveLength(2);
    expect(await workspace.ladeTermine(GUILD, von, bis, { nurOffene: true })).toHaveLength(0);
  });

  it('nimmt die Termine eines archivierten Projekts aus der Planung', async () => {
    const projekt = await workspace.erstelleProjekt(GUILD, ANNA, {
      titel: 'Vorbei',
      dueAt: new Date('2026-06-20T12:00:00Z'),
    });
    await workspace.ergaenzeMeilenstein(projekt.id, ANNA, {
      titel: 'Egal',
      dueAt: new Date('2026-06-18T12:00:00Z'),
    });
    await workspace.erstelleAufgabe(GUILD, ANNA, {
      titel: 'Auch egal',
      projectId: projekt.id,
      dueAt: new Date('2026-06-19T12:00:00Z'),
    });
    await workspace.archiviere(projekt.id, ANNA);

    const termine = await workspace.ladeTermine(
      GUILD,
      new Date('2026-06-01T00:00:00Z'),
      new Date('2026-07-01T00:00:00Z'),
    );
    expect(termine).toHaveLength(0);
  });

  it('verlangt für einen Meilenstein einen Titel und lässt ihn nicht ins Archiv', async () => {
    const projekt = await workspace.erstelleProjekt(GUILD, ANNA, { titel: 'Projekt' });
    await expect(
      workspace.ergaenzeMeilenstein(projekt.id, ANNA, { titel: '  ', dueAt: new Date() }),
    ).rejects.toThrow(/braucht einen Titel/u);

    await workspace.archiviere(projekt.id, ANNA);
    await expect(
      workspace.ergaenzeMeilenstein(projekt.id, ANNA, { titel: 'Spät', dueAt: new Date() }),
    ).rejects.toThrow(/archiviert/u);
  });

  it('hält Datumsänderungen eines Meilensteins im Verlauf fest, das Häkchen nicht', async () => {
    const projekt = await workspace.erstelleProjekt(GUILD, ANNA, { titel: 'Verlauf' });
    const meilenstein = await workspace.ergaenzeMeilenstein(projekt.id, ANNA, {
      titel: 'Punkt',
      dueAt: new Date('2026-06-10T12:00:00Z'),
    });

    const vorher = (await workspace.ladeVerlauf({ projectId: projekt.id })).filter(
      (eintrag) => eintrag.art === 'milestone.changed',
    ).length;

    await workspace.aendereMeilenstein(meilenstein.id, ANNA, { erledigt: true });
    const nachHaken = (await workspace.ladeVerlauf({ projectId: projekt.id })).filter(
      (eintrag) => eintrag.art === 'milestone.changed',
    ).length;
    // Ein Häkchen ist keine Planungsänderung.
    expect(nachHaken).toBe(vorher);

    await workspace.aendereMeilenstein(meilenstein.id, ANNA, {
      dueAt: new Date('2026-06-20T12:00:00Z'),
    });
    const nachDatum = (await workspace.ladeVerlauf({ projectId: projekt.id })).filter(
      (eintrag) => eintrag.art === 'milestone.changed',
    ).length;
    expect(nachDatum).toBe(vorher + 1);
  });

  it('zählt Meilensteine nicht in den Fortschritt', async () => {
    const projekt = await workspace.erstelleProjekt(GUILD, ANNA, { titel: 'Fortschritt' });
    const meilenstein = await workspace.ergaenzeMeilenstein(projekt.id, ANNA, {
      titel: 'Erreicht',
      dueAt: new Date('2026-06-10T12:00:00Z'),
    });
    await workspace.aendereMeilenstein(meilenstein.id, ANNA, { erledigt: true });
    await workspace.erstelleAufgabe(GUILD, ANNA, { titel: 'Offen', projectId: projekt.id });

    const ansicht = await workspace.ladeProjekt(projekt.id);
    // Null Prozent, obwohl ein Meilenstein abgehakt ist: der Fortschritt kommt
    // aus Aufgaben. Sonst sprang er auf 50, weil jemand ein Datum bestätigt hat.
    expect(ansicht?.fortschritt).toEqual({ gesamt: 1, erledigt: 0, prozent: 0 });
  });
});
