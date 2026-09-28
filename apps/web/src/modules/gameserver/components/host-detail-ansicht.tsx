'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Copy, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  hostAbbilderSynchronisierenAction,
  hostLoeschenAction,
  hostRegistrierungOeffnenAction,
  hostStatusAction,
  hostVerbindungTestenAction,
} from '@/modules/gameserver/actions';
import { GesundheitsAbzeichen, statusText } from './host-verwaltung';
import type { HostDetail } from '@/server/gameserver';

/**
 * Die Detailseite eines Hosts.
 *
 * ## Was es hier nicht gibt
 *
 * Keine Shell, keine Docker-Kommandozeile, keine RCON-Konsole, kein
 * Dateieditor. Die Knöpfe sind eine feste Liste von Handlungen, und jede
 * davon geht durch eine Server Action mit Berechtigungsprüfung.
 *
 * ## Das Registrierungs-Token
 *
 * Es erscheint **einmal**, direkt nachdem jemand es angefordert hat, und
 * wird nirgends gespeichert - in der Datenbank steht nur sein Hash. Wer es
 * verlegt, fordert ein neues an; das alte gilt dann nicht mehr.
 */
export function HostDetailAnsicht({
  host,
  darfVerwalten,
  darfAbbilder,
  swisshubUrl,
  csrfToken,
}: {
  host: HostDetail;
  darfVerwalten: boolean;
  darfAbbilder: boolean;
  swisshubUrl: string;
  csrfToken: string;
}): React.JSX.Element {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const [token, setToken] = useState<{ wert: string; ablauf: string } | null>(null);

  const mit = async (schluessel: string, arbeit: () => Promise<void>): Promise<void> => {
    setLaeuft(schluessel);
    try {
      await arbeit();
    } finally {
      setLaeuft(null);
    }
  };

  async function statusSetzen(status: 'ACTIVE' | 'DRAINING' | 'MAINTENANCE' | 'DISABLED'): Promise<void> {
    await mit(status, async () => {
      const antwort = await hostStatusAction({ csrfToken, hostId: host.id, status });
      if (!antwort.ok) {
        toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
        return;
      }
      toast.success(
        antwort.data.laufende > 0
          ? `${statusText(status)}. ${String(antwort.data.laufende)} laufende Matches bleiben unberührt.`
          : statusText(status),
      );
      router.refresh();
    });
  }

  async function registrierungOeffnen(): Promise<void> {
    await mit('register', async () => {
      const antwort = await hostRegistrierungOeffnenAction({
        csrfToken,
        hostId: host.id,
        gueltigMinuten: 60,
      });
      if (!antwort.ok) {
        toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
        return;
      }
      setToken({ wert: antwort.data.token, ablauf: antwort.data.ablauf });
      router.refresh();
    });
  }

  async function verbindungTesten(): Promise<void> {
    await mit('check', async () => {
      const antwort = await hostVerbindungTestenAction({ csrfToken, hostId: host.id });
      if (!antwort.ok) {
        toast.error(antwort.error?.message ?? 'Die Prüfung ist fehlgeschlagen.');
        return;
      }
      if (antwort.data.ok) {
        toast.success(antwort.data.meldung);
      } else {
        toast.error(antwort.data.meldung);
      }
      router.refresh();
    });
  }

  async function abbilderAbgleichen(laden: boolean): Promise<void> {
    await mit(laden ? 'pull' : 'sync', async () => {
      const antwort = await hostAbbilderSynchronisierenAction({ csrfToken, hostId: host.id, laden });
      if (!antwort.ok) {
        toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
        return;
      }
      const { geprueft, aktuell, geladen, fehler } = antwort.data;
      toast[fehler > 0 ? 'error' : 'success'](
        `${String(geprueft)} geprüft, ${String(aktuell)} aktuell, ${String(geladen)} geladen, ${String(fehler)} Fehler.`,
      );
      router.refresh();
    });
  }

  async function entfernen(): Promise<void> {
    if (!window.confirm(`Host «${host.name}» wirklich entfernen? Das lässt sich nicht rückgängig machen.`)) {
      return;
    }
    await mit('delete', async () => {
      const antwort = await hostLoeschenAction({ csrfToken, hostId: host.id });
      if (!antwort.ok) {
        toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
        return;
      }
      toast.success('Host entfernt.');
      router.push('/turniere/gameserver/hosts');
    });
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">{host.name}</h1>
            <GesundheitsAbzeichen wert={host.gesundheit} />
            <Badge variant="outline">{statusText(host.status)}</Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            {host.hostname}:{host.agentPort}
            {host.region ? ` · ${host.region}` : ''}
            {host.gruppe ? ` · ${host.gruppe}` : ''}
          </p>
          <p className="text-muted-foreground mt-1 text-sm">{host.gesundheitGrund}</p>
        </div>

        {darfVerwalten ? (
          <div className="flex flex-wrap gap-2">
            <Knopf label="Verbindung testen" schluessel="check" laeuft={laeuft} bei={verbindungTesten} />
            {host.status !== 'ACTIVE' ? (
              <Knopf
                label="Aktivieren"
                schluessel="ACTIVE"
                laeuft={laeuft}
                bei={() => statusSetzen('ACTIVE')}
              />
            ) : null}
            {host.status === 'ACTIVE' ? (
              <Knopf
                label="Leerlaufen lassen"
                schluessel="DRAINING"
                laeuft={laeuft}
                bei={() => statusSetzen('DRAINING')}
              />
            ) : null}
            {host.status !== 'MAINTENANCE' ? (
              <Knopf
                label="In Wartung"
                schluessel="MAINTENANCE"
                laeuft={laeuft}
                bei={() => statusSetzen('MAINTENANCE')}
              />
            ) : null}
            {host.status !== 'DISABLED' ? (
              <Knopf
                label="Abschalten"
                schluessel="DISABLED"
                laeuft={laeuft}
                bei={() => statusSetzen('DISABLED')}
              />
            ) : null}
            <Knopf
              label="Entfernen"
              schluessel="delete"
              laeuft={laeuft}
              bei={entfernen}
              variante="destructive"
            />
          </div>
        ) : null}
      </header>

      {/* --- Registrierung ------------------------------------------------ */}
      {darfVerwalten ? (
        <section className="rounded-lg border p-4" aria-label="Registrierung">
          <h2 className="font-medium">Registrierung</h2>
          {host.registriert ? (
            <p className="text-muted-foreground mt-1 text-sm">
              Dieser Host ist registriert. Eine erneute Registrierung ersetzt seine Identität - nötig nur,
              wenn die Maschine neu aufgesetzt wurde.
            </p>
          ) : (
            <p className="text-muted-foreground mt-1 text-sm">
              Dieser Host hat sich noch nie gemeldet. Erzeuge ein Registrierungs-Token und trage es auf der
              Maschine als <code>SWISSHUB_REGISTRATION_TOKEN</code> ein.
            </p>
          )}

          {host.registrierungOffenBis ? (
            <p className="mt-2 text-sm">
              Ein Token ist offen bis {new Date(host.registrierungOffenBis).toLocaleString('de-CH')}.
            </p>
          ) : null}

          {token ? (
            <div className="bg-muted mt-3 rounded-md p-3">
              <p className="text-sm font-medium">
                Einmalig sichtbar - danach steht in der Datenbank nur noch ein Hash.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate text-sm">{token.wert}</code>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard.writeText(token.wert);
                    toast.success('Kopiert.');
                  }}
                >
                  <Copy className="mr-1 h-3 w-3" aria-hidden />
                  Kopieren
                </Button>
              </div>
              <p className="text-muted-foreground mt-2 text-xs">
                Gültig bis {new Date(token.ablauf).toLocaleString('de-CH')}. Auf der Maschine:
              </p>
              <pre className="mt-1 overflow-x-auto text-xs">
                {`SWISSHUB_URL=${swisshubUrl}\nSWISSHUB_REGISTRATION_TOKEN=${token.wert}`}
              </pre>
            </div>
          ) : null}

          <Knopf
            label={host.registriert ? 'Neu registrieren' : 'Registrierungs-Token erzeugen'}
            schluessel="register"
            laeuft={laeuft}
            bei={registrierungOeffnen}
            klasse="mt-3"
          />
        </section>
      ) : null}

      {/* --- Ressourcen --------------------------------------------------- */}
      <section className="rounded-lg border p-4" aria-label="Ressourcen">
        <h2 className="font-medium">Ressourcen</h2>
        <dl className="mt-3 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <Wert label="Matches" wert={`${String(host.instanzen)} / ${String(host.maxInstanzen)}`} />
          <Wert label="CPU frei" wert={`${host.cpuFrei.toFixed(1)} von ${String(host.cpuCores)}`} />
          <Wert
            label="RAM frei"
            wert={`${String(Math.round(host.memoryFreiMb / 1024))} von ${String(Math.round(host.memoryMb / 1024))} GB`}
          />
          <Wert
            label="Disk frei"
            wert={host.diskFreeMb === null ? 'unbekannt' : `${String(Math.round(host.diskFreeMb / 1024))} GB`}
          />
          <Wert label="Agent" wert={host.agentVersion ?? 'unbekannt'} />
          <Wert
            label="Docker"
            wert={
              host.dockerVerfuegbar === null
                ? 'unbekannt'
                : host.dockerVerfuegbar
                  ? 'läuft'
                  : 'antwortet nicht'
            }
          />
          <Wert
            label="Letztes Lebenszeichen"
            wert={host.lastHeartbeatAt ? new Date(host.lastHeartbeatAt).toLocaleString('de-CH') : 'nie'}
          />
          <Wert label="Belegte Ports" wert={String(host.ports.gesamt)} />
        </dl>
        <p className="text-muted-foreground mt-3 text-xs">
          Portbereiche: Spiel {host.portBereiche.game} · Query {host.portBereiche.query} · GOTV{' '}
          {host.portBereiche.tv}
        </p>
        {host.lastError ? <p className="text-destructive mt-2 text-sm">{host.lastError}</p> : null}
      </section>

      {/* --- Abbilder ----------------------------------------------------- */}
      <section className="rounded-lg border p-4" aria-label="Abbilder">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">Runtime-Images</h2>
          {darfAbbilder ? (
            <div className="flex gap-2">
              <Knopf
                label="Abgleichen"
                schluessel="sync"
                laeuft={laeuft}
                bei={() => abbilderAbgleichen(false)}
              />
              <Knopf
                label="Fehlende laden"
                schluessel="pull"
                laeuft={laeuft}
                bei={() => abbilderAbgleichen(true)}
              />
            </div>
          ) : null}
        </div>

        {host.abbilder.length === 0 ? (
          <p className="text-muted-foreground mt-2 text-sm">Es ist kein Runtime-Image eingetragen.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {host.abbilder.map((abbild) => (
              <li key={abbild.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>
                  <span className="font-medium">{abbild.name}</span>{' '}
                  <span className="text-muted-foreground">{abbild.gewuenscht}</span>
                </span>
                {abbild.laedt ? (
                  <Badge variant="secondary">lädt</Badge>
                ) : abbild.aktuell ? (
                  <Badge>aktuell</Badge>
                ) : abbild.vorhanden ? (
                  <Badge variant="secondary">Update verfügbar ({abbild.vorhanden})</Badge>
                ) : (
                  <Badge variant="outline">nicht vorhanden</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* --- Laufende Instanzen ------------------------------------------- */}
      <section className="rounded-lg border p-4" aria-label="Match-Instanzen">
        <h2 className="font-medium">Match-Instanzen</h2>
        {host.instanzenDetail.length === 0 ? (
          <p className="text-muted-foreground mt-2 text-sm">Auf diesem Host läuft gerade nichts.</p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {host.instanzenDetail.map((instanz) => (
              <li key={instanz.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <span className="font-medium">{instanz.name}</span>
                  {instanz.matchNummer === null ? null : (
                    <span className="text-muted-foreground">
                      {' '}
                      · Match {instanz.matchNummer}
                      {instanz.turnier ? ` · ${instanz.turnier}` : ''}
                    </span>
                  )}
                </span>
                <span className="text-muted-foreground">
                  {instanz.status}
                  {instanz.gamePort === null ? '' : ` · Port ${String(instanz.gamePort)}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Knopf({
  label,
  schluessel,
  laeuft,
  bei,
  variante,
  klasse,
}: {
  label: string;
  schluessel: string;
  laeuft: string | null;
  bei: () => Promise<void>;
  variante?: 'destructive';
  klasse?: string;
}): React.JSX.Element {
  return (
    <Button
      type="button"
      size="sm"
      variant={variante ?? 'outline'}
      disabled={laeuft !== null}
      onClick={() => void bei()}
      className={klasse}
    >
      {laeuft === schluessel ? <Loader2 className="mr-2 h-3 w-3 animate-spin" aria-hidden /> : null}
      {label}
    </Button>
  );
}

function Wert({ label, wert }: { label: string; wert: string }): React.JSX.Element {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd>{wert}</dd>
    </div>
  );
}
