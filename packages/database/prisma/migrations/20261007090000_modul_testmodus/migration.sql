-- Modul-Testmodus.
--
-- Ausschliesslich hinzufuegend: eine Spalte mit Vorgabewert. Kein DROP, kein
-- UPDATE, kein DELETE. Jedes bestehende Modul bleibt damit exakt dort, wo es
-- war - `testMode = false` heisst «wie bisher».
--
-- Der Status ist bewusst kein Enum, sondern die Kombination zweier Spalten:
--
--   enabled = false                  -> DEAKTIVIERT
--   enabled = true, testMode = true  -> TESTMODUS
--   enabled = true, testMode = false -> AKTIV
--
-- So bleibt `enabled` das, was es immer war, und die hundert Stellen, die
-- `isModuleEnabled` fragen, brauchen keine Aenderung: ein Modul im Testmodus
-- **laeuft**, es ist nur fuer normale Mitglieder gesperrt.

-- AlterTable
ALTER TABLE "ModuleState" ADD COLUMN     "testMode" BOOLEAN NOT NULL DEFAULT false;
