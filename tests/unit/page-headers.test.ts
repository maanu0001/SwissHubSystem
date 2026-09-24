import { describe, expect, it } from 'vitest';

/**
 * Ein primärer Seitentitel je Seite.
 *
 * Hintergrund: Der Titel einer Modulseite steht in der Module Registry und
 * wird von der Kopfzeile (`AppHeader`) als `<h1>` gerendert. Mehrere Seiten
 * haben denselben Titel zusätzlich als `PageHeader` wiederholt - auf
 * `/level` und `/spielersuche` stand die Überschrift dadurch zweimal
 * untereinander.
 *
 * Diese Prüfung arbeitet auf dem Quelltext statt auf gerendertem HTML: sie
 * deckt damit jede Seite ab, auch solche, die ohne Datenbank und Discord gar
 * nicht rendern würden.
 */
const { buildNavigation, listModuleDefinitions } = await import('@swisshub/modules');
const { readdirSync, readFileSync, statSync } = await import('node:fs');
const { join, relative, sep } = await import('node:path');

const APP_DIR = join(process.cwd(), 'apps/web/src/app/(app)');

/** Alle Seiten unterhalb der geschützten Routengruppe. */
function pageFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      return pageFiles(full);
    }
    return name === 'page.tsx' ? [full] : [];
  });
}

/** Dateipfad -> Route. Gruppenordner in Klammern zählen nicht mit. */
function routeOf(file: string): string {
  const segments = relative(APP_DIR, file)
    .split(sep)
    .slice(0, -1)
    .filter((segment) => !segment.startsWith('('));
  return `/${segments.join('/')}`;
}

/**
 * Sämtliche Navigationseinträge, unabhängig von Berechtigungen.
 *
 * ## Warum «Modul sehen» hier dazugehört
 *
 * `buildNavigation` verlangt zweierlei: die Berechtigung des Eintrags **und**
 * `<präfix>.module.view` für das Modul dahinter. Die zweite steht in keiner
 * `permissions`-Liste - sie wird aus dem Präfix abgeleitet. Wer sie hier
 * vergisst, bekommt eine fast leere Navigation zurück.
 *
 * Genau das ist passiert: von 34 Einträgen kam **einer** an, nämlich
 * `/profil` (der trägt `baseline` und überlebt die Modulsperre). Die Prüfung
 * unten lief damit gegen eine einzige Route, blieb grün und liess einen
 * doppelten Titel im Wrapped Studio durch - bis er im Betrieb auffiel.
 *
 * Deshalb kommen jetzt alle drei Quellen zusammen, und ein Test darunter
 * hält fest, dass die Liste auch wirklich gefüllt ist.
 */
const navigation = (() => {
  const definitionen = listModuleDefinitions();
  const permissions = [
    ...definitionen.flatMap((definition) => definition.navigation.map((item) => item.permission)),
    ...definitionen.flatMap((definition) => definition.permissions.map((eintrag) => eintrag.key)),
    ...definitionen.map((definition) => `${definition.permissionPrefix}.module.view`),
  ];
  const moduleIds = new Set(definitionen.map((definition) => definition.id));
  return buildNavigation(permissions, moduleIds);
})();

const navByHref = new Map(navigation.map((entry) => [entry.href, entry]));
const pages = pageFiles(APP_DIR).sort();

describe('Seitentitel', () => {
  it('findet die Seiten der Anwendung', () => {
    expect(pages.length).toBeGreaterThan(20);
  });

  it('prüft den Titel gegen eine vollständige Navigation', () => {
    /*
     * Der Wächter über dem Wächter.
     *
     * Die Prüfung weiter unten sagt nur dann etwas aus, wenn die Navigation
     * tatsächlich Einträge enthält. Kam sie fast leer zurück - siehe oben -,
     * lief der Test gegen nichts und blieb trotzdem grün. Eine Zahl, die
     * grob zur Modul-Registry passt, fällt auf, wenn das noch einmal
     * passiert.
     */
    expect(navigation.length).toBeGreaterThan(25);
    expect(navByHref.has('/system/wrapped'), 'Wrapped Studio fehlt in der Navigation').toBe(true);
  });

  it.each(pages.map((file) => [relative(APP_DIR, file), file] as const))(
    '%s trägt höchstens einen primären Header',
    (_name, file) => {
      const source = readFileSync(file, 'utf8');
      const headers = source.match(/<PageHeader\b/g)?.length ?? 0;
      expect(headers).toBeLessThanOrEqual(1);
    },
  );

  it.each(pages.map((file) => [relative(APP_DIR, file), file] as const))(
    '%s überlässt der Kopfzeile das <h1>',
    (_name, file) => {
      // Das einzige <h1> der Anwendung steht in `AppHeader`. Ein zweites auf
      // der Seite wäre sowohl doppelt als auch ein Fehler für Screenreader.
      expect(readFileSync(file, 'utf8')).not.toMatch(/<h1[\s>]/);
    },
  );

  it.each(pages.filter((file) => navByHref.has(routeOf(file))).map((file) => [routeOf(file), file] as const))(
    '%s wiederholt den Titel aus der Navigation nicht',
    (route, file) => {
      const source = readFileSync(file, 'utf8');
      const entry = navByHref.get(route)!;

      // Für diese Route liefert die Kopfzeile bereits Titel und Beschreibung.
      expect(source, `${route}: Titel "${entry.label}" steht schon in der Kopfzeile`).not.toMatch(
        /<PageHeader\b/,
      );
    },
  );
});
