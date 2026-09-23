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
 * `guild.voiceStates.cache` ist die richtige Quelle: sie kommt mit
 * `GUILD_CREATE` mit und beantwortet genau die Frage, um die es geht.
 * `channel.members` entsteht dagegen aus dem Mitglieder-Cache und ist frisch
 * nach dem Start oft leer.
 *
 * Trotzdem werden **beide** gelesen, und das ist eine Korrektur.
 *
 * Frueher stand hier, `channel.members` duerfe gar nicht vorkommen. Die
 * Begruendung stimmt, die Folgerung war zu eng: wenn die erste Quelle einmal
 * leer ist - ein Server, der erst nachtraeglich verfuegbar wird, eine
 * wiederaufgenommene Verbindung -, dann sieht der Abgleich einen vollen
 * Sprachkanal als leer an und schliesst jeden Abschnitt. Genau dieser Zustand
 * stand im Dashboard: «Gerade im Sprachkanal: 0», waehrend durchgehend Leute
 * im Voice waren.
 *
 * Eine Statistik, die bei «niemand da» landet, weil ein Zwischenspeicher noch
 * nicht gefuellt war, ist schlimmer als eine, die zwei Mal nachsieht.
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
const jobs = lies('apps/bot/src/jobs.ts');

describe('Wer im Sprachkanal sitzt', () => {
  it('wird über die Sprachzustände des Servers gelesen', () => {
    expect(ereignisse).toContain('guild.voiceStates.cache.values()');
  });

  it('und zusätzlich über den Mitglieder-Cache der Kanäle', () => {
    /*
     * Die zweite Quelle. Früher stand hier, sie dürfe nicht vorkommen -
     * siehe oben, warum das die falsche Folgerung war.
     *
     * Geprüft wird der Code, nicht der Kommentar darüber.
     */
    const funktion = ohneKommentare(ereignisse.slice(ereignisse.indexOf('export function anwesendeImVoice')));
    expect(funktion).toContain('kanal.members');
  });

  it('zählt niemanden doppelt, den beide Quellen kennen', () => {
    // Zwei Quellen ohne Entdoppelung wären zwei Abschnitte für dieselbe
    // Person - und die doppelte Zeit.
    const funktion = ohneKommentare(ereignisse.slice(ereignisse.indexOf('export function anwesendeImVoice')));
    expect(funktion).toContain('gefunden.has(discordId)');
  });

  it('zählt Bühnenkanäle mit', () => {
    expect(ereignisse).toContain('ChannelType.GuildStageVoice');
  });
});

describe('Der Abgleich beim Start', () => {
  it('geht in beide Richtungen', () => {
    // Nur schliessen hiesse: wer während des Neustarts im Kanal sass, wird
    // ab da nicht mehr gezählt.
    const code = ohneKommentare(start);
    expect(code).toContain('anwesendeImVoice(readyClient, guildId)');
    expect(code).toContain('.gleicheSprachabschnitteAb(guildId, anwesend)');
    expect(code).not.toContain('schliesseVerwaisteAbschnitte(guildId, anwesende');
  });

  it('bleibt keine Momentaufnahme', () => {
    /*
     * Der Lauf beim Start füllt die Lücke genau einmal. Greift er daneben -
     * ein Zwischenspeicher, der noch nicht gefüllt war -, bliebe die
     * Datenbank für immer bei «niemand im Sprachkanal». Also gleicht der Bot
     * im Betrieb weiter ab.
     */
    expect(jobs).toContain("name: 'analytics-voice-presence'");
    expect(jobs).toContain('analytics.gleicheAnwesenheitAb(');
    expect(ohneKommentare(start)).toContain('anwesendeImVoice(client, guildId)');
  });

  it('läuft nicht gröber als eine Minute', () => {
    // Die Sprachzeit wird in Minuten sichtbar. Ein Raster, das gröber ist
    // als das, was es messen soll, taugt nicht.
    const job = jobs.slice(jobs.indexOf("name: 'analytics-voice-presence'"));
    expect(job.slice(0, job.indexOf('},'))).toContain('intervalMs: 60 * 1000');
  });

  it('schliesst beim Herunterfahren dagegen alles', () => {
    expect(start).toContain('analytics.schliesseVerwaisteAbschnitte(guildId)');
  });

  it('zählt die Ausfallzeit niemandem zu', () => {
    // Bis zum letzten Herzschlag reicht das Wissen - und keine Sekunde
    // weiter.
    expect(zaehler).toContain('status?.lastHeartbeatAt ?? jetzt');
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
