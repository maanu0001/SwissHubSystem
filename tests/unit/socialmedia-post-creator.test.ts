import { describe, expect, it } from 'vitest';
import { socialmedia } from '@swisshub/modules';
import { renderToStaticMarkup } from 'react-dom/server';
import { zeichnePost, postDateiname, POST_MASSE } from '@/modules/socialmedia/post-folie';

/**
 * Der Post Creator (§54, §57).
 *
 * ## Was hier geprueft wird
 *
 * Die Vorlagenregistry, die Inhaltspruefung und - das ist der interessante
 * Teil - dass die sechs Designs tatsaechlich **verschiedene Strukturen**
 * ergeben und nicht dieselbe Grafik in anderen Farben. Die Vorgabe sagt das
 * ausdruecklich, und ohne einen Test darauf waere es eine Behauptung im
 * Kommentar.
 *
 * Geprueft wird am gerenderten Markup, nicht am fertigen PNG. Ein
 * Pixelvergleich waere genauer und zugleich unbrauchbar: er schlaegt bei
 * jeder Schriftaktualisierung fehl und sagt dann nichts ueber das Layout.
 * Dass die 13 Typen in allen Designs und Formaten auch wirklich ein PNG
 * ergeben, prueft der Renderdurchlauf ausserhalb der Testsuite - er braucht
 * die WASM-Pipeline von Satori und waere hier eine Minute Laufzeit je Lauf.
 */

/*
 * Gerendert statt abgetastet.
 *
 * Der erste Versuch lief den Elementbaum ab, den `zeichnePost` liefert - und
 * fand nichts: die Wurzel ist eine **Komponente**, kein Element mit Kindern.
 * Ihre Struktur entsteht erst beim Rendern. `renderToStaticMarkup` tut genau
 * das und sonst nichts; es braucht kein DOM, keinen Browser und keine
 * Momentaufnahme.
 */
function gerendert(element: React.JSX.Element): string {
  return renderToStaticMarkup(element);
}

/** Die Stilangaben aller Flaechen - so, wie sie im Markup stehen. */
function stile(element: React.JSX.Element): string[] {
  const treffer = gerendert(element).matchAll(/style="([^"]*)"/gu);
  return [...treffer].map((eintrag) => eintrag[1] ?? '');
}

const INHALT = {
  titel: 'SwissHub Cup Oktober',
  untertitel: 'Counter-Strike 2',
  text: 'Anmeldung bis Freitag\nMaximal 16 Teams',
  cta: 'Jetzt anmelden',
  datum: '2026-10-24',
  zeit: '20:00',
  ort: 'Discord',
  fusszeile: 'Die SwissHub Community spielt.',
  branding: true,
};

function baue(design: socialmedia.PostDesign, format: socialmedia.PostFormat = 'quadrat'): string[] {
  const typ = socialmedia.postTyp('info')!;
  return stile(
    zeichnePost({
      typId: typ.id,
      typLabel: typ.label,
      block: typ.block,
      design,
      format,
      inhalt: INHALT,
      bilder: {},
      baum: null,
    }),
  );
}

/** Die Werte einer Eigenschaft über alle Flächen - in der Reihenfolge des Baums. */
function eigenschaft(flaechen: string[], name: string): string[] {
  return flaechen
    .map((stil) => new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, 'u').exec(stil)?.[1]?.trim())
    .filter((wert): wert is string => wert !== undefined);
}

describe('Post Creator: die Vorlagen (§31, §32)', () => {
  it('kennt mindestens dreizehn Post-Typen', () => {
    expect(socialmedia.POST_TYPEN.length).toBeGreaterThanOrEqual(13);
  });

  it('gibt jedem Typ Felder, Pflichtfelder und Designs', () => {
    for (const typ of socialmedia.POST_TYPEN) {
      expect(typ.felder.length, typ.id).toBeGreaterThan(0);
      expect(typ.pflicht.length, typ.id).toBeGreaterThan(0);
      expect(typ.designs.length, typ.id).toBeGreaterThan(0);
      // Ein Pflichtfeld, das der Typ nicht hat, waere ein Post, der nie
      // fertig werden kann.
      for (const pflicht of typ.pflicht) {
        expect(typ.felder, `${typ.id}/${pflicht}`).toContain(pflicht);
      }
      for (const design of typ.designs) {
        expect(socialmedia.POST_DESIGNS, `${typ.id}/${design}`).toContain(design);
      }
    }
  });

  it('beschreibt jedes Feld, das ein Typ verlangt', () => {
    for (const typ of socialmedia.POST_TYPEN) {
      for (const feld of typ.felder) {
        expect(socialmedia.FELD_BESCHREIBUNG[feld], `${typ.id}/${feld}`).toBeDefined();
      }
    }
  });

  it('faellt bei einem fremden Design auf das erste des Typs zurück', () => {
    // Nicht auf einen Fehler: die Vorlagenliste soll erweiterbar sein, und
    // das schliesst Umbauten ein. Ein Post, der nach einer Umbenennung nicht
    // mehr aufgeht, waere der teuerste Weg, das zu bemerken.
    const typ = socialmedia.POST_TYPEN[0]!;
    expect(socialmedia.postDesign(typ.id, 'gibtsnicht')).toBe(typ.designs[0]);
    expect(socialmedia.postDesign('gibtsnicht', 'clean')).toBe('clean');
  });

  it('nennt die drei Formate in exakter Pixelgrösse (§44)', () => {
    expect(POST_MASSE.quadrat).toEqual({ breite: 1080, hoehe: 1080 });
    expect(POST_MASSE.feed).toEqual({ breite: 1080, hoehe: 1350 });
    expect(POST_MASSE.story).toEqual({ breite: 1080, hoehe: 1920 });
  });
});

describe('Post Creator: die Designs sind echte Layouts (§32)', () => {
  it('ergibt für jedes Design eine andere Struktur', () => {
    /*
     * Der Kern der Vorgabe.
     *
     * Verglichen wird die **Form** des Baums - wie viele Flaechen, mit
     * welchen Eigenschaften, in welcher Reihenfolge. Waeren die Designs
     * dieselbe Komposition in anderen Farben, waeren diese Signaturen
     * gleich bis auf die Farbwerte; hier sind sie es auch in der Struktur
     * nicht.
     */
    const signaturen = socialmedia.POST_DESIGNS.map((design) => {
      const flaechen = baue(design);
      return [
        flaechen.length,
        eigenschaft(flaechen, 'position').join(','),
        eigenschaft(flaechen, 'flex-direction').join(','),
        eigenschaft(flaechen, 'border-radius').join(','),
        eigenschaft(flaechen, 'transform').join(','),
        eigenschaft(flaechen, 'align-items').join(','),
      ].join('|');
    });
    expect(new Set(signaturen).size).toBe(signaturen.length);
  });

  it('unterscheidet hellen und dunklen Grund', () => {
    const grundVon = (design: socialmedia.PostDesign): string =>
      eigenschaft(baue(design), 'background-color')[0] ?? '';
    // Clean und Minimal sind die hellen - und das ist eine Layoutentscheidung,
    // keine Farbvariante: auf hellem Grund steht die Schrift dunkel, die
    // Linien sind feiner und die Flaechen kleiner.
    expect(grundVon('clean')).toMatch(/^#f/u);
    expect(grundVon('minimal')).toMatch(/^#f|^#ff/u);
    for (const design of ['bold', 'tournament', 'dark', 'spotlight'] as const) {
      expect(grundVon(design), design).toMatch(/^#(0|1)/u);
    }
  });

  it('baut nur dort gedrehte Flächen, wo ein Keil gehört', () => {
    const hatDrehung = (design: socialmedia.PostDesign): boolean =>
      eigenschaft(baue(design), 'transform').some((wert) => wert.includes('rotate'));
    expect(hatDrehung('bold')).toBe(true);
    expect(hatDrehung('dark')).toBe(true);
    expect(hatDrehung('clean')).toBe(false);
    expect(hatDrehung('minimal')).toBe(false);
    expect(hatDrehung('tournament')).toBe(false);
  });

  it('baut nur im Spotlight runde Flächen', () => {
    const hatKreise = (design: socialmedia.PostDesign): boolean =>
      eigenschaft(baue(design), 'border-radius').filter((wert) => wert.startsWith('9999')).length >= 3;
    expect(hatKreise('spotlight')).toBe(true);
    for (const design of ['clean', 'bold', 'minimal', 'tournament', 'dark'] as const) {
      expect(hatKreise(design), design).toBe(false);
    }
  });

  it('gibt Tournament sein Kopfband über die volle Breite', () => {
    /*
     * Die Flaeche, die beide Merkmale traegt: volle Breite **und**
     * Akzentfarbe. Nur nach der Breite zu suchen traf die Buehne selbst -
     * die ist auch 1080 breit, nur eben nicht das Kopfband.
     */
    const band = baue('tournament').find(
      (stil) => stil.includes('width:1080px') && stil.includes('background-color:#83060a'),
    );
    expect(band).toBeDefined();
    // Ein Band, kein Hintergrund: die Hoehe ist ein Bruchteil der Buehne.
    const hoehe = Number.parseInt(/height:(\d+)px/u.exec(band ?? '')?.[1] ?? '0', 10);
    expect(hoehe).toBeGreaterThan(0);
    expect(hoehe).toBeLessThan(300);
  });
});

describe('Post Creator: die Formate passen das Layout an (§46)', () => {
  it('hält in der Story den sicheren Bereich frei', () => {
    /*
     * In der Story liegen Profilzeile und Antwortfeld von Instagram ueber dem
     * Bild. Was dort steht, ist weg - deshalb beginnt der Inhalt weiter unten.
     * Im Quadrat gibt es das nicht, und dort waere derselbe Abstand nur
     * verschenkte Flaeche.
     */
    const story = baue('clean', 'story');
    const quadrat = baue('clean', 'quadrat');
    const obersterAbstand = (flaechen: string[]): number =>
      Number.parseInt(eigenschaft(flaechen, 'padding-top')[0] ?? '0', 10);
    expect(obersterAbstand(story)).toBeGreaterThan(obersterAbstand(quadrat) + 100);
  });

  it('setzt die Begegnung in der Story untereinander statt nebeneinander', () => {
    const typ = socialmedia.postTyp('match')!;
    const fuer = (format: socialmedia.PostFormat): string[] =>
      stile(
        zeichnePost({
          typId: typ.id,
          typLabel: typ.label,
          block: typ.block,
          design: 'tournament',
          format,
          inhalt: { ...INHALT, teams: { a: 'Team A', b: 'Team B' } },
          bilder: {},
          baum: null,
        }),
      );
    // Die eine Zeile, die den Unterschied macht: `flexDirection` der
    // Begegnung. Nebeneinander haetten zwei Namen in der Story je 40 Prozent
    // der Breite - uebereinander die volle.
    const spalten = (liste: string[]): number =>
      liste.filter(
        (stil) => stil.includes('flex-direction:column') && stil.includes('justify-content:space-between'),
      ).length;
    expect(spalten(fuer('story'))).toBeGreaterThan(spalten(fuer('quadrat')));
  });
});

describe('Post Creator: die Inhaltsprüfung (§35, §36)', () => {
  const EIN_BILD = `socialpost-${'a'.repeat(32)}.png`;

  it('lässt nur Felder durch, die der Typ hat', () => {
    // «Reminder» kennt kein Motiv. Ein Bild, das trotzdem mitgeschickt wird,
    // darf nicht in der Spalte landen - sonst taucht es beim naechsten
    // Typwechsel wieder auf.
    const inhalt = socialmedia.normalisiereInhalt('reminder', {
      titel: 'Gleich geht es los',
      bild: EIN_BILD,
      erfundenesFeld: 'hallo',
    });
    expect(inhalt.titel).toBe('Gleich geht es los');
    expect(inhalt.bild).toBeUndefined();
    expect(Object.keys(inhalt)).not.toContain('erfundenesFeld');
  });

  it('weist blob-, data- und fremde Bildadressen ab', () => {
    /*
     * Der Kern von §35. Eine `blob:`-Adresse existiert nur in dem Browser,
     * der sie erzeugt hat - gespeichert waere sie nach einem Neuladen ein
     * Bild mit Loch. Eine `data:`-URI waere ein Megabyte in einer
     * JSON-Spalte, eine fremde `https:`-Adresse ein Abruf, den jemand
     * anderes bestimmt (§37).
     */
    for (const adresse of [
      'blob:http://localhost/8f3a-4c',
      'data:image/png;base64,iVBORw0KGgo=',
      'https://fremd.example.com/bild.png',
      '../../etc/passwd',
      'socialpost-kurz.png',
    ]) {
      expect(() => socialmedia.normalisiereInhalt('info', { titel: 'x', bild: adresse }), adresse).toThrow();
    }
  });

  it('nimmt einen Dateinamen aus dem eigenen Upload-Verzeichnis', () => {
    const inhalt = socialmedia.normalisiereInhalt('info', { titel: 'x', bild: EIN_BILD });
    expect(inhalt.bild).toBe(EIN_BILD);
  });

  it('lässt nur https-Links auf einen Post', () => {
    expect(
      socialmedia.normalisiereInhalt('turnier', { titel: 'x', link: 'https://swisshub.gg/t' }).link,
    ).toBe('https://swisshub.gg/t');
    for (const link of ['http://swisshub.gg', 'javascript:alert(1)', 'kein link']) {
      expect(() => socialmedia.normalisiereInhalt('turnier', { titel: 'x', link }), link).toThrow();
    }
  });

  it('wirft ein unmögliches Datum weg statt es zu raten', () => {
    expect(
      socialmedia.normalisiereInhalt('event', { titel: 'x', datum: '2026-02-31' }).datum,
    ).toBeUndefined();
    expect(
      socialmedia.normalisiereInhalt('event', { titel: 'x', datum: '24.10.2026' }).datum,
    ).toBeUndefined();
    expect(socialmedia.normalisiereInhalt('event', { titel: 'x', datum: '2026-10-24' }).datum).toBe(
      '2026-10-24',
    );
  });

  it('nimmt nur gültige Uhrzeiten', () => {
    expect(socialmedia.normalisiereInhalt('event', { titel: 'x', zeit: '9:05' }).zeit).toBe('09:05');
    expect(socialmedia.normalisiereInhalt('event', { titel: 'x', zeit: '25:00' }).zeit).toBeUndefined();
  });

  it('wandelt die Farbe um, statt sie zu bereinigen', () => {
    expect(socialmedia.normalisiereInhalt('info', { titel: 'x', akzentfarbe: '#1A2B3C' }).akzentfarbe).toBe(
      '#1a2b3c',
    );
    expect(
      socialmedia.normalisiereInhalt('info', { titel: 'x', akzentfarbe: 'red; url(x)' }).akzentfarbe,
    ).toBeUndefined();
  });

  it('begrenzt die Partnerzeichen auf sechs', () => {
    const viele = Array.from(
      { length: 10 },
      (_, index) => `socialpost-${String(index).repeat(32).slice(0, 32)}.png`,
    );
    const inhalt = socialmedia.normalisiereInhalt('partner', { titel: 'x', sponsoren: viele });
    expect(inhalt.sponsoren?.length).toBe(6);
  });

  it('speichert beim Turnierbaum nur die Kennung, nie die Paarungen (§45)', () => {
    const inhalt = socialmedia.normalisiereInhalt('bracket', {
      titel: 'x',
      bracket: { tournamentId: 'abc123', runden: [{ matches: ['erfunden'] }] },
    });
    expect(inhalt.bracket).toEqual({ tournamentId: 'abc123' });
  });

  it('nennt die fehlenden Pflichtfelder', () => {
    const typ = socialmedia.postTyp('match')!;
    const leer = socialmedia.normalisiereInhalt('match', {});
    expect(socialmedia.fehlendeFelder(typ, leer)).toContain('teams');
    const halb = socialmedia.normalisiereInhalt('match', { teams: { a: 'A', b: '' } });
    expect(socialmedia.fehlendeFelder(typ, halb)).toContain('teams');
    const voll = socialmedia.normalisiereInhalt('match', { teams: { a: 'A', b: 'B' } });
    expect(socialmedia.fehlendeFelder(typ, voll)).toEqual([]);
  });
});

describe('Post Creator: die Dateinamen', () => {
  it('nimmt nichts aus fremder Hand unverändert in den Namen', () => {
    const name = postDateiname('event', 'story', '../../etc/passwd & "böse"');
    expect(name).toMatch(/^swisshub-event-[a-z0-9-]*-story\.png$/u);
    expect(name).not.toContain('/');
    expect(name).not.toContain('"');
  });

  it('kommt auch ohne brauchbaren Titel zu einem Namen', () => {
    expect(postDateiname('info', 'feed', '???')).toBe('swisshub-info-post-feed.png');
  });
});
