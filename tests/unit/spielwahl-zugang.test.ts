import { describe, expect, it } from 'vitest';

const { existsSync, readFileSync } = await import('node:fs');
const { join } = await import('node:path');

/** Kommentare raus, bevor nach verbotenen Aufrufen gesucht wird. */
function ohneKommentare(quelle: string): string {
  return quelle.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '');
}

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
/*
 * Die Buehne liegt ausserhalb von `(app)`.
 *
 * Seit Gaeste ohne Konto mitstimmen koennen: die Anmeldung liegt in SwissHub
 * im Layout von `(app)`, und diese eine Seite muss auch ohne sie erreichbar
 * sein. Die Uebersicht und der Spielkatalog bleiben drin.
 */
const SEITE = 'apps/web/src/app/was-spielen-wir/[token]/page.tsx';
const GAST_AKTIONEN = 'apps/web/src/modules/spielwahl/gast-aktionen.ts';
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
    /*
     * Die Gast-Aktionen laden die Session nicht selbst.
     *
     * Sie gehen ueber `verlangeGastZugang`, und **dort** steht die Abfrage -
     * an einer Stelle statt an siebzehn. Eine zweite Ladestelle in dieser
     * Datei waere die, die den Guild-Filter irgendwann vergisst; `prisma.`
     * darf darin deshalb nicht vorkommen.
     *
     * Die Guild **vergleichen** muessen sie trotzdem:
     * `verlangeGastZugang` gibt sie zurueck, und `verlangeEigeneGuild` haelt
     * sie gegen `resolveGuildId()`. Vorher stand hier, `resolveGuildId` duerfe
     * nicht vorkommen - das war richtig, solange ein Gast nur abstimmen
     * konnte und die Runde ihm ohnehin geschickt worden war. Wer Runden
     * eroeffnet und fuehrt, soll das nicht in einer fremden Guild tun.
     */
    const gast = quelle(GAST_AKTIONEN);
    expect(gast).not.toContain('prisma.');
    expect(gast).toContain('resolveGuildId()');
    expect(gast).toContain('verlangeEigeneGuild');
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
    /*
     * Beide Dateien: das Rad und die Stelle, an der es stehen bleibt.
     *
     * `rad-stopp.ts` streut den Haltepunkt innerhalb des Gewinnerfeldes -
     * genau die Art Zahl, die jemand aus Bequemlichkeit mit `Math.random`
     * ziehen wuerde. Dann hielte jeder Bildschirm an einer anderen Stelle,
     * und einer davon unter einem fremden Cover. Sie kommt deshalb aus dem
     * Seed der Runde, und diese Zeilen halten das fest.
     */
    for (const datei of [
      'apps/web/src/modules/spielwahl/components/rad.tsx',
      'apps/web/src/modules/spielwahl/rad-stopp.ts',
    ]) {
      /*
       * Ohne die Kommentare gelesen.
       *
       * In `rad-stopp.ts` steht `Math.random` in dem Absatz, der erklaert,
       * warum es dort nicht verwendet wird. Geprueft wird der Code.
       */
      const inhalt = quelle(datei)
        .replaceAll(/\/\*[\s\S]*?\*\//gu, '')
        .replaceAll(/\/\/.*$/gmu, '');
      expect(inhalt, datei).not.toContain('Math.random');
      expect(inhalt, datei).not.toContain('crypto.getRandomValues');
      expect(inhalt, datei).not.toContain('Date.now()');
    }
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

/**
 * Die Übersicht ohne Konto.
 *
 * ## Warum das eine eigene Gruppe bekommt
 *
 * Weil der Fehler zweimal gemeldet wurde. Beim ersten Mal wanderte die Bühne
 * `/was-spielen-wir/<token>` aus `(app)` heraus, und das sah aus wie die
 * Lösung: ein geteilter Einladungslink funktionierte. Die **Übersicht** blieb
 * aber drinnen - und damit jeder Weg, der ohne Einladungswert dorthin führt:
 * die Adresse eintippen, dem Link im Kopfbereich folgen, ein Lesezeichen.
 *
 * Der Smoke-Test sah es sogar («307 /was-spielen-wir»), und es wurde als
 * gewollt abgehakt. Deshalb steht es jetzt als Prüfung da und nicht als
 * Erinnerung.
 */
describe('Die Übersicht ist ohne Konto erreichbar', () => {
  const UEBERSICHT = 'apps/web/src/app/was-spielen-wir/page.tsx';

  it('liegt ausserhalb von (app)', () => {
    // In SwissHub ist das **die** Entscheidung über Anmeldepflicht: das
    // Layout von `(app)` ruft `requireMember`, die Middleware tut es nicht.
    expect(existsSync(join(process.cwd(), UEBERSICHT))).toBe(true);
    expect(existsSync(join(process.cwd(), 'apps/web/src/app/(app)/was-spielen-wir/page.tsx'))).toBe(false);
  });

  it('verlangt weder Anmeldung noch Mitgliedschaft', () => {
    const quelle = ohneKommentare(readFileSync(join(process.cwd(), UEBERSICHT), 'utf8'));
    expect(quelle).not.toContain('requireMember');
    expect(quelle).not.toContain('requirePagePermission');
    // Eine Weiterleitung wäre die Anmeldewand mit anderen Mitteln.
    expect(quelle).not.toMatch(/\bredirect\(/u);
    expect(quelle).toContain('getOptionalAuthContext');
  });

  it('lässt den Spielkatalog in (app)', () => {
    // Zusehen ist öffentlich, Pflegen nicht. Rutschte der Katalog mit heraus,
    // stünde er ohne Anmeldung offen - und niemand hätte es bemerkt.
    expect(existsSync(join(process.cwd(), 'apps/web/src/app/(app)/was-spielen-wir/games/page.tsx'))).toBe(
      true,
    );
  });

  it('gibt den Einladungswert nur an Teilnehmer heraus', () => {
    /*
     * Die Regel ist nicht «nur an Mitglieder», sondern «nur an Leute, die in
     * der Runde dabei sind» - und sie sitzt in der Ladefunktion, nicht in der
     * Seite.
     *
     * Die Übersicht lädt deshalb mit der **eigenen** Kennung, und bei einem
     * Besucher ohne Konto ist das seine Gastkennung. Hier stand vorher ein
     * fester leerer Wert für Gäste, und das war die Ursache eines
     * Anmeldefensters: der Gast, der eine Runde eröffnet hatte, bekam seine
     * eigene Runde ohne Einladungswert angeboten und kam dahinter nicht
     * herein.
     *
     * Wer noch kein Gastcookie hat, liest weiterhin mit leerem Wert - und ist
     * damit in keiner Runde dabei.
     */
    const lader = ohneKommentare(
      readFileSync(join(process.cwd(), 'apps/web/src/server/spielwahl.ts'), 'utf8'),
    );
    expect(lader).toContain("inviteToken: dabei ? session.inviteToken : ''");
    expect(lader).toContain("betrachter !== ''");

    const quelle = ohneKommentare(readFileSync(join(process.cwd(), UEBERSICHT), 'utf8'));
    expect(quelle).toContain("ladeOffeneRunden(guildId, mitglied?.user.discordId ?? gastkennung ?? '')");
  });

  it('zeigt den Schnellstart auch ohne Konto', () => {
    /*
     * Die Gegenprobe zur früheren Prüfung an dieser Stelle.
     *
     * Hier stand `expect(quelle).toContain('{mitglied ? <Schnellstart')` mit
     * der Begründung, ein Knopf, der nur mit einem Fehler antwortet, sei eine
     * Einladung zum Ärger. Der Knopf antwortet nicht mehr mit einem Fehler -
     * eine Runde eröffnen geht ohne Konto. Die alte Prüfung hätte die
     * Reparatur verhindert, deshalb steht sie jetzt umgekehrt da.
     */
    const quelle = ohneKommentare(readFileSync(join(process.cwd(), UEBERSICHT), 'utf8'));
    expect(quelle).toContain('<Schnellstart csrfToken={csrfTokenFor(mitglied)} />');
    expect(quelle).toMatch(/<Schnellstart\s+csrfToken=\{gastkennung[\s\S]*?gast\s*\/>/u);
    // Und keine Anmeldeeinladung an der Stelle, an der der Knopf steht.
    expect(quelle).not.toContain('GastEinladung');
  });

  it('verlangt auf der Bühne keinen Einladungswert mehr von einem Gast', () => {
    /*
     * Der zweite Weg in dasselbe Anmeldefenster.
     *
     * Die Bühne liess einen Gast nur über den Einladungswert herein, nicht
     * über die Sessionkennung. Das schützte nichts, seit die Übersicht
     * öffentlich ist und die Kennungen dort als Ziel stehen - es machte bloss
     * den gewöhnlichen Weg unmöglich: offene Runde sehen, draufklicken, auf
     * einer Anmeldemaske landen.
     *
     * Die Tür ist `gaesteErlaubt` und nichts sonst.
     */
    const seite = ohneKommentare(readFileSync(join(process.cwd(), SEITE), 'utf8'));
    expect(seite).toContain('if (session.gaesteErlaubt) {');
    expect(seite).not.toContain('istEinladung && session.gaesteErlaubt');
  });
});
