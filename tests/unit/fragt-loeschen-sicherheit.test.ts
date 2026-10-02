import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUDIT_ACTIONS } from '@swisshub/database';
import { fragt } from '@swisshub/modules';
import { listPermissions } from '@swisshub/permissions';

/**
 * Löschen in «SwissHub fragt» - die Wege drumherum.
 *
 * Was gelöscht wird und was bleibt, prüft `tests/integration/fragt-loeschen`
 * gegen eine echte Datenbank. Hier steht das, was man an einer Datenbank nicht
 * sieht: dass es eine eigene Berechtigung ist, dass sie in der Permission
 * Engine bekannt ist, dass die Rolle frisch gelesen wird, dass es einen
 * Protokolleintrag mit deutscher Beschriftung gibt und dass niemand ohne
 * Rückfrage auf den Knopf kommt.
 */

function quelle(datei: string): string {
  return readFileSync(join(process.cwd(), datei), 'utf8');
}

function ohneKommentare(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');
}

const AKTIONEN = ohneKommentare(quelle('apps/web/src/modules/fragt/actions.ts'));

describe('fragt: löschen braucht eine eigene Berechtigung', () => {
  it('kennt fragt.delete und nicht nur fragt.settings', () => {
    /*
     * Zwei Handlungen mit verschiedenen Folgen gehoeren nicht in dieselbe
     * Berechtigung, nur weil beide «Admin» klingen: Termine verstellen ist
     * reparierbar, ein Jahresverlauf nicht.
     */
    expect(fragt.FRAGT_PERMISSIONS.delete).toBe('fragt.delete');
    expect(fragt.FRAGT_PERMISSIONS.delete).not.toBe(fragt.FRAGT_PERMISSIONS.settings);
  });

  it('meldet sie an die Permission Engine', () => {
    /*
     * Eine Berechtigung, die nur im Code steht, laesst sich keiner Rolle
     * zuteilen - sie waere damit fuer alle ausser dem Besitzer gesperrt, und
     * niemand haette das angeordnet. `listPermissions` ist die Liste, aus der
     * «Server → Berechtigungen» ihre Haken baut.
     */
    const eintrag = listPermissions().find((definition) => definition.key === fragt.FRAGT_PERMISSIONS.delete);
    expect(eintrag, 'fragt.delete fehlt in der Permission Engine').toBeDefined();
    expect(eintrag?.label).toBeTruthy();
    expect(eintrag?.description).toBeTruthy();
    // `critical` - die Discord-Rolle wird frisch gelesen, bevor sie zählt.
    expect(eintrag?.critical).toBe(true);
  });

  it.each([
    ['fragt.draft.delete', 'fragtEntwurfLoeschenAction'],
    ['fragt.poll.delete', 'fragtErgebnisLoeschenAction'],
  ])('verlangt bei %s die Löschberechtigung und frische Rollen', (name, exportName) => {
    const ab = AKTIONEN.indexOf(`export const ${exportName} = defineAction(`);
    expect(ab, exportName).toBeGreaterThan(0);
    const abschnitt = AKTIONEN.slice(ab, ab + 900);

    expect(abschnitt).toContain(`name: '${name}'`);
    expect(abschnitt).toContain('FRAGT_PERMISSIONS.delete');
    /*
     * `critical` statt `cached`: wem die Rolle vor fuenf Minuten entzogen
     * wurde, soll nicht noch loeschen koennen. Bei einer nicht umkehrbaren
     * Handlung ist das der Unterschied zwischen «knapp daneben» und
     * «unwiderruflich».
     */
    expect(abschnitt).toContain("freshness: 'critical'");
  });

  it('nimmt die Kennung des Handelnden aus der Sitzung', () => {
    // Eine `discordId` im Formular waere der Weg, unter fremdem Namen zu
    // loeschen - und im Protokoll stuende dann der falsche Name.
    expect(AKTIONEN).toContain('handelnder(ctx)');
    expect(AKTIONEN).not.toMatch(/actorDiscordId:\s*z\./u);
  });
});

describe('fragt: löschen steht im Protokoll', () => {
  it('hat für beide Fälle eine Audit-Aktion', () => {
    expect(AUDIT_ACTIONS.FRAGT_DRAFT_DELETED).toBe('FRAGT_DRAFT_DELETED');
    expect(AUDIT_ACTIONS.FRAGT_POLL_DELETED).toBe('FRAGT_POLL_DELETED');
  });

  it('beschriftet beide auf Deutsch', () => {
    /*
     * `tests/unit/audit-darstellung` verlangt das von jeder Aktion. Hier noch
     * einmal namentlich, weil ein Protokoll mit «FRAGT_POLL_DELETED» in der
     * Zeile niemandem sagt, was passiert ist - und das Protokoll ist bei einer
     * nicht umkehrbaren Handlung die einzige Spur.
     */
    const labels = quelle('apps/web/src/modules/audit/labels.ts');
    expect(labels).toContain("FRAGT_DRAFT_DELETED: 'Social-Media-Entwurf gelöscht'");
    expect(labels).toContain("FRAGT_POLL_DELETED: 'Abstimmung samt Ergebnis gelöscht'");
  });

  it('hält im Protokoll fest, welche Frage bestehen blieb', () => {
    // Nachpruefbar statt behauptet - siehe `loescheAbstimmung`.
    const kern = ohneKommentare(quelle('packages/modules/src/fragt/abstimmung.ts'));
    expect(kern).toContain('frageBleibt: abstimmung.frageId');
  });

  it('löscht die Frage in keiner der beiden Funktionen', () => {
    /*
     * Die grobe Gegenprobe zur Kaskade: in diesen beiden Dateien darf
     * `fragtFrage.delete` nicht vorkommen. Die Kaskade laeuft ohnehin nur von
     * der Frage nach unten, aber ein Aufruf hier waere der Weg, sie von Hand
     * zu umgehen - und er faellt in einem Diff nur auf, wenn jemand hinsieht.
     */
    for (const datei of [
      'packages/modules/src/fragt/abstimmung.ts',
      'packages/modules/src/fragt/entwurf.ts',
    ]) {
      expect(ohneKommentare(quelle(datei)), datei).not.toContain('fragtFrage.delete');
      expect(ohneKommentare(quelle(datei)), datei).not.toContain('fragtFrage.deleteMany');
    }
  });
});

describe('fragt: niemand löscht ohne Rückfrage', () => {
  it('fragt im Studio über den zentralen Bestätigungsdialog', () => {
    const editor = ohneKommentare(quelle('apps/web/src/modules/fragt/components/studio-editor.tsx'));
    expect(editor).toContain('ConfirmationDialog');
    expect(editor).toContain('destructive');
    // Und der Knopf erscheint nur mit Berechtigung - eine Höflichkeit, keine
    // Sicherung: die Aktion prüft selbst.
    expect(editor).toContain('darfLoeschen');
  });

  it('fragt beim Ergebnis ebenfalls - und nennt die Frage im Dialog', () => {
    const komponente = ohneKommentare(quelle('apps/web/src/modules/fragt/components/ergebnis-loeschen.tsx'));
    expect(komponente).toContain('ConfirmationDialog');
    expect(komponente).toContain('destructive');
    /*
     * Der Fragetext im Dialog, damit niemand das falsche Ergebnis loescht:
     * zwei Zeilen in einer Liste sehen sich aehnlich, zwei Fragen nicht.
     */
    expect(komponente).toContain('frageText');
  });

  it('zeigt den Knopf am Ergebnis nur mit der Berechtigung und nur bei geschlossenen', () => {
    const seite = ohneKommentare(quelle('apps/web/src/app/(app)/fragt/ergebnisse/[id]/page.tsx'));
    expect(seite).toContain('FRAGT_PERMISSIONS.delete');
    // Eine laufende Abstimmung mitten im Satz abzuschneiden lehnt auch das
    // Modul ab; der Knopf dazu erscheint gar nicht erst.
    expect(seite).toContain('!laeuftNoch');
  });
});
