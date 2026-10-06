import { ImageResponse } from 'next/og';
import { NextResponse } from 'next/server';
import { can } from '@swisshub/auth';
import { resolveGuildId } from '@swisshub/discord';
import { isModuleEnabled, socialmedia, wrapped } from '@swisshub/modules';
import { createLogger } from '@swisshub/logger';
import { getActionAuthContext } from '@/server/auth';
import { enforceRateLimit } from '@/server/rate-limit';
import { POST_MASSE, postDateiname, zeichnePost } from '@/modules/socialmedia/post-folie';
import { ladeBilder } from '@/modules/socialmedia/bilder';

const log = createLogger('web:socialmedia-zip');

/**
 * Alle drei Formate als ZIP (§49).
 *
 * ## Warum ein Archiv und nicht drei Downloads
 *
 * Weil die drei Dateien zusammengehoeren und derselbe Post sind. Einzeln
 * geladen liegen sie im Downloadordner in der Reihenfolge, in der sie
 * ankamen, mit drei Klicks und drei Nachfragen des Browsers.
 *
 * ## Warum der ZIP-Schreiber von Wrapped
 *
 * Weil er schon da ist (`wrapped/zip.ts`), keine Abhaengigkeit mitbringt und
 * genau das kann, was hier gebraucht wird: ein paar PNG ohne Kompression in
 * ein Archiv legen. PNG ist bereits komprimiert; es ein zweites Mal durch
 * Deflate zu schicken kostet Rechenzeit und spart Promille.
 *
 * ## Warum dieselbe Zeichenquelle
 *
 * Weil es nur eine gibt. Die drei Dateien entstehen durch `zeichnePost` mit
 * drei Formaten - nicht durch drei Vorlagen, die zufaellig gleich aussehen
 * sollen (§38).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ postId: string }> },
): Promise<Response> {
  const context = await getActionAuthContext('cached');
  if (!context?.isMember) {
    return new NextResponse(null, { status: 401 });
  }
  if (!can(context, socialmedia.SOCIAL_MEDIA_PERMISSIONS.postExport)) {
    return new NextResponse(null, { status: 403 });
  }
  if (!(await isModuleEnabled(socialmedia.SOCIAL_MEDIA_MODULE_ID))) {
    return new NextResponse(null, { status: 404 });
  }

  await enforceRateLimit('postExport', context.user.discordId);

  const { postId } = await params;
  const guildId = await resolveGuildId();
  const post = await socialmedia.ladePost(postId, guildId);
  if (!post) {
    return new NextResponse(null, { status: 404 });
  }
  const typ = socialmedia.postTyp(post.postType);
  if (!typ) {
    return new NextResponse(null, { status: 409 });
  }

  const inhalt = socialmedia.leseInhalt(post);
  /*
   * Bilder und Baum **einmal** - nicht je Format.
   *
   * Drei Formate lesen dieselben Dateien und dasselbe Turnier. Es dreimal zu
   * tun waere zweimal zu viel, und es ist ausserdem die Zusage, dass alle
   * drei Dateien denselben Stand zeigen, auch wenn waehrend des Exports ein
   * Match entschieden wird.
   */
  const [bilder, baum] = await Promise.all([
    ladeBilder(inhalt),
    inhalt.bracket
      ? socialmedia.ladeTurnierBaum(inhalt.bracket.tournamentId, guildId)
      : Promise.resolve(null),
  ]);

  const design = socialmedia.postDesign(typ.id, post.design);
  const eintraege: Array<{ name: string; daten: Uint8Array }> = [];

  for (const format of socialmedia.POST_FORMATE) {
    /*
     * Eines nach dem anderen.
     *
     * Nicht parallel: jede `ImageResponse` rendert in einem eigenen
     * WASM-Kontext, und drei gleichzeitig sind drei Kontexte im Speicher
     * eines Containers, der auch die WebApp bedient. Drei Bilder
     * nacheinander brauchen unter einer Sekunde - das ist kein Grund fuer
     * Parallelitaet.
     */
    const mass = POST_MASSE[format];
    const bild = new ImageResponse(
      zeichnePost({
        typId: typ.id,
        typLabel: typ.label,
        block: typ.block,
        design,
        format,
        inhalt,
        bilder,
        baum,
      }),
      { width: mass.breite, height: mass.hoehe },
    );
    const inhaltBytes = new Uint8Array(await bild.arrayBuffer());
    if (inhaltBytes.byteLength === 0) {
      log.error('Leeres PNG beim ZIP-Export', { postId, format });
      return new NextResponse(null, { status: 500 });
    }
    eintraege.push({ name: postDateiname(typ.id, format, post.title), daten: inhaltBytes });
  }

  const archiv = wrapped.baueZip(eintraege);
  const stamm = postDateiname(typ.id, 'quadrat', post.title).replace(/-quadrat\.png$/u, '');

  return new NextResponse(new Uint8Array(archiv), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${stamm}-alle-formate.zip"`,
      'Content-Length': String(archiv.byteLength),
      'Cache-Control': 'no-store',
    },
  });
}
