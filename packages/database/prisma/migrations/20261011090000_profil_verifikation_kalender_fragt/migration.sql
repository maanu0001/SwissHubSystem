-- Profil-Achievements, Verifikations-Auto-Delete, Kalender-Zahlungen,
-- SwissHub-fragt-Stimmendetails.
--
-- Ausschliesslich additiv. Keine Spalte wird entfernt, keine Tabelle
-- geloescht, kein Wert umgeschrieben. Jede neue Spalte hat entweder einen
-- Vorgabewert oder ist nullbar - bestehende Zeilen bleiben damit gueltig,
-- ohne dass sie angefasst werden muessen.
--
-- Die Achievement-Stufen und die Stimmendetails brauchen hier nichts: die
-- Stufe steht laengst an der Auszeichnung, und die `voterDiscordId` steht
-- laengst an der Stimme. Beides ist eine Frage der Darstellung und der
-- Berechtigung, nicht des Datenmodells.

-- ---------------------------------------------------------------------------
-- Verifikation: der Termin fuer das selbsttaetige Loeschen
-- ---------------------------------------------------------------------------

ALTER TABLE "VerificationBotMessage" ADD COLUMN "deleteAt" TIMESTAMP(3);
ALTER TABLE "VerificationBotMessage" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Die faellige Abfrage des Durchgangs: Art, Termin, Erledigung.
CREATE INDEX "VerificationBotMessage_kind_deleteAt_deletedAt_idx"
  ON "VerificationBotMessage"("kind", "deleteAt", "deletedAt");

-- Bestehende Begruessungen bekommen bewusst KEINEN Termin. Sie stehen zum
-- Teil seit Monaten im Kanal; ihnen rueckwirkend eine Frist von 24 Stunden
-- zu geben hiesse, beim ersten Durchgang nach dem Deployment hunderte
-- Nachrichten auf einmal zu loeschen. Das Auto-Delete greift ab der naechsten
-- Begruessung.

-- ---------------------------------------------------------------------------
-- Community-Kalender: Eintritt und Zahlung
-- ---------------------------------------------------------------------------

CREATE TYPE "CalendarPaymentStatus" AS ENUM (
  'NOT_REQUIRED',
  'PENDING',
  'VERIFIED',
  'WAIVED',
  'REFUNDED'
);

ALTER TABLE "CalendarEvent" ADD COLUMN "entryFeeEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CalendarEvent" ADD COLUMN "entryFeeCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CalendarEvent" ADD COLUMN "entryFeeCurrency" TEXT NOT NULL DEFAULT 'CHF';
ALTER TABLE "CalendarEvent" ADD COLUMN "paymentNote" TEXT;
ALTER TABLE "CalendarEvent" ADD COLUMN "paymentQrPath" TEXT;

ALTER TABLE "CalendarRegistration"
  ADD COLUMN "paymentStatus" "CalendarPaymentStatus" NOT NULL DEFAULT 'NOT_REQUIRED';
ALTER TABLE "CalendarRegistration" ADD COLUMN "paymentAmountCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CalendarRegistration" ADD COLUMN "paymentCurrency" TEXT;
ALTER TABLE "CalendarRegistration" ADD COLUMN "paymentVerifiedAt" TIMESTAMP(3);
ALTER TABLE "CalendarRegistration" ADD COLUMN "paymentVerifiedByDiscordId" TEXT;
ALTER TABLE "CalendarRegistration" ADD COLUMN "paymentVerifiedByUsername" TEXT;
ALTER TABLE "CalendarRegistration" ADD COLUMN "paymentReason" TEXT;

-- Alle bestehenden Anmeldungen bleiben auf NOT_REQUIRED, und das ist richtig:
-- sie sind zu Terminen entstanden, die nichts gekostet haben. Sie
-- nachtraeglich auf PENDING zu setzen hiesse, von Leuten Geld zu erwarten,
-- die nie eines schuldeten.

CREATE INDEX "CalendarRegistration_eventId_paymentStatus_registeredAt_idx"
  ON "CalendarRegistration"("eventId", "paymentStatus", "registeredAt");
