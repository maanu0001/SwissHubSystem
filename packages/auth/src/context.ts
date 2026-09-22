import { bootstrapConfig, identityConfig } from '@swisshub/config';
import {
  AUDIT_ACTIONS,
  SECURITY_EVENTS,
  prisma,
  recordSecurityEvent,
  safeRecordAudit,
} from '@swisshub/database';
import {
  ADMIN_FULL,
  hasPermission,
  listPermissions,
  loadRoleConfiguration,
  moderationLevelOf,
  resolvePermissions,
  type PermissionResolution,
} from '@swisshub/permissions';
import { AppError } from '@swisshub/shared';
import type { AppRole, User } from '@swisshub/database';
import { getIdentity, type DiscordIdentity } from './identity';

/**
 * Aufgelöster Sicherheitskontext eines Requests.
 *
 * Er bündelt Identität, aktuelle Discord-Rollen und effektive Permissions.
 * Jede serverseitige Aktion arbeitet ausschliesslich mit diesem Kontext.
 */
export interface AuthUser {
  id: string;
  discordId: string;
  username: string;
  globalName: string | null;
  displayName: string;
  avatarHash: string | null;
  appRole: AppRole;
  isOwner: boolean;
}

/**
 * Eine laufende Vorschau.
 *
 * **Keine Identitätsübernahme.** `user` bleibt die angemeldete Person, die
 * Sitzung bleibt ihre, und jede serverseitige Autorisierung folgt weiterhin
 * ihr. Was sich ändert, ist ausschliesslich die Frage «was sähe diese Person
 * oder diese Rolle?» - beantwortet von derselben Permission Engine, mit
 * denselben Regeln.
 */
export interface PreviewContext {
  kind: 'USER' | 'ROLE';
  /** Discord-ID der Person bzw. ID der Rolle. */
  subjectId: string;
  /** Anzeigename für den Banner. */
  label: string;
  startedAt: Date;
  expiresAt: Date;
}

export interface AuthContext {
  user: AuthUser;
  sessionId: string;
  identity: DiscordIdentity;
  isMember: boolean;
  /**
   * Die Permissions, nach denen die Oberfläche entscheidet, was zu sehen ist.
   *
   * Ohne Vorschau sind das die der angemeldeten Person. Läuft eine Vorschau,
   * sind es die der Vorschau-Person - und `realPermissions` daneben bleiben
   * die echten. Beides zusammen ist die ganze Sicherheit dieser Funktion:
   * `can()` verlangt **beide**, eine Vorschau kann deshalb nie mehr zeigen,
   * als die angemeldete Person ohnehin sehen dürfte.
   */
  permissions: PermissionResolution;
  /**
   * Die Permissions der angemeldeten Person - gesetzt, solange eine Vorschau
   * läuft. Serverseitige Autorisierung folgt ausschliesslich ihnen.
   */
  realPermissions?: PermissionResolution;
  /** Ausgerollte Permission-Liste für das UI (nur UX, keine Sicherheit). */
  permissionKeys: string[];
  /** Höchste Moderationsstufe der aktuellen Rollen. */
  moderationLevel: number;
  roleIds: string[];
  /** Läuft gerade eine Vorschau? Dann ist alles Schreibende gesperrt. */
  preview?: PreviewContext;
}

export type Freshness = 'cached' | 'critical';

export interface BuildContextInput {
  user: User;
  sessionId: string;
  freshness?: Freshness;
}

export async function buildAuthContext({
  user,
  sessionId,
  freshness = 'cached',
}: BuildContextInput): Promise<AuthContext> {
  const identity = await getIdentity(user.discordId, {
    maxAgeMs: freshness === 'critical' ? identityConfig.criticalTtlMs : identityConfig.cacheTtlMs,
  });

  const isOwner = bootstrapConfig.ownerDiscordId === user.discordId;
  const configuration = await loadRoleConfiguration();
  const permissions = resolvePermissions(
    { discordId: user.discordId, roleIds: identity.roleIds, isOwner },
    configuration.mappings,
  );

  const permissionKeys = listPermissions()
    .map((definition) => definition.key)
    .filter((key) => hasPermission(permissions, key));

  const appRole = deriveAppRole({ isOwner, permissions });
  if (appRole !== user.appRole) {
    await prisma.user.update({ where: { id: user.id }, data: { appRole } }).catch(() => undefined);
  }

  return {
    user: {
      id: user.id,
      discordId: user.discordId,
      username: user.username,
      globalName: user.globalName,
      displayName: identity.displayName ?? user.globalName ?? user.username,
      avatarHash: user.avatarHash,
      appRole,
      isOwner,
    },
    sessionId,
    identity,
    isMember: identity.isMember,
    permissions,
    permissionKeys,
    moderationLevel: moderationLevelOf(identity.roleIds, configuration.moderationLevels),
    roleIds: identity.roleIds,
  };
}

/**
 * Grobe Anwendungsgruppe - reine Anzeigeinformation. Massgeblich für
 * Entscheidungen sind ausschliesslich die Permissions.
 */
export function deriveAppRole(input: { isOwner: boolean; permissions: PermissionResolution }): AppRole {
  if (input.isOwner) {
    return 'OWNER';
  }
  if (input.permissions.granted.has(ADMIN_FULL) || hasPermission(input.permissions, 'settings.edit')) {
    return 'ADMIN';
  }
  if (hasPermission(input.permissions, 'moderation.execute')) {
    return 'MODERATOR';
  }
  if (input.permissions.granted.size > 0) {
    return 'TEAM';
  }
  return 'USER';
}

export interface GuardMetadata {
  ipHash?: string | null;
  userAgent?: string | null;
  path?: string | null;
  module?: string | null;
}

/** Stellt sicher, dass der Benutzer aktuell Mitglied der SwissHub Guild ist. */
export function assertMembership(context: AuthContext, metadata: GuardMetadata = {}): void {
  if (context.isMember) {
    return;
  }
  void recordSecurityEvent({
    type: SECURITY_EVENTS.NOT_A_MEMBER,
    severity: 'MEDIUM',
    discordId: context.user.discordId,
    ipHash: metadata.ipHash,
    userAgent: metadata.userAgent,
    path: metadata.path,
  });
  throw new AppError('NOT_A_MEMBER');
}

/**
 * Zentrale Berechtigungsprüfung.
 *
 * Fail closed: fehlt die Permission, wird die Aktion abgebrochen, ein
 * Sicherheitsereignis erfasst und der Versuch im Audit Log vermerkt.
 */
export async function assertPermission(
  context: AuthContext,
  permission: string,
  metadata: GuardMetadata = {},
): Promise<void> {
  assertMembership(context, metadata);
  /*
   * Serverseitig zählt die angemeldete Person, nie eine Vorschau.
   *
   * Eine Vorschau darf die Oberfläche einschränken; sie darf nicht darüber
   * entscheiden, was der Server tut. Mutierende Aktionen sind während einer
   * Vorschau ohnehin gesperrt - diese Zeile ist die zweite Verteidigungslinie
   * und stellt sicher, dass eine Vorschau auch dann nichts verschiebt, wenn
   * die erste einmal fehlen sollte.
   */
  if (hasPermission(context.realPermissions ?? context.permissions, permission)) {
    return;
  }

  await Promise.all([
    recordSecurityEvent({
      type: SECURITY_EVENTS.PERMISSION_DENIED,
      severity: 'MEDIUM',
      discordId: context.user.discordId,
      ipHash: metadata.ipHash,
      userAgent: metadata.userAgent,
      path: metadata.path,
      metadata: { permission },
    }),
    safeRecordAudit({
      action: AUDIT_ACTIONS.PERMISSION_DENIED,
      module: metadata.module ?? null,
      actorDiscordId: context.user.discordId,
      actorUsername: context.user.username,
      success: false,
      errorCode: 'FORBIDDEN',
      metadata: { permission, path: metadata.path ?? null },
      ipHash: metadata.ipHash,
      userAgent: metadata.userAgent,
    }),
  ]);

  throw new AppError('FORBIDDEN', {
    internalMessage: `Permission ${permission} fehlt für ${context.user.discordId}`,
  });
}

/**
 * Darf der Betrachter das sehen?
 *
 * Während einer Vorschau müssen **beide** Seiten zustimmen: die
 * Vorschau-Person (sonst zeigte die Vorschau etwas, das sie nie sähe) und die
 * angemeldete Person (sonst wäre die Vorschau eine Rechteausweitung - man
 * wählte eine Rolle mit mehr Rechten als die eigenen und sähe deren
 * Oberfläche). Eine gefälschte Vorschau-Kennung bringt dadurch nichts: sie
 * kann nur wegnehmen, nie hinzufügen.
 */
export function can(context: AuthContext, permission: string): boolean {
  if (!context.isMember) {
    return false;
  }
  if (!hasPermission(context.permissions, permission)) {
    return false;
  }
  return context.realPermissions ? hasPermission(context.realPermissions, permission) : true;
}
