import { describe, expect, it } from 'vitest';

/**
 * Jede Server Action prüft die Berechtigung serverseitig.
 *
 * Eine Server Action ist ein öffentlicher HTTP-Endpunkt: Next.js erzeugt für
 * jede exportierte Funktion in einer `'use server'`-Datei eine aufrufbare
 * Adresse. Ob die Oberfläche den zugehörigen Knopf anzeigt, spielt dabei keine
 * Rolle - wer die Adresse kennt, ruft sie auf.
 *
 * Deshalb muss jede Action entweder eine feste `permission` deklarieren oder
 * im Rumpf ausdrücklich prüfen (das ist nötig, wo die Berechtigung erst zur
 * Laufzeit feststeht - etwa bei den Moduleinstellungen). Diese Prüfung
 * arbeitet auf dem Quelltext und fängt damit auch eine Action ab, die niemand
 * getestet hat.
 */
const { globSync, readFileSync } = await import('node:fs');
const { join } = await import('node:path');

/**
 * Alle Aktionsdateien - auf deutsch wie auf englisch benannt.
 *
 * Das Muster hiess lange nur `{actions,*-actions}.ts`. Die Module, deren
 * Dateien `aktionen.ts` heissen - Spielwahl, Wrapped, Profil, die
 * Auszeichnungen -, liefen deshalb nie durch diesen Test: sechs Dateien, die
 * ein Waechter zu bewachen glaubte und nicht einmal gelesen hatte.
 *
 * Deshalb steht hier beides, und deshalb prueft der Test unten ausserdem,
 * dass er alle Dateien findet, die nach einer Aktionsdatei aussehen. Ein
 * Muster, das lueckenhaft ist, faellt sonst genau dann auf, wenn die Luecke
 * ausgenutzt wurde.
 */
const FILES = globSync('apps/web/src/modules/*/{actions,*-actions,aktionen,*-aktionen}.ts', {
  cwd: process.cwd(),
}).sort();

/** Ausdrücke, die eine Prüfung im Rumpf der Action darstellen. */
const EXPLICIT_CHECKS = [
  'assertConfigurationAccess',
  'assertSetupAccess',
  'assertPermission',
  // Kalender: die Zustaendigkeit fuer genau diesen Termin. `calendar.edit`
  // deckt alle Termine ab, `calendar.manageOwn` nur die eigenen - das laesst
  // sich nicht als eine feste Permission ausdruecken.
  'requireEventZugriff',
];

interface Action {
  file: string;
  name: string;
  body: string;
}

/** Alle `export const x = defineAction({...}, handler)` einer Datei. */
function actionsOf(file: string): Action[] {
  const source = readFileSync(join(process.cwd(), file), 'utf8');
  const found: Action[] = [];
  const pattern = /^export const (\w+) = defineAction\(\n([\s\S]*?)^\);$/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    found.push({ file, name: match[1] ?? '', body: match[2] ?? '' });
  }
  return found;
}

const actions = FILES.flatMap(actionsOf);

/**
 * Die oeffentlichen Aktionen - die Ausnahme, und sie traegt ihre eigene Pflicht.
 *
 * `defineOeffentlicheAktion` laeuft ohne Anmeldung, ohne Mitgliedschaft und
 * ohne Berechtigung: ein Gast in einer Spielauswahl hat keine davon. An deren
 * Stelle tritt genau eine Pruefung, und dieser Test verlangt sie von jeder
 * dieser Aktionen - `verlangeGastZugang` prueft die Form der Kennung, dass die
 * Runde Gaeste zulaesst und dass sie noch laeuft.
 *
 * Die Liste ist ausdruecklich eine Liste und keine Suche ueber alle Dateien:
 * eine neue Datei mit oeffentlichen Aktionen muss hier eingetragen werden, und
 * das ist die Gelegenheit, an der jemand hinsieht.
 */
const GAST_FILES = ['apps/web/src/modules/spielwahl/gast-aktionen.ts'];

/** Alle `export const x = defineOeffentlicheAktion({...}, handler)`. */
function oeffentlicheAktionenOf(file: string): Action[] {
  const source = readFileSync(join(process.cwd(), file), 'utf8');
  const found: Action[] = [];
  const pattern = /^export const (\w+) = defineOeffentlicheAktion\(\n([\s\S]*?)^\);$/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    found.push({ file, name: match[1] ?? '', body: match[2] ?? '' });
  }
  return found;
}

const gastAktionen = GAST_FILES.flatMap(oeffentlicheAktionenOf);

describe('Server Actions', () => {
  it('findet die Actions der Anwendung', () => {
    expect(FILES.length).toBeGreaterThan(5);
    expect(actions.length).toBeGreaterThan(40);
  });

  it('laesst keine Aktionsdatei aus', () => {
    /*
     * Die Gegenprobe zum Muster oben.
     *
     * Gesucht wird jede Datei unter `modules/*`, die `defineAction` oder
     * `defineOeffentlicheAktion` enthaelt - unabhaengig davon, wie sie heisst.
     * Jede davon muss von `FILES` erfasst sein. Ohne diesen Test ist ein
     * unvollstaendiges Dateimuster ein Waechter, der schweigt.
     */
    const alle = globSync('apps/web/src/modules/**/*.ts', { cwd: process.cwd() })
      .filter((datei) => {
        const inhalt = readFileSync(join(process.cwd(), datei), 'utf8');
        return inhalt.includes('defineAction(') || inhalt.includes('defineOeffentlicheAktion(');
      })
      .sort();

    expect(alle.filter((datei) => !FILES.includes(datei) && !GAST_FILES.includes(datei))).toEqual([]);
  });

  it.each(actions.map((a) => [`${a.file.split('/').at(-2)}/${a.name}`, a] as const))(
    '%s prüft die Berechtigung',
    (_label, action) => {
      // `permission: undefined` erfuellt zwar die Schreibweise, deklariert
      // aber nichts - es waere ein Waechter, der bei der einen Form
      // wegsieht, auf die es ankommt.
      const declared =
        /\bpermission:\s*\S/.test(action.body) && !/\bpermission:\s*undefined/.test(action.body);
      const explicit = EXPLICIT_CHECKS.some((check) => action.body.includes(check));
      // Dritte zulässige Form: Selbstbedienung. Die Aktion wirkt dann
      // ausschliesslich auf die Daten des Aufrufers und braucht keine
      // Verwaltungsberechtigung - ein Mitglied schliesst sein eigenes Abo ab.
      // Bewusst eine ausdrückliche Kennzeichnung und keine Ableitung: eine
      // Aktion, die "ctx.user.id" bloss erwähnt, ist damit nicht abgedeckt.
      const selbstbedienung = /\bselfService:\s*true/.test(action.body);
      // Vierte Form: der Antragsteller-Zugang. Er ist die einzige Stelle ohne
      // Guild-Mitgliedschaft - und deshalb die einzige, die eine eigene
      // Eigentumsprüfung mitbringen muss. Sie wird unten geprüft.
      const antragsteller = /\bapplicant:\s*true/.test(action.body);
      expect(
        declared || explicit || selbstbedienung || antragsteller,
        `${action.name}: weder "permission:", noch eine ausdrückliche Prüfung im Rumpf, noch "selfService: true", noch "applicant: true"`,
      ).toBe(true);
    },
  );

  /**
   * Der Antragsteller-Zugang trägt seine Prüfung im Rumpf.
   *
   * `applicant: true` nimmt die Mitgliedschaft aus der Kette - und damit das
   * einzige Glied, das bisher jeden Fremden abgewiesen hat. An seine Stelle
   * muss eine stärkere Prüfung treten: gehört dieser Datensatz dem
   * Aufrufer? Ohne sie könnte jeder angemeldete Discord-Benutzer den Antrag
   * eines anderen öffnen.
   *
   * Geprüft wird auf den Aufruf eines Helfers, dessen Name die Prüfung
   * benennt - nicht auf eine beliebige Erwähnung von `discordId`. Eine
   * Aktion, die die Kennung bloss weiterreicht, ist damit nicht abgedeckt.
   */
  const ANTRAGSTELLER_PRUEFUNGEN = ['requireEigenerAppeal', 'assertEigenerAppeal'];

  const antragstellerActions = actions.filter((action) => /\bapplicant:\s*true/.test(action.body));

  const antragstellerFaelle: Array<[string, Action | null]> =
    antragstellerActions.length > 0
      ? antragstellerActions.map((a) => [`${a.file.split('/').at(-2)}/${a.name}`, a])
      : [['(derzeit keine)', null]];

  it.each(antragstellerFaelle)('%s prüft das Eigentum am Datensatz', (_label, action) => {
    if (!action) {
      expect(antragstellerActions).toHaveLength(0);
      return;
    }
    expect(
      ANTRAGSTELLER_PRUEFUNGEN.some((pruefung) => action.body.includes(pruefung)),
      `${action.name}: "applicant: true" ohne Eigentumsprüfung (${ANTRAGSTELLER_PRUEFUNGEN.join(' / ')})`,
    ).toBe(true);
  });

  it.each(actions.map((a) => [`${a.file.split('/').at(-2)}/${a.name}`, a] as const))(
    '%s validiert die Eingabe',
    (_label, action) => {
      // Ohne Schema landet ungeprüfter Browser-Input im Handler.
      expect(action.body, `${action.name}: kein schema`).toMatch(/\bschema:\s*\S/);
    },
  );

  it('exportiert aus Action-Dateien nichts ausser Actions', () => {
    // Ein anderer Export in einer `'use server'`-Datei waere ebenfalls von
    // aussen aufrufbar - dann jedoch ohne die Absicherungen von defineAction.
    for (const file of [...FILES, ...GAST_FILES]) {
      const source = readFileSync(join(process.cwd(), file), 'utf8');
      const exports = [...source.matchAll(/^export (?:async function|const|function) (\w+)/gm)];
      for (const [line, name] of exports.map((m) => [m[0], m[1]] as const)) {
        expect(line, `${file}: "${name}" ist exportiert, aber keine Action`).toContain('export const');
        expect(
          source.includes(`export const ${name} = defineAction(`) ||
            source.includes(`export const ${name} = defineOeffentlicheAktion(`),
          `${file}: "${name}" ist exportiert, aber keine Action`,
        ).toBe(true);
      }
    }
  });
});

/**
 * Die oeffentlichen Aktionen.
 *
 * Sie haben kein `permission`, keine Mitgliedschaft und keinen `AuthContext` -
 * das ist der Sinn der Sache und die Gefahr daran. Geprueft wird deshalb, dass
 * jede von ihnen genau die Pruefung aufruft, die an die Stelle der drei
 * entfallenen Glieder tritt.
 */
describe('Öffentliche Aktionen (Gäste)', () => {
  it('findet sie', () => {
    expect(gastAktionen.length).toBeGreaterThan(0);
  });

  it.each(gastAktionen.map((a) => [`${a.file.split('/').at(-2)}/${a.name}`, a] as const))(
    '%s prüft den Gastzugang',
    (_label, action) => {
      expect(
        action.body.includes('verlangeGastZugang'),
        `${action.name}: keine "verlangeGastZugang"-Prüfung im Rumpf`,
      ).toBe(true);
    },
  );

  it.each(gastAktionen.map((a) => [`${a.file.split('/').at(-2)}/${a.name}`, a] as const))(
    '%s validiert die Eingabe',
    (_label, action) => {
      expect(action.body, `${action.name}: kein schema`).toMatch(/\bschema:\s*\S/);
    },
  );

  it('schlägt kein Spiel vor und fasst keine Phase an', () => {
    /*
     * Die Liste der Dinge, die ein Gast nicht darf - als Wortliste gegen den
     * Quelltext.
     *
     * Grob, und mit Absicht: sie faellt auch dann, wenn jemand die Funktion
     * bloss importiert. Genau das ist der Fall, den sie fangen soll - der
     * naechste Umbau, in dem «nur mal schnell» ein Aufruf mehr dazukommt.
     */
    const verboten = [
      'schlageVor',
      'nimmZurueck',
      'entferneKandidat',
      'schliesseVorschlaege',
      'oeffneVorschlaege',
      'starte',
      'loseNeu',
      'nochEine',
      'nimmAn',
      'schliesse',
      'entferne',
      'setzeCoHost',
      'uebergib',
      'aendereEinstellungen',
      'wechsle',
    ];
    for (const file of GAST_FILES) {
      const source = readFileSync(join(process.cwd(), file), 'utf8')
        .replaceAll(/\/\*[\s\S]*?\*\//gu, '')
        .replaceAll(/\/\/.*$/gmu, '');
      for (const name of verboten) {
        expect(source, `${file}: ruft "${name}" auf`).not.toContain(`spielwahl.${name}(`);
      }
    }
  });
});
