import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle, ArrowLeft, Check, CreditCard, Minus } from 'lucide-react';
import { can } from '@swisshub/auth';
import { appUrl } from '@swisshub/config';
import { premium } from '@swisshub/modules';
import { PAYMENT_INTEGRATION_ID, describe, getIntegration } from '@swisshub/secrets';
import { formatDateTime } from '@swisshub/shared';
import { Panel } from '@/components/shared/panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SecretFeld } from '@/modules/integrations/components/secret-feld';
import { TestKnopf } from '@/modules/integrations/components/test-knopf';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';

export const metadata: Metadata = { title: 'Zahlungen' };
export const dynamic = 'force-dynamic';

/**
 * System → Integrationen → Zahlungen (§17).
 *
 * ## Warum eine eigene Seite und nicht die allgemeine Feldliste
 *
 * Weil welche Felder noetig sind, vom gewaehlten Anbieter abhaengt. Die
 * allgemeine Liste zeigte alle zehn - darunter «Checkout Endpoint» fuer
 * Stripe, das ihn nicht kennt, und «Space ID» fuer PayPal, das sie nicht hat.
 * Ein Formular mit Feldern, die nichts bedeuten, laedt dazu ein, sie
 * auszufuellen.
 *
 * Dazu kommen drei Dinge, die nur hier Sinn haben: die Faehigkeiten des
 * Anbieters (§15 - nicht alle koennen alles), der Modus (§19 - und er muss
 * deutlich sichtbar sein), und die Webhook-Adresse, die beim Anbieter
 * eingetragen werden muss.
 *
 * ## Warum keine Werte geladen werden
 *
 * `describe()` liefert eine Auskunft **ohne** Werte: Maske, Herkunft,
 * Zeitpunkt. Stuende hier `getSecret()`, laege der API-Schluessel im
 * ausgelieferten HTML - und eine Serverkomponente rendert ihre Daten in die
 * Seite (§18).
 */

/** Ein Haken, ein Strich oder ein Hinweis - je Faehigkeit. */
function Faehigkeit({ kann, label }: { kann: boolean; label: string }): React.JSX.Element {
  return (
    <li className="flex items-center gap-2 text-sm">
      {kann ? (
        <Check aria-hidden="true" className="size-4 shrink-0 text-emerald-500" />
      ) : (
        <Minus aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      )}
      <span className={kann ? '' : 'text-muted-foreground'}>{label}</span>
    </li>
  );
}

export default async function ZahlungenIntegrationPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission('integrations.view');
  const csrfToken = csrfTokenFor(context);
  const darfAendern = can(context, 'integrations.secrets.manage') && can(context, 'integrations.manage');

  const definition = getIntegration(PAYMENT_INTEGRATION_ID);
  const [felder, konfiguration, webhook] = await Promise.all([
    describe(PAYMENT_INTEGRATION_ID),
    premium.ladeKonfiguration(),
    premium.webhookZustand(),
  ]);

  const profil = konfiguration.profil;
  /*
   * Welche Felder gezeigt werden.
   *
   * Die vier Steuerfelder immer; die uebrigen nur, wenn der gewaehlte Anbieter
   * sie kennt. Solange keiner gewaehlt ist, bleibt es bei den Steuerfeldern -
   * man soll zuerst entscheiden, wer kassiert, und dann seine Zugangsdaten
   * eintragen.
   */
  const STEUERUNG = new Set(['enabled', 'provider', 'mode']);
  const relevant = new Set<string>([...(profil?.pflicht ?? []), ...(profil?.optional ?? [])]);

  const sichtbar = felder.filter(
    (feld) => STEUERUNG.has(feld.key) || (profil !== null && relevant.has(feld.key)),
  );
  const verborgen = felder.length - sichtbar.length;

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

      {/* Der Zustand zuerst: die eine Frage, mit der man hierherkommt. */}
      <Panel
        title="Zustand"
        icon={<CreditCard />}
        description="Was SwissHub gerade mit Zahlungen tun kann - und was nicht."
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={konfiguration.bereit ? 'default' : 'secondary'}>
            {konfiguration.bereit ? 'Betriebsbereit' : 'Nicht betriebsbereit'}
          </Badge>
          {profil ? <Badge variant="outline">{profil.label}</Badge> : null}
          {/*
            Der Modus deutlich und nicht als Nebensatz (§19).

            LIVE ist rot, weil es die Aussage «hier fliesst echtes Geld» ist -
            und weil die gefaehrliche Verwechslung die ist, LIVE fuer TEST zu
            halten.
          */}
          <Badge variant={konfiguration.modus === 'LIVE' ? 'destructive' : 'secondary'}>
            Modus {konfiguration.modus === 'LIVE' ? 'LIVE – echtes Geld' : 'TEST'}
          </Badge>
          {profil && !profil.adapter ? (
            <Badge variant="outline" className="border-amber-500/50 text-amber-500">
              Adapter fehlt
            </Badge>
          ) : null}
        </div>

        {konfiguration.hinderungsgrund ? (
          <p className="mt-3 flex items-start gap-2 text-sm text-muted-foreground">
            <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-amber-500" />
            <span>
              {konfiguration.hinderungsgrund}
              {/*
                §27: kein Fehlerzustand. Premium laeuft weiter - nur der
                Checkout bleibt zu, und das steht hier als Tatsache, nicht als
                Warnung.
              */}{' '}
              Premium funktioniert weiterhin für Admin-Vergaben, bestehende Abos und die Angebotsseite; nur
              der Kauf ist nicht verfügbar.
            </span>
          </p>
        ) : null}

        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Webhook-Adresse</dt>
            <dd className="mt-1">
              <code className="break-all rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                {appUrl('/api/premium/webhook')}
              </code>
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Standardwährung</dt>
            <dd className="mt-1">CHF – pro Angebot einstellbar</dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-muted-foreground">
          Die Adresse gehört beim Anbieter als Webhook-Ziel eingetragen. Ohne gültige Signatur wird kein
          Ereignis verarbeitet - ein unsignierter Aufruf verändert nichts.
        </p>

        {/*
          Webhook-Status (§18).

          «Eingerichtet» kann diese Seite nicht wissen - das weiss nur der
          Anbieter. Was sie weiss, ist, ob je eines angekommen ist, und das
          ist die nuetzlichere Auskunft: ein hinterlegtes Geheimnis ohne ein
          einziges Ereignis heisst fast immer, dass die Adresse beim Anbieter
          fehlt.
        */}
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
          <Badge variant={webhook.geheimnisGesetzt ? 'secondary' : 'outline'}>
            {webhook.geheimnisGesetzt ? 'Signaturgeheimnis hinterlegt' : 'Kein Signaturgeheimnis'}
          </Badge>
          <Badge variant={webhook.anzahl > 0 ? 'secondary' : 'outline'}>
            {webhook.anzahl === 0
              ? 'Noch kein Ereignis empfangen'
              : `${webhook.anzahl} Ereignis${webhook.anzahl === 1 ? '' : 'se'} empfangen`}
          </Badge>
          {webhook.fehlerhaft > 0 ? (
            <Badge variant="outline" className="border-amber-500/50 text-amber-500">
              {webhook.fehlerhaft} mit Fehler
            </Badge>
          ) : null}
          {webhook.zuletzt ? (
            <span className="text-xs text-muted-foreground">
              Zuletzt {formatDateTime(webhook.zuletzt)}
              {webhook.zuletztTyp ? ` (${webhook.zuletztTyp})` : ''}
            </span>
          ) : null}
        </div>
        {webhook.geheimnisGesetzt && webhook.anzahl === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Das Geheimnis ist da, angekommen ist noch nichts. Meistens fehlt dann die Adresse oben in den
            Einstellungen des Anbieters.
          </p>
        ) : null}
      </Panel>

      <Panel
        title="Anbieter und Zugangsdaten"
        description="Wer das Geld entgegennimmt. Geheime Felder lassen sich setzen und ersetzen, nie zurücklesen."
      >
        <div className="space-y-3">
          {sichtbar.map((feld) => {
            const katalog = definition?.fields.find((eintrag) => eintrag.key === feld.key);
            const pflicht = profil?.pflicht.includes(feld.key as never) ?? false;
            return (
              <SecretFeld
                key={feld.key}
                integrationId={PAYMENT_INTEGRATION_ID}
                csrfToken={csrfToken}
                darfAendern={darfAendern}
                feld={{
                  ...feld,
                  ...(katalog?.description
                    ? {
                        description: pflicht
                          ? `${katalog.description} (für ${profil?.label ?? 'diesen Anbieter'} erforderlich)`
                          : katalog.description,
                      }
                    : {}),
                  updatedAt: feld.updatedAt ? feld.updatedAt.toISOString() : null,
                }}
              />
            );
          })}
        </div>

        {verborgen > 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">
            {verborgen} weitere{verborgen === 1 ? 's' : ''} Feld
            {verborgen === 1 ? '' : 'er'} gehör{verborgen === 1 ? 't' : 'en'} zu anderen Anbietern und
            {verborgen === 1 ? ' wird' : ' werden'} hier nicht angezeigt.
          </p>
        ) : null}

        <div className="mt-5 border-t border-border/60 pt-4">
          {/* Prüft Erreichbarkeit und Zugangsdaten - keine Zahlung (§20). */}
          <TestKnopf integrationId={PAYMENT_INTEGRATION_ID} csrfToken={csrfToken} />
          <p className="mt-2 text-xs text-muted-foreground">
            Der Test fragt den Anbieter nach seinem Kontostand oder antwortet mit einem Verbindungsaufbau. Es
            wird keine Zahlung ausgelöst und kein Betrag bewegt.
          </p>
        </div>
      </Panel>

      {profil ? (
        <Panel
          title={`Was ${profil.label} kann`}
          description="Nicht jeder Anbieter kann alles. Was hier fehlt, bietet SwissHub bei diesem Anbieter nicht an."
        >
          <p className="mb-3 text-sm text-muted-foreground">{profil.beschreibung}</p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {(Object.keys(profil.capabilities) as Array<keyof typeof profil.capabilities>).map(
              (schluessel) => (
                <Faehigkeit
                  key={schluessel}
                  kann={profil.capabilities[schluessel]}
                  label={premium.CAPABILITY_LABEL[schluessel]}
                />
              ),
            )}
          </ul>
          {!profil.adapter ? (
            <p className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
              Für {profil.label} ist in SwissHub noch kein Adapter angeschlossen. Die Zugangsdaten lassen sich
              hinterlegen und vorbereiten - eine Zahlung läuft damit noch nicht. Das ist Absicht: ein
              Formular, das nach «fertig» aussieht und dann nichts tut, wäre schlechter als eines, das sagt,
              was fehlt.
            </p>
          ) : null}
          {profil.dokumentation ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Zugangsdaten:{' '}
              <a href={profil.dokumentation} className="underline" target="_blank" rel="noreferrer noopener">
                {profil.dokumentation}
              </a>
            </p>
          ) : null}
          {profil.waehrungen.length > 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Bekannte Währungen: {profil.waehrungen.join(', ')}
            </p>
          ) : null}
        </Panel>
      ) : (
        <Panel title="Noch kein Anbieter gewählt">
          <p className="text-sm text-muted-foreground">
            Sobald oben ein Anbieter gewählt ist, steht hier, was er kann und welche Zugangsdaten er braucht.
            Bis dahin ist der Kauf von Premium nicht verfügbar - alles andere am Premium-Modul funktioniert.
          </p>
        </Panel>
      )}

      <Panel
        title="Zuletzt geändert"
        description="Welche Felder hinterlegt sind - und woher sie kommen. Werte stehen hier nie."
      >
        <ul className="space-y-1 text-sm">
          {felder.map((feld) => (
            <li key={feld.key} className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">{feld.label}:</span>
              <Badge variant={feld.origin === 'missing' ? 'outline' : 'secondary'}>
                {feld.origin === 'database'
                  ? 'Datenbank'
                  : feld.origin === 'environment'
                    ? 'Umgebung'
                    : feld.origin === 'default'
                      ? 'Vorgabe'
                      : 'nicht gesetzt'}
              </Badge>
              {feld.updatedAt ? (
                <span className="text-xs text-muted-foreground">{formatDateTime(feld.updatedAt)}</span>
              ) : null}
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}
