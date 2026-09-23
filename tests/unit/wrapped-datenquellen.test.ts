import { describe, expect, it } from 'vitest';

const { readFileSync, globSync } = await import('node:fs');
const { join } = await import('node:path');

/**
 * Woraus ein Rückblick gebaut werden darf - und woraus nicht.
 *
 * ## Die Regel
 *
 * Ein Jahresrückblick ist kein Führungszeugnis. Bans, Kicks, Mutes, Jails,
 * Meldungen, Tickets, Verifikationsprobleme, Entbannungsanträge und
 * Moderationsnotizen kommen darin nicht vor - weder als Zahl noch als Szene
 * noch als Nebensatz.
 *
 * ## Warum ein Test und nicht ein Kommentar
 *
 * Weil es sich leise einschleicht. Niemand würde eine Szene «Deine Bans
 * 2026» bauen. Aber «aktive Tage» aus einer Tabelle zu zählen, in der auch
 * Jails stehen, ist ein Einzeiler - und auf dem Bildschirm sieht man der
 * Zahl nicht an, woher sie kommt.
 *
 * Geprüft wird deshalb die **Datenherkunft im Quelltext**: welche Tabellen
 * das Modul überhaupt anfasst. Eine verbotene Tabelle fällt hier auf, bevor
 * sie irgendwo eine Zahl ergibt.
 */
const WURZEL = process.cwd();

/** Die Dateien, die die Zahlen eines Rückblicks beschaffen. */
const DATENDATEIEN = [
  'packages/modules/src/wrapped/resolver.ts',
  'packages/modules/src/wrapped/momentaufnahme.ts',
  'packages/modules/src/wrapped/highlight.ts',
  'packages/modules/src/wrapped/archetyp.ts',
];

/**
 * Tabellen, die in einem Rückblick nichts zu suchen haben.
 *
 * Geschrieben als Prisma-Zugriff (`prisma.jailEntry`) und als roher
 * Tabellenname (`"JailEntry"`), weil das Modul beides benutzt.
 */
const VERBOTEN = [
  'jailEntry',
  'JailEntry',
  'moderationCase',
  'ModerationCase',
  'moderationNote',
  'ModerationNote',
  'ticket',
  'Ticket',
  'appeal',
  'Appeal',
  'verificationRequest',
  'VerificationRequest',
  'clipReport',
  'ClipReport',
  'securityEvent',
  'SecurityEvent',
  'voteJail',
  'VoteJail',
];

const quelle = (datei: string): string => readFileSync(join(WURZEL, datei), 'utf8');

/**
 * Nur der Code, ohne Kommentare.
 *
 * Der Test hier sucht nach Wörtern wie «Jail» - und genau diese Wörter
 * stehen in den Kommentaren, die erklären, warum sie nicht vorkommen
 * dürfen. Ohne diesen Schritt hätte sich die Datei an ihrer eigenen
 * Begründung gestört.
 */
const ohneKommentare = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//gu, ' ').replace(/^\s*\/\/.*$/gmu, ' ');

describe('Datenquellen eines Rückblicks', () => {
  it.each(DATENDATEIEN)('%s fasst keine Moderationsdaten an', (datei) => {
    const text = quelle(datei);
    const gefunden = VERBOTEN.filter((name) => {
      // Als Prisma-Zugriff oder als Tabellenname in rohem SQL.
      return new RegExp(`(prisma\\.${name}\\b)|("${name}")`, 'u').test(text);
    });
    expect(gefunden, `${datei} greift auf ${gefunden.join(', ')} zu`).toEqual([]);
  });

  it('liest keine Nachrichteninhalte', () => {
    /*
     * Gezählt wird, nie gelesen. `AnalyticsUserDaily` enthält Zahlen; ein
     * Zugriff auf eine Tabelle mit Inhalten wäre ein anderer Rückblick.
     */
    for (const datei of DATENDATEIEN) {
      const text = quelle(datei);
      expect(text).not.toMatch(/prisma\.message\b/u);
      expect(text).not.toMatch(/"MessageLog"/u);
      expect(text).not.toMatch(/\bcontent:\s*true/u);
    }
  });

  it('nennt in den Szenentexten nichts aus der Moderation', () => {
    /*
     * Die zweite Hälfte derselben Regel: auch wenn die Zahl nie käme, darf
     * kein Text so tun, als gäbe es sie.
     */
    const texte = ohneKommentare(quelle('packages/modules/src/wrapped/texte.ts')).toLowerCase();
    for (const wort of ['ban', 'kick', 'jail', 'timeout', 'verwarn', 'ticket', 'gesperrt']) {
      expect(texte, `«${wort}» steht in den Szenentexten`).not.toContain(wort);
    }
  });

  it('erwähnt in keiner Szene der Oberfläche eine Moderationssache', () => {
    const dateien = globSync('apps/web/src/modules/wrapped/**/*.tsx', { cwd: WURZEL });
    expect(dateien.length).toBeGreaterThan(5);

    for (const datei of dateien) {
      const text = ohneKommentare(quelle(datei)).toLowerCase();
      for (const wort of ['jail', 'moderation', 'verwarnung', 'entbannung']) {
        expect(text, `${datei} erwähnt «${wort}»`).not.toContain(wort);
      }
    }
  });
});
