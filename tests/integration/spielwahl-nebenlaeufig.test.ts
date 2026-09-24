import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_spielwahl_nebenlaeufig');

/**
 * Was passiert, wenn alle gleichzeitig klicken.
 *
 * ## Warum das eine eigene Datei wert ist
 *
 * Weil diese Fehler sich nicht anschauen lassen. Ein doppelt gestartetes
 * Roulette, eine Stimme, die zweimal zählt, zwei Runden mit zwei Gewinnern -
 * all das entsteht aus einem Zeitfenster von wenigen Millisekunden, und
 * niemand stolpert beim Durchlesen darüber. Man sieht es erst am
 * Freitagabend, wenn sechs Leute gleichzeitig auf denselben Knopf drücken.
 *
 * Deshalb wird hier gleichzeitig gedrückt.
 */
const { prisma } = await import('@swisshub/database');
const { spielwahl } = await import('@swisshub/modules');

const GUILD = '000000000000000001';
const FREMDE_GUILD = '000000000000000002';
const ANNA = { discordId: '100000000000000001', username: 'anna' };
const BEN = { discordId: '100000000000000002', username: 'ben' };
const CARA = { discordId: '100000000000000003', username: 'cara' };

async function leeren(): Promise<void> {
  await prisma.spielwahlVote.deleteMany({});
  await prisma.spielwahlRound.deleteMany({});
  await prisma.spielwahlSupport.deleteMany({});
  await prisma.spielwahlCandidate.deleteMany({});
  await prisma.spielwahlCommand.deleteMany({});
  await prisma.spielwahlParticipant.deleteMany({});
  await prisma.spielwahlSession.deleteMany({});
  await prisma.game.deleteMany({});
}

async function spiele(anzahl: number): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 0; index < anzahl; index += 1) {
    const name = `Spiel ${String.fromCharCode(65 + index)}`;
    const spiel = await prisma.game.create({
      data: { name, nameKey: name.toLowerCase(), enabled: true },
    });
    ids.push(spiel.id);
  }
  return ids;
}

async function bereit(anzahl = 4, guildId = GUILD): Promise<string> {
  const gameIds = await spiele(anzahl);
  const session = await spielwahl.eroeffne({
    guildId,
    host: ANNA,
    optionen: { modus: 'ROULETTE', vorschlaegeProPerson: 10 },
  });
  await spielwahl.tritteBei(session.id, BEN.discordId);
  for (const gameId of gameIds) {
    await spielwahl.schlageVor(session.id, ANNA.discordId, { gameId });
  }
  await spielwahl.schliesseVorschlaege(session.id, ANNA);
  return session.id;
}

describeWithDatabase('Was spielen wir?: gleichzeitig', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await leeren();
  });

  it('startet eine Runde genau einmal, auch bei fünf gleichzeitigen Versuchen', async () => {
    /*
     * Der Klassiker: der Host drueckt, nichts passiert sichtbar, er drueckt
     * noch einmal. Ohne Riegel laufen zwei Runden an - und die zweite
     * ueberschreibt den Gewinner der ersten.
     */
    const sessionId = await bereit();

    const ergebnisse = await Promise.allSettled(
      Array.from({ length: 5 }, () => spielwahl.starte(sessionId, ANNA)),
    );

    const erfolgreich = ergebnisse.filter((eintrag) => eintrag.status === 'fulfilled');
    expect(erfolgreich).toHaveLength(1);
    expect(await prisma.spielwahlRound.count({ where: { sessionId } })).toBe(1);
  });

  it('macht aus demselben Befehlsschlüssel genau eine Handlung', async () => {
    const sessionId = await bereit();
    const schluessel = 'abcdefgh12345678';

    const ergebnisse = await Promise.all(
      Array.from({ length: 4 }, () =>
        spielwahl.einmalig(
          { sessionId, schluessel, befehl: 'start', discordId: ANNA.discordId },
          async () => ({ rundenId: await spielwahl.starte(sessionId, ANNA) }),
        ),
      ),
    );

    // Alle bekommen dieselbe Antwort - die des Gewinners.
    const rundenIds = new Set(ergebnisse.map((eintrag) => eintrag?.rundenId).filter(Boolean));
    expect(rundenIds.size).toBe(1);
    expect(await prisma.spielwahlRound.count({ where: { sessionId } })).toBe(1);
  });

  it('gibt den Befehlsschlüssel wieder frei, wenn die Handlung scheitert', async () => {
    /*
     * Sonst waere ein einmaliger Fehler - Netz weg, Datenbank kurz besetzt -
     * eine dauerhafte Sperre fuer genau diese Handlung, und der Knopf bliebe
     * fuer immer wirkungslos.
     */
    const sessionId = await bereit();
    const schluessel = 'zzzzzzzz87654321';

    await expect(
      spielwahl.einmalig({ sessionId, schluessel, befehl: 'test', discordId: ANNA.discordId }, async () => {
        throw new Error('geht gerade nicht');
      }),
    ).rejects.toThrow();

    expect(await prisma.spielwahlCommand.count({ where: { sessionId, schluessel } })).toBe(0);

    // Der zweite Versuch mit demselben Schluessel geht durch.
    const ergebnis = await spielwahl.einmalig(
      { sessionId, schluessel, befehl: 'test', discordId: ANNA.discordId },
      async () => ({ ok: true }),
    );
    expect(ergebnis).toEqual({ ok: true });
  });

  it('schliesst eine Runde genau einmal ab, auch wenn zehn Seiten gleichzeitig prüfen', async () => {
    const sessionId = await bereit();
    const rundenId = await spielwahl.starte(sessionId, ANNA);
    const runde = await prisma.spielwahlRound.findUniqueOrThrow({ where: { id: rundenId } });
    const spaeter = new Date(runde.endsAt!.getTime() + 1);

    const ergebnisse = await Promise.all(
      Array.from({ length: 10 }, () => spielwahl.pruefe(sessionId, spaeter)),
    );

    // Genau eine Pruefung hat tatsaechlich abgeschlossen.
    expect(ergebnisse.filter(Boolean)).toHaveLength(1);
    const nachher = await prisma.spielwahlSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(nachher.status).toBe('ERGEBNIS');
  });

  it('lässt zehn gleichzeitige Beitritte nicht über die Höchstzahl gehen', async () => {
    const session = await spielwahl.eroeffne({
      guildId: GUILD,
      host: ANNA,
      optionen: { maxTeilnehmer: 3 },
    });

    const kennungen = Array.from({ length: 10 }, (_, index) => `20000000000000000${index}`);
    await Promise.allSettled(kennungen.map((discordId) => spielwahl.tritteBei(session.id, discordId)));

    const dabei = await prisma.spielwahlParticipant.count({ where: { sessionId: session.id, leftAt: null } });
    expect(dabei).toBeLessThanOrEqual(3);
  });

  it('hält die Vorschlagsgrenze auch bei gleichzeitigen Vorschlägen ein', async () => {
    const gameIds = await spiele(6);
    const session = await spielwahl.eroeffne({
      guildId: GUILD,
      host: ANNA,
      optionen: { vorschlaegeProPerson: 2 },
    });

    await Promise.allSettled(
      gameIds.map((gameId) => spielwahl.schlageVor(session.id, ANNA.discordId, { gameId })),
    );

    const eigene = await prisma.spielwahlSupport.count({
      where: { discordId: ANNA.discordId, candidate: { sessionId: session.id } },
    });
    expect(eigene).toBeLessThanOrEqual(2);
  });

  it('erzeugt aus gleichzeitigen Vorschlägen desselben Titels genau einen Kandidaten', async () => {
    const [gameId] = await spiele(1);
    const session = await spielwahl.eroeffne({ guildId: GUILD, host: ANNA });
    await spielwahl.tritteBei(session.id, BEN.discordId);
    await spielwahl.tritteBei(session.id, CARA.discordId);

    await Promise.allSettled([
      spielwahl.schlageVor(session.id, ANNA.discordId, { gameId }),
      spielwahl.schlageVor(session.id, BEN.discordId, { gameId }),
      spielwahl.schlageVor(session.id, CARA.discordId, { gameId }),
    ]);

    expect(await prisma.spielwahlCandidate.count({ where: { sessionId: session.id } })).toBe(1);
  });

  it('erhöht die Revision bei jeder Änderung', async () => {
    /*
     * Die Revision ist die einzige Sicherung dagegen, dass ein Browser einen
     * aelteren Stand ueber einen neueren legt. Bliebe sie bei einer Aenderung
     * stehen, saehe der Strom keinen Grund zu senden - und die Buehne stuende
     * still, obwohl sich etwas geaendert hat.
     */
    const session = await spielwahl.eroeffne({ guildId: GUILD, host: ANNA });
    const anfang = await prisma.spielwahlSession.findUniqueOrThrow({ where: { id: session.id } });

    await spielwahl.tritteBei(session.id, BEN.discordId);
    const nachBeitritt = await prisma.spielwahlSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(nachBeitritt.revision).toBeGreaterThan(anfang.revision);

    const [gameId] = await spiele(1);
    await spielwahl.schlageVor(session.id, ANNA.discordId, { gameId });
    const nachVorschlag = await prisma.spielwahlSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(nachVorschlag.revision).toBeGreaterThan(nachBeitritt.revision);

    await spielwahl.verlasse(session.id, BEN.discordId);
    const nachAustritt = await prisma.spielwahlSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(nachAustritt.revision).toBeGreaterThan(nachVorschlag.revision);
  });

  // --- Guild-Isolation ----------------------------------------------------

  it('findet eine Runde einer fremden Guild nicht - weder über Kennung noch über Einladung', async () => {
    const sessionId = await bereit(3, FREMDE_GUILD);
    const session = await prisma.spielwahlSession.findUniqueOrThrow({ where: { id: sessionId } });

    expect(await spielwahl.finde(GUILD, sessionId)).toBeNull();
    expect(await spielwahl.findeUeberEinladung(GUILD, session.inviteToken)).toBeNull();

    // In der eigenen Guild dagegen schon.
    expect(await spielwahl.finde(FREMDE_GUILD, sessionId)).not.toBeNull();
  });

  it('vergibt einen Einladungswert, der nicht zu raten ist', async () => {
    const eine = await spielwahl.eroeffne({ guildId: GUILD, host: ANNA });
    const andere = await spielwahl.eroeffne({ guildId: GUILD, host: BEN });

    for (const session of [eine, andere]) {
      expect(session.inviteToken).toMatch(/^[0-9a-f]{32}$/u);
      // Nicht die Kennung, und keine fortlaufende Nummer.
      expect(session.inviteToken).not.toBe(session.id);
    }
    expect(eine.inviteToken).not.toBe(andere.inviteToken);
  });

  it('lässt niemanden ohne Führungsrolle die Runde steuern', async () => {
    const sessionId = await bereit();
    await expect(spielwahl.starte(sessionId, BEN)).rejects.toThrow();
    await expect(spielwahl.loseNeu(sessionId, BEN)).rejects.toThrow();
    await expect(spielwahl.nochEine(sessionId, BEN)).rejects.toThrow();
    await expect(spielwahl.nimmAn(sessionId, BEN)).rejects.toThrow();
    await expect(spielwahl.entferne(sessionId, ANNA.discordId, BEN)).rejects.toThrow();
  });

  it('lässt einen Co-Host führen, aber nicht die Führung weiterreichen', async () => {
    const sessionId = await bereit();
    await spielwahl.setzeCoHost(sessionId, BEN.discordId, true, ANNA);

    expect(await spielwahl.fuehrt(sessionId, BEN.discordId)).toBe(true);
    // Die Fuehrung uebergibt nur der Host selbst.
    await expect(spielwahl.uebergib(sessionId, CARA.discordId, BEN)).rejects.toThrow();
  });

  it('lässt niemanden ausserhalb der Runde abstimmen', async () => {
    const gameIds = await spiele(3);
    const session = await spielwahl.eroeffne({
      guildId: GUILD,
      host: ANNA,
      optionen: { modus: 'VOTING', vorschlaegeProPerson: 10 },
    });
    for (const gameId of gameIds) {
      await spielwahl.schlageVor(session.id, ANNA.discordId, { gameId });
    }
    await spielwahl.schliesseVorschlaege(session.id, ANNA);
    await spielwahl.starte(session.id, ANNA);

    const kandidaten = await spielwahl.listeKandidaten(session.id);
    await expect(spielwahl.stimme(session.id, CARA.discordId, kandidaten[0]!.id, 0)).rejects.toThrow();
  });

  it('behält abgegebene Stimmen, wenn jemand entfernt wird', async () => {
    /*
     * Sonst waere eine Abstimmung nachtraeglich veraenderbar, indem man
     * Waehler entfernt - und zwar von genau der Person, die den Ausgang
     * beeinflussen moechte.
     */
    const gameIds = await spiele(3);
    const session = await spielwahl.eroeffne({
      guildId: GUILD,
      host: ANNA,
      optionen: { modus: 'VOTING', vorschlaegeProPerson: 10, abstimmdauerSek: 300 },
    });
    await spielwahl.tritteBei(session.id, BEN.discordId);
    await spielwahl.tritteBei(session.id, CARA.discordId);
    for (const gameId of gameIds) {
      await spielwahl.schlageVor(session.id, ANNA.discordId, { gameId });
    }
    await spielwahl.schliesseVorschlaege(session.id, ANNA);
    await spielwahl.starte(session.id, ANNA);

    const kandidaten = await spielwahl.listeKandidaten(session.id);
    await spielwahl.stimme(session.id, BEN.discordId, kandidaten[0]!.id, 0);

    const runde = await prisma.spielwahlRound.findFirstOrThrow({ where: { sessionId: session.id } });
    expect(await prisma.spielwahlVote.count({ where: { roundId: runde.id } })).toBe(1);

    await spielwahl.entferne(session.id, BEN.discordId, ANNA);
    expect(await prisma.spielwahlVote.count({ where: { roundId: runde.id } })).toBe(1);
  });
});
