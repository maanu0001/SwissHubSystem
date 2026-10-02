import type { WorkspacePriority, WorkspaceProjectStatus, WorkspaceTaskStatus } from '@swisshub/database';
import { workspace } from '@swisshub/modules';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { cn } from '@/lib/utils';
import {
  AUFGABEN_STATUS_LABEL,
  FAELLIGKEIT_FARBE,
  PRIORITAET_FARBE,
  PRIORITAET_LABEL,
  PROJEKT_STATUS_LABEL,
  STATUS_FARBE,
  fristText,
} from '../labels';
import type { Teammitglied } from '../daten';

/**
 * Die kleinen Teile, aus denen die Listen bestehen.
 *
 * Alle serverseitig gerendert - sie haben keinen Zustand. Ein Abzeichen, das
 * eine Client-Komponente wäre, käme mit eigenem JavaScript in jede Liste, in
 * der es dreissigmal vorkommt.
 */

const BASIS = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium';

export function StatusAbzeichen({ status }: { status: WorkspaceTaskStatus }): React.JSX.Element {
  return <span className={cn(BASIS, STATUS_FARBE[status])}>{AUFGABEN_STATUS_LABEL[status]}</span>;
}

export function ProjektStatusAbzeichen({ status }: { status: WorkspaceProjectStatus }): React.JSX.Element {
  const farbe: Record<WorkspaceProjectStatus, string> = {
    PLANNED: 'bg-secondary text-secondary-foreground',
    ACTIVE: 'bg-success/15 text-success',
    PAUSED: 'bg-warning/15 text-warning',
    COMPLETED: 'bg-primary/15 text-primary',
    ARCHIVED: 'bg-muted text-muted-foreground',
  };
  return <span className={cn(BASIS, farbe[status])}>{PROJEKT_STATUS_LABEL[status]}</span>;
}

/**
 * Die Priorität - und bei «Normal» gar nichts.
 *
 * Ein Abzeichen an jeder Zeile ist kein Hinweis mehr. Sichtbar ist, was vom
 * Normalfall abweicht.
 */
export function PrioritaetAbzeichen({
  prioritaet,
}: {
  prioritaet: WorkspacePriority;
}): React.JSX.Element | null {
  const farbe = PRIORITAET_FARBE[prioritaet];
  if (!farbe) {
    return null;
  }
  return <span className={cn(BASIS, farbe)}>{PRIORITAET_LABEL[prioritaet]}</span>;
}

/**
 * Die Frist - abgestuft gefärbt.
 *
 * Die Stufe kommt aus `faelligkeitsstufe` im Modulkern, also aus derselben
 * Rechnung wie die Zahlen der Übersicht. Zwei Vorstellungen davon, was «bald»
 * heisst, wären eine Liste, die anders zählt als die Kachel darüber.
 */
export function Frist({
  dueAt,
  jetzt,
  baldTage,
  className,
}: {
  dueAt: Date | null;
  jetzt: Date;
  baldTage: number;
  className?: string;
}): React.JSX.Element | null {
  if (!dueAt) {
    return null;
  }
  const stufe = workspace.faelligkeitsstufe(dueAt, jetzt, baldTage);
  const text = stufe === 'heute' ? 'heute fällig' : fristText(dueAt);
  return (
    <span className={cn('text-xs tabular-nums', FAELLIGKEIT_FARBE[stufe], className)}>
      {stufe === 'ueberfaellig' ? `überfällig · ${fristText(dueAt)}` : text}
    </span>
  );
}

/**
 * Die Zuständigen als Avatarreihe.
 *
 * Höchstens vier, danach eine Zahl: fünf Bilder nebeneinander sind auf einer
 * Karte breiter als ihr Titel.
 */
export function Zustaendige({
  kennungen,
  namen,
  max = 4,
}: {
  kennungen: readonly string[];
  namen: Map<string, Teammitglied>;
  max?: number;
}): React.JSX.Element {
  if (kennungen.length === 0) {
    return <span className="text-xs text-muted-foreground">niemand zuständig</span>;
  }
  const sichtbar = kennungen.slice(0, max);
  const weitere = kennungen.length - sichtbar.length;
  return (
    <span className="flex items-center gap-1">
      {sichtbar.map((discordId) => {
        const person = namen.get(discordId);
        return (
          <DiscordAvatar
            key={discordId}
            discordId={discordId}
            avatarHash={person?.avatarHash ?? null}
            name={person?.name ?? discordId}
            size={24}
            ring={false}
          />
        );
      })}
      {weitere > 0 ? <span className="text-xs text-muted-foreground">+{weitere}</span> : null}
    </span>
  );
}

/** Der Fortschritt eines Projekts - als Balken mit Zahl daneben. */
export function Fortschrittsbalken({
  fortschritt,
}: {
  fortschritt: workspace.Fortschritt;
}): React.JSX.Element {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {fortschritt.erledigt} von {fortschritt.gesamt} {fortschritt.gesamt === 1 ? 'Aufgabe' : 'Aufgaben'}
        </span>
        <span className="tabular-nums">{fortschritt.prozent}%</span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-secondary"
        role="progressbar"
        aria-valuenow={fortschritt.prozent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Fortschritt"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${fortschritt.prozent}%` }}
        />
      </div>
    </div>
  );
}

/** Die Checkliste als Zahl - weggelassen, wenn es keine gibt. */
export function ChecklisteZahl({
  gesamt,
  offen,
}: {
  gesamt: number;
  offen: number;
}): React.JSX.Element | null {
  if (gesamt === 0) {
    return null;
  }
  return (
    <span className="text-xs tabular-nums text-muted-foreground">
      {gesamt - offen}/{gesamt}
    </span>
  );
}

export function Tags({ tags }: { tags: readonly string[] }): React.JSX.Element | null {
  if (tags.length === 0) {
    return null;
  }
  return (
    <span className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <span key={tag} className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
          {tag}
        </span>
      ))}
    </span>
  );
}
