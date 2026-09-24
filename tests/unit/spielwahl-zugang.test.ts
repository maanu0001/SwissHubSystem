import { describe, expect, it } from 'vitest';

const { readFileSync } = await import('node:fs');
const { join } = await import('node:path');

/**
 * Wer was darf - statisch nachgelesen.
 *
 * ## Warum das hier steht und nicht nur zur Laufzeit geprüft wird
 *
 * Weil die gefährlichen Fehler Einzeiler sind und niemandem auffallen: eine
 * Session, die ohne Guild-Filter gesucht wird, öffnet sich weiterhin - nur
 * eben auch für jemanden aus einer anderen Guild. Eine Aktion ohne
 * `verlangeFuehrung` funktioniert weiterhin - nur darf sie dann jeder.
 *
 * `tests/unit/action-authorization.test.ts` prüft für **alle** Aktionen des
 * Systems, dass eine Berechtigung, eine Prüfung im Rumpf oder die
 * Kennzeichnung `selfService` vorhanden ist. Diese Datei schliesst die Lücke
 * daneben: was danach noch gelten muss, ist fachlich und nicht formal.
 */
const quelle = (datei: string): string => readFileSync(join(process.cwd(), datei), 'utf8');

const AKTIONEN = 'apps/web/src/modules/spielwahl/aktionen.ts';
const STROM = 'apps/web/src/app/api/was-spielen-wir/[id]/live/route.ts';
const SEITE = 'apps/web/src/app/(app)/was-spielen-wir/[token]/page.tsx';
const SESSION = 'packages/modules/src/spielwahl/session.ts';

describe('Zugang zur Spielauswahl', () => {
  it('lädt jede Session ausschliesslich mit der eigenen Guild', () => {
    /*
     * Eine Sessionkennung in der Adresszeile sagt nichts darüber aus, ob sie
     * den Anfragenden etwas angeht. Die Guild gehört deshalb in die Abfrage
     * und nicht in eine Prüfung danach - was man nicht lädt, kann man auch
     * nicht versehentlich herausgeben.
     */
    for (const datei of [AKTIONEN, STROM, SEITE]) {
      expect(quelle(datei), datei).toContain('resolveGuildId()');
    }
    const kern = quelle(SESSION);
    expect(kern).toContain('findFirst({ where: { guildId, inviteToken } })');
    expect(kern).toContain('findFirst({ where: { guildId, id: sessionId } })');
  });

  it('verlangt für jede führende Handlung die Rolle in der Session', () => {
    const kern = quelle(SESSION);
    for (const funktion of ['schliesseVorschlaege', 'oeffneVorschlaege', 'nimmAn', 'entferne']) {
      const ab = kern.indexOf(`export async function ${funktion}`);
      expect(ab, funktion).toBeGreaterThan(0);
      const abschnitt = kern.slice(ab, ab + 900);
      expect(abschnitt, funktion).toMatch(/verlangeFuehrung|rolleVon/u);
    }
  });

  it('verlangt zum Abstimmen die Teilnahme', () => {
    const runde = quelle('packages/modules/src/spielwahl/runde.ts');
    const ab = runde.indexOf('export async function stimme');
    expect(ab).toBeGreaterThan(0);
    expect(runde.slice(ab, ab + 400)).toContain('verlangeTeilnahme');
  });

  it('nimmt die Führungsrolle nicht aus einer Eingabe entgegen', () => {
    /*
     * Der Fehler wäre ein Feld `alsHost: true` im Formular. Geprüft wird
     * deshalb, dass die Rolle ausschliesslich aus der Session gelesen wird -
     * `rolleVon` fragt die Datenbank, nie die Anfrage.
     */
    const kern = quelle(SESSION);
    const ab = kern.indexOf('export async function rolleVon');
    expect(kern.slice(ab, ab + 500)).toContain('prisma.spielwahlParticipant.findUnique');
    expect(quelle(AKTIONEN)).not.toMatch(/rolle:\s*z\./u);
  });

  it('lässt eine fremde Runde nur mit Moderationsrecht schliessen - und schreibt es auf', () => {
    const aktionen = quelle(AKTIONEN);
    const ab = aktionen.indexOf("name: 'spielwahl.session.close'");
    const abschnitt = aktionen.slice(ab, ab + 1200);
    expect(abschnitt).toContain('SPIELWAHL_PERMISSIONS.manage');
    expect(abschnitt).toContain('alsModeration');

    const kern = quelle(SESSION);
    const schliessen = kern.slice(kern.indexOf('export async function schliesse'));
    expect(schliessen).toContain('SPIELWAHL_SESSION_CLOSED');
  });

  it('schreibt jede Stimme in einer Transaktion und prüft die Serverzeit', () => {
    const runde = quelle('packages/modules/src/spielwahl/runde.ts');
    const ab = runde.indexOf('export async function stimme');
    expect(runde.slice(ab, ab + 1200)).toContain('prisma.$transaction');

    for (const datei of [
      'packages/modules/src/spielwahl/modi/voting.ts',
      'packages/modules/src/spielwahl/modi/elimination.ts',
    ]) {
      // Die Uhr des Servers entscheidet, nicht die des Geräts.
      expect(quelle(datei), datei).toContain('eingabe.jetzt >= eingabe.runde.endsAt');
    }
  });

  it('bestimmt den Roulette-Gewinner auf dem Server, nicht im Browser', () => {
    const roulette = quelle('packages/modules/src/spielwahl/modi/roulette.ts');
    expect(roulette).toContain('drawWeighted');
    expect(roulette).toContain('gewinnerCandidateId: ziehung.winner.entryId');

    /*
     * Und im Browser wird nicht gewürfelt. Das Rad rechnet den Endwinkel aus
     * dem Wert des Servers - eine einzige `Math.random()` in dieser Datei
     * hiesse, dass zwei Bildschirme verschiedene Ergebnisse zeigen können.
     */
    const rad = quelle('apps/web/src/modules/spielwahl/components/rad.tsx');
    expect(rad).not.toContain('Math.random');
    expect(rad).not.toContain('crypto.getRandomValues');
  });

  it('lädt kein Bild aus einer Eingabe', () => {
    /*
     * Ein freier Vorschlag bekommt kein Cover. Das Bild entsteht
     * ausschliesslich aus `coverSrc(spiel)` - also aus dem gepflegten
     * Katalog und nie aus dem Textfeld, in das jemand gerade etwas getippt
     * hat.
     *
     * Geprueft wird die Zuweisung: `cover` wird einmal deklariert, einmal
     * aus dem Katalog gesetzt, und der Zweig fuer den freien Titel fasst sie
     * nicht an. Dass das auch in der Datenbank so ankommt, prueft
     * `tests/integration/spielwahl-katalog.test.ts`.
     */
    const kandidaten = quelle('packages/modules/src/spielwahl/kandidaten.ts');
    const zuweisungen = [...kandidaten.matchAll(/^\s*cover = (.+);$/gmu)].map((treffer) => treffer[1]);
    expect(zuweisungen).toEqual(['coverSrc(spiel)']);
    expect(kandidaten).toContain('coverSnapshot: cover');
  });

  it('prüft freie Titel gegen eine Erlaubnisliste von Zeichen', () => {
    const schemas = quelle('packages/modules/src/spielwahl/schemas.ts');
    expect(schemas).toContain('freierNameSchema');
    // Eine Erlaubnisliste, keine Verbotsliste.
    expect(schemas).toMatch(/\^\[\\p\{L\}\\p\{N\}/u);
  });
});
