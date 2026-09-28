'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Server } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { hostSpeichernAction } from '@/modules/gameserver/actions';
import type { HostAnsicht } from '@/server/gameserver';

/**
 * Die Hostliste und das Formular für einen neuen Host.
 *
 * ## Was hier nicht steht
 *
 * Kein Agent-Token, kein Registrierungs-Token, kein RCON-Passwort. Dass ein
 * Host registriert ist, steht als Wort da - nicht als Geheimnis. Das
 * Registrierungs-Token gibt es genau einmal, auf der Detailseite, direkt
 * nachdem jemand es angefordert hat.
 */
export function HostVerwaltung({
  hosts,
  gruppen,
  darfVerwalten,
  csrfToken,
}: {
  hosts: HostAnsicht[];
  gruppen: Array<{ id: string; name: string }>;
  darfVerwalten: boolean;
  csrfToken: string;
}): React.JSX.Element {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState(false);
  const [formularOffen, setFormularOffen] = useState(false);

  async function anlegen(formular: FormData): Promise<void> {
    setLaeuft(true);
    const zahl = (feld: string, vorgabe: number): number => {
      const roh = Number.parseInt(String(formular.get(feld) ?? ''), 10);
      return Number.isFinite(roh) ? roh : vorgabe;
    };

    const antwort = await hostSpeichernAction({
      csrfToken,
      name: String(formular.get('name') ?? ''),
      description: String(formular.get('description') ?? '') || null,
      hostname: String(formular.get('hostname') ?? ''),
      agentPort: zahl('agentPort', 9443),
      region: String(formular.get('region') ?? '') || null,
      groupId: String(formular.get('groupId') ?? '') || null,
      // V1 unterstützt genau ein Spiel. Sobald ein zweiter Adapter dazukommt,
      // wird daraus eine Mehrfachauswahl - die Spalte kann das schon.
      allowedGames: ['CS2'],
      cpuCores: zahl('cpuCores', 0),
      memoryMb: zahl('memoryMb', 0),
      diskGb: zahl('diskGb', 0),
      reservedCpuCores: zahl('reservedCpuCores', 1),
      reservedMemoryMb: zahl('reservedMemoryMb', 2048),
      minFreeDiskGb: zahl('minFreeDiskGb', 10),
      maxInstances: zahl('maxInstances', 6),
      maxParallelStarts: zahl('maxParallelStarts', 2),
      gamePortFrom: zahl('gamePortFrom', 27015),
      gamePortTo: zahl('gamePortTo', 27199),
      queryPortFrom: zahl('queryPortFrom', 27200),
      queryPortTo: zahl('queryPortTo', 27399),
      tvPortFrom: zahl('tvPortFrom', 27400),
      tvPortTo: zahl('tvPortTo', 27599),
    });
    setLaeuft(false);

    if (!antwort.ok) {
      toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
      return;
    }
    toast.success('Host angelegt. Als Nächstes die Registrierung öffnen.');
    setFormularOffen(false);
    router.push(`/turniere/gameserver/hosts/${antwort.data.hostId}`);
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {hosts.map((host) => (
          <Link
            key={host.id}
            href={`/turniere/gameserver/hosts/${host.id}`}
            className="focus-visible:ring-ring block rounded-lg border p-4 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium">{host.name}</p>
                <p className="text-muted-foreground truncate text-sm">
                  {host.hostname}:{host.agentPort}
                </p>
              </div>
              <GesundheitsAbzeichen wert={host.gesundheit} />
            </div>

            <p className="text-muted-foreground mt-3 text-sm">{host.gesundheitGrund}</p>

            <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
              <div>
                <dt className="text-muted-foreground text-xs">Matches</dt>
                <dd>
                  {host.instanzen} / {host.maxInstanzen}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">CPU frei</dt>
                <dd>{host.cpuFrei.toFixed(1)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">RAM frei</dt>
                <dd>{Math.round(host.memoryFreiMb / 1024)} GB</dd>
              </div>
            </dl>

            {host.status !== 'ACTIVE' ? (
              <Badge variant="outline" className="mt-3">
                {statusText(host.status)}
              </Badge>
            ) : null}
          </Link>
        ))}
      </div>

      {hosts.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <Server className="text-muted-foreground mx-auto h-8 w-8" aria-hidden />
          <p className="mt-3 font-medium">Noch kein Gameserver-Host eingerichtet</p>
          <p className="text-muted-foreground mx-auto mt-1 max-w-prose text-sm">
            Ein Host ist eine vorbereitete Linux-Maschine mit Docker und dem SwissHub Game Agent. Auf ihr
            startet SwissHub pro Match einen eigenen Container. Turniere laufen auch ohne - sie bekommen dann
            einfach keinen automatischen Server.
          </p>
        </div>
      ) : null}

      {darfVerwalten ? (
        formularOffen ? (
          <form action={anlegen} className="space-y-4 rounded-lg border p-4" aria-label="Neuen Host anlegen">
            <div className="grid gap-4 sm:grid-cols-2">
              <Feld name="name" label="Name" vorgabe="SH-GAME-HOST-01" pflicht />
              <Feld name="hostname" label="Adresse oder IP" vorgabe="" pflicht />
              <Feld name="agentPort" label="Agent-Port" vorgabe="9443" />
              <Feld name="region" label="Region" vorgabe="" />
            </div>

            <div>
              <Label htmlFor="groupId">Hostgruppe</Label>
              <select
                id="groupId"
                name="groupId"
                className="border-input bg-background mt-1 h-9 w-full rounded-md border px-3 text-sm"
                defaultValue=""
              >
                <option value="">Keine</option>
                {gruppen.map((gruppe) => (
                  <option key={gruppe.id} value={gruppe.id}>
                    {gruppe.name}
                  </option>
                ))}
              </select>
            </div>

            <fieldset className="grid gap-4 sm:grid-cols-3">
              <legend className="text-sm font-medium">Kapazität</legend>
              <Feld name="cpuCores" label="CPU-Kerne" vorgabe="8" />
              <Feld name="memoryMb" label="RAM in MB" vorgabe="32768" />
              <Feld name="diskGb" label="Disk in GB" vorgabe="200" />
              <Feld name="reservedCpuCores" label="Reserve CPU" vorgabe="1" />
              <Feld name="reservedMemoryMb" label="Reserve RAM (MB)" vorgabe="4096" />
              <Feld name="minFreeDiskGb" label="Min. freie Disk (GB)" vorgabe="20" />
              <Feld name="maxInstances" label="Max. Matches" vorgabe="6" />
              <Feld name="maxParallelStarts" label="Max. parallele Starts" vorgabe="2" />
            </fieldset>

            <fieldset className="grid gap-4 sm:grid-cols-3">
              <legend className="text-sm font-medium">
                Portbereiche
                <span className="text-muted-foreground ml-2 font-normal">
                  dürfen sich nicht überschneiden
                </span>
              </legend>
              <Feld name="gamePortFrom" label="Spielports von" vorgabe="27015" />
              <Feld name="gamePortTo" label="bis" vorgabe="27199" />
              <span className="hidden sm:block" />
              <Feld name="queryPortFrom" label="Query von" vorgabe="27200" />
              <Feld name="queryPortTo" label="bis" vorgabe="27399" />
              <span className="hidden sm:block" />
              <Feld name="tvPortFrom" label="GOTV von" vorgabe="27400" />
              <Feld name="tvPortTo" label="bis" vorgabe="27599" />
            </fieldset>

            <div className="flex gap-2">
              <Button type="submit" disabled={laeuft}>
                {laeuft ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
                Host anlegen
              </Button>
              <Button type="button" variant="ghost" onClick={() => setFormularOffen(false)}>
                Abbrechen
              </Button>
            </div>
          </form>
        ) : (
          <Button onClick={() => setFormularOffen(true)}>Host anlegen</Button>
        )
      ) : null}
    </div>
  );
}

function Feld({
  name,
  label,
  vorgabe,
  pflicht = false,
}: {
  name: string;
  label: string;
  vorgabe: string;
  pflicht?: boolean;
}): React.JSX.Element {
  return (
    <div>
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} defaultValue={vorgabe} required={pflicht} className="mt-1" />
    </div>
  );
}

/**
 * Die Gesundheit als Abzeichen.
 *
 * «Unbekannt» gibt es hier nicht: die Gesundheit wird aus dem letzten
 * Lebenszeichen abgeleitet, und ein fehlendes Lebenszeichen ist eine
 * Aussage - nämlich OFFLINE.
 */
export function GesundheitsAbzeichen({ wert }: { wert: string }): React.JSX.Element {
  const variante =
    wert === 'HEALTHY'
      ? 'default'
      : wert === 'DEGRADED' || wert === 'MAINTENANCE'
        ? 'secondary'
        : 'destructive';

  const text: Record<string, string> = {
    HEALTHY: 'Bereit',
    DEGRADED: 'Beeinträchtigt',
    OFFLINE: 'Offline',
    MAINTENANCE: 'Wartung',
    DISABLED: 'Abgeschaltet',
    UNREGISTERED: 'Nicht registriert',
  };

  return <Badge variant={variante}>{text[wert] ?? wert}</Badge>;
}

export function statusText(status: string): string {
  const texte: Record<string, string> = {
    ACTIVE: 'Nimmt Matches an',
    DRAINING: 'Läuft leer',
    MAINTENANCE: 'In Wartung',
    DISABLED: 'Abgeschaltet',
  };
  return texte[status] ?? status;
}
