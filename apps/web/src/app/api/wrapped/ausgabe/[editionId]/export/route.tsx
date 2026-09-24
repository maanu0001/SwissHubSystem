import { ImageResponse } from 'next/og';
import { NextResponse, type NextRequest } from 'next/server';
import { appUrl } from '@swisshub/config';
import { can } from '@swisshub/auth';
import { createLogger } from '@swisshub/logger';
import { isModuleEnabled, wrapped } from '@swisshub/modules';
import { getActionAuthContext } from '@/server/auth';
import { enforceRateLimit } from '@/server/rate-limit';
import {
  AUSGABE_MASSE,
  folienDateiname,
  zeichneAusgabeFolie,
  type AusgabeFormat,
} from '@/modules/wrapped/ausgabe-folie';
import type { WrappedVariante } from '@swisshub/modules/wrapped/vorlagen';

const log = createLogger('web:wrapped:export');

/**
 * Alle Folien einer Ausgabe als ZIP.
 *
 * ## Warum ein Archiv und nicht fuenfzehn Klicks
 *
 * Weil ein Karussell fuenfzehn Bilder in der richtigen Reihenfolge braucht
 * und niemand fuenfzehnmal «Speichern unter» drueckt. Die Dateien sind
 * durchnummeriert, damit sie auch im Entpacker in der Reihenfolge der
 * Geschichte stehen.
 *
 * ## Warum nacheinander gezeichnet wird
 *
 * Fuenfzehn Bilder zu je 1080x1920 gleichzeitig im Speicher zu halten, waere
 * ein Vielfaches dessen, was der Container hat - und der Bau ist ohnehin auf
 * 1,5 GB begrenzt. Nacheinander dauert ein paar Sekunden laenger und haelt
 * den Verbrauch bei einem Bild.
 *
 * ## Warum ausgeschaltete Folien fehlen
 *
 * Weil sie ausgeschaltet sind. Wer eine Folie im Editor abwaehlt, will sie
 * nicht im Archiv - und ein Bild, das man hinterher von Hand loeschen muss,
 * ist keine Hilfe.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Fuenfzehn Bilder rastern dauert laenger als die Vorgabe von 15 Sekunden. */
export const maxDuration = 120;

const FORMATE = new Set<AusgabeFormat>(['story', 'feed']);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ editionId: string }> },
): Promise<Response> {
  const context = await getActionAuthContext('cached');
  if (!context?.isMember) {
    return new NextResponse(null, { status: 401 });
  }
  if (!can(context, wrapped.WRAPPED_PERMISSIONS.export)) {
    return new NextResponse(null, { status: 403 });
  }
  if (!(await isModuleEnabled(wrapped.WRAPPED_MODULE_ID))) {
    return new NextResponse(null, { status: 404 });
  }

  await enforceRateLimit('wrappedExport', context.user.discordId);

  const adresse = new URL(request.url);
  const format = (adresse.searchParams.get('format') ?? 'story') as AusgabeFormat;
  if (!FORMATE.has(format)) {
    return new NextResponse(null, { status: 400 });
  }

  const { editionId } = await params;
  const ausgabe = await wrapped.ladeAusgabe(editionId);
  if (!ausgabe) {
    return new NextResponse(null, { status: 404 });
  }

  const folien = ausgabe.folien.filter((folie) => folie.enabled);
  if (folien.length === 0) {
    return NextResponse.json(
      { ok: false, error: { message: 'Diese Ausgabe hat keine eingeschaltete Folie.' } },
      { status: 400 },
    );
  }

  const mass = AUSGABE_MASSE[format];
  const host = new URL(appUrl('/')).host;
  const eintraege: Array<{ name: string; daten: Uint8Array }> = [];

  for (const folie of folien) {
    /*
     * Das Bild eines Community Moments als Bytes, nicht als Adresse.
     *
     * Die Zeichenmaschine laeuft hier im Server. Eine relative Adresse
     * liess frueher den **ganzen** Export mit einer 500 abbrechen, und in
     * der Editor-Vorschau war davon nichts zu sehen - dort zeichnet ein
     * Browser, dem eine relative Adresse genuegt.
     *
     * Faellt das Lesen aus, wird die Folie ohne Bild gezeichnet. Ein
     * Archiv mit einer schlichteren Folie ist besser als kein Archiv.
     */
    const bildQuelle = folie.momentId
      ? await wrapped.momentBildDatenUri(folie.momentId).catch((fehler: unknown) => {
          log.warn('Bild eines Community Moments nicht lesbar', { momentId: folie.momentId, fehler });
          return null;
        })
      : null;

    const bild = new ImageResponse(
      zeichneAusgabeFolie({
        folie: {
          templateKey: folie.templateKey,
          daten: folie.daten,
          editorial: folie.editorial,
          bildQuelle,
        },
        format,
        variante: ausgabe.variant as WrappedVariante,
        titel: ausgabe.title,
        host,
      }),
      { width: mass.breite, height: mass.hoehe },
    );
    const bytes = new Uint8Array(await new Response(bild.body).arrayBuffer());
    eintraege.push({ name: folienDateiname(folie.position, folie.storyKey), daten: bytes });
  }

  const archiv = wrapped.baueZip(eintraege);
  log.info('Wrapped-Ausgabe exportiert', {
    editionId,
    format,
    folien: eintraege.length,
    bytes: archiv.length,
  });

  const name = `swisshub-wrapped-${ausgabe.periodKey}-${format}.zip`;
  return new NextResponse(new Uint8Array(archiv), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Content-Length': String(archiv.length),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
