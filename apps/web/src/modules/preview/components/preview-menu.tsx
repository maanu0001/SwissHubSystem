'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { starteVorschauAction } from '@/modules/preview/actions';

export interface VorschauRolle {
  id: string;
  name: string;
}

interface PreviewMenuProps {
  csrfToken: string;
  rollen: VorschauRolle[];
  darfBenutzer: boolean;
  darfRolle: boolean;
  /** Der Auslöser - das Benutzermenü reicht seinen Eintrag herein. */
  offen: boolean;
  onOffenChange(offen: boolean): void;
}

/**
 * Die Auswahl für «Ansicht als …».
 *
 * Zwei Wege, weil es zwei Fragen sind: *Was sieht diese Person?* und *Was
 * erlaubt diese Rolle?* Die erste ist die genauere - eine Person trägt meist
 * mehrere Rollen, und es kann ausdrückliche Ausnahmen geben. Die zweite ist
 * die, die man beim Einrichten einer Rolle stellt.
 *
 * Die Discord-ID wird hier eingetippt und nicht aus einer Mitgliederliste
 * gewählt: eine Suche über alle Mitglieder wäre eine zweite Mitgliedersuche
 * neben der, die es schon gibt. Wer eine ID zur Hand hat, hat sie meist aus
 * genau dieser Suche.
 */
export function PreviewMenu({
  csrfToken,
  rollen,
  darfBenutzer,
  darfRolle,
  offen,
  onOffenChange,
}: PreviewMenuProps): React.JSX.Element {
  const router = useRouter();
  const [discordId, setDiscordId] = useState('');
  const [laeuft, starte] = useTransition();

  function starteVorschau(kind: 'USER' | 'ROLE', subjectId: string, label: string): void {
    starte(() => {
      void starteVorschauAction({ csrfToken, kind, subjectId, label }).then((antwort) => {
        if (!antwort.ok) {
          toast.error(antwort.error.message);
          return;
        }
        onOffenChange(false);
        router.refresh();
      });
    });
  }

  return (
    <Dialog open={offen} onOpenChange={onOffenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ansicht als …</DialogTitle>
          <DialogDescription>
            Zeigt die Oberfläche so, wie diese Person oder Rolle sie sähe. Nur zum Ansehen: solange die
            Vorschau läuft, lässt sich nichts ausführen und nichts ändern.
          </DialogDescription>
        </DialogHeader>

        {darfBenutzer ? (
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              const wert = discordId.trim();
              if (!/^\d{17,20}$/u.test(wert)) {
                toast.error('Bitte eine gültige Discord-ID angeben.');
                return;
              }
              starteVorschau('USER', wert, wert);
            }}
          >
            <label className="text-sm font-medium" htmlFor="vorschau-benutzer">
              Als Benutzer
            </label>
            <div className="flex gap-2">
              <Input
                id="vorschau-benutzer"
                value={discordId}
                onChange={(event) => setDiscordId(event.target.value)}
                placeholder="Discord-ID"
                inputMode="numeric"
              />
              <Button type="submit" variant="outline" disabled={laeuft}>
                <Search aria-hidden="true" />
                Ansehen
              </Button>
            </div>
          </form>
        ) : null}

        {darfRolle && rollen.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">Als Rolle</p>
            <ul className="max-h-56 space-y-1 overflow-y-auto scrollbar-slim">
              {rollen.map((rolle) => (
                <li key={rolle.id}>
                  <Button
                    variant="ghost"
                    className="w-full justify-start"
                    disabled={laeuft}
                    onClick={() => starteVorschau('ROLE', rolle.id, rolle.name)}
                  >
                    <Eye aria-hidden="true" />
                    {rolle.name}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {!darfBenutzer && !darfRolle ? (
          <p className="text-sm text-muted-foreground">
            Dir fehlt die Berechtigung, eine Vorschau zu starten.
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
