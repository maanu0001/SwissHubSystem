-- CreateEnum
CREATE TYPE "XpSlotStatus" AS ENUM ('ACTIVE', 'MAINTENANCE', 'DISABLED', 'EVENT_ONLY');

-- CreateEnum
CREATE TYPE "XpSlotSymbolRole" AS ENUM ('NORMAL', 'WILD', 'SCATTER', 'JACKPOT', 'PREMIUM');

-- CreateEnum
CREATE TYPE "XpSlotFreespinStatus" AS ENUM ('ACTIVE', 'USED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "XpSlotBonusStage" AS ENUM ('LADDER_1', 'LADDER_2', 'SPINS', 'FINISHED', 'LOST');

-- CreateEnum
CREATE TYPE "XpSlotSpinKind" AS ENUM ('PAID', 'FREESPIN_PACKAGE', 'BONUS_ROUND', 'TEST');

-- CreateEnum
CREATE TYPE "XpSlotPremiumState" AS ENUM ('CREDITED', 'QUEUED', 'FAILED');

-- CreateEnum
CREATE TYPE "XpSlotSoundPackKind" AS ENUM ('STANDARD', 'EVENT', 'SPECIAL');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "XpSource" ADD VALUE IF NOT EXISTS 'SLOT_STAKE';
ALTER TYPE "XpSource" ADD VALUE IF NOT EXISTS 'SLOT_WIN';
ALTER TYPE "XpSource" ADD VALUE IF NOT EXISTS 'SLOT_REFUND';

-- CreateTable
CREATE TABLE "XpSlotConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "status" "XpSlotStatus" NOT NULL DEFAULT 'DISABLED',
    "maintenanceNote" TEXT,
    "betTiers" INTEGER[],
    "minBet" INTEGER NOT NULL DEFAULT 10,
    "maxBet" INTEGER NOT NULL DEFAULT 500,
    "jackpotMultiplier" INTEGER NOT NULL DEFAULT 500,
    "jackpotPureOnly" BOOLEAN NOT NULL DEFAULT true,
    "wildSubstitutesAll" BOOLEAN NOT NULL DEFAULT false,
    "bonusTriggerCount" INTEGER NOT NULL DEFAULT 3,
    "bonusBaseFreespins" INTEGER NOT NULL DEFAULT 8,
    "bonusLadder1" INTEGER NOT NULL DEFAULT 12,
    "bonusLadder2" INTEGER NOT NULL DEFAULT 16,
    "gambleChance1Bp" INTEGER NOT NULL DEFAULT 5000,
    "gambleChance2Bp" INTEGER NOT NULL DEFAULT 5000,
    "retriggerSpins" INTEGER NOT NULL DEFAULT 3,
    "stickyWilds" BOOLEAN NOT NULL DEFAULT true,
    "premiumEnabled" BOOLEAN NOT NULL DEFAULT false,
    "maxWinMultiplier" INTEGER NOT NULL DEFAULT 1000,
    "maxDailyLoss" INTEGER NOT NULL DEFAULT 0,
    "maxDailyWin" INTEGER NOT NULL DEFAULT 0,
    "maxSpinsPerSession" INTEGER NOT NULL DEFAULT 0,
    "sessionCooldownSeconds" INTEGER NOT NULL DEFAULT 0,
    "autoSpinCounts" INTEGER[],
    "tierBigMultiplier" INTEGER NOT NULL DEFAULT 10,
    "tierMegaMultiplier" INTEGER NOT NULL DEFAULT 25,
    "backgroundPath" TEXT,
    "backgroundUrl" TEXT,
    "logoPath" TEXT,
    "logoUrl" TEXT,
    "accentColor" TEXT,
    "overlayOpacity" INTEGER NOT NULL DEFAULT 40,
    "glowStrength" INTEGER NOT NULL DEFAULT 60,
    "spinButtonStyle" TEXT NOT NULL DEFAULT 'puls',
    "activeSoundPackId" TEXT,
    "feedChannelId" TEXT,
    "feedBigWin" BOOLEAN NOT NULL DEFAULT false,
    "feedJackpot" BOOLEAN NOT NULL DEFAULT true,
    "feedPremium" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByDiscordId" TEXT,

    CONSTRAINT "XpSlotConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "XpSlotSymbol" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "XpSlotSymbolRole" NOT NULL DEFAULT 'NORMAL',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "weight" INTEGER NOT NULL DEFAULT 10,
    "order" INTEGER NOT NULL DEFAULT 0,
    "imagePath" TEXT,
    "imageUrl" TEXT,
    "glow" BOOLEAN NOT NULL DEFAULT false,
    "payout3Bp" INTEGER NOT NULL DEFAULT 0,
    "payout4Bp" INTEGER NOT NULL DEFAULT 0,
    "payout5Bp" INTEGER NOT NULL DEFAULT 0,
    "premiumDays3" INTEGER NOT NULL DEFAULT 0,
    "premiumDays4" INTEGER NOT NULL DEFAULT 0,
    "premiumDays5" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "XpSlotSymbol_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "XpSlotSoundPack" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "XpSlotSoundPackKind" NOT NULL DEFAULT 'STANDARD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "XpSlotSoundPack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "XpSlotSound" (
    "id" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "volume" INTEGER NOT NULL DEFAULT 80,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "XpSlotSound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "XpSlotEvent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "overrides" JSONB NOT NULL,
    "symbolOverrides" JSONB,
    "soundPackId" TEXT,
    "createdByDiscordId" TEXT,
    "activatedAt" TIMESTAMP(3),
    "deactivatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "XpSlotEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "XpSlotFreespinPackage" (
    "id" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "granted" INTEGER NOT NULL,
    "remaining" INTEGER NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,
    "bet" INTEGER NOT NULL,
    "status" "XpSlotFreespinStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3),
    "reason" TEXT,
    "grantedByDiscordId" TEXT,
    "revokedByDiscordId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "XpSlotFreespinPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "XpSlotSpin" (
    "id" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "kind" "XpSlotSpinKind" NOT NULL DEFAULT 'PAID',
    "bet" INTEGER NOT NULL,
    "grid" TEXT[],
    "lines" JSONB NOT NULL,
    "grossWin" INTEGER NOT NULL DEFAULT 0,
    "netWin" INTEGER NOT NULL DEFAULT 0,
    "capped" BOOLEAN NOT NULL DEFAULT false,
    "jackpot" BOOLEAN NOT NULL DEFAULT false,
    "bonusTrigger" BOOLEAN NOT NULL DEFAULT false,
    "premiumDays" INTEGER NOT NULL DEFAULT 0,
    "xpBefore" INTEGER NOT NULL DEFAULT 0,
    "xpAfter" INTEGER NOT NULL DEFAULT 0,
    "configNote" JSONB,
    "freespinPackageId" TEXT,
    "bonusRoundId" TEXT,
    "eventId" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "XpSlotSpin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "XpSlotBonusRound" (
    "id" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "triggerSpinId" TEXT NOT NULL,
    "stage" "XpSlotBonusStage" NOT NULL DEFAULT 'LADDER_1',
    "bet" INTEGER NOT NULL,
    "awarded" INTEGER NOT NULL DEFAULT 0,
    "remaining" INTEGER NOT NULL DEFAULT 0,
    "played" INTEGER NOT NULL DEFAULT 0,
    "retriggers" INTEGER NOT NULL DEFAULT 0,
    "ladder" JSONB,
    "stickyCells" INTEGER[],
    "totalWin" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "XpSlotBonusRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "XpSlotPremiumGrant" (
    "id" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "spinId" TEXT NOT NULL,
    "days" INTEGER NOT NULL,
    "state" "XpSlotPremiumState" NOT NULL DEFAULT 'QUEUED',
    "note" TEXT,
    "subscriptionId" TEXT,
    "creditedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "XpSlotPremiumGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "XpSlotSession" (
    "id" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSpinAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "spins" INTEGER NOT NULL DEFAULT 0,
    "staked" INTEGER NOT NULL DEFAULT 0,
    "won" INTEGER NOT NULL DEFAULT 0,
    "bestWin" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "XpSlotSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "XpSlotDaily" (
    "id" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "spins" INTEGER NOT NULL DEFAULT 0,
    "staked" INTEGER NOT NULL DEFAULT 0,
    "won" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "XpSlotDaily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "XpSlotSymbol_key_key" ON "XpSlotSymbol"("key");

-- CreateIndex
CREATE INDEX "XpSlotSymbol_active_order_idx" ON "XpSlotSymbol"("active", "order");

-- CreateIndex
CREATE UNIQUE INDEX "XpSlotSound_packId_slot_key" ON "XpSlotSound"("packId", "slot");

-- CreateIndex
CREATE INDEX "XpSlotEvent_active_endsAt_idx" ON "XpSlotEvent"("active", "endsAt");

-- CreateIndex
CREATE INDEX "XpSlotFreespinPackage_discordId_status_idx" ON "XpSlotFreespinPackage"("discordId", "status");

-- CreateIndex
CREATE INDEX "XpSlotFreespinPackage_status_expiresAt_idx" ON "XpSlotFreespinPackage"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "XpSlotSpin_idempotencyKey_key" ON "XpSlotSpin"("idempotencyKey");

-- CreateIndex
CREATE INDEX "XpSlotSpin_discordId_createdAt_idx" ON "XpSlotSpin"("discordId", "createdAt");

-- CreateIndex
CREATE INDEX "XpSlotSpin_createdAt_idx" ON "XpSlotSpin"("createdAt");

-- CreateIndex
CREATE INDEX "XpSlotSpin_jackpot_createdAt_idx" ON "XpSlotSpin"("jackpot", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "XpSlotBonusRound_triggerSpinId_key" ON "XpSlotBonusRound"("triggerSpinId");

-- CreateIndex
CREATE INDEX "XpSlotBonusRound_discordId_stage_idx" ON "XpSlotBonusRound"("discordId", "stage");

-- CreateIndex
CREATE INDEX "XpSlotPremiumGrant_state_createdAt_idx" ON "XpSlotPremiumGrant"("state", "createdAt");

-- CreateIndex
CREATE INDEX "XpSlotPremiumGrant_discordId_createdAt_idx" ON "XpSlotPremiumGrant"("discordId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "XpSlotSession_discordId_key" ON "XpSlotSession"("discordId");

-- CreateIndex
CREATE INDEX "XpSlotSession_lastSpinAt_idx" ON "XpSlotSession"("lastSpinAt");

-- CreateIndex
CREATE INDEX "XpSlotDaily_day_idx" ON "XpSlotDaily"("day");

-- CreateIndex
CREATE UNIQUE INDEX "XpSlotDaily_discordId_day_key" ON "XpSlotDaily"("discordId", "day");

-- AddForeignKey
ALTER TABLE "XpSlotConfig" ADD CONSTRAINT "XpSlotConfig_activeSoundPackId_fkey" FOREIGN KEY ("activeSoundPackId") REFERENCES "XpSlotSoundPack"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "XpSlotSound" ADD CONSTRAINT "XpSlotSound_packId_fkey" FOREIGN KEY ("packId") REFERENCES "XpSlotSoundPack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "XpSlotEvent" ADD CONSTRAINT "XpSlotEvent_soundPackId_fkey" FOREIGN KEY ("soundPackId") REFERENCES "XpSlotSoundPack"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "XpSlotSpin" ADD CONSTRAINT "XpSlotSpin_freespinPackageId_fkey" FOREIGN KEY ("freespinPackageId") REFERENCES "XpSlotFreespinPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "XpSlotSpin" ADD CONSTRAINT "XpSlotSpin_bonusRoundId_fkey" FOREIGN KEY ("bonusRoundId") REFERENCES "XpSlotBonusRound"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "XpSlotSpin" ADD CONSTRAINT "XpSlotSpin_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "XpSlotEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "XpSlotBonusRound" ADD CONSTRAINT "XpSlotBonusRound_triggerSpinId_fkey" FOREIGN KEY ("triggerSpinId") REFERENCES "XpSlotSpin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "XpSlotPremiumGrant" ADD CONSTRAINT "XpSlotPremiumGrant_spinId_fkey" FOREIGN KEY ("spinId") REFERENCES "XpSlotSpin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

