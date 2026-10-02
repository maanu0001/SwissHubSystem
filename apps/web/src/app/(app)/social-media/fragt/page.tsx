import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { resolveGuildId } from '@swisshub/discord';
import { socialmedia } from '@swisshub/modules';
import { ModulNavigation } from '@/components/shared/modul-navigation';
import { Panel } from '@/components/shared/panel';
import { Badge } from '@/components/ui/badge';
import { EmptyState, ErrorState } from '@/components/shared/states';
import { requirePagePermission } from '@/server/auth';
import { ladeExportKarten, ladeSocialMediaStand, socialMediaBereiche } from '@/server/socialmedia';

export const metadata: Metadata = { title: 'SwissHub fragt' };
export const dynamic = 'force-dynamic';

/**
 * Der Reiter «SwissHub fragt» im Social-Media-Bereich.
 *
 * ## Warum hier kein Studio steht
 *
 * Weil es eines gibt. Das Content Studio liegt unter `/fragt/studio/<id>`, es
 * kennt die Vorlagen, die Formate und den Entwurfszustand - und es wuerde hier
 * zum zweiten Mal entstehen, in einer Fassung, die beim naechsten Feld
 * auseinanderlaeuft.
 *
 * Diese Seite ist deshalb eine Liste mit Wegen hinein: welche Abstimmungen
 * geschlossen sind, welche davon schon gepostet wurden, und wohin man klickt.
 * Mehr soll ein Zugriffspunkt nicht sein.
 *
 * ## Warum sie nicht einfach auf `/fragt` weiterleitet
 *
 * Weil `/fragt` die Arbeit an den Fragen zeigt - Bibliothek, Planung, laufende
 * Abstimmung - und nicht die am Posten. Wer hier ist, hat eine andere Frage als
 * wer dort ist. Eine Weiterleitung waere bequem und waere die Antwort auf die
 * falsche Frage.
 */
export default async function SocialMediaFragtPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(socialmedia.SOCIAL_MEDIA_PERMISSIONS.view);
  const guildId = await resolveGuildId();
  const stand = await ladeSocialMediaStand(context, guildId);

  if (!stand.aktiv) {
    return <ErrorState title="Modul deaktiviert" description="Social Media ist derzeit ausgeschaltet." />;
  }
  /*
   * Kein Reiter, keine Seite.
   *
   * `notFound` und nicht 403: ob jemand `fragt.studio` hat, ist keine Auskunft,
   * die diese Adresse geben muss. Und die eigentliche Pruefung sitzt ohnehin in
   * `/fragt/studio` selbst - diese Zeile verhindert nur einen Weg, der dort
   * endet.
   */
  if (!stand.fragtOffen) {
    notFound();
  }

  const karten = (await ladeExportKarten(stand)).filter((karte) => karte.quelle === 'fragt');

  return (
    <div className="space-y-6">
      <ModulNavigation
        eintraege={socialMediaBereiche(stand)}
        aktiv="fragt"
        label="Bereiche in Social Media"
      />

      <Panel
        title="Geschlossene Abstimmungen"
        description="Jede Zeile führt in das Content Studio, in dem die Grafiken entstehen - oder auf das Ergebnis, solange es noch keinen Entwurf gibt."
        icon="MessageCircleQuestion"
        action={
          <Link
            href="/fragt"
            className="text-sm text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
          >
            Zu SwissHub fragt
          </Link>
        }
      >
        {karten.length === 0 ? (
          <EmptyState
            title="Noch keine geschlossene Abstimmung"
            description="Sobald eine Frage durch ist, steht ihr Ergebnis hier - und von hier führt der Weg ins Studio."
          />
        ) : (
          <ul className="grid gap-3">
            {karten.map((karte) => (
              <li key={karte.href}>
                <Link
                  href={karte.href}
                  className="flex flex-col gap-2 rounded-xl border border-border bg-background/40 p-4 transition hover:border-primary/40 sm:flex-row sm:items-center sm:justify-between"
                >
                  <p className="min-w-0 truncate text-sm font-medium">{karte.titel}</p>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-muted-foreground">{karte.hinweis}</span>
                    {karte.offen ? <Badge variant="default">Offen</Badge> : null}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
