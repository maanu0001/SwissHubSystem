import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { ENTFERNTE_PERMISSIONS, listPermissions } from '@swisshub/permissions';
import '@swisshub/modules';

/**
 * Berechtigungen, die es gibt und die nichts tun.
 *
 * ## Der Befund
 *
 * Zwei Schlüssel stehen in der Registry, sind in den Einstellungen
 * ankreuzbar - und werden an keiner Stelle im Code abgefragt:
 * `calendar.manageReminders` und `music.workers.manage`. Wer sie einer Rolle
 * gibt, gibt ihr nichts. Die Handlungen, die sie beschreiben, existieren in
 * der WebApp nicht: es gibt keine Aktion, die Kalender-Erinnerungen verwaltet,
 * und keine, die Music-Worker verwaltet. `music.workers.view` dagegen wird
 * geprüft, an der Worker-Seite - nur ansehen gibt es, nicht ändern.
 *
 * ## Warum sie bleiben
 *
 * Entfernt wurden sie nicht, und das ist eine Entscheidung: ein Schlüssel, den
 * man aus der Registry nimmt, während er in produktiven Rollendaten steht,
 * wird genau zu dem, was diese Runde behoben hat - eine Altlast, die es nicht
 * mehr gibt und die niemand weggeräumt hat. Für zwei Schlüssel, die nichts
 * kaputt machen, ist das der falsche Preis.
 *
 * Verdrahtet wurden sie auch nicht. Eine Prüfung für eine Handlung zu
 * erfinden, die es nicht gibt, wäre eine erfundene Zusage: das Häkchen sähe
 * danach bedeutsam aus und wäre es weiterhin nicht. Wenn die Funktion kommt,
 * kommt die Prüfung mit ihr - und dann schlägt dieser Test fehl und zeigt,
 * dass der Eintrag hier gehört gelöscht zu werden.
 *
 * ## Warum die Prüfung so vorsichtig ist
 *
 * Weil ein voreiliger Befund hier schon zweimal danebenlag. Der erste Versuch
 * suchte `ANALYTICS_PERMISSIONS.settings` und `P.settings` und erklärte drei
 * Analytics- und Moderationsschlüssel für ungeprüft - geprüft werden sie über
 * `p.settings`, mit kleinem p, in `apps/web/src/server/analytics.ts`. Der
 * zweite Versuch löste beliebige Kurznamen auf und meldete fünfzig Lücken,
 * von denen keine nachprüfbar war.
 *
 * Eine gemeldete Lücke, die keine ist, kostet genauso viel Vertrauen wie eine
 * übersehene. Dieser Test behauptet darum **nicht**, alle Lücken zu finden -
 * das bräuchte einen echten Referenz-Auflöser über den TypeScript-Baum. Er
 * prüft die zwei benannten, und er prüft sie scharf: findet sich für einen von
 * ihnen irgendwo eine Prüfung, schlägt er fehl.
 */
const RESERVIERT: readonly string[] = ['calendar.manageReminders', 'music.workers.manage'];

const dateien = execFileSync(
  'git',
  ['ls-files', 'apps/*.ts', 'apps/*.tsx', 'packages/*.ts', 'packages/*.tsx'],
  { encoding: 'utf8', cwd: process.cwd(), maxBuffer: 64 * 1024 * 1024 },
)
  .split('\n')
  .filter((pfad) => pfad.length > 0);

/** Das Katalogobjekt eines Moduls - dort steht die Definition, nicht die Prüfung. */
const KATALOG = /export const (\w*PERMISSIONS)\s*(?::[^=]*)?=\s*\{([\s\S]*?)\n\}/gu;

const QUELLEN = new Map(dateien.map((pfad) => [pfad, readFileSync(pfad, 'utf8')] as const));

/**
 * Der Quelltext ohne die Stellen, die einen Schlüssel nur benennen.
 *
 * Zwei Sorten fallen weg: das Katalogobjekt selbst
 * (`manageReminders: 'calendar.manageReminders'`) und der Eintrag in der
 * Modulbeschreibung (`{ key: CALENDAR_PERMISSIONS.manageReminders, label: … }`).
 * Der zweite stellt die Berechtigung in der Oberfläche zum Ankreuzen bereit -
 * er ist die Zusage, deren Einhaltung dieser Test prüft, und nicht ihre
 * Erfüllung.
 */
const PRUEFSTELLEN = [...QUELLEN.values()]
  .map((quelle) => quelle.replace(KATALOG, '').replace(/\bkey:\s*(?:\w+\.)?\w*PERMISSIONS\.\w+/gu, ''))
  .join('\n');

/** Unter welchem Feldnamen ein Modul diesen Schlüssel führt. */
function feldVon(key: string): string | null {
  for (const quelle of QUELLEN.values()) {
    for (const block of quelle.matchAll(KATALOG)) {
      for (const feld of block[2]!.matchAll(/(\w+):\s*'([^']+)'/gu)) {
        if (feld[2] === key) {
          return feld[1]!;
        }
      }
    }
  }
  return null;
}

describe('Reservierte Berechtigungen', () => {
  it('führt jede von ihnen in der Registry', () => {
    // Reserviert ist nicht entfernt - das ist der ganze Unterschied.
    const bekannt = new Set(listPermissions().map((eintrag) => eintrag.key));
    for (const key of RESERVIERT) {
      expect(bekannt.has(key), key).toBe(true);
    }
  });

  it('verwechselt reserviert nicht mit entfernt', () => {
    const entfernt = new Set(ENTFERNTE_PERMISSIONS.map((eintrag) => eintrag.key));
    for (const key of RESERVIERT) {
      expect(entfernt.has(key), key).toBe(false);
    }
  });

  it('wird von keiner Stelle im Code geprüft', () => {
    for (const key of RESERVIERT) {
      expect(PRUEFSTELLEN).not.toContain(`'${key}'`);
      expect(PRUEFSTELLEN).not.toContain(`"${key}"`);

      /*
       * Und auch nicht über das Feld - unter keinem Kurznamen. Gesucht wird
       * `.<feld>` ohne Rücksicht darauf, welches Objekt davorsteht: das ist
       * grob und in die vorsichtige Richtung grob. Taucht der Feldname
       * irgendwo auf, gilt der Schlüssel als geprüft und der Test schlägt
       * fehl - lieber ein Fehlschlag, den jemand nachsieht, als eine Lücke,
       * die hier als erledigt verbucht wird.
       */
      const feld = feldVon(key);
      expect(feld, `${key} steht in keinem Katalogobjekt`).not.toBeNull();
      expect(
        new RegExp(`\\.${feld!}\\b`).test(PRUEFSTELLEN),
        `${key} wird doch geprüft - über .${feld!}`,
      ).toBe(false);
    }
  });

  it('hat für music.workers.view sehr wohl eine Prüfung', () => {
    /*
     * Der Gegentest. Fände die Methode oben auch `workersView` nicht, würde
     * sie schlicht nichts finden - und «keine Prüfung» wäre keine Aussage
     * über den Code, sondern eine über den Test.
     */
    expect(new RegExp('\\.workersView\\b').test(PRUEFSTELLEN)).toBe(true);
  });
});
