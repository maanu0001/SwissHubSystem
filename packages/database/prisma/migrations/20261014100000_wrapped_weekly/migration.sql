-- Wrapped fuer eine vergangene ISO-Kalenderwoche.
--
-- Rein additiv: ein Wert mehr im bestehenden Enum. Kein DROP, kein
-- TRUNCATE, keine Spalte umgeschrieben; bestehende Monats- und
-- Jahresausgaben bleiben unberuehrt.
--
-- `IF NOT EXISTS`, damit ein zweiter Lauf der Migration nicht abbricht -
-- ADD VALUE ist ohne das nicht wiederholbar.
ALTER TYPE "WrappedEditionType" ADD VALUE IF NOT EXISTS 'WEEKLY';
