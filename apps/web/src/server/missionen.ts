import 'server-only';
import { can } from '@swisshub/auth';
import { missions } from '@swisshub/modules';
import { resolveGuildId } from '@swisshub/discord';
import { systemRoutes } from '@swisshub/shared';
import type { AuthContext } from '@swisshub/auth';

/**
 * Was die Missionsseiten laden - an einer Stelle.
 *
 * ## Die vier Bereiche
 *
 * Genau vier, und die Reihenfolge ist die des taeglichen Gebrauchs:
 * Übersicht (wie steht es?), Missionen (was laeuft?), Vorlagen (was lege
 * ich immer wieder an?), Einstellungen (wann beginnt die Woche?).
 *
 * Die Übersicht ist zugleich die Mitgliederseite. Das ist kein Sparzwang,
 * sondern die ehrlichere Loesung: ein Teammitglied soll sehen, was die
 * Community sieht, ohne die Ansicht zu wechseln - sonst baut man zwei
 * Wahrheiten ueber dieselbe Mission.
 *
 * Nicht dabei und bewusst nicht: Seasons, Analytics, Verlauf,
 * Automatisierungen. Jeder dieser Bereiche waere ein eigenes Modul, das
 * sich als Reiter tarnt.
 */
export interface MissionsAbschnitt {
  href: string;
  label: string;
}

export function missionsAbschnitte(context: AuthContext): MissionsAbschnitt[] {
  const abschnitte: MissionsAbschnitt[] = [{ href: systemRoutes.missionen(), label: 'Übersicht' }];

  if (can(context, missions.MISSIONS_PERMISSIONS.manage)) {
    abschnitte.push(
      { href: systemRoutes.missionenVerwaltung(), label: 'Missionen' },
      { href: systemRoutes.missionenVorlagen(), label: 'Vorlagen' },
    );
  }
  if (can(context, missions.MISSIONS_PERMISSIONS.settings)) {
    abschnitte.push({ href: `/modules/${missions.MISSIONS_MODULE_ID}`, label: 'Einstellungen' });
  }

  return abschnitte;
}

export interface MissionsStand {
  guildId: string | null;
  laufend: missions.MissionsAnsicht[];
  /** Die zuletzt abgeschlossenen - damit die Seite nicht leer ist. */
  vergangen: missions.MissionsAnsicht[];
  darfVerwalten: boolean;
}

/**
 * Der Stand fuer die Mitgliederseite.
 *
 * `fuerDiscordId` ist immer die angemeldete Person - nie ein Parameter aus
 * der Adresszeile. Wessen Fortschritt jemand sieht, entscheidet die
 * Sitzung, nicht die URL.
 */
export async function ladeMissionsStand(context: AuthContext): Promise<MissionsStand> {
  const guildId = await resolveGuildId().catch(() => null);
  if (!guildId) {
    return { guildId: null, laufend: [], vergangen: [], darfVerwalten: false };
  }

  const [laufend, vergangen] = await Promise.all([
    missions.ansicht(guildId, ['LAEUFT', 'GEPLANT'], context.user.discordId),
    missions.ansicht(guildId, ['ABGESCHLOSSEN'], context.user.discordId, 5),
  ]);

  return {
    guildId,
    laufend,
    vergangen,
    darfVerwalten: can(context, missions.MISSIONS_PERMISSIONS.manage),
  };
}
