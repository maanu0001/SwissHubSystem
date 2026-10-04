-- XP-Slot: geschenkte Bonusspiele, Paketgewinne und Meldezeitpunkte.
--
-- Additiv, mit einer Ausnahme, die gleich erklaert wird. Jede neue Spalte hat
-- eine Vorgabe oder darf leer sein; bestehende Pakete, Runden und Spins
-- bleiben unveraendert.
--
-- ## Die eine Lockerung: `triggerSpinId` darf leer sein
--
-- Eine Bonusrunde entstand bisher immer aus einem Spin, und die Spalte war
-- deshalb verpflichtend. Ein **geschenktes** Bonusspiel hat keinen solchen
-- Spin. Einen zu erfinden, nur damit die Spalte gefuellt ist, hiesse einen
-- Spin in die Historie zu schreiben, den niemand gedreht hat - mit Einsatz,
-- Gewinn und Zeitstempel, alles erfunden.
--
-- `DROP NOT NULL` ist eine Lockerung und verliert nichts: jede bestehende
-- Zeile behaelt ihren Ausloeser. Genau eines von beiden ist gesetzt, und
-- welches, sagt die Anwendung.

-- --- Freispielpakete: Meldungen und Paketgewinn ---------------------------
ALTER TABLE "XpSlotFreespinPackage" ADD COLUMN "introSeenAt" TIMESTAMP(3);
ALTER TABLE "XpSlotFreespinPackage" ADD COLUMN "outroSeenAt" TIMESTAMP(3);
ALTER TABLE "XpSlotFreespinPackage" ADD COLUMN "packageWin" INTEGER NOT NULL DEFAULT 0;

-- --- Geschenkte Bonusspiele ----------------------------------------------
CREATE TYPE "XpSlotBonusGrantStatus" AS ENUM ('PENDING', 'STARTED', 'FINISHED', 'REVOKED', 'EXPIRED');

CREATE TABLE "XpSlotBonusGrant" (
    "id" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "bet" INTEGER NOT NULL,
    "reason" TEXT,
    "status" "XpSlotBonusGrantStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3),
    "introSeenAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "grantedByDiscordId" TEXT,
    "revokedByDiscordId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "XpSlotBonusGrant_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "XpSlotBonusGrant_discordId_status_idx" ON "XpSlotBonusGrant"("discordId", "status");
CREATE INDEX "XpSlotBonusGrant_status_expiresAt_idx" ON "XpSlotBonusGrant"("status", "expiresAt");

-- --- Bonusrunde: Herkunft und Abschlussmeldung ----------------------------
ALTER TABLE "XpSlotBonusRound" ALTER COLUMN "triggerSpinId" DROP NOT NULL;
ALTER TABLE "XpSlotBonusRound" ADD COLUMN "grantId" TEXT;
ALTER TABLE "XpSlotBonusRound" ADD COLUMN "outroSeenAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "XpSlotBonusRound_grantId_key" ON "XpSlotBonusRound"("grantId");
ALTER TABLE "XpSlotBonusRound" ADD CONSTRAINT "XpSlotBonusRound_grantId_fkey"
    FOREIGN KEY ("grantId") REFERENCES "XpSlotBonusGrant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
