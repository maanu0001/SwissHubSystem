/**
 * Altlasten der Permission Registry.
 *
 * ## Der Fehler, den diese Datei behebt
 *
 * In den Einstellungen liess sich keine Rollen-Konfiguration mehr speichern.
 * Die Meldung lautete «Unbekannte Berechtigung:
 * members.view.spielersuche.own», und sie kam, sobald man irgendetwas
 * aenderte - auch etwas voellig anderes, etwa `level.xpslot.play`.
 *
 * Nachgemessen: die Spielersuche wurde entfernt und mit ihr acht
 * Berechtigungen aus der Registry. Die Zuordnungen in `RolePermission` blieben
 * stehen; niemand raeumte sie weg. Die Einstellungsseite laedt die
 * Zuordnungen einer Rolle unveraendert in die Oberflaeche, die Oberflaeche
 * schickt beim Speichern alles zurueck, was sie bekommen hat - und die
 * Server-Aktion lehnte den ganzen Vorgang ab, weil ein Schluessel darunter
 * war, den die Registry nicht mehr kennt.
 *
 * Eine Zeile aus dem letzten Jahr blockierte damit jede gueltige Aenderung
 * von heute.
 *
 * ## Warum nicht einfach alles Unbekannte ignorieren
 *
 * Weil «unbekannt» zwei sehr verschiedene Dinge heissen kann:
 *
 *  - Ein Schluessel, den es einmal gab und der absichtlich weg ist. Das ist
 *    Altdatenpflege, und die soll das Speichern nicht aufhalten.
 *  - Ein Schluessel, den es nie gab. Das ist ein Tippfehler im Code oder ein
 *    manipulierter Aufruf von aussen. Der muss auffallen.
 *
 * Wer beides still durchlaesst, baut sich eine Rechteverwaltung, in der
 * `moderation.exectue` genauso ruhig angenommen wird wie der richtige Name -
 * und niemand merkt, dass die Rolle das Recht nie bekommen hat. Deshalb steht
 * hier eine **benannte** Liste. Was darauf steht, ist bekannt und wird
 * behandelt. Was nicht darauf steht und die Registry nicht kennt, bleibt ein
 * Fehler.
 */

import { isKnownPermission } from './registry';

/** Ein Schluessel, den es einmal gab. */
export interface Altlast {
  key: string;
  /**
   * Der Nachfolger, falls es einen gibt.
   *
   * Nur setzen, wenn der neue Schluessel **dieselbe** Befugnis beschreibt.
   * Ein Nachfolger vererbt die Zuordnung: wer das alte Recht hatte, hat
   * danach das neue. Das ist bei einer Umbenennung richtig und bei einer
   * neuen Funktion falsch - dort waere es eine Rechteausweitung, die niemand
   * angeordnet hat.
   */
  ersatz?: string;
  /** Warum der Schluessel weg ist. Steht in der Diagnose. */
  grund: string;
}

/**
 * Die entfernten Berechtigungen.
 *
 * ## Die acht Schluessel der Spielersuche
 *
 * Commit `7de2252` («Die Spielersuche geht, der Spielekatalog bleibt») nahm
 * das Modul aus dem System. Der Spielekatalog zog zu «Was spielen wir?»
 * (`spielwahl.*`) - die Spielersuche selbst wurde nicht ersetzt, sie wurde
 * abgeschafft.
 *
 * Darum hat hier **keiner** der acht einen `ersatz`, obwohl es ein Modul mit
 * aehnlichem Namen gibt. `spielwahl.view` ist nicht der neue Name von
 * `spielersuche.view`: «Wer sucht Mitspieler» und «Was spielen wir als
 * naechstes» sind zwei Funktionen, und «Was spielen wir?» gab es vorher
 * schon. Wuerde man hier einen Ersatz eintragen, bekaeme jede Rolle, die
 * einmal die Spielersuche sehen durfte, stillschweigend Zugriff auf ein
 * anderes Modul. Eine Aufraeumaktion darf keine Rechte verteilen.
 */
export const ENTFERNTE_PERMISSIONS: readonly Altlast[] = [
  {
    key: 'members.view.spielersuche.all',
    grund: 'Spielersuche entfernt; der Abschnitt im Member Center ist weggefallen.',
  },
  {
    key: 'members.view.spielersuche.own',
    grund: 'Spielersuche entfernt; der Abschnitt im Member Center ist weggefallen.',
  },
  { key: 'spielersuche.closeOwn', grund: 'Spielersuche entfernt.' },
  { key: 'spielersuche.create', grund: 'Spielersuche entfernt.' },
  { key: 'spielersuche.join', grund: 'Spielersuche entfernt.' },
  { key: 'spielersuche.module.view', grund: 'Spielersuche entfernt.' },
  { key: 'spielersuche.stats.viewOwn', grund: 'Spielersuche entfernt.' },
  { key: 'spielersuche.view', grund: 'Spielersuche entfernt.' },
];

const altlasten = new Map<string, Altlast>(ENTFERNTE_PERMISSIONS.map((eintrag) => [eintrag.key, eintrag]));

/** Ist dieser Schluessel eine bekannte Altlast? */
export function istAltlast(key: string): boolean {
  return altlasten.has(key);
}

export function altlastVon(key: string): Altlast | undefined {
  return altlasten.get(key);
}

/** Was aus einer Liste von Schluesseln geworden ist. */
export interface AltlastErgebnis {
  /** Schluessel, die die Registry kennt - einschliesslich der Nachfolger. */
  gueltig: string[];
  /** Umgeschriebene Schluessel, als Paar fuer das Audit. */
  migriert: { von: string; nach: string }[];
  /** Bekannte Altlasten ohne Nachfolger. Fallen weg. */
  entfernt: string[];
  /** Weder bekannt noch als Altlast benannt. Das ist ein Fehler. */
  unbekannt: string[];
}

/**
 * Trennt eine Liste von Schluesseln in gueltig, migriert, entfernt, unbekannt.
 *
 * Reine Funktion ohne Datenbank: dieselbe Entscheidung gilt fuer die
 * Server-Aktion, die Einstellungsseite, die Aufraeumaktion und die Diagnose.
 * Es gibt sie genau einmal, damit Vorschau und Persistenz nicht
 * auseinanderlaufen koennen.
 *
 * `gueltig` ist dublettenfrei und behaelt die Eingabereihenfolge; ein
 * Nachfolger, der schon direkt in der Liste stand, kommt nicht zweimal vor.
 */
export function aufloeseAltlasten(keys: readonly string[]): AltlastErgebnis {
  const gueltig: string[] = [];
  const gesehen = new Set<string>();
  const migriert: { von: string; nach: string }[] = [];
  const entfernt: string[] = [];
  const unbekannt: string[] = [];

  const nimm = (key: string): void => {
    if (!gesehen.has(key)) {
      gesehen.add(key);
      gueltig.push(key);
    }
  };

  for (const key of keys) {
    if (isKnownPermission(key)) {
      nimm(key);
      continue;
    }
    const altlast = altlasten.get(key);
    if (!altlast) {
      if (!unbekannt.includes(key)) {
        unbekannt.push(key);
      }
      continue;
    }
    /*
     * Ein Nachfolger, den die Registry selbst nicht kennt, ist ein Fehler in
     * dieser Datei - nicht in den Daten. Dann faellt der Schluessel weg und
     * der Permission-Health-Bericht zeigt den Widerspruch an; still ein
     * ungueltiges Recht zu schreiben waere schlimmer.
     */
    if (altlast.ersatz && isKnownPermission(altlast.ersatz)) {
      migriert.push({ von: key, nach: altlast.ersatz });
      nimm(altlast.ersatz);
      continue;
    }
    if (!entfernt.includes(key)) {
      entfernt.push(key);
    }
  }

  return { gueltig, migriert, entfernt, unbekannt };
}
