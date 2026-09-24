-- Abbau des Spielersuche-Altbestands
-- ===================================
--
-- NICHT AUTOMATISCH. Dieses Skript liegt bewusst neben `prisma/migrations`
-- und nicht darin: `prisma migrate deploy` fuehrt alles aus, was im
-- Migrationsordner liegt, und das hier soll niemand versehentlich ausloesen.
--
-- ## Warum es getrennt ist
--
-- Der Spielekatalog ist bereits umgezogen (Migration
-- `20260925090000_spielekatalog`) - umbenannt, mit denselben Kennungen, alle
-- Verweise aus Turnieren, Clips und Spielwahl gueltig. Was hier faellt, sind
-- die Tabellen der Spielersuche selbst: vergangene Suchen, Teilnahmen,
-- Sprachzeiten, Nutzungszaehler und die Uebernahme aus der Altdatenbank.
--
-- Kein Programmteil liest sie noch. Aber es sind Betriebsdaten von Monaten,
-- und ein DROP nimmt man nicht zurueck. Deshalb laeuft das hier erst, wenn
-- jemand eine Sicherung geprueft hat - nicht, weil sie existiert, sondern
-- weil sie sich wiederherstellen laesst.
--
-- ## Vorher
--
--   1. Sichern:
--        sudo /usr/local/bin/swisshub-backup
--        ls -lh /var/backups/swisshub/
--
--   2. Die Sicherung tatsaechlich einspielen - in eine Wegwerf-Datenbank,
--      nicht in die produktive:
--        createdb swisshub_restoretest
--        gunzip -c /var/backups/swisshub/<datei>.sql.gz | psql swisshub_restoretest
--        psql swisshub_restoretest -c 'SELECT COUNT(*) FROM "SpielersucheMatch";'
--
--      Kommt dort eine plausible Zahl heraus, ist die Sicherung brauchbar.
--      Kommt ein Fehler, ist sie es nicht - dann hier nicht weitermachen.
--
--   3. Erst dann:
--        psql "$DATABASE_URL" -f deploy/sql/spielersuche-altbestand.sql
--
--   4. Danach in `packages/database/prisma/schema.prisma` die Modelle
--      `SpielersucheMatch`, `SpielersucheParticipant`, `SpielersucheRolePing`,
--      `SpielersucheUsage`, `SpielersucheVoiceSession`, `SpielersucheImport`,
--      `SpielersucheImportItem`, die fuenf `Spielersuche*`-Aufzaehlungstypen
--      und `Game.roleId` entfernen und eine leere Migration erzeugen, die den
--      Stand festhaelt:
--        prisma migrate dev --name spielersuche-altbestand-entfernt --create-only
--      Der erzeugte SQL-Inhalt darf durch `-- bereits ausgefuehrt` ersetzt
--      werden, wenn dieses Skript produktiv schon gelaufen ist.
--
-- ## Was bleibt
--
-- Die Audit-Eintraege. Sie stehen in `AuditLog` und nicht hier; die
-- Beweiskette der Spielersuche bleibt vollstaendig lesbar.

BEGIN;

-- Reihenfolge nach Abhaengigkeit: was auf andere zeigt, faellt zuerst.
DROP TABLE IF EXISTS "SpielersucheImportItem";
DROP TABLE IF EXISTS "SpielersucheVoiceSession";
DROP TABLE IF EXISTS "SpielersucheParticipant";
DROP TABLE IF EXISTS "SpielersucheMatch";
DROP TABLE IF EXISTS "SpielersucheImport";
DROP TABLE IF EXISTS "SpielersucheRolePing";
DROP TABLE IF EXISTS "SpielersucheUsage";

DROP TYPE IF EXISTS "SpielersucheImportAction";
DROP TYPE IF EXISTS "SpielersucheImportKind";
DROP TYPE IF EXISTS "SpielersucheImportStatus";
DROP TYPE IF EXISTS "SpielersucheSource";
DROP TYPE IF EXISTS "SpielersucheStatus";

-- Die letzte Spalte, die nach Spielersuche klang.
ALTER TABLE "Game" DROP COLUMN IF EXISTS "roleId";

COMMIT;
