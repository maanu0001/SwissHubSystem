-- Mitgliederprofile
--
-- Vier Tabellen und drei Aufzaehlungstypen, alles neu. Keine bestehende
-- Spalte wird angefasst, keine Zeile geaendert, nichts geloescht: wer heute
-- kein Profil hat, hat danach keine Zeile - und das ist der Normalfall.
--
-- `Game` bekommt lediglich eine Gegenrelation; sie entsteht ueber den
-- Fremdschluessel in `MemberGameProfile` und aendert die Tabelle nicht.

-- CreateEnum
CREATE TYPE "ProfileVisibility" AS ENUM ('MEMBERS', 'PRIVATE');

-- CreateEnum
CREATE TYPE "PlayStyle" AS ENUM ('CASUAL', 'COMPETITIVE', 'BOTH');

-- CreateEnum
CREATE TYPE "Availability" AS ENUM ('UNSET', 'LOOKING', 'OPEN', 'BUSY');

-- CreateTable
CREATE TABLE "MemberProfile" (
    "id" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "displayName" TEXT,
    "tagline" TEXT,
    "bio" TEXT,
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "platforms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "playtimes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "comms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "playStyle" "PlayStyle" NOT NULL DEFAULT 'BOTH',
    "availability" "Availability" NOT NULL DEFAULT 'UNSET',
    "bannerPath" TEXT,
    "bannerPreset" TEXT,
    "theme" TEXT NOT NULL DEFAULT 'swisshub',
    "accent" TEXT NOT NULL DEFAULT 'rot',
    "visibilityProfile" "ProfileVisibility" NOT NULL DEFAULT 'MEMBERS',
    "visibilityGames" "ProfileVisibility" NOT NULL DEFAULT 'MEMBERS',
    "visibilitySocials" "ProfileVisibility" NOT NULL DEFAULT 'PRIVATE',
    "visibilityCareer" "ProfileVisibility" NOT NULL DEFAULT 'MEMBERS',
    "visibilityActivity" "ProfileVisibility" NOT NULL DEFAULT 'MEMBERS',
    "discoverable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberGameProfile" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "platform" TEXT,
    "note" TEXT,
    "favorite" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "fields" JSONB NOT NULL DEFAULT '{}',
    "fieldsVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberGameProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberSocialLink" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberSocialLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberShowcase" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "refId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberShowcase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MemberProfile_discordId_key" ON "MemberProfile"("discordId");

-- CreateIndex
CREATE INDEX "MemberProfile_discoverable_availability_idx" ON "MemberProfile"("discoverable", "availability");

-- CreateIndex
CREATE INDEX "MemberProfile_playStyle_idx" ON "MemberProfile"("playStyle");

-- CreateIndex
CREATE INDEX "MemberGameProfile_profileId_sortOrder_idx" ON "MemberGameProfile"("profileId", "sortOrder");

-- CreateIndex
CREATE INDEX "MemberGameProfile_gameId_idx" ON "MemberGameProfile"("gameId");

-- CreateIndex
CREATE UNIQUE INDEX "MemberGameProfile_profileId_gameId_key" ON "MemberGameProfile"("profileId", "gameId");

-- CreateIndex
CREATE INDEX "MemberSocialLink_profileId_sortOrder_idx" ON "MemberSocialLink"("profileId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "MemberSocialLink_profileId_platform_key" ON "MemberSocialLink"("profileId", "platform");

-- CreateIndex
CREATE INDEX "MemberShowcase_profileId_slot_idx" ON "MemberShowcase"("profileId", "slot");

-- CreateIndex
CREATE UNIQUE INDEX "MemberShowcase_profileId_slot_key" ON "MemberShowcase"("profileId", "slot");

-- AddForeignKey
ALTER TABLE "MemberGameProfile" ADD CONSTRAINT "MemberGameProfile_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "MemberProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberGameProfile" ADD CONSTRAINT "MemberGameProfile_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberSocialLink" ADD CONSTRAINT "MemberSocialLink_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "MemberProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberShowcase" ADD CONSTRAINT "MemberShowcase_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "MemberProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

