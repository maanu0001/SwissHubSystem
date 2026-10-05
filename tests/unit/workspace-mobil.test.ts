import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Der Workspace bricht auf dem Telefon nicht aus.
 *
 * ## Die gemessene Ursache
 *
 * Bei 390 px lief die Projektseite um **116 px** ueber den Bildschirmrand
 * hinaus, die Aufgabenseite um **220 px**. Die Spur fuehrte nicht zu einer
 * zu breiten Kachel, sondern zu einer Grid-Spur:
 *
 *     div.grid.gap-4.lg:grid-cols-3   w: 358px
 *       grid-template-columns:        489.8px   ← die Spur selbst
 *
 * Auf dem Telefon greift `lg:` nicht, und ein Grid **ohne** Spaltenangabe
 * legt eine implizite Spur mit `auto` an. Das Minimum einer `auto`-Spur ist
 * die min-content-Breite ihres Inhalts: die Spur waechst also mit dem
 * breitesten Kind, statt es zu begrenzen.
 *
 * `min-w-0` am Kind hilft dagegen **nicht** - und genau das war die Falle,
 * denn es stand schon da (`Panel` setzt es). Das Minimum sitzt an der Spur.
 *
 * ## Warum dieser Test am Quelltext prueft
 *
 * Weil der Verhaltenstest dafuer ein Browser ist, und der laeuft im
 * Browser-Smoke (`spec25-ws.mjs`, sieben Seiten × vier Breiten). Was hier
 * geprueft wird, ist die **Regel**, damit die naechste Kachel nicht wieder
 * ohne Basis-Spalte entsteht: Tailwinds `grid-cols-1` ist
 * `repeat(1, minmax(0, 1fr))`, und dieses `minmax(0, …)` ist die
 * Begrenzung. Eine Klassenliste, die mit `grid gap-` beginnt, hat sie nicht.
 */

const ORTE = ['apps/web/src/app/(app)/workspace', 'apps/web/src/modules/workspace'];

/**
 * Quelltext ohne Kommentare.
 *
 * Ohne das prueft dieser Test seine eigene Dokumentation: in `page.tsx`
 * steht die alte Klassenliste `grid gap-4 lg:grid-cols-3` als Beispiel im
 * erklaerenden Kommentar, und in `aufgabe-beteiligte.tsx` steht
 * «Projektleitung» in dem Satz, der erklaert, dass es sie dort nicht gibt.
 * Beides ist richtig so - und beides waere ein Fehlschlag.
 */
const ohneKommentare = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');

const lies = (pfad: string): string => ohneKommentare(readFileSync(pfad, 'utf8'));

/** Alle `.tsx` unter einem Verzeichnisbaum. */
function dateien(wurzel: string): string[] {
  const gefunden: string[] = [];
  const lauf = (ort: string): void => {
    for (const eintrag of readdirSync(ort)) {
      const pfad = join(ort, eintrag);
      if (statSync(pfad).isDirectory()) {
        lauf(pfad);
      } else if (pfad.endsWith('.tsx')) {
        gefunden.push(pfad);
      }
    }
  };
  lauf(wurzel);
  return gefunden;
}

describe('Workspace-Kacheln begrenzen ihre Grid-Spuren', () => {
  const alle = ORTE.flatMap((ort) => dateien(ort));

  it('findet die Dateien überhaupt', () => {
    // Ein Test, der nichts liest, ist gruen und wertlos.
    expect(alle.length).toBeGreaterThan(10);
  });

  it('gibt jedem Grid eine Basis-Spalte', () => {
    const ohne: string[] = [];
    for (const pfad of alle) {
      const text = lies(pfad);
      /*
       * Gesucht sind Klassenlisten, die mit `grid gap-` anfangen - also ein
       * Grid, dessen erste Angabe der Abstand ist und keine Spalte. Ein
       * `grid-cols-…`, `grid-flow-…` oder eine eigene Spur direkt hinter
       * `grid` ist in Ordnung.
       */
      for (const treffer of text.matchAll(/['"`]grid gap-[^'"`]*/gu)) {
        ohne.push(`${pfad}: ${treffer[0].slice(1, 70)}`);
      }
    }
    expect(ohne, `Grids ohne Basis-Spalte:\n${ohne.join('\n')}`).toEqual([]);
  });

  it('begrenzt die Spalte der Beteiligten-Zeile auch dort, wo sie zweispaltig wird', () => {
    /*
     * Die Hinzufuegen-Zeile im Projekt ist ab `sm` zweispaltig: Suche und
     * Funktion nebeneinander. Die Suchspalte braucht `minmax(0,1fr)` - ein
     * Eingabefeld hat eine Standardbreite aus seinem `size`-Attribut, und
     * die ist breiter als die Spalte sein darf.
     */
    const projekt = lies('apps/web/src/modules/workspace/components/projekt-steuerung.tsx');
    expect(projekt).toContain('sm:grid-cols-[minmax(0,1fr)_auto]');
  });

  it('lässt die Zeile eines Beteiligten umbrechen statt sie aufzudrücken', () => {
    /*
     * Gemessen ragte die Projektzeile 85 px ueber den Rand: Gesicht, Name,
     * ein Auswahlfeld mit `w-36 shrink-0` und ein Knopf passen bei 390 px
     * nicht in eine Zeile, und `shrink-0` liess das Auswahlfeld nicht
     * nachgeben.
     */
    const projekt = lies('apps/web/src/modules/workspace/components/projekt-steuerung.tsx');
    expect(projekt).toContain('flex-wrap');
    expect(projekt).toContain('sm:flex-nowrap');
    // Keine feste Breite mehr am Auswahlfeld - die Spalte gibt sie vor.
    expect(projekt).not.toContain('w-36 shrink-0');
  });
});

describe('Die Beteiligten-Kachel bedient sich an Projekt und Aufgabe gleich', () => {
  const projekt = lies('apps/web/src/modules/workspace/components/projekt-steuerung.tsx');
  const aufgabe = lies('apps/web/src/modules/workspace/components/aufgabe-beteiligte.tsx');

  it('benutzt an beiden Stellen dieselbe Personensuche', () => {
    // Zwei Bedienmuster fuer eine Handlung sind eine Gewohnheit, die man
    // zweimal lernen muss.
    for (const quelle of [projekt, aufgabe]) {
      expect(quelle).toContain("from './personensuche'");
      expect(quelle).toContain('<Personensuche');
      expect(quelle).toContain('Hinzufügen');
    }
  });

  it('kennt an der Aufgabe keine Rolle - nirgends', () => {
    /*
     * «Alle Beteiligten sind gleichwertig verantwortlich» ist eine Aussage
     * ueber das Modell. Steht in der Oberflaeche ein Rollenbegriff, ist sie
     * schon halb zurueckgenommen.
     */
    expect(aufgabe).not.toContain('ROLLE_LABEL');
    expect(aufgabe).not.toContain('Projektleitung');
    expect(aufgabe).not.toContain('Unterstützung');
    expect(aufgabe).not.toContain('WorkspaceMemberRole');
  });

  it('bietet niemanden zweimal an', () => {
    /*
     * Die Zusage «keine Duplikate» steht an der Kandidatenliste und nicht in
     * einer Pruefung beim Hinzufuegen: was man nicht waehlen kann, kann man
     * nicht doppelt waehlen. Die Pruefung beim Klick bleibt als zweite
     * Schranke - zwei schnelle Klicks sind schneller als ein Neuaufbau.
     */
    expect(projekt).toContain('const kandidaten = useMemo');
    expect(projekt).toContain('team.filter((eintrag) => !dabei.has(eintrag.discordId))');
    expect(projekt).toContain('if (stand.some((eintrag) => eintrag.discordId === gewaehlt))');

    expect(aufgabe).toContain('team.filter((eintrag) => !stand.includes(eintrag.discordId))');
    expect(aufgabe).toContain('if (stand.includes(gewaehlt))');
  });

  it('nimmt keine freie Texteingabe als Person an', () => {
    /*
     * Das Feld sucht, es benennt nicht. `wert` ist die Kennung einer Person
     * aus dem Team oder `null` - ein eingetippter Name kann kein
     * Beteiligter werden, weil es keinen Weg gibt, auf dem er einer wuerde.
     */
    const suche = lies('apps/web/src/modules/workspace/components/personensuche.tsx');
    expect(suche).toContain('wert: string | null');
    expect(suche).toContain('aufWahl: (discordId: string | null) => void');
    // Die Wahl kommt aus der Liste, nicht aus dem Feld.
    expect(suche).toContain('aufWahl(an ? null : person.discordId)');
    expect(suche).not.toMatch(/aufWahl\(suche/u);
  });

  it('zeigt die Liste auch ohne Berechtigung, nur unveränderlich', () => {
    // Wer nicht zuweisen darf, will trotzdem wissen, wen er fragen muss.
    expect(aufgabe).toContain('if (!darfBearbeiten)');
    expect(aufgabe).toContain('Zum Ändern der Beteiligten fehlt dir die Berechtigung.');
  });
});
