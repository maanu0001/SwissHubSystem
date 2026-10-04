-- Serverrollen: Spaltenzahl je Gruppe und das Dropdown-Embed.
--
-- Rein additiv. Jede neue Spalte hat entweder eine Vorgabe oder darf leer
-- sein, also bleibt jede bestehende Gruppe genau so, wie sie war:
--
--   * `spalten` steht auf 1 - die oeffentliche Seite zeigt die Rollen heute
--     untereinander, und eine Migration soll kein Layout aendern, nach dem
--     niemand gefragt hat. Wer zwei Spalten will, stellt sie ein.
--   * `embedAktiv` steht auf false. Eine Gruppe, die nach dieser Migration
--     ungefragt ein Auswahlmenue in einen Kanal schreibt, waere eine
--     Nachricht, die niemand bestellt hat.
--   * Kanal, Nachricht, Titel, Text, Farbe und Zeitstempel bleiben leer. Dass
--     `embedMessageId` leer ist, **ist** die Aussage «noch nicht
--     veroeffentlicht» - es braucht dafuer kein zweites Feld.
--
-- Nichts wird gelesen, nichts geloescht, keine Zeile angefasst.
ALTER TABLE "ServerRoleCategory" ADD COLUMN "spalten" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ServerRoleCategory" ADD COLUMN "embedAktiv" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ServerRoleCategory" ADD COLUMN "embedChannelId" TEXT;
ALTER TABLE "ServerRoleCategory" ADD COLUMN "embedMessageId" TEXT;
ALTER TABLE "ServerRoleCategory" ADD COLUMN "embedTitel" TEXT;
ALTER TABLE "ServerRoleCategory" ADD COLUMN "embedBeschreibung" TEXT;
ALTER TABLE "ServerRoleCategory" ADD COLUMN "embedFarbe" TEXT;
ALTER TABLE "ServerRoleCategory" ADD COLUMN "embedAktualisiertAm" TIMESTAMP(3);
