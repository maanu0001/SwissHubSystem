/**
 * Braucht dieses Deployment einen Wiederherstellungspunkt?
 *
 *   npx tsx scripts/migrationen-pruefen.ts [<alter-commit>]
 *
 * Ohne Argument werden ALLE Migrationen im Repository bewertet - das ist der
 * Modus fuer eine erste Einrichtung und fuer die Uebersicht. Mit einem Commit
 * werden nur die Migrationen bewertet, die seither hinzugekommen sind - das ist
 * der Modus der Pipeline.
 *
 * Ausgabe: ein JSON-Objekt auf stdout, und ein Rueckgabewert:
 *
 *   0  kein Wiederherstellungspunkt noetig
 *   1  einer noetig (destruktive oder unbekannte Migration)
 *   2  die Bewertung war nicht moeglich
 *
 * Die Pipeline liest den Rueckgabewert, ein Mensch die Ausgabe.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { bewerteMigrationen } from '../packages/database/src/migrations-bewertung';

const MIGRATIONS_DIR = join(process.cwd(), 'packages/database/prisma/migrations');

function alleMigrationen(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => {
      try {
        return statSync(join(MIGRATIONS_DIR, name)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
}

/**
 * Welche Migrationen seit einem Commit hinzugekommen sind.
 *
 * `git diff --diff-filter=A` nennt nur HINZUGEFUEGTE Dateien. Das ist die
 * richtige Frage: eine geaenderte Migrationsdatei ist ein Fehler eigener Art
 * (Prisma prueft ihre Pruefsumme und bricht ab), und eine geloeschte ist im
 * Repository nicht vorgesehen.
 */
function neueMigrationen(seit: string): string[] {
  try {
    const ausgabe = execFileSync(
      'git',
      ['diff', '--name-only', '--diff-filter=A', seit, 'HEAD', '--', 'packages/database/prisma/migrations'],
      { encoding: 'utf8' },
    );
    const namen = new Set<string>();
    for (const zeile of ausgabe.split('\n')) {
      // packages/database/prisma/migrations/<name>/migration.sql
      const treffer = /migrations\/([^/]+)\//u.exec(zeile.trim());
      if (treffer?.[1]) {
        namen.add(treffer[1]);
      }
    }
    return [...namen].sort();
  } catch (fehler) {
    process.stderr.write(
      `Der Vergleich mit «${seit}» war nicht moeglich: ${String(fehler)}\n` +
        'Es werden vorsichtshalber ALLE Migrationen bewertet - das ergibt hoechstens ' +
        'einen unnoetigen Wiederherstellungspunkt.\n',
    );
    return alleMigrationen();
  }
}

function lese(name: string): { name: string; sql: string } {
  try {
    return { name, sql: readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8') };
  } catch {
    // Eine Migration ohne SQL-Datei ist etwas, das hier nicht vorkommen soll.
    // Sie als leer zu behandeln waere die unvorsichtige Richtung: leer heisst
    // «unbedenklich». Ein Hinweis, der nicht zu einem der bekannten Muster
    // passt, wird dagegen als «unbekannt» gewertet.
    return { name, sql: '/* migration.sql fehlt */ UNBEKANNTE_ANWEISUNG;' };
  }
}

const seit = process.argv[2];
const namen = seit ? neueMigrationen(seit) : alleMigrationen();
const befund = bewerteMigrationen(namen.map(lese));

process.stdout.write(
  `${JSON.stringify(
    {
      verglichen_mit: seit ?? 'alle',
      anzahl: namen.length,
      braucht_recovery_point: befund.brauchtRecoveryPoint,
      zusammenfassung: befund.zusammenfassung,
      befunde: befund.befunde.filter((eintrag) => eintrag.bewertung !== 'vorwaertskompatibel'),
      vorwaertskompatibel: befund.befunde
        .filter((eintrag) => eintrag.bewertung === 'vorwaertskompatibel')
        .map((eintrag) => eintrag.name),
    },
    null,
    2,
  )}\n`,
);

process.exit(befund.brauchtRecoveryPoint ? 1 : 0);
