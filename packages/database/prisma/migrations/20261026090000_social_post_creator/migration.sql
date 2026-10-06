-- Social Media: Post Creator
--
-- Rein additiv (§58): ein neuer Typ, eine neue Tabelle, zwei Indizes, ein
-- Fremdschluessel. Keine bestehende Spalte wird angefasst, keine Zeile
-- geaendert, nichts geloescht. Wer die Migration zurueckdreht, verliert die
-- Posts dieses Moduls und sonst nichts.
--
-- `createdById` ist bewusst nullbar mit ON DELETE SET NULL: ein geloeschtes
-- Konto soll seine Posts nicht mitnehmen - die Arbeit gehoert dem Server.

CREATE TYPE "SocialPostStatus" AS ENUM ('DRAFT', 'READY', 'ARCHIVED');

CREATE TABLE "SocialPost" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "postType" TEXT NOT NULL,
    "design" TEXT NOT NULL,
    "renderConfig" JSONB NOT NULL DEFAULT '{}',
    "status" "SocialPostStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT,
    "createdByDiscordId" TEXT,
    "createdByUsername" TEXT,
    "updatedByUsername" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialPost_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SocialPost_guildId_status_updatedAt_idx" ON "SocialPost"("guildId", "status", "updatedAt");
CREATE INDEX "SocialPost_guildId_postType_idx" ON "SocialPost"("guildId", "postType");

ALTER TABLE "SocialPost" ADD CONSTRAINT "SocialPost_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
