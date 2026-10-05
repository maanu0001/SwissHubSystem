import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Die Beteiligten-Suche: Quelle, Endpunkt, Verhalten.
 *
 * ## Warum dieser Test Quelltext liest
 *
 * Weil die Komponente eine Client-Komponente mit Zustand, Entprellung und
 * einer Server Action ist - ohne Browser laesst sie sich nicht bedienen, und
 * mit Browser prueft man eine Inszenierung statt einer Zusage. Was hier
 * geprueft wird, sind die Entscheidungen, die den Fehler verursacht haben und
 * die man beim naechsten Umbau versehentlich zuruecknehmen kann:
 *
 *   - Gesucht wird **serverseitig im Mitgliederspiegel**, nicht in einer
 *     Liste, die die Seite mitgebracht hat.
 *   - Der Endpunkt prueft `workspace.view` und hat eine Ratengrenze.
 *   - Die Trefferliste steht im Fluss und nicht in einem Popover.
 *   - Eine spaete Antwort ueberschreibt keine neuere.
 *
 * Das Verhalten gegen eine echte Datenbank steht in
 * `tests/integration/workspace-personensuche.test.ts`: dort findet die alte
 * Quelle null Treffer und die neue fuenf.
 */
const lies = (pfad: string): string => readFileSync(pfad, 'utf8');

/**
 * Der Picker liegt zentral.
 *
 * Er wird an zwei Stellen gebraucht - Workspace-Beteiligte und XP-Slot-
 * Geschenke -, und darum steht er unter `components/shared`. Was den
 * Workspace daran betrifft, ist eine Zeile: welche Suche gefragt wird.
 */
const suche = lies('apps/web/src/components/shared/personensuche.tsx');
const anschluss = lies('apps/web/src/modules/workspace/components/personensuche.tsx');
const daten = lies('apps/web/src/modules/workspace/daten.ts');
const aktionen = lies('apps/web/src/modules/workspace/actions.ts');
const traeger = lies('packages/modules/src/traeger.ts');
const dienst = lies('packages/modules/src/members/service.ts');

describe('Beteiligten-Suche: die Quelle', () => {
  it('sucht im Mitgliederspiegel und nicht nur unter den Angemeldeten', () => {
    // Die Ursache des leeren Suchfelds: `traegerDerBerechtigung` nimmt seine
    // Grundmenge aus `prisma.user`.
    expect(traeger).toContain('export async function traegerSuche(');
    expect(traeger).toContain('suchePersonenSpiegel(suche,');
    expect(daten).toContain('export async function sucheTeam(');
    expect(daten).toContain('traegerSuche(WORKSPACE_BETEILIGUNG, begriff');
  });

  it('prueft die Berechtigung an den Rollen des Spiegels', () => {
    // Dieselbe Rechnung wie die Seitenpruefung - nur ohne die Anmeldung als
    // stille Voraussetzung.
    expect(traeger).toContain('resolvePermissions(');
    expect(traeger).toContain('hasPermission(');
    expect(traeger).toContain('roleIds: person.roleIds');
  });

  it('teilt die Suchbedingung mit der Mitgliederliste', () => {
    // Keine zweite Meinung darueber, was ein Treffer ist: dieselbe
    // `bedingung()`, derselbe `searchText`, dieselbe Regel fuer Ausgetretene.
    expect(dienst).toContain('export async function suchePersonenSpiegel(');
    expect(dienst).toContain('await bedingung(query, { ohneBots: true })');
  });

  it('nimmt auch die Angemeldeten dazu, statt eine Quelle gegen die andere zu tauschen', () => {
    // Wer sich angemeldet hat, aber keine Spiegelzeile hat, soll nicht
    // verschwinden - und eine frisch eingerichtete Anwendung ohne Abgleich
    // auch nicht leer dastehen.
    expect(daten).toContain('traegerDerBerechtigung(workspace.WORKSPACE_PERMISSIONS.view)');
    expect(daten).toContain("traegerSuche(WORKSPACE_BETEILIGUNG, ''");
    expect(daten).toContain('if (!liste.has(person.discordId))');
  });
});

describe('Beteiligten-Suche: der Endpunkt', () => {
  it('prueft serverseitig und begrenzt die Rate', () => {
    expect(aktionen).toContain('export const workspaceTeamSuchenAction = defineAction(');
    expect(aktionen).toContain("name: 'workspace.team.search'");
    expect(aktionen).toContain('permission: workspace.WORKSPACE_PERMISSIONS.view');
    expect(aktionen).toContain("rateLimit: 'workspaceSuche'");
  });

  it('nimmt nur einen Suchbegriff und gibt nur Treffer zurueck', () => {
    expect(aktionen).toContain('begriff: z.string().trim().max(100)');
    expect(aktionen).toContain('treffer: await sucheTeam(input.begriff)');
  });
});

describe('Beteiligten-Suche: das Feld', () => {
  it('fragt die Server Action und nicht eine uebergebene Liste', () => {
    expect(anschluss).toContain('workspaceTeamSuchenAction({ csrfToken, begriff })');
    expect(suche).toContain('const antwort = await suchen(begriff);');
    // Die alte Form: ein Filter ueber `team`, das die Seite mitgebracht hat.
    expect(suche).not.toContain('team: readonly Teammitglied[]');
  });

  it('entprellt und raeumt seinen Zeitgeber wieder ab', () => {
    expect(suche).toContain('const ENTPRELLUNG_MS =');
    expect(suche).toContain('setTimeout(');
    expect(suche).toContain('clearTimeout(uhr);');
  });

  it('reagiert schon ab einem Zeichen', () => {
    expect(suche).toContain('const AB_ZEICHEN = 1;');
    expect(suche).toContain('begriff.length < AB_ZEICHEN');
  });

  it('verwirft eine veraltete Antwort', () => {
    // «man» nach «manuel»: ohne diesen Zaehler stehen die Treffer zum
    // kuerzeren Begriff unter dem laengeren.
    expect(suche).toContain('laufRef');
    expect(suche).toContain('if (laufRef.current !== lauf) {');
  });

  it('zeigt Ladezustand, Leermeldung und Fehler', () => {
    expect(suche).toContain('animate-spin');
    expect(suche).toContain('{leerText}');
    expect(suche).toContain('setFehler(');
  });

  it('haelt die Auswahl sichtbar, auch wenn der Begriff danach nicht passt', () => {
    expect(suche).toContain('if (wert && !liste.some((person) => person.discordId === wert.discordId))');
    expect(suche).toContain('return [wert, ...liste];');
  });

  it('stellt die Treffer in den Fluss und nicht in ein Popover', () => {
    /*
     * Ein Popover waere genau der Fehler, den §8 beschreibt: abgeschnitten
     * von `overflow: hidden` der Kachel, hinter dem naechsten Element, auf
     * dem Telefon ueber dem Feld. Die Liste steht deshalb als `<ul>` im
     * Fluss - sie schiebt die Kachel auf und ist immer vollstaendig da.
     */
    const liste = suche.slice(suche.indexOf('role="listbox"') - 400, suche.indexOf('role="listbox"'));
    expect(liste).not.toContain('absolute');
    expect(liste).not.toContain('fixed');
    expect(liste).not.toContain('z-');
    expect(suche).toContain('max-h-52 space-y-1 overflow-y-auto');
  });

  it('bleibt auf einem Telefon bedienbar', () => {
    // Volle Breite statt der Standardbreite eines Eingabefelds, und eine
    // Trefferzeile, die ein Finger trifft.
    expect(suche).toContain('w-full min-w-0 pl-9');
    expect(suche).toContain('min-h-11 w-full min-w-0');
  });

  it('setzt sich nach dem Hinzufuegen zurueck', () => {
    const projekt = lies('apps/web/src/modules/workspace/components/projekt-steuerung.tsx');
    const aufgabe = lies('apps/web/src/modules/workspace/components/aufgabe-beteiligte.tsx');
    for (const quelle of [projekt, aufgabe]) {
      expect(quelle).toContain('key={runde}');
      expect(quelle).toContain('setRunde((vorher) => vorher + 1);');
    }
  });

  it('behaelt den Namen einer eben hinzugefuegten Person', () => {
    // Sie kann in der Liste der Seite fehlen - der Spiegel ist groesser.
    const projekt = lies('apps/web/src/modules/workspace/components/projekt-steuerung.tsx');
    const aufgabe = lies('apps/web/src/modules/workspace/components/aufgabe-beteiligte.tsx');
    for (const quelle of [projekt, aufgabe]) {
      expect(quelle).toContain('setDazu((vorher) => ({ ...vorher, [person.discordId]: person }))');
      expect(quelle).toContain('for (const [discordId, person] of Object.entries(dazu))');
    }
  });
});
