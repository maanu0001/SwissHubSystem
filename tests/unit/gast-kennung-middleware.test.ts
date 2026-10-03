import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COOKIE } from '@swisshub/config';
import { spielwahl } from '@swisshub/modules';

/**
 * Die Gastkennung entsteht in der Middleware - und zwar in derselben Form.
 *
 * ## Was hier eigentlich geprueft wird
 *
 * Das CSRF-Token einer oeffentlichen Aktion ist ein HMAC ueber die
 * Gastkennung. Eine Server Component darf keine Cookies setzen; wer also zum
 * ersten Mal auf «Was spielen wir?» kam, hatte keine Kennung, bekam ein
 * leeres Token mit - und seine erste Handlung wurde mit «CSRF-Token
 * ungueltig» abgewiesen. Erst nach einem Neuladen passte beides zusammen.
 *
 * Ein Statuscode zeigt das nicht: die Seite antwortet mit 200, und der erste
 * Klick geht ins Leere. Deshalb steht die Vergabe jetzt in der Middleware,
 * der einzigen Stelle, die vor dem Rendern laeuft und Cookies setzen darf.
 *
 * ## Warum als Quelltexttest und nicht als Import
 *
 * Dieselbe Begruendung wie bei `clips-csp.test.ts`: die Middleware laeuft in
 * der Edge-Laufzeit und darf `@swisshub/modules` mit seiner
 * Datenbankanbindung nicht laden. Cookiename, Muster und Laufzeit stehen
 * deshalb zweimal. Laufen sie auseinander, ist die Folge still - die Seite
 * liest ein Cookie, das die Middleware anders geschrieben hat, und jede
 * Gasthandlung scheitert wieder. Dieser Test macht daraus einen roten Lauf.
 */
const middleware = readFileSync(
  fileURLToPath(new URL('../../apps/web/src/middleware.ts', import.meta.url)),
  'utf8',
);

function wert(name: string): string {
  const treffer = new RegExp(`const ${name} = (.+);`, 'u').exec(middleware);
  if (!treffer) {
    throw new Error(`In der Middleware steht kein \`${name}\` mehr.`);
  }
  return treffer[1]!.trim();
}

describe('Die Gastkennung in der Middleware', () => {
  it('schreibt dasselbe Cookie wie der Server', () => {
    expect(wert('GAST_COOKIE')).toBe(`'${COOKIE.spielwahlGast}'`);
  });

  it('erzeugt genau die Form, die der Server akzeptiert', () => {
    expect(wert('GAST_MUSTER')).toBe(spielwahl.GAST_MUSTER.toString());
  });

  it('haelt die Kennung so lange wie `server/gast.ts`', () => {
    const quelle = readFileSync(
      fileURLToPath(new URL('../../apps/web/src/server/gast.ts', import.meta.url)),
      'utf8',
    );
    const tage = /const GAST_COOKIE_TAGE = (\d+);/u.exec(quelle);
    expect(tage).not.toBeNull();
    expect(wert('GAST_COOKIE_SEKUNDEN')).toBe(`${tage![1]} * 24 * 60 * 60`);
  });

  it('erzeugt eine Kennung, die das Muster erfuellt', () => {
    /*
     * Die Rechnung der Middleware nachgebaut - sie laesst sich hier nicht
     * importieren. Geprueft wird, dass 16 Zufallsbytes in genau 32
     * Hexzeichen muenden: ohne `padStart` faellt jedes Byte unter 16 auf ein
     * Zeichen zusammen, die Kennung ist zu kurz, und `istGastKennung`
     * lehnt sie ab - lautlos und erst beim Klick.
     */
    expect(middleware).toContain("padStart(2, '0')");
    const bytes = new Uint8Array(16).fill(7);
    const kennung = `gast:${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
    expect(spielwahl.istGastKennung(kennung)).toBe(true);
  });

  it('vergibt sie nur auf den oeffentlichen Seiten der Spielauswahl', () => {
    // Keine Kennung fuer jeden Besucher des ganzen Systems: sie entsteht
    // dort, wo man gleich mitmachen koennen soll, und nirgends sonst.
    expect(wert('SPIELWAHL')).toBe('/^\\/was-spielen-wir(\\/|$)/');
    const muster = /^\/was-spielen-wir(\/|$)/u;
    expect(muster.test('/was-spielen-wir')).toBe(true);
    expect(muster.test('/was-spielen-wir/abc')).toBe(true);
    expect(muster.test('/dashboard')).toBe(false);
    expect(muster.test('/was-spielen-wir-anders')).toBe(false);
  });

  it('setzt sie in die Anfrage, bevor die Koepfe kopiert werden', () => {
    /*
     * Die Reihenfolge ist die Zusage. Steht `new Headers(request.headers)`
     * vor `request.cookies.set`, traegt der kopierte `cookie`-Kopf die neue
     * Kennung nicht - und die Seite bekommt wieder ein Token, das nicht
     * passt. Genau der Fehler, nur eine Ebene tiefer.
     */
    const setzen = middleware.indexOf('request.cookies.set(GAST_COOKIE');
    // Die Anweisung, nicht ihre Erwaehnung im Kommentar darueber.
    const kopieren = middleware.indexOf('const requestHeaders = new Headers(request.headers);');
    expect(setzen).toBeGreaterThan(-1);
    expect(kopieren).toBeGreaterThan(-1);
    expect(setzen).toBeLessThan(kopieren);
  });

  it('gibt sie auch an die Antwort, httpOnly und ohne Drittverwendung', () => {
    const block = middleware.slice(middleware.indexOf('response.cookies.set(GAST_COOKIE'));
    expect(block).toContain('httpOnly: true');
    expect(block).toContain("sameSite: 'lax'");
    expect(block).toContain('secure: !isDevelopment');
  });
});
