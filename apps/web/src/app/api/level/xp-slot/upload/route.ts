import { NextResponse, type NextRequest } from 'next/server';
import { SECURITY_EVENTS, recordSecurityEvent } from '@swisshub/database';
import { assertMembership, assertPermission, verifyCsrfToken } from '@swisshub/auth';
import { level } from '@swisshub/modules';
import { createLogger } from '@swisshub/logger';
import { AppError, fail, ok, toAppError } from '@swisshub/shared';
import { getActionAuthContext, getRequestMetadata } from '@/server/auth';
import { enforceRateLimit } from '@/server/rate-limit';
import { leseFormular } from '@/server/upload';

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
    const metadata = await getRequestMetadata();
    const context = await getActionAuthContext('critical');
    if (!context) {
      throw new AppError('UNAUTHENTICATED');
    }
    assertMembership(context, { ...metadata, path: 'level.xpslot.upload' });

    /*
     * Erst anmelden, dann den Koerper lesen - und 64 MB als Dach.
     *
     * Vorher stand `formData()` in der ersten Zeile, und damit las der Server
     * bis zu vierundsechzig Megabyte von jemandem, der gar nicht angemeldet
     * ist. Die Sitzungspruefung braucht das Formular nicht; nur die
     * CSRF-Pruefung tut das, und die kommt danach.
     *
     * Die 64 sind dieselbe Zahl wie `middlewareClientMaxBodySize`.
     *
     * Hier geht beides durch, Symbolbild und Klang, und die beiden haben
     * verschiedene Grenzen. Welche gilt, steht erst fest, wenn das Formular
     * gelesen ist - genau deshalb nennt die Meldung an dieser Stelle die
     * Grenze der Schicht darueber. Die eigentliche Zahl sagt danach
     * `storeLogoUpload` beziehungsweise `speichereKlang`.
     *
     * Dass die 64 zu `next.config.ts` passt, prueft ein Test. Importieren
     * laesst sie sich von dort nicht: die Konfiguration wird vom Build
     * geladen, nicht von der Anwendung.
     */
    const form = await leseFormular(request, 64);

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
      /*
       * Keine Zahlen hier - die Grenze steht bei ihrem Namensraum.
       *
       * Hier standen 2 MB und 1024 Pixel. Beides lehnte den Normalfall ab:
       * ein Symbol aus einem Grafikprogramm hat heute 2048 Pixel Kantenlaenge
       * und als PNG mit Transparenz mehrere Megabyte. Im Spiel sitzt es in
       * einer Zelle von rund hundert Pixeln - das Original darf trotzdem
       * gross sein, es wird ohnehin skaliert.
       */
      const gespeichert = await branding.storeLogoUpload(bytes, datei.type || null, 'slotsymbol');
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
