import { describe, expect, it } from 'vitest';
import {
  hatNachricht,
  type WarteEintrag,
} from '../../apps/web/src/modules/verification/components/warteschlange';

/**
 * Der Filter «Nur mit gesendeter Nachricht».
 *
 * Er soll die Warteschlange auf das eindampfen, was jetzt entscheidbar ist.
 * Entscheidbar ist ein Fall erst, wenn etwas zu lesen da ist - und das ist
 * nicht dasselbe wie «hat schon einmal geschrieben».
 */

function fall(teil: Partial<WarteEintrag>): WarteEintrag {
  return {
    id: 'a',
    discordId: '1',
    username: null,
    displayName: null,
    avatarHash: null,
    status: 'WAITING_FOR_REVIEW',
    joinedAt: new Date().toISOString(),
    accountCreatedAt: null,
    latestMessage: null,
    latestMessageId: null,
    messageCount: 0,
    aiVerdict: null,
    aiConfidence: null,
    aiError: null,
    wartetSeit: 0,
    jungesKonto: false,
    ohneAvatar: false,
    ...teil,
  };
}

describe('Verifikations-Warteschlange: Filter', () => {
  it('behaelt, was gelesen werden kann', () => {
    expect(hatNachricht(fall({ latestMessage: 'Hallo, ich spiele CS.' }))).toBe(true);
  });

  it('blendet aus, wer noch gar nichts geschrieben hat', () => {
    expect(hatNachricht(fall({}))).toBe(false);
  });

  it('blendet auch aus, wo nur ein Zaehler steht und kein Text', () => {
    /*
     * `messageCount` zaehlt jede je geschriebene Nachricht, auch eine
     * geloeschte. Haenge der Filter daran, stuende so ein Fall in der
     * gefilterten Liste - und truege darunter «Noch keine Nachricht
     * geschrieben».
     */
    expect(hatNachricht(fall({ messageCount: 3, latestMessage: null }))).toBe(false);
  });

  it('behaelt eine leere Zeile als Nachricht', () => {
    // Eine abgeschickte Leerzeile ist eine Antwort - eine schlechte, aber
    // eine, die das Team sehen und ablehnen koennen muss.
    expect(hatNachricht(fall({ latestMessage: '' }))).toBe(true);
  });
});
