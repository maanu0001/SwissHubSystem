import { NextResponse, type NextRequest } from 'next/server';
import { SECURITY_EVENTS, recordSecurityEvent } from '@swisshub/database';
import { assertMembership, can, verifyCsrfToken } from '@swisshub/auth';
import { isModuleEnabled, wrapped } from '@swisshub/modules';
import { createLogger } from '@swisshub/logger';
import { AppError, fail, ok, toAppError } from '@swisshub/shared';
import { getActionAuthContext, getRequestMetadata } from '@/server/auth';
import { enforceRateLimit } from '@/server/rate-limit';

const log = createLogger('web:wrapped:moment');

/**
 * Das Bild eines Community Moments.
 *
 * **Lesen** darf, wer das Studio sehen darf - das Bild steht auf einer
 * Folie, und wer die Ausgabe bearbeitet, muss sie ansehen koennen.
 * **Schreiben** darf, wer Momente pflegen darf.
 *
 * Nicht aus `public/`: das Upload-Verzeichnis liegt ausserhalb des statisch
 * bedienten Bereichs, und hier wird der Content-Type fest gesetzt. Eine als
 * PNG deklarierte HTML-Datei kann dadurch nie als HTML ankommen.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ momentId: string }> },
): Promise<Response> {
  const context = await getActionAuthContext('cached');
  if (!context?.isMember) {
    return new NextResponse(null, { status: 401 });
  }
  if (!can(context, wrapped.WRAPPED_PERMISSIONS.studioView)) {
    return new NextResponse(null, { status: 403 });
  }
  if (!(await isModuleEnabled(wrapped.WRAPPED_MODULE_ID))) {
    return new NextResponse(null, { status: 404 });
  }

  const { momentId } = await params;
  const datei = await wrapped.leseMomentBild(momentId);
  if (!datei) {
    return new NextResponse(null, { status: 404 });
  }

  return new NextResponse(new Uint8Array(datei.data), {
    headers: {
      'Content-Type': datei.contentType,
      'Cache-Control': 'private, max-age=300',
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ momentId: string }> },
): Promise<Response> {
  try {
    const form = await request.formData();
    const metadata = await getRequestMetadata();
    const context = await getActionAuthContext('critical');
    if (!context) {
      throw new AppError('UNAUTHENTICATED');
    }
    assertMembership(context, { ...metadata, path: 'wrapped.moment.bild' });

    if (context.preview) {
      throw new AppError('FORBIDDEN', {
        userMessage: 'Die Vorschau ist nur zum Ansehen.',
        internalMessage: 'Moment-Upload während einer Vorschau abgelehnt',
      });
    }
    if (!can(context, wrapped.WRAPPED_PERMISSIONS.momentsManage)) {
      throw new AppError('FORBIDDEN', {
        userMessage: 'Dir fehlt die Berechtigung, Community Moments zu pflegen.',
      });
    }

    const csrfToken = form.get('csrfToken');
    if (typeof csrfToken !== 'string' || !verifyCsrfToken(context.sessionId, csrfToken)) {
      await recordSecurityEvent({
        type: SECURITY_EVENTS.CSRF_FAILED,
        severity: 'HIGH',
        discordId: context.user.discordId,
        ipHash: metadata.ipHash,
        userAgent: metadata.userAgent,
        path: 'wrapped.moment.bild',
      });
      throw new AppError('FORBIDDEN', {
        userMessage: 'Sicherheitsprüfung fehlgeschlagen. Bitte Seite neu laden.',
      });
    }

    await enforceRateLimit('brandingUpload', context.user.discordId);

    const datei = form.get('image');
    if (!(datei instanceof File)) {
      throw new AppError('VALIDATION_FAILED', { userMessage: 'Bitte ein Bild auswählen.' });
    }
    if (datei.size > wrapped.MAX_MOMENT_BYTES) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: `Die Datei ist zu gross (maximal ${Math.round(wrapped.MAX_MOMENT_BYTES / 1024 / 1024)} MB).`,
      });
    }

    const { momentId } = await params;
    await wrapped.speichereMomentBild(
      momentId,
      new Uint8Array(await datei.arrayBuffer()),
      datei.type || null,
    );

    return NextResponse.json(ok({ gespeichert: true }));
  } catch (error) {
    const appError = toAppError(error);
    if (appError.code === 'INTERNAL') {
      log.error('Moment-Bild konnte nicht gespeichert werden', { error });
    }
    return NextResponse.json(fail(appError), { status: appError.code === 'FORBIDDEN' ? 403 : 400 });
  }
}
