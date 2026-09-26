-- CreateEnum
CREATE TYPE "StreamerPlattform" AS ENUM ('TWITCH', 'YOUTUBE');

-- CreateEnum
CREATE TYPE "StreamerStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "StreamerVerifikation" AS ENUM ('KEINE', 'OAUTH', 'MANUELL');

-- CreateEnum
CREATE TYPE "StreamerSpotlightStatus" AS ENUM ('DRAFT', 'FINAL', 'VEROEFFENTLICHT');

-- CreateTable
CREATE TABLE "StreamerProfil" (
    "id" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "status" "StreamerStatus" NOT NULL DEFAULT 'DRAFT',
    "beschreibung" TEXT,
    "sprachen" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ankuendigungAktiv" BOOLEAN NOT NULL DEFAULT true,
    "ablehnungsGrund" TEXT,
    "eingereichtAm" TIMESTAMP(3),
    "entschiedenAm" TIMESTAMP(3),
    "entschiedenVon" TEXT,
    "pausiertAm" TIMESTAMP(3),
    "pausiertVon" TEXT,
    "pausierungsGrund" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StreamerProfil_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StreamerKanal" (
    "id" TEXT NOT NULL,
    "profilId" TEXT NOT NULL,
    "plattform" "StreamerPlattform" NOT NULL,
    "externeId" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "anzeigename" TEXT,
    "verifikation" "StreamerVerifikation" NOT NULL DEFAULT 'KEINE',
    "verifiziertAm" TIMESTAMP(3),
    "verifiziertVon" TEXT,
    "aktiv" BOOLEAN NOT NULL DEFAULT true,
    "zuletztGeprueftAm" TIMESTAMP(3),
    "letzterFehler" TEXT,
    "letzterFehlerAm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StreamerKanal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StreamerSession" (
    "id" TEXT NOT NULL,
    "kanalId" TEXT NOT NULL,
    "externeSessionId" TEXT NOT NULL,
    "titel" TEXT,
    "spiel" TEXT,
    "vorschaubildUrl" TEXT,
    "zuschauer" INTEGER,
    "sprache" TEXT,
    "streamUrl" TEXT,
    "gestartetAm" TIMESTAMP(3) NOT NULL,
    "zuletztGesehenAm" TIMESTAMP(3) NOT NULL,
    "beendetAm" TIMESTAMP(3),
    "zuschauerHoehepunkt" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StreamerSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StreamerAnkuendigung" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT,
    "gesendetAm" TIMESTAMP(3),
    "fehler" TEXT,
    "versuche" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StreamerAnkuendigung_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StreamerSpotlight" (
    "id" TEXT NOT NULL,
    "profilId" TEXT NOT NULL,
    "status" "StreamerSpotlightStatus" NOT NULL DEFAULT 'DRAFT',
    "ueberschrift" TEXT,
    "beschreibung" TEXT,
    "cta" TEXT,
    "erstelltVon" TEXT,
    "discordChannelId" TEXT,
    "discordMessageId" TEXT,
    "veroeffentlichtAm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StreamerSpotlight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StreamerApiVerbrauch" (
    "id" TEXT NOT NULL,
    "plattform" "StreamerPlattform" NOT NULL,
    "tag" TEXT NOT NULL,
    "einheiten" INTEGER NOT NULL DEFAULT 0,
    "abfragen" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StreamerApiVerbrauch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StreamerProfil_discordId_key" ON "StreamerProfil"("discordId");

-- CreateIndex
CREATE INDEX "StreamerProfil_status_idx" ON "StreamerProfil"("status");

-- CreateIndex
CREATE INDEX "StreamerProfil_status_eingereichtAm_idx" ON "StreamerProfil"("status", "eingereichtAm");

-- CreateIndex
CREATE INDEX "StreamerKanal_plattform_aktiv_idx" ON "StreamerKanal"("plattform", "aktiv");

-- CreateIndex
CREATE UNIQUE INDEX "StreamerKanal_plattform_externeId_key" ON "StreamerKanal"("plattform", "externeId");

-- CreateIndex
CREATE UNIQUE INDEX "StreamerKanal_profilId_plattform_key" ON "StreamerKanal"("profilId", "plattform");

-- CreateIndex
CREATE INDEX "StreamerSession_beendetAm_gestartetAm_idx" ON "StreamerSession"("beendetAm", "gestartetAm");

-- CreateIndex
CREATE INDEX "StreamerSession_kanalId_gestartetAm_idx" ON "StreamerSession"("kanalId", "gestartetAm");

-- CreateIndex
CREATE UNIQUE INDEX "StreamerSession_kanalId_externeSessionId_key" ON "StreamerSession"("kanalId", "externeSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "StreamerAnkuendigung_sessionId_key" ON "StreamerAnkuendigung"("sessionId");

-- CreateIndex
CREATE INDEX "StreamerAnkuendigung_gesendetAm_idx" ON "StreamerAnkuendigung"("gesendetAm");

-- CreateIndex
CREATE INDEX "StreamerSpotlight_profilId_createdAt_idx" ON "StreamerSpotlight"("profilId", "createdAt");

-- CreateIndex
CREATE INDEX "StreamerSpotlight_status_idx" ON "StreamerSpotlight"("status");

-- CreateIndex
CREATE UNIQUE INDEX "StreamerApiVerbrauch_plattform_tag_key" ON "StreamerApiVerbrauch"("plattform", "tag");

-- AddForeignKey
ALTER TABLE "StreamerKanal" ADD CONSTRAINT "StreamerKanal_profilId_fkey" FOREIGN KEY ("profilId") REFERENCES "StreamerProfil"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StreamerSession" ADD CONSTRAINT "StreamerSession_kanalId_fkey" FOREIGN KEY ("kanalId") REFERENCES "StreamerKanal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StreamerAnkuendigung" ADD CONSTRAINT "StreamerAnkuendigung_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "StreamerSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StreamerSpotlight" ADD CONSTRAINT "StreamerSpotlight_profilId_fkey" FOREIGN KEY ("profilId") REFERENCES "StreamerProfil"("id") ON DELETE CASCADE ON UPDATE CASCADE;

