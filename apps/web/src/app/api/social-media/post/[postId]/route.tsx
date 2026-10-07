import { ImageResponse } from 'next/og';
import { NextResponse, type NextRequest } from 'next/server';
import { can } from '@swisshub/auth';
import { resolveGuildId } from '@swisshub/discord';
import { isModuleEnabled, socialmedia } from '@swisshub/modules';
import { getActionAuthContext } from '@/server/auth';
import { enforceRateLimit } from '@/server/rate-limit';
import { POST_MASSE, postDateiname, zeichnePost } from '@/modules/socialmedia/post-folie';
import { ladeBilder } from '@/modules/socialmedia/bilder';
import { ladeSchriften } from '@/modules/socialmedia/mitgeliefert';

/**
 * Ein Post als PNG - und zugleich die Vorschau im Editor (§38, §47).
 *
 * ## Warum das eine Route ist und nicht zwei
 *
 * Weil «Vorschau = Export» sonst eine Absicht waere und nicht eine Tatsache.
 * Der Editor zeigt ein `<img>` auf genau diese Adresse; der Exportknopf laedt
 * sie mit `download`. Es gibt keinen zweiten Weg zu einem Bild, also kann es
 * keinen Unterschied geben - auch nicht in einem halben Jahr, wenn jemand ein
 * Feld ergaenzt und die zweite Stelle vergisst.
 *
 * Unterschieden wird nur eines: ob die Antwort als Datei angeboten wird. Das
 * ist eine Kopfzeile, kein zweiter Renderweg - und sie haengt am Recht
 * `posts.export`, denn ein Export verlaesst das System.
 *
 * ## Warum kein Cache
 *
 * Ein Post wird bearbeitet. Eine alte Fassung im Browsercache waere eine
 * Grafik, deren Text nicht mehr dem entspricht, was im Editor steht - und
 * genau das erlebt man dann als «die Vorschau aktualisiert nicht».
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FORMATE = new Set<string>(socialmedia.POST_FORMATE);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ postId: string }> },
): Promise<Response> {
  const context = await getActionAuthContext('cached');
  if (!context?.isMember) {
    return new NextResponse(null, { status: 401 });
  }
  if (!can(context, socialmedia.SOCIAL_MEDIA_PERMISSIONS.postView)) {
    return new NextResponse(null, { status: 403 });
  }
  if (!(await isModuleEnabled(socialmedia.SOCIAL_MEDIA_MODULE_ID))) {
    return new NextResponse(null, { status: 404 });
  }

  const adresse = new URL(request.url);
  const herunterladen = adresse.searchParams.get('download') === '1';
  if (herunterladen && !can(context, socialmedia.SOCIAL_MEDIA_PERMISSIONS.postExport)) {
    return new NextResponse(null, { status: 403 });
  }

  // Ein Bild zu zeichnen kostet Rechenzeit. Die Vorschau laeuft oefter als
  // der Export, deshalb zwei Grenzen - und die schaerfere am Export.
  await enforceRateLimit(herunterladen ? 'postExport' : 'postCreator', context.user.discordId);

  const format = adresse.searchParams.get('format') ?? 'quadrat';
  if (!FORMATE.has(format)) {
    return new NextResponse(null, { status: 400 });
  }

  const { postId } = await params;
  const guildId = await resolveGuildId();
  const post = await socialmedia.ladePost(postId, guildId);
  if (!post) {
    return new NextResponse(null, { status: 404 });
  }

  const typ = socialmedia.postTyp(post.postType);
  if (!typ) {
    // Die Vorlage gibt es nicht mehr. Lieber ein klarer Fehlschlag als ein
    // Bild, das nach einer anderen Vorlage aussieht als die, mit der es
    // angelegt wurde.
    return new NextResponse(null, { status: 409 });
  }

  const inhalt = socialmedia.leseInhalt(post);
  const [bilder, baum, schriften] = await Promise.all([
    ladeBilder(inhalt),
    /*
     * Der Baum wird **gelesen**, nicht aus dem Post genommen (§45).
     *
     * Am Post steht nur die Kennung des Turniers. Deshalb zeigt ein Export
     * von heute den Stand von heute - und nicht den, der beim Anlegen galt.
     */
    inhalt.bracket
      ? socialmedia.ladeTurnierBaum(inhalt.bracket.tournamentId, guildId)
      : Promise.resolve(null),
    /*
     * Die Schriftschnitte.
     *
     * Ohne sie kennt `next/og` genau einen - Noto Sans Regular - und
     * verwirft jedes `fontWeight` still. Eine Ueberschrift saehe dann aus wie
     * ihr Fliesstext, nur groesser. Gelesen wird einmal je Prozess, der
     * zweite Export bekommt dieselben Puffer.
     */
    ladeSchriften(),
  ]);

  const mass = POST_MASSE[format as socialmedia.PostFormat];
  const bild = new ImageResponse(
    zeichnePost({
      typId: typ.id,
      typLabel: typ.label,
      block: typ.block,
      design: socialmedia.postDesign(typ.id, post.design),
      format: format as socialmedia.PostFormat,
      inhalt,
      bilder,
      baum,
    }),
    { width: mass.breite, height: mass.hoehe, ...(schriften ? { fonts: schriften } : {}) },
  );

  const antwort = new NextResponse(bild.body, bild);
  if (herunterladen) {
    antwort.headers.set(
      'Content-Disposition',
      `attachment; filename="${postDateiname(typ.id, format as socialmedia.PostFormat, post.title)}"`,
    );
  }
  antwort.headers.set('Cache-Control', 'no-store');
  return antwort;
}
