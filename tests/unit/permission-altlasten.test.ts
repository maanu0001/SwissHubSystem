import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ENTFERNTE_PERMISSIONS,
  aufloeseAltlasten,
  altlastVon,
  isKnownPermission,
  istAltlast,
  listPermissions,
} from '@swisshub/permissions';
import '@swisshub/modules';

/**
 * Altdaten blockieren keine gültige Rollen-Konfiguration mehr.
 *
 * ## Der Fehler
 *
 * In den Einstellungen liess sich keine Rolle mehr speichern. Die Meldung war
 * «Unbekannte Berechtigung: members.view.spielersuche.own», und sie kam auch
 * dann, wenn man etwas ganz anderes änderte - etwa `level.xpslot.play` für
 * die Mitglieder freischalten wollte.
 *
 * Die Spielersuche wurde entfernt und mit ihr acht Berechtigungen aus der
 * Registry; ihre Zeilen in `RolePermission` blieben stehen. Die
 * Einstellungsseite lud sie in die Oberfläche, die Oberfläche schickte sie
 * beim Speichern zurück, und die Server-Aktion lehnte den ganzen Vorgang ab.
 */
const lies = (pfad: string): string => readFileSync(join(process.cwd(), pfad), 'utf8');

describe('Entfernte Berechtigungen sind benannt', () => {
  it('kennt genau die acht Schlüssel der Spielersuche', () => {
    expect(ENTFERNTE_PERMISSIONS.map((eintrag) => eintrag.key).sort()).toEqual([
      'members.view.spielersuche.all',
      'members.view.spielersuche.own',
      'spielersuche.closeOwn',
      'spielersuche.create',
      'spielersuche.join',
      'spielersuche.module.view',
      'spielersuche.stats.viewOwn',
      'spielersuche.view',
    ]);
  });

  it('nennt für jeden einen Grund', () => {
    for (const eintrag of ENTFERNTE_PERMISSIONS) {
      expect(eintrag.grund.length, eintrag.key).toBeGreaterThan(10);
    }
  });

  it('überschneidet sich nicht mit der Registry', () => {
    /*
     * Ein Schlüssel kann nicht gleichzeitig gültig und entfernt sein. Stünde
     * er in beiden Listen, entschiede die Reihenfolge der Prüfung - und das
     * ist kein Modell, auf dem Rechte beruhen sollten.
     */
    for (const eintrag of ENTFERNTE_PERMISSIONS) {
      expect(isKnownPermission(eintrag.key), eintrag.key).toBe(false);
    }
  });

  it('verteilt keine Rechte durch einen Ersatz', () => {
    /*
     * Keiner der acht hat einen Nachfolger. `spielwahl.*` ist nicht der neue
     * Name der Spielersuche - «Wer sucht Mitspieler» und «Was spielen wir als
     * nächstes» sind zwei Funktionen, und «Was spielen wir?» gab es vorher
     * schon. Ein Ersatz hier würde jeder Rolle, die einmal die Spielersuche
     * sehen durfte, stillschweigend ein anderes Modul öffnen.
     */
    for (const eintrag of ENTFERNTE_PERMISSIONS) {
      expect(eintrag.ersatz, eintrag.key).toBeUndefined();
    }
  });

  it('lässt einen Ersatz grundsätzlich zu', () => {
    // Die Struktur trägt den Fall - die acht brauchen ihn bloss nicht.
    const quelle = lies('packages/permissions/src/altlasten.ts');
    expect(quelle).toContain('ersatz?: string');
    expect(quelle).toContain('migriert.push({ von: key, nach: altlast.ersatz })');
  });
});

describe('aufloeseAltlasten trennt vier Fälle', () => {
  it('lässt bekannte Schlüssel unverändert durch', () => {
    const ergebnis = aufloeseAltlasten(['level.xpslot.play', 'members.view']);
    expect(ergebnis.gueltig).toEqual(['level.xpslot.play', 'members.view']);
    expect(ergebnis.entfernt).toEqual([]);
    expect(ergebnis.unbekannt).toEqual([]);
  });

  it('räumt eine benannte Altlast weg, ohne das Übrige anzufassen', () => {
    const ergebnis = aufloeseAltlasten([
      'level.xpslot.play',
      'members.view.spielersuche.own',
      'members.view',
    ]);
    // Das ist der Kern: die gültigen Rechte bleiben vollständig.
    expect(ergebnis.gueltig).toEqual(['level.xpslot.play', 'members.view']);
    expect(ergebnis.entfernt).toEqual(['members.view.spielersuche.own']);
    expect(ergebnis.unbekannt).toEqual([]);
  });

  it('behandelt einen echten Tippfehler weiterhin als Fehler', () => {
    /*
     * Der Gegentest zum Aufräumen: `moderation.exectue` sieht aus wie ein
     * Recht und ist keines. Würde er still durchgehen, hätte eine Rolle das
     * Recht nie bekommen und niemand hätte es gemerkt.
     */
    const ergebnis = aufloeseAltlasten(['moderation.exectue', 'members.view']);
    expect(ergebnis.unbekannt).toEqual(['moderation.exectue']);
    expect(ergebnis.gueltig).toEqual(['members.view']);
  });

  it('nennt jeden unbekannten Schlüssel nur einmal', () => {
    const ergebnis = aufloeseAltlasten(['was.soll.das', 'was.soll.das']);
    expect(ergebnis.unbekannt).toEqual(['was.soll.das']);
  });

  it('schreibt keine Dublette, wenn der Nachfolger schon dabei ist', () => {
    const ergebnis = aufloeseAltlasten(['members.view', 'members.view']);
    expect(ergebnis.gueltig).toEqual(['members.view']);
  });

  it('kommt mit einer leeren Liste zurecht', () => {
    expect(aufloeseAltlasten([])).toEqual({
      gueltig: [],
      migriert: [],
      entfernt: [],
      unbekannt: [],
    });
  });

  it('hält die ganze Registry für gültig', () => {
    // Keine Berechtigung darf sich selbst für eine Altlast halten.
    const alle = listPermissions().map((eintrag) => eintrag.key);
    const ergebnis = aufloeseAltlasten(alle);
    expect(ergebnis.gueltig.length).toBe(alle.length);
    expect(ergebnis.entfernt).toEqual([]);
    expect(ergebnis.unbekannt).toEqual([]);
  });
});

describe('Der konkrete Fehlerfall', () => {
  it('speichert level.xpslot.play, obwohl die alte Zeile noch dabei ist', () => {
    /*
     * Genau die Liste, die die Oberfläche aus der Datenbank zurückschickte:
     * ein paar gültige Rechte und eine Zeile der Spielersuche. Vorher
     * scheiterte daran der ganze Vorgang.
     */
    const ausDerDatenbank = [
      'dashboard.view',
      'members.view',
      'members.view.spielersuche.own',
      'level.xpslot.play',
    ];
    const ergebnis = aufloeseAltlasten(ausDerDatenbank);
    expect(ergebnis.unbekannt).toEqual([]);
    expect(ergebnis.gueltig).toContain('level.xpslot.play');
    expect(ergebnis.gueltig).not.toContain('members.view.spielersuche.own');
  });

  it('kennt den Schlüssel aus der Fehlermeldung als Altlast', () => {
    expect(istAltlast('members.view.spielersuche.own')).toBe(true);
    expect(altlastVon('members.view.spielersuche.own')?.grund).toContain('Spielersuche');
    expect(istAltlast('level.xpslot.play')).toBe(false);
  });

  it('hält level.xpslot.play als spielbares Recht in der Registry', () => {
    /*
     * Die Berechtigung, um die es ging. Sie ist ein gewöhnliches Recht und
     * kein Admin-Sonderfall - genau deshalb musste sie sich speichern lassen.
     */
    expect(isKnownPermission('level.xpslot.play')).toBe(true);
  });
});

describe('Vorschau und Persistenz rechnen auf derselben Liste', () => {
  it('filtert die Seite mit derselben Funktion wie die Aktion', () => {
    /*
     * Die Zahl in «Vorschau: 29 von 366 Berechtigungen nach dem Speichern»
     * stimmt nur, wenn die Oberfläche dieselbe Liste zählt, die der Server
     * danach schreibt. Dieselbe Funktion an beiden Stellen ist die
     * Zusicherung dafür - zwei eigene Filter wären zwei Wahrheiten.
     */
    const seite = lies('apps/web/src/app/(app)/server/permissions/page.tsx');
    expect(seite).toContain('aufloeseAltlasten(');
    expect(seite).toContain(').gueltig');

    const aktion = lies('apps/web/src/modules/configuration/actions.ts');
    expect(aktion).toContain('aufloeseAltlasten(input.permissions)');
  });

  it('schreibt die Aufräumung ins Audit, statt sie zu verschweigen', () => {
    const aktion = lies('apps/web/src/modules/configuration/actions.ts');
    expect(aktion).toContain('migriert: altlasten.migriert');
    expect(aktion).toContain('entfernt: [...altlasten.entfernt].sort()');
  });

  it('rechnet ab der Auflösung nirgends mehr auf input', () => {
    /*
     * Kein stiller Teil-Save: würde eine Stelle weiter unten `input` lesen,
     * käme die Altlast dort wieder herein und das Ergebnis wäre halb neu und
     * halb alt.
     */
    const aktion = lies('apps/web/src/modules/configuration/actions.ts');
    const ab = aktion.indexOf('const erlaubt = aufloeseAltlasten(input.permissions)');
    const bis = aktion.indexOf("revalidatePath('/server/permissions')", ab);
    expect(ab).toBeGreaterThan(0);
    const rumpf = aktion.slice(ab, bis);
    // Die beiden Auflösungszeilen selbst dürfen `input` lesen - danach nicht.
    const ohneAufloesung = rumpf
      .split('\n')
      .filter((zeile) => !zeile.includes('aufloeseAltlasten(input.'))
      .join('\n');
    expect(ohneAufloesung).not.toContain('input.permissions');
    expect(ohneAufloesung).not.toContain('input.deniedPermissions');
  });
});
