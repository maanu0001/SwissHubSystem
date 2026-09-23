import { describe, expect, it } from 'vitest';
import { logs, analytics } from '@swisshub/modules';
import type { DiscordEvent } from '@swisshub/database';

/**
 * Beitritte und Austritte als eigene Log-Kategorie.
 *
 * Zwei Zusagen tragen das hier, und beide sind Zusagen darueber, was **nicht**
 * passiert:
 *
 * 1. **Nichts verschwindet beim Update.** Wer heute «Mitglieder» eingerichtet
 *    hat, sieht Beitritte weiterhin dort - auch ohne von der neuen Kategorie
 *    zu wissen. Ein Log, das nach einem Update aufhoert, sieht aus wie ein
 *    Server, auf dem niemand mehr beitritt.
 * 2. **Nichts steht zweimal da.** Wer beide Kanaele einrichtet, bekommt den
 *    Beitritt trotzdem nur einmal - und ein Rauswurf erscheint im Kanal fuer
 *    Beitritte gar nicht, weil er dort eine falsche Aussage waere.
 */

const JETZT = new Date('2026-09-09T14:00:00.000Z');

function ereignis(teile: Partial<DiscordEvent> = {}): DiscordEvent {
  return {
    id: 'ev-beitritt',
    guildId: '900000000000000009',
    category: 'MEMBER',
    type: analytics.EVENT_TYPES.MEMBER_JOIN,
    severity: 'INFO',
    actorDiscordId: null,
    actorUsername: null,
    actorSource: 'UNKNOWN',
    subjectDiscordId: '200000000000000002',
    subjectUsername: 'neuling',
    channelId: null,
    channelName: null,
    messageId: null,
    contentBefore: null,
    contentAfter: null,
    moderationActionId: null,
    bulkId: null,
    metadata: {},
    occurredAt: JETZT,
    createdAt: JETZT,
    ...teile,
  } as DiscordEvent;
}

const alsText = (embed: unknown): string => JSON.stringify(embed);

/**
 * Beitritte gehen in ihren eigenen Kanal - und nur dorthin.
 *
 * Hier stand ein Rückfall auf MEMBERS, damit Beitritte beim Update nicht aus
 * dem Kanal verschwinden, in dem sie bisher standen. Die Sorge war berechtigt,
 * die Lösung ist es nicht mehr: seit MEMBERS «Rollen» heisst und
 * ausschliesslich Rollenänderungen trägt, wäre ein Beitritt dort falsch
 * einsortiert.
 *
 * Verloren geht trotzdem nichts - die Migration übernimmt den bisherigen
 * Mitglieder-Kanal für JOIN_LEAVE, wo dort noch keiner eingerichtet war.
 */
describe('Der eigene Kanal für Beitritte', () => {
  it('nennt für einen Beitritt ausschliesslich JOIN_LEAVE', () => {
    expect(
      logs.kategorienFuerEreignis({
        category: 'MEMBER',
        type: analytics.EVENT_TYPES.MEMBER_JOIN,
      }),
    ).toEqual(['JOIN_LEAVE']);
  });

  it('nennt für einen freiwilligen Austritt ebenfalls nur JOIN_LEAVE', () => {
    expect(
      logs.kategorienFuerEreignis({
        category: 'MEMBER',
        type: analytics.EVENT_TYPES.MEMBER_LEAVE,
        entfernt: null,
      }),
    ).toEqual(['JOIN_LEAVE']);
  });

  it('hält einen Kick aus dem Beitrittskanal heraus', () => {
    /*
     * Er steht mit Grund und Handelndem im Moderationskanal. «Hat den Server
     * verlassen» wäre daneben eine zweite, falsche Aussage.
     *
     * Früher blieb er unter «Mitglieder» stehen - dort war er eine
     * Mitgliederbewegung. Unter «Rollen» ist er das nicht mehr, also gar
     * nicht: einmal gemeldet genügt.
     */
    expect(
      logs.kategorienFuerEreignis({
        category: 'MEMBER',
        type: analytics.EVENT_TYPES.MEMBER_LEAVE,
        entfernt: 'KICK',
      }),
    ).toEqual([]);
  });

  it('hält einen Bann ebenso heraus', () => {
    expect(
      logs.kategorienFuerEreignis({
        category: 'MEMBER',
        type: analytics.EVENT_TYPES.MEMBER_LEAVE,
        entfernt: 'BAN',
      }),
    ).toEqual([]);
  });

  it('meldet einen Rauswurf genau einmal', () => {
    /*
     * Früher stand er zusätzlich unter «Mitglieder» - dort war ein Austritt
     * auch dann eine Mitgliederbewegung, wenn er ein Kick war. Seit die
     * Kategorie «Rollen» heisst, trägt sie das nicht mehr, und der
     * Moderationskanal hat ihn ohnehin: mit Grund und Handelndem.
     */
    const kategorien = logs.kategorienFuerEreignis({
      category: 'MEMBER',
      type: analytics.EVENT_TYPES.MEMBER_LEAVE,
      entfernt: 'KICK',
    });

    expect(kategorien).not.toContain('MEMBERS');
    expect(kategorien).toEqual([]);
  });

  it('kennt die Kategorie mit Beschreibung und Beispiel', () => {
    const definition = logs.kategorie('JOIN_LEAVE');

    expect(definition.label).toBeTruthy();
    expect(definition.beschreibung).toBeTruthy();
    expect(definition.beispiel).toBeTruthy();
  });
});

describe('Die Einladung im Beitritts-Embed', () => {
  it('nennt Code, Nutzung und Ersteller einer belegten Zuordnung', () => {
    const embed = logs.formatiereEreignis(
      ereignis({
        metadata: {
          einladungsArt: 'EINDEUTIG',
          einladungsCode: 'swisshub',
          einladungVon: '100000000000000001',
          einladungVonName: 'munoha',
          einladungsNutzungen: 7,
        },
      }),
    );
    const text = alsText(embed);

    expect(text).toContain('swisshub');
    expect(text).toContain('7. Nutzung');
    expect(text).toContain('munoha');
  });

  it('nennt bei einer eindeutigen Zuordnung keinen Hinweis', () => {
    // Der Normalfall braucht keine Einschränkung. Ein Hinweis an jedem
    // Beitritt läse sich, als wäre jede Angabe unsicher.
    const embed = logs.formatiereEreignis(
      ereignis({
        metadata: {
          einladungsArt: 'EINDEUTIG',
          einladungsCode: 'swisshub',
          einladungVon: '100000000000000001',
          einladungVonName: 'munoha',
          einladungsNutzungen: 7,
        },
      }),
    );

    expect(alsText(embed)).not.toContain('Hinweis');
  });

  it('schreibt die Unschärfe dazu, wenn mehrere Nutzungen dazwischenlagen', () => {
    const embed = logs.formatiereEreignis(
      ereignis({
        metadata: {
          einladungsArt: 'MEHRERE_NUTZUNGEN',
          einladungsCode: 'swisshub',
          einladungVon: '100000000000000001',
          einladungVonName: 'munoha',
          einladungsNutzungen: 9,
        },
      }),
    );
    const text = alsText(embed);

    expect(text).toContain('swisshub');
    expect(text).toContain('mehrere Nutzungen');
  });

  it('nennt keinen Code, wenn die Zuordnung mehrdeutig war', () => {
    // Der eigentliche Punkt: hier wird nicht geraten. Ein falsch genannter
    // Einladender ist eine Behauptung über einen Menschen.
    const embed = logs.formatiereEreignis(ereignis({ metadata: { einladungsArt: 'MEHRDEUTIG' } }));
    const text = alsText(embed);

    expect(text).toContain('nicht eindeutig');
    expect(text).not.toContain('einladungsCode');
  });

  it('sagt bei fehlendem Recht, woran es liegt', () => {
    // «Unbekannt» ohne Begründung liest sich wie ein Fehler. Hier steht, was
    // zu tun ist.
    const embed = logs.formatiereEreignis(ereignis({ metadata: { einladungsArt: 'KEIN_ZUGRIFF' } }));

    expect(alsText(embed)).toContain('Server verwalten');
  });

  it('lässt das Feld bei Ereignissen aus der Zeit davor ganz weg', () => {
    // Damals wurde gar nicht nachgesehen. «Unbekannt» wäre eine Aussage über
    // etwas, das nie versucht wurde.
    const embed = logs.formatiereEreignis(ereignis({ metadata: {} }));

    expect(alsText(embed)).not.toContain('Einladung');
  });

  it('erfindet zu einem unbekannten Zuordnungswert keinen Text', () => {
    const embed = logs.formatiereEreignis(ereignis({ metadata: { einladungsArt: 'IRGENDWAS' } }));

    expect(alsText(embed)).not.toContain('Einladung');
  });

  it('nennt keinen Einladenden, wenn Discord ihn nicht mitgegeben hat', () => {
    const embed = logs.formatiereEreignis(
      ereignis({
        metadata: {
          einladungsArt: 'EINDEUTIG',
          einladungsCode: 'swisshub',
          einladungVon: null,
          einladungVonName: null,
          einladungsNutzungen: 2,
        },
      }),
    );
    const text = alsText(embed);

    expect(text).toContain('swisshub');
    expect(text).not.toContain('Eingeladen von');
  });

  it('hängt einem Austritt keine Einladung an', () => {
    const embed = logs.formatiereEreignis(
      ereignis({
        type: analytics.EVENT_TYPES.MEMBER_LEAVE,
        metadata: { einladungsArt: 'EINDEUTIG', einladungsCode: 'swisshub' },
      }),
    );

    expect(alsText(embed)).not.toContain('swisshub');
  });
});
