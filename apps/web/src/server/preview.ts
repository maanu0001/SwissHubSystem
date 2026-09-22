import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { COOKIE, bootstrapConfig, env, isProduction } from '@swisshub/config';
import { hmacSha256, safeEqual } from '@swisshub/shared/crypto';
import { AppError } from '@swisshub/shared';
import {
  hasPermission,
  listPermissions,
  loadRoleConfiguration,
  resolvePermissions,
} from '@swisshub/permissions';
import { prisma } from '@swisshub/database';
import type { AuthContext, PreviewContext } from '@swisshub/auth';

/**
 * «Ansicht als …» - die Vorschau.
 *
 * ## Was sie ist
 *
 * Eine Antwort auf die Frage: *Wie sähe das Dashboard für diese Person oder
 * diese Rolle aus?* Sidebar, Seiten, Reiter, Knöpfe und Kacheln richten sich
 * danach.
 *
 * ## Was sie nicht ist
 *
 * Keine Identitätsübernahme. Die Sitzung bleibt die der angemeldeten Person,
 * `context.user` bleibt sie, das Audit Log nennt sie. Niemand handelt als
 * jemand anders - es wird während einer Vorschau überhaupt nicht gehandelt:
 * jede Server Action ist gesperrt (siehe `defineAction`).
 *
 * ## Warum sie nichts ausweiten kann
 *
 * Drei Riegel, und jeder allein genügte:
 *
 * 1. **Die Schnittmenge.** `can()` verlangt die Zustimmung beider Seiten -
 *    der Vorschau-Person *und* der angemeldeten. Eine Vorschau kann deshalb
 *    nur wegnehmen. Eine gefälschte Kennung im Cookie bringt nichts.
 * 2. **Die Signatur.** Das Cookie trägt einen HMAC über Art, Ziel und
 *    Ablauf. Wer es verändert, macht es ungültig.
 * 3. **Die Berechtigung.** Ohne `preview.use` wird das Cookie ignoriert,
 *    auch wenn es gültig ist - etwa nach einem Rechteentzug.
 *
 * ## Warum sie nicht ewig läuft
 *
 * Ein Admin, der am nächsten Tag unbemerkt weiter in einer Vorschau sässe,
 * hielte das Dashboard für kaputt. Das Cookie ist auf `PREVIEW_TTL_MS`
 * begrenzt, und der Ablauf steht **in** der Signatur - ein abgelaufenes
 * Cookie lässt sich nicht durch ein längeres Verfallsdatum am Browser
 * verlängern.
 */

/** Wie lange eine Vorschau höchstens läuft. */
export const PREVIEW_TTL_MS = 30 * 60 * 1000;

export const PREVIEW_PERMISSIONS = {
  use: 'preview.use',
  user: 'preview.user',
  role: 'preview.role',
} as const;

interface PreviewNutzlast {
  kind: 'USER' | 'ROLE';
  subjectId: string;
  label: string;
  expiresAt: number;
}

function signiere(nutzlast: PreviewNutzlast): string {
  const daten = JSON.stringify(nutzlast);
  const roh = Buffer.from(daten, 'utf8').toString('base64url');
  return `${roh}.${hmacSha256(env.AUTH_SECRET, `preview:${roh}`)}`;
}

function pruefe(wert: string | undefined): PreviewNutzlast | null {
  if (!wert) {
    return null;
  }
  const [roh, signatur] = wert.split('.', 2);
  if (!roh || !signatur || !safeEqual(hmacSha256(env.AUTH_SECRET, `preview:${roh}`), signatur)) {
    return null;
  }
  try {
    const nutzlast = JSON.parse(Buffer.from(roh, 'base64url').toString('utf8')) as PreviewNutzlast;
    if (nutzlast.kind !== 'USER' && nutzlast.kind !== 'ROLE') {
      return null;
    }
    if (typeof nutzlast.subjectId !== 'string' || !/^\d{17,20}$/u.test(nutzlast.subjectId)) {
      return null;
    }
    if (typeof nutzlast.expiresAt !== 'number' || nutzlast.expiresAt <= Date.now()) {
      return null;
    }
    return nutzlast;
  } catch {
    return null;
  }
}

/** Die rohe Vorschau aus dem Cookie - geprüft, aber noch ohne Berechtigung. */
export const rohePreview = cache(async (): Promise<PreviewNutzlast | null> => {
  const store = await cookies();
  return pruefe(store.get(COOKIE.preview)?.value);
});

export async function setzePreviewCookie(nutzlast: Omit<PreviewNutzlast, 'expiresAt'>): Promise<Date> {
  const expiresAt = Date.now() + PREVIEW_TTL_MS;
  const store = await cookies();
  store.set(COOKIE.preview, signiere({ ...nutzlast, expiresAt }), {
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(PREVIEW_TTL_MS / 1000),
  });
  return new Date(expiresAt);
}

export async function loeschePreviewCookie(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE.preview);
}

/**
 * Den Sicherheitskontext um eine laufende Vorschau ergänzen.
 *
 * Gibt den unveränderten Kontext zurück, wenn keine Vorschau läuft, das
 * Cookie ungültig ist oder die Berechtigung fehlt. Es wirft nie: eine kaputte
 * Vorschau darf nicht das Dashboard unbenutzbar machen - sie fällt einfach
 * weg, und der Admin sieht wieder sein eigenes.
 */
export async function mitVorschau(context: AuthContext): Promise<AuthContext> {
  const nutzlast = await rohePreview();
  if (!nutzlast) {
    return context;
  }
  // Nach einem Rechteentzug ist das Cookie technisch noch gültig - die
  // Vorschau ist es nicht mehr.
  if (!hasPermission(context.permissions, PREVIEW_PERMISSIONS.use)) {
    return context;
  }

  const konfiguration = await loadRoleConfiguration().catch(() => null);
  if (!konfiguration) {
    return context;
  }

  const roleIds =
    nutzlast.kind === 'ROLE'
      ? [nutzlast.subjectId]
      : ((
          await prisma.discordIdentityCache
            .findUnique({ where: { discordId: nutzlast.subjectId }, select: { roleIds: true } })
            .catch(() => null)
        )?.roleIds ?? []);

  /*
   * `isOwner` folgt der Wahrheit, nicht der Bequemlichkeit.
   *
   * Der Owner-Zugang stammt aus der Umgebung, nicht aus den Rollen - eine
   * Vorschau auf den Owner, die ihn unterschlüge, zeigte etwas Falsches. Eine
   * Rechteausweitung entsteht daraus nicht: die Schnittmenge in `can()`
   * begrenzt die Vorschau auf das, was die angemeldete Person ohnehin darf.
   * Bei einer Rollenvorschau gibt es keine Person und damit keinen Owner.
   */
  const previewResolution = resolvePermissions(
    {
      discordId: nutzlast.kind === 'USER' ? nutzlast.subjectId : '',
      roleIds,
      isOwner: nutzlast.kind === 'USER' && bootstrapConfig.ownerDiscordId === nutzlast.subjectId,
    },
    konfiguration.mappings,
  );

  const preview: PreviewContext = {
    kind: nutzlast.kind,
    subjectId: nutzlast.subjectId,
    label: nutzlast.label,
    startedAt: new Date(nutzlast.expiresAt - PREVIEW_TTL_MS),
    expiresAt: new Date(nutzlast.expiresAt),
  };

  const ergaenzt: AuthContext = {
    ...context,
    permissions: previewResolution,
    realPermissions: context.permissions,
    preview,
    // Die Moderationsstufe gehört zur Hierarchieprüfung und damit zum Handeln.
    // Gehandelt wird in der Vorschau nicht; sie bleibt deshalb unverändert.
  };

  // Die ausgerollte Liste ist die Schnittmenge - genau das, was `can()`
  // beantwortet. Sie steuert Seitenleiste und `PermissionGuard`.
  ergaenzt.permissionKeys = listPermissions()
    .map((definition) => definition.key)
    .filter((key) => hasPermission(previewResolution, key) && hasPermission(context.permissions, key));

  return ergaenzt;
}

/**
 * Sperrt alles Schreibende, solange eine Vorschau läuft.
 *
 * Die Vorschau ist eine Frage, keine Handlung. Der Knopf mag sichtbar sein -
 * gesperrt wird hier, auf dem Server, und damit auch für einen Aufruf, der
 * die Oberfläche umgeht.
 */
export function verweigereInVorschau(context: AuthContext, aktion: string): void {
  if (!context.preview) {
    return;
  }
  throw new AppError('FORBIDDEN', {
    userMessage: 'Die Vorschau ist nur zum Ansehen. Beende sie oben im Banner, um wieder handeln zu können.',
    internalMessage: `Aktion ${aktion} während einer Vorschau abgelehnt (${context.preview.kind} ${context.preview.subjectId})`,
  });
}
