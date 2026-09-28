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
import { profilSpeichernAction } from '@/modules/gameserver/actions';

export interface ProfilZeile {
  id: string;
  name: string;
  game: string;
  templateName: string | null;
  mapPool: string[];
  slots: number;
  overtime: boolean;
  knifeRound: boolean;
  gotvEnabled: boolean;
  demoRecording: boolean;
  readyRule: string;
  enabled: boolean;
}

export function ProfilVerwaltung({
  profile,
  templates,
  csrfToken,
}: {
  profile: ProfilZeile[];
  templates: Array<{ id: string; name: string }>;
  csrfToken: string;
}): React.JSX.Element {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState(false);
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '');
  const [readyRule, setReadyRule] = useState('CAPTAIN');
  const [schalter, setSchalter] = useState({
    overtime: true,
    knifeRound: true,
    gotvEnabled: true,
    demoRecording: true,
    restoreSupport: true,
  });

  async function speichern(formular: FormData): Promise<void> {
    setLaeuft(true);
    /*
     * Der Map-Pool als Zeilen, nicht als kommagetrennte Liste: Mapnamen
     * enthalten keine Kommas, aber Menschen tippen welche - und eine Liste
     * mit einem leeren Eintrag scheitert erst beim Veto.
     */
    const mapPool = String(formular.get('mapPool') ?? '')
      .split(/[\n,]/u)
      .map((zeile) => zeile.trim())
      .filter(Boolean);

    const antwort = await profilSpeichernAction({
      csrfToken,
      name: String(formular.get('name') ?? ''),
      game: 'CS2',
      templateId: templateId || null,
      region: String(formular.get('region') ?? '') || null,
      mapPool,
      slots: Number(formular.get('slots') ?? 12),
      tacticalPauses: Number(formular.get('tacticalPauses') ?? 4),
      technicalPauses: Number(formular.get('technicalPauses') ?? 2),
      warmupSeconds: Number(formular.get('warmupSeconds') ?? 300),
      readyRule: readyRule as 'CAPTAIN' | 'ALL',
      passwordStrategy: 'RANDOM',
      fixedPassword: null,
      enabled: true,
      ...schalter,
    });
    setLaeuft(false);

    if (!antwort.ok) {
      toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
      return;
    }
    toast.success('Game Profile gespeichert.');
    router.refresh();
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Vorhandene Profile</h2>
        {profile.length === 0 ? (
          <p className="text-sm text-muted-foreground">Noch kein Profil.</p>
        ) : (
          <ul className="space-y-2">
            {profile.map((eintrag) => (
              <li key={eintrag.id} className="rounded-lg border border-border bg-card p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{eintrag.name}</span>
                  <Badge variant={eintrag.enabled ? 'success' : 'outline'}>
                    {eintrag.enabled ? 'aktiv' : 'aus'}
                  </Badge>
                  <Badge variant="secondary">{eintrag.game}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {eintrag.templateName ?? 'ohne Template'} · {eintrag.mapPool.length} Maps · {eintrag.slots}{' '}
                  Slots · Ready: {eintrag.readyRule === 'ALL' ? 'alle Spieler' : 'Captain'}
                  {eintrag.overtime ? ' · Overtime' : ''}
                  {eintrag.knifeRound ? ' · Knife' : ''}
                  {eintrag.gotvEnabled ? ' · GOTV' : ''}
                  {eintrag.demoRecording ? ' · Demos' : ''}
                </p>
                {eintrag.mapPool.length > 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground">{eintrag.mapPool.join(', ')}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Neues Profil</h2>
        <form
          action={(formular) => void speichern(formular)}
          className="space-y-4 rounded-xl border border-border p-4"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="gp-name">Name</Label>
              <Input
                id="gp-name"
                name="name"
                required
                maxLength={80}
                placeholder="CS2 – SwissHub Competitive"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gp-template">Server-Template</Label>
              <select
                id="gp-template"
                className="h-11 w-full rounded-md border border-border bg-background px-3 text-sm"
                value={templateId}
                onChange={(ereignis) => setTemplateId(ereignis.target.value)}
              >
                <option value="">— keines —</option>
                {templates.map((eintrag) => (
                  <option key={eintrag.id} value={eintrag.id}>
                    {eintrag.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="gp-maps">Map-Pool</Label>
            <textarea
              id="gp-maps"
              name="mapPool"
              rows={7}
              className="w-full rounded-md border border-border bg-background p-3 text-sm"
              placeholder={'de_mirage\nde_inferno\nde_nuke\nde_ancient\nde_anubis\nde_dust2\nde_vertigo'}
            />
            <p className="text-xs text-muted-foreground">
              Eine Map je Zeile. Für ein vollständiges Veto braucht es mindestens sieben - das prüft der
              Server beim Speichern, nicht erst mitten im Veto.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-4">
            <Zahl id="gp-slots" name="slots" label="Slots" vorgabe={12} min={2} max={64} />
            <Zahl id="gp-tac" name="tacticalPauses" label="Taktische Pausen" vorgabe={4} min={0} max={20} />
            <Zahl
              id="gp-tech"
              name="technicalPauses"
              label="Technische Pausen"
              vorgabe={2}
              min={0}
              max={20}
            />
            <Zahl id="gp-warm" name="warmupSeconds" label="Warmup (Sek.)" vorgabe={300} min={0} max={3600} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="gp-ready">Ready-Regel</Label>
            <select
              id="gp-ready"
              className="h-11 w-full rounded-md border border-border bg-background px-3 text-sm sm:w-72"
              value={readyRule}
              onChange={(ereignis) => setReadyRule(ereignis.target.value)}
            >
              <option value="CAPTAIN">Nur der Captain meldet bereit</option>
              <option value="ALL">Alle Spieler melden bereit</option>
            </select>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ['overtime', 'Overtime'],
                ['knifeRound', 'Knife Round'],
                ['gotvEnabled', 'GOTV'],
                ['demoRecording', 'Demos aufzeichnen'],
                ['restoreSupport', 'Wiederherstellung erlauben'],
              ] as const
            ).map(([schluessel, beschriftung]) => (
              <div key={schluessel} className="flex items-center gap-3">
                <Switch
                  id={`gp-${schluessel}`}
                  checked={schalter[schluessel]}
                  onCheckedChange={(wert) => setSchalter((alt) => ({ ...alt, [schluessel]: wert }))}
                />
                <Label htmlFor={`gp-${schluessel}`}>{beschriftung}</Label>
              </div>
            ))}
          </div>

          <Button type="submit" disabled={laeuft}>
            {laeuft ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            Profil speichern
          </Button>
        </form>
      </section>
    </div>
  );
}

function Zahl({
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
