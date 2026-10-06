import 'server-only';
import { prisma } from '@swisshub/database';
import { aufloeseAltlasten, altlastVon, listPermissions } from '@swisshub/permissions';

/**
 * Der Zustand der Rechtedaten - eine Auskunft, kein Modul.
 *
 * ## Warum es das gibt
 *
 * Weil der Fehler, der diese Runde ausgeloest hat, unsichtbar war, bis er das
 * Speichern blockierte. Acht Berechtigungen der entfernten Spielersuche
 * standen noch in `RolePermission`; niemand konnte das sehen, und niemand
 * suchte danach, weil nichts darauf hinwies. Erst als eine Rollen-Konfiguration
 * nicht mehr zu speichern war, kam «Unbekannte Berechtigung» - eine Meldung
 * ueber eine Folge, nicht ueber die Ursache.
 *
 * Die Auflösung in der Server-Aktion raeumt solche Zeilen jetzt weg, und die
 * Migration hat die acht bekannten entfernt. Beides passiert aber im
 * Verborgenen. Diese Funktion macht den Zustand sichtbar: sie zaehlt, was in
 * der Datenbank steht und in der Registry fehlt - getrennt in «benannt» und
 * «unbenannt», weil das zwei verschiedene Dinge sind.
 *
 * ## Was sie absichtlich nicht ist
 *
 * Kein Modul, keine Seite, kein Verlauf, keine Reparaturfunktion. Eine
 * Abfrage und eine Zusammenfassung, die in einem Kasten auf der
 * Berechtigungsseite Platz hat. Die Reparatur steckt dort, wo geschrieben
 * wird; eine zweite Stelle, die Rechtedaten aendert, waere eine Stelle zuviel.
 *
 * Registry-Schluessel, die nirgends geprueft werden, stehen hier nicht: das
 * laesst sich nur am Quelltext feststellen und nicht zur Laufzeit. Dafuer gibt
 * es einen Test, der die bekannte Liste festnagelt - damit kein weiterer
 * unbemerkt dazukommt.
 */
export interface PermissionGesundheit {
  /** Wie viele Berechtigungen die Registry kennt. */
  registriert: number;
  /** Wie viele Zuordnungen es insgesamt gibt. */
  zuordnungen: number;
  /**
   * Bekannte Altlasten in der Datenbank, mit Zahl der Zeilen.
   *
   * Dass hier etwas steht, ist kein Fehler - es heisst, dass eine Rolle seit
   * der Aufraeumung nicht mehr gespeichert wurde. Beim naechsten Speichern
   * verschwindet die Zeile.
   */
  altlasten: { key: string; zeilen: number; grund: string }[];
  /**
   * Unbenannte Schluessel in der Datenbank.
   *
   * Das hier ist der Fall, der jemanden interessieren sollte: ein Schluessel,
   * den weder die Registry noch die Altlastenliste kennt. Entweder ist ein
   * Modul beim Nachsehen nicht geladen, oder ein Seed schreibt einen Namen,
   * den es nicht gibt.
   */
  unbenannt: { key: string; zeilen: number }[];
}

export async function permissionGesundheit(): Promise<PermissionGesundheit> {
  const [registriert, zeilen] = await Promise.all([
    Promise.resolve(listPermissions().length),
    prisma.rolePermission.groupBy({ by: ['permission'], _count: { permission: true } }),
  ]);

  const altlasten: PermissionGesundheit['altlasten'] = [];
  const unbenannt: PermissionGesundheit['unbenannt'] = [];
  let zuordnungen = 0;

  for (const zeile of zeilen) {
    const anzahl = zeile._count.permission;
    zuordnungen += anzahl;
    /*
     * Dieselbe Entscheidung wie beim Speichern - nicht eine zweite, die
     * danebenliegen koennte. Ein einzelner Schluessel, damit `gueltig`
     * eindeutig fuer genau diesen steht.
     */
    const ergebnis = aufloeseAltlasten([zeile.permission]);
    if (ergebnis.gueltig.length > 0 && ergebnis.migriert.length === 0) {
      continue;
    }
    if (ergebnis.unbekannt.length > 0) {
      unbenannt.push({ key: zeile.permission, zeilen: anzahl });
      continue;
    }
    altlasten.push({
      key: zeile.permission,
      zeilen: anzahl,
      grund: altlastVon(zeile.permission)?.grund ?? 'Entfernt.',
    });
  }

  return {
    registriert,
    zuordnungen,
    altlasten: altlasten.sort((a, b) => a.key.localeCompare(b.key)),
    unbenannt: unbenannt.sort((a, b) => a.key.localeCompare(b.key)),
  };
}
