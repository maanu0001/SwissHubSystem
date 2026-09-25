-- Das oeffentliche Profil sperren - als Moderationsmassnahme.
--
-- Rein additiv: vier nullbare Spalten und ein Index. `publicLockedAt IS NULL`
-- heisst «nicht gesperrt», und das ist fuer jedes bestehende Profil die
-- richtige Antwort.
--
-- Der Zustand steht am Profil, die Geschichte in `ModerationAction` - wer,
-- wann, warum. Dieselbe Aufteilung wie beim Jail. Eine eigene Tabelle fuer
-- den Zustand waere ein zweiter Join auf jedem oeffentlichen Seitenaufruf
-- und eine zweite Stelle, an der jemand vergessen koennte nachzusehen.

ALTER TABLE "MemberProfile" ADD COLUMN "publicLockedAt" TIMESTAMP(3);
ALTER TABLE "MemberProfile" ADD COLUMN "publicLockReason" TEXT;
ALTER TABLE "MemberProfile" ADD COLUMN "publicLockedByDiscordId" TEXT;
ALTER TABLE "MemberProfile" ADD COLUMN "publicLockUntil" TIMESTAMP(3);

CREATE INDEX "MemberProfile_publicLockUntil_idx" ON "MemberProfile"("publicLockUntil");

-- Zwei neue Massnahmearten in der Akte.
--
-- Keine Discord-Massnahmen: sie wirken ausschliesslich in dieser Anwendung.
-- Sie stehen trotzdem in derselben Akte wie Bann und Timeout, weil sie
-- dieselbe Frage beantworten - was ist diesem Mitglied widerfahren.
ALTER TYPE "ModerationActionType" ADD VALUE IF NOT EXISTS 'PROFILE_LOCK';
ALTER TYPE "ModerationActionType" ADD VALUE IF NOT EXISTS 'PROFILE_UNLOCK';
