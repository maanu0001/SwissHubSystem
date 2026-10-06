'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { postErstellenAction } from '@/modules/socialmedia/actions';
import { cn } from '@/lib/utils';

/**
 * Einen neuen Post anlegen - Vorlage waehlen, benennen, los (§29).
 *
 * ## Warum die Vorlage zuerst
 *
 * Weil sie bestimmt, welche Felder es gibt. Ein leerer Post, dem man
 * nachtraeglich einen Typ gibt, hiesse: erst Felder ausfuellen, dann sehen,
 * dass die Vorlage sie nicht kennt. Der Typ laesst sich im Editor trotzdem
 * noch wechseln - dann wandert mit, was beide Typen haben, und der Rest
 * faellt weg. Das ist bewusst so: ein Feld, das eine Vorlage nicht zeichnet,
 * im Datensatz zu behalten waere ein Rest, der beim naechsten Wechsel wieder
 * auftaucht.
 *
 * ## Warum die Designs hier schon stehen
 *
 * Damit die Wahl eine ist. «Event» allein sagt nicht, wie das Bild aussieht;
 * «Event, Design Bold» schon - und die Kurzbeschreibung des Aufbaus daneben
 * macht aus sechs Namen sechs unterscheidbare Dinge.
 */

export interface VorlagenWahl {
  typen: Array<{ id: string; label: string; beschreibung: string; designs: string[] }>;
  designs: Array<{ id: string; label: string; aufbau: string }>;
}

export function PostNeu({
  vorlagen,
  csrfToken,
}: {
  vorlagen: VorlagenWahl;
  csrfToken: string;
}): React.JSX.Element {
  const router = useRouter();
  const [offen, setOffen] = useState(false);
  const [laeuft, setLaeuft] = useState(false);
  const [titel, setTitel] = useState('');
  const [typId, setTypId] = useState(vorlagen.typen[0]?.id ?? 'info');
  const typ = vorlagen.typen.find((eintrag) => eintrag.id === typId);
  const [design, setDesign] = useState(typ?.designs[0] ?? 'clean');

  function waehleTyp(id: string): void {
    setTypId(id);
    const neu = vorlagen.typen.find((eintrag) => eintrag.id === id);
    // Das erste Design des neuen Typs - das alte kennt er moeglicherweise nicht.
    setDesign(neu?.designs[0] ?? 'clean');
  }

  async function anlegen(): Promise<void> {
    setLaeuft(true);
    const antwort = await postErstellenAction({
      csrfToken,
      title: titel.trim() === '' ? (typ?.label ?? 'Neuer Post') : titel.trim(),
      postType: typId,
      design,
    });
    setLaeuft(false);
    if (!antwort.ok) {
      toast.error(antwort.error.message);
      return;
    }
    setOffen(false);
    router.push(`/social-media/post-creator/${antwort.data.postId}`);
  }

  const verfuegbareDesigns = vorlagen.designs.filter((eintrag) => typ?.designs.includes(eintrag.id));

  return (
    <Dialog open={offen} onOpenChange={(naechst) => (laeuft ? undefined : setOffen(naechst))}>
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden="true" />
          Neuer Post
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Neuen Post anlegen</DialogTitle>
          <DialogDescription>Vorlage und Design wählen - alles andere entsteht im Editor.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="neu-titel">Arbeitstitel</Label>
            <Input
              id="neu-titel"
              value={titel}
              placeholder={typ?.label ?? ''}
              onChange={(e) => setTitel(e.target.value)}
            />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Vorlage</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {vorlagen.typen.map((eintrag) => (
                <button
                  key={eintrag.id}
                  type="button"
                  onClick={() => waehleTyp(eintrag.id)}
                  className={cn(
                    'rounded-lg border p-3 text-left transition',
                    typId === eintrag.id
                      ? 'border-primary/60 bg-primary/5'
                      : 'border-border hover:border-primary/30',
                  )}
                >
                  <span className="block text-sm font-medium">{eintrag.label}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{eintrag.beschreibung}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Design</legend>
            <div className="grid gap-2">
              {verfuegbareDesigns.map((eintrag) => (
                <button
                  key={eintrag.id}
                  type="button"
                  onClick={() => setDesign(eintrag.id)}
                  className={cn(
                    'rounded-lg border p-3 text-left transition',
                    design === eintrag.id
                      ? 'border-primary/60 bg-primary/5'
                      : 'border-border hover:border-primary/30',
                  )}
                >
                  <span className="block text-sm font-medium">{eintrag.label}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{eintrag.aufbau}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOffen(false)} disabled={laeuft}>
              Abbrechen
            </Button>
            <Button onClick={() => void anlegen()} disabled={laeuft}>
              {laeuft ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              Anlegen und bearbeiten
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
