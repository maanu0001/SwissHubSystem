import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { wrapped } from '@swisshub/modules';
import { hasPermission, resolvePermissions } from '@swisshub/permissions';

/**
 * Das Loeschen einer Wrapped-Ausgabe - die strukturellen Zusagen.
 *
 * ## Was hier geprueft wird und was nicht
 *
 * Die **Wirkung** steht in `tests/integration/wrapped-ausgabe.test.ts`: dass
 * die Folien mitgehen, dass eine eingefrorene Ausgabe loeschbar ist, dass ein
 * Moment stehen bleibt, der noch woanders steckt. Hier steht, was sich ohne
 * Datenbank zeigen laesst und beim Umbauen leicht verloren geht:
 *
 *  - dass Einfrieren und Loeschen zwei getrennte Berechtigungen sind,
 *  - dass ein gewoehnliches Mitglied keine davon hat,
 *  - dass nirgends eine feste Benutzer- oder Rollenkennung steht,
 *  - dass keine zweite Tabelle auf eine Ausgabe zeigt, ohne mitzugehen,
 *  - dass das Loeschen eine ausdrueckliche Bestaetigung braucht.
 */

const lies = (pfad: string): string => readFileSync(pfad, 'utf8');
const ohneKommentare = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');

const P = wrapped.WRAPPED_PERMISSIONS;
const KERN = 'packages/modules/src/wrapped/ausgabe.ts';
const AKTIONEN = 'apps/web/src/modules/wrapped/ausgabe-aktionen.ts';
const UEBERSICHT = 'apps/web/src/modules/wrapped/components/ausgaben-uebersicht.tsx';
const SCHEMA = 'packages/database/prisma/schema.prisma';

describe('Berechtigung', () => {
  it('trennt Einfrieren, Entsperren und Loeschen', () => {
    expect(P.editionFinalize).toBe('wrapped.edition.finalize');
    expect(P.editionUnlock).toBe('wrapped.edition.unlock');
    expect(P.editionDelete).toBe('wrapped.edition.delete');
    // Drei Schluessel, nicht einer: wer einfrieren darf, darf deshalb noch
    // nicht loeschen - das Erste ist umkehrbar, das Zweite nicht.
    expect(new Set([P.editionFinalize, P.editionUnlock, P.editionDelete]).size).toBe(3);
  });

  it('ist als Berechtigung registriert und damit einer Rolle zuweisbar', () => {
    const eintrag = wrapped.wrappedModule.permissions?.find((e) => e.key === P.editionDelete);
    expect(eintrag).toBeDefined();
    expect(eintrag?.label).toBeTruthy();
    // Ohne Registrierung stuende der Schluessel in keiner Rollenverwaltung -
    // niemand koennte ihn vergeben, und das Loeschen waere unerreichbar.
    expect(eintrag?.description).toBeTruthy();
  });

  it('gibt einem gewoehnlichen Mitglied kein Loeschen', () => {
    const mappings = [
      { discordRoleId: 'rolle-mitglied', permission: P.viewOwn },
      { discordRoleId: 'rolle-leitung', permission: P.editionDelete },
    ];
    const mitglied = resolvePermissions(
      { discordId: '910000000000000061', roleIds: ['rolle-mitglied'], isOwner: false },
      mappings,
    );
    expect(hasPermission(mitglied, P.viewOwn)).toBe(true);
    expect(hasPermission(mitglied, P.editionDelete)).toBe(false);

    const leitung = resolvePermissions(
      { discordId: '910000000000000062', roleIds: ['rolle-leitung'], isOwner: false },
      mappings,
    );
    expect(hasPermission(leitung, P.editionDelete)).toBe(true);
  });

  it('haengt die Action an genau diese Berechtigung', () => {
    const quelle = lies(AKTIONEN);
    const stelle = quelle.indexOf('export const ausgabeLoeschenAction');
    expect(stelle).toBeGreaterThan(-1);
    const block = quelle.slice(stelle, stelle + 600);
    expect(block).toContain('permission: wrapped.WRAPPED_PERMISSIONS.editionDelete');
    // Frische Rollen, nicht die zwischengespeicherten: eine entzogene Rolle
    // soll nicht noch fuenf Minuten loeschen duerfen.
    expect(block).toContain("freshness: 'critical'");
  });

  it('nennt keine festen Benutzer- oder Rollenkennungen', () => {
    for (const pfad of [KERN, AKTIONEN, UEBERSICHT]) {
      expect(ohneKommentare(lies(pfad))).not.toMatch(/\d{17,20}/u);
    }
  });
});

describe('Umfang des Schnitts', () => {
  it('laesst keine Zeile zurueck, die auf eine Ausgabe zeigt', () => {
    const schema = lies(SCHEMA);
    /*
     * Jede Beziehung auf `WrappedEdition` muss `onDelete: Cascade` tragen.
     *
     * Das ist die Zusage «keine Waisen», und zwar nicht fuer die Tabellen von
     * heute, sondern fuer die von morgen: wer eine zweite Tabelle an eine
     * Ausgabe haengt und das Loeschen nicht bedenkt, faellt hier auf statt
     * erst dann, wenn jemand die verwaisten Zeilen findet.
     */
    const bezuege = [...schema.matchAll(/WrappedEdition\s+@relation\(([^)]*)\)/gu)];
    expect(bezuege.length).toBeGreaterThan(0);
    for (const bezug of bezuege) {
      expect(bezug[1]).toContain('onDelete: Cascade');
    }
  });

  it('laesst geteilte Anhaenge ausdruecklich stehen', () => {
    const schema = lies(SCHEMA);
    const folie = schema.slice(schema.indexOf('model WrappedSlide {'));
    const block = folie.slice(0, folie.indexOf('\n}'));
    /*
     * Ein Moment gehoert der Momentverwaltung und kann in mehreren Ausgaben
     * vorkommen. `SetNull` statt `Cascade` ist genau der Unterschied zwischen
     * «diesen Rueckblick wegwerfen» und «dieses Bild ueberall wegwerfen».
     */
    expect(block).toMatch(/momentId.*\n.*WrappedMoment\?\s+@relation\([^)]*onDelete: SetNull/u);
  });

  it('loescht die Ausgabe und schreibt danach die Pruefspur', () => {
    const quelle = ohneKommentare(lies(KERN));
    const stelle = quelle.indexOf('export async function loescheAusgabe');
    const block = quelle.slice(stelle, quelle.indexOf('export async function entsperreAusgabe'));
    expect(block).toContain('prisma.wrappedEdition.delete');
    expect(block).toContain('WRAPPED_EDITION_DELETED');
    // Zeitraum, Art, Zustand und Folienzahl - vorher gelesen, weil es die
    // Zeile danach nicht mehr gibt.
    for (const feld of ['periodKey', 'art:', 'status:', 'folien:']) {
      expect(block).toContain(feld);
    }
    // Kein Zustandsriegel: eine eingefrorene Ausgabe ist ebenfalls loeschbar.
    expect(block).not.toMatch(/status\s*!==\s*'DRAFT'/u);
  });
});

describe('Bedienung', () => {
  it('fragt vor dem Loeschen nach - mit getippter Bestaetigung', () => {
    const quelle = lies(UEBERSICHT);
    expect(quelle).toContain('ConfirmationDialog');
    expect(quelle).toContain('destructive');
    // Kein Loeschen mit einem Klick: der Zeitraum muss getippt werden.
    expect(quelle).toContain('confirmDisabled={bestaetigung.trim() !== ausgabe.periodKey}');
  });

  it('sagt im Dialog, was mitgeht und was bleibt', () => {
    const quelle = lies(UEBERSICHT);
    expect(quelle).toContain('Folien');
    expect(quelle).toContain('Exportdaten');
    expect(quelle).toContain('Community Moments bleiben');
  });

  it('haelt Einfrieren und Loeschen als zwei Handlungen auseinander', () => {
    const quelle = lies(AKTIONEN);
    expect(quelle).toContain('ausgabeFinalisierenAction');
    expect(quelle).toContain('ausgabeLoeschenAction');
    // Zwei Actions mit zwei Namen - kein Schalter, der beides tut.
    expect(quelle).toContain("name: 'wrapped.ausgabe.loeschen'");
  });
});
