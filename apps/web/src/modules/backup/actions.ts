'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { AUDIT_ACTIONS, safeRecordAudit } from '@swisshub/database';
import { backup } from '@swisshub/modules';
import { defineAction } from '@/server/action';

/**
 * Server Actions von Backup & Recovery.
 *
 * ==========================================================================
 * VIER REGELN, DIE JEDE AKTION HIER EINHAELT
 * ==========================================================================
 *
 * 1. **Keine Aktion fuehrt etwas aus.** Sie legen eine Anforderung ab; der
 *    Controller unter einem anderen Benutzer prueft sie gegen eine feste Liste
 *    und fuehrt aus. Diese Datei enthaelt kein `exec`, kein `spawn`, keinen
 *    Pfad, der aus einer Eingabe stammt.
 *
 * 2. **Es gibt keine Aktion «produktiven Restore ausfuehren».** Das ist keine
 *    Luecke, sondern die Entscheidung: die destruktivste Operation des Systems
 *    bekommt keinen Knopf in einer Oberflaeche, die aus dem Internet
 *    erreichbar ist. Die WebApp fordert an und gibt frei; ausgefuehrt wird auf
 *    der Kommandozeile von einem Menschen.
 *
 * 3. **Kein Geheimnis kommt zurueck.** Was eine Aktion zurueckgibt, geht an
 *    den Browser. Zurueck kommen Kennungen, Zeitpunkte und Zustaende - nie ein
 *    Schluessel, nie ein Passwort, nie eine Zugangskennung.
 *
 * 4. **Ins Audit Log nur, was ein Mensch entschieden hat.** Ein taeglicher
 *    Sicherungslauf steht nicht darin; ein von Hand gestarteter steht darin,
 *    weil ihn jemand ausgeloest hat. Das Audit Log ist eine Beweiskette und
 *    kein Betriebslog.
 * ==========================================================================
 */

const P = backup.BACKUP_PERMISSIONS;

function revalidateBackup(): void {
  revalidatePath('/system/backup');
  revalidatePath('/system/backup/historie');
  revalidatePath('/system/backup/recovery');
  revalidatePath('/system/backup/notfall');
  revalidatePath('/system/backup/einstellungen');
}

/**
 * Welche Operation zu welcher Berechtigung gehoert.
 *
 * Eine Tabelle und keine Verzweigung: eine neue Operation ist ein Eintrag
 * hier, und wer keinen einträgt, bekommt keine Aktion - der Rueckfall unten
 * lehnt ab. `tests/unit/backup-aktionen.test.ts` verlangt fuer jede Operation
 * des Controllers einen Eintrag.
 */
const OPERATION_PERMISSION: Record<backup.ControllerOperation, string> = {
  status: P.view,
  punkte: P.points,
  'backup-datenbank': P.run,
  'backup-datenbank-voll': P.run,
  'backup-dateien': P.run,
  'backup-konfiguration': P.run,
  'backup-geheimnisse': P.run,
  'backup-extern': P.run,
  pruefen: P.run,
  'pruefen-tief': P.run,
  'restore-test': P.test,
  'restore-probelauf': P.test,
};

/** Welche Operationen ins Audit Log gehoeren - und unter welcher Aktion. */
const OPERATION_AUDIT: Partial<Record<backup.ControllerOperation, string>> = {
  'backup-datenbank': AUDIT_ACTIONS.BACKUP_MANUAL_STARTED,
  'backup-datenbank-voll': AUDIT_ACTIONS.BACKUP_MANUAL_STARTED,
  'backup-dateien': AUDIT_ACTIONS.BACKUP_MANUAL_STARTED,
  'backup-konfiguration': AUDIT_ACTIONS.BACKUP_MANUAL_STARTED,
  'backup-geheimnisse': AUDIT_ACTIONS.BACKUP_MANUAL_STARTED,
  'backup-extern': AUDIT_ACTIONS.BACKUP_MANUAL_STARTED,
  pruefen: AUDIT_ACTIONS.BACKUP_VERIFY_STARTED,
  'pruefen-tief': AUDIT_ACTIONS.BACKUP_VERIFY_STARTED,
  'restore-test': AUDIT_ACTIONS.BACKUP_RESTORE_TEST_STARTED,
  'restore-probelauf': AUDIT_ACTIONS.BACKUP_RESTORE_TEST_STARTED,
  // `status` und `punkte` ausdruecklich NICHT: sie lesen nur, und die
  // Uebersicht ruft sie bei jedem Aufruf. Sie im Log zu fuehren hiesse, es
  // mit Zeilen zu fuellen, die nichts aussagen.
};

const anforderungSchema = z.object({
  operation: z.enum(backup.CONTROLLER_OPERATIONEN),
  /**
   * Der Zeitpunkt wird hier UND im Controller geprueft.
   *
   * Hier, damit die Meldung im Dashboard verstaendlich ist; dort, weil das die
   * Pruefung ist, auf die es ankommt. Wer sich auf die Pruefung des Aufrufers
   * verlaesst, hat keine Grenze, sondern eine Absprache.
   */
  zeitpunkt: z
    .string()
    .trim()
    .max(40)
    .regex(backup.ZEITPUNKT_MUSTER, 'Form: 2026-09-25 14:30:00+02')
    .optional()
    .or(z.literal('')),
});

/**
 * Eine Anforderung an den Controller stellen.
 *
 * `permission: P.view` ist die Untergrenze; die eigentliche Pruefung steht im
 * Rumpf und richtet sich nach der Operation. Eine Aktion je Operation waere
 * zwoelf fast gleiche Aktionen - und die zwoelfte vergisst irgendwann die
 * Pruefung.
 */
export const anforderungStellenAction = defineAction(
  {
    name: 'backup.anforderung',
    module: backup.BACKUP_MODULE_ID,
    permission: P.view,
    schema: anforderungSchema,
    rateLimit: 'backupRun',
  },
  async ({ ctx, input, metadata }) => {
    const { assertPermission } = await import('@swisshub/auth');
    const benoetigt = OPERATION_PERMISSION[input.operation];
    if (!benoetigt) {
      // Der Rueckfall. Eine Operation ohne Eintrag ist nicht ausfuehrbar -
      // lieber abgelehnt als mit der Untergrenze ausgefuehrt.
      const { forbidden } = await import('@swisshub/shared');
      throw forbidden('Fuer diese Operation ist keine Berechtigung festgelegt.');
    }
    await assertPermission(ctx, benoetigt, {
      ...metadata,
      path: 'backup.anforderung',
      module: backup.BACKUP_MODULE_ID,
    });

    const ergebnis = await backup.stelleAnforderung({
      operation: input.operation,
      zeitpunkt: input.zeitpunkt === '' ? null : (input.zeitpunkt ?? null),
      angefordertVon: ctx.user.discordId,
    });

    const auditAktion = OPERATION_AUDIT[input.operation];
    if (auditAktion) {
      await safeRecordAudit({
        action: auditAktion,
        module: backup.BACKUP_MODULE_ID,
        actorDiscordId: ctx.user.discordId,
        actorUsername: ctx.user.username,
        metadata: {
          operation: input.operation,
          kennung: ergebnis.kennung,
          ...(input.zeitpunkt ? { zeitpunkt: input.zeitpunkt } : {}),
        },
        ipHash: metadata.ipHash,
        userAgent: metadata.userAgent,
      });
    }

    revalidateBackup();
    return {
      kennung: ergebnis.kennung,
      operation: ergebnis.operation,
      hinweis:
        'Die Anforderung ist abgelegt. Der Controller arbeitet sie ab; der Fortschritt erscheint hier, sobald er beginnt.',
    };
  },
);

// ==========================================================================
// Produktiver Restore - anfordern, freigeben, zurueckziehen
// ==========================================================================

const anforderungRestoreSchema = z.object({
  umfang: z.enum([
    backup.RESTORE_UMFANG.datenbank,
    backup.RESTORE_UMFANG.dateien,
    backup.RESTORE_UMFANG.vollstaendig,
  ]),
  /** Leer heisst «jungstmoeglicher Stand». */
  zeitpunkt: z
    .string()
    .trim()
    .max(40)
    .regex(backup.ZEITPUNKT_MUSTER, 'Form: 2026-09-25 14:30:00+02')
    .optional()
    .or(z.literal('')),
  begruendung: z.string().trim().min(20, 'Mindestens 20 Zeichen.').max(2000),
});

/**
 * Einen produktiven Restore anfordern.
 *
 * Diese Aktion loest NICHTS aus. Nach ihr steht eine Zeile in der Datenbank
 * und ein Eintrag im Audit Log - und es fehlt die zweite Person.
 */
export const restoreAnfordernAction = defineAction(
  {
    name: 'backup.restore.anfordern',
    module: backup.BACKUP_MODULE_ID,
    permission: P.restoreRequest,
    schema: anforderungRestoreSchema,
    rateLimit: 'backupRestore',
  },
  async ({ ctx, input, metadata }) => {
    const zielZeitpunkt =
      input.zeitpunkt && input.zeitpunkt !== '' ? new Date(input.zeitpunkt.replace(' ', 'T')) : null;
    if (zielZeitpunkt !== null && Number.isNaN(zielZeitpunkt.getTime())) {
      const { validationFailed } = await import('@swisshub/shared');
      throw validationFailed({ zeitpunkt: 'Kein lesbarer Zeitpunkt.' });
    }

    const zeile = await backup.fordereRestoreAn({
      umfang: input.umfang,
      zielZeitpunkt,
      begruendung: input.begruendung,
      angefordertVon: ctx.user.discordId,
      angefordertVonName: ctx.user.username ?? null,
    });

    await safeRecordAudit({
      action: AUDIT_ACTIONS.BACKUP_RESTORE_REQUESTED,
      module: backup.BACKUP_MODULE_ID,
      actorDiscordId: ctx.user.discordId,
      actorUsername: ctx.user.username,
      targetLabel: zeile.umfangLabel,
      metadata: {
        freigabeId: zeile.id,
        umfang: zeile.umfang,
        zielZeitpunkt: zielZeitpunkt?.toISOString() ?? 'jungstmoeglich',
        gueltigBis: zeile.gueltigBis.toISOString(),
        begruendung: input.begruendung.slice(0, 500),
      },
      ipHash: metadata.ipHash,
      userAgent: metadata.userAgent,
    });

    revalidateBackup();
    return { id: zeile.id, gueltigBis: zeile.gueltigBis.toISOString() };
  },
);

/**
 * Freigeben - durch eine ANDERE Person.
 *
 * Die Pruefung darauf steht in `@swisshub/modules`; hier wird der abgelehnte
 * Versuch protokolliert. Ein Versuch, die eigene Anforderung selbst
 * freizugeben, ist eine Auskunft: er heisst entweder, dass jemand das Prinzip
 * nicht kennt, oder dass jemand es umgehen wollte. Beides will man wissen.
 */
export const restoreFreigebenAction = defineAction(
  {
    name: 'backup.restore.freigeben',
    module: backup.BACKUP_MODULE_ID,
    permission: P.restoreApprove,
    schema: z.object({ id: z.string().min(1).max(64) }),
    rateLimit: 'backupRestore',
  },
  async ({ ctx, input, metadata }) => {
    try {
      const zeile = await backup.gebeRestoreFrei(input.id, ctx.user.discordId, ctx.user.username ?? null);

      await safeRecordAudit({
        action: AUDIT_ACTIONS.BACKUP_RESTORE_APPROVED,
        module: backup.BACKUP_MODULE_ID,
        actorDiscordId: ctx.user.discordId,
        actorUsername: ctx.user.username,
        targetDiscordId: zeile.angefordertVon,
        targetLabel: zeile.umfangLabel,
        metadata: {
          freigabeId: zeile.id,
          umfang: zeile.umfang,
          angefordertVon: zeile.angefordertVon,
          zielZeitpunkt: zeile.zielZeitpunkt?.toISOString() ?? 'jungstmoeglich',
          gueltigBis: zeile.gueltigBis.toISOString(),
        },
        ipHash: metadata.ipHash,
        userAgent: metadata.userAgent,
      });

      revalidateBackup();
      return { id: zeile.id, gueltigBis: zeile.gueltigBis.toISOString() };
    } catch (error) {
      const { toAppError } = await import('@swisshub/shared');
      const appError = toAppError(error);
      if (appError.code === 'FORBIDDEN') {
        await safeRecordAudit({
          action: AUDIT_ACTIONS.BACKUP_RESTORE_SELF_APPROVAL_DENIED,
          module: backup.BACKUP_MODULE_ID,
          actorDiscordId: ctx.user.discordId,
          actorUsername: ctx.user.username,
          success: false,
          errorCode: appError.code,
          metadata: { freigabeId: input.id },
          ipHash: metadata.ipHash,
          userAgent: metadata.userAgent,
        });
      }
      throw error;
    }
  },
);

export const restoreZurueckziehenAction = defineAction(
  {
    name: 'backup.restore.zurueckziehen',
    module: backup.BACKUP_MODULE_ID,
    // Zurueckziehen darf, wer anfordern darf: den eigenen Antrag zu
    // widerrufen ist die harmlose Richtung. Ob es der eigene ist, prueft der
    // Rumpf - wer nur anfordern darf, soll nicht fremde Antraege abraeumen.
    permission: P.restoreRequest,
    schema: z.object({ id: z.string().min(1).max(64), grund: z.string().trim().max(500).optional() }),
    rateLimit: 'backupRestore',
  },
  async ({ ctx, input, metadata }) => {
    const { can } = await import('@swisshub/auth');
    const alle = await backup.listeFreigaben(100);
    const eintrag = alle.find((zeile) => zeile.id === input.id);
    if (!eintrag) {
      const { notFound } = await import('@swisshub/shared');
      throw notFound('Diese Anforderung gibt es nicht.');
    }
    // Fremde Antraege darf nur zurueckziehen, wer auch freigeben darf.
    if (eintrag.angefordertVon !== ctx.user.discordId && !can(ctx, P.restoreApprove)) {
      const { forbidden } = await import('@swisshub/shared');
      throw forbidden('Fremde Anforderungen kann nur zurueckziehen, wer sie auch freigeben darf.');
    }

    const zeile = await backup.lehneRestoreAb(input.id, ctx.user.discordId, input.grund ?? '');
    await safeRecordAudit({
      action: AUDIT_ACTIONS.BACKUP_RESTORE_REJECTED,
      module: backup.BACKUP_MODULE_ID,
      actorDiscordId: ctx.user.discordId,
      actorUsername: ctx.user.username,
      targetLabel: zeile.umfangLabel,
      metadata: { freigabeId: zeile.id, grund: (input.grund ?? '').slice(0, 300) },
      ipHash: metadata.ipHash,
      userAgent: metadata.userAgent,
    });
    revalidateBackup();
    return { id: zeile.id };
  },
);
