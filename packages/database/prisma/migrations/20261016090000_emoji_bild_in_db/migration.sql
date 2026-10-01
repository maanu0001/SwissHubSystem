-- Die Bytes eines Emoji-Vorschlags wandern aus dem Upload-Verzeichnis in die
-- Datenbank.
--
-- Grund: das Upload-Volume ist fuer den Bot absichtlich nur lesbar gemountet
-- (docker-compose.prod.yml: «schreiben tut ausschliesslich die WebApp»). Ein
-- Vorschlag aus einem Slash Command scheiterte deshalb mit EROFS. Ein Emoji
-- ist bei Discord hart auf 256 KiB begrenzt - diese Bytes gehoeren in die
-- Datenbank, die Bot und WebApp ohnehin teilen.
--
-- Keine Datenwanderung: die Dateien des Altbestands liegen weiterhin im
-- Upload-Verzeichnis und werden von dort gelesen. `dateiName` wird nur
-- optional, bestehende Werte bleiben unveraendert stehen.

ALTER TABLE "EmojiAntrag" ALTER COLUMN "dateiName" DROP NOT NULL;

CREATE TABLE "EmojiAntragBild" (
    "antragId" TEXT NOT NULL,
    "daten" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmojiAntragBild_pkey" PRIMARY KEY ("antragId")
);

ALTER TABLE "EmojiAntragBild"
    ADD CONSTRAINT "EmojiAntragBild_antragId_fkey"
    FOREIGN KEY ("antragId") REFERENCES "EmojiAntrag"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
