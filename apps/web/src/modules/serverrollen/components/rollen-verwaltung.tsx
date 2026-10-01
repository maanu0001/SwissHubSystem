'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Lock, Save, ShieldAlert, Trash2 } from 'lucide-react';
import type { serverrollen } from '@swisshub/modules';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { entferneRolleAction, speichereRolleAction } from '../actions';
import { cn } from '@/lib/utils';

/**
 * Die Rollen beschreiben und freigeben.
 *
 * ## Warum der Haken manchmal gar nicht geht
 *
 * Weil `pruefeSelbstzuweisung` schon beim Aufbau der Seite gefragt wurde - mit
 * `selfAssignable: true`, also «dürfte sie überhaupt». Eine Rolle mit
 * «Mitglieder kicken» kommt deshalb mit ausgegrautem Schalter und einem Satz
 * daneben, statt sich anhaken zu lassen und später nichts zu tun.
 *
 * Das ist Bequemlichkeit und keine Sperre: die Sperre sitzt in der Server
 * Action und noch einmal in `aendereEigeneRolle`. Wer den Schalter im Browser
 * aktiviert, bekommt vom Server dieselbe Begründung.
 *
 * ## Warum «gepflegt» der Unterschied ist
 *
 * Eine Rolle ohne Zeile in `ServerRoleMeta` steht nicht auf der öffentlichen
 * Seite. Speichern legt die Zeile an, «Entfernen» löscht sie wieder - damit
 * ist die Seite eine Auswahl des Teams und nicht ein Abbild aller Rollen, die
 * Discord gerade kennt.
 */
export function RollenVerwaltung({
  rollen,
  kategorien,
  csrfToken,
  darfFreigeben,
}: {
  rollen: serverrollen.RolleFuerVerwaltung[];
  kategorien: serverrollen.KategorieFuerVerwaltung[];
  csrfToken: string;
  darfFreigeben: boolean;
}): React.JSX.Element {
  const [suche, setSuche] = useState('');
  const [nurGepflegte, setNurGepflegte] = useState(false);

  const sichtbar = useMemo(() => {
    const begriff = suche.trim().toLowerCase();
    return rollen.filter(
      (rolle) =>
        (!nurGepflegte || rolle.gepflegt) &&
        (begriff.length === 0 || rolle.name.toLowerCase().includes(begriff)),
    );
  }, [rollen, suche, nurGepflegte]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          value={suche}
          onChange={(ereignis) => setSuche(ereignis.target.value)}
          placeholder="Rolle suchen"
          className="sm:max-w-xs"
        />
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch checked={nurGepflegte} onCheckedChange={setNurGepflegte} />
          Nur beschriebene Rollen
        </label>
        <span className="text-xs text-muted-foreground sm:ml-auto">
          {sichtbar.length} von {rollen.length}
        </span>
      </div>

      {sichtbar.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          Keine Rolle passt dazu.
        </p>
      ) : (
        <ul className="space-y-3">
          {sichtbar.map((rolle) => (
            <RollenZeile
              key={rolle.discordRoleId}
              rolle={rolle}
              kategorien={kategorien}
              alleRollen={rollen}
              csrfToken={csrfToken}
              darfFreigeben={darfFreigeben}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

interface Entwurf {
  categoryId: string;
  beschreibung: string;
  sortOrder: number;
  publicVisible: boolean;
  selfAssignable: boolean;
  selfRemovable: boolean;
  voraussetzungRoleId: string;
}

function RollenZeile({
  rolle,
  kategorien,
  alleRollen,
  csrfToken,
  darfFreigeben,
}: {
  rolle: serverrollen.RolleFuerVerwaltung;
  kategorien: serverrollen.KategorieFuerVerwaltung[];
  alleRollen: serverrollen.RolleFuerVerwaltung[];
  csrfToken: string;
  darfFreigeben: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [laeuft, starte] = useTransition();
  const [entwurf, setEntwurf] = useState<Entwurf>({
    categoryId: rolle.categoryId ?? '',
    beschreibung: rolle.beschreibung ?? '',
    sortOrder: rolle.sortOrder,
    publicVisible: rolle.publicVisible,
    selfAssignable: rolle.selfAssignable,
    selfRemovable: rolle.selfRemovable,
    voraussetzungRoleId: rolle.voraussetzungRoleId ?? '',
  });

  const speichern = (): void => {
    starte(async () => {
      const antwort = await speichereRolleAction({
        csrfToken,
        discordRoleId: rolle.discordRoleId,
        categoryId: entwurf.categoryId || null,
        beschreibung: entwurf.beschreibung.trim() || null,
        sortOrder: entwurf.sortOrder,
        publicVisible: entwurf.publicVisible,
        /*
         * Das Feld geht nur mit, wenn die Person es ändern darf.
         *
         * Sonst schickte eine Redaktorin bei jedem Speichern einen
         * `selfAssignable`-Wert mit - und die Aktion lehnte ab, obwohl sie
         * nichts daran geändert hat.
         */
        ...(darfFreigeben ? { selfAssignable: entwurf.selfAssignable } : {}),
        selfRemovable: entwurf.selfRemovable,
        voraussetzungRoleId: entwurf.voraussetzungRoleId || null,
      });
      if (!antwort.ok) {
        toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
        return;
      }
      toast.success(`«${rolle.name}» gespeichert.`);
      router.refresh();
    });
  };

  const entfernen = (): void => {
    if (
      !window.confirm(`«${rolle.name}» von der öffentlichen Seite nehmen? Die Beschreibung geht verloren.`)
    ) {
      return;
    }
    starte(async () => {
      const antwort = await entferneRolleAction({ csrfToken, discordRoleId: rolle.discordRoleId });
      if (!antwort.ok) {
        toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
        return;
      }
      toast.success('Von der Seite genommen.');
      router.refresh();
    });
  };

  // Der Schalter ist nur dann bedienbar, wenn die Rolle es überhaupt erlaubt
  // **und** die Person das Recht dazu hat. Zwei verschiedene Gründe, einer
  // davon genügt - die Erklärung daneben sagt, welcher.
  const freigabeSperre = !rolle.freigabeMoeglich
    ? (rolle.sperrText ?? 'Diese Rolle kann nicht selbst vergeben werden.')
    : !darfFreigeben
      ? 'Dafür fehlt dir die Berechtigung «Selbstvergabe freigeben».'
      : null;

  return (
    <li className="space-y-3 rounded-xl border border-border/70 bg-muted/20 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span
          aria-hidden="true"
          className={cn('size-3 shrink-0 rounded-full', rolle.farbe ? '' : 'bg-muted-foreground/40')}
          style={rolle.farbe ? { backgroundColor: rolle.farbe } : undefined}
        />
        <span className="font-medium">{rolle.name}</span>
        <span className="text-xs text-muted-foreground">Position {rolle.position}</span>
        {rolle.gepflegt ? (
          <Badge variant="secondary">auf der Seite</Badge>
        ) : (
          <Badge variant="outline">nicht auf der Seite</Badge>
        )}
        {rolle.managed ? <Badge variant="outline">von Discord verwaltet</Badge> : null}
        {/*
          Die gefundenen kritischen Rechte stehen nur hier im Dashboard. Auf der
          oeffentlichen Seite waeren sie eine Einkaufsliste fuer jemanden, der
          sie nicht haben soll.
        */}
        {rolle.kritischeRechte.length > 0 ? (
          <Badge variant="destructive" className="gap-1">
            <ShieldAlert className="size-3" aria-hidden="true" />
            {rolle.kritischeRechte.join(', ')}
          </Badge>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className="text-sm font-medium">Gruppe</span>
          <select
            value={entwurf.categoryId}
            onChange={(ereignis) => setEntwurf((v) => ({ ...v, categoryId: ereignis.target.value }))}
            className="min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm"
          >
            <option value="">Sonstige</option>
            {kategorien.map((gruppe) => (
              <option key={gruppe.id} value={gruppe.id}>
                {gruppe.name}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1.5">
          <span className="text-sm font-medium">Voraussetzung</span>
          <select
            value={entwurf.voraussetzungRoleId}
            onChange={(ereignis) => setEntwurf((v) => ({ ...v, voraussetzungRoleId: ereignis.target.value }))}
            className="min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm"
          >
            <option value="">Keine</option>
            {/*
              Sich selbst als Voraussetzung waere eine Rolle, die niemand je
              bekommt - deshalb faellt sie aus der Auswahl heraus.
            */}
            {alleRollen
              .filter((andere) => andere.discordRoleId !== rolle.discordRoleId)
              .map((andere) => (
                <option key={andere.discordRoleId} value={andere.discordRoleId}>
                  {andere.name}
                </option>
              ))}
          </select>
          <span className="block text-xs text-muted-foreground">
            Wer diese Rolle nicht hat, kann sich die hier nicht geben.
          </span>
        </label>
      </div>

      <label className="block space-y-1.5">
        <span className="text-sm font-medium">Beschreibung</span>
        <textarea
          value={entwurf.beschreibung}
          maxLength={280}
          rows={2}
          onChange={(ereignis) => setEntwurf((v) => ({ ...v, beschreibung: ereignis.target.value }))}
          placeholder="Was diese Rolle bedeutet und wie man sie bekommt."
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={entwurf.publicVisible}
            onCheckedChange={(wert) => setEntwurf((v) => ({ ...v, publicVisible: wert }))}
          />
          Öffentlich zeigen
        </label>

        <label className={cn('flex items-center gap-2 text-sm', freigabeSperre && 'text-muted-foreground')}>
          <Switch
            checked={entwurf.selfAssignable && !freigabeSperre}
            disabled={freigabeSperre !== null}
            onCheckedChange={(wert) => setEntwurf((v) => ({ ...v, selfAssignable: wert }))}
          />
          Selbst vergeben
          {freigabeSperre ? <Lock className="size-3.5 shrink-0" aria-hidden="true" /> : null}
        </label>

        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={entwurf.selfRemovable}
            onCheckedChange={(wert) => setEntwurf((v) => ({ ...v, selfRemovable: wert }))}
          />
          Selbst abgeben
        </label>

        <label className="flex items-center gap-2 text-sm">
          Position
          <Input
            type="number"
            min={0}
            max={999}
            value={entwurf.sortOrder}
            onChange={(ereignis) =>
              setEntwurf((v) => ({ ...v, sortOrder: Number.parseInt(ereignis.target.value, 10) || 0 }))
            }
            className="h-9 w-20"
          />
        </label>
      </div>

      {freigabeSperre ? (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {freigabeSperre}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={speichern} disabled={laeuft}>
          <Save className="size-4" aria-hidden="true" />
          Speichern
        </Button>
        {rolle.gepflegt ? (
          <Button type="button" size="sm" variant="ghost" onClick={entfernen} disabled={laeuft}>
            <Trash2 className="size-4" aria-hidden="true" />
            Von der Seite nehmen
          </Button>
        ) : null}
      </div>
    </li>
  );
}
