'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { clipEinreichenAction, clipVorschauAction } from '@/modules/clips/actions';
import { cn } from '@/lib/utils';

export interface SpielOption {
  id: string;
  name: string;
}

interface Vorschau {
  provider: string;
  canonicalUrl: string;
  thumbnailUrl: string | null;
  einbettung: string;
}

const SCHRITTE = ['Link', 'Details', 'Absenden'] as const;

/**
 * Der Weg von der Adresse zum eingereichten Clip.
 *
 * ## Drei Schritte statt eines Formulars
 *
 * Ein einziges Formular mit sechs Feldern sieht nach Arbeit aus. Drei
 * Schritte mit je einer Frage sehen nach zwei Minuten aus - und das sind sie
 * auch. Der erste Schritt bringt ausserdem sofort ein Bild: wer seinen
 * eigenen Clip sieht, weiss, dass die richtige Adresse angekommen ist.
 *
 * ## Warum die Adresse der Server prueft
 *
 * Dieselbe Pruefung im Browser nachzubauen hiesse, zwei Regeln zu haben, die
 * auseinanderlaufen - und die im Browser waere ohnehin nur Hoeflichkeit.
 * Gefragt wird deshalb der Server, und zwar mit derselben Funktion, die auch
 * beim Einreichen entscheidet.
 */
export function EinreichAssistent({
  csrfToken,
  spiele,
  limitErreicht,
}: {
  csrfToken: string;
  spiele: SpielOption[];
  limitErreicht: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [schritt, setSchritt] = useState(0);
  const [url, setUrl] = useState('');
  const [vorschau, setVorschau] = useState<Vorschau | null>(null);
  const [titel, setTitel] = useState('');
  const [beschreibung, setBeschreibung] = useState('');
  const [gameId, setGameId] = useState('');
  const [rechte, setRechte] = useState(false);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  async function pruefeLink(): Promise<void> {
    if (laeuft || url.trim().length < 8) {
      return;
    }
    setLaeuft(true);
    setFehler(null);
    const antwort = await clipVorschauAction({ csrfToken, url: url.trim() });
    setLaeuft(false);

    if (!antwort.ok) {
      setVorschau(null);
      setFehler(antwort.error.message);
      return;
    }
    setVorschau(antwort.data);
    setSchritt(1);
  }

  async function reicheEin(): Promise<void> {
    if (laeuft || !rechte) {
      return;
    }
    setLaeuft(true);
    setFehler(null);
    const antwort = await clipEinreichenAction({
      csrfToken,
      url: url.trim(),
      titel: titel.trim(),
      ...(beschreibung.trim() ? { beschreibung: beschreibung.trim() } : {}),
      ...(gameId ? { gameId } : {}),
      rechteBestaetigt: true,
    });
    setLaeuft(false);

    if (!antwort.ok) {
      setFehler(antwort.error.message);
      return;
    }
    toast.success('Dein Clip ist eingereicht - die Moderation schaut ihn sich an.');
    router.push('/clips');
    router.refresh();
  }

  if (limitErreicht) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-center">
        <h2 className="font-semibold">Du bist diese Woche schon dabei</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Mehr Einreichungen sind für diese Runde nicht vorgesehen. Nächste Woche gerne wieder.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ol className="flex items-center gap-2" aria-label="Fortschritt">
        {SCHRITTE.map((name, index) => (
          <li key={name} className="flex flex-1 items-center gap-2">
            <span
              className={cn(
                'grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold transition',
                index < schritt
                  ? 'bg-primary text-primary-foreground'
                  : index === schritt
                    ? 'bg-primary/15 text-primary ring-2 ring-primary'
                    : 'bg-secondary text-muted-foreground',
              )}
              aria-current={index === schritt ? 'step' : undefined}
            >
              {index < schritt ? <Check className="size-3.5" aria-hidden="true" /> : index + 1}
            </span>
            <span
              className={cn(
                'hidden text-sm sm:inline',
                index === schritt ? 'font-medium text-foreground' : 'text-muted-foreground',
              )}
            >
              {name}
            </span>
            {index < SCHRITTE.length - 1 ? <span className="h-px flex-1 bg-border" /> : null}
          </li>
        ))}
      </ol>

      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        {schritt === 0 ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="clip-url">Link zu deinem Clip</Label>
              <Input
                id="clip-url"
                value={url}
                inputMode="url"
                autoComplete="off"
                placeholder="https://clips.twitch.tv/... oder https://youtu.be/..."
                onChange={(ereignis) => setUrl(ereignis.target.value)}
                onKeyDown={(ereignis) => {
                  if (ereignis.key === 'Enter') {
                    ereignis.preventDefault();
                    void pruefeLink();
                  }
                }}
              />
              <p className="text-xs text-muted-foreground">
                Twitch-Clips, YouTube-Videos und Medal-Clips. Andere Quellen sind nicht zugelassen.
              </p>
            </div>

            <Button onClick={() => void pruefeLink()} disabled={laeuft || url.trim().length < 8}>
              {laeuft ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              Weiter
              <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          </div>
        ) : null}

        {schritt === 1 && vorschau ? (
          <div className="space-y-4">
            <div className="overflow-hidden rounded-xl border border-border bg-black">
              <iframe
                src={vorschau.einbettung}
                title="Vorschau deines Clips"
                className="aspect-video w-full"
                allow="fullscreen"
                sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
                referrerPolicy="strict-origin-when-cross-origin"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="clip-titel">Titel</Label>
              <Input
                id="clip-titel"
                value={titel}
                maxLength={120}
                placeholder="Worum geht es in 5 Wörtern?"
                onChange={(ereignis) => setTitel(ereignis.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="clip-beschreibung">Beschreibung (optional)</Label>
              <Input
                id="clip-beschreibung"
                value={beschreibung}
                maxLength={500}
                placeholder="Kontext, der beim Zuschauen hilft"
                onChange={(ereignis) => setBeschreibung(ereignis.target.value)}
              />
            </div>

            {spiele.length > 0 ? (
              <div className="space-y-1.5">
                <Label htmlFor="clip-spiel">Spiel (optional)</Label>
                <select
                  id="clip-spiel"
                  value={gameId}
                  onChange={(ereignis) => setGameId(ereignis.target.value)}
                  className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">Ohne Angabe</option>
                  {spiele.map((spiel) => (
                    <option key={spiel.id} value={spiel.id}>
                      {spiel.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setSchritt(0)}>
                <ArrowLeft className="size-4" aria-hidden="true" />
                Zurück
              </Button>
              <Button onClick={() => setSchritt(2)} disabled={titel.trim().length < 3}>
                Weiter
                <ArrowRight className="size-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        ) : null}

        {schritt === 2 ? (
          <div className="space-y-4">
            <div>
              <h2 className="font-semibold">Fast geschafft</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Die Moderation schaut sich deinen Clip an, bevor er im Voting erscheint.
              </p>
            </div>

            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-4 transition hover:border-primary/40">
              <input
                type="checkbox"
                checked={rechte}
                onChange={(ereignis) => setRechte(ereignis.target.checked)}
                className="mt-0.5 size-4 accent-[hsl(var(--primary))]"
              />
              <span className="text-sm">
                Der Clip stammt von mir oder ich darf ihn einreichen. Er zeigt nichts, was gegen die
                Serverregeln verstösst.
              </span>
            </label>

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setSchritt(1)}>
                <ArrowLeft className="size-4" aria-hidden="true" />
                Zurück
              </Button>
              <Button onClick={() => void reicheEin()} disabled={!rechte || laeuft}>
                {laeuft ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                Clip einreichen
              </Button>
            </div>
          </div>
        ) : null}

        {fehler ? (
          <p role="alert" className="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {fehler}
          </p>
        ) : null}
      </div>
    </div>
  );
}
