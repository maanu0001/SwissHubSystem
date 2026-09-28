import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_missionen');

/**
 * Community Missions gegen eine echte Datenbank.
 *
 * ## Was hier geprueft wird
 *
 * Die drei Zusagen, die sich ohne Datenbank nicht pruefen lassen:
 *
 *   1. der Fortschritt wird aus der **Quelle** gerechnet, nicht mitgezaehlt
 *   2. eine Mission schliesst genau **einmal** ab
 *   3. eine Belohnung wird genau **einmal** vergeben
 *
 * Die zweite und die dritte sind der Kern. Sie beruhen auf Eindeutigkeiten
 * und bedingten Schreiboperationen - also auf Zusagen der Datenbank, nicht
 * der Anwendung. Ein Test mit einer Attrappe wuerde genau die Zusage
 * pruefen, die er selbst gibt.
 */
const { prisma } = await import('@swisshub/database');
const { missions } = await import('@swisshub/modules');

const GUILD = '100000000000000002';

/**
 * Eine Nachricht im XP-Journal, zu einem bestimmten Zeitpunkt.
 *
 * Geschrieben wird die echte Zeile mit allen Pflichtfeldern - nicht eine
 * verkuerzte Attrappe. Wenn das Journal morgen eine Spalte dazubekommt,
 * scheitert dieser Helfer, und das ist richtig so: eine Mission, die auf
 * einer Tabelle rechnet, soll merken, wenn sich die Tabelle aendert.
 *
 * `createdAt` wird uebergeben statt `applyXp` zu benutzen, weil dort immer
 * «jetzt» steht - und ein Zeitfenster laesst sich nicht pruefen, wenn alle
 * Zeilen im selben Moment entstehen.
 */
async function buchung(discordId: string, wann: string, quelle: 'MESSAGE' | 'VOICE' = 'MESSAGE') {
  const profil = await prisma.levelProfile.upsert({
    where: { discordId },
    create: { discordId },
    update: {},
  });
  return prisma.xpTransaction.create({
    data: {
      profileId: profil.id,
      discordId,
      source: quelle,
      delta: 5,
      requestedDelta: 5,
      xpBefore: 0,
      xpAfter: 5,
      levelBefore: 1,
      levelAfter: 1,
      createdAt: new Date(wann),
    },
  });
}

/** Eine Mission mit Vorgaben, damit die Tests nur nennen, was sie brauchen. */
async function mission(felder: Partial<Parameters<typeof prisma.mission.create>[0]['data']> = {}) {
  return prisma.mission.create({
    data: {
      guildId: GUILD,
      art: 'WOCHE',
      typ: 'NACHRICHTEN',
      titel: 'Testmission',
      ziel: 10,
      beginntAm: new Date('2026-01-05T00:00:00Z'),
      endetAm: new Date('2026-01-12T00:00:00Z'),
      status: 'LAEUFT',
      ...felder,
    },
  });
}

describeWithDatabase('Der Fortschritt', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.missionBelohnung.deleteMany();
    await prisma.missionFortschritt.deleteMany();
    await prisma.mission.deleteMany();
    await prisma.xpTransaction.deleteMany();
    await prisma.levelProfile.deleteMany();
  });

  it('rechnet Nachrichten aus dem XP-Journal, im Zeitfenster', async () => {
    const eintrag = await mission();

    // Zwei im Fenster.
    await buchung('a', '2026-01-06T10:00:00Z');
    await buchung('a', '2026-01-07T10:00:00Z');
    // Eine davor - zaehlt nicht.
    await buchung('a', '2026-01-01T10:00:00Z');
    // Eine im Fenster, aber keine Nachricht.
    await buchung('a', '2026-01-06T11:00:00Z', 'VOICE');
    // Eine von jemand anderem.
    await buchung('b', '2026-01-06T12:00:00Z');

    const stand = await missions.messeStand(eintrag, new Date('2026-01-08T00:00:00Z'));

    expect(stand.werte.get('a')).toBe(2);
    expect(stand.werte.get('b')).toBe(1);
    expect(stand.summe).toBe(3);
  });

  it('lässt das Fenster einer beendeten Mission nicht weiterwandern', async () => {
    /*
     * Sonst aenderte sich das Ergebnis einer abgeschlossenen Mission bei
     * jedem Aufruf - und die Zahl neben «geschafft» stimmte morgen nicht
     * mehr mit der ueberein, die gestern belohnt wurde.
     */
    const eintrag = await mission();
    await buchung('a', '2026-01-06T10:00:00Z');
    // Nach dem Ende der Mission.
    await buchung('a', '2026-01-20T10:00:00Z');

    const stand = await missions.messeStand(eintrag, new Date('2026-02-01T00:00:00Z'));
    expect(stand.werte.get('a')).toBe(1);
  });

  it('überschreibt den Stand, statt ihn hochzuzählen', async () => {
    /*
     * Der Grund, warum ein doppelter Durchgang folgenlos ist. Zweimal
     * dasselbe zu schreiben muss dasselbe ergeben - sonst braeuchte jeder
     * Retry eine eigene Vorkehrung.
     */
    const eintrag = await mission();
    const werte = new Map([['a', 7]]);

    await missions.speichereStand(eintrag.id, werte);
    await missions.speichereStand(eintrag.id, werte);

    const zeilen = await prisma.missionFortschritt.findMany({ where: { missionId: eintrag.id } });
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]?.wert).toBe(7);
  });

  it('meldet einen unbekannten Typ als leer, statt zu werfen', async () => {
    /*
     * Eine Mission aus einer Version, die einen Typ kannte, den es nicht
     * mehr gibt. Kein Absturz des Durchgangs - er soll die uebrigen
     * Missionen weiter bedienen.
     */
    const eintrag = await mission();
    const stand = await missions.messeStand({ ...eintrag, typ: 'GIBT_ES_NICHT' });

    expect(stand.summe).toBe(0);
    expect(stand.werte.size).toBe(0);
  });
});

describeWithDatabase('Der Abschluss', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.missionBelohnung.deleteMany();
    await prisma.missionFortschritt.deleteMany();
    await prisma.mission.deleteMany();
    await prisma.xpTransaction.deleteMany();
    await prisma.levelProfile.deleteMany();
  });

  it('schliesst eine Mission genau einmal ab - auch bei gleichzeitigen Durchgängen', async () => {
    /*
     * **Der wichtigste Test dieser Datei.**
     *
     * Zwei Worker, dieselbe faellige Mission, im selben Moment. Genau einer
     * darf `abgeschlossen: true` bekommen; der andere muss leer ausgehen,
     * ohne einen Fehler zu werfen - das ist der Normalfall bei zwei
     * Instanzen, keine Ausnahme.
     *
     * Was das prueft, ist die bedingte Schreiboperation in `schliesseAb`.
     * Eine Pruefung «laeuft die noch?» in der Anwendung bestuende diesen
     * Test nicht: beide Durchgaenge laesen «ja», bevor einer schreibt.
     */
    const eintrag = await mission({ ziel: 1 });
    await buchung('a', '2026-01-06T10:00:00Z');

    const jetzt = new Date('2026-01-12T00:01:00Z');
    const [erster, zweiter] = await Promise.all([
      missions.schliesseAb(eintrag.id, jetzt),
      missions.schliesseAb(eintrag.id, jetzt),
    ]);

    const gewinner = [erster, zweiter].filter((ergebnis) => ergebnis.abgeschlossen);
    expect(gewinner, 'Genau ein Durchgang darf abschliessen').toHaveLength(1);

    const danach = await prisma.mission.findUnique({ where: { id: eintrag.id } });
    expect(danach?.status).toBe('ABGESCHLOSSEN');
    expect(danach?.abgeschlossenAm).not.toBeNull();
  });

  it('vergibt eine Belohnung genau einmal je Mitglied', async () => {
    const eintrag = await mission({ ziel: 1, belohnungXp: 100 });

    const jetzt = new Date('2026-01-12T00:01:00Z');
    const [erste, zweite] = await Promise.all([
      missions.belohne(
        eintrag.id,
        eintrag.titel,
        'a',
        { xp: 100, premiumTage: 0, auszeichnung: null },
        jetzt,
      ),
      missions.belohne(
        eintrag.id,
        eintrag.titel,
        'a',
        { xp: 100, premiumTage: 0, auszeichnung: null },
        jetzt,
      ),
    ]);

    const neu = [erste, zweite].filter((ergebnis) => !ergebnis.schonVergeben);
    expect(neu, 'Genau eine Vergabe darf neu sein').toHaveLength(1);

    const zeilen = await prisma.missionBelohnung.findMany({ where: { missionId: eintrag.id } });
    expect(zeilen).toHaveLength(1);

    /*
     * Und die XP genau einmal. Das ist der zweite Riegel - der
     * Idempotenzschluessel im XP-Journal - und er haelt auch dann, wenn
     * jemand spaeter einen anderen Weg zur Belohnung baut.
     */
    const buchungen = await prisma.xpTransaction.findMany({ where: { discordId: 'a', source: 'ADMIN' } });
    expect(buchungen).toHaveLength(1);
    expect(buchungen[0]?.delta).toBe(100);
  });

  it('belohnt eine Wochenmission nur, wer das Ziel erreicht hat', async () => {
    const eintrag = await mission({ ziel: 2, belohnungXp: 50 });
    await buchung('schafft', '2026-01-06T10:00:00Z');
    await buchung('schafft', '2026-01-06T11:00:00Z');
    await buchung('knapp', '2026-01-06T12:00:00Z');

    const ergebnis = await missions.schliesseAb(eintrag.id, new Date('2026-01-12T00:01:00Z'));

    expect(ergebnis.abgeschlossen).toBe(true);
    expect(ergebnis.zielErreicht).toBe(true);
    expect(ergebnis.belohnt.map((eintrag) => eintrag.discordId)).toEqual(['schafft']);
  });

  it('belohnt bei einer Challenge nur, wer genug beigetragen hat', async () => {
    const eintrag = await mission({ art: 'CHALLENGE', ziel: 3, mindestBeitrag: 2, belohnungXp: 50 });
    await buchung('traegt', '2026-01-06T10:00:00Z');
    await buchung('traegt', '2026-01-06T11:00:00Z');
    await buchung('war-kurz-da', '2026-01-06T12:00:00Z');

    const ergebnis = await missions.schliesseAb(eintrag.id, new Date('2026-01-12T00:01:00Z'));

    expect(ergebnis.zielErreicht).toBe(true);
    expect(ergebnis.stand).toBe(3);
    expect(ergebnis.belohnt.map((eintrag) => eintrag.discordId)).toEqual(['traegt']);
  });

  it('belohnt niemanden, wenn die Challenge das gemeinsame Ziel verfehlt', async () => {
    const eintrag = await mission({ art: 'CHALLENGE', ziel: 100, mindestBeitrag: 1, belohnungXp: 50 });
    await buchung('a', '2026-01-06T10:00:00Z');

    const ergebnis = await missions.schliesseAb(eintrag.id, new Date('2026-01-12T00:01:00Z'));

    expect(ergebnis.abgeschlossen).toBe(true);
    expect(ergebnis.zielErreicht).toBe(false);
    expect(ergebnis.belohnt).toHaveLength(0);
    expect(await prisma.missionBelohnung.count()).toBe(0);
  });

  it('misst vor dem Abschluss noch einmal', async () => {
    /*
     * Zwischen dem letzten Fortschrittsdurchgang und dem Ende koennen
     * Minuten liegen. Wer sie in der letzten Minute geschafft hat, soll
     * belohnt werden - sonst waere der Fuenf-Minuten-Takt des Durchgangs
     * eine stille Frist.
     */
    const eintrag = await mission({ ziel: 1, belohnungXp: 10 });
    expect(await prisma.missionFortschritt.count()).toBe(0);

    await buchung('spaet', '2026-01-11T23:59:00Z');

    const ergebnis = await missions.schliesseAb(eintrag.id, new Date('2026-01-12T00:01:00Z'));
    expect(ergebnis.belohnt.map((eintrag) => eintrag.discordId)).toEqual(['spaet']);
  });

  it('schliesst eine abgebrochene Mission nicht ab', async () => {
    const eintrag = await mission({ status: 'ABGEBROCHEN' });
    const ergebnis = await missions.schliesseAb(eintrag.id, new Date('2026-01-12T00:01:00Z'));

    expect(ergebnis.abgeschlossen).toBe(false);
    expect(await prisma.missionBelohnung.count()).toBe(0);
  });

  it('bricht eine laufende Mission ab, ohne zu belohnen - und nur einmal', async () => {
    const eintrag = await mission({ ziel: 1, belohnungXp: 100 });
    const akteur = { discordId: '1', username: 'test' };

    const [erster, zweiter] = await Promise.all([
      missions.brichAb(akteur, eintrag.id),
      missions.brichAb(akteur, eintrag.id),
    ]);

    expect([erster, zweiter].filter(Boolean)).toHaveLength(1);
    expect((await prisma.mission.findUnique({ where: { id: eintrag.id } }))?.status).toBe('ABGEBROCHEN');
    expect(await prisma.missionBelohnung.count()).toBe(0);
  });
});

describeWithDatabase('Die Verwaltung', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.missionBelohnung.deleteMany();
    await prisma.missionFortschritt.deleteMany();
    await prisma.mission.deleteMany();
    await prisma.missionVorlage.deleteMany();
  });

  const akteur = { discordId: '1', username: 'test' };

  const basis = {
    guildId: GUILD,
    art: 'WOCHE' as const,
    typ: 'NACHRICHTEN' as const,
    titel: 'Reden ist Silber',
    ziel: 50,
    mindestBeitrag: 1,
    beginntAm: new Date('2026-01-05T00:00:00Z'),
    endetAm: new Date('2026-01-12T00:00:00Z'),
    belohnungXp: 100,
    belohnungPremiumTage: 0,
  };

  it('legt eine Mission an, die sofort läuft, wenn ihr Beginn erreicht ist', async () => {
    const eintrag = await missions.erstelleMission(akteur, basis, new Date('2026-01-06T00:00:00Z'));
    expect(eintrag.status).toBe('LAEUFT');
  });

  it('legt eine Mission als geplant an, solange ihr Beginn in der Zukunft liegt', async () => {
    const eintrag = await missions.erstelleMission(akteur, basis, new Date('2026-01-01T00:00:00Z'));
    expect(eintrag.status).toBe('GEPLANT');
  });

  it('weist eine Challenge auf einem nicht zusammenzählbaren Typ ab', async () => {
    await expect(
      missions.erstelleMission(akteur, { ...basis, art: 'CHALLENGE', typ: 'LEVEL_ERREICHT' }),
    ).rejects.toThrow();
  });

  it('weist ein Ende vor dem Beginn ab', async () => {
    await expect(
      missions.erstelleMission(akteur, { ...basis, endetAm: new Date('2026-01-01T00:00:00Z') }),
    ).rejects.toThrow();
  });

  it('lässt eine abgeschlossene Mission nicht mehr ändern', async () => {
    /*
     * Eine abgeschlossene Mission ist Geschichte: ihre Belohnungen sind
     * vergeben. Ein nachtraeglich gesenktes Ziel erzeugte eine Liste von
     * Gewinnern, die es nie gab.
     */
    const eintrag = await missions.erstelleMission(akteur, basis, new Date('2026-01-06T00:00:00Z'));
    await prisma.mission.update({ where: { id: eintrag.id }, data: { status: 'ABGESCHLOSSEN' } });

    await expect(missions.aendereMission(akteur, eintrag.id, { ziel: 1 })).rejects.toThrow();
  });

  it('macht aus einer Vorlage eine Mission der laufenden Woche', async () => {
    const vorlage = await missions.speichereVorlage(akteur, {
      name: 'Voice-Woche',
      art: 'WOCHE',
      typ: 'VOICE_MINUTEN',
      titel: '100 Minuten im Voice',
      ziel: 100,
      mindestBeitrag: 1,
      belohnungXp: 250,
      belohnungPremiumTage: 0,
    });

    // Mittwoch, 14. Januar 2026 - Wochenstart Montag 00:00 Zuerich.
    const eintrag = await missions.ausVorlage(
      akteur,
      vorlage.id,
      GUILD,
      1,
      0,
      new Date('2026-01-14T12:00:00Z'),
    );

    expect(eintrag.titel).toBe('100 Minuten im Voice');
    expect(eintrag.ziel).toBe(100);
    expect(eintrag.belohnungXp).toBe(250);
    expect(eintrag.vorlageId).toBe(vorlage.id);
    expect(eintrag.beginntAm.toISOString()).toBe('2026-01-11T23:00:00.000Z');
    expect(eintrag.endetAm.toISOString()).toBe('2026-01-18T23:00:00.000Z');
    expect(eintrag.status).toBe('LAEUFT');
  });

  it('mustert eine Vorlage aus, statt sie zu löschen', async () => {
    const vorlage = await missions.speichereVorlage(akteur, {
      name: 'Alte Vorlage',
      art: 'WOCHE',
      typ: 'NACHRICHTEN',
      titel: 'Alt',
      ziel: 10,
      mindestBeitrag: 1,
      belohnungXp: 0,
      belohnungPremiumTage: 0,
    });
    const eintrag = await missions.ausVorlage(akteur, vorlage.id, GUILD, 1, 0);

    await missions.musterVorlageAus(akteur, vorlage.id);

    // Die Vorlage gibt es noch - die Mission behaelt ihre Herkunft.
    expect(await prisma.missionVorlage.count()).toBe(1);
    expect((await prisma.mission.findUnique({ where: { id: eintrag.id } }))?.vorlageId).toBe(vorlage.id);
    // Aber sie steht nicht mehr zur Auswahl.
    expect(await missions.aktiveVorlagen()).toHaveLength(0);
    expect(await missions.alleVorlagen()).toHaveLength(1);
  });
});
