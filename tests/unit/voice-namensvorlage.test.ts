import { describe, expect, it } from 'vitest';

/**
 * Namen fuer temporaere Sprachkanaele.
 *
 * ## Warum das schiefging
 *
 * `🔊| @username's Stübli` liess sich nicht speichern, und der Grund war
 * nicht der, nach dem es aussah:
 *
 * 1. Die Pruefung verlangte eine geschweifte Klammer. `@username` ist die
 *    Schreibweise, die jedem zuerst einfaellt - sie wurde abgelehnt, und
 *    die Meldung nannte `{username}`, ohne den Unterschied zu erklaeren.
 * 2. Die Zeichenliste stammte von Textkanaelen. Discord normalisiert deren
 *    Namen selbst; fuer Sprachkanaele gilt das nicht, und `|` ist dort ein
 *    ganz gewoehnliches Trennzeichen. Es fiel lautlos heraus.
 *
 * Beide Wege sind unten abgedeckt - die Vorlage und der Name, der am Ende
 * wirklich am Kanal steht.
 */
const { baueKanalName, pruefeName, saeubere, PLATZHALTER } =
  await import('../../packages/modules/src/voice/naming');

const GEWUENSCHT = "🔊| @username's Stübli";

describe('Die gewuenschte Vorlage', () => {
  it('behaelt Pipe, Emoji, Apostroph und Leerzeichen', () => {
    const name = baueKanalName(GEWUENSCHT, { username: 'Manu' });
    expect(name).toBe("🔊| Manu's Stübli");
  });

  it('ergibt dasselbe wie die geschweifte Schreibweise', () => {
    expect(baueKanalName(GEWUENSCHT, { username: 'Manu' })).toBe(
      baueKanalName("🔊| {username}'s Stübli", { username: 'Manu' }),
    );
  });

  it('gilt als Vorlage mit Platzhalter', () => {
    expect(PLATZHALTER.some((platz) => GEWUENSCHT.includes(platz))).toBe(true);
  });
});

describe('Zeichen im Kanalnamen', () => {
  it.each([
    ['Pipe', '🎮 Zocken | Runde 2', '🎮 Zocken | Runde 2'],
    ['Umlaute', 'Jürgen Müller Stübli', 'Jürgen Müller Stübli'],
    ['Apostroph', "Manu's Ecke", "Manu's Ecke"],
    ['Schraegstrich', 'CS2 / Valorant', 'CS2 / Valorant'],
    ['Klammern', 'Talk (privat)', 'Talk (privat)'],
  ])('laesst %s stehen', (_name, eingabe, erwartet) => {
    expect(saeubere(eingabe, 100)).toBe(erwartet);
  });

  it.each([
    ['Erwaehnung', 'Jürgen @everyone', 'Jürgen everyone'],
    ['Raute', '#allgemein', 'allgemein'],
    ['spitze Klammer', '<@123>', '123'],
  ])('entfernt %s weiterhin', (_name, eingabe, erwartet) => {
    // Ein Kanalname erzeugt keine Erwaehnung - aber `@everyone` in einer
    // Kanalliste ist ein Trick, den niemand braucht.
    expect(saeubere(eingabe, 100)).toBe(erwartet);
  });
});

describe('Randfaelle beim Einsetzen', () => {
  it('kuerzt einen sehr langen Benutzernamen, ohne die Vorlage zu zerstoeren', () => {
    const name = baueKanalName(GEWUENSCHT, { username: 'A'.repeat(80) });
    expect(name.startsWith('🔊| ')).toBe(true);
    expect(name.endsWith("'s Stübli")).toBe(true);
    // Discord nimmt 100 Zeichen.
    expect(name.length).toBeLessThanOrEqual(100);
  });

  it('faellt bei einem Namen aus lauter unzulaessigen Zeichen auf «Talk» zurueck', () => {
    // Sonst stuende dort «'s Stübli» - ein Name, der nach einem Fehler
    // aussieht, weil er nach einem Fehler aussieht.
    expect(baueKanalName(GEWUENSCHT, { username: '@@@' })).toBe("🔊| Talk's Stübli");
  });

  it('nimmt den Anzeigenamen, wo die Vorlage ihn verlangt', () => {
    expect(baueKanalName('🔊| @displayName', { username: 'manu', displayName: 'Manu B.' })).toBe(
      '🔊| Manu B.',
    );
  });

  it('bleibt bei einem Emoji-Namen brauchbar', () => {
    const name = baueKanalName(GEWUENSCHT, { username: '🎮🎮🎮' });
    expect(name).toContain('🎮');
    expect(name).toContain('Stübli');
  });
});

describe('Von Hand umbenennen', () => {
  it('nimmt den gewuenschten Namen unveraendert an', () => {
    // Hier fiel das Pipe-Zeichen ebenfalls heraus - derselbe Filter.
    expect(pruefeName('🔊| Manus Stübli')).toEqual({ ok: true, name: '🔊| Manus Stübli' });
  });

  it('lehnt ab, was nach dem Saeubern nichts mehr ist', () => {
    const ergebnis = pruefeName('@@@');
    expect(ergebnis.ok).toBe(false);
  });

  it('lehnt mehr als hundert Zeichen ab', () => {
    const ergebnis = pruefeName('A'.repeat(101));
    expect(ergebnis.ok).toBe(false);
  });
});
