import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOURNAMENT_PERMISSIONS } from '../../packages/modules/src/tournaments/config';

/**
 * Die Sicherheitszusagen der Gameserver-Orchestrierung.
 *
 * ## Warum diese Prüfungen strukturell sind
 *
 * Weil sie Zusagen über den **ganzen** Code sind, nicht über einen Ablauf.
 * «Kein Geheimnis erreicht den Browser» lässt sich nicht an einem Beispiel
 * zeigen - es muss für jede Datei gelten, auch für die, die es morgen gibt.
 * Ein Test, der die Dateien liest, gilt auch für die.
 *
 * Geprüft wird jeweils ausserhalb von Kommentaren: die Kopftexte erklären,
 * warum etwas nicht vorkommt, und sollen dafür nicht bestraft werden.
 */

const wurzel = process.cwd();

function ohneKommentare(quelle: string): string {
  return quelle.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '');
}

/** Alle Quelldateien unter einem Pfad, rekursiv. */
function dateienUnter(pfad: string, endungen = ['.ts', '.tsx']): Array<{ pfad: string; quelle: string }> {
  const ergebnis: Array<{ pfad: string; quelle: string }> = [];
  const gehe = (verzeichnis: string): void => {
    for (const name of readdirSync(verzeichnis)) {
      const voll = join(verzeichnis, name);
      if (statSync(voll).isDirectory()) {
        gehe(voll);
      } else if (endungen.some((endung) => name.endsWith(endung))) {
        ergebnis.push({ pfad: voll.slice(wurzel.length + 1), quelle: readFileSync(voll, 'utf8') });
      }
    }
  };
  gehe(join(wurzel, pfad));
  return ergebnis;
}

describe('Kein Geheimnis erreicht den Browser', () => {
  /**
   * Alles, was der Browser von der Gameserver-Verwaltung zu sehen bekommt.
   *
   * Server Actions liefern ihren Rückgabewert an den Client; Client-
   * Komponenten laufen dort. Beides zusammen ist die Grenze.
   */
  const grenze = [
    ...dateienUnter('apps/web/src/modules/gameserver'),
    ...dateienUnter('apps/web/src/server', ['.ts']).filter((d) => d.pfad.endsWith('gameserver.ts')),
  ];

  it('gibt nirgends ein RCON-Passwort heraus', () => {
    for (const datei of grenze) {
      expect(ohneKommentare(datei.quelle), datei.pfad).not.toMatch(
        /rconPasswort\(|rconPasswordEnc|rconPassword\b/u,
      );
    }
  });

  it('gibt nirgends ein Agent-Token heraus', () => {
    for (const datei of grenze) {
      expect(ohneKommentare(datei.quelle), datei.pfad).not.toMatch(/agentTokenEnc|agentToken\b/u);
    }
  });

  it('entschlüsselt an der Grenze überhaupt nichts', () => {
    // `decryptSecret` gehört in den Orchestrator, nicht in eine Seite.
    for (const datei of grenze) {
      expect(ohneKommentare(datei.quelle), datei.pfad).not.toMatch(/decryptSecret/u);
    }
  });

  it('reicht die Zugangsdaten des Anbieters nicht durch', () => {
    for (const datei of grenze) {
      expect(ohneKommentare(datei.quelle), datei.pfad).not.toMatch(/ladeZugang\(|getSecret\(/u);
    }
  });

  it('nennt die Ansicht eines Servers kein Geheimnis', () => {
    /*
     * Der Typ selbst ist die Zusage: was nicht darin vorkommt, kann nicht
     * mitreisen. Deshalb wird hier die Typdefinition gelesen, nicht eine
     * Antwort zur Laufzeit.
     */
    const quelle = readFileSync(join(wurzel, 'packages/modules/src/gameserver/orchestrator.ts'), 'utf8');
    const anfang = quelle.indexOf('export interface ServerAnsicht');
    const ende = quelle.indexOf('}', anfang);
    const block = quelle.slice(anfang, ende);

    expect(anfang).toBeGreaterThan(-1);
    expect(block).not.toMatch(/rcon|token|secret|password/iu);
  });

  it('nennt den Match Room kein Geheimnis ausser dem Lobbypasswort', () => {
    const quelle = readFileSync(join(wurzel, 'apps/web/src/server/gameserver.ts'), 'utf8');
    const anfang = quelle.indexOf('export interface MatchRoomAnsicht');
    const ende = quelle.indexOf('\n}', anfang);
    const block = ohneKommentare(quelle.slice(anfang, ende));

    expect(anfang).toBeGreaterThan(-1);
    expect(block).not.toMatch(/rcon|agentToken|providerRef/iu);
    // `serverPasswort` ist erlaubt und ausdrücklich gewollt - es steht
    // ohnehin in jeder Lobby.
    expect(block).toMatch(/serverPasswort/u);
  });
});

describe('Keine freie Konsole in der WebApp', () => {
  const actions = readFileSync(join(wurzel, 'apps/web/src/modules/gameserver/actions.ts'), 'utf8');

  it('nimmt keine Server Action einen Befehl entgegen', () => {
    expect(ohneKommentare(actions)).not.toMatch(/command|rconCommand|shell|\bexec\b/iu);
  });

  it('bietet die Match-Aktionen als feste Aufzählung an', () => {
    /*
     * Eine `z.enum`-Liste, kein `z.string()`. Der Unterschied ist genau der,
     * um den es geht: eine Aufzählung lässt sich nicht erweitern, indem
     * jemand etwas tippt.
     */
    expect(actions).toMatch(/MATCH_AKTION = z\.enum\(\[/u);
  });

  it('gibt der Rundenzahl eine Ober- und Untergrenze', () => {
    expect(actions).toMatch(/runde: z\.coerce\.number\(\)\.int\(\)\.min\(1\)\.max\(60\)/u);
  });
});

describe('Jede Aktion prüft serverseitig', () => {
  const actions = readFileSync(join(wurzel, 'apps/web/src/modules/gameserver/actions.ts'), 'utf8');

  it('gibt jeder Server Action eine Berechtigung und eine Ratenbegrenzung', () => {
    /*
     * Gezählt statt gelesen: jede `defineAction` braucht beides. Eine ohne
     * Berechtigung wäre ein offener Einstieg, eine ohne Begrenzung ein
     * Werkzeug, mit dem sich das Datacenter fluten liesse.
     */
    const aktionen = actions.match(/defineAction\(/gu) ?? [];
    const berechtigungen = actions.match(/^\s+permission: /gmu) ?? [];
    const begrenzungen = actions.match(/^\s+rateLimit: /gmu) ?? [];

    expect(aktionen.length).toBeGreaterThan(5);
    expect(berechtigungen).toHaveLength(aktionen.length);
    expect(begrenzungen).toHaveLength(aktionen.length);
  });

  it('verlangt für jede schreibende Aktion frische Anmeldedaten', () => {
    const aktionen = actions.match(/defineAction\(/gu) ?? [];
    const frische = actions.match(/^\s+freshness: 'critical'/gmu) ?? [];
    expect(frische).toHaveLength(aktionen.length);
  });
});

describe('Die Berechtigungen', () => {
  it('liegen unter dem Präfix des Turniermoduls', () => {
    /*
     * Nicht unter einem eigenen. Der Gameserver ist kein zweites Modul,
     * sondern die Infrastruktur dieses einen - und die zentrale
     * Modulprüfung leitet die Modulkennung aus dem Präfix ab.
     */
    const gameserverKeys = Object.entries(TOURNAMENT_PERMISSIONS)
      .filter(([name]) =>
        /gameserver|Profiles|template|infrastructure|matchControl|veto|Cleanup|Hold/iu.test(name),
      )
      .map(([, wert]) => wert);

    expect(gameserverKeys.length).toBeGreaterThanOrEqual(9);
    for (const key of gameserverKeys) {
      expect(key, key).toMatch(/^tournaments\./u);
    }
  });

  it('nennt keine Rolle beim Namen', () => {
    // Keine hartkodierte Discord-Rolle irgendwo im Gameserver-Code.
    for (const datei of [
      ...dateienUnter('packages/modules/src/gameserver'),
      ...dateienUnter('apps/web/src/modules/gameserver'),
    ]) {
      expect(ohneKommentare(datei.quelle), datei.pfad).not.toMatch(/['"`]\d{17,20}['"`]/u);
    }
  });
});

describe('Der Bot bleibt frei von Web-Abhängigkeiten', () => {
  it('importiert kein Gameserver-Modul server-only', () => {
    /*
     * Dieselbe Falle wie beim Backup-Modul: `import 'server-only'` in einer
     * Datei, die über ein Sammelmodul im Bot landet, bringt den Bot beim
     * Start um - und der Typecheck sieht nichts davon. Der
     * Bot-Startup-Test fängt es ebenfalls; diese Prüfung nennt die Datei.
     */
    for (const datei of dateienUnter('packages/modules/src/gameserver')) {
      expect(datei.quelle, datei.pfad).not.toMatch(/^import 'server-only'/mu);
    }
  });

  it('zieht kein React und kein Next in den Modulkern', () => {
    for (const datei of dateienUnter('packages/modules/src/gameserver')) {
      expect(ohneKommentare(datei.quelle), datei.pfad).not.toMatch(/from 'react'|from 'next\//u);
    }
  });
});
