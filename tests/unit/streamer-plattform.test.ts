import { describe, expect, it } from 'vitest';
import {
  KanalEingabeFehler,
  bewerbungSchema,
  embedAdresse,
  erkenneKanal,
  hatKanal,
  kanalAdresse,
  plattform,
  streamAdresse,
  vorschaubild,
} from '../../packages/modules/src/streamer/plattform';

/**
 * Die Kanalerkennung - die Stelle, an der eine Bewerbung scheitert oder nicht.
 *
 * `plattform.ts` haengt an nichts: keine Datenbank, kein `fetch`, keine
 * Umgebung. Genau deshalb kann das Bewerbungsformular im Browser dieselbe
 * Funktion benutzen, die der Server danach anwendet - und genau deshalb ist
 * jede Regel hier einzeln pruefbar.
 *
 * Geprueft wird vor allem, was Leute **tatsaechlich** hineinkopieren: die
 * vollstaendige Adresse mit Abfrageparametern, die Adresse ohne Schema, das
 * @handle, die nackte Kanal-ID. Eine Oberflaeche, die nur eine dieser Formen
 * annimmt, schickt die Haelfte der Bewerber wieder weg.
 */
describe('Streamer Hub: Kanalerkennung', () => {
  it('nimmt einen Twitch-Kanal in allen Formen, die vorkommen', () => {
    for (const eingabe of [
      'swisshub_dev',
      'twitch.tv/swisshub_dev',
      'https://twitch.tv/swisshub_dev',
      'https://www.twitch.tv/swisshub_dev',
      'https://www.twitch.tv/swisshub_dev?tt_medium=mobile_web_share',
      'https://www.twitch.tv/swisshub_dev/',
      // Eine Unterseite ist derselbe Kanal - der Pfad danach gehoert nicht dazu.
      'https://www.twitch.tv/swisshub_dev/videos',
      '  twitch.tv/swisshub_dev  ',
    ]) {
      expect(erkenneKanal('TWITCH', eingabe), eingabe).toEqual({
        plattform: 'TWITCH',
        art: 'twitchLogin',
        wert: 'swisshub_dev',
      });
    }
  });

  it('schreibt einen Twitch-Login klein', () => {
    /*
     * Twitch antwortet auf `login=SwissHub_Dev` leer. Ein Kanal, der sich
     * eintragen laesst und danach nie live ist, ist der schlimmste Zustand:
     * es sieht aus, als funktionierte die Erkennung nicht.
     */
    expect(erkenneKanal('TWITCH', 'SwissHub_Dev').wert).toBe('swisshub_dev');
  });

  it('lehnt ab, was kein Twitch-Login sein kann', () => {
    for (const eingabe of ['', '  ', 'ab', 'mit leerzeichen', 'punkt.im.namen', 'ä-umlaut', 'a'.repeat(26)]) {
      expect(() => erkenneKanal('TWITCH', eingabe), eingabe).toThrow(KanalEingabeFehler);
    }
  });

  it('erkennt YouTube an der Kanal-ID, am Handle und an der Kanaladresse', () => {
    const id = 'UCBR8-60-B28hp2BmDPdntcQ';
    for (const eingabe of [id, `https://youtube.com/channel/${id}`, `youtube.com/channel/${id}/`]) {
      expect(erkenneKanal('YOUTUBE', eingabe), eingabe).toEqual({
        plattform: 'YOUTUBE',
        art: 'youtubeKanalId',
        wert: id,
      });
    }
    for (const eingabe of ['@swisshub', 'swisshub', 'https://youtube.com/@swisshub']) {
      expect(erkenneKanal('YOUTUBE', eingabe), eingabe).toEqual({
        plattform: 'YOUTUBE',
        art: 'youtubeHandle',
        wert: 'swisshub',
      });
    }
  });

  it('sagt bei den alten YouTube-Adressen, was stattdessen gebraucht wird', () => {
    /*
     * `/c/<name>` und `/user/<name>` lassen sich mit der Data API nicht
     * zuverlaessig aufloesen. Eine Bewerbung stillschweigend anzunehmen und
     * den Kanal danach leer zu lassen waere die schlechtere Antwort - der
     * Fehlertext nennt deshalb den Weg zur Kanal-ID.
     */
    for (const eingabe of ['https://youtube.com/c/SwissHub', 'youtube.com/user/SwissHub']) {
      expect(() => erkenneKanal('YOUTUBE', eingabe), eingabe).toThrow(/UC/u);
    }
  });

  it('baut Kanal- und Streamadressen je Plattform richtig', () => {
    expect(kanalAdresse('TWITCH', 'swisshub_dev')).toBe('https://twitch.tv/swisshub_dev');
    expect(kanalAdresse('YOUTUBE', 'UCBR8-60-B28hp2BmDPdntcQ')).toBe(
      'https://youtube.com/channel/UCBR8-60-B28hp2BmDPdntcQ',
    );
    expect(kanalAdresse('YOUTUBE', 'swisshub')).toBe('https://youtube.com/@swisshub');

    // Twitch: der Kanal, denn dort laeuft immer nur ein Stream.
    expect(streamAdresse('TWITCH', 'swisshub_dev', '48215309421')).toBe('https://twitch.tv/swisshub_dev');
    // YouTube: das Video, denn ein Kanal zeigt daneben anderes.
    expect(streamAdresse('YOUTUBE', 'UCBR8-60-B28hp2BmDPdntcQ', 'dQw4w9WgXcQ')).toBe(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    );
  });

  it('gibt keine Einbettungsadresse zurueck, wo es keine zulaessige gibt', () => {
    /*
     * Der wichtigere der beiden Zweige. Ein `<iframe>` auf eine Adresse, die
     * die Plattform nicht dafuer vorsieht, ist fremder Code auf unserer Seite -
     * die Seite zeigt dann lieber das Vorschaubild mit einem Link.
     */
    // YouTube ohne laufendes Video: es gibt nichts einzubetten.
    expect(embedAdresse('YOUTUBE', 'UCBR8-60-B28hp2BmDPdntcQ', null, 'swisshub.ch')).toBeNull();
    // Twitch ohne bekannten eigenen Hostnamen: der Player verweigert ohne `parent`.
    expect(embedAdresse('TWITCH', 'swisshub_dev', '1', '   ')).toBeNull();

    const twitch = embedAdresse('TWITCH', 'swisshub_dev', '1', 'SwissHub.ch');
    expect(twitch).toContain('player.twitch.tv');
    expect(twitch).toContain('parent=swisshub.ch');
    expect(twitch).toContain('autoplay=false');

    // Und YouTube ohne Zaehlung fuer Besucher, die nichts angeklickt haben.
    expect(embedAdresse('YOUTUBE', 'UCx', 'dQw4w9WgXcQ', 'swisshub.ch')).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    );
  });

  it('setzt die Masse in ein Twitch-Vorschaubild ein', () => {
    // Bleiben die Platzhalter stehen, antwortet Twitchs CDN mit 404 - und die
    // Uebersicht ist voller grauer Kaesten.
    expect(vorschaubild('https://cdn/live_1-{width}x{height}.jpg', 1280, 720)).toBe(
      'https://cdn/live_1-1280x720.jpg',
    );
    expect(vorschaubild(null)).toBeNull();
  });

  it('verlangt mindestens eine Sprache und mindestens einen Kanal', () => {
    const gueltig = bewerbungSchema.safeParse({ sprachen: ['de'], twitch: 'twitch.tv/a_b_c' });
    expect(gueltig.success).toBe(true);

    expect(bewerbungSchema.safeParse({ sprachen: [] }).success).toBe(false);
    expect(bewerbungSchema.safeParse({ sprachen: ['klingonisch'] }).success).toBe(false);

    // Und die Aussage ueber zwei Felder, die das Schema nicht treffen kann.
    expect(hatKanal({ twitch: '', youtube: '' })).toBe(false);
    expect(hatKanal({ twitch: '  ', youtube: '@kanal' })).toBe(true);
  });

  it('kennt genau zwei Plattformen und wirft bei einer dritten', () => {
    expect(plattform('TWITCH').oauthMoeglich).toBe(true);
    // YouTube kann die Inhaberschaft in dieser Fassung nicht selbst beweisen -
    // und die Oberflaeche sagt das, statt es zu behaupten.
    expect(plattform('YOUTUBE').oauthMoeglich).toBe(false);
    expect(() => plattform('KICK')).toThrow(/Unbekannte Plattform/u);
  });
});
