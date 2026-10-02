import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildNavigation,
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

  it('steht bei den Modulen und nicht bei System', () => {
    // Es ist woechentliche Arbeit und keine Verwaltung des Servers - genau der
    // Grund, warum das Wrapped Studio unter System niemand gefunden hat.
    expect(definition?.navigation.map((eintrag) => eintrag.group)).toEqual(['modules']);
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

  it('steht bei den Modulen und nicht mehr unter System', () => {
    /*
     * Dort lag er neben Discord-Sync und den Sicherungen, und dort sucht
     * niemand etwas, das man postet. Jetzt liegt er direkt hinter «Social
     * Media».
     */
    expect(wrappedDefinition?.navigation.map((eintrag) => eintrag.group)).toEqual(['modules']);
    expect(wrappedDefinition?.navigation[0]?.order).toBe(28);
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
