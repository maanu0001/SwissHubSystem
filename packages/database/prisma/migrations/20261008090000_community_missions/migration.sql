-- Community Missions.
--
-- Rein additiv: drei Enums, vier neue Tabellen, keine bestehende Spalte
-- angefasst, keine bestehende Zeile veraendert. Wer diese Migration
-- einspielt und das Modul nicht einschaltet, merkt nichts davon.
--
-- Die beiden Eindeutigkeiten weiter unten sind keine Schoenheit, sondern die
-- eigentliche Absicherung des Moduls:
--
--   MissionFortschritt(missionId, discordId)  - ein Stand je Mitglied
--   MissionBelohnung(missionId, discordId)    - eine Belohnung je Mitglied
--
-- Die zweite traegt das Versprechen aus der Spezifikation, dass eine Mission
-- ihre Belohnung genau einmal vergibt. Sie wird vor dem Verschenken
-- geschrieben; wer sie nicht anlegen kann, hat verloren und vergibt nichts.
-- Ein Neustart des Bots, ein zweiter Worker oder ein Retry kommen damit
-- nicht an der Datenbank vorbei.

-- CreateEnum
CREATE TYPE "MissionArt" AS ENUM ('WOCHE', 'CHALLENGE');

-- CreateEnum
CREATE TYPE "MissionTyp" AS ENUM ('VOICE_MINUTEN', 'NACHRICHTEN', 'CLIP_EINGEREICHT', 'TURNIER_TEILNAHME', 'PROFIL_VOLLSTAENDIG', 'LEVEL_ERREICHT');

-- CreateEnum
CREATE TYPE "MissionStatus" AS ENUM ('ENTWURF', 'GEPLANT', 'LAEUFT', 'ABGESCHLOSSEN', 'ABGEBROCHEN');

-- CreateTable
CREATE TABLE "Mission" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "art" "MissionArt" NOT NULL,
    "typ" "MissionTyp" NOT NULL,
    "titel" TEXT NOT NULL,
    "beschreibung" TEXT,
    "ziel" INTEGER NOT NULL,
    "mindestBeitrag" INTEGER NOT NULL DEFAULT 1,
    "beginntAm" TIMESTAMP(3) NOT NULL,
    "endetAm" TIMESTAMP(3) NOT NULL,
    "status" "MissionStatus" NOT NULL DEFAULT 'ENTWURF',
    "abgeschlossenAm" TIMESTAMP(3),
    "belohnungXp" INTEGER NOT NULL DEFAULT 0,
    "belohnungPremiumTage" INTEGER NOT NULL DEFAULT 0,
    "belohnungAuszeichnung" TEXT,
    "vorlageId" TEXT,
    "angekuendigtStartAm" TIMESTAMP(3),
    "angekuendigtAbschlussAm" TIMESTAMP(3),
    "erstelltVonDiscordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Mission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MissionFortschritt" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "wert" INTEGER NOT NULL DEFAULT 0,
    "aktualisiertAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MissionFortschritt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MissionBelohnung" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "premiumTage" INTEGER NOT NULL DEFAULT 0,
    "auszeichnung" TEXT,
    "ergebnis" TEXT,
    "vergebenAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MissionBelohnung_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MissionVorlage" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "art" "MissionArt" NOT NULL,
    "typ" "MissionTyp" NOT NULL,
    "titel" TEXT NOT NULL,
    "beschreibung" TEXT,
    "ziel" INTEGER NOT NULL,
    "mindestBeitrag" INTEGER NOT NULL DEFAULT 1,
    "belohnungXp" INTEGER NOT NULL DEFAULT 0,
    "belohnungPremiumTage" INTEGER NOT NULL DEFAULT 0,
    "belohnungAuszeichnung" TEXT,
    "aktiv" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MissionVorlage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Mission_guildId_status_endetAm_idx" ON "Mission"("guildId", "status", "endetAm");

-- CreateIndex
CREATE INDEX "Mission_guildId_beginntAm_idx" ON "Mission"("guildId", "beginntAm");

-- CreateIndex
CREATE INDEX "MissionFortschritt_missionId_wert_idx" ON "MissionFortschritt"("missionId", "wert");

-- CreateIndex
CREATE UNIQUE INDEX "MissionFortschritt_missionId_discordId_key" ON "MissionFortschritt"("missionId", "discordId");

-- CreateIndex
CREATE INDEX "MissionBelohnung_discordId_vergebenAm_idx" ON "MissionBelohnung"("discordId", "vergebenAm");

-- CreateIndex
CREATE UNIQUE INDEX "MissionBelohnung_missionId_discordId_key" ON "MissionBelohnung"("missionId", "discordId");

-- CreateIndex
CREATE UNIQUE INDEX "MissionVorlage_name_key" ON "MissionVorlage"("name");

-- AddForeignKey
ALTER TABLE "Mission" ADD CONSTRAINT "Mission_vorlageId_fkey" FOREIGN KEY ("vorlageId") REFERENCES "MissionVorlage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionFortschritt" ADD CONSTRAINT "MissionFortschritt_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionBelohnung" ADD CONSTRAINT "MissionBelohnung_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

