-- Mehrere Tickets je Bestellung, mit und ohne SwissHub-Konto.
--
-- Rein additiv: eine neue Tabelle, ein neues Enum, eine neue Spalte mit
-- Vorgabewert. Keine Spalte entfernt, keine Tabelle geloescht, kein
-- bestehender Wert umgeschrieben.
--
-- Die bestehenden Anmeldungen bekommen je ein Ticket auf sich selbst - siehe
-- unten. Danach beantwortet dieselbe Abfrage fuer alte und neue Zeilen
-- dieselbe Frage, und es gibt keinen Sonderfall «Anmeldung ohne Ticket».

-- ---------------------------------------------------------------------------
-- Die Bestellung
-- ---------------------------------------------------------------------------

-- Eins als Vorgabe: jede bestehende Anmeldung ist eine Bestellung ueber genau
-- ein Ticket. Bestehende Zeilen sind damit ohne Umschreiben korrekt.
ALTER TABLE "CalendarRegistration" ADD COLUMN "ticketCount" INTEGER NOT NULL DEFAULT 1;

-- ---------------------------------------------------------------------------
-- Das Ticket
-- ---------------------------------------------------------------------------

CREATE TYPE "CalendarTicketStatus" AS ENUM ('ACTIVE', 'CANCELLED');

CREATE TABLE "CalendarTicket" (
  "id"                   TEXT NOT NULL,
  "registrationId"       TEXT NOT NULL,
  "eventId"              TEXT NOT NULL,

  "memberDiscordId"      TEXT,
  "memberUsername"       TEXT,

  "guestFirstName"       TEXT,
  "guestLastName"        TEXT,
  "guestEmail"           TEXT,
  "guestDiscordName"     TEXT,
  "note"                 TEXT,

  "token"                TEXT NOT NULL,
  "status"               "CalendarTicketStatus" NOT NULL DEFAULT 'ACTIVE',
  "position"             INTEGER NOT NULL DEFAULT 0,

  "checkedInAt"          TIMESTAMP(3),
  "checkedInByDiscordId" TEXT,
  "checkedInByUsername"  TEXT,

  "cancelledAt"          TIMESTAMP(3),

  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CalendarTicket_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CalendarTicket_token_key" ON "CalendarTicket"("token");
-- Die Kapazitaetsfrage: wie viele aktive Tickets hat dieser Termin?
CREATE INDEX "CalendarTicket_eventId_status_idx" ON "CalendarTicket"("eventId", "status");
CREATE INDEX "CalendarTicket_registrationId_position_idx" ON "CalendarTicket"("registrationId", "position");
CREATE INDEX "CalendarTicket_memberDiscordId_idx" ON "CalendarTicket"("memberDiscordId");

ALTER TABLE "CalendarTicket"
  ADD CONSTRAINT "CalendarTicket_registrationId_fkey"
  FOREIGN KEY ("registrationId") REFERENCES "CalendarRegistration"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CalendarTicket"
  ADD CONSTRAINT "CalendarTicket_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "CalendarEvent"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Bestehende Anmeldungen bekommen ihr Ticket
-- ---------------------------------------------------------------------------
--
-- Jede vorhandene Anmeldung wird zu einer Bestellung ueber ein Ticket, und
-- dieses Ticket gehoert der Person, die sich angemeldet hat. Nichts geht
-- verloren, und danach gibt es keine Anmeldung ohne Ticket - die
-- Zaehlfunktionen brauchen deshalb keinen Sonderfall fuer den Altbestand.
--
-- ## Der Token
--
-- `gen_random_uuid()` ist in PostgreSQL seit Version 13 eingebaut und liefert
-- eine Zufallszahl aus derselben Quelle wie `pgcrypto` - also nicht aus
-- `random()`, das aus einem Startwert vorhersagbar ist. Zwei davon,
-- aneinandergehaengt und ohne Bindestriche, ergeben 64 hexadezimale Zeichen.
-- Dieselbe Laenge, die `randomBytes(32)` im Anwendungscode erzeugt.
--
-- Die Alternative waere ein Skript nach der Migration gewesen. Das haette
-- einen Zwischenzustand hinterlassen, in dem Tickets ohne Token existieren -
-- und der Eindeutigkeitsindex haette ihn nicht ueberlebt.
--
-- ## Der Zustand
--
-- Eine stornierte Anmeldung bekommt ein storniertes Ticket. Sonst zaehlte
-- eine abgesagte Teilnahme von gestern ab heute wieder als belegter Platz.

INSERT INTO "CalendarTicket" (
  "id",
  "registrationId",
  "eventId",
  "memberDiscordId",
  "memberUsername",
  "token",
  "status",
  "position",
  "cancelledAt",
  "createdAt",
  "updatedAt"
)
SELECT
  replace(gen_random_uuid()::text, '-', ''),
  r."id",
  r."eventId",
  r."discordId",
  COALESCE(r."displayName", r."username"),
  replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  CASE WHEN r."status" = 'CANCELLED' THEN 'CANCELLED'::"CalendarTicketStatus"
       ELSE 'ACTIVE'::"CalendarTicketStatus" END,
  0,
  r."cancelledAt",
  r."registeredAt",
  CURRENT_TIMESTAMP
FROM "CalendarRegistration" r;
