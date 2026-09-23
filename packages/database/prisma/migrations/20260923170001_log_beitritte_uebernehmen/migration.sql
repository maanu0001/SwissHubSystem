-- Beitritte und Austritte behalten ihren Kanal.
--
-- Bisher fielen sie ohne eigenen JOIN_LEAVE-Kanal auf MEMBERS zurueck. Seit
-- MEMBERS nur noch Rollenaenderungen traegt, gibt es diesen Rueckfall nicht
-- mehr - wer nur MEMBERS eingerichtet hatte, saehe ab sofort keine Beitritte
-- mehr, ohne dass jemand etwas geaendert haette.
--
-- Deshalb wird der bisherige Kanal uebernommen, und zwar nur dort, wo fuer
-- JOIN_LEAVE noch keiner eingerichtet ist. Eine bestehende Einrichtung wird
-- nicht angetastet.
--
-- Eigene Migration, weil ein in derselben Transaktion hinzugefuegter
-- Enum-Wert in Postgres noch nicht verwendet werden darf.
--
-- Der Gesundheitszustand wird bewusst nicht uebernommen: er gilt fuer die
-- Zustellung einer Kategorie, und die Pruefung setzt ihn beim naechsten Lauf
-- selbst.
INSERT INTO "DiscordLogChannel" ("category", "guildId", "channelId", "channelName", "enabled", "updatedBy", "createdAt", "updatedAt")
SELECT
  'JOIN_LEAVE'::"DiscordLogCategory",
  "guildId",
  "channelId",
  "channelName",
  "enabled",
  'migration:log-rollen',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "DiscordLogChannel"
WHERE "category" = 'MEMBERS'
ON CONFLICT ("category") DO NOTHING;
