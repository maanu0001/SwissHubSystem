-- Clips: die Grundlage fuer «Clip of the Week» und das spaetere Clip Center.
--
-- Vier getrennte Entitaeten statt einer grossen: ein Clip ist eine Sache fuer
-- sich, ein Wettbewerb ist eine Sache fuer sich, eine Teilnahme verbindet
-- beide, und eine Stimme haengt an der Teilnahme.
--
-- Rein additiv: fuenf neue Tabellen, fuenf neue Enums, eine neue
-- Fremdschluesselbeziehung auf die bestehende Spiele-Registry. Keine
-- bestehende Tabelle wird veraendert, nichts wird geloescht.
--
-- Die beiden Eindeutigkeiten tragen Fachlichkeit, nicht nur Ordnung:
--   Clip(guildId, provider, externalId)          - derselbe Clip einmal
--   ClipVote(competitionId, entryId, voterDiscordId) - eine Stimme je Clip
-- Die zweite ist der Riegel gegen den Wettlauf: zwei gleichzeitige Klicks
-- laufen beide durch jede Pruefung, aber nur einer kommt hier vorbei.

-- CreateEnum
CREATE TYPE "ClipSourceType" AS ENUM ('TWITCH_CLIP', 'YOUTUBE', 'UPLOAD');

-- CreateEnum
CREATE TYPE "ClipStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'REMOVED');

-- CreateEnum
CREATE TYPE "ClipCompetitionStatus" AS ENUM ('DRAFT', 'SUBMISSION', 'VOTING', 'FINALIZING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ClipEntryStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'REMOVED');

-- CreateEnum
CREATE TYPE "ClipReportReason" AS ENUM ('INAPPROPRIATE', 'RIGHTS', 'HARASSMENT', 'OTHER');

-- CreateTable
CREATE TABLE "Clip" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "submittedByDiscordId" TEXT NOT NULL,
    "submittedByUsername" TEXT,
    "submittedByDisplayName" TEXT,
    "submittedByAvatarHash" TEXT,
    "sourceType" "ClipSourceType" NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "canonicalUrl" TEXT NOT NULL,
    "embedUrl" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "durationSeconds" INTEGER,
    "creatorName" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "gameId" TEXT,
    "gameName" TEXT,
    "status" "ClipStatus" NOT NULL DEFAULT 'PENDING',
    "approvedAt" TIMESTAMP(3),
    "approvedByDiscordId" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectedByDiscordId" TEXT,
    "rejectionReason" TEXT,
    "rejectionNote" TEXT,
    "removedAt" TIMESTAMP(3),
    "removedByDiscordId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Clip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClipCompetition" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT,
    "status" "ClipCompetitionStatus" NOT NULL DEFAULT 'DRAFT',
    "submissionStartsAt" TIMESTAMP(3) NOT NULL,
    "submissionEndsAt" TIMESTAMP(3) NOT NULL,
    "votingStartsAt" TIMESTAMP(3) NOT NULL,
    "votingEndsAt" TIMESTAMP(3) NOT NULL,
    "finalizedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledByDiscordId" TEXT,
    "winnerEntryId" TEXT,
    "votesPerMember" INTEGER NOT NULL DEFAULT 3,
    "submissionsPerMember" INTEGER NOT NULL DEFAULT 1,
    "allowSelfVote" BOOLEAN NOT NULL DEFAULT false,
    "showVoteCounts" BOOLEAN NOT NULL DEFAULT false,
    "startMessageId" TEXT,
    "startChannelId" TEXT,
    "startPostedAt" TIMESTAMP(3),
    "votingMessageId" TEXT,
    "votingChannelId" TEXT,
    "votingPostedAt" TIMESTAMP(3),
    "winnerMessageId" TEXT,
    "winnerChannelId" TEXT,
    "winnerPostedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClipCompetition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClipCompetitionEntry" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "clipId" TEXT NOT NULL,
    "submittedByDiscordId" TEXT NOT NULL,
    "status" "ClipEntryStatus" NOT NULL DEFAULT 'PENDING',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),
    "removedByDiscordId" TEXT,
    "removalReason" TEXT,
    "finalRank" INTEGER,
    "finalVoteCount" INTEGER,

    CONSTRAINT "ClipCompetitionEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClipVote" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "voterDiscordId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClipVote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClipReport" (
    "id" TEXT NOT NULL,
    "clipId" TEXT NOT NULL,
    "reporterDiscordId" TEXT NOT NULL,
    "reason" "ClipReportReason" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByDiscordId" TEXT,

    CONSTRAINT "ClipReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Clip_guildId_status_createdAt_idx" ON "Clip"("guildId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Clip_guildId_submittedByDiscordId_createdAt_idx" ON "Clip"("guildId", "submittedByDiscordId", "createdAt");

-- CreateIndex
CREATE INDEX "Clip_guildId_gameId_status_idx" ON "Clip"("guildId", "gameId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Clip_guildId_provider_externalId_key" ON "Clip"("guildId", "provider", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "ClipCompetition_winnerEntryId_key" ON "ClipCompetition"("winnerEntryId");

-- CreateIndex
CREATE INDEX "ClipCompetition_guildId_status_votingEndsAt_idx" ON "ClipCompetition"("guildId", "status", "votingEndsAt");

-- CreateIndex
CREATE INDEX "ClipCompetition_guildId_number_idx" ON "ClipCompetition"("guildId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "ClipCompetition_guildId_key_key" ON "ClipCompetition"("guildId", "key");

-- CreateIndex
CREATE INDEX "ClipCompetitionEntry_competitionId_status_idx" ON "ClipCompetitionEntry"("competitionId", "status");

-- CreateIndex
CREATE INDEX "ClipCompetitionEntry_competitionId_finalRank_idx" ON "ClipCompetitionEntry"("competitionId", "finalRank");

-- CreateIndex
CREATE INDEX "ClipCompetitionEntry_submittedByDiscordId_idx" ON "ClipCompetitionEntry"("submittedByDiscordId");

-- CreateIndex
CREATE UNIQUE INDEX "ClipCompetitionEntry_competitionId_clipId_key" ON "ClipCompetitionEntry"("competitionId", "clipId");

-- CreateIndex
CREATE INDEX "ClipVote_competitionId_voterDiscordId_idx" ON "ClipVote"("competitionId", "voterDiscordId");

-- CreateIndex
CREATE INDEX "ClipVote_entryId_idx" ON "ClipVote"("entryId");

-- CreateIndex
CREATE UNIQUE INDEX "ClipVote_competitionId_entryId_voterDiscordId_key" ON "ClipVote"("competitionId", "entryId", "voterDiscordId");

-- CreateIndex
CREATE INDEX "ClipReport_resolvedAt_createdAt_idx" ON "ClipReport"("resolvedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClipReport_clipId_reporterDiscordId_key" ON "ClipReport"("clipId", "reporterDiscordId");

-- AddForeignKey
ALTER TABLE "Clip" ADD CONSTRAINT "Clip_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "SpielersucheGame"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipCompetition" ADD CONSTRAINT "ClipCompetition_winnerEntryId_fkey" FOREIGN KEY ("winnerEntryId") REFERENCES "ClipCompetitionEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipCompetitionEntry" ADD CONSTRAINT "ClipCompetitionEntry_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "ClipCompetition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipCompetitionEntry" ADD CONSTRAINT "ClipCompetitionEntry_clipId_fkey" FOREIGN KEY ("clipId") REFERENCES "Clip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipVote" ADD CONSTRAINT "ClipVote_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "ClipCompetition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipVote" ADD CONSTRAINT "ClipVote_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "ClipCompetitionEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipReport" ADD CONSTRAINT "ClipReport_clipId_fkey" FOREIGN KEY ("clipId") REFERENCES "Clip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

