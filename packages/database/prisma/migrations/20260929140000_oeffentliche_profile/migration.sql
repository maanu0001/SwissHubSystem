-- Oeffentliche Profile.
--
-- Rein additiv, und bewusst ohne Datenaenderung:
--
--   * `PUBLIC` kommt als dritter Wert dazu. Kein bestehendes Profil wird
--     darauf gesetzt. Wer heute `MEMBERS` stehen hat, hat fuer angemeldete
--     Mitglieder freigegeben und nicht fuer das offene Netz - das
--     nachtraeglich umzudeuten waere eine stille Ausweitung einer
--     Datenschutz-Einstellung.
--   * `publicSlug` bleibt ueberall NULL. Ein in der Migration geratener
--     Slug waere eine Adresse, die niemand gewaehlt hat. Er entsteht, wenn
--     jemand sein Profil oeffentlich stellt.
--
-- Nach dieser Migration ist also kein einziges Profil oeffentlich. Das ist
-- die Absicht.

-- AlterEnum
ALTER TYPE "ProfileVisibility" ADD VALUE 'PUBLIC';

-- AlterTable
ALTER TABLE "MemberProfile" ADD COLUMN "publicSlug" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "MemberProfile_publicSlug_key" ON "MemberProfile"("publicSlug");
