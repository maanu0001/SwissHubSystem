import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Die Zeitraumlogik der Statistik - an der Quelle geprüft.
 *
 * ## Warum am Quelltext
 *
 * Weil der Fehler eine **Struktur** war und kein Wert. «Die Sprachzeit
 * stimmt» lässt sich mit Daten zeigen; «es gibt keine Stelle, die den
 * Zeitraum wieder auf Kalendertage aufrundet» nicht. Die zweite Aussage ist
 * die, die hält: sie gilt auch für die Kennzahl, die nächstes Jahr dazukommt.
 *
 * Jeder Test hier entspricht einem Satz aus dem Auftrag - «keine duplizierten
 * 24h-/7d-/30d-Berechnungen an mehreren Stellen» etwa - und jeder Satz wäre
 * ohne ihn beim nächsten Umbau leicht zu verlieren.
 */

const lies = (pfad: string): string => readFileSync(join(process.cwd(), pfad), 'utf8');

const ohneKommentare = (quelle: string): string =>
  quelle.replaceAll(/\/\*[\s\S]*?\*\//gu, '').replaceAll(/\/\/.*$/gmu, '');

/** Die Rümpfe der Funktionen einer Datei, nach Namen - auch der internen. */
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

const STATISTIK = lies('packages/modules/src/analytics/statistik.ts');
const SPRACHZEIT = lies('packages/modules/src/analytics/sprachzeit.ts');
const ZEITRAUM = lies('packages/modules/src/analytics/zeitraum.ts');
const SEITE = lies('apps/web/src/app/(app)/analytics/statistik/page.tsx');

describe('Zeitraum: eine Stelle entscheidet über die Grenzen', () => {
  it('löst jeden Filter in genau einer Funktion auf', () => {
    // `aufloesen` ist der eine Weg von «30d» zu zwei Zeitpunkten.
    expect(ZEITRAUM).toContain('export function aufloesen(');
    expect(ZEITRAUM).toContain('export const ZEITRAUM_VORGABEN');
  });

  it('kennt die Filternamen nur an einer Stelle', () => {
    /*
     * Der Satz aus dem Auftrag: keine duplizierten 24h-/7d-/30d-Berechnungen
     * an mehreren Stellen.
     *
     * Geprueft wird deshalb nicht «rechnet hier irgendwo jemand mit Tagen» -
     * Zeitfenster gibt es auch fuer anderes, etwa die Kohortenbindung. Geprueft
     * wird, wo die **Filternamen** vorkommen: wer `'7d'` ausserhalb von
     * `zeitraum.ts` in Stunden umrechnet, hat eine zweite Auslegung derselben
     * Sache, und die naechste Aenderung erwischt nur eine davon.
     */
    for (const [name, quelle] of [
      ['statistik.ts', STATISTIK],
      ['sprachzeit.ts', SPRACHZEIT],
    ] as const) {
      const code = ohneKommentare(quelle);
      for (const id of ["'24h'", "'7d'", "'30d'", "'90d'", "'1y'"]) {
        expect(code, `${name} kennt den Filter ${id}`).not.toContain(id);
      }
    }
    // Die Vorgaben stehen ausschliesslich in `zeitraum.ts`.
    expect(ZEITRAUM).toMatch(/stunden: 24 \* 7/u);
    expect(ZEITRAUM).toMatch(/stunden: 24 \* 30/u);
    // Und die Seite gibt den Namen nur weiter, statt ihn auszulegen.
    expect(SEITE).not.toMatch(/query\.zeitraum === '(24h|7d|30d)'/u);
  });

  it('reicht den Filter von der Adresse bis in den Loader', () => {
    // Search Param → `aufloesen` → `scope` → Kennzahlen. Keine Zwischenstufe,
    // die ihn verliert.
    expect(SEITE).toMatch(/aufloesen\(\{\s*id: query\.zeitraum/u);
    expect(SEITE).toMatch(/const scope = \{ guildId, zeitraum/u);
    expect(SEITE).toContain('statistik.kennzahlen(scope)');
  });
});

describe('Sprachzeit: exakt und nicht auf Kalendertage gerundet', () => {
  it('nimmt für die Kennzahl genau den gewählten Zeitraum', () => {
    const fenster = funktionen(SPRACHZEIT).get('sprachzeitFenster')!;
    // Vorher stand hier `tagesBeginn(zeitraum.von)` - genau das war der Fehler.
    expect(fenster).toContain('von: zeitraum.von');
    expect(fenster).not.toContain('tagesBeginn');
  });

  it('hat ein eigenes, weiteres Fenster für die Balken - und sagt das', () => {
    /*
     * Die Verlaufsgrafik liest Tageszeilen, und eine Tageszeile ist ein ganzer
     * Kalendertag. Dass beide Fenster verschieden sind, ist Absicht: die
     * Kennzahl sagt «in den letzten 24 Stunden», ein Balken sagt «an diesem
     * Tag».
     */
    const eimer = funktionen(SPRACHZEIT).get('eimerFenster')!;
    expect(eimer).toContain('tagesBeginn(zeitraum.von)');
    // Und die Kennzahl benutzt es nicht.
    const kennzahlen = funktionen(STATISTIK).get('kennzahlen')!;
    expect(kennzahlen).toContain('sprachzeitFuer(scope, zeitraum)');
  });

  it('rechnet die Sprachzeit aus den Abschnitten und schneidet am Rand ab', () => {
    const rechnung = funktionen(SPRACHZEIT).get('sprachSekundenImFenster')!;
    expect(rechnung).toContain('"AnalyticsVoiceSegment"');
    // Die Ueberlappungsformel, beide Haelften.
    expect(rechnung).toContain('LEAST(COALESCE("leftAt"');
    expect(rechnung).toContain('GREATEST("joinedAt"');
    // AFK zaehlt nicht - dieselbe Regel wie beim Verbuchen.
    expect(rechnung).toContain('"isAfk" = false');
    // Und ein Fenster in der Zukunft endet jetzt.
    expect(rechnung).toContain('Math.min(fenster.bis.getTime(), jetzt.getTime())');
  });

  it('liest die Sprachzeit nicht mehr aus den Tagesaggregaten', () => {
    /*
     * Die eigentliche Zusage. `summen` darf `voiceSeconds` nicht mehr aus
     * `analyticsDaily` oder `analyticsHourly` addieren - sonst kaeme die
     * aufgerundete Zahl durch die Hintertuer zurueck.
     */
    const summen = funktionen(STATISTIK).get('summen')!;
    expect(summen).toContain('analyticsHourly.aggregate');
    expect(summen).not.toContain('analyticsDaily.aggregate');
    // Die Sprachzeit kommt als Parameter herein, nicht aus der Abfrage.
    expect(summen).toContain('sprachSekunden: number');
    expect(summen).toContain('voiceSeconds: sprachSekunden');
    expect(summen).not.toMatch(/_sum:.*voiceSeconds/u);
  });

  it('holt die Nachrichten stundengenau statt tagesgenau', () => {
    const summen = funktionen(STATISTIK).get('summen')!;
    // `hourStart >= stunde(von)` und `< bis` - nicht `day >= tag(von)`.
    expect(summen).toContain('hourStart: { gte: stunde(von), lt: bis }');
    expect(summen).not.toContain('day: { gte: tag(von)');
  });

  it('gibt dem Vergleichszeitraum dieselbe Rechnung', () => {
    const kennzahlen = funktionen(STATISTIK).get('kennzahlen')!;
    expect(kennzahlen).toContain('vergleich ? sprachzeitFuer(scope, vergleich)');
    // Und derselben Summenfunktion.
    expect(kennzahlen).toMatch(/summen\(guildId, vergleich\.von, vergleich\.bis/u);
  });
});

describe('Anteile: Zähler und Nenner aus derselben Quelle', () => {
  it('nimmt den Nenner der Bestenliste aus derselben Tabelle wie die Zähler', () => {
    /*
     * Vorher stand dort die Serversumme aus `summen`. Seit die stundengenau
     * ist, kaeme sie aus einem anderen Zeitfenster als die Tageszeilen der
     * einzelnen Personen - und ein Anteil koennte ueber hundert Prozent
     * rutschen.
     */
    const top = funktionen(STATISTIK).get('topMitglieder')!;
    expect(top).toContain('analyticsUserDaily.aggregate');
    expect(top).not.toMatch(/summen\(guildId/u);
  });

  it('nimmt den Nenner der Kanalverteilung aus derselben Tabelle', () => {
    const kanaele = funktionen(STATISTIK).get('topKanaele')!;
    expect(kanaele).toContain('analyticsChannelDaily.aggregate');
    expect(kanaele).not.toMatch(/summen\(guildId/u);
  });

  it('ruft `summen` nur noch für die Kennzahlen auf', () => {
    // Eine Stelle, ein Zweck. Wer sie fuer eine Prozentrechnung braucht, hat
    // den Nenner am falschen Ort geholt.
    const aufrufe = [...ohneKommentare(STATISTIK).matchAll(/\bsummen\(/gu)];
    // Deklaration plus die beiden Aufrufe in `kennzahlen`.
    expect(aufrufe).toHaveLength(3);
  });
});

describe('Formatierung bleibt', () => {
  it('zeigt die Sprachzeit weiter in Stunden mit einer Nachkommastelle', () => {
    // Nur die Rechnung war falsch, nicht die Darstellung.
    expect(SEITE).toContain('<LiveSprachzeit');
    expect(SEITE).toContain('label="Sprachzeit"');
  });

  it('lässt die beiden getrennten Diagramme stehen', () => {
    // Nachrichten und Sprachzeit in zwei Diagrammen - eine gemeinsame Achse
    // ergaebe eine Kurve am Rand und eine auf der Null.
    expect(SEITE).toContain('Nachrichten über Zeit');
    expect(SEITE).toContain('Sprachzeit über Zeit');
  });
});
