import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { can } from '@swisshub/auth';
import { serverrollen } from '@swisshub/modules';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { KategorienVerwaltung } from '@/modules/serverrollen/components/kategorien-verwaltung';
import { RollenVerwaltung } from '@/modules/serverrollen/components/rollen-verwaltung';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { loadDiscordOptions } from '@/server/configuration';
import { cn } from '@/lib/utils';
import { DokuHinweis } from '@/modules/docs/components/doku-link';

export const metadata: Metadata = { title: 'Serverrollen' };
export const dynamic = 'force-dynamic';

/**
 * Serverrollen pflegen.
 *
 * ## Warum hier nicht noch einmal die Hierarchie steht
 *
 * Weil sie unter `Server → Rollen` steht. Dieser Bereich beantwortet eine
 * andere Frage - «was erzählen wir über diese Rolle» - und benutzt dieselben
 * Daten: denselben Rollen-Zwischenspeicher, dieselbe `getRoleHierarchy` im
 * Hintergrund, dasselbe `discord.roles.add`.
 *
 * ## Die Warnung oben ist nicht Deko
 *
 * Lässt sich die Position der Bot-Rolle nicht ermitteln, sperrt
 * `pruefeSelbstzuweisung` **alles** - eine Hierarchie, die niemand kennt, ist
 * kein Freibrief. Ohne diesen Hinweis wäre die Folge eine Seite voll
 * ausgegrauter Schalter ohne erkennbaren Grund.
 */
export default async function ServerrollenVerwaltungsSeite(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(serverrollen.SERVERROLLEN_PERMISSIONS.view);
  const [ansicht, oeffentlich, discordOptionen] = await Promise.all([
    serverrollen.ladeVerwaltung(),
    serverrollen.oeffentlichErlaubt(),
    // Die Kanalliste fuer das Dropdown-Embed - dieselbe Quelle wie ueberall.
    loadDiscordOptions(),
  ]);

  const csrfToken = csrfTokenFor(context);
  const darfPflegen = can(context, serverrollen.SERVERROLLEN_PERMISSIONS.manage);
  const darfFreigeben = can(context, serverrollen.SERVERROLLEN_PERMISSIONS.selfService);

  return (
    <div className="space-y-6">
      {/*
        Keine eigene Hauptueberschrift hier: die eine der Anwendung steht in
        `AppHeader` und kommt aus der Route. Eine zweite waere doppelt und fuer
        Screenreader falsch.
      */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Rollen erklären, in Gruppen sortieren und zur Selbstvergabe freigeben. Name und Farbe kommen von
          Discord - hier steht nur, was Discord nicht kennt.
        </p>
        <DokuHinweis slug="serverrollen" />
        {oeffentlich ? (
          <Link
            href="/serverrollen"
            target="_blank"
            rel="noreferrer"
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'shrink-0')}
          >
            <ExternalLink className="size-4" aria-hidden="true" />
            Öffentliche Seite
          </Link>
        ) : null}
      </header>

      {ansicht.botPosition === null ? (
        <Card className="border-destructive/40">
          <CardContent className="flex items-start gap-3 py-5 text-sm">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
            <div className="space-y-1">
              <p className="font-medium">Die Rolle des Bots ist gerade nicht zu ermitteln.</p>
              <p className="text-muted-foreground">
                Solange das so ist, bleibt jede Selbstvergabe gesperrt - Discord erlaubt einem Bot nur Rollen
                unterhalb seiner eigenen, und ohne diese Angabe lässt sich das nicht prüfen. Prüfe unter{' '}
                <Link href="/server/roles" className="underline">
                  Server → Rollen
                </Link>
                , ob der Bot auf dem Server ist.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {!oeffentlich ? (
        <Card>
          <CardContent className="py-5 text-sm text-muted-foreground">
            Die öffentliche Seite ist ausgeschaltet. Du kannst hier alles vorbereiten; sichtbar wird es,
            sobald du das Modul einschaltest und in den Moduleinstellungen «Öffentliche Seite» aktivierst.
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Gruppen</CardTitle>
          <CardDescription>
            Die Abschnitte der öffentlichen Seite, in der Reihenfolge ihrer Position. Rollen ohne Gruppe
            stehen am Ende unter «Sonstige». Je Gruppe lässt sich einstellen, ob nur eine Rolle daraus gilt,
            in wie vielen Spalten sie auf der öffentlichen Seite steht und ob sie als Auswahlmenü in einem
            Discord-Kanal liegt.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {darfPflegen ? (
            <KategorienVerwaltung
              kategorien={ansicht.kategorien}
              channels={discordOptionen.channels}
              csrfToken={csrfToken}
            />
          ) : (
            <NurLesen kategorien={ansicht.kategorien} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rollen</CardTitle>
          <CardDescription>
            Alle Rollen des Servers. Erst wer eine Beschreibung oder eine Gruppe bekommt, erscheint auf der
            öffentlichen Seite.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {darfPflegen ? (
            <RollenVerwaltung
              rollen={ansicht.rollen}
              kategorien={ansicht.kategorien}
              csrfToken={csrfToken}
              darfFreigeben={darfFreigeben}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Zum Ändern fehlt dir die Berechtigung «Serverrollen pflegen».
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Die Gruppen ohne Knöpfe.
 *
 * Wer nur `view` hat, soll den Stand sehen können - eine leere Seite wäre eine
 * schlechtere Antwort als eine Liste ohne Bedienelemente.
 */
function NurLesen({ kategorien }: { kategorien: serverrollen.KategorieFuerVerwaltung[] }): React.JSX.Element {
  if (kategorien.length === 0) {
    return <p className="text-sm text-muted-foreground">Noch keine Gruppe angelegt.</p>;
  }
  return (
    <ul className="space-y-2 text-sm">
      {kategorien.map((gruppe) => (
        <li key={gruppe.id} className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2">
          <span className="font-medium">{gruppe.name}</span>
          <span className="text-muted-foreground">
            {' '}
            · {gruppe.anzahlRollen} {gruppe.anzahlRollen === 1 ? 'Rolle' : 'Rollen'}
            {gruppe.publicVisible ? '' : ' · versteckt'}
          </span>
        </li>
      ))}
    </ul>
  );
}
