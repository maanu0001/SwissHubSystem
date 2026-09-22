'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Bell,
  CalendarDays,
  Check,
  Gavel,
  ShieldCheck,
  Ticket,
  type LucideIcon,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { markiereAlleGelesenAction, markiereGelesenAction } from '@/modules/notifications/actions';
import { cn } from '@/lib/utils';

export interface GlockenEintragAnsicht {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  route: string | null;
  count: number;
  gelesen: boolean;
  createdAt: string;
}

export interface NotificationBellProps {
  eintraege: GlockenEintragAnsicht[];
  ungelesen: number;
  csrfToken: string;
  /**
   * Während einer Vorschau bleibt die Glocke stumm.
   *
   * Nicht aus Bequemlichkeit: persönliche Benachrichtigungen sind ein
   * Posteingang. Sie in einer Vorschau zu zeigen - ob die der Vorschau-Person
   * oder die eigenen - wäre entweder ein Datenschutzproblem oder eine
   * Vorschau, die etwas zeigt, das die Person so nie sähe.
   */
  vorschauAktiv?: boolean;
}

/** Symbol je Art. Unbekannte Arten bekommen die Glocke selbst. */
const SYMBOLE: Record<string, LucideIcon> = {
  'ticket.neu': Ticket,
  'verifikation.offen': ShieldCheck,
  'automation.fehler': AlertTriangle,
  'appeal.eskaliert': Gavel,
  'kalender.anmeldung': CalendarDays,
};

/** «vor 5 Min.» - kurz genug für eine Zeile. */
function seit(iso: string): string {
  const minuten = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minuten < 1) {
    return 'gerade eben';
  }
  if (minuten < 60) {
    return `vor ${minuten} Min.`;
  }
  const stunden = Math.round(minuten / 60);
  if (stunden < 24) {
    return `vor ${stunden} Std.`;
  }
  const tage = Math.round(stunden / 24);
  return tage === 1 ? 'gestern' : `vor ${tage} Tagen`;
}

/**
 * Die Glocke in der Kopfzeile.
 *
 * Sie zeigt ausschliesslich die Meldungen der angemeldeten Person. Wer eine
 * Meldung öffnet, markiert sie damit als gelesen - das ist die Handlung, die
 * «gelesen» bedeutet, und sie braucht keinen zweiten Klick.
 *
 * Ein Deep Link darin ist Navigation, keine Berechtigung: die Zielseite prüft
 * weiterhin selbst. Verlor jemand zwischen Meldung und Klick das Recht,
 * bekommt er dort dieselbe Antwort wie jeder andere ohne Berechtigung.
 */
export function NotificationBell({
  eintraege,
  ungelesen,
  csrfToken,
  vorschauAktiv = false,
}: NotificationBellProps): React.JSX.Element {
  const router = useRouter();
  const [offen, setOffen] = useState(false);
  const [, starte] = useTransition();

  if (vorschauAktiv) {
    return (
      <button
        type="button"
        disabled
        aria-label="Persönliche Benachrichtigungen werden in der Vorschau nicht angezeigt."
        title="Persönliche Benachrichtigungen werden in der Vorschau nicht angezeigt."
        className="relative rounded-xl border border-transparent p-2 text-muted-foreground opacity-50"
      >
        <Bell className="size-5" aria-hidden="true" />
      </button>
    );
  }

  function oeffne(eintrag: GlockenEintragAnsicht): void {
    if (eintrag.gelesen) {
      return;
    }
    starte(() => {
      void markiereGelesenAction({ csrfToken, id: eintrag.id }).then(() => router.refresh());
    });
  }

  function alleGelesen(): void {
    starte(() => {
      void markiereAlleGelesenAction({ csrfToken }).then(() => router.refresh());
    });
  }

  return (
    <DropdownMenu open={offen} onOpenChange={setOffen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="relative rounded-xl border border-transparent p-2 text-muted-foreground transition-colors hover:border-border hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={ungelesen > 0 ? `Benachrichtigungen, ${ungelesen} ungelesen` : 'Benachrichtigungen'}
        >
          <Bell className="size-5" aria-hidden="true" />
          {ungelesen > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex min-w-[1.25rem] items-center justify-center rounded-full bg-primary px-1 text-[0.65rem] font-semibold leading-5 text-primary-foreground">
              {ungelesen > 99 ? '99+' : ungelesen}
            </span>
          ) : null}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-[22rem] max-w-[calc(100vw-2rem)] p-0">
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <DropdownMenuLabel className="p-0">Benachrichtigungen</DropdownMenuLabel>
          {ungelesen > 0 ? (
            <Button variant="ghost" size="sm" onClick={alleGelesen}>
              <Check aria-hidden="true" />
              Alle gelesen
            </Button>
          ) : null}
        </div>
        <DropdownMenuSeparator className="m-0" />

        {eintraege.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            Nichts Neues. Hier erscheint, was auf dich wartet.
          </p>
        ) : (
          <ul className="max-h-[22rem] overflow-y-auto scrollbar-slim">
            {eintraege.map((eintrag) => {
              const Symbol = SYMBOLE[eintrag.kind] ?? Bell;
              const inhalt = (
                <>
                  <span
                    className={cn(
                      'mt-0.5 shrink-0 rounded-lg p-1.5',
                      eintrag.gelesen ? 'bg-muted text-muted-foreground' : 'bg-primary/15 text-primary',
                    )}
                  >
                    <Symbol className="size-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className={cn('min-w-0 truncate text-sm', !eintrag.gelesen && 'font-semibold')}>
                        {eintrag.title}
                      </span>
                      {eintrag.count > 1 ? (
                        <span className="shrink-0 rounded bg-muted px-1 text-[0.65rem] font-medium tabular-nums text-muted-foreground">
                          {eintrag.count}×
                        </span>
                      ) : null}
                    </span>
                    {eintrag.body ? (
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {eintrag.body}
                      </span>
                    ) : null}
                    <span className="mt-0.5 block text-[0.68rem] text-muted-foreground">
                      {seit(eintrag.createdAt)}
                    </span>
                  </span>
                  {!eintrag.gelesen ? (
                    <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                  ) : null}
                </>
              );

              const klassen = cn(
                'flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-accent/60',
                !eintrag.gelesen && 'bg-primary/[0.04]',
              );

              return (
                <li key={eintrag.id} className="border-b border-border/50 last:border-0">
                  {eintrag.route ? (
                    <Link
                      href={eintrag.route}
                      className={klassen}
                      onClick={() => {
                        oeffne(eintrag);
                        setOffen(false);
                      }}
                    >
                      {inhalt}
                    </Link>
                  ) : (
                    <button type="button" className={klassen} onClick={() => oeffne(eintrag)}>
                      {inhalt}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
