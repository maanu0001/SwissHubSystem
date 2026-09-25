-- Herzschlag und Fehlergrund fuer den Momentaufnahmen-Durchgang.
--
-- Rein additiv, zwei nullbare Spalten. `NULL` heisst «kein Lebenszeichen
-- bekannt» - fuer bestehende Laeufe ist das die Wahrheit, und die Abfrage
-- faellt dann auf `startedAt` zurueck.
--
-- Warum es sie braucht: ein Durchgang, dessen Bot mitten im Lauf starb,
-- stand fuer immer auf RUNNING. `starteDurchgang` gab ihn jedem weiteren
-- Klick zurueck statt neu zu beginnen - der Knopf meldete Erfolg, und nichts
-- geschah. Und weil der Takt sich immer den aeltesten offenen Lauf nimmt,
-- blockierte genau ein solcher Lauf jeden spaeteren.

ALTER TABLE "WrappedGenerationRun" ADD COLUMN "heartbeatAt" TIMESTAMP(3);
ALTER TABLE "WrappedGenerationRun" ADD COLUMN "failureReason" TEXT;
