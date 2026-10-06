import type { Metadata } from 'next';
import Link from 'next/link';
import { can } from '@swisshub/auth';
import { resolveGuildId } from '@swisshub/discord';
import { socialmedia } from '@swisshub/modules';
import { formatDateTime } from '@swisshub/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EmptyState, ErrorState } from '@/components/shared/states';
import { ModulNavigation } from '@/components/shared/modul-navigation';
import { StatCard } from '@/components/shared/stat-card';
import { PostAktionen } from '@/modules/socialmedia/components/post-aktionen';
import { PostNeu } from '@/modules/socialmedia/components/post-neu';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { ladeSocialMediaStand, socialMediaBereiche } from '@/server/socialmedia';

export const metadata: Metadata = { title: 'Post Creator' };
export const dynamic = 'force-dynamic';

/**
 * Die Bibliothek des Post Creators (§42).
 *
 * ## Warum die Filter in der Adresse stehen
 *
 * Weil man eine gefilterte Liste verschicken und zurueckspringen will. Mit
 * Zustand im Browser waere «Entwürfe, Typ Event» ein Zustand, der beim
 * Zurueckgehen verloren ist - und der Link an einen Kollegen zeigte etwas
 * anderes als der eigene Bildschirm.
 *
 * Und weil es ohne JavaScript funktioniert: ein `form` mit `method="get"`
 * braucht keinen Client, keinen Effekt und keine Entprellung.
 */
const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Entwurf',
  READY: 'Fertig',
  ARCHIVED: 'Abgelegt',
};

export default async function PostCreatorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission(socialmedia.SOCIAL_MEDIA_PERMISSIONS.postView);
  const guildId = await resolveGuildId();
  const stand = await ladeSocialMediaStand(context, guildId);

  if (!stand.aktiv) {
    return (
      <ErrorState
        title="Modul deaktiviert"
        description="Social Media ist derzeit ausgeschaltet. In den Moduleinstellungen lässt es sich einschalten."
      />
    );
  }

  const filter = await searchParams;
  const einzeln = (schluessel: string): string =>
    typeof filter[schluessel] === 'string' ? (filter[schluessel] as string) : '';
  const status = einzeln('status');
  const typFilter = einzeln('typ');
  const suche = einzeln('suche');

  const [posts, zahlen] = await Promise.all([
    socialmedia.ladePosts({
      guildId,
      ...(status === 'DRAFT' || status === 'READY' || status === 'ARCHIVED' ? { status } : {}),
      ...(typFilter ? { postType: typFilter } : {}),
      ...(suche ? { suche } : {}),
    }),
    socialmedia.zaehlePosts(guildId),
  ]);

  const darfAnlegen = can(context, socialmedia.SOCIAL_MEDIA_PERMISSIONS.postCreate);
  const darfLoeschen = can(context, socialmedia.SOCIAL_MEDIA_PERMISSIONS.postDelete);
  const darfExportieren = can(context, socialmedia.SOCIAL_MEDIA_PERMISSIONS.postExport);
  const csrfToken = csrfTokenFor(context);

  return (
    <div className="space-y-6">
      <ModulNavigation
        eintraege={socialMediaBereiche(stand)}
        aktiv="post-creator"
        label="Bereiche in Social Media"
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Entwürfe" value={zahlen.DRAFT} hint="in Arbeit" />
        <StatCard label="Fertig" value={zahlen.READY} hint="bereit zum Posten" />
        <StatCard label="Abgelegt" value={zahlen.ARCHIVED} hint="aus dem Weg, nicht gelöscht" />
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        {/* Ein gewoehnliches GET-Formular - kein Client, keine Entprellung. */}
        <form className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="suche">Titel</Label>
            <Input id="suche" name="suche" defaultValue={suche} placeholder="suchen" className="w-48" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="status">Status</Label>
            <select
              id="status"
              name="status"
              defaultValue={status}
              className="h-10 rounded-lg border border-border bg-card/70 px-3 text-sm"
            >
              <option value="">Alle</option>
              <option value="DRAFT">Entwurf</option>
              <option value="READY">Fertig</option>
              <option value="ARCHIVED">Abgelegt</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="typ">Typ</Label>
            <select
              id="typ"
              name="typ"
              defaultValue={typFilter}
              className="h-10 rounded-lg border border-border bg-card/70 px-3 text-sm"
            >
              <option value="">Alle</option>
              {socialmedia.POST_TYPEN.map((typ) => (
                <option key={typ.id} value={typ.id}>
                  {typ.label}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" variant="outline">
            Filtern
          </Button>
        </form>

        {darfAnlegen ? (
          <PostNeu
            csrfToken={csrfToken}
            vorlagen={{
              typen: socialmedia.POST_TYPEN.map((typ) => ({
                id: typ.id,
                label: typ.label,
                beschreibung: typ.beschreibung,
                designs: [...typ.designs],
              })),
              designs: socialmedia.POST_DESIGNS.map((id) => ({
                id,
                label: socialmedia.DESIGN_BESCHREIBUNG[id].label,
                aufbau: socialmedia.DESIGN_BESCHREIBUNG[id].aufbau,
              })),
            }}
          />
        ) : null}
      </div>

      {posts.length === 0 ? (
        <EmptyState
          title={suche || status || typFilter ? 'Nichts gefunden' : 'Noch keine Posts'}
          description={
            suche || status || typFilter
              ? 'Mit anderen Filtern findest du vielleicht mehr.'
              : 'Mit «Neuer Post» entsteht der erste - Vorlage wählen, Text eintragen, exportieren.'
          }
        />
      ) : (
        <ul className="grid gap-3">
          {posts.map((post) => {
            const typ = socialmedia.postTyp(post.postType);
            return (
              <li
                key={post.id}
                className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={post.status === 'READY' ? 'success' : 'secondary'}>
                      {STATUS_LABEL[post.status] ?? post.status}
                    </Badge>
                    <Badge variant="outline">{typ?.label ?? post.postType}</Badge>
                    <Badge variant="outline">
                      {
                        socialmedia.DESIGN_BESCHREIBUNG[socialmedia.postDesign(post.postType, post.design)]
                          .label
                      }
                    </Badge>
                  </div>
                  <Link
                    href={`/social-media/post-creator/${post.id}`}
                    className="block truncate text-sm font-medium hover:underline"
                  >
                    {post.title}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(post.updatedAt)}
                    {post.updatedByUsername ? ` · ${post.updatedByUsername}` : ''}
                  </p>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-1">
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/social-media/post-creator/${post.id}`}>Öffnen</Link>
                  </Button>
                  {darfExportieren ? (
                    <Button asChild variant="ghost" size="sm">
                      <a href={`/api/social-media/post/${post.id}/zip`} download>
                        Exportieren
                      </a>
                    </Button>
                  ) : null}
                  <PostAktionen
                    postId={post.id}
                    titel={post.title}
                    archiviert={post.status === 'ARCHIVED'}
                    csrfToken={csrfToken}
                    darfDuplizieren={darfAnlegen}
                    darfLoeschen={darfLoeschen}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
