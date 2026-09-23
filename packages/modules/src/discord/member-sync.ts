import { Prisma, prisma } from '@swisshub/database';
import { discord as defaultDiscord, type DiscordGateway, type GuildMember } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';

const log = createLogger('discord:member-sync');

/**
 * Den Mitgliederbestand des Servers spiegeln.
 *
 * ## Warum
 *
 * Mitglieder wurden bewusst nicht gespiegelt und bei jedem Seitenaufruf direkt
 * bei Discord geholt. Nur liefert `GET /guilds/{id}/members` je Anfrage
 * hoechstens 1000 Eintraege und blaettert ueber einen Cursor - geholt wurde
 * genau **eine** Seite, gedeckelt auf 100. Gesucht, gefiltert und geblaettert
 * wurde anschliessend in JavaScript, also in diesen 100 Eintraegen.
 *
 * Damit kannte die Anwendung 100 von ueber 6000 Mitgliedern. Wer weiter hinten
 * stand, war ueber die Suche nicht zu finden, und die Gesamtzahl war die
 * Laenge des einen geholten Stapels.
 *
 * Ueber alle Mitglieder zu suchen heisst, alle zu kennen. Sie bei jedem Klick
 * erneut zu holen, waere weder schnell noch hoeflich gegenueber Discord. Also
 * dieselbe Loesung wie fuer Rollen und Kanaele: ein vollstaendiger Abgleich,
 * danach fortgeschrieben ueber die Gateway-Ereignisse.
 *
 * ## Wie
 *
 * Der Abgleich blaettert vollstaendig durch - `after` ist die hoechste bisher
 * gesehene Kennung - und hoert erst auf, wenn Discord eine kuerzere Seite als
 * die angeforderte liefert. Geschrieben wird in Stapeln ueber ein einzelnes
 * `INSERT ... ON CONFLICT`: bei 6000 Mitgliedern waeren einzelne Schreibbefehle
 * 6000 Roundtrips.
 *
 * Wer bei Discord nicht mehr auftaucht, wird als ausgetreten **markiert** und
 * nicht geloescht - genau wie eine geloeschte Rolle. Ein Moderationseintrag
 * zeigt sonst auf einen Namen, den niemand mehr aufloesen kann.
 */

/** Discord erlaubt hoechstens 1000 Mitglieder je Anfrage. */
const DISCORD_SEITE = 1000;
/** Zeilen je Schreibbefehl. Gross genug, um Roundtrips zu sparen. */
const SCHREIB_STAPEL = 500;
/**
 * Obergrenze der Seiten je Lauf.
 *
 * Ein Riegel gegen eine Schleife, die nicht endet - etwa wenn Discord den
 * Cursor einmal nicht weiterbewegt. Bei 1000 je Seite reicht das fuer
 * 500'000 Mitglieder und damit weit ueber jede reale Guild hinaus.
 */
const MAX_SEITEN = 500;

export interface MemberSyncSummary {
  /** Wie viele Mitglieder Discord insgesamt geliefert hat. */
  gesehen: number;
  /** Wie viele Zeilen geschrieben wurden (angelegt oder aktualisiert). */
  geschrieben: number;
  /** Wie viele als ausgetreten markiert wurden. */
  ausgetreten: number;
  seiten: number;
  durationMs: number;
  success: boolean;
  error?: string;
}

/** Benutzername, globaler Name, Spitzname und Anzeigename in Kleinschrift. */
export function suchtext(member: {
  username: string;
  globalName: string | null;
  nickname: string | null;
  displayName: string;
}): string {
  return [member.username, member.globalName, member.nickname, member.displayName]
    .filter((wert): wert is string => Boolean(wert))
    .map((wert) => wert.toLowerCase())
    .filter((wert, index, alle) => alle.indexOf(wert) === index)
    .join(' ');
}

/**
 * Einen Stapel Mitglieder schreiben.
 *
 * Ein einzelnes `INSERT ... ON CONFLICT DO UPDATE` statt eines Schreibbefehls
 * je Mitglied. `leftAt` wird dabei ausdruecklich zurueckgesetzt: wer wieder da
 * ist, ist wieder da.
 */
async function schreibeStapel(mitglieder: readonly GuildMember[], jetzt: Date): Promise<number> {
  if (mitglieder.length === 0) {
    return 0;
  }

  const zeilen = mitglieder.map(
    (member) => Prisma.sql`(
      ${member.discordId},
      ${member.username},
      ${member.globalName},
      ${member.nickname},
      ${member.displayName},
      ${member.avatarHash},
      ${member.isBot},
      ${member.roleIds},
      ${member.joinedAt},
      ${member.accountCreatedAt},
      ${member.boosting},
      ${member.timedOutUntil},
      ${suchtext(member)},
      ${jetzt},
      NULL
    )`,
  );

  return prisma.$executeRaw`
    INSERT INTO "DiscordMemberCache" (
      "discordId", "username", "globalName", "nickname", "displayName",
      "avatarHash", "isBot", "roleIds", "joinedAt", "accountCreatedAt",
      "boosting", "timedOutUntil", "searchText", "syncedAt", "leftAt"
    )
    VALUES ${Prisma.join(zeilen)}
    ON CONFLICT ("discordId") DO UPDATE SET
      "username" = EXCLUDED."username",
      "globalName" = EXCLUDED."globalName",
      "nickname" = EXCLUDED."nickname",
      "displayName" = EXCLUDED."displayName",
      "avatarHash" = EXCLUDED."avatarHash",
      "isBot" = EXCLUDED."isBot",
      "roleIds" = EXCLUDED."roleIds",
      "joinedAt" = EXCLUDED."joinedAt",
      "accountCreatedAt" = EXCLUDED."accountCreatedAt",
      "boosting" = EXCLUDED."boosting",
      "timedOutUntil" = EXCLUDED."timedOutUntil",
      "searchText" = EXCLUDED."searchText",
      "syncedAt" = EXCLUDED."syncedAt",
      "leftAt" = NULL
  `;
}

/** Ein einzelnes Mitglied fortschreiben - fuer die Gateway-Ereignisse. */
export async function merkeMitglied(member: GuildMember, jetzt = new Date()): Promise<void> {
  await schreibeStapel([member], jetzt);
}

/** Ein Mitglied als ausgetreten markieren. */
export async function merkeAustritt(discordId: string, jetzt = new Date()): Promise<void> {
  await prisma.discordMemberCache.updateMany({
    where: { discordId, leftAt: null },
    data: { leftAt: jetzt, syncedAt: jetzt },
  });
}

/**
 * Den vollstaendigen Mitgliederbestand abgleichen.
 *
 * Laeuft beim Start und danach in grossem Abstand als Sicherheitsnetz. Im
 * Betrieb halten die Gateway-Ereignisse den Spiegel aktuell; dieser Lauf holt
 * nach, was waehrend einer Unterbrechung geschah.
 */
export async function syncMembers(
  optionen: { gateway?: DiscordGateway; jetzt?: Date } = {},
): Promise<MemberSyncSummary> {
  const gateway = optionen.gateway ?? defaultDiscord;
  const jetzt = optionen.jetzt ?? new Date();
  const started = Date.now();

  let gesehen = 0;
  let geschrieben = 0;
  let seiten = 0;
  let after: string | undefined;
  const gesehene: string[] = [];

  try {
    for (let runde = 0; runde < MAX_SEITEN; runde += 1) {
      const stapel = await gateway.members.list({ limit: DISCORD_SEITE, after });
      seiten += 1;
      if (stapel.length === 0) {
        break;
      }

      gesehen += stapel.length;
      for (const member of stapel) {
        gesehene.push(member.discordId);
      }

      for (let i = 0; i < stapel.length; i += SCHREIB_STAPEL) {
        geschrieben += await schreibeStapel(stapel.slice(i, i + SCHREIB_STAPEL), jetzt);
      }

      /*
       * Der Cursor.
       *
       * Discord blaettert nach aufsteigender Kennung. Die hoechste dieser
       * Seite ist der Einstieg in die naechste. Die Kennungen sind Snowflakes
       * und damit groesser, als eine Zahl in JavaScript genau darstellen kann -
       * verglichen wird deshalb als Zeichenkette gleicher Laenge.
       */
      const hoechste = stapel.reduce(
        (bisher, member) => (groesser(member.discordId, bisher) ? member.discordId : bisher),
        stapel[0]!.discordId,
      );
      if (after === hoechste) {
        // Discord bewegt den Cursor nicht - weiterzublaettern hiesse, dieselbe
        // Seite endlos zu holen.
        log.warn('Mitglieder-Abgleich: Cursor bewegt sich nicht', { after, seiten });
        break;
      }
      after = hoechste;

      if (stapel.length < DISCORD_SEITE) {
        break;
      }
    }

    /*
     * Wer nicht mehr dabei ist.
     *
     * Nur, wenn ueberhaupt jemand geliefert wurde: eine leere Antwort - ein
     * fehlendes Intent, ein Ausfall - darf nicht den ganzen Server als
     * ausgetreten markieren.
     */
    let ausgetreten = 0;
    if (gesehene.length > 0) {
      const ergebnis = await prisma.discordMemberCache.updateMany({
        where: { discordId: { notIn: gesehene }, leftAt: null },
        data: { leftAt: jetzt, syncedAt: jetzt },
      });
      ausgetreten = ergebnis.count;
    }

    const summary: MemberSyncSummary = {
      gesehen,
      geschrieben,
      ausgetreten,
      seiten,
      durationMs: Date.now() - started,
      success: true,
    };
    log.info('Mitglieder synchronisiert', {
      gesehen,
      ausgetreten,
      seiten,
      durationMs: summary.durationMs,
    });
    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('Mitglieder-Abgleich fehlgeschlagen', { error, gesehen, seiten });
    return {
      gesehen,
      geschrieben,
      ausgetreten: 0,
      seiten,
      durationMs: Date.now() - started,
      success: false,
      error: message,
    };
  }
}

/** Snowflake-Vergleich als Zeichenkette: laenger ist groesser, sonst lexikalisch. */
function groesser(a: string, b: string): boolean {
  return a.length === b.length ? a > b : a.length > b.length;
}

export interface MemberSyncStand {
  /** Aktive Mitglieder im Spiegel. */
  gespiegelt: number;
  /** Davon Bots. */
  bots: number;
  /** Was Discord selbst als Mitgliederzahl meldet - oder `null`. */
  discord: number | null;
  letzterSync: Date | null;
}

/**
 * Der Stand des Spiegels.
 *
 * Damit eine erneute Abweichung auffaellt, statt still im Hintergrund zu
 * bestehen. Genau daran ist es zuletzt gescheitert: die Liste sah vollstaendig
 * aus, und nichts sagte, dass sie es nicht war.
 */
export async function memberSyncStand(): Promise<MemberSyncStand> {
  const [gespiegelt, bots, jungste, guild] = await Promise.all([
    prisma.discordMemberCache.count({ where: { leftAt: null } }),
    prisma.discordMemberCache.count({ where: { leftAt: null, isBot: true } }),
    prisma.discordMemberCache.findFirst({
      where: { leftAt: null },
      orderBy: { syncedAt: 'desc' },
      select: { syncedAt: true },
    }),
    prisma.guildConfig.findFirst({ select: { memberCount: true } }).catch(() => null),
  ]);

  return {
    gespiegelt,
    bots,
    discord: guild?.memberCount ?? null,
    letzterSync: jungste?.syncedAt ?? null,
  };
}
