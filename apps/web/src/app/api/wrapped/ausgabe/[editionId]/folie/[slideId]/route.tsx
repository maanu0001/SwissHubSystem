import { ImageResponse } from 'next/og';
import { NextResponse, type NextRequest } from 'next/server';
import { appUrl } from '@swisshub/config';
import { can } from '@swisshub/auth';
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

/**
 * Eine einzelne Folie als PNG.
 *
 * ## Warum gezeichnet und nicht abfotografiert
 *
 * Ein Screenshot haette die Groesse des Fensters, die Schrift des Systems
 * und mit etwas Pech die Hälfte einer Browserleiste. Hier entsteht das Bild
 * aus derselben Komponente, die auch die Vorschau zeigt - in fester Groesse,
 * mit festen Farben, ohne Ladezustand und ohne Oberflaeche drumherum.
 *
 * ## Warum aus dem Schnappschuss und nicht aus den Quelldaten
 *
 * Weil eine veroeffentlichte Ausgabe beim zweiten Export dasselbe ergeben
 * muss wie beim ersten. Die Zahlen stehen in der Folie; ein umbenanntes
 * Turnier aendert sie nicht mehr.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FORMATE = new Set<AusgabeFormat>(['story', 'feed']);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ editionId: string; slideId: string }> },
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

  await enforceRateLimit('wrappedShare', context.user.discordId);

  const adresse = new URL(request.url);
  const format = adresse.searchParams.get('format') ?? 'story';
  if (!FORMATE.has(format as AusgabeFormat)) {
    return new NextResponse(null, { status: 400 });
  }

  const { editionId, slideId } = await params;
  const ausgabe = await wrapped.ladeAusgabe(editionId);
  if (!ausgabe) {
    return new NextResponse(null, { status: 404 });
  }
  const folie = ausgabe.folien.find((eintrag) => eintrag.id === slideId);
  if (!folie) {
    return new NextResponse(null, { status: 404 });
  }

  const mass = AUSGABE_MASSE[format as AusgabeFormat];
  const bild = new ImageResponse(
    zeichneAusgabeFolie({
      folie: { templateKey: folie.templateKey, daten: folie.daten, editorial: folie.editorial },
      format: format as AusgabeFormat,
      variante: ausgabe.variant as WrappedVariante,
      titel: ausgabe.title,
      host: new URL(appUrl('/')).host,
    }),
    { width: mass.breite, height: mass.hoehe },
  );

  const antwort = new NextResponse(bild.body, bild);
  antwort.headers.set(
    'Content-Disposition',
    `attachment; filename="${folienDateiname(folie.position, folie.storyKey)}"`,
  );
  return antwort;
}
