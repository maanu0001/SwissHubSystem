import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Der Jail-Import beginnt mit einer Dateiauswahl - und die muss da sein.
 *
 * Sie war es zeitweise nicht. Der Assistent zeigte das Eingabefeld nur,
 * solange es gar keine Analyse gab; eine einzige liegengebliebene Analyse
 * oder ein Klick auf einen Eintrag der Verlaufsliste ersetzte es dauerhaft
 * durch die alte Vorschau. Von aussen sah das aus, als liesse sich keine
 * `.db` mehr auswählen.
 *
 * Die Fachlichkeit des Imports steht im Integrationstest gegen eine echte
 * Datenbank. Hier steht nur, was man davor nicht falsch machen darf.
 */

function lies(pfad: string): string {
  return readFileSync(join(process.cwd(), pfad), 'utf8');
}

const seite = lies('apps/web/src/app/(app)/moderation/jail/import/page.tsx');
const assistent = lies('apps/web/src/modules/jail/components/import-wizard.tsx');

describe('Die Dateiauswahl ist immer erreichbar', () => {
  it('steht auch dann auf der Seite, wenn eine Analyse offen ist', () => {
    // Zweimal eingebunden: oben, wenn nichts zu entscheiden ist - sonst
    // unter der Vorschau als «andere Datei».
    const vorkommen = seite.split('<ImportUploadStep').length - 1;
    expect(vorkommen).toBe(2);
    expect(seite).toContain('ueberschrift="Andere Datei hochladen"');
  });

  it('entscheidet über eine benannte Bedingung statt über eine Kette im JSX', () => {
    expect(seite).toContain('const nichtsZuEntscheiden =');
    expect(seite).toContain('{nichtsZuEntscheiden ? null : (');
  });

  it('gibt jedem Eingabefeld eine eigene Kennung', () => {
    // Zwei gleiche `id` auf einer Seite machten die Beschriftung mehrdeutig
    // und den zweiten Klick wirkungslos.
    expect(assistent).toContain('const feldId = useId();');
    expect(assistent).toContain('id={feldId}');
    expect(assistent).not.toContain('id="legacy-db"');
  });
});

describe('Der Dateidialog zeigt die .db an', () => {
  it('filtert über Endungen und nicht nur über MIME-Typen', () => {
    // Für SQLite gibt es keinen registrierten MIME-Typ. Ein Dialog, der nur
    // danach filtert, zeigte die Datei grau.
    expect(assistent).toContain("'.db,.sqlite,.sqlite3");
    expect(assistent).toContain('application/octet-stream');
  });

  it('sagt in der Beschriftung, welches Format gemeint ist', () => {
    expect(assistent).toContain('Datei (SQLite,');
  });

  it('verlässt sich für die Sicherheit nicht auf den Dialog', () => {
    // Die grosszügige Auswahl ist keine grosszügige Annahme: der Server
    // prüft die SQLite-Signatur, und nur er entscheidet.
    const leser = lies('packages/modules/src/jail/import/reader.ts');
    expect(leser).toContain("const SQLITE_MAGIC = 'SQLite format 3\\0'");
    expect(leser).toContain('readOnly: true');
  });
});

describe('Der Proxy lässt durch, was die Anwendung zulässt', () => {
  it('hält die nginx-Grenze über der grössten Import-Obergrenze', () => {
    // Sonst antwortet der Proxy mit 413, bevor die Anwendung die Datei
    // überhaupt sieht - und die Fehlermeldung käme von der falschen Stelle.
    const conf = lies('deploy/nginx/system.swisshub.gg.conf');
    const treffer = /client_max_body_size (\d+)m;/u.exec(conf);
    expect(treffer).not.toBeNull();

    const grenzeMb = Number(treffer?.[1]);
    const groesste = Math.max(
      ...['jail', 'level', 'spielersuche'].map((modul) => {
        const quelle = lies(`packages/modules/src/${modul}/import/reader.ts`);
        const zahl = /MAX_LEGACY_DB_BYTES = (\d+) \* 1024 \* 1024/u.exec(quelle);
        return Number(zahl?.[1] ?? 0);
      }),
    );

    expect(groesste).toBeGreaterThan(0);
    expect(grenzeMb).toBeGreaterThan(groesste);
  });
});
