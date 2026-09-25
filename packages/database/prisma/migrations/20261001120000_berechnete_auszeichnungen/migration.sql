-- Die Verwaltungsschicht ueber den gerechneten Auszeichnungen.
--
-- Eine Schicht und keine Tabelle fuer die Arten selbst: welcher Messwert
-- gezaehlt wird, ist eine Aussage ueber die Datenquellen dieses Systems und
-- gehoert in den Code. Verwaltbar sind Darstellung und **eine Zahl** -
-- damit gibt es kein Feld, ueber das ein Ausdruck in die Auswertung
-- gelangen koennte.
--
-- Leer beim Anlegen, und das ist der Normalzustand: ein fehlender Eintrag
-- heisst «unveraendert». Nur wer etwas aendert, bekommt eine Zeile.

CREATE TABLE "ComputedAwardOverride" (
    "key" TEXT NOT NULL,
    "label" TEXT,
    "description" TEXT,
    "symbol" TEXT,
    "tier" TEXT,
    "threshold" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "updatedByDiscordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComputedAwardOverride_pkey" PRIMARY KEY ("key")
);
