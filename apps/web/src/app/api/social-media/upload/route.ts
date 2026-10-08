import { NextResponse, type NextRequest } from 'next/server';
import { SECURITY_EVENTS, recordSecurityEvent } from '@swisshub/database';
import { assertMembership, assertPermission, verifyCsrfToken } from '@swisshub/auth';
import { branding, socialmedia } from '@swisshub/modules';
import { createLogger } from '@swisshub/logger';
import { AppError, fail, ok, toAppError } from '@swisshub/shared';
import { getActionAuthContext, getRequestMetadata } from '@/server/auth';
import { enforceRateLimit } from '@/server/rate-limit';
import { leseFormular } from '@/server/upload';

const log = createLogger('web:socialmedia-upload');

/**
 * Bilder fuer den Post Creator hochladen (§34, §35).
 *
 * Route Handler statt Server Action, weil Dateien uebertragen werden - und
 * dieselbe Sicherheitskette wie bei jedem anderen Upload im System: Session,
 * Mitgliedschaft, CSRF, Rate Limit, Berechtigung.
 *
 * ## Warum die Pruefung nicht hier steht
 *
 * Weil sie zentral ist. `storeLogoUpload` erkennt das Format an den **Bytes**,
 * vergleicht es mit dem gemeldeten Typ, prueft Groesse und Masse und erzeugt
 * den Dateinamen selbst. Der Name aus dem Browser wird nie verwendet - damit
 * sind Pfadmanipulation und ausfuehrbare Endungen strukturell ausgeschlossen,
 * ohne dass irgendetwas bereinigt werden muesste.
 *
 * SVG ist ausdruecklich **nicht** dabei. Die Vorgabe erlaubt es nur, wenn eine
 * sichere Pipeline existiert; es gibt keine - ein SVG ist ausfuehrbares
 * Markup, und es zu entschaerfen ist eine eigene Aufgabe, nicht ein Nebensatz
 * hier.
 *
 * ## Warum der Antwortwert nur ein Dateiname ist
 *
 * Weil der Editor ihn in das Feld schreibt und beim Speichern mitgibt - und
 * die Pruefung beim Speichern genau diese Form erwartet. Eine `blob:`-Adresse
 * aus dem Browser kaeme dort nicht durch (§35), und das ist der Grund, warum
 * hochgeladen wird, bevor gespeichert wird.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<Response> {
  try {
    /*
     * Erst anmelden, dann den Koerper lesen.
     *
     * Vorher stand `formData()` in der ersten Zeile, und damit las der Server
     * bis zu zweiunddreissig Megabyte von jemandem, der gar nicht angemeldet
     * ist. Die Sitzungspruefung braucht das Formular nicht - nur die
     * CSRF-Pruefung tut das, und die kommt danach.
     */
    const metadata = await getRequestMetadata();
    const context = await getActionAuthContext('critical');
    if (!context) {
      throw new AppError('UNAUTHENTICATED');
    }
    assertMembership(context, { ...metadata, path: 'socialmedia.upload' });

    /*
     * Die Meldung nennt die groessere der beiden Grenzen.
     *
     * Welche gilt, steht im Formular - und das Formular ist genau das, was
     * hier gerade nicht gelesen werden konnte. Die kleinere zu nennen waere
     * falsch, wenn es ein Hintergrund war; die groessere ist in jedem Fall
     * wahr («maximal erlaubt») und fuehrt niemanden in die Irre, der eine
     * 45 MB grosse Datei als Hintergrund einsetzen will.
     */
    const form = await leseFormular(request, branding.SOCIALPOST_HINTERGRUND_BYTES / 1024 / 1024);

    const csrfToken = form.get('csrfToken');
    if (typeof csrfToken !== 'string' || !verifyCsrfToken(context.sessionId, csrfToken)) {
      await recordSecurityEvent({
        type: SECURITY_EVENTS.CSRF_FAILED,
        severity: 'HIGH',
        discordId: context.user.discordId,
        ipHash: metadata.ipHash,
        userAgent: metadata.userAgent,
        path: 'socialmedia.upload',
      });
      throw new AppError('FORBIDDEN', {
        userMessage: 'Sicherheitsprüfung fehlgeschlagen. Bitte Seite neu laden.',
      });
    }

    await enforceRateLimit('postCreator', context.user.discordId);
    await assertPermission(context, socialmedia.SOCIAL_MEDIA_PERMISSIONS.postEdit, {
      ...metadata,
      path: 'socialmedia.upload',
    });

    const datei = form.get('datei');
    if (!(datei instanceof File)) {
      throw new AppError('VALIDATION_FAILED', { userMessage: 'Bitte eine Datei auswählen.' });
    }

    const bytes = new Uint8Array(await datei.arrayBuffer());
    /*
     * Der Hintergrund darf groesser sein als die uebrigen Postbilder.
     *
     * Er fuellt die ganze Flaeche, waehrend Motiv, Logo und Partnerzeichen
     * Ausschnitte sind - und kommt deshalb regelmaessig als unkomprimiertes
     * Original. Das Feld steht im Formular; faellt es weg oder heisst es
     * anders, gilt die Tabellengrenze. Eine unbekannte Angabe kann damit
     * nichts erhoehen.
     */
    const feld = form.get('feld');
    const istHintergrund = feld === 'hintergrundbild';
    const gespeichert = await branding.storeLogoUpload(
      bytes,
      datei.type || null,
      'socialpost',
      istHintergrund ? { maxBytes: branding.SOCIALPOST_HINTERGRUND_BYTES } : {},
    );

    return NextResponse.json(
      ok({
        dateiname: gespeichert.fileName,
        format: gespeichert.format,
        breite: gespeichert.width,
        hoehe: gespeichert.height,
      }),
    );
  } catch (error) {
    const appError = toAppError(error);
    if (appError.code === 'INTERNAL') {
      log.error('Post-Upload gescheitert', { error });
    }
    return NextResponse.json(fail(appError), { status: appError.code === 'FORBIDDEN' ? 403 : 400 });
  }
}
