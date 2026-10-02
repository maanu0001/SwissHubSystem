import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_spielwahl_gaeste');

/**
 * Gäste ohne Discord-Konto.
 *
 * ## Was hier tatsächlich geprüft wird
 *
 * Nicht «kann ein Gast abstimmen» - das ist der leichte Teil. Sondern die
 * Grenze: **was ein Gast nicht kann**, und zwar auch dann, wenn er den Aufruf
 * direkt macht statt über die Oberfläche. Eine Server Action ist ein Endpunkt;
 * die Knöpfe, die eine Seite weglässt, sind keine Sicherung.
 *
 * Geprüft wird deshalb in beide Richtungen:
 *
 *   - Ein Gast eröffnet eine Runde, tritt bei, steht mit Namen in der Liste,
 *     schlägt Spiele vor, stimmt mit, führt seine eigene Runde - und seine
 *     Stimme zählt wie jede andere.
 *   - Ein Gast wird **nicht** Host der Runde eines Mitglieds, kommt nicht in
 *     eine Runde ohne `gaesteErlaubt`, bleibt an Kontingent und Katalogzwang
 *     gebunden, und eine erfundene Kennung kommt gar nicht erst durch.
 *
 * ## Warum gegen eine echte Datenbank
 *
 * Weil Gäste sich Teilnehmer- und Stimmentabelle mit den Mitgliedern teilen -
 * unterschieden am Präfix der Kennung. Ob das trägt, zeigt sich an der
 * Eindeutigkeit, der Zählung der Plätze und daran, dass eine Auswertung über
 * beide zusammen stimmt. Eine Attrappe würde genau das nicht zeigen.
 */
const { prisma } = await import('@swisshub/database');
const { spielwahl, getModuleSettings, setModuleSettings } = await import('@swisshub/modules');
const { clearRevisionCaches } = await import('@swisshub/database');

const GUILD = '000000000000000001';
const ANNA = { discordId: '100000000000000001', username: 'anna' };
const BEN = { discordId: '100000000000000002', username: 'ben' };

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

/** Gaeste auf Serverebene erlauben - sonst bleibt jede Session zu. */
async function serverErlaubtGaeste(erlaubt: boolean, gastRundenGrenze = 25): Promise<void> {
  /*
   * Jeder Wert ausdruecklich.
   *
   * `useTestSchema` benutzt das Schema zwischen Laeufen weiter, und `leeren()`
   * raeumt `ModuleState` nicht auf. Ein Spread ueber die vorhandenen
   * Einstellungen liesse den Wert eines frueheren Laufs stehen - genau die
   * Art Testabhaengigkeit, die man einmal sucht und nie wieder.
   */
  await setModuleSettings(
    spielwahl.SPIELWAHL_MODULE_ID,
    {
      vorschlaegeProPerson: 3,
      maxTeilnehmerGrenze: 12,
      abstimmdauerSek: 45,
      freieVorschlaege: true,
      gaesteErlaubt: erlaubt,
      gastRundenGrenze,
      offeneProPerson: 3,
      verfallStunden: 12,
      announcementChannelId: null,
    },
    'test',
  );
}

async function spiele(anzahl: number): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 0; index < anzahl; index += 1) {
    const name = `Spiel ${index}`;
    const spiel = await prisma.game.create({
      data: { name, nameKey: name.toLowerCase(), enabled: true },
    });
    ids.push(spiel.id);
  }
  return ids;
}

/** Eine Runde, die bis zur Abstimmung gekommen ist. */
async function bisZurAbstimmung(sessionId: string, gameIds: string[]): Promise<void> {
  await spielwahl.schlageVor(sessionId, ANNA.discordId, { gameId: gameIds[0] });
  await spielwahl.schlageVor(sessionId, BEN.discordId, { gameId: gameIds[1] });
  await spielwahl.aendereEinstellungen(sessionId, { modus: 'VOTING' });
  await spielwahl.schliesseVorschlaege(sessionId, ANNA);
  await spielwahl.starte(sessionId, ANNA);
}

describeWithDatabase('Was spielen wir?: Gäste ohne Konto', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await leeren();
    await serverErlaubtGaeste(true);
  });

  // --- Die Kennung ----------------------------------------------------------

  it('erkennt eine Gastkennung und verwechselt sie nie mit einer Discord-Kennung', () => {
    const kennung = spielwahl.neueGastKennung();
    expect(spielwahl.istGastKennung(kennung)).toBe(true);
    expect(kennung.startsWith(spielwahl.GAST_PRAEFIX)).toBe(true);

    // Eine Discord-Kennung ist eine Ziffernfolge - nie eine Gastkennung.
    for (const fremd of [ANNA.discordId, '', 'gast:', 'gast:xyz', 'gast:ABCDEF', `${kennung}0`, 'system']) {
      expect(spielwahl.istGastKennung(fremd), fremd).toBe(false);
    }
  });

  it('zieht bei jedem Aufruf eine andere Kennung', () => {
    const kennungen = new Set(Array.from({ length: 200 }, () => spielwahl.neueGastKennung()));
    expect(kennungen.size).toBe(200);
  });

  // --- Der Zugang -----------------------------------------------------------

  /**
   * Alle drei Faelle, nicht nur einer.
   *
   * Hier stand vorher: «der Host hat nichts gesagt» → Runde zu. Das war das
   * Verhalten, und es war der Fehler. Jede neue Runde startete gastfrei, auch
   * wenn der Server die Teilnahme ohne Konto ausdruecklich erlaubte - der Host
   * haette einen Schalter finden muessen, von dem er nichts wusste. Wer den
   * Einladungslink teilte, bekam von seinen Gaesten zu hoeren, dass es nicht
   * geht.
   *
   * Die Regel «Server **und** Host» bleibt unveraendert. Was sich aendert, ist
   * allein, was «der Host hat nichts gesagt» bedeutet: nicht mehr «nein»,
   * sondern «wie der Server es haelt». Dasselbe tut `freieVorschlaege` seit
   * immer.
   *
   * Geprueft werden deshalb jetzt alle drei Faelle - der schweigende Host war
   * nur einer davon, und ein Test, der bloss ihn kennt, haette den
   * widersprechenden Host nicht abgedeckt.
   */
  it('folgt der Servervorgabe, wenn der Host nichts sagt', async () => {
    const session = await spielwahl.eroeffne({ guildId: GUILD, host: ANNA });
    const gast = spielwahl.neueGastKennung();

    // Der Server erlaubt es (siehe `beforeEach`) - also ist die Runde offen.
    await expect(spielwahl.verlangeGastZugang(session.id, gast)).resolves.toMatchObject({
      id: session.id,
    });
  });

  it('bleibt zu, wenn der Host sie ausdruecklich zumacht', async () => {
    // Der Host behaelt seine Entscheidung je Runde - er muss sie nur noch
    // treffen, wenn er von der Servervorgabe abweichen will.
    const session = await spielwahl.eroeffne({
      guildId: GUILD,
      host: ANNA,
      optionen: { gaesteErlaubt: false },
    });

    await expect(spielwahl.verlangeGastZugang(session.id, spielwahl.neueGastKennung())).rejects.toThrow();
  });

  it('oeffnet sie, wenn der Host sie ausdruecklich aufmacht', async () => {
    const session = await spielwahl.eroeffne({
      guildId: GUILD,
      host: BEN,
      optionen: { gaesteErlaubt: true },
    });

    await expect(
      spielwahl.verlangeGastZugang(session.id, spielwahl.neueGastKennung()),
    ).resolves.toMatchObject({ id: session.id });
  });

  it('bleibt zu, wenn der Server es verbietet - auch ohne Angabe des Hosts', async () => {
    // Das Veto des Admins gilt unveraendert, und zwar auch gegen die neue
    // Vorgabe: steht es beim Server aus, ist jede Runde zu.
    await serverErlaubtGaeste(false);
    const session = await spielwahl.eroeffne({ guildId: GUILD, host: ANNA });

    const gespeichert = await prisma.spielwahlSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(gespeichert.gaesteErlaubt).toBe(false);
    await expect(spielwahl.verlangeGastZugang(session.id, spielwahl.neueGastKennung())).rejects.toThrow();
  });

  it('lässt den Host nicht über die Servervorgabe hinweg', async () => {
    await serverErlaubtGaeste(false);
    const session = await spielwahl.eroeffne({
      guildId: GUILD,
      host: ANNA,
      optionen: { gaesteErlaubt: true },
    });

    const gespeichert = await prisma.spielwahlSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(gespeichert.gaesteErlaubt).toBe(false);

    // Und auch nachträglich nicht.
    await spielwahl.aendereEinstellungen(session.id, { gaesteErlaubt: true });
    const nachher = await prisma.spielwahlSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(nachher.gaesteErlaubt).toBe(false);
  });

  it('weist eine erfundene Kennung ab, auch in einer offenen Runde', async () => {
    const session = await spielwahl.eroeffne({
      guildId: GUILD,
      host: ANNA,
      optionen: { gaesteErlaubt: true },
    });

    /*
     * Der Fall, der nicht passieren darf: jemand schreibt eine fremde
     * Discord-Kennung in sein Cookie und handelt als dieses Mitglied.
     */
    for (const erfunden of [BEN.discordId, 'gast:kurz', 'GAST:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '']) {
      await expect(spielwahl.verlangeGastZugang(session.id, erfunden), erfunden).rejects.toThrow();
    }
  });

  it('weist eine geschlossene Runde ab', async () => {
    const session = await spielwahl.eroeffne({
      guildId: GUILD,
      host: ANNA,
      optionen: { gaesteErlaubt: true },
    });
    await spielwahl.schliesse(session.id, ANNA);

    await expect(spielwahl.verlangeGastZugang(session.id, spielwahl.neueGastKennung())).rejects.toThrow();
  });

  // --- Beitreten ------------------------------------------------------------

  it('nimmt einen Gast mit Namen auf und zeigt ihn als Gast', async () => {
    const session = await spielwahl.eroeffne({
      guildId: GUILD,
      host: ANNA,
      optionen: { gaesteErlaubt: true },
    });
    const gast = spielwahl.neueGastKennung();

    expect(await spielwahl.tritteBei(session.id, gast, 'Nina')).toBe('neu');

    const stand = await spielwahl.baueAnsicht(session.id, gast);
    const zeile = stand?.teilnehmer.find((teilnehmer) => teilnehmer.discordId === gast);
    expect(zeile?.anzeigename).toBe('Nina');
    expect(zeile?.istGast).toBe(true);
    expect(stand?.betrachterIstGast).toBe(true);

    // Das Mitglied daneben bleibt ein Mitglied.
    const host = stand?.teilnehmer.find((teilnehmer) => teilnehmer.discordId === ANNA.discordId);
    expect(host?.istGast).toBe(false);
  });

  it('verlangt einen Namen - und prüft ihn serverseitig', async () => {
    const session = await spielwahl.eroeffne({
      guildId: GUILD,
      host: ANNA,
      optionen: { gaesteErlaubt: true },
    });
    const gast = spielwahl.neueGastKennung();

    await expect(spielwahl.tritteBei(session.id, gast)).rejects.toThrow();
    await expect(spielwahl.tritteBei(session.id, gast, 'x')).rejects.toThrow();
    await expect(spielwahl.tritteBei(session.id, gast, '<script>')).rejects.toThrow();
    await expect(spielwahl.tritteBei(session.id, gast, 'https://boese.example')).rejects.toThrow();
    await expect(spielwahl.tritteBei(session.id, gast, '....')).rejects.toThrow();

    expect(await prisma.spielwahlParticipant.count({ where: { discordId: gast } })).toBe(0);
  });

  it('nimmt keinen Gast auf, wenn die Runde keine zulässt', async () => {
    // Ausdruecklich zugemacht - «nichts gesagt» heisst jetzt «wie der Server
    // es haelt», und der erlaubt es in diesem Block.
    const session = await spielwahl.eroeffne({
      guildId: GUILD,
      host: ANNA,
      optionen: { gaesteErlaubt: false },
    });
    await expect(spielwahl.tritteBei(session.id, spielwahl.neueGastKennung(), 'Nina')).rejects.toThrow();
  });

  it('setzt dem Mitglied keinen Gastnamen', async () => {
    const session = await spielwahl.eroeffne({
      guildId: GUILD,
      host: ANNA,
      optionen: { gaesteErlaubt: true },
    });

    // Ein Name bei einem Mitglied waere ein Weg, den Anzeigenamen frei zu
    // setzen - er wird verworfen, nicht uebernommen.
    await spielwahl.tritteBei(session.id, BEN.discordId, 'Chef vom Dienst');
    const zeile = await prisma.spielwahlParticipant.findUniqueOrThrow({
      where: { sessionId_discordId: { sessionId: session.id, discordId: BEN.discordId } },
    });
    expect(zeile.gastName).toBeNull();
  });

  it('lässt einen Gast seinen Namen ändern, ohne seinen Platz zu verlieren', async () => {
    const session = await spielwahl.eroeffne({
      guildId: GUILD,
      host: ANNA,
      optionen: { gaesteErlaubt: true },
    });
    const gast = spielwahl.neueGastKennung();

    await spielwahl.tritteBei(session.id, gast, 'Nina');
    expect(await spielwahl.tritteBei(session.id, gast, 'Nina B.')).toBe('schon-dabei');

    expect(await prisma.spielwahlParticipant.count({ where: { sessionId: session.id } })).toBe(2);
    const zeile = await prisma.spielwahlParticipant.findUniqueOrThrow({
      where: { sessionId_discordId: { sessionId: session.id, discordId: gast } },
    });
    expect(zeile.gastName).toBe('Nina B.');
  });

  it('zählt einen Gast auf die Plätze der Runde', async () => {
    const session = await spielwahl.eroeffne({
      guildId: GUILD,
      host: ANNA,
      optionen: { gaesteErlaubt: true, maxTeilnehmer: 2 },
    });

    await spielwahl.tritteBei(session.id, spielwahl.neueGastKennung(), 'Nina');
    // Zwei Plaetze, der Host hat einen - die Runde ist voll.
    await expect(spielwahl.tritteBei(session.id, spielwahl.neueGastKennung(), 'Tim')).rejects.toThrow();
  });

  // --- Was ein Gast darf, und was nicht -------------------------------------

  it('lässt einen Gast Spiele vorschlagen - aus dem Katalog und frei', async () => {
    /*
     * Hier stand das Gegenteil, und zwar mit Begruendung: ein Vorschlag
     * «traegt einen Namen, bleibt im Katalog und wird spaeter gezaehlt».
     * Zwei der drei Behauptungen waren falsch - ein freier Titel landet als
     * `freierName` in dieser Runde und nirgends sonst -, und die dritte war
     * kein Grund: dann waere eine Runde ohne angemeldete Teilnehmer eine
     * leere Liste mit einem Rad, das nichts zu drehen hat.
     */
    const gameIds = await spiele(2);
    const session = await spielwahl.eroeffne({
      guildId: GUILD,
      host: ANNA,
      optionen: { gaesteErlaubt: true },
    });
    const gast = spielwahl.neueGastKennung();
    await spielwahl.tritteBei(session.id, gast, 'Nina');

    await spielwahl.schlageVor(session.id, gast, { gameId: gameIds[0] });
    await spielwahl.schlageVor(session.id, gast, { freierName: 'Irgendwas' });

    const kandidaten = await spielwahl.listeKandidaten(session.id);
    expect(kandidaten.map((eintrag) => eintrag.name).sort()).toEqual(['Irgendwas', 'Spiel 0']);
    // Der freie Titel bleibt in der Runde und geht nicht in den Katalog.
    expect(await prisma.game.count()).toBe(2);
  });

  it('hält den Gast an dasselbe Kontingent wie ein Mitglied', async () => {
    const gameIds = await spiele(5);
    const session = await spielwahl.eroeffne({
      guildId: GUILD,
      host: ANNA,
      optionen: { gaesteErlaubt: true, vorschlaegeProPerson: 2 },
    });
    const gast = spielwahl.neueGastKennung();
    await spielwahl.tritteBei(session.id, gast, 'Nina');

    await spielwahl.schlageVor(session.id, gast, { gameId: gameIds[0] });
    await spielwahl.schlageVor(session.id, gast, { gameId: gameIds[1] });
    await expect(spielwahl.schlageVor(session.id, gast, { gameId: gameIds[2] })).rejects.toThrow();
  });

  it('hält den Gast an den Katalogzwang, wenn freie Titel aus sind', async () => {
    const gameIds = await spiele(2);
    const session = await spielwahl.eroeffne({
      guildId: GUILD,
      host: ANNA,
      optionen: { gaesteErlaubt: true, freieVorschlaege: false },
    });
    const gast = spielwahl.neueGastKennung();
    await spielwahl.tritteBei(session.id, gast, 'Nina');

    await spielwahl.schlageVor(session.id, gast, { gameId: gameIds[0] });
    await expect(spielwahl.schlageVor(session.id, gast, { freierName: 'Irgendwas' })).rejects.toThrow();
  });

  it('lässt einen Gast mitstimmen, und seine Stimme zählt wie jede andere', async () => {
    const gameIds = await spiele(2);
    const session = await spielwahl.eroeffne({
      guildId: GUILD,
      host: ANNA,
      optionen: { gaesteErlaubt: true },
    });
    await spielwahl.tritteBei(session.id, BEN.discordId);
    const gast = spielwahl.neueGastKennung();
    await spielwahl.tritteBei(session.id, gast, 'Nina');

    await bisZurAbstimmung(session.id, gameIds);

    const kandidaten = await spielwahl.listeKandidaten(session.id);
    const ziel = kandidaten[0]!.id;

    await spielwahl.stimme(session.id, gast, ziel, 0);

    const stimmen = await prisma.spielwahlVote.findMany({ where: { candidateId: ziel } });
    expect(stimmen).toHaveLength(1);
    expect(stimmen[0]?.discordId).toBe(gast);

    // Und die Zaehlung sieht sie - ueber Mitglieder und Gaeste hinweg.
    await spielwahl.stimme(session.id, BEN.discordId, ziel, 0);
    expect(await prisma.spielwahlVote.count({ where: { candidateId: ziel } })).toBe(2);
  });

  it('nimmt eine Gaststimme beim zweiten Klick zurück', async () => {
    const gameIds = await spiele(2);
    const session = await spielwahl.eroeffne({
      guildId: GUILD,
      host: ANNA,
      optionen: { gaesteErlaubt: true },
    });
    await spielwahl.tritteBei(session.id, BEN.discordId);
    const gast = spielwahl.neueGastKennung();
    await spielwahl.tritteBei(session.id, gast, 'Nina');
    await bisZurAbstimmung(session.id, gameIds);

    const ziel = (await spielwahl.listeKandidaten(session.id))[0]!.id;
    await spielwahl.stimme(session.id, gast, ziel, 0);
    await spielwahl.stimme(session.id, gast, ziel, 0);

    expect(await prisma.spielwahlVote.count({ where: { discordId: gast } })).toBe(0);
  });

  it('lässt einen Gast, der nicht beigetreten ist, nicht abstimmen', async () => {
    const gameIds = await spiele(2);
    const session = await spielwahl.eroeffne({
      guildId: GUILD,
      host: ANNA,
      optionen: { gaesteErlaubt: true },
    });
    await spielwahl.tritteBei(session.id, BEN.discordId);
    await bisZurAbstimmung(session.id, gameIds);

    const ziel = (await spielwahl.listeKandidaten(session.id))[0]!.id;
    await expect(spielwahl.stimme(session.id, spielwahl.neueGastKennung(), ziel, 0)).rejects.toThrow();
  });

  it('lässt den Host einen Gast nicht zum Co-Host oder Host machen', async () => {
    const session = await spielwahl.eroeffne({
      guildId: GUILD,
      host: ANNA,
      optionen: { gaesteErlaubt: true },
    });
    const gast = spielwahl.neueGastKennung();
    await spielwahl.tritteBei(session.id, gast, 'Nina');

    /*
     * Auch nicht von Hand und auch nicht in guter Absicht.
     *
     * Host und Co-Host duerfen starten, neu auslosen und annehmen - genau die
     * Handlungen, die ein Gast nicht hat. Eine Ernennung waere der Weg um die
     * Regel herum, und zwar der bequemste.
     */
    await expect(spielwahl.setzeCoHost(session.id, gast, true, ANNA)).rejects.toThrow();
    await expect(spielwahl.uebergib(session.id, gast, ANNA)).rejects.toThrow();

    const zeile = await prisma.spielwahlParticipant.findUniqueOrThrow({
      where: { sessionId_discordId: { sessionId: session.id, discordId: gast } },
    });
    expect(zeile.rolle).toBe('GAST');
    const nachher = await prisma.spielwahlSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(nachher.hostDiscordId).toBe(ANNA.discordId);
  });

  it('bricht die Runde ab, wenn nur noch Gäste da sind', async () => {
    const session = await spielwahl.eroeffne({
      guildId: GUILD,
      host: ANNA,
      optionen: { gaesteErlaubt: true },
    });
    await spielwahl.tritteBei(session.id, spielwahl.neueGastKennung(), 'Nina');

    await spielwahl.verlasse(session.id, ANNA.discordId);

    // Niemand mehr da, der sie führen dürfte - dieselbe Antwort wie bei einer
    // leeren Runde.
    const nachher = await prisma.spielwahlSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(nachher.status).toBe('ABGEBROCHEN');
  });

  it('gibt die Führung an das Mitglied weiter und überspringt den Gast', async () => {
    const session = await spielwahl.eroeffne({
      guildId: GUILD,
      host: ANNA,
      optionen: { gaesteErlaubt: true },
    });
    // Der Gast ist früher dabei als Ben - nach Beitrittszeit käme er zuerst.
    const gast = spielwahl.neueGastKennung();
    await spielwahl.tritteBei(session.id, gast, 'Nina');
    await spielwahl.tritteBei(session.id, BEN.discordId);

    await spielwahl.verlasse(session.id, ANNA.discordId);

    const nachher = await prisma.spielwahlSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(nachher.hostDiscordId).toBe(BEN.discordId);
    expect(nachher.status).not.toBe('ABGEBROCHEN');
  });

  it('macht einen Gast nicht zum Host, wenn der Host geht', async () => {
    const session = await spielwahl.eroeffne({
      guildId: GUILD,
      host: ANNA,
      optionen: { gaesteErlaubt: true },
    });
    const gast = spielwahl.neueGastKennung();
    await spielwahl.tritteBei(session.id, gast, 'Nina');

    await spielwahl.verlasse(session.id, ANNA.discordId);

    /*
     * Die Fuehrung wandert an den, der am laengsten dabei und anwesend ist -
     * und das waere hier der Gast. Damit koennte er Runden starten und das
     * Ergebnis annehmen, also genau das, was ihm verwehrt sein soll.
     */
    const rolle = await prisma.spielwahlParticipant.findUniqueOrThrow({
      where: { sessionId_discordId: { sessionId: session.id, discordId: gast } },
    });
    expect(rolle.rolle).not.toBe('HOST');
  });
});

/**
 * Der Standard: Teilnahme ohne Konto ist neu **an**.
 *
 * ## Warum das zwei Tests braucht und nicht einen
 *
 * Weil die interessante Aussage nicht «der Standard ist true» ist, sondern die
 * Grenze daneben: er gilt fuer einen Server, der nichts eingestellt hat, und
 * **nicht** fuer einen, der den Schalter ausdruecklich ausgemacht hat. Wer ihn
 * absichtlich aus hat, soll ihn nicht durch ein Update wieder an finden.
 *
 * Genau das traegt `getModuleSettings`: es liest die hinterlegte Json durch das
 * Schema, und ein Standard greift nur, wo ein Wert fehlt. Deshalb braucht es
 * auch keine Migration - eine, die «alles = true» schriebe, waere der Fehler,
 * den diese beiden Tests verbieten.
 */
describeWithDatabase('Was spielen wir: der Standard fuer Teilnahme ohne Konto', () => {
  beforeAll(async () => {
    await pushSchema();
  });

  beforeEach(async () => {
    await leeren();
    await prisma.moduleState.deleteMany({});
    clearRevisionCaches();
  });

  it('ist an, solange niemand etwas eingestellt hat', async () => {
    const einstellungen = await getModuleSettings<Record<string, unknown>>(spielwahl.SPIELWAHL_MODULE_ID);
    expect(einstellungen.gaesteErlaubt as boolean).toBe(true);
  });

  it('bleibt aus, wenn ein Server ihn ausdruecklich ausgemacht hat', async () => {
    await serverErlaubtGaeste(false);
    clearRevisionCaches();

    const einstellungen = await getModuleSettings<Record<string, unknown>>(spielwahl.SPIELWAHL_MODULE_ID);
    // Kein Standard ueberschreibt eine Entscheidung, die schon getroffen ist.
    expect(einstellungen.gaesteErlaubt as boolean).toBe(false);
  });

  it('laesst sich danach von Hand wieder anschalten', async () => {
    await serverErlaubtGaeste(false);
    clearRevisionCaches();
    await serverErlaubtGaeste(true);
    clearRevisionCaches();

    const einstellungen = await getModuleSettings<Record<string, unknown>>(spielwahl.SPIELWAHL_MODULE_ID);
    expect(einstellungen.gaesteErlaubt as boolean).toBe(true);
  });
});

/**
 * Eine Runde, die jemand ohne Konto eröffnet hat.
 *
 * ## Warum das eine eigene Gruppe bekommt
 *
 * Weil es der Fall ist, der dreimal als «verlangt weiterhin Login» gemeldet
 * wurde, und weil er genau eine Grenze **nicht** aufweichen darf: in der Runde
 * eines Mitglieds wird ein Gast nicht zum Host. Beide Richtungen stehen hier
 * nebeneinander, damit die eine nicht ohne die andere geändert wird.
 *
 * Geprüft wird der ganze Ablauf gegen eine echte Datenbank - eröffnen,
 * vorschlagen, Phase schliessen, starten, annehmen. Eine Attrappe würde nicht
 * zeigen, dass die Hostzeile, die Kandidatenzeilen und die Statusmaschine
 * dabei zusammenpassen.
 */
describeWithDatabase('Was spielen wir?: eine Runde ohne Konto', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await leeren();
    await serverErlaubtGaeste(true);
    clearRevisionCaches();
  });

  it('lässt einen Gast eine Runde eröffnen und führt ihn als Host', async () => {
    const gast = spielwahl.neueGastKennung();
    const session = await spielwahl.eroeffne({
      guildId: GUILD,
      host: { discordId: gast, username: 'Nina' },
    });

    const zeile = await prisma.spielwahlSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(zeile.hostDiscordId).toBe(gast);
    // Die Runde lässt Gäste zu - sonst käme ihr eigener Host nicht hinein.
    expect(zeile.gaesteErlaubt).toBe(true);

    const teilnehmer = await prisma.spielwahlParticipant.findUniqueOrThrow({
      where: { sessionId_discordId: { sessionId: session.id, discordId: gast } },
    });
    expect(teilnehmer.rolle).toBe('HOST');
    // Der Name steht in der Zeile - es gibt kein Profil, aus dem er käme.
    expect(teilnehmer.gastName).toBe('Nina');
  });

  it('prüft den Namen des eröffnenden Gastes serverseitig', async () => {
    const gast = spielwahl.neueGastKennung();
    for (const name of ['', 'a', '<script>', 'x'.repeat(25)]) {
      await expect(
        spielwahl.eroeffne({ guildId: GUILD, host: { discordId: gast, username: name } }),
        name,
      ).rejects.toThrow();
    }
    expect(await prisma.spielwahlSession.count()).toBe(0);
  });

  it('lässt keinen Gast eröffnen, wenn der Server es abgeschaltet hat', async () => {
    await serverErlaubtGaeste(false);
    clearRevisionCaches();

    await expect(
      spielwahl.eroeffne({
        guildId: GUILD,
        host: { discordId: spielwahl.neueGastKennung(), username: 'Nina' },
      }),
    ).rejects.toThrow();

    // Ein Mitglied darf weiterhin - der Schalter betrifft nur Gäste.
    await spielwahl.eroeffne({ guildId: GUILD, host: ANNA });
    expect(await prisma.spielwahlSession.count()).toBe(1);
  });

  it('begrenzt die Zahl gleichzeitig offener Gastrunden - und zählt Mitgliedsrunden nicht mit', async () => {
    /*
     * Die Grenze, die nicht am Cookie haengt.
     *
     * `offeneProPerson` zaehlt je Kennung, und die eines Gastes steht in
     * seinem Cookie - loeschen, neuer Gast, neue Runde. Deshalb hier eine
     * absolute Obergrenze. Der Test verwendet **verschiedene** Kennungen,
     * genau wie der Besucher, der sein Cookie loescht.
     */
    await serverErlaubtGaeste(true, 2);
    clearRevisionCaches();

    await spielwahl.eroeffne({
      guildId: GUILD,
      host: { discordId: spielwahl.neueGastKennung(), username: 'Eins' },
    });
    await spielwahl.eroeffne({
      guildId: GUILD,
      host: { discordId: spielwahl.neueGastKennung(), username: 'Zwei' },
    });
    await expect(
      spielwahl.eroeffne({
        guildId: GUILD,
        host: { discordId: spielwahl.neueGastKennung(), username: 'Drei' },
      }),
    ).rejects.toThrow();

    // Ein Mitglied kommt weiterhin durch - seine Runde zählt nicht mit.
    await spielwahl.eroeffne({ guildId: GUILD, host: ANNA });
    expect(await prisma.spielwahlSession.count()).toBe(3);
  });

  it('gibt eine Gastrunde wieder frei, wenn eine geschlossen wird', async () => {
    await serverErlaubtGaeste(true, 1);
    clearRevisionCaches();

    const erste = spielwahl.neueGastKennung();
    const session = await spielwahl.eroeffne({
      guildId: GUILD,
      host: { discordId: erste, username: 'Eins' },
    });
    await expect(
      spielwahl.eroeffne({
        guildId: GUILD,
        host: { discordId: spielwahl.neueGastKennung(), username: 'Zwei' },
      }),
    ).rejects.toThrow();

    await spielwahl.schliesse(session.id, { discordId: erste, username: 'Eins' });

    // Geschlossen heisst: zählt nicht mehr. Die Grenze ist eine über offene
    // Runden, nicht eine über je gemachte.
    const zweite = await spielwahl.eroeffne({
      guildId: GUILD,
      host: { discordId: spielwahl.neueGastKennung(), username: 'Zwei' },
    });
    expect(zweite.id).toBeTruthy();
  });

  it('führt eine Gastrunde von der Lobby bis zum Ergebnis', async () => {
    const gameIds = await spiele(2);
    const gast = spielwahl.neueGastKennung();
    const wer = { discordId: gast, username: 'Nina' };
    const session = await spielwahl.eroeffne({ guildId: GUILD, host: wer });

    // Vorschlagen, Phase schliessen, starten - alles durch denselben Gast.
    await spielwahl.schlageVor(session.id, gast, { gameId: gameIds[0] });
    await spielwahl.schlageVor(session.id, gast, { gameId: gameIds[1] });
    await spielwahl.aendereEinstellungen(session.id, { modus: 'VOTING' });
    await spielwahl.schliesseVorschlaege(session.id, wer);
    await spielwahl.starte(session.id, wer);

    const kandidaten = await spielwahl.listeKandidaten(session.id);
    await spielwahl.stimme(session.id, gast, kandidaten[0]!.id, 0);

    /*
     * Das Ergebnis steht, sobald alle gewaehlt haben - hier ist «alle» eine
     * Person. Auf den Timer zu warten waere ein Test, der zehn Sekunden
     * schlaeft, um dasselbe zu sehen.
     */
    await spielwahl.nimmAn(session.id, wer);

    const zeile = await prisma.spielwahlSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(zeile.status).toBe('ABGESCHLOSSEN');
    expect(zeile.ergebnisCandidateId).toBe(kandidaten[0]!.id);
  });

  it('lässt einen fremden Gast die Runde eines Gastes nicht führen', async () => {
    const wirt = spielwahl.neueGastKennung();
    const fremd = spielwahl.neueGastKennung();
    const session = await spielwahl.eroeffne({
      guildId: GUILD,
      host: { discordId: wirt, username: 'Nina' },
    });
    await spielwahl.tritteBei(session.id, fremd, 'Tim');

    /*
     * «Ein Gast darf fuehren» heisst nicht «jeder Gast darf jede Runde
     * fuehren». Die Fuehrung haengt an der Rolle in dieser Session, und die
     * bekommt nur, wer sie eroeffnet hat oder sie uebertragen bekam.
     */
    const anderer = { discordId: fremd, username: 'Tim' };
    await expect(spielwahl.schliesseVorschlaege(session.id, anderer)).rejects.toThrow();
    await expect(spielwahl.nimmAn(session.id, anderer)).rejects.toThrow();
    await expect(spielwahl.schliesse(session.id, anderer)).rejects.toThrow();
  });

  it('gibt die Führung einer Gastrunde an den nächsten Gast weiter', async () => {
    const wirt = spielwahl.neueGastKennung();
    const naechster = spielwahl.neueGastKennung();
    const session = await spielwahl.eroeffne({
      guildId: GUILD,
      host: { discordId: wirt, username: 'Nina' },
    });
    await spielwahl.tritteBei(session.id, naechster, 'Tim');

    await spielwahl.verlasse(session.id, wirt);

    /*
     * Hier bricht die Runde **nicht** ab - anders als in der Mitgliedsrunde
     * weiter oben. Der Unterschied ist nicht die Nachsicht, sondern die
     * Richtung: eine Gastrunde in Gasthand zu lassen eröffnet niemandem
     * etwas, was er nicht schon hatte.
     */
    const zeile = await prisma.spielwahlSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(zeile.status).not.toBe('ABGEBROCHEN');
    expect(zeile.hostDiscordId).toBe(naechster);
  });

  it('lässt den Gast-Host einen anderen Gast zum Co-Host machen - in seiner Runde', async () => {
    const wirt = spielwahl.neueGastKennung();
    const zweiter = spielwahl.neueGastKennung();
    const session = await spielwahl.eroeffne({
      guildId: GUILD,
      host: { discordId: wirt, username: 'Nina' },
    });
    await spielwahl.tritteBei(session.id, zweiter, 'Tim');

    await spielwahl.setzeCoHost(session.id, zweiter, true, { discordId: wirt, username: 'Nina' });

    const zeile = await prisma.spielwahlParticipant.findUniqueOrThrow({
      where: { sessionId_discordId: { sessionId: session.id, discordId: zweiter } },
    });
    expect(zeile.rolle).toBe('COHOST');
  });

  it('macht eine Gastrunde, die an ein Mitglied übergeben wurde, zur Mitgliedsrunde', async () => {
    /*
     * Die Monotonie der Regel, als Test.
     *
     * Eine Gastrunde darf in Mitgliedshand uebergehen - das ist der sichere
     * Weg. Danach ist sie eine Mitgliedsrunde, und ab dann wird kein Gast
     * mehr zum Host. Haengt die Regel an `hostDiscordId`, gilt das von
     * selbst; dieser Test nagelt fest, dass es so bleibt.
     */
    const wirt = spielwahl.neueGastKennung();
    const dritter = spielwahl.neueGastKennung();
    const session = await spielwahl.eroeffne({
      guildId: GUILD,
      host: { discordId: wirt, username: 'Nina' },
    });
    await spielwahl.tritteBei(session.id, ANNA.discordId);
    await spielwahl.tritteBei(session.id, dritter, 'Tim');

    await spielwahl.uebergib(session.id, ANNA.discordId, { discordId: wirt, username: 'Nina' });

    const zeile = await prisma.spielwahlSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(zeile.hostDiscordId).toBe(ANNA.discordId);

    // Ab jetzt ist es eine Mitgliedsrunde - kein Gast wird mehr Host.
    await expect(spielwahl.setzeCoHost(session.id, dritter, true, ANNA)).rejects.toThrow();
    await expect(spielwahl.uebergib(session.id, dritter, ANNA)).rejects.toThrow();
  });

  it('lässt den Gast-Host sich nicht selbst aussperren', async () => {
    const wirt = spielwahl.neueGastKennung();
    const session = await spielwahl.eroeffne({
      guildId: GUILD,
      host: { discordId: wirt, username: 'Nina' },
    });

    /*
     * `gaesteErlaubt` ist in dieser Runde die Tuer, durch die der Host selbst
     * hereingekommen ist. Ausgeschaltet koennte er sie nicht mehr bedienen und
     * nicht einmal beenden - eine Einstellung, die mit einem Klick zuschlaegt.
     */
    await expect(spielwahl.aendereEinstellungen(session.id, { gaesteErlaubt: false })).rejects.toThrow();

    const zeile = await prisma.spielwahlSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(zeile.gaesteErlaubt).toBe(true);
  });

  it('lässt ein Mitglied in seiner eigenen Runde weiterhin abschalten', async () => {
    // Die Gegenprobe: der Riegel gilt der Gastrunde, nicht dem Schalter.
    const session = await spielwahl.eroeffne({ guildId: GUILD, host: ANNA });
    await spielwahl.aendereEinstellungen(session.id, { gaesteErlaubt: false });

    const zeile = await prisma.spielwahlSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(zeile.gaesteErlaubt).toBe(false);
  });

  it('schreibt die eröffnete Gastrunde ins Protokoll', async () => {
    const gast = spielwahl.neueGastKennung();
    const session = await spielwahl.eroeffne({
      guildId: GUILD,
      host: { discordId: gast, username: 'Nina' },
    });

    /*
     * Eine Handlung ohne Konto ist kein Grund, sie nicht aufzuschreiben - im
     * Gegenteil. Die Gastkennung steht als Handelnder im Protokoll, genau wie
     * sie in der Teilnehmerzeile steht.
     */
    const eintrag = await prisma.auditLog.findFirst({
      where: { action: 'SPIELWAHL_SESSION_CREATED', actorDiscordId: gast },
    });
    expect(eintrag).not.toBeNull();
    expect(eintrag?.actorUsername).toBe('Nina');
    expect((eintrag?.metadata as { sessionId?: string } | null)?.sessionId).toBe(session.id);
  });
});
