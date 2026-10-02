'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import type {
  WorkspacePriority,
  WorkspaceProject,
  WorkspaceReminder,
  WorkspaceTask,
} from '@swisshub/database';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { ERINNERUNG_LABEL, PRIORITAET_LABEL, datumFuerFeld } from '../labels';
import { workspaceAufgabeAendernAction, workspaceAufgabeErstellenAction } from '../actions';
import type { Teammitglied } from '../daten';

/**
 * Eine Aufgabe anlegen oder bearbeiten.
 *
 * ## Warum ein Formular für beides
 *
 * Weil die Felder dieselben sind. Zwei Formulare wären zwei Stellen, an denen
 * ein neues Feld auftauchen müsste - und eine davon würde es vergessen.
 * Der Unterschied steckt in einem `taskId`: ohne anlegen, mit ändern.
 *
 * ## Was das Formular **nicht** kann
 *
 * Den Status setzen. Der gehört aufs Board und auf die Detailseite, wo der
 * alte Status mitgeschickt wird - ein Formular, das ihn blind überschreibt,
 * wäre genau die verlorene Nebenläufigkeitsprüfung.
 *
 * ## Zuständige
 *
 * Die Auswahl ist eine Liste mit Kästchen und kein Suchfeld: das Team ist
 * klein, und eine Suche über acht Namen ist ein Feld mehr zum Ausfüllen. Wer
 * angeboten wird, entscheidet der Server - es sind die Träger von
 * `workspace.view`, also die, die die Aufgabe hinterher auch sehen.
 */

const PRIORITAETEN: WorkspacePriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
const ERINNERUNGEN: WorkspaceReminder[] = ['NONE', 'ON_DUE_DATE', 'ONE_DAY', 'THREE_DAYS', 'ONE_WEEK'];

export interface AufgabeFormularProps {
  csrfToken: string;
  projekte: Array<Pick<WorkspaceProject, 'id' | 'title'>>;
  team: Teammitglied[];
  /** Vorbelegtes Projekt - auf einer Projektseite ist es das Projekt. */
  projektVorgabe?: string | null;
  /** Gesetzt: bearbeiten. Nicht gesetzt: anlegen. */
  aufgabe?: Pick<
    WorkspaceTask,
    'id' | 'title' | 'description' | 'projectId' | 'priority' | 'startAt' | 'dueAt' | 'reminder' | 'tags'
  >;
  zustaendigeVorgabe?: readonly string[];
  /** Beschriftung des öffnenden Knopfs. */
  knopf?: string;
  variante?: 'default' | 'outline';
}

export function AufgabeFormular({
  csrfToken,
  projekte,
  team,
  projektVorgabe = null,
  aufgabe,
  zustaendigeVorgabe = [],
  knopf,
  variante = 'default',
}: AufgabeFormularProps): React.JSX.Element {
  const router = useRouter();
  const [offen, setOffen] = useState(false);
  const [laeuft, starte] = useTransition();

  const bearbeiten = Boolean(aufgabe);
  const [titel, setTitel] = useState(aufgabe?.title ?? '');
  const [beschreibung, setBeschreibung] = useState(aufgabe?.description ?? '');
  const [projectId, setProjectId] = useState(aufgabe?.projectId ?? projektVorgabe ?? '');
  const [prioritaet, setPrioritaet] = useState<WorkspacePriority>(aufgabe?.priority ?? 'NORMAL');
  const [startAt, setStartAt] = useState(datumFuerFeld(aufgabe?.startAt ?? null));
  const [dueAt, setDueAt] = useState(datumFuerFeld(aufgabe?.dueAt ?? null));
  const [reminder, setReminder] = useState<WorkspaceReminder>(aufgabe?.reminder ?? 'NONE');
  const [tags, setTags] = useState((aufgabe?.tags ?? []).join(', '));
  const [zustaendige, setZustaendige] = useState<string[]>([...zustaendigeVorgabe]);

  const schalteZustaendig = (discordId: string): void => {
    setZustaendige((bisher) =>
      bisher.includes(discordId) ? bisher.filter((eintrag) => eintrag !== discordId) : [...bisher, discordId],
    );
  };

  const speichern = (): void => {
    if (titel.trim() === '') {
      toast.error('Die Aufgabe braucht einen Titel.');
      return;
    }
    starte(async () => {
      const gemeinsam = {
        csrfToken,
        titel: titel.trim(),
        beschreibung: beschreibung.trim() || null,
        // Leer heisst «kein Projekt» - und das ist ein zulässiger Zustand,
        // keine fehlende Eingabe.
        projectId: projectId || null,
        prioritaet,
        startAt: startAt || null,
        dueAt: dueAt || null,
        reminder,
        tags: tags
          .split(',')
          .map((tag) => tag.trim())
          .filter((tag) => tag !== ''),
      };

      const antwort = aufgabe
        ? await workspaceAufgabeAendernAction({ ...gemeinsam, taskId: aufgabe.id })
        : await workspaceAufgabeErstellenAction({ ...gemeinsam, zustaendige });

      if (!antwort.ok) {
        toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
        return;
      }
      setOffen(false);
      if (!aufgabe) {
        // Nach dem Anlegen zurücksetzen: der nächste Klick auf «Neue Aufgabe»
        // soll ein leeres Formular öffnen und nicht das letzte noch einmal.
        setTitel('');
        setBeschreibung('');
        setTags('');
        setZustaendige([]);
        setDueAt('');
      }
      toast.success(bearbeiten ? 'Aufgabe gespeichert.' : 'Aufgabe angelegt.');
      router.refresh();
    });
  };

  return (
    <Dialog open={offen} onOpenChange={setOffen}>
      <DialogTrigger asChild>
        <Button variant={variante} size="sm">
          {bearbeiten ? null : <Plus className="size-4" />}
          {knopf ?? (bearbeiten ? 'Bearbeiten' : 'Neue Aufgabe')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{bearbeiten ? 'Aufgabe bearbeiten' : 'Neue Aufgabe'}</DialogTitle>
          <DialogDescription>
            {bearbeiten
              ? 'Der Status wird hier nicht geändert - das geschieht auf dem Board.'
              : 'Eine Aufgabe braucht einen Titel. Alles andere kann warten.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ws-titel">Titel</Label>
            <Input
              id="ws-titel"
              value={titel}
              maxLength={160}
              onChange={(ereignis): void => setTitel(ereignis.target.value)}
              placeholder="Was ist zu tun?"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="ws-beschreibung">Beschreibung</Label>
            <textarea
              id="ws-beschreibung"
              value={beschreibung}
              maxLength={8000}
              rows={4}
              onChange={(ereignis): void => setBeschreibung(ereignis.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="Was dazugehört, was vorher geklärt sein muss …"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ws-projekt">Projekt</Label>
              <Select
                value={projectId || 'ohne'}
                onValueChange={(wert): void => setProjectId(wert === 'ohne' ? '' : wert)}
              >
                <SelectTrigger id="ws-projekt">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ohne">Kein Projekt</SelectItem>
                  {projekte.map((projekt) => (
                    <SelectItem key={projekt.id} value={projekt.id}>
                      {projekt.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ws-prio">Priorität</Label>
              <Select
                value={prioritaet}
                onValueChange={(wert): void => setPrioritaet(wert as WorkspacePriority)}
              >
                <SelectTrigger id="ws-prio">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITAETEN.map((wert) => (
                    <SelectItem key={wert} value={wert}>
                      {PRIORITAET_LABEL[wert]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ws-start">Start</Label>
              <Input
                id="ws-start"
                type="date"
                value={startAt}
                onChange={(ereignis): void => setStartAt(ereignis.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ws-frist">Frist</Label>
              <Input
                id="ws-frist"
                type="date"
                value={dueAt}
                onChange={(ereignis): void => setDueAt(ereignis.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ws-erinnerung">Erinnerung</Label>
            <Select value={reminder} onValueChange={(wert): void => setReminder(wert as WorkspaceReminder)}>
              <SelectTrigger id="ws-erinnerung">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ERINNERUNGEN.map((wert) => (
                  <SelectItem key={wert} value={wert}>
                    {ERINNERUNG_LABEL[wert]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {dueAt === '' && reminder !== 'NONE' ? (
              <p className="text-xs text-warning">Ohne Frist gibt es nichts, woran erinnert werden könnte.</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="ws-tags">Tags</Label>
            <Input
              id="ws-tags"
              value={tags}
              onChange={(ereignis): void => setTags(ereignis.target.value)}
              placeholder="turnier, cs2"
            />
            <p className="text-xs text-muted-foreground">
              Mit Komma getrennt, höchstens zehn. Gross- und Kleinschreibung spielt keine Rolle.
            </p>
          </div>

          {!bearbeiten && team.length > 0 ? (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Zuständig</legend>
              <div className="flex flex-wrap gap-2">
                {team.map((mitglied) => {
                  const gewaehlt = zustaendige.includes(mitglied.discordId);
                  return (
                    <label
                      key={mitglied.discordId}
                      className={cn(
                        'flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-3 text-sm transition-colors',
                        gewaehlt
                          ? 'border-primary bg-primary/10 text-foreground'
                          : 'border-border text-muted-foreground hover:text-foreground',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={gewaehlt}
                        onChange={(): void => schalteZustaendig(mitglied.discordId)}
                        className="sr-only"
                      />
                      {mitglied.name}
                    </label>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                Angeboten werden die, die den Workspace öffnen dürfen.
              </p>
            </fieldset>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={(): void => setOffen(false)} disabled={laeuft}>
            Abbrechen
          </Button>
          <Button onClick={speichern} disabled={laeuft}>
            {laeuft ? 'Wird gespeichert …' : bearbeiten ? 'Speichern' : 'Anlegen'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
