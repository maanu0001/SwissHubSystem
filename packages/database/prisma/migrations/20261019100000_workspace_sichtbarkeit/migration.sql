-- Projektsichtbarkeit und Discord-Kanal je Projekt.
--
-- Additiv: bestehende Projekte sind `TEAM`, also genau so sichtbar wie
-- vorher. Niemand verliert den Zugang zu einem Projekt, das er gestern noch
-- gesehen hat.
CREATE TYPE "WorkspaceVisibility" AS ENUM ('TEAM', 'SELECTED_GROUPS', 'PRIVATE');

ALTER TABLE "WorkspaceProject"
  ADD COLUMN "visibility" "WorkspaceVisibility" NOT NULL DEFAULT 'TEAM',
  ADD COLUMN "visibleRoleIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "discordChannelId" TEXT;
