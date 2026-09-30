import 'server-only';
import type { z } from 'zod';
import { assertMembership, assertPermission, verifyCsrfToken, type AuthContext } from '@swisshub/auth';
import { SECURITY_EVENTS, recordSecurityEvent } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { AppError, fail, ok, toAppError, type ActionResult } from '@swisshub/shared';
import { getActionAuthContext } from './auth';
import { getRequestMetadata } from './request';
import { enforceRateLimit, type RateLimitName } from './rate-limit';

const log = createLogger('web:action');

/**
 * Zentrale Sicherheitskette für Server Actions.
 *
 * Reihenfolge (Fail Closed - jeder Schritt kann abbrechen):
 *   Authentifizierung -> Guild-Mitgliedschaft -> CSRF -> Rate Limit ->
 *   Validierung -> Autorisierung -> Ausführung.
 *
 * Genau eine Ausnahme gibt es von der Mitgliedschaft, und sie ist
 * ausdrücklich zu kennzeichnen: `applicant: true` für den Zugang gebannter
 * Antragsteller (siehe dort). Alle übrigen Glieder der Kette bleiben.
 *
 * Ein manipuliertes HTTP-Request kann dadurch nichts auslösen, was der
 * angemeldete Benutzer über die UI nicht ebenfalls dürfte.
 */
export interface ActionDefinition<TSchema extends z.ZodTypeAny> {
  /** Interner Name (Logs, Rate-Limit-Bucket). */
  name: string;
  module?: string;
  /** Benötigte Permission. */
  permission?: string;
  schema?: TSchema;
  rateLimit?: RateLimitName;
  /**
   * `critical` lädt die Discord-Rollen frisch, bevor autorisiert wird.
   * Standard für alle schreibenden Aktionen.
   */
  freshness?: 'cached' | 'critical';
  /** CSRF-Prüfung (Standard: an). */
  csrf?: boolean;
  /**
   * Selbstbedienung: die Aktion wirkt ausschliesslich auf die Daten des
   * Aufrufers.
   *
   * Damit braucht sie keine eigene Permission - die Mitgliedschaft genuegt.
   * Ein Mitglied darf sein eigenes Premium-Abo abschliessen und kuendigen,
   * ohne dafuer eine Verwaltungsberechtigung zu besitzen.
   *
   * Die Angabe ist bewusst eine ausdrueckliche Erklaerung und keine
   * Ableitung: `tests/unit/action-authorization.test.ts` verlangt von jeder
   * Aktion eine feste Permission, eine Pruefung im Rumpf oder genau diese
   * Kennzeichnung. Wer sie setzt, sagt damit zu, dass die Aktion keine
   * fremde Kennung aus der Eingabe uebernimmt, ohne die Zugehoerigkeit zu
   * pruefen.
   */
  selfService?: boolean;
  /**
   * Antragsteller-Zugang: die Aktion laeuft ohne Guild-Mitgliedschaft.
   *
   * **Die einzige Stelle im ganzen System, an der die Mitgliedschaft
   * entfaellt** - und sie entfaellt aus einem Grund, der sich nicht umgehen
   * laesst: Ein Entbannungsantrag kommt von jemandem, der nicht mehr auf dem
   * Server ist. Die Mitgliedschaft als Voraussetzung waere genau die Mauer,
   * die den Antrag unmoeglich macht.
   *
   * Was dabei **nicht** entfaellt: Anmeldung, CSRF, Ratengrenze,
   * Eingabepruefung. Und die Berechtigung entfaellt nicht etwa, sondern wird
   * durch eine staerkere ersetzt - die Aktion muss im Rumpf pruefen, dass der
   * Datensatz dem Aufrufer gehoert:
   *
   *     appeal.applicantDiscordId === ctx.user.discordId
   *
   * `tests/unit/action-authorization.test.ts` verlangt genau diese Pruefung
   * von jeder so gekennzeichneten Aktion. Ohne sie faellt der Test.
   *
   * Ein Nicht-Mitglied hat ausserdem strukturell keine Rechte: `can()` gibt
   * fuer `isMember: false` immer `false` zurueck. Eine so gekennzeichnete
   * Aktion kann daher nichts erreichen, was einer Berechtigung beduerfte.
   */
  applicant?: boolean;
  /**
   * Die Aktion läuft auch während einer laufenden Vorschau.
   *
   * **Genau zwei Aktionen dürfen das:** eine Vorschau starten und eine
   * beenden. Alles andere ist während einer Vorschau gesperrt - sie ist eine
   * Frage, keine Handlung. Wer dieses Kennzeichen setzt, sagt damit zu, dass
   * die Aktion nichts ausser dem Vorschau-Zustand selbst verändert.
   */
  allowDuringPreview?: boolean;
}

export interface ActionHandlerContext<TInput> {
  ctx: AuthContext;
  input: TInput;
  metadata: { ipHash: string | null; userAgent: string | null };
}

type ActionInput = Record<string, unknown> & { csrfToken?: string };

export function defineAction<TSchema extends z.ZodTypeAny, TResult>(
  definition: ActionDefinition<TSchema>,
  handler: (context: ActionHandlerContext<z.infer<TSchema>>) => Promise<TResult>,
): (input: ActionInput) => Promise<ActionResult<TResult>> {
  return async (rawInput: ActionInput): Promise<ActionResult<TResult>> => {
    const metadata = await getRequestMetadata();

    try {
      const context = await getActionAuthContext(definition.freshness ?? 'critical');

      if (!context) {
        await recordSecurityEvent({
          type: SECURITY_EVENTS.INVALID_SESSION,
          severity: 'LOW',
          ipHash: metadata.ipHash,
          userAgent: metadata.userAgent,
          path: definition.name,
        });
        throw new AppError('UNAUTHENTICATED');
      }

      // Antragsteller sind keine Mitglieder - siehe `applicant` oben.
      if (!definition.applicant) {
        assertMembership(context, { ...metadata, path: definition.name });
      }

      /*
       * Vorschau ist nur zum Ansehen - und zwar serverseitig.
       *
       * Die Sperre steht hier, vor Eingabepruefung und Autorisierung, und sie
       * gilt fuer **jede** Aktion. Eine Liste der schreibenden Aktionen zu
       * pflegen hiesse, sie beim naechsten neuen Knopf zu vergessen; die
       * vorsichtige Richtung ist, alles zu sperren und die zwei Ausnahmen
       * ausdruecklich zu benennen.
       *
       * Dass ein Knopf in der Oberflaeche vielleicht noch sichtbar waere,
       * spielt keine Rolle: gesperrt wird hier, und damit auch fuer einen
       * Aufruf, der die Oberflaeche umgeht.
       */
      if (context.preview && !definition.allowDuringPreview) {
        await recordSecurityEvent({
          type: SECURITY_EVENTS.PERMISSION_DENIED,
          severity: 'LOW',
          discordId: context.user.discordId,
          ipHash: metadata.ipHash,
          userAgent: metadata.userAgent,
          path: definition.name,
          metadata: { grund: 'preview', previewKind: context.preview.kind },
        });
        throw new AppError('FORBIDDEN', {
          userMessage:
            'Die Vorschau ist nur zum Ansehen. Beende sie oben im Banner, um wieder handeln zu können.',
          internalMessage: `Aktion ${definition.name} während einer Vorschau abgelehnt`,
        });
      }

      if (definition.csrf !== false) {
        const token = typeof rawInput?.csrfToken === 'string' ? rawInput.csrfToken : null;
        if (!verifyCsrfToken(context.sessionId, token)) {
          await recordSecurityEvent({
            type: SECURITY_EVENTS.CSRF_FAILED,
            severity: 'HIGH',
            discordId: context.user.discordId,
            ipHash: metadata.ipHash,
            userAgent: metadata.userAgent,
            path: definition.name,
          });
          throw new AppError('FORBIDDEN', {
            userMessage: 'Sicherheitsprüfung fehlgeschlagen. Bitte Seite neu laden und erneut versuchen.',
            internalMessage: 'CSRF-Token ungültig',
          });
        }
      }

      if (definition.rateLimit) {
        await enforceRateLimit(definition.rateLimit, context.user.discordId);
      }

      let input = {} as z.infer<TSchema>;
      if (definition.schema) {
        const { csrfToken: _csrfToken, ...payload } = rawInput ?? {};
        const parsed = definition.schema.safeParse(payload);
        if (!parsed.success) {
          await recordSecurityEvent({
            type: SECURITY_EVENTS.INVALID_INPUT,
            severity: 'LOW',
            discordId: context.user.discordId,
            ipHash: metadata.ipHash,
            userAgent: metadata.userAgent,
            path: definition.name,
            metadata: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
          });
          throw new AppError('VALIDATION_FAILED', {
            details: { fieldErrors: flattenIssues(parsed.error) },
          });
        }
        input = parsed.data;
      }

      if (definition.permission) {
        // `assertPermission` prueft die Mitgliedschaft mit. Eine Aktion, die
        // beides deklariert, waere in sich widerspruechlich - sie liefe fuer
        // ein Nicht-Mitglied nie und fuer ein Mitglied ohne den Antragsteller-
        // Pfad. Das faellt hier auf und nicht erst im Betrieb.
        if (definition.applicant) {
          throw new AppError('INTERNAL', {
            internalMessage: `${definition.name}: "applicant" und "permission" schliessen sich aus.`,
          });
        }
        await assertPermission(context, definition.permission, {
          ...metadata,
          path: definition.name,
          module: definition.module ?? null,
        });

        /*
         * Der Testmodus-Riegel, serverseitig.
         *
         * Die Seitenleiste zu filtern reicht nicht: eine Server Action ist
         * ein Endpunkt, den man auch ohne die Seite aufrufen kann. Wer die
         * Berechtigung hat und den Testmodus-Schluessel nicht, bekommt hier
         * dieselbe Antwort wie an der Seite - `FORBIDDEN`, ohne Auskunft
         * darueber, dass es das Modul ueberhaupt gibt.
         */
        const { darfModulPermissionOeffnen, TESTMODUS_PERMISSION } = await import('@swisshub/modules');
        const { hasPermission } = await import('@swisshub/permissions');
        const testmodusSchluessel = hasPermission(
          context.realPermissions ?? context.permissions,
          TESTMODUS_PERMISSION,
        );
        if (!(await darfModulPermissionOeffnen(definition.permission, testmodusSchluessel))) {
          throw new AppError('FORBIDDEN', {
            userMessage: 'Dieser Bereich steht gerade nicht zur Verfügung.',
            internalMessage: `${definition.name}: Modul im Testmodus, kein ${TESTMODUS_PERMISSION}`,
          });
        }
      }

      const result = await handler({ ctx: context, input, metadata });
      return ok(result);
    } catch (error) {
      const appError = toAppError(error);
      if (appError.code === 'INTERNAL') {
        log.error('Server Action fehlgeschlagen', { action: definition.name, error });
      } else {
        log.warn('Server Action abgelehnt', {
          action: definition.name,
          code: appError.code,
          reason: appError.internalMessage,
        });
      }
      return fail(appError);
    }
  };
}

function flattenIssues(error: z.ZodError): Record<string, string> {
  const output: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || 'form';
    output[key] ??= issue.message;
  }
  return output;
}

/**
 * Die Sicherheitskette für Besucher ohne Konto.
 *
 * ## Warum sie überhaupt existiert
 *
 * `defineAction` beginnt mit einer Anmeldung und einer Guild-Mitgliedschaft.
 * Für eine Spielauswahl, an der ein Gast über den Einladungslink teilnimmt,
 * steht beides nicht zur Verfügung - es gibt keinen Benutzer, keine Sitzung
 * und keine Rollen. Eine Aktion in `defineAction` zu zwingen hiesse, einen
 * Benutzerkontext zu erfinden; eine erfundene `discordId` in einem
 * `AuthContext` wäre eine Lüge, die durch das ganze System reist.
 *
 * ## Was von der Kette bleibt
 *
 * **Alles ausser Anmeldung, Mitgliedschaft und Berechtigung**, und zwar aus
 * demselben Code: CSRF, Ratengrenze, Eingabeprüfung, Sicherheitsprotokoll,
 * Fehlerabbildung. Die drei entfallenen Glieder werden durch ein einziges
 * ersetzt, das der Rumpf aufrufen **muss**:
 *
 *     await spielwahl.verlangeGastZugang(sessionId, besucher.kennung)
 *
 * Es prüft die Form der Kennung (nur `gast:<hex>` - eine Discord-Kennung
 * besteht dieses Muster nie), dass diese Runde Gäste zulässt, und dass sie
 * noch läuft. `tests/unit/action-authorization.test.ts` verlangt den Aufruf
 * von jeder so definierten Aktion; ohne ihn fällt der Test.
 *
 * ## Warum das kein zweites System ist
 *
 * Weil es dieselbe Datei, dieselben Primitive und dieselbe Testabdeckung
 * teilt. Der Unterschied ist die Art der Identität, und die steht im Typ:
 * `besucher: { kennung }` statt `ctx: AuthContext`. Wer eine Aktion hier
 * definiert, sieht auf einen Blick, dass er im öffentlichen Teil ist.
 *
 * Es gibt genau einen Grund, hier etwas hinzuzufügen: eine Handlung, die ein
 * Gast in einer Spielauswahl tun darf. Alles andere gehört in `defineAction`.
 */
export interface OeffentlicheAktionsDefinition<TSchema extends z.ZodTypeAny> {
  name: string;
  module?: string;
  schema?: TSchema;
  rateLimit?: RateLimitName;
}

export interface OeffentlicherHandlerKontext<TInput> {
  /** Wer da ist - nur eine Kennung, kein Benutzer. */
  besucher: { kennung: string };
  input: TInput;
  metadata: { ipHash: string | null; userAgent: string | null };
}

export function defineOeffentlicheAktion<TSchema extends z.ZodTypeAny, TResult>(
  definition: OeffentlicheAktionsDefinition<TSchema>,
  handler: (context: OeffentlicherHandlerKontext<z.infer<TSchema>>) => Promise<TResult>,
): (input: ActionInput) => Promise<ActionResult<TResult>> {
  return async (rawInput: ActionInput): Promise<ActionResult<TResult>> => {
    const metadata = await getRequestMetadata();

    try {
      /*
       * Die Kennung wird hier vergeben, wenn es noch keine gibt.
       *
       * Eine Aktion darf Cookies setzen, eine Seite nicht - deshalb entsteht
       * die Kennung beim ersten Klick und nicht beim Laden. Wer nur zusieht,
       * bekommt kein Cookie.
       */
      const { sicherGastKennung } = await import('./gast');
      const besucher = await sicherGastKennung();

      const token = typeof rawInput?.csrfToken === 'string' ? rawInput.csrfToken : null;
      if (!verifyCsrfToken(besucher.kennung, token)) {
        await recordSecurityEvent({
          type: SECURITY_EVENTS.CSRF_FAILED,
          severity: 'HIGH',
          ipHash: metadata.ipHash,
          userAgent: metadata.userAgent,
          path: definition.name,
        });
        throw new AppError('FORBIDDEN', {
          userMessage: 'Sicherheitsprüfung fehlgeschlagen. Bitte Seite neu laden und erneut versuchen.',
          internalMessage: 'CSRF-Token ungültig (Gast)',
        });
      }

      /*
       * Die Ratengrenze auf die Gastkennung.
       *
       * Nicht auf die IP-Adresse: hinter einer sitzt im Zweifel ein
       * Wohnzimmer mit fünf Leuten, und die Grenze träfe dann alle fünf. Wer
       * sein Cookie löscht, umgeht sie - das ist dieselbe Offenheit wie beim
       * Abstimmen selbst, und sie wird an derselben Stelle aufgefangen: ein
       * Gast steht mit Namen in der Teilnehmerliste.
       */
      if (definition.rateLimit) {
        await enforceRateLimit(definition.rateLimit, besucher.kennung);
      }

      let input = {} as z.infer<TSchema>;
      if (definition.schema) {
        const { csrfToken: _csrfToken, ...payload } = rawInput ?? {};
        const parsed = definition.schema.safeParse(payload);
        if (!parsed.success) {
          await recordSecurityEvent({
            type: SECURITY_EVENTS.INVALID_INPUT,
            severity: 'LOW',
            ipHash: metadata.ipHash,
            userAgent: metadata.userAgent,
            path: definition.name,
            metadata: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
          });
          throw new AppError('VALIDATION_FAILED', {
            details: { fieldErrors: flattenIssues(parsed.error) },
          });
        }
        input = parsed.data;
      }

      const result = await handler({ besucher: { kennung: besucher.kennung }, input, metadata });
      return ok(result);
    } catch (error) {
      const appError = toAppError(error);
      if (appError.code === 'INTERNAL') {
        log.error('Öffentliche Aktion fehlgeschlagen', { action: definition.name, error });
      } else {
        log.warn('Öffentliche Aktion abgelehnt', {
          action: definition.name,
          code: appError.code,
          reason: appError.internalMessage,
        });
      }
      return fail(appError);
    }
  };
}
