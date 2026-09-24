-- Periodische Wrappeds - der Rueckblick ueber die Community.
--
-- Rein additiv. Drei neue Tabellen, zwei neue Aufzaehlungstypen; an
-- `WrappedCampaign`, `WrappedScene`, `WrappedSnapshot`, `WrappedGenerationRun`
-- und `WrappedView` aendert sich nichts. Der persoenliche Jahresrueckblick
-- laeuft unveraendert weiter.
--
-- Kein DROP, kein DELETE, keine geaenderte Spalte. Geprueft mit
-- `prisma migrate diff` gegen den Bestand; die beiden Treffer auf «DROP» in
-- dieser Datei sind `ON DELETE`-Klauseln von Fremdschluesseln.

-- CreateEnum
CREATE TYPE "WrappedEditionType" AS ENUM ('MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "WrappedEditionStatus" AS ENUM ('DRAFT', 'FINALIZED', 'PUBLISHED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "WrappedEdition" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "type" "WrappedEditionType" NOT NULL,
    "periodKey" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" "WrappedEditionStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "variant" TEXT NOT NULL DEFAULT 'standard',
    "sources" JSONB NOT NULL,
    "diagnostics" JSONB,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "generatedAt" TIMESTAMP(3),
    "finalizedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdByDiscordId" TEXT,
    "updatedByDiscordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WrappedEdition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WrappedSlide" (
    "id" TEXT NOT NULL,
    "editionId" TEXT NOT NULL,
    "storyKey" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "snapshotData" JSONB NOT NULL,
    "editorialData" JSONB NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "momentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WrappedSlide_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WrappedMoment" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "imagePath" TEXT,
    "happenedAt" TIMESTAMP(3) NOT NULL,
    "eventId" TEXT,
    "tournamentId" TEXT,
    "includeMonthly" BOOLEAN NOT NULL DEFAULT true,
    "includeYearly" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdByDiscordId" TEXT,
    "updatedByDiscordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WrappedMoment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WrappedEdition_guildId_type_periodStart_idx" ON "WrappedEdition"("guildId", "type", "periodStart");

-- CreateIndex
CREATE INDEX "WrappedEdition_guildId_status_idx" ON "WrappedEdition"("guildId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WrappedEdition_guildId_type_periodKey_key" ON "WrappedEdition"("guildId", "type", "periodKey");

-- CreateIndex
CREATE INDEX "WrappedSlide_editionId_position_idx" ON "WrappedSlide"("editionId", "position");

-- CreateIndex
CREATE INDEX "WrappedSlide_momentId_idx" ON "WrappedSlide"("momentId");

-- CreateIndex
CREATE UNIQUE INDEX "WrappedSlide_editionId_storyKey_key" ON "WrappedSlide"("editionId", "storyKey");

-- CreateIndex
CREATE INDEX "WrappedMoment_guildId_happenedAt_idx" ON "WrappedMoment"("guildId", "happenedAt");

-- CreateIndex
CREATE INDEX "WrappedMoment_guildId_includeMonthly_happenedAt_idx" ON "WrappedMoment"("guildId", "includeMonthly", "happenedAt");

-- CreateIndex
CREATE INDEX "WrappedMoment_guildId_includeYearly_happenedAt_idx" ON "WrappedMoment"("guildId", "includeYearly", "happenedAt");

-- AddForeignKey
ALTER TABLE "WrappedSlide" ADD CONSTRAINT "WrappedSlide_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "WrappedEdition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WrappedSlide" ADD CONSTRAINT "WrappedSlide_momentId_fkey" FOREIGN KEY ("momentId") REFERENCES "WrappedMoment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

