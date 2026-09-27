/**
 * Test-Umgebung.
 *
 * Es werden ausschliesslich Platzhalterwerte gesetzt - Tests sprechen niemals
 * mit dem echten Discord oder einer produktiven Datenbank.
 */
/*
 * `NODE_ENV` ueber eine Zuweisung auf das Umgebungsobjekt.
 *
 * Next erklaert `process.env.NODE_ENV` in seinen Typen als **nur lesbar** -
 * zu Recht, denn in der laufenden Anwendung darf es niemand aendern. Sobald
 * ein Test eine Datei aus `apps/web/src/app` anfasst, gilt diese Erklaerung
 * auch hier, und die einfache Zuweisung waere ein Typfehler in einer Datei,
 * die nichts damit zu tun hat.
 *
 * Vitest setzt den Wert ohnehin selbst; diese Zeile ist die Zusicherung fuer
 * den Fall, dass die Testdatei ausserhalb von Vitest geladen wird.
 */
(process.env as Record<string, string | undefined>).NODE_ENV = 'test';
// Datenbankgestützte Tests nutzen `SWISSHUB_TEST_DATABASE_URL` (siehe
// `tests/helpers/database.ts`) und werden ohne sie übersprungen. Die übrigen
// Tests sprechen nie mit einer echten Datenbank - der Platzhalter genügt.
process.env.DATABASE_URL =
  process.env.SWISSHUB_TEST_DATABASE_URL?.trim() ||
  'postgresql://test:test@localhost:5432/test?schema=public';
process.env.DISCORD_BOT_TOKEN = 'test-bot-token-placeholder-value';
process.env.DISCORD_CLIENT_ID = '100000000000000000';
process.env.DISCORD_CLIENT_SECRET = 'test-client-secret';
process.env.DISCORD_GUILD_ID = '200000000000000000';
process.env.AUTH_SECRET = 'test-auth-secret-test-auth-secret-test-auth';
process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
process.env.LOG_LEVEL = 'error';

/**
 * Kein Besitzer in Tests.
 *
 * Vitest übernimmt Werte aus `.env` in `process.env`. Stimmt die dort
 * hinterlegte Besitzer-ID zufällig mit einer Test-ID überein, umgeht dieser
 * Aufrufer sämtliche Berechtigungsprüfungen - und ein Test, der genau die
 * prüfen soll, wird still wirkungslos.
 */
process.env.SWISSHUB_OWNER_DISCORD_ID = '';
