import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildNavigation,
  groupNavigation,
  listModuleDefinitions,
  moduleViewPermissionOf,
  socialmedia,
  wrapped,
} from '@swisshub/modules';

/**
 * Social Media: ein Zugriffspunkt, kein zweites Exportsystem.
 *
 * ## Was hier tatsaechlich geprueft wird
 *
 * Die drei Zusicherungen, die den Bereich von einer Duplizierung unterscheiden:
 *
 *   1. **Es besitzt nichts.** Keine eigene Tabelle, keine Server Action, kein
 *      Entwurfszustand. Was es zeigt, liest es; was man dort tun kann, tut man
 *      im Ursprungsmodul. Ein zweiter Ort mit eigenen Entwuerfen waere ein
 *      zweiter Ort, an dem ein Entwurf anders aussieht als im Studio.
 *   2. **Es zeichnet nichts.** Die Grafiken entstehen in `social-folie.tsx` und
 *      den `/api/.../grafik`-Routen. Eine zweite Zeichenstelle waere eine
 *      zweite Gestalt derselben Grafik.
 *   3. **Kein Lesezeichen bricht.** Der Eintrag «Wrapped Studio» ist aus der
 *      Seitenleiste verschwunden, die Adresse `/system/wrapped` nicht.
 */
const definition = listModuleDefinitions().find(
  (eintrag) => eintrag.id === socialmedia.SOCIAL_MEDIA_MODULE_ID,
);

describe('Social Media: die Registrierung', () => {
  it('ist als Modul angemeldet', () => {
    expect(definition).toBeDefined();
  });

  it('steht unter System und nicht bei der Community', () => {
    /*
     * Unter «Community» steht, was die Gemeinschaft *benutzt* - Kalender,
     * Turniere, Level, Musik. Diesen Bereich benutzt niemand aus der
     * Gemeinschaft: hier arbeitet das Team an dem, was nach draussen geht.
     * Dass die Daten aus Community-Modulen kommen, macht den Arbeitsplatz
     * nicht zu einem Angebot an die Mitglieder.
     */
    expect(definition?.navigation.map((eintrag) => eintrag.group)).toEqual(['system']);
  });

  it('hat genau einen Eintrag in der Seitenleiste', () => {
    // Vier Reiter, ein Eintrag. Die Unternavigation steht auf der Seite.
    expect(definition?.navigation).toHaveLength(1);
    expect(definition?.navigation[0]?.href).toBe('/social-media');
  });

  it('beansprucht die Unterseiten fuer seine Kopfzeile', () => {
    // Ohne `titlePrefix` stuende auf `/social-media/wrapped` kein Titel.
    expect(definition?.navigation[0]?.titlePrefix).toBe('/social-media');
  });

  it('verlangt genau eine Berechtigung: den Bereich sehen', () => {
    expect(definition?.permissions.map((eintrag) => eintrag.key)).toEqual(['socialmedia.view']);
  });

  it('erscheint in der Navigation, wenn das Recht da ist', () => {
    const eintraege = buildNavigation(
      ['socialmedia.view', 'socialmedia.module.view'],
      new Set([socialmedia.SOCIAL_MEDIA_MODULE_ID]),
    );
    expect(eintraege.map((eintrag) => eintrag.href)).toContain('/social-media');
  });

  it('erscheint nicht ohne das Recht', () => {
    const eintraege = buildNavigation([], new Set([socialmedia.SOCIAL_MEDIA_MODULE_ID]));
    expect(eintraege.map((eintrag) => eintrag.href)).not.toContain('/social-media');
  });
});

describe('Social Media: es besitzt und zeichnet nichts', () => {
  it('bringt keine eigene Prisma-Tabelle mit', () => {
    const schema = readFileSync('packages/database/prisma/schema.prisma', 'utf8');
    expect(schema).not.toMatch(/model SocialMedia/u);
  });

  it('hat keine Server Actions - es wird nichts geschrieben', () => {
    expect(existsSync('apps/web/src/modules/socialmedia/actions.ts')).toBe(false);
  });

  const quellen = [
    'apps/web/src/app/(app)/social-media/page.tsx',
    'apps/web/src/app/(app)/social-media/fragt/page.tsx',
    'apps/web/src/app/(app)/social-media/clips/page.tsx',
    'apps/web/src/app/(app)/social-media/wrapped/page.tsx',
    'apps/web/src/server/socialmedia.ts',
  ];

  it.each(quellen)('%s zeichnet keine Grafik selbst', (pfad) => {
    const quelle = readFileSync(pfad, 'utf8');
    // Keine ImageResponse, keine Folienkomponente: der Bereich verlinkt auf die
    // Stellen, die das koennen.
    expect(quelle).not.toContain('ImageResponse');
    expect(quelle).not.toContain('zeichneSocialFolie');
  });

  it.each(quellen)('%s schreibt nicht in die Datenbank', (pfad) => {
    const quelle = readFileSync(pfad, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//gu, '')
      .replace(/^\s*\/\/.*$/gmu, '');
    for (const verboten of ['.create(', '.update(', '.delete(', '.upsert(', '.createMany(']) {
      expect(quelle, `${pfad} enthaelt ${verboten}`).not.toContain(verboten);
    }
  });
});

describe('Wrapped: der Eintrag zieht um, die Adresse bleibt', () => {
  const wrappedDefinition = listModuleDefinitions().find(
    (eintrag) => eintrag.id === wrapped.WRAPPED_MODULE_ID,
  );

  it('steht unter System, direkt hinter Social Media', () => {
    expect(wrappedDefinition?.navigation.map((eintrag) => eintrag.group)).toEqual(['system']);
    expect(wrappedDefinition?.navigation[0]?.order).toBe(28);
  });

  it('liegt hinter Social Media und vor der Serververwaltung', () => {
    /*
     * Die Reihenfolge entsteht aus `order`, nicht aus einer Sonderregel in der
     * Seitenleiste. Dieser Test haelt fest, dass die beiden Zahlen zueinander
     * passen - und dass beide vor den Verwaltungseintraegen liegen, die bei 78
     * beginnen.
     */
    const socialOrder = definition?.navigation[0]?.order ?? 0;
    const wrappedOrder = wrappedDefinition?.navigation[0]?.order ?? 0;
    expect(socialOrder).toBeLessThan(wrappedOrder);
    expect(wrappedOrder).toBeLessThan(78);
  });

  it('heisst «Wrapped» und nicht mehr «Wrapped Studio»', () => {
    // «Studio» war der Name der Werkstatt. In der Seitenleiste steht der Name
    // des Bereichs; die Werkstatt ist, was darin liegt.
    expect(wrappedDefinition?.navigation[0]?.label).toBe('Wrapped');
  });

  it('behaelt seinen Eintrag - «Modul sehen» haengt daran', () => {
    /*
     * Die Zusicherung, die hier beinahe verlorengegangen waere.
     *
     * `moduleViewPermissionOf` leitet `wrapped.module.view` aus der Navigation
     * ab und liefert `null`, wenn ein Modul keinen Eintrag hat. Ohne diesen
     * Schluessel pruefte `requirePagePermission` ihn auch nicht mehr - der
     * Eintrag aus der Seitenleiste zu nehmen waere also das Entfernen eines
     * Riegels vor dem Studio, nicht ein Umzug.
     *
     * Das ist genau einmal passiert und von `permission-presets.test.ts`
     * gefunden worden. Dieser Test sagt, warum es nicht wieder passieren soll.
     */
    expect(wrappedDefinition?.navigation.length).toBeGreaterThan(0);
    expect(moduleViewPermissionOf(wrappedDefinition!)).toBe('wrapped.module.view');
  });

  it('bleibt unter seiner alten Adresse erreichbar', () => {
    expect(wrappedDefinition?.navigation[0]?.href).toBe('/system/wrapped');
  });

  it.each([
    'apps/web/src/app/(app)/system/wrapped/page.tsx',
    'apps/web/src/app/(app)/system/wrapped/[id]/page.tsx',
  ])('%s antwortet weiterhin - kein Lesezeichen bricht', (pfad) => {
    expect(existsSync(pfad)).toBe(true);
  });

  it('ist vom Social-Media-Bereich aus erreichbar', () => {
    // Der Reiter «Wrapped» im Hub listet die Rueckblicke und fuehrt in dieses
    // Studio - das ist die Buendelung, ohne eine Kopie der Daten.
    const quelle = readFileSync('apps/web/src/app/(app)/social-media/wrapped/page.tsx', 'utf8');
    expect(quelle).toContain('systemRoutes.wrappedStudio()');
  });
});

/**
 * Die Gruppen, wie die Seitenleiste sie tatsächlich baut.
 *
 * ## Warum nicht nur die Moduldefinition
 *
 * Weil zwischen `group: 'system'` und dem Abschnitt, den jemand sieht, noch
 * `buildNavigation` und `groupNavigation` liegen. Ein Test auf das Feld allein
 * prüft eine Absicht; dieser prüft das Ergebnis - und zwar in derselben Liste,
 * aus der Desktop, Mobile und Schnellnavigation entstehen. Eine eigene mobile
 * Gruppierung gibt es nicht, deshalb deckt dieser Test beide Geräte ab.
 */
describe('Seitenleiste: Wrapped und Social Media liegen unter System', () => {
  const alleRechte = (() => {
    const definitionen = listModuleDefinitions();
    return [
      ...definitionen.flatMap((eintrag) => eintrag.navigation.map((item) => item.permission)),
      ...definitionen.flatMap((eintrag) => eintrag.permissions.map((recht) => recht.key)),
      ...definitionen.map((eintrag) => `${eintrag.permissionPrefix}.module.view`),
    ];
  })();
  const gruppen = groupNavigation(
    buildNavigation(alleRechte, new Set(listModuleDefinitions().map((eintrag) => eintrag.id))),
  );

  const gruppeVon = (href: string): string | null =>
    gruppen.find((gruppe) => gruppe.items.some((item) => item.href === href))?.id ?? null;

  it('baut überhaupt Gruppen - sonst sagt der Rest nichts aus', () => {
    expect(gruppen.length).toBeGreaterThan(3);
    expect(gruppen.map((gruppe) => gruppe.id)).toContain('system');
  });

  it.each([
    ['Social Media', '/social-media'],
    ['Wrapped', '/system/wrapped'],
  ])('%s liegt in der Gruppe system', (_name, href) => {
    expect(gruppeVon(href)).toBe('system');
  });

  it.each([
    ['Social Media', '/social-media'],
    ['Wrapped', '/system/wrapped'],
  ])('%s liegt nicht mehr bei der Community', (_name, href) => {
    // `modules` ist die Gruppe, die in der Oberfläche «Community» heisst.
    expect(gruppeVon(href)).not.toBe('modules');
  });

  it('lässt die Community-Module dort, wo sie sind', () => {
    // Die Gegenprobe: der Umzug darf nicht die halbe Seitenleiste mitnehmen.
    for (const href of ['/clips', '/fragt', '/kalender', '/level', '/turniere/uebersicht']) {
      expect(gruppeVon(href), href).toBe('modules');
    }
  });

  it('nennt die Gruppe system weiterhin «System»', () => {
    expect(gruppen.find((gruppe) => gruppe.id === 'system')?.label).toBe('System');
  });

  it('steht in der Gruppe system vor der Serververwaltung', () => {
    const system = gruppen.find((gruppe) => gruppe.id === 'system');
    const positionen = system?.items.map((item) => item.href) ?? [];
    const socialIndex = positionen.indexOf('/social-media');
    const wrappedIndex = positionen.indexOf('/system/wrapped');
    const botIndex = positionen.indexOf('/system/bot');

    expect(socialIndex).toBeGreaterThanOrEqual(0);
    expect(socialIndex).toBeLessThan(wrappedIndex);
    expect(wrappedIndex).toBeLessThan(botIndex);
  });
});
