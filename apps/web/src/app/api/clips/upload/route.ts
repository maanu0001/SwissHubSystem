import { NextResponse, type NextRequest } from 'next/server';
import { SECURITY_EVENTS, recordSecurityEvent } from '@swisshub/database';
import { assertMembership, assertPermission, verifyCsrfToken } from '@swisshub/auth';
import { resolveGuildId } from '@swisshub/discord';
import { clips } from '@swisshub/modules';
import { createLogger } from '@swisshub/logger';
import { AppError, fail, ok, toAppError } from '@swisshub/shared';
import { getActionAuthContext, getRequestMetadata } from '@/server/auth';
import { enforceRateLimit } from '@/server/rate-limit';

const log = createLogger('web:clip-upload');

/**
 * Eine Clipdatei hochladen und damit einreichen.
 *
 * ## Warum ein Route Handler und keine Server Action
 *
 * Weil eine Server Action ihren Rumpf durch die Body-Grenze von Next zieht -
 * standardmässig ein Megabyte, und sie anzuheben hiesse, sie für *jede*
 * Aktion anzuheben. Ein Route Handler nimmt den Rumpf direkt; derselbe Weg,
 * den der Logo-Upload und die drei Import-Assistenten schon gehen.
 *
 * ## Die Sicherheitskette ist dieselbe
 *
 * Session, Mitgliedschaft, CSRF, Rate Limit, Berechtigung - in dieser
 * Reihenfolge, wie bei jeder schreibenden Aktion. Ein Upload-Endpunkt, der
 * eine dieser Prüfungen auslässt, ist ein offenes Dateiablage-System auf einer
 * Domain mit Anmeldung davor.
 *
 * ## Die Reihenfolge ist der eigentliche Schutz
 *
 * Die Datei wird **zuletzt** angefasst. Vorher steht alles, was sich ohne sie
 * entscheiden lässt:
 *
 *   1. Wer bist du, darfst du das, wie oft schon in zehn Minuten
 *   2. Ist der Upload in diesem Modul überhaupt erlaubt
 *   3. Läuft eine Runde, sind die Einreichungen offen, ist dein Kontingent frei
 *   4. Passt die gemeldete Grösse ins Limit
 *   5. **erst jetzt** wird gelesen und geschrieben
 *
 * Ohne Schritt 3 wäre «die Runde ist geschlossen» eine Antwort, die erst nach
 * hundert Megabyte kommt. Fünf Versuche je zehn Minuten - das Rate Limit -
 * wären dann ein halbes Gigabyte geschriebene Datei für nichts. Mit Schritt 3
 * kostet derselbe Versuch zwei Datenbankabfragen.
 *
 * ## Und wenn die Einreichung danach doch scheitert
 *
 * Dann wird die Datei gelöscht - siehe unten. Sie muss geschrieben werden,
 * bevor `reicheEin` sie sehen kann, und zwischen beidem kann die Runde
 * schliessen oder ein zweiter Tab dasselbe Kontingent verbrauchen. Eine Datei,
 * die zu keinem Clip gehört, wäre sonst für immer da: niemand kennt ihren
 * Namen, und Speicherplatz füllt sich lautlos.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<Response> {
  const metadata = await getRequestMetadata();
  /*
   * Ausserhalb des `try`, damit der `catch` sie kennt.
   *
   * Das ist der ganze Grund für diese Variable: der Aufräumpfad braucht den
   * Namen der Datei, die der Fehler hinterlassen hat.
   */
  let gespeichert: string | null = null;

  try {
    const context = await getActionAuthContext('critical');
    if (!context) {
      throw new AppError('UNAUTHENTICATED');
    }
    assertMembership(context, { ...metadata, path: 'clips.upload' });

    const form = await request.formData();
    const csrfToken = form.get('csrfToken');
    if (typeof csrfToken !== 'string' || !verifyCsrfToken(context.sessionId, csrfToken)) {
      await recordSecurityEvent({
        type: SECURITY_EVENTS.CSRF_FAILED,
        severity: 'HIGH',
        discordId: context.user.discordId,
        ipHash: metadata.ipHash,
        userAgent: metadata.userAgent,
        path: 'clips.upload',
      });
      throw new AppError('FORBIDDEN', {
        userMessage: 'Sicherheitsprüfung fehlgeschlagen. Bitte Seite neu laden.',
      });
    }

    /*
     * Ein eigenes Rate Limit, strenger als das der Einreichung.
     *
     * `clipSubmit` erlaubt zehn Versuche in zehn Minuten - bei einer Adresse
     * kostet ein Fehlversuch nichts. Bei einer Datei kostet er die
     * Übertragung, und zehn Fehlversuche wären ein Gigabyte durch die
     * Leitung. Fünf ist genug, um einen Tippfehler im Titel zu korrigieren.
     */
    await enforceRateLimit('clipUpload', context.user.discordId);
    await assertPermission(context, clips.CLIPS_PERMISSIONS.submit, { ...metadata, path: 'clips.upload' });

    const einstellungen = await clips.einstellungen();
    if (!einstellungen.allowUploads) {
      throw new AppError('CONFLICT', {
        userMessage:
          'Direkte Uploads sind auf diesem Server nicht freigegeben. Reiche den Clip über Twitch, YouTube oder Medal ein.',
      });
    }
    const maxBytes = einstellungen.uploadMaxMb * 1024 * 1024;

    const guildId = await resolveGuildId();
    // Wirft, wenn keine Runde läuft, die Einreichungen zu sind oder das
    // eigene Kontingent aufgebraucht ist - bevor ein Byte gelesen wird.
    await clips.pruefeEinreichungsfenster(guildId, context.user.discordId);

    const datei = form.get('video');
    if (!(datei instanceof File)) {
      throw new AppError('VALIDATION_FAILED', { userMessage: 'Bitte eine Videodatei auswählen.' });
    }
    /*
     * Die gemeldete Grösse zuerst.
     *
     * `datei.size` kommt aus dem Rumpf, den nginx und Next bereits
     * entgegengenommen haben - sie zu prüfen spart nicht die Übertragung,
     * aber das Lesen in den Arbeitsspeicher. Die verbindliche Prüfung macht
     * `speichereVideo` an den echten Bytes.
     */
    if (datei.size > maxBytes) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: `Die Datei ist zu gross - erlaubt sind ${einstellungen.uploadMaxMb} MB.`,
      });
    }

    const titel = String(form.get('titel') ?? '');
    const beschreibung = String(form.get('beschreibung') ?? '').trim();
    const gameId = String(form.get('gameId') ?? '').trim();
    const gameName = String(form.get('gameName') ?? '').trim();
    if (form.get('rechteBestaetigt') !== 'true') {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: 'Bitte bestätigen, dass der Clip verwendet werden darf.',
      });
    }

    const video = await clips.speichereVideo(
      new Uint8Array(await datei.arrayBuffer()),
      datei.type || null,
      maxBytes,
    );
    gespeichert = video.dateiname;

    const ergebnis = await clips.reicheEin(
      guildId,
      {
        discordId: context.user.discordId,
        username: context.user.username,
        displayName: context.user.displayName,
        avatarHash: context.user.avatarHash,
      },
      {
        upload: { dateiname: video.dateiname, container: video.container },
        titel,
        beschreibung: beschreibung || null,
        gameId: gameId || null,
        gameName: gameName || null,
      },
    );
    // Die Einreichung steht - ab hier gehört die Datei zum Clip.
    gespeichert = null;

    log.info('Clipdatei eingereicht', {
      discordId: context.user.discordId,
      dateiname: video.dateiname,
      bytes: video.bytes,
      container: video.container,
    });
    return NextResponse.json(ok({ entryId: ergebnis.entryId }));
  } catch (error) {
    if (gespeichert) {
      // Nicht `await`-abhängig vom Erfolg: das Löschen darf die Antwort
      // nicht verzögern oder einen zweiten Fehler daraus machen.
      await clips.loescheVideo(gespeichert).catch(() => undefined);
    }
    const appError = toAppError(error);
    if (appError.code === 'INTERNAL') {
      log.error('Clip-Upload fehlgeschlagen', { error });
    }
    return NextResponse.json(fail(appError), {
      status: appError.code === 'FORBIDDEN' ? 403 : appError.code === 'UNAUTHENTICATED' ? 401 : 400,
    });
  }
}
