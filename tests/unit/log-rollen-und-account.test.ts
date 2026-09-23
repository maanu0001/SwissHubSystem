import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EVENT_TYPES } from '../../packages/modules/src/analytics/event-types';
import { LOG_KATEGORIEN, kategorie, kategorienFuerEreignis } from '../../packages/modules/src/logs/registry';
import { formatiereEreignis } from '../../packages/modules/src/logs/formatters';
import type { DiscordEvent } from '@swisshub/database';

/**
 * Die Trennung der Log-Kategorien.
 *
 * ## Was sich geändert hat
 *
 * «Mitglieder» hiess so und enthielt dreierlei: Rollen, Spitznamen und - ohne
 * eigenen Kanal - auch Beitritte und Austritte. Drei Vorgänge mit drei
 * verschiedenen Lesern in einem Kanal.
 *
 * Jetzt:
 *
 *   Rollen             → Rollenänderungen, sonst nichts
 *   Accountänderungen  → Benutzername und Profilbild
 *   Beitritte          → wer kommt und wer geht
 *   Spitzname          → wird nicht mehr gemeldet
 *
 * Der interne Schlüssel bleibt `MEMBERS`: er ist der Primärschlüssel der
 * eingerichteten Kanäle. Ihn umzubenennen hiesse, jede bestehende Zuordnung
 * zu verlieren - für einen Namen, den niemand sieht.
 */
const ereignis = (type: string, extras: Partial<DiscordEvent> = {}): DiscordEvent =>
  ({
    id: 'e1',
    guildId: '000000000000000001',
    category: 'MEMBER',
    type,
    severity: 'INFO',
    subjectDiscordId: '100000000000000001',
    subjectUsername: 'manuel',
    occurredAt: new Date(Date.UTC(2026, 8, 23, 14, 42)),
    metadata: null,
    contentBefore: null,
    contentAfter: null,
    channelId: null,
    channelName: null,
    actorDiscordId: null,
    actorUsername: null,
    actorSource: null,
    ...extras,
  }) as unknown as DiscordEvent;

describe('Die Kategorie «Rollen»', () => {
  it('heisst im Dashboard «Rollen»', () => {
    expect(kategorie('MEMBERS').label).toBe('Rollen');
  });

  it('behält den gespeicherten Schlüssel MEMBERS', () => {
    // Der Schlüssel trägt die eingerichteten Kanäle. Ein neuer Schlüssel
    // hiesse: alle Zuordnungen weg.
    expect(LOG_KATEGORIEN.map((eintrag) => eintrag.id)).toContain('MEMBERS');
  });

  it('nimmt eine vergebene Rolle auf', () => {
    expect(kategorienFuerEreignis({ category: 'MEMBER', type: EVENT_TYPES.MEMBER_ROLE_ADD })).toEqual([
      'MEMBERS',
    ]);
  });

  it('nimmt eine entzogene Rolle auf', () => {
    expect(kategorienFuerEreignis({ category: 'MEMBER', type: EVENT_TYPES.MEMBER_ROLE_REMOVE })).toEqual([
      'MEMBERS',
    ]);
  });

  it('meldet einen Spitznamen überhaupt nicht mehr', () => {
    /*
     * Nicht nur im Text verstecken: das Ereignis erzeugt gar keinen Log mehr.
     * Im Verlauf und in der Statistik bleibt es stehen - dort ist es eine
     * Tatsache über den Server, keine Meldung an ein Team.
     */
    expect(kategorienFuerEreignis({ category: 'MEMBER', type: EVENT_TYPES.MEMBER_NICKNAME })).toEqual([]);
  });

  it('nimmt keinen Beitritt und keinen Austritt mehr auf', () => {
    for (const typ of [EVENT_TYPES.MEMBER_JOIN, EVENT_TYPES.MEMBER_LEAVE]) {
      const ziele = kategorienFuerEreignis({ category: 'MEMBER', type: typ });
      expect(ziele, typ).not.toContain('MEMBERS');
      expect(ziele, typ).toEqual(['JOIN_LEAVE']);
    }
  });

  it('meldet einen Rauswurf nicht als Austritt', () => {
    // Die Massnahme steht mit Grund und Handelndem im Moderationskanal.
    expect(
      kategorienFuerEreignis({ category: 'MEMBER', type: EVENT_TYPES.MEMBER_LEAVE, entfernt: 'KICK' }),
    ).toEqual([]);
  });
});

describe('Die Kategorie «Accountänderungen»', () => {
  it('existiert als eigene, einrichtbare Kategorie', () => {
    const eintrag = kategorie('ACCOUNT_CHANGES');
    expect(eintrag.label).toBe('Accountänderungen');
    expect(eintrag.beschreibung.length).toBeGreaterThan(10);
    expect(eintrag.beispiel.length).toBeGreaterThan(5);
  });

  it('nimmt eine Kontoänderung auf - und nur diese Kategorie', () => {
    expect(kategorienFuerEreignis({ category: 'MEMBER', type: EVENT_TYPES.MEMBER_ACCOUNT_UPDATE })).toEqual([
      'ACCOUNT_CHANGES',
    ]);
  });

  it('nennt den alten und den neuen Benutzernamen', () => {
    const embed = formatiereEreignis(
      ereignis(EVENT_TYPES.MEMBER_ACCOUNT_UPDATE, {
        metadata: { username: { von: 'alterName', nach: 'neuerName' } } as never,
      }),
    );

    const namensfeld = embed.fields?.find((f) => f.name === 'Benutzername');
    expect(namensfeld?.value).toContain('alterName');
    expect(namensfeld?.value).toContain('neuerName');
  });

  it('stellt das Mitglied als Erwähnung dar', () => {
    const embed = formatiereEreignis(
      ereignis(EVENT_TYPES.MEMBER_ACCOUNT_UPDATE, {
        metadata: { username: { von: 'a', nach: 'b' } } as never,
      }),
    );

    expect(embed.fields?.find((f) => f.name === 'Mitglied')?.value).toContain('<@100000000000000001>');
  });

  it('zeigt das neue Profilbild gross im Eintrag', () => {
    /*
     * Der Kern der Anforderung. Eine Zeile «https://cdn.discordapp.com/…»
     * beantwortet die Frage «wie sieht es aus» nicht - man müsste sie
     * anklicken.
     */
    const embed = formatiereEreignis(
      ereignis(EVENT_TYPES.MEMBER_ACCOUNT_UPDATE, {
        metadata: {
          avatar: { von: null, nach: 'abc123' },
          avatarUrl: 'https://cdn.discordapp.com/avatars/100000000000000001/abc123.png?size=512',
        } as never,
      }),
    );

    expect(embed.image?.url).toBe(
      'https://cdn.discordapp.com/avatars/100000000000000001/abc123.png?size=512',
    );
  });

  it('fasst Name und Bild in einem Eintrag zusammen', () => {
    // Wer beides zugleich wechselt, hat eine Sache getan.
    const embed = formatiereEreignis(
      ereignis(EVENT_TYPES.MEMBER_ACCOUNT_UPDATE, {
        metadata: {
          username: { von: 'alt', nach: 'neu' },
          avatar: { von: 'x', nach: 'y' },
          avatarUrl: 'https://cdn.discordapp.com/avatars/1/y.png?size=512',
        } as never,
      }),
    );

    expect(embed.fields?.some((f) => f.name === 'Benutzername')).toBe(true);
    expect(embed.fields?.some((f) => f.name === 'Profilbild')).toBe(true);
    expect(embed.image?.url).toContain('y.png');
  });

  it('erfindet keine Bildadresse', () => {
    // Ohne belegte Adresse kein Bild - lieber kein Bild als ein kaputtes.
    const embed = formatiereEreignis(
      ereignis(EVENT_TYPES.MEMBER_ACCOUNT_UPDATE, {
        metadata: { avatar: { von: 'x', nach: 'y' } } as never,
      }),
    );
    expect(embed.image).toBeUndefined();
  });

  it('nimmt keine Adresse an, die nicht von Discord kommen kann', () => {
    const embed = formatiereEreignis(
      ereignis(EVENT_TYPES.MEMBER_ACCOUNT_UPDATE, {
        metadata: {
          avatar: { von: 'x', nach: 'y' },
          avatarUrl: 'javascript:alert(1)',
        } as never,
      }),
    );
    expect(embed.image).toBeUndefined();
  });
});

describe('Der Bot hört auf das richtige Ereignis', () => {
  const quelle = readFileSync(join(process.cwd(), 'apps/bot/src/analytics-events.ts'), 'utf8');

  it('nutzt userUpdate für Kontoänderungen', () => {
    // Ein Benutzername gilt überall, ein Spitzname auf einem Server. Aus
    // `guildMemberUpdate` lässt sich eine Kontoänderung nicht ableiten.
    expect(quelle).toContain('client.on(Events.UserUpdate');
  });

  it('meldet nichts, wenn sich weder Name noch Bild geändert haben', () => {
    expect(quelle).toContain('if (!nameGeaendert && !bildGeaendert)');
  });

  it('behauptet nichts über einen unvollständig bekannten Vorzustand', () => {
    expect(quelle).toContain('if (alt.partial)');
  });

  it('lässt discord.js die Bildadresse bauen', () => {
    // Eigene und Standardbilder folgen verschiedenen Regeln.
    expect(quelle).toContain('displayAvatarURL(');
  });
});
