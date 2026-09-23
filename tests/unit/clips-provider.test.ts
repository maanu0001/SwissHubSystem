import { describe, expect, it } from 'vitest';
import { EINBETTUNGS_HOSTS, einbettung, erkenneClip } from '@swisshub/modules/clips/provider';

/**
 * Was als Clip durchgeht - und was nicht.
 *
 * ## Warum diese Datei so lang ist
 *
 * `erkenneClip()` ist die einzige Stelle, an der eine von aussen eingegebene
 * Adresse ueber die Schwelle kommt. Was hier durchrutscht, landet danach in
 * einem `iframe` auf einer angemeldeten Seite - und ein `iframe` fuellt den
 * Bildschirm und sieht aus wie unsere Anwendung.
 *
 * Geprueft wird deshalb nicht «funktioniert der gute Fall», sondern die
 * Liste der Versuche, die man in einem solchen Feld tatsaechlich sieht.
 */
describe('Clip-Anbieter erkennen', () => {
  describe('nimmt echte Clips an', () => {
    const gute: Array<[string, { provider: string; externalId: string }]> = [
      [
        'https://clips.twitch.tv/SpicyCloudyTortoiseKappaPride-AbCdEf123',
        { provider: 'twitch', externalId: 'SpicyCloudyTortoiseKappaPride-AbCdEf123' },
      ],
      [
        'https://www.twitch.tv/swisshub/clip/SpicyCloudyTortoise',
        { provider: 'twitch', externalId: 'SpicyCloudyTortoise' },
      ],
      ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', { provider: 'youtube', externalId: 'dQw4w9WgXcQ' }],
      ['https://youtu.be/dQw4w9WgXcQ', { provider: 'youtube', externalId: 'dQw4w9WgXcQ' }],
      ['https://m.youtube.com/watch?v=dQw4w9WgXcQ', { provider: 'youtube', externalId: 'dQw4w9WgXcQ' }],
    ];

    it.each(gute)('%s', (eingabe, erwartet) => {
      const erkannt = erkenneClip(eingabe);
      expect(erkannt.provider).toBe(erwartet.provider);
      expect(erkannt.externalId).toBe(erwartet.externalId);
    });

    it('wirft Tracking-Parameter weg - derselbe Clip ist derselbe Clip', () => {
      const mitMuell = erkenneClip(
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ&utm_source=discord&si=abc&t=42',
      );
      const ohne = erkenneClip('https://youtu.be/dQw4w9WgXcQ');
      expect(mitMuell.externalId).toBe(ohne.externalId);
      expect(mitMuell.canonicalUrl).toBe(ohne.canonicalUrl);
    });
  });

  describe('weist alles andere ab', () => {
    /*
     * Die Liste ist die eigentliche Pruefung.
     *
     * Jede Zeile ist ein Weg, auf dem man eine fremde Adresse in einen
     * Rahmen bekaeme - vom naiven `http://localhost` bis zur
     * Aehnlichkeitsdomain, die im Fliesstext niemandem auffaellt.
     */
    const schlechte: Array<[string, string]> = [
      ['leer', ''],
      ['nur Text', 'schau mal was ich gestern gemacht habe'],
      // Schema
      ['file://', 'file:///etc/passwd'],
      ['ftp://', 'ftp://example.com/clip.mp4'],
      ['javascript:', 'javascript:alert(document.cookie)'],
      ['data:', 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='],
      ['http statt https', 'http://clips.twitch.tv/EchterClipName'],
      ['ohne Schema', 'clips.twitch.tv/EchterClipName'],
      // Interne Ziele
      ['localhost', 'https://localhost/clip'],
      ['127.0.0.1', 'https://127.0.0.1:3000/clip'],
      ['privates Netz 10/8', 'https://10.0.0.5/clip'],
      ['privates Netz 192.168/16', 'https://192.168.1.1/clip'],
      ['privates Netz 172.16/12', 'https://172.16.0.1/clip'],
      ['Metadaten-Endpunkt AWS', 'https://169.254.169.254/latest/meta-data/'],
      ['Metadaten-Endpunkt GCP', 'https://metadata.google.internal/computeMetadata/v1/'],
      ['IPv6-Loopback', 'https://[::1]/clip'],
      // Aehnliche Namen
      ['Subdomain-Trick', 'https://youtube.com.angreifer.example/watch?v=dQw4w9WgXcQ'],
      ['Praefix-Trick', 'https://evil-youtube.com/watch?v=dQw4w9WgXcQ'],
      ['Suffix-Trick', 'https://twitch.tv.angreifer.example/swisshub/clip/Irgendwas'],
      ['Benutzerdaten in der Adresse', 'https://clips.twitch.tv@angreifer.example/clip'],
      // Richtiger Host, falscher Inhalt
      ['YouTube ohne Kennung', 'https://www.youtube.com/watch?v='],
      ['YouTube-Kennung zu kurz', 'https://www.youtube.com/watch?v=abc'],
      ['YouTube-Kennung zu lang', 'https://www.youtube.com/watch?v=dQw4w9WgXcQtoolang'],
      ['YouTube-Kennung mit Anfuehrungszeichen', 'https://www.youtube.com/watch?v=dQw4w9Wg"cQ'],
      ['Twitch ohne Clip-Pfad', 'https://www.twitch.tv/swisshub'],
      ['Twitch-Kennung mit Schraegstrich', 'https://clips.twitch.tv/Abc/../../etc'],
      ['Twitch-Kennung mit Winkelklammern', 'https://clips.twitch.tv/<script>alert(1)</script>'],
    ];

    it.each(schlechte)('%s', (_name, eingabe) => {
      expect(() => erkenneClip(eingabe)).toThrow();
    });
  });

  describe('baut die Einbettungsadresse selbst', () => {
    /*
     * Der Kern der Sache.
     *
     * Wuerde die Eingabe in `embedUrl` durchgereicht, waere jede Pruefung
     * oben nur eine Verzoegerung - man muesste sie einmal umgehen, und der
     * Rahmen zeigte danach, was man will. Deshalb: die Adresse entsteht aus
     * Anbieter und Kennung, und die Kennung ist auf ein Zeichenalphabet
     * begrenzt.
     */
    it('nimmt nichts aus der Eingabe ausser der Kennung', () => {
      const erkannt = erkenneClip('https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=evil');
      expect(erkannt.embedUrl).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
      expect(erkannt.embedUrl).not.toContain('evil');
    });

    it('legt jede Einbettungsadresse auf einen freigegebenen Host', () => {
      const adressen = [
        erkenneClip('https://youtu.be/dQw4w9WgXcQ').embedUrl,
        erkenneClip('https://clips.twitch.tv/EchterClipName').embedUrl,
      ];
      for (const adresse of adressen) {
        expect(
          EINBETTUNGS_HOSTS.some((host) => adresse.startsWith(`${host}/`) || adresse.startsWith(`${host}?`)),
        ).toBe(true);
      }
    });

    it('haengt den Hostnamen fuer Twitch an - und kodiert ihn', () => {
      const clip = erkenneClip('https://clips.twitch.tv/EchterClipName');
      expect(einbettung(clip, 'system.swisshub.gg')).toContain('&parent=system.swisshub.gg');
      // Ein Hostname mit Sonderzeichen darf den Parameter nicht sprengen.
      expect(einbettung(clip, 'boese&autoplay=true')).toContain('&parent=boese%26autoplay%3Dtrue');
    });

    it('laesst YouTube-Adressen unveraendert - dort gibt es kein `parent`', () => {
      const clip = erkenneClip('https://youtu.be/dQw4w9WgXcQ');
      expect(einbettung(clip, 'system.swisshub.gg')).toBe(clip.embedUrl);
    });
  });

  describe('Vorschaubilder', () => {
    it('leitet das YouTube-Bild aus der Kennung ab', () => {
      expect(erkenneClip('https://youtu.be/dQw4w9WgXcQ').thumbnailUrl).toBe(
        'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
      );
    });

    it('raet bei Twitch keines', () => {
      // Twitchs Vorschauadresse enthaelt einen Teil, den nur die API kennt.
      // Eine geratene Adresse waere ein kaputtes Bild in jeder Karte.
      expect(erkenneClip('https://clips.twitch.tv/EchterClipName').thumbnailUrl).toBeNull();
    });
  });
});
