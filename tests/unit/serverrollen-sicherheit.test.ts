import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DISCORD_PERMISSIONS } from '@swisshub/discord';
import {
  KRITISCHE_RECHTE,
  kritischeRechteVon,
  pruefeSelbstzuweisung,
} from '../../packages/modules/src/serverrollen/sicherheit';
import { rollenFarbe } from '../../packages/modules/src/serverrollen/dienst';

/**
 * Der Safety Guard der Selbstvergabe.
 *
 * ## Der Fall, um den es geht
 *
 * Kein Angriff, sondern ein Versehen. Eine Rolle heisst «Content», trägt aber
 * seit einem Umbau «Mitglieder kicken». Jemand im Team hakt sie zur
 * Selbstvergabe an - und hat damit die Moderation zur Selbstbedienung gemacht.
 * Auffallen würde es erst, wenn es jemand nutzt.
 *
 * Deshalb steht hier nicht «der Haken wird respektiert», sondern das Gegenteil:
 * **auch mit** Haken bleibt eine Rolle mit kritischen Rechten gesperrt. Das ist
 * die eine Zusicherung, die diese Datei festnagelt.
 */

/** Die Rechte-Bits als String, wie Discord sie im Zwischenspeicher ablegt. */
function rechte(...namen: Array<keyof typeof DISCORD_PERMISSIONS>): string {
  return namen.reduce((bits, name) => bits | DISCORD_PERMISSIONS[name], 0n).toString();
}

/** Eine harmlose Rolle, die unterhalb der Bot-Rolle liegt. */
const HARMLOS = { permissions: rechte('VIEW_CHANNEL', 'SEND_MESSAGES'), managed: false, position: 5 };
const BOT_POSITION = 20;

describe('Safety Guard: kritische Rechte schlagen den Haken', () => {
  it.each([...KRITISCHE_RECHTE])('sperrt eine Rolle mit %s, obwohl sie freigegeben ist', (recht) => {
    const urteil = pruefeSelbstzuweisung({
      rolle: { ...HARMLOS, permissions: rechte(recht) },
      // Der Haken ist gesetzt. Genau das ist der gefährliche Fall.
      selfAssignable: true,
      botPosition: BOT_POSITION,
    });

    expect(urteil.erlaubt).toBe(false);
    expect(urteil.grund).toBe('kritische_rechte');
    expect(urteil.gefundeneRechte).toContain(recht);
    // Und ein Satz dazu: ein «geht nicht» ohne Grund zwingt zum Rätselraten.
    expect(urteil.text).toBeTruthy();
  });

  it('deckt genau die sechs Rechte aus der Anforderung ab', () => {
    /*
     * Eine längere Liste wäre eine eigene Meinung darüber, was «gefährlich»
     * ist; eine kürzere wäre eine Lücke. Diese sechs sind gesetzt - wer sie
     * bekommt, kann den Server umbauen oder Leute entfernen.
     */
    expect([...KRITISCHE_RECHTE].sort()).toEqual(
      [
        'ADMINISTRATOR',
        'BAN_MEMBERS',
        'KICK_MEMBERS',
        'MANAGE_CHANNELS',
        'MANAGE_GUILD',
        'MANAGE_ROLES',
      ].sort(),
    );
  });

  it('erkennt Administrator am von Discord dokumentierten Bit', () => {
    // Die Zahl steht in Discords Dokumentation. Ein vertippter Bitwert wäre
    // ein Guard, der nie zuschlägt - und das fiele sonst niemandem auf.
    expect(DISCORD_PERMISSIONS.ADMINISTRATOR).toBe(8n);
    expect(kritischeRechteVon('8')).toEqual(['ADMINISTRATOR']);
  });

  it('löst Administrator nicht in alle Rechte auf', () => {
    // «Administrator» ist die klarere Auskunft als sechs Zeilen, die alle aus
    // derselben Quelle stammen.
    expect(kritischeRechteVon(rechte('ADMINISTRATOR'))).toEqual(['ADMINISTRATOR']);
  });

  it('behandelt einen unlesbaren Rechte-Wert wie Administrator', () => {
    /*
     * Die Spalte kommt aus einem Zwischenspeicher und ist älter als der Code.
     * Die andere Richtung wäre eine Rolle, die sich durch einen kaputten Wert
     * freikauft.
     */
    for (const kaputt of ['keine Zahl', '', '   ', '-8', '0x8', '8n']) {
      expect(kritischeRechteVon(kaputt), `«${kaputt}»`).toEqual(['ADMINISTRATOR']);
      expect(
        pruefeSelbstzuweisung({
          rolle: { ...HARMLOS, permissions: kaputt },
          selfAssignable: true,
          botPosition: BOT_POSITION,
        }).erlaubt,
        `«${kaputt}»`,
      ).toBe(false);
    }

    // Die Gegenprobe: eine echte Null heisst «keine Rechte» und ist erlaubt.
    expect(kritischeRechteVon('0')).toEqual([]);
  });

  it('nennt alle gefundenen kritischen Rechte, nicht nur das erste', () => {
    // Das Dashboard zeigt sie; «eins davon» wäre eine halbe Antwort.
    const urteil = pruefeSelbstzuweisung({
      rolle: { ...HARMLOS, permissions: rechte('BAN_MEMBERS', 'KICK_MEMBERS') },
      selfAssignable: true,
      botPosition: BOT_POSITION,
    });
    expect(urteil.gefundeneRechte).toEqual(expect.arrayContaining(['BAN_MEMBERS', 'KICK_MEMBERS']));
  });
});

describe('Safety Guard: was Discord ohnehin ablehnen würde', () => {
  it('sperrt eine von Discord verwaltete Rolle', () => {
    const urteil = pruefeSelbstzuweisung({
      rolle: { ...HARMLOS, managed: true },
      selfAssignable: true,
      botPosition: BOT_POSITION,
    });
    expect(urteil.erlaubt).toBe(false);
    expect(urteil.grund).toBe('von_discord_verwaltet');
  });

  it('sperrt eine Rolle auf oder über der Bot-Rolle', () => {
    for (const position of [BOT_POSITION, BOT_POSITION + 1]) {
      const urteil = pruefeSelbstzuweisung({
        rolle: { ...HARMLOS, position },
        selfAssignable: true,
        botPosition: BOT_POSITION,
      });
      expect(urteil.erlaubt, `Position ${position}`).toBe(false);
      expect(urteil.grund).toBe('ueber_der_bot_rolle');
    }
  });

  it('sperrt alles, wenn die Bot-Position unbekannt ist', () => {
    /*
     * Discord antwortet nicht, der Bot ist nicht auf dem Server - eine
     * Hierarchie, die niemand kennt, ist kein Freibrief. Die andere Richtung
     * wäre ein Ausfall, der die Selbstvergabe öffnet.
     */
    const urteil = pruefeSelbstzuweisung({
      rolle: HARMLOS,
      selfAssignable: true,
      botPosition: null,
    });
    expect(urteil.erlaubt).toBe(false);
    expect(urteil.grund).toBe('ueber_der_bot_rolle');
  });
});

describe('Safety Guard: der Haken und die Voraussetzung', () => {
  it('lässt eine harmlose, freigegebene Rolle durch', () => {
    const urteil = pruefeSelbstzuweisung({
      rolle: HARMLOS,
      selfAssignable: true,
      botPosition: BOT_POSITION,
    });
    expect(urteil).toEqual({ erlaubt: true, grund: null, text: null, gefundeneRechte: [] });
  });

  it('sperrt eine harmlose Rolle ohne Haken', () => {
    const urteil = pruefeSelbstzuweisung({
      rolle: HARMLOS,
      selfAssignable: false,
      botPosition: BOT_POSITION,
    });
    expect(urteil.erlaubt).toBe(false);
    expect(urteil.grund).toBe('nicht_freigegeben');
  });

  it('meldet kritische Rechte auch bei einer Rolle ohne Haken', () => {
    /*
     * Die Reihenfolge der Prüfungen ist Absicht: so sagt das Dashboard schon
     * vorher, dass diese Rolle ohnehin nie freigegeben werden könnte. Sonst
     * setzt jemand den Haken und wundert sich, dass nichts passiert.
     */
    const urteil = pruefeSelbstzuweisung({
      rolle: { ...HARMLOS, permissions: rechte('MANAGE_ROLES') },
      selfAssignable: false,
      botPosition: BOT_POSITION,
    });
    expect(urteil.grund).toBe('kritische_rechte');
  });

  it('verlangt die vorausgesetzte Rolle', () => {
    const eingabe = {
      rolle: HARMLOS,
      selfAssignable: true,
      botPosition: BOT_POSITION,
      voraussetzungRoleId: 'rolle-davor',
    };
    expect(pruefeSelbstzuweisung({ ...eingabe, eigeneRollen: [] }).grund).toBe('voraussetzung_fehlt');
    expect(pruefeSelbstzuweisung({ ...eingabe, eigeneRollen: ['rolle-davor'] }).erlaubt).toBe(true);
  });
});

describe('Rollenfarbe: Discords Null ist keine Farbe', () => {
  it('gibt für 0 keine Farbe heraus', () => {
    /*
     * Discord schreibt `0` für «keine eigene Farbe». Daraus `#000000` zu
     * machen wäre falsch: die Rolle hat keine Farbe, sie ist nicht schwarz -
     * und ein schwarzer Punkt wäre im Dark Mode ohnehin unsichtbar.
     */
    expect(rollenFarbe(0)).toBeNull();
  });

  it('gibt die echte Discord-Farbe als Hex heraus', () => {
    expect(rollenFarbe(0x5865f2)).toBe('#5865f2');
    // Führende Nullen bleiben stehen - sonst wird aus Dunkelblau ein Dreier.
    expect(rollenFarbe(0x0000ff)).toBe('#0000ff');
  });

  it('verträgt Unsinn, ohne eine Farbe zu erfinden', () => {
    expect(rollenFarbe(-1)).toBeNull();
    expect(rollenFarbe(Number.NaN)).toBeNull();
  });
});

/** Block- und Zeilenkommentare entfernen. */
function ohneKommentare(quelle: string): string {
  return quelle.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');
}

function dateienUnter(verzeichnis: string): string[] {
  return readdirSync(verzeichnis).flatMap((name) => {
    const voll = join(verzeichnis, name);
    return statSync(voll).isDirectory() ? dateienUnter(voll) : [voll];
  });
}

const QUELLEN = [
  ...dateienUnter(join(process.cwd(), 'packages/modules/src/serverrollen')),
  ...dateienUnter(join(process.cwd(), 'apps/web/src/modules/serverrollen')),
  ...dateienUnter(join(process.cwd(), 'apps/web/src/app/serverrollen')),
  ...dateienUnter(join(process.cwd(), 'apps/web/src/app/(app)/server/serverrollen')),
];

describe('Serverrollen: keine zweiten Systeme, keine festen Kennungen', () => {
  it('enthält keine hardcodierte Discord-Rollenkennung', () => {
    /*
     * Eine Snowflake im Quelltext ist eine Rolle, die auf genau einem Server
     * existiert - und auf jedem anderen eine stille Fehlfunktion. Welche Rolle
     * was bedeutet, steht in der Datenbank.
     */
    for (const datei of QUELLEN) {
      const treffer = ohneKommentare(readFileSync(datei, 'utf8')).match(/(?<!\w)\d{17,20}(?!\w)/gu) ?? [];
      expect(treffer, `${datei} nennt eine feste Discord-Kennung: ${treffer.join(', ')}`).toEqual([]);
    }
  });

  it('spricht aus dem Browser nie direkt mit Discord', () => {
    /*
     * Eine Client-Komponente, die `discord.roles.add` aufruft, wäre ein
     * Bot-Token im Browser. Alles geht über die Server Action - und die prüft.
     */
    for (const datei of QUELLEN.filter((pfad) => pfad.endsWith('.tsx'))) {
      const quelle = readFileSync(datei, 'utf8');
      if (!quelle.includes("'use client'")) {
        continue;
      }
      expect(quelle, `${datei} ist eine Client-Komponente`).not.toMatch(/@swisshub\/discord/u);
      expect(quelle).not.toMatch(/discord\.(roles|members|guild)\./u);
    }
  });

  it('nimmt die Kennung der handelnden Person aus der Sitzung', () => {
    /*
     * Eine `discordId` aus dem Formular wäre die Lücke, durch die jemand einer
     * anderen Person eine Rolle gibt. Das Schema der Aktion nennt sie deshalb
     * nicht, und der Dienst bekommt sie aus `ctx.user`.
     */
    const aktionen = readFileSync(
      join(process.cwd(), 'apps/web/src/modules/serverrollen/actions.ts'),
      'utf8',
    );
    const rumpf = ohneKommentare(aktionen);
    expect(rumpf).toContain('ctx.user.discordId');
    expect(rumpf).not.toMatch(/discordId:\s*z\./u);
  });

  it('prüft jede Zuweisung beim Zugriff neu und nicht nur beim Haken', () => {
    // Zwischen dem Setzen des Hakens und dem Klick kann sich auf Discord
    // alles geändert haben - deshalb fragt der Dienst erneut.
    const dienst = ohneKommentare(
      readFileSync(join(process.cwd(), 'packages/modules/src/serverrollen/dienst.ts'), 'utf8'),
    );
    expect(dienst).toContain('pruefeSelbstzuweisung');
    // Und der Dienst benutzt den bestehenden Discord-Zugang, keinen eigenen.
    expect(dienst).toContain('discord.roles.add');
    expect(dienst).not.toMatch(/fetch\(/u);
  });
});
