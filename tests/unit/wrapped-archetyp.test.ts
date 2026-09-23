import { describe, expect, it } from 'vitest';
import { ARCHETYPEN, bestimmeArchetyp, nachtanteil } from '@swisshub/modules/wrapped/archetyp';
import { WRAPPED_PERSONAS } from '@swisshub/modules/wrapped/fixtures';
import type { WrappedDaten } from '@swisshub/modules/wrapped/daten';

/**
 * Der Typ ist eine Rechnung, keine Meinung.
 *
 * ## Warum das geprueft wird
 *
 * Weil das Etikett das ist, was am Ende auf der Share Card steht und
 * weitergeschickt wird. Es muss drei Dinge koennen:
 *
 *   - **wiederholbar sein** - dieselben Daten, derselbe Typ, immer
 *   - **unterscheiden** - ein Chat-Mensch bekommt nicht denselben Typ wie
 *     jemand, der 600 Stunden im Sprachkanal sass
 *   - **eindeutig sein** - auch wenn zwei Werte gleich sind
 *
 * ## Was diese Datei gefunden hat
 *
 * Die erste Fassung deckelte jeden Punktwert bei 1. Eine in vier Bereichen
 * aktive Person erreichte damit viermal die Hoechstpunktzahl, und bei vier
 * exakt gleichen Werten entschied allein die Reihenfolge der Liste - der
 * Allrounder-Testfall bekam «The Clip Machine». Der Deckel ist weg; die
 * Daempfung ueber die Wurzel bleibt.
 */
const jahr = 2026;
const persona = (key: string): WrappedDaten => {
  const eintrag = WRAPPED_PERSONAS.find((kandidat) => kandidat.key === key);
  if (!eintrag) {
    throw new Error(`Persona ${key} fehlt`);
  }
  return eintrag.bauen(jahr);
};

describe('Archetyp', () => {
  describe('trifft bei den Testpersonen das Erwartete', () => {
    it.each([
      ['allrounder', 'allrounder'],
      ['chat', 'chatter'],
      ['competitive', 'competitor'],
      ['minimal', 'regular'],
    ])('%s → %s', (personaKey, erwartet) => {
      expect(bestimmeArchetyp(persona(personaKey)).key).toBe(erwartet);
    });

    it('macht aus viel Sprachzeit einen Voice- oder Nachttyp', () => {
      /*
       * Bewusst zwei zugelassene Antworten.
       *
       * Die Voice-Testperson hat 612 Stunden mit Schwerpunkt um 23 Uhr -
       * beide Etiketten sind dafuer richtig, und welches gewinnt, haengt an
       * einer Schwelle, die sich aendern darf. Was **nicht** passieren darf,
       * ist ein Chat- oder Wettkampftyp.
       */
      expect(['voice_resident', 'night_owl']).toContain(bestimmeArchetyp(persona('voice')).key);
    });
  });

  it('gibt bei denselben Daten immer denselben Typ', () => {
    const daten = persona('allrounder');
    const laeufe = Array.from({ length: 20 }, () => bestimmeArchetyp(daten).key);
    expect(new Set(laeufe).size).toBe(1);
  });

  it('legt die Punktwerte offen', () => {
    // Wer wissen will, warum er diesen Typ hat, soll eine Antwort bekommen.
    const ergebnis = bestimmeArchetyp(persona('allrounder'));
    for (const typ of ARCHETYPEN) {
      expect(ergebnis.scores[typ.key]).toBeTypeOf('number');
    }
  });

  it('entscheidet einen echten Gleichstand nach fester Reihenfolge', () => {
    /*
     * Ohne jede Aktivitaet sind alle Punktwerte null. Das ist der einzige
     * Fall, in dem die Reihenfolge der Liste entscheidet - und sie muss
     * entscheiden, sonst waere das Ergebnis zufaellig.
     */
    const leer = leerePerson();
    const laeufe = Array.from({ length: 10 }, () => bestimmeArchetyp(leer).key);
    expect(new Set(laeufe).size).toBe(1);
    expect(laeufe[0]).toBe('voice_resident');
  });

  describe('Nachtanteil', () => {
    it('ist null ohne Sprachzeit', () => {
      expect(nachtanteil(new Array<number>(24).fill(0))).toBe(0);
    });

    it('zählt 22 bis 04 Uhr als Nacht', () => {
      const stunden = new Array<number>(24).fill(0);
      stunden[23] = 100;
      stunden[12] = 100;
      expect(nachtanteil(stunden)).toBeCloseTo(0.5, 5);
    });

    it('macht aus wenigen Nachtstunden keinen Nachttyp', () => {
      /*
       * Zweimal im Jahr um drei Uhr eine halbe Stunde: der Nachtanteil ist
       * 1, die Sprachzeit lächerlich. Die Schranke verhindert, dass daraus
       * «The Night Owl» wird.
       */
      const daten = leerePerson();
      const stunden = new Array<number>(24).fill(0);
      stunden[3] = 3600;
      daten.voice = { ...daten.voice, seconds: 3600, hours: stunden };
      expect(bestimmeArchetyp(daten).key).not.toBe('night_owl');
    });

    it('macht aus vielen Nachtstunden einen Nachttyp', () => {
      const daten = leerePerson();
      const stunden = new Array<number>(24).fill(0);
      // 120 Stunden, fast alles zwischen 23 und 03 Uhr.
      for (const stunde of [23, 0, 1, 2]) {
        stunden[stunde] = 27 * 3600;
      }
      stunden[20] = 12 * 3600;
      daten.voice = { ...daten.voice, seconds: 120 * 3600, hours: stunden };
      expect(bestimmeArchetyp(daten).key).toBe('night_owl');
    });
  });

  it('bevorzugt Breite vor einer einzelnen Spitze', () => {
    /*
     * Der Kern des Allrounders. Drei Bereiche knapp unter der Schwelle
     * schlagen einen Bereich deutlich darüber - das ist die Aussage des
     * Typs, und sie muss in der Rechnung stehen, nicht nur im Namen.
     */
    const breit = leerePerson();
    breit.voice = { ...breit.voice, seconds: 200 * 3600, hours: gleichmaessig(200 * 3600) };
    breit.messages = { ...breit.messages, total: 2600 };
    breit.wettkampf = { ...breit.wettkampf, tournamentsPlayed: 4, eventsAttended: 3 };
    breit.clips = { ...breit.clips, approved: 6, wins: 1 };

    expect(bestimmeArchetyp(breit).key).toBe('allrounder');

    const schmal = leerePerson();
    schmal.messages = { ...schmal.messages, total: 12000 };
    expect(bestimmeArchetyp(schmal).key).toBe('chatter');
  });
});

function gleichmaessig(gesamt: number): number[] {
  return new Array<number>(24).fill(Math.round(gesamt / 24));
}

/** Eine Person ganz ohne Aktivitaet - die Grundlage der Grenzfaelle. */
function leerePerson(): WrappedDaten {
  const quelle = { lage: 'vollstaendig' as const, seit: null, abdeckung: 1 };
  return {
    version: 1,
    person: {
      discordId: '900000000000000001',
      username: 'leer',
      displayName: 'Leer',
      avatarHash: null,
      joinedAt: null,
      imZeitraumBeigetreten: false,
    },
    period: { start: `${jahr}-01-01T00:00:00.000Z`, end: `${jahr + 1}-01-01T00:00:00.000Z`, year: jahr },
    voice: {
      seconds: 0,
      sessions: 0,
      longestSessionSeconds: 0,
      longestSessionAt: null,
      topChannels: [],
      mates: [],
      hours: new Array<number>(24).fill(0),
    },
    messages: { total: 0, daysWithMessages: 0, bestDay: null },
    level: null,
    clips: { submitted: 0, approved: 0, wins: 0, votesReceived: 0, best: null },
    wettkampf: {
      tournamentsPlayed: 0,
      tournamentWins: 0,
      bestPlacement: null,
      eventsAttended: 0,
      eventTitles: [],
      tournamentTitles: [],
    },
    spiele: { top: [], quelle: 'spielersuche' },
    aktivitaet: {
      activeDays: 0,
      longestStreak: 0,
      bestMonth: null,
      daysPerMonth: new Array<number>(12).fill(0),
    },
    highlight: null,
    archetyp: { key: 'regular', scores: {} },
    quellen: {
      voice: quelle,
      messages: quelle,
      level: quelle,
      clips: quelle,
      events: quelle,
      tournaments: quelle,
      games: quelle,
    },
  };
}
