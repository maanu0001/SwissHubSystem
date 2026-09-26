import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listModuleDefinitions } from '../../packages/modules/src/registry';
import { STREAMER_MODULE_ID, STREAMER_PERMISSIONS } from '../../packages/modules/src/streamer/config';

/**
 * Wer was darf - und dass es serverseitig geprueft wird.
 *
 * ## Warum das ein Test und keine Sichtpruefung ist
 *
 * §16 verlangt zwei Dinge, und beide sind unsichtbar:
 *
 *  - **Keine hartcodierten Discord-Rollennamen.** Ein `=== 'Moderator'`
 *    irgendwo im Modul faellt niemandem auf, solange die Rolle so heisst - und
 *    bricht still, sobald jemand sie umbenennt. Rollen werden in SwissHub auf
 *    Berechtigungen abgebildet, und zwar an einer Stelle.
 *  - **Alle sensiblen Aktionen serverseitig abgesichert.** Eine ausgeblendete
 *    Schaltflaeche ist keine Sperre: wer die Adresse kennt, ruft die Aktion
 *    auf. Geprueft wird deshalb, dass **jede** Server Action des Moduls eine
 *    Berechtigung nennt.
 */
const AKTIONEN = readFileSync(join(process.cwd(), 'apps/web/src/modules/streamer/actions.ts'), 'utf8');

/** Alle Dateien des Moduls - Kern und Oberflaeche. */
const MODULDATEIEN = [
  'packages/modules/src/streamer/config.ts',
  'packages/modules/src/streamer/plattform.ts',
  'packages/modules/src/streamer/bewerbung.ts',
  'packages/modules/src/streamer/verwaltung.ts',
  'packages/modules/src/streamer/live.ts',
  'packages/modules/src/streamer/ankuendigung.ts',
  'packages/modules/src/streamer/oeffentlich.ts',
  'packages/modules/src/streamer/abfragen.ts',
  'packages/modules/src/streamer/spotlight.ts',
  'packages/modules/src/streamer/twitch.ts',
  'packages/modules/src/streamer/youtube.ts',
  'apps/web/src/modules/streamer/actions.ts',
  'apps/web/src/modules/streamer/navigation.ts',
];

describe('Streamer Hub: Berechtigungen', () => {
  it('meldet alle acht Berechtigungen bei der Module Registry an', () => {
    /*
     * Was nicht angemeldet ist, laesst sich in der Rollenverwaltung nicht
     * vergeben - die Oberflaeche dort baut ihre Liste aus der Registry. Eine
     * Berechtigung, die es im Code gibt und in der Registry nicht, kann deshalb
     * niemand erteilen.
     */
    const definition = listModuleDefinitions().find((eintrag) => eintrag.id === STREAMER_MODULE_ID);
    expect(definition, 'Das Modul ist nicht registriert').toBeDefined();

    const angemeldet = new Set(definition!.permissions.map((eintrag) => eintrag.key));
    for (const schluessel of Object.values(STREAMER_PERMISSIONS)) {
      expect(angemeldet.has(schluessel), `${schluessel} fehlt in der Registry`).toBe(true);
    }
    expect(Object.values(STREAMER_PERMISSIONS)).toHaveLength(8);
  });

  it('gibt jeder Server Action eine Berechtigung', () => {
    /*
     * `defineAction` verlangt sie im Typ - dieser Test faengt den Fall, dass
     * jemand `permission` auf eine Zeichenkette setzt, die keine des Moduls ist,
     * oder eine Aktion mit der schwaechsten Berechtigung absichert, weil es
     * schneller ging.
     */
    const aufrufe = [...AKTIONEN.matchAll(/name:\s*'([^']+)'[\s\S]{0,400}?permission:\s*([^,\n]+)/gu)];
    expect(aufrufe.length, 'Es wurden keine Aktionen gefunden').toBeGreaterThanOrEqual(10);

    for (const [, name, berechtigung] of aufrufe) {
      expect(name).toMatch(/^streamer\./u);
      expect(berechtigung, `${name} nennt keine Berechtigung des Moduls`).toMatch(/^P\.\w+$/u);
    }
  });

  it('sichert das Veroeffentlichen strenger ab als das Entwerfen', () => {
    /*
     * Ein Entwurf bleibt im Haus. Eine Veroeffentlichung geht in einen Kanal mit
     * mehreren hundert Mitgliedern und laesst sich nicht zurueckholen - das sind
     * zwei verschiedene Entscheidungen und deshalb zwei Berechtigungen.
     */
    expect(STREAMER_PERMISSIONS.spotlight).not.toBe(STREAMER_PERMISSIONS.publish);
    expect(AKTIONEN).toContain('P.publish');
    expect(AKTIONEN).toContain('P.spotlight');
  });

  it('nennt nirgends einen Discord-Rollennamen', () => {
    /*
     * Gesucht wird die **Form** einer Rollenpruefung und nicht jedes Wort, das
     * auch ein Rollenname sein koennte: «Streamer» steht als Beschriftung in der
     * Navigation, und ein Test, der darueber stolpert, wird abgeschaltet.
     *
     * Rollen heissen morgen anders; Berechtigungen nicht. Eine Rolle wird in
     * SwissHub an einer Stelle auf Berechtigungen abgebildet, und keine davon
     * liegt in diesem Modul.
     */
    const verdaechtig = [
      /roleName\s*===/u,
      /role\.name\s*===/u,
      /\broles\b[\s\S]{0,20}\.includes\(/u,
      /hasRole\s*\(/u,
      /\bmemberRoles\b/u,
      /=== '(Moderator|Admin|Administrator)'/u,
    ];
    for (const pfad of MODULDATEIEN) {
      const quelle = readFileSync(join(process.cwd(), pfad), 'utf8');
      for (const muster of verdaechtig) {
        expect(muster.test(quelle), `${pfad} enthält ${String(muster)}`).toBe(false);
      }
    }
  });

  it('prueft in keiner Modulfunktion selbst eine Rolle', () => {
    /*
     * Die Berechtigungspruefung gehoert in die Server Action, nicht in den
     * Modulkern: derselbe Kern wird vom Bot gerufen, und dort gibt es keinen
     * angemeldeten Benutzer. Ein `can()` im Kern waere entweder toter Code oder
     * eine Pruefung gegen einen erfundenen Kontext.
     */
    for (const pfad of MODULDATEIEN.filter((eintrag) => eintrag.startsWith('packages/'))) {
      const quelle = readFileSync(join(process.cwd(), pfad), 'utf8');
      expect(quelle, `${pfad} prüft selbst Berechtigungen`).not.toMatch(/\bcan\(/u);
    }
  });

  it('haengt die interne Navigation an Berechtigungen und nicht an Rollen', () => {
    const navigation = readFileSync(
      join(process.cwd(), 'apps/web/src/modules/streamer/navigation.ts'),
      'utf8',
    );
    // Jeder Bereich hinter einem `can(context, …)` - und die Seite dahinter
    // prueft es noch einmal selbst.
    expect(navigation).toMatch(/can\(context, streamer\.STREAMER_PERMISSIONS\./u);
    expect(navigation).not.toMatch(/roles\b/u);
  });

  it('verlangt auf jeder internen Seite eine Berechtigung', () => {
    /*
     * Der Fall, den eine versteckte Navigation nicht abdeckt: jemand tippt die
     * Adresse ein. Jede Seite unter `/streamer-hub` muss deshalb selbst pruefen -
     * und zwar mit einer Berechtigung, nicht nur mit `requireMember()`.
     */
    const seiten = [
      'page.tsx',
      'streamer/page.tsx',
      'bewerbungen/page.tsx',
      'bewerbung/page.tsx',
      'ankuendigungen/page.tsx',
      'studio/page.tsx',
      'studio/[spotlightId]/page.tsx',
    ];
    for (const seite of seiten) {
      const quelle = readFileSync(join(process.cwd(), 'apps/web/src/app/(app)/streamer-hub', seite), 'utf8');
      expect(quelle, `${seite} prüft keine Berechtigung`).toMatch(
        /requirePagePermission\(streamer\.STREAMER_PERMISSIONS\./u,
      );
    }
  });
});
