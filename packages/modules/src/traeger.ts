import { prisma } from '@swisshub/database';
import { bootstrapConfig } from '@swisshub/config';
import { hasPermission, loadRoleConfiguration, resolvePermissions } from '@swisshub/permissions';

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
