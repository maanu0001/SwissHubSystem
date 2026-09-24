'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { profile } from '@swisshub/modules';
import { bearbeiteFremdesProfilAction } from '../actions';

/**
 * Die Felder, bei denen die Verwaltung eingreifen koennen muss.
 *
 * Bewusst schlicht: drei Textfelder und zwei Auswahlen. Der volle Editor
 * unter «Mein Profil» hat sechs Abschnitte - Vitrine, Spiele, Gestaltung,
 * Privatsphaere. Die gehoeren der Person und sind keine Moderationsfrage.
 *
 * Dasselbe Schema wie dort (`allgemeinSchema`): es gibt ein Profilmodell,
 * nicht zwei. Was hier gespeichert wird, landet in denselben Spalten, und
 * die Person sieht es in ihrem eigenen Editor wieder.
 */
export function FremdesProfilFormular({
  discordId,
  csrfToken,
  start,
}: {
  discordId: string;
  csrfToken: string;
  start: profile.AllgemeinEingabe;
}): React.JSX.Element {
  const router = useRouter();
  const [laeuft, starte] = useTransition();
  const [entwurf, setEntwurf] = useState(start);

  const speichern = (): void => {
    starte(async () => {
      const antwort = await bearbeiteFremdesProfilAction({ csrfToken, discordId, ...entwurf });
      if (!antwort.ok) {
        toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
        return;
      }
      toast.success('Gespeichert.');
      router.refresh();
    });
  };

  const feld = (
    key: 'displayName' | 'tagline',
    label: string,
    grenze: number,
    hinweis: string,
  ): React.JSX.Element => (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      <input
        type="text"
        value={entwurf[key] ?? ''}
        maxLength={grenze}
        onChange={(ereignis) => setEntwurf((v) => ({ ...v, [key]: ereignis.target.value || null }))}
        className="min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm"
      />
      <span className="block text-xs text-muted-foreground">{hinweis}</span>
    </label>
  );

  return (
    <div className="max-w-2xl space-y-5 rounded-xl border border-border bg-card p-5">
      {feld('displayName', 'Profilname', 32, 'Zusätzlich zum Discord-Namen, nicht an seiner Stelle.')}
      {feld('tagline', 'Motto', 80, 'Der eine Satz unter dem Namen.')}

      <label className="block space-y-1.5">
        <span className="text-sm font-medium">Über mich</span>
        <textarea
          value={entwurf.bio ?? ''}
          maxLength={600}
          rows={5}
          onChange={(ereignis) => setEntwurf((v) => ({ ...v, bio: ereignis.target.value || null }))}
          className="w-full rounded-lg border border-border bg-background p-3 text-sm"
        />
      </label>

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={laeuft}
          onClick={speichern}
          className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {laeuft ? 'Speichert …' : 'Speichern'}
        </button>
        <p className="text-xs text-muted-foreground">
          Spiele, Vitrine, Gestaltung und Privatsphäre bleiben unberührt - die gehören dem Mitglied.
        </p>
      </div>
    </div>
  );
}
