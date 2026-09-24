-- Von Hand verliehene Auszeichnungen.
--
-- Rein additiv. Die abgeleiteten Auszeichnungen bleiben, was sie sind:
-- gerechnet und in keiner Tabelle. Hier stehen nur die, fuer die es keine
-- Zahl gibt, sondern eine Entscheidung.
--
-- `@@unique(discordId, key)` ist der Riegel gegen die doppelte Verleihung -
-- auch bei zwei gleichzeitigen Klicks.

-- CreateTable
CREATE TABLE "MemberAward" (
    "id" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "grantedByDiscordId" TEXT NOT NULL,
    "note" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberAward_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MemberAward_discordId_key_key" ON "MemberAward"("discordId", "key");

-- CreateIndex
CREATE INDEX "MemberAward_discordId_idx" ON "MemberAward"("discordId");
