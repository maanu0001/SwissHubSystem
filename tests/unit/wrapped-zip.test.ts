import { describe, expect, it } from 'vitest';
/*
 * Ueber den Hauptzugang und nicht ueber einen Unterpfad: der Schreiber
 * braucht `node:zlib` und gehoert damit auf den Server. Ihn client-sicher zu
 * exportieren waere eine Einladung, ihn im Browser zu verwenden.
 */
import { wrapped } from '@swisshub/modules';

const { baueZip, istGueltigerZipName } = wrapped;

/**
 * Der ZIP-Schreiber.
 *
 * Geprueft wird der Aufbau am Byte: die drei Kennungen, die Anzahl der
 * Eintraege und die Reproduzierbarkeit. Dass ein echter Entpacker die Datei
 * oeffnet, laesst sich hier nicht pruefen - das ist von Hand geschehen und
 * steht in der Commit-Beschreibung.
 */

const daten = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('ZIP-Archiv', () => {
  it('beginnt mit der lokalen Kennung und endet mit dem Verzeichnisende', () => {
    const archiv = baueZip([{ name: '01-intro.png', daten: daten('eins') }]);
    expect(archiv.readUInt32LE(0)).toBe(0x04034b50);
    expect(archiv.readUInt32LE(archiv.length - 22)).toBe(0x06054b50);
  });

  it('haelt die Anzahl der Dateien im Verzeichnisende fest', () => {
    const archiv = baueZip([
      { name: '01-a.png', daten: daten('a') },
      { name: '02-b.png', daten: daten('b') },
      { name: '03-c.png', daten: daten('c') },
    ]);
    // Zwei Felder: Eintraege auf dieser Diskette und insgesamt.
    expect(archiv.readUInt16LE(archiv.length - 14)).toBe(3);
    expect(archiv.readUInt16LE(archiv.length - 12)).toBe(3);
  });

  it('speichert unkomprimiert und in voller Laenge', () => {
    const inhalt = daten('x'.repeat(5000));
    const archiv = baueZip([{ name: 'gross.png', daten: inhalt }]);
    // Verfahren 0 = gespeichert.
    expect(archiv.readUInt16LE(8)).toBe(0);
    // Komprimierte und unkomprimierte Groesse sind gleich.
    expect(archiv.readUInt32LE(18)).toBe(inhalt.length);
    expect(archiv.readUInt32LE(22)).toBe(inhalt.length);
  });

  it('ergibt zweimal dasselbe Archiv', () => {
    // Deshalb der feste Zeitstempel: ein Export soll reproduzierbar sein.
    const bauen = (): Buffer =>
      baueZip([
        { name: '01-intro.png', daten: daten('eins') },
        { name: '02-voice.png', daten: daten('zwei') },
      ]);
    expect(bauen().equals(bauen())).toBe(true);
  });

  it('laesst keinen Namen durch, der ein Pfad sein koennte', () => {
    /*
     * «Zip Slip»: ein Entpacker, der einem `../` folgt, schreibt die Datei
     * irgendwohin. Die Namen kommen hier aus dem eigenen Code - aber ein
     * Archiv wechselt den Rechner, und was darin steht, soll auch dann
     * harmlos sein, wenn der Code drumherum sich aendert.
     */
    for (const name of ['../flucht.png', 'a/b.png', 'a\\b.png', '', '.punkt', 'ä.png']) {
      expect(istGueltigerZipName(name), name).toBe(false);
      expect(() => baueZip([{ name, daten: daten('x') }])).toThrow();
    }
    expect(istGueltigerZipName('01-intro.png')).toBe(true);
  });

  it('nimmt kein leeres Archiv an', () => {
    expect(() => baueZip([])).toThrow();
  });
});
