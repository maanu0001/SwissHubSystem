'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Lock, Pencil, Trash2 } from 'lucide-react';
import type { emoji as emojiModul } from '@swisshub/modules';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { benenneEmojiUmAction, loescheEmojiAction } from '../actions';

/**
 * Die Emojis, die auf dem Server liegen.
 *
 * ## Warum hier nichts gespiegelt wird
 *
 * Die Liste kommt bei jedem Aufruf von Discord. Eine eigene Tabelle wäre die,
 * die nach dem ersten Umbenennen auf Discord falsch ist - und niemand würde es
 * merken, weil beide Seiten für sich stimmig aussehen.
 *
 * ## `managed` ist gesperrt, nicht versteckt
 *
 * Twitch-Abo-Emojis und Integrationsrollen kann kein Bot ändern. Sie
 * auszublenden wäre eine unvollständige Liste; sie gesperrt zu zeigen
 * beantwortet die Frage «warum kann ich das nicht umbenennen».
 */
export function KatalogListe({
  katalog,
  csrfToken,
  darfVerwalten,
}: {
  katalog: emojiModul.KatalogEintrag[];
  csrfToken: string;
  darfVerwalten: boolean;
}): React.JSX.Element {
  const [suche, setSuche] = useState('');
  const sichtbar = useMemo(() => {
    const begriff = suche.trim().toLowerCase();
    return begriff.length === 0 ? katalog : katalog.filter((eintrag) => eintrag.name.includes(begriff));
  }, [katalog, suche]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          value={suche}
          onChange={(ereignis) => setSuche(ereignis.target.value)}
          placeholder="Emoji suchen"
          className="sm:max-w-xs"
        />
        <span className="text-xs text-muted-foreground sm:ml-auto">
          {sichtbar.length} von {katalog.length}
        </span>
      </div>

      {sichtbar.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          {katalog.length === 0 ? 'Noch keine Emojis auf dem Server.' : 'Kein Emoji passt dazu.'}
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {sichtbar.map((eintrag) => (
            <KatalogZeile
              key={eintrag.id}
              eintrag={eintrag}
              csrfToken={csrfToken}
              darfVerwalten={darfVerwalten}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function KatalogZeile({
  eintrag,
  csrfToken,
  darfVerwalten,
}: {
  eintrag: emojiModul.KatalogEintrag;
  csrfToken: string;
  darfVerwalten: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [laeuft, starte] = useTransition();
  const [name, setName] = useState(eintrag.name);
  const [offen, setOffen] = useState(false);

  const umbenennen = (): void => {
    starte(async () => {
      const antwort = await benenneEmojiUmAction({ csrfToken, emojiId: eintrag.id, name });
      if (!antwort.ok) {
        toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
        return;
      }
      if (!antwort.data.ok) {
        toast.error(antwort.data.grund ?? 'Ging nicht.');
        return;
      }
      setOffen(false);
      toast.success('Umbenannt.');
      router.refresh();
    });
  };

  const loeschen = (): void => {
    /*
     * Eine Rückfrage, und sie nennt den Namen.
     *
     * Löschen ist bei Discord unwiderruflich - die Bytes kommen nicht zurück.
     * Ein «Wirklich löschen?» ohne Namen ist bei einer Liste aus dreissig
     * Kacheln keine Rückfrage, sondern ein Klick.
     */
    if (!window.confirm(`«${eintrag.name}» endgültig löschen? Discord gibt das Bild nicht zurück.`)) {
      return;
    }
    starte(async () => {
      const antwort = await loescheEmojiAction({ csrfToken, emojiId: eintrag.id });
      if (!antwort.ok) {
        toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
        return;
      }
      if (!antwort.data.ok) {
        toast.error(antwort.data.grund ?? 'Ging nicht.');
        return;
      }
      toast.success('Gelöscht.');
      router.refresh();
    });
  };

  return (
    <li className="space-y-2 rounded-xl border border-border/70 bg-muted/20 p-3">
      <div className="flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={eintrag.bildUrl}
          alt={eintrag.name}
          width={32}
          height={32}
          className="size-8 shrink-0 object-contain"
          loading="lazy"
        />
        <code className="min-w-0 flex-1 truncate text-sm">:{eintrag.name}:</code>
        {eintrag.animated ? <Badge variant="secondary">animiert</Badge> : null}
        {/* Stillgelegt: vorhanden, aber nicht nutzbar - der Server hat Boost-Stufen verloren. */}
        {!eintrag.available ? <Badge variant="destructive">stillgelegt</Badge> : null}
        {eintrag.managed ? (
          <span title="Gehört einer Integration - kein Bot kann es ändern.">
            <Lock className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </span>
        ) : null}
      </div>

      {darfVerwalten && !eintrag.managed ? (
        offen ? (
          <div className="flex gap-2">
            <Input
              value={name}
              onChange={(ereignis) => setName(ereignis.target.value)}
              maxLength={32}
              className="h-9"
            />
            <Button type="button" size="sm" onClick={umbenennen} disabled={laeuft}>
              Speichern
            </Button>
          </div>
        ) : (
          <div className="flex gap-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setOffen(true)}
              disabled={laeuft}
              aria-label={`${eintrag.name} umbenennen`}
            >
              <Pencil className="size-3.5" aria-hidden="true" />
              Umbenennen
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={loeschen}
              disabled={laeuft}
              aria-label={`${eintrag.name} löschen`}
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
            </Button>
          </div>
        )
      ) : null}
    </li>
  );
}
