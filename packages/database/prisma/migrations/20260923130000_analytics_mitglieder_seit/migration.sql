-- Ab wann Bei- und Austritte gemessen werden.
--
-- Das Gegenstueck zu "messagesSince" und "voiceSince". Es fehlte, und dadurch
-- hielt der Backfill die gemessenen Mitgliederzahlen fuer seine eigenen und
-- raeumte sie weg.
--
-- Additiv und nullbar: vorhandene Zeilen bleiben unberuehrt. NULL heisst
-- "noch nichts gemessen"; die Marke setzt sich beim naechsten Bei- oder
-- Austritt von selbst.
ALTER TABLE "AnalyticsTracking" ADD COLUMN "membersSince" TIMESTAMP(3);
