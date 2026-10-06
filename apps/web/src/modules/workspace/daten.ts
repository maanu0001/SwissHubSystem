import 'server-only';
import { can } from '@swisshub/auth';
import type { AuthContext } from '@swisshub/auth';
import {
  getModuleSettings,
  members,
  moderation,
  traegerDerBerechtigung,
  traegerPruefung,
  traegerSuche,
  workspace,
} from '@swisshub/modules';

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
/**
 * Wer alles sieht - als Berechtigungsfrage und nicht als Namensliste.
 *
 * Zwei Schlüssel, und beide stehen für dieselbe Aussage: *diese Person hat im
 * Workspace nichts zu suchen, was sie nicht sehen dürfte.*
 *
 *  - `workspace.settings.manage` - wer das Modul verwaltet, muss auch an ein
 *    verwaistes privates Projekt herankommen, sonst gäbe es Projekte, die
 *    niemand mehr aufräumen kann.
 *  - `moderation.execute` - das allgemeine Recht zu moderieren. Es ist der
 *    Schlüssel, den die Vorlagen «Moderator» und «Senior Moderator»
 *    gemeinsam haben, und kein Mitglied und keine Community-Rolle traegt ihn.
 *
 * Die Administration braucht keinen eigenen Eintrag: `admin.full` beantwortet
 * jede Berechtigungsfrage mit ja, auch diese.
 *
 * ## Warum keine neue Berechtigung
 *
 * Weil eine neue Berechtigung niemandem gehört, bis jemand sie zuweist. Auf
 * einem Server, dessen Rollen seit Monaten eingerichtet sind, wäre
 * `workspace.view.all` ein Schlüssel ohne Schloss - das Modul wüsste, wer
 * alles sehen dürfte, und es wäre niemand. `moderation.execute` haben die
 * Moderatoren bereits; damit gilt die Zusage ohne einen einzigen Klick in der
 * Rollenverwaltung.
 */
export const WORKSPACE_VOLLZUGRIFF: readonly string[] = [
  workspace.WORKSPACE_PERMISSIONS.settingsManage,
  moderation.MODERATION_PERMISSIONS.execute,
];

/**
 * Wer das Modul oeffnen darf.
 *
 * Die Seiten des Workspace fragen diese Menge und nicht `workspace.view`
 * allein - «eine davon genuegt», wie `requirePagePermission` es mit mehreren
 * Angaben ohnehin versteht.
 *
 * ## Der Fehler, den das behebt
 *
 * `darfAlles` entscheidet, **welche Zeilen** jemand sieht. Es entscheidet
 * nicht, **ob die Seite aufgeht** - das tat der Riegel davor, und der hing an
 * `workspace.view`. Ein Moderator, der diese Berechtigung nie zugewiesen
 * bekam, kam damit gar nicht erst hinein: die Zusage «Moderatoren sehen alle
 * Projekte» galt fuer eine Seite, die er nicht oeffnen konnte. Nachgemessen am
 * gebauten Server: Projektliste ohne das private Projekt, Projektdetail ohne
 * Inhalt, Board leer.
 *
 * Beide Fragen haengen jetzt an derselben Menge. Eine zweite Antwort auf
 * «gehoert diese Person in den Workspace» gibt es nicht.
 */
export const WORKSPACE_ZUGANG: readonly string[] = [
  workspace.WORKSPACE_PERMISSIONS.view,
  ...WORKSPACE_VOLLZUGRIFF,
];

/**
 * Wer als Beteiligter in Frage kommt.
 *
 * Die Vollzugriffsberechtigungen gehören dazu, und zwar ausdrücklich: ein
 * Moderator, der jedes Projekt sieht, muss sich auch in eines eintragen
 * lassen können. Vorher war er im Suchfeld nicht auffindbar, weil er
 * `workspace.view` nicht einzeln zugewiesen hatte - er brauchte sie nie, um
 * hineinzukommen.
 *
 * Automatisch beteiligt ist dadurch niemand. Die Liste sagt, wer **wählbar**
 * ist; eingetragen wird, wer eingetragen wird.
 */
const WORKSPACE_BETEILIGUNG: readonly string[] = WORKSPACE_ZUGANG;

export function workspaceBetrachter(context: AuthContext): workspace.WorkspaceBetrachter {
  return {
    discordId: context.user.discordId,
    darfAlles: WORKSPACE_VOLLZUGRIFF.some((berechtigung) => can(context, berechtigung)),
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
 *
 * ## Warum zwei Quellen
 *
 * Weil eine davon im Betrieb fast leer war. `traegerDerBerechtigung` nimmt
 * seine Grundmenge aus den **angemeldeten** Benutzern - mit gutem Grund, dort
 * steht er -, und auf einem Server, dessen Mitglieder die WebApp kaum
 * benutzen, waren das 14 von 35. Jede Auswahlliste des Moduls kannte damit 14
 * Leute, und das sah nach einer kaputten Liste aus.
 *
 * Dazu kommen deshalb die Berechtigten aus dem Mitgliederspiegel: dieselbe
 * Berechtigung, an denselben Rollen geprüft, nur ohne die Anmeldung als
 * stille Voraussetzung. Die Vereinigung ist die Antwort auf «wer darf das
 * Modul öffnen» - und sie bleibt bei 200 gedeckelt, weil eine Liste in einer
 * Seite eine Liste bleiben soll. Wer darüber hinaus sucht, benutzt
 * `sucheTeam`.
 */
export async function ladeTeam(): Promise<Teammitglied[]> {
  const [kennungen, imSpiegel] = await Promise.all([
    traegerDerBerechtigung(workspace.WORKSPACE_PERMISSIONS.view),
    traegerSuche(WORKSPACE_BETEILIGUNG, '', { grenze: 200 }),
  ]);

  const liste = new Map<string, Teammitglied>();
  for (const person of imSpiegel) {
    liste.set(person.discordId, {
      discordId: person.discordId,
      name: person.displayName,
      username: person.username,
      avatarHash: person.avatarHash,
      ehemalig: false,
    });
  }
  // Die Angemeldeten danach, aber ohne die schon bekannten zu überschreiben:
  // der Spiegel ist die frischere Auskunft über Namen und Avatar.
  for (const person of await personenZuListe(kennungen)) {
    if (!liste.has(person.discordId)) {
      liste.set(person.discordId, person);
    }
  }
  return [...liste.values()].sort((a, b) => a.name.localeCompare(b.name, 'de-CH'));
}

/**
 * Wer zu einem Suchbegriff passt und zugewiesen werden kann.
 *
 * ## Der Fehler, den das behebt
 *
 * Das Suchfeld der Beteiligten zeigte auf dem Server keine Treffer. Es lag
 * nicht am Feld, nicht am Klick und nicht am Popover: `ladeTeam` nimmt seine
 * Grundmenge aus den **angemeldeten** Benutzern, und auf einem Server, dessen
 * Mitglieder die WebApp kaum oeffnen, sind das eine Handvoll. Nachgemessen:
 * 35 Mitglieder im Spiegel, 14 davon je angemeldet, 21 Treffer zu «manuel» im
 * Spiegel - und **keiner** davon in der Auswahlliste. Durchsucht wurde eine
 * Liste, in der die gesuchten Leute nicht standen.
 *
 * `traegerSuche` sucht deshalb im Mitgliederspiegel und prueft die
 * Berechtigung an den Rollen, die dort stehen. Dieselbe Berechtigung wie
 * vorher - nur ohne die Anmeldung als stille Voraussetzung.
 *
 * ## Warum es den Rueckfall auf `ladeTeam` gibt
 *
 * Weil der Spiegel leer sein kann: eine frisch eingerichtete Anwendung hat
 * noch nie abgeglichen, und eine Testumgebung hat Benutzer ohne Spiegelzeile.
 * Dann ist die kleine Menge besser als keine. Er greift nur, wenn der Spiegel
 * **nichts** liefert; im Normalfall kostet er keine Abfrage.
 */
export async function sucheTeam(begriff: string, grenze = 20): Promise<Teammitglied[]> {
  const treffer = await traegerSuche(WORKSPACE_BETEILIGUNG, begriff, { grenze });
  if (treffer.length > 0) {
    return treffer.map((person) => ({
      discordId: person.discordId,
      name: person.displayName,
      username: person.username,
      avatarHash: person.avatarHash,
      // Wer im Spiegel steht, ist auf dem Server - das ist, was der Spiegel
      // bedeutet.
      ehemalig: false,
    }));
  }

  const gesucht = begriff.trim().toLowerCase();
  const angemeldete = await ladeTeam();
  const passend =
    gesucht === ''
      ? angemeldete
      : angemeldete.filter(
          (eintrag) =>
            eintrag.name.toLowerCase().includes(gesucht) ||
            (eintrag.username ?? '').toLowerCase().includes(gesucht),
        );
  return passend.slice(0, grenze);
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
 * Ein Beteiligter, so wie die Oberfläche ihn braucht.
 *
 * `darfOeffnen` ist eine **berechnete** Auskunft und keine abgeleitete:
 * serverseitig an denselben Rollen und derselben Engine geprüft, mit der auch
 * der Riegel vor der Seite prüft.
 */
export interface Beteiligter extends Teammitglied {
  darfOeffnen: boolean;
}

/**
 * Die Beteiligten einer Seite - mit Namen und mit der Wahrheit über ihren
 * Zugang.
 *
 * ## Der Fehler, den das behebt
 *
 * Unter den Beteiligten eines Projekts stand «darf den Workspace nicht mehr
 * öffnen» - auch bei Leuten, die ihn sehr wohl öffnen durften. Der Hinweis
 * stand nicht da, weil jemand nachgesehen hätte, sondern weil die Komponente
 * ihn unter jeden Namen schrieb, den sie in `team` nicht fand. `team` ist die
 * Liste der **wählbaren** Personen: bei 200 gedeckelt, nach Anzeigename
 * sortiert und auf dem Mitgliederspiegel aufgebaut. Wer dahinter lag, nicht
 * gespiegelt war oder den Server verlassen hatte, fehlte darin - und bekam
 * eine Aussage über seine Rechte, die niemand geprüft hatte.
 *
 * Beteiligte sind Metadaten des Workspace: Projektleitung, Unterstützung,
 * Verantwortliche einer Aufgabe. Sie stehen in der Liste, weil jemand sie
 * eingetragen hat, und ihr Name gehört angezeigt, ob sie das Modul öffnen
 * dürfen oder nicht. Darum zwei getrennte Auskünfte statt einer geratenen:
 * der Name kommt aus `namenKarte` (Spiegel, dann angemeldete Benutzer), und
 * `darfOeffnen` aus `traegerPruefung` über genau diese Kennungen.
 */
export async function ladeBeteiligte(
  kennungen: ReadonlyArray<string | null | undefined>,
): Promise<Map<string, Beteiligter>> {
  const gesucht = [...new Set(kennungen.filter((kennung): kennung is string => Boolean(kennung)))];
  if (gesucht.length === 0) {
    return new Map();
  }
  const [namen, zugang] = await Promise.all([
    namenKarte(gesucht),
    traegerPruefung(gesucht, WORKSPACE_ZUGANG),
  ]);

  const karte = new Map<string, Beteiligter>();
  for (const discordId of gesucht) {
    const person = namen.get(discordId);
    karte.set(discordId, {
      discordId,
      /*
       * Ohne Treffer die Kennung - sie ist hässlich und wahr. Ein
       * Platzhalter sähe nach einem Namen aus.
       */
      name: person?.name ?? discordId,
      username: person?.username ?? null,
      avatarHash: person?.avatarHash ?? null,
      ehemalig: person?.ehemalig ?? true,
      darfOeffnen: zugang.get(discordId) ?? false,
    });
  }
  return karte;
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
