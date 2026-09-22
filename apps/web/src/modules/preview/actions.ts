'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { AUDIT_ACTIONS, safeRecordAudit } from '@swisshub/database';
import { snowflakeSchema } from '@swisshub/shared';
import { defineAction } from '@/server/action';
import { PREVIEW_PERMISSIONS, loeschePreviewCookie, rohePreview, setzePreviewCookie } from '@/server/preview';

/**
 * Eine Vorschau starten und beenden.
 *
 * Die beiden einzigen Aktionen mit `allowDuringPreview`. Sie verändern
 * ausschliesslich den Vorschau-Zustand selbst - sonst nichts. Wäre das
 * Beenden gesperrt, käme man aus einer Vorschau nur noch über das Löschen
 * eines Cookies heraus.
 *
 * Beide protokollieren in das bestehende Audit Log: wer, worauf, ab wann und
 * bis wann. Was der Admin dabei zu sehen bekam, steht dort nicht - das wären
 * fremde Inhalte in einem Protokoll, das niemand darum gebeten hat.
 */

export const starteVorschauAction = defineAction(
  {
    name: 'preview.start',
    permission: PREVIEW_PERMISSIONS.use,
    allowDuringPreview: true,
    schema: z.object({
      kind: z.enum(['USER', 'ROLE']),
      subjectId: snowflakeSchema,
      label: z.string().min(1).max(80),
    }),
    rateLimit: 'previewSwitch',
    freshness: 'critical',
  },
  async ({ ctx, input, metadata }) => {
    // Person und Rolle sind zwei Entscheidungen, also zwei Berechtigungen.
    // `assertPermission` würde hier dasselbe tun; der ausdrückliche Weg macht
    // im Code sichtbar, dass es zwei sind.
    const { assertPermission } = await import('@swisshub/auth');
    await assertPermission(ctx, input.kind === 'USER' ? PREVIEW_PERMISSIONS.user : PREVIEW_PERMISSIONS.role, {
      ...metadata,
      path: 'preview.start',
    });

    const expiresAt = await setzePreviewCookie({
      kind: input.kind,
      subjectId: input.subjectId,
      label: input.label,
    });

    await safeRecordAudit({
      action: AUDIT_ACTIONS.PREVIEW_STARTED,
      module: 'core',
      actorDiscordId: ctx.user.discordId,
      actorUsername: ctx.user.username,
      targetDiscordId: input.kind === 'USER' ? input.subjectId : null,
      targetLabel: `${input.kind === 'USER' ? 'Benutzer' : 'Rolle'}: ${input.label}`,
      success: true,
      metadata: { kind: input.kind, subjectId: input.subjectId, expiresAt: expiresAt.toISOString() },
      ipHash: metadata.ipHash,
      userAgent: metadata.userAgent,
    });

    revalidatePath('/', 'layout');
    return { expiresAt: expiresAt.toISOString() };
  },
);

export const beendeVorschauAction = defineAction(
  {
    name: 'preview.stop',
    allowDuringPreview: true,
    // Beenden braucht keine Angabe - welche Vorschau laeuft, steht im Cookie.
    schema: z.object({}),
    // Bewusst ohne Permission: das Beenden darf nie daran scheitern, dass
    // die Berechtigung inzwischen entzogen wurde. Es nimmt nichts weg und
    // gibt nichts dazu - es stellt den Normalzustand wieder her.
    selfService: true,
    rateLimit: 'previewSwitch',
    freshness: 'cached',
  },
  async ({ ctx, metadata }) => {
    const laufend = await rohePreview();
    await loeschePreviewCookie();

    if (laufend) {
      await safeRecordAudit({
        action: AUDIT_ACTIONS.PREVIEW_ENDED,
        module: 'core',
        actorDiscordId: ctx.user.discordId,
        actorUsername: ctx.user.username,
        targetDiscordId: laufend.kind === 'USER' ? laufend.subjectId : null,
        targetLabel: `${laufend.kind === 'USER' ? 'Benutzer' : 'Rolle'}: ${laufend.label}`,
        success: true,
        metadata: { kind: laufend.kind, subjectId: laufend.subjectId },
        ipHash: metadata.ipHash,
        userAgent: metadata.userAgent,
      });
    }

    revalidatePath('/', 'layout');
    return { beendet: laufend !== null };
  },
);
