-- Workspace: welche Projektereignisse in den Discord-Kanal gehen.
--
-- Rein additiv. `discordUpdates` steht auf `true`, weil ein Projekt mit
-- eingetragenem Kanal bisher immer gemeldet hat - ein Vorgabewert `false`
-- waere eine stille Abschaltung bestehender Projekte.
--
-- `discordEvents` bleibt leer: die Vorgabe setzt das Modul beim Anlegen, und
-- bestehende Projekte bekommen sie in derselben Migration weiter unten.
ALTER TABLE "WorkspaceProject"
  ADD COLUMN IF NOT EXISTS "discordUpdates" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "discordEvents" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "discordFehlerAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "discordFehlerText" TEXT;

-- Bestehende Projekte behalten genau das, was sie bisher bekamen: eine
-- Meldung bei neuer Aufgabe, bei erledigter, bei blockierter und bei einem
-- erreichten Meilenstein. Alles Weitere ist neu und bleibt abgeschaltet,
-- damit aus diesem Deployment kein unangekuendigter Mehrverkehr in fremden
-- Kanaelen wird.
UPDATE "WorkspaceProject"
SET "discordEvents" = ARRAY['task.created', 'task.done', 'task.blocked', 'milestone.done']::TEXT[]
WHERE "discordChannelId" IS NOT NULL
  AND cardinality("discordEvents") = 0;

-- XP-Slot: das Embed von `/xp-slot` wird im Dashboard gepflegt.
-- Alle Textfelder bleiben leer; leer heisst «Vorgabe aus dem Code».
ALTER TABLE "XpSlotConfig"
  ADD COLUMN IF NOT EXISTS "commandEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "commandTitle" TEXT,
  ADD COLUMN IF NOT EXISTS "commandDescription" TEXT,
  ADD COLUMN IF NOT EXISTS "commandColor" TEXT,
  ADD COLUMN IF NOT EXISTS "commandButtonLabel" TEXT,
  ADD COLUMN IF NOT EXISTS "commandFooter" TEXT,
  ADD COLUMN IF NOT EXISTS "commandThumbnailUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "commandImageUrl" TEXT;
