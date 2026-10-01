import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Der Bot schreibt nicht in das Upload-Verzeichnis.
 *
 * ## Warum es diesen Test gibt
 *
 * Weil die Regel einmal gebrochen wurde und niemand es merkte, bis jemand
 * `/emoji_request` benutzte. `docker-compose.prod.yml` mountet das
 * Upload-Volume fuer den Bot mit `:ro` - «schreiben tut ausschliesslich die
 * WebApp». Das Emoji-Modul legte die Bytes eines Vorschlags trotzdem als Datei
 * dort ab. Im Bot wurde daraus `EROFS`, und die Person sah «Das
 * Upload-Verzeichnis auf dem Server ist nicht beschreibbar».
 *
 * Ein Typ faengt das nicht: `writeFile` ist in beiden Prozessen dieselbe
 * Funktion, und welcher Container sie ausfuehrt, steht nicht im Code. Was den
 * Fehler faengt, ist diese Zusicherung - und sie muss an der Datei haengen,
 * nicht an einem Ablauf: wer hier wieder eine Datei anlegt, soll es im Test
 * erfahren und nicht im Betrieb.
 *
 * ## Warum lesend erlaubt bleibt
 *
 * Vorschlaege von vor der Umstellung haben ihre Bytes noch als Datei. Sie
 * werden von dort gelesen und, wo es geht, geloescht. Lesen ist unter `:ro`
 * erlaubt; Loeschen scheitert im Bot still und gelingt in der WebApp.
 */
describe('Emoji-Speicher: keine Schreibzugriffe auf das Upload-Verzeichnis', () => {
  const quelle = readFileSync('packages/modules/src/emoji/speicher.ts', 'utf8');

  /** Kommentare raus - ein Wort in einer Erklaerung ist kein Aufruf. */
  const ohneKommentare = quelle
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/^\s*\/\/.*$/gmu, '');

  it.each(['writeFile', 'appendFile', 'mkdir', 'createWriteStream', 'copyFile', 'rename'])(
    'ruft %s nicht auf',
    (verboten) => {
      expect(ohneKommentare).not.toContain(verboten);
    },
  );

  it('liest und loescht weiterhin - der Altbestand liegt noch als Datei', () => {
    expect(ohneKommentare).toContain('readFile');
    expect(ohneKommentare).toContain('rm(');
  });

  it('legt die Bytes in EmojiAntragBild ab', () => {
    expect(ohneKommentare).toContain('emojiAntragBild');
  });
});

/**
 * Und der Bot-Mount bleibt, was er ist.
 *
 * Die eigentliche Zusicherung steht in der Compose-Datei, nicht im Code. Wer
 * sie aufweicht, um einen Schreibzugriff zu ermoeglichen, hat das Problem nicht
 * geloest, sondern die Regel aufgegeben - und das soll nicht unbemerkt gehen.
 */
describe('docker-compose.prod.yml: der Bot bekommt das Upload-Volume nur lesbar', () => {
  const compose = readFileSync('docker-compose.prod.yml', 'utf8');

  it('mountet swisshub-uploads im Bot mit :ro', () => {
    const botAbschnitt = compose.slice(compose.indexOf('\n  bot:'), compose.indexOf('\n  music-runtime:'));
    expect(botAbschnitt).toContain('swisshub-uploads:/var/lib/swisshub/uploads:ro');
  });

  it('mountet es in der WebApp schreibbar - dort entstehen Logo und Clipdateien', () => {
    const webAbschnitt = compose.slice(compose.indexOf('\n  web:'), compose.indexOf('\n  bot:'));
    expect(webAbschnitt).toContain('swisshub-uploads:/var/lib/swisshub/uploads\n');
  });

  it('setzt nirgends chmod 777', () => {
    expect(compose).not.toContain('777');
  });
});
