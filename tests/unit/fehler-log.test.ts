import { describe, expect, it } from 'vitest';
import { AppError } from '../../packages/shared/src/errors';
import {
  bereinige,
  bereinigeKontext,
  fingerprintVon,
  istMeldepflichtig,
} from '../../packages/modules/src/logs/fehler';
import { LOG_KATEGORIEN } from '../../packages/modules/src/logs/registry';

/**
 * Der Fehler-Log ist die Stelle, an der ein Geheimnis am leichtesten landet.
 *
 * Eine Fehlermeldung zitiert die Anfrage, die sie ausgeloest hat - und eine
 * Anfrage an Discord traegt den Bot-Token in der `Authorization`-Kopfzeile,
 * eine Datenbankmeldung die Verbindungszeichenfolge mitsamt Passwort. Beides
 * ginge ohne Bereinigung in einen Discord-Kanal, den das halbe Team liest.
 *
 * Diese Tests sind deshalb keine Formalie: sie sind die Zusage, dass der Weg
 * in die Tabelle durch `bereinige` fuehrt und was dabei ueberlebt.
 */

/**
 * Eine Attrappe in der Form eines Discord-Bot-Tokens.
 *
 * Zusammengesetzt und nicht als Zeichenkette hingeschrieben - aus einem
 * Grund, der beim ersten Versuch zuschlug: GitHubs Push Protection erkennt
 * die **Form** und lehnt den Push ab. Sie hat damit recht, auch wenn der
 * Wert erfunden ist: ein Literal dieser Form im Repository ist fuer jeden
 * Scanner ein Fund, und jeder spaetere Push bliebe daran haengen.
 *
 * Fuer den Test aendert das nichts. Geprueft wird `bereinige`, und die
 * arbeitet auf dem Wert zur Laufzeit - nicht auf dem Quelltext.
 */
function tokenAttrappe(): string {
  const teile = ['MTIzNDU2Nzg5MDEyMzQ1Njc4', 'GaBcDe', 'A'.repeat(28)];
  return teile.join('.');
}

describe('bereinige', () => {
  it('entfernt einen Discord-Bot-Token', () => {
    const attrappe = tokenAttrappe();
    const sauber = bereinige(`Request failed: Authorization: Bot ${attrappe}`);
    expect(sauber).not.toContain(attrappe);
    for (const teil of attrappe.split('.')) {
      expect(sauber, teil).not.toContain(teil);
    }
  });

  it('entfernt den Wert hinter Bearer', () => {
    const sauber = bereinige('fetch 401: Bearer abcdef1234567890abcdef');
    expect(sauber).toContain('Bearer [entfernt]');
    expect(sauber).not.toContain('abcdef1234567890abcdef');
  });

  it('entfernt das Passwort aus einer Verbindungszeichenfolge', () => {
    const sauber = bereinige('connect ECONNREFUSED postgresql://swisshub:gehe1mnis@db:5432/app');
    expect(sauber).not.toContain('gehe1mnis');
    expect(sauber).toContain('postgresql://[zugang]@db:5432/app');
  });

  it('entfernt benannte Werte, gleich in welcher Schreibweise', () => {
    for (const roh of [
      'token=xyz987abc',
      '"secret": "xyz987abc"',
      "password: 'xyz987abc'",
      'api_key=xyz987abc',
      'apiKey: xyz987abc',
    ]) {
      expect(bereinige(roh), roh).not.toContain('xyz987abc');
    }
  });

  it('entfernt E-Mail-Adressen', () => {
    // Personenbezogen und in einem Fehlerkanal nicht noetig.
    const sauber = bereinige('Kein Konto fuer vorname.nachname@example.com gefunden');
    expect(sauber).not.toContain('@example.com');
    expect(sauber).toContain('[email]');
  });

  it('entfernt lange Zeichenfolgen, die niemand benannt hat', () => {
    const lang = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0UV';
    expect(bereinige(`unerwartet: ${lang}`)).not.toContain(lang);
  });

  it('laesst den Stapel lesbar - Pfade bleiben stehen', () => {
    /*
     * Die Gegenprobe zur Regel darueber, und die wichtigste hier.
     *
     * Das allgemeine Muster hiess zuerst `[A-Za-z0-9+/_-]{40,}` - mit
     * Schraegstrich. Damit verschwand jeder Dateipfad im Stapel als `[lang]`,
     * und der Log war technisch sauber und praktisch wertlos: er sagte, dass
     * etwas kaputt ist, aber nicht wo.
     */
    const stapel =
      'TypeError: x is not a function\n    at ladeProfil (/app/packages/modules/src/profile/service.ts:120:7)';
    const sauber = bereinige(stapel);
    expect(sauber).toContain('/app/packages/modules/src/profile/service.ts');
    expect(sauber).toContain('ladeProfil');
  });
});

describe('bereinigeKontext', () => {
  it('ersetzt den Wert eines heiklen Schluessels vollstaendig', () => {
    const sauber = bereinigeKontext({ authorization: 'kurz', sessionToken: 'kurz' });
    // Nicht bereinigt, sondern ersetzt: bei einem Feld namens `authorization`
    // ist der Inhalt definitionsgemaess geheim - kein Muster muss das erst
    // erkennen, und ein kurzer Wert entgeht jedem Muster.
    expect(sauber).toEqual({ authorization: '[entfernt]', sessionToken: '[entfernt]' });
  });

  it('reicht kein Objekt durch', () => {
    /*
     * Der Griff, mit dem ein ganzes Request-Objekt in die Tabelle rutscht.
     * Wer ein Feld aus einem Objekt braucht, gibt es einzeln mit.
     */
    const sauber = bereinigeKontext({ anfrage: { headers: { cookie: 'session=geheim' } } });
    expect(sauber).toEqual({ anfrage: '[object]' });
  });

  it('bereinigt auch gewoehnliche Werte', () => {
    const sauber = bereinigeKontext({ meldung: 'fehlgeschlagen fuer a@b.ch' });
    expect(sauber?.meldung).toContain('[email]');
  });

  it('gibt nichts zurueck, wenn nichts uebrig bleibt', () => {
    expect(bereinigeKontext({})).toBeUndefined();
    expect(bereinigeKontext({ a: null, b: undefined })).toBeUndefined();
    expect(bereinigeKontext(undefined)).toBeUndefined();
  });
});

describe('fingerprintVon', () => {
  const basis = { source: 'WEBAPP', origin: 'action:profil.allgemein', code: 'INTERNAL' } as const;

  it('fasst denselben Fehler mit verschiedenen Kennungen zusammen', () => {
    /*
     * Der ganze Zweck der Entstellung. Ohne sie waere «Mitglied 123 nicht
     * gefunden» ein anderer Fehler als «Mitglied 456 nicht gefunden» - zwei
     * Zeilen, zwei Meldungen, derselbe Bug.
     */
    const links = fingerprintVon({ ...basis, message: 'Mitglied 123456789012345678 nicht gefunden' });
    const rechts = fingerprintVon({ ...basis, message: 'Mitglied 987654321098765432 nicht gefunden' });
    expect(links).toBe(rechts);
  });

  it('unterscheidet verschiedene Fehler', () => {
    const links = fingerprintVon({ ...basis, message: 'Mitglied nicht gefunden' });
    const rechts = fingerprintVon({ ...basis, message: 'Spiel nicht gefunden' });
    expect(links).not.toBe(rechts);
  });

  it('unterscheidet denselben Fehler an verschiedenen Orten', () => {
    const links = fingerprintVon({ ...basis, message: 'kaputt' });
    const rechts = fingerprintVon({ ...basis, origin: '/u/[slug]', message: 'kaputt' });
    expect(links).not.toBe(rechts);
  });

  it('passt in die Spalte', () => {
    expect(fingerprintVon({ ...basis, message: 'x'.repeat(5000) })).toHaveLength(40);
  });
});

describe('istMeldepflichtig', () => {
  it('meldet keine Antwort an einen Benutzer', () => {
    /*
     * «Dir fehlt die Berechtigung» ist eine Antwort des Systems und kein
     * Fehler. Sie in einen Fehlerkanal zu schreiben hiesse, ihn mit dem
     * Normalbetrieb zu fluten - und die paar Faelle, die wirklich jemand
     * ansehen muss, darin zu begraben.
     */
    for (const code of ['FORBIDDEN', 'VALIDATION_FAILED', 'NOT_FOUND', 'RATE_LIMITED'] as const) {
      expect(istMeldepflichtig(new AppError(code)), code).toBe(false);
    }
  });

  it('meldet, was niemand vorhergesehen hat', () => {
    expect(istMeldepflichtig(new AppError('INTERNAL'))).toBe(true);
    expect(istMeldepflichtig(new AppError('CONFIGURATION_MISSING'))).toBe(true);
    expect(istMeldepflichtig(new AppError('SECRET_UNREADABLE'))).toBe(true);
  });

  it('meldet jeden Fehler, der kein AppError ist', () => {
    // Ein `TypeError` ist nie eine Antwort an einen Benutzer.
    expect(istMeldepflichtig(new TypeError('x is not a function'))).toBe(true);
    expect(istMeldepflichtig('kaputt')).toBe(true);
    expect(istMeldepflichtig(undefined)).toBe(true);
  });
});

describe('die Kategorie ist einrichtbar', () => {
  it('steht in der Registry', () => {
    /*
     * Ohne Eintrag gaebe es die Kategorie im Enum, aber kein Auswahlfeld
     * unter Server -> Log-Kanaele - und damit keinen Weg, einen Kanal dafuer
     * zu bestimmen. Der Log liefe und erreichte niemanden.
     */
    const eintrag = LOG_KATEGORIEN.find((kandidat) => kandidat.id === 'ERRORS');
    expect(eintrag).toBeDefined();
    expect(eintrag?.label).toBe('Fehler');
  });
});
