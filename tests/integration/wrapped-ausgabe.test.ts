import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';
import { crc32, deflateSync } from 'node:zlib';

useTestSchema('test_wrapped_ausgabe');

/*
 * Ein eigenes Upload-Verzeichnis - **vor** dem Import der Module.
 *
 * Ohne das schreibt der Bildtest weiter unten nach `/var/lib/swisshub/uploads`.
 * Auf einem Entwicklungsrechner geht das zufaellig gut; auf dem CI-Runner
 * gibt es das Verzeichnis nicht, und der Lauf endete mit `EACCES`. Genau so
 * ist er gescheitert - lokal gruen, im Gate rot.
 *
 * `storage.ts` liest den Pfad beim Laden in eine Konstante. Das Setzen muss
 * deshalb vor dem `await import` darunter stehen, nicht in einem `beforeAll`
 * - dieselbe Reihenfolge wie in `branding-upload.test.ts`.
 */
process.env.SWISSHUB_UPLOAD_DIR = mkdtempSync(join(tmpdir(), 'swisshub-wrapped-uploads-'));

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

  // --- Die Woche als dritter Zeitraum ---------------------------------------

  it('erzeugt eine Wochenausgabe mit eigenem Schluessel, Titel und Zeitraum', async () => {
    await tageswerte('2026-08', { voiceSeconds: 7200, messages: 500 });

    // 2026-W33: Montag 10.08. bis Sonntag 16.08. - mitten im August, damit
    // die Tageswerte oben den ganzen Zeitraum decken.
    const woche = wrapped.periodeVon('WEEKLY', '2026-W33')!;
    const ergebnis = await wrapped.erzeugeAusgabe(GUILD, woche, { akteur: AKTEUR, jetzt: NACH_AUGUST });

    expect(ergebnis.neu).toBe(true);
    expect(ergebnis.folien).toBeGreaterThan(0);

    const gespeichert = await prisma.wrappedEdition.findUniqueOrThrow({
      where: { id: ergebnis.editionId },
    });
    expect(gespeichert.type).toBe('WEEKLY');
    expect(gespeichert.periodKey).toBe('2026-W33');
    expect(gespeichert.title).toBe('SwissHub Wrapped KW 33 2026');
    expect(gespeichert.subtitle).toBe('Sieben Tage SwissHub.');
    expect(gespeichert.periodStart).toEqual(woche.start);
    expect(gespeichert.periodEnd).toEqual(woche.end);
  });

  it('haelt Woche, Monat und Jahr desselben Servers auseinander', async () => {
    await tageswerte('2026-08', { voiceSeconds: 7200, messages: 500 });

    const woche = await wrapped.erzeugeAusgabe(GUILD, wrapped.periodeVon('WEEKLY', '2026-W33')!, {
      jetzt: NACH_AUGUST,
    });
    const monat = await wrapped.erzeugeAusgabe(GUILD, august(), { jetzt: NACH_AUGUST });

    expect(woche.editionId).not.toBe(monat.editionId);
    expect(await prisma.wrappedEdition.count()).toBe(2);

    // Und ein zweiter Anlauf derselben Woche legt nichts Zweites an.
    const nochmal = await wrapped.erzeugeAusgabe(GUILD, wrapped.periodeVon('WEEKLY', '2026-W33')!, {
      jetzt: NACH_AUGUST,
    });
    expect(nochmal.neu).toBe(false);
    expect(await prisma.wrappedEdition.count()).toBe(2);
  });

  it('bleibt bei der Woche unter ihrer Folienobergrenze', async () => {
    await tageswerte('2026-08', { voiceSeconds: 7200, messages: 500 });

    const woche = await wrapped.erzeugeAusgabe(GUILD, wrapped.periodeVon('WEEKLY', '2026-W33')!, {
      jetzt: NACH_AUGUST,
    });
    const monat = await wrapped.erzeugeAusgabe(GUILD, august(), { jetzt: NACH_AUGUST });

    expect(woche.folien).toBeLessThanOrEqual(wrapped.FOLIEN_OBERGRENZE.WEEKLY);
    // Und weniger als der Monat - das ist der Sinn der kleineren Grenze.
    expect(woche.folien).toBeLessThanOrEqual(monat.folien);
  });

  it('erzeugt keine Wochenausgabe fuer eine laufende Woche', async () => {
    const woche = wrapped.periodeVon('WEEKLY', '2026-W33')!;
    // Mittwoch derselben Woche.
    const mittendrin = new Date('2026-08-12T10:00:00Z');

    await expect(wrapped.erzeugeAusgabe(GUILD, woche, { jetzt: mittendrin })).rejects.toThrow();
    expect(await prisma.wrappedEdition.count()).toBe(0);
  });

  it('nimmt einen fuer den Monat vorgemerkten Moment auch in die Woche, in der er war', async () => {
    await tageswerte('2026-08', { voiceSeconds: 7200, messages: 500 });
    await wrapped.erstelleMoment(
      GUILD,
      {
        title: 'GameNight',
        description: null,
        // Mittwoch der Woche 33.
        happenedOn: '2026-08-12',
        includeMonthly: true,
        includeYearly: false,
        priority: 0,
      },
      AKTEUR,
    );

    const inDerWoche = await wrapped.erzeugeAusgabe(GUILD, wrapped.periodeVon('WEEKLY', '2026-W33')!, {
      jetzt: NACH_AUGUST,
    });
    const ansicht = await wrapped.ladeAusgabe(inDerWoche.editionId);
    expect(ansicht?.folien.some((folie) => folie.storyKey === 'community_moment')).toBe(true);

    // Und nicht in eine Woche, in der er nicht war.
    const danach = await wrapped.erzeugeAusgabe(GUILD, wrapped.periodeVon('WEEKLY', '2026-W34')!, {
      jetzt: NACH_AUGUST,
    });
    const ansichtDanach = await wrapped.ladeAusgabe(danach.editionId);
    expect(ansichtDanach?.folien.some((folie) => folie.storyKey === 'community_moment')).toBe(false);
  });

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

  // --- Teilweise erhobene Zeitraeume ---------------------------------------

  /** Die Messung beginnt mitten im August - knapp die Haelfte des Monats. */
  async function messungErstAbMitteAugust(): Promise<void> {
    await prisma.analyticsTracking.updateMany({
      where: { guildId: GUILD },
      data: { voiceSince: new Date('2026-08-17T00:00:00Z') },
    });
  }

  it('zeigt die Zahl auch bei halb erhobenem Zeitraum - mit Hinweis', async () => {
    await tageswerte('2026-08', { voiceSeconds: 7200, messages: 500 });
    await messungErstAbMitteAugust();

    const ergebnis = await wrapped.erzeugeAusgabe(GUILD, august(), { jetzt: NACH_AUGUST });
    const ansicht = await wrapped.ladeAusgabe(ergebnis.editionId);
    const folie = ansicht?.folien.find((eintrag) => eintrag.storyKey === 'voice_total');

    /*
     * Vorher entfiel diese Folie. Wer im August angefangen hat zu messen,
     * bekam **keine** Sprachzeit - obwohl die halbe Strecke gemessen wurde
     * und die Zahlen stimmen. Aus «unvollstaendig» wurde «nicht vorhanden»,
     * und das ist nicht ehrlicher, sondern nur leerer.
     */
    expect(folie).toBeDefined();
    // Und sie sagt, woran sie haengt - mit Datum und Anteil, nicht mit
    // «teilweise».
    expect(folie?.erhebung).toContain('2026-08-17');
    expect(folie?.erhebung).toMatch(/\d+ %/u);
  });

  it('haengt keinen Hinweis an eine Folie, die den ganzen Zeitraum abdeckt', async () => {
    await tageswerte('2026-08', { voiceSeconds: 7200, messages: 500 });

    const ergebnis = await wrapped.erzeugeAusgabe(GUILD, august(), { jetzt: NACH_AUGUST });
    const ansicht = await wrapped.ladeAusgabe(ergebnis.editionId);
    const folie = ansicht?.folien.find((eintrag) => eintrag.storyKey === 'voice_total');

    // Ein Hinweis, der immer dasteht, sagt nichts mehr.
    expect(folie?.erhebung).toBeNull();
  });

  it('nimmt den Hinweis weg, sobald die Quelle den Zeitraum voll abdeckt', async () => {
    await tageswerte('2026-08', { voiceSeconds: 7200, messages: 500 });
    await messungErstAbMitteAugust();
    const ergebnis = await wrapped.erzeugeAusgabe(GUILD, august(), { jetzt: NACH_AUGUST });

    /*
     * Der Hinweis beschreibt die Datenlage, nicht die Folie - also darf er
     * beim naechsten Durchgang nicht von der alten Folie uebernommen werden.
     * Hier wird korrigiert, seit wann gemessen wurde (das kommt vor: die
     * Marke wurde zu spaet gesetzt), und danach ist der Satz falsch.
     */
    await prisma.analyticsTracking.updateMany({
      where: { guildId: GUILD },
      data: { voiceSince: new Date('2025-01-01T00:00:00Z') },
    });
    /*
     * Ohne `jetzt`: `regeneriereAusgabe` nimmt die echte Uhr, und der August
     * 2026 liegt in der Vergangenheit - ein Zeitraum, der laeuft, wuerde
     * ohnehin abgelehnt.
     */
    await wrapped.regeneriereAusgabe(ergebnis.editionId, { akteur: AKTEUR });

    const ansicht = await wrapped.ladeAusgabe(ergebnis.editionId);
    expect(ansicht?.folien.find((eintrag) => eintrag.storyKey === 'voice_total')?.erhebung).toBeNull();
  });

  it('laesst eine Folie weiterhin weg, wenn gar nicht gemessen wurde', async () => {
    await tageswerte('2026-08', { voiceSeconds: 7200, messages: 500 });
    /*
     * Gemessen wird erst ab Oktober - der August ist eine Luecke, kein
     * Teilstueck. (Eine **fehlende** Markierung heisst dagegen «von Anfang
     * an gemessen»; das ist der Normalfall eines Servers, der schon lief,
     * bevor es die Marke gab.)
     */
    await prisma.analyticsTracking.updateMany({
      where: { guildId: GUILD },
      data: { voiceSince: new Date('2026-10-01T00:00:00Z') },
    });

    const ergebnis = await wrapped.erzeugeAusgabe(GUILD, august(), { jetzt: NACH_AUGUST });
    const ansicht = await wrapped.ladeAusgabe(ergebnis.editionId);

    /*
     * Die Gegenprobe zur Lockerung. «Teilweise» heisst «zeigen und
     * kennzeichnen», «fehlt» heisst weiterhin «weglassen»: eine Zahl ohne
     * Messung waere erfunden, und keine Kennzeichnung macht sie wahr.
     */
    expect(ansicht?.folien.some((eintrag) => eintrag.storyKey === 'voice_total')).toBe(false);
    expect(ansicht?.gruende.some((grund) => grund.lage === 'nicht_erhoben')).toBe(true);
  });

  // --- Eine Ausgabe loeschen ----------------------------------------------

  it('loescht eine Ausgabe samt ihren Folien', async () => {
    await tageswerte('2026-08', { voiceSeconds: 7200, messages: 500 });
    const ergebnis = await wrapped.erzeugeAusgabe(GUILD, august(), { jetzt: NACH_AUGUST });
    expect(await prisma.wrappedSlide.count({ where: { editionId: ergebnis.editionId } })).toBeGreaterThan(0);

    await wrapped.loescheAusgabe(ergebnis.editionId, AKTEUR);

    expect(await prisma.wrappedEdition.count({ where: { id: ergebnis.editionId } })).toBe(0);
    // Die Folien haengen mit `Cascade` daran - sonst blieben Waisen stehen,
    // die niemand mehr findet und niemand mehr aufraeumt.
    expect(await prisma.wrappedSlide.count({ where: { editionId: ergebnis.editionId } })).toBe(0);
  });

  it('laesst den Community Moment stehen, der in der Ausgabe stand', async () => {
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
    const vorher = await wrapped.ladeAusgabe(ergebnis.editionId);
    expect(vorher?.folien.some((folie) => folie.momentId === moment.id)).toBe(true);

    await wrapped.loescheAusgabe(ergebnis.editionId, AKTEUR);

    /*
     * Die wichtigste Zusage des Loeschens. Eine Folie **zeigt** auf einen
     * Moment, sie besitzt ihn nicht: das Bild gehoert der Momentverwaltung und
     * kann in mehreren Ausgaben vorkommen. Mitzuloeschen hiesse, aus «diesen
     * Rueckblick wegwerfen» ein «dieses Bild ueberall wegwerfen» zu machen.
     */
    expect(await prisma.wrappedMoment.count({ where: { id: moment.id } })).toBe(1);
  });

  it('haelt das Loeschen in der Pruefspur fest', async () => {
    await tageswerte('2026-08', { voiceSeconds: 7200, messages: 500 });
    const ergebnis = await wrapped.erzeugeAusgabe(GUILD, august(), { jetzt: NACH_AUGUST });
    const folien = await prisma.wrappedSlide.count({ where: { editionId: ergebnis.editionId } });

    await wrapped.loescheAusgabe(ergebnis.editionId, AKTEUR);

    const eintrag = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'WRAPPED_EDITION_DELETED' },
    });
    // Nach dem Loeschen ist die Zeile weg - was es gab, steht nur noch hier.
    expect(eintrag.targetLabel).toBe('2026-08');
    expect((eintrag.metadata as { folien?: unknown }).folien).toBe(folien);
    expect(eintrag.actorDiscordId).toBe(AKTEUR.discordId);
  });

  it('loescht auch eine eingefrorene Ausgabe', async () => {
    await tageswerte('2026-08', { voiceSeconds: 7200, messages: 500 });
    const ergebnis = await wrapped.erzeugeAusgabe(GUILD, august(), { jetzt: NACH_AUGUST });
    await wrapped.finalisiereAusgabe(ergebnis.editionId, AKTEUR);
    expect(
      (await prisma.wrappedEdition.findUniqueOrThrow({ where: { id: ergebnis.editionId } })).status,
    ).toBe('FINALIZED');

    /*
     * Einfrieren und Loeschen sind zwei Handlungen, nicht zwei Stufen
     * derselben. Eine eingefrorene Ausgabe ist gegen **Aenderung** geschuetzt
     * - gegen stilles Nachrechnen, nicht gegen eine ausdrueckliche
     * Entscheidung mit eigener Berechtigung. Waere sie unloeschbar, haette ein
     * Probelauf, den jemand versehentlich eingefroren hat, Bestand fuer immer.
     */
    await wrapped.loescheAusgabe(ergebnis.editionId, AKTEUR);

    expect(await prisma.wrappedEdition.count({ where: { id: ergebnis.editionId } })).toBe(0);
    const eintrag = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'WRAPPED_EDITION_DELETED' },
    });
    // Der Zustand vor dem Schnitt steht in der Pruefspur - sonst waere
    // hinterher nicht erkennbar, dass hier etwas Festgeschriebenes wegfiel.
    expect((eintrag.metadata as { status?: unknown }).status).toBe('FINALIZED');
  });

  it('nimmt der Ausgabe auch die gespeicherten Folienstaende', async () => {
    await tageswerte('2026-08', { voiceSeconds: 7200, messages: 500 });
    const ergebnis = await wrapped.erzeugeAusgabe(GUILD, august(), { jetzt: NACH_AUGUST });
    const gespeichert = await prisma.wrappedSlide.findMany({
      where: { editionId: ergebnis.editionId },
      select: { snapshotData: true },
    });
    expect(gespeichert.length).toBeGreaterThan(0);
    expect(gespeichert.every((folie) => folie.snapshotData !== null)).toBe(true);

    await wrapped.loescheAusgabe(ergebnis.editionId, AKTEUR);

    /*
     * Die erhobenen Zahlen stehen in `snapshotData` je Folie, und daraus
     * entstehen die Bilder und die Social-Exporte. Mit den Folien ist damit
     * auch die Grundlage jedes Exports weg - es gibt keine zweite Ablage,
     * aus der sich die Ausgabe hinterher noch zeichnen liesse.
     */
    expect(await wrapped.ladeAusgabe(ergebnis.editionId)).toBeNull();
    expect(await prisma.wrappedSlide.count({ where: { editionId: ergebnis.editionId } })).toBe(0);
    // Und keine Waise irgendwo sonst in der Tabelle.
    expect(await prisma.wrappedSlide.count({})).toBe(0);
  });

  it('laesst einen Moment stehen, der noch in einer zweiten Ausgabe steckt', async () => {
    await tageswerte('2026-08', { voiceSeconds: 7200, messages: 500 });
    await tageswerte('2026-09', { voiceSeconds: 7200, messages: 500 });
    const moment = await wrapped.erstelleMoment(
      GUILD,
      {
        title: 'LAN im Herbst',
        description: null,
        happenedOn: '2026-08-09',
        includeMonthly: true,
        includeYearly: true,
        priority: 0,
      },
      AKTEUR,
    );
    const august_ = await wrapped.erzeugeAusgabe(GUILD, august(), { jetzt: NACH_AUGUST });
    /*
     * Derselbe Moment in zwei Ausgaben: `includeYearly` setzt ihn auch in
     * den Jahresrueckblick. Das ist der Fall, auf den es ankommt - ein
     * Anhang, der **nicht** ausschliesslich zu dieser einen Ausgabe gehoert.
     */
    const jahr = await wrapped.erzeugeAusgabe(GUILD, wrapped.periodeVon('YEARLY', '2026')!, {
      jetzt: new Date('2027-01-02T12:00:00Z'),
    });

    await wrapped.loescheAusgabe(august_.editionId, AKTEUR);

    expect(await prisma.wrappedMoment.count({ where: { id: moment.id } })).toBe(1);
    // Und die andere Ausgabe zeigt weiterhin darauf.
    const uebrig = await wrapped.ladeAusgabe(jahr.editionId);
    expect(uebrig).not.toBeNull();
    expect(await prisma.wrappedSlide.count({ where: { editionId: jahr.editionId } })).toBeGreaterThan(0);
  });

  it('loescht nichts, was es nicht gibt', async () => {
    await expect(wrapped.loescheAusgabe('gibt-es-nicht', AKTEUR)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await prisma.auditLog.count({ where: { action: 'WRAPPED_EDITION_DELETED' } })).toBe(0);
  });

  it('loescht denselben Zeitraum nur einmal', async () => {
    await tageswerte('2026-08', { voiceSeconds: 7200, messages: 500 });
    const ergebnis = await wrapped.erzeugeAusgabe(GUILD, august(), { jetzt: NACH_AUGUST });

    await wrapped.loescheAusgabe(ergebnis.editionId, AKTEUR);
    // Der zweite Versuch findet nichts mehr - und schreibt deshalb auch
    // keinen zweiten Protokolleintrag.
    await expect(wrapped.loescheAusgabe(ergebnis.editionId, AKTEUR)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await prisma.auditLog.count({ where: { action: 'WRAPPED_EDITION_DELETED' } })).toBe(1);
  });

  it('gibt den Zeitraum nach dem Loeschen wieder frei', async () => {
    await tageswerte('2026-08', { voiceSeconds: 7200, messages: 500 });
    const erste = await wrapped.erzeugeAusgabe(GUILD, august(), { jetzt: NACH_AUGUST });
    await wrapped.loescheAusgabe(erste.editionId, AKTEUR);

    /*
     * Der Riegel `@@unique([guildId, type, periodKey])` ist der Grund, weshalb
     * es zweimal denselben Monat nicht geben kann. Nach dem Loeschen muss er
     * wieder offen sein - sonst waere ein versehentlich geloeschter August
     * fuer immer verloren.
     */
    const zweite = await wrapped.erzeugeAusgabe(GUILD, august(), { jetzt: NACH_AUGUST });
    expect(zweite.editionId).not.toBe(erste.editionId);
    expect(zweite.folien).toBeGreaterThan(0);
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
