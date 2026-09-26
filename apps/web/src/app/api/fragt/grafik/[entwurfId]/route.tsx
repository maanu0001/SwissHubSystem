import { ImageResponse } from 'next/og';
import { NextResponse, type NextRequest } from 'next/server';
import { can } from '@swisshub/auth';
import { fragt, isModuleEnabled } from '@swisshub/modules';
import { getActionAuthContext } from '@/server/auth';
import { enforceRateLimit } from '@/server/rate-limit';
import {
  SOCIAL_MASSE,
  folienDateiname,
  zeichneSocialFolie,
  type SocialFormat,
} from '@/modules/fragt/social-folie';
import { socialDaten } from '@/modules/fragt/daten';

/**
 * Eine Social-Media-Folie als PNG.
 *
 * ## Warum gezeichnet und nicht abfotografiert
 *
 * Weil ein Screenshot die Groesse des Fensters haette, die Schrift des Systems
 * und mit etwas Pech die Haelfte einer Browserleiste. Hier entsteht das Bild
 * aus derselben Komponente, die auch die Vorschau im Studio zeigt - in fester
 * Groesse, mit festen Farben, ohne Oberflaeche drumherum.
 *
 * ## Warum aus dem Schnappschuss
 *
 * Weil ein zweiter Export dasselbe ergeben muss wie der erste. Die Zahlen
 * stehen in `FragtAbstimmung.ergebnis`, festgeschrieben beim Schliessen; eine
 * spaeter umbenannte Antwort aendert sie nicht mehr.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FORMATE = new Set<SocialFormat>(['story', 'feed', 'quadrat']);
const ARTEN = new Set<string>(fragt.FOLIEN_ARTEN);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ entwurfId: string }> },
): Promise<Response> {
  const context = await getActionAuthContext('cached');
  if (!context?.isMember) {
    return new NextResponse(null, { status: 401 });
  }
  if (!can(context, fragt.FRAGT_PERMISSIONS.studio)) {
    return new NextResponse(null, { status: 403 });
  }
  if (!(await isModuleEnabled(fragt.FRAGT_MODULE_ID))) {
    return new NextResponse(null, { status: 404 });
  }

  // Ein Bild zu zeichnen kostet Rechenzeit. Dasselbe Limit wie beim
  // Wrapped-Export, aus demselben Grund.
  await enforceRateLimit('wrappedShare', context.user.discordId);

  const adresse = new URL(request.url);
  const format = adresse.searchParams.get('format') ?? 'story';
  const art = adresse.searchParams.get('art') ?? '';
  if (!FORMATE.has(format as SocialFormat)) {
    return new NextResponse(null, { status: 400 });
  }

  const { entwurfId } = await params;
  const quelle = await fragt.holeEntwurfsDaten(entwurfId);
  if (!quelle) {
    return new NextResponse(null, { status: 404 });
  }

  const daten = socialDaten(quelle);
  if (!daten) {
    // Kein lesbares Ergebnis. Lieber ein klarer Fehlschlag als ein Bild mit
    // Nullen, das aussieht wie ein Ergebnis.
    return new NextResponse(null, { status: 409 });
  }

  /*
   * Ohne `art` gilt die Vorlage des Entwurfs.
   *
   * Das ist der Weg fuer ein Einzelbild: das Studio waehlt `winner`, `results`
   * oder `duel`, und die Route zeichnet die dazu passende Folie. Mit `art`
   * wird eine bestimmte Folie des Carousels angefordert.
   */
  const folienArt = ARTEN.has(art)
    ? (art as fragt.FolienArt)
    : ((): fragt.FolienArt => {
        const vorlage = quelle.entwurf.vorlage as fragt.Vorlage;
        return vorlage === 'winner' ? 'gewinner' : vorlage === 'duel' ? 'duell' : 'verteilung';
      })();

  const mass = SOCIAL_MASSE[format as SocialFormat];
  const bild = new ImageResponse(
    zeichneSocialFolie({ art: folienArt, format: format as SocialFormat, daten }),
    { width: mass.breite, height: mass.hoehe },
  );

  const antwort = new NextResponse(bild.body, bild);
  antwort.headers.set(
    'Content-Disposition',
    `attachment; filename="${folienDateiname(0, folienArt, format as SocialFormat)}"`,
  );
  // Kein Cache: ein Entwurf wird bearbeitet, und eine alte Fassung im Cache
  // waere eine Grafik, deren Text nicht mehr dem entspricht, was im Studio
  // steht.
  antwort.headers.set('Cache-Control', 'no-store');
  return antwort;
}
