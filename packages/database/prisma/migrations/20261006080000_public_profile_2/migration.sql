-- Public Profile 2.0: Link-in-Bio, Abschnittsreihenfolge, Slug-Aliasse.
--
-- Ausschliesslich hinzufuegend. Kein DROP, kein UPDATE, kein DELETE, keine
-- Aenderung an einer bestehenden Spalte: jede Zeile unten legt etwas Neues an
-- oder haengt eine Spalte mit Vorgabewert an. Bestehende Profile, Themes,
-- Banner, XP-Werte und Auszeichnungen bleiben unberuehrt.
--
-- Die Vorgaben der neuen Sichtbarkeitsspalten sind der **bisherige** Zustand:
-- Level und Auszeichnungen standen schon auf jeder oeffentlichen Profilseite,
-- der Streaming-Abschnitt seit dem Streamer Hub. Turniererfolge waren nie
-- oeffentlich und stehen deshalb auf MEMBERS - diese Migration veroeffentlicht
-- nichts, was niemand freigegeben hat.

-- AlterTable
ALTER TABLE "MemberProfile" ADD COLUMN     "highlightAwards" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "publicIndexable" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "publicSections" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "visibilityAwards" "ProfileVisibility" NOT NULL DEFAULT 'PUBLIC',
ADD COLUMN     "visibilityLevel" "ProfileVisibility" NOT NULL DEFAULT 'PUBLIC',
ADD COLUMN     "visibilityStreaming" "ProfileVisibility" NOT NULL DEFAULT 'PUBLIC',
ADD COLUMN     "visibilityTournaments" "ProfileVisibility" NOT NULL DEFAULT 'MEMBERS';

-- AlterTable
ALTER TABLE "MemberSocialLink" ADD COLUMN     "featured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "hidden" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "label" TEXT;

-- CreateTable
CREATE TABLE "MemberProfileLink" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberProfileLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberProfileSlugAlias" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberProfileSlugAlias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MemberProfileLink_profileId_sortOrder_idx" ON "MemberProfileLink"("profileId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "MemberProfileLink_profileId_url_key" ON "MemberProfileLink"("profileId", "url");

-- CreateIndex
CREATE UNIQUE INDEX "MemberProfileSlugAlias_slug_key" ON "MemberProfileSlugAlias"("slug");

-- CreateIndex
CREATE INDEX "MemberProfileSlugAlias_discordId_idx" ON "MemberProfileSlugAlias"("discordId");

-- AddForeignKey
ALTER TABLE "MemberProfileLink" ADD CONSTRAINT "MemberProfileLink_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "MemberProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

