-- Das Vier-Augen-Prinzip fuer produktive Wiederherstellungen.
--
-- Die Permission Engine kann feingranular vergeben, aber sie kennt keine
-- Freigabe durch eine ZWEITE Person: `can(context, permission)` ist eine
-- Aussage ueber genau einen Handelnden. Fuer die eine Operation, bei der ein
-- einzelner Irrtum nicht ausreichen soll - einen produktiven Restore, der
-- alles nach dem Zielzeitpunkt verwirft -, ist das zu wenig.
--
-- Diese Tabelle loest keinen Restore aus. Sie ist der Nachweis, dass zwei
-- Personen zugestimmt haben; ausgefuehrt wird auf der Kommandozeile, von
-- einem Menschen, der den Nachweis vorzeigt.

CREATE TYPE "RestoreFreigabeStatus" AS ENUM (
    'ANGEFORDERT',
    'FREIGEGEBEN',
    'ABGELEHNT',
    'VERWENDET',
    'ABGELAUFEN'
);

CREATE TABLE "RestoreFreigabe" (
    "id" TEXT NOT NULL,
    "umfang" TEXT NOT NULL,
    "zielZeitpunkt" TIMESTAMP(3),
    -- Pflicht und kein Feld, das leer bleiben darf: die Begruendung ist das,
    -- was in einem halben Jahr die Frage beantwortet, weshalb an diesem Tag
    -- Daten verworfen wurden.
    "begruendung" TEXT NOT NULL,
    "angefordertVon" TEXT NOT NULL,
    "angefordertVonName" TEXT,
    "angefordertAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Die zweite Person. Dass sie eine ANDERE ist, prueft die Server Action -
    -- dort kann die Meldung erklaeren, warum, und hier waere es ein CHECK,
    -- den Prisma nicht fuehrt.
    "freigegebenVon" TEXT,
    "freigegebenVonName" TEXT,
    "freigegebenAm" TIMESTAMP(3),
    -- Eine Freigabe ohne Frist ist eine dauerhafte Befugnis.
    "gueltigBis" TIMESTAMP(3) NOT NULL,
    "status" "RestoreFreigabeStatus" NOT NULL DEFAULT 'ANGEFORDERT',
    "abgelehntVon" TEXT,
    "abgelehntAm" TIMESTAMP(3),
    "abgelehntGrund" TEXT,
    -- Einmalig: eine wiederverwendbare Freigabe ist genau die, die man beim
    -- zweiten Mal nicht mehr bemerkt.
    "verwendetAm" TIMESTAMP(3),
    "verwendetVon" TEXT,

    CONSTRAINT "RestoreFreigabe_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RestoreFreigabe_status_angefordertAm_idx"
    ON "RestoreFreigabe"("status", "angefordertAm");

CREATE INDEX "RestoreFreigabe_angefordertVon_angefordertAm_idx"
    ON "RestoreFreigabe"("angefordertVon", "angefordertAm");
