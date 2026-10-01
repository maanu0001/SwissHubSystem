import { describe, expect, it } from 'vitest';
import { emojiPlaetze } from '@swisshub/discord';
import {
  EMOJI_MAX_BYTES,
  alsDataUri,
  erkenneArt,
  istAnimiert,
  maszeVon,
  pruefeBild,
  pruefsummeVon,
} from '../../packages/modules/src/emoji/bild';
import { pruefeEmojiName } from '../../packages/modules/src/emoji/name';
import { erlaubteHostsAus, hostErlaubt } from '../../packages/modules/src/emoji/herkunft';
import { pruefePlatz } from '../../packages/modules/src/emoji/plaetze';
import type { PlatzUebersicht } from '../../packages/modules/src/emoji/plaetze';

/**
 * Was vor einem Emoji-Upload geprüft wird.
 *
 * ## Warum das Prüfen hier und nicht bei Discord passiert
 *
 * Weil Discord erst beim Hochladen widerspricht, und zwar mit «Invalid Form
 * Body». Ein Vorschlag, der drei Tage in der Moderation liegt und dann am
 * Namen scheitert, ist eine Enttäuschung, die am Anfang vermeidbar war.
 */

/** Ein PNG-Kopf mit Massen - echte Bytes, keine Behauptung. */
function png(breite: number, hoehe: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x00, 0x00, 0x00, 0x0d], 8);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  const sicht = new DataView(bytes.buffer);
  sicht.setUint32(16, breite);
  sicht.setUint32(20, hoehe);
  return bytes;
}

/** Ein GIF mit `bilder` Bildsteuerblöcken - ab zwei ist es animiert. */
function gif(breite: number, hoehe: number, bilder: number): Uint8Array {
  const kopf = new Uint8Array(13 + bilder * 3);
  kopf.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0); // GIF89a
  const sicht = new DataView(kopf.buffer);
  sicht.setUint16(6, breite, true);
  sicht.setUint16(8, hoehe, true);
  for (let i = 0; i < bilder; i += 1) {
    kopf.set([0x21, 0xf9, 0x04], 13 + i * 3);
  }
  return kopf;
}

describe('Emoji-Name: was Discord annimmt', () => {
  it.each([
    ['pog', 'pog'],
    // Doppelpunkte und Rand: wer `:pog:` tippt, meint `pog`.
    [':pog:', 'pog'],
    ['  pog  ', 'pog'],
    // Grossbuchstaben werden klein: zwei Namen, die sich nur in der
    // Schreibweise unterscheiden, sind im Chat nicht unterscheidbar.
    ['POG', 'pog'],
    ['swiss_hub_2026', 'swiss_hub_2026'],
  ])('nimmt «%s» an und speichert «%s»', (eingabe, erwartet) => {
    const befund = pruefeEmojiName(eingabe);
    expect(befund.ok, befund.grund).toBe(true);
    expect(befund.name).toBe(erwartet);
  });

  it.each([
    ['p', 'zu kurz'],
    ['a'.repeat(33), 'zu lang'],
    ['mein emoji', 'Leerzeichen'],
    ['grüezi', 'Umlaut'],
    ['pog-face', 'Bindestrich'],
    ['pog!', 'Satzzeichen'],
    ['___', 'nur Unterstriche'],
    ['', 'leer'],
  ])('lehnt «%s» ab (%s)', (eingabe) => {
    const befund = pruefeEmojiName(eingabe);
    expect(befund.ok).toBe(false);
    // Und immer mit einem Satz, der sagt, was zu ändern ist.
    expect(befund.grund).toBeTruthy();
  });

  it('ersetzt nichts stillschweigend', () => {
    /*
     * Aus «mein emoji» automatisch `mein_emoji` zu machen hiesse, einen Namen
     * zu vergeben, den niemand gewählt hat - und der steht danach im Chat.
     */
    const befund = pruefeEmojiName('mein emoji');
    expect(befund.ok).toBe(false);
    expect(befund.name).not.toBe('mein_emoji');
  });
});

describe('Emoji-Bild: die Bytes entscheiden, nicht die Endung', () => {
  it('erkennt PNG, JPEG, GIF und WebP an ihren ersten Bytes', () => {
    expect(erkenneArt(png(64, 64))).toBe('image/png');
    expect(erkenneArt(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('image/jpeg');
    expect(erkenneArt(gif(64, 64, 1))).toBe('image/gif');
    const webp = new Uint8Array(32);
    webp.set([0x52, 0x49, 0x46, 0x46], 0);
    webp.set([0x57, 0x45, 0x42, 0x50], 8);
    expect(erkenneArt(webp)).toBe('image/webp');
  });

  it('lehnt ein SVG ab, auch wenn es sich PNG nennt', () => {
    /*
     * Der Fall, auf den es ankommt. Ein SVG ist ein Dokument mit
     * Skriptfähigkeit; Discord nähme es nicht, aber bis dahin läge es im
     * Upload-Verzeichnis. Der Content-Type oder die Endung sagt hier nichts -
     * geprüft werden die Bytes.
     */
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
    expect(erkenneArt(svg)).toBeNull();
    expect(pruefeBild(svg).ok).toBe(false);
  });

  it('lehnt eine leere Datei ab', () => {
    expect(pruefeBild(new Uint8Array()).ok).toBe(false);
  });

  it('lehnt alles über Discords Grenze ab und nennt die Grösse', () => {
    const zuGross = new Uint8Array(EMOJI_MAX_BYTES + 1);
    zuGross.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    const befund = pruefeBild(zuGross);
    expect(befund.ok).toBe(false);
    // Die gefundene Grösse steht drin: «zu gross» allein sagt nicht, wie weit.
    expect(befund.grund).toMatch(/\d+ KB/u);
  });

  it('liest die Masse aus dem PNG-Kopf', () => {
    expect(maszeVon(png(128, 96), 'image/png')).toEqual({ breite: 128, hoehe: 96 });
  });

  it('liest die Masse aus dem GIF-Kopf', () => {
    expect(maszeVon(gif(48, 32, 1), 'image/gif')).toEqual({ breite: 48, hoehe: 32 });
  });

  it('trennt ein animiertes GIF von einem Einzelbild', () => {
    /*
     * Der Unterschied ist nicht Kosmetik: Discord zählt feste und animierte
     * Emojis getrennt. Ein animiertes auf einen festen Platz zu rechnen
     * ergibt eine Zahl, die nicht stimmt - und einen Upload, der an einem
     * Kontingent scheitert, das das Dashboard als frei gezeigt hat.
     */
    expect(istAnimiert(gif(64, 64, 1), 'image/gif')).toBe(false);
    expect(istAnimiert(gif(64, 64, 4), 'image/gif')).toBe(true);
    expect(pruefeBild(gif(64, 64, 4)).animiert).toBe(true);
  });

  it('erkennt ein animiertes WebP am Flaggenbit', () => {
    const bauen = (flaggen: number): Uint8Array => {
      const bytes = new Uint8Array(32);
      bytes.set([0x52, 0x49, 0x46, 0x46], 0);
      bytes.set([0x57, 0x45, 0x42, 0x50], 8);
      bytes.set([0x56, 0x50, 0x38, 0x58], 12); // VP8X
      bytes[20] = flaggen;
      return bytes;
    };
    expect(istAnimiert(bauen(0b0000_0000), 'image/webp')).toBe(false);
    expect(istAnimiert(bauen(0b0000_0010), 'image/webp')).toBe(true);
  });

  it('warnt bei einem grossen Bild, ohne es abzulehnen', () => {
    const befund = pruefeBild(png(512, 512));
    expect(befund.ok).toBe(true);
    // Discord verkleinert auf 128 Pixel - das soll jemand wissen, bevor feine
    // Linien verschwinden. Verhindert wird deswegen nichts.
    expect(befund.hinweis).toBeTruthy();
  });

  it('lehnt ein absurd grosses Bild ab', () => {
    expect(pruefeBild(png(8000, 8000)).ok).toBe(false);
  });

  it('baut die Data-URI, in der Discord ein Bild annimmt', () => {
    const uri = alsDataUri(png(16, 16), 'image/png');
    expect(uri.startsWith('data:image/png;base64,')).toBe(true);
    // Die Bytes müssen ohnehin durch diesen Prozess - genau deshalb kann er
    // sie vorher prüfen.
    expect(Buffer.from(uri.split(',')[1] ?? '', 'base64')).toEqual(Buffer.from(png(16, 16)));
  });

  it('gibt für dieselben Bytes dieselbe Prüfsumme', () => {
    expect(pruefsummeVon(png(64, 64))).toBe(pruefsummeVon(png(64, 64)));
    expect(pruefsummeVon(png(64, 64))).not.toBe(pruefsummeVon(png(65, 64)));
  });
});

describe('Import: nur freigegebene Hosts', () => {
  it('liest die Freigabeliste aus Komma, Semikolon und Zeilen', () => {
    expect(erlaubteHostsAus('cdn.discordapp.com, media.discordapp.net')).toEqual([
      'cdn.discordapp.com',
      'media.discordapp.net',
    ]);
    expect(erlaubteHostsAus('a.example\nb.example;c.example')).toEqual([
      'a.example',
      'b.example',
      'c.example',
    ]);
  });

  it('verzeiht ein vorangestelltes Schema und einen Pfad', () => {
    // Der häufigste Tippfehler, und kein anderer Host.
    expect(erlaubteHostsAus('https://cdn.discordapp.com/attachments')).toEqual(['cdn.discordapp.com']);
  });

  it('ist leer, wenn nichts eingetragen ist - und das heisst «kein Import»', () => {
    expect(erlaubteHostsAus('')).toEqual([]);
    expect(erlaubteHostsAus('  ,  ')).toEqual([]);
  });

  it('erlaubt Unterdomänen eines Eintrags', () => {
    expect(hostErlaubt('media.discordapp.net', ['discordapp.net'])).toBe(true);
    expect(hostErlaubt('discordapp.net', ['discordapp.net'])).toBe(true);
  });

  it('lässt sich nicht von einem angehängten Namen täuschen', () => {
    /*
     * Die Falle: `endsWith('discordapp.net')` allein wäre für
     * `evil-discordapp.net` wahr. Geprüft wird deshalb auf Punktgrenze.
     */
    expect(hostErlaubt('evil-discordapp.net', ['discordapp.net'])).toBe(false);
    expect(hostErlaubt('discordapp.net.angreifer.example', ['discordapp.net'])).toBe(false);
  });

  it('erlaubt nichts, wenn die Liste leer ist', () => {
    expect(hostErlaubt('cdn.discordapp.com', [])).toBe(false);
  });
});

describe('Emoji-Plätze: Discord zählt getrennt', () => {
  it('kennt die Plätze je Boost-Stufe', () => {
    expect(emojiPlaetze(0)).toBe(50);
    expect(emojiPlaetze(1)).toBe(100);
    expect(emojiPlaetze(2)).toBe(150);
    expect(emojiPlaetze(3)).toBe(250);
    // Eine Stufe, die Discord noch nicht hat, fällt auf die höchste bekannte.
    expect(emojiPlaetze(9)).toBe(250);
  });

  function uebersicht(festBelegt: number, animiertBelegt: number, gesamt = 50): PlatzUebersicht {
    return {
      fest: { belegt: festBelegt, gesamt, frei: gesamt - festBelegt, stillgelegt: 0 },
      animiert: { belegt: animiertBelegt, gesamt, frei: gesamt - animiertBelegt, stillgelegt: 0 },
      boostStufe: 0,
    };
  }

  it('lässt ein animiertes Emoji durch, obwohl die festen Plätze voll sind', () => {
    /*
     * Der Kern der getrennten Rechnung. Eine Zahl für beide Arten würde hier
     * ablehnen - und läge falsch.
     */
    const voll = uebersicht(50, 10);
    expect(pruefePlatz(voll, false, 0).ok).toBe(false);
    expect(pruefePlatz(voll, true, 0).ok).toBe(true);
  });

  it('hält die Reserve für das Team frei', () => {
    const knapp = uebersicht(47, 0);
    expect(pruefePlatz(knapp, false, 5).ok).toBe(false);
    // Das Team darf den letzten Platz belegen - das ist eine Entscheidung.
    expect(pruefePlatz(knapp, false, 5, { mitReserve: false }).ok).toBe(true);
  });

  it('unterscheidet «voll» von «nur noch Reserve»', () => {
    // Zwei verschiedene Lagen brauchen zwei verschiedene Sätze: einmal muss
    // etwas weichen, einmal entscheidet das Team.
    expect(pruefePlatz(uebersicht(50, 0), false, 5).grund).toMatch(/belegt/u);
    expect(pruefePlatz(uebersicht(47, 0), false, 5).grund).toMatch(/reserviert/u);
  });

  it('zählt stillgelegte Emojis als belegt', () => {
    /*
     * Ein Server, der eine Boost-Stufe verliert, behält seine Emojis - Discord
     * stellt die überzähligen still. Sie belegen trotzdem einen Platz. Wer sie
     * als frei rechnet, bekommt einen Upload, der an Discord scheitert.
     */
    const stand: PlatzUebersicht = {
      fest: { belegt: 50, gesamt: 50, frei: 0, stillgelegt: 20 },
      animiert: { belegt: 0, gesamt: 50, frei: 50, stillgelegt: 0 },
      boostStufe: 0,
    };
    expect(pruefePlatz(stand, false, 0).ok).toBe(false);
  });
});
