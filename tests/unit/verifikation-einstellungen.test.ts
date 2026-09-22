import { describe, expect, it } from 'vitest';
import { isChannelField, verification, type SettingsField } from '@swisshub/modules';

const { verificationModule, verificationSettingsSchema } = verification;

/**
 * Die Einstellungen der Verifikation - und die drei Kanäle darin.
 *
 * Das Modul spricht mit drei verschiedenen Publika, und jedes hat seinen
 * eigenen Kanal:
 *
 * - **Verifikationskanal**: dort schreiben Leute, die noch *nicht*
 *   verifiziert sind. Nach der Entscheidung sehen sie ihn nicht mehr.
 * - **Moderations-Kanal**: dort entscheidet das Team.
 * - **Kanal nach Verifikation**: dort liest die Gemeinschaft, wer neu dabei
 *   ist.
 *
 * Solange das drei getrennte Einstellungen sind, kann man sie nicht
 * versehentlich vermischen. Genau das prüft diese Datei - zusammen mit der
 * Frage, ob die Meldung wirklich im Dashboard änderbar ist und ob die
 * Platzhalter das bleiben, was sie sein sollen: Ersetzungen, keine
 * Ausdrücke.
 */

const felder = verificationModule.settingsFields ?? [];

function feld(key: string): SettingsField {
  const treffer = felder.find((eintrag) => eintrag.key === key);
  expect(treffer, `Feld «${key}» fehlt in den Einstellungen.`).toBeDefined();
  return treffer as SettingsField;
}

describe('Verifikation · Einstellungen', () => {
  it('trennt die drei Kanäle in drei eigene Felder', () => {
    const kanalfelder = felder.filter(isChannelField).map((eintrag) => eintrag.key);
    expect(kanalfelder).toContain('verificationChannelId');
    expect(kanalfelder).toContain('moderatorChannelId');
    expect(kanalfelder).toContain('postVerificationChannelId');
    expect(new Set(kanalfelder).size).toBe(kanalfelder.length);
  });

  it('lässt den Ergebniskanal auswählen statt eintippen', () => {
    // Eine hart hinterlegte oder von Hand eingetippte ID wäre genau das,
    // was der Channel-Selector abschafft: sie zeigt irgendwann ins Leere,
    // und niemand sieht es.
    const eintrag = feld('postVerificationChannelId');
    expect(eintrag.type).toBe('discord-channel');
    expect(isChannelField(eintrag) && eintrag.channelKinds).toEqual(['text']);
  });

  it('macht Überschrift, Text, Farbe und Erwähnung im Dashboard änderbar', () => {
    expect(feld('postVerificationTitle').type).toBe('text');
    expect(feld('postVerificationMessage').type).toBe('textarea');
    expect(feld('postVerificationColor').type).toBe('text');
    expect(feld('postVerificationMention').type).toBe('boolean');
    expect(feld('cleanupEnabled').type).toBe('boolean');
  });

  it('kennt zu jedem Feld einen Schlüssel im Schema', () => {
    // Ein Tippfehler im Feldschlüssel ergäbe ein Eingabefeld, das nichts
    // speichert - sichtbar, bedienbar, wirkungslos.
    const erlaubt = new Set(Object.keys(verificationSettingsSchema.shape));
    const unbekannt = felder.map((eintrag) => eintrag.key).filter((key) => !erlaubt.has(key));
    expect(unbekannt).toEqual([]);
  });

  it('meldet ohne Ergebniskanal gar nichts', () => {
    const vorgabe = verificationSettingsSchema.parse({});
    expect(vorgabe.postVerificationChannelId).toBeNull();
    // Ein Kanal, den niemand ausgesucht hat, ist kein Ort für eine
    // öffentliche Ankündigung.
  });

  it('räumt nach der Entscheidung auf, solange niemand es abschaltet', () => {
    expect(verificationSettingsSchema.parse({}).cleanupEnabled).toBe(true);
    expect(verificationSettingsSchema.parse({ cleanupEnabled: false }).cleanupEnabled).toBe(false);
  });

  it('nimmt nur echte Hex-Farben an', () => {
    expect(verificationSettingsSchema.parse({ postVerificationColor: '#83060A' }).postVerificationColor).toBe(
      '#83060A',
    );
    expect(() => verificationSettingsSchema.parse({ postVerificationColor: 'grün' })).toThrow();
    expect(() => verificationSettingsSchema.parse({ postVerificationColor: '#12345' })).toThrow();
    expect(() =>
      verificationSettingsSchema.parse({ postVerificationColor: 'javascript:alert(1)' }),
    ).toThrow();
  });

  it('begrenzt Überschrift und Text', () => {
    expect(() => verificationSettingsSchema.parse({ postVerificationTitle: 'x'.repeat(201) })).toThrow();
    expect(() => verificationSettingsSchema.parse({ postVerificationMessage: 'x'.repeat(2001) })).toThrow();
  });
});

describe('Verifikation · Platzhalter', () => {
  const person = { discordId: '4711', username: 'manu', displayName: 'Manuel' };

  it('ersetzt genau die drei vorgesehenen Platzhalter', () => {
    expect(verification.fuelleVorlage('{user} · {username} · {displayName}', person)).toBe(
      '<@4711> · manu · Manuel',
    );
  });

  it('lässt alles andere stehen', () => {
    // Eine Vorlage, die beliebige Ausdrücke auswertet, wäre eine
    // Ausführungsumgebung in einem Textfeld. Es gibt genau drei Ersetzungen,
    // und alles andere ist Text.
    const vorlage = '{{7*7}} ${process.env.DISCORD_BOT_TOKEN} {admin} {user.roles} <@everyone>';
    const ergebnis = verification.fuelleVorlage(vorlage, person);
    expect(ergebnis).toBe(vorlage);
    expect(ergebnis).not.toContain('49');
  });

  it('kommt ohne Anzeigenamen aus', () => {
    expect(
      verification.fuelleVorlage('{displayName} ({username})', {
        discordId: '1',
        username: 'nur-name',
        displayName: null,
      }),
    ).toBe('nur-name (nur-name)');
  });
});
