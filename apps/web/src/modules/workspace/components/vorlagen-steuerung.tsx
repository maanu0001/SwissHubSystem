'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Archive, Rocket, Sparkles } from 'lucide-react';
import { systemRoutes } from '@swisshub/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  workspaceProjektAusVorlageAction,
  workspaceStandardvorlagenAction,
  workspaceVorlageArchivierenAction,
  workspaceVorlageZurueckholenAction,
} from '../actions';

/**
 * Was man mit einer Vorlage tut.
 *
 * ## Warum das Zieldatum im Dialog steht und nicht optional daneben
 *
 * Weil die Fristen der Vorlage **darauf** rechnen. Ohne Zieldatum bekommen die
 * Aufgaben keine Fristen - das ist zulässig, aber es ist eine Entscheidung und
 * keine Nebensache. Der Hinweis darunter sagt sie, und zwar bevor jemand zwölf
 * Aufgaben ohne Frist anlegt und sich wundert.
 */

export function AusVorlage({
  csrfToken,
  templateId,
  name,
  projektTitel,
  anzahl,
}: {
  csrfToken: string;
  templateId: string;
  name: string;
  projektTitel: string;
  anzahl: number;
}): React.JSX.Element {
  const router = useRouter();
  const [offen, setOffen] = useState(false);
  const [laeuft, starte] = useTransition();
  const [titel, setTitel] = useState(projektTitel);
  const [zielAm, setZielAm] = useState('');

  return (
    <Dialog open={offen} onOpenChange={setOffen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Rocket className="size-4" />
          Projekt starten
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Projekt aus «{name}»</DialogTitle>
          <DialogDescription>
            {anzahl} {anzahl === 1 ? 'Aufgabe' : 'Aufgaben'} werden kopiert. Ab dann ist es ein gewöhnliches
            Projekt - was du darin änderst, ändert die Vorlage nicht.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ws-v-titel">Projekttitel</Label>
            <Input
              id="ws-v-titel"
              value={titel}
              maxLength={160}
              onChange={(ereignis): void => setTitel(ereignis.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ws-v-ziel">Zieldatum</Label>
            <Input
              id="ws-v-ziel"
              type="date"
              value={zielAm}
              onChange={(ereignis): void => setZielAm(ereignis.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {zielAm === ''
                ? 'Ohne Zieldatum bekommen die Aufgaben keine Fristen - lieber keine als zwölf falsche.'
                : 'Die Fristen der Vorlage rechnen auf diesen Tag. Was vorher fertig sein muss, liegt davor.'}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={(): void => setOffen(false)} disabled={laeuft}>
            Abbrechen
          </Button>
          <Button
            disabled={laeuft}
            onClick={(): void =>
              starte(async () => {
                const antwort = await workspaceProjektAusVorlageAction({
                  csrfToken,
                  templateId,
                  titel: titel.trim() || undefined,
                  zielAm: zielAm || null,
                });
                if (!antwort.ok) {
                  toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
                  return;
                }
                setOffen(false);
                toast.success('Projekt angelegt.');
                // Direkt hin: wer ein Projekt startet, will es sehen und nicht
                // in der Vorlagenliste bleiben.
                router.push(systemRoutes.workspaceProjekt(antwort.data.projectId));
              })
            }
          >
            {laeuft ? 'Wird angelegt …' : 'Anlegen'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function VorlageArchivKnopf({
  csrfToken,
  templateId,
  archiviert,
}: {
  csrfToken: string;
  templateId: string;
  archiviert: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [laeuft, starte] = useTransition();

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={laeuft}
      onClick={(): void =>
        starte(async () => {
          const antwort = archiviert
            ? await workspaceVorlageZurueckholenAction({ csrfToken, templateId })
            : await workspaceVorlageArchivierenAction({ csrfToken, templateId });
          if (!antwort.ok) {
            toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
            return;
          }
          toast.success(archiviert ? 'Vorlage zurückgeholt.' : 'Vorlage archiviert.');
          router.refresh();
        })
      }
    >
      <Archive className="size-4" />
      {archiviert ? 'Zurückholen' : 'Archivieren'}
    </Button>
  );
}

/**
 * Die vier Standardvorlagen anlegen.
 *
 * Nur die fehlenden, und die Meldung sagt die Zahl: «vier Vorlagen angelegt» zu
 * melden, wenn es keine war, wäre eine Unwahrheit über etwas, das man sofort
 * nachprüfen kann.
 */
export function StandardvorlagenKnopf({ csrfToken }: { csrfToken: string }): React.JSX.Element {
  const router = useRouter();
  const [laeuft, starte] = useTransition();

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={laeuft}
      onClick={(): void =>
        starte(async () => {
          const antwort = await workspaceStandardvorlagenAction({ csrfToken });
          if (!antwort.ok) {
            toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
            return;
          }
          const anzahl = antwort.data.angelegt;
          toast.success(
            anzahl === 0
              ? 'Alle Standardvorlagen sind schon da.'
              : `${anzahl} ${anzahl === 1 ? 'Vorlage' : 'Vorlagen'} angelegt.`,
          );
          router.refresh();
        })
      }
    >
      <Sparkles className="size-4" />
      Standardvorlagen anlegen
    </Button>
  );
}
