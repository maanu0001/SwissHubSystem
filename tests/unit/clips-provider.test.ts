import { describe, expect, it } from 'vitest';
import { EINBETTUNGS_HOSTS, einbettung, erkenneClip, erkenneUpload } from '@swisshub/modules/clips/provider';

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

/**
 * Medal.
 *
 * Dieselbe Schwelle wie bei Twitch und YouTube: die eingegebene Adresse wird
 * zerlegt, nie durchgereicht. Was hier ankommt, landet in einem `iframe`.
 */
describe('Medal', () => {
  const NUMMER = '4954893';
  const TOKEN = 'vpkPnOp0o';
  const KENNUNG = `${NUMMER}/${TOKEN}`;

  describe('erkennt die Adressformen', () => {
    it.each([
      ['die Einbettungsform', `https://medal.tv/clip/${KENNUNG}`],
      ['die Clipseite', `https://medal.tv/clips/${KENNUNG}`],
      ['die Seite mit Spiel im Pfad', `https://medal.tv/games/valorant/clips/${KENNUNG}`],
      ['mit www', `https://www.medal.tv/clips/${KENNUNG}`],
      ['mit Parametern dran', `https://medal.tv/clips/${KENNUNG}?invite=abc&utm_source=discord`],
    ])('%s', (_name, adresse) => {
      const clip = erkenneClip(adresse);
      expect(clip.provider).toBe('medal');
      expect(clip.sourceType).toBe('MEDAL');
      expect(clip.externalId).toBe(KENNUNG);
    });

    it('nimmt beide Teile als Kennung, nicht die Nummer allein', () => {
      /*
       * Ohne den Token liesse sich die Einbettungsadresse nicht wieder
       * bauen - ein Duplikat waere an der Nummer erkennbar, der Clip danach
       * aber nicht abspielbar.
       */
      expect(erkenneClip(`https://medal.tv/clips/${KENNUNG}`).externalId).toContain('/');
      expect(erkenneClip(`https://medal.tv/clips/${KENNUNG}`).externalId).not.toBe(NUMMER);
    });

    it('erkennt denselben Clip über verschiedene Adressen als denselben', () => {
      // Sonst waere derselbe Clip zweimal einreichbar.
      const a = erkenneClip(`https://medal.tv/clips/${KENNUNG}`);
      const b = erkenneClip(`https://medal.tv/games/apex-legends/clips/${KENNUNG}?x=1`);
      expect(a.externalId).toBe(b.externalId);
    });
  });

  describe('lehnt ab, was kein Clip ist', () => {
    it.each([
      ['die Startseite', 'https://medal.tv/'],
      ['ein Profil', 'https://medal.tv/u/irgendwer'],
      ['eine Spielseite ohne Clip', 'https://medal.tv/games/valorant'],
      ['ein Clip ohne Token', `https://medal.tv/clips/${NUMMER}`],
      ['eine Nummer, die keine ist', 'https://medal.tv/clips/nichtszahl/vpkPnOp0o'],
      ['ein Token mit Sonderzeichen', `https://medal.tv/clips/${NUMMER}/vpk$nOp`],
      ['ein Token, das zu kurz ist', `https://medal.tv/clips/${NUMMER}/ab`],
    ])('%s', (_name, adresse) => {
      expect(() => erkenneClip(adresse)).toThrow();
    });

    it('nimmt keinen fremden Host, der medal.tv enthaelt', () => {
      // Der klassische Versuch: `medal.tv.angreifer.example`.
      expect(() => erkenneClip(`https://medal.tv.angreifer.example/clips/${KENNUNG}`)).toThrow();
      expect(() => erkenneClip(`https://nichtmedal.tv/clips/${KENNUNG}`)).toThrow();
    });

    it('nennt in der Meldung, wo der Link herkommt', () => {
      // Ein Schemafehler hilft niemandem weiter.
      expect(() => erkenneClip('https://medal.tv/u/irgendwer')).toThrow(/medal\.tv/u);
    });
  });

  describe('baut die Einbettung selbst', () => {
    it('benutzt die dokumentierte Playeradresse', () => {
      const clip = erkenneClip(`https://medal.tv/clips/${KENNUNG}`);
      expect(clip.embedUrl).toBe(`https://medal.tv/clip/${KENNUNG}?autoplay=0&loop=0`);
    });

    it('schaltet Autoplay und Dauerschleife ab', () => {
      /*
       * Medals Vorgabe ist automatische, stumme Wiedergabe in Dauerschleife.
       * In einer Liste mit mehreren Einreichungen waere das eine Seite, auf
       * der alles gleichzeitig losgeht.
       */
      const clip = erkenneClip(`https://medal.tv/clips/${KENNUNG}`);
      expect(clip.embedUrl).toContain('autoplay=0');
      expect(clip.embedUrl).toContain('loop=0');
    });

    it('reicht die eingegebene Adresse nicht durch', () => {
      // Der Kern des Moduls: aus der Eingabe wird eine Kennung, und aus der
      // Kennung entsteht alles weitere.
      const clip = erkenneClip(`https://medal.tv/clips/${KENNUNG}?invite=BOESE&next=//angreifer.example`);
      expect(clip.embedUrl).not.toContain('BOESE');
      expect(clip.embedUrl).not.toContain('angreifer');
      expect(clip.canonicalUrl).not.toContain('BOESE');
    });

    it('gibt die Einbettung unveraendert weiter - nur Twitch braucht den Parent', () => {
      const clip = erkenneClip(`https://medal.tv/clips/${KENNUNG}`);
      expect(einbettung(clip, 'system.swisshub.gg')).toBe(clip.embedUrl);
    });

    it('raet kein Vorschaubild', () => {
      /*
       * Medal hat keine aus der Kennung ableitbare Bildadresse. Eine geratene
       * waere ein kaputtes Bild an einer Stelle, an der ein leerer Platz
       * besser aussieht - und ein Abruf waere der erste Server-Request auf
       * eine von aussen bestimmte Adresse.
       */
      expect(erkenneClip(`https://medal.tv/clips/${KENNUNG}`).thumbnailUrl).toBeNull();
    });

    it('zeigt auf die Clipseite als sicheren aeusseren Link', () => {
      // Der Rueckfall, wenn die Einbettung leer bleibt.
      const clip = erkenneClip(`https://medal.tv/clip/${KENNUNG}`);
      expect(clip.canonicalUrl).toBe(`https://medal.tv/clips/${KENNUNG}`);
    });
  });

  it('steht in der Liste der einbettbaren Hosts', () => {
    // Ohne das entstuende die Adresse, und der Rahmen blieb leer.
    expect(EINBETTUNGS_HOSTS).toContain('https://medal.tv');
  });
});

/**
 * Hochgeladene Dateien.
 *
 * ## Warum das hier steht und nicht bei der Speicherung
 *
 * Weil hier entsteht, was die Oberflaeche spaeter anzeigt. Eine zweite Stelle,
 * die Adressen fuer Clips baut, waere die gefaehrlichere von beiden - niemand
 * sieht sie so genau an wie diese Datei.
 */
describe('Upload als Clip', () => {
  const NAME = 'clip-0123456789abcdef0123456789abcdef.mp4';

  it('zeigt auf die interne Route, nicht auf eine fremde Adresse', () => {
    const clip = erkenneUpload(NAME, 'mp4');
    expect(clip.provider).toBe('upload');
    expect(clip.sourceType).toBe('UPLOAD');
    expect(clip.embedUrl).toBe(`/api/clips/datei/${NAME}`);
    expect(clip.canonicalUrl).toBe(`/api/clips/datei/${NAME}`);
  });

  it('nimmt den Dateinamen als Kennung', () => {
    /*
     * Und damit ist jeder Upload ein eigener Clip: der Name entsteht aus 16
     * Zufallsbytes. Zweimal dieselbe Datei ergibt zwei Einreichungen - die
     * Moderation entscheidet, wie bei jedem anderen inhaltlichen Zweifel.
     */
    expect(erkenneUpload(NAME, 'mp4').externalId).toBe(NAME);
  });

  it('raet kein Vorschaubild', () => {
    // Ein Einzelbild aus dem Video braeuchte einen Decoder.
    expect(erkenneUpload(NAME, 'mp4').thumbnailUrl).toBeNull();
  });

  it('nimmt nur Namen, die diese Anwendung selbst erzeugt', () => {
    const schlecht = [
      ['Pfadmanipulation', '../../etc/passwd'],
      ['Pfad im Namen', 'clips/clip-0123456789abcdef0123456789abcdef.mp4'],
      ['fremde Endung', 'clip-0123456789abcdef0123456789abcdef.html'],
      ['zu kurzer Zufall', 'clip-0123.mp4'],
      ['kein Praefix', '0123456789abcdef0123456789abcdef.mp4'],
      ['Doppelendung', 'clip-0123456789abcdef0123456789abcdef.mp4.html'],
      ['Nullbyte', 'clip-0123456789abcdef0123456789abcdef.mp4\u0000.html'],
    ] as const;
    for (const [was, name] of schlecht) {
      expect(() => erkenneUpload(name, 'mp4'), was).toThrow();
    }
  });

  it('lehnt einen Namen ab, der nicht zum erkannten Container passt', () => {
    /*
     * Der Kern: die Route setzt den Content-Type aus dem Namen. Liefen Name
     * und Inhalt auseinander, wuerde eine WebM-Datei als `video/mp4`
     * ausgeliefert - und der Player bliebe schwarz, ohne dass irgendwo ein
     * Fehler stuende.
     */
    expect(() => erkenneUpload(NAME, 'webm')).toThrow();
    expect(() => erkenneUpload('clip-0123456789abcdef0123456789abcdef.webm', 'mp4')).toThrow();
  });
});
