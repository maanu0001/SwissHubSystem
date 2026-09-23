-- Die Mitglieder des Servers, gespiegelt aus Discord.
--
-- Bisher wurden Mitglieder bei jedem Seitenaufruf direkt bei Discord geholt -
-- und zwar genau eine Seite, gedeckelt auf 100. Gesucht und gefiltert wurde
-- danach in JavaScript, also in diesen 100 Eintraegen. Ueber alle Mitglieder
-- zu suchen heisst, alle zu kennen; dieselbe Loesung wie fuer Rollen und
-- Kanaele.
--
-- Additiv: eine neue Tabelle, keine vorhandene wird angefasst.
CREATE TABLE "DiscordMemberCache" (
    "discordId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "globalName" TEXT,
    "nickname" TEXT,
    "displayName" TEXT NOT NULL,
    "avatarHash" TEXT,
    "isBot" BOOLEAN NOT NULL DEFAULT false,
    "roleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "joinedAt" TIMESTAMP(3),
    "accountCreatedAt" TIMESTAMP(3),
    "boosting" BOOLEAN NOT NULL DEFAULT false,
    "timedOutUntil" TIMESTAMP(3),
    "searchText" TEXT NOT NULL DEFAULT '',
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "DiscordMemberCache_pkey" PRIMARY KEY ("discordId")
);

-- Die Liste: aktive Mitglieder, nach Name sortiert.
CREATE INDEX "DiscordMemberCache_leftAt_isBot_displayName_idx"
    ON "DiscordMemberCache"("leftAt", "isBot", "displayName");

-- Sortierung nach Beitritt.
CREATE INDEX "DiscordMemberCache_leftAt_joinedAt_idx"
    ON "DiscordMemberCache"("leftAt", "joinedAt");

-- Der Rollenfilter - ohne GIN waere jede Rollenabfrage ein Tabellenscan.
CREATE INDEX "DiscordMemberCache_roleIds_idx" ON "DiscordMemberCache" USING GIN ("roleIds");
