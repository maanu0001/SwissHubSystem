-- Der zentrale Fehler-Log.
--
-- Zwei Dinge: eine neue Log-Kategorie, damit sich ein Discord-Kanal dafuer
-- einrichten laesst, und die Tabelle, die gleiche Fehler zusammenfasst.
--
-- Die Kategorie wird NICHT automatisch auf einen Kanal gelegt. Ein Kanal, in
-- den ohne Zutun Fehler laufen, waere eine Entscheidung ueber einen fremden
-- Server; wer sie will, richtet sie unter Server -> Log-Kanaele ein.

ALTER TYPE "DiscordLogCategory" ADD VALUE IF NOT EXISTS 'ERRORS';

CREATE TYPE "ErrorLogSource" AS ENUM ('DISCORD_COMMAND', 'DISCORD_INTERACTION', 'BOT', 'WEBAPP');

CREATE TABLE "ErrorLogEntry" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "source" "ErrorLogSource" NOT NULL,
    "origin" TEXT NOT NULL,
    "code" TEXT,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "context" JSONB,
    "actorDiscordId" TEXT,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),
    "notifiedCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ErrorLogEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ErrorLogEntry_fingerprint_key" ON "ErrorLogEntry"("fingerprint");
CREATE INDEX "ErrorLogEntry_lastSeenAt_idx" ON "ErrorLogEntry"("lastSeenAt");
CREATE INDEX "ErrorLogEntry_source_lastSeenAt_idx" ON "ErrorLogEntry"("source", "lastSeenAt");
