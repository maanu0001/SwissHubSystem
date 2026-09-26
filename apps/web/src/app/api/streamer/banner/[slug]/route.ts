import { NextResponse, type NextRequest } from 'next/server';
import { profile, streamer } from '@swisshub/modules';

/**
 * Das Banner eines freigegebenen Streamers - oeffentlich.
 *
 * ## Warum es diese Route gibt
 *
 * `/api/profil/<id>/banner` verlangt eine Mitgliedschaft, und das ist dort
 * richtig: ein Profilbanner gehoert zum Profil, und das Profil sehen
 * Mitglieder. Ein anonymer Besucher der oeffentlichen Streamer-Seite bekaeme
 * dort eine 401 - und damit eine Seite mit Verlauf statt Banner, ohne dass
 * jemand wuesste, warum.
 *
 * Diese Route ist die bewusste, enge Oeffnung dafuer. Sie liefert **nur**:
 *
 * - zu einem Profil-Slug, der existiert,
 * - dessen Person ein **freigegebenes** Streamer-Profil hat,
 * - mit mindestens einem aktiven Kanal.
 *
 * Alles andere ist 404 - dieselbe Antwort fuer «kein Slug», «kein Streamer»,
 * «pausiert» und «kein Banner». Ein Besucher soll daraus nichts ableiten
 * koennen.
 *
 * ## Warum das keine Ausweitung ist, die jemand entschieden haben muss
 *
 * Weil die Person sie entschieden hat: eine Bewerbung als Community-Streamer
 * **ist** die Zustimmung zur oeffentlichen Darstellung. Und die Freigabe des
 * Teams ist die zweite Unterschrift darunter. Wer sein Streamer-Profil
 * pausieren laesst, verliert damit auch diese Route.
 *
 * Dass die Slug-Auflösung ueber `ladeOeffentlichenStreamer` laeuft, ist
 * Absicht: es ist dieselbe Funktion, die auch die Seite selbst benutzt. Eine
 * eigene Abfrage hier waere eine zweite Stelle, die entscheidet, was
 * oeffentlich ist.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  // Derselbe Schalter wie die Seiten, die dieses Bild einbinden.
  if (!(await streamer.oeffentlichErlaubt())) {
    return new NextResponse(null, { status: 404 });
  }

  const { slug } = await params;
  const eintrag = await streamer.ladeOeffentlichenStreamer(slug);
  if (!eintrag) {
    return new NextResponse(null, { status: 404 });
  }

  const datei = await profile.leseBanner(eintrag.discordId);
  if (!datei) {
    return new NextResponse(null, { status: 404 });
  }

  return new NextResponse(new Uint8Array(datei.data), {
    headers: {
      'Content-Type': datei.contentType,
      /*
       * Oeffentlich zwischenspeicherbar, aber kurz: das Banner aendert sich
       * selten, die Freigabe kann sich jederzeit aendern. Fuenf Minuten sind
       * lang genug fuer eine Uebersichtsseite mit zwanzig Karten und kurz
       * genug, dass eine Pausierung schnell wirkt.
       */
      'Cache-Control': 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
