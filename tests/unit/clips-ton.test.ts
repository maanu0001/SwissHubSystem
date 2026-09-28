import { describe, expect, it } from 'vitest';
import { erkenneContainer, erkenneTonformat, speichereVideo } from '@swisshub/modules/clips/video-speicher';

/**
 * Clip of the Week nimmt Videoclips - keine Tondateien.
 *
 * ## Die Entscheidung und ihr Grund
 *
 * Der Wettbewerb ist von Anfang bis Ende visuell: die Vorschau beim
 * Einreichen, die Ansicht der Moderation, die Kacheln der Abstimmung, die
 * Gewinnerkarte und der Discord-Beitrag zeigen alle ein Bild. Eine WAV- oder
 * MP3-Datei waere an jeder dieser Stellen ein leerer Kasten mit einem
 * Abspielknopf - in einer Reihe von Kacheln die eine, die niemand anklickt.
 *
 * Sie sauber zu unterstuetzen hiesse: eine Wellenform zeichnen, eine zweite
 * Kachelform bauen, der Moderation eine zweite Ansicht geben, der
 * Gewinnerkarte ein zweites Layout. Das ist eine Funktion, kein Dateiformat.
 *
 * Also **B**: ablehnen, und zwar mit einer Begruendung, die weiterhilft.
 *
 * ## Warum die Erkennung trotzdem noetig ist
 *
 * Eine WAV-Datei wuerde ohnehin abgelehnt - sie ist kein MP4 und kein WebM.
 * Zwei Dinge kaemen aber ohne diese Pruefung nicht heraus:
 *
 *  - Die Meldung waere «MOV, MKV und AVI spielen Browser nicht zuverlaessig
 *    ab - wandle den Clip vorher um». Ein Rat, der bei einer Tondatei ins
 *    Leere geht.
 *  - **M4A kaeme durch.** Es ist ein MP4-Container mit nur einer Tonspur,
 *    traegt dieselbe `ftyp`-Box und wird von `erkenneContainer` als `mp4`
 *    erkannt. Es waere im Player ein schwarzes Rechteck - der einzige Fall,
 *    in dem hier tatsaechlich etwas abgelehnt wird, das sonst durchginge.
 */

/** `RIFF` + Laenge + `WAVE`. */
function wav(): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes.set(
    [...'RIFF'].map((z) => z.charCodeAt(0)),
    0,
  );
  bytes.set([0x24, 0x00, 0x00, 0x00], 4);
  bytes.set(
    [...'WAVE'].map((z) => z.charCodeAt(0)),
    8,
  );
  return bytes;
}

function mitAnfang(text: string, laenge = 64): Uint8Array {
  const bytes = new Uint8Array(laenge);
  for (let i = 0; i < text.length; i += 1) {
    bytes[i] = text.charCodeAt(i);
  }
  return bytes;
}

/** Ein MP4-Kopf mit frei waehlbarer Marke. */
function ftyp(marke: string): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes.set([0x00, 0x00, 0x00, 0x20], 0);
  bytes.set([0x66, 0x74, 0x79, 0x70], 4);
  for (let i = 0; i < 4; i += 1) {
    bytes[8 + i] = marke.charCodeAt(i);
  }
  return bytes;
}

describe('Tonformate erkennen', () => {
  it('erkennt WAV an RIFF/WAVE', () => {
    expect(erkenneTonformat(wav())).toBe('WAV');
  });

  it('erkennt MP3 mit und ohne ID3-Kopf', () => {
    expect(erkenneTonformat(mitAnfang('ID3\u0003'))).toBe('MP3');
    // Ein Frame ohne ID3: elf gesetzte Bits als Synchronisationswort.
    const roh = new Uint8Array(64);
    roh[0] = 0xff;
    roh[1] = 0xfb;
    expect(erkenneTonformat(roh)).toBe('MP3');
  });

  it('erkennt OGG und FLAC', () => {
    expect(erkenneTonformat(mitAnfang('OggS'))).toBe('OGG');
    expect(erkenneTonformat(mitAnfang('fLaC'))).toBe('FLAC');
  });

  it('erkennt M4A - den Fall, der sonst als MP4 durchginge', () => {
    const datei = ftyp('M4A ');
    // Der Containerpruefung nach ist es ein MP4 ...
    expect(erkenneContainer(datei)).toBe('mp4');
    // ... und genau deshalb steht die Tonpruefung davor.
    expect(erkenneTonformat(datei)).toBe('M4A');
  });

  it('haelt ein echtes Video fuer kein Tonformat', () => {
    /*
     * Die Gegenrichtung. Ein Test, der nur Ablehnungen prueft, waere auch
     * gruen, wenn die Funktion immer «Ton» sagte - und dann kaeme kein
     * einziger Clip mehr durch.
     */
    expect(erkenneTonformat(ftyp('isom'))).toBeNull();
    expect(erkenneTonformat(ftyp('mp42'))).toBeNull();
    const webm = new Uint8Array(48);
    webm.set([0x1a, 0x45, 0xdf, 0xa3], 0);
    webm.set(
      [...'webm'].map((z) => z.charCodeAt(0)),
      12,
    );
    expect(erkenneTonformat(webm)).toBeNull();
  });

  it('haelt eine zu kurze Datei fuer kein Tonformat', () => {
    expect(erkenneTonformat(new Uint8Array(4))).toBeNull();
  });
});

describe('Eine Tondatei einreichen', () => {
  const GRENZE = 100 * 1024 * 1024;

  /**
   * Die Meldung, die das Mitglied sieht.
   *
   * `AppError.message` ist die interne Notiz fuers Log; was im Browser
   * ankommt, ist `userMessage`. Ein Test auf `message` wuerde also gruen, ohne
   * dass jemals jemand die Begruendung zu lesen bekommt - und genau die
   * Begruendung ist hier der Punkt.
   */
  async function meldung(aufruf: Promise<unknown>): Promise<string> {
    try {
      await aufruf;
    } catch (fehler) {
      return (fehler as { userMessage?: string }).userMessage ?? String(fehler);
    }
    throw new Error('Der Aufruf ist nicht gescheitert.');
  }

  it('wird abgelehnt und sagt, warum', async () => {
    expect(await meldung(speichereVideo(wav(), 'audio/wav', GRENZE))).toMatch(/Tondatei \(WAV\)/u);
  });

  it('nennt Clip of the Week beim Namen statt zum Umwandeln zu raten', async () => {
    /*
     * Der Unterschied, auf den es ankommt. «Wandle den Clip um» hilft bei
     * einer MOV-Datei; bei einer WAV ist es eine Sackgasse.
     */
    const text = await meldung(speichereVideo(wav(), 'audio/wav', GRENZE));
    expect(text).toMatch(/Videoclips/u);
    expect(text).not.toMatch(/wandle den Clip/u);
  });

  it('lehnt auch M4A ab, obwohl der Container ein MP4 ist', async () => {
    expect(await meldung(speichereVideo(ftyp('M4A '), null, GRENZE))).toMatch(/Tondatei \(M4A\)/u);
  });

  it('lehnt eine leere Datei weiterhin als leer ab', async () => {
    // Die Reihenfolge der Pruefungen darf sich durch die neue nicht verschieben.
    expect(await meldung(speichereVideo(new Uint8Array(0), 'video/mp4', GRENZE))).toMatch(/leer/u);
  });

  it('lehnt eine zu grosse Datei weiterhin an der Groesse ab', async () => {
    const gross = new Uint8Array(2048);
    gross.set(
      [...'RIFF'].map((z) => z.charCodeAt(0)),
      0,
    );
    expect(await meldung(speichereVideo(gross, null, 1024))).toMatch(/zu gross/u);
  });
});
