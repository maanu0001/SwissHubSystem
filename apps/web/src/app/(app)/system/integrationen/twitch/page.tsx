import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, Radio } from 'lucide-react';
import { can } from '@swisshub/auth';
import { appUrl } from '@swisshub/config';
import { TWITCH_INTEGRATION_ID, describe, getIntegration } from '@swisshub/secrets';
import { Panel } from '@/components/shared/panel';
import { Button } from '@/components/ui/button';
import { SecretFeld } from '@/modules/integrations/components/secret-feld';
import { TestKnopf } from '@/modules/integrations/components/test-knopf';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';

export const metadata: Metadata = { title: 'Twitch-Integration' };
export const dynamic = 'force-dynamic';

/**
 * Twitch: Client ID und Client Secret.
 *
 * Gebaut wie die Discord-Seite, und aus demselben Grund: geladen wird
 * ausschliesslich `describe()` - eine Auskunft ohne Werte. Eine
 * Serverkomponente rendert ihre Daten in die Seite; stuende hier `getSecret()`,
 * laege das Client Secret im ausgelieferten HTML.
 *
 * ## Warum die Redirect-URI hier nur dasteht
 *
 * Weil sie nicht konfiguriert wird. Twitch verlangt sie beim Autorisieren und
 * beim Einloesen zeichengleich, und sie entsteht aus `NEXT_PUBLIC_APP_URL` -
 * derselben Quelle, aus der auch die WebApp ihre Adresse kennt. Ein zweites
 * Eingabefeld dafuer waere eine Fehlerquelle, die sich nur mit «invalid
 * redirect uri» meldet, und zwar erst beim Mitglied.
 */
export default async function TwitchIntegrationPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission('integrations.view');
  const csrfToken = csrfTokenFor(context);
  /*
   * Zwei Berechtigungen, weil die Aktion dahinter zwei prueft: `defineAction`
   * verlangt `integrations.secrets.manage`, und `pruefeAnbieter` im Rumpf
   * zusaetzlich `integrations.manage`. Eine Oberflaeche, die Felder anbietet,
   * die die Aktion ablehnt, waere eine Einladung in eine Fehlermeldung.
   */
  const darfAendern = can(context, 'integrations.secrets.manage') && can(context, 'integrations.manage');

  const definition = getIntegration(TWITCH_INTEGRATION_ID);
  const felder = await describe(TWITCH_INTEGRATION_ID);

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
        title="Twitch-Anwendung"
        icon={<Radio />}
        description="Zugangsdaten aus der Twitch Developer Console. Sie tragen die Live-Erkennung des Streamer Hubs und den Nachweis der Kanalinhaberschaft."
      >
        <div className="space-y-3">
          {felder.map((feld) => {
            const katalog = definition?.fields.find((eintrag) => eintrag.key === feld.key);
            return (
              <SecretFeld
                key={feld.key}
                integrationId={TWITCH_INTEGRATION_ID}
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
          {/* Der Test holt ein App Access Token und fragt damit einen Kanal ab -
              nicht nur das Token, denn das bestätigt die Zugangsdaten, aber
              nicht, dass Helix antwortet. */}
          <TestKnopf integrationId={TWITCH_INTEGRATION_ID} csrfToken={csrfToken} />
        </div>
      </Panel>

      <Panel title="OAuth" description="Wie ein Mitglied beweist, dass ein Kanal ihm gehört.">
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-muted-foreground">Redirect URI</dt>
            <dd className="mt-1">
              <code className="break-all rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                {appUrl('/api/streamer/twitch/callback')}
              </code>
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Scopes</dt>
            <dd className="mt-1 text-muted-foreground">
              keine - <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">/helix/users</code>{' '}
              gibt ohne Bereich das Konto des Token-Inhabers zurück, und genau das ist der Beweis.
            </dd>
          </div>
        </dl>
        <p className="mt-4 text-xs text-muted-foreground">
          Die Redirect URI gehört in der Twitch Developer Console unter OAuth Redirect URLs eingetragen,
          zeichengleich. Der Zugriffstoken des Mitglieds wird nach der Prüfung sofort widerrufen und nicht
          gespeichert - der Streamer Hub braucht ihn nur für diesen einen Moment.
        </p>
      </Panel>
    </>
  );
}
