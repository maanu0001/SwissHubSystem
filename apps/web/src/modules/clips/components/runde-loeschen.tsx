'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Eye, EyeOff, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import { clipRuhmeshalleAction, clipRundeLoeschenAction } from '@/modules/clips/admin-actions';

/**
 * Die beiden zerstoerenden Knoepfe an einer Runde.
 *
 * ## Warum sie zusammen in einer Datei stehen
 *
 * Weil sie zusammen gelesen werden muessen. «Aus der Hall of Fame nehmen» und
 * «Runde loeschen» sehen in einer Tabellenzeile fast gleich aus und tun
 * voellig Verschiedenes - das eine blendet aus und laesst sich zuruecknehmen,
 * das andere nimmt Einreichungen, Stimmen und Platzierungen mit und nicht.
 * Wer den einen aendert, soll den anderen vor Augen haben.
 *
 * ## Die Bestaetigung ist kein Klick
 *
 * Beim Loeschen muss der Schluessel der Runde abgetippt werden - `2026-W39`.
 * Ein Dialog mit einem roten Knopf ist bei der dritten Runde am Abend nur
 * noch ein zweiter Klick; ein Feld, in dem die richtige Woche stehen muss,
 * ist eine Gelegenheit zu merken, dass man die falsche Zeile erwischt hat.
 *
 * Geprueft wird die Eingabe trotzdem auf dem Server. Hier bleibt der Knopf
 * nur inaktiv - das ist eine Hoeflichkeit, keine Zusicherung.
 */
export function RundeLoeschen({
  competitionId,
  nummer,
  schluessel,
  einreichungen,
  stimmen,
  csrfToken,
}: {
  competitionId: string;
  nummer: number;
  schluessel: string;
  einreichungen: number;
  stimmen: number;
  csrfToken: string;
}): React.JSX.Element {
  const router = useRouter();
  const [offen, setOffen] = useState(false);
  const [eingabe, setEingabe] = useState('');
  const [grund, setGrund] = useState('');
  const [laeuft, setLaeuft] = useState(false);

  async function loesche(): Promise<void> {
    setLaeuft(true);
    const antwort = await clipRundeLoeschenAction({
      csrfToken,
      competitionId,
      bestaetigung: eingabe,
      ...(grund.trim() ? { grund: grund.trim() } : {}),
    });
    setLaeuft(false);

    if (!antwort.ok) {
      toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
      router.refresh();
      /*
       * Geworfen, damit der Dialog offen bleibt.
       *
       * `ConfirmationDialog` schliesst nach einem `onConfirm`, das
       * durchlaeuft. Bei einer abgewiesenen Bestaetigung ist genau das
       * falsch: die Eingabe waere weg, und man faenge von vorne an.
       */
      throw new Error('Löschen abgewiesen');
    }
    setEingabe('');
    setGrund('');
    const daten = antwort.data;
    toast.success(
      `Runde #${daten.nummer} gelöscht - ${daten.einreichungen} Einreichungen, ${daten.stimmen} Stimmen` +
        (daten.dateienGeloescht > 0 ? `, ${daten.dateienGeloescht} Dateien` : ''),
    );
    router.refresh();
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOffen(true)}
        disabled={laeuft}
        title="Runde löschen"
        className="text-destructive hover:text-destructive"
      >
        {laeuft ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Trash2 className="size-4" aria-hidden="true" />
        )}
        <span className="sr-only">Runde #{nummer} löschen</span>
      </Button>

      <ConfirmationDialog
        open={offen}
        onOpenChange={(auf) => {
          setOffen(auf);
          if (!auf) {
            setEingabe('');
            setGrund('');
          }
        }}
        title={`Runde #${nummer} endgültig löschen?`}
        destructive
        confirmLabel="Endgültig löschen"
        confirmDisabled={eingabe.trim() !== schluessel}
        description={
          <>
            Damit gehen <strong>{einreichungen} Einreichungen</strong> und <strong>{stimmen} Stimmen</strong>{' '}
            mitsamt den Platzierungen dieser Runde verloren. Die Clips selbst bleiben, solange sie in einer
            anderen Runde antreten; hochgeladene Dateien, auf die danach nichts mehr zeigt, werden von der
            Platte gelöscht. Das lässt sich nicht rückgängig machen.
            <br />
            <br />
            Soll die Runde nur nicht mehr in der Hall of Fame stehen, nimm sie dort heraus - das bleibt
            umkehrbar.
          </>
        }
        onConfirm={() => void loesche()}
      >
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={`loeschen-${competitionId}`}>
              Zur Bestätigung <code className="font-mono font-semibold">{schluessel}</code> eintippen
            </Label>
            <Input
              id={`loeschen-${competitionId}`}
              value={eingabe}
              onChange={(ereignis) => setEingabe(ereignis.target.value)}
              placeholder={schluessel}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`grund-${competitionId}`}>Grund (fürs Protokoll, optional)</Label>
            <Input
              id={`grund-${competitionId}`}
              value={grund}
              onChange={(ereignis) => setGrund(ereignis.target.value)}
              maxLength={300}
            />
          </div>
          {eingabe.trim() !== schluessel && eingabe.length > 0 ? (
            <p className="text-xs text-destructive">Das ist nicht der Schlüssel dieser Runde.</p>
          ) : null}
        </div>
      </ConfirmationDialog>
    </>
  );
}

/**
 * Eine abgeschlossene Runde aus der Hall of Fame nehmen - oder zurueckholen.
 *
 * Derselbe Knopf in beide Richtungen, weil es dieselbe Entscheidung in beide
 * Richtungen ist. Der Zustand kommt vom Server (`verborgen`); die Komponente
 * raet ihn nicht aus dem letzten Klick.
 */
export function RuhmeshalleSchalter({
  competitionId,
  nummer,
  verborgen,
  csrfToken,
}: {
  competitionId: string;
  nummer: number;
  verborgen: boolean;
  csrfToken: string;
}): React.JSX.Element {
  const router = useRouter();
  const [offen, setOffen] = useState(false);
  const [grund, setGrund] = useState('');
  const [laeuft, setLaeuft] = useState(false);

  async function schalte(): Promise<void> {
    setLaeuft(true);
    const antwort = await clipRuhmeshalleAction({
      csrfToken,
      competitionId,
      verbergen: !verborgen,
      ...(!verborgen && grund.trim() ? { grund: grund.trim() } : {}),
    });
    setLaeuft(false);

    if (!antwort.ok) {
      toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
      router.refresh();
      throw new Error('Umschalten abgewiesen');
    }
    setGrund('');
    toast.success(
      verborgen
        ? `Runde #${nummer} steht wieder in der Hall of Fame.`
        : `Runde #${nummer} ist aus der Hall of Fame genommen.`,
    );
    router.refresh();
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOffen(true)}
        disabled={laeuft}
        title={verborgen ? 'In die Hall of Fame zurückholen' : 'Aus der Hall of Fame nehmen'}
      >
        {laeuft ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : verborgen ? (
          <Eye className="size-4" aria-hidden="true" />
        ) : (
          <EyeOff className="size-4" aria-hidden="true" />
        )}
        <span className="sr-only">
          Runde #{nummer} {verborgen ? 'in die Hall of Fame zurückholen' : 'aus der Hall of Fame nehmen'}
        </span>
      </Button>

      <ConfirmationDialog
        open={offen}
        onOpenChange={(auf) => {
          setOffen(auf);
          if (!auf) {
            setGrund('');
          }
        }}
        title={
          verborgen
            ? `Runde #${nummer} zurück in die Hall of Fame?`
            : `Runde #${nummer} aus der Hall of Fame nehmen?`
        }
        confirmLabel={verborgen ? 'Zurückholen' : 'Herausnehmen'}
        description={
          verborgen
            ? 'Die Runde erscheint wieder in der Rückschau, und ihre Ergebnisseite ist wieder für alle erreichbar.'
            : 'Die Runde verschwindet aus der Rückschau, und ihre Ergebnisseite ist für Mitglieder nicht mehr erreichbar. Einreichungen, Stimmen und Platzierungen bleiben bestehen - die Bilanz der Mitglieder ändert sich nicht. Der Schritt lässt sich jederzeit zurücknehmen.'
        }
        onConfirm={() => void schalte()}
      >
        {verborgen ? null : (
          <div className="space-y-1.5">
            <Label htmlFor={`hof-grund-${competitionId}`}>Grund (fürs Protokoll, optional)</Label>
            <Input
              id={`hof-grund-${competitionId}`}
              value={grund}
              onChange={(ereignis) => setGrund(ereignis.target.value)}
              maxLength={300}
            />
          </div>
        )}
      </ConfirmationDialog>
    </>
  );
}
