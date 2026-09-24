import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_spielwahl_entscheidung');

/**
 * Die drei Wege zu einem Ergebnis.
 *
 * ## Worauf es ankommt
 *
 * Nicht darauf, dass am Ende irgendein Spiel dasteht - das taete auch
 * `Math.random()` im Browser. Sondern darauf, dass es **dasselbe** Spiel ist,
 * egal wer fragt und wie oft, dass eine Stimme nicht zweimal zaehlt und dass
 * ein Gleichstand nicht in einer Endlosschleife endet.
 */
const { prisma } = await import('@swisshub/database');
const { spielwahl } = await import('@swisshub/modules');

const GUILD = '000000000000000001';
const ANNA = { discordId: '100000000000000001', username: 'anna' };
const BEN = { discordId: '100000000000000002', username: 'ben' };
const CARA = { discordId: '100000000000000003', username: 'cara' };
const DAN = { discordId: '100000000000000004', username: 'dan' };

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

/** Das laufende Duell einer Ausscheidungsrunde. */
function duell(runde: { baum: unknown; duellIndex: number }) {
  return spielwahl.modi.aktuellesDuell(spielwahl.modi.leseBaum(runde.baum), runde.duellIndex);
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

/** Eine Session mit `anzahl` Kandidaten, bereit zum Start. */
async function bereit(
  modus: 'ROULETTE' | 'VOTING' | 'ELIMINATION',
  anzahl: number,
  mitspieler: Array<{ discordId: string; username: string }> = [BEN],
  optionen: Record<string, unknown> = {},
): Promise<{ sessionId: string; kandidaten: string[] }> {
  const gameIds = await spiele(anzahl);
  const session = await spielwahl.eroeffne({
    guildId: GUILD,
    host: ANNA,
    optionen: { modus, vorschlaegeProPerson: 10, ...optionen },
  });
  for (const person of mitspieler) {
    await spielwahl.tritteBei(session.id, person.discordId);
  }
  for (const gameId of gameIds) {
    await spielwahl.schlageVor(session.id, ANNA.discordId, { gameId });
  }
  await spielwahl.schliesseVorschlaege(session.id, ANNA);
  const kandidaten = (await spielwahl.listeKandidaten(session.id)).map((eintrag) => eintrag.id);
  return { sessionId: session.id, kandidaten };
}

describeWithDatabase('Was spielen wir?: Entscheidungen', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await leeren();
  });

  // --- Roulette -----------------------------------------------------------

  it('zieht den Roulette-Gewinner einmal - wiederholtes Prüfen ändert ihn nicht', async () => {
    const { sessionId } = await bereit('ROULETTE', 5);
    const rundenId = await spielwahl.starte(sessionId, ANNA);
    const runde = await prisma.spielwahlRound.findUniqueOrThrow({ where: { id: rundenId } });
    const gewinner = runde.gewinnerCandidateId;

    const spaeter = new Date(runde.endsAt!.getTime() + 1);
    await Promise.all([
      spielwahl.pruefe(sessionId, spaeter),
      spielwahl.pruefe(sessionId, spaeter),
      spielwahl.pruefe(sessionId, spaeter),
      spielwahl.pruefe(sessionId, spaeter),
      spielwahl.pruefe(sessionId, spaeter),
    ]);

    const nachher = await prisma.spielwahlRound.findUniqueOrThrow({ where: { id: rundenId } });
    expect(nachher.gewinnerCandidateId).toBe(gewinner);
    expect(nachher.status).toBe('FERTIG');
    // Genau eine Runde, nicht fuenf.
    expect(await prisma.spielwahlRound.count({ where: { sessionId } })).toBe(1);
  });

  it('gibt ohne Gewichtung jedem Spiel genau ein Los - auch bei vielen Unterstützern', async () => {
    /*
     * Die Probe aufs Exempel fuer die Fairness-Regel. Ein Kandidat hat drei
     * Unterstuetzer, drei andere je einen. Ohne Gewichtung muss die
     * Gesamtsumme der Lose der Zahl der Kandidaten entsprechen - nicht der
     * Zahl der Vorschlaege.
     */
    const gameIds = await spiele(4);
    const session = await spielwahl.eroeffne({
      guildId: GUILD,
      host: ANNA,
      optionen: { modus: 'ROULETTE', vorschlaegeProPerson: 10 },
    });
    for (const person of [BEN, CARA]) {
      await spielwahl.tritteBei(session.id, person.discordId);
    }
    for (const gameId of gameIds) {
      await spielwahl.schlageVor(session.id, ANNA.discordId, { gameId });
    }
    await spielwahl.schlageVor(session.id, BEN.discordId, { gameId: gameIds[0] });
    await spielwahl.schlageVor(session.id, CARA.discordId, { gameId: gameIds[0] });
    await spielwahl.schliesseVorschlaege(session.id, ANNA);

    const rundenId = await spielwahl.starte(session.id, ANNA);
    const runde = await prisma.spielwahlRound.findUniqueOrThrow({ where: { id: rundenId } });
    expect(runde.losGesamt).toBe(4);
  });

  it('gewichtet nur, wenn die Gruppe es bewusst eingeschaltet hat', async () => {
    const gameIds = await spiele(3);
    const session = await spielwahl.eroeffne({
      guildId: GUILD,
      host: ANNA,
      optionen: { modus: 'ROULETTE', vorschlaegeProPerson: 10, rouletteGewichtet: true },
    });
    await spielwahl.tritteBei(session.id, BEN.discordId);
    for (const gameId of gameIds) {
      await spielwahl.schlageVor(session.id, ANNA.discordId, { gameId });
    }
    await spielwahl.schlageVor(session.id, BEN.discordId, { gameId: gameIds[0] });
    await spielwahl.schliesseVorschlaege(session.id, ANNA);

    const rundenId = await spielwahl.starte(session.id, ANNA);
    const runde = await prisma.spielwahlRound.findUniqueOrThrow({ where: { id: rundenId } });
    // Zwei Unterstuetzer fuer A, je einer fuer B und C.
    expect(runde.losGesamt).toBe(4);
  });

  it('lässt genau einmal neu auslosen', async () => {
    const { sessionId } = await bereit('ROULETTE', 4);
    const ersteRunde = await spielwahl.starte(sessionId, ANNA);
    const erste = await prisma.spielwahlRound.findUniqueOrThrow({ where: { id: ersteRunde } });
    await spielwahl.pruefe(sessionId, new Date(erste.endsAt!.getTime() + 1));

    await spielwahl.loseNeu(sessionId, ANNA);
    const zweite = await prisma.spielwahlRound.findFirstOrThrow({
      where: { sessionId },
      orderBy: { nummer: 'desc' },
    });
    expect(zweite.nummer).toBe(2);
    expect(zweite.kandidaten).toEqual(erste.kandidaten);

    await spielwahl.pruefe(sessionId, new Date(zweite.endsAt!.getTime() + 1));
    await expect(spielwahl.loseNeu(sessionId, ANNA)).rejects.toThrow();
  });

  // --- Voting -------------------------------------------------------------

  it('zählt jede Person einmal, egal wie oft sie klickt', async () => {
    const { sessionId, kandidaten } = await bereit('VOTING', 3, [BEN, CARA]);
    await spielwahl.starte(sessionId, ANNA);

    await Promise.all([
      spielwahl.stimme(sessionId, BEN.discordId, kandidaten[0]!, 0).catch(() => undefined),
      spielwahl.stimme(sessionId, BEN.discordId, kandidaten[0]!, 0).catch(() => undefined),
      spielwahl.stimme(sessionId, BEN.discordId, kandidaten[0]!, 0).catch(() => undefined),
    ]);

    const runde = await prisma.spielwahlRound.findFirstOrThrow({ where: { sessionId } });
    const stimmen = await prisma.spielwahlVote.count({
      where: { roundId: runde.id, discordId: BEN.discordId },
    });
    expect(stimmen).toBeLessThanOrEqual(1);
  });

  it('setzt eine einzelne Stimme um, statt sie abzulehnen', async () => {
    const { sessionId, kandidaten } = await bereit('VOTING', 3);
    await spielwahl.starte(sessionId, ANNA);

    await spielwahl.stimme(sessionId, BEN.discordId, kandidaten[0]!, 0);
    await spielwahl.stimme(sessionId, BEN.discordId, kandidaten[1]!, 0);

    const runde = await prisma.spielwahlRound.findFirstOrThrow({ where: { sessionId } });
    const stimmen = await prisma.spielwahlVote.findMany({
      where: { roundId: runde.id, discordId: BEN.discordId },
    });
    expect(stimmen).toHaveLength(1);
    expect(stimmen[0]?.candidateId).toBe(kandidaten[1]);
  });

  it('nimmt eine Stimme zurück, wenn dasselbe noch einmal angeklickt wird', async () => {
    const { sessionId, kandidaten } = await bereit('VOTING', 3);
    await spielwahl.starte(sessionId, ANNA);
    await spielwahl.stimme(sessionId, BEN.discordId, kandidaten[0]!, 0);
    await spielwahl.stimme(sessionId, BEN.discordId, kandidaten[0]!, 0);

    const runde = await prisma.spielwahlRound.findFirstOrThrow({ where: { sessionId } });
    expect(await prisma.spielwahlVote.count({ where: { roundId: runde.id } })).toBe(0);
  });

  it('nimmt nach Ablauf der Serverzeit keine Stimme mehr an', async () => {
    const { sessionId, kandidaten } = await bereit('VOTING', 3, [BEN], { abstimmdauerSek: 10 });
    const rundenId = await spielwahl.starte(sessionId, ANNA);
    await prisma.spielwahlRound.update({
      where: { id: rundenId },
      data: { endsAt: new Date(Date.now() - 1000) },
    });
    await expect(spielwahl.stimme(sessionId, BEN.discordId, kandidaten[0]!, 0)).rejects.toThrow();
  });

  it('entscheidet die Abstimmung für den Meistgewählten', async () => {
    const { sessionId, kandidaten } = await bereit('VOTING', 3, [BEN, CARA]);
    const rundenId = await spielwahl.starte(sessionId, ANNA);

    await spielwahl.stimme(sessionId, ANNA.discordId, kandidaten[1]!, 0);
    await spielwahl.stimme(sessionId, BEN.discordId, kandidaten[1]!, 0);
    await spielwahl.stimme(sessionId, CARA.discordId, kandidaten[0]!, 0);

    const runde = await prisma.spielwahlRound.findUniqueOrThrow({ where: { id: rundenId } });
    expect(runde.status).toBe('FERTIG');
    expect(runde.gewinnerCandidateId).toBe(kandidaten[1]);
  });

  it('eröffnet bei Gleichstand eine Stichwahl nur unter den Gleichauf-Kandidaten', async () => {
    const { sessionId, kandidaten } = await bereit('VOTING', 3, [BEN, CARA, DAN], {
      gleichstand: 'STICHWAHL',
    });
    await spielwahl.starte(sessionId, ANNA);

    await spielwahl.stimme(sessionId, ANNA.discordId, kandidaten[0]!, 0);
    await spielwahl.stimme(sessionId, BEN.discordId, kandidaten[0]!, 0);
    await spielwahl.stimme(sessionId, CARA.discordId, kandidaten[1]!, 0);
    await spielwahl.stimme(sessionId, DAN.discordId, kandidaten[1]!, 0);

    const runden = await prisma.spielwahlRound.findMany({ where: { sessionId }, orderBy: { nummer: 'asc' } });
    expect(runden).toHaveLength(2);
    expect(runden[0]?.entscheidungsart).toBe('stichwahl');
    expect(runden[1]?.kandidaten.sort()).toEqual([kandidaten[0]!, kandidaten[1]!].sort());
    expect(runden[1]?.status).toBe('LAEUFT');
  });

  it('entscheidet den Gleichstand per Los, wenn die Gruppe das gewählt hat', async () => {
    const { sessionId, kandidaten } = await bereit('VOTING', 3, [BEN], { gleichstand: 'ZUFALL' });
    const rundenId = await spielwahl.starte(sessionId, ANNA);

    await spielwahl.stimme(sessionId, ANNA.discordId, kandidaten[0]!, 0);
    await spielwahl.stimme(sessionId, BEN.discordId, kandidaten[1]!, 0);

    const runde = await prisma.spielwahlRound.findUniqueOrThrow({ where: { id: rundenId } });
    expect(runde.status).toBe('FERTIG');
    expect(runde.entscheidungsart).toBe('los-bei-gleichstand');
    expect([kandidaten[0], kandidaten[1]]).toContain(runde.gewinnerCandidateId);
  });

  it('entscheidet per Los, wenn niemand abgestimmt hat', async () => {
    const { sessionId } = await bereit('VOTING', 3, [BEN], { abstimmdauerSek: 10 });
    const rundenId = await spielwahl.starte(sessionId, ANNA);
    const runde = await prisma.spielwahlRound.findUniqueOrThrow({ where: { id: rundenId } });

    await spielwahl.pruefe(sessionId, new Date(runde.endsAt!.getTime() + 1));
    const nachher = await prisma.spielwahlRound.findUniqueOrThrow({ where: { id: rundenId } });
    expect(nachher.status).toBe('FERTIG');
    expect(nachher.entscheidungsart).toBe('los-ohne-stimmen');
    expect(nachher.gewinnerCandidateId).not.toBeNull();
  });

  // --- Elimination --------------------------------------------------------

  it('spielt ein Ausscheidungsturnier mit gerader Anzahl bis zum Sieger durch', async () => {
    const { sessionId, kandidaten } = await bereit('ELIMINATION', 4, [BEN]);
    const rundenId = await spielwahl.starte(sessionId, ANNA);

    for (let schritt = 0; schritt < 10; schritt += 1) {
      const runde = await prisma.spielwahlRound.findUniqueOrThrow({ where: { id: rundenId } });
      if (runde.status !== 'LAEUFT') {
        break;
      }
      const paarung = duell(runde);
      if (!paarung) {
        break;
      }
      // Beide stimmen fuer A - eindeutig, kein Los noetig.
      await spielwahl.stimme(sessionId, ANNA.discordId, paarung.a, paarung.nr);
      await spielwahl.stimme(sessionId, BEN.discordId, paarung.a, paarung.nr);
    }

    const fertig = await prisma.spielwahlRound.findUniqueOrThrow({ where: { id: rundenId } });
    expect(fertig.status).toBe('FERTIG');
    expect(kandidaten).toContain(fertig.gewinnerCandidateId);
  });

  it('kommt auch mit ungerader Kandidatenzahl bis zum Sieger', async () => {
    /*
     * Der Fall, an dem eine Turnierlogik erfahrungsgemaess scheitert: bei
     * fuenf Kandidaten gibt es in der ersten Stufe zwei Duelle und ein
     * Freilos, in der zweiten wieder drei - und wer das Freilos jedesmal an
     * dieselbe Stelle haengt, dreht sich im Kreis.
     */
    for (const anzahl of [3, 5, 7]) {
      await leeren();
      const { sessionId, kandidaten } = await bereit('ELIMINATION', anzahl, [BEN]);
      const rundenId = await spielwahl.starte(sessionId, ANNA);

      for (let schritt = 0; schritt < 40; schritt += 1) {
        const runde = await prisma.spielwahlRound.findUniqueOrThrow({ where: { id: rundenId } });
        if (runde.status !== 'LAEUFT') {
          break;
        }
        const paarung = duell(runde);
        if (!paarung || paarung.b === null) {
          await spielwahl.pruefe(sessionId);
          continue;
        }
        await spielwahl.stimme(sessionId, ANNA.discordId, paarung.a, paarung.nr);
        await spielwahl.stimme(sessionId, BEN.discordId, paarung.a, paarung.nr);
      }

      const fertig = await prisma.spielwahlRound.findUniqueOrThrow({ where: { id: rundenId } });
      expect(fertig.status, `bei ${anzahl} Kandidaten`).toBe('FERTIG');
      expect(kandidaten).toContain(fertig.gewinnerCandidateId);
    }
  });

  it('entscheidet ein unentschiedenes Duell per Los statt in einer Endlosschleife', async () => {
    const { sessionId } = await bereit('ELIMINATION', 2, [BEN], { abstimmdauerSek: 10 });
    const rundenId = await spielwahl.starte(sessionId, ANNA);
    const runde = await prisma.spielwahlRound.findUniqueOrThrow({ where: { id: rundenId } });
    const paarung = duell(runde)!;

    await spielwahl.stimme(sessionId, ANNA.discordId, paarung.a, paarung.nr);
    await spielwahl.stimme(sessionId, BEN.discordId, paarung.b!, paarung.nr);

    await spielwahl.pruefe(sessionId, new Date(runde.endsAt!.getTime() + 1));
    const fertig = await prisma.spielwahlRound.findUniqueOrThrow({ where: { id: rundenId } });
    expect(fertig.status).toBe('FERTIG');
    expect([paarung.a, paarung.b]).toContain(fertig.gewinnerCandidateId);
  });

  it('nimmt keine Stimme für ein Duell an, das schon weitergegangen ist', async () => {
    const { sessionId } = await bereit('ELIMINATION', 4, [BEN]);
    const rundenId = await spielwahl.starte(sessionId, ANNA);
    const runde = await prisma.spielwahlRound.findUniqueOrThrow({ where: { id: rundenId } });
    const erstes = duell(runde)!;

    await spielwahl.stimme(sessionId, ANNA.discordId, erstes.a, erstes.nr);
    await spielwahl.stimme(sessionId, BEN.discordId, erstes.a, erstes.nr);

    // Das Duell ist vorbei - eine verspaetete Stimme dafuer gilt nicht mehr.
    await expect(spielwahl.stimme(sessionId, CARA.discordId, erstes.a, erstes.nr)).rejects.toThrow();
  });
});
