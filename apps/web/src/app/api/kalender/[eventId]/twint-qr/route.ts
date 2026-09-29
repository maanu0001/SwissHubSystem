import { NextResponse, type NextRequest } from 'next/server';
import { SECURITY_EVENTS, recordSecurityEvent } from '@swisshub/database';
import { assertMembership, can, verifyCsrfToken } from '@swisshub/auth';
import { calendar } from '@swisshub/modules';
import { createLogger } from '@swisshub/logger';
import { AppError, fail, ok, toAppError } from '@swisshub/shared';
import { getActionAuthContext, getRequestMetadata } from '@/server/auth';
import { enforceRateLimit } from '@/server/rate-limit';

const log = createLogger('web:kalender:twint-qr');

/**
 * Der TWINT-QR-Code eines Termins - ausliefern und hochladen.
 *
 * ## Warum Route Handler und nicht Server Action
 *
 * Weil eine Datei übertragen wird. Dieselbe Lage wie beim Logo, beim
 * Spielcover und beim Profilbanner, und dieselbe Sicherheitskette: Sitzung,
 * Mitgliedschaft, CSRF, Ratengrenze, Berechtigung. Die Prüfung der Datei
 * selbst - Magic Bytes, Grösse, Abmessungen, serverseitig erzeugter Name -
 * macht `speichereZahlungsQr` über die zentrale Ablage.
 *
 * ## Warum nicht aus `public/`
 *
 * Das Upload-Verzeichnis liegt ausserhalb des statisch bedienten Bereichs.
 * Hier wird der Content-Type fest gesetzt und `nosniff` gesendet; eine
 * hochgeladene Datei kann dadurch nie als HTML oder Skript beim Betrachter
 * ankommen, egal wie sie heisst.
 *
 * ## Wer lesen darf
 *
 * Jedes angemeldete Mitglied. Der Code ist genau dafür da, gescannt zu
 * werden - ihn vor denen zu verstecken, die sich anmelden sollen, wäre
 * sinnlos. Er zeigt auf das Konto des Vereins, nicht auf ein privates.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> },
): Promise<Response> {
  const context = await getActionAuthContext('cached');
  if (!context?.isMember) {
    return new NextResponse(null, { status: 401 });
  }

  const { eventId } = await params;
  const datei = await calendar.leseZahlungsQr(eventId);
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
  { params }: { params: Promise<{ eventId: string }> },
): Promise<Response> {
  try {
    const form = await request.formData();
    const metadata = await getRequestMetadata();
    const context = await getActionAuthContext('critical');
    if (!context) {
      throw new AppError('UNAUTHENTICATED');
    }
    assertMembership(context, { ...metadata, path: 'calendar.twintQr' });

    const csrfToken = form.get('csrfToken');
    if (typeof csrfToken !== 'string' || !verifyCsrfToken(context.sessionId, csrfToken)) {
      await recordSecurityEvent({
        type: SECURITY_EVENTS.CSRF_FAILED,
        severity: 'HIGH',
        discordId: context.user.discordId,
        ipHash: metadata.ipHash,
        userAgent: metadata.userAgent,
        path: 'calendar.twintQr',
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
    /*
     * Die Groesse zweimal geprueft: hier, ehe die Datei in den Speicher
     * gelesen wird, und noch einmal in der Ablage an den echten Bytes. Die
     * erste Pruefung spart die Arbeit, die zweite ist die verbindliche -
     * `File.size` kommt aus dem Browser.
     */
    if (datei.size > calendar.MAX_QR_BYTES) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: `Die Datei ist zu gross (maximal ${Math.round(calendar.MAX_QR_BYTES / 1024 / 1024)} MB).`,
      });
    }

    const { eventId } = await params;
    const gespeichert = await calendar.speichereZahlungsQr(
      {
        discordId: context.user.discordId,
        username: context.user.username,
        can: (permission: string) => can(context, permission),
      },
      eventId,
      new Uint8Array(await datei.arrayBuffer()),
      datei.type || null,
    );

    return NextResponse.json(ok(gespeichert));
  } catch (error) {
    const appError = toAppError(error);
    if (appError.code === 'INTERNAL') {
      log.error('TWINT-QR konnte nicht gespeichert werden', { error });
    }
    return NextResponse.json(fail(appError), { status: appError.code === 'FORBIDDEN' ? 403 : 400 });
  }
}
