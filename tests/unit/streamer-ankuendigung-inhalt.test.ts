import { describe, expect, it } from 'vitest';
import {
  bereiteErwaehnung,
  baueEmbed,
  setzeVorlageEin,
  type SessionMitKanal,
} from '../../packages/modules/src/streamer/ankuendigung';
import { STREAMER_SETTINGS_VORGABE, type StreamerSettings } from '../../packages/modules/src/streamer/config';

/**
 * Was in einer Live-Ankuendigung steht - und was nicht.
 *
 * Diese drei Funktionen bauen die Nachricht, die spaeter in einem Kanal mit
 * mehreren hundert Mitgliedern landet. Sie haengen an nichts: kein Discord,
 * keine Datenbank. Genau deshalb lassen sich die beiden Zusagen einzeln
 * pruefen, die §9.2 und §12 verlangen:
 *
 *  - Es wird niemals `@everyone` oder `@here` gepingt.
 *  - Es steht keine Zahl darin, die wir nicht beobachtet haben.
 */

const einstellungen = (teile: Partial<StreamerSettings> = {}): StreamerSettings => ({
  ...STREAMER_SETTINGS_VORGABE,
  ankuendigungAktiv: true,
  ankuendigungChannelId: '200000000000000001',
  ...teile,
});

const session = (teile: Partial<SessionMitKanal> = {}): SessionMitKanal =>
  ({
    id: 'sess-1',
    kanalId: 'kanal-1',
    externeSessionId: '48215309421',
    titel: 'Feierabend-Runde',
    spiel: 'Valorant',
    vorschaubildUrl: 'https://cdn/live_a-{width}x{height}.jpg',
    zuschauer: 42,
    zuschauerHoehepunkt: 42,
    sprache: 'de',
    streamUrl: 'https://twitch.tv/swisshub_dev',
    gestartetAm: new Date('2026-09-26T18:00:00.000Z'),
    zuletztGesehenAm: new Date('2026-09-26T18:03:00.000Z'),
    beendetAm: null,
    createdAt: new Date('2026-09-26T18:00:00.000Z'),
    updatedAt: new Date('2026-09-26T18:03:00.000Z'),
    ...teile,
    kanal: {
      id: 'kanal-1',
      profilId: 'profil-1',
      plattform: 'TWITCH',
      externeId: '10000001',
      handle: 'swisshub_dev',
      anzeigename: 'SwissHub_Dev',
      verifikation: 'OAUTH',
      aktiv: true,
      zuletztGeprueftAm: null,
      letzterFehler: null,
      letzterFehlerAm: null,
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      updatedAt: new Date('2026-09-01T00:00:00.000Z'),
      ...(teile.kanal ?? {}),
      profil: {
        discordId: '100000000000000001',
        ankuendigungAktiv: true,
        status: 'APPROVED',
        ...(teile.kanal?.profil ?? {}),
      },
    },
  }) as unknown as SessionMitKanal;

const daten = {
  anzeigename: 'Lea',
  profilbildUrl: 'https://cdn.discordapp.com/avatars/1/abc.png?size=128',
  swisshubUrl: 'https://swisshub.ch/streamer/lea',
};

describe('Streamer Hub: Erwaehnungen', () => {
  it('pingt niemals @everyone oder @here', () => {
    /*
     * Zwei Vorkehrungen gleichzeitig, und beide sind noetig:
     *
     *  - `parse: []` heisst, dass Discord von sich aus nichts aufloest. Ein
     *    `@everyone` im Text bliebe damit Text.
     *  - Es wird zusaetzlich entfernt, damit es nicht einmal **so aussieht**.
     *    Ein sichtbares «@everyone» in einer Ankuendigung liest jemand als
     *    Ping und fragt, warum er keine Benachrichtigung bekam.
     */
    const ergebnis = bereiteErwaehnung('@everyone @here <@&300000000000000001> Achtung');
    expect(ergebnis.inhalt).not.toContain('@everyone');
    expect(ergebnis.inhalt).not.toContain('@here');
    expect(ergebnis.inhalt).toContain('<@&300000000000000001>');
    expect(ergebnis.allowedMentions).toEqual({ parse: [], roles: ['300000000000000001'] });
  });

  it('erlaubt nur die Rollen, die wirklich im Text stehen', () => {
    // Doppelt genannt heisst einmal erlaubt - und keine andere Rolle.
    const ergebnis = bereiteErwaehnung('<@&1000000000000000001> <@&1000000000000000001> los');
    expect(ergebnis.allowedMentions).toEqual({ parse: [], roles: ['1000000000000000001'] });
  });

  it('macht aus einem leeren Erwaehnungstext keinen leeren Beitrag', () => {
    // Vorgabe ist leer: dann gibt es keinen `content`, nur das Embed.
    const ergebnis = bereiteErwaehnung('');
    expect(ergebnis.inhalt).toBeUndefined();
    expect(ergebnis.allowedMentions).toEqual({ parse: [] });
  });
});

describe('Streamer Hub: Vorlage', () => {
  it('laesst einen Platzhalter ohne Wert weg statt ihn zu erfinden', () => {
    /*
     * «Lea ist live mit unbekannt» ist schlechter als «Lea ist live». YouTube
     * liefert kein Spiel, und ein geratenes Spiel stuende danach in einer
     * Ankuendigung und auf einer Instagram-Grafik.
     */
    expect(
      setzeVorlageEin('{streamer} spielt {spiel} - {titel}', {
        streamer: 'Lea',
        titel: null,
        spiel: null,
        plattform: 'YouTube',
        url: 'https://x',
      }),
    ).toBe('Lea spielt -');
  });

  it('setzt alle bekannten Platzhalter ein', () => {
    expect(
      setzeVorlageEin('{streamer} ist live auf {plattform}: {titel} ({spiel}) {url}', {
        streamer: 'Lea',
        titel: 'Feierabend',
        spiel: 'Valorant',
        plattform: 'Twitch',
        url: 'https://twitch.tv/lea',
      }),
    ).toBe('Lea ist live auf Twitch: Feierabend (Valorant) https://twitch.tv/lea');
  });

  it('ruehrt einen unbekannten Platzhalter nicht an', () => {
    // Lieber sichtbar stehenlassen als stillschweigend loeschen: dann sieht der
    // Betreiber, dass er sich verschrieben hat.
    expect(
      setzeVorlageEin('{streamer} {zuschauer}', {
        streamer: 'Lea',
        titel: null,
        spiel: null,
        plattform: 'Twitch',
        url: 'https://x',
      }),
    ).toBe('Lea {zuschauer}');
  });
});

describe('Streamer Hub: Embed', () => {
  it('nennt keine Zuschauerzahl, wenn die Plattform keine geliefert hat', () => {
    /*
     * Eine Null waere eine Behauptung, und zwar eine, die einem Streamer
     * schadet: «0 Zuschauer» stuende bei jedem Kanal, der die Zahl verbirgt.
     */
    const ohne = baueEmbed(session({ zuschauer: null }), daten, einstellungen());
    const felder = ohne.embeds?.[0]?.fields ?? [];
    expect(felder.map((feld) => feld.name)).not.toContain('Zuschauer');

    const mit = baueEmbed(session({ zuschauer: 7 }), daten, einstellungen());
    expect(mit.embeds?.[0]?.fields?.find((feld) => feld.name === 'Zuschauer')?.value).toBe('7');
  });

  it('setzt die Masse im Vorschaubild ein und umgeht den Bildzwischenspeicher', () => {
    const payload = baueEmbed(session(), daten, einstellungen());
    const bild = payload.embeds?.[0]?.image?.url ?? '';
    expect(bild).toContain('1280x720');
    expect(bild).not.toContain('{width}');
    // Der Zeitstempel: ohne ihn zeigt Discord bei der zweiten Ankuendigung
    // desselben Kanals das Bild der ersten.
    expect(bild).toContain(`t=${new Date('2026-09-26T18:00:00.000Z').getTime()}`);
  });

  it('verlinkt das SwissHub-Profil nur, wenn es eines gibt', () => {
    const mit = baueEmbed(session(), daten, einstellungen());
    expect(JSON.stringify(mit.components)).toContain('Streamer-Profil');

    const ohne = baueEmbed(session(), { ...daten, swisshubUrl: null }, einstellungen());
    // Ein Knopf, der auf eine 404 fuehrt, ist schlechter als keiner.
    expect(JSON.stringify(ohne.components)).not.toContain('Streamer-Profil');
    expect(JSON.stringify(ohne.components)).toContain('Auf Twitch anschauen');
  });

  it('nimmt den Anzeigenamen aus dem Profil und nicht von der Plattform', () => {
    /*
     * Auf der Plattform heisst der Kanal «SwissHub_Dev», im SwissHub-Profil
     * «Lea». Angekuendigt wird «Lea» - sonst hiesse dieselbe Person auf Discord
     * anders als in ihrem Profil.
     */
    const payload = baueEmbed(session(), daten, einstellungen());
    expect(payload.embeds?.[0]?.author?.name).toContain('Lea');
    expect(payload.embeds?.[0]?.author?.name).not.toContain('SwissHub_Dev');
  });
});
