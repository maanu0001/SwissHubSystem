import { NextResponse, type NextRequest } from 'next/server';
import { SECURITY_EVENTS, recordSecurityEvent } from '@swisshub/database';
import { assertMembership, verifyCsrfToken } from '@swisshub/auth';
import { profile } from '@swisshub/modules';
import { createLogger } from '@swisshub/logger';
import { AppError, fail, ok, toAppError } from '@swisshub/shared';
import { getActionAuthContext, getRequestMetadata } from '@/server/auth';
import { enforceRateLimit } from '@/server/rate-limit';

const log = createLogger('web:profil:banner');

/**
 * Das Profilbanner - ausliefern und hochladen.
 *
 * ## Wer darf was
 *
 * **Lesen** darf jedes Mitglied: ein Banner steht im Profilkopf, und den
 * sehen alle, die das Profil sehen. **Hochladen** darf ausschliesslich der
 * Eigentuemer - und zwar nicht, weil eine Pruefung die Kennung aus der
 * Adresse mit der Sitzung vergleicht und dabei vielleicht einmal vergessen
 * wird, sondern weil die Kennung aus der Adresse beim Schreiben gar nicht
 * benutzt wird. Geschrieben wird immer auf `context.user.discordId`.
 *
 * ## Warum Route Handler und nicht Server Action
 *
 * Weil eine Datei uebertragen wird - wie beim Logo, beim Spielcover und bei
 * der eigenen Levelkarte. Die Sicherheitskette bleibt dieselbe: Sitzung,
 * Mitgliedschaft, CSRF, Ratengrenze.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ discordId: string }> },
): Promise<Response> {
  const context = await getActionAuthContext('cached');
  if (!context?.isMember) {
    return new NextResponse(null, { status: 401 });
  }

  const { discordId } = await params;
  const datei = await profile.leseBanner(discordId);
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

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const form = await request.formData();
    const metadata = await getRequestMetadata();
    const context = await getActionAuthContext('critical');
    if (!context) {
      throw new AppError('UNAUTHENTICATED');
    }
    assertMembership(context, { ...metadata, path: 'profil.banner' });

    if (context.preview) {
      throw new AppError('FORBIDDEN', {
        userMessage: 'Die Vorschau ist nur zum Ansehen. Beende sie oben im Banner.',
        internalMessage: 'Banner-Upload während einer Vorschau abgelehnt',
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
        path: 'profil.banner',
      });
      throw new AppError('FORBIDDEN', {
        userMessage: 'Sicherheitsprüfung fehlgeschlagen. Bitte Seite neu laden.',
      });
    }

    await enforceRateLimit('profilUpload', context.user.discordId);

    const datei = form.get('image');
    if (!(datei instanceof File)) {
      throw new AppError('VALIDATION_FAILED', { userMessage: 'Bitte ein Bild auswählen.' });
    }
    if (datei.size > profile.MAX_BANNER_BYTES) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: `Die Datei ist zu gross (maximal ${Math.round(profile.MAX_BANNER_BYTES / 1024 / 1024)} MB).`,
      });
    }

    // Die Kennung aus der Adresse spielt beim Schreiben keine Rolle - siehe
    // oben. Geschrieben wird das Profil der Sitzung.
    await profile.speichereBanner(
      context.user.discordId,
      new Uint8Array(await datei.arrayBuffer()),
      datei.type || null,
    );

    return NextResponse.json(ok({ gespeichert: true }));
  } catch (error) {
    const appError = toAppError(error);
    if (appError.code === 'INTERNAL') {
      log.error('Profilbanner konnte nicht gespeichert werden', { error });
    }
    return NextResponse.json(fail(appError), { status: appError.code === 'FORBIDDEN' ? 403 : 400 });
  }
}
