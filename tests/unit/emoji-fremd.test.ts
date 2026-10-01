import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cdnAdresse, leseReferenz } from '../../packages/modules/src/emoji/fremd';
import { DISCORD_BILD_HOSTS } from '../../packages/modules/src/emoji/herkunft';
import { EMOJI_PERMISSIONS } from '../../packages/modules/src/emoji/config';

/**
 * Ein Emoji von einem anderen Server übernehmen.
 *
 * ## Was hier geprüft wird
 *
 * Das Lesen der Referenz, und zwar scharf: `<:pog:123…>` ist der Normalfall,
 * aber die Eingabe kommt aus einem Textfeld, und dort steht alles Mögliche.
 * Ein zu grosszügiges Muster macht aus einem Tippfehler eine Kennung, die
 * irgendwohin zeigt; ein zu enges lässt den Weg scheitern, auf dem die Leute
 * tatsächlich kommen.
 *
 * Und die gebaute Adresse: sie ist der Grund, weshalb das **kein** Laden einer
 * beliebigen Adresse ist. Sie entsteht aus der Kennung, und ihr Host steht in
 * einer festen Liste - nicht in einer Einstellung.
 */

const ID = '123456789012345678';

describe('Emoji-Referenz: was als Eingabe durchgeht', () => {
  it('liest ein festes Emoji aus einer Nachricht', () => {
    const befund = leseReferenz(`<:pog:${ID}>`);
    expect(befund.ok).toBe(true);
    expect(befund.referenz).toEqual({
      discordEmojiId: ID,
      urspruenglicherName: 'pog',
      animiertLautReferenz: false,
    });
  });

  it('liest ein animiertes Emoji und merkt sich das', () => {
    // Die Art entscheidet über das Platzkontingent - sie darf nicht verloren
    // gehen, nur weil das `a` klein ist.
    const befund = leseReferenz(`<a:pog_tanz:${ID}>`);
    expect(befund.referenz?.animiertLautReferenz).toBe(true);
  });

  it('verzeiht Leerzeichen am Rand', () => {
    expect(leseReferenz(`  <:pog:${ID}>  `).ok).toBe(true);
  });

  it('nimmt die nackte Kennung an - dann ist die Art noch offen', () => {
    const befund = leseReferenz(ID);
    expect(befund.ok).toBe(true);
    expect(befund.referenz?.urspruenglicherName).toBeNull();
    /*
     * `null` und nicht `false`: ohne Referenz weiss niemand, ob das Emoji
     * animiert ist. Es auf «fest» zu raten holte von einem animierten Emoji
     * ein Einzelbild - eine stille Verschlechterung.
     */
    expect(befund.referenz?.animiertLautReferenz).toBeNull();
  });

  it('nimmt eine CDN-Adresse an', () => {
    const befund = leseReferenz(`https://cdn.discordapp.com/emojis/${ID}.gif?size=96`);
    expect(befund.referenz?.discordEmojiId).toBe(ID);
    expect(befund.referenz?.animiertLautReferenz).toBe(true);
  });

  it('erklärt bei einem Standard-Emoji, warum das nicht geht', () => {
    /*
     * Der häufigste Fehlgriff. «Konnte nicht geladen werden» wäre hier die
     * unbrauchbare Antwort: ein Unicode-Zeichen liegt auf keinem Server, es
     * gehört allen.
     */
    for (const zeichen of ['🔥', '😀', 'Schau mal: 🎉']) {
      const befund = leseReferenz(zeichen);
      expect(befund.ok, zeichen).toBe(false);
      expect(befund.grund, zeichen).toContain('Standard-Emoji');
    }
  });

  it.each([
    ['', 'leer'],
    ['   ', 'nur Leerzeichen'],
    ['pog', 'nur ein Wort'],
    [':pog:', 'ohne Klammern und Kennung'],
    [`<:pog:${ID}`, 'Klammer fehlt'],
    [`<:pog:12345>`, 'Kennung zu kurz'],
    [`<:p:${ID}>`, 'Name zu kurz'],
    [`<:pog-face:${ID}>`, 'Bindestrich im Namen'],
    [`<b:pog:${ID}>`, 'unbekanntes Vorzeichen'],
    ['https://example.com/emojis/123.png', 'fremder Host ohne Kennungslänge'],
    ['../../etc/passwd', 'Pfad'],
    ['9999999999999999999999999', 'Kennung zu lang'],
  ])('lehnt «%s» ab (%s)', (eingabe) => {
    const befund = leseReferenz(eingabe);
    expect(befund.ok).toBe(false);
    // Und immer mit einem Satz - ein stilles `false` lässt die Person raten.
    expect(befund.grund).toBeTruthy();
  });

  it('liest aus einem eingebetteten Emoji nichts heraus', () => {
    /*
     * Absichtlich streng: das Muster ist an den Anfang und das Ende gebunden.
     * Wer einen ganzen Satz einfügt, bekommt eine Fehlermeldung statt eines
     * Emojis, das er nicht gemeint hat - etwa das erste von fünf.
     */
    expect(leseReferenz(`schau <:pog:${ID}> und <:lol:${ID}>`).ok).toBe(false);
  });
});

describe('Die Bildadresse wird gebaut, nicht eingegeben', () => {
  it('zeigt auf Discords CDN', () => {
    expect(cdnAdresse(ID, false)).toBe(`https://cdn.discordapp.com/emojis/${ID}.png`);
    expect(cdnAdresse(ID, true)).toBe(`https://cdn.discordapp.com/emojis/${ID}.gif`);
  });

  it('nimmt den Host aus der festen Liste', () => {
    /*
     * Das ist der Kern: der Host kommt nicht aus einer Einstellung, die jemand
     * ändern kann, sondern aus `DISCORD_BILD_HOSTS`. Deshalb ist das Übernehmen
     * kein Abruf einer beliebigen Adresse.
     */
    expect(cdnAdresse(ID, false).startsWith(`https://${DISCORD_BILD_HOSTS[0]}/`)).toBe(true);
  });
});

/** Block- und Zeilenkommentare entfernen. */
function ohneKommentare(quelle: string): string {
  return quelle.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');
}

function lies(pfad: string): string {
  return readFileSync(join(process.cwd(), pfad), 'utf8');
}

describe('Die drei Befehle nehmen ein Emoji, kein Bild', () => {
  const befehle = lies('apps/bot/src/commands/emoji-commands.ts');
  const rumpf = ohneKommentare(befehle);

  it.each(['emoji_add', 'emoji_request', 'emoji_vote'])('%s hat ein Emoji-Feld', (name) => {
    const block = rumpf.slice(rumpf.indexOf(`name: '${name}'`));
    const bisEnde = block.slice(0, block.indexOf('},\n  {') + 1 || undefined);
    expect(bisEnde).toContain("name: 'emoji'");
  });

  it('nimmt keinen Anhang mehr an', () => {
    // Der alte Weg - eine Datei hochladen - ist ersetzt, nicht ergaenzt.
    expect(rumpf).not.toContain('ApplicationCommandOptionType.Attachment');
    expect(rumpf).not.toContain('getAttachment');
  });

  it('holt das Bild über die Übernahme und nicht selbst', () => {
    expect(rumpf).toContain('emoji.uebernehmeEmoji');
    expect(rumpf).not.toMatch(/fetch\(/u);
  });

  it('prüft für jeden Befehl die richtige Berechtigung', () => {
    expect(rumpf).toContain('EMOJI_PERMISSIONS.manage');
    expect(rumpf).toContain('EMOJI_PERMISSIONS.request');
    // Die neue, eigene Berechtigung fuer die Abstimmung.
    expect(rumpf).toContain('EMOJI_PERMISSIONS.voteStart');
  });

  it('bricht ohne Abstimmungskanal ab, bevor etwas angelegt wird', () => {
    /*
     * Eine Abstimmung ohne Kanal laesst eine Frist laufen, die niemand sehen
     * kann. Der Abbruch muss **vor** `hole()` stehen, sonst wird ein Bild
     * geholt und ein Vorschlag angelegt, den niemand gewollt hat.
     */
    const stelle = rumpf.indexOf('abstimmungChannelId.trim().length === 0');
    const holen = rumpf.indexOf('await hole(interaction)', rumpf.indexOf('async function abstimmenLassen'));
    expect(stelle).toBeGreaterThan(0);
    expect(stelle).toBeLessThan(holen);
  });

  it('baut keine zweite Fachlogik', () => {
    for (const funktion of ['fuegeEmojiHinzu', 'reicheEin', 'reicheEinUndStelleZurAbstimmung']) {
      expect(rumpf, `${funktion} fehlt`).toContain(`emoji.${funktion}`);
    }
    // Keine eigene Namenspruefung, keine eigene Platzrechnung.
    expect(rumpf).not.toMatch(/a-z0-9_/u);
    expect(rumpf).not.toContain('premiumTier');
  });
});

describe('Abstimmung starten ist eine eigene Berechtigung', () => {
  it('heisst emoji.vote und ist nicht Teil von moderate', () => {
    /*
     * Der Sinn: sie soll an eine Levelrolle gehen koennen («ab Level 15»),
     * waehrend das Entscheiden beim Team bleibt. Waere sie Teil von `moderate`,
     * gaebe man mit ihr auch das Annehmen und Loeschen weg.
     */
    expect(EMOJI_PERMISSIONS.voteStart).toBe('emoji.vote');
    expect(EMOJI_PERMISSIONS.voteStart).not.toBe(EMOJI_PERMISSIONS.moderate);
  });

  it('steht als eigener Eintrag in der Modulregistrierung', () => {
    const config = lies('packages/modules/src/emoji/config.ts');
    expect(config).toContain('EMOJI_PERMISSIONS.voteStart');
    // Und sie ist nicht `critical`: sie entscheidet nichts.
    const block = config.slice(config.indexOf('EMOJI_PERMISSIONS.voteStart'));
    expect(block.slice(0, block.indexOf('},'))).not.toContain('critical');
  });

  it('öffnet der Knopf im Team-Embed denselben Weg', () => {
    const knoepfe = ohneKommentare(lies('apps/bot/src/emoji-buttons.ts'));
    expect(knoepfe).toContain('EMOJI_PERMISSIONS.voteStart');
    // Annehmen und Ablehnen bleiben bei `moderate`.
    expect(knoepfe).toContain('EMOJI_PERMISSIONS.moderate');
  });
});
