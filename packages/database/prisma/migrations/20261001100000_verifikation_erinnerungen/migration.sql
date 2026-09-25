-- Erinnerungen an offene Verifikationen.
--
-- Rein additiv: drei Spalten und ein Index. `nextReminderAt IS NULL` heisst
-- «keine weitere Erinnerung», und das ist fuer jeden bestehenden Vorgang die
-- richtige Antwort - auch fuer die offenen. Wer heute wartet, bekommt seine
-- erste Erinnerung erst, wenn der Bot sie plant; rueckwirkend eine ganze
-- Warteschlange aufzuwecken waere ein Schwall Erwaehnungen auf einen Schlag.
--
-- Der ganze Zeitplan steht in `nextReminderAt`. Kein Zeitgeber im
-- Arbeitsspeicher: ein `setTimeout` ueberlebt kein Deployment, und einer je
-- Person waeren sechstausend Uhren fuer eine Frage, die eine Abfrage
-- beantwortet.

ALTER TABLE "VerificationRequest" ADD COLUMN "nextReminderAt" TIMESTAMP(3);
ALTER TABLE "VerificationRequest" ADD COLUMN "lastReminderAt" TIMESTAMP(3);
ALTER TABLE "VerificationRequest" ADD COLUMN "reminderCount" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "VerificationRequest_status_nextReminderAt_idx"
  ON "VerificationRequest"("status", "nextReminderAt");
