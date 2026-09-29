-- Preis und Zahlungsstand am einzelnen Ticket.
--
-- Rein additiv: drei Spalten und ein Index. Kein DROP, kein TRUNCATE, kein
-- umgeschriebener Wert. Bestehende Tickets bekommen den Zustand, den ihre
-- Bestellung heute hat - danach sagt das Ticket dasselbe wie vorher die
-- Bestellung, nur je Person statt je Bestellung.
--
-- Warum es die Spalten braucht: eine Bestellung kann nachtraeglich wachsen.
-- Wer zwei Tickets bezahlt hat und ein drittes dazunimmt, hat zwei bezahlte
-- und ein offenes. Ein einzelner Status an der Bestellung kann das nicht
-- sagen, ohne eine der beiden Haelften falsch darzustellen.

ALTER TABLE "CalendarTicket" ADD COLUMN "priceCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CalendarTicket" ADD COLUMN "settledStatus" "CalendarPaymentStatus";
ALTER TABLE "CalendarTicket" ADD COLUMN "settledAt" TIMESTAMP(3);

-- Der Preis je Ticket aus dem Gesamtbetrag der Bestellung.
--
-- Geteilt durch die mitgefuehrte Ticketzahl, weil genau so gerechnet wurde:
-- `entryFeeCents * ticketZeilen.length`. Bei `ticketCount = 0` - was es nicht
-- geben sollte, aber eine Division durch null waere ein Abbruch der Migration -
-- bleibt der Vorgabewert stehen.
UPDATE "CalendarTicket" t
   SET "priceCents" = (r."paymentAmountCents" / GREATEST(r."ticketCount", 1))
  FROM "CalendarRegistration" r
 WHERE t."registrationId" = r."id"
   AND r."ticketCount" > 0
   AND r."paymentAmountCents" > 0;

-- Der Zahlungsstand: was fuer die Bestellung gilt, gilt bis heute fuer jedes
-- ihrer Tickets. `PENDING` und `REFUNDED` bleiben offen (`NULL`) - dort ist
-- nichts erledigt, und genau das hiess es auch vorher.
UPDATE "CalendarTicket" t
   SET "settledStatus" = r."paymentStatus",
       "settledAt"     = COALESCE(r."paymentVerifiedAt", t."createdAt")
  FROM "CalendarRegistration" r
 WHERE t."registrationId" = r."id"
   AND r."paymentStatus" IN ('NOT_REQUIRED', 'VERIFIED', 'WAIVED');

CREATE INDEX "CalendarTicket_eventId_status_settledStatus_idx"
    ON "CalendarTicket"("eventId", "status", "settledStatus");
