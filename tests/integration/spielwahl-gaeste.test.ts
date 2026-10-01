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
 *   - Ein Gast tritt bei, steht mit Namen in der Liste, stimmt mit, und seine
 *     Stimme zählt wie jede andere.
 *   - Ein Gast schlägt nichts vor, kommt nicht in eine Runde ohne
 *     `gaesteErlaubt`, und eine erfundene Kennung kommt gar nicht erst durch.
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
async function serverErlaubtGaeste(erlaubt: boolean): Promise<void> {
  await setModuleSettings(
    spielwahl.SPIELWAHL_MODULE_ID,
    {
      vorschlaegeProPerson: 3,
      maxTeilnehmerGrenze: 12,
      abstimmdauerSek: 45,
      freieVorschlaege: true,
      gaesteErlaubt: erlaubt,
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

  it('öffnet eine Runde nur, wenn Server und Host es wollen', async () => {
    const zu = await spielwahl.eroeffne({ guildId: GUILD, host: ANNA });
    const gast = spielwahl.neueGastKennung();

    // Vorgabe ist aus - der Host hat nichts gesagt.
    await expect(spielwahl.verlangeGastZugang(zu.id, gast)).rejects.toThrow();

    const offen = await spielwahl.eroeffne({
      guildId: GUILD,
      host: BEN,
      optionen: { gaesteErlaubt: true },
    });
    await expect(spielwahl.verlangeGastZugang(offen.id, gast)).resolves.toMatchObject({ id: offen.id });
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
    const session = await spielwahl.eroeffne({ guildId: GUILD, host: ANNA });
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

  it('lässt einen Gast kein Spiel vorschlagen - auch nicht direkt', async () => {
    const gameIds = await spiele(2);
    const session = await spielwahl.eroeffne({
      guildId: GUILD,
      host: ANNA,
      optionen: { gaesteErlaubt: true },
    });
    const gast = spielwahl.neueGastKennung();
    await spielwahl.tritteBei(session.id, gast, 'Nina');

    /*
     * Die Sperre steht in `schlageVor` selbst - nicht in der Aktion und nicht
     * in der Oberflaeche. Dieser Aufruf umgeht beide.
     */
    await expect(spielwahl.schlageVor(session.id, gast, { gameId: gameIds[0] })).rejects.toThrow();
    await expect(spielwahl.schlageVor(session.id, gast, { freierName: 'Irgendwas' })).rejects.toThrow();

    expect(await prisma.spielwahlCandidate.count({ where: { sessionId: session.id } })).toBe(0);
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
    const einstellungen = await getModuleSettings<spielwahl.SpielwahlSettings>(
      spielwahl.SPIELWAHL_MODULE_ID,
    );
    expect(einstellungen.gaesteErlaubt).toBe(true);
  });

  it('bleibt aus, wenn ein Server ihn ausdruecklich ausgemacht hat', async () => {
    await serverErlaubtGaeste(false);
    clearRevisionCaches();

    const einstellungen = await getModuleSettings<spielwahl.SpielwahlSettings>(
      spielwahl.SPIELWAHL_MODULE_ID,
    );
    // Kein Standard ueberschreibt eine Entscheidung, die schon getroffen ist.
    expect(einstellungen.gaesteErlaubt).toBe(false);
  });

  it('laesst sich danach von Hand wieder anschalten', async () => {
    await serverErlaubtGaeste(false);
    clearRevisionCaches();
    await serverErlaubtGaeste(true);
    clearRevisionCaches();

    const einstellungen = await getModuleSettings<spielwahl.SpielwahlSettings>(
      spielwahl.SPIELWAHL_MODULE_ID,
    );
    expect(einstellungen.gaesteErlaubt).toBe(true);
  });
});
