import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Nachkauf, Profil-Links und die entfernte Kachel - an der Quelle geprüft.
 *
 * ## Warum am Quelltext
 *
 * Weil die Zusagen hier Struktur sind. «Die Kachel ‹Angemeldet› ist weg»
 * lässt sich an einer gerenderten Seite nur für den einen Fall zeigen, den man
 * gerade aufgesetzt hat; am Quelltext ist die Aussage allgemein. Und
 * «purchaserUserId ist nicht manipulierbar» ist eine Aussage über das
 * Eingabeschema, nicht über eine Anfrage.
 */

const lies = (pfad: string): string => readFileSync(join(process.cwd(), pfad), 'utf8');

const ohneKommentare = (quelle: string): string =>
  quelle.replaceAll(/\/\*[\s\S]*?\*\//gu, '').replaceAll(/\/\/.*$/gmu, '');

function funktionen(quelle: string): Map<string, string> {
  const treffer = [...quelle.matchAll(/(?:export )?(?:async )?function (\w+)/gu)];
  const ergebnis = new Map<string, string>();
  for (const [index, stelle] of treffer.entries()) {
    const ab = stelle.index!;
    const bis = treffer[index + 1]?.index ?? quelle.length;
    ergebnis.set(stelle[1]!, quelle.slice(ab, bis));
  }
  return ergebnis;
}

const REGISTRIERUNG = lies('packages/modules/src/calendar/registrations.ts');
const TICKETS = lies('packages/modules/src/calendar/tickets.ts');
const ZAHLUNGEN = lies('packages/modules/src/calendar/zahlungen.ts');
const SCHEMAS = lies('packages/modules/src/calendar/schemas.ts');
const ACTIONS = lies('apps/web/src/modules/calendar/actions.ts');
const ANMELDUNG = lies('apps/web/src/modules/calendar/components/anmelde-bereich.tsx');
const UEBERSICHT = lies('apps/web/src/modules/calendar/components/zahlungs-uebersicht.tsx');
const TEILNEHMENDE = lies('apps/web/src/modules/calendar/components/teilnehmende-liste.tsx');
const TEILNEHMERSEITE = lies('apps/web/src/app/(app)/kalender/[slug]/teilnehmer/page.tsx');
const PROFIL = lies('packages/modules/src/profile/oeffentlich.ts');
const SCHEMA = lies('packages/database/prisma/schema.prisma');

describe('Nachkauf: eine Bestellung, die wächst', () => {
  it('legt keine zweite Bestellung an', () => {
    const rumpf = funktionen(REGISTRIERUNG).get('ergaenzeTickets')!;
    // Gesucht wird die bestehende, nicht eine neue erzeugt.
    expect(rumpf).toContain('calendarRegistration.findUnique');
    expect(rumpf).not.toContain('calendarRegistration.create');
    // Und die Datenbank liesse eine zweite gar nicht zu.
    expect(SCHEMA).toMatch(/@@unique\(\[eventId, discordId\]\)/u);
  });

  it('nimmt die Bestellung aus der Sitzung und nicht aus der Anfrage', () => {
    /*
     * Die Mass-Assignment-Luecke, die es hier nicht gibt: das Eingabeschema
     * kennt keine Bestellnummer. Welche Bestellung waechst, ergibt sich aus
     * `(eventId, discordId)` - und die Kennung setzt die Server Action aus
     * `ctx.user`.
     */
    const schema = SCHEMAS.slice(
      SCHEMAS.indexOf('export const ticketsErgaenzenSchema'),
      SCHEMAS.indexOf('export const ticketIdSchema'),
    );
    expect(schema).not.toContain('registrationId');
    expect(schema).not.toContain('purchaserUserId');
    expect(schema).not.toContain('memberDiscordId');

    const aktion = ACTIONS.slice(
      ACTIONS.indexOf('export const addTicketsAction'),
      ACTIONS.indexOf('export const unregisterAction'),
    );
    expect(aktion).toContain('discordId: ctx.user.discordId');
    expect(aktion).toContain('memberDiscordId: ctx.user.discordId');
    expect(aktion).not.toContain('input.registrationId');
    expect(aktion).not.toContain('input.memberDiscordId');
  });

  it('prüft die Kapazität unter der Zeilensperre, und nur für die neuen Plätze', () => {
    const rumpf = funktionen(REGISTRIERUNG).get('ergaenzeTickets')!;
    const sperre = rumpf.indexOf('FOR UPDATE');
    const zaehlen = rumpf.indexOf('belegteTickets(eventId, tx)');
    expect(sperre).toBeGreaterThan(-1);
    expect(zaehlen).toBeGreaterThan(sperre);
    // Nur die neuen gegenrechnen - die bestehenden stecken schon in `belegt`.
    expect(rumpf).toContain('belegt + neueZeilen.length > frisch.capacity');
  });

  it('rechnet den Zusatzbetrag serverseitig aus dem Termin', () => {
    const rumpf = funktionen(REGISTRIERUNG).get('ergaenzeTickets')!;
    // Aus `frisch` - dem Termin unter der Sperre -, nicht aus der Anfrage.
    expect(rumpf).toContain('zahlungFuerNeueTickets(frisch, now)');
    expect(rumpf).toContain('ticketZahlung.priceCents * neueZeilen.length');
    expect(ohneKommentare(SCHEMAS)).not.toMatch(/zusatzbetrag|paymentAmountCents/u);
  });

  it('lässt eine wartende Bestellung nicht wachsen', () => {
    const rumpf = funktionen(REGISTRIERUNG).get('ergaenzeTickets')!;
    expect(rumpf).toMatch(/status === 'WAITLIST'[\s\S]{0,200}throw conflict/u);
  });

  it('prüft die Anmeldefrist wie eine Neuanmeldung', () => {
    const rumpf = funktionen(REGISTRIERUNG).get('ergaenzeTickets')!;
    expect(rumpf).toContain('anmeldungGesperrt(event, now)');
  });

  it('begrenzt die Gesamtzahl je Bestellung und nicht nur die Anfrage', () => {
    const rumpf = funktionen(REGISTRIERUNG).get('ergaenzeTickets')!;
    expect(rumpf).toContain('bisher + neueZeilen.length > MAX_TICKETS_JE_BESTELLUNG');
  });
});

describe('Nachkauf: Zahlung bleibt manuell', () => {
  it('legt neue Tickets bei einem kostenpflichtigen Termin offen an', () => {
    const rumpf = funktionen(TICKETS).get('zahlungFuerNeueTickets')!;
    // Kostenpflichtig → `settledStatus: null`. Kein Automatismus.
    expect(rumpf).toMatch(/settledStatus: null/u);
    expect(rumpf).toMatch(/settledStatus: 'NOT_REQUIRED'/u);
  });

  it('erledigt beim Bestätigen nur die offenen Tickets', () => {
    /*
     * Sonst bekaeme ein bereits bezahltes Ticket einen neuen Zeitpunkt - oder,
     * bei einem spaeteren Erlass, den Status «erlassen». Die Kasse faende
     * einen Betrag nicht wieder, den sie erhalten hat.
     */
    const rumpf = funktionen(TICKETS).get('erledigeTickets')!;
    expect(rumpf).toContain('settledStatus: null');
    expect(rumpf).toContain("status: 'ACTIVE'");
  });

  it('öffnet beim Zurücknehmen alle Tickets der Bestellung', () => {
    const rumpf = funktionen(TICKETS).get('oeffneTickets')!;
    // Ohne `settledStatus`-Filter im `where`: eine Ruecknahme gilt fuer alle,
    // auch fuer die bereits erledigten. Genau das unterscheidet sie von
    // `erledigeTickets`.
    const wo = rumpf.slice(rumpf.indexOf('where:'), rumpf.indexOf('data:'));
    expect(wo).toContain("status: 'ACTIVE'");
    expect(wo).not.toContain('settledStatus');
    expect(rumpf).toContain('settledStatus: null, settledAt: null');
  });

  it('schreibt Bestellung und Tickets in derselben Transaktion', () => {
    /*
     * Sonst gaebe es einen Moment, in dem die Bestellung bestaetigt ist und
     * niemand definitiv - und wenn dazwischen etwas scheitert, bliebe er.
     */
    for (const name of ['bestaetigeZahlung', 'erlasseZahlung', 'nimmBestaetigungZurueck']) {
      const rumpf = funktionen(ZAHLUNGEN).get(name)!;
      expect(rumpf, `${name} ohne Transaktion`).toContain('prisma.$transaction');
      expect(rumpf, `${name} fasst die Tickets nicht an`).toMatch(/erledigeTickets\(tx|oeffneTickets\(tx/u);
    }
  });

  it('kennt genau einen Weg, ein Ticket auf VERIFIED zu setzen', () => {
    const schreiben = [...funktionen(TICKETS).entries()].filter(
      ([, rumpf]) => rumpf.includes('updateMany(') && rumpf.includes('settledStatus: status'),
    );
    expect(schreiben.map(([name]) => name)).toEqual(['erledigeTickets']);
    // Und die Berechtigung dafuer liegt in `zahlungen.ts`.
    const verify = funktionen(ZAHLUNGEN).get('bestaetigeZahlung')!;
    expect(verify.indexOf('paymentsVerify')).toBeLessThan(verify.indexOf('erledigeTickets'));
  });

  it('leitet definitiv vom Ticket ab und nicht vom Status der Bestellung', () => {
    const rumpf = funktionen(TICKETS).get('ticketIstDefinitiv')!;
    expect(rumpf).toContain('ticket.settledStatus !== null');
    expect(rumpf).not.toContain('paymentStatus');
    // Eine Bestellung ohne Platz hat trotzdem keine definitiven Teilnehmer.
    expect(rumpf).toContain("ticket.registration.status === 'CONFIRMED'");
  });

  it('rechnet offen und eingegangen aus den Ticketpreisen', () => {
    /*
     * `paymentAmountCents` ist der Gesamtbetrag. Nach einem Nachkauf auf eine
     * bezahlte Bestellung waere «offen = Gesamtbetrag» falsch - offen ist nur
     * der Nachkauf.
     */
    const rumpf = funktionen(ZAHLUNGEN).get('zahlungsKennzahlen')!;
    expect(rumpf).toMatch(/settledStatus: 'VERIFIED'[\s\S]{0,200}_sum: \{ priceCents: true \}/u);
    expect(rumpf).toMatch(/settledStatus: null[\s\S]{0,200}_sum: \{ priceCents: true \}/u);
    // Ein Erlass zaehlt nicht als eingegangen - dieselbe Regel wie vorher.
    expect(rumpf).not.toMatch(/settledStatus: 'WAIVED'[\s\S]{0,200}eingegangen/u);
  });

  it('behauptet in der Anmeldeansicht keine Zahlung für neue Tickets', () => {
    const code = ohneKommentare(ANMELDUNG);
    for (const satz of ['Zahlung erfolgreich', 'Ticket gekauft', 'Alles bezahlt', 'Teilnahme bestätigt']) {
      expect(code, `«${satz}» steht in der Anmeldeansicht`).not.toContain(satz);
    }
    // Und was stattdessen dort steht.
    expect(ANMELDUNG).toContain('noch nicht definitiv');
    expect(ANMELDUNG).toContain('behalten ihren Stand');
  });

  it('zeigt dem Besteller den offenen Betrag und nicht den Gesamtbetrag', () => {
    const code = ohneKommentare(ANMELDUNG);
    expect(code).toMatch(/eintritt && meine\.offenRappen > 0/u);
    expect(code).toContain('offenerBetrag={meine.offenerBetrag}');
    // Und sagt «noch zu bezahlen», wenn ein Teil schon erledigt ist.
    expect(ANMELDUNG).toContain("teilweise ? 'Noch zu bezahlen' : 'Zu bezahlen'");
  });

  it('markiert offene Tickets in der eigenen Liste einzeln', () => {
    expect(ANMELDUNG).toContain('!ticket.erledigt');
  });
});

describe('Nachkauf: die Aktion in der Oberfläche', () => {
  it('bietet bei bestehender Anmeldung «Tickets hinzufügen»', () => {
    expect(ANMELDUNG).toContain('Tickets hinzufügen');
    // Sichtbar nur bei einer bestaetigten eigenen Anmeldung.
    expect(ANMELDUNG).toMatch(/!abmeldenGrund && darfTeilnehmen && meine\.status === 'CONFIRMED'/u);
  });

  it('verwendet dasselbe Ticketformular wie die Anmeldung', () => {
    // Kein zweites Gästeformular: `TicketWaehler` wird beide Male benutzt.
    const treffer = [...ANMELDUNG.matchAll(/<TicketWaehler/gu)];
    expect(treffer).toHaveLength(2);
  });

  it('zeigt vor dem Bestätigen den Zusatzbetrag', () => {
    expect(ANMELDUNG).toContain('Kommt dazu');
    expect(ANMELDUNG).toContain('nachkaufBetrag');
  });

  it('sperrt den Knopf, wenn kein Platz mehr frei ist', () => {
    expect(ANMELDUNG).toContain('Keine Plätze mehr frei');
    expect(ANMELDUNG).toContain('freiePlaetze === 0');
  });

  it('trägt die Aktion die Teilnahmeberechtigung und keine Verwaltungsrechte', () => {
    const aktion = ACTIONS.slice(
      ACTIONS.indexOf('export const addTicketsAction'),
      ACTIONS.indexOf('export const unregisterAction'),
    );
    expect(aktion).toContain('permission: P.participate');
    expect(aktion).toContain("freshness: 'critical'");
    expect(aktion).toContain("rateLimit: 'calendarParticipate'");
  });
});

describe('Bestellungen: die Kachel «Angemeldet» ist weg', () => {
  it('zeigt sie nicht mehr', () => {
    expect(UEBERSICHT).not.toContain('label="Angemeldet"');
    // Und das Feld ist auch aus den Props verschwunden.
    const props = UEBERSICHT.slice(
      UEBERSICHT.indexOf('export interface ZahlungsKennzahlenAnsicht'),
      UEBERSICHT.indexOf('type Filter'),
    );
    expect(props).not.toMatch(/^\s*angemeldet: number;/mu);
    // Die Seite gibt sie auch nicht mehr mit.
    expect(TEILNEHMERSEITE).not.toContain('angemeldet: kennzahlen.angemeldet');
  });

  it('ersetzt sie nicht durch eine andere Teilnehmerzahl in derselben Reihe', () => {
    /*
     * Der Satz aus dem Auftrag: nicht durch eine ähnlich unklare Zahl
     * ersetzen. Die Reihe «Bestellungen» enthält nur noch Zahlungszustände -
     * jeder davon eindeutig.
     */
    // Ohne Kommentare: der Kommentar an dieser Stelle erklaert, warum die
    // Kachel weg ist, und nennt dabei die Woerter, nach denen hier gesucht wird.
    const reihe = ohneKommentare(
      UEBERSICHT.slice(UEBERSICHT.indexOf('>Bestellungen<'), UEBERSICHT.indexOf('>Tickets<')),
    );
    expect(reihe).toContain('label="Zahlung ausstehend"');
    expect(reihe).toContain('label="Bestätigt"');
    expect(reihe).toContain('label="Erlassen"');
    expect(reihe).toContain('label="Storniert"');
    for (const wort of ['Teilnehmer', 'Personen', 'Angemeldet', 'Gäste']) {
      expect(reihe, `«${wort}» steht wieder in der Bestellreihe`).not.toContain(wort);
    }
  });

  it('lässt die Teilnehmerzahlen in der Ticketreihe stehen', () => {
    const reihe = UEBERSICHT.slice(UEBERSICHT.indexOf('>Tickets<'));
    expect(reihe).toContain('label="Reservierte Plätze"');
    expect(reihe).toContain('label="Definitive Teilnehmer"');
  });
});

describe('Profil-Links', () => {
  it('entscheidet über Sichtbarkeit im Profilmodul und nicht im Kalender', () => {
    // Dieselben vier Bedingungen wie bei `slugVon` - an einer Stelle.
    const rumpf = PROFIL.slice(PROFIL.indexOf('export async function slugsVon'));
    const bis = rumpf.indexOf('\n}\n');
    const text = rumpf.slice(0, bis);
    expect(text).toContain('publicSlug: { not: null }');
    expect(text).toContain("visibilityProfile: 'PUBLIC'");
    expect(text).toContain('publicLockedAt: null');

    // Der Kalender fragt dort nach und legt keine eigene Abfrage an.
    expect(TICKETS).toContain("await import('../profile/oeffentlich')");
    expect(ohneKommentare(TICKETS)).not.toContain('memberProfile.findMany');
  });

  it('gibt einem Gast nie einen Slug', () => {
    const rumpf = TICKETS.slice(TICKETS.indexOf('function zuTeilnehmerZeile'));
    expect(rumpf).toContain(
      'profilSlug: ticket.memberDiscordId ? (slugs.get(ticket.memberDiscordId) ?? null) : null',
    );
  });

  it('verwendet die bestehende öffentliche Adresse', () => {
    expect(TEILNEHMENDE).toContain('systemRoutes.oeffentlichesProfil(slug)');
    // Keine neue Route, kein eigener Aufbau - und die Adresse steht an genau
    // einer Stelle im Projekt.
    expect(TEILNEHMENDE).not.toMatch(/`\/u\/\$\{/u);
    expect(TEILNEHMENDE).not.toContain('/profil/');
    expect(TEILNEHMENDE).not.toContain('/api/profil');
  });

  it('hängt den Link am Namen und nicht an einem eigenen Knopf', () => {
    const code = ohneKommentare(TEILNEHMENDE);
    expect(code).toMatch(/<Link[\s\S]{0,300}underline/u);
    expect(code).not.toContain('Profil ansehen');
  });

  it('holt die Slugs einer Liste in einer Abfrage', () => {
    const rumpf = funktionen(TICKETS).get('profilSlugs')!;
    expect(rumpf).toContain('slugsVon(ids)');
    // Keine Abfrage je Zeile - eine Sammlung, ein Aufruf.
    expect(rumpf).not.toContain('for (const');
    expect(rumpf).toContain('tickets.flatMap');
  });
});

describe('Die Teilnehmerliste der Eventseite', () => {
  const EVENTSEITE = lies('apps/web/src/app/(app)/kalender/[slug]/page.tsx');
  const OEFFENTLICH = lies('apps/web/src/modules/calendar/components/teilnehmende-oeffentlich.tsx');

  it('lädt für die Eventseite die engere Auswahl', () => {
    /*
     * Zwei Listen, zwei Abfragen. Die Eventseite ist bei
     * `participantsPublic` fuer jedes Mitglied sichtbar; die Einlasssicht
     * unter «Teilnehmer» steht hinter `calendar.guests.view`.
     *
     * Was die Eventseite nicht laedt, kann sie auch nicht zeigen - die
     * Trennung liegt in der Abfrage und nicht in der Darstellung.
     */
    expect(EVENTSEITE).toContain('calendar.ladeOeffentlicheTeilnehmer(event.id)');
    expect(EVENTSEITE).not.toContain('ladeTeilnehmerGruppen');
    expect(EVENTSEITE).not.toContain('ladeTeilnehmende');
  });

  it('wählt im Modulkern nur die vier Ticketfelder aus, die jeder sehen darf', () => {
    const rumpf = funktionen(TICKETS).get('ladeOeffentlicheTeilnehmer')!;
    const auswahl = rumpf.slice(rumpf.indexOf('tickets: {'), rumpf.indexOf('});'));
    for (const feld of ['memberDiscordId', 'memberUsername', 'guestFirstName', 'guestLastName']) {
      expect(auswahl, `${feld} fehlt`).toContain(feld);
    }
    for (const geheim of [
      'guestEmail',
      'guestDiscordName',
      'note',
      'settledStatus',
      'priceCents',
      'checkedInAt',
      'token',
    ]) {
      expect(auswahl, `${geheim} steht in der oeffentlichen Auswahl`).not.toContain(geheim);
    }
    // Und nur, was tatsaechlich kommt.
    expect(auswahl).toContain("status: 'ACTIVE'");
  });

  it('gibt die Discord-Kennung nicht an die Eventseite weiter', () => {
    // Sie wird gebraucht, um den Slug nachzuschlagen - und bleibt im Server.
    const rumpf = funktionen(TICKETS).get('ladeOeffentlicheTeilnehmer')!;
    const ergebnis = rumpf.slice(rumpf.lastIndexOf('return zeilen.map('));
    expect(ergebnis).not.toMatch(/^\s*discordId:/mu);
    expect(ergebnis).toContain('bestellerSlug');
  });

  it('lädt die Antworten auf Zusatzfragen nur für die Organisation', () => {
    /*
     * Antworten gehen niemanden ausser der Organisation etwas an. Sie werden
     * nicht ausgeblendet, sondern gar nicht erst geholt.
     */
    expect(EVENTSEITE).toMatch(/darfAntwortenSehen[\s\S]{0,200}listRegistrations/u);
    expect(EVENTSEITE).toMatch(/darfAntwortenSehen\s*=\s*can\(context, P\.manageRegistrations\)/u);
  });

  it('verlinkt den Mitgliedsnamen und den Gast nicht', () => {
    const code = ohneKommentare(OEFFENTLICH);
    expect(code).toContain('systemRoutes.oeffentlichesProfil(slug)');
    // Ohne Slug bleibt der Name Text.
    expect(code).toMatch(/if \(!slug\)[\s\S]{0,140}<span/u);
    // Die Gaeste sind Text in einem Satzteil - es gibt fuer sie keinen Link.
    expect(code).toContain('gaesteText(');
    const gaeste = OEFFENTLICH.slice(OEFFENTLICH.indexOf('function gaesteText'));
    expect(gaeste.slice(0, gaeste.indexOf('\n}\n'))).not.toContain('Link');
  });

  it('nennt die Gäste bei der Person, die sie anmeldet', () => {
    const code = ohneKommentare(OEFFENTLICH);
    // Ein Eintrag je Anmeldung, und die Gaeste stehen darin.
    expect(code).toMatch(/gruppen\.map\(\(gruppe\)[\s\S]{0,900}mitgebracht/u);
    expect(OEFFENTLICH).toContain('mit ${namen}');
    // Und wer selbst nicht kommt, meldet sie nur an.
    expect(OEFFENTLICH).toContain('meldet ${namen} an');
  });

  it('zeigt Personen und Anmeldungen als zwei Zahlen', () => {
    // «12 Anmeldungen» sagt nichts darueber, wie voll es wird.
    const code = ohneKommentare(OEFFENTLICH);
    expect(code).toContain('gruppe.anzahl');
    expect(code).toMatch(/personen === 1 \? 'Person' : 'Personen'/u);
    expect(code).toMatch(/gruppen\.length === 1 \? 'Anmeldung' : 'Anmeldungen'/u);
  });

  it('zeigt auf der Eventseite keine Zahlungs- oder Einlassangaben', () => {
    const code = ohneKommentare(OEFFENTLICH);
    for (const feld of [
      'guestEmail',
      'settledStatus',
      'definitiv',
      'checkedIn',
      'zahlung',
      'betrag',
      'Einchecken',
    ]) {
      expect(code, `${feld} steht in der oeffentlichen Liste`).not.toContain(feld);
    }
  });
});

describe('Bestehende Daten laufen weiter', () => {
  it('erweitert das Ticket rein additiv', () => {
    const migration = lies(
      'packages/database/prisma/migrations/20261013090000_kalender_nachkauf/migration.sql',
    );
    expect(migration).toContain('ADD COLUMN "priceCents"');
    expect(migration).toContain('ADD COLUMN "settledStatus"');
    expect(migration).toContain('ADD COLUMN "settledAt"');
    // Kein DROP, kein TRUNCATE, kein DELETE - auch nicht in einem Kommentar
    // versteckt, das hier ist reines SQL.
    const sql = migration.replaceAll(/^--.*$/gmu, '');
    expect(sql).not.toMatch(/\bDROP\b|\bTRUNCATE\b|\bDELETE\s+FROM\b/iu);
  });

  it('füllt bestehende Tickets aus dem Zustand ihrer Bestellung auf', () => {
    const migration = lies(
      'packages/database/prisma/migrations/20261013090000_kalender_nachkauf/migration.sql',
    );
    // Der Preis je Ticket aus dem Gesamtbetrag.
    expect(migration).toContain('r."paymentAmountCents" / GREATEST(r."ticketCount", 1)');
    // Und der Zahlungsstand - nur was wirklich erledigt war.
    expect(migration).toContain("IN ('NOT_REQUIRED', 'VERIFIED', 'WAIVED')");
    // `PENDING` und `REFUNDED` bleiben offen.
    expect(migration).not.toMatch(/settledStatus[\s\S]{0,80}'PENDING'/u);
  });

  it('lässt eine Einzelanmeldung ohne Nachkauf unverändert funktionieren', () => {
    const register = funktionen(REGISTRIERUNG).get('register')!;
    // Der alte Weg: ohne Angabe ein Ticket auf die anmeldende Person.
    expect(register).toMatch(/optionen\.tickets && optionen\.tickets\.length > 0/u);
    // Und mit Preis und Stand aus dem Termin unter der Sperre.
    expect(register).toContain('zahlungFuerNeueTickets(frisch, now)');
  });
});
