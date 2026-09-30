-- Eine Runde aus der Hall of Fame nehmen, ohne sie zu loeschen.
--
-- Rein additiv: drei Spalten, alle nullbar. Kein DROP, kein TRUNCATE, kein
-- umgeschriebener Wert - bestehende Runden bleiben sichtbar, weil `NULL`
-- heisst «nicht ausgeblendet».
--
-- Warum es die Spalten braucht: «Eintrag aus der Hall of Fame nehmen» und
-- «Runde loeschen» sind zwei Handlungen. Die erste blendet aus und ist
-- zuruecknehmbar, die zweite entfernt Einreichungen, Stimmen und
-- Platzierungen endgueltig. Ohne ein Feld dafuer gaebe es nur die zweite.

ALTER TABLE "ClipCompetition" ADD COLUMN "hallOfFameHiddenAt" TIMESTAMP(3);
ALTER TABLE "ClipCompetition" ADD COLUMN "hallOfFameHiddenByDiscordId" TEXT;
ALTER TABLE "ClipCompetition" ADD COLUMN "hallOfFameHiddenReason" TEXT;
