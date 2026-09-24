-- Der Spielekatalog bekommt seinen eigenen Namen.
--
-- Umbenannt, nicht neu angelegt: jede Kennung bleibt dieselbe, und damit
-- bleibt jeder Verweis aus Turnieren, Clips und Spielwahl gueltig. Ein neues
-- `Game` daneben haette bedeutet, tausende Fremdschluessel umzuhaengen - und
-- jede Zeile, die dabei danebengeht, ist ein Turnier ohne Spiel.
--
-- Diese Migration loescht nichts. Die Tabellen der Spielersuche bleiben
-- vorerst stehen; ihr Abbau steht in `deploy/sql/spielersuche-altbestand.sql`
-- und wird erst nach einer geprueften Sicherung ausgefuehrt.

-- 1. Tabelle und ihre Indizes -----------------------------------------------
ALTER TABLE "SpielersucheGame" RENAME TO "Game";
ALTER INDEX "SpielersucheGame_pkey" RENAME TO "Game_pkey";
ALTER INDEX "SpielersucheGame_nameKey_key" RENAME TO "Game_nameKey_key";
ALTER INDEX "SpielersucheGame_legacyId_key" RENAME TO "Game_legacyId_key";
ALTER INDEX "SpielersucheGame_enabled_name_idx" RENAME TO "Game_enabled_name_idx";

-- 2. Spalten, die nach Spielersuche klangen ----------------------------------
-- `RENAME COLUMN` und nicht «neu anlegen, kopieren, alt loeschen»: die Daten
-- bleiben unangetastet an Ort und Stelle.
ALTER TABLE "Game" RENAME COLUMN "bannerUrl" TO "coverUrl";
ALTER TABLE "Game" RENAME COLUMN "maxSquadSize" TO "maxPlayers";

-- Die Rolle, die beim Start einer Suche erwaehnt wurde. Ohne das Modul ohne
-- Verwendung - aber noch nicht geloescht, sondern nur freigegeben. Der Wert
-- bleibt lesbar, bis das Aufraeum-Skript laeuft.
ALTER TABLE "Game" ALTER COLUMN "roleId" DROP NOT NULL;

-- 3. Was ein Katalog ausserdem braucht ---------------------------------------
ALTER TABLE "Game" ADD COLUMN "shortName" TEXT;
ALTER TABLE "Game" ADD COLUMN "description" TEXT;
ALTER TABLE "Game" ADD COLUMN "genre" TEXT;
ALTER TABLE "Game" ADD COLUMN "platforms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Game" ADD COLUMN "coverPath" TEXT;
ALTER TABLE "Game" ADD COLUMN "archivedAt" TIMESTAMP(3);
CREATE INDEX "Game_archivedAt_idx" ON "Game"("archivedAt");

-- 4. Schnappschuss in den Vorschlaegen ----------------------------------------
-- Erst nullbar anlegen, aus dem Bestand fuellen, dann verbindlich machen. Eine
-- direkt gesetzte NOT-NULL-Spalte haette jede vorhandene Zeile zurueckgewiesen.
ALTER TABLE "SpielwahlCandidate" ADD COLUMN "nameSnapshot" TEXT;
ALTER TABLE "SpielwahlCandidate" ADD COLUMN "coverSnapshot" TEXT;

UPDATE "SpielwahlCandidate" AS c
SET "nameSnapshot" = g."name", "coverSnapshot" = g."coverUrl"
FROM "Game" AS g
WHERE c."gameId" = g."id";

-- Freie Vorschlaege und verwaiste Zeilen. Der Gedankenstrich ist dieselbe
-- Ersatzanzeige, die die Oberflaeche bisher zur Laufzeit gesetzt hat.
UPDATE "SpielwahlCandidate"
SET "nameSnapshot" = COALESCE(NULLIF(TRIM("freierName"), ''), '—')
WHERE "nameSnapshot" IS NULL;

ALTER TABLE "SpielwahlCandidate" ALTER COLUMN "nameSnapshot" SET NOT NULL;

-- 5. Ein geloeschtes Spiel darf keine Runde mitnehmen -------------------------
ALTER TABLE "SpielwahlCandidate" DROP CONSTRAINT "SpielwahlCandidate_gameId_fkey";
ALTER TABLE "SpielwahlCandidate"
  ADD CONSTRAINT "SpielwahlCandidate_gameId_fkey"
  FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE SET NULL ON UPDATE CASCADE;
