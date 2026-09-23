-- SwissHub Wrapped: fuenf neue Tabellen, zwei neue Aufzaehlungstypen.
--
-- Rein additiv. Kein bestehendes Modell wird angefasst, keine Spalte
-- entfernt, keine Zeile geloescht. Erzeugt mit `prisma migrate diff` gegen
-- eine Datenbank auf dem Stand der letzten Migration.
--
-- Zwei Eindeutigkeiten tragen die Fachlichkeit:
--
--   WrappedCampaign(guildId, key)       - je Server ein Rueckblick je Jahr.
--                                          Der Riegel gegen eine zweite
--                                          Kampagne «2026».
--   WrappedSnapshot(campaignId, discordId) - je Person genau eine
--                                          Momentaufnahme. Ein wiederholter
--                                          oder fortgesetzter Lauf schreibt
--                                          dieselbe Zeile, statt eine
--                                          zweite anzulegen.
--
-- `WrappedSnapshot.sceneKeys` ist ein Textfeld-Array: die Reihenfolge der
-- Kapitel gehoert zur Momentaufnahme. Wuerde sie bei jedem Aufruf neu
-- entschieden, erzaehlte derselbe Rueckblick nach einer Aenderung an der
-- Eignungsregel eine andere Geschichte.
-- CreateEnum
CREATE TYPE "WrappedCampaignStatus" AS ENUM ('DRAFT', 'PREPARING', 'READY', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "WrappedRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "WrappedCampaign" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "displayYear" INTEGER NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" "WrappedCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "introText" TEXT,
    "outroText" TEXT,
    "shareCardsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "announceEnabled" BOOLEAN NOT NULL DEFAULT false,
    "announcementChannelId" TEXT,
    "minActiveDays" INTEGER NOT NULL DEFAULT 5,
    "minMessages" INTEGER NOT NULL DEFAULT 20,
    "minVoiceMinutes" INTEGER NOT NULL DEFAULT 60,
    "publishedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "announcementMessageId" TEXT,
    "announcementChannelPostedId" TEXT,
    "announcementPostedAt" TIMESTAMP(3),
    "createdByDiscordId" TEXT,
    "updatedByDiscordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WrappedCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WrappedScene" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "sceneKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL,
    "textOverrides" JSONB,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WrappedScene_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WrappedSnapshot" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "username" TEXT,
    "displayName" TEXT,
    "avatarHash" TEXT,
    "data" JSONB NOT NULL,
    "sceneKeys" TEXT[],
    "archetype" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WrappedSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WrappedGenerationRun" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "status" "WrappedRunStatus" NOT NULL DEFAULT 'QUEUED',
    "total" INTEGER NOT NULL DEFAULT 0,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "cursor" TEXT,
    "errors" JSONB,
    "startedByDiscordId" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WrappedGenerationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WrappedView" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "firstOpenedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastOpenedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "lastSceneKey" TEXT,

    CONSTRAINT "WrappedView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WrappedCampaign_guildId_status_idx" ON "WrappedCampaign"("guildId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WrappedCampaign_guildId_key_key" ON "WrappedCampaign"("guildId", "key");

-- CreateIndex
CREATE INDEX "WrappedScene_campaignId_position_idx" ON "WrappedScene"("campaignId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "WrappedScene_campaignId_sceneKey_key" ON "WrappedScene"("campaignId", "sceneKey");

-- CreateIndex
CREATE INDEX "WrappedSnapshot_campaignId_archetype_idx" ON "WrappedSnapshot"("campaignId", "archetype");

-- CreateIndex
CREATE UNIQUE INDEX "WrappedSnapshot_campaignId_discordId_key" ON "WrappedSnapshot"("campaignId", "discordId");

-- CreateIndex
CREATE INDEX "WrappedGenerationRun_campaignId_createdAt_idx" ON "WrappedGenerationRun"("campaignId", "createdAt");

-- CreateIndex
CREATE INDEX "WrappedGenerationRun_status_idx" ON "WrappedGenerationRun"("status");

-- CreateIndex
CREATE INDEX "WrappedView_campaignId_completedAt_idx" ON "WrappedView"("campaignId", "completedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WrappedView_campaignId_discordId_key" ON "WrappedView"("campaignId", "discordId");

-- AddForeignKey
ALTER TABLE "WrappedScene" ADD CONSTRAINT "WrappedScene_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "WrappedCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WrappedSnapshot" ADD CONSTRAINT "WrappedSnapshot_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "WrappedCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WrappedGenerationRun" ADD CONSTRAINT "WrappedGenerationRun_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "WrappedCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WrappedView" ADD CONSTRAINT "WrappedView_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "WrappedCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

