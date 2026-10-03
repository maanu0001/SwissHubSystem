'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CircleDot, Eye, EyeOff, Layers, Plus, Trash2 } from 'lucide-react';
import type { serverrollen } from '@swisshub/modules';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { bearbeiteKategorieAction, erstelleKategorieAction, loescheKategorieAction } from '../actions';

/**
 * Die Gruppen, in denen die Rollen stehen.
 *
 * ## Warum Gruppen und keine flache Liste
 *
 * Weil fünfzig Rollen in einer Spalte niemand liest. «Spiele», «Pings»,
 * «Team», «Auszeichnungen» - die Gruppe sagt schon, worum es geht, und die
 * Reihenfolge der Gruppen ist die Dramaturgie der öffentlichen Seite.
 *
 * ## Löschen löst auf, es wirft nicht weg
 *
 * Das Datenmodell setzt `onDelete: SetNull`. Die Beschreibungen der Rollen
 * darin bleiben, sie rutschen nach «Sonstige». Eine Gruppe aufzulösen ist
 * etwas anderes, als die Textarbeit daran zu verlieren - und der Unterschied
 * steht auch im Bestätigungstext.
 */
export function KategorienVerwaltung({
  kategorien,
  csrfToken,
}: {
  kategorien: serverrollen.KategorieFuerVerwaltung[];
  csrfToken: string;
}): React.JSX.Element {
  const router = useRouter();
  const [laeuft, starte] = useTransition();
  const [name, setName] = useState('');
  const [hinweis, setHinweis] = useState('');

  const anlegen = (): void => {
    if (name.trim().length === 0) {
      toast.error('Eine Gruppe braucht einen Namen.');
      return;
    }
    starte(async () => {
      const antwort = await erstelleKategorieAction({
        csrfToken,
        name: name.trim(),
        hinweis: hinweis.trim() || null,
        // Neue Gruppen hinten anstellen: eine neue Gruppe soll die bestehende
        // Reihenfolge nicht durcheinanderbringen.
        sortOrder: kategorien.length,
      });
      if (!antwort.ok) {
        toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
        return;
      }
      setName('');
      setHinweis('');
      toast.success('Gruppe angelegt.');
      router.refresh();
    });
  };

  const aendern = (
    id: string,
    daten: {
      sortOrder?: number;
      publicVisible?: boolean;
      exklusiv?: boolean;
      name?: string;
      hinweis?: string | null;
    },
  ): void => {
    starte(async () => {
      const antwort = await bearbeiteKategorieAction({ csrfToken, id, ...daten });
      if (!antwort.ok) {
        toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
        return;
      }
      router.refresh();
    });
  };

  const loeschen = (gruppe: serverrollen.KategorieFuerVerwaltung): void => {
    const frage =
      gruppe.anzahlRollen > 0
        ? `«${gruppe.name}» auflösen? Die ${gruppe.anzahlRollen} Rollen darin behalten ihre Beschreibung und stehen danach unter «Sonstige».`
        : `«${gruppe.name}» löschen?`;
    if (!window.confirm(frage)) {
      return;
    }
    starte(async () => {
      const antwort = await loescheKategorieAction({ csrfToken, id: gruppe.id });
      if (!antwort.ok) {
        toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
        return;
      }
      toast.success('Gruppe aufgelöst.');
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={name}
          onChange={(ereignis) => setName(ereignis.target.value)}
          placeholder="Name der Gruppe, z. B. «Spiele»"
          maxLength={60}
          className="sm:max-w-xs"
        />
        <Input
          value={hinweis}
          onChange={(ereignis) => setHinweis(ereignis.target.value)}
          placeholder="Hinweis darunter (optional)"
          maxLength={200}
        />
        <Button type="button" onClick={anlegen} disabled={laeuft} className="shrink-0">
          <Plus className="size-4" aria-hidden="true" />
          Anlegen
        </Button>
      </div>

      {kategorien.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          Noch keine Gruppe. Ohne Gruppen stehen alle Rollen unter «Sonstige» - das geht, wird aber schnell
          lang.
        </p>
      ) : (
        <ul className="space-y-2">
          {kategorien.map((gruppe) => (
            <li
              key={gruppe.id}
              className="flex flex-col gap-2 rounded-xl border border-border/70 bg-muted/30 p-3 sm:flex-row sm:items-center sm:gap-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{gruppe.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {gruppe.hinweis ?? 'Kein Hinweis'} · {gruppe.anzahlRollen}{' '}
                  {gruppe.anzahlRollen === 1 ? 'Rolle' : 'Rollen'}
                </p>
              </div>

              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                Position
                <Input
                  type="number"
                  min={0}
                  max={999}
                  defaultValue={gruppe.sortOrder}
                  disabled={laeuft}
                  onBlur={(ereignis) => {
                    const wert = Number.parseInt(ereignis.target.value, 10);
                    if (Number.isFinite(wert) && wert !== gruppe.sortOrder) {
                      aendern(gruppe.id, { sortOrder: wert });
                    }
                  }}
                  className="h-9 w-20"
                />
              </label>

              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={laeuft}
                onClick={() => aendern(gruppe.id, { publicVisible: !gruppe.publicVisible })}
                title={
                  gruppe.publicVisible
                    ? 'Auf der öffentlichen Seite sichtbar - klicken, um sie auszublenden'
                    : 'Ausgeblendet - klicken, um sie zu zeigen'
                }
              >
                {gruppe.publicVisible ? (
                  <Eye className="size-4" aria-hidden="true" />
                ) : (
                  <EyeOff className="size-4" aria-hidden="true" />
                )}
                {gruppe.publicVisible ? 'Sichtbar' : 'Versteckt'}
              </Button>

              {/*
               * Nur eine Rolle aus dieser Gruppe gleichzeitig.
               *
               * Ein Knopf und kein Haken, weil er in derselben Zeile steht wie
               * «Sichtbar» und dasselbe tut: einen Zustand umschalten, den man
               * am Knopf selbst ablesen kann.
               */}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={laeuft}
                onClick={() => aendern(gruppe.id, { exklusiv: !gruppe.exklusiv })}
                title={
                  gruppe.exklusiv
                    ? 'Nur eine Rolle aus dieser Gruppe gleichzeitig - klicken, um mehrere zu erlauben'
                    : 'Mehrere Rollen aus dieser Gruppe möglich - klicken, um auf eine zu beschränken'
                }
              >
                {gruppe.exklusiv ? (
                  <CircleDot className="size-4" aria-hidden="true" />
                ) : (
                  <Layers className="size-4" aria-hidden="true" />
                )}
                {gruppe.exklusiv ? 'Nur eine' : 'Mehrere'}
              </Button>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={laeuft}
                onClick={() => loeschen(gruppe)}
                aria-label={`${gruppe.name} auflösen`}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
