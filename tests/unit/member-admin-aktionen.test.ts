import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Die Aktionen, die auf ein fremdes Profil zeigen.
 *
 * ## Warum das geprueft wird
 *
 * Die uebrigen Profil-Aktionen nehmen **kein** Ziel entgegen: wessen Profil
 * geaendert wird, kommt aus der Sitzung, und ein praepariertes Request kann
 * deshalb kein fremdes treffen - nicht, weil eine Pruefung es abfaengt,
 * sondern weil es keinen Weg gibt, die Frage zu stellen.
 *
 * Die drei hier sind anders: sie tragen eine Kennung in der Eingabe. Damit
 * ist die Berechtigung das Einzige, was zwischen einem beliebigen Mitglied
 * und einem fremden Profil steht. Eine Oberflaeche, die den Knopf
 * versteckt, reicht dafuer nicht - der Knopf ist nicht die Anfrage.
 */
const QUELLE = readFileSync(join(process.cwd(), 'apps/web/src/modules/members/actions.ts'), 'utf8');

/** Der Block einer Aktion, von `defineAction` bis zum Rumpf. */
function definition(name: string): string {
  const start = QUELLE.indexOf(`name: '${name}'`);
  expect(start, `Aktion ${name} fehlt`).toBeGreaterThan(-1);
  const rumpf = QUELLE.indexOf('async ({', start);
  return QUELLE.slice(start, rumpf);
}

describe('Aktionen auf fremde Profile', () => {
  it.each([
    ['members.awards.grant', 'awardsManage'],
    ['members.awards.revoke', 'awardsManage'],
    ['members.profile.edit', 'profileEdit'],
  ])('%s verlangt %s serverseitig', (aktion, berechtigung) => {
    const block = definition(aktion);
    expect(block, `${aktion} prueft keine Berechtigung`).toContain('permission:');
    expect(block).toContain(`MEMBER_PERMISSIONS.${berechtigung}`);
    /*
     * `selfService` waere hier genau falsch: es bedeutet «der Dienst
     * entscheidet aus Betrachter und Ziel». Diese drei haben ein Ziel aus
     * der Eingabe - da muss die Berechtigung stehen.
     */
    expect(block, `${aktion} steht auf selfService`).not.toContain('selfService');
  });

  it.each(['members.awards.grant', 'members.awards.revoke', 'members.profile.edit'])(
    '%s nimmt die Kennung geprueft entgegen',
    (aktion) => {
      // `snowflakeSchema` und nicht `z.string()`: sonst landete beliebiger
      // Text in einer Datenbankabfrage.
      const block = definition(aktion);
      expect(block).toContain('schema:');
      expect(QUELLE).toContain('discordId: snowflakeSchema');
    },
  );

  it('bearbeitet nur Profilfelder und keine Moderationsdaten', () => {
    const block = definition('members.profile.edit');
    // Dasselbe Schema wie der eigene Editor - es gibt ein Profilmodell.
    expect(block).toContain('profile.allgemeinSchema');
    for (const verboten of ['jail', 'ticket', 'note', 'roleIds', 'verification']) {
      expect(block, `«${verboten}» im Schema der Profilbearbeitung`).not.toContain(verboten);
    }
  });
});
