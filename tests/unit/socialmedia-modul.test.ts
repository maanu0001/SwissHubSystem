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
 * Social Media: ein Zugriffspunkt - und seit dem Post Creator ein Arbeitsplatz.
 *
 * ## Die Grenze hat sich verschoben, und zwar absichtlich
 *
 * Dieser Bereich besass urspruenglich **nichts**: keine Tabelle, keine Server
 * Action, keinen Entwurfszustand. Das war richtig, solange er nur zeigte, was
 * in «SwissHub fragt», «Clip of the Week» und «Wrapped» ohnehin entsteht.
 *
 * Der Post Creator aendert das an genau einer Stelle: ein freier Post hat kein
 * Ursprungsmodul. Er entsteht hier, also gehoert er hierher - mit eigener
 * Tabelle (`SocialPost`) und eigenen Server Actions.
 *
 * Was **nicht** gewandert ist, ist das Eigentum an fremden Daten. Die vier
 * Uebersichtsseiten lesen weiterhin und schreiben nichts; eine Frage, ein Clip
 * und ein Rueckblick liegen weiterhin in ihrem Modul. Genau das haelt dieser
 * Test fest - nicht mehr «besitzt nichts», sondern «besitzt nur das Eigene».
 *
 * Drei Zusicherungen bleiben:
 *
 *   1. **Es kopiert nichts.** Die Uebersichtsseiten und `server/socialmedia.ts`
 *      schreiben in keine Tabelle, und die Post-Actions fassen ausschliesslich
 *      `socialPost` an.
 *   2. **Es zeichnet nur an einer Stelle.** Die Uebersichtsseiten zeichnen
 *      gar nicht; der Post Creator zeichnet in `post-folie.tsx`, und Vorschau
 *      wie Export gehen durch dieselbe Route.
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

  it('trennt «Bereich sehen» von dem, was man im Post Creator tun darf (§50)', () => {
    /*
     * Sechs Rechte und nicht eines.
     *
     * Vorher war es eines, weil alles Tun in einem anderen Modul lag. Mit dem
     * Post Creator liegt es hier - und dann ist «darf mitarbeiten» etwas
     * anderes als «darf aufraeumen». Die Liste steht hier vollstaendig, damit
     * ein neu erfundenes Recht auffaellt, statt sich dazuzusetzen.
     */
    expect(definition?.permissions.map((eintrag) => eintrag.key)).toEqual([
      'socialmedia.view',
      'socialmedia.posts.view',
      'socialmedia.posts.create',
      'socialmedia.posts.edit',
      'socialmedia.posts.export',
      'socialmedia.posts.delete',
    ]);
  });

  it('markiert nur das Löschen als kritisch', () => {
    // Eine Vorlage anzulegen ist Alltag; einen Post endgueltig zu loeschen ist
    // die eine Richtung ohne Rueckweg.
    const kritisch = definition?.permissions
      .filter((eintrag) => eintrag.critical)
      .map((eintrag) => eintrag.key);
    expect(kritisch).toEqual(['socialmedia.posts.delete']);
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

describe('Social Media: es besitzt nur das Eigene', () => {
  it('hält keine Kopie einer Frage, eines Clips oder eines Rückblicks', () => {
    /*
     * Die Zusicherung, auf die es ankommt.
     *
     * `SocialPost` darf es geben - das ist der freie Post, der hier entsteht.
     * Was es nicht geben darf, ist eine zweite Tabelle fuer Daten, die schon
     * jemandem gehoeren: dann gaebe es zwei Antworten auf die Frage, was in
     * einer Abstimmung stand.
     */
    const schema = readFileSync('packages/database/prisma/schema.prisma', 'utf8');
    expect(schema).toMatch(/model SocialPost \{/u);
    for (const verboten of [
      /model SocialMediaFrage/u,
      /model SocialMediaClip/u,
      /model SocialMediaWrapped/u,
      /model SocialMediaEntwurf/u,
    ]) {
      expect(schema, String(verboten)).not.toMatch(verboten);
    }
  });

  it('fasst in seinen Server Actions nur die eigene Tabelle an', () => {
    /*
     * Es gibt jetzt Server Actions - der Post Creator schreibt. Die Frage ist
     * nicht mehr «ob», sondern «woran»: alles, was sie anfassen, laeuft ueber
     * den Dienst `socialmedia.*`, und der kennt nur `socialPost`.
     *
     * Ein direkter Prisma-Zugriff auf eine fremde Tabelle waere genau der
     * Schritt, mit dem aus dem Arbeitsplatz ein zweites Datenmodul wird.
     */
    const quelle = readFileSync('apps/web/src/modules/socialmedia/actions.ts', 'utf8');
    for (const fremd of [
      'prisma.fragtAbstimmung',
      'prisma.fragtEntwurf',
      'prisma.clipCompetition',
      'prisma.wrappedCampaign',
      'prisma.tournament',
    ]) {
      expect(quelle, fremd).not.toContain(fremd);
    }
  });

  it('liest den Turnierbaum, statt ihn zu speichern (§45)', () => {
    // Am Post steht die Kennung des Turniers, nie seine Paarungen. Sonst
    // zeigte ein Export von heute den Stand von vorgestern.
    const dienst = readFileSync('packages/modules/src/socialmedia/posts.ts', 'utf8');
    expect(dienst).toContain('tournamentId');
    expect(dienst).not.toContain('prisma.tournamentMatch');
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
