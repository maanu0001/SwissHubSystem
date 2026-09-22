-- Persoenliche Benachrichtigungen im Dashboard.
--
-- Rein additiv: eine neue Tabelle und ihre Indizes. Keine bestehende Spalte
-- wird angefasst, nichts geloescht, nichts umbenannt. Laeuft die Migration
-- auf einem Bestand, aendert sich an ihm nichts - die Glocke ist danach nur
-- leer, und sie fuellt sich mit dem naechsten Ereignis.
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "recipientDiscordId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "route" TEXT,
    "actorDiscordId" TEXT,
    "actorLabel" TEXT,
    "entityId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "groupKey" TEXT,
    "count" INTEGER NOT NULL DEFAULT 1,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- Der Riegel gegen Doppel: dasselbe Ereignis erzeugt fuer dieselbe Person
-- genau eine Zeile, auch wenn es zweimal zugestellt wird.
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- Die Abfrage der Glocke.
CREATE INDEX "Notification_recipientDiscordId_readAt_createdAt_idx" ON "Notification"("recipientDiscordId", "readAt", "createdAt");

-- Die Zusammenfassung gleichartiger Meldungen.
CREATE INDEX "Notification_recipientDiscordId_groupKey_idx" ON "Notification"("recipientDiscordId", "groupKey");

-- Die Aufbewahrung raeumt nach Alter.
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");
