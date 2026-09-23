import 'server-only';
import { z } from 'zod';
import { AUDIT_ACTIONS, prisma, verifyAuditChain } from '@swisshub/database';
import { paginate, sanitizeText, toSkipTake, type Paginated } from '@swisshub/shared';
import type { AuditLog, Prisma } from '@swisshub/database';

/**
 * Ein leeres Feld ist kein Wert.
 *
 * ## Der Fehler, der hier steckte
 *
 * Das Filterformular schickt beim Absenden **alle** seine Felder mit, auch
 * die leeren - so verhalten sich HTML-Formulare. In der Adresszeile stand
 * danach `?actor=&target=&action=LOGIN&module=&from=&to=&outcome=all`.
 *
 * `from` war damit `''`, und `''` ist eine Zeichenkette. `.optional()` laesst
 * nur `undefined` durch, nicht den Leerstring - also lief `''` in
 * `.date()` und wurde abgelehnt. `parse` warf, die Server Component brach ab,
 * und daraus wurde «Diese Seite konnte nicht geladen werden».
 *
 * Mit der gewaehlten Aktion hatte das nichts zu tun: **jede** Anwendung des
 * Filters ist so gescheitert, unabhaengig davon, was ausgewaehlt war.
 *
 * Diese Umwandlung macht aus jedem leeren Feld `undefined`, bevor irgendeine
 * Regel greift - an einer Stelle, statt an sieben.
 */
const leerIstNichts = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((wert) => (typeof wert === 'string' && wert.trim() === '' ? undefined : wert), schema);

/** Filter der Audit-Log-Ansicht. Alle Werte werden serverseitig validiert. */
export const auditFilterSchema = z.object({
  actor: leerIstNichts(
    z
      .string()
      .max(100)
      .optional()
      .transform((value) => (value ? sanitizeText(value, 100) : undefined)),
  ),
  target: leerIstNichts(
    z
      .string()
      .max(100)
      .optional()
      .transform((value) => (value ? sanitizeText(value, 100) : undefined)),
  ),
  /*
   * Die Aktion kommt aus der Registry, nicht aus einer eigenen Liste.
   *
   * Ein Wert, den es nicht gibt - eine von Hand verbogene Adresse, eine
   * umbenannte Aktion - wird still verworfen statt abgelehnt. Ein Filter, der
   * ins Leere zeigt, ist kein Grund, jemandem die Seite zu verweigern.
   */
  action: leerIstNichts(
    z
      .string()
      .max(64)
      .optional()
      .transform((wert) => (wert && istBekannteAktion(wert) ? wert : undefined)),
  ),
  module: leerIstNichts(z.string().max(64).optional()),
  outcome: leerIstNichts(z.enum(['all', 'success', 'error']).default('all')),
  from: leerIstNichts(z.string().date().optional()),
  to: leerIstNichts(z.string().date().optional()),
  page: leerIstNichts(z.coerce.number().int().min(1).max(1000).default(1)),
  pageSize: leerIstNichts(z.coerce.number().int().min(10).max(100).default(25)),
});

export type AuditFilter = z.infer<typeof auditFilterSchema>;

export const AUDIT_ACTION_OPTIONS = Object.values(AUDIT_ACTIONS);

const BEKANNTE_AKTIONEN = new Set<string>(AUDIT_ACTION_OPTIONS);

function istBekannteAktion(wert: string): boolean {
  return BEKANNTE_AKTIONEN.has(wert);
}

/**
 * Den Filter lesen, ohne die Seite aufs Spiel zu setzen.
 *
 * Was in der Adresszeile steht, kommt von aussen. Eine unbrauchbare Angabe
 * darf dazu fuehren, dass sie nicht greift - nicht dazu, dass die Seite
 * verschwindet. Bleibt etwas uebrig, das sich nicht lesen laesst, gilt der
 * Standardfilter, und `verworfen` nennt die Felder, damit die Oberflaeche es
 * sagen kann, statt es zu verschweigen.
 */
export function leseAuditFilter(params: Record<string, string | undefined>): {
  filter: AuditFilter;
  verworfen: string[];
} {
  const ergebnis = auditFilterSchema.safeParse(params);
  if (ergebnis.success) {
    return { filter: ergebnis.data, verworfen: [] };
  }

  const verworfen = [...new Set(ergebnis.error.issues.map((problem) => String(problem.path[0] ?? '')))];
  // Die unbrauchbaren Felder weglassen und den Rest noch einmal lesen: ein
  // falsches Datum soll nicht den Aktionsfilter mitreissen.
  const bereinigt = Object.fromEntries(
    Object.entries(params).filter(([schluessel]) => !verworfen.includes(schluessel)),
  );
  const zweiterVersuch = auditFilterSchema.safeParse(bereinigt);

  return {
    filter: zweiterVersuch.success ? zweiterVersuch.data : auditFilterSchema.parse({}),
    verworfen: verworfen.filter((feld) => feld.length > 0),
  };
}

export async function loadAuditLog(filter: AuditFilter): Promise<Paginated<AuditLog>> {
  const where: Prisma.AuditLogWhereInput = {
    ...(filter.action ? { action: filter.action } : {}),
    ...(filter.module ? { module: filter.module } : {}),
    ...(filter.outcome === 'all' ? {} : { success: filter.outcome === 'success' }),
    ...(filter.actor
      ? {
          OR: [
            { actorUsername: { contains: filter.actor, mode: 'insensitive' } },
            { actorDiscordId: filter.actor },
          ],
        }
      : {}),
    ...(filter.target
      ? {
          AND: [
            {
              OR: [
                { targetLabel: { contains: filter.target, mode: 'insensitive' } },
                { targetDiscordId: filter.target },
              ],
            },
          ],
        }
      : {}),
    ...(filter.from || filter.to
      ? {
          createdAt: {
            ...(filter.from ? { gte: new Date(`${filter.from}T00:00:00.000Z`) } : {}),
            ...(filter.to ? { lte: new Date(`${filter.to}T23:59:59.999Z`) } : {}),
          },
        }
      : {}),
  };

  const { skip, take } = toSkipTake({ page: filter.page, pageSize: filter.pageSize });
  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { sequence: 'desc' }, skip, take }),
    prisma.auditLog.count({ where }),
  ]);

  /*
   * Wer auf Seite 12 steht und dann filtert, steht selten wieder auf Seite 12.
   *
   * Frueher blieb die Seitenzahl stehen, und das Ergebnis war eine leere
   * Liste mit «Keine Einträge» - obwohl es Treffer gab, nur eben weiter
   * vorne. Gibt es Treffer, aber auf dieser Seite keine, wird die letzte
   * vorhandene Seite geholt.
   */
  const letzteSeite = Math.max(1, Math.ceil(total / filter.pageSize));
  if (items.length === 0 && total > 0 && filter.page > letzteSeite) {
    const nachgeholt = await prisma.auditLog.findMany({
      where,
      orderBy: { sequence: 'desc' },
      ...toSkipTake({ page: letzteSeite, pageSize: filter.pageSize }),
    });
    return paginate(nachgeholt, total, { page: letzteSeite, pageSize: filter.pageSize });
  }

  return paginate(items, total, { page: filter.page, pageSize: filter.pageSize });
}

/** Integritätsprüfung der Hash-Chain für die Anzeige im Audit Log. */
export async function checkAuditIntegrity(): Promise<{ valid: boolean; checked: number }> {
  const result = await verifyAuditChain(500);
  return { valid: result.valid, checked: result.checked };
}
