import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Das Ticket-Dashboard zeigt drei Zahlen.
 *
 * Es waren sechs: dazu «In Bearbeitung», «Nicht zugewiesen» und «Überfällig».
 * Sie beantworteten keine Frage, die man vor dem Blick in die Liste hat, und
 * drängten das Einzige, was zählt - was gerade auf das Team wartet - nach
 * unten.
 *
 * Entfernt ist die Anzeige, nicht die Fachlichkeit: `getOverview` rechnet die
 * übrigen Zahlen weiter, und das Ticket-Modul behält jede seiner Seiten.
 */
const WURZEL = process.cwd();
const lies = (pfad: string): string => readFileSync(join(WURZEL, pfad), 'utf8');

const dashboard = lies('apps/web/src/app/(app)/tickets/page.tsx');

describe('Ticket-Dashboard: die Kacheln', () => {
  it('zeigt genau die drei gewünschten', () => {
    const labels = [...dashboard.matchAll(/label: '([^']+)'/gu)].map((treffer) => treffer[1]);
    expect(labels).toEqual(['Offen', 'Wartet auf Support', 'Wartet auf Mitglied']);
  });

  it('zeigt die drei entfernten nicht mehr', () => {
    for (const weg of ['In Bearbeitung', 'Nicht zugewiesen', 'Überfällig']) {
      expect(dashboard).not.toContain(`label: '${weg}'`);
    }
  });

  it('behält die bestehende Darstellung der Kacheln', () => {
    // Dieselbe Card, dasselbe Icon-Feld, dieselbe Warnfarbe - nur weniger
    // davon.
    expect(dashboard).toContain('<Card key={karte.label}>');
    expect(dashboard).toContain('karte.warnung');
    expect(dashboard).toContain("'bg-warning/15 text-warning'");
    expect(dashboard).toContain('text-2xl font-semibold tabular-nums');
  });

  it('lässt keine leere Rasterspalte zurück', () => {
    /*
     * Das Raster war auf sechs Kacheln ausgelegt (2 bzw. 3 Spalten). Mit drei
     * Kacheln hätte `xl:grid-cols-3` über `sm:grid-cols-2` eine Zeile mit
     * zwei und eine mit einer ergeben - eine halbe leere Zeile.
     */
    expect(dashboard).toContain('grid gap-3 sm:grid-cols-3');
    expect(dashboard).not.toContain('sm:grid-cols-2 xl:grid-cols-3');
  });

  it('bleibt auf dem Telefon einspaltig', () => {
    // Keine feste Spaltenzahl unterhalb von `sm` - sonst quetschen sich drei
    // Kacheln auf 320 px nebeneinander.
    expect(dashboard).not.toMatch(/className="grid gap-3 grid-cols-[23]/u);
  });
});

describe('Ticket-Dashboard: die Funktionen bleiben', () => {
  it('zeigt weiterhin die Ticketliste', () => {
    expect(dashboard).toContain('<TicketList');
    expect(dashboard).toContain('Neueste Tickets');
    expect(dashboard).toContain('/tickets/offen');
  });

  it('zeigt weiterhin die Abschnittsnavigation', () => {
    expect(dashboard).toContain('<TicketSectionNav');
  });

  it('behält die Ansicht für gewöhnliche Mitglieder', () => {
    expect(dashboard).toContain('Du hast aktuell keine Tickets');
  });

  it('lässt keine Unterseite des Moduls verschwinden', () => {
    // Detail, Archiv, Kategorien, Statistiken, Vorlagen, Sperren,
    // Schlagwörter, «meine», «neu», «offen» - alles bleibt.
    const seiten = readdirSync(join(WURZEL, 'apps/web/src/app/(app)/tickets')).sort();
    expect(seiten).toEqual([
      '[ticketId]',
      'archiv',
      'kategorien',
      'meine',
      'neu',
      'offen',
      'page.tsx',
      'panels',
      'schlagwoerter',
      'sperren',
      'statistiken',
      'vorlagen',
    ]);
  });

  it('rechnet die entfernten Zahlen weiterhin', () => {
    // Nur die Anzeige ist weg. Wer sie braucht - Statistikseite, Badges -
    // bekommt sie unverändert.
    const queries = lies('packages/modules/src/tickets/queries.ts');
    for (const feld of ['inBearbeitung', 'nichtZugewiesen', 'ueberfaellig']) {
      expect(queries).toContain(feld);
    }
  });
});
