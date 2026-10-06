-- Premium: manuelle Vergabe durch die Verwaltung, normalisierte Zahlungsstati.
--
-- Vollstaendig additiv. Keine Spalte faellt weg, keine wird enger, kein
-- bestehender Wert aendert sich:
--
--   * `PremiumGrant` ist neu und zunaechst leer. Sie protokolliert die
--     **Handlung** einer Vergabe; der Anspruch bleibt das Abonnement.
--   * `PremiumPaymentStatus` bekommt zwei Werte dazu. Ein Enum zu erweitern
--     ist in PostgreSQL additiv - bestehende Zeilen behalten ihren Wert.
--   * Die drei neuen Produktspalten duerfen leer sein. Bestehende Angebote
--     bleiben unveraendert, und `durationDays = NULL` heisst weiterhin
--     «der Anbieter bestimmt die Periode».

-- --- Zahlungsstati vervollstaendigen --------------------------------------
--
-- `IF NOT EXISTS`, damit eine erneut angewandte Migration nicht abbricht.
ALTER TYPE "PremiumPaymentStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
ALTER TYPE "PremiumPaymentStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';

-- --- Angebote: Anbieterkennungen und Laufzeit -----------------------------
ALTER TABLE "PremiumProduct" ADD COLUMN "providerProductId" TEXT;
ALTER TABLE "PremiumProduct" ADD COLUMN "durationDays" INTEGER;

-- --- Die Vergabe ----------------------------------------------------------
CREATE TYPE "PremiumGrantUnit" AS ENUM ('DAYS', 'WEEKS', 'MONTHS');
CREATE TYPE "PremiumGrantMode" AS ENUM ('NEW', 'EXTEND', 'REPLACE');
CREATE TYPE "PremiumGrantStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');

CREATE TABLE "PremiumGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "amount" INTEGER NOT NULL,
    "unit" "PremiumGrantUnit" NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "mode" "PremiumGrantMode" NOT NULL,
    "reason" TEXT,
    "grantedByDiscordId" TEXT,
    "grantedByUsername" TEXT,
    "status" "PremiumGrantStatus" NOT NULL DEFAULT 'ACTIVE',
    "revokedAt" TIMESTAMP(3),
    "revokedByDiscordId" TEXT,
    "revokedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PremiumGrant_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PremiumGrant_userId_createdAt_idx" ON "PremiumGrant"("userId", "createdAt");
CREATE INDEX "PremiumGrant_status_createdAt_idx" ON "PremiumGrant"("status", "createdAt");
CREATE INDEX "PremiumGrant_productId_idx" ON "PremiumGrant"("productId");

ALTER TABLE "PremiumGrant" ADD CONSTRAINT "PremiumGrant_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PremiumGrant" ADD CONSTRAINT "PremiumGrant_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "PremiumProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Ein geloeschtes Abonnement darf die Vergabegeschichte nicht mitnehmen.
ALTER TABLE "PremiumGrant" ADD CONSTRAINT "PremiumGrant_subscriptionId_fkey"
    FOREIGN KEY ("subscriptionId") REFERENCES "PremiumSubscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
