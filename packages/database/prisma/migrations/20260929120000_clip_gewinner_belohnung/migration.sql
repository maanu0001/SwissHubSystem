-- Was der Gewinner einer Clip-Runde bekommen hat.
--
-- Rein additiv: ein Aufzaehlungstyp und eine Tabelle. Keine bestehende
-- Spalte wird angefasst, kein Wert umgeschrieben.
--
-- Der Riegel steckt in `ClipCompetitionReward_competitionId_key`: genau eine
-- Belohnung je Runde. Ein zweiter Abschlusslauf scheitert daran in der
-- Datenbank - und nicht an einer Abfrage, die zu frueh gelesen hat.

-- CreateEnum
CREATE TYPE "ClipRewardKind" AS ENUM ('PREMIUM', 'XP', 'NONE');

-- CreateTable
CREATE TABLE "ClipCompetitionReward" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "winnerDiscordId" TEXT NOT NULL,
    "kind" "ClipRewardKind" NOT NULL,
    "subscriptionId" TEXT,
    "xpAmount" INTEGER,
    "reason" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClipCompetitionReward_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClipCompetitionReward_competitionId_key" ON "ClipCompetitionReward"("competitionId");

-- CreateIndex
CREATE INDEX "ClipCompetitionReward_winnerDiscordId_idx" ON "ClipCompetitionReward"("winnerDiscordId");

-- AddForeignKey
ALTER TABLE "ClipCompetitionReward" ADD CONSTRAINT "ClipCompetitionReward_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "ClipCompetition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
