import { NextResponse, type NextRequest } from 'next/server';
import { SECURITY_EVENTS, recordSecurityEvent } from '@swisshub/database';
import { assertMembership, can, verifyCsrfToken } from '@swisshub/auth';
import { games } from '@swisshub/modules';
import { createLogger } from '@swisshub/logger';
import { AppError, fail, ok, toAppError } from '@swisshub/shared';
import { getActionAuthContext, getRequestMetadata } from '@/server/auth';
import { enforceRateLimit } from '@/server/rate-limit';

const log = createLogger('web:games:cover');

/**
 * Das Cover eines Spiels - ausliefern und hochladen.
 *
 * ## Warum nicht aus `public/`
 *
 * Das Upload-Verzeichnis liegt ausserhalb des statisch bedienten Bereichs.
 * Hier wird der Content-Type fest gesetzt; eine hochgeladene Datei kann
 * dadurch nie als HTML oder Skript ausgeliefert werden, egal wie sie heisst.
 *
 * ## Warum Route Handler und nicht Server Action
 *
 * Weil eine Datei uebertragen wird - genau wie beim Logo, beim
 * Kartenhintergrund und bei der eigenen Levelkarte. Die Sicherheitskette
 * bleibt dieselbe: Sitzung, Mitgliedschaft, CSRF, Ratengrenze, Berechtigung.
 *
 * Lesen darf jedes Mitglied: der Katalog ist die Grundlage von Turnieren,
 * Clips und Runden, und ein Cover ist keine persoenliche Angabe. Schreiben
 * darf nur, wer `spielwahl.games.manage` hat - geprueft hier **und** im
 * Dienst.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ gameId: string }> },
): Promise<Response> {
  const context = await getActionAuthContext('cached');
  if (!context?.isMember) {
    return new NextResponse(null, { status: 401 });
  }

  const { gameId } = await params;
  const file = await games.leseCover(gameId);
  if (!file) {
    return new NextResponse(null, { status: 404 });
  }

  return new NextResponse(new Uint8Array(file.data), {
    headers: {
      'Content-Type': file.contentType,
      'Cache-Control': 'private, max-age=300',
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ gameId: string }> },
): Promise<Response> {
  try {
    const form = await request.formData();
    const metadata = await getRequestMetadata();
    const context = await getActionAuthContext('critical');
    if (!context) {
      throw new AppError('UNAUTHENTICATED');
    }
    assertMembership(context, { ...metadata, path: 'games.cover' });

    const csrfToken = form.get('csrfToken');
    if (typeof csrfToken !== 'string' || !verifyCsrfToken(context.sessionId, csrfToken)) {
      await recordSecurityEvent({
        type: SECURITY_EVENTS.CSRF_FAILED,
        severity: 'HIGH',
        discordId: context.user.discordId,
        ipHash: metadata.ipHash,
        userAgent: metadata.userAgent,
        path: 'games.cover',
      });
      throw new AppError('FORBIDDEN', {
        userMessage: 'Sicherheitsprüfung fehlgeschlagen. Bitte Seite neu laden.',
      });
    }

    await enforceRateLimit('brandingUpload', context.user.discordId);

    const file = form.get('image');
    if (!(file instanceof File)) {
      throw new AppError('VALIDATION_FAILED', { userMessage: 'Bitte ein Bild auswählen.' });
    }
    if (file.size > games.MAX_COVER_BYTES) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: `Die Datei ist zu gross (maximal ${Math.round(games.MAX_COVER_BYTES / 1024 / 1024)} MB).`,
      });
    }

    const { gameId } = await params;
    const gespeichert = await games.speichereCover(
      gameId,
      {
        discordId: context.user.discordId,
        username: context.user.username,
        can: (permission: string) => can(context, permission),
      },
      new Uint8Array(await file.arrayBuffer()),
      file.type || null,
    );

    return NextResponse.json(ok(gespeichert));
  } catch (error) {
    const appError = toAppError(error);
    if (appError.code === 'INTERNAL') {
      log.error('Cover konnte nicht gespeichert werden', { error });
    }
    return NextResponse.json(fail(appError), { status: appError.code === 'FORBIDDEN' ? 403 : 400 });
  }
}
