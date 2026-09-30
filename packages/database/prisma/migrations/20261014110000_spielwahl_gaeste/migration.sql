-- Gaeste ohne Discord-Konto in einer Spielauswahl.
--
-- Rein additiv: zwei Spalten. `gaesteErlaubt` mit Vorgabe `false` - eine
-- bestehende Runde aendert ihr Verhalten dadurch nicht, und eine neue
-- ebenfalls nicht, solange der Host es nicht einschaltet. `gastName` ist
-- nullbar, weil ein Mitglied keinen braucht.
--
-- Kein DROP, kein TRUNCATE, keine bestehende Spalte angefasst. Gaeste
-- teilen sich die Teilnehmer- und Stimmentabelle mit den Mitgliedern -
-- unterschieden werden sie am Praefix der Kennung, nicht an einer zweiten
-- Tabelle (siehe packages/modules/src/spielwahl/gast.ts).

ALTER TABLE "SpielwahlSession" ADD COLUMN "gaesteErlaubt" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SpielwahlParticipant" ADD COLUMN "gastName" TEXT;
