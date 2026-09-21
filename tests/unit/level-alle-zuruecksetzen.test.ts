import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { level } from '@swisshub/modules';
import { listPermissions } from '@swisshub/permissions';

/**
 * Die Schaltfläche «Alle XP zurücksetzen» - Zugang und Rückfrage.
 *
 * Die Fachlichkeit steht im Integrationstest gegen eine echte Datenbank. Hier
 * steht, was man davor nicht falsch machen darf: wer sie überhaupt sieht, dass
 * sie nicht ohne Rückfrage auslöst, und dass sie sagt, was sie tut - und was
 * sie nicht tut.
 */

function lies(pfad: string): string {
  return readFileSync(join(process.cwd(), pfad), 'utf8');
}

const knopf = lies('apps/web/src/modules/level/components/reset-levels-button.tsx');
const seite = lies('apps/web/src/app/(app)/level/mitglieder/page.tsx');
const actions = lies('apps/web/src/modules/level/actions.ts');

describe('Zugang: eine eigene Berechtigung', () => {
  it('hängt nicht an «XP vergeben und entziehen»', () => {
    // Wer einer Person XP gibt oder nimmt, soll nicht nebenbei den Stand des
    // ganzen Servers löschen können. Das ist eine andere Entscheidung, also
    // eine eigene Berechtigung.
    expect(level.LEVEL_PERMISSIONS.reset).toBe('level.reset');
    expect(level.LEVEL_PERMISSIONS.reset).not.toBe(level.LEVEL_PERMISSIONS.membersManage);
  });

  it('ist in der Registry angemeldet und als kritisch gekennzeichnet', () => {
    const eintrag = listPermissions().find((recht) => recht.key === level.LEVEL_PERMISSIONS.reset);
    expect(eintrag).toBeDefined();
    expect(eintrag?.critical).toBe(true);
    // Ohne Anmeldung stünde sie in keiner Berechtigungsmatrix - niemand
    // könnte sie vergeben, und niemand sähe, dass es sie gibt.
    expect(eintrag?.module).toBe(level.LEVEL_MODULE_ID);
  });

  it('gilt auch für die Server Action, nicht nur für den Knopf', () => {
    // Die Schaltfläche auszublenden ist Darstellung. Die Autorisierung
    // entscheidet der Server - sonst genügte ein Aufruf von aussen.
    expect(actions).toContain('permission: PERMISSIONS.reset');
    expect(seite).toContain('const canReset = can(context, level.LEVEL_PERMISSIONS.reset)');
  });

  it('lässt die übrigen Level-Berechtigungen unverändert', () => {
    for (const [name, wert] of [
      ['view', 'level.view'],
      ['membersView', 'level.members.view'],
      ['membersManage', 'level.members.manage'],
      ['rolesManage', 'level.roles.manage'],
      ['settingsManage', 'level.settings.manage'],
      ['import', 'level.import'],
    ] as const) {
      expect(level.LEVEL_PERMISSIONS[name], name).toBe(wert);
    }
  });
});

describe('Die Rückfrage', () => {
  it('löst nicht direkt aus', () => {
    // Der Klick öffnet den Dialog; ausgeführt wird erst dessen Bestätigung.
    expect(knopf).toContain('<ConfirmationDialog');
    expect(knopf).toContain('onConfirm={handleConfirm}');
    expect(knopf).toContain('setOpen(true);');
  });

  it('ist als destruktiv gekennzeichnet', () => {
    expect(knopf).toContain('destructive');
    expect(knopf).toContain('variant="destructive"');
  });

  it('sagt, was verschwindet und was bleibt', () => {
    // «Alle XP zurücksetzen» allein liesse offen, ob dabei auch die
    // Levelkarte, die Zähler oder der Verlauf mitgehen.
    expect(knopf).toContain('rückgängig machen');
    expect(knopf).toContain('Meilenstein-Rollen werden entzogen');
    expect(knopf).toContain('Unberührt bleiben');
  });

  it('nennt die Zahl, um die es geht', () => {
    expect(knopf).toContain('Alle XP zurücksetzen ({betroffen})');
    expect(knopf).toContain('XP-Stände auf null zurücksetzen?');
  });

  it('erscheint gar nicht, wenn es nichts zurückzusetzen gibt', () => {
    // Eine Schaltfläche, die nichts bewirkt, lädt zum Ausprobieren ein - und
    // das ist bei dieser die schlechteste aller Einladungen.
    expect(knopf).toContain('if (betroffen === 0) {\n    return null;\n  }');
  });

  it('spricht vom Anfang der Kurve, nicht von Level 0', () => {
    // `levelFromXp(0)` ist 1. Ein «Level 0» im Dialog wäre eine Zahl, die es
    // im System nirgends gibt - und das Journal sagte etwas anderes.
    expect(level.levelFromXp(0)).toBe(1);
    expect(knopf).not.toContain('Level 0');
  });

  it('warnt vor gebundenen Verlosungseinsätzen', () => {
    // Der Einsatz ist bereits abgebucht; bei einem Abbruch käme er zurück -
    // und entstünde nach einer Rücksetzung aus dem Nichts.
    expect(knopf).toContain('verlosungsEinsaetze > 0');
    expect(knopf).toContain('bekommen die Teilnehmenden ihren Einsatz zurück');
  });
});

describe('Der Bestand, über den entschieden wird', () => {
  it('prüft beim Ausführen, ob er sich geändert hat', () => {
    // Zwischen Seitenaufbau und Klick können Minuten liegen, und im
    // Level-System vergeht keine Minute ohne Bewegung: jede Nachricht bucht
    // XP.
    expect(actions).toContain('const aktuell = await level.countLevelProfilesWithXp()');
    expect(actions).toContain('if (aktuell !== input.erwartet)');
  });

  it('zählt den ganzen Bestand, nicht die gefilterte Seite', () => {
    // Die Liste zeigt eine Seite und richtet sich nach Suche und Sortierung;
    // der Knopf fasst jeden Stand an.
    expect(seite).toContain('level.countLevelProfilesWithXp()');
    expect(seite).not.toContain('betroffen={result.total}');
  });

  it('fragt beides nur, wenn es jemand darf', () => {
    // Zwei Abfragen für eine Schaltfläche, die die meisten gar nicht sehen -
    // die gehören hinter die Berechtigung.
    expect(seite).toContain('const [betroffen, verlosungsEinsaetze] = canReset');
  });

  it('hat ein eigenes, strenges Rate Limit', () => {
    const grenzen = lies('apps/web/src/server/rate-limit.ts');
    expect(grenzen).toContain('levelReset:');
    expect(actions).toContain("rateLimit: 'levelReset'");
  });

  it('nimmt die Bestätigung als Schlüssel mit', () => {
    expect(knopf).toContain('idempotencyKey: key');
    expect(actions).toContain('idempotencyKey: input.idempotencyKey');
  });
});

describe('Die Reihenfolge steht im Modul, nicht in der Oberfläche', () => {
  const admin = lies('packages/modules/src/level/admin.ts');

  it('bucht, bevor es schreibt', () => {
    // Das Journal hält den Stand fest, der gleich überschrieben wird. Danach
    // wäre er weg.
    const journal = admin.indexOf('tx.xpTransaction.createMany');
    const schreiben = admin.indexOf('tx.levelProfile.updateMany');
    expect(journal).toBeGreaterThan(0);
    expect(schreiben).toBeGreaterThan(journal);
  });

  it('liest erst hinter der Sperre', () => {
    // Sonst bucht der Bot zwischen Lesen und Schreiben, und im Journal stünde
    // ein Ausgangswert, den es nie gab.
    const sperre = admin.indexOf('FOR UPDATE');
    const lesen = admin.indexOf('const profile = await tx.levelProfile.findMany');
    expect(sperre).toBeGreaterThan(0);
    expect(lesen).toBeGreaterThan(sperre);
  });

  it('benutzt denselben Rollenabgleich wie die Seite «Meilenstein-Rollen»', () => {
    // Keine zweite Abgleichslogik: welche Rolle zu welchem Level gehört und
    // wie mit einem Fehlschlag umzugehen ist, steht an einer Stelle.
    expect(admin).toContain('await reconcileMilestones({');
  });

  it('arbeitet in Stapeln statt in einer einzigen Transaktion', () => {
    // Eine Transaktion über zehntausend Zeilen sperrte sie minutenlang - und
    // in dieser Zeit könnte der Bot keine einzige Nachricht verbuchen.
    expect(admin).toContain('const RESET_CHUNK_SIZE = 100;');
    expect(admin).toContain('start += RESET_CHUNK_SIZE');
  });

  it('begrenzt die Discord-Anfragen und verschweigt die Grenze nicht', () => {
    expect(admin).toContain('const RESET_ROLLEN_GRENZE = 2000;');
    expect(admin).toContain('limit: RESET_ROLLEN_GRENZE');
    expect(admin).toContain('ergebnis.gefunden > RESET_ROLLEN_GRENZE');
  });

  it('meldet auf Discord einmal, nicht einmal je Person', () => {
    // `logXpChange` je Profil wären bei ein paar tausend Mitgliedern ebenso
    // viele Discord-Anfragen und ein unlesbares Protokoll.
    expect(admin).toContain('await logLevelReset(context, {');
    const reset = admin.slice(admin.indexOf('export async function resetAllLevels'));
    expect(reset).not.toContain('logXpChange(');
  });
});
