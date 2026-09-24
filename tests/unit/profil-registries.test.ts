import { describe, expect, it } from 'vitest';
import * as angaben from '@swisshub/modules/profil/angaben';
import * as auszeichnungen from '@swisshub/modules/profil/auszeichnungen';
import * as gestaltung from '@swisshub/modules/profil/gestaltung';
import * as schemas from '@swisshub/modules/profil/schemas';
import * as showcase from '@swisshub/modules/profil/showcase';
import * as socials from '@swisshub/modules/profil/socials';
import * as spielfelder from '@swisshub/modules/profil/spielfelder';

/**
 * Die Registries der Mitgliederprofile.
 *
 * Alles hier ist rein - keine Datenbank, keine Uhr. Genau deshalb steht es
 * in einer Registry und nicht in einer Tabelle, und genau deshalb laesst es
 * sich so pruefen: dieselbe Eingabe muss immer dasselbe ergeben.
 *
 * Geprueft wird vor allem, was **nicht** durchkommt. Eine Registry, die
 * grosszuegig ist, waere wertlos: ihr ganzer Zweck ist, dass aus einer
 * Profilspalte kein Stylesheet und aus einem Benutzernamen keine fremde
 * Adresse wird.
 */

describe('Spielfelder', () => {
  it('kennt die Felder eines Spiels ueber seinen Namen, nicht ueber eine Kennung', () => {
    // Der Name ist in jeder Installation derselbe, die Katalog-Kennung nicht.
    expect(spielfelder.hatSpielfelder('Counter-Strike 2')).toBe(true);
    expect(spielfelder.hatSpielfelder('counter strike 2')).toBe(true);
    expect(spielfelder.hatSpielfelder('CS2')).toBe(false);
  });

  it('gibt fuer ein unbekanntes Spiel keine Felder und ein leeres Schema', () => {
    expect(spielfelder.felderFuer('Ein Spiel, das es nicht gibt')).toEqual([]);
    const schema = spielfelder.schemaFuer('Ein Spiel, das es nicht gibt');
    expect(schema.safeParse({}).success).toBe(true);
    // Auch hier: `strict`. Ein unbekanntes Spiel ist kein Freibrief.
    expect(schema.safeParse({ irgendwas: 'x' }).success).toBe(false);
  });

  it('lehnt ein Feld ab, das die Registry nicht kennt', () => {
    const schema = spielfelder.schemaFuer('VALORANT');
    expect(schema.safeParse({ rang: 'Gold' }).success).toBe(true);
    expect(schema.safeParse({ rang: 'Gold', heimlich: '<script>' }).success).toBe(false);
  });

  it('lehnt einen Wert ab, der nicht in der Auswahl steht', () => {
    const schema = spielfelder.schemaFuer('VALORANT');
    expect(schema.safeParse({ rang: 'Radiant' }).success).toBe(true);
    expect(schema.safeParse({ rang: 'Ultra-Radiant' }).success).toBe(false);
  });

  it('laesst weg, was die Registry nicht mehr kennt, statt zu scheitern', () => {
    // Der Fall nach einer Aenderung der Registry: gespeichert ist noch ein
    // Feld von gestern. Es faellt weg - die Profilseite darf daran nicht
    // zerbrechen.
    const gezeigt = spielfelder.zeigeFelder('VALORANT', { rang: 'Gold', alteSpalte: 'x' });
    expect(gezeigt.map((feld) => feld.key)).toEqual(['rang']);
  });

  it('haelt eine Mehrfachauswahl als Liste zusammen', () => {
    const gezeigt = spielfelder.zeigeFelder('League of Legends', {
      positionen: ['Mid', 'Jungle'],
    });
    expect(gezeigt[0]?.wert).toBe('Mid, Jungle');
  });

  it('gibt fuer kaputte gespeicherte Werte nichts zurueck statt zu werfen', () => {
    expect(spielfelder.zeigeFelder('VALORANT', null)).toEqual([]);
    expect(spielfelder.zeigeFelder('VALORANT', 'kein Objekt')).toEqual([]);
  });
});

describe('Socials', () => {
  it('baut aus einer Kennung eine Adresse - und nur eine https-Adresse', () => {
    const twitch = socials.zeigeSocial('twitch', 'swisshub', false);
    expect(twitch?.adresse).toBe('https://twitch.tv/swisshub');
  });

  it('nimmt keine vollstaendige Adresse als Kennung an', () => {
    // Das ist die eigentliche Absicherung: was nie hereinkommt, muss auch
    // nicht gefiltert werden.
    expect(socials.pruefeHandle('twitch', 'https://twitch.tv/swisshub')).toBeNull();
    expect(socials.pruefeHandle('twitch', 'javascript:alert(1)')).toBeNull();
    expect(socials.pruefeHandle('twitch', 'evil.example.com/swisshub')).toBeNull();
    expect(socials.pruefeHandle('twitch', '../../andere')).toBeNull();
  });

  it('unterscheidet SteamID64 und Vanity-Namen', () => {
    expect(socials.zeigeSocial('steam', '76561198000000000', false)?.adresse).toBe(
      'https://steamcommunity.com/profiles/76561198000000000',
    );
    expect(socials.zeigeSocial('steam', 'swisshub', false)?.adresse).toBe(
      'https://steamcommunity.com/id/swisshub',
    );
  });

  it('erzeugt fuer Plattformen ohne oeffentliche Profilseite keinen Link', () => {
    const riot = socials.zeigeSocial('riot', 'Spieler#EUW1', false);
    expect(riot?.handle).toBe('Spieler#EUW1');
    expect(riot?.adresse).toBeNull();
  });

  it('prueft das Format je Plattform', () => {
    expect(socials.pruefeHandle('riot', 'SpielerOhneTag')).toBeNull();
    expect(socials.pruefeHandle('battlenet', 'Name#12')).toBeNull();
    expect(socials.pruefeHandle('battlenet', 'Name#1234')).toBe('Name#1234');
    expect(socials.pruefeHandle('nintendo', '1234-5678-9012')).toBeNull();
    expect(socials.pruefeHandle('nintendo', 'SW-1234-5678-9012')).toBe('SW-1234-5678-9012');
  });

  it('kennt keine unbekannte Plattform', () => {
    expect(socials.pruefeHandle('meinedomain', 'irgendwas')).toBeNull();
    expect(socials.zeigeSocial('meinedomain', 'irgendwas', false)).toBeNull();
  });

  it('zeigt eine selbst eingetragene Kennung nie als verifiziert', () => {
    // Die Eingabe kennt das Feld gar nicht - es laesst sich also auch nicht
    // mitschicken.
    const geprueft = schemas.socialSchema.safeParse({
      platform: 'twitch',
      handle: 'swisshub',
      verified: true,
    });
    expect(geprueft.success).toBe(true);
    expect(geprueft.success && 'verified' in geprueft.data).toBe(false);
  });
});

describe('Gestaltung', () => {
  it('faellt bei einer unbekannten Wahl auf den Standard zurueck', () => {
    expect(gestaltung.akzent('gibtsnicht').key).toBe(gestaltung.STANDARD_AKZENT.key);
    expect(gestaltung.thema(null).key).toBe(gestaltung.STANDARD_THEMA.key);
    expect(gestaltung.bannervorlage(undefined).key).toBe(gestaltung.STANDARD_BANNER.key);
  });

  it('nimmt keine Farbe entgegen, sondern nur einen Schluessel', () => {
    const geprueft = schemas.gestaltungSchema.safeParse({
      theme: 'swisshub',
      accent: 'red; background:url(https://example.com)',
      bannerPreset: null,
    });
    expect(geprueft.success).toBe(false);
  });

  it('baut die Variablen ausschliesslich aus der Registry', () => {
    const variablen = gestaltung.gestaltungsVariablen('kohle', 'gletscher');
    expect(variablen['--profil-akzent']).toBe(gestaltung.akzent('gletscher').hsl);
    // Auch bei Unsinn steht dort eine Farbe - nie die Eingabe.
    const unsinn = gestaltung.gestaltungsVariablen('}</style><script>', 'x');
    expect(unsinn['--profil-akzent']).toBe(gestaltung.STANDARD_AKZENT.hsl);
    expect(unsinn['--profil-flaeche']).toBe(gestaltung.STANDARD_THEMA.hslFlaeche);
  });
});

describe('Vitrine', () => {
  it('nimmt keinen Platz ausserhalb der drei', () => {
    expect(showcase.istGueltigerPlatz(0, 'level', null)).toBe(true);
    expect(showcase.istGueltigerPlatz(showcase.SHOWCASE_PLAETZE, 'level', null)).toBe(false);
    expect(showcase.istGueltigerPlatz(-1, 'level', null)).toBe(false);
    expect(showcase.istGueltigerPlatz(1.5, 'level', null)).toBe(false);
  });

  it('verlangt einen Verweis, wo einer noetig ist', () => {
    expect(showcase.istGueltigerPlatz(0, 'tournament', null)).toBe(false);
    expect(showcase.istGueltigerPlatz(0, 'tournament', 'abc')).toBe(true);
    // «Level» gehoert der Person, nicht einem Datensatz.
    expect(showcase.istGueltigerPlatz(0, 'level', null)).toBe(true);
  });

  it('kennt keinen erfundenen Typ', () => {
    expect(showcase.istShowcaseArt('weltmeister')).toBe(false);
    expect(showcase.istGueltigerPlatz(0, 'weltmeister', 'abc')).toBe(false);
  });
});

describe('Angaben', () => {
  it('sortiert nach der Liste, nicht nach der Speicherreihenfolge', () => {
    expect(angaben.labels('sprachen', ['en', 'de'])).toEqual(['Deutsch', 'Englisch']);
  });

  it('laesst unbekannte Schluessel beim Anzeigen weg', () => {
    expect(angaben.labels('sprachen', ['de', 'klingonisch'])).toEqual(['Deutsch']);
  });

  it('lehnt unbekannte Schluessel beim Schreiben ab', () => {
    // Beim Anzeigen schweigen, beim Schreiben widersprechen - sonst sieht es
    // aus, als waere die Angabe gespeichert worden.
    const schema = angaben.mehrfachSchema('sprachen', 6);
    expect(schema.safeParse(['de']).success).toBe(true);
    expect(schema.safeParse(['klingonisch']).success).toBe(false);
  });

  it('haelt die Obergrenze ein und entfernt Doppelte', () => {
    const schema = angaben.mehrfachSchema('sprachen', 2);
    expect(schema.safeParse(['de', 'en', 'fr']).success).toBe(false);
    const geprueft = schema.safeParse(['de', 'de']);
    expect(geprueft.success && geprueft.data).toEqual(['de']);
  });
});

describe('Auszeichnungen', () => {
  const jetzt = new Date('2026-09-24T12:00:00Z');

  const grundlage = (teile: Partial<auszeichnungen.Grundlage> = {}): auszeichnungen.Grundlage => ({
    beitrittAm: null,
    level: 1,
    hoechstlevel: false,
    turniere: { teilgenommen: 0, podeste: 0, siege: 0 },
    clips: { eingereicht: 0, treppchen: 0, siege: 0, erhalteneStimmen: 0 },
    events: 0,
    spielprofile: 0,
    boostet: false,
    jetzt,
    ...teile,
  });

  it('vergibt nichts, wofuer keine Daten vorliegen', () => {
    expect(auszeichnungen.erreichte(grundlage())).toEqual([]);
  });

  it('erfindet ohne Beitrittsdatum kein Jubilaeum', () => {
    // Discord liefert `joinedAt` nicht immer. Ein geschaetztes Datum waere
    // ein erfundener Erfolg.
    const ohne = auszeichnungen.erreichte(grundlage({ beitrittAm: null }));
    expect(ohne.some((eintrag) => eintrag.key.startsWith('dabei-'))).toBe(false);
  });

  it('vergibt rueckwirkend, ohne dass jemand etwas nachtragen muesste', () => {
    const alt = auszeichnungen.erreichte(grundlage({ beitrittAm: new Date('2019-01-01T00:00:00Z') }));
    expect(alt.map((eintrag) => eintrag.key)).toEqual(
      expect.arrayContaining(['dabei-1', 'dabei-3', 'dabei-5']),
    );
  });

  it('ist idempotent, weil sie nichts schreibt', () => {
    const daten = grundlage({ turniere: { teilgenommen: 6, podeste: 2, siege: 3 } });
    const erster = auszeichnungen.erreichte(daten);
    const zweiter = auszeichnungen.erreichte(daten);
    expect(zweiter).toEqual(erster);
    // Und die Grundlage bleibt unberuehrt - keine versteckte Buchung.
    expect(daten.turniere.siege).toBe(3);
  });

  it('belohnt keine Nachrichtenzahl', () => {
    const alle = auszeichnungen.alleAuszeichnungsArten();
    const verdaechtig = alle.filter((art) =>
      /nachricht|message|spam|aktiv/i.test(`${art.key} ${art.label} ${art.beschreibung}`),
    );
    expect(verdaechtig).toEqual([]);
  });

  it('nennt Kalenderanmeldungen nicht Teilnahme', () => {
    // Der Kalender erhebt kein Einchecken. Wer «teilgenommen» schreibt, wo
    // nur «angemeldet» belegt ist, behauptet etwas.
    const event = auszeichnungen.auszeichnungsArt('event-dabei');
    expect(event?.beschreibung).toContain('angemeldet');
  });

  it('sortiert erreichte vor offene und Gold vor Bronze', () => {
    const bewertet = auszeichnungen.bewerte(grundlage({ boostet: true, spielprofile: 5 }));
    const erreicht = bewertet.filter((eintrag) => eintrag.erreicht);
    expect(erreicht[0]?.stufe).toBe('gold');
    expect(bewertet.findIndex((e) => !e.erreicht)).toBeGreaterThan(erreicht.length - 1);
  });
});

describe('Eingabepruefung', () => {
  it('nimmt nur die beiden Sichtbarkeitsstufen an', () => {
    const basis = {
      visibilityProfile: 'MEMBERS',
      visibilityGames: 'MEMBERS',
      visibilitySocials: 'PRIVATE',
      visibilityCareer: 'MEMBERS',
      visibilityActivity: 'MEMBERS',
      discoverable: true,
    };
    expect(schemas.privatsphaereSchema.safeParse(basis).success).toBe(true);
    expect(schemas.privatsphaereSchema.safeParse({ ...basis, visibilityProfile: 'PUBLIC' }).success).toBe(
      false,
    );
  });

  it('kuerzt einen sehr langen Text nicht, sondern lehnt ihn ab', () => {
    const geprueft = schemas.allgemeinSchema.safeParse({
      displayName: '',
      tagline: '',
      bio: 'x'.repeat(601),
      languages: [],
      platforms: [],
      playtimes: [],
      comms: [],
      playStyle: 'BOTH',
      availability: 'UNSET',
    });
    expect(geprueft.success).toBe(false);
  });

  it('macht aus einer leeren Eingabe «nichts angegeben»', () => {
    const geprueft = schemas.allgemeinSchema.parse({
      displayName: '   ',
      tagline: '',
      bio: '',
      languages: [],
      platforms: [],
      playtimes: [],
      comms: [],
      playStyle: 'BOTH',
      availability: 'UNSET',
    });
    expect(geprueft.displayName).toBeNull();
    expect(geprueft.tagline).toBeNull();
  });

  it('nimmt Sonderzeichen und Emoji an, ohne sie zu verstuemmeln', () => {
    const text = 'Grüezi 🇨🇭 <b>kein HTML</b> & "Anführungszeichen"';
    const geprueft = schemas.allgemeinSchema.parse({
      displayName: '',
      tagline: text,
      bio: '',
      languages: [],
      platforms: [],
      playtimes: [],
      comms: [],
      playStyle: 'BOTH',
      availability: 'UNSET',
    });
    // Nicht escapen, nicht filtern: React setzt Text als Text. Wer hier
    // umschreibt, zerstoert echte Eingaben und gewinnt nichts.
    expect(geprueft.tagline).toBe(text);
  });

  it('lehnt zwei Eintraege derselben Plattform ab', () => {
    const geprueft = schemas.socialsSchema.safeParse({
      eintraege: [
        { platform: 'twitch', handle: 'eins' },
        { platform: 'twitch', handle: 'zwei' },
      ],
    });
    expect(geprueft.success).toBe(false);
  });

  it('lehnt zwei Vitrineneintraege auf demselben Platz ab', () => {
    const geprueft = schemas.showcaseSchema.safeParse({
      plaetze: [
        { slot: 0, kind: 'level', refId: null },
        { slot: 0, kind: 'level', refId: null },
      ],
    });
    expect(geprueft.success).toBe(false);
  });

  it('laesst einen manipulierten Filter fallen, statt ihn zu uebernehmen', () => {
    expect(schemas.entdeckenSchema.safeParse({ sprache: "de'; DROP TABLE" }).success).toBe(false);
    expect(schemas.entdeckenSchema.safeParse({ plattform: 'C64' }).success).toBe(false);
  });
});
