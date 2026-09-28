import { ImageResponse } from 'next/og';
import { NextResponse, type NextRequest } from 'next/server';
import { appUrl } from '@swisshub/config';
import { getDiscordAvatarUrl } from '@swisshub/discord/cdn';
import { profile } from '@swisshub/modules';
import { systemRoutes } from '@swisshub/shared';
import {
  GAMER_CARD_MASSE,
  gamerCardDateiname,
  istGamerCardFormat,
  zeichneGamerCard,
} from '@/modules/profile/gamer-card';
import { qrDatenUri } from '@/modules/profile/qr';

/**
 * Die Gamer Card als PNG.
 *
 * ## Warum die Route oeffentlich ist - und trotzdem nichts preisgibt
 *
 * Sie zeigt genau das, was auf `/u/<slug>` steht, in Bildform. Deshalb kommt
 * sie aus **derselben** Quelle: `ladeOeffentlichesProfilOderSperre`. Gibt es
 * kein oeffentliches Profil unter diesem Slug, ist es privat oder von der
 * Moderation gesperrt, gibt es auch keine Karte - und zwar mit derselben 404
 * wie die Seite.
 *
 * Eine zweite Datenquelle waere eine zweite Stelle, an der ein verborgenes Feld
 * durchrutschen koennte. Die Sichtbarkeit je Abschnitt hat der Dienst bereits
 * angewendet: fehlt das Level im DTO, fehlt es auf der Karte - hier steht keine
 * Pruefung, die man vergessen kann.
 *
 * ## Warum das Profilbild hier geholt wird und nicht in der Zeichnung
 *
 * Satori wuerde es sonst mitten im Rendern von Discords CDN laden. Ein
 * langsames CDN waere dann ein Export, der ins Zeitlimit laeuft - und ein
 * Dienst, der beim Zeichnen beliebige Adressen abruft, ist eine Angriffsflaeche.
 * Hier wird **eine** bekannte Adresse mit einem Zeitlimit geholt; scheitert es,
 * zeigt die Karte die Anfangsbuchstaben.
 *
 * ## Warum `no-store`
 *
 * Weil die Karte der Stand von jetzt ist. Wer sein Theme wechselt und die Karte
 * neu exportiert, soll das neue Theme sehen - und nicht das, was vor fuenf
 * Minuten im Zwischenspeicher lag. Eine geteilte **Datei** ist ohnehin eine
 * Kopie; zwischenzuspeichern gibt es hier nichts zu gewinnen.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Wie lange auf Discords CDN gewartet wird, bevor die Karte ohne Bild entsteht. */
const BILD_ZEITLIMIT_MS = 4000;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const antwort = await profile.ladeOeffentlichesProfilOderSperre(slug);
  /*
   * Nur ein Profil ergibt eine Karte.
   *
   * «gesperrt» und «umgezogen» bekommen ausdruecklich keine: eine gesperrte
   * Seite darf kein Bild mehr ausliefern (§21), und fuer einen alten Slug gibt
   * es die Karte unter der neuen Adresse.
   */
  if (antwort.art !== 'profil') {
    return new NextResponse(null, { status: 404 });
  }
  const profil = antwort.profil;

  const rohFormat = request.nextUrl.searchParams.get('format') ?? 'story';
  if (!istGamerCardFormat(rohFormat)) {
    return new NextResponse('Unbekanntes Format.', { status: 400 });
  }
  // Der QR-Code ist optional: `?qr=0` laesst ihn weg. Vorgabe ist «dabei» -
  // eine Karte ohne Weg zum Profil ist ein Bild ohne Anschluss.
  const mitQr = request.nextUrl.searchParams.get('qr') !== '0';

  const adresse = appUrl(systemRoutes.oeffentlichesProfil(profil.slug));
  const mass = GAMER_CARD_MASSE[rohFormat];

  const [bildQuelle, bannerQuelle] = await Promise.all([
    holeBild(getDiscordAvatarUrl(profil.identitaet.discordId, profil.identitaet.avatarHash, 512)),
    profil.gestaltung.bannerBild ? leseBanner(profil.identitaet.discordId) : Promise.resolve(null),
  ]);

  const bild = new ImageResponse(
    zeichneGamerCard({
      format: rohFormat,
      profil,
      adresse,
      bildQuelle,
      bannerQuelle,
      qrQuelle: mitQr ? qrDatenUri(adresse) : null,
    }),
    { width: mass.breite, height: mass.hoehe },
  );

  const bytes = await bild.arrayBuffer();
  return new NextResponse(bytes, {
    headers: {
      'content-type': 'image/png',
      'cache-control': 'no-store',
      /*
       * `inline` und nicht `attachment`.
       *
       * Die Vorschau im Editor ist dieselbe Route - mit `attachment` laedt der
       * Browser sie herunter, statt sie zu zeigen. Den Download erzwingt der
       * Knopf im Editor ueber das `download`-Attribut, und der Dateiname steht
       * trotzdem hier, damit er auch bei «Bild speichern unter» stimmt.
       */
      'content-disposition': `inline; filename="${gamerCardDateiname(
        profil.identitaet.profilname ?? profil.identitaet.name,
        rohFormat,
      )}"`,
    },
  });
}

/**
 * Ein Bild von Discords CDN als Daten-URI - oder `null`.
 *
 * Mit Zeitlimit und ohne Wurf: eine Karte ohne Profilbild ist eine Karte, eine
 * Ausnahme mitten im Export ist ein 500er. Geprueft wird zusaetzlich der
 * gemeldete Typ - was kein Bild ist, wird nicht eingebettet.
 */
async function holeBild(url: string): Promise<string | null> {
  try {
    const antwort = await fetch(url, { signal: AbortSignal.timeout(BILD_ZEITLIMIT_MS) });
    if (!antwort.ok) {
      return null;
    }
    const typ = antwort.headers.get('content-type') ?? '';
    if (!typ.startsWith('image/')) {
      return null;
    }
    const daten = Buffer.from(await antwort.arrayBuffer());
    return `data:${typ};base64,${daten.toString('base64')}`;
  } catch {
    return null;
  }
}

/**
 * Das Profilbanner aus dem Upload-Verzeichnis.
 *
 * Direkt von der Platte und nicht ueber die eigene Route: `/api/profil/<id>/banner`
 * verlangt eine Mitgliedschaft, und dieser Export laeuft auch ohne Anmeldung.
 * Dass das Banner ueberhaupt gezeigt werden darf, hat der Dienst schon
 * entschieden - `gestaltung.bannerBild` ist nur gesetzt, wenn das Profil
 * oeffentlich steht.
 */
async function leseBanner(discordId: string): Promise<string | null> {
  try {
    const datei = await profile.leseBanner(discordId);
    if (!datei) {
      return null;
    }
    return `data:${datei.contentType};base64,${datei.data.toString('base64')}`;
  } catch {
    return null;
  }
}
