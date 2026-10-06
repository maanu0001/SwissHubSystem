-- Die Rechtezeilen der entfernten Spielersuche wegraeumen.
--
-- ## Warum diese Migration
--
-- Commit 7de2252 nahm die Spielersuche aus dem System und mit ihr acht
-- Berechtigungen aus der Registry. Die Zuordnungen in "RolePermission"
-- blieben stehen - eine Loeschung stand in keinem Schema, also geschah
-- keine.
--
-- Die Folge war kein Rechteproblem, sondern eine Blockade: die
-- Einstellungsseite lud die Zeilen einer Rolle unveraendert in die
-- Oberflaeche, die Oberflaeche schickte beim Speichern alles zurueck, und die
-- Server-Aktion lehnte die ganze Konfiguration ab, weil ein Schluessel
-- darunter war, den es nicht mehr gibt. Sichtbar wurde das als «Unbekannte
-- Berechtigung: members.view.spielersuche.own» - und zwar auch dann, wenn
-- jemand etwas voellig anderes aendern wollte.
--
-- ## Was sie anfasst, und was nicht
--
-- Genau die acht namentlich genannten Schluessel. Kein TRUNCATE, kein
-- Loeschen nach Muster, keine Rolle, keine Mitgliedschaft. Jede andere Zeile
-- in "RolePermission" bleibt unberuehrt; wer die Spielersuche nie zugewiesen
-- bekam, merkt von dieser Migration nichts.
--
-- Die Schluessel beschreiben Funktionen, die es nicht mehr gibt - ein Recht
-- auf ein entferntes Modul ist kein Recht, das jemand verlieren kann. Darum
-- gibt es auch keine Ersetzung: "spielwahl.*" ist nicht der neue Name der
-- Spielersuche, und eine Aufraeumaktion darf keine Rechte verteilen.
--
-- Sie laeuft einmal. Sollte eine Zeile spaeter erneut auftauchen, ist das ein
-- Hinweis auf einen Seed oder ein Preset, das den alten Namen noch kennt -
-- deshalb zeigt die Permission-Health-Diagnose unbekannte Schluessel in der
-- Datenbank dauerhaft an.
DELETE FROM "RolePermission"
WHERE "permission" IN (
  'members.view.spielersuche.all',
  'members.view.spielersuche.own',
  'spielersuche.closeOwn',
  'spielersuche.create',
  'spielersuche.join',
  'spielersuche.module.view',
  'spielersuche.stats.viewOwn',
  'spielersuche.view'
);
