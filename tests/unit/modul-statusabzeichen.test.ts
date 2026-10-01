import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  getModuleStatusBadge,
  registerModuleStatusBadge,
  resolveModuleStatusBadges,
} from '@swisshub/modules';

/**
 * Statusabzeichen in der Seitenleiste.
 *
 * ## Was hier tatsaechlich geprueft wird
 *
 * Nicht «steht da Voting» - das ist Darstellung. Sondern die drei Eigenschaften,
 * an denen die Architektur haengt:
 *
 *   1. **Ein Modul meldet seinen Zustand an, die Navigation fragt.** Steht in
 *      der Seitenleiste ein `if` auf einen Modulnamen, ist sie die Stelle, die
 *      alle Modulzustaende kennt - und jedes neue Abzeichen eine Aenderung an
 *      einer Datei, die mit dem Modul nichts zu tun hat.
 *   2. **Alle auf einmal.** Die Seitenleiste steht auf jeder Seite und wird
 *      dreimal gezeichnet. Eine Abfrage je Eintrag und Darstellung waere ein
 *      Dutzend Abfragen pro Seitenaufruf fuer zwei Woerter am Rand.
 *   3. **Ein Fehlschlag ergibt kein Abzeichen und nimmt die anderen nicht
 *      mit.** Ein Zustand, ueber den wir gerade nichts wissen, soll nicht
 *      behauptet werden - und ein Modul, dessen Abfrage scheitert, darf nicht
 *      die Abzeichen der uebrigen loeschen.
 */
describe('Statusabzeichen: die Registry', () => {
  it('gibt zurueck, was ein Modul gemeldet hat', async () => {
    registerModuleStatusBadge({
      moduleId: 'test-mit-zustand',
      resolve: async () => ({ label: 'Laeuft', variant: 'akzent' }),
    });

    const alle = await resolveModuleStatusBadges();
    expect(alle.get('test-mit-zustand')).toEqual({ label: 'Laeuft', variant: 'akzent' });
  });

  it('ergibt bei null kein Abzeichen - der Normalfall', async () => {
    registerModuleStatusBadge({ moduleId: 'test-ohne-zustand', resolve: async () => null });

    const alle = await resolveModuleStatusBadges();
    expect(alle.has('test-ohne-zustand')).toBe(false);
  });

  it('verschluckt einen Fehler und laesst die uebrigen Abzeichen stehen', async () => {
    registerModuleStatusBadge({
      moduleId: 'test-kaputt',
      resolve: async () => {
        throw new Error('Datenbank weg');
      },
    });
    registerModuleStatusBadge({
      moduleId: 'test-daneben',
      resolve: async () => ({ label: 'Da', variant: 'ruhig' }),
    });

    const alle = await resolveModuleStatusBadges();
    expect(alle.has('test-kaputt')).toBe(false);
    // Und genau das ist der Punkt: ein kaputtes Modul nimmt die anderen nicht mit.
    expect(alle.get('test-daneben')?.label).toBe('Da');
  });

  it('beantwortet die Einzelfrage - und ein unbekanntes Modul mit null', async () => {
    registerModuleStatusBadge({
      moduleId: 'test-einzeln',
      resolve: async () => ({ label: 'Einzeln', variant: 'dringend' }),
    });

    expect(await getModuleStatusBadge('test-einzeln')).toEqual({
      label: 'Einzeln',
      variant: 'dringend',
    });
    expect(await getModuleStatusBadge('gibt-es-nicht')).toBeNull();
  });

  it('faengt den Fehler auch in der Einzelfrage', async () => {
    registerModuleStatusBadge({
      moduleId: 'test-einzeln-kaputt',
      resolve: async () => {
        throw new Error('weg');
      },
    });

    await expect(getModuleStatusBadge('test-einzeln-kaputt')).resolves.toBeNull();
  });
});

/** Kommentare raus - ein Modulname in einer Erklaerung ist keine Abfrage. */
function ohneKommentare(quelle: string): string {
  return quelle.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');
}

describe('Statusabzeichen: nichts davon steht in der Seitenleiste', () => {
  const sidebar = ohneKommentare(
    readFileSync('apps/web/src/components/layout/sidebar-nav.tsx', 'utf8'),
  );

  it.each(['clips', 'fragt', 'Einreichung', 'Voting', 'Frage offen'])(
    'kennt %s nicht',
    (begriff) => {
      expect(sidebar).not.toContain(begriff);
    },
  );

  it('stellt die Lautstaerke aus der Variante dar, nicht aus dem Text', () => {
    expect(sidebar).toContain('badgeVariant');
    expect(sidebar).toContain("variante === 'dringend'");
  });
});

describe('Statusabzeichen: die Module melden ihren Zustand selbst an', () => {
  it.each([
    ['clips', 'packages/modules/src/clips/config.ts', ['Einreichung', 'Voting']],
    ['fragt', 'packages/modules/src/fragt/config.ts', ['Frage offen']],
  ])('%s meldet an und kennt seine Label', (_modul, pfad, label) => {
    const quelle = readFileSync(pfad, 'utf8');
    expect(quelle).toContain('registerModuleStatusBadge');
    for (const eintrag of label) {
      expect(quelle).toContain(eintrag);
    }
  });
});
