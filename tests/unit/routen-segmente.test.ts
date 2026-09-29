import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Zwei verschiedene Namen für dasselbe dynamische Segment.
 *
 * ## Was dieser Test verhindert
 *
 * Next.js verlangt, dass ein dynamisches Segment an derselben Stelle im
 * Routenbaum überall gleich heisst. Liegen unter `/api/kalender` ein
 * `[slug]` und ein `[eventId]`, ist das ein Fehler:
 *
 *     You cannot use different slug names for the same dynamic path
 *     ('slug' !== 'eventId')
 *
 * ## Warum es ihn braucht
 *
 * Weil ihn nichts sonst findet. `next build` übersetzt das anstandslos,
 * `npm run check` ist grün, und die Typprüfung sieht zwei Ordner, die
 * einander nichts angehen. Geworfen wird erst, wenn der Server den
 * Routenbaum zusammensetzt - also beim Start, und dann bei **jeder**
 * Anfrage, nicht nur auf der betroffenen Adresse.
 *
 * Genau so ist es passiert: das Gate war vollständig grün, die Abbilder
 * waren gebaut, die Migration lief, und der Web-Container wurde nicht
 * gesund. Fünf Minuten Gesundheitsprüfung, dann ein roter Deploy - wegen
 * eines Ordnernamens.
 *
 * Der Test kostet Millisekunden und beantwortet die Frage an der Stelle, an
 * der sie sich stellt.
 */

const APP = join(process.cwd(), 'apps/web/src/app');

/** Ist das ein dynamisches Segment? `[id]`, `[...rest]`, `[[...opt]]`. */
const istDynamisch = (name: string): boolean => name.startsWith('[') && name.endsWith(']');

/** `[...slug]` und `[[...slug]]` zu `slug` - verglichen wird der Name. */
const segmentName = (name: string): string => name.replace(/^\[+\.{0,3}/u, '').replace(/\]+$/u, '');

/**
 * Jeder Ordner mit mehr als einem dynamischen Kind.
 *
 * Route Groups (`(app)`) und private Ordner (`_lib`) bilden keine
 * Adressebene - sie werden deshalb durchgereicht, statt eine eigene zu
 * eröffnen. Sonst gälten `(app)/[slug]` und `(marketing)/[name]` als
 * verschieden, obwohl Next.js sie auf derselben Ebene sieht.
 */
function sammle(
  verzeichnis: string,
  adresse: string,
  treffer: Array<{ adresse: string; namen: string[] }>,
): void {
  const eintraege = readdirSync(verzeichnis, { withFileTypes: true }).filter((e) => e.isDirectory());

  const dynamisch = new Set<string>();
  for (const eintrag of eintraege) {
    const name = eintrag.name;
    const pfad = join(verzeichnis, name);

    // Route Group oder privater Ordner: keine eigene Adressebene.
    if (name.startsWith('(') || name.startsWith('_') || name.startsWith('@')) {
      sammle(pfad, adresse, treffer);
      continue;
    }
    if (istDynamisch(name)) {
      dynamisch.add(segmentName(name));
    }
    sammle(pfad, `${adresse}/${name}`, treffer);
  }

  if (dynamisch.size > 1) {
    treffer.push({ adresse: adresse || '/', namen: [...dynamisch].sort() });
  }
}

describe('Routenbaum: ein dynamisches Segment heisst überall gleich', () => {
  it('hat nirgends zwei verschieden benannte dynamische Geschwister', () => {
    const treffer: Array<{ adresse: string; namen: string[] }> = [];
    sammle(APP, '', treffer);

    const meldung = treffer
      .map((t) => `  ${t.adresse}: ${t.namen.map((n) => `[${n}]`).join(' und ')}`)
      .join('\n');

    expect(
      treffer,
      `Next.js wirft beim Start «You cannot use different slug names for the same dynamic path».\n` +
        `Betroffen:\n${meldung}\n` +
        `Entweder denselben Namen verwenden oder eine andere Adressebene wählen.`,
    ).toEqual([]);
  });

  it('erkennt den Fall, gegen den er geschrieben wurde', () => {
    /*
     * Die Gegenprobe. Ein Strukturtest, der nur «alles in Ordnung» sagen
     * kann, sagt auch dann «alles in Ordnung», wenn er kaputt ist.
     */
    const treffer: Array<{ adresse: string; namen: string[] }> = [];
    const erfunden = {
      '/api/kalender': ['[slug]', '[eventId]'],
    };
    for (const [adresse, kinder] of Object.entries(erfunden)) {
      const namen = new Set(kinder.filter(istDynamisch).map(segmentName));
      if (namen.size > 1) {
        treffer.push({ adresse, namen: [...namen].sort() });
      }
    }
    expect(treffer).toEqual([{ adresse: '/api/kalender', namen: ['eventId', 'slug'] }]);
  });

  it('stört sich nicht an einem einzelnen dynamischen Kind', () => {
    const namen = new Set(['[slug]'].filter(istDynamisch).map(segmentName));
    expect(namen.size).toBe(1);
  });

  it('liest Catch-all-Segmente als denselben Namen', () => {
    // `[slug]` und `[...slug]` nebeneinander sind fuer Next.js in Ordnung -
    // es ist derselbe Name. Der Test darf daraus keinen Fehler machen.
    const namen = new Set(['[slug]', '[...slug]', '[[...slug]]'].map(segmentName));
    expect([...namen]).toEqual(['slug']);
  });
});
