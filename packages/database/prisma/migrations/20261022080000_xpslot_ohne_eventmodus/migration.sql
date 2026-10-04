-- Der Eventmodus des XP-Slots wird entfernt.
--
-- Er war eine zweite Konfiguration: eine Tabelle mit JSON-Feldern, die Teile
-- von "XpSlotConfig" ueberschrieb, solange ein Event lief. Damit war keine
-- Zahl im Dashboard mehr verlaesslich - man musste wissen, ob gerade ein
-- Event laeuft, um eine Auszahlung richtig zu lesen.
--
-- Was mit den Daten passiert:
--
--  * Ein Slot, der auf EVENT_ONLY stand, war ohne laufendes Event gesperrt.
--    Er wird auf MAINTENANCE gesetzt und damit nicht stillschweigend fuer
--    alle geoeffnet - das Team entscheidet, wann es aufmacht.
--  * Die Eventzuordnung der bisherigen Spins faellt weg. Die Spins selbst
--    bleiben vollstaendig: Einsatz, Spielfeld, Gewinn und die Spielnotiz in
--    "configNote" stehen weiterhin da, und darin standen die wirksamen Werte
--    des Spins - also auch die, die ein Event beigetragen hat.
--  * Die Eventtabelle selbst wird geloescht. Sie beschreibt eine Funktion,
--    die es nicht mehr gibt; eine stehengelassene Tabelle waere eine
--    Einladung, sie wieder anzuschliessen.
--
-- Die Pruefspur bleibt unangetastet: die Eintraege XP_SLOT_EVENT_* und ihre
-- Beschriftungen bestehen weiter, damit nachlesbar bleibt, dass es Events gab.

UPDATE "XpSlotConfig" SET "status" = 'MAINTENANCE' WHERE "status" = 'EVENT_ONLY';

ALTER TABLE "XpSlotSpin" DROP CONSTRAINT IF EXISTS "XpSlotSpin_eventId_fkey";
ALTER TABLE "XpSlotSpin" DROP COLUMN IF EXISTS "eventId";

ALTER TABLE "XpSlotEvent" DROP CONSTRAINT IF EXISTS "XpSlotEvent_soundPackId_fkey";
DROP TABLE IF EXISTS "XpSlotEvent";

-- Der Aufzaehlungstyp ohne EVENT_ONLY. Postgres kann einen Wert nicht
-- entfernen; der Typ wird deshalb neu gebaut und die Spalte umgehaengt. Die
-- Vorgabe wird vorher abgeraeumt, weil sie sonst am alten Typ haengt.
ALTER TYPE "XpSlotStatus" RENAME TO "XpSlotStatus_alt";
CREATE TYPE "XpSlotStatus" AS ENUM ('ACTIVE', 'MAINTENANCE', 'DISABLED');
ALTER TABLE "XpSlotConfig" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "XpSlotConfig"
  ALTER COLUMN "status" TYPE "XpSlotStatus" USING ("status"::text::"XpSlotStatus");
ALTER TABLE "XpSlotConfig" ALTER COLUMN "status" SET DEFAULT 'DISABLED';
DROP TYPE "XpSlotStatus_alt";
