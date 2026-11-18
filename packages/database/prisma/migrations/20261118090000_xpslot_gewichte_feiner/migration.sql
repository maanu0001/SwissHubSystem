-- Die Symbolgewichte des XP-Slots feiner abstufen.
--
-- ## Warum diese Migration
--
-- Mit der Scatter-Staffel hebt eine hoehere Zahl von Bonussymbolen den
-- Einstieg in die Risikoleiter: vier Scatter geben zwoelf Freispiele statt
-- acht, sechs geben sechzehn. Das ist gewuenscht - es kostet aber Quote, und
-- zwar mehr, als es aussieht: garantierte zwoelf Freispiele sind wegen der
-- Sticky Wilds fast dreimal so viel wert wie acht, und rund ein Zehntel
-- aller Bonusrunden kommt von vier oder mehr Scattern.
--
-- Gemessen mit `rechneRtp`: die Quote stieg von 92,6 auf 99,3 Prozent.
--
-- ## Was sie tut
--
-- Sie multipliziert alle Symbolgewichte mit 16 - das Bonussymbol nur mit 15.
--
-- Die Verhaeltnisse der uebrigen Symbole zueinander bleiben damit exakt
-- erhalten, auch wenn jemand sie von Hand verstellt hat. Der Anteil des
-- Bonussymbols sinkt um ein Sechzehntel, und genau das bezahlt die Staffel:
-- eine Bonusrunde kommt etwa alle 117 statt alle 98 Spins.
--
-- Die Multiplikation ist zugleich der Grund fuer die krummen Zahlen: mit dem
-- alten Massstab lag zwischen Scattergewicht 2 und 3 ein Quotensprung von
-- 28 Punkten, und dazwischen gab es keine ganze Zahl. Nach dieser Migration
-- verschiebt eine Stufe die Quote noch um gut zwei Punkte.
--
-- ## Was sie nicht tut
--
-- Sie setzt keine Zahl absolut. Wer seine Gewichte angepasst hat, behaelt
-- seine Abstimmung; nur der Massstab wird feiner und der Bonus etwas
-- seltener. Die Quote der eigenen Konfiguration steht nach wie vor live im
-- Dashboard unter Spielregeln - diese Migration ersetzt den Blick dorthin
-- nicht.
--
-- Die Obergrenze je Gewicht liegt bei 1000; mit den Vorgaben ist das
-- hoechste Gewicht nach der Multiplikation 480.

UPDATE "XpSlotSymbol"
SET "weight" = LEAST("weight" * 16, 1000)
WHERE "role" <> 'SCATTER';

UPDATE "XpSlotSymbol"
SET "weight" = LEAST("weight" * 15, 1000)
WHERE "role" = 'SCATTER';
