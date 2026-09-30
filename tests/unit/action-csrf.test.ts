import { describe, expect, it } from 'vitest';

/**
 * Jeder Aufruf einer Server Action führt den CSRF-Token mit.
 *
 * `defineAction` prüft ihn vor allem anderen ausser der Anmeldung, und keine
 * einzige Aktion ist davon ausgenommen (`csrf: false` kommt im ganzen Projekt
 * nicht vor - der Test unten hält das fest). Fehlt der Token, antwortet jede
 * Aktion mit «Sicherheitsprüfung fehlgeschlagen» - und zwar erst im Browser,
 * nicht beim Übersetzen und nicht in einem Modultest.
 *
 * Genau so ist es passiert: die Einrichtung der Discord-Log-Kanäle ging in
 * Produktion, und der erste Klick auf ein Auswahlfeld lief in diese Meldung.
 * Typecheck, Lint und 2824 Prüfungen waren grün - keine davon fasst die
 * Verdrahtung zwischen Seite, Komponente und Aktion an.
 *
 * Diese Prüfung schliesst die Lücke auf dem Quelltext: wer eine Aktion
 * aufruft, muss den Token im Haus haben. Sie folgt ihm nicht bis in den
 * Aufruf hinein - viele Komponenten reichen ihn in einer Nutzlast weiter, und
 * eine Verfolgung über Variablen hinweg wäre mehr Aufwand als Nutzen. Der
 * Fehler, der hier wirklich passiert, ist der ganz vergessene Token, und den
 * fängt sie.
 */
const { globSync, readFileSync } = await import('node:fs');
const { join } = await import('node:path');

const KOMPONENTEN = globSync('apps/web/src/**/*.tsx', { cwd: process.cwd() }).sort();
/**
 * Aktionsdateien - auf deutsch wie auf englisch benannt.
 *
 * Das Muster hiess lange nur `{actions,*-actions}.ts` und liess damit die
 * Module aus, deren Dateien `aktionen.ts` heissen: Spielwahl, Wrapped, Profil,
 * Auszeichnungen. Derselbe Fehler stand in
 * `tests/unit/action-authorization.test.ts` - ein Waechter, der die Haelfte
 * seiner Tuer nicht kannte.
 */
const AKTIONSDATEIEN = globSync('apps/web/src/modules/*/{actions,*-actions,aktionen,*-aktionen}.ts', {
  cwd: process.cwd(),
}).sort();

function lies(datei: string): string {
  return readFileSync(join(process.cwd(), datei), 'utf8');
}

/**
 * Die Namen, die eine Datei aus einem Aktionsmodul importiert.
 *
 * Nur sie zählen. Eine Komponente namens `QuickAction` ist keine Server
 * Action, und ohne diese Einschränkung stünde sie hier als Fehlalarm.
 */
function importierteAktionen(quelltext: string): string[] {
  const namen: string[] = [];
  // `actions` und `aktionen` - dieselbe Sache, zwei Sprachen.
  const muster = /import\s*\{([^}]+)\}\s*from\s*'([^']*(?:actions|aktionen))'/gu;
  let treffer: RegExpExecArray | null;
  while ((treffer = muster.exec(quelltext)) !== null) {
    for (const teil of (treffer[1] ?? '').split(',')) {
      const name = teil
        .trim()
        .split(/\s+as\s+/u)
        .pop()
        ?.trim();
      if (name && (name.endsWith('Action') || name.endsWith('Aktion'))) {
        namen.push(name);
      }
    }
  }
  return namen;
}

const MIT_AKTIONEN = KOMPONENTEN.map((datei) => {
  const quelltext = lies(datei);
  return { datei, quelltext, aktionen: importierteAktionen(quelltext) };
}).filter((eintrag) => eintrag.aktionen.length > 0);

describe('CSRF-Token an den Server Actions', () => {
  it('findet überhaupt Komponenten, die Aktionen aufrufen', () => {
    // Ohne diese Zusicherung wäre die Prüfung unten stillschweigend leer -
    // etwa wenn sich der Zuschnitt der Ordner einmal ändert.
    expect(MIT_AKTIONEN.length).toBeGreaterThan(20);
  });

  it.each(MIT_AKTIONEN.map((eintrag) => [eintrag.datei, eintrag] as const))(
    '%s führt den CSRF-Token mit',
    (_datei, eintrag) => {
      expect(
        eintrag.quelltext.includes('csrfToken'),
        `${eintrag.datei} ruft ${eintrag.aktionen.join(', ')} auf, kennt aber keinen csrfToken. ` +
          'Die Seite muss ihn über `csrfTokenFor(context)` reichen, die Komponente ihn mitsenden - ' +
          'sonst antwortet jede dieser Aktionen mit «Sicherheitsprüfung fehlgeschlagen».',
      ).toBe(true);
    },
  );

  /**
   * Wer sich von der Prüfung ausnimmt, steht hier namentlich.
   *
   * Vorher stand hier «keine einzige Aktion» - und das war falsch, seit das
   * Dateimuster oben die deutsch benannten Aktionsdateien ausliess: das
   * Lebenszeichen der Spielauswahl trug `csrf: false`, und dieser Test hatte
   * die Datei nie gelesen.
   *
   * Statt die Ausnahme nun zu verbieten, werden die zwei benannt, die es gibt:
   *
   *   - `spielwahl.session.ping` - ein Lebenszeichen. Es schreibt genau ein
   *     Feld der eigenen Zeile (`lastSeenAt`) und läuft alle zwanzig Sekunden
   *     aus einem Intervall. Eine fremde Seite, die es auslöst, erreicht
   *     damit, dass jemand als anwesend gilt, der anwesend ist.
   *   - `spielwahl.games.search` - eine Suche im gemeinsamen Spielkatalog.
   *     Sie schreibt nichts. Ein CSRF-Angriff auf eine Leseoperation gibt dem
   *     Angreifer die Antwort ohnehin nicht zu sehen.
   *
   * Der Test wird damit nicht schwächer, sondern genauer: die Namen müssen
   * **genau** stimmen. Eine dritte Ausnahme fällt auf, eine beseitigte auch.
   */
  const CSRF_AUSNAHMEN = ['spielwahl.session.ping', 'spielwahl.games.search'];

  /** Der Name der Aktion, in deren Block ein `csrf: false` steht. */
  function ausnahmeNamen(quelltext: string): string[] {
    const namen: string[] = [];
    for (const treffer of quelltext.matchAll(/csrf: false/gu)) {
      const davor = quelltext.slice(0, treffer.index);
      const name = [...davor.matchAll(/name: '([^']+)'/gu)].at(-1)?.[1];
      namen.push(name ?? '(unbekannt)');
    }
    return namen;
  }

  it('kennt genau die benannten Aktionen ohne CSRF-Prüfung', () => {
    const gefunden = AKTIONSDATEIEN.flatMap((datei) => ausnahmeNamen(lies(datei))).sort();
    expect(gefunden).toEqual([...CSRF_AUSNAHMEN].sort());
  });

  it('gibt einer öffentlichen Gast-Aktion keine Ausnahme', () => {
    /*
     * Die oeffentlichen Aktionen haben keine Anmeldung, aus der ein Angreifer
     * schoepfen koennte - und genau deshalb ist CSRF dort *wichtiger* und
     * nicht unwichtiger: das Gastcookie reist bei jeder Anfrage mit, auch bei
     * einer, die eine fremde Seite ausloest. `defineOeffentlicheAktion` prueft
     * das Token immer; hier wird festgehalten, dass es keinen Schalter dafuer
     * gibt.
     */
    const kette = lies('apps/web/src/server/action.ts');
    const ab = kette.indexOf('export function defineOeffentlicheAktion');
    expect(ab).toBeGreaterThan(0);
    const teil = kette.slice(ab);
    expect(teil, 'defineOeffentlicheAktion prüft kein CSRF-Token').toContain('verifyCsrfToken(');
    // Kein Schalter: weder ein Feld `csrf?: boolean` in der Definition noch ein
    // `csrf: false` irgendwo darin.
    expect(teil, 'defineOeffentlicheAktion kennt einen CSRF-Schalter').not.toMatch(
      /\bcsrf\??:\s*(?:false|boolean)/u,
    );
  });
});
