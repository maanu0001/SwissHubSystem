import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_fragt_loeschen');

/**
 * Entwürfe und Ergebnisse löschen.
 *
 * ## Die eine Zusage, die hier festgenagelt wird
 *
 * **Ein Ergebnis zu löschen darf die Frage nicht mitnehmen.** Das folgt aus
 * der Richtung der Kaskade im Datenmodell - `FragtFrage → FragtAbstimmung`,
 * nie umgekehrt -, und genau deshalb steht es hier: eine Zusage, die aus einer
 * Schemaeigenschaft folgt, bricht nicht beim nächsten Umbau der Funktion,
 * sondern beim nächsten Umbau des Schemas. Dieser Test merkt beides.
 *
 * ## Warum gegen eine echte Datenbank
 *
 * Weil die Kaskade die Sache ist, um die es geht. Eine Attrappe würde
 * zurückgeben, was man ihr sagt; hier zählt, was PostgreSQL mit den
 * Fremdschlüsseln tut - welche Zeilen danach noch stehen und welche nicht.
 */
const { prisma } = await import('@swisshub/database');
const { fragt } = await import('@swisshub/modules');

const GUILD = '000000000000000001';
const ADMIN = { discordId: '100000000000000009', username: 'admin' };

interface Aufbau {
  frageId: string;
  abstimmungId: string;
  entwurfId: string;
  optionIds: string[];
}

/** Frage, Abstimmung, zwei Stimmen und ein Entwurf - ein ganzer Durchgang. */
async function baueDurchgang(): Promise<Aufbau> {
  const frage = await prisma.fragtFrage.create({
    data: {
      guildId: GUILD,
      text: 'Welches Game am Freitag?',
      kategorie: 'Gaming',
      typ: 'UMFRAGE',
      status: 'CLOSED',
      tags: [],
      optionen: {
        create: [
          { label: 'Deep Rock Galactic', position: 0 },
          { label: 'Lethal Company', position: 1 },
        ],
      },
    },
  });
  const optionen = await prisma.fragtOption.findMany({
    where: { frageId: frage.id },
    orderBy: { position: 'asc' },
  });

  const abstimmung = await prisma.fragtAbstimmung.create({
    data: {
      guildId: GUILD,
      frageId: frage.id,
      frageText: frage.text,
      typ: frage.typ,
      status: 'CLOSED',
      channelId: '000000000000000099',
      opensAt: new Date(Date.now() - 86_400_000),
      closesAt: new Date(Date.now() - 3_600_000),
      closedAt: new Date(Date.now() - 3_600_000),
      finalVotes: 2,
      ergebnis: {
        version: 1,
        zeilen: [
          { optionId: optionen[0]!.id, label: optionen[0]!.label, position: 0, stimmen: 2 },
          { optionId: optionen[1]!.id, label: optionen[1]!.label, position: 1, stimmen: 0 },
        ],
      },
    },
  });

  await prisma.fragtStimme.createMany({
    data: [
      { abstimmungId: abstimmung.id, optionId: optionen[0]!.id, voterDiscordId: '100000000000000001' },
      { abstimmungId: abstimmung.id, optionId: optionen[0]!.id, voterDiscordId: '100000000000000002' },
    ],
  });

  const entwurf = await prisma.fragtEntwurf.create({
    data: {
      abstimmungId: abstimmung.id,
      status: 'OFFEN',
      vorlage: 'winner',
      format: 'story',
      ueberschrift: frage.text,
      cta: 'Sag es uns auf Discord.',
      folien: [{ art: 'gewinner', aktiv: true, position: 0 }],
      medienDatei: 'beispiel.png',
      exportAkzentfarbe: '#1f8f3d',
    },
  });

  return {
    frageId: frage.id,
    abstimmungId: abstimmung.id,
    entwurfId: entwurf.id,
    optionIds: optionen.map((option) => option.id),
  };
}

describeWithDatabase('SwissHub fragt: löschen', () => {
  beforeAll(async () => {
    await pushSchema();
  });

  beforeEach(async () => {
    await prisma.auditLog.deleteMany({});
    await prisma.fragtStimme.deleteMany({});
    await prisma.fragtEntwurf.deleteMany({});
    await prisma.fragtAbstimmung.deleteMany({});
    await prisma.fragtOption.deleteMany({});
    await prisma.fragtFrage.deleteMany({});
  });

  // --- Entwurf --------------------------------------------------------------

  it('löscht einen Entwurf und lässt das Ergebnis stehen', async () => {
    const { entwurfId, abstimmungId, frageId } = await baueDurchgang();

    await fragt.loescheEntwurf(entwurfId, ADMIN);

    expect(await prisma.fragtEntwurf.findUnique({ where: { id: entwurfId } })).toBeNull();
    // Das Ergebnis ist die Arbeit der Community, der Entwurf die des Teams.
    expect(await prisma.fragtAbstimmung.findUnique({ where: { id: abstimmungId } })).not.toBeNull();
    expect(await prisma.fragtFrage.findUnique({ where: { id: frageId } })).not.toBeNull();
    expect(await prisma.fragtStimme.count({ where: { abstimmungId } })).toBe(2);
  });

  it('schreibt das Löschen eines Entwurfs ins Protokoll', async () => {
    const { entwurfId, abstimmungId } = await baueDurchgang();
    await fragt.loescheEntwurf(entwurfId, ADMIN);

    const eintrag = await prisma.auditLog.findFirst({ where: { action: 'FRAGT_DRAFT_DELETED' } });
    expect(eintrag).not.toBeNull();
    expect(eintrag?.actorDiscordId).toBe(ADMIN.discordId);
    expect(eintrag?.targetLabel).toBe('Welches Game am Freitag?');
    expect((eintrag?.metadata as { abstimmungId?: string } | null)?.abstimmungId).toBe(abstimmungId);
  });

  it('löscht einen Entwurf auch dann, wenn er als veröffentlicht markiert ist', async () => {
    /*
     * `bearbeiteEntwurf` weist einen veroeffentlichten Entwurf ab, und das ist
     * richtig: was auf Instagram steht, soll nicht nachtraeglich anders hier
     * stehen. Loeschen behauptet nichts - es raeumt auf, und das Protokoll
     * haelt fest, dass der Eintrag bestand.
     */
    const { entwurfId } = await baueDurchgang();
    await prisma.fragtEntwurf.update({
      where: { id: entwurfId },
      data: { status: 'VEROEFFENTLICHT' },
    });

    await fragt.loescheEntwurf(entwurfId, ADMIN);
    expect(await prisma.fragtEntwurf.findUnique({ where: { id: entwurfId } })).toBeNull();
  });

  it('meldet einen unbekannten Entwurf als nicht gefunden', async () => {
    await expect(fragt.loescheEntwurf('cmxxxxxxxxxxxxxxxxxxxxxxx', ADMIN)).rejects.toThrow();
  });

  // --- Ergebnis -------------------------------------------------------------

  it('löscht ein Ergebnis samt Stimmen und Entwurf - und lässt die Frage stehen', async () => {
    const { abstimmungId, frageId, entwurfId, optionIds } = await baueDurchgang();

    await fragt.loescheAbstimmung(abstimmungId, ADMIN);

    expect(await prisma.fragtAbstimmung.findUnique({ where: { id: abstimmungId } })).toBeNull();
    expect(await prisma.fragtStimme.count({ where: { abstimmungId } })).toBe(0);
    expect(await prisma.fragtEntwurf.findUnique({ where: { id: entwurfId } })).toBeNull();

    /*
     * **Die Zusage.** Die Frage bleibt, und mit ihr ihre Antwortoptionen -
     * sonst waere die Frage nach dem Loeschen eines Durchgangs eine Frage
     * ohne Antworten und damit nicht mehr stellbar.
     */
    const frage = await prisma.fragtFrage.findUnique({ where: { id: frageId } });
    expect(frage).not.toBeNull();
    expect(frage?.text).toBe('Welches Game am Freitag?');
    expect(await prisma.fragtOption.count({ where: { id: { in: optionIds } } })).toBe(2);
  });

  it('lässt die Frage auch bei mehreren Durchgängen stehen', async () => {
    /*
     * Der Fall, in dem eine Frage zweimal gestellt wurde. Einen Durchgang zu
     * loeschen darf den anderen nicht beruehren - sonst waere «Ergebnis
     * loeschen» in Wahrheit «Fragengeschichte loeschen».
     */
    const erster = await baueDurchgang();
    const zweiter = await prisma.fragtAbstimmung.create({
      data: {
        guildId: GUILD,
        frageId: erster.frageId,
        frageText: 'Welches Game am Freitag?',
        typ: 'UMFRAGE',
        status: 'CLOSED',
        channelId: '000000000000000099',
        opensAt: new Date(Date.now() - 172_800_000),
        closesAt: new Date(Date.now() - 90_000_000),
        closedAt: new Date(Date.now() - 90_000_000),
        finalVotes: 5,
      },
    });

    await fragt.loescheAbstimmung(erster.abstimmungId, ADMIN);

    expect(await prisma.fragtFrage.findUnique({ where: { id: erster.frageId } })).not.toBeNull();
    expect(await prisma.fragtAbstimmung.findUnique({ where: { id: zweiter.id } })).not.toBeNull();
  });

  it('weist eine laufende Abstimmung ab', async () => {
    const { abstimmungId } = await baueDurchgang();
    await prisma.fragtAbstimmung.update({
      where: { id: abstimmungId },
      data: { status: 'ACTIVE', closedAt: null },
    });

    /*
     * Eine laufende Abstimmung mitten im Satz abzuschneiden hiesse: auf
     * Discord stehen Knoepfe, die ins Nichts fuehren, und abgegebene Stimmen
     * verschwinden, ohne dass jemand ein Ergebnis gesehen haette.
     */
    await expect(fragt.loescheAbstimmung(abstimmungId, ADMIN)).rejects.toThrow();
    expect(await prisma.fragtAbstimmung.findUnique({ where: { id: abstimmungId } })).not.toBeNull();
  });

  it('schreibt das Löschen eines Ergebnisses ins Protokoll - mit der bleibenden Frage', async () => {
    const { abstimmungId, frageId } = await baueDurchgang();
    await fragt.loescheAbstimmung(abstimmungId, ADMIN);

    const eintrag = await prisma.auditLog.findFirst({ where: { action: 'FRAGT_POLL_DELETED' } });
    expect(eintrag).not.toBeNull();
    expect(eintrag?.actorDiscordId).toBe(ADMIN.discordId);
    const metadaten = eintrag?.metadata as { frageBleibt?: string; stimmen?: number } | null;
    // Nachpruefbar statt behauptet: wer wissen will, ob eine Frage mitging,
    // findet hier ihre Kennung und kann sie nachschlagen.
    expect(metadaten?.frageBleibt).toBe(frageId);
    expect(metadaten?.stimmen).toBe(2);
  });

  it('meldet eine unbekannte Abstimmung als nicht gefunden', async () => {
    await expect(fragt.loescheAbstimmung('cmxxxxxxxxxxxxxxxxxxxxxxx', ADMIN)).rejects.toThrow();
  });
});
