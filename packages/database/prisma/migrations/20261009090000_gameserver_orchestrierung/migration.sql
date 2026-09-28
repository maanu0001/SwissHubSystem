-- Gameserver-Orchestrierung fuer das Turniermodul.
--
-- Rein additiv: fuenf Enums, neun neue Tabellen und **eine** nullable Spalte
-- an einer bestehenden (`TournamentMatch.overdueNotifiedAt`). Keine
-- bestehende Spalte geaendert, keine geloescht, keine Zeile angefasst. Wer
-- diese Migration einspielt und keinen Anbieter einrichtet, merkt nichts
-- davon - Turniere laufen unveraendert weiter.
--
-- Die beiden Eindeutigkeiten weiter unten sind die eigentliche Absicherung:
--
--   MatchServerAssignment(matchId, generation)  - ein Server je Anlauf
--   MatchVetoAction(assignmentId, stepIndex)    - ein Schritt je Position
--
-- Die erste traegt die Zusage, dass ein Match nicht zweimal gleichzeitig
-- provisioniert wird: der Orchestrator legt die Zuordnung an, bevor er den
-- Anbieter anspricht, und wer sie nicht anlegen kann, hat verloren. Die
-- zweite verhindert, dass zwei gleichzeitige Klicks beide denselben
-- Veto-Schritt belegen.
--
-- `TournamentMatch.overdueNotifiedAt` ersetzt eine JSON-Pfadabfrage im
-- Ereignisprotokoll, die der Durchgang bisher **je ueberfaelligem Match und
-- Minute** ausfuehrte - auf einer Tabelle ohne Index auf `detail`.

-- CreateEnum
CREATE TYPE "GameServerGame" AS ENUM ('CS2');

-- CreateEnum
CREATE TYPE "GameServerStatus" AS ENUM ('PENDING', 'PROVISIONING', 'BOOTING', 'AGENT_READY', 'RUNNING', 'STOPPING', 'REMOVED', 'FAILED');

-- CreateEnum
CREATE TYPE "MatchServerPhase" AS ENUM ('WAITING_FOR_SERVER', 'PROVISIONING', 'SERVER_BOOTING', 'AGENT_CONNECTING', 'CONFIGURING', 'READY_FOR_VETO', 'VETO_RUNNING', 'WAITING_FOR_PLAYERS', 'READY_CHECK', 'LIVE', 'MATCH_FINISHED', 'RESULT_PROCESSING', 'ARCHIVING', 'CLEANUP_PENDING', 'SERVER_REMOVED', 'PROVISION_FAILED', 'CONFIG_FAILED', 'SERVER_ERROR', 'MATCH_INTERRUPTED', 'RESULT_ERROR', 'ARCHIVE_ERROR');

-- CreateEnum
CREATE TYPE "MatchVetoStepKind" AS ENUM ('BAN', 'PICK', 'DECIDER');

-- CreateEnum
CREATE TYPE "MatchVetoActor" AS ENUM ('A', 'B', 'SYSTEM');

-- CreateEnum
CREATE TYPE "GameServerFileKind" AS ENUM ('DEMO', 'SERVER_LOG', 'MATCH_DATA');

-- AlterTable
ALTER TABLE "TournamentMatch" ADD COLUMN     "overdueNotifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "GameServerProvider" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "driver" TEXT NOT NULL,
    "region" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "lastCheckAt" TIMESTAMP(3),
    "lastCheckOk" BOOLEAN,
    "lastCheckMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameServerProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameServerTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "game" "GameServerGame" NOT NULL,
    "imageRef" TEXT NOT NULL,
    "region" TEXT,
    "cpuCores" INTEGER NOT NULL DEFAULT 4,
    "memoryMb" INTEGER NOT NULL DEFAULT 8192,
    "diskGb" INTEGER NOT NULL DEFAULT 40,
    "gamePort" INTEGER NOT NULL DEFAULT 27015,
    "tvPort" INTEGER NOT NULL DEFAULT 27020,
    "agentPort" INTEGER NOT NULL DEFAULT 9443,
    "maxRuntimeMinutes" INTEGER NOT NULL DEFAULT 240,
    "cleanupDelayMinutes" INTEGER NOT NULL DEFAULT 15,
    "driverOptions" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameServerTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameProfile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "game" "GameServerGame" NOT NULL,
    "templateId" TEXT,
    "region" TEXT,
    "mapPool" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "slots" INTEGER NOT NULL DEFAULT 12,
    "overtime" BOOLEAN NOT NULL DEFAULT true,
    "knifeRound" BOOLEAN NOT NULL DEFAULT true,
    "tacticalPauses" INTEGER NOT NULL DEFAULT 4,
    "technicalPauses" INTEGER NOT NULL DEFAULT 2,
    "gotvEnabled" BOOLEAN NOT NULL DEFAULT true,
    "demoRecording" BOOLEAN NOT NULL DEFAULT true,
    "restoreSupport" BOOLEAN NOT NULL DEFAULT true,
    "warmupSeconds" INTEGER NOT NULL DEFAULT 300,
    "readyRule" TEXT NOT NULL DEFAULT 'CAPTAIN',
    "passwordStrategy" TEXT NOT NULL DEFAULT 'RANDOM',
    "fixedPassword" TEXT,
    "adapterOptions" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameServerInstance" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "templateId" TEXT,
    "profileId" TEXT,
    "game" "GameServerGame" NOT NULL,
    "name" TEXT NOT NULL,
    "providerRef" TEXT,
    "status" "GameServerStatus" NOT NULL DEFAULT 'PENDING',
    "region" TEXT,
    "publicHost" TEXT,
    "gamePort" INTEGER,
    "tvPort" INTEGER,
    "agentPort" INTEGER,
    "rconPasswordEnc" TEXT,
    "agentTokenEnc" TEXT,
    "serverPassword" TEXT,
    "lastHeartbeatAt" TIMESTAMP(3),
    "cpuPercent" DOUBLE PRECISION,
    "memoryMb" INTEGER,
    "diskFreeMb" INTEGER,
    "playerCount" INTEGER,
    "currentMap" TEXT,
    "tournamentId" TEXT,
    "heldByDiscordId" TEXT,
    "heldReason" TEXT,
    "provisionStartedAt" TIMESTAMP(3),
    "provisionEndedAt" TIMESTAMP(3),
    "deleteAfterAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameServerInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchServerAssignment" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "instanceId" TEXT,
    "profileId" TEXT,
    "phase" "MatchServerPhase" NOT NULL DEFAULT 'WAITING_FOR_SERVER',
    "provisionAfterAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "liveAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "rawResult" JSONB,
    "resultReview" BOOLEAN NOT NULL DEFAULT false,
    "resultReviewReason" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchServerAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchVetoAction" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "kind" "MatchVetoStepKind" NOT NULL,
    "actor" "MatchVetoActor" NOT NULL,
    "map" TEXT NOT NULL,
    "byDiscordId" TEXT,
    "byAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchVetoAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameServerFile" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "instanceId" TEXT,
    "kind" "GameServerFileKind" NOT NULL,
    "remoteName" TEXT NOT NULL,
    "storedPath" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "mapIndex" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameServerFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServerHeartbeat" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "cpuPercent" DOUBLE PRECISION,
    "memoryMb" INTEGER,
    "diskFreeMb" INTEGER,
    "playerCount" INTEGER,
    "currentMap" TEXT,
    "gameRunning" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServerHeartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProvisioningAttempt" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT,
    "matchId" TEXT,
    "generation" INTEGER,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "succeeded" BOOLEAN NOT NULL DEFAULT false,
    "durationMs" INTEGER,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "ProvisioningAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GameServerProvider_name_key" ON "GameServerProvider"("name");

-- CreateIndex
CREATE INDEX "GameServerTemplate_game_enabled_idx" ON "GameServerTemplate"("game", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "GameServerTemplate_providerId_name_key" ON "GameServerTemplate"("providerId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "GameProfile_name_key" ON "GameProfile"("name");

-- CreateIndex
CREATE INDEX "GameProfile_game_enabled_idx" ON "GameProfile"("game", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "GameServerInstance_name_key" ON "GameServerInstance"("name");

-- CreateIndex
CREATE INDEX "GameServerInstance_status_game_idx" ON "GameServerInstance"("status", "game");

-- CreateIndex
CREATE INDEX "GameServerInstance_tournamentId_status_idx" ON "GameServerInstance"("tournamentId", "status");

-- CreateIndex
CREATE INDEX "GameServerInstance_status_deleteAfterAt_idx" ON "GameServerInstance"("status", "deleteAfterAt");

-- CreateIndex
CREATE INDEX "MatchServerAssignment_phase_provisionAfterAt_idx" ON "MatchServerAssignment"("phase", "provisionAfterAt");

-- CreateIndex
CREATE INDEX "MatchServerAssignment_instanceId_idx" ON "MatchServerAssignment"("instanceId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchServerAssignment_matchId_generation_key" ON "MatchServerAssignment"("matchId", "generation");

-- CreateIndex
CREATE INDEX "MatchVetoAction_assignmentId_createdAt_idx" ON "MatchVetoAction"("assignmentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MatchVetoAction_assignmentId_stepIndex_key" ON "MatchVetoAction"("assignmentId", "stepIndex");

-- CreateIndex
CREATE INDEX "GameServerFile_assignmentId_kind_idx" ON "GameServerFile"("assignmentId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "GameServerFile_assignmentId_kind_remoteName_key" ON "GameServerFile"("assignmentId", "kind", "remoteName");

-- CreateIndex
CREATE INDEX "ServerHeartbeat_instanceId_createdAt_idx" ON "ServerHeartbeat"("instanceId", "createdAt");

-- CreateIndex
CREATE INDEX "ServerHeartbeat_createdAt_idx" ON "ServerHeartbeat"("createdAt");

-- CreateIndex
CREATE INDEX "ProvisioningAttempt_matchId_generation_idx" ON "ProvisioningAttempt"("matchId", "generation");

-- CreateIndex
CREATE INDEX "ProvisioningAttempt_startedAt_idx" ON "ProvisioningAttempt"("startedAt");

-- AddForeignKey
ALTER TABLE "GameServerTemplate" ADD CONSTRAINT "GameServerTemplate_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "GameServerProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameProfile" ADD CONSTRAINT "GameProfile_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "GameServerTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameServerInstance" ADD CONSTRAINT "GameServerInstance_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "GameServerProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameServerInstance" ADD CONSTRAINT "GameServerInstance_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "GameServerTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameServerInstance" ADD CONSTRAINT "GameServerInstance_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "GameProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchServerAssignment" ADD CONSTRAINT "MatchServerAssignment_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "TournamentMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchServerAssignment" ADD CONSTRAINT "MatchServerAssignment_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "GameServerInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchServerAssignment" ADD CONSTRAINT "MatchServerAssignment_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "GameProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchVetoAction" ADD CONSTRAINT "MatchVetoAction_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "MatchServerAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameServerFile" ADD CONSTRAINT "GameServerFile_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "MatchServerAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameServerFile" ADD CONSTRAINT "GameServerFile_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "GameServerInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServerHeartbeat" ADD CONSTRAINT "ServerHeartbeat_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "GameServerInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProvisioningAttempt" ADD CONSTRAINT "ProvisioningAttempt_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "GameServerInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

