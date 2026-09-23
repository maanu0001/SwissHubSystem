-- Die Log-Kategorie MEMBERS heisst im Dashboard jetzt «Rollen» und traegt nur
-- noch Rollenaenderungen. Dazu kommt «Accountaenderungen» fuer Benutzername
-- und Profilbild.
--
-- Der Schluessel MEMBERS bleibt: er ist der Primaerschluessel von
-- DiscordLogChannel und traegt die eingerichteten Kanaele. Ihn umzubenennen
-- hiesse, jede bestehende Zuordnung zu verlieren - fuer einen Namen, den
-- ohnehin niemand sieht.
ALTER TYPE "DiscordLogCategory" ADD VALUE IF NOT EXISTS 'ACCOUNT_CHANGES';
