'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import { vorlageAusmusternAction, vorlageSpeichernAction } from '@/modules/missions/actions';
import type { TypAuswahl } from './missions-formular';

export interface VorlagenZeile {
  id: string;
  name: string;
  art: string;
  typ: string;
  typLabel: string;
  titel: string;
  ziel: number;
  einheit: string;
  belohnungXp: number;
  belohnungPremiumTage: number;
  aktiv: boolean;
}

/**
 * Vorlagen anlegen und ausmustern.
 *
 * ## Warum Vorlagen ueberhaupt
 *
 * Weil dieselbe Mission jede Woche wiederkommt. Ohne Vorlage hiesse
 * «Wochenmission starten» jedes Mal: acht Felder ausfuellen, zwei Termine
 * setzen, hoffen, dass die Belohnung dieselbe ist wie letzte Woche. Mit
 * Vorlage ist es ein Klick, und die Belohnung ist garantiert dieselbe.
 *
 * ## Ausmustern statt loeschen
 *
 * Eine geloeschte Vorlage naehme den Missionen, die aus ihr entstanden sind,
 * die Herkunft. Ausgemusterte verschwinden aus der Auswahl und bleiben in
 * der Liste - sichtbar als das, was sie sind.
 */
export function VorlagenVerwaltung({
  vorlagen,
  typen,
  csrfToken,
}: {
  vorlagen: VorlagenZeile[];
  typen: TypAuswahl[];
  csrfToken: string;
}): React.JSX.Element {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const [auszumustern, setAuszumustern] = useState<VorlagenZeile | null>(null);
  const [art, setArt] = useState<'WOCHE' | 'CHALLENGE'>('WOCHE');
  const [typKey, setTypKey] = useState(typen[0]?.key ?? '');

  const gewaehlt = typen.find((typ) => typ.key === typKey) ?? typen[0];
  const verfuegbar = art === 'CHALLENGE' ? typen.filter((typ) => typ.summierbar) : typen;

  async function speichern(formular: FormData): Promise<void> {
    setLaeuft('speichern');
    const antwort = await vorlageSpeichernAction({
      csrfToken,
      name: String(formular.get('name') ?? ''),
      art,
      typ: typKey,
      titel: String(formular.get('titel') ?? ''),
      beschreibung: String(formular.get('beschreibung') ?? '') || null,
      ziel: Number(formular.get('ziel') ?? 0),
      mindestBeitrag: Number(formular.get('mindestBeitrag') ?? 1),
      belohnungXp: Number(formular.get('belohnungXp') ?? 0),
      belohnungPremiumTage: Number(formular.get('belohnungPremiumTage') ?? 0),
      belohnungAuszeichnung: String(formular.get('belohnungAuszeichnung') ?? '') || null,
    });
    setLaeuft(null);
    if (!antwort.ok) {
      toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
      return;
    }
    toast.success('Vorlage gespeichert.');
    router.refresh();
  }

  async function ausmustern(): Promise<void> {
    if (!auszumustern) {
      return;
    }
    setLaeuft(auszumustern.id);
    const antwort = await vorlageAusmusternAction({ csrfToken, vorlageId: auszumustern.id });
    setLaeuft(null);
    setAuszumustern(null);
    if (!antwort.ok) {
      toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
      return;
    }
    toast.success('Vorlage ausgemustert.');
    router.refresh();
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Vorhandene Vorlagen</h2>
        {vorlagen.length === 0 ? (
          <p className="text-sm text-muted-foreground">Noch keine Vorlage.</p>
        ) : (
          <ul className="space-y-2">
            {vorlagen.map((vorlage) => (
              <li
                key={vorlage.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{vorlage.name}</span>
                    {vorlage.aktiv ? null : <Badge variant="outline">Ausgemustert</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {vorlage.art === 'CHALLENGE' ? 'Community Challenge' : 'Wochenmission'} ·{' '}
                    {vorlage.typLabel} · Ziel {vorlage.ziel} {vorlage.einheit}
                    {vorlage.belohnungXp > 0 ? ` · ${vorlage.belohnungXp} XP` : ''}
                    {vorlage.belohnungPremiumTage > 0
                      ? ` · ${vorlage.belohnungPremiumTage} Tage Premium`
                      : ''}
                  </p>
                </div>
                {vorlage.aktiv ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={laeuft !== null}
                    onClick={() => setAuszumustern(vorlage)}
                  >
                    Ausmustern
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Neue Vorlage</h2>
        <form
          action={(formular) => void speichern(formular)}
          className="space-y-4 rounded-xl border border-border p-4"
        >
          <div className="space-y-2">
            <Label htmlFor="vorlage-name">Name der Vorlage</Label>
            <Input id="vorlage-name" name="name" required maxLength={80} placeholder="Voice-Woche" />
            <p className="text-xs text-muted-foreground">
              Nur für euch im Team - die Community sieht den Titel darunter.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="vorlage-art">Art</Label>
              <select
                id="vorlage-art"
                className="h-11 w-full rounded-md border border-border bg-background px-3 text-sm"
                value={art}
                onChange={(ereignis) => {
                  const neu = ereignis.target.value as 'WOCHE' | 'CHALLENGE';
                  setArt(neu);
                  if (neu === 'CHALLENGE' && !typen.find((typ) => typ.key === typKey)?.summierbar) {
                    setTypKey(typen.find((typ) => typ.summierbar)?.key ?? '');
                  }
                }}
              >
                <option value="WOCHE">Wochenmission</option>
                <option value="CHALLENGE">Community Challenge</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="vorlage-typ">Was gemessen wird</Label>
              <select
                id="vorlage-typ"
                className="h-11 w-full rounded-md border border-border bg-background px-3 text-sm"
                value={typKey}
                onChange={(ereignis) => setTypKey(ereignis.target.value)}
              >
                {verfuegbar.map((typ) => (
                  <option key={typ.key} value={typ.key}>
                    {typ.label}
                  </option>
                ))}
              </select>
              {gewaehlt ? <p className="text-xs text-muted-foreground">{gewaehlt.erklaerung}</p> : null}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="vorlage-titel">Titel, den die Community sieht</Label>
            <Input id="vorlage-titel" name="titel" required maxLength={120} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="vorlage-beschreibung">Beschreibung (freiwillig)</Label>
            <Input id="vorlage-beschreibung" name="beschreibung" maxLength={500} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="vorlage-ziel">Ziel ({gewaehlt?.einheit})</Label>
              <Input
                id="vorlage-ziel"
                name="ziel"
                type="number"
                min={1}
                required
                defaultValue={gewaehlt?.zielVorschlag ?? 1}
              />
            </div>
            {art === 'CHALLENGE' ? (
              <div className="space-y-2">
                <Label htmlFor="vorlage-mindest">Mindestbeitrag je Mitglied</Label>
                <Input id="vorlage-mindest" name="mindestBeitrag" type="number" min={1} defaultValue={1} />
              </div>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="vorlage-xp">XP</Label>
              <Input id="vorlage-xp" name="belohnungXp" type="number" min={0} max={10000} defaultValue={0} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vorlage-premium">Tage Premium</Label>
              <Input
                id="vorlage-premium"
                name="belohnungPremiumTage"
                type="number"
                min={0}
                max={90}
                defaultValue={0}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vorlage-award">Auszeichnung (Schlüssel)</Label>
              <Input id="vorlage-award" name="belohnungAuszeichnung" maxLength={80} />
            </div>
          </div>

          <Button type="submit" disabled={laeuft !== null || !typKey}>
            {laeuft === 'speichern' ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            Vorlage speichern
          </Button>
        </form>
      </section>

      <ConfirmationDialog
        open={auszumustern !== null}
        onOpenChange={(offen) => !offen && setAuszumustern(null)}
        title="Vorlage ausmustern?"
        description={
          auszumustern
            ? `«${auszumustern.name}» verschwindet aus der Auswahl. Laufende Missionen bleiben unberührt.`
            : ''
        }
        confirmLabel="Ausmustern"
        onConfirm={() => void ausmustern()}
      />
    </div>
  );
}
