import { NextResponse } from 'next/server';
import { z } from 'zod';
import { can } from '@swisshub/auth';
import { analytics, isModuleEnabled } from '@swisshub/modules';
import { getOptionalAuthContext } from '@/server/auth';
import { analyticsGuildId } from '@/server/analytics';

/**
 * Der laufende Stand der Sprachzeit.
 *
 * Die Statistikseite selbst rechnet den Stand beim Aufruf aus - ein Neuladen
 * liefert deshalb immer frische Zahlen. Dieser Endpunkt beantwortet die
 * zweite Frage: was ist daraus geworden, während die Seite offen ist?
 *
 * Er liefert absichtlich wenig: die Summen, die gerade wachsen, wie viele
 * Sitzungen sie wachsen lassen, und die Serverzeit dazu. Aus diesen drei
 * Angaben rechnet die Oberfläche zwischen zwei Abrufen selbst weiter - je
 * laufender Sitzung eine Sekunde je Sekunde. Deshalb braucht es keinen Abruf
 * je Sekunde, und deshalb steht trotzdem nie eine veraltete Zahl auf der
 * Seite.
 *
 * Die Wahrheit bleibt dabei hier. Die Uhr des Browsers wird nicht gefragt -
 * sie dient nur dazu, die Zeit **seit** `asOf` zu messen, und eine falsch
 * gestellte Uhr verschiebt damit nichts, was gespeichert ist.
 *
 * Eine Abfrage über die offenen Abschnitte, mehr nicht: ihre Zahl wächst mit
 * den Leuten, die gerade in einem Sprachkanal sitzen, nicht mit der
 * Geschichte des Servers.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const querySchema = z.object({
  zeitraum: z.string().max(10).optional(),
  von: z.string().max(10).optional(),
  bis: z.string().max(10).optional(),
});

export async function GET(request: Request): Promise<Response> {
  const context = await getOptionalAuthContext();
  if (!context?.isMember) {
    return new Response('Nicht angemeldet.', { status: 401 });
  }
  // Dieselbe Berechtigung wie die Seite - ein Live-Endpunkt ist keine
  // Hintertür zu Zahlen, die jemand sonst nicht sehen darf.
  if (!can(context, analytics.ANALYTICS_PERMISSIONS.statisticsView)) {
    return new Response('Keine Berechtigung.', { status: 403 });
  }
  if (!(await isModuleEnabled(analytics.ANALYTICS_MODULE_ID))) {
    return new Response('Modul ist nicht aktiv.', { status: 409 });
  }

  const url = new URL(request.url);
  const query = querySchema.parse({
    zeitraum: url.searchParams.get('zeitraum') ?? undefined,
    von: url.searchParams.get('von') ?? undefined,
    bis: url.searchParams.get('bis') ?? undefined,
  });

  const jetzt = new Date();
  const guildId = await analyticsGuildId();
  const stand = await analytics.trackingStand(guildId);
  const zeitraum = analytics.aufloesen({
    id: query.zeitraum,
    von: query.von,
    bis: query.bis,
    datenBeginn: stand?.startedAt ?? null,
    jetzt,
  });

  const einstellungen = await analytics.statistik.statistikEinstellungen();
  const [zahlen, heuteWerte] = await Promise.all([
    analytics.statistik.kennzahlen({
      guildId,
      zeitraum,
      mitBots: einstellungen.mitBots,
      jetzt,
    }),
    analytics.statistik.heute(guildId, einstellungen.mitBots, jetzt),
  ]);

  return NextResponse.json(
    {
      asOf: zahlen.asOf.toISOString(),
      zeitraum: { sekunden: zahlen.sprachSekunden.wert, wachsend: zahlen.wachsend },
      heute: { sekunden: heuteWerte.sprachSekunden, wachsend: heuteWerte.wachsend },
      imSprachkanal: heuteWerte.imSprachkanal,
      aktive: heuteWerte.aktive,
      sitzungen: zahlen.sprachSitzungen.wert,
    },
    // Weder Browser noch Proxy dürfen diese Antwort aufbewahren - sie ist
    // eine Momentaufnahme und in der nächsten Sekunde eine andere.
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}
