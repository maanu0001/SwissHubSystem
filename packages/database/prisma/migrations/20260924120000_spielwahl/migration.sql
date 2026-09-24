-- CreateEnum
CREATE TYPE "SpielwahlStatus" AS ENUM ('LOBBY', 'BEREIT', 'ENTSCHEIDUNG', 'ERGEBNIS', 'ABGESCHLOSSEN', 'ABGEBROCHEN');

-- CreateEnum
CREATE TYPE "SpielwahlModus" AS ENUM ('ROULETTE', 'VOTING', 'ELIMINATION');

-- CreateEnum
CREATE TYPE "SpielwahlRundeStatus" AS ENUM ('LAEUFT', 'FERTIG', 'ABGEBROCHEN');

-- CreateEnum
CREATE TYPE "SpielwahlRolle" AS ENUM ('HOST', 'COHOST', 'GAST');

-- CreateEnum
CREATE TYPE "SpielwahlGleichstand" AS ENUM ('STICHWAHL', 'ZUFALL');

-- CreateTable
CREATE TABLE "SpielwahlSession" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "inviteToken" TEXT NOT NULL,
    "hostDiscordId" TEXT NOT NULL,
    "status" "SpielwahlStatus" NOT NULL DEFAULT 'LOBBY',
    "modus" "SpielwahlModus" NOT NULL DEFAULT 'ROULETTE',
    "vorschlaegeProPerson" INTEGER NOT NULL DEFAULT 3,
    "maxTeilnehmer" INTEGER NOT NULL DEFAULT 12,
    "freieVorschlaege" BOOLEAN NOT NULL DEFAULT true,
    "abstimmdauerSek" INTEGER NOT NULL DEFAULT 45,
    "stimmenProPerson" INTEGER NOT NULL DEFAULT 1,
    "geheimeStimmen" BOOLEAN NOT NULL DEFAULT true,
    "gleichstand" "SpielwahlGleichstand" NOT NULL DEFAULT 'STICHWAHL',
    "rouletteGewichtet" BOOLEAN NOT NULL DEFAULT false,
    "beitrittWaehrendRunde" BOOLEAN NOT NULL DEFAULT true,
    "nachlosenErlaubt" BOOLEAN NOT NULL DEFAULT true,
    "nachgelostAm" TIMESTAMP(3),
    "currentRoundId" TEXT,
    "ergebnisCandidateId" TEXT,
    "ergebnisAm" TIMESTAMP(3),
    "announcementChannelId" TEXT,
    "announcementMessageId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpielwahlSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpielwahlParticipant" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "rolle" "SpielwahlRolle" NOT NULL DEFAULT 'GAST',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpielwahlParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpielwahlCandidate" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "gameId" TEXT,
    "freierName" TEXT,
    "namensKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpielwahlCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpielwahlSupport" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "erster" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpielwahlSupport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpielwahlRound" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "nummer" INTEGER NOT NULL,
    "modus" "SpielwahlModus" NOT NULL,
    "status" "SpielwahlRundeStatus" NOT NULL DEFAULT 'LAEUFT',
    "kandidaten" TEXT[],
    "seed" TEXT NOT NULL,
    "losPunkt" INTEGER,
    "losGesamt" INTEGER,
    "baum" JSONB,
    "duellIndex" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "gewinnerCandidateId" TEXT,
    "entscheidungsart" TEXT,

    CONSTRAINT "SpielwahlRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpielwahlVote" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "duell" INTEGER NOT NULL DEFAULT 0,
    "discordId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpielwahlVote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpielwahlCommand" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "schluessel" TEXT NOT NULL,
    "befehl" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "ergebnis" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpielwahlCommand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SpielwahlSession_inviteToken_key" ON "SpielwahlSession"("inviteToken");

-- CreateIndex
CREATE UNIQUE INDEX "SpielwahlSession_currentRoundId_key" ON "SpielwahlSession"("currentRoundId");

-- CreateIndex
CREATE INDEX "SpielwahlSession_guildId_status_idx" ON "SpielwahlSession"("guildId", "status");

-- CreateIndex
CREATE INDEX "SpielwahlSession_guildId_hostDiscordId_idx" ON "SpielwahlSession"("guildId", "hostDiscordId");

-- CreateIndex
CREATE INDEX "SpielwahlSession_status_expiresAt_idx" ON "SpielwahlSession"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "SpielwahlParticipant_sessionId_leftAt_idx" ON "SpielwahlParticipant"("sessionId", "leftAt");

-- CreateIndex
CREATE UNIQUE INDEX "SpielwahlParticipant_sessionId_discordId_key" ON "SpielwahlParticipant"("sessionId", "discordId");

-- CreateIndex
CREATE INDEX "SpielwahlCandidate_sessionId_idx" ON "SpielwahlCandidate"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "SpielwahlCandidate_sessionId_namensKey_key" ON "SpielwahlCandidate"("sessionId", "namensKey");

-- CreateIndex
CREATE INDEX "SpielwahlSupport_discordId_idx" ON "SpielwahlSupport"("discordId");

-- CreateIndex
CREATE UNIQUE INDEX "SpielwahlSupport_candidateId_discordId_key" ON "SpielwahlSupport"("candidateId", "discordId");

-- CreateIndex
CREATE INDEX "SpielwahlRound_status_endsAt_idx" ON "SpielwahlRound"("status", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "SpielwahlRound_sessionId_nummer_key" ON "SpielwahlRound"("sessionId", "nummer");

-- CreateIndex
CREATE INDEX "SpielwahlVote_roundId_duell_idx" ON "SpielwahlVote"("roundId", "duell");

-- CreateIndex
CREATE UNIQUE INDEX "SpielwahlVote_roundId_duell_discordId_candidateId_key" ON "SpielwahlVote"("roundId", "duell", "discordId", "candidateId");

-- CreateIndex
CREATE INDEX "SpielwahlCommand_sessionId_createdAt_idx" ON "SpielwahlCommand"("sessionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SpielwahlCommand_sessionId_schluessel_key" ON "SpielwahlCommand"("sessionId", "schluessel");

-- AddForeignKey
ALTER TABLE "SpielwahlSession" ADD CONSTRAINT "SpielwahlSession_currentRoundId_fkey" FOREIGN KEY ("currentRoundId") REFERENCES "SpielwahlRound"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpielwahlParticipant" ADD CONSTRAINT "SpielwahlParticipant_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "SpielwahlSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpielwahlCandidate" ADD CONSTRAINT "SpielwahlCandidate_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "SpielwahlSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpielwahlCandidate" ADD CONSTRAINT "SpielwahlCandidate_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "SpielersucheGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpielwahlSupport" ADD CONSTRAINT "SpielwahlSupport_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "SpielwahlCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpielwahlRound" ADD CONSTRAINT "SpielwahlRound_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "SpielwahlSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpielwahlRound" ADD CONSTRAINT "SpielwahlRound_gewinnerCandidateId_fkey" FOREIGN KEY ("gewinnerCandidateId") REFERENCES "SpielwahlCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpielwahlVote" ADD CONSTRAINT "SpielwahlVote_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "SpielwahlRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpielwahlVote" ADD CONSTRAINT "SpielwahlVote_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "SpielwahlCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpielwahlCommand" ADD CONSTRAINT "SpielwahlCommand_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "SpielwahlSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

