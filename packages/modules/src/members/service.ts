import { prisma } from '@swisshub/database';
import {
  discord as defaultDiscord,
  type DiscordGateway,
  type GuildMember,
  type GuildRole,
} from '@swisshub/discord';
import { isSnowflake, sanitizeText } from '@swisshub/shared';
import type { DiscordMemberCache, JailEntry, ModerationAction, Prisma } from '@swisshub/database';
import { getCoreSettings } from '../settings';

/**
 * Mitglieder-Service.
 *
 * Mitgliederdaten werden bei Discord gelesen und NICHT dauerhaft gespiegelt
 * (Datensparsamkeit). Persistiert wird nur, was für Moderation und
 * Nachvollziehbarkeit gebraucht wird.
 */
export interface MemberRoleView {
  id: string;
  name: string;
  color: number;
  position: number;
}

export interface MemberSummary {
  discordId: string;
  username: string;
  displayName: string;
  avatarHash: string | null;
  isBot: boolean;
  roles: MemberRoleView[];
  joinedAt: Date | null;
  accountCreatedAt: Date | null;
  boosting: boolean;
  /** Aktiver Jail, falls vorhanden. */
  /** Aktiver Jail; `endsAt` ist `null` bei einem permanenten Jail. */
  activeJail: { id: string; endsAt: Date | null; reason: string } | null;
  timedOut: boolean;
}

export interface MemberProfile extends MemberSummary {
  jailHistory: JailEntry[];
  moderationHistory: ModerationAction[];
}

function toRoleViews(roleIds: readonly string[], roles: readonly GuildRole[]): MemberRoleView[] {
  return roleIds
    .map((roleId) => roles.find((role) => role.id === roleId))
    .filter((role): role is GuildRole => role !== undefined)
    .sort((a, b) => b.position - a.position)
    .map((role) => ({ id: role.id, name: role.name, color: role.color, position: role.position }));
}

async function decorate(members: GuildMember[], gateway: DiscordGateway): Promise<MemberSummary[]> {
  if (members.length === 0) {
    return [];
  }
  const [roles, activeJails] = await Promise.all([
    gateway.roles.list(),
    prisma.jailEntry.findMany({
      where: {
        targetDiscordId: { in: members.map((member) => member.discordId) },
        releasedAt: null,
        status: { in: ['COMPLETED', 'PARTIAL'] },
      },
      select: { id: true, targetDiscordId: true, endsAt: true, reason: true },
    }),
  ]);

  const jailByDiscordId = new Map(activeJails.map((jail) => [jail.targetDiscordId, jail]));

  return members.map((member) => {
    const jail = jailByDiscordId.get(member.discordId);
    return {
      discordId: member.discordId,
      username: member.username,
      displayName: member.displayName,
      avatarHash: member.avatarHash,
      isBot: member.isBot,
      roles: toRoleViews(member.roleIds, roles),
      joinedAt: member.joinedAt,
      accountCreatedAt: member.accountCreatedAt,
      boosting: member.boosting,
      activeJail: jail ? { id: jail.id, endsAt: jail.endsAt, reason: jail.reason } : null,
      timedOut: member.timedOutUntil !== null && member.timedOutUntil > new Date(),
    };
  });
}

/**
 * Serverseitige Mitgliedersuche nach Username, Anzeigename oder Discord ID.
 * Es wird niemals die vollständige Mitgliederliste an den Browser gesendet.
 */
export async function searchMembers(
  rawQuery: string,
  options: { limit?: number; gateway?: DiscordGateway } = {},
): Promise<MemberSummary[]> {
  const gateway = options.gateway ?? defaultDiscord;
  const query = sanitizeText(rawQuery, 100);
  const settings = await getCoreSettings();
  const limit = Math.min(options.limit ?? settings.memberSearchLimit, 100);

  if (query.length === 0) {
    return decorate(await gateway.members.list({ limit }), gateway);
  }

  if (isSnowflake(query)) {
    const member = await gateway.members.get(query);
    return member ? decorate([member], gateway) : [];
  }

  if (query.length < 2) {
    return [];
  }

  return decorate(await gateway.members.search(query, limit), gateway);
}

/**
 * Die Basisdaten eines Mitglieds.
 *
 * Ohne Verlauf: wer den Jail-Verlauf oder die Moderationshistorie braucht,
 * fragt sie einzeln an. Frueher lieferte diese Datei beides ungefragt mit,
 * und die Profilseite zeigte es jedem, der Mitglieder ansehen durfte - das
 * Member Center entscheidet nun je Abschnitt.
 */
export async function getMemberSummary(
  discordId: string,
  options: { gateway?: DiscordGateway } = {},
): Promise<MemberSummary | null> {
  const gateway = options.gateway ?? defaultDiscord;
  const member = await gateway.members.get(discordId);
  if (!member) {
    return null;
  }
  const [summary] = await decorate([member], gateway);
  return summary ?? null;
}

export async function getMemberProfile(
  discordId: string,
  options: { gateway?: DiscordGateway } = {},
): Promise<MemberProfile | null> {
  const gateway = options.gateway ?? defaultDiscord;
  const member = await gateway.members.get(discordId);
  if (!member) {
    return null;
  }
  const [summary] = await decorate([member], gateway);
  if (!summary) {
    return null;
  }

  const [jailHistory, moderationHistory] = await Promise.all([
    prisma.jailEntry.findMany({
      where: { targetDiscordId: discordId },
      orderBy: { startedAt: 'desc' },
      take: 20,
    }),
    prisma.moderationAction.findMany({
      where: { targetDiscordId: discordId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
  ]);

  return { ...summary, jailHistory, moderationHistory };
}

/**
 * Filter der Mitgliederliste.
 *
 * Bewusst nur diese vier. Ein Filter ist ein Versprechen, dass die Liste
 * danach vollstaendig ist - und das laesst sich nur halten, wo die Daten
 * ohne zusaetzliche Anfrage je Mitglied vorliegen. «Online» zum Beispiel
 * fehlt: die Anwesenheit kennt nur das Gateway, und sie fuer eine
 * Filterzeile abzufragen hiesse, sie dauerhaft zu speichern.
 */
export interface MemberFilter {
  /** Nur Mitglieder mit dieser Rolle. */
  roleId?: string | null;
  /** Nur Mitglieder mit laufendem Jail. */
  jailed?: boolean;
  /** Nur Mitglieder mit laufendem Premium. */
  premium?: boolean;
  /** Bots ausblenden. */
  ohneBots?: boolean;
}

export interface MemberPage {
  members: MemberSummary[];
  /** Treffer vor der Seitenaufteilung. */
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Mitglieder suchen, filtern und seitenweise ausgeben.
 *
 * ## Was hier vorher stand
 *
 * Geholt wurde eine Seite bei Discord - `searchMembers` mit einem Limit, das
 * intern auf 100 gedeckelt war -, und darin wurde anschliessend in JavaScript
 * gefiltert und geblaettert. `total` war die Laenge dieses einen Stapels.
 *
 * Dadurch kannte die Anwendung 100 von ueber 6000 Mitgliedern. Die Suche fand
 * niemanden, der nicht zufaellig in diesen 100 stand, der Rollenfilter lief
 * ebenfalls nur ueber sie, und die Gesamtzahl war schlicht falsch - «99
 * Mitglieder, Seite 1 von 5» waren 100 geholte minus einen Bot.
 *
 * ## Was jetzt geschieht
 *
 * Gesucht, gefiltert, sortiert und geblaettert wird in der Datenbank, gegen
 * den vollstaendigen Spiegel des Mitgliederbestands. Der Browser bekommt eine
 * Seite, die Datenbank kennt alle - und `total` ist ein `count` ueber alles,
 * was dem Filter entspricht, nicht die Laenge der Ausgabe.
 */
export async function listMembersPage(
  rawQuery: string,
  filter: MemberFilter = {},
  options: { page?: number; pageSize?: number; gateway?: DiscordGateway } = {},
): Promise<MemberPage> {
  const pageSize = Math.min(Math.max(options.pageSize ?? 100, 1), 100);
  const page = Math.max(options.page ?? 1, 1);
  const gateway = options.gateway ?? defaultDiscord;
  const query = sanitizeText(rawQuery, 100).trim();

  /*
   * Solange noch nie abgeglichen wurde, gibt es nichts zu durchsuchen.
   *
   * Dann lieber der alte Weg ueber Discord als eine leere Seite: eine frisch
   * eingerichtete Anwendung soll Mitglieder zeigen, auch bevor der erste
   * Abgleich gelaufen ist.
   */
  if ((await prisma.discordMemberCache.count({ where: { leftAt: null } })) === 0) {
    return listMembersPageUeberDiscord(query, filter, { page, pageSize, gateway });
  }

  const where = await bedingung(query, filter);

  const [zeilen, total] = await Promise.all([
    prisma.discordMemberCache.findMany({
      where,
      // Nach Anzeigename, und bei Gleichstand nach Kennung - sonst koennte
      // dasselbe Mitglied auf zwei Seiten erscheinen oder auf keiner.
      orderBy: [{ displayName: 'asc' }, { discordId: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.discordMemberCache.count({ where }),
  ]);

  return { members: await ausSpiegel(zeilen, gateway), total, page, pageSize };
}

/** Die Bedingung der Liste - Suche und Filter, vor jeder Seitenaufteilung. */
async function bedingung(query: string, filter: MemberFilter): Promise<Prisma.DiscordMemberCacheWhereInput> {
  const where: Prisma.DiscordMemberCacheWhereInput = { leftAt: null };

  if (filter.ohneBots === true) {
    where.isBot = false;
  }
  if (filter.roleId) {
    where.roleIds = { has: filter.roleId };
  }

  if (query.length > 0) {
    where.OR = isSnowflake(query)
      ? // Eine Kennung ist eine Kennung - kein Teiltreffer im Namen.
        [{ discordId: query }]
      : [
          // `searchText` traegt Benutzername, globalen Namen, Spitznamen und
          // Anzeigenamen in Kleinschrift. Eine Bedingung statt vier.
          { searchText: { contains: query.toLowerCase() } },
          { discordId: { startsWith: query } },
        ];
  }

  /*
   * Jail und Premium stehen in eigenen Tabellen.
   *
   * Beides sind kleine Mengen - wer eingesperrt ist oder ein Abonnement hat,
   * sind Dutzende, nicht Tausende. Ihre Kennungen einmal zu holen und in die
   * Bedingung zu geben, ist guenstiger als eine Verknuepfung ueber den ganzen
   * Mitgliederbestand, und es bleibt eine Abfrage je Seite - kein N+1.
   */
  const einschraenkungen: string[][] = [];
  if (filter.jailed === true) {
    const jails = await prisma.jailEntry.findMany({
      where: { releasedAt: null, status: { in: ['COMPLETED', 'PARTIAL'] } },
      select: { targetDiscordId: true },
      distinct: ['targetDiscordId'],
    });
    einschraenkungen.push(jails.map((eintrag) => eintrag.targetDiscordId));
  }
  if (filter.premium === true) {
    const abos = await prisma.premiumSubscription.findMany({
      where: { status: 'ACTIVE' },
      select: { discordId: true },
      distinct: ['discordId'],
    });
    einschraenkungen.push(abos.map((eintrag) => eintrag.discordId));
  }
  for (const kennungen of einschraenkungen) {
    where.AND = [...(Array.isArray(where.AND) ? where.AND : []), { discordId: { in: kennungen } }];
  }

  return where;
}

/** Zeilen des Spiegels in die Ansicht uebersetzen. */
async function ausSpiegel(
  zeilen: readonly DiscordMemberCache[],
  gateway: DiscordGateway,
): Promise<MemberSummary[]> {
  if (zeilen.length === 0) {
    return [];
  }
  const [roles, activeJails] = await Promise.all([
    gateway.roles.list(),
    prisma.jailEntry.findMany({
      where: {
        targetDiscordId: { in: zeilen.map((zeile) => zeile.discordId) },
        releasedAt: null,
        status: { in: ['COMPLETED', 'PARTIAL'] },
      },
      select: { id: true, targetDiscordId: true, endsAt: true, reason: true },
    }),
  ]);
  const jailByDiscordId = new Map(activeJails.map((jail) => [jail.targetDiscordId, jail]));
  const jetzt = new Date();

  return zeilen.map((zeile) => {
    const jail = jailByDiscordId.get(zeile.discordId);
    return {
      discordId: zeile.discordId,
      username: zeile.username,
      displayName: zeile.displayName,
      avatarHash: zeile.avatarHash,
      isBot: zeile.isBot,
      roles: toRoleViews(zeile.roleIds, roles),
      joinedAt: zeile.joinedAt,
      accountCreatedAt: zeile.accountCreatedAt,
      boosting: zeile.boosting,
      activeJail: jail ? { id: jail.id, endsAt: jail.endsAt, reason: jail.reason } : null,
      timedOut: zeile.timedOutUntil !== null && zeile.timedOutUntil > jetzt,
    };
  });
}

/**
 * Der Weg ueber Discord - nur noch, solange der Spiegel leer ist.
 *
 * Er kann nicht mehr, als er je konnte: eine Seite bei Discord, danach
 * filtern und blaettern im Geholten. Genau deshalb steht er hier nur als
 * Uebergang bis zum ersten Abgleich.
 */
async function listMembersPageUeberDiscord(
  query: string,
  filter: MemberFilter,
  options: { page: number; pageSize: number; gateway: DiscordGateway },
): Promise<MemberPage> {
  const kandidaten = await searchMembers(query, { limit: 100, gateway: options.gateway });

  let gefiltert = kandidaten;
  if (filter.ohneBots === true) {
    gefiltert = gefiltert.filter((member) => !member.isBot);
  }
  if (filter.roleId) {
    gefiltert = gefiltert.filter((member) => member.roles.some((role) => role.id === filter.roleId));
  }
  if (filter.jailed === true) {
    gefiltert = gefiltert.filter((member) => member.activeJail !== null);
  }
  if (filter.premium === true) {
    const mitPremium = await prisma.premiumSubscription.findMany({
      where: { discordId: { in: gefiltert.map((member) => member.discordId) }, status: 'ACTIVE' },
      select: { discordId: true },
    });
    const menge = new Set(mitPremium.map((eintrag) => eintrag.discordId));
    gefiltert = gefiltert.filter((member) => menge.has(member.discordId));
  }

  const start = (options.page - 1) * options.pageSize;
  return {
    members: gefiltert.slice(start, start + options.pageSize),
    total: gefiltert.length,
    page: options.page,
    pageSize: options.pageSize,
  };
}
