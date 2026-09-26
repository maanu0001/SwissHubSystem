import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_streamer_bewerbung');

/**
 * Registrierung, Inhaberschaft, Freigabe - und was dazwischen nicht passieren darf.
 *
 * ## Die Frage, um die es hier geht
 *
 * §5 verlangt: **kein Mitglied darf einen fremden Kanal als seinen eigenen
 * eintragen.** Das ist kein Randfall - wer `twitch.tv/gronkh` eintraegt und
 * freigegeben wird, laesst SwissHub dessen Streams ankuendigen und stellt ihn
 * auf die oeffentliche Seite.
 *
 * Abgesichert ist das an drei Stellen, und jede wird hier geprueft:
 *
 *   1. `@@unique([plattform, externeId])` - ein Kanal gehoert einem Profil.
 *      In der Datenbank, nicht im Code: zwei gleichzeitige Bewerbungen auf
 *      denselben Kanal wuerden an einer Pruefung «gibt es schon?» beide
 *      vorbeikommen.
 *   2. Der OAuth-Rueckweg vergleicht die Kennung, die **Twitch** genannt hat,
 *      mit der eingetragenen - nicht die Namen.
 *   3. Gespeichert wird die unveraenderliche Kennung und nicht der Name. Ein
 *      Eintrag auf den Namen folgte nach einer Umbenennung dem naechsten
 *      Inhaber.
 *
 * ## Und warum «vergeben» nicht sagt, wem
 *
 * Sonst waere die Bewerbungsmaske ein Werkzeug, um herauszufinden, welches
 * Mitglied welchen Kanal hat.
 */
/*
 * Die Zugangsdaten kommen auch im Test aus der zentralen Integrationsverwaltung
 * und nicht aus einem Parameter. `twitchZugang()` ist bewusst nicht
 * austauschbar: ein Weg, Zugangsdaten von aussen einzusetzen, waere ein Weg an
 * der Verschluesselung vorbei. Injiziert wird nur der Abruf.
 */
process.env.MASTER_ENCRYPTION_KEY = Buffer.alloc(32, 17).toString('base64');

const { prisma } = await import('@swisshub/database');
const { streamer } = await import('@swisshub/modules');
const secrets = await import('@swisshub/secrets');

const LEA = '100000000000000001';
const BEN = '100000000000000002';
const MOD = '100000000000000009';

/** Twitchs Kennung - der Anker, nicht der Name. */
const KANAL_ID = '10000001';

/** Eine Twitch-Attrappe, die einen Kanal je Login kennt. */
function twitch(kanaele: Record<string, { id: string; login: string; name: string }>) {
  return async (url: string): Promise<Response> => {
    if (url.includes('id.twitch.tv')) {
      return new Response(JSON.stringify({ access_token: 'attrappe', expires_in: 3600 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    const logins = new URL(url).searchParams.getAll('login');
    return new Response(
      JSON.stringify({
        data: logins
          .filter((login) => kanaele[login])
          .map((login) => ({
            id: kanaele[login]!.id,
            login: kanaele[login]!.login,
            display_name: kanaele[login]!.name,
            profile_image_url: 'https://cdn/lea.png',
            description: 'Streamt abends.',
          })),
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
}

const KANAELE = {
  lea_streamt: { id: KANAL_ID, login: 'lea_streamt', name: 'Lea_Streamt' },
  ben_streamt: { id: '10000002', login: 'ben_streamt', name: 'Ben_Streamt' },
};

const eingabe = (teile: Record<string, unknown> = {}) => ({
  beschreibung: 'Ich streame abends.',
  sprachen: ['de'],
  spiele: [],
  twitch: '',
  youtube: '',
  ankuendigungAktiv: true,
  ...teile,
});

describeWithDatabase('Streamer Hub: Bewerbung und Inhaberschaft', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    // Das App Access Token lebt im Modulzustand - jeder Fall holt es frisch.
    streamer.verwerfeToken();
    await prisma.streamerSession.deleteMany();
    await prisma.streamerKanal.deleteMany();
    await prisma.streamerProfil.deleteMany();
    await prisma.auditLog.deleteMany();
    await secrets.setSecret('twitch', 'clientId', 'abcdefghij0123456789', { actorDiscordId: 'test' });
    await secrets.setSecret('twitch', 'clientSecret', 'kein-echtes-secret-nur-ein-testwert', {
      actorDiscordId: 'test',
    });
  });

  it('speichert einen Kanal mit der Kennung der Plattform, nicht mit dem Namen', async () => {
    const ergebnis = await streamer.speichereBewerbung(
      LEA,
      eingabe({ twitch: 'https://twitch.tv/Lea_Streamt?ref=x' }),
      twitch(KANAELE),
    );

    expect(ergebnis.vergeben).toEqual([]);
    const kanal = ergebnis.profil.kanaele[0]!;
    expect(kanal.externeId).toBe(KANAL_ID);
    // Der Name ist nur Beiwerk - er wird bei jeder Aufloesung nachgezogen.
    expect(kanal.handle).toBe('lea_streamt');
    // Und unbestaetigt: eine Eingabe ist kein Nachweis.
    expect(kanal.verifikation).toBe('KEINE');
    expect(ergebnis.profil.status).toBe('DRAFT');
  });

  it('laesst einen fremden Kanal nicht als eigenen eintragen', async () => {
    await streamer.speichereBewerbung(LEA, eingabe({ twitch: 'lea_streamt' }), twitch(KANAELE));

    const fremd = await streamer.speichereBewerbung(BEN, eingabe({ twitch: 'lea_streamt' }), twitch(KANAELE));

    expect(fremd.vergeben).toEqual(['TWITCH']);
    // Bens Bewerbung existiert - aber ohne diesen Kanal.
    expect(fremd.profil.kanaele).toHaveLength(0);
    // Und Leas Kanal ist unberuehrt.
    const kanal = await prisma.streamerKanal.findFirstOrThrow({ include: { profil: true } });
    expect(kanal.profil.discordId).toBe(LEA);
  });

  it('verraet nicht, wem ein vergebener Kanal gehoert', async () => {
    await streamer.speichereBewerbung(LEA, eingabe({ twitch: 'lea_streamt' }), twitch(KANAELE));
    const fremd = await streamer.speichereBewerbung(BEN, eingabe({ twitch: 'lea_streamt' }), twitch(KANAELE));
    /*
     * Die Antwort ist eine Plattformkennung und sonst nichts. Kein Name, keine
     * Discord-ID, kein Profil - sonst waere die Maske eine Suchfunktion.
     */
    expect(JSON.stringify(fremd.vergeben)).not.toContain(LEA);
    expect(JSON.stringify(fremd.vergeben)).toBe('["TWITCH"]');
  });

  it('haelt die Eindeutigkeit auch bei zwei gleichzeitigen Bewerbungen', async () => {
    /*
     * Echtes `Promise.all`, nicht zweimal nacheinander. Eine Pruefung «gibt es
     * den Kanal schon?» haette hier ein Zeitfenster: beide finden nichts, beide
     * schreiben. Die Bedingung in der Datenbank hat dieses Fenster nicht.
     */
    const [einer, anderer] = await Promise.all([
      streamer.speichereBewerbung(LEA, eingabe({ twitch: 'lea_streamt' }), twitch(KANAELE)),
      streamer.speichereBewerbung(BEN, eingabe({ twitch: 'lea_streamt' }), twitch(KANAELE)),
    ]);

    const zusammen = [...einer.profil.kanaele, ...anderer.profil.kanaele];
    expect(zusammen).toHaveLength(1);
    expect([einer.vergeben.length, anderer.vergeben.length].sort()).toEqual([0, 1]);
    expect(await prisma.streamerKanal.count()).toBe(1);
  });

  it('bestaetigt einen Kanal nur, wenn Twitch dieselbe Kennung nennt', async () => {
    await streamer.speichereBewerbung(LEA, eingabe({ twitch: 'lea_streamt' }), twitch(KANAELE));

    // Jemand hat sich mit einem anderen Twitch-Konto angemeldet. Genau dafuer
    // steht `force_verify` in der Autorisierungsadresse.
    const falsch = await streamer.bestaetigeKanal(LEA, 'TWITCH', '99999999', 'jemand_anders');
    expect(falsch.bestaetigt).toBe(false);
    expect(falsch.grund).toContain('jemand_anders');
    const unbestaetigt = await prisma.streamerKanal.findFirstOrThrow();
    expect(unbestaetigt.verifikation).toBe('KEINE');

    const richtig = await streamer.bestaetigeKanal(LEA, 'TWITCH', KANAL_ID, 'lea_streamt');
    expect(richtig.bestaetigt).toBe(true);
    const bestaetigt = await prisma.streamerKanal.findFirstOrThrow();
    expect(bestaetigt.verifikation).toBe('OAUTH');
    // Bei OAuth war es die Plattform und kein Mensch.
    expect(bestaetigt.verifiziertVon).toBeNull();
    expect(bestaetigt.verifiziertAm).not.toBeNull();
  });

  it('nimmt die Verifikation zurueck, wenn ein anderer Kanal eingetragen wird', async () => {
    /*
     * Die Bestaetigung belegte die Inhaberschaft **eines** Kontos, nicht jedes
     * kuenftigen. Bliebe sie stehen, waere ein einmal bewiesener Kanal ein
     * Freifahrtschein fuer jeden weiteren.
     */
    await streamer.speichereBewerbung(LEA, eingabe({ twitch: 'lea_streamt' }), twitch(KANAELE));
    await streamer.bestaetigeKanal(LEA, 'TWITCH', KANAL_ID, 'lea_streamt');

    await streamer.speichereBewerbung(LEA, eingabe({ twitch: 'ben_streamt' }), twitch(KANAELE));
    const kanal = await prisma.streamerKanal.findFirstOrThrow();
    expect(kanal.externeId).toBe('10000002');
    expect(kanal.verifikation).toBe('KEINE');
    expect(kanal.verifiziertAm).toBeNull();
  });

  it('entfernt einen Kanal, der aus dem Formular verschwindet', async () => {
    // Sonst liesse sich ein einmal eingetragener Kanal nie wieder loswerden.
    await streamer.speichereBewerbung(LEA, eingabe({ twitch: 'lea_streamt' }), twitch(KANAELE));
    expect(await prisma.streamerKanal.count()).toBe(1);

    const ohne = await streamer
      .speichereBewerbung(LEA, eingabe({ twitch: '', youtube: '' }), twitch(KANAELE))
      .catch((fehler: Error) => fehler);
    // Ohne **jeden** Kanal laesst sich nicht speichern - es waere eine
    // Bewerbung ohne Gegenstand.
    expect(ohne).toBeInstanceOf(Error);
    expect(await prisma.streamerKanal.count()).toBe(1);
  });

  it('nennt einen Kanal, den Twitch nicht kennt, beim Namen', async () => {
    const fehler = await streamer
      .speichereBewerbung(LEA, eingabe({ twitch: 'gibt_es_nicht' }), twitch(KANAELE))
      .catch((ursache: Error) => ursache);
    expect(fehler).toBeInstanceOf(Error);
    expect((fehler as Error).message).toContain('gibt_es_nicht');
    // Und es entsteht kein Kanal, dessen Live-Abfrage fuer immer leer bliebe.
    expect(await prisma.streamerKanal.count()).toBe(0);
  });

  it('reicht eine Bewerbung genau einmal ein', async () => {
    await streamer.speichereBewerbung(LEA, eingabe({ twitch: 'lea_streamt' }), twitch(KANAELE));

    expect(await streamer.reicheEin(LEA)).toEqual({ eingereicht: true });
    // Zweimal Einreichen erzeugt keine zweite Bewerbung - und ein Klick auf
    // einer veralteten Seite schiebt eine entschiedene nicht zurueck.
    expect(await streamer.reicheEin(LEA)).toEqual({ eingereicht: false });
    expect((await prisma.streamerProfil.findFirstOrThrow()).status).toBe('PENDING');
  });

  it('laesst eine Bewerbung in Pruefung nicht mehr aendern', async () => {
    await streamer.speichereBewerbung(LEA, eingabe({ twitch: 'lea_streamt' }), twitch(KANAELE));
    await streamer.reicheEin(LEA);

    const fehler = await streamer
      .speichereBewerbung(LEA, eingabe({ twitch: 'ben_streamt' }), twitch(KANAELE))
      .catch((ursache: Error) => ursache);
    // Sonst entscheidet ein Moderator ueber einen Text, der beim Klick schon
    // ein anderer ist.
    expect(fehler).toBeInstanceOf(Error);
    expect((fehler as Error).message).toMatch(/Prüfung/u);
  });

  it('macht aus einer abgelehnten Bewerbung wieder einen Entwurf', async () => {
    await streamer.speichereBewerbung(LEA, eingabe({ twitch: 'lea_streamt' }), twitch(KANAELE));
    await streamer.reicheEin(LEA);
    const profil = await prisma.streamerProfil.findFirstOrThrow();

    await streamer.lehneAb(profil.id, 'Der Kanal gehört nicht dir.', MOD);
    expect((await prisma.streamerProfil.findFirstOrThrow()).status).toBe('REJECTED');

    // Ohne das blieb sie fuer immer abgelehnt und die Person konnte sich nie
    // korrigieren.
    const neu = await streamer.speichereBewerbung(LEA, eingabe({ twitch: 'lea_streamt' }), twitch(KANAELE));
    expect(neu.profil.status).toBe('DRAFT');
    expect(neu.profil.ablehnungsGrund).toBeNull();
  });

  it('verlangt fuer eine Ablehnung einen Grund', async () => {
    await streamer.speichereBewerbung(LEA, eingabe({ twitch: 'lea_streamt' }), twitch(KANAELE));
    await streamer.reicheEin(LEA);
    const profil = await prisma.streamerProfil.findFirstOrThrow();

    // Die Person soll wissen, was fehlt.
    await expect(streamer.lehneAb(profil.id, '   ', MOD)).rejects.toThrow();
    expect((await prisma.streamerProfil.findFirstOrThrow()).status).toBe('PENDING');
  });

  it('gibt nur eine Bewerbung frei, die zur Entscheidung steht', async () => {
    await streamer.speichereBewerbung(LEA, eingabe({ twitch: 'lea_streamt' }), twitch(KANAELE));
    const profil = await prisma.streamerProfil.findFirstOrThrow();

    // Ein Entwurf ist keine Bewerbung - genehmigt wird, was eingereicht wurde.
    const zuFrueh = await streamer.genehmige(profil.id, MOD);
    expect(zuFrueh.geaendert).toBe(false);

    await streamer.reicheEin(LEA);
    expect(await streamer.genehmige(profil.id, MOD)).toEqual({ geaendert: true });
    // Und ein zweiter Klick auf einer veralteten Seite tut nichts mehr.
    const nochmal = await streamer.genehmige(profil.id, MOD);
    expect(nochmal.geaendert).toBe(false);
    expect(nochmal.grund).toMatch(/entschieden/u);
  });

  it('beendet beim Pausieren die laufende Session', async () => {
    /*
     * Sonst liefe sie weiter, waehrend der Streamer nicht sichtbar ist - und
     * auf der oeffentlichen Seite stuende ein Live-Eintrag, den es nicht
     * mehr geben darf.
     */
    await streamer.speichereBewerbung(LEA, eingabe({ twitch: 'lea_streamt' }), twitch(KANAELE));
    await streamer.reicheEin(LEA);
    const profil = await prisma.streamerProfil.findFirstOrThrow();
    await streamer.genehmige(profil.id, MOD);

    const kanal = await prisma.streamerKanal.findFirstOrThrow();
    await prisma.streamerSession.create({
      data: {
        kanalId: kanal.id,
        externeSessionId: 'stream-1',
        gestartetAm: new Date(),
        zuletztGesehenAm: new Date(),
      },
    });

    await streamer.pausiere(profil.id, 'Beschwerde geprüft.', MOD);
    expect((await prisma.streamerProfil.findFirstOrThrow()).status).toBe('SUSPENDED');
    expect((await prisma.streamerSession.findFirstOrThrow()).beendetAm).not.toBeNull();
  });

  it('protokolliert Bewerbung, Bestaetigung und Freigabe - ohne Zugangsdaten', async () => {
    await streamer.speichereBewerbung(LEA, eingabe({ twitch: 'lea_streamt' }), twitch(KANAELE));
    await streamer.reicheEin(LEA);
    await streamer.bestaetigeKanal(LEA, 'TWITCH', KANAL_ID, 'lea_streamt');
    const profil = await prisma.streamerProfil.findFirstOrThrow();
    await streamer.genehmige(profil.id, MOD);

    const eintraege = await prisma.auditLog.findMany();
    const aktionen = eintraege.map((eintrag) => eintrag.action);
    expect(aktionen).toContain('STREAMER_APPLIED');
    expect(aktionen).toContain('STREAMER_CHANNEL_VERIFIED');
    expect(aktionen).toContain('STREAMER_APPROVED');

    /*
     * Und §17: eine einzelne Live-Abfrage steht **nicht** im Audit. Hier wird
     * zusaetzlich geprueft, dass kein Token und kein Geheimnis darin landet -
     * der OAuth-Zugriffstoken des Mitglieds wird ohnehin sofort widerrufen.
     */
    // `BigInt` in der Kette der Protokollzeilen - deshalb mit eigenem Ersetzer.
    const alles = JSON.stringify(eintraege, (_schluessel, wert) =>
      typeof wert === 'bigint' ? wert.toString() : wert,
    );
    expect(alles).not.toContain('attrappe');
    expect(alles).not.toContain('access_token');
    expect(aktionen.filter((aktion) => /LIVE|CHECK/u.test(aktion))).toEqual([]);
  });
});
