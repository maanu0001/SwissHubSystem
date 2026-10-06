import { prisma } from '@swisshub/database';
import { bootstrapConfig } from '@swisshub/config';
import {
  hasAnyPermission,
  hasPermission,
  loadRoleConfiguration,
  resolvePermissions,
} from '@swisshub/permissions';
import { suchePersonenSpiegel, type SpiegelPerson } from './members/service';

/**
 * Wer eine Berechtigung besitzt.
 *
 * ## Warum das an einer Stelle steht
 *
 * Weil die Frage «wer darf das?» im System auf zwei Weisen gestellt wird. Die
 * häufige ist: *darf **diese** Person das* - dafür gibt es den
 * `AuthContext` und `can()`. Die seltene ist diese: *wer alles darf das* - für
 * einen Empfängerkreis einer Meldung, für die Auswahlliste der Zuständigen
 * einer Aufgabe.
 *
 * Die zweite Frage braucht niemandes Sitzung, sondern die Rollen aller - und
 * sie zweimal zu beantworten hiesse, zwei Meinungen darüber zu haben, was
 * `admin.full` und eine ausdrückliche Ausnahme bedeuten. Gerechnet wird
 * deshalb mit **derselben** `resolvePermissions`/`hasPermission`, die auch die
 * Seite prüft.
 *
 * ## Woraus die Grundmenge besteht
 *
 * Aus den angemeldeten Benutzern, die Mitglied und nicht gesperrt sind. Nicht
 * aus dem Mitgliederspiegel: wer sich nie angemeldet hat, hat keine
 * aufgelösten Rollen im System und könnte keine Seite öffnen, auf die ein
 * Deep Link oder eine Zuweisung zeigt.
 *
 * Die Obergrenze ist eine Bremse und keine Auswahl - nach letzter Anmeldung
 * sortiert, damit sie im Zweifel die Aktiven trifft.
 */

const HOECHSTENS = 200;

export interface BerechtigungsTraeger {
  discordId: string;
}

export async function traegerDerBerechtigung(
  permission: string,
  optionen: { grenze?: number } = {},
): Promise<string[]> {
  const [konfiguration, benutzer] = await Promise.all([
    loadRoleConfiguration(),
    prisma.user.findMany({
      where: { isBlocked: false, identityCache: { isMember: true } },
      select: { discordId: true, identityCache: { select: { roleIds: true } } },
      orderBy: { lastLoginAt: 'desc' },
      take: Math.min(Math.max(optionen.grenze ?? HOECHSTENS, 1), HOECHSTENS),
    }),
  ]);

  const traeger: string[] = [];
  for (const eintrag of benutzer) {
    const aufloesung = resolvePermissions(
      {
        discordId: eintrag.discordId,
        roleIds: eintrag.identityCache?.roleIds ?? [],
        isOwner: bootstrapConfig.ownerDiscordId === eintrag.discordId,
      },
      konfiguration.mappings,
    );
    if (hasPermission(aufloesung, permission)) {
      traeger.push(eintrag.discordId);
    }
  }
  return traeger;
}

/** Eine Person, die die Berechtigung besitzt - mit allem, was ein Auswahlfeld zeigt. */
export interface TraegerPerson {
  discordId: string;
  displayName: string;
  username: string | null;
  avatarHash: string | null;
}

/**
 * Wer eine Berechtigung besitzt und zu einem Suchbegriff passt.
 *
 * ## Warum das nicht `traegerDerBerechtigung` ist
 *
 * Wegen der Grundmenge. Oben steht, warum sie dort aus den **angemeldeten**
 * Benutzern besteht: ein Empfaenger einer Meldung soll die Seite auch oeffnen
 * koennen, auf die der Link zeigt.
 *
 * Fuer ein Auswahlfeld ist genau das der Fehler. Auf einem Server, dessen
 * Mitglieder die WebApp kaum benutzen, haben sich eine Handvoll Leute je
 * angemeldet - und ein Suchfeld, das nur diese Handvoll kennt, findet zu
 * «man» niemanden, obwohl einundzwanzig Mitglieder so heissen. Es sah aus wie
 * ein kaputtes Dropdown und war eine zu kleine Grundmenge.
 *
 * Hier ist sie deshalb der Mitgliederspiegel: alle, die auf dem Server sind.
 * Die Berechtigung bleibt die gleiche Frage und wird mit derselben
 * `resolvePermissions`/`hasPermission` beantwortet - sie braucht keine
 * Anmeldung, sondern Rollen, und die traegt der Spiegel. Wer zugewiesen wird,
 * darf das Modul also nach wie vor oeffnen; er muss es nur noch nicht schon
 * einmal getan haben.
 *
 * ## Warum die Rohmenge groesser ist als die Ausgabe
 *
 * Gefiltert wird nach der Abfrage, nicht in ihr: die Berechtigung steht in
 * der Rollenzuordnung und nicht in der Datenbank. Geholt werden deshalb bis
 * zu `ROHMENGE` Treffer des Suchbegriffs, und erst was davon berechtigt ist,
 * wird auf `grenze` gekuerzt. Bei einer Suche ab zwei Zeichen ist die
 * Rohmenge klein; ohne Suchbegriff ist sie die Bremse, die sie sein soll.
 */
const ROHMENGE = 200;

export async function traegerSuche(
  permission: string | readonly string[],
  suche: string,
  optionen: { grenze?: number } = {},
): Promise<TraegerPerson[]> {
  const grenze = Math.min(Math.max(optionen.grenze ?? 20, 1), 200);
  const [konfiguration, kandidaten] = await Promise.all([
    loadRoleConfiguration(),
    suchePersonenSpiegel(suche, { grenze: Math.max(ROHMENGE, grenze) }),
  ]);

  const treffer: TraegerPerson[] = [];
  for (const person of kandidaten) {
    if (!darf(person, konfiguration.mappings, permission)) {
      continue;
    }
    treffer.push({
      discordId: person.discordId,
      displayName: person.displayName,
      username: person.username,
      avatarHash: person.avatarHash,
    });
    if (treffer.length >= grenze) {
      break;
    }
  }
  return treffer;
}

/**
 * Besitzen **diese** Personen die Berechtigung?
 *
 * ## Die dritte Frage
 *
 * Oben stehen zwei: «darf diese Person das» (`can()` auf der Sitzung) und
 * «wer alles darf das» (`traegerDerBerechtigung`, `traegerSuche`). Diese hier
 * ist die dritte: *von diesen benannten Leuten - wer darf?*
 *
 * ## Der Fehler, den das behebt
 *
 * Im Workspace stand unter Beteiligten «darf den Workspace nicht mehr
 * oeffnen». Das war keine Auskunft, sondern ein Schluss aus einer
 * Abwesenheit: die Oberflaeche bekam die Liste der **waehlbaren** Leute und
 * schrieb den Hinweis unter jeden Namen, der darin nicht vorkam. Diese Liste
 * ist aber gedeckelt und nach Anzeigenamen sortiert - wer dahinter liegt,
 * fehlte darin, ohne irgendein Recht verloren zu haben. Auch der Rest der
 * Menge war die falsche Grundlage: «kommt als neuer Beteiligter in Frage»
 * und «darf das Modul oeffnen» sind nicht dieselbe Frage.
 *
 * Gefragt wird jetzt nach genau den Kennungen, um die es geht. Das sind ein
 * paar pro Projekt, die Antwort kommt aus denselben Rollen und derselben
 * `resolvePermissions` wie jede andere Pruefung - und sie ist eine Antwort
 * und keine Vermutung.
 *
 * Die Rollen kommen aus dem Mitgliederspiegel, mit Rueckfall auf die
 * aufgeloesten Rollen eines angemeldeten Benutzers. `leftAt` wird nicht
 * gefiltert: wer den Server verlassen hat, hat immer noch die Rollen, die er
 * hatte, und ob er fort ist, ist eine andere Auskunft als ob er darf.
 *
 * Eine Kennung, zu der sich nichts finden laesst, bekommt `false` - ohne
 * Rollen gibt es keine Berechtigung. Der Aufrufer weiss selbst, dass er nach
 * ihr gefragt hat.
 */
export async function traegerPruefung(
  kennungen: readonly string[],
  permission: string | readonly string[],
): Promise<Map<string, boolean>> {
  const ergebnis = new Map<string, boolean>();
  const gesucht = [...new Set(kennungen)].filter((kennung) => kennung.length > 0);
  if (gesucht.length === 0) {
    return ergebnis;
  }

  const [konfiguration, imSpiegel, angemeldete] = await Promise.all([
    loadRoleConfiguration(),
    prisma.discordMemberCache.findMany({
      where: { discordId: { in: gesucht } },
      select: { discordId: true, roleIds: true },
    }),
    prisma.user.findMany({
      where: { discordId: { in: gesucht } },
      select: { discordId: true, identityCache: { select: { roleIds: true } } },
    }),
  ]);

  const rollen = new Map<string, string[]>();
  for (const zeile of angemeldete) {
    rollen.set(zeile.discordId, zeile.identityCache?.roleIds ?? []);
  }
  // Der Spiegel danach: er ist die frischere Auskunft ueber die Rollen auf
  // dem Server, und die aufgeloesten Rollen einer Sitzung koennen alt sein.
  for (const zeile of imSpiegel) {
    rollen.set(zeile.discordId, zeile.roleIds);
  }

  for (const discordId of gesucht) {
    const roleIds = rollen.get(discordId);
    if (!roleIds) {
      ergebnis.set(discordId, false);
      continue;
    }
    const aufloesung = resolvePermissions(
      {
        discordId,
        roleIds,
        isOwner: bootstrapConfig.ownerDiscordId === discordId,
      },
      konfiguration.mappings,
    );
    ergebnis.set(
      discordId,
      typeof permission === 'string'
        ? hasPermission(aufloesung, permission)
        : hasAnyPermission(aufloesung, [...permission]),
    );
  }
  return ergebnis;
}

/**
 * Besitzt diese Person die Berechtigung - oder eine davon?
 *
 * Mehrere, weil manche Fragen mehrere Antworten haben. «Wer darf als
 * Beteiligter im Workspace stehen» sind die mit `workspace.view` **und** die,
 * die ohnehin alles sehen: Administration und Moderation. Eine Liste mit
 * `hasAnyPermission` sagt das in einer Zeile; drei Aufrufe mit drei
 * Ergebnislisten muessten danach wieder vereinigt werden.
 */
function darf(
  person: SpiegelPerson,
  mappings: Awaited<ReturnType<typeof loadRoleConfiguration>>['mappings'],
  permission: string | readonly string[],
): boolean {
  const aufloesung = resolvePermissions(
    {
      discordId: person.discordId,
      roleIds: person.roleIds,
      isOwner: bootstrapConfig.ownerDiscordId === person.discordId,
    },
    mappings,
  );
  return typeof permission === 'string'
    ? hasPermission(aufloesung, permission)
    : hasAnyPermission(aufloesung, [...permission]);
}
