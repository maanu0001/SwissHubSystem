import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Die Grenzen um Eintritt und Zahlung - an der Quelle geprüft.
 *
 * ## Warum am Quelltext und nicht an einer laufenden Seite
 *
 * Weil die Zusagen hier Struktur sind und kein Verhalten. «Die Zahlungsdaten
 * werden nur geladen, wenn jemand sie sehen darf» lässt sich an einer
 * gerenderten Seite nur zeigen, indem man sie rendert - und dann bestätigt
 * der Test genau den Fall, den man gerade aufgesetzt hat. Am Quelltext ist
 * die Aussage allgemein: es gibt keinen Pfad, auf dem es anders käme.
 *
 * Jeder Test hier entspricht einem Satz aus dem Auftrag, und jeder Satz
 * wäre ohne ihn leicht zu verlieren.
 */

const lies = (pfad: string): string => readFileSync(join(process.cwd(), pfad), 'utf8');

/**
 * Derselbe Quelltext ohne Kommentare.
 *
 * Mehrere Tests hier suchen nach Formulierungen, die **nicht** vorkommen
 * duerfen - «Ticket gekauft» etwa. Sie stehen aber sehr wohl in den
 * Kommentaren, die erklaeren, warum es sie nicht gibt. Geprueft wird der
 * Code.
 */
const ohneKommentare = (quelle: string): string =>
  quelle.replaceAll(/\/\*[\s\S]*?\*\//gu, '').replaceAll(/\/\/.*$/gmu, '');

/** Die Rümpfe der exportierten Funktionen einer Datei, nach Namen. */
function funktionen(quelle: string): Map<string, string> {
  const treffer = [...quelle.matchAll(/export (?:async )?function (\w+)/gu)];
  const ergebnis = new Map<string, string>();
  for (const [index, stelle] of treffer.entries()) {
    const ab = stelle.index!;
    const bis = treffer[index + 1]?.index ?? quelle.length;
    ergebnis.set(stelle[1]!, quelle.slice(ab, bis));
  }
  return ergebnis;
}

const ZAHLUNGEN = lies('packages/modules/src/calendar/zahlungen.ts');
const REGISTRIERUNG = lies('packages/modules/src/calendar/registrations.ts');
const SERVICE = lies('packages/modules/src/calendar/service.ts');
const ACTIONS = lies('apps/web/src/modules/calendar/actions.ts');
const TEILNEHMER = lies('apps/web/src/app/(app)/kalender/[slug]/teilnehmer/page.tsx');
const ANMELDUNG = lies('apps/web/src/modules/calendar/components/anmelde-bereich.tsx');
const QR_ROUTE = lies('apps/web/src/app/api/kalender/[slug]/twint-qr/route.ts');
const FORMULAR = lies('apps/web/src/modules/calendar/components/event-formular.tsx');

describe('Zahlungen: kein automatischer Eingang', () => {
  it('kennt genau einen Weg nach VERIFIED, und der verlangt einen Menschen', () => {
    /*
     * Der Kern des Auftrags. Es darf keine Stelle geben, die `VERIFIED`
     * setzt, ohne vorher eine Berechtigung zu pruefen.
     */
    const alle = funktionen(ZAHLUNGEN);
    const schreiben = [...alle.entries()].filter(
      // Eine Zuweisung, keine Filterbedingung: `updateMany` **und** der Wert.
      ([, rumpf]) => rumpf.includes('updateMany(') && rumpf.includes("paymentStatus: 'VERIFIED'"),
    );
    expect(schreiben.map(([name]) => name)).toEqual(['bestaetigeZahlung']);

    const rumpf = alle.get('bestaetigeZahlung')!;
    expect(rumpf).toContain('paymentsVerify');
    expect(rumpf).toContain("paymentStatus: 'VERIFIED'");
    // Die Berechtigung steht VOR der Aenderung.
    expect(rumpf.indexOf('paymentsVerify')).toBeLessThan(rumpf.indexOf("paymentStatus: 'VERIFIED'"));
  });

  it('setzt eine frische Anmeldung nie auf bezahlt', () => {
    const ab = REGISTRIERUNG.indexOf('export async function register');
    const bis = REGISTRIERUNG.indexOf('\nexport ', ab + 10);
    const rumpf = REGISTRIERUNG.slice(ab, bis);
    expect(rumpf).toContain('startStatus(');
    for (const wert of ['VERIFIED', 'WAIVED']) {
      expect(rumpf, `register setzt ${wert}`).not.toContain(`'${wert}'`);
    }
  });

  it('kennt keinen Durchgang, der Zahlungen fortschreibt', () => {
    /*
     * Es gibt keinen Zeitablauf, der aus PENDING etwas anderes macht. Wer
     * je einen einbaut, faellt hier auf - und liest dann den Satz darueber.
     */
    const worker = lies('packages/modules/src/calendar/worker.ts');
    expect(worker).not.toContain('paymentStatus');
    expect(worker).not.toContain('VERIFIED');
  });

  it('führt «erlassen» nicht als «bezahlt»', () => {
    // Zwei Werte, zwei Audit-Aktionen, zwei Kennzahlen. Wer sie
    // zusammenzoege, suchte spaeter in der Kasse nach einem Betrag, den nie
    // jemand geschickt hat.
    expect(ZAHLUNGEN).toContain("paymentStatus: 'WAIVED'");
    expect(ZAHLUNGEN).toContain('CALENDAR_PAYMENT_WAIVED');
    const ab = ZAHLUNGEN.indexOf('export async function zahlungsKennzahlen');
    const rumpf = ZAHLUNGEN.slice(ab);
    // Im WAIVED-Zweig darf `eingegangenRappen` nicht wachsen.
    const zweig = rumpf.slice(rumpf.indexOf("case 'WAIVED':"), rumpf.indexOf("case 'REFUNDED':"));
    expect(zweig).not.toContain('eingegangenRappen');
  });
});

describe('Zahlungen: getrennte Berechtigungen', () => {
  it('verlangt für jede Handlung ihre eigene Berechtigung', () => {
    const erwartet: Array<[string, string]> = [
      ['bestaetigeZahlung', 'paymentsVerify'],
      ['erlasseZahlung', 'paymentsWaive'],
      ['nimmBestaetigungZurueck', 'paymentsRevoke'],
      ['speichereZahlungsQr', 'paymentsManage'],
      ['entferneZahlungsQr', 'paymentsManage'],
    ];
    for (const [funktion, recht] of erwartet) {
      const ab = ZAHLUNGEN.indexOf(`export async function ${funktion}`);
      expect(ab, `${funktion} fehlt`).toBeGreaterThan(-1);
      const bis = ZAHLUNGEN.indexOf('\nexport ', ab + 10);
      const rumpf = ZAHLUNGEN.slice(ab, bis === -1 ? undefined : bis);
      expect(rumpf, `${funktion} prüft ${recht} nicht`).toContain(recht);
    }
  });

  it('prüft dieselben Berechtigungen auch an den Server Actions', () => {
    for (const recht of ['paymentsVerify', 'paymentsWaive', 'paymentsRevoke', 'paymentsManage']) {
      expect(ACTIONS, `Server Action ohne ${recht}`).toContain(`P.${recht}`);
    }
  });

  it('lässt den Preis nicht über die allgemeine Bearbeitung ändern', () => {
    /*
     * Wer die Beschreibung schreibt, soll nicht nebenbei den Eintritt
     * verdoppeln. Der Riegel sitzt im Dienst: ohne `darfZahlungen` fallen
     * die Felder aus den Daten.
     */
    expect(SERVICE).toContain('darfZahlungen: boolean');
    const ab = SERVICE.indexOf('darfZahlungen\n      ? {');
    expect(ab, 'die Zahlungsfelder haengen nicht an der Berechtigung').toBeGreaterThan(-1);
    const block = SERVICE.slice(ab, SERVICE.indexOf(': {})', ab));
    for (const feld of ['entryFeeEnabled', 'entryFeeCents', 'entryFeeCurrency', 'paymentNote']) {
      expect(block, `${feld} steht ausserhalb der Bedingung`).toContain(feld);
    }
    expect(ACTIONS).toContain('darfZahlungen: can(ctx, P.paymentsManage)');
  });

  it('zeigt den Editor-Abschnitt nur mit der Berechtigung', () => {
    expect(FORMULAR).toContain('darfZahlungen: boolean');
    expect(FORMULAR).toContain('{darfZahlungen ? (');
  });
});

describe('Zahlungen: nichts Internes nach aussen', () => {
  it('lädt die Zahlungsangaben nur, wenn jemand sie sehen darf', () => {
    /*
     * «Das Frontend blendet es aus» ist keine Zugriffskontrolle: was eine
     * Server Component laedt, steht im HTML, das der Browser bekommt.
     */
    expect(TEILNEHMER).toContain('darfZahlungenSehen');
    expect(TEILNEHMER).toContain('can(context, P.paymentsView)');
    expect(TEILNEHMER).toMatch(/darfZahlungenSehen\s*\?\s*calendar\.ladeZahlungsliste/u);
    expect(TEILNEHMER).toMatch(/darfZahlungenSehen\s*\?\s*calendar\.zahlungsKennzahlen/u);
  });

  it('zeigt der teilnehmenden Person keine internen Angaben', () => {
    // Wer bestaetigt hat, wann, und mit welchem Grund - das ist die Auskunft
    // der Organisation, nicht die des Gastes.
    for (const feld of ['verifiedByUsername', 'paymentVerifiedBy', 'paymentReason']) {
      expect(ANMELDUNG, `${feld} steht in der Anmeldeansicht`).not.toContain(feld);
    }
  });

  it('behauptet der teilnehmenden Person gegenüber keine Zahlung', () => {
    // Die verbotenen Formulierungen aus dem Auftrag.
    const code = ohneKommentare(ANMELDUNG);
    for (const satz of ['Ticket gekauft', 'Zahlung erfolgreich', 'Du bist definitiv angemeldet']) {
      expect(code, `«${satz}» steht in der Anmeldeansicht`).not.toContain(satz);
    }
    // Und das, was stattdessen dort steht.
    expect(ANMELDUNG).toContain('noch nicht definitiv');
    expect(ANMELDUNG).toContain('ZAHLUNG AUSSTEHEND');
  });

  it('schützt den QR-Upload mit der vollen Sicherheitskette', () => {
    for (const teil of [
      'assertMembership',
      'verifyCsrfToken',
      'enforceRateLimit',
      'MAX_QR_BYTES',
      'X-Content-Type-Options',
    ]) {
      expect(QR_ROUTE, `${teil} fehlt an der Upload-Route`).toContain(teil);
    }
    // Und die Berechtigung wird durchgereicht, nicht hier entschieden.
    expect(QR_ROUTE).toContain('can: (permission: string) => can(context, permission)');
  });

  it('nimmt kein SVG und kein PDF als QR-Code', () => {
    /*
     * Eine SVG-Datei kann Skripte enthalten; solange sie niemand
     * zuverlaessig bereinigt, ist das Weglassen die ehrlichere Loesung. Der
     * Riegel steht in der zentralen Ablage - das Format wird an den echten
     * Bytes erkannt, nicht am Header und nicht an der Endung.
     */
    const ablage = lies('packages/modules/src/branding/storage.ts');
    expect(ablage).toContain('export function detectImageFormat');
    expect(ablage).not.toContain("'image/svg+xml'");
    expect(ablage).not.toContain("'application/pdf'");
    expect(FORMULAR).toContain('accept="image/png,image/jpeg,image/webp"');
  });

  it('speichert keine Zahlungsdaten im Protokoll', () => {
    /*
     * Was im Audit Log steht, ist «wer hat wann bestaetigt, dass fuer diesen
     * Termin so viel eingegangen ist» - kein Beleg, keine Referenz, keine
     * Kontonummer.
     */
    for (const feld of ['iban', 'IBAN', 'kontonummer', 'transaktionsId', 'referenz']) {
      expect(ZAHLUNGEN, `${feld} taucht im Zahlungsdienst auf`).not.toContain(feld);
    }
  });
});

/**
 * SwissHub fragt: die Trennung zwischen öffentlich und Admin.
 *
 * Steht hier, weil es dieselbe Regel ist wie oben: was eine Server Component
 * lädt, steht im HTML. Wer die Berechtigung nicht hat, bekommt die Daten
 * nicht - er bekommt sie nicht ausgeblendet.
 */
describe('SwissHub fragt: öffentlich bleibt anonym', () => {
  const SEITE = lies('apps/web/src/app/(app)/fragt/ergebnisse/[id]/page.tsx');
  const KOMPONENTE = lies('apps/web/src/modules/fragt/components/stimmen-detail.tsx');
  const CONFIG = lies('packages/modules/src/fragt/config.ts');

  it('hat eine eigene Berechtigung für die Einzelstimmen', () => {
    // Nicht «wer Ergebnisse sieht, sieht auch Namen». Zwei Schluessel.
    expect(CONFIG).toContain("votesDetail: 'fragt.votes.detail'");
    expect(CONFIG).toContain('FRAGT_PERMISSIONS.votesDetail');
    // Als kritisch gekennzeichnet - sie gibt Einblick in einzelne Leute.
    const ab = CONFIG.indexOf('key: FRAGT_PERMISSIONS.votesDetail');
    expect(CONFIG.slice(ab, CONFIG.indexOf('},', ab))).toContain('critical: true');
  });

  it('lädt die Einzelstimmen nur mit dieser Berechtigung', () => {
    expect(SEITE).toContain('fragt.FRAGT_PERMISSIONS.votesDetail');
    expect(SEITE).toMatch(/darfDetails\s*\?\s*await fragt\.ladeStimmenDetail/u);
    // Der Bereich erscheint nur, wenn tatsaechlich Daten da sind.
    expect(SEITE).toContain('{stimmen ? (');
  });

  it('prüft in der Komponente selbst nichts', () => {
    /*
     * Eine Bedingung in der Komponente waere «das Frontend versteckt es» -
     * und die Namen staenden trotzdem im HTML. Die Komponente zeichnet, was
     * sie bekommt; entschieden wird eine Ebene darueber.
     */
    const code = ohneKommentare(KOMPONENTE);
    expect(code).not.toContain('votes.detail');
    expect(code).not.toContain('can(');
  });

  it('nennt die Seite, die nur Ergebnisse zeigt, keine Kennung', () => {
    const uebersicht = lies('apps/web/src/app/(app)/fragt/ergebnisse/page.tsx');
    expect(uebersicht).not.toContain('voterDiscordId');
    expect(uebersicht).not.toContain('ladeStimmenDetail');
  });
});
