import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Die Grenzen um Tickets, Gäste und den Anmeldeweg - an der Quelle geprüft.
 *
 * ## Warum am Quelltext
 *
 * Weil die Zusagen hier Struktur sind. «Der QR-Code erscheint nicht vor der
 * Anmeldung» lässt sich an einer gerenderten Seite nur für den einen Fall
 * zeigen, den man gerade aufgesetzt hat. Am Quelltext ist die Aussage
 * allgemein: es gibt keinen Pfad, auf dem es anders käme.
 *
 * Jeder Test hier entspricht einem Satz aus dem Auftrag, und jeder Satz wäre
 * ohne ihn leicht zu verlieren - meistens beim übernächsten Umbau, von
 * jemandem, der den Satz nie gelesen hat.
 */

const lies = (pfad: string): string => readFileSync(join(process.cwd(), pfad), 'utf8');

/**
 * Derselbe Quelltext ohne Kommentare.
 *
 * Mehrere Tests suchen nach Formulierungen, die **nicht** vorkommen duerfen -
 * `plusOneName` etwa. Sie stehen aber sehr wohl in den Kommentaren, die
 * erklaeren, warum es sie nicht gibt. Geprueft wird der Code.
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

const TICKETS = lies('packages/modules/src/calendar/tickets.ts');
const REGISTRIERUNG = lies('packages/modules/src/calendar/registrations.ts');
const SCHEMAS = lies('packages/modules/src/calendar/schemas.ts');
const QUERIES = lies('packages/modules/src/calendar/queries.ts');
const DISCORD = lies('packages/modules/src/calendar/discord.ts');
const CONFIG = lies('packages/modules/src/calendar/config.ts');
const BOT = lies('apps/bot/src/calendar-interactions.ts');
const ACTIONS = lies('apps/web/src/modules/calendar/actions.ts');
const ANMELDUNG = lies('apps/web/src/modules/calendar/components/anmelde-bereich.tsx');
const TEILNEHMENDE = lies('apps/web/src/modules/calendar/components/teilnehmende-liste.tsx');
const QR_ROUTE = lies('apps/web/src/app/api/kalender/[slug]/twint-qr/route.ts');
const DETAILSEITE = lies('apps/web/src/app/(app)/kalender/[slug]/page.tsx');
const TEILNEHMERSEITE = lies('apps/web/src/app/(app)/kalender/[slug]/teilnehmer/page.tsx');
const KARTE = lies('apps/web/src/modules/calendar/components/shared.tsx');
const SCHEMA = lies('packages/database/prisma/schema.prisma');

describe('Tickets: Bestellung und Teilnehmer sind getrennt', () => {
  it('kennt kein plusOne-Feld - in keiner Form', () => {
    /*
     * Der Satz aus dem Auftrag, wortwoertlich: keine «+1»-Sonderloesung. Der
     * naheliegende Ausweg waere `plusOneName` gewesen, der zweite Schritt
     * `plusTwoName` - und danach ist «wie viele kommen?» eine
     * Fallunterscheidung statt einer Abfrage.
     */
    const verboten = /plus[_-]?(one|two|three|1|2|3)|begleit(er|ung)Name|guest1|gast1/iu;
    for (const [name, quelle] of [
      ['Schema', SCHEMA],
      ['tickets.ts', TICKETS],
      ['registrations.ts', REGISTRIERUNG],
      ['schemas.ts', SCHEMAS],
      ['Anmeldeansicht', ANMELDUNG],
    ] as const) {
      expect(ohneKommentare(quelle), `${name} traegt ein +1-Feld`).not.toMatch(verboten);
    }
  });

  it('hat genau eine Ticket-Tabelle und keine zweite Modellfamilie', () => {
    // Nicht `CalendarGuest` **und** `CalendarTicket` und `CalendarAttendee` -
    // eine Person ist eine Zeile, und zwar in derselben Tabelle.
    const modelle = [...SCHEMA.matchAll(/^model (Calendar\w+)/gmu)].map((t) => t[1]!);
    const personenModelle = modelle.filter((name) => /Ticket|Guest|Gast|Attendee|Teilnehm/iu.test(name));
    expect(personenModelle).toEqual(['CalendarTicket']);
  });

  it('haengt das Ticket an die Bestellung und an den Termin', () => {
    /*
     * `eventId` steht doppelt - an der Bestellung und am Ticket. Das ist
     * Absicht: die Kapazitaetspruefung laeuft unter einer Zeilensperre und
     * muss dort zaehlen koennen, ohne ueber die Bestellungen zu verbinden.
     */
    const modell = SCHEMA.slice(SCHEMA.indexOf('model CalendarTicket'));
    const bis = modell.indexOf('\n}');
    const rumpf = modell.slice(0, bis);
    expect(rumpf).toMatch(/registrationId\s+String/u);
    expect(rumpf).toMatch(/eventId\s+String/u);
    expect(rumpf).toMatch(/onDelete:\s*Cascade/u);
    expect(rumpf).toMatch(/@@index\(\[eventId, status\]\)/u);
    expect(rumpf).toMatch(/token\s+String\s+@unique/u);
  });

  it('macht Gastfelder optional und erfindet keine Discord-Kennung', () => {
    const modell = SCHEMA.slice(SCHEMA.indexOf('model CalendarTicket'));
    const rumpf = modell.slice(0, modell.indexOf('\n}'));
    // Ein Gast hat keinen Account. Ein Pflichtfeld hier hiesse, eines zu
    // erfinden - und genau das verbietet der Auftrag.
    for (const feld of ['memberDiscordId', 'guestFirstName', 'guestEmail', 'guestDiscordName']) {
      expect(rumpf, `${feld} ist nicht optional`).toMatch(new RegExp(`${feld}\\s+String\\?`, 'u'));
    }
  });
});

describe('Tickets: Token', () => {
  it('erzeugt den Token kryptografisch zufällig', () => {
    expect(TICKETS).toContain("import { randomBytes } from 'node:crypto'");
    const erzeugen = funktionen(TICKETS).get('ticketToken')!;
    expect(erzeugen).toContain('randomBytes(32)');
    // Nichts, was sich hochzaehlen oder aus einer Bestellnummer ableiten
    // laesst.
    expect(ohneKommentare(TICKETS)).not.toContain('Math.random');
    expect(ohneKommentare(TICKETS)).not.toMatch(/\bposition\s*\+\s*1\b.*token/iu);
  });

  it('vergibt einen Token je Ticket, nicht je Bestellung', () => {
    // `ticketDaten` laeuft je Zeile - also je Person.
    const daten = funktionen(TICKETS).get('ticketDaten')!;
    expect(daten).toContain('token: ticketToken()');
    const register = funktionen(REGISTRIERUNG).get('register')!;
    expect(register).toMatch(/ticketEingaben\.map\(\(eingabe, index\) => ticketDaten\(/u);
  });

  it('hält Ticket-QR und TWINT-QR auseinander', () => {
    /*
     * Zwei verschiedene Codes mit zwei verschiedenen Aufgaben: der eine
     * bezahlt, der andere laesst ein. Wer sie vermischte, liesse jeden
     * herein, der den Zahlungscode abfotografiert hat.
     */
    expect(ohneKommentare(TICKETS)).not.toContain('leseZahlungsQr');
    expect(ohneKommentare(TICKETS)).not.toContain('paymentQr');
    const qrModul = lies('packages/modules/src/calendar/zahlungen.ts');
    expect(ohneKommentare(qrModul)).not.toContain('ticketToken');
  });

  it('gibt den Ticket-Token nur an den Besteller', () => {
    const quelle = funktionen(TICKETS);
    // Die eigene Bestellung traegt ihn - es ist das eigene Ticket.
    expect(quelle.get('meineBestellung')!).toContain('token: ticket.token');
    // Die Adminlisten nicht.
    expect(quelle.get('ladeBestellungen')!).not.toContain('token');
    expect(quelle.get('ladeTeilnehmende')!).not.toContain('token');
    // Und die Detailseite reicht ihn nicht an den Browser weiter.
    expect(ohneKommentare(DETAILSEITE)).not.toContain('token:');
  });

  it('weist einen Token ab, der nicht nach einem Token aussieht', () => {
    const nachschlagen = funktionen(TICKETS).get('ticketZuToken')!;
    // Ohne diese Zeile waere jede Eingabe eine Datenbankabfrage.
    expect(nachschlagen).toMatch(/\^\[0-9a-f\]\{64\}\$/u);
    expect(nachschlagen).toContain('return null');
  });
});

describe('Tickets: keine Preis- und Zuordnungsmanipulation', () => {
  it('rechnet den Gesamtbetrag serverseitig aus dem Termin', () => {
    const register = funktionen(REGISTRIERUNG).get('register')!;
    expect(register).toContain('frisch.entryFeeCents * ticketZeilen.length');
    // Und nimmt keinen Betrag aus der Anfrage entgegen.
    expect(ohneKommentare(SCHEMAS)).not.toMatch(/paymentAmountCents|gesamtbetrag|totalCents/u);
  });

  it('lässt kein Ticket auf ein fremdes Mitglied ausstellen', () => {
    /*
     * Die Mass-Assignment-Luecke, die es hier nicht gibt: `memberDiscordId`
     * steht **nicht** im Eingabeschema. Das Formular schickt ein Ja oder
     * Nein; die Kennung setzt der Server aus der Sitzung.
     */
    const ticketSchema = SCHEMAS.slice(
      SCHEMAS.indexOf('export const ticketEingabeSchema'),
      SCHEMAS.indexOf('export const registerSchema'),
    );
    expect(ticketSchema).not.toContain('memberDiscordId');
    expect(ticketSchema).not.toContain('purchaserUserId');
    expect(ticketSchema).toContain('fuerMich');

    const register = ACTIONS.slice(
      ACTIONS.indexOf('export const registerAction'),
      ACTIONS.indexOf('export const unregisterAction'),
    );
    expect(register).toContain('memberDiscordId: ctx.user.discordId');
    expect(register).not.toContain('input.memberDiscordId');
  });

  it('lässt den Besteller nicht zweimal im selben Saal stehen', () => {
    const registerSchema = SCHEMAS.slice(SCHEMAS.indexOf('export const registerSchema'));
    expect(registerSchema).toContain('fuerMich > 1');
  });

  it('begrenzt die Ticketzahl im Schema und im Dienst', () => {
    // Zweimal, und das ist kein Versehen: das Schema faengt die Anfrage, der
    // Dienst faengt den Aufruf aus Bot oder Skript.
    expect(SCHEMAS).toMatch(/z\.array\(ticketEingabeSchema\)\.max\(10\)/u);
    expect(funktionen(REGISTRIERUNG).get('register')!).toContain('MAX_TICKETS_JE_BESTELLUNG');
  });

  it('setzt den Besteller der Bestellung aus der Sitzung', () => {
    expect(ohneKommentare(SCHEMAS)).not.toMatch(/purchaserUserId|bestellerDiscordId:/u);
    const register = ACTIONS.slice(
      ACTIONS.indexOf('export const registerAction'),
      ACTIONS.indexOf('export const unregisterAction'),
    );
    expect(register).toContain('discordId: ctx.user.discordId');
  });
});

describe('Tickets: Kapazität', () => {
  it('prüft die Kapazität unter der Zeilensperre', () => {
    const register = funktionen(REGISTRIERUNG).get('register')!;
    const sperre = register.indexOf('FOR UPDATE');
    const zaehlen = register.indexOf('belegteTickets(eventId, tx)');
    expect(sperre).toBeGreaterThan(-1);
    expect(zaehlen).toBeGreaterThan(sperre);
    // Und der Vergleich ist «passt die ganze Bestellung», nicht «ist noch
    // irgendwo Platz».
    expect(register).toContain('belegt + ticketZeilen.length > frisch.capacity');
  });

  it('zählt Tickets und nicht Bestellungen', () => {
    const zaehlen = funktionen(TICKETS).get('belegteTickets')!;
    expect(zaehlen).toContain('calendarTicket.count');
    expect(zaehlen).toContain("status: 'ACTIVE'");
    expect(zaehlen).toContain("registration: { status: 'CONFIRMED' }");
  });

  it('zählt auch auf den Event-Kacheln Tickets', () => {
    /*
     * Dieselbe Verwechslung an der zweiten Stelle: die Monatsansicht und die
     * Liste holten ihre Zahlen ueber `calendarRegistration.groupBy`. Auf der
     * Kachel staende «3 / 20», waehrend acht Leute kommen.
     */
    const belegungen = QUERIES.slice(QUERIES.indexOf('async function belegungen'));
    const rumpf = belegungen.slice(0, belegungen.indexOf('\nfunction zuZeile'));
    expect(rumpf).toContain('calendarTicket.groupBy');
    expect(rumpf).not.toContain('calendarRegistration.groupBy');
  });

  it('gibt beim Stornieren eines Tickets den Platz unter der Sperre frei', () => {
    const storno = funktionen(TICKETS).get('storniereTicket')!;
    expect(storno).toContain('FOR UPDATE');
    expect(storno).toContain('ticketCount: verbleibend');
  });

  it('rückt nur Bestellungen nach, die ganz hineinpassen', () => {
    const nach = funktionen(REGISTRIERUNG).get('rueckeNach') ?? REGISTRIERUNG;
    expect(nach).toMatch(/ticketCount: \{ lte: frei \}/u);
  });
});

describe('Tickets: Berechtigungen', () => {
  it('kennt keine hartcodierte Rollenprüfung', () => {
    for (const [name, quelle] of [
      ['tickets.ts', TICKETS],
      ['Teilnehmerseite', TEILNEHMERSEITE],
      ['Teilnehmendenliste', TEILNEHMENDE],
    ] as const) {
      const code = ohneKommentare(quelle);
      expect(code, `${name} prueft eine Rolle direkt`).not.toMatch(
        /roles\.includes\(|roleId ===|=== 'ADMIN'|isAdmin\b/u,
      );
    }
    // Geprueft wird ueber benannte Berechtigungen.
    expect(TICKETS).toContain('CALENDAR_PERMISSIONS.guestsManage');
    expect(TICKETS).toContain('CALENDAR_PERMISSIONS.ordersManage');
    expect(TICKETS).toContain('CALENDAR_PERMISSIONS.checkIn');
  });

  it('meldet jede neue Berechtigung in der Registry an', () => {
    for (const schluessel of ['guestsView', 'guestsManage', 'ordersManage', 'checkIn']) {
      expect(CONFIG, `${schluessel} fehlt`).toContain(`${schluessel}:`);
    }
    for (const wert of [
      'calendar.guests.view',
      'calendar.guests.manage',
      'calendar.orders.manage',
      'calendar.checkin',
    ]) {
      expect(CONFIG, `${wert} fehlt als Schluessel`).toContain(`'${wert}'`);
    }
    /*
     * Und jeder taucht im Katalog wieder auf - mit Beschriftung und
     * Beschreibung. Ein Schluessel, den nur der Code kennt, laesst sich in
     * der Rechteverwaltung niemandem geben.
     */
    for (const schluessel of ['guestsView', 'guestsManage', 'ordersManage', 'checkIn']) {
      const eintrag = new RegExp(
        `key: CALENDAR_PERMISSIONS\\.${schluessel},\\s*\\n\\s*label: '[^']+',\\s*\\n\\s*description:`,
        'u',
      );
      expect(CONFIG, `${schluessel} hat keinen Eintrag im Katalog`).toMatch(eintrag);
    }
  });

  it('lässt den Besteller die eigenen Gäste ändern und sonst niemanden', () => {
    const pruefung = TICKETS.slice(TICKETS.indexOf('function verlangeTicketZugriff'));
    const rumpf = pruefung.slice(0, pruefung.indexOf('\n}\n'));
    expect(rumpf).toContain('ticket.registration.discordId === actor.discordId');
    expect(rumpf).toContain('actor.can(permission)');
    expect(rumpf).toContain("throw new AppError('FORBIDDEN'");
  });

  it('prüft die Berechtigung im Dienst und nicht in der Server Action', () => {
    /*
     * Die Ticket-Aktionen tragen `participate` und keinen Verwaltungs-
     * schluessel: ob jemand darf, haengt davon ab, **wessen** Ticket es ist,
     * und das weiss erst der Dienst. Die Entscheidung dorthin zu verlegen,
     * wo die Daten sind, ist der ganze Punkt.
     */
    const ticketAktionen = ACTIONS.slice(ACTIONS.indexOf('export const updateTicketAction'));
    expect(ticketAktionen).toContain('ticketActor(ctx)');
    expect(ACTIONS).toMatch(/const ticketActor = [\s\S]{0,200}can: \(permission/u);
    // Der Check-in dagegen ist reine Verwaltung und traegt seinen Schluessel.
    const checkin = ACTIONS.slice(ACTIONS.indexOf('export const checkInTicketAction'));
    expect(checkin).toContain('permission: P.checkIn');
  });

  it('lässt niemanden ohne Berechtigung einchecken', () => {
    const check = funktionen(TICKETS).get('checkeEin')!;
    const pruefung = check.indexOf('CALENDAR_PERMISSIONS.checkIn');
    const schreiben = check.indexOf('updateMany');
    expect(pruefung).toBeGreaterThan(-1);
    expect(schreiben).toBeGreaterThan(pruefung);
  });
});

describe('Check-in', () => {
  it('lässt nur definitive Tickets herein', () => {
    const check = funktionen(TICKETS).get('checkeEin')!;
    expect(check).toContain('ticketIstDefinitiv(ticket)');
    expect(check).toContain('Zahlung noch nicht bestätigt');
    // Kein zweiter Weg daran vorbei.
    expect(ohneKommentare(TICKETS)).not.toMatch(/trotzdem|erzwing|force|override/iu);
  });

  it('schreibt den Check-in bedingt auf «noch nicht eingecheckt»', () => {
    const check = funktionen(TICKETS).get('checkeEin')!;
    expect(check).toMatch(/updateMany\(\{\s*where: \{ id: ticketId, checkedInAt: null \}/u);
    expect(check).toContain('count !== 1');
    // Ein zweiter Scan ist eine Auskunft, kein Fehler.
    expect(check).toContain('geaendert: false');
  });

  it('nennt «definitiv» genau einmal', () => {
    // Drei Zustaende, eine Liste - sonst weicht die Kachel von der Liste ab.
    expect(TICKETS).toContain(
      "export const DEFINITIVE_ZAHLUNGSZUSTAENDE = ['NOT_REQUIRED', 'VERIFIED', 'WAIVED']",
    );
    for (const [name, quelle] of [
      ['zahlungen.ts', lies('packages/modules/src/calendar/zahlungen.ts')],
      ['registrations.ts', REGISTRIERUNG],
      ['queries.ts', QUERIES],
    ] as const) {
      const code = ohneKommentare(quelle);
      if (code.includes('DEFINITIV')) {
        expect(code, `${name} baut die Liste selbst`).not.toMatch(
          /\['NOT_REQUIRED',\s*'VERIFIED',\s*'WAIVED'\]/u,
        );
      }
    }
  });
});

describe('TWINT-QR: erst nach der Anmeldung', () => {
  it('liefert den Code nur an eine eigene Bestellung oder die Kasse', () => {
    const get = QR_ROUTE.slice(
      QR_ROUTE.indexOf('export async function GET'),
      QR_ROUTE.indexOf('export async function POST'),
    );
    expect(get).toContain('context?.isMember');
    expect(get).toContain('calendar.meineAnmeldung(event.id, context.user.discordId)');
    expect(get).toContain('!eigene && !can(context, calendar.CALENDAR_PERMISSIONS.paymentsView)');
    // 404 statt 403: ob hier ein Code haengt, geht niemanden etwas an, der
    // ihn nicht sehen darf.
    const stelle = get.indexOf('!eigene && !can(');
    expect(get.slice(stelle, stelle + 200)).toContain('status: 404');
  });

  it('zeigt vor der Anmeldung den Preis und keinen QR-Code', () => {
    const vorher = ANMELDUNG.slice(
      ANMELDUNG.indexOf('function PreisHinweis'),
      ANMELDUNG.indexOf('function ZahlungsKasten'),
    );
    expect(vorher).toContain('Eintritt:');
    expect(vorher).not.toContain('qrAdresse');
    expect(vorher).not.toContain('<img');
    // Und sagt, wann er kommt.
    expect(vorher).toContain('erscheinen direkt nach der');
  });

  it('zeigt den QR-Code erst, wenn eine Bestellung besteht', () => {
    const code = ohneKommentare(ANMELDUNG);
    // Der Kasten haengt an `meine` - es gibt keinen Zweig ohne Bestellung.
    expect(code).toMatch(/meine \?[\s\S]{0,600}<ZahlungsKasten/u);
    expect(code).toMatch(/eintritt && meine\.zahlung === 'PENDING'/u);
    const kasten = ANMELDUNG.slice(ANMELDUNG.indexOf('function ZahlungsKasten'));
    expect(kasten).toContain('qrAdresse');
    // Mit dem Betrag, der aus der Ticketzahl folgt.
    expect(kasten).toContain('gesamtbetrag');
  });

  it('behauptet nirgends eine Zahlung, die niemand geprüft hat', () => {
    const code = ohneKommentare(ANMELDUNG);
    for (const satz of [
      'Zahlung erfolgreich',
      'Ticket gekauft',
      'Teilnahme bestätigt',
      'Bezahlt!',
      'Erfolgreich bezahlt',
    ]) {
      expect(code, `«${satz}» steht in der Anmeldeansicht`).not.toContain(satz);
    }
  });
});

describe('Discord: kostenpflichtige Events gehen über SwissHub', () => {
  it('blendet die Anmeldeknöpfe bei Eintritt aus', () => {
    const knoepfe = funktionen(DISCORD).get('zeigtAnmeldeknoepfe')!;
    expect(knoepfe).toContain('kostenpflichtig(event)');
    expect(knoepfe).toMatch(/if \(kostenpflichtig\(event\)\) \{\s*return false;/u);
  });

  it('weist den Klick auch dann ab, wenn der Knopf noch da ist', () => {
    /*
     * Der zweite Riegel, und der eigentliche. Ein Knopf, der nicht angezeigt
     * wird, ist keine Zugriffskontrolle: eine Ankuendigung von letzter Woche
     * traegt ihn noch, und eine Knopfkennung ist eine Zeichenkette, die
     * jeder schicken kann.
     */
    expect(BOT).toContain('calendar.kostenpflichtig(event)');
    const stelle = BOT.indexOf('calendar.kostenpflichtig(event)');
    const melden = BOT.indexOf('await melde(interaction, event)');
    expect(melden).toBeGreaterThan(stelle);
    // Und der Riegel liest den Termin frisch, statt der Kennung zu glauben.
    expect(BOT.slice(0, stelle)).toMatch(/getEvent|findEvent|requireEvent/u);
  });

  it('nennt im Embed den Preis und den Weg zur Anmeldung', () => {
    expect(DISCORD).toContain("name: 'Eintritt'");
    expect(DISCORD).toContain('Die Anmeldung erfolgt über SwissHub.');
  });

  it('führt im Discord-Embed keine Registrierung für kostenpflichtige Events aus', () => {
    // Die einzige Stelle, die anmeldet, liegt hinter dem Riegel.
    const vorRiegel = BOT.slice(0, BOT.indexOf('calendar.kostenpflichtig(event)'));
    expect(ohneKommentare(vorRiegel)).not.toContain('calendar.register(');
  });
});

describe('Gastdaten bleiben intern', () => {
  it('zeigt die Gästeliste nur mit Berechtigung', () => {
    expect(TEILNEHMERSEITE).toMatch(/darfGaesteSehen\s*=/u);
    expect(TEILNEHMERSEITE).toContain('guestsView');
    // Serverseitig getrennt: ohne Berechtigung wird gar nicht erst geladen.
    expect(TEILNEHMERSEITE).toMatch(/darfGaesteSehen\s*\?\s*[\s\S]{0,120}ladeTeilnehmende/u);
  });

  it('gibt Gast-E-Mail und Adminvermerke nicht an die Mitgliederansicht', () => {
    const detail = ohneKommentare(DETAILSEITE);
    for (const feld of ['verifiedBy', 'paymentVerifiedByUsername', 'paymentReason', 'checkedInBy']) {
      expect(detail, `${feld} steht auf der Detailseite`).not.toContain(feld);
    }
    // Die eigene Bestellung zeigt die eigenen Gaeste - das ist etwas anderes.
    const meine = funktionen(TICKETS).get('meineBestellung')!;
    expect(meine).not.toContain('paymentVerifiedBy');
    expect(meine).not.toContain('paymentReason');
  });

  it('zeigt auf der Event-Kachel keine Namen', () => {
    const karte = KARTE.slice(KARTE.indexOf('export function EventKarte'));
    expect(karte).not.toContain('guest');
    expect(karte).not.toContain('teilnehmende');
  });
});

describe('Anzeige: Reservierung und Zusage sind zwei Zahlen', () => {
  it('nennt den Anmeldeknopf schlicht «Anmelden»', () => {
    expect(ANMELDUNG).toMatch(/\{belegung\.full \? 'Auf die Warteliste' : 'Anmelden'\}/u);
    // Nicht «Jetzt kaufen», nicht «Kostenpflichtig anmelden».
    const code = ohneKommentare(ANMELDUNG);
    for (const satz of ['Jetzt kaufen', 'Kostenpflichtig bestellen', 'Ticket kaufen']) {
      expect(code, `«${satz}» steht auf dem Knopf`).not.toContain(satz);
    }
  });

  it('zeigt den Eintrittspreis auf der Detailseite prominent', () => {
    expect(DETAILSEITE).toContain('label="Eintrittspreis"');
    expect(DETAILSEITE).toContain('calendar.betragText(event.entryFeeCents, event.entryFeeCurrency)');
  });

  it('zeigt den Eintrittspreis auf der Event-Kachel', () => {
    expect(KARTE).toContain('export function EintrittsBadge');
    const karte = KARTE.slice(KARTE.indexOf('export function EventKarte'));
    expect(karte).toContain('<EintrittsBadge zeile={zeile} />');
    // Und «CHF 0.-» gibt es nicht: kein Betrag heisst kein Eintritt.
    expect(KARTE).toContain('zeile.entryFeeCents <= 0');
  });

  it('trennt in der Verwaltung definitive Teilnehmer von reservierten Plätzen', () => {
    expect(TEILNEHMERSEITE).toContain('Definitive Teilnehmer');
    expect(TEILNEHMERSEITE).toContain('Reservierte Plätze');
    expect(TEILNEHMERSEITE).toContain('definitiveTickets');
    expect(TEILNEHMERSEITE).toContain('reservierteTickets');
  });

  it('nennt bei jedem Gast, zu wem er gehört', () => {
    expect(TEILNEHMENDE).toContain('Gehört zu');
    expect(TEILNEHMENDE).toContain('zeile.bestellerName');
  });

  it('unterscheidet in der Liste definitiv von vorläufig', () => {
    const marke = TEILNEHMENDE.slice(TEILNEHMENDE.indexOf('function StandMarke'));
    expect(marke).toContain("'Definitiv'");
    expect(marke).toContain("'Vorläufig'");
    expect(marke).toContain('Zahlung ausstehend');
  });
});

describe('Bestehende Anmeldungen laufen weiter', () => {
  it('legt ohne Ticketangabe ein Ticket auf die anmeldende Person', () => {
    const register = funktionen(REGISTRIERUNG).get('register')!;
    expect(register).toMatch(/optionen\.tickets && optionen\.tickets\.length > 0/u);
    expect(register).toContain('memberDiscordId: identity.discordId');
  });

  it('storniert bei der Abmeldung auch die Tickets', () => {
    for (const name of ['unregister', 'removeRegistration']) {
      const rumpf = funktionen(REGISTRIERUNG).get(name)!;
      expect(rumpf, `${name} laesst Tickets stehen`).toMatch(
        /calendarTicket\.updateMany\([\s\S]{0,300}status: 'CANCELLED'/u,
      );
    }
  });

  it('füllt die Migration bestehende Anmeldungen mit genau einem Ticket auf', () => {
    const migration = lies(
      'packages/database/prisma/migrations/20261012090000_kalender_tickets/migration.sql',
    );
    expect(migration).toContain('INSERT INTO "CalendarTicket"');
    expect(migration).toContain('FROM "CalendarRegistration"');
    // Additiv: keine Zeile geht verloren.
    expect(migration).not.toMatch(/\bDROP\b|\bTRUNCATE\b|\bDELETE\s+FROM\b/iu);
  });
});
