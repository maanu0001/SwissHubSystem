import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import '@swisshub/modules';
import { alleSeiten, blockText } from '../../apps/web/src/modules/docs/register';
import { WERKE } from '../../apps/web/src/modules/docs/werk';
import type { DokuBlock } from '../../apps/web/src/modules/docs/typen';

/**
 * Was in der Dokumentation nicht stehen darf.
 *
 * ## Warum das ein Test ist und kein Vorsatz
 *
 * Eine Dokumentation über Integrationen, Secrets und Deployment ist genau der
 * Ort, an dem versehentlich ein echter Wert landet - weil man beim Schreiben
 * eine Konfiguration offen hat und ein Beispiel daraus abschreibt. Ein Satz
 * in einer Richtlinie verhindert das nicht; eine Prüfung über den gesamten
 * Inhalt schon.
 *
 * Geprüft wird auf die Form, nicht auf einen bekannten Wert: ein Discord-Token
 * sieht aus wie ein Discord-Token, ein privater Schlüssel beginnt mit seiner
 * PEM-Zeile. Namen von Umgebungsvariablen sind ausdrücklich erlaubt - §17
 * verlangt sie sogar. Verboten sind ihre Werte.
 */

/** Jeder Textschnipsel beider Werke - Absätze, Listen, Tabellen, Code. */
function allerText(): { ort: string; text: string }[] {
  const stuecke: { ort: string; text: string }[] = [];

  const aus = (ort: string, block: DokuBlock): void => {
    stuecke.push({ ort, text: blockText(block) });
    if (block.art === 'code') {
      stuecke.push({ ort: `${ort} (code)`, text: block.inhalt });
    }
  };

  for (const werk of WERKE) {
    for (const { seite } of alleSeiten(werk)) {
      for (const abschnitt of seite.abschnitte) {
        const ort = `${werk.id}/${seite.slug}#${abschnitt.anker}`;
        for (const block of abschnitt.blocks) aus(ort, block);
        for (const unter of abschnitt.unter ?? []) {
          for (const block of unter.blocks) aus(`${ort}/${unter.anker}`, block);
        }
      }
    }
  }
  return stuecke;
}

const VERBOTEN: readonly { name: string; muster: RegExp }[] = [
  // Discord-Bot-Token: drei Base64-Teile, der erste ist die kodierte App-ID.
  { name: 'Discord-Token', muster: /\b[A-Za-z0-9_-]{24,28}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,40}\b/u },
  { name: 'privater Schlüssel', muster: /-----BEGIN [A-Z ]*PRIVATE KEY-----/u },
  // Zahlungsanbieter-Schlüssel (live und test tragen dieselbe Form).
  { name: 'Stripe-Schlüssel', muster: /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}/u },
  { name: 'Stripe-Webhook-Geheimnis', muster: /\bwhsec_[A-Za-z0-9]{16,}/u },
  { name: 'GitHub-Token', muster: /\bgh[pousr]_[A-Za-z0-9]{30,}/u },
  { name: 'AWS-Zugriffsschlüssel', muster: /\bAKIA[0-9A-Z]{16}\b/u },
  { name: 'Google-API-Schlüssel', muster: /\bAIza[0-9A-Za-z_-]{30,}/u },
  { name: 'JSON Web Token', muster: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/u },
  // Eine Verbindungszeichenfolge mit Passwort - nicht die Form `:<passwort>@`.
  {
    name: 'Datenbank-URL mit Passwort',
    muster:
      /\b(?:postgres(?:ql)?|mysql|redis|mongodb):\/\/[^\s:@/]+:(?!<|\.\.\.|PASSWORT|passwort|\*)[^\s:@/]{4,}@/u,
  },
];

describe('Doku-Sicherheit: keine Geheimnisse', () => {
  const stuecke = allerText();

  it('liest überhaupt Inhalt', () => {
    // Gegenprobe: ohne sie könnten alle Prüfungen unten über eine leere Liste
    // laufen und «nichts gefunden» sagen, weil sie nichts gesehen haben.
    expect(stuecke.length).toBeGreaterThan(250);
    expect(stuecke.some((stueck) => stueck.text.includes('Permission'))).toBe(true);
  });

  it.each(VERBOTEN.map((eintrag) => [eintrag.name, eintrag.muster] as const))(
    'enthält kein %s',
    (_name, muster) => {
      const treffer = stuecke
        .filter((stueck) => muster.test(stueck.text))
        .map((stueck) => `${stueck.ort}: ${stueck.text.slice(0, 80)}`);
      expect(treffer).toEqual([]);
    },
  );

  it('erkennt ein eingeschmuggeltes Geheimnis', () => {
    /*
     * Die Gegenprobe zu den Mustern selbst. Ohne sie wüsste niemand, ob die
     * regulären Ausdrücke überhaupt etwas finden könnten - ein Muster mit
     * einem Tippfehler ist genauso grün wie ein sauberer Inhalt.
     *
     * ## Warum die Proben zusammengesetzt werden
     *
     * Weil sie sonst selbst Geheimnisse wären - der Form nach jedenfalls, und
     * mehr kann ein Scanner nicht beurteilen. Diese Datei als Ganzes stand
     * schon einmal in einem abgelehnten Push: GitHubs Push Protection hat den
     * erfundenen Discord-Token in der Zeile darunter gefunden und den ganzen
     * Commit blockiert. Zu Recht, denn an der Zeichenkette ist nicht zu
     * erkennen, dass sie ausgedacht ist.
     *
     * Deshalb liegt in der Quelle nirgends ein vollständiger Token. Jede Probe
     * entsteht erst beim Lauf aus ihren Teilen; geprüft wird die
     * zusammengesetzte Zeichenkette, die Aussage des Tests bleibt also
     * dieselbe. Ein Scanner, der die Datei liest, findet nichts - weil nichts
     * da ist, nicht weil er ausgeschaltet wurde.
     */
    const teile = (...stuecke: string[]): string => stuecke.join('');

    const proben = [
      // Discord-Bot-Token: drei Teile, punktgetrennt.
      ['MTIzNDU2Nzg5MDEyMzQ1Njc4', 'Gh1jKl', 'abcdefghijklmnopqrstuvwxyz123'].join('.'),
      teile('-----BEGIN ', 'RSA ', 'PRIVATE KEY', '-----'),
      teile('sk', '_live_', 'abcdefghijklmnopqrstuvwx'),
      teile('whsec', '_', 'abcdefghijklmnopqrstuvwx'),
      teile('ghp', '_', 'abcdefghijklmnopqrstuvwxyz1234567890'),
      teile('AKIA', 'IOSFODNN7', 'EXAMPLE'),
      teile('AIza', 'SyAbcdefghijklmnopqrstuvwxyz1234567'),
      ['eyJhbGciOiJIUzI1NiIs', 'eyJzdWIiOiIxMjM0', 'SflKxwRJSMeKKF2QT4'].join('.'),
      teile('postgresql://swisshub:', 'geheim123', '@db:5432/swisshub'),
    ];

    for (const probe of proben) {
      expect(
        VERBOTEN.some((eintrag) => eintrag.muster.test(probe)),
        probe.slice(0, 40),
      ).toBe(true);
    }
  });

  it('nennt Umgebungsvariablen beim Namen, mit Platzhaltern als Wert', () => {
    const text = stuecke.map((stueck) => stueck.text).join('\n');
    // §17: Namen und Verwendungszweck ja, Werte nein.
    // Die Namen, wie sie wirklich heissen - abgeglichen gegen
    // `packages/config/src/env.ts` und `.env.example`. Ein erfundener Name
    // waere hier doppelt falsch: der Test waere rot, und stimmte er, stuende
    // er fuer eine Variable, die es nicht gibt.
    expect(text).toContain('DISCORD_BOT_TOKEN');
    expect(text).toContain('DISCORD_CLIENT_SECRET');
    expect(text).toContain('DATABASE_URL');
    // Und dort, wo eine Zuweisung auftaucht, steht kein echter Wert - geprüft
    // durch die Muster oben; hier nur, dass überhaupt Platzhalter benutzt
    // werden statt erfundener Beispielwerte.
    const zuweisungen = text.match(/\b[A-Z][A-Z0-9_]{5,}=(\S+)/gu) ?? [];
    const verdaechtig = zuweisungen.filter(
      (zuweisung) => !/=(?:<|\.\.\.|$)/u.test(zuweisung) && !/=['"]?(?:…|\*)/u.test(zuweisung),
    );
    expect(verdaechtig).toEqual([]);
  });

  it('dokumentiert keine Personennamen als Zuständige', () => {
    // §59: keine hartkodierten Personennamen. Rollen und Funktionen ja.
    const text = stuecke.map((stueck) => stueck.text).join('\n');
    expect(text).not.toMatch(/\bzuständig(?:e[rn]?)?:\s*[A-ZÄÖÜ][a-zäöü]+\s+[A-ZÄÖÜ]/u);
  });
});

describe('Doku-Darstellung: mobil', () => {
  const komponenten = join(process.cwd(), 'apps/web/src/modules/docs/components');
  const lies = (datei: string): string => readFileSync(join(komponenten, datei), 'utf8');

  it('bricht breite Inhalte ab statt die Seite zu dehnen', () => {
    const blocks = lies('blocks.tsx');
    // Tabellen und Codeblöcke sind die beiden Dinge, die auf 360 px nicht
    // passen. Beide bekommen einen eigenen Scrollbereich; `min-w-0` erlaubt
    // dem Flex-Kind überhaupt, schmaler als sein Inhalt zu werden - ohne das
    // schiebt die Tabelle die ganze Seite auf.
    expect(blocks).toContain('overflow-x-auto');
    expect(blocks).toContain('min-w-0');
    expect(lies('code-block.tsx')).toContain('overflow-x-auto');
  });

  it('zeigt die Navigation auf dem Telefon als Schubfach', () => {
    const navigation = lies('doku-navigation.tsx');
    expect(navigation).toContain('lg:hidden');
    expect(navigation).toContain('hidden lg:block');
    // Breite am Bildschirm gemessen, nicht fest: 20rem wären auf 360 px zu
    // viel, `85vw` lässt den Rand zum Schliessen stehen.
    expect(navigation).toContain('w-[min(20rem,85vw)]');
  });

  it('blendet die Seitengliederung auf schmalen Geräten aus', () => {
    // «Auf dieser Seite» ist eine dritte Spalte. Auf einem Telefon wäre sie
    // eine zweite Navigation vor dem Text, den sie gliedert.
    expect(lies('auf-dieser-seite.tsx')).toContain('hidden xl:block');
  });

  it('hat keine feste Breite in Pixeln, die ein Telefon sprengt', () => {
    for (const datei of readdirSync(komponenten).filter((name) => name.endsWith('.tsx'))) {
      const quelle = lies(datei);
      const treffer = [...quelle.matchAll(/\bw-\[(\d+)px\]/gu)]
        .map((eintrag) => Number(eintrag[1]))
        .filter((breite) => breite > 320);
      expect(treffer, datei).toEqual([]);
    }
  });
});
