import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_spielwahl_e2e');

/**
 * Ein ganzer Abend mit sechs Leuten.
 *
 * ## Warum sechs und nicht zwei
 *
 * Weil die Fehler, um die es hier geht, erst bei mehreren auftreten: ein
 * Gleichstand braucht mindestens vier Stimmen, ein «alle haben gewählt»
 * braucht jemanden, der noch nicht gewählt hat, und ein Turnierbaum, der
 * sich bei ungerader Anzahl verhakt, tut das erst ab drei Kandidaten.
 *
 * Die Teilnehmer sind hier Funktionsaufrufe und keine Browser. Was sie
 * aufrufen, ist dasselbe, was auch die Oberfläche aufruft - dazwischen liegt
 * nur `defineAction`, und das prüft Anmeldung und Rechte, nicht die Fachlogik.
 */
const { prisma } = await import('@swisshub/database');
const { spielwahl } = await import('@swisshub/modules');

const GUILD = '000000000000000001';
const LEUTE = Array.from({ length: 6 }, (_, index) => ({
  discordId: `10000000000000000${index + 1}`,
  username: `person${index + 1}`,
}));
const [HOST, ...GAESTE] = LEUTE as [(typeof LEUTE)[number], ...Array<(typeof LEUTE)[number]>];

async function leeren(): Promise<void> {
  await prisma.spielwahlVote.deleteMany({});
  await prisma.spielwahlRound.deleteMany({});
  await prisma.spielwahlSupport.deleteMany({});
  await prisma.spielwahlCandidate.deleteMany({});
  await prisma.spielwahlCommand.deleteMany({});
  await prisma.spielwahlParticipant.deleteMany({});
  await prisma.spielwahlSession.deleteMany({});
  await prisma.spielersucheGame.deleteMany({});
}

async function spiele(anzahl: number): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 0; index < anzahl; index += 1) {
    const name = `Spiel ${String.fromCharCode(65 + index)}`;
    const spiel = await prisma.spielersucheGame.create({
      data: { name, nameKey: name.toLowerCase(), roleId: `4000000000000000${index}0`, enabled: true },
    });
    ids.push(spiel.id);
  }
  return ids;
}

/** Spielt eine Ausscheidung bis zum Ende - jeder stimmt für die linke Seite. */
async function spieleTurnierDurch(sessionId: string, rundenId: string, waehler: typeof LEUTE): Promise<void> {
  for (let schritt = 0; schritt < 60; schritt += 1) {
    const runde = await prisma.spielwahlRound.findUniqueOrThrow({ where: { id: rundenId } });
    if (runde.status !== 'LAEUFT') {
      return;
    }
    const paarung = spielwahl.modi.aktuellesDuell(spielwahl.modi.leseBaum(runde.baum), runde.duellIndex);
    if (!paarung || paarung.b === null) {
      await spielwahl.pruefe(sessionId);
      continue;
    }
    for (const person of waehler) {
      await spielwahl.stimme(sessionId, person.discordId, paarung.a, paarung.nr);
    }
  }
  throw new Error('Das Turnier ist nicht zum Ende gekommen.');
}

describeWithDatabase('Was spielen wir?: ein Abend zu sechst', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await leeren();
  });

  it('geht den ganzen Ablauf durch: beitreten, vorschlagen, abstimmen, annehmen', async () => {
    const gameIds = await spiele(5);
    const session = await spielwahl.eroeffne({
      guildId: GUILD,
      host: HOST,
      optionen: { modus: 'VOTING', vorschlaegeProPerson: 1 },
    });

    // 2. Mitglieder treten bei.
    for (const person of GAESTE) {
      expect(await spielwahl.tritteBei(session.id, person.discordId)).toBe('neu');
    }

    // 3. Alle schlagen vor - jeder ein anderes Spiel.
    for (const [index, person] of LEUTE.entries()) {
      await spielwahl.schlageVor(session.id, person.discordId, { gameId: gameIds[index % gameIds.length] });
    }
    // Sechs Leute, fuenf Spiele: eines hat zwei Unterstuetzer, es bleiben fuenf Kandidaten.
    expect(await spielwahl.listeKandidaten(session.id)).toHaveLength(5);

    // 4. Der Host schliesst die Phase.
    await spielwahl.schliesseVorschlaege(session.id, HOST);

    // 5./6. Die Kandidaten stehen, die Runde startet.
    const kandidaten = (await spielwahl.listeKandidaten(session.id)).map((eintrag) => eintrag.id);
    const rundenId = await spielwahl.starte(session.id, HOST);

    // 7. Alle stimmen - vier fuer den einen, zwei fuer den anderen.
    for (const person of LEUTE.slice(0, 4)) {
      await spielwahl.stimme(session.id, person.discordId, kandidaten[0]!, 0);
    }
    for (const person of LEUTE.slice(4)) {
      await spielwahl.stimme(session.id, person.discordId, kandidaten[1]!, 0);
    }

    // 8. Das Ergebnis steht, sobald alle gewaehlt haben - ohne auf den Timer zu warten.
    const runde = await prisma.spielwahlRound.findUniqueOrThrow({ where: { id: rundenId } });
    expect(runde.status).toBe('FERTIG');
    expect(runde.gewinnerCandidateId).toBe(kandidaten[0]);

    // 9./10. Angenommen.
    await spielwahl.nimmAn(session.id, HOST);
    const fertig = await prisma.spielwahlSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(fertig.status).toBe('ABGESCHLOSSEN');
    expect(fertig.ergebnisCandidateId).toBe(kandidaten[0]);

    // Und der Schnappschuss, den alle sehen, stimmt dazu.
    const stand = await spielwahl.baueAnsicht(session.id, GAESTE[0]!.discordId);
    expect(stand?.status).toBe('ABGESCHLOSSEN');
    expect(stand?.ergebnisCandidateId).toBe(kandidaten[0]);
    expect(stand?.teilnehmer).toHaveLength(6);
    // Nach dem Ende sind die Stimmen sichtbar - vorher waren sie es nicht.
    expect(stand?.runde?.stimmen?.[kandidaten[0]!]).toBe(4);
  });

  it('hält geheime Stimmen bis zum Schluss zurück - auch im Schnappschuss', async () => {
    /*
     * Der Kern der Zusage: was der Browser nicht bekommt, kann niemand
     * aufdecken. Eine Oberflaeche, die die Zahlen hat und ausblendet,
     * blendet sie nur so lange aus, bis jemand die Netzwerkanfragen ansieht.
     */
    const gameIds = await spiele(3);
    const session = await spielwahl.eroeffne({
      guildId: GUILD,
      host: HOST,
      optionen: { modus: 'VOTING', vorschlaegeProPerson: 5, geheimeStimmen: true, abstimmdauerSek: 300 },
    });
    for (const person of GAESTE) {
      await spielwahl.tritteBei(session.id, person.discordId);
    }
    for (const gameId of gameIds) {
      await spielwahl.schlageVor(session.id, HOST.discordId, { gameId });
    }
    await spielwahl.schliesseVorschlaege(session.id, HOST);
    const kandidaten = (await spielwahl.listeKandidaten(session.id)).map((eintrag) => eintrag.id);
    await spielwahl.starte(session.id, HOST);

    await spielwahl.stimme(session.id, HOST.discordId, kandidaten[0]!, 0);

    const waehrend = await spielwahl.baueAnsicht(session.id, GAESTE[0]!.discordId);
    expect(waehrend?.runde?.stimmen).toBeNull();
    // Wie viele schon gewaehlt haben, steht drin - das nimmt das Warten, ohne
    // das Ergebnis vorwegzunehmen.
    expect(waehrend?.runde?.abgegeben).toBe(1);
    // Und die eigene Stimme sieht man - die kennt man ohnehin.
    expect(waehrend?.runde?.eigeneStimmen).toEqual([]);

    const beimHost = await spielwahl.baueAnsicht(session.id, HOST.discordId);
    expect(beimHost?.runde?.eigeneStimmen).toEqual([kandidaten[0]]);
  });

  it('spielt eine Ausscheidung zu sechst mit fünf Spielen bis zum Sieger durch', async () => {
    const gameIds = await spiele(5);
    const session = await spielwahl.eroeffne({
      guildId: GUILD,
      host: HOST,
      optionen: { modus: 'ELIMINATION', vorschlaegeProPerson: 5 },
    });
    for (const person of GAESTE) {
      await spielwahl.tritteBei(session.id, person.discordId);
    }
    for (const gameId of gameIds) {
      await spielwahl.schlageVor(session.id, HOST.discordId, { gameId });
    }
    await spielwahl.schliesseVorschlaege(session.id, HOST);
    const kandidaten = (await spielwahl.listeKandidaten(session.id)).map((eintrag) => eintrag.id);
    const rundenId = await spielwahl.starte(session.id, HOST);

    await spieleTurnierDurch(session.id, rundenId, LEUTE);

    const fertig = await prisma.spielwahlRound.findUniqueOrThrow({ where: { id: rundenId } });
    expect(fertig.status).toBe('FERTIG');
    expect(kandidaten).toContain(fertig.gewinnerCandidateId);

    // Jedes Duell hat eine eigene Nummer - keine Stimme zaehlt zweimal.
    const stimmen = await prisma.spielwahlVote.findMany({ where: { roundId: rundenId } });
    const duelle = new Set(stimmen.map((stimme) => stimme.duell));
    expect(duelle.size).toBeGreaterThanOrEqual(3);
    for (const duell of duelle) {
      const je = stimmen.filter((stimme) => stimme.duell === duell);
      expect(new Set(je.map((stimme) => stimme.discordId)).size).toBe(je.length);
    }
  });

  it('überlebt es, wenn mittendrin jemand geht - auch der Host', async () => {
    const gameIds = await spiele(4);
    const session = await spielwahl.eroeffne({
      guildId: GUILD,
      host: HOST,
      optionen: { modus: 'VOTING', vorschlaegeProPerson: 5, abstimmdauerSek: 300 },
    });
    for (const person of GAESTE) {
      await spielwahl.tritteBei(session.id, person.discordId);
    }
    for (const gameId of gameIds) {
      await spielwahl.schlageVor(session.id, HOST.discordId, { gameId });
    }
    await spielwahl.schliesseVorschlaege(session.id, HOST);
    const kandidaten = (await spielwahl.listeKandidaten(session.id)).map((eintrag) => eintrag.id);
    await spielwahl.starte(session.id, HOST);

    await spielwahl.stimme(session.id, HOST.discordId, kandidaten[0]!, 0);
    await spielwahl.verlasse(session.id, HOST.discordId);

    // Die Fuehrung ist weitergegangen, die Runde laeuft.
    const nachher = await prisma.spielwahlSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(nachher.hostDiscordId).toBe(GAESTE[0]!.discordId);
    expect(nachher.status).toBe('ENTSCHEIDUNG');

    // Die Stimme des Gegangenen zaehlt weiter.
    for (const person of GAESTE) {
      await spielwahl.stimme(session.id, person.discordId, kandidaten[0]!, 0);
    }
    const runde = await prisma.spielwahlRound.findFirstOrThrow({ where: { sessionId: session.id } });
    expect(runde.status).toBe('FERTIG');
    expect(await prisma.spielwahlVote.count({ where: { roundId: runde.id } })).toBe(6);

    // Und der neue Host kann annehmen.
    await spielwahl.nimmAn(session.id, GAESTE[0]!);
    expect((await prisma.spielwahlSession.findUniqueOrThrow({ where: { id: session.id } })).status).toBe(
      'ABGESCHLOSSEN',
    );
  });
});
