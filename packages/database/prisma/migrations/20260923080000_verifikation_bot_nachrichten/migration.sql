-- Verifikation: jede Bot-Nachricht eines Vorgangs, nicht nur die letzte.
--
-- Rein additiv: ein neuer Aufzaehlungstyp und eine neue Tabelle. An
-- `VerificationRequest` aendert sich nichts - die bisherigen Felder
-- `greetingMessageId` und `welcomeMessageId` bleiben als Rueckfallebene
-- stehen, damit Vorgaenge aus der Zeit davor weiter aufgeraeumt werden.
--
-- Bestehende Vorgaenge bekommen ihre bekannte Bot-Nachricht gleich
-- eingetragen. Das ist keine Datenaenderung, sondern dieselbe Angabe an der
-- Stelle, an der sie ab jetzt gesucht wird.
CREATE TYPE "VerificationBotMessageKind" AS ENUM ('GREETING', 'WELCOME');

CREATE TABLE "VerificationBotMessage" (
  "id"               TEXT NOT NULL,
  "requestId"        TEXT NOT NULL,
  "kind"             "VerificationBotMessageKind" NOT NULL,
  "channelId"        TEXT NOT NULL,
  "discordMessageId" TEXT NOT NULL,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "VerificationBotMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VerificationBotMessage_requestId_discordMessageId_key"
  ON "VerificationBotMessage" ("requestId", "discordMessageId");

CREATE INDEX "VerificationBotMessage_requestId_createdAt_idx"
  ON "VerificationBotMessage" ("requestId", "createdAt");

ALTER TABLE "VerificationBotMessage"
  ADD CONSTRAINT "VerificationBotMessage_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "VerificationRequest"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "VerificationBotMessage" ("id", "requestId", "kind", "channelId", "discordMessageId", "createdAt")
SELECT gen_random_uuid()::text, "id", 'GREETING', "greetingChannelId", "greetingMessageId", "createdAt"
  FROM "VerificationRequest"
 WHERE "greetingMessageId" IS NOT NULL AND "greetingChannelId" IS NOT NULL;

INSERT INTO "VerificationBotMessage" ("id", "requestId", "kind", "channelId", "discordMessageId", "createdAt")
SELECT gen_random_uuid()::text, "id", 'WELCOME', "welcomeChannelId", "welcomeMessageId", "createdAt"
  FROM "VerificationRequest"
 WHERE "welcomeMessageId" IS NOT NULL AND "welcomeChannelId" IS NOT NULL
   AND "welcomeMessageId" IS DISTINCT FROM "greetingMessageId";
