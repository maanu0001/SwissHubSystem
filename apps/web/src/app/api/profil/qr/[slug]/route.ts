import { NextResponse, type NextRequest } from 'next/server';
import { appUrl } from '@swisshub/config';
import { profile } from '@swisshub/modules';
import { qrSvg } from '@/modules/profile/qr';

/**
 * Der QR-Code zur oeffentlichen Profiladresse - als Datei.
 *
 * ## Warum SVG und nicht PNG
 *
 * Weil dieser Code auf Papier landet: auf einem Flyer, einem Sticker, einem
 * Aufsteller an einer Veranstaltung. Ein SVG laesst sich beliebig gross drucken,
 * ohne dass eine Kante unscharf wird - und Unschaerfe ist genau das, was einen
 * QR-Code unlesbar macht. Wer ein Raster braucht, nimmt die Gamer Card: dort
 * steckt derselbe Code im PNG.
 *
 * ## Warum der Code auf den aktuellen Slug zeigt
 *
 * Er zeigt auf `/u/<aktueller Slug>`. Aendert jemand seine Adresse, fuehrt ein
 * schon gedruckter Code auf den alten - und der leitet weiter, weil der alte
 * Slug als Alias bestehen bleibt. Das ist der Grund, warum es diese Aliasse
 * gibt: ein gedruckter Code laesst sich nicht einsammeln.
 *
 * ## Warum dieselbe Pruefung wie die Seite
 *
 * `ladeOeffentlichesProfilOderSperre` entscheidet. Ein privates oder von der
 * Moderation gesperrtes Profil gibt keinen Code her - ein QR-Code auf eine 404
 * waere kein Schutz, aber ein Aergernis, und §21 verlangt, dass eine Sperre
 * jede oeffentliche Ausgabe abschaltet.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const antwort = await profile.ladeOeffentlichesProfilOderSperre(slug);
  if (antwort.art !== 'profil') {
    return new NextResponse(null, { status: 404 });
  }

  const adresse = `${appUrl()}/u/${encodeURIComponent(antwort.profil.slug)}`;
  const svg = qrSvg(adresse);
  // `?download=1` erzwingt das Speichern; ohne den Parameter zeigt der Browser
  // den Code an - das ist, was die Vorschau im Editor braucht.
  const laden = request.nextUrl.searchParams.get('download') === '1';

  return new NextResponse(svg, {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      /*
       * Fuenf Minuten.
       *
       * Der Code aendert sich nur, wenn der Slug sich aendert - und dann lohnt
       * ein kurzer Zwischenspeicher trotzdem nicht viel. Er bremst vor allem
       * jemanden, der die Route in einer Schleife aufruft.
       */
      'cache-control': 'public, max-age=300',
      ...(laden
        ? {
            'content-disposition': `attachment; filename="swisshub-qr-${antwort.profil.slug}.svg"`,
          }
        : {}),
    },
  });
}
