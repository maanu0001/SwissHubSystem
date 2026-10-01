-- CreateEnum
CREATE TYPE "EmojiHerkunft" AS ENUM ('UPLOAD', 'IMPORT', 'DISCORD_ANHANG');

-- CreateEnum
CREATE TYPE "EmojiAntragStatus" AS ENUM ('OFFEN', 'ABSTIMMUNG', 'ANGENOMMEN', 'ABGELEHNT', 'ABGELAUFEN');

-- CreateTable
CREATE TABLE "EmojiAntrag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pruefsumme" TEXT NOT NULL,
    "dateiName" TEXT NOT NULL,
    "mimeTyp" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "animiert" BOOLEAN NOT NULL DEFAULT false,
    "breite" INTEGER,
    "hoehe" INTEGER,
    "herkunft" "EmojiHerkunft" NOT NULL,
    "herkunftNotiz" TEXT,
    "status" "EmojiAntragStatus" NOT NULL DEFAULT 'OFFEN',
    "antragstellerId" TEXT NOT NULL,
    "begruendung" TEXT,
    "modChannelId" TEXT,
    "modMessageId" TEXT,
    "abstimmungStartetAm" TIMESTAMP(3),
    "abstimmungEndetAm" TIMESTAMP(3),
    "stimmenZiel" INTEGER,
    "abstimmungChannelId" TEXT,
    "abstimmungMessageId" TEXT,
    "entschiedenVon" TEXT,
    "entschiedenAm" TIMESTAMP(3),
    "ablehnungsGrund" TEXT,
    "emojiId" TEXT,
    "emojiName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmojiAntrag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmojiStimme" (
    "id" TEXT NOT NULL,
    "antragId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmojiStimme_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmojiAntrag_status_idx" ON "EmojiAntrag"("status");

-- CreateIndex
CREATE INDEX "EmojiAntrag_pruefsumme_idx" ON "EmojiAntrag"("pruefsumme");

-- CreateIndex
CREATE INDEX "EmojiAntrag_antragstellerId_idx" ON "EmojiAntrag"("antragstellerId");

-- CreateIndex
CREATE INDEX "EmojiAntrag_status_abstimmungEndetAm_idx" ON "EmojiAntrag"("status", "abstimmungEndetAm");

-- CreateIndex
CREATE INDEX "EmojiStimme_antragId_idx" ON "EmojiStimme"("antragId");

-- CreateIndex
CREATE UNIQUE INDEX "EmojiStimme_antragId_discordId_key" ON "EmojiStimme"("antragId", "discordId");

-- AddForeignKey
ALTER TABLE "EmojiStimme" ADD CONSTRAINT "EmojiStimme_antragId_fkey" FOREIGN KEY ("antragId") REFERENCES "EmojiAntrag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

