'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Archive, ArchiveRestore, Copy, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  postArchivierenAction,
  postDuplizierenAction,
  postLoeschenAction,
} from '@/modules/socialmedia/actions';

/**
 * Duplizieren, ablegen, loeschen (§42).
 *
 * ## Warum nur das Loeschen fragt
 *
 * Weil nur es sich nicht zurueckholen laesst. Ablegen ist ein Schalter mit
 * einem Weg zurueck, Duplizieren erzeugt etwas und nimmt nichts - eine
 * Rueckfrage dort waere ein Klick, der nichts schuetzt, und sie erzieht dazu,
 * Rueckfragen wegzuklicken.
 */
export function PostAktionen({
  postId,
  titel,
  archiviert,
  csrfToken,
  darfDuplizieren,
  darfLoeschen,
}: {
  postId: string;
  titel: string;
  archiviert: boolean;
  csrfToken: string;
  darfDuplizieren: boolean;
  darfLoeschen: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const [fragt, setFragt] = useState(false);

  async function duplizieren(): Promise<void> {
    setLaeuft('kopie');
    const antwort = await postDuplizierenAction({ csrfToken, postId });
    setLaeuft(null);
    if (!antwort.ok) {
      toast.error(antwort.error.message);
      return;
    }
    toast.success('Kopie angelegt - als Entwurf.');
    router.push(`/social-media/post-creator/${antwort.data.postId}`);
  }

  async function archivieren(): Promise<void> {
    setLaeuft('archiv');
    const antwort = await postArchivierenAction({ csrfToken, postId, archivieren: !archiviert });
    setLaeuft(null);
    if (!antwort.ok) {
      toast.error(antwort.error.message);
      return;
    }
    toast.success(archiviert ? 'Zurückgeholt.' : 'Abgelegt.');
    router.refresh();
  }

  async function loeschen(): Promise<void> {
    setLaeuft('loeschen');
    const antwort = await postLoeschenAction({ csrfToken, postId });
    setLaeuft(null);
    setFragt(false);
    if (!antwort.ok) {
      toast.error(antwort.error.message);
      return;
    }
    toast.success('Gelöscht.');
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {darfDuplizieren ? (
        <Button variant="ghost" size="sm" onClick={() => void duplizieren()} disabled={laeuft !== null}>
          {laeuft === 'kopie' ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <Copy aria-hidden="true" />
          )}
          Duplizieren
        </Button>
      ) : null}
      {darfLoeschen ? (
        <>
          <Button variant="ghost" size="sm" onClick={() => void archivieren()} disabled={laeuft !== null}>
            {laeuft === 'archiv' ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : archiviert ? (
              <ArchiveRestore aria-hidden="true" />
            ) : (
              <Archive aria-hidden="true" />
            )}
            {archiviert ? 'Zurückholen' : 'Ablegen'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive"
            onClick={() => setFragt(true)}
            disabled={laeuft !== null}
          >
            <Trash2 aria-hidden="true" />
            Löschen
          </Button>
          <Dialog open={fragt} onOpenChange={(offen) => (laeuft ? undefined : setFragt(offen))}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>«{titel}» löschen?</DialogTitle>
                <DialogDescription>
                  Der Post verschwindet endgültig. Die hochgeladenen Bilder bleiben liegen - sie können in
                  einer Kopie noch gebraucht werden.
                </DialogDescription>
              </DialogHeader>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setFragt(false)} disabled={laeuft !== null}>
                  Abbrechen
                </Button>
                <Button variant="destructive" onClick={() => void loeschen()} disabled={laeuft !== null}>
                  {laeuft === 'loeschen' ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                  Endgültig löschen
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </>
      ) : null}
    </div>
  );
}
