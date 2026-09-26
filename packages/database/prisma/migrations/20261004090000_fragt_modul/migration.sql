-- CreateEnum
CREATE TYPE "FragtFragetyp" AS ENUM ('ENTWEDER_ODER', 'UMFRAGE', 'FAVORIT', 'HOT_TAKE');

-- CreateEnum
CREATE TYPE "FragtFrageStatus" AS ENUM ('DRAFT', 'READY', 'SCHEDULED', 'ACTIVE', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "FragtAbstimmungStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "FragtEntwurfStatus" AS ENUM ('OFFEN', 'FINALISIERT', 'VEROEFFENTLICHT');

-- CreateTable
CREATE TABLE "FragtFrage" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "untertitel" TEXT,
    "kategorie" TEXT NOT NULL,
    "typ" "FragtFragetyp" NOT NULL,
    "status" "FragtFrageStatus" NOT NULL DEFAULT 'DRAFT',
    "tags" TEXT[],
    "dauerStunden" INTEGER NOT NULL DEFAULT 48,
    "geplantAt" TIMESTAMP(3),
    "medienDatei" TEXT,
    "zuletztGestelltAt" TIMESTAMP(3),
    "createdByDiscordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "FragtFrage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FragtOption" (
    "id" TEXT NOT NULL,
    "frageId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FragtOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FragtAbstimmung" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "frageId" TEXT NOT NULL,
    "status" "FragtAbstimmungStatus" NOT NULL DEFAULT 'ACTIVE',
    "frageText" TEXT NOT NULL,
    "untertitel" TEXT,
    "typ" "FragtFragetyp" NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT,
    "ergebnisMessageId" TEXT,
    "opensAt" TIMESTAMP(3) NOT NULL,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "ergebnis" JSONB,
    "finalVotes" INTEGER NOT NULL DEFAULT 0,
    "zwischenstandSichtbar" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FragtAbstimmung_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FragtStimme" (
    "id" TEXT NOT NULL,
    "abstimmungId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "voterDiscordId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FragtStimme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FragtEntwurf" (
    "id" TEXT NOT NULL,
    "abstimmungId" TEXT NOT NULL,
    "status" "FragtEntwurfStatus" NOT NULL DEFAULT 'OFFEN',
    "vorlage" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "ueberschrift" TEXT NOT NULL,
    "untertitel" TEXT,
    "cta" TEXT NOT NULL,
    "folien" JSONB NOT NULL,
    "medienDatei" TEXT,
    "veroeffentlichtAt" TIMESTAMP(3),
    "createdByDiscordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FragtEntwurf_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FragtFrage_guildId_status_idx" ON "FragtFrage"("guildId", "status");

-- CreateIndex
CREATE INDEX "FragtFrage_guildId_geplantAt_idx" ON "FragtFrage"("guildId", "geplantAt");

-- CreateIndex
CREATE INDEX "FragtFrage_guildId_status_zuletztGestelltAt_idx" ON "FragtFrage"("guildId", "status", "zuletztGestelltAt");

-- CreateIndex
CREATE INDEX "FragtOption_frageId_idx" ON "FragtOption"("frageId");

-- CreateIndex
CREATE UNIQUE INDEX "FragtOption_frageId_position_key" ON "FragtOption"("frageId", "position");

-- CreateIndex
CREATE INDEX "FragtAbstimmung_guildId_status_closesAt_idx" ON "FragtAbstimmung"("guildId", "status", "closesAt");

-- CreateIndex
CREATE INDEX "FragtAbstimmung_messageId_idx" ON "FragtAbstimmung"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "FragtAbstimmung_frageId_opensAt_key" ON "FragtAbstimmung"("frageId", "opensAt");

-- CreateIndex
CREATE INDEX "FragtStimme_abstimmungId_optionId_idx" ON "FragtStimme"("abstimmungId", "optionId");

-- CreateIndex
CREATE UNIQUE INDEX "FragtStimme_abstimmungId_voterDiscordId_key" ON "FragtStimme"("abstimmungId", "voterDiscordId");

-- CreateIndex
CREATE INDEX "FragtEntwurf_status_idx" ON "FragtEntwurf"("status");

-- CreateIndex
CREATE UNIQUE INDEX "FragtEntwurf_abstimmungId_key" ON "FragtEntwurf"("abstimmungId");

-- AddForeignKey
ALTER TABLE "FragtOption" ADD CONSTRAINT "FragtOption_frageId_fkey" FOREIGN KEY ("frageId") REFERENCES "FragtFrage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FragtAbstimmung" ADD CONSTRAINT "FragtAbstimmung_frageId_fkey" FOREIGN KEY ("frageId") REFERENCES "FragtFrage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FragtStimme" ADD CONSTRAINT "FragtStimme_abstimmungId_fkey" FOREIGN KEY ("abstimmungId") REFERENCES "FragtAbstimmung"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FragtStimme" ADD CONSTRAINT "FragtStimme_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "FragtOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FragtEntwurf" ADD CONSTRAINT "FragtEntwurf_abstimmungId_fkey" FOREIGN KEY ("abstimmungId") REFERENCES "FragtAbstimmung"("id") ON DELETE CASCADE ON UPDATE CASCADE;
