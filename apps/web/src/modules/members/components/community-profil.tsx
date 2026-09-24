import Link from 'next/link';
import { ExternalLink, Pencil, Settings2 } from 'lucide-react';
import { profile } from '@swisshub/modules';
import { systemRoutes } from '@swisshub/shared';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/states';
import { formatDateTime } from '@swisshub/shared';
import { AuszeichnungsVerwaltung } from './auszeichnungs-verwaltung';
import { cn } from '@/lib/utils';

/**
 * Das Community-Profil eines Mitglieds - aus Sicht der Verwaltung.
 *
 * Drei Dinge, und nur drei: hinsehen, was oeffentlich davon steht,
 * bearbeiten, und Auszeichnungen verleihen. Tickets, Jail und Notizen haben
 * ihre eigenen Reiter und ihre eigenen Berechtigungen - sie kommen hier
 * nicht mit, auch nicht «weil man gerade da ist».
 */
export async function CommunityProfil({
  discordId,
  csrfToken,
  darfBearbeiten,
  darfAuszeichnungen,
  darfVerwalten,
}: {
  discordId: string;
  csrfToken: string;
  darfBearbeiten: boolean;
  darfAuszeichnungen: boolean;
  /** Darf die Liste der Auszeichnungen selbst pflegen - `members.awards.define`. */
  darfVerwalten: boolean;
}): Promise<React.JSX.Element> {
  const [slug, verleihungen, aktive] = await Promise.all([
    profile.slugVon(discordId).catch(() => null),
    darfAuszeichnungen ? profile.verleihungenVon(discordId).catch(() => []) : Promise.resolve([]),
    darfAuszeichnungen
      ? profile.listeAuszeichnungsArten().catch(() => [])
      : Promise.resolve([] as profile.VerwalteteArt[]),
  ]);

  /*
   * Die vergebbaren Arten plus die, die dieses Mitglied schon hat.
   *
   * Ohne den zweiten Teil verschwaende eine archivierte Auszeichnung aus
   * dieser Liste - und mit ihr der Knopf, mit dem man sie wieder entzieht.
   * Am Profil stuende sie weiterhin.
   */
  const fehlende = verleihungen
    .map((eintrag) => eintrag.key)
    .filter((key) => !aktive.some((art) => art.key === key));
  const arten = [...aktive, ...(await profile.auszeichnungsArtenNach(fehlende).catch(() => []))];

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Öffentliches Profil</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {slug
              ? 'Dieses Mitglied hat sein Profil öffentlich gestellt. Der Link funktioniert ohne Anmeldung.'
              : 'Dieses Mitglied hat sein Profil nicht öffentlich gestellt. Die Ansicht unten zeigt, was angemeldete Mitglieder sehen.'}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            href={systemRoutes.profil(discordId)}
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
          >
            Profil ansehen
          </Link>
          {slug ? (
            <a
              href={`/u/${slug}`}
              target="_blank"
              rel="noreferrer"
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
            >
              <ExternalLink aria-hidden="true" />
              Öffentliche Seite
            </a>
          ) : null}
          {darfBearbeiten ? (
            <Link href={`/members/${discordId}/profil`} className={cn(buttonVariants({ size: 'sm' }))}>
              <Pencil aria-hidden="true" />
              Bearbeiten
            </Link>
          ) : null}
        </div>
      </section>

      {darfAuszeichnungen ? (
        <section className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold">Auszeichnungen</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Nur die verleihbaren. Turniersiege, Clip-Siege und das Level werden gerechnet und lassen sich
              hier nicht setzen - sie entstehen dadurch, dass jemand sie sich verdient.
            </p>
            {darfVerwalten ? (
              <Link
                href={systemRoutes.auszeichnungen()}
                className="inline-flex items-center gap-1.5 text-xs text-primary-bright underline-offset-4 hover:underline"
              >
                <Settings2 className="size-3.5" aria-hidden="true" />
                Welche Auszeichnungen es gibt, wird hier verwaltet
              </Link>
            ) : null}
          </div>
          <AuszeichnungsVerwaltung
            discordId={discordId}
            csrfToken={csrfToken}
            arten={arten.map((art) => ({
              key: art.key,
              label: art.label,
              beschreibung: art.beschreibung,
              symbol: art.symbol,
              stufe: art.stufe,
              vergebbar: art.aktiv && !art.archiviert,
            }))}
            verliehen={verleihungen.map((eintrag) => ({
              key: eintrag.key,
              am: formatDateTime(eintrag.grantedAt),
              notiz: eintrag.note,
            }))}
          />
        </section>
      ) : null}

      {!darfBearbeiten && !darfAuszeichnungen ? (
        <EmptyState
          title="Nichts zu verwalten"
          description="Für diesen Bereich fehlen dir die Berechtigungen."
        />
      ) : null}
    </div>
  );
}
