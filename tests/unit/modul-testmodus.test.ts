import { describe, expect, it } from 'vitest';
import { hasPermission, PERMISSION_PRESETS, type PermissionResolution } from '@swisshub/permissions';
import { darfStatusOeffnen, modulStatus, TESTMODUS_PERMISSION, type ModulStatus } from '@swisshub/modules';

/**
 * Der Testmodus - die Regel, ohne Datenbank.
 *
 * ## Was er ist
 *
 * Eine **zusaetzliche** Bedingung, keine zweite Berechtigungssprache. Ein
 * Modul im Testmodus laeuft in Produktion; wer es oeffnen will, braucht
 * weiterhin seine Modulberechtigung und zusaetzlich `modules.testmode.use`.
 *
 * ## Warum das hier ohne Datenbank steht
 *
 * Weil die Regel selbst nichts mit Speicherung zu tun hat. Sie ist eine
 * Aussage ueber zwei Wahrheitswerte, und eine Aussage, die man nur mit einem
 * aufgebauten Schema pruefen kann, prueft man seltener. Der Weg von der
 * Datenbank hierher steht in `tests/integration/modul-testmodus.test.ts`.
 */

const ALLE: ModulStatus[] = ['AKTIV', 'TESTMODUS', 'DEAKTIVIERT'];

describe('Der Status aus zwei Spalten', () => {
  it('nennt ein abgeschaltetes Modul deaktiviert - egal was im Testmodus steht', () => {
    /*
     * Die Reihenfolge der Pruefung ist die Aussage: `enabled` gewinnt. Ein
     * Modul, das jemand abgeschaltet hat, bleibt abgeschaltet, auch wenn das
     * Testmodus-Kennzeichen noch von frueher stehengeblieben ist.
     */
    expect(modulStatus(false, false)).toBe('DEAKTIVIERT');
    expect(modulStatus(false, true)).toBe('DEAKTIVIERT');
  });

  it('unterscheidet aktiv und Testmodus', () => {
    expect(modulStatus(true, false)).toBe('AKTIV');
    expect(modulStatus(true, true)).toBe('TESTMODUS');
  });
});

describe('Wer ein Modul oeffnen darf', () => {
  it('laesst jeden an ein aktives Modul - der Riegel greift nur im Testmodus', () => {
    expect(darfStatusOeffnen('AKTIV', false)).toBe(true);
    expect(darfStatusOeffnen('AKTIV', true)).toBe(true);
  });

  it('sperrt ein Testmodul fuer den, der den Schluessel nicht hat', () => {
    expect(darfStatusOeffnen('TESTMODUS', false)).toBe(false);
  });

  it('oeffnet ein Testmodul fuer den, der ihn hat', () => {
    expect(darfStatusOeffnen('TESTMODUS', true)).toBe(true);
  });

  it('kuemmert sich nicht um deaktivierte Module', () => {
    /*
     * Bewusst `true`. Ein abgeschaltetes Modul ist nicht die Frage dieser
     * Funktion - dafuer gibt es die bestehende Deaktivierungslogik, und die
     * bleibt unveraendert. Zwei Stellen, die dasselbe abschalten, waeren eine
     * zu viel: die zweite wird vergessen, und dann laeuft etwas weiter, von
     * dem alle denken, es sei aus.
     */
    expect(darfStatusOeffnen('DEAKTIVIERT', false)).toBe(true);
    expect(darfStatusOeffnen('DEAKTIVIERT', true)).toBe(true);
  });

  it('entscheidet fuer jeden Status eindeutig', () => {
    // Kein Status ohne Antwort - auch nicht, wenn spaeter einer dazukommt.
    for (const status of ALLE) {
      expect(typeof darfStatusOeffnen(status, false)).toBe('boolean');
      expect(typeof darfStatusOeffnen(status, true)).toBe('boolean');
    }
  });
});

describe('Wer den Schluessel hat', () => {
  const vorlage = (id: string): string[] =>
    PERMISSION_PRESETS.find((preset) => preset.id === id)?.permissions ?? [];

  /**
   * Eine Vorlage so pruefen, wie die Anwendung sie prueft.
   *
   * `hasPermission` nimmt eine aufgeloeste Berechtigungslage und keine Liste -
   * darin steckt die Wildcard- und `admin.full`-Semantik. Ein Test, der
   * stattdessen `includes` benutzte, pruefte eine andere Regel als die, die
   * im Betrieb gilt: `admin.full` steht in keiner Liste als
   * `modules.testmode.use` drin.
   */
  const lage = (berechtigungen: string[]): PermissionResolution => ({
    discordId: '000000000000000001',
    isOwner: false,
    granted: new Set(berechtigungen),
    denied: new Set<string>(),
    matchedRoleIds: [],
  });

  it('gibt ihn dem Administrator ueber den Vollzugriff', () => {
    /*
     * Nicht einzeln aufgezaehlt: `admin.full` schliesst alles ein. Ihn
     * trotzdem in die Vorlage zu schreiben waere eine Zeile, die nichts tut -
     * und beim naechsten Schluessel fragte sich jemand, warum dieser eine
     * dort steht und die anderen nicht.
     */
    expect(hasPermission(lage(vorlage('administrator')), TESTMODUS_PERMISSION)).toBe(true);
  });

  it('gibt ihn dem Moderator und dem Senior Moderator', () => {
    expect(vorlage('moderator')).toContain(TESTMODUS_PERMISSION);
    expect(hasPermission(lage(vorlage('moderator')), TESTMODUS_PERMISSION)).toBe(true);

    const senior = PERMISSION_PRESETS.find(
      (preset) => preset.id !== 'moderator' && preset.permissions.includes('moderation.ban'),
    );
    expect(senior, 'Keine Vorlage mit Bannrecht gefunden').toBeDefined();
    expect(hasPermission(lage(senior?.permissions ?? []), TESTMODUS_PERMISSION)).toBe(true);
  });

  it('gibt ihn keiner Mitglieder-, Premium- oder Lesevorlage', () => {
    /*
     * Der Kern von §31: ein gewoehnliches Mitglied darf ein Testmodul nicht
     * sehen, **selbst wenn** eine Rolle ihm die Modulberechtigung gibt. Das
     * geht nur, wenn dieser Schluessel in keiner Mitgliedervorlage steht.
     */
    for (const id of ['mitglied', 'premium', 'viewer']) {
      const berechtigungen = vorlage(id);
      expect(berechtigungen.length, `Vorlage ${id} nicht gefunden`).toBeGreaterThan(0);
      expect(
        hasPermission(lage(berechtigungen), TESTMODUS_PERMISSION),
        `Vorlage ${id} traegt ${TESTMODUS_PERMISSION}`,
      ).toBe(false);
    }
  });

  it('macht aus dem Schluessel allein keinen Zugang', () => {
    /*
     * Die andere Haelfte. Wer nur den Testmodus-Schluessel hat, aber die
     * Modulberechtigung nicht, kommt nicht hinein - der Riegel ersetzt die
     * Berechtigungspruefung nicht, er kommt dazu.
     */
    const nurSchluessel = [TESTMODUS_PERMISSION];
    expect(hasPermission(lage(nurSchluessel), 'clips.submit')).toBe(false);
    expect(darfStatusOeffnen('TESTMODUS', hasPermission(lage(nurSchluessel), TESTMODUS_PERMISSION))).toBe(
      true,
    );
    // Beides zusammen entscheidet - und das tut der Aufrufer, nicht diese Funktion.
  });
});
