import { prisma } from '@swisshub/database';

/**
 * Avatar-Hashes zu Discord-IDs.
 *
 * Audit Log und Aktivitätsfeed speichern bewusst keine Avatare mit (sie würden
 * veralten). Für die Darstellung werden die Hashes deshalb gesammelt aus der
 * `User`-Tabelle nachgeschlagen - ein Query statt einer Discord-Anfrage pro
 * Zeile. Fehlt jemand dort (z.B. nie angemeldet), liefert die Avatar-Komponente
 * Discords Standardbild.
 */
export async function loadAvatarHashes(
  discordIds: ReadonlyArray<string | null | undefined>,
): Promise<Map<string, string | null>> {
  const unique = [...new Set(discordIds.filter((id): id is string => typeof id === 'string' && id !== ''))];
  if (unique.length === 0) {
    return new Map();
  }

  const users = await prisma.user.findMany({
    where: { discordId: { in: unique } },
    select: { discordId: true, avatarHash: true },
  });

  return new Map(users.map((user) => [user.discordId, user.avatarHash]));
}

export interface PersonImLog {
  discordId: string;
  displayName: string;
  username: string | null;
  avatarHash: string | null;
  /** Nicht mehr auf dem Server - der Eintrag bleibt trotzdem lesbar. */
  ehemalig: boolean;
}

/**
 * Personen fuer eine Liste aufloesen - in zwei Abfragen, nicht in N.
 *
 * ## Warum das hier steht
 *
 * Ein Audit-Eintrag traegt eine Kennung, manchmal einen Benutzernamen von
 * damals. Beides liest sich schlecht: `123456789012345678` sagt nichts, und
 * ein Name von vor einem Jahr ist nicht mehr der Name.
 *
 * Die Aufloesung gehoert an **eine** Stelle. Jede Komponente, die selbst
 * nachschlaegt, ist eine Abfrage je Zeile - bei fuenfundzwanzig Zeilen
 * fuenfundzwanzig Abfragen.
 *
 * ## Zwei Quellen, in dieser Reihenfolge
 *
 * Zuerst der Mitgliederspiegel: er kennt alle, mit Anzeigenamen und Bild.
 * Dann die angemeldeten Benutzer - fuer jemanden, der den Server verlassen
 * hat, aber ein Konto im Dashboard hatte.
 *
 * Wen beide nicht kennen, gilt als ehemalig. Der Eintrag bleibt lesbar: mit
 * dem Namen, der damals aufgeschrieben wurde, und der Kennung.
 */
export async function loadPersonen(
  discordIds: ReadonlyArray<string | null | undefined>,
): Promise<Map<string, PersonImLog>> {
  const kennungen = [
    ...new Set(discordIds.filter((id): id is string => typeof id === 'string' && id !== '')),
  ];
  if (kennungen.length === 0) {
    return new Map();
  }

  const [spiegel, benutzer] = await Promise.all([
    prisma.discordMemberCache.findMany({
      where: { discordId: { in: kennungen } },
      select: { discordId: true, displayName: true, username: true, avatarHash: true, leftAt: true },
    }),
    prisma.user.findMany({
      where: { discordId: { in: kennungen } },
      select: { discordId: true, username: true, avatarHash: true },
    }),
  ]);

  const ergebnis = new Map<string, PersonImLog>();
  for (const zeile of benutzer) {
    ergebnis.set(zeile.discordId, {
      discordId: zeile.discordId,
      displayName: zeile.username,
      username: zeile.username,
      avatarHash: zeile.avatarHash,
      ehemalig: true,
    });
  }
  // Der Spiegel gewinnt: er ist neuer und kennt den Anzeigenamen des Servers.
  for (const zeile of spiegel) {
    ergebnis.set(zeile.discordId, {
      discordId: zeile.discordId,
      displayName: zeile.displayName,
      username: zeile.username,
      avatarHash: zeile.avatarHash,
      ehemalig: zeile.leftAt !== null,
    });
  }

  return ergebnis;
}
