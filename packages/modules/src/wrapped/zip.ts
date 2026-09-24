import { crc32 } from 'node:zlib';

/**
 * Ein ZIP-Archiv schreiben.
 *
 * ## Warum ohne Bibliothek
 *
 * Weil hier nichts komprimiert wird - und damit faellt der einzige schwere
 * Teil eines ZIP-Schreibers weg. PNG ist bereits Deflate-komprimiert; es
 * ein zweites Mal durch Deflate zu schicken kostet Rechenzeit und spart in
 * der Groessenordnung von Promille. Uebrig bleiben ein paar Kopfzeilen mit
 * festen Feldlaengen und eine Pruefsumme, die Node seit Version 22 selbst
 * mitbringt.
 *
 * Eine Abhaengigkeit dafuer waere ein Paket mehr in jedem Docker-Bau, eine
 * Datei mehr im Lieferumfang und eine Sicherheitsmeldung mehr im Jahr - fuer
 * achtzig Zeilen, die sich nie wieder aendern.
 *
 * ## Warum der Zeitstempel fest ist
 *
 * Damit dieselben Folien zweimal dasselbe Archiv ergeben. Ein Export soll
 * reproduzierbar sein; mit der aktuellen Uhrzeit im Kopf waere jede Datei
 * eine andere, auch wenn sich am Inhalt nichts geaendert hat.
 *
 * ## Was dieser Schreiber nicht kann
 *
 * Mehr als 4 GB, mehr als 65'535 Dateien, Verschluesselung, Ordner. Ein
 * Wrapped-Export hat fuenfzehn PNG von je ein paar hundert Kilobyte - alles
 * davon liegt um Groessenordnungen unter den Grenzen. Waere das anders,
 * gehoerte hier eine Bibliothek hin.
 */

export interface ZipEintrag {
  /** Dateiname im Archiv. Nur ASCII-Buchstaben, Ziffern, `-` und `.`. */
  name: string;
  daten: Uint8Array;
}

/** 1. Januar 1980, 00:00 - der frueheste Zeitpunkt, den ein ZIP kennt. */
const DOS_ZEIT = 0;
const DOS_DATUM = 0x0021;

const LOKAL_KOPF = 0x04034b50;
const ZENTRAL_KOPF = 0x02014b50;
const ENDE_KOPF = 0x06054b50;

/**
 * Der Dateiname - streng, und das ist Absicht.
 *
 * Ein Name mit `/` oder `..` darin waere ein Pfad, und ein Pfad in einem
 * Archiv ist die Zutat fuer «Zip Slip»: ein Entpacker, der ihm folgt,
 * schreibt die Datei irgendwohin. Die Namen kommen hier zwar aus dem eigenen
 * Code, aber ein Archiv ist eine Datei, die den Rechner wechselt - und was
 * darin steht, soll auch dann harmlos sein, wenn jemand den Code drumherum
 * eines Tages aendert.
 */
const NAME_MUSTER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u;

export function istGueltigerZipName(name: string): boolean {
  return NAME_MUSTER.test(name) && !name.includes('..');
}

function u16(wert: number): Buffer {
  const puffer = Buffer.allocUnsafe(2);
  puffer.writeUInt16LE(wert, 0);
  return puffer;
}

function u32(wert: number): Buffer {
  const puffer = Buffer.allocUnsafe(4);
  puffer.writeUInt32LE(wert >>> 0, 0);
  return puffer;
}

/**
 * Die Eintraege zu einem Archiv zusammensetzen.
 *
 * Alles im Speicher: bei fuenfzehn Bildern ist das ein paar Megabyte, und
 * ein Strom brauchte hier nur zusaetzliche Zustandshaltung. Wuerde das
 * Archiv je gross, waere ein Strom der naechste Schritt.
 */
export function baueZip(eintraege: readonly ZipEintrag[]): Buffer {
  if (eintraege.length === 0) {
    throw new Error('Ein Archiv ohne Dateien ergibt keinen Sinn.');
  }
  if (eintraege.length > 65_535) {
    throw new Error('Mehr als 65 535 Dateien kann dieser Schreiber nicht.');
  }

  const stuecke: Buffer[] = [];
  const zentral: Buffer[] = [];
  let versatz = 0;

  for (const eintrag of eintraege) {
    if (!istGueltigerZipName(eintrag.name)) {
      throw new Error(`Unzulässiger Dateiname im Archiv: ${eintrag.name}`);
    }
    const name = Buffer.from(eintrag.name, 'ascii');
    const daten = Buffer.from(eintrag.daten);
    const pruefsumme = crc32(daten);

    const lokal = Buffer.concat([
      u32(LOKAL_KOPF),
      u16(20), // benoetigte Fassung: 2.0
      u16(0), // keine Merkmale - insbesondere kein Datendeskriptor
      u16(0), // Verfahren 0 = gespeichert, nicht komprimiert
      u16(DOS_ZEIT),
      u16(DOS_DATUM),
      u32(pruefsumme),
      u32(daten.length),
      u32(daten.length),
      u16(name.length),
      u16(0), // kein Zusatzfeld
      name,
    ]);

    stuecke.push(lokal, daten);

    zentral.push(
      Buffer.concat([
        u32(ZENTRAL_KOPF),
        u16(20), // erstellt von Fassung 2.0
        u16(20),
        u16(0),
        u16(0),
        u16(DOS_ZEIT),
        u16(DOS_DATUM),
        u32(pruefsumme),
        u32(daten.length),
        u32(daten.length),
        u16(name.length),
        u16(0),
        u16(0), // kein Kommentar
        u16(0), // Diskette 0
        u16(0), // interne Merkmale
        u32(0), // externe Merkmale
        u32(versatz),
        name,
      ]),
    );

    versatz += lokal.length + daten.length;
  }

  const verzeichnis = Buffer.concat(zentral);
  const ende = Buffer.concat([
    u32(ENDE_KOPF),
    u16(0),
    u16(0),
    u16(eintraege.length),
    u16(eintraege.length),
    u32(verzeichnis.length),
    u32(versatz),
    u16(0),
  ]);

  return Buffer.concat([...stuecke, verzeichnis, ende]);
}
