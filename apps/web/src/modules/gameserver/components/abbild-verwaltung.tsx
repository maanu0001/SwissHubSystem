'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { abbildSpeichernAction } from '@/modules/gameserver/actions';
import type { AbbildAnsicht } from '@/server/gameserver';

/**
 * Die Container-Abbilder, aus denen Match-Instanzen entstehen.
 *
 * ## Warum hier jedes Feld einzeln steht
 *
 * Weil es kein Feld für «zusätzliche Docker-Argumente» geben soll. Ein
 * solches Feld wäre die Docker-CLI im Browser, nur mit mehr Schritten:
 * `--privileged`, `--network host` oder `-v /:/host` wären dann eine
 * Eingabe entfernt. Was ein Container bekommt, steht deshalb in geprüften
 * Spalten - Abbild, Tag, Startargumente, Ports, Mountpfade.
 *
 * Das Startkommando ist eine **Liste** von Argumenten und keine Zeile. Eine
 * Zeile müsste jemand zerlegen, und wer zerlegt, interpretiert.
 */
export function AbbildVerwaltung({
  abbilder,
  csrfToken,
}: {
  abbilder: AbbildAnsicht[];
  csrfToken: string;
}): React.JSX.Element {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState(false);
  const [aktiv, setAktiv] = useState(true);
  const [bearbeitet, setBearbeitet] = useState<AbbildAnsicht | null>(null);
  const [offen, setOffen] = useState(false);

  async function speichern(formular: FormData): Promise<void> {
    setLaeuft(true);

    const text = (feld: string): string => String(formular.get(feld) ?? '').trim();
    const zahl = (feld: string, vorgabe: number): number => {
      const roh = Number.parseInt(text(feld), 10);
      return Number.isFinite(roh) ? roh : vorgabe;
    };
    const optionaleZahl = (feld: string): number | null => {
      const roh = text(feld);
      if (roh === '') {
        return null;
      }
      const wert = Number.parseInt(roh, 10);
      return Number.isFinite(wert) ? wert : null;
    };

    const antwort = await abbildSpeichernAction({
      csrfToken,
      id: bearbeitet?.id ?? null,
      name: text('name'),
      game: 'CS2',
      image: text('image'),
      tag: text('tag'),
      // Zeilenweise eingegeben, als Liste gespeichert. Leerzeilen fallen
      // weg - ein leeres Argument wäre auf der Kommandozeile ein Argument.
      command: text('command')
        .split('\n')
        .map((zeile) => zeile.trim())
        .filter((zeile) => zeile.length > 0),
      dataMountPath: text('dataMountPath') || '/swisshub/data',
      configMountPath: text('configMountPath') || '/swisshub/config',
      gamePortInContainer: zahl('gamePortInContainer', 27015),
      queryPortInContainer: optionaleZahl('queryPortInContainer'),
      tvPortInContainer: optionaleZahl('tvPortInContainer'),
      healthTimeoutSeconds: zahl('healthTimeoutSeconds', 120),
      enabled: aktiv,
    });

    setLaeuft(false);
    if (!antwort.ok) {
      toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
      return;
    }
    toast.success('Runtime-Image gespeichert.');
    setOffen(false);
    setBearbeitet(null);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <ul className="space-y-3">
        {abbilder.map((abbild) => (
          <li key={abbild.id} className="rounded-lg border p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-medium">
                  {abbild.name}
                  {abbild.enabled ? null : (
                    <Badge variant="outline" className="ml-2">
                      aus
                    </Badge>
                  )}
                </p>
                <p className="text-muted-foreground text-sm">
                  {abbild.image}:{abbild.tag} · {abbild.game}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={abbild.hostsAktuell === abbild.hostsGesamt ? 'default' : 'secondary'}>
                  {abbild.hostsAktuell} / {abbild.hostsGesamt} Hosts aktuell
                </Badge>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setBearbeitet(abbild);
                    setAktiv(abbild.enabled);
                    setOffen(true);
                  }}
                >
                  Bearbeiten
                </Button>
              </div>
            </div>

            <dl className="text-muted-foreground mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <div>
                <dt>Spielport im Container</dt>
                <dd>{abbild.gamePortInContainer}</dd>
              </div>
              <div>
                <dt>Query</dt>
                <dd>{abbild.queryPortInContainer ?? '—'}</dd>
              </div>
              <div>
                <dt>GOTV</dt>
                <dd>{abbild.tvPortInContainer ?? '—'}</dd>
              </div>
              <div>
                <dt>Game Profiles</dt>
                <dd>{abbild.profileAnzahl}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>

      {offen ? (
        <form action={speichern} className="space-y-4 rounded-lg border p-4" aria-label="Runtime-Image">
          <div className="grid gap-4 sm:grid-cols-2">
            <Feld name="name" label="Name" vorgabe={bearbeitet?.name ?? 'CS2 Stable'} pflicht />
            <Feld name="image" label="Abbild ohne Tag" vorgabe={bearbeitet?.image ?? ''} pflicht />
            <Feld name="tag" label="Tag" vorgabe={bearbeitet?.tag ?? 'latest'} pflicht />
            <Feld
              name="healthTimeoutSeconds"
              label="Startzeit bis «bereit» (s)"
              vorgabe={String(bearbeitet?.healthTimeoutSeconds ?? 120)}
            />
          </div>

          <div>
            <Label htmlFor="command">Startargumente, eines je Zeile</Label>
            <textarea
              id="command"
              name="command"
              rows={4}
              defaultValue={(bearbeitet?.command ?? []).join('\n')}
              className="border-input bg-background mt-1 w-full rounded-md border px-3 py-2 font-mono text-sm"
            />
            <p className="text-muted-foreground mt-1 text-xs">
              Leer lassen heisst: das Startkommando des Abbilds. Es gibt bewusst kein Feld für freie
              Docker-Argumente.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Feld
              name="dataMountPath"
              label="Datenverzeichnis im Container"
              vorgabe={bearbeitet?.dataMountPath ?? '/swisshub/data'}
            />
            <Feld
              name="configMountPath"
              label="Konfigurationsverzeichnis im Container"
              vorgabe={bearbeitet?.configMountPath ?? '/swisshub/config'}
            />
            <Feld
              name="gamePortInContainer"
              label="Spielport im Container"
              vorgabe={String(bearbeitet?.gamePortInContainer ?? 27015)}
            />
            <Feld
              name="queryPortInContainer"
              label="Query-Port im Container (leer = keiner)"
              vorgabe={
                bearbeitet?.queryPortInContainer === null || bearbeitet?.queryPortInContainer === undefined
                  ? ''
                  : String(bearbeitet.queryPortInContainer)
              }
            />
            <Feld
              name="tvPortInContainer"
              label="GOTV-Port im Container (leer = keiner)"
              vorgabe={
                bearbeitet?.tvPortInContainer === null || bearbeitet?.tvPortInContainer === undefined
                  ? ''
                  : String(bearbeitet.tvPortInContainer)
              }
            />
          </div>

          <div className="flex items-center gap-2">
            <Switch id="enabled" checked={aktiv} onCheckedChange={setAktiv} />
            <Label htmlFor="enabled">Aktiv</Label>
          </div>

          <div className="flex gap-2">
            <Button type="submit" disabled={laeuft}>
              {laeuft ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
              Speichern
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setOffen(false);
                setBearbeitet(null);
              }}
            >
              Abbrechen
            </Button>
          </div>
        </form>
      ) : (
        <Button
          onClick={() => {
            setBearbeitet(null);
            setAktiv(true);
            setOffen(true);
          }}
        >
          Runtime-Image eintragen
        </Button>
      )}
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
