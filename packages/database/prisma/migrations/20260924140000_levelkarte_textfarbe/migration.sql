-- Textfarbe der eigenen Levelkarte.
--
-- Additiv und nullbar. Bestehende Karten bekommen NULL und damit genau das,
-- was sie vorher hatten: die Standardfarbe der Karte. Kein Standardwert in
-- der Spalte, weil «nichts gewaehlt» und «Weiss gewaehlt» sich unterscheiden
-- muessen - sonst liesse sich ein Zuruecksetzen nicht von einer bewussten
-- Wahl trennen.
ALTER TABLE "LevelProfile" ADD COLUMN "customCardTextColor" TEXT;
