import { ImageResponse } from 'next/og';
import { NextResponse, type NextRequest } from 'next/server';
import { can } from '@swisshub/auth';
import { isModuleEnabled, profile, streamer } from '@swisshub/modules';
import { getDiscordAvatarUrl } from '@swisshub/discord/cdn';
import { createLogger } from '@swisshub/logger';
import { getActionAuthContext } from '@/server/auth';
import { enforceRateLimit } from '@/server/rate-limit';
import {
  SPOTLIGHT_MASSE,
  istFormat,
  spotlightDateiname,
  zeichneSpotlight,
} from '@/modules/streamer/social-folie';

/**
 * Ein Streamer Spotlight als PNG.
 *
 * ## Warum dieselbe Komponente wie die Vorschau
 *
 * Weil §10.4 genau das verlangt: was im Studio zu sehen ist, muss auch
 * herauskommen. `zeichneSpotlight` wird von der Vorschau und von hier gerufen;
 * eine zweite Zeichenfunktion waere die Stelle, an der beides auseinanderlaeuft
 * - und auffallen wuerde es erst auf Instagram.
 *
 * ## Warum die Bilder als Daten-URI hereinkommen
 *
 * Satori holt eine Bildadresse waehrend des Zeichnens selbst. Zwei Probleme
 * dabei:
 *
 * 1. **Das Banner liegt hinter einer Route mit Zugangspruefung.** Satori
 *    schickt keine Cookies, bekaeme also eine 401 und zeichnete nichts.
 * 2. **Ein langsames CDN wird ein Export, der ins Zeitlimit laeuft.**
 *
 * Deshalb holt diese Route beide Bilder selbst - das Banner direkt aus dem
 * Dateispeicher, den Avatar von Discords CDN mit einem eigenen Zeitlimit - und
 * reicht sie als Daten-URI weiter. Scheitert eines davon, entsteht die Grafik
 * **ohne** es: eine Spotlight-Grafik ohne Banner ist brauchbar, eine
 * Fehlermeldung nicht.
 *
 * ## Was hier nicht passiert
 *
 * Kein Weg nach Instagram. Die Antwort ist eine PNG-Datei zum Herunterladen.
 * Veroeffentlicht wird von einem Menschen.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('web:streamer:spotlight');

/** Wie lange auf ein fremdes Bild gewartet wird, bevor es weggelassen wird. */
const BILD_ZEITLIMIT_MS = 4000;

/** Ein Bild holen und als Daten-URI zurueckgeben - oder `null`. */
async function alsDatenUri(adresse: string): Promise<string | null> {
  try {
    const antwort = await fetch(adresse, { signal: AbortSignal.timeout(BILD_ZEITLIMIT_MS) });
    if (!antwort.ok) {
      return null;
    }
    const typ = antwort.headers.get('content-type') ?? 'image/png';
    if (!typ.startsWith('image/')) {
      return null;
    }
    const bytes = Buffer.from(await antwort.arrayBuffer());
    // Ein Profilbild ist klein. Etwas Grosses waere nichts, was hier hingehoert.
    if (bytes.byteLength > 4 * 1024 * 1024) {
      return null;
    }
    return `data:${typ};base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ spotlightId: string }> },
): Promise<Response> {
  const context = await getActionAuthContext('cached');
  if (!context?.isMember) {
    return new NextResponse(null, { status: 401 });
  }
  if (!can(context, streamer.STREAMER_PERMISSIONS.spotlight)) {
    return new NextResponse(null, { status: 403 });
  }
  if (!(await isModuleEnabled(streamer.STREAMER_MODULE_ID))) {
    return new NextResponse(null, { status: 404 });
  }

  // Ein Bild zu zeichnen kostet Rechenzeit - dasselbe Limit wie beim
  // Wrapped-Export, aus demselben Grund.
  await enforceRateLimit('wrappedShare', context.user.discordId);

  const adresse = new URL(request.url);
  const format = adresse.searchParams.get('format') ?? 'story';
  if (!istFormat(format)) {
    return new NextResponse('Unbekanntes Format.', { status: 400 });
  }

  const { spotlightId } = await params;
  const daten = await streamer.holeSpotlightDaten(spotlightId);
  if (!daten) {
    return new NextResponse(null, { status: 404 });
  }

  /*
   * Das Banner aus dem Dateispeicher - nicht ueber die Route.
   *
   * Direkt gelesen, weil wir hier serverseitig sind und den Umweg ueber HTTP
   * samt Zugangspruefung nicht brauchen. Das ist zugleich der Grund, warum es
   * ueberhaupt geht: die Route wuerde Satori abweisen.
   */
  let bannerQuelle: string | null = null;
  const bannerDatei = await profile.leseBanner(daten.streamer.discordId).catch(() => null);
  if (bannerDatei) {
    bannerQuelle = `data:${bannerDatei.contentType};base64,${Buffer.from(bannerDatei.data).toString('base64')}`;
  }

  const bildQuelle = await alsDatenUri(
    getDiscordAvatarUrl(daten.streamer.discordId, daten.streamer.avatarHash, 512),
  );
  if (!bildQuelle) {
    // Kein Grund, den Export zu verweigern - die Fassung bleibt, das Bild fehlt.
    log.debug('Profilbild liess sich nicht laden', { spotlightId });
  }

  const { breite, hoehe } = SPOTLIGHT_MASSE[format];

  return new ImageResponse(
    zeichneSpotlight({
      format,
      streamer: daten.streamer,
      texte: {
        ueberschrift: daten.spotlight.ueberschrift,
        beschreibung: daten.spotlight.beschreibung,
        cta: daten.spotlight.cta,
      },
      bildQuelle,
      bannerQuelle,
    }),
    {
      width: breite,
      height: hoehe,
      headers: {
        /*
         * `no-store`: der Entwurf aendert sich beim Bearbeiten, und ein
         * zwischengespeichertes PNG waere die Fassung von vorhin - genau der
         * Unterschied zwischen Vorschau und Export, den es nicht geben soll.
         */
        'Cache-Control': 'no-store',
        'Content-Disposition': `inline; filename="${spotlightDateiname(daten.streamer.name, format)}"`,
      },
    },
  );
}
