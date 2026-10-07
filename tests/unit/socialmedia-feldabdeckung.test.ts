import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { socialmedia } from '@swisshub/modules';

/**
 * Die Feldabdeckung - als Zusicherung statt als Tabelle in einem Bericht.
 *
 * ## Der Fehler, den diese Datei festnagelt
 *
 * Ein Posttyp konnte Inhalt **zeichnen**, den der Editor nicht **erfassen**
 * liess. Beim Turnierbaum war es der Baum selbst: `bracket` stand in der
 * Feldliste, der Editor filterte ihn heraus (`.filter((feld) => feld !==
 * 'bracket')`), und gespeichert wurde nur eine Turnierkennung. Damit war der
 * Typ ohne Turniereintrag unbenutzbar und mit einem unveraenderlich.
 *
 * Es war nicht der einzige Fall, nur der auffaelligste: «Info» konnte keinen
 * Link tragen, «Event» kein Partnerzeichen, «Gewinner» weder Platzierung noch
 * Endstand noch Aufruf, «Match» keinen Text - obwohl die Zeichenquelle alle
 * diese Felder fuer ihren Block bereits las.
 *
 * ## Warum das als Test und nicht als Liste
 *
 * Weil eine Liste im Bericht altert und ein Test faellt. Die Richtung ist
 * dabei beidseitig:
 *
 * - **Kein Feld ohne Darstellung**: was der Editor anbietet, muss der Block
 *   dieses Typs auch zeichnen. Sonst tippt jemand etwas, das nie erscheint.
 * - **Keine Darstellung ohne Feld**: was der Block zeichnet, muss der Typ
 *   anbieten koennen. Sonst bleibt eine Flaeche leer, die gefuellt waere.
 */

const FOLIE = readFileSync(join(process.cwd(), 'apps/web/src/modules/socialmedia/post-folie.tsx'), 'utf8');
const EDITOR = readFileSync(
  join(process.cwd(), 'apps/web/src/modules/socialmedia/components/post-editor.tsx'),
  'utf8',
);

/**
 * Welche Felder ein Inhaltsblock zeichnet.
 *
 * Von Hand gepflegt und aus `Inhalt()` in `post-folie.tsx` abgelesen - nicht
 * geraten. Ein Block, der ein Feld dazubekommt, braucht hier eine Zeile; das
 * ist der Preis dafuer, dass die Zusicherung etwas behauptet statt nur den
 * Quelltext zu spiegeln.
 */
const BLOCK_ZEICHNET: Record<socialmedia.InhaltsBlock, readonly string[]> = {
  // Titelblock, Fakten (nur Termin), Aufzaehlung, Partnerzeichen, Link, Aufruf
  aussage: ['titel', 'untertitel', 'text', 'sponsoren', 'link', 'cta'],
  termin: ['titel', 'untertitel', 'datum', 'zeit', 'ort', 'text', 'sponsoren', 'link', 'cta'],
  liste: ['titel', 'untertitel', 'text', 'sponsoren', 'link', 'cta'],
  begegnung: ['titel', 'untertitel', 'teams', 'punkte', 'datum', 'zeit', 'ort', 'text'],
  ergebnis: ['titel', 'untertitel', 'teams', 'punkte', 'datum', 'zeit', 'ort', 'text'],
  baum: ['titel', 'untertitel', 'bracket', 'sponsoren'],
  person: ['titel', 'gewinner', 'platzierung', 'untertitel', 'punkte', 'text', 'sponsoren', 'cta'],
};

/**
 * Felder, die jedes Geruest zeichnet - unabhaengig vom Block.
 *
 * Marke (`logo`, `branding`), Hintergrund (`bild`, `hintergrundbild`),
 * Fusszeile und die Akzentfarbe. Sie stehen in den sechs Geruesten, nicht in
 * `Inhalt()`, und gelten deshalb ueberall.
 */
const IMMER_GEZEICHNET = ['logo', 'branding', 'bild', 'hintergrundbild', 'fusszeile', 'akzentfarbe'] as const;

describe('Post Creator: jeder Typ kann alles erfassen, was er zeigt', () => {
  for (const typ of socialmedia.POST_TYPEN) {
    it(`«${typ.label}» bietet kein Feld an, das sein Bild nicht zeigt`, () => {
      const gezeichnet = new Set<string>([...BLOCK_ZEICHNET[typ.block], ...IMMER_GEZEICHNET]);
      const blind = typ.felder.filter((feld) => !gezeichnet.has(feld));
      expect(blind, `${typ.id}: Felder ohne Darstellung`).toEqual([]);
    });
  }

  /*
   * Die Gegenrichtung - je Block, nicht je Typ.
   *
   * Je Typ waere sie falsch: sie zwaenge jeden Typ, jedes Feld zu fuehren,
   * das sein Block zeichnen **kann**. Genau das ist die generische
   * Einheitsform, die nicht gewollt ist - ein Reminder braucht kein
   * Partnerzeichen, nur weil ein Partnerpost eines hat.
   *
   * Was dagegen stimmen muss: jede Flaeche, die ein Block zeichnet, muss von
   * **irgendeinem** Typ erreichbar sein. Sonst steht in der Zeichenquelle
   * Code fuer etwas, das niemand je eingeben kann.
   */
  for (const [block, felder] of Object.entries(BLOCK_ZEICHNET)) {
    it(`alles, was der Block «${block}» zeichnet, lässt sich irgendwo erfassen`, () => {
      const erreichbar = new Set<string>(
        socialmedia.POST_TYPEN.filter((typ) => typ.block === block).flatMap((typ) => [...typ.felder]),
      );
      const tot = felder.filter((feld) => !erreichbar.has(feld));
      expect(tot, `${block}: zeichnet, was kein Typ anbietet`).toEqual([]);
    });
  }

  it('kennt für jede Feldart eine Eingabe im Editor', () => {
    /*
     * Der Editor uebersetzt `art` in ein Eingabefeld. Eine Art, die er nicht
     * kennt, faellt in den Textfeld-Zweig - und ein Turnierbaum in einem
     * einzeiligen Textfeld ist kein Turnierbaum.
     */
    const arten = new Set(Object.values(socialmedia.FELD_BESCHREIBUNG).map((feld) => feld.art));
    const behandelt = new Set<string>();
    for (const treffer of EDITOR.matchAll(/beschreibung\.art === '([a-z]+)'/gu)) {
      behandelt.add(treffer[1] as string);
    }
    // `text`, `datum`, `zeit` und `url` teilen sich den Rueckfall auf das
    // einzeilige Eingabefeld - das ist dort richtig und kein fehlender Zweig.
    const rueckfall = new Set(['text', 'datum', 'zeit', 'url']);
    const fehlend = [...arten].filter((art) => !behandelt.has(art) && !rueckfall.has(art));
    expect(fehlend).toEqual([]);
  });
});

describe('Turnierbaum: erfassbar, nicht nur lesbar', () => {
  it('filtert den Baum nicht mehr aus der Feldliste', () => {
    /*
     * Die Zeile, um die es ging. Sie stand im Editor und nahm dem Typ
     * «Turnier-Baum» genau das Feld, das seinen Inhalt ausmacht.
     */
    expect(EDITOR).not.toMatch(/\.filter\(\(feld\) => feld !== 'bracket'\)/u);
  });

  it('bietet eine eigene Eingabe für die Feldart «turnierbaum»', () => {
    expect(socialmedia.FELD_BESCHREIBUNG.bracket.art).toBe('turnierbaum');
    expect(EDITOR).toContain("beschreibung.art === 'turnierbaum'");
    expect(EDITOR).toContain('function BaumFeld');
  });

  it('speichert Runden, Begegnungen, Punkte und Sieger', () => {
    const inhalt = socialmedia.normalisiereInhalt('bracket', {
      titel: 'Playoffs',
      bracket: {
        runden: [
          {
            label: 'Halbfinal',
            paarungen: [
              { a: { name: 'Alpha', punkte: 2 }, b: { name: 'Beta', punkte: 0 }, sieger: 'a' },
              { a: { name: 'Gamma' }, b: { name: 'Delta' } },
            ],
          },
          { label: 'Final', paarungen: [{ a: { name: 'Alpha' }, b: { name: 'Gamma' } }] },
        ],
      },
    });
    expect(inhalt.bracket?.runden).toHaveLength(2);
    expect(inhalt.bracket?.runden[0]?.paarungen).toHaveLength(2);
    expect(inhalt.bracket?.runden[0]?.paarungen[0]?.sieger).toBe('a');
    expect(inhalt.bracket?.runden[0]?.paarungen[1]?.sieger).toBeUndefined();
    expect(inhalt.bracket?.runden[1]?.label).toBe('Final');
  });

  it('kommt mit 4, 8 und 16 Teams zurecht, ohne feste Grösse', () => {
    // Vier, acht, sechzehn Teams sind verschieden viele Paarungen in der
    // ersten Runde - mehr Unterschied gibt es nicht.
    for (const teams of [4, 8, 16]) {
      const paarungen = Array.from({ length: teams / 2 }, (_, i) => ({
        a: { name: `Team ${i * 2 + 1}` },
        b: { name: `Team ${i * 2 + 2}` },
      }));
      const inhalt = socialmedia.normalisiereInhalt('bracket', {
        titel: 'x',
        bracket: { runden: [{ label: 'Runde 1', paarungen }] },
      });
      expect(inhalt.bracket?.runden[0]?.paarungen, `${teams} Teams`).toHaveLength(teams / 2);
    }
  });

  it('wirft leere Begegnungen und leere Runden weg', () => {
    // Drei leere Klammern im Export sehen aus wie ein Fehler - nicht wie ein
    // Baum, der noch nicht gefuellt ist.
    const inhalt = socialmedia.normalisiereInhalt('bracket', {
      titel: 'x',
      bracket: {
        runden: [
          { label: 'Leer', paarungen: [{ a: { name: '' }, b: {} }] },
          { label: 'Echt', paarungen: [{ a: { name: 'Alpha' }, b: { name: 'Beta' } }] },
        ],
      },
    });
    expect(inhalt.bracket?.runden).toHaveLength(1);
    expect(inhalt.bracket?.runden[0]?.label).toBe('Echt');
  });

  it('ist ohne jede Runde gar nicht gesetzt', () => {
    const inhalt = socialmedia.normalisiereInhalt('bracket', { titel: 'x', bracket: { runden: [] } });
    expect(inhalt.bracket).toBeUndefined();
  });

  it('begrenzt Runden und Begegnungen', () => {
    const paarungen = Array.from({ length: 40 }, (_, i) => ({
      a: { name: `A${i}` },
      b: { name: `B${i}` },
    }));
    const runden = Array.from({ length: 20 }, (_, i) => ({ label: `R${i}`, paarungen }));
    const inhalt = socialmedia.normalisiereInhalt('bracket', { titel: 'x', bracket: { runden } });
    expect(inhalt.bracket?.runden.length).toBeLessThanOrEqual(socialmedia.MAX_BAUM_RUNDEN);
    expect(inhalt.bracket?.runden[0]?.paarungen.length).toBeLessThanOrEqual(socialmedia.MAX_BAUM_PAARUNGEN);
  });

  it('nennt im Editor dieselben Obergrenzen wie der Modulkern', () => {
    // Der Editor laeuft im Browser und kann den Modulkern nicht importieren -
    // er haengt an Prisma. Also stehen die Zahlen zweimal, und hier wird
    // geprueft, dass sie dieselben sind.
    expect(EDITOR).toContain(`const MAX_BAUM_RUNDEN = ${socialmedia.MAX_BAUM_RUNDEN};`);
    expect(EDITOR).toContain(`const MAX_BAUM_PAARUNGEN = ${socialmedia.MAX_BAUM_PAARUNGEN};`);
  });

  it('zeichnet den Baum aus dem Post und nicht aus dem Turnier', () => {
    /*
     * Die Zeichenquelle hatte einen eigenen Eingang fuer den Baum
     * (`auftrag.baum`), und der kam aus dem Turnier. Jetzt ist er ein Feld
     * des Inhalts - damit ist der Export reproduzierbar und der Editor hat
     * ueberhaupt etwas zu bearbeiten.
     */
    expect(FOLIE).toContain('auftrag.inhalt.bracket');
    expect(FOLIE).not.toMatch(/\bauftrag\.baum\b/u);
  });
});

describe('Turnierdaten: Übernahme füllt, bindet aber nicht', () => {
  it('schreibt den Baum in den Editor statt ihn zu verknüpfen', () => {
    expect(EDITOR).toContain('antwort.data.baum');
    // Die alte Fassung setzte nur die Kennung - das war die Bindung.
    expect(EDITOR).not.toMatch(/bracket: \{ tournamentId \}/u);
  });

  it('merkt sich die Herkunft, ohne daraus zu lesen', () => {
    const inhalt = socialmedia.normalisiereInhalt('bracket', {
      titel: 'x',
      bracket: {
        tournamentId: 'turnier-1',
        runden: [{ label: 'Final', paarungen: [{ a: { name: 'A' }, b: { name: 'B' } }] }],
      },
    });
    expect(inhalt.bracket?.tournamentId).toBe('turnier-1');
  });

  it('schreibt nirgends ins Turnier zurück', () => {
    const quelle = readFileSync(
      join(process.cwd(), 'packages/modules/src/socialmedia/turnierdaten.ts'),
      'utf8',
    );
    // Lesen ja, schreiben nein - ein Post darf ein Turnier nicht verändern.
    expect(quelle).not.toMatch(/prisma\.tournament\w*\.(update|create|delete|upsert)/u);
  });
});
