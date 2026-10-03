import { NextResponse, type NextRequest } from 'next/server';
import { SECURITY_EVENTS, recordSecurityEvent } from '@swisshub/database';
import { assertMembership, assertPermission, verifyCsrfToken } from '@swisshub/auth';
import { level } from '@swisshub/modules';
import { createLogger } from '@swisshub/logger';
import { AppError, fail, ok, toAppError } from '@swisshub/shared';
import { getActionAuthContext, getRequestMetadata } from '@/server/auth';
import { enforceRateLimit } from '@/server/rate-limit';

const log = createLogger('web:xpslot-upload');

/**
 * Symbolbilder und Klaenge des XP-Slots hochladen.
 *
 * Route Handler statt Server Action, weil Dateien uebertragen werden. Die
 * Sicherheitskette bleibt dieselbe wie bei jedem anderen Upload im System:
 * Session, Mitgliedschaft, CSRF, Rate Limit, Berechtigung. Das Format wird am
 * Inhalt erkannt, der Dateiname serverseitig erzeugt.
 *
 * Zwei Arten gehen durch denselben Endpunkt, weil die Kette identisch ist und
 * nur die Formatpruefung sich unterscheidet - `art` entscheidet, welche.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const form = await request.formData();
    const metadata = await getRequestMetadata();
    const context = await getActionAuthContext('critical');
    if (!context) {
      throw new AppError('UNAUTHENTICATED');
    }
    assertMembership(context, { ...metadata, path: 'level.xpslot.upload' });

    const csrfToken = form.get('csrfToken');
    if (typeof csrfToken !== 'string' || !verifyCsrfToken(context.sessionId, csrfToken)) {
      await recordSecurityEvent({
        type: SECURITY_EVENTS.CSRF_FAILED,
        severity: 'HIGH',
        discordId: context.user.discordId,
        ipHash: metadata.ipHash,
        userAgent: metadata.userAgent,
        path: 'level.xpslot.upload',
      });
      throw new AppError('FORBIDDEN', {
        userMessage: 'Sicherheitsprüfung fehlgeschlagen. Bitte Seite neu laden.',
      });
    }

    await enforceRateLimit('slotUpload', context.user.discordId);
    await assertPermission(context, level.LEVEL_PERMISSIONS.xpslotManage, {
      ...metadata,
      path: 'level.xpslot.upload',
    });

    const art = String(form.get('art') ?? '');
    const datei = form.get('datei');
    if (!(datei instanceof File)) {
      throw new AppError('VALIDATION_FAILED', { userMessage: 'Bitte eine Datei auswählen.' });
    }
    const bytes = new Uint8Array(await datei.arrayBuffer());
    const S = level.xpslot;

    if (art === 'bild') {
      const { branding } = await import('@swisshub/modules');
      const gespeichert = await branding.storeLogoUpload(bytes, datei.type || null, 'slotsymbol', {
        maxBytes: 2 * 1024 * 1024,
        minSize: 32,
        maxSize: 1024,
      });
      return NextResponse.json(ok({ dateiname: gespeichert.fileName, format: gespeichert.format }));
    }

    if (art === 'klang') {
      const slot = String(form.get('slot') ?? '');
      const packId = String(form.get('packId') ?? '');
      if (!S.istKlangSlot(slot)) {
        throw new AppError('VALIDATION_FAILED', { userMessage: 'Diesen Klangslot gibt es nicht.' });
      }
      const grenze = S.MUSIK_SLOTS.includes(slot) ? S.MUSIK_MAX_BYTES : S.KLANG_MAX_BYTES;
      const gespeichert = await S.speichereKlang(bytes, datei.type || null, grenze);
      await S.setzeKlang(packId, slot, gespeichert.dateiname, {
        discordId: context.user.discordId,
        username: context.user.username,
      });
      return NextResponse.json(ok({ dateiname: gespeichert.dateiname, format: gespeichert.format }));
    }

    throw new AppError('VALIDATION_FAILED', { userMessage: 'Unbekannte Upload-Art.' });
  } catch (error) {
    const appError = toAppError(error);
    if (appError.code === 'INTERNAL') {
      log.error('XP-Slot-Upload gescheitert', { error });
    }
    return NextResponse.json(fail(appError), { status: appError.code === 'FORBIDDEN' ? 403 : 400 });
  }
}
