import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  KARTEN_FORMATE,
  KARTEN_MASSE,
  dateiname,
  kuerze,
  passendeGroesse,
  zeichneKarte,
  type KartenFormat,
  type KartenSeite,
} from '../../apps/web/src/modules/wrapped/share-karte';
import { WRAPPED_PERSONAS } from '@swisshub/modules/wrapped/fixtures';
import type { WrappedDaten } from '@swisshub/modules/wrapped/daten';

/**
 * Die Karten zum Teilen.
 *
 * ## Was hier wirklich geprüft wird
 *
 * Nicht, ob die Karte schön ist - das entscheidet ein Blick auf das Bild.
 * Sondern zwei Dinge, die ein Blick **nicht** zuverlässig entscheidet:
 *
 *   - **Was draufsteht.** Eine Karte verlässt den Server. Gerät eine
 *     Discord-Kennung darauf, ist sie draussen, und niemandem fällt es auf:
 *     eine achtzehnstellige Zahl sieht auf einem Bild nicht verdächtig aus.
 *   - **Dass sie überall speicherbar ist.** Ein Dateiname mit einem
 *     Schrägstrich ist auf mindestens einem verbreiteten System kein
 *     Dateiname, sondern ein Pfad.
 */
const jahr = 2026;

const persona = (key: string): WrappedDaten => {
  const eintrag = WRAPPED_PERSONAS.find((kandidat) => kandidat.key === key);
  if (!eintrag) {
    throw new Error(`Persona ${key} fehlt`);
  }
  return eintrag.bauen(jahr);
};

/** Die Karte als Text - so lässt sich prüfen, was darauf steht. */
const alsText = (daten: WrappedDaten, format: KartenFormat, seite: KartenSeite): string =>
  renderToStaticMarkup(zeichneKarte({ daten, format, seite, jahr, host: 'swisshub.gg' }));

describe('Share Card', () => {
  const formate = KARTEN_FORMATE.map((eintrag) => eintrag.key);
  const seiten: KartenSeite[] = ['story', 'quadrat'];

  describe('trägt keine Kennungen nach draussen', () => {
    it.each(formate.flatMap((format) => seiten.map((seite) => [format, seite] as const)))(
      '%s / %s',
      (format, seite) => {
        const daten = persona('allrounder');
        const text = alsText(daten, format, seite);

        /*
         * Die eigene Kennung und die der Mates - keine davon darf vorkommen,
         * auch nicht in einem Attribut.
         */
        expect(text).not.toContain(daten.person.discordId);
        for (const mate of daten.voice.mates) {
          expect(text).not.toContain(mate.discordId);
        }

        // Und ganz allgemein: keine Zahl in Snowflake-Länge.
        const verdaechtig = text.match(/\b\d{17,20}\b/gu) ?? [];
        expect(verdaechtig).toEqual([]);
      },
    );
  });

  it('nennt bei den Mates keine Zeiten', () => {
    /*
     * Wie lange jemand mit wem zusammensass, ist eine Auskunft über Leute,
     * die diese Karte nicht verschickt haben. Die Szene hält sich daran;
     * die Karte muss es auch.
     */
    const text = alsText(persona('allrounder'), 'mates', 'story');
    expect(text).not.toMatch(/\d+\s*(h|Std|Stunden|min|Minuten)/u);
  });

  it('macht aus jedem Namen einen speicherbaren Dateinamen', () => {
    expect(dateiname(2026, 'Manuel', 'uebersicht')).toBe('swisshub-wrapped-2026-manuel.png');
    expect(dateiname(2026, 'Mänu Köhler', 'mates')).toBe('swisshub-wrapped-2026-maenu-koehler-mates.png');
    expect(dateiname(2026, 'a/b\\c:d', 'archetyp')).toBe('swisshub-wrapped-2026-a-b-c-d-archetyp.png');
    expect(dateiname(2026, '../../etc/passwd', 'uebersicht')).toBe('swisshub-wrapped-2026-etc-passwd.png');
    // Ein Name ganz ohne brauchbare Zeichen ergibt trotzdem einen Namen.
    expect(dateiname(2026, '🎮🎮🎮', 'uebersicht')).toBe('swisshub-wrapped-2026.png');
  });

  it('enthält in keinem Dateinamen ein Zeichen, das Pfade trennt', () => {
    const GEFAEHRLICH = ['/', '\\', ':', '\u0000'];
    for (const name of ['Manu/el', 'C:\\Users', '..\\..\\x', 'a\u0000b']) {
      const ergebnis = dateiname(2026, name, 'uebersicht');
      for (const zeichen of GEFAEHRLICH) {
        expect(ergebnis).not.toContain(zeichen);
      }
      expect(ergebnis.startsWith('swisshub-wrapped-2026')).toBe(true);
      expect(ergebnis.endsWith('.png')).toBe(true);
    }
  });

  describe('Schriftgrösse', () => {
    it('lässt kurze Wörter in voller Grösse', () => {
      expect(passendeGroesse('THE REGULAR', 872, 156)).toBe(156);
    });

    it('verkleinert, bis das längste Wort hineinpasst', () => {
      /*
       * «ALLROUNDER» lief bei 156 Pixeln rechts aus dem Bild. Der Wert darf
       * sich ändern; die Eigenschaft nicht.
       */
      const groesse = passendeGroesse('THE ALLROUNDER', 872, 156);
      expect(groesse).toBeLessThan(156);
      expect(groesse * 10 * 0.7).toBeLessThanOrEqual(872);
    });

    it('rechnet mit dem längsten Wort und nicht mit der ganzen Zeile', () => {
      // Sonst würde ein langer Satz aus kurzen Wörtern unnötig klein.
      expect(passendeGroesse('a a a a a a a a a a a a', 872, 100)).toBe(100);
    });
  });

  it('kürzt zu lange Namen mit einem Auslassungszeichen', () => {
    expect(kuerze('kurz', 10)).toBe('kurz');
    expect(kuerze('einsehrlangername', 10)).toHaveLength(10);
    expect(kuerze('einsehrlangername', 10).endsWith('…')).toBe(true);
  });

  it('zeichnet jede Persona in jedem Format ohne Absturz', () => {
    /*
     * Die Grenzfälle sind die wertvollen: «minimal» hat fast keine Daten,
     * «luecken» fehlen ganze Quellen, «extrem» sprengt jede Skala. Eine
     * Karte, die dabei wirft, wäre ein 500er im Gesicht eines Mitglieds.
     */
    for (const eintrag of WRAPPED_PERSONAS) {
      for (const format of formate) {
        for (const seite of seiten) {
          expect(() => alsText(eintrag.bauen(jahr), format, seite)).not.toThrow();
        }
      }
    }
  });

  describe('ohne bekannten Namen', () => {
    /*
     * Der Discord-Spiegel kennt nicht zu jedem einen Namen - wer den Server
     * verlassen hat, zum Beispiel. Frueher stand dann «Du» im Namensfeld,
     * und drei der vier Saetze dieser Karte setzen den Namen in die dritte
     * Person. Heraus kam: «Das war das Jahr von Du.», «Alleine war Du
     * selten.», «Du war».
     *
     * Die Karte geht nach draussen. Ein Satz, der so aussieht, sieht nach
     * einem kaputten Programm aus - und zwar fuer jeden, der ihn sieht.
     */
    const ohneNamen = (): WrappedDaten => {
      const daten = persona(WRAPPED_PERSONAS[0]!.key);
      return { ...daten, person: { ...daten.person, displayName: null, username: null } };
    };

    it.each(formate.flatMap((format) => seiten.map((seite) => [format, seite] as const)))(
      '%s/%s schreibt keinen Satz mit «Du» in der dritten Person',
      (format, seite) => {
        const text = alsText(ohneNamen(), format, seite);
        for (const kaputt of ['von Du', 'war Du', 'Du war ', 'von Du.']) {
          expect(text, `«${kaputt}» steht auf der Karte`).not.toContain(kaputt);
        }
      },
    );

    it('sagt dasselbe in der zweiten Person', () => {
      expect(alsText(ohneNamen(), 'uebersicht', 'story')).toContain('Das war dein Jahr.');
      expect(alsText(ohneNamen(), 'archetyp', 'story')).toContain('Du warst');
      expect(alsText(ohneNamen(), 'mates', 'story')).toContain('Alleine warst du selten.');
    });

    it('erfindet auch in der Fusszeile keinen Namen', () => {
      // Lieber nichts als ein Platzhalter, der wie ein Name aussieht.
      expect(alsText(ohneNamen(), 'uebersicht', 'story')).not.toContain('>Du<');
    });

    it('nimmt den Namen, sobald es einen gibt', () => {
      const daten = persona(WRAPPED_PERSONAS[0]!.key);
      const mit = { ...daten, person: { ...daten.person, displayName: 'Silvan', username: 'silvan' } };
      expect(alsText(mit, 'uebersicht', 'story')).toContain('Das war das Jahr von Silvan.');
    });
  });

  it('hält sich an die beiden zugesagten Bildgrössen', () => {
    expect(KARTEN_MASSE.story).toEqual({ breite: 1080, hoehe: 1920 });
    expect(KARTEN_MASSE.quadrat).toEqual({ breite: 1080, hoehe: 1080 });
  });
});
