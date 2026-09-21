import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { jail } from '@swisshub/modules';
import { listPermissions } from '@swisshub/permissions';

/**
 * Die Schaltfläche «Alle Jails aufheben» - Zugang und Rückfrage.
 *
 * Die Fachlichkeit steht im Integrationstest gegen eine echte Datenbank. Hier
 * steht, was man davor nicht falsch machen darf: wer sie überhaupt sieht, dass
 * sie nicht ohne Rückfrage auslöst, und dass sie sagt, was sie tut.
 */

function lies(pfad: string): string {
  return readFileSync(join(process.cwd(), pfad), 'utf8');
}

const knopf = lies('apps/web/src/modules/jail/components/purge-jails-button.tsx');
const seite = lies('apps/web/src/app/(app)/moderation/jail/page.tsx');
const actions = lies('apps/web/src/modules/jail/actions.ts');

describe('Zugang: eine eigene Berechtigung', () => {
  it('hängt nicht an «Jail aufheben»', () => {
    // Wer einzeln freilässt, soll nicht nebenbei den gesamten laufenden
    // Bestand samt Einträgen entfernen können. Das ist eine eigene
    // Entscheidung, also eine eigene Berechtigung.
    expect(jail.JAIL_PERMISSIONS.purge).toBe('jail.purge');
    expect(jail.JAIL_PERMISSIONS.purge).not.toBe(jail.JAIL_PERMISSIONS.release);
  });

  it('ist in der Registry angemeldet und als kritisch gekennzeichnet', () => {
    const eintrag = listPermissions().find((recht) => recht.key === jail.JAIL_PERMISSIONS.purge);
    expect(eintrag).toBeDefined();
    expect(eintrag?.critical).toBe(true);
    // Ohne Anmeldung stünde sie in keiner Berechtigungsmatrix - niemand
    // könnte sie vergeben, und niemand sähe, dass es sie gibt.
    expect(eintrag?.module).toBe(jail.JAIL_MODULE_ID);
  });

  it('gilt auch für die Server Action, nicht nur für den Knopf', () => {
    // Die Schaltfläche auszublenden ist Darstellung. Die Autorisierung
    // entscheidet der Server - sonst genügte ein Aufruf von aussen.
    expect(actions).toContain('permission: jail.JAIL_PERMISSIONS.purge');
    expect(seite).toContain('const canPurge = can(context, jail.JAIL_PERMISSIONS.purge)');
  });

  it('lässt die übrigen Jail-Berechtigungen unverändert', () => {
    for (const [name, wert] of [
      ['view', 'jail.view'],
      ['create', 'jail.create'],
      ['edit', 'jail.edit'],
      ['release', 'jail.release'],
      ['settings', 'jail.settings'],
    ] as const) {
      expect(jail.JAIL_PERMISSIONS[name], name).toBe(wert);
    }
  });
});

describe('Die Rückfrage', () => {
  it('löst nicht direkt aus', () => {
    // Der Klick öffnet den Dialog; ausgeführt wird erst dessen Bestätigung.
    expect(knopf).toContain('<ConfirmationDialog');
    expect(knopf).toContain('onConfirm={handleConfirm}');
    expect(knopf).toContain('onClick={() => {');
    expect(knopf).toContain('setOpen(true);');
  });

  it('ist als destruktiv gekennzeichnet', () => {
    expect(knopf).toContain('destructive');
    expect(knopf).toContain('variant="destructive"');
  });

  it('sagt beides: wer freikommt und was verschwindet', () => {
    // «Alle Jails löschen» allein liesse offen, ob die Betroffenen ihre
    // Rollen zurückbekommen - genau die Frage, auf die es hier ankommt.
    expect(knopf).toContain('sofort freigelassen');
    expect(knopf).toContain('unwiderruflich gelöscht');
    expect(knopf).toContain('Der Verlauf unter «Vergangen» bleibt unberührt');
  });

  it('nennt die Zahl, um die es geht', () => {
    expect(knopf).toContain('Alle Jails aufheben ({aktive})');
    expect(knopf).toContain('laufenden Jails aufheben und löschen?');
  });

  it('erscheint gar nicht, wenn es nichts aufzuheben gibt', () => {
    // Eine Schaltfläche, die nichts bewirkt, lädt zum Ausprobieren ein - und
    // das ist bei dieser die schlechteste aller Einladungen.
    expect(knopf).toContain('if (aktive === 0) {\n    return null;\n  }');
  });
});

describe('Der Bestand, über den entschieden wird', () => {
  it('prüft beim Ausführen, ob er sich geändert hat', () => {
    // Zwischen Seitenaufbau und Klick können Minuten liegen. Ist jemand
    // dazugekommen, verschwände er, ohne dass jemand über ihn entschieden
    // hat.
    expect(actions).toContain('const aktuell = await jail.countActiveJails()');
    expect(actions).toContain('if (aktuell !== input.erwartet)');
  });

  it('zählt den ganzen Bestand, nicht die gefilterte Seite', () => {
    // Die Liste zeigt eine Seite und richtet sich nach Reiter und Suche; der
    // Knopf räumt alles Laufende weg.
    expect(seite).toContain('jail.countActiveJails()');
    expect(seite).not.toContain('aktive={result.total}');
  });

  it('steht nur im Reiter «Aktiv»', () => {
    // Unter «Vergangen» fasst er nichts an, was dort zu sehen ist - ein
    // Knopf, der etwas anderes wegräumt als die Liste darunter zeigt, ist
    // eine Falle.
    expect(seite).toContain("query.tab === 'active' ? (");
  });

  it('hat ein eigenes, strenges Rate Limit', () => {
    const grenzen = lies('apps/web/src/server/rate-limit.ts');
    expect(grenzen).toContain('jailPurge:');
    expect(actions).toContain("rateLimit: 'jailPurge'");
  });
});

describe('Die Reihenfolge steht im Service, nicht in der Oberfläche', () => {
  const service = lies('packages/modules/src/jail/service.ts');

  it('lässt erst frei und löscht danach', () => {
    const freilassung = service.indexOf('const freilassung = await releaseJail(');
    const loeschen = service.indexOf('prisma.jailEntry.deleteMany');
    expect(freilassung).toBeGreaterThan(0);
    expect(loeschen).toBeGreaterThan(freilassung);
  });

  it('löscht nur, was tatsächlich freigelassen wurde', () => {
    // Scheitert eine Freilassung, trägt die Person ihre Jail-Rolle weiter.
    // Ihr Eintrag ist dann das Einzige, was noch davon weiss.
    expect(service).toContain('deleteMany({ where: { id: { in: freigegeben } } })');
  });

  it('benutzt dieselbe Freilassung wie der einzelne Knopf', () => {
    // Keine zweite Freilassungslogik: Rollen, Moderationslog,
    // Benachrichtigung und Audit-Eintrag je Person kommen von dort.
    expect(service).toContain('await releaseJail(eintrag.id, {');
    expect(service).toContain("releaseType: 'MANUAL'");
  });

  it('arbeitet nacheinander statt gleichzeitig', () => {
    // Jede Freilassung sind mehrere Discord-Anfragen; fünfzig davon parallel
    // wären ein selbstgebautes Rate-Limit-Problem.
    expect(service).toContain('for (const eintrag of aktive) {');
    expect(service).not.toContain('Promise.all(aktive.map');
  });

  it('lädt den Ausführungskontext einmal und reicht ihn weiter', () => {
    expect(service).toContain('const context = options.context ?? (await loadJailContext(gateway))');
    expect(service).toContain('        context,\n      });');
  });

  it('liest «aktiv» aus einer einzigen Definition', () => {
    // Zwei Definitionen von «aktiv» liefen auseinander, und dann räumte der
    // Knopf etwas anderes weg, als die Liste zeigt.
    expect(service).toContain('const AKTIVE_JAILS:');
    expect(service).toContain('where: AKTIVE_JAILS');
  });
});
