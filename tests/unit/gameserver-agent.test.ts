import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AGENT_AKTIONEN,
  ERLAUBTE_PFADE,
  ZEITFENSTER_SEKUNDEN,
  erzeugeAgentToken,
  erzeugeServerPasswort,
  nonce,
  pruefeAnfrage,
  pruefeNutzlast,
  signiere,
} from '../../packages/modules/src/gameserver/agent-protokoll';
import { agentZugriff, type AgentTransport } from '../../packages/modules/src/gameserver/agent-client';

/**
 * Der Agent.
 *
 * Diese Datei prueft vor allem eines: dass der Agent **keine** Fernwartung
 * ist. Ein Gameserver steht mit einer oeffentlichen Adresse im Netz; alles,
 * was er entgegennimmt, nimmt er von jedem entgegen, der die Adresse
 * findet. Die Signatur ist das, was dazwischensteht, und die feste Liste
 * der Aktionen ist das, was uebrig bliebe, wenn die Signatur einmal fiele.
 */

const TOKEN = 'test-token-abc';
const jetzt = 1_800_000_000;

/** Eine korrekt signierte Anfrage - die Grundlage der Gegenproben. */
function gueltig(überschreibungen: Partial<Parameters<typeof pruefeAnfrage>[0]> = {}) {
  const einmalwert = nonce();
  const rumpf = '';
  return {
    token: TOKEN,
    methode: 'GET',
    pfad: '/health',
    zeitstempel: String(jetzt),
    einmalwert,
    signatur: signiere(TOKEN, 'GET', '/health', jetzt, einmalwert, rumpf),
    rumpf,
    kennstDuDenNonce: () => false,
    jetztSekunden: jetzt,
    ...überschreibungen,
  };
}

describe('Die Signaturprüfung', () => {
  it('lässt eine korrekt signierte Anfrage durch', () => {
    expect(pruefeAnfrage(gueltig())).toEqual({ ok: true });
  });

  it('weist eine Anfrage ohne Signatur ab', () => {
    const ergebnis = pruefeAnfrage(gueltig({ signatur: null }));
    expect(ergebnis).toMatchObject({ ok: false, status: 401 });
  });

  it('weist ein falsches Token ab', () => {
    const einmalwert = nonce();
    const ergebnis = pruefeAnfrage(
      gueltig({
        einmalwert,
        signatur: signiere('anderes-token', 'GET', '/health', jetzt, einmalwert, ''),
      }),
    );
    expect(ergebnis).toMatchObject({ ok: false, status: 401 });
  });

  it('bindet die Signatur an den Pfad', () => {
    /*
     * Sonst liesse sich eine mitgelesene Signatur von `/health` auf
     * `/game/stop` umhaengen - ein Aufruf, der mitten im Match den Server
     * anhaelt.
     */
    const einmalwert = nonce();
    const ergebnis = pruefeAnfrage(
      gueltig({
        pfad: '/game/stop',
        methode: 'POST',
        einmalwert,
        signatur: signiere(TOKEN, 'GET', '/health', jetzt, einmalwert, ''),
      }),
    );
    expect(ergebnis).toMatchObject({ ok: false, status: 401 });
  });

  it('bindet die Signatur an den Rumpf', () => {
    // Sonst liesse sich eine gültige `configure`-Anfrage mit einer anderen
    // Aufstellung versehen - und das Match liefe mit fremden Spielern.
    const einmalwert = nonce();
    const echt = JSON.stringify({ team1: 'A' });
    const ergebnis = pruefeAnfrage(
      gueltig({
        pfad: '/match/configure',
        methode: 'POST',
        rumpf: JSON.stringify({ team1: 'B' }),
        einmalwert,
        signatur: signiere(TOKEN, 'POST', '/match/configure', jetzt, einmalwert, echt),
      }),
    );
    expect(ergebnis).toMatchObject({ ok: false, status: 401 });
  });

  it('weist eine abgelaufene Anfrage ab', () => {
    const ergebnis = pruefeAnfrage(gueltig({ jetztSekunden: jetzt + ZEITFENSTER_SEKUNDEN + 1 }));
    expect(ergebnis).toMatchObject({ ok: false, status: 401 });
  });

  it('weist eine Anfrage aus der Zukunft ab', () => {
    /*
     * Der klassische Weg, ein Zeitfenster auszuhebeln: einen Zeitstempel von
     * morgen setzen und die Signatur beliebig lange verwenden.
     */
    const ergebnis = pruefeAnfrage(gueltig({ jetztSekunden: jetzt - ZEITFENSTER_SEKUNDEN - 1 }));
    expect(ergebnis).toMatchObject({ ok: false, status: 401 });
  });

  it('weist eine wiedereingespielte Anfrage ab', () => {
    const ergebnis = pruefeAnfrage(gueltig({ kennstDuDenNonce: () => true }));
    expect(ergebnis).toMatchObject({ ok: false, status: 401 });
  });

  it('weist einen unbekannten Pfad ab - noch vor der Signatur', () => {
    const ergebnis = pruefeAnfrage(gueltig({ pfad: '/shell', signatur: null }));
    // 404, nicht 401: was es nicht gibt, gibt es nicht - und die Antwort
    // verraet nicht, ob eine gueltige Signatur geholfen haette.
    expect(ergebnis).toMatchObject({ ok: false, status: 404 });
  });
});

describe('Die Nutzlastprüfung', () => {
  it('lässt eine Rundenzahl durch und alles andere nicht', () => {
    expect(pruefeNutzlast('matchRestore', { round: 12 })).toEqual({ ok: true });

    for (const boese of [
      { round: 'rm -rf /' },
      { round: 0 },
      { round: -1 },
      { round: 61 },
      { round: 1.5 },
      {},
      null,
    ]) {
      expect(pruefeNutzlast('matchRestore', boese), JSON.stringify(boese)).toMatchObject({ ok: false });
    }
  });
});

describe('Der Agent kennt keine freie Shell', () => {
  const protokoll = readFileSync(
    join(process.cwd(), 'packages/modules/src/gameserver/agent-protokoll.ts'),
    'utf8',
  );
  const aktionen = readFileSync(join(process.cwd(), 'apps/game-agent/src/aktionen.ts'), 'utf8');
  const server = readFileSync(join(process.cwd(), 'apps/game-agent/src/index.ts'), 'utf8');

  it('bietet genau die zehn festen Aktionen an', () => {
    /*
     * Die Zahl ist absichtlich festgeschrieben. Wer eine elfte ergaenzt,
     * faellt hier auf und muss sich fragen lassen, ob sie eine feste
     * Handlung ist - oder ein Weg, etwas auszufuehren.
     */
    expect(Object.keys(AGENT_AKTIONEN)).toHaveLength(10);
    expect(ERLAUBTE_PFADE).toHaveLength(10);
  });

  /** Kommentare weg: sie nennen genau das, was es nicht geben soll. */
  const ohneKommentare = (quelle: string): string =>
    quelle.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '');

  it('hat keinen Endpunkt, der einen Befehl entgegennimmt', () => {
    /*
     * Die Kopftexte der drei Dateien erklaeren ausdruecklich, warum es kein
     * `executeCommand` gibt. Sie sind der Grund, nicht der Verstoss -
     * deshalb wird im Code gesucht, nicht in der Erklaerung.
     */
    for (const [name, quelle] of [
      ['Protokoll', protokoll],
      ['Aktionen', aktionen],
      ['Server', server],
    ] as const) {
      expect(ohneKommentare(quelle), name).not.toMatch(
        /executeCommand|runCommand|\/exec\b|\/shell\b|\/cmd\b/u,
      );
    }
  });

  it('benutzt keine Shell zum Ausführen', () => {
    /*
     * `spawn` mit Argumentliste statt `exec` mit einer Zeile. Der
     * Unterschied ist genau der, um den es geht: `exec` gibt den Text einer
     * Shell, `spawn` gibt ihn dem Programm.
     */
    expect(ohneKommentare(aktionen)).not.toMatch(/\bexec\(|\bexecSync\(|shell:\s*true/u);
    expect(aktionen).toMatch(/spawn\(/u);
  });

  it('nimmt keinen Pfad aus der Anfrage entgegen', () => {
    // Sonst waere `/files/demos?dir=/etc` ein gueltiger Aufruf.
    expect(ohneKommentare(server)).not.toMatch(/searchParams|req\.query|url\.parse/u);
  });
});

describe('Erzeugte Geheimnisse', () => {
  it('erzeugt jedes Mal ein anderes Agent-Token', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => erzeugeAgentToken()));
    expect(tokens.size).toBe(50);
    // 32 Bytes als base64url - lang genug, dass Raten sinnlos ist.
    expect([...tokens][0]?.length).toBeGreaterThanOrEqual(40);
  });

  it('erzeugt ein Serverpasswort, das sich abtippen lässt', () => {
    /*
     * Es wird in einer Spielkonsole getippt, gelegentlich vom Telefon
     * abgelesen. Kein `l` neben `1`, kein `O` neben `0`, keine
     * Sonderzeichen - ein Passwort, das niemand fehlerfrei eingibt, wird
     * weitergereicht, bis es alle haben.
     */
    for (let i = 0; i < 50; i += 1) {
      expect(erzeugeServerPasswort()).toMatch(/^[abcdefghijkmnpqrstuvwxyz23456789]{8}$/u);
    }
  });
});

describe('Der Client', () => {
  /** Ein Transport, der mitschreibt, statt zu senden. */
  function mitschrift(antwort: unknown = { ok: true }) {
    const aufrufe: Array<{ url: string; method: string; headers: Record<string, string>; body?: string }> =
      [];
    const transport: AgentTransport = async (url, optionen) => {
      aufrufe.push({
        url,
        method: optionen.method,
        headers: optionen.headers,
        ...(optionen.body ? { body: optionen.body } : {}),
      });
      return { status: 200, text: async () => JSON.stringify(antwort) };
    };
    return { aufrufe, transport };
  }

  it('signiert jede Anfrage', async () => {
    const { aufrufe, transport } = mitschrift();
    await agentZugriff({ host: '192.0.2.1', port: 9443, token: TOKEN }, transport).gameStart();

    const aufruf = aufrufe[0];
    expect(aufruf?.url).toBe('https://192.0.2.1:9443/game/start');
    expect(aufruf?.headers['x-swisshub-signature']).toBeTruthy();
    expect(aufruf?.headers['x-swisshub-nonce']).toBeTruthy();
  });

  it('benutzt für jede Anfrage einen neuen Einmalwert', async () => {
    const { aufrufe, transport } = mitschrift();
    const zugriff = agentZugriff({ host: '192.0.2.1', port: 9443, token: TOKEN }, transport);
    await zugriff.gameStart();
    await zugriff.gameStart();

    expect(aufrufe[0]?.headers['x-swisshub-nonce']).not.toBe(aufrufe[1]?.headers['x-swisshub-nonce']);
  });

  it('lässt eine ungültige Rundenzahl nicht einmal auf die Leitung', async () => {
    const { aufrufe, transport } = mitschrift();
    const zugriff = agentZugriff({ host: '192.0.2.1', port: 9443, token: TOKEN }, transport);

    await expect(zugriff.matchRestore(999)).rejects.toThrow();
    expect(aufrufe, 'Die Anfrage darf den Prozess nicht verlassen').toHaveLength(0);
  });

  it('macht aus einem Dateinamen mit Pfad nur den Dateinamen', async () => {
    /*
     * Was der Agent meldet, ist die Ausgabe eines fremden Prozesses.
     * `../../etc/passwd` waere ein gueltiger «Name» - und spaeter ein
     * gueltiger Pfad beim Ablegen.
     */
    const { transport } = mitschrift({
      files: [{ kind: 'DEMO', name: '../../etc/passwd', sizeBytes: 10 }],
    });
    const dateien = await agentZugriff({ host: '192.0.2.1', port: 9443, token: TOKEN }, transport).dateien();

    expect(dateien[0]?.name).toBe('passwd');
  });

  it('lässt unerwartete Einträge weg, statt zu raten', async () => {
    const { transport } = mitschrift({
      files: [
        { kind: 'DEMO', name: 'match.dem', sizeBytes: 100 },
        { kind: 'GIBTESNICHT', name: 'x', sizeBytes: 1 },
        { name: 'ohne-art', sizeBytes: 1 },
        'kaputt',
      ],
    });
    const dateien = await agentZugriff({ host: '192.0.2.1', port: 9443, token: TOKEN }, transport).dateien();

    expect(dateien).toHaveLength(1);
    expect(dateien[0]?.name).toBe('match.dem');
  });
});
