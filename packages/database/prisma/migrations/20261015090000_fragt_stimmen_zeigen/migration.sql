-- SwissHub fragt: die absolute Stimmenzahl auf der Social-Grafik abschaltbar.
--
-- Rein additiv: eine Spalte mit Vorgabe. Kein DROP, kein TRUNCATE, keine
-- bestehende Spalte angefasst. `true` ist der Stand von vorher - jeder
-- bestehende Entwurf exportiert danach genau wie zuvor.
ALTER TABLE "FragtEntwurf" ADD COLUMN IF NOT EXISTS "stimmenZeigen" BOOLEAN NOT NULL DEFAULT true;
