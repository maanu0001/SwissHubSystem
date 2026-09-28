-- CreateEnum
CREATE TYPE "GameServerHostStatus" AS ENUM ('ACTIVE', 'DRAINING', 'MAINTENANCE', 'DISABLED');

-- CreateEnum
CREATE TYPE "HostPortKind" AS ENUM ('GAME', 'QUERY', 'TV');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "GameServerStatus" ADD VALUE 'RESERVED';
ALTER TYPE "GameServerStatus" ADD VALUE 'CREATING';
ALTER TYPE "GameServerStatus" ADD VALUE 'STARTING';
ALTER TYPE "GameServerStatus" ADD VALUE 'CONFIGURING';
ALTER TYPE "GameServerStatus" ADD VALUE 'READY';
ALTER TYPE "GameServerStatus" ADD VALUE 'LIVE';
ALTER TYPE "GameServerStatus" ADD VALUE 'STOPPED';
ALTER TYPE "GameServerStatus" ADD VALUE 'ARCHIVING';
ALTER TYPE "GameServerStatus" ADD VALUE 'REMOVING';

-- AlterTable
ALTER TABLE "GameProfile" ADD COLUMN     "casterSlots" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "coachSlots" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "cpuLimit" DOUBLE PRECISION NOT NULL DEFAULT 2,
ADD COLUMN     "cpuReservation" DOUBLE PRECISION NOT NULL DEFAULT 1,
ADD COLUMN     "defaultBestOf" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "diskLimitMb" INTEGER NOT NULL DEFAULT 20480,
ADD COLUMN     "gotvDelaySeconds" INTEGER NOT NULL DEFAULT 105,
ADD COLUMN     "matchPlugin" TEXT NOT NULL DEFAULT 'get5',
ADD COLUMN     "maxRuntimeMinutes" INTEGER NOT NULL DEFAULT 240,
ADD COLUMN     "memoryLimitMb" INTEGER NOT NULL DEFAULT 4096,
ADD COLUMN     "memoryReservationMb" INTEGER NOT NULL DEFAULT 2048,
ADD COLUMN     "overtimeMaxRounds" INTEGER NOT NULL DEFAULT 6,
ADD COLUMN     "overtimeStartMoney" INTEGER NOT NULL DEFAULT 16000,
ADD COLUMN     "pauseSeconds" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "pluginSettings" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "preferredGroupId" TEXT,
ADD COLUMN     "restoreMaxRounds" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "runtimeImageId" TEXT,
ADD COLUMN     "serverNameTemplate" TEXT NOT NULL DEFAULT 'SwissHub | {tournament} | Match {match}',
ADD COLUMN     "techPauseSeconds" INTEGER NOT NULL DEFAULT 300,
ADD COLUMN     "tickrate" INTEGER NOT NULL DEFAULT 64;

-- AlterTable
ALTER TABLE "GameServerInstance" ADD COLUMN     "containerRef" TEXT,
ADD COLUMN     "cpuLimit" DOUBLE PRECISION,
ADD COLUMN     "diskLimitMb" INTEGER,
ADD COLUMN     "hostId" TEXT,
ADD COLUMN     "imageTag" TEXT,
ADD COLUMN     "maxRuntimeMinutes" INTEGER,
ADD COLUMN     "memoryLimitMb" INTEGER,
ADD COLUMN     "profileSnapshot" JSONB,
ADD COLUMN     "queryPort" INTEGER,
ADD COLUMN     "runtimeImageId" TEXT,
ADD COLUMN     "startedAt" TIMESTAMP(3),
ADD COLUMN     "stoppedAt" TIMESTAMP(3),
ALTER COLUMN "providerId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "MatchServerAssignment" ADD COLUMN     "forcedHostId" TEXT;

-- AlterTable
ALTER TABLE "ServerHeartbeat" ADD COLUMN     "agentVersion" TEXT,
ADD COLUMN     "dockerAvailable" BOOLEAN,
ADD COLUMN     "hostId" TEXT,
ADD COLUMN     "instanceCount" INTEGER,
ALTER COLUMN "instanceId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "HostGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "region" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HostGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameServerHost" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "hostname" TEXT NOT NULL,
    "agentPort" INTEGER NOT NULL DEFAULT 9443,
    "region" TEXT,
    "groupId" TEXT,
    "status" "GameServerHostStatus" NOT NULL DEFAULT 'ACTIVE',
    "registrationTokenHash" TEXT,
    "registrationExpiresAt" TIMESTAMP(3),
    "registeredAt" TIMESTAMP(3),
    "agentTokenEnc" TEXT,
    "agentVersion" TEXT,
    "lastHeartbeatAt" TIMESTAMP(3),
    "dockerAvailable" BOOLEAN,
    "cpuPercent" DOUBLE PRECISION,
    "memoryUsedMb" INTEGER,
    "diskFreeMb" INTEGER,
    "uptimeSeconds" INTEGER,
    "runningCount" INTEGER,
    "cpuCores" INTEGER NOT NULL DEFAULT 0,
    "memoryMb" INTEGER NOT NULL DEFAULT 0,
    "diskGb" INTEGER NOT NULL DEFAULT 0,
    "reservedCpuCores" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "reservedMemoryMb" INTEGER NOT NULL DEFAULT 2048,
    "minFreeDiskGb" INTEGER NOT NULL DEFAULT 10,
    "maxInstances" INTEGER NOT NULL DEFAULT 6,
    "maxParallelStarts" INTEGER NOT NULL DEFAULT 2,
    "allowedGames" "GameServerGame"[] DEFAULT ARRAY[]::"GameServerGame"[],
    "gamePortFrom" INTEGER NOT NULL DEFAULT 27015,
    "gamePortTo" INTEGER NOT NULL DEFAULT 27199,
    "queryPortFrom" INTEGER NOT NULL DEFAULT 27200,
    "queryPortTo" INTEGER NOT NULL DEFAULT 27399,
    "tvPortFrom" INTEGER NOT NULL DEFAULT 27400,
    "tvPortTo" INTEGER NOT NULL DEFAULT 27599,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameServerHost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HostPortReservation" (
    "id" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "kind" "HostPortKind" NOT NULL,
    "instanceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HostPortReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameRuntimeImage" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "game" "GameServerGame" NOT NULL,
    "image" TEXT NOT NULL,
    "tag" TEXT NOT NULL DEFAULT 'latest',
    "command" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "env" JSONB NOT NULL DEFAULT '{}',
    "dataMountPath" TEXT NOT NULL DEFAULT '/swisshub/data',
    "configMountPath" TEXT NOT NULL DEFAULT '/swisshub/config',
    "gamePortInContainer" INTEGER NOT NULL DEFAULT 27015,
    "queryPortInContainer" INTEGER,
    "tvPortInContainer" INTEGER,
    "healthTimeoutSeconds" INTEGER NOT NULL DEFAULT 120,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameRuntimeImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HostImageState" (
    "id" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "imageId" TEXT NOT NULL,
    "presentTag" TEXT,
    "sizeBytes" BIGINT,
    "lastSeenAt" TIMESTAMP(3),
    "pulling" BOOLEAN NOT NULL DEFAULT false,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HostImageState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HostGroup_name_key" ON "HostGroup"("name");

-- CreateIndex
CREATE UNIQUE INDEX "GameServerHost_name_key" ON "GameServerHost"("name");

-- CreateIndex
CREATE INDEX "GameServerHost_status_region_idx" ON "GameServerHost"("status", "region");

-- CreateIndex
CREATE INDEX "HostPortReservation_instanceId_idx" ON "HostPortReservation"("instanceId");

-- CreateIndex
CREATE UNIQUE INDEX "HostPortReservation_hostId_port_key" ON "HostPortReservation"("hostId", "port");

-- CreateIndex
CREATE UNIQUE INDEX "GameRuntimeImage_name_key" ON "GameRuntimeImage"("name");

-- CreateIndex
CREATE INDEX "GameRuntimeImage_game_enabled_idx" ON "GameRuntimeImage"("game", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "HostImageState_hostId_imageId_key" ON "HostImageState"("hostId", "imageId");

-- CreateIndex
CREATE INDEX "GameServerInstance_hostId_status_idx" ON "GameServerInstance"("hostId", "status");

-- CreateIndex
CREATE INDEX "ServerHeartbeat_hostId_createdAt_idx" ON "ServerHeartbeat"("hostId", "createdAt");

-- AddForeignKey
ALTER TABLE "GameProfile" ADD CONSTRAINT "GameProfile_runtimeImageId_fkey" FOREIGN KEY ("runtimeImageId") REFERENCES "GameRuntimeImage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameProfile" ADD CONSTRAINT "GameProfile_preferredGroupId_fkey" FOREIGN KEY ("preferredGroupId") REFERENCES "HostGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameServerInstance" ADD CONSTRAINT "GameServerInstance_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "GameServerHost"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameServerInstance" ADD CONSTRAINT "GameServerInstance_runtimeImageId_fkey" FOREIGN KEY ("runtimeImageId") REFERENCES "GameRuntimeImage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServerHeartbeat" ADD CONSTRAINT "ServerHeartbeat_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "GameServerHost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameServerHost" ADD CONSTRAINT "GameServerHost_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "HostGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostPortReservation" ADD CONSTRAINT "HostPortReservation_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "GameServerHost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostPortReservation" ADD CONSTRAINT "HostPortReservation_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "GameServerInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostImageState" ADD CONSTRAINT "HostImageState_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "GameServerHost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostImageState" ADD CONSTRAINT "HostImageState_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "GameRuntimeImage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

