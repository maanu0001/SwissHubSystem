-- Farbe, Zeichen und Zusatztext je Export.
--
-- Rein additiv und nullable: `NULL` heisst «wie im Modul», und das war das
-- Verhalten vor dieser Migration. Bestehende Entwuerfe aendern sich dadurch
-- nicht - weder ihr Aussehen noch ihre Zeilen.
ALTER TABLE "FragtEntwurf" ADD COLUMN "exportAkzentfarbe" TEXT;
ALTER TABLE "FragtEntwurf" ADD COLUMN "exportLogo" TEXT;
ALTER TABLE "FragtEntwurf" ADD COLUMN "exportZusatztext" TEXT;
