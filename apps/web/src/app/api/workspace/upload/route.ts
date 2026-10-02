import { NextResponse, type NextRequest } from 'next/server';
import { SECURITY_EVENTS, recordSecurityEvent } from '@swisshub/database';
import { assertMembership, assertPermission, verifyCsrfToken } from '@swisshub/auth';
import { workspace } from '@swisshub/modules';
import { createLogger } from '@swisshub/logger';
import { AppError, fail, ok, toAppError } from '@swisshub/shared';
import { getActionAuthContext, getRequestMetadata } from '@/server/auth';
import { enforceRateLimit } from '@/server/rate-limit';

const log = createLogger('web:workspace-upload');

/**
 * Anhänge im Workspace.
 *
 * Dateien lassen sich nicht über eine Server Action übertragen, deshalb ein
 * Route Handler - die Sicherheitskette bleibt dieselbe wie bei jeder anderen
 * schreibenden Aktion: Session, Mitgliedschaft, CSRF, Ratengrenze,
 * Berechtigung. Die Prüfung der Datei selbst macht die zentrale
 * Upload-Infrastruktur: Magic Bytes, Grösse, Abmessungen, zufälliger
 * Dateiname mit der Endung aus dem **erkannten** Inhalt.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<Response> {
  const metadata = await getRequestMetadata();

  try {
    const context = await getActionAuthContext('critical');
    if (!context) {
      throw new AppError('UNAUTHENTICATED');
    }
    assertMembership(context, { ...metadata, path: 'workspace.upload' });

    const form = await request.formData();
    const csrfToken = form.get('csrfToken');
    if (typeof csrfToken !== 'string' || !verifyCsrfToken(context.sessionId, csrfToken)) {
      await recordSecurityEvent({
        type: SECURITY_EVENTS.CSRF_FAILED,
        severity: 'HIGH',
        discordId: context.user.discordId,
        ipHash: metadata.ipHash,
        userAgent: metadata.userAgent,
        path: 'workspace.upload',
      });
      throw new AppError('FORBIDDEN', {
        userMessage: 'Sicherheitsprüfung fehlgeschlagen. Bitte Seite neu laden.',
      });
    }

    await enforceRateLimit('workspaceUpload', context.user.discordId);
    await assertPermission(context, workspace.WORKSPACE_PERMISSIONS.tasksEdit, {
      ...metadata,
      path: 'workspace.upload',
    });

    /*
     * Genau einer von beiden - und nicht beide.
     *
     * Ein Anhang gehört an eine Aufgabe **oder** an ein Projekt. Beides
     * mitzuschicken wäre keine zulässige Angabe, und sie stillschweigend nach
     * einer Rangfolge aufzulösen hiesse, die Datei irgendwo abzulegen, wo
     * niemand sie sucht.
     */
    const taskId = form.get('taskId');
    const projectId = form.get('projectId');
    const anAufgabe = typeof taskId === 'string' && taskId !== '';
    const anProjekt = typeof projectId === 'string' && projectId !== '';
    if (anAufgabe === anProjekt) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: 'Ein Anhang gehört an eine Aufgabe oder an ein Projekt.',
      });
    }

    const datei = form.get('datei');
    if (!(datei instanceof File)) {
      throw new AppError('VALIDATION_FAILED', { userMessage: 'Bitte eine Datei auswählen.' });
    }
    // Die Vorprüfung, bevor die Datei gelesen wird: der Kern prüft es noch
    // einmal, aber fünf Megabyte zuerst in den Speicher zu holen, um sie dann
    // abzulehnen, ist unnötig.
    if (datei.size > workspace.ANHANG_MAX_BYTES) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: `Die Datei ist zu gross (maximal ${Math.round(workspace.ANHANG_MAX_BYTES / 1024 / 1024)} MB).`,
      });
    }

    const anhang = await workspace.ergaenzeAnhang(
      anAufgabe ? { taskId: taskId as string } : { projectId: projectId as string },
      context.user.discordId,
      {
        bytes: new Uint8Array(await datei.arrayBuffer()),
        mimeTyp: datei.type || null,
        name: datei.name,
      },
    );

    return NextResponse.json(ok({ anhangId: anhang.id }));
  } catch (error) {
    const appError = toAppError(error);
    if (appError.code === 'INTERNAL') {
      log.error('Anhang-Upload fehlgeschlagen', { error });
    }
    return NextResponse.json(fail(appError), { status: appError.code === 'FORBIDDEN' ? 403 : 400 });
  }
}
