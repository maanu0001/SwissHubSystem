import { describe, expect, it } from 'vitest';
import '@swisshub/modules';
import { finde, sucheIndex } from '../../apps/web/src/modules/docs/register';
import { zerlegeInline, nurText, linksIn } from '../../apps/web/src/modules/docs/inline';
import { hervorhebe } from '../../apps/web/src/modules/docs/components/hervorhebung';
import { ENTWICKLER_DOKU, TEAM_DOKU } from '../../apps/web/src/modules/docs/werk';

/**
 * Suche, Inline-Auszeichnung und Hervorhebung.
 *
 * Alle drei laufen ohne Datenbank und ohne Netz: der Index entsteht aus den
 * Inhaltsdateien, die Auszeichnung ist ein regulärer Ausdruck, die
 * Hervorhebung ein Tokenizer. Das ist der Grund, warum die Suche pro
 * Tastendruck nichts kostet - es gibt keine Abfrage, die sie auslösen könnte.
 */

describe('Doku-Suche', () => {
  const entwicklerIndex = sucheIndex(ENTWICKLER_DOKU);
  const teamIndex = sucheIndex(TEAM_DOKU);

  it('hat je Seite und je Abschnitt einen Eintrag', () => {
    expect(entwicklerIndex.length).toBeGreaterThan(50);
    expect(teamIndex.length).toBeGreaterThan(50);
    for (const eintrag of [...entwicklerIndex, ...teamIndex]) {
      expect(eintrag.href.startsWith('/system/docs/')).toBe(true);
      expect(eintrag.titel.length).toBeGreaterThan(0);
    }
  });

  it('findet einen Modulnamen', () => {
    const treffer = finde(teamIndex, 'workspace');
    expect(treffer.length).toBeGreaterThan(0);
    expect(treffer.some((eintrag) => eintrag.href.includes('/workspace'))).toBe(true);
  });

  it('findet einen Fachbegriff in der Entwickler-Doku', () => {
    expect(finde(entwicklerIndex, 'permission engine').length).toBeGreaterThan(0);
    expect(finde(entwicklerIndex, 'migration').length).toBeGreaterThan(0);
    expect(finde(entwicklerIndex, 'deployment').length).toBeGreaterThan(0);
  });

  it('findet auch im Fliesstext, nicht nur in Titeln', () => {
    // «Verweigern schlaegt Erlauben» steht in keinem Titel.
    const treffer = finde(teamIndex, 'verweigern');
    expect(treffer.length).toBeGreaterThan(0);
  });

  it('verlangt alle Begriffe', () => {
    const beide = finde(teamIndex, 'workspace aufgaben');
    expect(beide.length).toBeGreaterThan(0);
    expect(finde(teamIndex, 'workspace gibtesnichtalsbegriff')).toEqual([]);
  });

  it('ordnet Titeltreffer vor Texttreffer', () => {
    const treffer = finde(teamIndex, 'premium');
    expect(treffer.length).toBeGreaterThan(1);
    expect(treffer[0]!.titel.toLowerCase()).toContain('premium');
  });

  it('gibt bei leerer Anfrage nichts zurück', () => {
    expect(finde(teamIndex, '')).toEqual([]);
    expect(finde(teamIndex, '   ')).toEqual([]);
  });

  it('gibt bei einer Anfrage ohne Treffer nichts zurück', () => {
    expect(finde(teamIndex, 'zqxwv')).toEqual([]);
    expect(finde(entwicklerIndex, 'zqxwv')).toEqual([]);
  });

  it('achtet nicht auf Gross- und Kleinschreibung', () => {
    expect(finde(teamIndex, 'PREMIUM').length).toBe(finde(teamIndex, 'premium').length);
  });

  it('hält die Grenze ein', () => {
    expect(finde(teamIndex, 'e', 5).length).toBeLessThanOrEqual(5);
  });
});

describe('Inline-Auszeichnung', () => {
  it('erkennt Code, Fettes und Links', () => {
    const teile = zerlegeInline('Siehe `datei.ts` und **wichtig** sowie [Ziel](/dashboard).');
    expect(teile.some((teil) => teil.art === 'code' && teil.text === 'datei.ts')).toBe(true);
    expect(teile.some((teil) => teil.art === 'fett' && teil.text === 'wichtig')).toBe(true);
    expect(teile.some((teil) => teil.art === 'link' && teil.href === '/dashboard')).toBe(true);
  });

  it('lässt HTML stehen, statt es zu deuten', () => {
    /*
     * Der Grund, warum es diese Zerlegung ueberhaupt gibt: der Text wird als
     * Text gerendert, nie als HTML. Ein `<script>` im Inhalt bleibt ein
     * Wort - es gibt keine Stelle, die `dangerouslySetInnerHTML` aufruft.
     */
    const teile = zerlegeInline('<script>alert(1)</script>');
    expect(teile).toHaveLength(1);
    expect(teile[0]!.art).toBe('text');
    expect(teile[0]!.text).toBe('<script>alert(1)</script>');
  });

  it('nurText entfernt die Auszeichnung', () => {
    expect(nurText('Siehe `datei.ts` und **wichtig** sowie [Ziel](/dashboard).')).toBe(
      'Siehe datei.ts und wichtig sowie Ziel.',
    );
  });

  it('linksIn nennt die Ziele', () => {
    expect(linksIn('[A](/a) und [B](https://example.test/b)')).toEqual(['/a', 'https://example.test/b']);
    expect(linksIn('ohne Link')).toEqual([]);
  });
});

describe('Code-Hervorhebung', () => {
  it('erkennt Schlüsselwörter, Texte, Zahlen und Kommentare', () => {
    const token = hervorhebe("const x = 42; // Hinweis\nconst y = 'wert';", 'ts');
    const arten = new Set(token.map((t) => t.art));
    expect(arten.has('schluessel')).toBe(true);
    expect(arten.has('zahl')).toBe(true);
    expect(arten.has('kommentar')).toBe(true);
    expect(arten.has('text')).toBe(true);
  });

  it('gibt den Inhalt unverändert zurück, wenn man die Token zusammensetzt', () => {
    /*
     * Die wichtigste Eigenschaft eines Tokenizers, der Quelltext anzeigt:
     * er darf nichts verlieren und nichts erfinden. Faellt ein Zeichen weg,
     * steht im Codeblock etwas anderes als in der Datei.
     */
    const proben: readonly [string, Parameters<typeof hervorhebe>[1]][] = [
      ["const a = 'x'; // y", 'ts'],
      ['SELECT * FROM "RolePermission" WHERE id = 1;', 'sql'],
      ['npm run check # alles', 'bash'],
      ['{ "a": 1, "b": null }', 'json'],
      ['model User {\n  id String @id\n}', 'prisma'],
      ['einfach nur Text', 'text'],
    ];
    for (const [inhalt, sprache] of proben) {
      expect(
        hervorhebe(inhalt, sprache)
          .map((t) => t.wert)
          .join(''),
        sprache,
      ).toBe(inhalt);
    }
  });

  it('verschluckt eine leere Eingabe nicht', () => {
    expect(
      hervorhebe('', 'ts')
        .map((t) => t.wert)
        .join(''),
    ).toBe('');
  });
});
