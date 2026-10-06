import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { can } from '@swisshub/auth';
import { resolveGuildId } from '@swisshub/discord';
import { socialmedia } from '@swisshub/modules';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/shared/states';
import { PostEditor } from '@/modules/socialmedia/components/post-editor';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';

export const metadata: Metadata = { title: 'Post bearbeiten' };
export const dynamic = 'force-dynamic';

/**
 * Der Editor eines Posts.
 *
 * ## Was diese Seite dem Editor mitgibt
 *
 * Die Registry - und zwar **als Daten**, nicht als Import. Der Editor laeuft
 * im Browser; wuerde er `@swisshub/modules` importieren, kaeme der halbe
 * Modulkern samt Prisma-Typen ins Client-Bundle. Hier werden die Vorlagen in
 * schlichte Listen umgesetzt, und der Editor liest nur sie.
 *
 * Das ist gleichzeitig die Zusage, dass Editor und Zeichenquelle dieselbe
 * Vorlagenliste sehen: beide stammen aus `socialmedia.POST_TYPEN`, eine
 * Seite in JSON gegossen, die andere direkt.
 */
export default async function PostEditorPage({
  params,
}: {
  params: Promise<{ postId: string }>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission(socialmedia.SOCIAL_MEDIA_PERMISSIONS.postView);
  const { postId } = await params;
  const guildId = await resolveGuildId();
  const post = await socialmedia.ladePost(postId, guildId);

  if (!post) {
    return (
      <ErrorState
        title="Post nicht gefunden"
        description="Dieser Post existiert nicht mehr oder gehört zu einem anderen Server."
      />
    );
  }

  const typ = socialmedia.postTyp(post.postType);
  if (!typ) {
    return (
      <ErrorState
        title="Vorlage unbekannt"
        description="Die Vorlage dieses Posts gibt es nicht mehr. Lege ihn mit einer aktuellen Vorlage neu an."
      />
    );
  }

  const turniere = typ.quelle === 'turnier' ? await socialmedia.ladeTurnierWahl(guildId) : [];

  const felder = Object.fromEntries(
    socialmedia.POST_FELDER.map((feld) => [
      feld,
      {
        art: socialmedia.FELD_BESCHREIBUNG[feld].art,
        label: socialmedia.FELD_BESCHREIBUNG[feld].label,
        hinweis: socialmedia.FELD_BESCHREIBUNG[feld].hinweis,
      },
    ]),
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/social-media/post-creator">
            <ArrowLeft aria-hidden="true" />
            Zurück zur Bibliothek
          </Link>
        </Button>
      </div>

      <PostEditor
        csrfToken={csrfTokenFor(context)}
        darfBearbeiten={can(context, socialmedia.SOCIAL_MEDIA_PERMISSIONS.postEdit)}
        darfExportieren={can(context, socialmedia.SOCIAL_MEDIA_PERMISSIONS.postExport)}
        ansicht={{
          postId: post.id,
          title: post.title,
          postType: post.postType,
          design: socialmedia.postDesign(post.postType, post.design),
          status: post.status,
          inhalt: socialmedia.leseInhalt(post) as Record<string, unknown>,
          stand: post.updatedAt.getTime(),
        }}
        vorlagen={{
          typen: socialmedia.POST_TYPEN.map((eintrag) => ({
            id: eintrag.id,
            label: eintrag.label,
            felder: [...eintrag.felder],
            pflicht: [...eintrag.pflicht],
            designs: [...eintrag.designs],
            quelle: eintrag.quelle,
          })),
          designs: socialmedia.POST_DESIGNS.map((id) => ({
            id,
            label: socialmedia.DESIGN_BESCHREIBUNG[id].label,
            aufbau: socialmedia.DESIGN_BESCHREIBUNG[id].aufbau,
          })),
          felder,
          formate: socialmedia.POST_FORMATE.map((id) => ({
            id,
            label: socialmedia.FORMAT_LABEL[id],
          })),
          turniere: turniere.map((turnier) => ({
            id: turnier.id,
            name: turnier.name,
            spiel: turnier.spiel,
          })),
        }}
      />
    </div>
  );
}
