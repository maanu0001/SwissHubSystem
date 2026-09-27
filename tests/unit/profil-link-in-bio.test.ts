import { describe, expect, it } from 'vitest';
import {
  MAX_HERVORGEHOBEN,
  MAX_LABEL_LAENGE,
  MAX_LINKS,
  MAX_URL_LAENGE,
  linkSymbol,
  linksSchema,
  pruefeLinkAdresse,
} from '../../packages/modules/src/profile/links';

/**
 * Der Link-in-Bio-Bereich - und die Adressen, die hineinkommen.
 *
 * ## Warum das der gefaehrlichste Teil von Public Profile 2.0 ist
 *
 * Weil hier zum ersten Mal eine **vollstaendige Adresse** aus einer Eingabe
 * gespeichert wird. Alles andere am Profil ist ein Schluessel aus einer
 * Registry: aus «twitch» plus «swisshub» baut der Server `twitch.tv/swisshub`,
 * und aus einer Eingabe kann dort kein fremdes Ziel werden.
 *
 * Ein freier Link kann das. Er landet in einem `href`, den ein Besucher
 * anklickt, der die Person nicht kennt - und `javascript:alert(document.cookie)`
 * sieht in einer Datenbankspalte genauso aus wie `https://example.com`.
 *
 * Geprueft wird deshalb mit einer **Allowlist der Schemata**: genau `https`,
 * und alles andere fehlt. Eine Liste verbotener Schemata waere immer
 * unvollstaendig, und was nicht darauf steht, ginge durch.
 */
describe('Link-in-Bio: welche Adressen durchgehen', () => {
  it('nimmt eine gewoehnliche https-Adresse an', () => {
    for (const wert of [
      'https://example.com',
      'https://example.com/',
      'https://example.com/pfad/tief?a=1&b=2#stelle',
      'https://sub.domain.example.com/seite',
      'https://xn--mnchen-3ya.de/',
      'https://example.com:8443/api',
    ]) {
      const geprueft = pruefeLinkAdresse(wert);
      expect(geprueft.ok, wert).toBe(true);
    }
  });

  it('lehnt jedes andere Schema ab', () => {
    /*
     * Die Liste, die in jeder XSS-Anleitung steht - und ein paar, die dort
     * nicht stehen. Keiner davon kommt durch, und zwar nicht weil er in einer
     * Blocklist steht, sondern weil nur `https` in der Allowlist ist.
     */
    for (const wert of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'java\tscript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'ftp://example.com/datei',
      'http://example.com',
      'mailto:jemand@example.com',
      'tel:+41791234567',
      'about:blank',
      'blob:https://example.com/abc',
      '//example.com/ohne-schema',
      'example.com',
      '/relativ',
    ]) {
      const geprueft = pruefeLinkAdresse(wert);
      expect(geprueft.ok, wert).toBe(false);
    }
  });

  it('lehnt Zugangsdaten im Host ab', () => {
    /*
     * `https://system.swisshub.gg@boese.example` sieht im Text nach SwissHub
     * aus und landet auf `boese.example`. Genau dafuer gibt es diese Pruefung -
     * ein Besucher liest den Text und nicht die Adressleiste.
     */
    for (const wert of [
      'https://system.swisshub.gg@boese.example/',
      'https://opfer:geheim@boese.example/',
      'https://nutzer@example.com/',
    ]) {
      const geprueft = pruefeLinkAdresse(wert);
      expect(geprueft.ok, wert).toBe(false);
      if (!geprueft.ok) {
        expect(geprueft.grund).toMatch(/Benutzername|Passwort/u);
      }
    }
  });

  it('lehnt Adressen ohne oeffentlichen Hostnamen ab', () => {
    // Alles davon zeigt ins eigene Netz, nicht ins offene.
    for (const wert of [
      'https://localhost/',
      'https://localhost:3000/',
      'https://intern/',
      'https://example.com./',
    ]) {
      const geprueft = pruefeLinkAdresse(wert);
      expect(geprueft.ok, wert).toBe(false);
    }
  });

  it('begrenzt die Laenge', () => {
    const zuLang = `https://example.com/${'a'.repeat(MAX_URL_LAENGE)}`;
    const geprueft = pruefeLinkAdresse(zuLang);
    expect(geprueft.ok).toBe(false);
    if (!geprueft.ok) {
      expect(geprueft.grund).toMatch(/höchstens/u);
    }
  });

  it('speichert die normalisierte Adresse und nicht die Eingabe', () => {
    /*
     * Zurueck aus dem `URL`-Objekt: damit steht in der Spalte, was der Browser
     * tatsaechlich aufloesen wuerde. Ein Unterschied zwischen dem, was dasteht,
     * und dem, wohin es fuehrt, ist genau die Luecke, die eine Pruefung auf der
     * rohen Eingabe offen laesst.
     */
    const geprueft = pruefeLinkAdresse('  https://Example.COM/Pfad  ');
    expect(geprueft.ok).toBe(true);
    if (geprueft.ok) {
      // Host klein, Pfad unveraendert - so macht es die URL-Spezifikation.
      expect(geprueft.url).toBe('https://example.com/Pfad');
    }
    // Der Standardport verschwindet.
    const mitPort = pruefeLinkAdresse('https://example.com:443/x');
    expect(mitPort.ok && mitPort.url).toBe('https://example.com/x');
  });

  it('nennt eine leere Eingabe beim Namen', () => {
    for (const wert of ['', '   ']) {
      const geprueft = pruefeLinkAdresse(wert);
      expect(geprueft.ok).toBe(false);
      if (!geprueft.ok) {
        expect(geprueft.grund).toMatch(/Gib eine Adresse an/u);
      }
    }
  });
});

describe('Link-in-Bio: die Liste als Ganzes', () => {
  const frei = (url: string, teile: Record<string, unknown> = {}) => ({
    art: 'frei' as const,
    url,
    label: 'Mein Link',
    ...teile,
  });
  const plattform = (key: string, handle: string, teile: Record<string, unknown> = {}) => ({
    art: 'plattform' as const,
    plattform: key,
    handle,
    ...teile,
  });

  it('nimmt eine gemischte Liste an', () => {
    const ergebnis = linksSchema.safeParse({
      eintraege: [
        plattform('twitch', 'swisshub', { hervorgehoben: true }),
        frei('https://example.com/portfolio'),
        plattform('steam', '76561198000000000'),
      ],
    });
    expect(ergebnis.success).toBe(true);
  });

  it('lehnt dieselbe Plattform zweimal ab', () => {
    // `@@unique([profileId, platform])` laesst sie ohnehin nur einmal zu - die
    // Meldung hier ist die freundliche Haelfte, die Bedingung die verbindliche.
    const ergebnis = linksSchema.safeParse({
      eintraege: [plattform('twitch', 'eins'), plattform('twitch', 'zwei')],
    });
    expect(ergebnis.success).toBe(false);
  });

  it('lehnt denselben Link zweimal ab - auch in anderer Schreibweise', () => {
    const ergebnis = linksSchema.safeParse({
      eintraege: [frei('https://example.com/x'), frei('https://Example.com:443/x')],
    });
    expect(ergebnis.success).toBe(false);
  });

  it('verlangt fuer einen freien Link einen Titel', () => {
    /*
     * Ohne Titel stuende auf dem Knopf eine nackte Adresse. Bei einer Plattform
     * gibt es einen Rueckfall - ihr Name -, bei einem freien Link nicht.
     */
    const ergebnis = linksSchema.safeParse({
      eintraege: [{ art: 'frei', url: 'https://example.com', label: '' }],
    });
    expect(ergebnis.success).toBe(false);
  });

  it('haelt die Obergrenze fuer Hervorhebungen ein', () => {
    const ergebnis = linksSchema.safeParse({
      eintraege: [
        plattform('twitch', 'a', { hervorgehoben: true }),
        plattform('steam', 'bb', { hervorgehoben: true }),
        plattform('faceit', 'ccc', { hervorgehoben: true }),
        frei('https://example.com/vier', { hervorgehoben: true }),
      ],
    });
    expect(ergebnis.success).toBe(false);
    expect(MAX_HERVORGEHOBEN).toBe(3);
  });

  it('zaehlt einen verborgenen Eintrag nicht in die Hervorhebungen', () => {
    /*
     * Ein ausgeblendeter Link erscheint nicht - er kann also auch nichts
     * hervorheben. Ihn mitzuzaehlen hiesse, jemandem einen Platz wegzunehmen
     * fuer einen Knopf, den niemand sieht.
     */
    const ergebnis = linksSchema.safeParse({
      eintraege: [
        plattform('twitch', 'a', { hervorgehoben: true }),
        plattform('steam', 'bb', { hervorgehoben: true }),
        plattform('faceit', 'ccc', { hervorgehoben: true }),
        frei('https://example.com/vier', { hervorgehoben: true, verborgen: true }),
      ],
    });
    expect(ergebnis.success).toBe(true);
  });

  it('begrenzt die Zahl der Links', () => {
    const ergebnis = linksSchema.safeParse({
      eintraege: Array.from({ length: MAX_LINKS + 1 }, (_, index) => frei(`https://example.com/${index}`)),
    });
    expect(ergebnis.success).toBe(false);
  });

  it('begrenzt die Laenge eines Titels', () => {
    const ergebnis = linksSchema.safeParse({
      eintraege: [frei('https://example.com', { label: 'x'.repeat(MAX_LABEL_LAENGE + 1) })],
    });
    expect(ergebnis.success).toBe(false);
  });

  it('nimmt in der Eingabe kein Verifikationsfeld an', () => {
    /*
     * `verified` kommt in diesem Schema ueberhaupt nicht vor - niemand kann es
     * mitschicken. Ein Haken entsteht ausschliesslich dort, wo die Plattform
     * selbst bestaetigt hat, und das ist heute allein der OAuth-Weg des
     * Streamer Hubs.
     */
    const ergebnis = linksSchema.safeParse({
      eintraege: [plattform('twitch', 'swisshub', { verifiziert: true, verified: true })],
    });
    expect(ergebnis.success).toBe(true);
    if (ergebnis.success) {
      expect(JSON.stringify(ergebnis.data)).not.toContain('verifiziert');
      expect(JSON.stringify(ergebnis.data)).not.toContain('verified');
    }
  });

  it('gibt jedem Eintrag ein Symbol - und keinem ein erfundenes Logo', () => {
    expect(linkSymbol('plattform', 'twitch')).toBe('Radio');
    expect(linkSymbol('plattform', 'youtube')).toBe('Clapperboard');
    // Eine unbekannte Plattform und ein freier Link bekommen dasselbe
    // neutrale Symbol - Lucide hat keine Markenlogos, und ein nachgezeichnetes
    // waere schlechter als ein neutrales.
    expect(linkSymbol('plattform', 'gibtesnicht')).toBe('Link2');
    expect(linkSymbol('frei')).toBe('Link2');
  });
});
