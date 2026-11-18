-- Kommentare unter oeffentlichen Profilen.
--
-- ## Was sie ermoeglichen
--
-- Wer angemeldet ist, kann unter einem oeffentlichen Profil etwas
-- hinterlassen. Gelesen werden die Kommentare von allen, die das Profil
-- sehen - es steht oeffentlich, und was darunter steht, auch.
--
-- ## Warum weich geloescht wird
--
-- `deletedAt` statt eines echten DELETE. Entfernen duerfen drei Parteien:
-- wer den Kommentar geschrieben hat, wem das Profil gehoert, und die
-- Moderation. Ein hart geloeschter Kommentar macht die Frage «stand da
-- etwas, und was» unbeantwortbar - gerade dann, wenn sich jemand ueber eine
-- Entfernung beschwert.
--
-- ## Warum der Name mitgefuehrt wird
--
-- `authorName` steht in der Zeile und wird nicht nachgeschlagen. Wer den
-- Server verlaesst, verschwindet aus dem Mitgliederspiegel - sein Kommentar
-- stuende dann unter einer nackten Zahl.

CREATE TABLE "MemberProfileComment" (
    "id" TEXT NOT NULL,
    "profileDiscordId" TEXT NOT NULL,
    "authorDiscordId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedByDiscordId" TEXT,

    CONSTRAINT "MemberProfileComment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MemberProfileComment_profileDiscordId_deletedAt_createdAt_idx"
    ON "MemberProfileComment"("profileDiscordId", "deletedAt", "createdAt");

CREATE INDEX "MemberProfileComment_authorDiscordId_idx"
    ON "MemberProfileComment"("authorDiscordId");
