import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  cs2VetoAblauf,
  istSteamId64,
  leseCs2Ergebnis,
} from '../../packages/modules/src/gameserver/cs2/adapter';
import { gameAdapter, listeAdapter } from '../../packages/modules/src/gameserver/adapter';
import { baueStartskript } from '../../packages/modules/src/gameserver/startskript';

/**
 * Der CS2-Adapter und die Trennlinie um ihn herum.
 *
 * Zwei Sorten Test in dieser Datei:
 *
 * **Fachlich** - was der Adapter aus einer Servermeldung macht. Hier liegt
 * die Entscheidung, ob ein Bracket weiterrueckt; sie muss im Zweifel zu
 * einem Menschen gehen und nicht zu einer Vermutung.
 *
 * **Strukturell** - dass im Orchestrator kein `CS2` steht. Das ist die
 * Bedingung dafuer, dass ein zweites Spiel spaeter eine Datei ist und keine
 * Operation am offenen Herzen, und eine Zusage, die sich nur so halten
 * laesst: indem ein Test sie nachliest.
 */

describe('SteamID64', () => {
  it('nimmt eine echte SteamID64 an', () => {
    expect(istSteamId64('76561198012345678')).toBe(true);
  });

  it('weist ab, was keine ist', () => {
    // Der haeufigste Fehler: jemand traegt seinen Profilnamen ein.
    expect(istSteamId64('meinname')).toBe(false);
    // Eine SteamID32 im alten Format.
    expect(istSteamId64('STEAM_1:0:12345')).toBe(false);
    // Siebzehn Ziffern, aber nicht aus dem Individual-Bereich.
    expect(istSteamId64('12345678901234567')).toBe(false);
    // Zu kurz.
    expect(istSteamId64('7656119801234567')).toBe(false);
  });
});

describe('Der Veto-Ablauf', () => {
  it('lässt bei BO1 genau eine Map übrig', () => {
    const ablauf = cs2VetoAblauf(1);
    const banns = ablauf.filter((s) => s.kind === 'BAN').length;
    const decider = ablauf.filter((s) => s.kind === 'DECIDER').length;

    expect(decider).toBe(1);
    // Sieben Maps im Pool, sechs gebannt, eine bleibt.
    expect(banns + decider).toBe(7);
  });

  it('wechselt die Seiten ab', () => {
    /*
     * Ein Ablauf, bei dem eine Seite zweimal hintereinander dran ist, ist
     * kein Veto - er waere ein Vorteil. Geprueft wird ueber alle Schritte,
     * die einer Seite gehoeren.
     */
    for (const bestOf of [1, 3, 5]) {
      const seiten = cs2VetoAblauf(bestOf)
        .filter((s) => s.actor !== 'SYSTEM')
        .map((s) => s.actor);
      for (let i = 1; i < seiten.length; i += 1) {
        expect(seiten[i], `Best of ${bestOf}, Schritt ${i}`).not.toBe(seiten[i - 1]);
      }
    }
  });

  it('ergibt bei BO3 drei und bei BO5 fünf Maps', () => {
    const maps = (bestOf: number) =>
      cs2VetoAblauf(bestOf).filter((s) => s.kind === 'PICK' || s.kind === 'DECIDER').length;

    expect(maps(3)).toBe(3);
    expect(maps(5)).toBe(5);
  });

  it('endet immer mit dem Decider', () => {
    for (const bestOf of [1, 3, 5]) {
      expect(cs2VetoAblauf(bestOf).at(-1)?.kind, `Best of ${bestOf}`).toBe('DECIDER');
    }
  });
});

describe('Das Resultat vom Server lesen', () => {
  const map = (name: string, a: number, b: number) => ({ map: name, team1_score: a, team2_score: b });

  it('liest ein eindeutiges BO1-Ergebnis', () => {
    const ergebnis = leseCs2Ergebnis({ maps: [map('de_mirage', 13, 7)] }, 1);

    expect(ergebnis.eindeutig).toBe(true);
    expect(ergebnis.mapsA).toBe(1);
    expect(ergebnis.mapsB).toBe(0);
    expect(ergebnis.maps[0]).toEqual({ index: 1, map: 'de_mirage', scoreA: 13, scoreB: 7 });
  });

  it('liest ein BO3 mit 2:1', () => {
    const ergebnis = leseCs2Ergebnis(
      { maps: [map('de_mirage', 13, 7), map('de_inferno', 10, 13), map('de_nuke', 13, 11)] },
      3,
    );

    expect(ergebnis.eindeutig).toBe(true);
    expect(ergebnis.mapsA).toBe(2);
    expect(ergebnis.mapsB).toBe(1);
  });

  it('kommt mit den verbreiteten Feldnamen zurecht', () => {
    // Die Plugins heissen die Felder unterschiedlich. Ein Adapter, der nur
    // eine Schreibweise kennt, faellt beim ersten Pluginwechsel um.
    const ergebnis = leseCs2Ergebnis({ map_results: [{ map_name: 'de_ancient', scoreA: 13, scoreB: 4 }] }, 1);
    expect(ergebnis.eindeutig).toBe(true);
    expect(ergebnis.maps[0]?.map).toBe('de_ancient');
  });

  /*
   * Ab hier: alles, was **nicht** ins Bracket darf.
   *
   * Jeder dieser Faelle koennte mit ein bisschen Raten zu einem Ergebnis
   * gemacht werden. Genau das soll nicht passieren - ein falsch
   * weitergerueckter Sieger ist im Turnierbetrieb kaum noch zu korrigieren.
   */
  it('schickt ein abgebrochenes BO3 zur Prüfung', () => {
    const ergebnis = leseCs2Ergebnis({ maps: [map('de_mirage', 13, 7)] }, 3);

    expect(ergebnis.eindeutig).toBe(false);
    expect(ergebnis.unklarGrund).toMatch(/Best of 3/u);
  });

  it('schickt ein Unentschieden zur Prüfung', () => {
    const ergebnis = leseCs2Ergebnis({ maps: [map('de_mirage', 12, 12)] }, 1);

    expect(ergebnis.eindeutig).toBe(false);
    expect(ergebnis.unklarGrund).toMatch(/unentschieden/u);
  });

  it('schickt zu viele Maps zur Prüfung', () => {
    const ergebnis = leseCs2Ergebnis(
      { maps: [map('a', 13, 1), map('b', 13, 2), map('c', 13, 3), map('d', 13, 4)] },
      3,
    );

    expect(ergebnis.eindeutig).toBe(false);
  });

  it('schickt eine unlesbare Meldung zur Prüfung, statt zu werfen', () => {
    for (const roh of [null, 'kaputt', {}, { maps: [] }, { maps: [{ map: 'de_dust2' }] }]) {
      const ergebnis = leseCs2Ergebnis(roh, 1);
      expect(ergebnis.eindeutig, JSON.stringify(roh)).toBe(false);
      expect(ergebnis.unklarGrund, JSON.stringify(roh)).toBeTruthy();
    }
  });
});

describe('Die Trennlinie zwischen Orchestrator und Spiel', () => {
  /** Die Dateien des Orchestrators - ohne den Unterordner der Adapter. */
  function orchestratorDateien(): Array<{ name: string; quelle: string }> {
    const verzeichnis = join(process.cwd(), 'packages/modules/src/gameserver');
    return readdirSync(verzeichnis)
      .filter((name) => name.endsWith('.ts'))
      .map((name) => ({ name, quelle: readFileSync(join(verzeichnis, name), 'utf8') }));
  }

  it('nennt im Orchestrator kein einziges Spiel beim Namen', () => {
    /*
     * Was hier **nicht** zaehlt, und warum:
     *
     * - **Kommentare.** Die Kopftexte erklaeren ausdrücklich, warum hier
     *   kein CS2 steht. Sie sind der Grund, nicht der Verstoss.
     * - **Import- und Export-Zeilen.** `export * from './cs2/adapter'` im
     *   Sammelmodul ist die Verdrahtung der Registry, keine Logik. Ohne sie
     *   wuerde sich der Adapter nie eintragen.
     *
     * Die Wortgrenze vor `de_` ist ebenfalls Absicht: ohne sie fand der Test
     * `BELEGENDE_ZUSTAENDE` und meldete eine Map, wo eine Konstante stand.
     *
     * Beim ersten Lauf hat dieser Test einen echten Befund gehabt:
     * `spieler.ts` trug die Karte `{ CS2: 'steam' }`. Sie steht jetzt im
     * Adapter, wo sie hingehoert.
     */
    const treffer: string[] = [];
    for (const datei of orchestratorDateien()) {
      const ohneKommentare = datei.quelle
        .replace(/\/\*[\s\S]*?\*\//gu, '')
        .replace(/\/\/.*$/gmu, '')
        .split('\n')
        .filter((zeile) => !/^\s*(import|export \*|export \{)/u.test(zeile))
        .join('\n');
      if (/\bCS2\b|counter-?strike|\bde_[a-z]+/iu.test(ohneKommentare)) {
        treffer.push(datei.name);
      }
    }

    expect(
      treffer,
      'Im Orchestrator darf kein Spiel hartkodiert sein - das gehört in den Game Adapter.',
    ).toEqual([]);
  });

  it('kennt genau einen Adapter, und der ist CS2', () => {
    // Version 1 ist bewusst nur CS2. Eine halbfertige zweite Integration
    // waere schlimmer als keine - sie sähe aus, als würde sie funktionieren.
    expect(listeAdapter().map((a) => a.game)).toEqual(['CS2']);
    expect(gameAdapter('CS2')).toBeDefined();
  });
});

describe('Das Startskript', () => {
  const eingabe = {
    agentToken: 'AbC-123_xyz',
    agentPort: 9443,
    rconPasswort: 'Geheim-42_abc',
    game: 'CS2' as const,
    gamePort: 27015,
    tvPort: 27020,
  };

  it('setzt die Werte in die Konfigurationsdatei', () => {
    const skript = baueStartskript(eingabe);

    expect(skript).toContain('SWISSHUB_AGENT_TOKEN=AbC-123_xyz');
    expect(skript).toContain('SWISSHUB_GAME_PORT=27015');
    expect(skript.startsWith('#cloud-config')).toBe(true);
  });

  /*
   * Der eigentliche Zweck dieser Gruppe.
   *
   * Das Startskript ist der einzige Text, den SwissHub einer Maschine zur
   * Ausfuehrung gibt. Kaeme darin ein Wert vor, den eine Shell anders liest
   * als gemeint, waere jede Berechtigung in der WebApp nur noch eine Bitte.
   */
  it('weist einen Wert ab, den eine Shell anders lesen könnte', () => {
    for (const boese of ['abc\nrm -rf /', 'abc; rm -rf /', 'abc$(whoami)', 'abc`id`', "abc'def", 'abc def']) {
      expect(() => baueStartskript({ ...eingabe, agentToken: boese }), boese).toThrow();
      expect(() => baueStartskript({ ...eingabe, rconPasswort: boese }), boese).toThrow();
    }
  });

  it('weist einen unmöglichen Port ab', () => {
    for (const port of [0, -1, 70_000, 1.5, Number.NaN]) {
      expect(() => baueStartskript({ ...eingabe, gamePort: port }), String(port)).toThrow();
    }
  });

  it('lädt beim Start nichts aus dem Netz nach', () => {
    // Eine Maschine, die beim Start aus dem Netz nachlaedt, haengt an einem
    // fremden Server - und der ist auch mal weg.
    const skript = baueStartskript(eingabe);
    expect(skript).not.toMatch(/curl|wget|apt-get|pip install|npm install/u);
  });
});
