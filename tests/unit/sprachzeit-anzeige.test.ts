import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dauer, stunden, zahl } from '../../apps/web/src/modules/analytics/format';

/**
 * Wie die Sprachzeit aussieht - und dass sie nicht altert.
 *
 * Die Fachlichkeit steht im Integrationstest gegen eine echte Datenbank.
 * Hier stehen die beiden Dinge davor und danach: das Zahlenformat, und die
 * Zusagen der Oberfläche, die sich nur an der Quelle prüfen lassen.
 */

function lies(pfad: string): string {
  return readFileSync(join(process.cwd(), pfad), 'utf8');
}

describe('TEST 44: Stunden mit Nachkommastelle', () => {
  const minuten = (wert: number): string => stunden(wert * 60);

  it('macht aus einer halben Stunde nicht mehr null', () => {
    // `0 h` für dreissig Minuten sah nach «nichts passiert» aus.
    expect(minuten(30)).toBe('0.5 h');
  });

  it('zeigt die Beispiele aus der Anforderung', () => {
    expect(minuten(0)).toBe('0.0 h');
    expect(minuten(6)).toBe('0.1 h');
    expect(minuten(60)).toBe('1.0 h');
    expect(minuten(90)).toBe('1.5 h');
    expect(minuten(127)).toBe('2.1 h');
    expect(minuten(6216)).toBe('103.6 h');
  });

  it('rundet auf eine Stelle und nicht auf ganze Stunden', () => {
    expect(minuten(165)).toBe('2.8 h'); // 2 h 45 min
    expect(minuten(59)).toBe('1.0 h');
    expect(minuten(31)).toBe('0.5 h');
  });

  it('rechnet mit Sekunden statt mit gerundeten Minuten', () => {
    // Intern wird nie früh gerundet - sonst summierten sich die Fehler.
    expect(stunden(95)).toBe('0.0 h');
    expect(stunden(3599)).toBe('1.0 h');
    expect(stunden(1)).toBe('0.0 h');
  });

  it('erfindet keine negative Zeit', () => {
    expect(stunden(-100)).toBe('0.0 h');
  });

  it('lässt die genaue Darstellung unangetastet', () => {
    // `dauer` steht in den Ranglisten und war nie das Problem: sie zeigt
    // Minuten und verschluckt eine halbe Stunde nicht.
    expect(dauer(1800)).toBe('30 min');
    expect(dauer(5400)).toBe('1 h 30 min');
    expect(zahl(1234)).toContain('234');
  });
});

describe('Die Seite zeigt den Stand von jetzt', () => {
  const seite = lies('apps/web/src/app/(app)/analytics/statistik/page.tsx');
  const route = lies('apps/web/src/app/api/analytics/live/route.ts');

  it('TEST 43: wird bei jedem Aufruf neu gerechnet', () => {
    // Ohne das käme nach einem Neuladen eine Zahl aus dem Cache - und die
    // wäre genau so alt wie der Cache.
    expect(seite).toContain("export const dynamic = 'force-dynamic'");
    expect(seite).not.toContain('unstable_cache');
    expect(seite).not.toContain('export const revalidate');
  });

  it('lässt den Live-Abruf von niemandem aufbewahren', () => {
    expect(route).toContain("export const dynamic = 'force-dynamic'");
    expect(route).toContain("'Cache-Control': 'no-store, max-age=0'");
    expect(lies('apps/web/src/modules/analytics/components/live-sprachzeit.tsx')).toContain(
      "cache: 'no-store'",
    );
  });

  it('prüft im Live-Abruf dieselbe Berechtigung wie die Seite', () => {
    // Ein Live-Endpunkt ist keine Hintertür zu Zahlen, die jemand sonst
    // nicht sehen darf.
    expect(route).toContain('ANALYTICS_PERMISSIONS.statisticsView');
  });
});

describe('Die geöffnete Seite rechnet weiter', () => {
  const live = lies('apps/web/src/modules/analytics/components/live-sprachzeit.tsx');

  it('TEST 42: zählt zwischen zwei Abgleichen selbst hoch', () => {
    expect(live).toContain('quelle.sekunden + quelle.wachsend * seither');
  });

  it('rechnet ab der Serverzeit, nicht ab der Uhr des Browsers', () => {
    // Die Browseruhr misst nur die verstrichene Spanne; eine falsch
    // gestellte Uhr verschiebt damit nichts, was gespeichert ist.
    expect(live).toContain('stand?.asOf ?? Date.parse(asOf)');
  });

  it('holt für alle Kacheln zusammen einen Stand', () => {
    // Ein Abonnement, nicht eines je Kachel - sonst holten vier Karten
    // viermal dasselbe.
    expect(live).toContain('if (zuhoerer.size === 1)');
    expect(live).toContain('if (zuhoerer.size > 0)');
  });

  it('fragt nicht jede Sekunde nach', () => {
    // Eine Anzeige mit einer Nachkommastelle ändert sich frühestens alle
    // sechs Minuten je Sitzung - ein Abruf je Sekunde wäre reine Last.
    const abgleich = /const ABGLEICH_MS = ([\d_]+);/u.exec(live);
    expect(abgleich).not.toBeNull();
    expect(Number(abgleich?.[1]?.replaceAll('_', ''))).toBeGreaterThanOrEqual(10_000);
  });

  it('ruht bei einem abgeschlossenen Zeitraum', () => {
    // Daran ändert sich nichts mehr - das wird nicht alle dreissig Sekunden
    // neu abgefragt.
    expect(live).toContain('function ruhend()');
    expect(live).toContain('useSyncExternalStore(aktiv ? abonniere : ruhend');
  });

  it('ruht NICHT bloss, weil gerade niemand im Sprachkanal ist', () => {
    /*
     * Der zweite Grund für «Gerade im Sprachkanal: 0».
     *
     * Vorher hing der Abgleich an «läuft gerade eine Sitzung?» - war beim
     * Aufbau der Seite niemand im Kanal, wurde nie wieder nachgefragt. Eine
     * Zahl, die «gerade» heisst, muss auch dann nachsehen, wenn die letzte
     * Antwort «niemand» war.
     */
    const seite = lies('apps/web/src/app/(app)/analytics/statistik/page.tsx');
    expect(seite).toContain('const reichtBisJetzt = zeitraum.bis.getTime()');
    // Die Heute-Kacheln fragen immer - sie zeigen die Gegenwart.
    expect(seite).toContain('feld="imSprachkanal" basis={heuteWerte.imSprachkanal} aktiv />');
    // Und die alte, zu enge Bedingung ist weg.
    expect(seite).not.toContain('const laeuft =');
  });

  it('zählt nur hoch, solange wirklich etwas wächst', () => {
    // Getrennt vom Abruf: nachgefragt wird immer, neu gezeichnet nur, wenn
    // sich zwischen zwei Antworten überhaupt etwas ändern kann.
    expect(live).toContain('function taktAnpassen()');
    expect(live).toContain('stand.zeitraum.wachsend > 0 || stand.heute.wachsend > 0');
  });
});

describe('Die Statistik rechnet an einer Stelle', () => {
  const statistik = lies('packages/modules/src/analytics/statistik.ts');

  it('holt die laufende Zeit über eine gemeinsame Funktion', () => {
    // Nicht je Kachel eine eigene Rechnung - das wären fünf Gelegenheiten,
    // dass sie auseinanderlaufen.
    expect(statistik).toContain('async function laufendFuer(');
    expect(statistik).toContain("from './sprachzeit'");
  });

  it('lässt keine Sprachzahl ohne laufenden Anteil', () => {
    // Jede Stelle, die `summen` benutzt, reicht den laufenden Anteil herein
    // oder lässt ihn begründet weg (Textranglisten).
    expect(statistik).toContain('laufend?.sekunden ?? 0');
  });
});
