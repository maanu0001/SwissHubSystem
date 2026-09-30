-- Die Vitrine eines Streamers: bis zu drei eigene Clips und eine
-- hervorgehobene Social-Media-Zeile auf dem oeffentlichen Profil.
--
-- Rein additiv: eine nullbare Spalte an StreamerProfil, eine neue Tabelle.
-- Kein DROP, kein TRUNCATE, keine bestehende Spalte angefasst. Bestehende
-- Streamer-Profile haben danach eine leere Vitrine und keine Zeile - genau
-- wie vorher.
--
-- Eine eigene Tabelle und nicht die `Clip`-Tabelle von Clip of the Week:
-- dort sind Clips Wettbewerbseinreichungen mit Moderationszustand, Stimmen
-- und Platzierungen. Gemeinsam gehalten braeuchte jede CotW-Abfrage ab
-- sofort einen Filter, und die eine, die ihn vergisst, legt einem Moderator
-- fremde Links in die Warteschlange. Geteilt wird die Logik (erkenneClip,
-- einbettung), nicht die Tabelle.

ALTER TABLE "StreamerProfil" ADD COLUMN "socialCaption" TEXT;

CREATE TABLE "StreamerClip" (
    "id" TEXT NOT NULL,
    "profilId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "canonicalUrl" TEXT NOT NULL,
    "embedUrl" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "titel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StreamerClip_pkey" PRIMARY KEY ("id")
);

-- Ein Platz ist einmal belegt, und derselbe Clip steht nicht zweimal in
-- derselben Vitrine. Beides in der Datenbank und nicht in einer Pruefung,
-- die zwei gleichzeitige Klicks beide passieren lassen.
CREATE UNIQUE INDEX "StreamerClip_profilId_position_key" ON "StreamerClip"("profilId", "position");
CREATE UNIQUE INDEX "StreamerClip_profilId_provider_externalId_key" ON "StreamerClip"("profilId", "provider", "externalId");

ALTER TABLE "StreamerClip" ADD CONSTRAINT "StreamerClip_profilId_fkey"
  FOREIGN KEY ("profilId") REFERENCES "StreamerProfil"("id") ON DELETE CASCADE ON UPDATE CASCADE;
