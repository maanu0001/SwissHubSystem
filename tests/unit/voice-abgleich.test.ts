import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Woher der Bot weiss, wer gerade im Sprachkanal sitzt.
 *
 * Die Fachlichkeit der Sprachzeit steht im Integrationstest gegen eine echte
 * Datenbank. Hier steht die eine Entscheidung davor, die sich dort nicht
 * prüfen lässt, weil sie discord.js betrifft: **welchen Cache der Bot
 * fragt.**
 *
 * `channel.members` entsteht aus dem Mitglieder-Cache - es sind die
 * Mitglieder, die der Prozess schon einmal gesehen hat. Frisch nach dem
 * Start ist der oft leer, und dann sieht der Abgleich einen vollen
 * Sprachkanal als leer an. `guild.voiceStates.cache` kommt mit
 * `GUILD_CREATE` mit und beantwortet genau die Frage, um die es geht.
 */

function lies(pfad: string): string {
  return readFileSync(join(process.cwd(), pfad), 'utf8');
}

/** Nur den Code, ohne die Kommentare darüber. */
function ohneKommentare(quelle: string): string {
  return quelle.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');
}

const ereignisse = lies('apps/bot/src/analytics-events.ts');
const start = lies('apps/bot/src/index.ts');
const zaehler = lies('packages/modules/src/analytics/zaehler.ts');

describe('Wer im Sprachkanal sitzt', () => {
  it('wird über die Sprachzustände des Servers gelesen', () => {
    expect(ereignisse).toContain('guild.voiceStates.cache.values()');
  });

  it('nicht über den Mitglieder-Cache der Kanäle', () => {
    // Genau das war der Grund, warum der Abgleich nach einem Neustart
    // niemanden fand. Geprüft wird der Code, nicht der Kommentar darüber -
    // der erklärt ja gerade, warum dieser Weg nicht genommen wird.
    const funktion = ohneKommentare(ereignisse.slice(ereignisse.indexOf('export function anwesendeImVoice')));
    expect(funktion).not.toContain('.members');
  });

  it('zählt Bühnenkanäle mit', () => {
    expect(ereignisse).toContain('ChannelType.GuildStageVoice');
  });
});

describe('Der Abgleich beim Start', () => {
  it('geht in beide Richtungen', () => {
    // Nur schliessen hiesse: wer während des Neustarts im Kanal sass, wird
    // ab da nicht mehr gezählt.
    expect(start).toContain('gleicheSprachabschnitteAb(guildId, anwesendeImVoice(readyClient, guildId))');
    expect(start).not.toContain('schliesseVerwaisteAbschnitte(guildId, anwesende');
  });

  it('schliesst beim Herunterfahren dagegen alles', () => {
    expect(start).toContain('analytics.schliesseVerwaisteAbschnitte(guildId)');
  });

  it('zählt die Ausfallzeit niemandem zu', () => {
    // Bis zum letzten Herzschlag reicht das Wissen - und keine Sekunde
    // weiter.
    expect(zaehler).toContain('status?.lastHeartbeatAt ?? new Date()');
    expect(zaehler).toContain('return grenze < jetzt ? grenze : jetzt;');
  });

  it('entscheidet über die Zählbarkeit nicht selbst', () => {
    // Modul, Einstellungen, Bot-Filter und ausgenommene Kanäle stehen an
    // einer Stelle - `starteSprachAbschnitt`. Hier gibt es keine zweite
    // Regel.
    const abgleich = zaehler.slice(zaehler.indexOf('export async function gleicheSprachabschnitteAb'));
    expect(abgleich).toContain('await starteSprachAbschnitt(');
    expect(abgleich).not.toContain('logVoice');
    expect(abgleich).not.toContain('prisma.analyticsVoiceSegment.create');
  });
});

describe('Ein Zustandswechsel ohne Kanalwechsel', () => {
  it('beendet keinen Abschnitt', () => {
    // Stumm, taub und Stream melden dasselbe Ereignis wie ein Kanalwechsel.
    const handler = ereignisse.slice(ereignisse.indexOf('client.on(Events.VoiceStateUpdate'));
    expect(handler).toContain('if (vorher === nachher) {');
  });

  it('läuft nicht mit einer leeren Kennung weiter', () => {
    const handler = ereignisse.slice(ereignisse.indexOf('client.on(Events.VoiceStateUpdate'));
    expect(handler).toContain('if (!personId) {');
    expect(handler).not.toContain("person?.id ?? ''");
  });
});
