-- Verleihbare Auszeichnungen werden verwaltbar.
--
-- Bisher standen die fuenf verleihbaren Arten als Konstante im Quelltext.
-- Wer eine sechste wollte, brauchte einen Entwickler und ein Deployment -
-- und das war der Grund, warum es im Betrieb keine Verwaltung dafuer gab.
--
-- Was sich **nicht** aendert: die gerechneten Auszeichnungen. Turniersiege,
-- Clip-Siege und das Level bleiben gerechnet und stehen weiterhin in keiner
-- Tabelle. Diese Tabelle nimmt ausschliesslich die auf, fuer die es keine
-- Zahl gibt.
--
-- Die INSERTs unten sind der Bestand, der schon verliehen ist. Ohne sie
-- verloeren bestehende `MemberAward`-Zeilen ihren Namen - sie zeigen ueber
-- `key` hierher.

-- CreateTable
CREATE TABLE "AwardDefinition" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "tier" TEXT NOT NULL DEFAULT 'bronze',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdByDiscordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AwardDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AwardDefinition_key_key" ON "AwardDefinition"("key");

-- CreateIndex
CREATE INDEX "AwardDefinition_archivedAt_sortOrder_idx" ON "AwardDefinition"("archivedAt", "sortOrder");

-- Der bisherige Bestand. `ON CONFLICT DO NOTHING`, damit ein erneuter Lauf
-- nichts ueberschreibt, was inzwischen von Hand geaendert wurde.
INSERT INTO "AwardDefinition" ("id", "key", "label", "description", "symbol", "tier", "sortOrder", "updatedAt")
VALUES
    ('awarddef_og_member',       'og-member',        'OG Member',        'War da, als der SwissHub noch klein war.',                  'Flame',          'gold',   10, CURRENT_TIMESTAMP),
    ('awarddef_community_legend','community-legend', 'Community Legend', 'Hat den SwissHub zu dem gemacht, was er ist.',              'Crown',          'gold',   20, CURRENT_TIMESTAMP),
    ('awarddef_helfer',          'helfer',           'Gute Seele',       'Hilft anderen, ohne dass jemand danach fragt.',             'HeartHandshake', 'silber', 30, CURRENT_TIMESTAMP),
    ('awarddef_event_held',      'event-held',       'Event-Held',       'Hat einen Abend getragen, an den sich alle erinnern.',      'PartyPopper',    'silber', 40, CURRENT_TIMESTAMP),
    ('awarddef_bug_jaeger',      'bug-jaeger',       'Bug-Jäger',        'Hat einen Fehler gefunden, den sonst niemand gesehen hat.', 'Bug',            'bronze', 50, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
