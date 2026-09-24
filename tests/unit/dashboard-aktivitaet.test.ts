import { describe, expect, it } from 'vitest';
import { DASHBOARD_ACTIVITY_ACTIONS, istDashboardRelevant } from '@swisshub/database';

/**
 * Welche Ereignisse auf das Dashboard gehoeren - und wie sie dort heissen.
 *
 * Zwei Zusagen werden hier geprueft, und beide sind zusammen erst eine:
 *
 *  1. Die Auswahl ist eine typisierte Liste und kein Textfilter. Ein
 *     Hintergrunddurchgang steht nicht darauf, ein abgewiesener Zugriff
 *     schon - unabhaengig davon, ob «system» oder ein Mensch gehandelt hat.
 *  2. Fuer jede Aktion auf dieser Liste gibt es einen Satz. Sonst waere der
 *     Gewinn nur, dass statt sechsmal «system hat eine Aktion ausgefuehrt»
 *     jetzt sechsmal «system hat eine Aktion ausgefuehrt» mit anderen
 *     Aktionen dahinter stuende.
 */
const { readFileSync } = await import('node:fs');

/** Die Schluessel aus `ACTION_VIEW` - gelesen, nicht importiert. */
function bekannteSaetze(): Map<string, string> {
  /*
   * Die Komponente importiert `lucide-react` und JSX; sie hier zu laden
   * hiesse, eine React-Umgebung aufzubauen, um an eine Tabelle zu kommen.
   * Die Datei zu lesen ist genauer: geprueft wird, was dort steht.
   */
  const quelle = readFileSync('apps/web/src/components/shared/activity-item.tsx', 'utf8');
  const beginn = quelle.indexOf('const ACTION_VIEW');
  const ende = quelle.indexOf('const FALLBACK');
  expect(beginn).toBeGreaterThan(-1);
  expect(ende).toBeGreaterThan(beginn);

  const block = quelle.slice(beginn, ende);
  const treffer = new Map<string, string>();
  for (const zeile of block.matchAll(/^\s{2}([A-Z][A-Z0-9_]+):\s*\{([\s\S]*?)\},?$/gmu)) {
    const [, aktion, rumpf] = zeile;
    if (aktion === undefined || rumpf === undefined) {
      continue;
    }
    const verb = /verb:\s*'([^']*)'/u.exec(rumpf);
    // Ein doppelter Schluessel gewaenne in JavaScript ebenfalls zuletzt -
    // hier wie dort ueberschreibt der spaetere Eintrag den frueheren.
    treffer.set(aktion, verb?.[1] ?? '');
  }
  return treffer;
}

describe('Auswahl der Dashboard-Aktivitäten', () => {
  it('lässt wiederkehrende Durchgänge und Wartezustände nicht durch', () => {
    // Genau die Einträge, die das Dashboard zugespammt haben.
    expect(istDashboardRelevant('RECONCILIATION_RUN')).toBe(false);
    expect(istDashboardRelevant('JAIL_PENDING_REJOIN')).toBe(false);
    expect(istDashboardRelevant('JAIL_RECONCILED')).toBe(false);
    expect(istDashboardRelevant('TICKET_RECONCILED')).toBe(false);
    expect(istDashboardRelevant('LEVEL_DECAY_RUN')).toBe(false);
  });

  it('lässt auch unbekannte künftige Aktionen nicht durch', () => {
    // Eine Erlaubnisliste und keine Verbotsliste: was morgen dazukommt,
    // steht nicht automatisch auf dem Dashboard.
    expect(istDashboardRelevant('IRGENDEIN_NEUES_EREIGNIS')).toBe(false);
  });

  it('behält menschliche und sicherheitsrelevante Ereignisse', () => {
    expect(istDashboardRelevant('JAIL_CREATED')).toBe(true);
    expect(istDashboardRelevant('LOGIN_DENIED')).toBe(true);
    expect(istDashboardRelevant('PERMISSION_DENIED')).toBe(true);
    expect(istDashboardRelevant('MODULE_SETTINGS_CHANGED')).toBe(true);
  });

  it('behält ein automatisch ausgelöstes, aber bedeutsames Ereignis', () => {
    // Der Fall, an dem ein Filter auf `actorName !== 'system'` scheitern
    // würde: niemand hat geklickt, und trotzdem ist es eine Nachricht.
    expect(istDashboardRelevant('TICKET_AUTO_CLOSED')).toBe(true);
  });

  it('filtert nicht über den Namen des Handelnden', () => {
    const quelle = readFileSync('apps/web/src/server/dashboard.ts', 'utf8');
    expect(quelle).not.toMatch(/actorUsername\s*[!=]==?\s*'system'/u);
    expect(quelle).toContain('DASHBOARD_ACTIVITY_ACTIONS');
  });

  it('filtert in der Abfrage und nicht nach der Pagination', () => {
    /*
     * Die Reihenfolge ist der Punkt. Erst sechs Zeilen holen und dann
     * aussortieren ergibt bei einem lebhaften Protokoll regelmaessig null
     * Zeilen - eine leere Liste statt einer aufgeraeumten.
     */
    const quelle = readFileSync('apps/web/src/server/dashboard.ts', 'utf8');
    const wo = quelle.indexOf('where: { action: { in: [...DASHBOARD_ACTIVITY_ACTIONS] } }');
    const take = quelle.indexOf('take: 6');
    expect(wo).toBeGreaterThan(-1);
    expect(take).toBeGreaterThan(wo);
    // Und nichts wird hinterher noch einmal weggeworfen.
    expect(quelle).not.toMatch(/recentActivity\s*\.filter/u);
  });
});

describe('Satzbau der Dashboard-Aktivitäten', () => {
  const saetze = bekannteSaetze();

  it('kennt zu jeder erlaubten Aktion einen konkreten Satz', () => {
    const ohneSatz = DASHBOARD_ACTIVITY_ACTIONS.filter((aktion) => !saetze.has(aktion));
    expect(ohneSatz).toEqual([]);
  });

  it('greift für keine erlaubte Aktion auf den Platzhaltertext zurück', () => {
    // «hat eine Aktion ausgeführt» ist kein Satz, sondern das Eingeständnis,
    // dass niemand einen formuliert hat.
    for (const aktion of DASHBOARD_ACTIVITY_ACTIONS) {
      expect(saetze.get(aktion)).not.toBe('hat eine Aktion ausgeführt');
      expect(saetze.get(aktion)?.length ?? 0).toBeGreaterThan(5);
    }
  });

  it('formuliert die automatisch ausgelösten Ereignisse ebenfalls aus', () => {
    expect(saetze.get('TICKET_AUTO_CLOSED')).toContain('automatisch geschlossen');
    expect(saetze.get('VERIFICATION_AI_VERIFIED')).toContain('automatisch');
  });
});
