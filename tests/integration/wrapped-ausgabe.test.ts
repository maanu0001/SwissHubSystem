import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';
import { crc32, deflateSync } from 'node:zlib';

useTestSchema('test_wrapped_ausgabe');

/**
 * Periodische Wrapped-Ausgaben gegen eine echte Datenbank.
 *
 * Geprueft wird hier, was sich ohne Postgres nicht zeigen laesst: dass genau
 * eine Ausgabe je Zeitraum entstehen kann, dass eine eingefrorene Ausgabe
 * sich nicht mehr von selbst aendert, und dass keine Zahl erfunden wird, wo
 * keine Daten sind.
 */
const { prisma } = await import('@swisshub/database');
const { wrapped } = await import('@swisshub/modules');

const GUILD = '000000000000000001';
const AKTEUR = { discordId: '900000000000000051', username: 'testleitung' };

async function leeren(): Promise<void> {
  await prisma.wrappedSlide.deleteMany({});
  await prisma.wrappedEdition.deleteMany({});
  // Auch die Kampagnen des persoenlichen Rueckblicks: der letzte Fall unten
  // legt eine an, und das Schema ueberlebt den Testlauf.
  await prisma.wrappedCampaign.deleteMany({});
  await prisma.wrappedMoment.deleteMany({});
  await prisma.analyticsUserDaily.deleteMany({});
  await prisma.analyticsDaily.deleteMany({});
  await prisma.analyticsTracking.deleteMany({});
  await prisma.tournamentParticipant.deleteMany({});
  await prisma.tournament.deleteMany({});
  await prisma.auditLog.deleteMany({});
}

/** Tageswerte fuer einen Monat - gleichmaessig, damit Erwartungen rechenbar bleiben. */
async function tageswerte(
  monat: string,
  werte: { voiceSeconds: number; messages: number; joins?: number },
): Promise<void> {
  const periode = wrapped.periodeVon('MONTHLY', monat)!;
  const tage: Array<{ guildId: string; day: Date; messages: number; voiceSeconds: number; joins: number }> =
    [];
  const [jahr, nummer] = monat.split('-').map(Number);
  const anzahl = new Date(Date.UTC(jahr!, nummer!, 0)).getUTCDate();

  for (let tag = 1; tag <= anzahl; tag += 1) {
    tage.push({
      guildId: GUILD,
      day: new Date(`${monat}-${String(tag).padStart(2, '0')}T00:00:00.000Z`),
      messages: werte.messages,
      voiceSeconds: werte.voiceSeconds,
      joins: werte.joins ?? 0,
    });
  }
  await prisma.analyticsDaily.createMany({ data: tage, skipDuplicates: true });

  // Eine Handvoll Personen je Tag - fuer die eindeutigen Aktiven.
  const personen = [];
  for (const tag of tage) {
    for (let i = 0; i < 5; i += 1) {
      personen.push({
        guildId: GUILD,
        discordId: `90000000000000${String(100 + i).padStart(4, '0')}`,
        day: tag.day,
        messages: 3,
        voiceSeconds: 600,
      });
    }
  }
  await prisma.analyticsUserDaily.createMany({ data: personen, skipDuplicates: true });
  expect(periode).not.toBeNull();
}

const august = () => wrapped.periodeVon('MONTHLY', '2026-08')!;
const NACH_AUGUST = new Date('2026-10-01T12:00:00Z');

describeWithDatabase('Wrapped-Ausgaben', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await leeren();
    await prisma.analyticsTracking.create({
      data: {
        guildId: GUILD,
        voiceSince: new Date('2025-01-01T00:00:00Z'),
        messagesSince: new Date('2025-01-01T00:00:00Z'),
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // --- Genau eine je Zeitraum ------------------------------------------------

  it('erzeugt genau eine Ausgabe je Zeitraum', async () => {
    await tageswerte('2026-08', { voiceSeconds: 7200, messages: 500 });

    const erste = await wrapped.erzeugeAusgabe(GUILD, august(), { akteur: AKTEUR, jetzt: NACH_AUGUST });
    expect(erste.neu).toBe(true);
    expect(erste.folien).toBeGreaterThan(0);

    const zweite = await wrapped.erzeugeAusgabe(GUILD, august(), { akteur: AKTEUR, jetzt: NACH_AUGUST });
    expect(zweite.neu).toBe(false);
    expect(zweite.editionId).toBe(erste.editionId);

    expect(await prisma.wrappedEdition.count()).toBe(1);
  });

  it('haelt auch zwei gleichzeitige Durchgaenge auseinander', async () => {
    await tageswerte('2026-08', { voiceSeconds: 7200, messages: 500 });

    /*
     * Der Fall mit zwei Arbeitern.
     *
     * Beide fragen gleichzeitig nach, beide finden nichts, beide legen an -
     * und genau einer kommt durch die Eindeutigkeit. Ohne den Riegel auf
     * Datenbankebene gaebe es hier zwei Augustausgaben.
     */
    const ergebnisse = await Promise.all([
      wrapped.erzeugeAusgabe(GUILD, august(), { jetzt: NACH_AUGUST }),
      wrapped.erzeugeAusgabe(GUILD, august(), { jetzt: NACH_AUGUST }),
      wrapped.erzeugeAusgabe(GUILD, august(), { jetzt: NACH_AUGUST }),
    ]);

    expect(await prisma.wrappedEdition.count()).toBe(1);
    expect(new Set(ergebnisse.map((e) => e.editionId)).size).toBe(1);
    expect(ergebnisse.filter((e) => e.neu)).toHaveLength(1);
  });

  it('erzeugt keine Ausgabe fuer einen laufenden Zeitraum', async () => {
    await expect(
      wrapped.erzeugeAusgabe(GUILD, august(), { jetzt: new Date('2026-08-15T12:00:00Z') }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await prisma.wrappedEdition.count()).toBe(0);
  });

  // --- Keine erfundenen Zahlen -----------------------------------------------

  it('laesst jede Folie weg, zu der es keine Daten gibt - und sagt warum', async () => {
    // Kein einziger Tageswert: nur Eroeffnung und Abschluss bleiben.
    const ergebnis = await wrapped.erzeugeAusgabe(GUILD, august(), { jetzt: NACH_AUGUST });
    const ansicht = await wrapped.ladeAusgabe(ergebnis.editionId);

    expect(ansicht?.folien.map((folie) => folie.storyKey)).toEqual(['intro', 'outro']);
    // Und es steht da, warum der Rest fehlt.
    expect(ansicht?.gruende.length).toBeGreaterThan(0);
    for (const grund of ansicht!.gruende) {
      expect(grund.erklaerung.length).toBeGreaterThan(10);
    }
  });

  it('nennt fehlende Messung und ruhigen Monat beim jeweils richtigen Namen', async () => {
    await prisma.analyticsTracking.update({
      where: { guildId: GUILD },
      // Sprachzeit wird erst ab Oktober gemessen - der August ist eine Luecke.
      data: { voiceSince: new Date('2026-10-01T00:00:00Z') },
    });
    await tageswerte('2026-08', { voiceSeconds: 7200, messages: 500 });

    const ergebnis = await wrapped.erzeugeAusgabe(GUILD, august(), { jetzt: NACH_AUGUST });
    const ansicht = await wrapped.ladeAusgabe(ergebnis.editionId);

    const voice = ansicht?.gruende.find((grund) => grund.storyKey === 'voice_total');
    expect(voice?.lage).toBe('nicht_erhoben');

    const turnier = ansicht?.gruende.find((grund) => grund.storyKey === 'tournament_winner');
    // Turniere werden nicht gemessen - es gab schlicht keines.
    expect(turnier?.lage).toBe('nichts_passiert');
  });

  it('behauptet keinen Rekord ohne Vergleichsdaten', async () => {
    await tageswerte('2026-08', { voiceSeconds: 7200, messages: 500 });

    const ergebnis = await wrapped.erzeugeAusgabe(GUILD, august(), { jetzt: NACH_AUGUST });
    const ansicht = await wrapped.ladeAusgabe(ergebnis.editionId);

    expect(ansicht?.folien.some((folie) => folie.storyKey === 'voice_record')).toBe(false);
    const grund = ansicht?.gruende.find((eintrag) => eintrag.storyKey === 'voice_record');
    expect(grund?.lage).toBe('zu_wenig_vergleich');
  });

  it('behauptet einen Rekord, sobald genuegend Vergleichstage vorliegen', async () => {
    // Drei Monate Vorlauf auf niedrigem Niveau, dann ein starker August.
    for (const monat of ['2026-05', '2026-06', '2026-07']) {
      await tageswerte(monat, { voiceSeconds: 1800, messages: 200 });
    }
    await tageswerte('2026-08', { voiceSeconds: 9000, messages: 500 });

    const ergebnis = await wrapped.erzeugeAusgabe(GUILD, august(), { jetzt: NACH_AUGUST });
    const ansicht = await wrapped.ladeAusgabe(ergebnis.editionId);

    const rekord = ansicht?.folien.find((folie) => folie.storyKey === 'voice_record');
    expect(rekord).toBeDefined();
    // 9000 Sekunden sind zwei volle Stunden.
    expect((rekord?.daten as { wert: string }).wert).toBe('2');
  });

  // --- Snapshots --------------------------------------------------------------

  it('friert die Zahlen ein - eine spaetere Quelldatenaenderung wirkt nicht zurueck', async () => {
    await tageswerte('2026-08', { voiceSeconds: 7200, messages: 500 });

    const ergebnis = await wrapped.erzeugeAusgabe(GUILD, august(), { akteur: AKTEUR, jetzt: NACH_AUGUST });
    await wrapped.finalisiereAusgabe(ergebnis.editionId, AKTEUR);

    const vorher = await wrapped.ladeAusgabe(ergebnis.editionId);
    const voiceVorher = vorher?.folien.find((folie) => folie.storyKey === 'voice_total')?.daten;

    // Die Quelldaten aendern sich nachtraeglich - etwa durch einen Nachlauf.
    await prisma.analyticsDaily.updateMany({
      where: { guildId: GUILD },
      data: { voiceSeconds: 99_999 },
    });

    const nachher = await wrapped.ladeAusgabe(ergebnis.editionId);
    expect(nachher?.folien.find((folie) => folie.storyKey === 'voice_total')?.daten).toEqual(voiceVorher);
  });

  it('erhebt eine eingefrorene Ausgabe nicht neu', async () => {
    await tageswerte('2026-08', { voiceSeconds: 7200, messages: 500 });
    const ergebnis = await wrapped.erzeugeAusgabe(GUILD, august(), { akteur: AKTEUR, jetzt: NACH_AUGUST });
    await wrapped.finalisiereAusgabe(ergebnis.editionId, AKTEUR);

    await expect(wrapped.regeneriereAusgabe(ergebnis.editionId, { akteur: AKTEUR })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('laesst eine eingefrorene Ausgabe erst nach dem Entsperren wieder aendern', async () => {
    await tageswerte('2026-08', { voiceSeconds: 7200, messages: 500 });
    const ergebnis = await wrapped.erzeugeAusgabe(GUILD, august(), { akteur: AKTEUR, jetzt: NACH_AUGUST });
    const ansicht = await wrapped.ladeAusgabe(ergebnis.editionId);
    const folie = ansicht!.folien[0]!;

    await wrapped.finalisiereAusgabe(ergebnis.editionId, AKTEUR);
    await expect(
      wrapped.speichereEditorial(folie.id, { ueberschrift: 'Neu', text: '' }, AKTEUR),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    await wrapped.entsperreAusgabe(ergebnis.editionId, AKTEUR);
    await expect(
      wrapped.speichereEditorial(folie.id, { ueberschrift: 'Neu', text: '' }, AKTEUR),
    ).resolves.toBeUndefined();
  });

  // --- Regenerierung ----------------------------------------------------------

  it('behaelt beim Neuerheben die redaktionellen Texte', async () => {
    await tageswerte('2026-08', { voiceSeconds: 7200, messages: 500 });
    const ergebnis = await wrapped.erzeugeAusgabe(GUILD, august(), { akteur: AKTEUR, jetzt: NACH_AUGUST });
    const vorher = await wrapped.ladeAusgabe(ergebnis.editionId);
    const folie = vorher!.folien.find((eintrag) => eintrag.storyKey === 'voice_total')!;

    await wrapped.speichereEditorial(
      folie.id,
      { ueberschrift: 'Von Hand', text: 'Ein eigener Satz.' },
      AKTEUR,
    );
    await wrapped.schalteFolie(folie.id, false, AKTEUR);

    await wrapped.regeneriereAusgabe(ergebnis.editionId, { akteur: AKTEUR });

    const nachher = await wrapped.ladeAusgabe(ergebnis.editionId);
    const neu = nachher!.folien.find((eintrag) => eintrag.storyKey === 'voice_total')!;
    expect(neu.editorial.ueberschrift).toBe('Von Hand');
    expect(neu.editorial.text).toBe('Ein eigener Satz.');
    // Auch das Ausschalten bleibt - es war eine Entscheidung.
    expect(neu.enabled).toBe(false);
  });

  it('setzt die Texte nur auf ausdruecklichen Befehl zurueck', async () => {
    await tageswerte('2026-08', { voiceSeconds: 7200, messages: 500 });
    const ergebnis = await wrapped.erzeugeAusgabe(GUILD, august(), { akteur: AKTEUR, jetzt: NACH_AUGUST });
    const vorher = await wrapped.ladeAusgabe(ergebnis.editionId);
    const folie = vorher!.folien.find((eintrag) => eintrag.storyKey === 'voice_total')!;

    await wrapped.speichereEditorial(folie.id, { ueberschrift: 'Von Hand', text: '' }, AKTEUR);
    await wrapped.regeneriereAusgabe(ergebnis.editionId, { akteur: AKTEUR, texteBehalten: false });

    const nachher = await wrapped.ladeAusgabe(ergebnis.editionId);
    const neu = nachher!.folien.find((eintrag) => eintrag.storyKey === 'voice_total')!;
    expect(neu.editorial.ueberschrift).toBe('Im Voice');
  });

  // --- Zustaende ---------------------------------------------------------------

  it('laesst nur den Weg Entwurf, eingefroren, veroeffentlicht zu', async () => {
    await tageswerte('2026-08', { voiceSeconds: 7200, messages: 500 });
    const ergebnis = await wrapped.erzeugeAusgabe(GUILD, august(), { akteur: AKTEUR, jetzt: NACH_AUGUST });

    // Ein Entwurf laesst sich nicht veroeffentlichen - die Zahlen koennten
    // sich noch aendern.
    await expect(wrapped.markiereVeroeffentlicht(ergebnis.editionId, AKTEUR)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });

    await wrapped.finalisiereAusgabe(ergebnis.editionId, AKTEUR);
    await wrapped.markiereVeroeffentlicht(ergebnis.editionId, AKTEUR);

    const ansicht = await wrapped.ladeAusgabe(ergebnis.editionId);
    expect(ansicht?.status).toBe('PUBLISHED');
    expect(ansicht?.publishedAt).not.toBeNull();
  });

  it('schreibt genau einen Protokolleintrag je Handlung, auch bei Doppelklick', async () => {
    await tageswerte('2026-08', { voiceSeconds: 7200, messages: 500 });
    const ergebnis = await wrapped.erzeugeAusgabe(GUILD, august(), { akteur: AKTEUR, jetzt: NACH_AUGUST });

    await Promise.all([
      wrapped.finalisiereAusgabe(ergebnis.editionId, AKTEUR),
      wrapped.finalisiereAusgabe(ergebnis.editionId, AKTEUR).catch(() => undefined),
    ]);

    const eintraege = await prisma.auditLog.count({ where: { action: 'WRAPPED_EDITION_FINALIZED' } });
    expect(eintraege).toBe(1);
  });

  // --- Jahresausgabe -----------------------------------------------------------

  it('wertet das Jahr ueber den ganzen Zeitraum aus, nicht ueber Monatsausgaben', async () => {
    // Drei Monate mit Daten - und keine einzige Monatsausgabe.
    await tageswerte('2026-03', { voiceSeconds: 3600, messages: 100 });
    await tageswerte('2026-07', { voiceSeconds: 7200, messages: 100 });
    await tageswerte('2026-11', { voiceSeconds: 1800, messages: 100 });
    expect(await prisma.wrappedEdition.count()).toBe(0);

    const jahr = wrapped.periodeVon('YEARLY', '2026')!;
    const ergebnis = await wrapped.erzeugeAusgabe(GUILD, jahr, {
      akteur: AKTEUR,
      jetzt: new Date('2027-01-02T00:00:00Z'),
    });
    const ansicht = await wrapped.ladeAusgabe(ergebnis.editionId);

    const verlauf = ansicht?.folien.find((folie) => folie.storyKey === 'month_overview');
    expect(verlauf).toBeDefined();
    const daten = verlauf?.daten as { monate: Array<{ wert: number }>; bester: string | null };
    expect(daten.monate).toHaveLength(12);
    // Juli ist der staerkste - aber es fehlen Monate, also keine Behauptung.
    expect(daten.bester).toBeNull();
    expect(daten.monate[6]?.wert).toBeGreaterThan(daten.monate[2]?.wert ?? 0);
  });

  it('nennt den staerksten Monat erst, wenn alle zwoelf gemessen wurden', async () => {
    for (let monat = 1; monat <= 12; monat += 1) {
      await tageswerte(`2026-${String(monat).padStart(2, '0')}`, {
        voiceSeconds: monat === 7 ? 9000 : 1800,
        messages: 100,
      });
    }

    const jahr = wrapped.periodeVon('YEARLY', '2026')!;
    const ergebnis = await wrapped.erzeugeAusgabe(GUILD, jahr, {
      jetzt: new Date('2027-01-02T00:00:00Z'),
    });
    const ansicht = await wrapped.ladeAusgabe(ergebnis.editionId);
    const daten = ansicht?.folien.find((folie) => folie.storyKey === 'month_overview')?.daten as {
      bester: string | null;
    };
    expect(daten.bester).toBe('Juli');
  });

  // --- Community Moments --------------------------------------------------------

  it('nimmt einen Moment nur in die Ausgabe seines Zeitraums', async () => {
    await tageswerte('2026-08', { voiceSeconds: 7200, messages: 500 });
    await wrapped.erstelleMoment(
      GUILD,
      {
        title: 'GameNight',
        description: null,
        happenedOn: '2026-08-09',
        includeMonthly: true,
        includeYearly: false,
        priority: 0,
      },
      AKTEUR,
    );

    const august2 = await wrapped.erzeugeAusgabe(GUILD, august(), { jetzt: NACH_AUGUST });
    const ansichtAugust = await wrapped.ladeAusgabe(august2.editionId);
    expect(ansichtAugust?.folien.some((folie) => folie.storyKey === 'community_moment')).toBe(true);

    const juli = await wrapped.erzeugeAusgabe(GUILD, wrapped.periodeVon('MONTHLY', '2026-07')!, {
      jetzt: NACH_AUGUST,
    });
    const ansichtJuli = await wrapped.ladeAusgabe(juli.editionId);
    expect(ansichtJuli?.folien.some((folie) => folie.storyKey === 'community_moment')).toBe(false);
  });

  it('reicht das Bild eines Moments als Bytes heraus, nicht als Adresse', async () => {
    /*
     * Der Befund aus dem Betrieb: im Schnappschuss steht
     * `/api/wrapped/moment/<id>`. Der Browser der Editor-Vorschau kommt
     * damit zurecht, die Zeichenmaschine des Exports nicht - sie wirft bei
     * einer relativen Adresse, und zwar fuer das ganze Archiv.
     *
     * Deshalb loest `momentBildDatenUri` die Bytes von der Platte auf.
     * Dieser Test haelt fest, dass dabei etwas herauskommt, das sich
     * zeichnen laesst.
     */
    const moment = await wrapped.erstelleMoment(
      GUILD,
      {
        title: 'GameNight',
        description: null,
        happenedOn: '2026-08-09',
        includeMonthly: true,
        includeYearly: false,
        priority: 0,
      },
      AKTEUR,
    );

    // Ohne Bild gibt es nichts aufzuloesen - und das ist kein Fehler.
    expect(await wrapped.momentBildDatenUri(moment.id)).toBeNull();

    await wrapped.speichereMomentBild(moment.id, einPng(), 'image/png');
    const uri = await wrapped.momentBildDatenUri(moment.id);
    expect(uri?.startsWith('data:image/png;base64,')).toBe(true);
    expect((uri ?? '').length).toBeGreaterThan(100);

    // Und ein Moment, den es nicht gibt, ergibt null statt eines Fehlers.
    expect(await wrapped.momentBildDatenUri('gibt-es-nicht')).toBeNull();
  });

  it('laesst einen Moment nicht loeschen, solange er in einer eingefrorenen Ausgabe steht', async () => {
    await tageswerte('2026-08', { voiceSeconds: 7200, messages: 500 });
    const moment = await wrapped.erstelleMoment(
      GUILD,
      {
        title: 'GameNight',
        description: null,
        happenedOn: '2026-08-09',
        includeMonthly: true,
        includeYearly: false,
        priority: 0,
      },
      AKTEUR,
    );
    const ergebnis = await wrapped.erzeugeAusgabe(GUILD, august(), { jetzt: NACH_AUGUST });
    await wrapped.finalisiereAusgabe(ergebnis.editionId, AKTEUR);

    await expect(wrapped.loescheMoment(moment.id, AKTEUR)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });

    await wrapped.entsperreAusgabe(ergebnis.editionId, AKTEUR);
    await expect(wrapped.loescheMoment(moment.id, AKTEUR)).resolves.toBeUndefined();
  });

  // --- Der bestehende Rueckblick bleibt unberuehrt -------------------------------

  it('laesst die Kampagnen des persoenlichen Rueckblicks unangetastet', async () => {
    const kampagne = await prisma.wrappedCampaign.create({
      data: {
        guildId: GUILD,
        key: '2026',
        title: 'SwissHub Wrapped 2026',
        displayYear: 2026,
        periodStart: new Date('2026-01-01T00:00:00Z'),
        periodEnd: new Date('2027-01-01T00:00:00Z'),
      },
    });

    await tageswerte('2026-08', { voiceSeconds: 7200, messages: 500 });
    await wrapped.erzeugeAusgabe(GUILD, august(), { jetzt: NACH_AUGUST });

    // Zwei verschiedene Dinge in zwei verschiedenen Tabellen.
    expect(await prisma.wrappedCampaign.count()).toBe(1);
    expect((await prisma.wrappedCampaign.findUnique({ where: { id: kampagne.id } }))?.title).toBe(
      'SwissHub Wrapped 2026',
    );
    expect(await prisma.wrappedEdition.count()).toBe(1);
  });
});

/**
 * Ein winziges, echtes PNG.
 *
 * Erzeugt statt eingecheckt: `speichereMomentBild` erkennt das Format an der
 * Signatur der Datei und prueft die Abmessungen, ein Platzhalter aus Nullen
 * kaeme also gar nicht erst durch.
 */
function einPng(): Uint8Array {
  const breite = 480;
  const hoehe = 480;
  const roh = Buffer.alloc((breite * 3 + 1) * hoehe);
  for (let y = 0; y < hoehe; y += 1) {
    const zeile = y * (breite * 3 + 1);
    roh[zeile] = 0;
    for (let x = 0; x < breite; x += 1) {
      roh[zeile + 1 + x * 3] = (x * 255) / breite;
      roh[zeile + 2 + x * 3] = (y * 255) / hoehe;
      roh[zeile + 3 + x * 3] = 128;
    }
  }
  const teil = (typ: string, inhalt: Buffer): Buffer => {
    const koerper = Buffer.concat([Buffer.from(typ, 'ascii'), inhalt]);
    const laenge = Buffer.alloc(4);
    laenge.writeUInt32BE(inhalt.length, 0);
    const summe = Buffer.alloc(4);
    summe.writeUInt32BE(crc32(koerper) >>> 0, 0);
    return Buffer.concat([laenge, koerper, summe]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(breite, 0);
  ihdr.writeUInt32BE(hoehe, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      teil('IHDR', ihdr),
      teil('IDAT', deflateSync(roh)),
      teil('IEND', Buffer.alloc(0)),
    ]),
  );
}
