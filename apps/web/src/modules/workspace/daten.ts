import 'server-only';
import { can } from '@swisshub/auth';
import type { AuthContext } from '@swisshub/auth';
import { getModuleSettings, members, traegerDerBerechtigung, workspace } from '@swisshub/modules';

/**
 * Was die Seiten des Workspace laden.
 *
 * ## Warum Namen hier aufgelöst werden und nicht in der Komponente
 *
 * Weil eine Komponente, die selbst nachschlägt, eine Abfrage je Zeile ist -
 * bei dreissig Aufgaben mit je zwei Zuständigen sechzig. `members.loadPersonen`
 * macht es in zwei Abfragen für alle, und es ist dieselbe Auflösung, die auch
 * das Audit Log benutzt: der Mitgliederspiegel zuerst, dann die angemeldeten
 * Benutzer, und wer in beiden fehlt, bleibt lesbar als ehemalig.
 *
 * Eine eigene Namenstabelle gibt es hier nicht. Das Modul ist intern, und die
 * Identitäten sind die, die es schon gibt.
 */

/**
 * Wer schaut - fuer die Sichtbarkeitspruefung des Moduls.
 *
 * `darfAlles` haengt an `settingsManage`: wer die Moduleinstellungen aendern
 * darf, verwaltet den Workspace und muss auch an ein verwaistes privates
 * Projekt herankommen - sonst gaebe es Projekte, die niemand mehr aufraeumen
 * kann, wenn ihre Mitglieder den Server verlassen haben.
 *
 * **Nicht** `projectsEdit`: das ist die Berechtigung, Projekte zu bearbeiten,
 * und nicht die, alle zu sehen. Die beiden zu vermischen hiesse, dass jedes
 * Teammitglied mit Schreibrecht jedes private Projekt liest - und die
 * Sichtbarkeit waere eine Anzeigeeinstellung.
 */
export function workspaceBetrachter(context: AuthContext): workspace.WorkspaceBetrachter {
  return {
    discordId: context.user.discordId,
    darfAlles: can(context, workspace.WORKSPACE_PERMISSIONS.settingsManage),
  };
}

export interface Teammitglied {
  discordId: string;
  name: string;
  /**
   * Der Discord-Benutzername - fuer die Faelle, in denen der Anzeigename
   * nicht genuegt.
   *
   * Zwei Leute mit demselben Anzeigenamen sind auf einem Server mit
   * hundertfuenfzig Mitgliedern keine Seltenheit, und wer jemandem eine
   * Aufgabe zuteilt, soll die richtige Person treffen. Angezeigt wird er nur,
   * wenn er sich vom Anzeigenamen unterscheidet - sonst steht dasselbe
   * zweimal.
   */
  username: string | null;
  avatarHash: string | null;
  ehemalig: boolean;
}

/**
 * Die Einstellungen des Moduls.
 *
 * `getModuleSettings` liest sie durch das Zod-Schema der Modulregistrierung -
 * fehlende oder kaputte Werte werden dort zu den Vorgaben, nicht hier.
 */
export async function workspaceEinstellungen(): Promise<workspace.WorkspaceSettings> {
  return getModuleSettings<workspace.WorkspaceSettings>(workspace.WORKSPACE_MODULE_ID);
}

/**
 * Wer zugewiesen werden kann.
 *
 * Alle, die `workspace.view` besitzen - und nicht alle Servermitglieder. Eine
 * Aufgabe jemandem zuzuweisen, der das Modul nicht öffnen darf, wäre eine
 * Zuweisung, von der der Zuständige nie erfährt.
 */
export async function ladeTeam(): Promise<Teammitglied[]> {
  const kennungen = await traegerDerBerechtigung(workspace.WORKSPACE_PERMISSIONS.view);
  return personenZuListe(kennungen);
}

/** Kennungen zu Namen - in der Reihenfolge der Namen. */
export async function personenZuListe(kennungen: readonly string[]): Promise<Teammitglied[]> {
  if (kennungen.length === 0) {
    return [];
  }
  const personen = await members.loadPersonen(kennungen);
  return kennungen
    .map((discordId) => {
      const person = personen.get(discordId);
      return {
        discordId,
        // Ohne Treffer die Kennung: sie ist hässlich, aber sie ist wahr - ein
        // erfundener Platzhalter wäre schlechter, weil er nach einem Namen
        // aussieht.
        name: person?.displayName ?? discordId,
        username: person?.username ?? null,
        avatarHash: person?.avatarHash ?? null,
        ehemalig: person?.ehemalig ?? true,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'de-CH'));
}

/**
 * Eine Nachschlagekarte für die Darstellung.
 *
 * Die Listen tragen Kennungen; die Komponenten brauchen Namen. Eine Karte für
 * die ganze Seite statt eines Treffers je Zeile.
 */
export async function namenKarte(
  kennungen: ReadonlyArray<string | null | undefined>,
): Promise<Map<string, Teammitglied>> {
  const personen = await members.loadPersonen(kennungen);
  const karte = new Map<string, Teammitglied>();
  for (const [discordId, person] of personen) {
    karte.set(discordId, {
      discordId,
      name: person.displayName,
      username: person.username,
      avatarHash: person.avatarHash,
      ehemalig: person.ehemalig,
    });
  }
  return karte;
}
