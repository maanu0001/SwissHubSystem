import { describe, expect, it } from 'vitest';
import {
  WRAPPED_SZENEN,
  baueGeschichte,
  pruefeAbdeckung,
  type SzenenEinstellung,
} from '@swisshub/modules/wrapped/szenen';
import { WRAPPED_PERSONAS, ueberschreibe } from '@swisshub/modules/wrapped/fixtures';
import { PLATZHALTER, fuelleVorlage, pruefeVorlage } from '@swisshub/modules/wrapped/vorlage';
import type { WrappedDaten, WrappedQuellen } from '@swisshub/modules/wrapped/daten';

/**
 * Welche Szenen jemand bekommt - und welche nicht.
 *
 * ## Die eine Regel, die über allem steht
 *
 * **Keine Szene mit einer Null.** Ein Rückblick, der jemandem «0 Stunden im
 * Voice» entgegenhält, ist keine Feier, sondern eine Quittung. Wer für eine
 * Szene keine Daten hat, bekommt die Szene nicht - und wenn danach zu wenig
 * übrig bleibt, gar keinen Rückblick.
 *
 * ## Die zweite: nichts erfinden
 *
 * Fehlt eine Quelle für den ganzen Server, entfällt die Szene für alle -
 * auch dann, wenn bei einer einzelnen Person noch eine alte Zeile
 * herumliegt. Sonst zeigte ein Server ohne Clip-Modul eine Clip-Szene.
 */
const jahr = 2026;

const VOLL = { lage: 'vollstaendig' as const, seit: null, abdeckung: 1 };
const alleQuellen: WrappedQuellen = {
  voice: VOLL,
  messages: VOLL,
  level: VOLL,
  clips: VOLL,
  events: VOLL,
  tournaments: VOLL,
  games: VOLL,
};

const standard: SzenenEinstellung[] = WRAPPED_SZENEN.map((szene) => ({
  sceneKey: szene.key,
  enabled: szene.standardAktiv,
  position: szene.position,
}));

const persona = (key: string): WrappedDaten => {
  const eintrag = WRAPPED_PERSONAS.find((kandidat) => kandidat.key === key);
  if (!eintrag) {
    throw new Error(`Persona ${key} fehlt`);
  }
  return eintrag.bauen(jahr);
};

describe('Szenenauswahl', () => {
  it('zeigt der aktivsten Testperson alle Kapitel', () => {
    expect(baueGeschichte(persona('allrounder'), standard)).toHaveLength(WRAPPED_SZENEN.length);
  });

  it('lässt bei einer ruhigen Person das meiste weg', () => {
    const wenig = baueGeschichte(persona('minimal'), standard);
    expect(wenig.length).toBeLessThan(WRAPPED_SZENEN.length);
    expect(wenig).toContain('intro');
    expect(wenig).toContain('finale');
  });

  it('zeigt keine Szene, deren Zahl null wäre', () => {
    /*
     * Der Kern der Regel. Geprüft wird nicht «die Szene fehlt», sondern
     * «für jede gezeigte Szene gibt es auch etwas zu zeigen» - Szene für
     * Szene, Persona für Persona.
     */
    const pruefer: Record<string, (daten: WrappedDaten) => number> = {
      voice_total: (daten) => daten.voice.seconds,
      voice_channel: (daten) => daten.voice.topChannels[0]?.seconds ?? 0,
      voice_mates: (daten) => daten.voice.mates.length,
      messages: (daten) => daten.messages.total,
      prime_time: (daten) => Math.max(0, ...daten.voice.hours),
      games: (daten) => daten.spiele.top.length,
      level: (daten) => daten.level?.xpGained ?? 0,
      clips: (daten) => (daten.clips.best ? 1 : 0),
      events: (daten) => daten.wettkampf.tournamentsPlayed + daten.wettkampf.eventsAttended,
      active_days: (daten) => daten.aktivitaet.activeDays,
      highlight: (daten) => (daten.highlight ? 1 : 0),
    };

    for (const eintrag of WRAPPED_PERSONAS) {
      const daten = eintrag.bauen(jahr);
      for (const key of baueGeschichte(daten, standard)) {
        const wert = pruefer[key]?.(daten);
        if (wert !== undefined) {
          expect(wert, `${eintrag.key} / ${key}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('lässt eine Szene weg, deren Quelle dem ganzen Server fehlt', () => {
    const daten = persona('allrounder');
    const ohneClips: WrappedDaten = {
      ...daten,
      quellen: { ...alleQuellen, clips: { lage: 'fehlt', seit: null, abdeckung: 0 } },
    };
    expect(baueGeschichte(daten, standard)).toContain('clips');
    expect(baueGeschichte(ohneClips, standard)).not.toContain('clips');
  });

  it('folgt der eingestellten Reihenfolge', () => {
    const umgedreht = standard.map((zeile, index) => ({ ...zeile, position: standard.length - index }));
    const vorwaerts = baueGeschichte(persona('allrounder'), standard);
    const rueckwaerts = baueGeschichte(persona('allrounder'), umgedreht);
    expect(rueckwaerts).toEqual([...vorwaerts].reverse());
  });

  it('lässt eine ausgeschaltete Szene weg', () => {
    const ohneMates = standard.map((zeile) =>
      zeile.sceneKey === 'voice_mates' ? { ...zeile, enabled: false } : zeile,
    );
    expect(baueGeschichte(persona('allrounder'), ohneMates)).not.toContain('voice_mates');
  });

  it('nimmt eine neue Szene auch ohne gespeicherte Einstellung auf', () => {
    /*
     * Eine Kampagne aus dem letzten Jahr kennt eine später hinzugekommene
     * Szene nicht. Sie soll trotzdem erscheinen - sonst müsste jede
     * bestehende Kampagne von Hand nachgezogen werden.
     */
    const luecke = standard.filter((zeile) => zeile.sceneKey !== 'prime_time');
    expect(baueGeschichte(persona('allrounder'), luecke)).toContain('prime_time');
  });

  describe('Abdeckungsmatrix', () => {
    it('unterscheidet «ausgeschaltet» von «keine Daten»', () => {
      const ohneMates = standard.map((zeile) =>
        zeile.sceneKey === 'voice_mates' ? { ...zeile, enabled: false } : zeile,
      );
      const befunde = new Map(
        pruefeAbdeckung(persona('minimal'), ohneMates).map((eintrag) => [eintrag.szene.key, eintrag.befund]),
      );
      expect(befunde.get('voice_mates')).toBe('ausgeschaltet');
      expect(befunde.get('clips')).toBe('zu-wenig-daten');
      expect(befunde.get('intro')).toBe('aktiv');
    });

    it('nennt eine fehlende Quelle beim Namen', () => {
      const daten = persona('allrounder');
      const ohneClips: WrappedDaten = {
        ...daten,
        quellen: { ...alleQuellen, clips: { lage: 'fehlt', seit: null, abdeckung: 0 } },
      };
      const befunde = new Map(
        pruefeAbdeckung(ohneClips, standard).map((eintrag) => [eintrag.szene.key, eintrag.befund]),
      );
      expect(befunde.get('clips')).toBe('keine-quelle');
    });

    it('nennt jede Szene genau einmal', () => {
      const befunde = pruefeAbdeckung(persona('allrounder'), standard);
      expect(befunde).toHaveLength(WRAPPED_SZENEN.length);
      expect(new Set(befunde.map((eintrag) => eintrag.szene.key)).size).toBe(WRAPPED_SZENEN.length);
    });
  });

  describe('Extremwerte', () => {
    it('hält auch unsinnig grosse Zahlen aus', () => {
      const wahnsinn = ueberschreibe(persona('allrounder'), {
        voiceSeconds: 9999 * 3600,
        messages: 999_999,
        activeDays: 366,
        clipWins: 999,
        levelEnd: 999,
      });
      const geschichte = baueGeschichte(wahnsinn, standard);
      expect(geschichte).toContain('voice_total');
      expect(geschichte).toContain('messages');
      expect(wahnsinn.archetyp.key).toBeTypeOf('string');
    });

    it('kommt mit einer Person ganz ohne Aktivität zurecht', () => {
      const nichts = ueberschreibe(persona('minimal'), {
        voiceSeconds: 0,
        messages: 0,
        activeDays: 0,
        clipWins: 0,
      });
      const geschichte = baueGeschichte(nichts, standard);
      // Intro, Typ und Finale sind keine Geschichte - genau das erkennt die
      // Erzeugung der Momentaufnahmen und überspringt solche Personen.
      const erzaehlend = geschichte.filter(
        (key) => key !== 'intro' && key !== 'finale' && key !== 'archetype',
      );
      expect(erzaehlend).toEqual([]);
    });
  });
});

/**
 * Die Textvorlagen.
 *
 * Alles, was hier eingegeben werden kann, landet auf dem Bildschirm eines
 * Mitglieds. Es gibt deshalb genau eine erlaubte Verarbeitung: Platzhalter
 * aus einer festen Liste einsetzen. Kein `eval`, keine Ausdrücke, kein HTML.
 */
describe('Textvorlagen', () => {
  const werte = Object.fromEntries(PLATZHALTER.map((eintrag) => [eintrag.key, eintrag.beispiel]));

  it('setzt nur Platzhalter aus der Liste ein', () => {
    expect(fuelleVorlage('Hallo {{displayName}}, dein Jahr {{year}}.', werte)).toBe(
      `Hallo ${werte.displayName}, dein Jahr ${werte.year}.`,
    );
  });

  it('lässt Unbekanntes unverändert stehen', () => {
    // Sichtbar falsch ist besser als still verschwunden.
    expect(fuelleVorlage('{{gibtsNicht}}', werte)).toBe('{{gibtsNicht}}');
  });

  it('führt nichts aus', () => {
    const boesartig = [
      '{{constructor}}',
      '{{__proto__}}',
      '{{ process.env.AUTH_SECRET }}',
      '{{1+1}}',
      '{{displayName.toUpperCase()}}',
    ];
    for (const text of boesartig) {
      const ergebnis = fuelleVorlage(text, werte);
      expect(ergebnis).not.toContain('undefined');
      expect(ergebnis).not.toContain('2');
      expect(ergebnis).not.toMatch(/MANUEL/u);
      // Was nicht auf der Liste steht, bleibt stehen, wie es dasteht.
      expect(ergebnis).toBe(text);
    }
  });

  it('weist spitze Klammern zurück', () => {
    expect(pruefeVorlage('<b>fett</b>').gueltig).toBe(false);
    expect(pruefeVorlage('<script>alert(1)</script>').gueltig).toBe(false);
  });

  it('weist Platzhalter mit Sonderzeichen zurück', () => {
    expect(pruefeVorlage('{{a.b}}').gueltig).toBe(false);
    expect(pruefeVorlage('{{a-b}}').gueltig).toBe(false);
    expect(pruefeVorlage('{{a()}}').gueltig).toBe(false);
  });

  it('meldet unbekannte Platzhalter, ohne den Text abzulehnen', () => {
    const befund = pruefeVorlage('Hallo {{displayName}} und {{tschuess}}');
    expect(befund.gueltig).toBe(true);
    expect(befund.unbekannt).toEqual(['tschuess']);
  });

  it('begrenzt die Länge', () => {
    expect(pruefeVorlage('x'.repeat(281)).gueltig).toBe(false);
    expect(pruefeVorlage('x'.repeat(280)).gueltig).toBe(true);
  });
});
