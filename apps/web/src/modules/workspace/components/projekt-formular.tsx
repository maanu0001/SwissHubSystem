'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import type { WorkspacePriority, WorkspaceProject, WorkspaceProjectStatus } from '@swisshub/database';
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
import { ChannelSelect } from '@/modules/configuration/components/channel-select';
import { RoleSelect } from '@/modules/configuration/components/role-select';
import type { ChannelOption, RoleOption } from '@/modules/configuration/components/discord-option-types';
import { PRIORITAET_LABEL, PROJEKT_STATUS_LABEL, datumFuerFeld } from '../labels';
import { workspaceProjektAendernAction, workspaceProjektErstellenAction } from '../actions';

/**
 * Ein Projekt anlegen oder bearbeiten.
 *
 * ## Warum «Archiviert» hier nicht zur Auswahl steht
 *
 * Weil Archivieren ein Vorgang ist und kein Wert in einer Liste: es setzt auch
 * `archivedAt` und den Archivierenden, und es hängt an einer eigenen,
 * eingriffsstarken Berechtigung. Über dieses Formular zu archivieren hiesse,
 * diese Berechtigung zu umgehen - der Server lässt es nicht zu, und eine
 * Auswahl anzubieten, die scheitert, ist schlechter als keine.
 *
 * ## Die Akzentfarbe
 *
 * Ein Farbwähler, nicht ein Textfeld. Was hereinkommt, wandelt der Server
 * ohnehin in `#rrggbb` oder `null` um; der Wähler sorgt dafür, dass niemand
 * etwas eingibt, das danach stillschweigend verschwindet.
 */

const STATUS: WorkspaceProjectStatus[] = ['PLANNED', 'ACTIVE', 'PAUSED', 'COMPLETED'];

/** Die drei Stufen - dieselben Werte wie im Schema. */
type Sichtbarkeit = 'TEAM' | 'SELECTED_GROUPS' | 'PRIVATE';
const PRIORITAETEN: WorkspacePriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

export function ProjektFormular({
  csrfToken,
  projekt,
  roles = [],
  channels = [],
}: {
  csrfToken: string;
  projekt?: Pick<
    WorkspaceProject,
    | 'id'
    | 'title'
    | 'description'
    | 'status'
    | 'priority'
    | 'accent'
    | 'startAt'
    | 'dueAt'
    | 'tags'
    | 'visibility'
    | 'visibleRoleIds'
    | 'discordChannelId'
  >;
  /** Fuer die Gruppenauswahl - dieselben Optionen wie in den Moduleinstellungen. */
  roles?: RoleOption[];
  /** Fuer den Projektkanal. */
  channels?: ChannelOption[];
}): React.JSX.Element {
  const router = useRouter();
  const [offen, setOffen] = useState(false);
  const [laeuft, starte] = useTransition();

  const bearbeiten = Boolean(projekt);
  const [titel, setTitel] = useState(projekt?.title ?? '');
  const [beschreibung, setBeschreibung] = useState(projekt?.description ?? '');
  const [status, setStatus] = useState<WorkspaceProjectStatus>(projekt?.status ?? 'PLANNED');
  const [prioritaet, setPrioritaet] = useState<WorkspacePriority | ''>(projekt?.priority ?? '');
  const [akzent, setAkzent] = useState(projekt?.accent ?? '');
  const [startAt, setStartAt] = useState(datumFuerFeld(projekt?.startAt ?? null));
  const [dueAt, setDueAt] = useState(datumFuerFeld(projekt?.dueAt ?? null));
  const [tags, setTags] = useState((projekt?.tags ?? []).join(', '));
  /*
   * Die Sichtbarkeit steht im Anlegen-Formular und nicht in einem zweiten
   * Schritt danach.
   *
   * Ein Projekt, das erst sichtbar entsteht und dann privat gestellt wird, war
   * dazwischen offen - und wer in dieser Zeit die Liste geladen hat, hat es
   * gesehen. Die Entscheidung gehoert also in dieselbe Maske wie der Titel.
   */
  const [sichtbarkeit, setSichtbarkeit] = useState<Sichtbarkeit>(projekt?.visibility ?? 'TEAM');
  const [gruppen, setGruppen] = useState<string[]>([...(projekt?.visibleRoleIds ?? [])]);
  const [kanal, setKanal] = useState(projekt?.discordChannelId ?? '');

  const speichern = (): void => {
    if (titel.trim() === '') {
      toast.error('Das Projekt braucht einen Titel.');
      return;
    }
    starte(async () => {
      const gemeinsam = {
        csrfToken,
        titel: titel.trim(),
        beschreibung: beschreibung.trim() || null,
        // `ARCHIVED` kommt hier nicht vor - siehe Kopf.
        status: status === 'ARCHIVED' ? 'PLANNED' : status,
        prioritaet: prioritaet === '' ? null : prioritaet,
        akzent: akzent || null,
        startAt: startAt || null,
        dueAt: dueAt || null,
        tags: tags
          .split(',')
          .map((tag) => tag.trim())
          .filter((tag) => tag !== ''),
        sichtbarkeit,
        // Nur bei «ausgewaehlte Gruppen» hat die Liste eine Bedeutung; sonst
        // leert der Server sie ohnehin.
        sichtbarFuerRollen: sichtbarkeit === 'SELECTED_GROUPS' ? gruppen : [],
        discordChannelId: kanal || null,
      } as const;

      const antwort = projekt
        ? await workspaceProjektAendernAction({ ...gemeinsam, projectId: projekt.id })
        : await workspaceProjektErstellenAction({ ...gemeinsam });

      if (!antwort.ok) {
        toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
        return;
      }
      setOffen(false);
      if (!projekt) {
        setTitel('');
        setBeschreibung('');
        setTags('');
      }
      toast.success(bearbeiten ? 'Projekt gespeichert.' : 'Projekt angelegt.');
      router.refresh();
    });
  };

  return (
    <Dialog open={offen} onOpenChange={setOffen}>
      <DialogTrigger asChild>
        <Button variant={bearbeiten ? 'outline' : 'default'} size="sm">
          {bearbeiten ? null : <Plus className="size-4" />}
          {bearbeiten ? 'Projekt bearbeiten' : 'Neues Projekt'}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{bearbeiten ? 'Projekt bearbeiten' : 'Neues Projekt'}</DialogTitle>
          <DialogDescription>
            {bearbeiten
              ? 'Zum Beenden gehört «Abgeschlossen»; ins Archiv legt es der eigene Knopf.'
              : 'Wer anlegt, leitet das Projekt - das lässt sich danach ändern.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ws-p-titel">Titel</Label>
            <Input
              id="ws-p-titel"
              value={titel}
              maxLength={120}
              onChange={(ereignis): void => setTitel(ereignis.target.value)}
              placeholder="Winter Cup 2026"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="ws-p-beschreibung">Beschreibung</Label>
            <textarea
              id="ws-p-beschreibung"
              value={beschreibung}
              maxLength={4000}
              rows={4}
              onChange={(ereignis): void => setBeschreibung(ereignis.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="Worum es geht, und woran man merkt, dass es fertig ist."
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ws-p-status">Status</Label>
              <Select
                value={status}
                onValueChange={(wert): void => setStatus(wert as WorkspaceProjectStatus)}
              >
                <SelectTrigger id="ws-p-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS.map((wert) => (
                    <SelectItem key={wert} value={wert}>
                      {PROJEKT_STATUS_LABEL[wert]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ws-p-prio">Priorität</Label>
              <Select
                value={prioritaet || 'ohne'}
                onValueChange={(wert): void =>
                  setPrioritaet(wert === 'ohne' ? '' : (wert as WorkspacePriority))
                }
              >
                <SelectTrigger id="ws-p-prio">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ohne">Ohne</SelectItem>
                  {PRIORITAETEN.map((wert) => (
                    <SelectItem key={wert} value={wert}>
                      {PRIORITAET_LABEL[wert]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ws-p-start">Start</Label>
              <Input
                id="ws-p-start"
                type="date"
                value={startAt}
                onChange={(ereignis): void => setStartAt(ereignis.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ws-p-ziel">Zieldatum</Label>
              <Input
                id="ws-p-ziel"
                type="date"
                value={dueAt}
                onChange={(ereignis): void => setDueAt(ereignis.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ws-p-akzent">Akzentfarbe</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="ws-p-akzent"
                  type="color"
                  value={akzent || '#83060a'}
                  onChange={(ereignis): void => setAkzent(ereignis.target.value)}
                  className="h-10 w-16 p-1"
                />
                {akzent ? (
                  <Button variant="ghost" size="sm" onClick={(): void => setAkzent('')}>
                    Zurücksetzen
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">Standardfarbe</span>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ws-p-tags">Tags</Label>
              <Input
                id="ws-p-tags"
                value={tags}
                onChange={(ereignis): void => setTags(ereignis.target.value)}
                placeholder="turnier, sponsoring"
              />
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Wer sieht das Projekt</legend>
              <Select
                value={sichtbarkeit}
                onValueChange={(wert): void => setSichtbarkeit(wert as Sichtbarkeit)}
              >
                <SelectTrigger aria-label="Sichtbarkeit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TEAM">Alle mit Workspace-Zugang</SelectItem>
                  <SelectItem value="SELECTED_GROUPS">Nur bestimmte Rollen</SelectItem>
                  <SelectItem value="PRIVATE">Nur die Projektmitglieder</SelectItem>
                </SelectContent>
              </Select>

              {sichtbarkeit === 'SELECTED_GROUPS' ? (
                /*
                Dieselbe Mechanik wie im Automation-Builder: `RoleSelect` waehlt
                eine Rolle, und die gewaehlten stehen als Chips darunter. Eine
                zweite Mehrfachauswahl zu bauen hiesse, zwei zu pflegen.
              */
                <div className="space-y-2">
                  <RoleSelect
                    id="ws-p-gruppen"
                    value=""
                    roles={roles.filter((rolle) => !gruppen.includes(rolle.id))}
                    onChange={(naechste): void => {
                      if (naechste) {
                        setGruppen((bisher) => [...bisher, naechste]);
                      }
                    }}
                    placeholder="Rolle hinzufügen"
                  />
                  {gruppen.length === 0 ? (
                    <p className="text-xs text-warning">
                      Noch keine Rolle gewählt - dann sehen es nur die Projektmitglieder.
                    </p>
                  ) : (
                    <ul className="flex flex-wrap gap-1.5">
                      {gruppen.map((rolleId) => (
                        <li key={rolleId}>
                          <button
                            type="button"
                            onClick={(): void =>
                              setGruppen((bisher) => bisher.filter((eintrag) => eintrag !== rolleId))
                            }
                            className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs transition-colors hover:border-destructive/60 hover:text-destructive"
                          >
                            {roles.find((eintrag) => eintrag.id === rolleId)?.name ?? rolleId}
                            <span aria-hidden="true">×</span>
                            <span className="sr-only">entfernen</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}

              <p className="text-xs text-muted-foreground">
                {sichtbarkeit === 'TEAM'
                  ? 'Projekt, Aufgaben und Kommentare sind für alle sichtbar, die den Workspace öffnen dürfen.'
                  : sichtbarkeit === 'SELECTED_GROUPS'
                    ? 'Die Projektmitglieder sehen es immer - zusätzlich alle mit einer dieser Rollen.'
                    : 'Nur die Projektmitglieder. Auch Aufgaben, Kommentare und Anhänge bleiben verborgen.'}
              </p>
            </fieldset>

            <div className="space-y-2">
              <Label htmlFor="ws-p-kanal">Discord-Kanal</Label>
              <ChannelSelect
                id="ws-p-kanal"
                channels={channels}
                value={kanal}
                onChange={(naechster): void => setKanal(naechster ?? '')}
                placeholder="Kein Kanal"
              />
              <p className="text-xs text-muted-foreground">
                Neue und erledigte Aufgaben sowie erreichte Meilensteine gehen als Embed dorthin. Ohne Kanal
                passiert nichts.
              </p>
            </div>
          </div>
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
