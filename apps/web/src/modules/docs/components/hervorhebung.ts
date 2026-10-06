import type { CodeSprache } from '../typen';

/**
 * Syntaxhervorhebung fuer die Doku - klein und ohne Abhaengigkeit.
 *
 * ## Warum nicht Shiki oder Prism
 *
 * Weil der Gegenwert nicht stimmt. Eine echte Hervorhebung bringt Grammatiken
 * fuer Dutzende Sprachen mit, bei Shiki als WASM; gebraucht werden hier sechs
 * Sprachen und vier Farben. Der Unterschied zwischen einem richtigen Parser
 * und diesem Muster ist in einem Doku-Schnipsel von zehn Zeilen nicht zu
 * sehen - der Unterschied im Auslieferungsgewicht schon.
 *
 * ## Was es kann, und was nicht
 *
 * Es erkennt Kommentare, Zeichenketten, Zahlen und Schluesselwoerter, in
 * dieser Reihenfolge. Es versteht **keine** Verschachtelung: ein
 * Schluesselwort innerhalb einer Zeichenkette bleibt Zeichenkette, weil
 * Zeichenketten vorher gewinnen, aber eine Zeichenkette ueber mehrere Zeilen
 * im Kommentar kann es verwirren. Fuer die Beispiele hier reicht das; wo es
 * nicht reicht, ist `sprache: 'text'` die ehrliche Antwort.
 *
 * Laeuft auf dem Server: der Codeblock ist eine Serverkomponente, und der
 * Browser bekommt fertiges Markup statt eines Hervorhebers.
 */

export type TokenArt = 'klar' | 'kommentar' | 'text' | 'zahl' | 'schluessel';

export interface Token {
  art: TokenArt;
  wert: string;
}

const SCHLUESSEL: Record<CodeSprache, readonly string[]> = {
  ts: [
    'async',
    'await',
    'const',
    'let',
    'var',
    'function',
    'return',
    'if',
    'else',
    'for',
    'of',
    'in',
    'while',
    'switch',
    'case',
    'break',
    'continue',
    'throw',
    'try',
    'catch',
    'finally',
    'new',
    'class',
    'extends',
    'implements',
    'interface',
    'type',
    'enum',
    'export',
    'import',
    'from',
    'as',
    'default',
    'readonly',
    'public',
    'private',
    'static',
    'void',
    'null',
    'undefined',
    'true',
    'false',
    'this',
    'typeof',
    'instanceof',
    'satisfies',
    'keyof',
  ],
  tsx: [
    'async',
    'await',
    'const',
    'let',
    'function',
    'return',
    'if',
    'else',
    'for',
    'of',
    'export',
    'import',
    'from',
    'as',
    'default',
    'type',
    'interface',
    'null',
    'undefined',
    'true',
    'false',
    'void',
    'readonly',
  ],
  bash: [
    'cd',
    'npm',
    'npx',
    'git',
    'docker',
    'sudo',
    'echo',
    'export',
    'if',
    'then',
    'fi',
    'for',
    'do',
    'done',
    'while',
    'exit',
    'run',
    'chown',
    'systemctl',
    'psql',
  ],
  sql: [
    'SELECT',
    'FROM',
    'WHERE',
    'INSERT',
    'INTO',
    'VALUES',
    'UPDATE',
    'SET',
    'DELETE',
    'JOIN',
    'LEFT',
    'INNER',
    'ON',
    'AND',
    'OR',
    'NOT',
    'IN',
    'ORDER',
    'BY',
    'GROUP',
    'LIMIT',
    'CREATE',
    'TABLE',
    'ALTER',
    'ADD',
    'COLUMN',
    'INDEX',
    'UNIQUE',
    'NULL',
    'DEFAULT',
  ],
  prisma: [
    'model',
    'enum',
    'datasource',
    'generator',
    'String',
    'Int',
    'Boolean',
    'DateTime',
    'Json',
    'Decimal',
    'BigInt',
    'Bytes',
  ],
  json: ['true', 'false', 'null'],
  text: [],
};

/*
 * Ein Muster je Sprachfamilie.
 *
 * Die Gruppen stehen in der Reihenfolge, in der sie gewinnen: Kommentar,
 * Zeichenkette, Zahl. Was uebrig bleibt, wird gegen die Schluesselwortliste
 * geprueft.
 */
const KOMMENTAR: Record<string, RegExp | null> = {
  ts: /\/\/[^\n]*|\/\*[\s\S]*?\*\//u,
  tsx: /\/\/[^\n]*|\/\*[\s\S]*?\*\//u,
  bash: /#[^\n]*/u,
  sql: /--[^\n]*/u,
  prisma: /\/\/[^\n]*/u,
  json: null,
  text: null,
};

/** Zerlegt Code in Token. */
export function hervorhebe(inhalt: string, sprache: CodeSprache): Token[] {
  if (sprache === 'text') {
    return [{ art: 'klar', wert: inhalt }];
  }

  const kommentar = KOMMENTAR[sprache];
  const teile: string[] = [
    ...(kommentar ? [kommentar.source] : []),
    // Zeichenketten in drei Anfuehrungsarten.
    String.raw`"(?:[^"\\\n]|\\.)*"`,
    String.raw`'(?:[^'\\\n]|\\.)*'`,
    '`(?:[^`\\\\]|\\\\.)*`',
    // Zahlen, auch mit Unterstrichen wie `10_000`.
    String.raw`\b\d[\d_]*(?:\.\d+)?\b`,
    // Woerter - danach gegen die Liste geprueft.
    String.raw`\b[A-Za-z_$][\w$]*\b`,
  ];
  const muster = new RegExp(teile.join('|'), 'gu');
  const woerter = new Set(SCHLUESSEL[sprache]);

  const token: Token[] = [];
  let zuletzt = 0;
  const schiebe = (art: TokenArt, wert: string): void => {
    const vorher = token[token.length - 1];
    // Gleiche Art direkt hintereinander zu einem Token zusammenziehen - das
    // haelt das Markup klein.
    if (vorher && vorher.art === art) {
      vorher.wert += wert;
      return;
    }
    token.push({ art, wert });
  };

  for (const treffer of inhalt.matchAll(muster)) {
    const start = treffer.index;
    if (start > zuletzt) {
      schiebe('klar', inhalt.slice(zuletzt, start));
    }
    const wert = treffer[0];
    zuletzt = start + wert.length;

    if (kommentar && new RegExp(`^(?:${kommentar.source})$`, 'u').test(wert)) {
      schiebe('kommentar', wert);
    } else if (/^["'`]/u.test(wert)) {
      schiebe('text', wert);
    } else if (/^\d/u.test(wert)) {
      schiebe('zahl', wert);
    } else if (woerter.has(wert)) {
      schiebe('schluessel', wert);
    } else {
      schiebe('klar', wert);
    }
  }

  if (zuletzt < inhalt.length) {
    schiebe('klar', inhalt.slice(zuletzt));
  }
  return token;
}
