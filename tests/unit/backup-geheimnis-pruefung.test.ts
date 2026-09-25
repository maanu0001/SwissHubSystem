import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Die Nachrechnung der Entschluesselung - gegen die echte Implementierung.
 *
 * ==========================================================================
 * WOZU DIESER TEST DA IST
 * ==========================================================================
 *
 * `deploy/backup/lib/geheimnis-pruefung.py` rechnet die Entschluesselung aus
 * `packages/secrets/src/crypto.ts` nach: AES-256-GCM, Umschlag
 * `v1.<kennung>.<iv>.<tag>.<geheimtext>`, Authentifizierungsanhang aus der
 * Adresse des Geheimnisses.
 *
 * Diese Doppelung ist gewollt. Der Restore-Test muss ohne Node, ohne Prisma
 * und ohne die Anwendung funktionieren - er laeuft gegen eine isolierte
 * Datenbank, und die Anwendung dort zu starten ist genau das, was er nicht
 * tun darf.
 *
 * Eine Doppelung ohne Absicherung laeuft aber auseinander. Aendert eines Tages
 * jemand das Umschlagformat oder den Anhang, dann sagt die Pruefung im
 * Restore-Test «alle Zugangsdaten lesbar», und sie liest in Wahrheit gar
 * nichts mehr. Das waere der schlimmste Zustand: ein gruener Haken, der eine
 * Annahme bestaetigt, die nicht mehr gilt.
 *
 * Dieser Test erzeugt deshalb einen Umschlag mit der ECHTEN Implementierung
 * und laesst ihn vom Python-Skript lesen. Weichen die beiden voneinander ab,
 * faellt er.
 * ==========================================================================
 */

const SKRIPT = join(process.cwd(), 'deploy/backup/lib/geheimnis-pruefung.py');

/** 32 Bytes in base64 - dasselbe Format wie MASTER_ENCRYPTION_KEY. */
const SCHLUESSEL = Buffer.from('swisshub-test-schluessel-32bytes').toString('base64');
const ANDERER = Buffer.from('anderer-test-schluessel-32bytes!').toString('base64');

interface Ergebnis {
  marke: string;
  gelesen: number;
  gescheitert: number;
  fremd: number;
  kennung: string;
}

/**
 * Das Skript aufrufen und seine eine Ausgabezeile zerlegen.
 *
 * Der Rueckgabewert wird ausdruecklich NICHT als Fehler behandelt: das Skript
 * gibt 2 zurueck, wenn eine Voraussetzung fehlt - und schreibt dabei die
 * FEHLER-Zeile, auf die es hier ankommt. `execFileSync` wuerde werfen und die
 * Ausgabe verschlucken.
 */
function pruefe(zeilen: string[], schluessel = SCHLUESSEL): Ergebnis {
  let ausgabe: string;
  try {
    ausgabe = execFileSync('python3', [SKRIPT], {
      input: zeilen.map((zeile) => `${zeile}\n`).join(''),
      encoding: 'utf8',
      env: { ...process.env, SWISSHUB_MASTER_KEY: schluessel },
    });
  } catch (fehler) {
    const abbruch = fehler as { stdout?: string | Buffer };
    ausgabe = String(abbruch.stdout ?? '');
  }

  const teile = ausgabe.trim().split(/\s+/u);
  return {
    marke: teile[0] ?? '',
    gelesen: Number(teile[1] ?? 0),
    gescheitert: Number(teile[2] ?? 0),
    fremd: Number(teile[3] ?? 0),
    kennung: teile[4] ?? '',
  };
}

/** Eine Zeile in der Form, die das Skript erwartet. */
function zeile(
  umschlag: string,
  adresse: { scope: 'GLOBAL' | 'GUILD'; guildId: string; provider: string; key: string },
): string {
  return [adresse.scope, adresse.guildId, adresse.provider, adresse.key, umschlag].join('\t');
}

describe('Geheimnis-Pruefung des Restore-Tests', () => {
  it('ist ueberhaupt vorhanden', () => {
    // Fehlt das Skript, faellt Stufe 6 des Restore-Tests stillschweigend aus.
    expect(existsSync(SKRIPT), `${SKRIPT} fehlt`).toBe(true);
  });

  it('liest einen Umschlag, den die echte Implementierung geschrieben hat', async () => {
    process.env.MASTER_ENCRYPTION_KEY = SCHLUESSEL;
    const { encryptSecret, keyId, readMasterKey } = await import('@swisshub/secrets');

    const adresse = { scope: 'GLOBAL' as const, guildId: '', provider: 'discord', key: 'botToken' };
    const umschlag = encryptSecret('ein-erfundener-bot-token-fuer-den-test', adresse);

    const ergebnis = pruefe([zeile(umschlag, adresse)]);

    expect(ergebnis.marke).toBe('OK');
    expect(ergebnis.gelesen).toBe(1);
    expect(ergebnis.gescheitert).toBe(0);
    expect(ergebnis.fremd).toBe(0);
    // Und die Kennung muss dieselbe sein, die die Anwendung bildet - daran
    // haengt die Aussage «der gesicherte Schluessel ist derselbe wie der
    // laufende».
    expect(ergebnis.kennung).toBe(keyId(readMasterKey({ MASTER_ENCRYPTION_KEY: SCHLUESSEL })!));
  });

  it('liest mehrere Umschlaege mit verschiedenen Adressen', async () => {
    process.env.MASTER_ENCRYPTION_KEY = SCHLUESSEL;
    const { encryptSecret } = await import('@swisshub/secrets');

    const adressen = [
      { scope: 'GLOBAL' as const, guildId: '', provider: 'discord', key: 'botToken' },
      { scope: 'GLOBAL' as const, guildId: '', provider: 'discord', key: 'clientSecret' },
      { scope: 'GLOBAL' as const, guildId: '', provider: 'ai', key: 'apiKey' },
      { scope: 'GUILD' as const, guildId: '100000000000000001', provider: 'bot:musik', key: 'token' },
    ];

    const zeilen = adressen.map((adresse, index) => zeile(encryptSecret(`wert-${index}`, adresse), adresse));

    const ergebnis = pruefe(zeilen);
    expect(ergebnis.gelesen).toBe(adressen.length);
    expect(ergebnis.gescheitert).toBe(0);
  });

  it('erkennt einen Umschlag aus einer anderen Schluesselgeneration - und zaehlt ihn getrennt', async () => {
    // Der Unterschied ist wichtig: «mit anderem Schluessel verschluesselt» ist
    // ein anderer Befund als «beschaedigt». Der erste heisst, dass jemand den
    // Hauptschluessel gewechselt hat, ohne die Werte neu zu hinterlegen; der
    // zweite heisst, dass die Daten kaputt sind.
    process.env.MASTER_ENCRYPTION_KEY = ANDERER;
    const { encryptSecret } = await import('@swisshub/secrets');
    const adresse = { scope: 'GLOBAL' as const, guildId: '', provider: 'discord', key: 'botToken' };
    const umschlag = encryptSecret('wert', adresse);

    const ergebnis = pruefe([zeile(umschlag, adresse)], SCHLUESSEL);
    expect(ergebnis.marke).toBe('OK');
    expect(ergebnis.fremd).toBe(1);
    expect(ergebnis.gescheitert).toBe(0);
    expect(ergebnis.gelesen).toBe(0);
  });

  it('erkennt einen Umschlag, der an eine andere Adresse gehoert', async () => {
    // Der Authentifizierungsanhang deckt die Adresse des Geheimnisses ab.
    // Genau deshalb laesst sich ein Geheimtext nicht von einer Zeile in eine
    // andere kopieren - und genau das muss die Nachrechnung ebenso erkennen,
    // sonst prueft sie weniger als die Anwendung.
    process.env.MASTER_ENCRYPTION_KEY = SCHLUESSEL;
    const { encryptSecret } = await import('@swisshub/secrets');

    const echt = { scope: 'GLOBAL' as const, guildId: '', provider: 'discord', key: 'botToken' };
    const umschlag = encryptSecret('wert', echt);
    const verschoben = { ...echt, key: 'clientSecret' };

    const ergebnis = pruefe([zeile(umschlag, verschoben)]);
    expect(ergebnis.gescheitert).toBe(1);
    expect(ergebnis.gelesen).toBe(0);
  });

  it('erkennt einen beschaedigten Umschlag', () => {
    const ergebnis = pruefe([
      zeile('v1.deadbeef.kaputt', {
        scope: 'GLOBAL',
        guildId: '',
        provider: 'discord',
        key: 'botToken',
      }),
    ]);
    expect(ergebnis.gescheitert).toBe(1);
  });

  it('meldet einen Schluessel, der keine 32 Bytes ergibt, als Voraussetzungsfehler', () => {
    // Und NICHT als «Entschluesselung gescheitert». Der Unterschied
    // entscheidet, was ein Administrator tut: das eine ist ein falsch
    // eingetragener Schluessel, das andere sind verlorene Daten.
    const ergebnis = pruefe([], 'zu-kurz');
    expect(ergebnis.marke).toBe('FEHLER');
  });

  it('kommt mit einer leeren Eingabe zurecht', () => {
    const ergebnis = pruefe([]);
    expect(ergebnis.marke).toBe('OK');
    expect(ergebnis.gelesen).toBe(0);
    expect(ergebnis.gescheitert).toBe(0);
  });

  it('ueberspringt unbrauchbare Zeilen, statt abzubrechen', () => {
    // Eine Zeile mit zu wenig Feldern ist ein Fehler in der Abfrage und kein
    // Grund, die ganze Pruefung abzubrechen - sonst entwertet eine einzelne
    // krumme Zeile den Befund ueber alle uebrigen.
    const ergebnis = pruefe(['nur\tdrei\tfelder', '']);
    expect(ergebnis.marke).toBe('OK');
  });
});
