import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ImageResponse } from 'next/og';
import {
  SOCIAL_MASSE,
  STANDARD_MARKE,
  schlagzeile,
  zeichneSocialFolie,
  type SocialDaten,
} from '../../apps/web/src/modules/fragt/social-folie';
import type { fragt } from '@swisshub/modules';

/**
 * Die drei Texte und das Zeichen - im **Bild**, nicht im DTO.
 *
 * ## Warum dieser Test existiert
 *
 * Weil die Ueberschrift einstellbar war, gespeichert wurde und von keiner
 * einzigen Folie gezeichnet wurde. Der Weg Editor → Aktion → Datenbank →
 * `socialDaten()` → `SocialDaten.ueberschrift` war vollstaendig; am Ende las
 * das Feld niemand. Jeder Test ueber das DTO war gruen, und das Feld tat
 * nichts.
 *
 * Die bestehende Fixture in `fragt-export-marke.test.ts` konnte das nicht
 * zeigen: dort ist `ueberschrift` gleich `frageText`, beide Bilder waeren also
 * ohnehin identisch gewesen. Hier sind sie absichtlich verschieden.
 *
 * ## Woran gemessen wird
 *
 * An den Bytes des gerenderten PNG. Ein Text, der im Bild steht, veraendert
 * sie; einer, der nicht gezeichnet wird, kann sie nicht veraendern. Das ist
 * die einzige Pruefung, die «erscheint in der Vorschau» wirklich beantwortet -
 * und sie braucht keine Schriftmetrik und kein Referenzbild, das bei jeder
 * Schriftaktualisierung bricht.
 */

const GRUND: SocialDaten = {
  frageText: 'Welches Game spielt ihr am Freitag?',
  untertitel: 'Drei Antworten, eine davon gewinnt.',
  ueberschrift: '',
  cta: 'Sag es uns auf Discord.',
  zeilen: [
    { label: 'Deep Rock Galactic', prozent: 55, stimmen: 11, fuehrt: true },
    { label: 'Counter-Strike 2', prozent: 30, stimmen: 6, fuehrt: false },
    { label: 'Lethal Company', prozent: 15, stimmen: 3, fuehrt: false },
  ],
  gesamt: 20,
  gewinner: { label: 'Deep Rock Galactic', prozent: 55, stimmen: 11 },
  gleichstand: [],
  stimmenZeigen: true,
};

/**
 * Die Folien mit einer Schlagzeile.
 *
 * Alle aussser der Aufruf-Folie. Die besteht aus genau einem Element - dem
 * Aufruf in einer farbigen Flaeche - und hatte noch nie eine Zeile darueber;
 * das ist ihre Aufgabe und nicht ein Versehen. Eine Schlagzeile dort
 * einzufuehren waere eine Designaenderung, die niemand verlangt hat, und sie
 * wuerde mit dem Zeichen oben links um denselben Platz streiten.
 *
 * Der bearbeitbare Text dieser Folie ist der **Aufruf** selbst - er wird
 * weiter unten eigens geprueft. Jedes Textfeld des Studios erscheint damit auf
 * mindestens einer Folie, und diese Liste sagt, auf welchen.
 */
const MIT_SCHLAGZEILE: fragt.FolienArt[] = ['frage', 'gewinner', 'verteilung', 'duell'];

async function bild(art: fragt.FolienArt, daten: SocialDaten): Promise<Buffer> {
  // Quadrat: dasselbe Format fuer alle Faelle, damit ein Unterschied nur vom
  // Text kommen kann und nicht von der Flaeche.
  const mass = SOCIAL_MASSE.quadrat;
  const antwort = new ImageResponse(
    zeichneSocialFolie({ art, format: 'quadrat', daten, marke: STANDARD_MARKE }),
    { width: mass.breite, height: mass.hoehe },
  );
  return Buffer.from(await antwort.arrayBuffer());
}

describe('Die Schlagzeile', () => {
  it('nimmt die Überschrift, wenn eine da ist', () => {
    expect(schlagzeile({ ...GRUND, ueberschrift: 'Freitagabend entschieden' })).toBe(
      'Freitagabend entschieden',
    );
  });

  it('nimmt den Wortlaut der Frage, wenn keine da ist', () => {
    expect(schlagzeile({ ...GRUND, ueberschrift: '' })).toBe(GRUND.frageText);
    // Leerzeichen sind keine Überschrift.
    expect(schlagzeile({ ...GRUND, ueberschrift: '   ' })).toBe(GRUND.frageText);
  });

  it('steht auf jeder einzelnen Folie im Bild', async () => {
    /*
     * Der Kern dieses Spec-Punkts. Fünf Folien, fünf Vergleiche: wäre die
     * Überschrift auf einer davon nicht gezeichnet, wären ihre Bytes gleich -
     * und genau das war vorher bei allen fünf der Fall.
     */
    for (const art of MIT_SCHLAGZEILE) {
      const ohne = await bild(art, { ...GRUND, ueberschrift: '' });
      const mit = await bild(art, { ...GRUND, ueberschrift: 'Freitagabend entschieden' });
      expect(ohne.equals(mit), `Folie «${art}» zeichnet die Überschrift nicht`).toBe(false);
    }
  }, 120_000);

  it('lässt die Aufruf-Folie bewusst unberührt', async () => {
    /*
     * Die Gegenprobe zur Liste darüber. Sie hält fest, dass das Fehlen der
     * Schlagzeile auf dieser Folie eine Entscheidung ist und kein vergessener
     * Aufruf von `schlagzeile()`: wer sie dort einbaut, bricht diesen Test und
     * muss den Kommentar bei `MIT_SCHLAGZEILE` widerlegen.
     */
    const ohne = await bild('cta', { ...GRUND, ueberschrift: '' });
    const mit = await bild('cta', { ...GRUND, ueberschrift: 'Freitagabend entschieden' });
    expect(ohne.equals(mit)).toBe(true);
  }, 60_000);

  it('ergibt leer dasselbe Bild wie der Wortlaut der Frage', async () => {
    // Die Zusage des Rückfalls: nichts eingestellt heisst «wie vorher», nicht
    // «eine leere Zeile».
    const leer = await bild('gewinner', { ...GRUND, ueberschrift: '' });
    const gleich = await bild('gewinner', { ...GRUND, ueberschrift: GRUND.frageText });
    expect(leer.equals(gleich)).toBe(true);
  }, 60_000);
});

describe('Untertitel und Aufruf', () => {
  it('zeichnet den Untertitel auf der Frage-Folie', async () => {
    const mit = await bild('frage', { ...GRUND, untertitel: 'Drei Antworten, eine davon gewinnt.' });
    const ohne = await bild('frage', { ...GRUND, untertitel: null });
    expect(mit.equals(ohne)).toBe(false);
  }, 60_000);

  it('zeichnet den Aufruf auf der Aufruf-Folie', async () => {
    const mit = await bild('cta', { ...GRUND, cta: 'Sag es uns auf Discord.' });
    const anders = await bild('cta', { ...GRUND, cta: 'Was hättest du gewählt?' });
    expect(mit.equals(anders)).toBe(false);
  }, 60_000);

  it('lässt bei leerem Aufruf die Fläche weg statt sie leer zu zeichnen', async () => {
    /*
     * §52. Ein leeres farbiges Rechteck wäre kein Aufruf, sondern eine Fläche,
     * die aussieht wie ein Fehler - und `passendeGroesse('')` hätte dafür auch
     * noch die grösste Schrift gerechnet.
     */
    const mit = await bild('cta', GRUND);
    const leer = await bild('cta', { ...GRUND, cta: '   ' });
    expect(mit.equals(leer)).toBe(false);
    // Ohne Text ist das Bild schlichter und damit kleiner komprimiert. Das ist
    // ein schwacher, aber unabhängiger Hinweis darauf, dass Fläche **und**
    // Schrift weg sind und nicht nur die Schrift.
    expect(leer.byteLength).toBeLessThan(mit.byteLength);
  }, 60_000);
});

/** Kommentare weg: eine Erklärung zeichnet nichts. */
function ohneKommentare(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');
}

describe('Der Quelltext der Kette', () => {
  const folie = readFileSync(
    fileURLToPath(new URL('../../apps/web/src/modules/fragt/social-folie.tsx', import.meta.url)),
    'utf8',
  );
  const editor = readFileSync(
    fileURLToPath(new URL('../../apps/web/src/modules/fragt/components/studio-editor.tsx', import.meta.url)),
    'utf8',
  );

  it('zieht jede Schlagzeile durch dieselbe Funktion', () => {
    /*
     * Fünf Folien, eine Regel. Griffe eine davon wieder direkt auf
     * `daten.frageText` zu, liefe sie an der Überschrift vorbei - und das
     * sieht man im Bild erst, wenn jemand genau diese Folie exportiert.
     */
    /*
     * Fünf Zeichenstellen bei vier Folienarten: die Gewinner-Folie hat zwei
     * Varianten - eine mit eindeutigem Gewinner und eine für den Gleichstand -
     * und beide tragen eine Schlagzeile. Die Zahl ist deshalb absichtlich
     * nicht `MIT_SCHLAGZEILE.length`; wer eine Variante vergisst, sieht es nur
     * bei genau diesem Ergebnis, und das ist der Fall, der niemandem auffällt.
     */
    const gezeichnet = folie.match(/\{schlagzeile\(daten\)\}/gu) ?? [];
    expect(gezeichnet).toHaveLength(5);
    /*
     * Und keine Folie greift daneben direkt auf den Wortlaut zu. Kommentare
     * erklären etwas, sie zeichnen nichts - deshalb zählt nur der Quelltext
     * ohne sie. Der Rückfall in `schlagzeile()` selbst ist der eine erlaubte
     * Zugriff.
     */
    const direkt = ohneKommentare(folie).match(/daten\.frageText/gu) ?? [];
    expect(direkt).toHaveLength(1);
  });

  it('lässt die Vorschau jede Folie zeigen', () => {
    // Vorher zeigte sie nur das Einzelbild der Vorlage - und damit nie die
    // Frage-Folie und nie die Aufruf-Folie, auf denen Untertitel und Aufruf
    // als einzige stehen.
    expect(editor).toContain('vorschauAdresse(vorschauFolie)');
    expect(editor).toContain('FOLIEN_REIHE');
  });

  it('springt beim Bearbeiten auf die Folie, auf der das Feld steht', () => {
    expect(editor).toContain("setVorschauFolie('frage')");
    expect(editor).toContain("setVorschauFolie('cta')");
  });

  it('sagt, wenn «Serverlogo» ohne hochgeladenes Logo auf das Signet fällt', () => {
    // Die Auswahl wirkte, nur sah man nicht warum nicht: ohne Datei zeichnet
    // `logoFuerFolie` das Signet. Das ist die bessere Grafik und die
    // schlechtere Auskunft.
    expect(editor).toContain('serverlogoVorhanden');
    expect(editor).toContain('kein Serverlogo hochgeladen');
  });
});
