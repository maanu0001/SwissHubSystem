-- Eine Gruppe, aus der man nur eine Rolle gleichzeitig tragen darf.
--
-- Additiv und mit Vorgabe `false`: bestehende Gruppen bleiben Sammlungen.
-- Wer die Einschränkung will, schaltet sie je Gruppe ein - und bestehende
-- Mehrfachzuordnungen werden dabei nicht angetastet, sondern erst beim
-- nächsten Wechsel einer Person aufgelöst.
ALTER TABLE "ServerRoleCategory" ADD COLUMN "exklusiv" BOOLEAN NOT NULL DEFAULT false;
