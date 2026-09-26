import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, Clapperboard } from 'lucide-react';
import { can } from '@swisshub/auth';
import { streamer } from '@swisshub/modules';
import { YOUTUBE_INTEGRATION_ID, describe, getIntegration } from '@swisshub/secrets';
import { Panel } from '@/components/shared/panel';
import { Button } from '@/components/ui/button';
import { SecretFeld } from '@/modules/integrations/components/secret-feld';
import { TestKnopf } from '@/modules/integrations/components/test-knopf';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';

export const metadata: Metadata = { title: 'YouTube-Integration' };
export const dynamic = 'force-dynamic';

/**
 * YouTube: API Key - und der Tagesstand des Kontingents.
 *
 * ## Warum der Verbrauch hier steht
 *
 * Weil er die eine Zahl ist, die diese Integration unbrauchbar machen kann,
 * ohne dass etwas kaputt aussieht: ist das Tageskontingent erschoepft, gibt die
 * API Fehler, und die Live-Erkennung weiss von keinem Kanal mehr etwas. Das
 * gehoert dem Betreiber vor die Augen und nicht in eine Fussnote.
 *
 * Die Zahlen kommen aus `StreamerApiVerbrauch` - also aus dem, was wir selbst
 * gebucht haben, nicht aus einer Schaetzung. Was Google zaehlt, kann davon
 * abweichen; deshalb steht es hier als «von uns gebucht» und nicht als
 * Restguthaben.
 */
export default async function YouTubeIntegrationPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission('integrations.view');
  const csrfToken = csrfTokenFor(context);
  // Zwei Berechtigungen - siehe die Twitch-Seite, dieselbe Aktion dahinter.
  const darfAendern = can(context, 'integrations.secrets.manage') && can(context, 'integrations.manage');

  const definition = getIntegration(YOUTUBE_INTEGRATION_ID);
  const [felder, stand, einstellungen] = await Promise.all([
    describe(YOUTUBE_INTEGRATION_ID),
    streamer.leseKontingent(),
    streamer.leseStreamerEinstellungen(),
  ]);

  return (
    <>
      <div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/system/integrationen">
            <ArrowLeft aria-hidden="true" />
            Zurück zu den Integrationen
          </Link>
        </Button>
      </div>

      <Panel
        title="YouTube Data API v3"
        icon={<Clapperboard />}
        description="Ein API-Schlüssel aus der Google Cloud Console, mit aktivierter YouTube Data API v3."
      >
        <div className="space-y-3">
          {felder.map((feld) => {
            const katalog = definition?.fields.find((eintrag) => eintrag.key === feld.key);
            return (
              <SecretFeld
                key={feld.key}
                integrationId={YOUTUBE_INTEGRATION_ID}
                csrfToken={csrfToken}
                darfAendern={darfAendern}
                feld={{
                  ...feld,
                  ...(katalog?.description ? { description: katalog.description } : {}),
                  updatedAt: feld.updatedAt ? feld.updatedAt.toISOString() : null,
                }}
              />
            );
          })}
        </div>

        <div className="mt-5 border-t border-border/60 pt-4">
          {/* Der Test kostet eine Einheit und bucht sie wie jede andere Abfrage.
              Ein Test, der nichts abfragt, würde einen abgelaufenen Schlüssel
              nicht finden. */}
          <TestKnopf integrationId={YOUTUBE_INTEGRATION_ID} csrfToken={csrfToken} />
        </div>
      </Panel>

      <Panel
        title="Kontingent heute"
        description="Was der Streamer Hub heute selbst gebucht hat - kein Restguthaben von Google."
      >
        <dl className="grid gap-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Verbraucht</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">
              {stand.einheiten.toLocaleString('de-CH')}
              <span className="ml-1 text-sm font-normal text-muted-foreground">
                / {einstellungen.youtubeKontingent.toLocaleString('de-CH')}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Abfragen</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">
              {stand.abfragen.toLocaleString('de-CH')}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Erkennungsart</dt>
            <dd className="mt-1">
              {einstellungen.youtubeGenau ? 'genau (teurer)' : 'sparsam'}
              <span className="mt-1 block text-xs text-muted-foreground">
                {einstellungen.youtubeGenau
                  ? 'search.list: 100 Einheiten je Kanal und Durchgang.'
                  : 'playlistItems.list + videos.list: 2 Einheiten je Kanal und Durchgang.'}
              </span>
            </dd>
          </div>
        </dl>
        <p className="mt-4 text-xs text-muted-foreground">
          Kontingent, Erkennungsart und Abfrageintervall stehen unter{' '}
          <Link href="/modules/streamer" className="text-primary underline-offset-4 hover:underline">
            System → Module → Streamer Hub
          </Link>
          . Ist das Kontingent erschöpft, hält der Streamer Hub den letzten bekannten Status - er erklärt
          keinen Kanal für offline, nur weil er nicht fragen konnte.
        </p>
      </Panel>
    </>
  );
}
