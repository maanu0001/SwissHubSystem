-- Serverrollen: Kategorien und Rollen-Metadaten fuer die oeffentliche Seite.
--
-- Rein additiv: zwei neue Tabellen. Kein DROP, kein TRUNCATE, keine bestehende
-- Spalte angefasst. Discord bleibt die Wahrheit fuer Name, Farbe und Kennung -
-- hier steht nur, was Discord nicht kennt.

CREATE TABLE IF NOT EXISTS "ServerRoleCategory" (
  "id"            TEXT NOT NULL,
  "name"          TEXT NOT NULL,
  "hinweis"       TEXT,
  "sortOrder"     INTEGER NOT NULL DEFAULT 0,
  "publicVisible" BOOLEAN NOT NULL DEFAULT true,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ServerRoleCategory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ServerRoleCategory_sortOrder_idx" ON "ServerRoleCategory"("sortOrder");

CREATE TABLE IF NOT EXISTS "ServerRoleMeta" (
  "id"                  TEXT NOT NULL,
  "discordRoleId"       TEXT NOT NULL,
  "categoryId"          TEXT,
  "beschreibung"        TEXT,
  "sortOrder"           INTEGER NOT NULL DEFAULT 0,
  "publicVisible"       BOOLEAN NOT NULL DEFAULT true,
  "selfAssignable"      BOOLEAN NOT NULL DEFAULT false,
  "selfRemovable"       BOOLEAN NOT NULL DEFAULT true,
  "voraussetzungRoleId" TEXT,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ServerRoleMeta_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ServerRoleMeta_discordRoleId_key" ON "ServerRoleMeta"("discordRoleId");
CREATE INDEX IF NOT EXISTS "ServerRoleMeta_categoryId_sortOrder_idx" ON "ServerRoleMeta"("categoryId", "sortOrder");
CREATE INDEX IF NOT EXISTS "ServerRoleMeta_publicVisible_idx" ON "ServerRoleMeta"("publicVisible");

-- `SET NULL`: eine geloeschte Gruppe nimmt die Rollen nicht mit. Sie fallen in
-- «Sonstige» zurueck, statt mitsamt ihren Beschreibungen zu verschwinden.
ALTER TABLE "ServerRoleMeta"
  ADD CONSTRAINT "ServerRoleMeta_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "ServerRoleCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
