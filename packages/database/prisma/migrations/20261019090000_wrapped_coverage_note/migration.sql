-- Der Erhebungshinweis einer Folie.
--
-- Additiv und nullable: bestehende Folien haben keinen, und das ist richtig -
-- sie entstanden aus Quellen, die als vollstaendig galten. Beim naechsten
-- Erheben setzt der Durchgang den Wert neu.
ALTER TABLE "WrappedSlide" ADD COLUMN "coverageNote" TEXT;
