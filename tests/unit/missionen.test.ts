import { describe, expect, it } from 'vitest';
import { berechtigte } from '../../packages/modules/src/missions/abschluss';
import { missionswoche } from '../../packages/modules/src/missions/woche';
import { challengeTypen, missionTyp, missionTypen } from '../../packages/modules/src/missions/typen';

/**
 * Die Regeln der Community Missions, ohne Datenbank.
 *
 * Hier steht, was **entschieden** wird: wer belohnt wird, wann eine Woche
 * beginnt, welche Typen es gibt. Was gespeichert und gemessen wird, steht in
 * `tests/integration/missionen.test.ts` - dort gibt es eine echte Datenbank,
 * und ohne eine waere eine Messung nur eine Attrappe, die sich selbst prueft.
 */

describe('Wer belohnt wird', () => {
  /**
   * Die Wochenmission ist die einfache Haelfte: jedes Mitglied fuer sich.
   */
  it('belohnt bei einer Wochenmission jeden, der das Ziel erreicht hat', () => {
    const werte = new Map([
      ['a', 120],
      ['b', 99],
      ['c', 100],
    ]);
    const { zielErreicht, ids } = berechtigte('WOCHE', 100, 1, werte, 319);

    expect(zielErreicht).toBe(true);
    expect(ids.sort()).toEqual(['a', 'c']);
  });

  it('meldet eine Wochenmission als nicht erreicht, wenn es niemand geschafft hat', () => {
    const { zielErreicht, ids } = berechtigte('WOCHE', 100, 1, new Map([['a', 99]]), 99);
    expect(zielErreicht).toBe(false);
    expect(ids).toEqual([]);
  });

  /**
   * Die Challenge ist die Stelle, an der ein Vorzeichenfehler teuer wird.
   *
   * Sie hat zwei Bedingungen, und beide muessen stimmen: die Summe muss das
   * Ziel erreichen, **und** der Einzelne muss genug beigetragen haben. Faellt
   * die zweite weg, bekommt jedes Servermitglied eine Woche Premium dafuer,
   * dass zwanzig andere die Challenge getragen haben - und das faellt erst
   * auf, wenn die Rechnung fuer die Abos kommt.
   */
  it('belohnt bei einer Challenge niemanden, solange die Summe das Ziel nicht erreicht', () => {
    const werte = new Map([
      ['a', 400],
      ['b', 400],
    ]);
    const { zielErreicht, ids } = berechtigte('CHALLENGE', 1000, 10, werte, 800);

    expect(zielErreicht).toBe(false);
    expect(ids).toEqual([]);
  });

  it('belohnt bei einer erreichten Challenge nur, wer genug beigetragen hat', () => {
    const werte = new Map([
      ['traegt', 600],
      ['hilft', 450],
      ['war-kurz-da', 3],
    ]);
    const { zielErreicht, ids } = berechtigte('CHALLENGE', 1000, 10, werte, 1053);

    expect(zielErreicht).toBe(true);
    expect(ids.sort()).toEqual(['hilft', 'traegt']);
    expect(ids).not.toContain('war-kurz-da');
  });

  it('lässt einen Mindestbeitrag von 0 nicht zu, auch wenn er in der Zeile steht', () => {
    /*
     * Die Eingabe im Dashboard verhindert die 0 schon. Diese Pruefung gilt
     * einer Zeile aus einer frueheren Version - oder einer, die jemand von
     * Hand gesetzt hat. Fail closed: aus 0 wird 1.
     */
    const werte = new Map([
      ['traegt', 1000],
      ['nichts-getan', 0],
    ]);
    const { ids } = berechtigte('CHALLENGE', 1000, 0, werte, 1000);

    expect(ids).toEqual(['traegt']);
  });
});

describe('Die Missionswoche', () => {
  /**
   * Gerechnet wird in Zuercher Zeit.
   *
   * Die Zeitpunkte unten sind UTC; im Winter liegt Zuerich eine Stunde
   * davor, im Sommer zwei. «Montag 00:00 Zuerich» ist im Winter also
   * Sonntag 23:00 UTC.
   */
  it('beginnt am eingestellten Wochentag zur eingestellten Stunde', () => {
    // Mittwoch, 14. Januar 2026, 12:00 UTC - mitten in der Woche.
    const woche = missionswoche(new Date('2026-01-14T12:00:00Z'), 1, 0);

    // Montag, 12. Januar 2026, 00:00 Zuerich = 11. Januar 23:00 UTC.
    expect(woche.beginn.toISOString()).toBe('2026-01-11T23:00:00.000Z');
    expect(woche.ende.toISOString()).toBe('2026-01-18T23:00:00.000Z');
  });

  it('rechnet einen Zeitpunkt vor der Startstunde noch zur vorherigen Woche', () => {
    /*
     * Montag, 12. Januar 2026, 08:00 Zuerich, bei einem Wochenstart um
     * 20:00. Die neue Woche hat noch nicht begonnen - der Zeitpunkt gehoert
     * in die Woche, die am Montag davor um 20:00 anfing.
     */
    const woche = missionswoche(new Date('2026-01-12T07:00:00Z'), 1, 20);

    expect(woche.beginn.toISOString()).toBe('2026-01-05T19:00:00.000Z');
    expect(woche.ende.toISOString()).toBe('2026-01-12T19:00:00.000Z');
  });

  /**
   * Die Zeitumstellung.
   *
   * Der eigentliche Grund, warum die Woche ueber den Kalender und nicht
   * ueber «Beginn plus sieben mal 24 Stunden» gerechnet wird. In der Nacht
   * zum 29. Maerz 2026 springt Zuerich von 02:00 auf 03:00; diese Woche hat
   * 167 Stunden. Trotzdem muss sie am Montag um dieselbe Wanduhrzeit enden.
   */
  it('hält die Wanduhrzeit über die Zeitumstellung', () => {
    // Mittwoch, 25. Maerz 2026 - die Woche der Umstellung.
    const woche = missionswoche(new Date('2026-03-25T12:00:00Z'), 1, 0);

    // Beginn: Montag 23.3. 00:00 Zuerich = 22.3. 23:00 UTC (Winterzeit).
    expect(woche.beginn.toISOString()).toBe('2026-03-22T23:00:00.000Z');
    // Ende: Montag 30.3. 00:00 Zuerich = 29.3. 22:00 UTC (Sommerzeit).
    expect(woche.ende.toISOString()).toBe('2026-03-29T22:00:00.000Z');

    const stunden = (woche.ende.getTime() - woche.beginn.getTime()) / 3_600_000;
    expect(stunden, 'Die Woche der Umstellung ist eine Stunde kürzer').toBe(167);
  });

  it('endet auch im Herbst zur richtigen Wanduhrzeit', () => {
    // Die Woche der Rueckstellung: 25. Oktober 2026, 169 Stunden.
    const woche = missionswoche(new Date('2026-10-21T12:00:00Z'), 1, 0);
    const stunden = (woche.ende.getTime() - woche.beginn.getTime()) / 3_600_000;
    expect(stunden).toBe(169);
  });
});

describe('Die Missionstypen', () => {
  /**
   * Die Zahl ist absichtlich festgeschrieben.
   *
   * Nicht, weil sechs eine schoene Zahl waere, sondern weil jeder Typ eine
   * belastbare Datenquelle braucht. Wer einen siebten hinzufuegt, faellt
   * hier auf und muss die Quelle im Kommentar von `typen.ts` benennen -
   * genau die Pruefung, die bei «Spielersuche benutzt» ergeben hat, dass es
   * die Quelle nicht gibt.
   */
  it('kennt genau die sechs Typen mit belastbarer Quelle', () => {
    expect(missionTypen()).toHaveLength(6);
  });

  it('nennt keinen Typ ohne Datenquelle', () => {
    const schluessel = missionTypen().map((typ) => typ.key);

    /*
     * Die beiden aus der Spezifikation, die nicht umgesetzt wurden:
     *
     *   PLAYER_SEARCH_USED - das Modul Spielersuche wurde entfernt; es gibt
     *   keine Tabelle, die eine Benutzung je Mitglied kennt.
     *
     *   STREAMER_ACTIVITY - Streams haengen an Kanaelen, nicht an
     *   Mitgliedern; nur verifizierte Kanalinhaber koennten so eine Mission
     *   ueberhaupt erfuellen.
     */
    expect(schluessel).not.toContain('PLAYER_SEARCH_USED');
    expect(schluessel).not.toContain('STREAMER_ACTIVITY');
  });

  it('gibt jedem Typ eine Bezeichnung, eine Einheit und eine Erklärung', () => {
    for (const typ of missionTypen()) {
      expect(typ.label, typ.key).not.toBe('');
      expect(typ.einheit, typ.key).not.toBe('');
      expect(typ.erklaerung, typ.key).not.toBe('');
      // Die Quelle steht fuer das Team da - eine leere waere eine Behauptung.
      expect(typ.quelle, typ.key).not.toBe('');
    }
  });

  it('zeigt in der Oberfläche nie die technische Kennung', () => {
    /*
     * Die Bezeichnung darf nicht die Kennung sein. Das ist kein
     * Schoenheitsfehler: `VOICE_MINUTEN` in einem Auswahlfeld ist genau die
     * Art Detail, die aus einem Modul fuer die Community ein Werkzeug fuer
     * Entwickler macht.
     */
    for (const typ of missionTypen()) {
      expect(typ.label, typ.key).not.toBe(typ.key);
      expect(typ.label, typ.key).not.toMatch(/^[A-Z_]+$/u);
    }
  });

  it('lässt nur zusammenzählbare Typen als Community Challenge zu', () => {
    const summierbar = challengeTypen().map((typ) => typ.key);

    /*
     * Ein Level laesst sich nicht addieren. «Der Server erreicht gemeinsam
     * Level 500» waere die Summe aller Level und stiege auch dann, wenn in
     * der Woche niemand etwas tut - ein Fortschrittsbalken, der von allein
     * voll wird.
     */
    expect(summierbar).not.toContain('LEVEL_ERREICHT');
    expect(summierbar).not.toContain('PROFIL_VOLLSTAENDIG');
    expect(summierbar).toContain('VOICE_MINUTEN');
    expect(summierbar).toContain('NACHRICHTEN');
  });

  it('misst Level und Profil ohne Zeitfenster', () => {
    /*
     * Beides sind Zustaende, keine Ereignisse. Wer sein Profil letzten
     * Monat ausgefuellt hat, hat es heute noch - eine Mission, die ihn
     * zwaenge, es noch einmal zu tun, haette nichts zu messen.
     */
    expect(missionTyp('LEVEL_ERREICHT')?.imZeitraum).toBe(false);
    expect(missionTyp('PROFIL_VOLLSTAENDIG')?.imZeitraum).toBe(false);
    expect(missionTyp('VOICE_MINUTEN')?.imZeitraum).toBe(true);
  });

  it('meldet einen unbekannten Typ als unbekannt, statt zu werfen', () => {
    expect(missionTyp('GIBT_ES_NICHT')).toBeUndefined();
  });
});
