import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Radio } from 'lucide-react';
import { streamer } from '@swisshub/modules';
import { formatDateTime, systemRoutes } from '@swisshub/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatCard } from '@/components/shared/stat-card';
import { ModulNavigation } from '@/components/shared/modul-navigation';
import { requirePagePermission } from '@/server/auth';
import { streamerNavigation } from '@/modules/streamer/navigation';

export const metadata: Metadata = { title: 'Streamer Hub' };
export const dynamic = 'force-dynamic';

/**
 * Die Uebersicht des Streamer Hubs.
 *
 * ## Was hier steht, und was nicht
 *
 * Jede Zahl zaehlt Zeilen, die durch eine beobachtete Handlung entstanden sind.
 * Es gibt keine geschaetzte Reichweite und kein Ranking - und die beobachteten
 * Streaming-Stunden tragen das Datum, ab dem beobachtet wird. Ohne dieses Datum
 * waere die Zahl eine Behauptung ueber die ganze Vergangenheit eines Kanals.
 *
 * ## Warum die offenen Punkte oben stehen
 *
 * Weil ein Modul, das nichts tut und nicht sagt warum, die schlechtere Variante
 * von einem ist, das gar nicht da ist. Ohne Zugangsdaten gibt es keine
 * Live-Erkennung, und dann soll das hier stehen - nicht in einem Log.
 *
 * Kein `PageHeader`: der Titel kommt aus der Module Registry, und die Kopfzeile
 * zeichnet ihn als die einzige Ueberschrift erster Ordnung der Anwendung. Ein
 * zweiter waere derselbe Text zweimal.
 */
export default async function StreamerHubSeite(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(streamer.STREAMER_PERMISSIONS.view);

  const [kennzahlen, bereit, einstellungen] = await Promise.all([
    streamer.ladeKennzahlen(),
    streamer.ladeBereitschaft(),
    streamer.leseStreamerEinstellungen(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <ModulNavigation
        eintraege={streamerNavigation(context)}
        aktiv="uebersicht"
        label="Bereiche im Streamer Hub"
      />

      {bereit.offenePunkte.length > 0 ? (
        <Card className="border-warning/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-warning">
              <AlertTriangle className="size-4" aria-hidden="true" />
              {bereit.offenePunkte.length === 1
                ? 'Ein Punkt ist offen'
                : `${bereit.offenePunkte.length} Punkte sind offen`}
            </CardTitle>
            <CardDescription>
              Ohne diese Schritte läuft das Modul eingeschränkt. Bewerbungen, Freigaben und das Content Studio
              funktionieren unabhängig davon.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2 text-sm">
              {bereit.offenePunkte.map((punkt) => (
                <li key={punkt} className="flex gap-2 text-muted-foreground">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-warning" aria-hidden="true" />
                  {punkt}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-success/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-success">
              <CheckCircle2 className="size-4" aria-hidden="true" />
              Alles eingerichtet
            </CardTitle>
            <CardDescription>
              Plattformabfragen laufen, Live-Ankündigungen sind aktiv und ein Kanal ist gewählt.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Jetzt live"
          value={kennzahlen.jetztLive}
          tone={kennzahlen.jetztLive > 0 ? 'success' : 'default'}
          icon={<Radio />}
          hint={kennzahlen.jetztLive > 0 ? 'gerade auf Sendung' : 'niemand auf Sendung'}
        />
        <StatCard
          label="Freigegeben"
          value={kennzahlen.freigegeben}
          hint={`${kennzahlen.registriert} registriert${kennzahlen.pausiert > 0 ? ` · ${kennzahlen.pausiert} pausiert` : ''}`}
        />
        <StatCard
          label="Offene Bewerbungen"
          value={kennzahlen.offeneBewerbungen}
          tone={kennzahlen.offeneBewerbungen > 0 ? 'warning' : 'default'}
          href={systemRoutes.streamerHubBewerbungen()}
        />
        <StatCard
          label="Erkannte Streams"
          value={kennzahlen.erkannteStreams}
          hint={
            kennzahlen.beobachtetSeit
              ? `beobachtet seit ${formatDateTime(kennzahlen.beobachtetSeit)}`
              : 'noch keiner beobachtet'
          }
        />
        <StatCard
          label="Gesendete Ankündigungen"
          value={kennzahlen.gesendeteAnkuendigungen}
          href={systemRoutes.streamerHubAnkuendigungen()}
        />
        <StatCard label="Spotlights" value={kennzahlen.spotlights} href={systemRoutes.streamerHubStudio()} />
        <StatCard
          label="Beobachtete Stunden"
          value={kennzahlen.beobachteteStunden}
          /*
           * Der Hinweis ist Teil der Zahl, nicht Dekor: ohne ihn liest sich
           * «14 Stunden» als die Streaming-Geschichte eines Kanals, und das ist
           * sie nicht - sie ist, was dieses Modul selbst gesehen hat.
           */
          hint={
            kennzahlen.beobachtetSeit
              ? `nur beendete Streams seit ${formatDateTime(kennzahlen.beobachtetSeit)}`
              : 'noch nichts beobachtet'
          }
        />
        <StatCard
          label="YouTube-Kontingent"
          value={
            bereit.youtube.aktiv
              ? `${bereit.youtube.kontingentVerbraucht} / ${bereit.youtube.kontingentGrenze}`
              : 'aus'
          }
          tone={
            bereit.youtube.aktiv &&
            bereit.youtube.kontingentVerbraucht > bereit.youtube.kontingentGrenze * 0.8
              ? 'warning'
              : 'default'
          }
          hint={
            bereit.youtube.aktiv
              ? bereit.youtube.genau
                ? 'genaue Erkennung'
                : 'günstige Erkennung'
              : undefined
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Wie oft abgefragt wird</CardTitle>
          <CardDescription>
            Einstellbar unter{' '}
            <Link href="/modules/streamer" className="text-primary underline-offset-4 hover:underline">
              System → Module → Streamer Hub
            </Link>
            .
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <div className="font-medium">Twitch</div>
            <div className="text-muted-foreground">
              {bereit.twitch.aktiv
                ? `alle ${einstellungen.twitchIntervallMinuten} Minuten, gebündelt bis 100 Kanäle je Anfrage`
                : 'Abfrage ausgeschaltet'}
              {bereit.twitch.aktiv && !bereit.twitch.zugangsdaten ? ' - Zugangsdaten fehlen' : ''}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <div className="font-medium">YouTube</div>
            <div className="text-muted-foreground">
              {bereit.youtube.aktiv
                ? `alle ${einstellungen.youtubeIntervallMinuten} Minuten, ${bereit.youtube.genau ? '100' : '2'} Einheiten je Kanal und Durchgang`
                : 'Abfrage ausgeschaltet'}
              {bereit.youtube.aktiv && !bereit.youtube.zugangsdaten ? ' - API Key fehlt' : ''}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
