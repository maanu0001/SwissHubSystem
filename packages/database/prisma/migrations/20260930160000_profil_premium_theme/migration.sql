-- Premium-Themes fuer die oeffentliche Profilseite.
--
-- Rein additiv, eine Spalte, nullbar. `NULL` ist «SwissHub Classic» - der
-- Zustand, in dem jedes bestehende Profil heute ist. Kein Bestandsprofil
-- aendert dadurch sein Aussehen.
--
-- Gespeichert wird ein Schluessel aus der Registry in
-- `packages/modules/src/profile/profil-themes.ts`, nie eine Farbe und nie
-- CSS. Ob der Schluessel wirkt, entscheidet die Anwendung beim Zeichnen
-- anhand der Premium-Ansprueche - deshalb raeumt hier nichts auf, wenn ein
-- Abonnement endet, und deshalb gibt es auch keinen Zeitgeber dafuer.

ALTER TABLE "MemberProfile" ADD COLUMN "premiumTheme" TEXT;
