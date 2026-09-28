'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import type { gameserver } from '@swisshub/modules';
import { formatDateTime } from '@swisshub/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import {
  serverFreigebenAction,
  serverHaltenAction,
  serverLoeschenAction,
} from '@/modules/gameserver/actions';

/**
 * Die Liste der laufenden Maschinen.
 *
 * ## Was hier bewusst nicht steht
 *
 * Kein RCON-Passwort, kein Agent-Token. Die Daten kommen als
 * `ServerAnsicht`, und dieser Typ enthält keines von beidem - nicht
 * maskiert, sondern gar nicht. Wer eine Konsole braucht, braucht SSH, und
 * SSH gehört nicht in einen Browser.
 */
export function ServerListe({
  server,
  csrfToken,
  darfHalten,
  darfLoeschen,
}: {
  server: gameserver.ServerAnsicht[];
  csrfToken: string;
  darfHalten: boolean;
  darfLoeschen: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const [zuLoeschen, setZuLoeschen] = useState<gameserver.ServerAnsicht | null>(null);

  async function fuehreAus(
    id: string,
    aktion: () => Promise<{ ok: boolean; error?: { message: string } }>,
    erfolg: string,
  ) {
    setLaeuft(id);
    const antwort = await aktion();
    setLaeuft(null);
    setZuLoeschen(null);
    if (!antwort.ok) {
      toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
      return;
    }
    toast.success(erfolg);
    router.refresh();
  }

  return (
    <>
      <ul className="space-y-3">
        {server.map((eintrag) => (
          <li key={eintrag.id} className="rounded-xl border border-border bg-card p-4">
            <header className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{eintrag.name}</span>
                  <Badge variant={farbe(eintrag.status)}>{statusText(eintrag.status)}</Badge>
                  {eintrag.heldByDiscordId ? <Badge variant="warning">Wird behalten</Badge> : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  {eintrag.providerName} · {eintrag.game}
                  {eintrag.region ? ` · ${eintrag.region}` : ''}
                  {eintrag.tournamentName ? ` · ${eintrag.tournamentName}` : ''}
                  {eintrag.matchNumber === null ? '' : ` · Match ${eintrag.matchNumber}`}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {darfHalten ? (
                  eintrag.heldByDiscordId ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={laeuft !== null}
                      onClick={() =>
                        void fuehreAus(
                          eintrag.id,
                          () => serverFreigebenAction({ csrfToken, instanceId: eintrag.id }),
                          'Server freigegeben - er wird wieder aufgeräumt.',
                        )
                      }
                    >
                      {laeuft === eintrag.id ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      ) : null}
                      Freigeben
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={laeuft !== null}
                      onClick={() =>
                        void fuehreAus(
                          eintrag.id,
                          () => serverHaltenAction({ csrfToken, instanceId: eintrag.id, grund: null }),
                          'Server bleibt stehen.',
                        )
                      }
                    >
                      Behalten
                    </Button>
                  )
                ) : null}

                {darfLoeschen ? (
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={laeuft !== null}
                    onClick={() => setZuLoeschen(eintrag)}
                  >
                    Löschen
                  </Button>
                ) : null}
              </div>
            </header>

            <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-3">
              <Wert name="Adresse" wert={adresse(eintrag)} />
              <Wert name="Kennung beim Anbieter" wert={eintrag.providerRef ?? 'noch keine'} />
              <Wert name="Map" wert={eintrag.currentMap ?? 'unbekannt'} />
              <Wert
                name="Spieler"
                wert={eintrag.playerCount === null ? 'unbekannt' : String(eintrag.playerCount)}
              />
              <Wert
                name="CPU"
                wert={eintrag.cpuPercent === null ? 'unbekannt' : `${Math.round(eintrag.cpuPercent)} %`}
              />
              <Wert
                name="Arbeitsspeicher"
                wert={eintrag.memoryMb === null ? 'unbekannt' : `${eintrag.memoryMb} MB`}
              />
              <Wert
                name="Freier Speicher"
                wert={eintrag.diskFreeMb === null ? 'unbekannt' : `${eintrag.diskFreeMb} MB`}
              />
              <Wert
                name="Laufzeit"
                wert={eintrag.laufzeitMinuten === null ? 'unbekannt' : `${eintrag.laufzeitMinuten} Min.`}
              />
              <Wert
                name="Letztes Lebenszeichen"
                wert={eintrag.lastHeartbeatAt ? formatDateTime(eintrag.lastHeartbeatAt) : 'noch keines'}
              />
            </dl>

            {eintrag.lastError ? (
              <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                {eintrag.lastError}
              </p>
            ) : null}
          </li>
        ))}
      </ul>

      <ConfirmationDialog
        open={zuLoeschen !== null}
        onOpenChange={(offen) => !offen && setZuLoeschen(null)}
        title="Server jetzt löschen?"
        description={
          zuLoeschen
            ? `«${zuLoeschen.name}» wird beim Anbieter entfernt - auch dann, wenn Demos und Logs noch nicht gesichert sind. Das lässt sich nicht zurücknehmen.`
            : ''
        }
        confirmLabel="Löschen"
        destructive
        onConfirm={() =>
          zuLoeschen
            ? void fuehreAus(
                zuLoeschen.id,
                () => serverLoeschenAction({ csrfToken, instanceId: zuLoeschen.id }),
                'Server gelöscht.',
              )
            : undefined
        }
      />
    </>
  );
}

function adresse(eintrag: gameserver.ServerAnsicht): string {
  if (!eintrag.publicHost) {
    return 'noch keine';
  }
  return eintrag.gamePort ? `${eintrag.publicHost}:${String(eintrag.gamePort)}` : eintrag.publicHost;
}

function Wert({ name, wert }: { name: string; wert: string }): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-muted-foreground">{name}</dt>
      <dd className="truncate font-medium">{wert}</dd>
    </div>
  );
}

function statusText(status: string): string {
  switch (status) {
    case 'PENDING':
      return 'Angelegt';
    case 'PROVISIONING':
      return 'Wird erstellt';
    case 'BOOTING':
      return 'Startet';
    case 'AGENT_READY':
      return 'Agent bereit';
    case 'RUNNING':
      return 'Läuft';
    case 'STOPPING':
      return 'Wird abgebaut';
    case 'FAILED':
      return 'Fehler';
    default:
      return status;
  }
}

function farbe(status: string): 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline' {
  switch (status) {
    case 'RUNNING':
    case 'AGENT_READY':
      return 'success';
    case 'FAILED':
      return 'destructive';
    case 'PROVISIONING':
    case 'BOOTING':
      return 'warning';
    default:
      return 'outline';
  }
}
