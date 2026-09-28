'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { templateSpeichernAction } from '@/modules/gameserver/actions';

export interface TemplateZeile {
  id: string;
  name: string;
  providerName: string;
  game: string;
  imageRef: string;
  cpuCores: number;
  memoryMb: number;
  diskGb: number;
  maxRuntimeMinutes: number;
  cleanupDelayMinutes: number;
  enabled: boolean;
}

/**
 * Server-Templates.
 *
 * `imageRef` ist die Kennung der Vorlage beim Anbieter - für SwissHub eine
 * undurchsichtige Zeichenkette. Was darin steckt (CS2, Match-Plugin,
 * Agent), entscheidet, wer das Abbild gebaut hat; das ist der einmalige
 * manuelle Schritt, der in `docs/GAMESERVER.md` steht.
 */
export function TemplateVerwaltung({
  templates,
  anbieter,
  csrfToken,
}: {
  templates: TemplateZeile[];
  anbieter: Array<{ id: string; name: string }>;
  csrfToken: string;
}): React.JSX.Element {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState(false);
  const [providerId, setProviderId] = useState(anbieter[0]?.id ?? '');

  async function speichern(formular: FormData): Promise<void> {
    setLaeuft(true);
    const zahl = (name: string, vorgabe: number) => Number(formular.get(name) ?? vorgabe);
    const antwort = await templateSpeichernAction({
      csrfToken,
      providerId,
      name: String(formular.get('name') ?? ''),
      game: 'CS2',
      imageRef: String(formular.get('imageRef') ?? ''),
      region: String(formular.get('region') ?? '') || null,
      cpuCores: zahl('cpuCores', 4),
      memoryMb: zahl('memoryMb', 8192),
      diskGb: zahl('diskGb', 40),
      agentPort: zahl('agentPort', 9443),
      maxRuntimeMinutes: zahl('maxRuntimeMinutes', 240),
      cleanupDelayMinutes: zahl('cleanupDelayMinutes', 15),
      enabled: true,
    });
    setLaeuft(false);
    if (!antwort.ok) {
      toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
      return;
    }
    toast.success('Template gespeichert.');
    router.refresh();
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Vorhandene Templates</h2>
        {templates.length === 0 ? (
          <p className="text-sm text-muted-foreground">Noch kein Template.</p>
        ) : (
          <ul className="space-y-2">
            {templates.map((eintrag) => (
              <li key={eintrag.id} className="rounded-lg border border-border bg-card p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{eintrag.name}</span>
                  <Badge variant={eintrag.enabled ? 'success' : 'outline'}>
                    {eintrag.enabled ? 'aktiv' : 'aus'}
                  </Badge>
                  <Badge variant="secondary">{eintrag.game}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {eintrag.providerName} · Abbild {eintrag.imageRef} · {eintrag.cpuCores} Kerne ·{' '}
                  {eintrag.memoryMb} MB · {eintrag.diskGb} GB · höchstens {eintrag.maxRuntimeMinutes} Min. ·
                  Schonfrist {eintrag.cleanupDelayMinutes} Min.
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Neues Template</h2>
        <form
          action={(formular) => void speichern(formular)}
          className="space-y-4 rounded-xl border border-border p-4"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="tpl-name">Name</Label>
              <Input id="tpl-name" name="name" required maxLength={80} placeholder="CS2 Turnier" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tpl-provider">Anbieter</Label>
              <select
                id="tpl-provider"
                className="h-11 w-full rounded-md border border-border bg-background px-3 text-sm"
                value={providerId}
                onChange={(ereignis) => setProviderId(ereignis.target.value)}
              >
                {anbieter.map((eintrag) => (
                  <option key={eintrag.id} value={eintrag.id}>
                    {eintrag.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tpl-image">Kennung der Vorlage beim Anbieter</Label>
            <Input id="tpl-image" name="imageRef" required maxLength={200} />
            <p className="text-xs text-muted-foreground">
              Das Abbild, in dem CS2, das Match-Plugin und der SwissHub-Agent bereits installiert sind. Wie es
              entsteht, steht in der Einrichtungsanleitung.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Feld id="tpl-cpu" name="cpuCores" label="CPU-Kerne" vorgabe={4} min={1} max={64} />
            <Feld id="tpl-mem" name="memoryMb" label="RAM (MB)" vorgabe={8192} min={512} max={262144} />
            <Feld id="tpl-disk" name="diskGb" label="Disk (GB)" vorgabe={40} min={10} max={2000} />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Feld id="tpl-agent" name="agentPort" label="Agent-Port" vorgabe={9443} min={1} max={65535} />
            <Feld
              id="tpl-runtime"
              name="maxRuntimeMinutes"
              label="Max. Laufzeit (Min.)"
              vorgabe={240}
              min={15}
              max={1440}
            />
            <Feld
              id="tpl-cleanup"
              name="cleanupDelayMinutes"
              label="Schonfrist (Min.)"
              vorgabe={15}
              min={0}
              max={1440}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tpl-region">Region (freiwillig)</Label>
            <Input id="tpl-region" name="region" maxLength={60} />
          </div>

          <Button type="submit" disabled={laeuft || !providerId}>
            {laeuft ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            Template speichern
          </Button>
        </form>
      </section>
    </div>
  );
}

function Feld({
  id,
  name,
  label,
  vorgabe,
  min,
  max,
}: {
  id: string;
  name: string;
  label: string;
  vorgabe: number;
  min: number;
  max: number;
}): React.JSX.Element {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={name} type="number" min={min} max={max} defaultValue={vorgabe} />
    </div>
  );
}
