import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  anweisungen,
  bewerteMigration,
  bewerteMigrationen,
} from '../../packages/database/src/migrations-bewertung';

/**
 * Die Bewertung der Migrationen - das Tor des Deployments.
 *
 * Sie entscheidet, ob die Pipeline vor einer Migration einen
 * Wiederherstellungspunkt verlangt. Zwei Fehlerrichtungen, und sie kosten
 * unterschiedlich viel:
 *
 *   Falsch positiv  → ein unnoetiges Backup. Kostet Minuten.
 *   Falsch negativ  → eine Migration ohne Netz. Kostet Daten.
 *
 * Deshalb pruefen die Tests unten vor allem die zweite Richtung: was als
 * unbedenklich durchgeht, muss es wirklich sein.
 */
describe('Bewertung einer Migration', () => {
  describe('vorwaertskompatibel', () => {
    it.each([
      ['CREATE TABLE', 'CREATE TABLE "Neu" ("id" TEXT NOT NULL, CONSTRAINT "Neu_pkey" PRIMARY KEY ("id"));'],
      ['CREATE INDEX', 'CREATE INDEX "Neu_id_idx" ON "Neu"("id");'],
      ['CREATE UNIQUE INDEX', 'CREATE UNIQUE INDEX "Neu_id_key" ON "Neu"("id");'],
      ['CREATE TYPE', "CREATE TYPE \"Status\" AS ENUM ('A', 'B');"],
      ['ADD COLUMN nullbar', 'ALTER TABLE "Alt" ADD COLUMN "neu" TEXT;'],
      ['ADD COLUMN mit Standardwert', 'ALTER TABLE "Alt" ADD COLUMN "neu" BOOLEAN NOT NULL DEFAULT false;'],
      ['neuer Enum-Wert', 'ALTER TYPE "Status" ADD VALUE \'C\';'],
      ['ADD CONSTRAINT', 'ALTER TABLE "Alt" ADD CONSTRAINT "Alt_fk" FOREIGN KEY ("x") REFERENCES "Y"("id");'],
      ['SET DEFAULT', 'ALTER TABLE "Alt" ALTER COLUMN "x" SET DEFAULT 0;'],
      ['COMMENT ON', 'COMMENT ON TABLE "Alt" IS \'etwas\';'],
      ['INSERT mit festen Werten', 'INSERT INTO "Alt" ("id") VALUES (\'a\');'],
    ])('%s', (_name, sql) => {
      expect(bewerteMigration('t', sql).bewertung).toBe('vorwaertskompatibel');
    });

    it('erkennt ON UPDATE CASCADE nicht als datenveraendernd', () => {
      /*
       * Der Fehler, den die Pruefung einmal hatte.
       *
       * `\bUPDATE` traf auch das UPDATE in `ON UPDATE CASCADE`, und damit galt
       * praktisch jede Migration mit einem Fremdschluessel als
       * datenveraendernd. Eine Pruefung, die bei allem anspringt, sagt nichts
       * mehr - und der Schritt, den sie ausloest, wird dann abgeschaltet.
       */
      const sql = `
        ALTER TABLE "Kind" ADD CONSTRAINT "Kind_elternId_fkey"
          FOREIGN KEY ("elternId") REFERENCES "Eltern"("id")
          ON DELETE CASCADE ON UPDATE CASCADE;
      `;
      const befund = bewerteMigration('t', sql);
      expect(befund.bewertung, JSON.stringify(befund)).toBe('vorwaertskompatibel');
    });
  });

  describe('destruktiv', () => {
    it.each([
      ['DROP TABLE', 'DROP TABLE "Alt";'],
      ['DROP COLUMN', 'ALTER TABLE "Alt" DROP COLUMN "x";'],
      ['DROP TYPE', 'DROP TYPE "Status";'],
      ['RENAME COLUMN', 'ALTER TABLE "Alt" RENAME COLUMN "x" TO "y";'],
      ['RENAME TO', 'ALTER TABLE "Alt" RENAME TO "Neu";'],
      ['Typwechsel', 'ALTER TABLE "Alt" ALTER COLUMN "x" TYPE INTEGER;'],
      ['SET NOT NULL', 'ALTER TABLE "Alt" ALTER COLUMN "x" SET NOT NULL;'],
      ['DELETE FROM', 'DELETE FROM "Alt" WHERE "x" IS NULL;'],
      ['TRUNCATE', 'TRUNCATE TABLE "Alt";'],
      ['UPDATE', 'UPDATE "Alt" SET "x" = 1;'],
      ['DROP CONSTRAINT', 'ALTER TABLE "Alt" DROP CONSTRAINT "Alt_fk";'],
      ['DROP NOT NULL', 'ALTER TABLE "Alt" ALTER COLUMN "x" DROP NOT NULL;'],
      ['DROP INDEX', 'DROP INDEX "Alt_x_key";'],
      ['INSERT ... SELECT', 'INSERT INTO "Neu" ("id") SELECT "id" FROM "Alt";'],
      ['ADD COLUMN NOT NULL ohne Standardwert', 'ALTER TABLE "Alt" ADD COLUMN "neu" TEXT NOT NULL;'],
    ])('%s', (_name, sql) => {
      const befund = bewerteMigration('t', sql);
      expect(befund.bewertung, JSON.stringify(befund)).toBe('destruktiv');
      // Jeder Befund nennt einen Grund. Ein Abbruch ohne Begruendung wird
      // uebergangen.
      expect(befund.gruende.length).toBeGreaterThan(0);
    });
  });

  describe('unbekannt', () => {
    it('stuft eine unbekannte Anweisung als unbekannt ein - nicht als unbedenklich', () => {
      /*
       * Die Richtung, in die der Fehler gehen muss.
       *
       * Ein vollstaendiger SQL-Parser waere genauer und muesste jede
       * Erweiterung der Syntax mitverfolgen; was er nicht versteht, gibt er im
       * Zweifel als unbedenklich zurueck. Diese Pruefung tut das Gegenteil.
       */
      const befund = bewerteMigration('t', 'CLUSTER "Alt" USING "Alt_pkey";');
      expect(befund.bewertung).toBe('unbekannt');
      expect(befund.unbekannt.length).toBe(1);
    });

    it('verlangt fuer eine unbekannte Anweisung einen Wiederherstellungspunkt', () => {
      const gesamt = bewerteMigrationen([{ name: 't', sql: 'VACUUM FULL "Alt";' }]);
      expect(gesamt.brauchtRecoveryPoint).toBe(true);
    });
  });

  describe('Zerlegung in Anweisungen', () => {
    it('trennt an Semikolons', () => {
      expect(anweisungen('SELECT 1; SELECT 2;')).toEqual(['SELECT 1', 'SELECT 2']);
    });

    it('entfernt Zeilen- und Blockkommentare', () => {
      // Ein DROP TABLE in einem Kommentar ist kein DROP TABLE. Ohne diese
      // Behandlung waere jede ausfuehrlich kommentierte Migration destruktiv -
      // und in diesem Projekt sind alle ausfuehrlich kommentiert.
      const sql = `
        -- DROP TABLE "Alt";
        /* und hier auch: DROP COLUMN "x" */
        CREATE TABLE "Neu" ("id" TEXT);
      `;
      expect(bewerteMigration('t', sql).bewertung).toBe('vorwaertskompatibel');
    });

    it('trennt nicht an einem Semikolon in einer Zeichenkette', () => {
      const zerlegt = anweisungen('INSERT INTO "Alt" ("x") VALUES (\'a;b\'); SELECT 1;');
      expect(zerlegt).toHaveLength(2);
      expect(zerlegt[0]).toContain("'a;b'");
    });

    it('trennt nicht innerhalb eines Dollar-Blocks', () => {
      const sql =
        'CREATE FUNCTION f() RETURNS void AS $$ BEGIN PERFORM 1; PERFORM 2; END; $$ LANGUAGE plpgsql;';
      expect(anweisungen(sql)).toHaveLength(1);
    });

    it('kommt mit einem verdoppelten Anfuehrungszeichen zurecht', () => {
      const zerlegt = anweisungen('INSERT INTO "Alt" ("x") VALUES (\'a\'\'b\'); SELECT 1;');
      expect(zerlegt).toHaveLength(2);
    });
  });

  describe('Gesamtbewertung', () => {
    it('verlangt ohne Migration keinen Wiederherstellungspunkt', () => {
      const gesamt = bewerteMigrationen([]);
      expect(gesamt.brauchtRecoveryPoint).toBe(false);
      expect(gesamt.zusammenfassung).toContain('Keine neue Migration');
    });

    it('verlangt bei ausschliesslich vorwaertskompatiblen keinen', () => {
      const gesamt = bewerteMigrationen([
        { name: 'a', sql: 'CREATE TABLE "A" ("id" TEXT);' },
        { name: 'b', sql: 'CREATE INDEX "A_id" ON "A"("id");' },
      ]);
      expect(gesamt.brauchtRecoveryPoint).toBe(false);
    });

    it('verlangt bei einer einzigen destruktiven einen', () => {
      const gesamt = bewerteMigrationen([
        { name: 'a', sql: 'CREATE TABLE "A" ("id" TEXT);' },
        { name: 'b', sql: 'ALTER TABLE "A" DROP COLUMN "id";' },
      ]);
      expect(gesamt.brauchtRecoveryPoint).toBe(true);
      expect(gesamt.zusammenfassung).toContain('1 von 2');
    });
  });
});

/**
 * Die echten Migrationen dieses Projekts.
 *
 * Der Test prueft nicht, WIE sie bewertet werden - das wuerde bei jeder neuen
 * Migration brechen. Er prueft, dass die Bewertung ueberhaupt durchlaeuft und
 * ein brauchbares Ergebnis liefert: eine Ausnahme oder eine leere Antwort
 * hier wuerde das Tor im Deployment stillschweigend oeffnen.
 */
describe('Bewertung der tatsaechlichen Migrationen', () => {
  const verzeichnis = join(process.cwd(), 'packages/database/prisma/migrations');
  const namen = readdirSync(verzeichnis).filter((name) => {
    try {
      return statSync(join(verzeichnis, name)).isDirectory();
    } catch {
      return false;
    }
  });

  it('findet die Migrationen des Projekts', () => {
    expect(namen.length).toBeGreaterThan(50);
  });

  it('bewertet jede einzelne ohne Ausnahme', () => {
    for (const name of namen) {
      const sql = readFileSync(join(verzeichnis, name, 'migration.sql'), 'utf8');
      const befund = bewerteMigration(name, sql);
      expect(['vorwaertskompatibel', 'destruktiv', 'unbekannt']).toContain(befund.bewertung);
    }
  });

  it('haelt einen erheblichen Teil fuer vorwaertskompatibel', () => {
    /*
     * Eine Plausibilitaetsgrenze, keine genaue Zahl.
     *
     * Wuerde die Pruefung alles als destruktiv einstufen, verlangte jedes
     * Deployment ein Backup - und der Schritt wuerde abgeschaltet. Wuerde sie
     * alles fuer unbedenklich halten, greift das Tor nie. Beides faellt hier
     * auf, ohne dass der Test bei jeder neuen Migration nachgezogen werden
     * muss.
     */
    const befunde = namen.map((name) =>
      bewerteMigration(name, readFileSync(join(verzeichnis, name, 'migration.sql'), 'utf8')),
    );
    const gut = befunde.filter((befund) => befund.bewertung === 'vorwaertskompatibel').length;
    expect(gut / befunde.length).toBeGreaterThan(0.4);
    expect(gut).toBeLessThan(befunde.length);
  });

  it('haelt die neue Freigabe-Migration fuer vorwaertskompatibel', () => {
    // Sie legt einen Typ, eine Tabelle und zwei Indizes an - sie nimmt nichts
    // weg. Waere sie destruktiv bewertet, verlangte ihr eigenes Deployment
    // einen Wiederherstellungspunkt, und das waere hier falsch.
    const name = namen.find((eintrag) => eintrag.includes('restore_freigabe'));
    expect(name, 'Die Migration restore_freigabe fehlt').toBeDefined();
    const sql = readFileSync(join(verzeichnis, name as string, 'migration.sql'), 'utf8');
    const befund = bewerteMigration(name as string, sql);
    expect(befund.bewertung, JSON.stringify(befund)).toBe('vorwaertskompatibel');
  });
});
