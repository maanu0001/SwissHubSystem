-- Verifikation: Ergebniskanal, Begruessung wiederfinden, Aufraeumen nachhalten.
--
-- Rein additiv: zehn nullbare Spalten an einer bestehenden Tabelle. Keine
-- Spalte wird geaendert, keine geloescht, kein Wert umgeschrieben. Auf einem
-- Bestand aendert sich nichts - laufende Vorgaenge tragen die Spalten leer
-- und verhalten sich wie zuvor.
--
-- Eine leere `greetingMessageId` heisst dabei nicht «keine Begruessung»,
-- sondern «nicht festgehalten». Das Aufraeumen behandelt beide Faelle gleich:
-- was es nicht kennt, fasst es nicht an.
ALTER TABLE "VerificationRequest"
  ADD COLUMN "greetingChannelId" TEXT,
  ADD COLUMN "greetingMessageId" TEXT,
  ADD COLUMN "welcomeChannelId" TEXT,
  ADD COLUMN "welcomeMessageId" TEXT,
  ADD COLUMN "successChannelId" TEXT,
  ADD COLUMN "successMessageId" TEXT,
  ADD COLUMN "successMessageAt" TIMESTAMP(3),
  ADD COLUMN "cleanupAt" TIMESTAMP(3),
  ADD COLUMN "cleanupStatus" TEXT,
  ADD COLUMN "cleanupError" TEXT;
