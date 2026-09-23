'use client';

import { useState } from 'react';
import {
  Bot,
  CalendarDays,
  Clapperboard,
  ChevronDown,
  ExternalLink,
  FileCog,
  Gamepad2,
  KeyRound,
  LifeBuoy,
  Megaphone,
  Plug,
  Server,
  ShieldAlert,
  Sliders,
  Trophy,
  UserCheck,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { formatDateTime } from '@swisshub/shared';
import type { PersonImLog } from '@swisshub/modules';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { AuditKategorieId, AuditKontext } from './kontext';

/**
 * Ein Audit-Eintrag als Zeile.
 *
 * ## Was sie beantworten soll
 *
 *   WER → WAS → WEM/WORAN → WANN → und wohin kann ich springen?
 *
 * In genau dieser Reihenfolge, und in einem Blick. Vorher stand da ein
 * Symbol, ein Aktionsschluessel, ein Benutzername und «Ziel:
 * 123456789012345678» - alles vorhanden, nichts lesbar.
 *
 * ## Warum eine Zeile und keine Karte
 *
 * Ein Audit Log wird gelesen, indem man es ueberfliegt. Karten mit Rahmen und
 * Abstand darum zwingen zum Scrollen und machen aus fuenfundzwanzig
 * Eintraegen fuenf Bildschirme. Die Dichte ist hier eine Funktion, keine
 * Sparsamkeit.
 *
 * ## Auf dem Telefon
 *
 * Dieselbe Zeile, umbrochen statt abgeschnitten: der Zeitpunkt rutscht unter
 * die Beteiligten, die Knoepfe darunter. Keine Tabelle, die quer gescrollt
 * werden muss.
 */

const SYMBOL: Record<AuditKategorieId, typeof Users> = {
  auth: KeyRound,
  moderation: ShieldAlert,
  tickets: LifeBuoy,
  verifikation: UserCheck,
  level: Gamepad2,
  automation: Bot,
  kalender: CalendarDays,
  turniere: Trophy,
  kommunikation: Megaphone,
  integrationen: Plug,
  migration: FileCog,
  einstellungen: Sliders,
  mitglieder: Users,
  clips: Clapperboard,
  system: Server,
};

export interface AuditZeileDaten {
  id: string;
  createdAt: Date;
  action: string;
  module: string | null;
  actorDiscordId: string | null;
  actorUsername: string | null;
  targetDiscordId: string | null;
  targetLabel: string | null;
  success: boolean;
  errorCode: string | null;
  metadata: unknown;
}

export function AuditZeile({
  eintrag,
  kontext,
  personen,
  darfRohdatenSehen,
}: {
  eintrag: AuditZeileDaten;
  kontext: AuditKontext;
  personen: Record<string, PersonImLog>;
  /** Rohdaten nur für die Verwaltung - sie können Namen und Gründe enthalten. */
  darfRohdatenSehen: boolean;
}): React.JSX.Element {
  const [offen, setOffen] = useState(false);
  const Symbol = SYMBOL[kontext.kategorie.id];

  const actor = eintrag.actorDiscordId ? personen[eintrag.actorDiscordId] : undefined;
  const target = eintrag.targetDiscordId ? personen[eintrag.targetDiscordId] : undefined;

  return (
    <li className="border-b border-border/50 last:border-0">
      <div className="flex items-start gap-3 py-3">
        <span
          className={cn(
            'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border',
            eintrag.success
              ? 'border-border bg-secondary/60 text-muted-foreground'
              : 'border-destructive/40 bg-destructive/10 text-destructive',
          )}
          aria-hidden="true"
        >
          <Symbol className="size-4" />
        </span>

        <div className="min-w-0 flex-1 space-y-1.5">
          {/* Zeile 1: was ist passiert. */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium leading-tight">{kontext.label}</span>
            <Badge variant="outline" className="shrink-0">
              {kontext.kategorie.label}
            </Badge>
            {!eintrag.success ? (
              <Badge variant="destructive" className="shrink-0">
                {eintrag.errorCode ?? 'Fehlgeschlagen'}
              </Badge>
            ) : null}
          </div>

          {/* Zeile 2: wer, an wem. */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <Person person={actor} ersatzName={eintrag.actorUsername} kennung={eintrag.actorDiscordId} />
            {target || eintrag.targetLabel ? (
              <>
                <span className="text-muted-foreground" aria-hidden="true">
                  →
                </span>
                <Person person={target} ersatzName={eintrag.targetLabel} kennung={eintrag.targetDiscordId} />
              </>
            ) : null}
          </div>

          {/* Zeile 3: was sich geändert hat. */}
          {kontext.aenderungen.length > 0 ? (
            <ul className="space-y-0.5 text-xs text-muted-foreground">
              {kontext.aenderungen.map((aenderung) => (
                <li key={aenderung.feld} className="flex flex-wrap items-center gap-1.5">
                  <span>{aenderung.feld}:</span>
                  {aenderung.vorher ? (
                    <code className="rounded bg-destructive/10 px-1 text-destructive">
                      {aenderung.vorher}
                    </code>
                  ) : null}
                  {aenderung.vorher && aenderung.nachher ? <span aria-hidden="true">→</span> : null}
                  {aenderung.nachher ? (
                    <code className="rounded bg-success/10 px-1 text-success">{aenderung.nachher}</code>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          {/* Zeile 4: wohin. */}
          {kontext.links.length > 0 || darfRohdatenSehen ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5 text-xs">
              {kontext.links.map((link) =>
                link.extern ? (
                  <a
                    key={link.href}
                    href={link.href}
                    target="_blank"
                    rel="noreferrer noopener"
                    // Zurückhaltend: eine rote Linkspalte über fünfundzwanzig
                    // Zeilen wäre eine rote Fläche, kein Akzent.
                    className="inline-flex items-center gap-1 text-foreground/75 underline-offset-2 hover:text-primary-bright hover:underline"
                  >
                    {link.label}
                    <ExternalLink className="size-3" aria-hidden="true" />
                  </a>
                ) : (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="text-foreground/75 underline-offset-2 hover:text-primary-bright hover:underline"
                  >
                    {link.label}
                  </Link>
                ),
              )}
              {darfRohdatenSehen ? (
                <button
                  type="button"
                  onClick={() => setOffen((vorher) => !vorher)}
                  aria-expanded={offen}
                  className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                >
                  Details
                  <ChevronDown
                    className={cn('size-3 transition-transform', offen && 'rotate-180')}
                    aria-hidden="true"
                  />
                </button>
              ) : null}
            </div>
          ) : null}

          {offen ? <Details eintrag={eintrag} /> : null}
        </div>

        <time
          dateTime={eintrag.createdAt.toISOString()}
          title={eintrag.createdAt.toISOString()}
          className="hidden shrink-0 whitespace-nowrap pt-0.5 text-xs tabular-nums text-muted-foreground sm:block"
        >
          {formatDateTime(eintrag.createdAt)}
        </time>
      </div>

      {/* Auf schmalen Geräten steht der Zeitpunkt unten statt rechts. */}
      <time
        dateTime={eintrag.createdAt.toISOString()}
        className="block pb-3 pl-11 text-xs tabular-nums text-muted-foreground sm:hidden"
      >
        {formatDateTime(eintrag.createdAt)}
      </time>
    </li>
  );
}

/**
 * Eine Person - mit Bild und Namen, nicht als Kennung.
 *
 * Die Kennung bleibt erreichbar: sie steht im Titel und damit im Tooltip. Wer
 * sie braucht, findet sie; wer das Log liest, muss sie nicht lesen.
 */
function Person({
  person,
  ersatzName,
  kennung,
}: {
  person: PersonImLog | undefined;
  ersatzName: string | null;
  kennung: string | null;
}): React.JSX.Element {
  if (!person && !ersatzName && !kennung) {
    return <span className="text-muted-foreground">System</span>;
  }

  // Ohne aufgelöste Person: der Name von damals, sonst die Kennung. Ein
  // historischer Eintrag bleibt dadurch lesbar, auch wenn die Person längst
  // weg ist.
  const name = person?.displayName ?? ersatzName ?? 'Ehemaliges Mitglied';

  return (
    <span className="inline-flex min-w-0 items-center gap-1.5" title={kennung ?? undefined}>
      {kennung ? (
        <DiscordAvatar discordId={kennung} avatarHash={person?.avatarHash} name={name} size={20} />
      ) : null}
      <span className={cn('truncate', person?.ehemalig && 'text-muted-foreground')}>{name}</span>
      {person?.ehemalig ? <span className="shrink-0 text-xs text-muted-foreground">(ehemalig)</span> : null}
    </span>
  );
}

/** Die technischen Angaben - eingeklappt, weil sie selten gebraucht werden. */
function Details({ eintrag }: { eintrag: AuditZeileDaten }): React.JSX.Element {
  const zeilen: Array<[string, string]> = [
    ['Aktion', eintrag.action],
    ...(eintrag.module ? ([['Modul', eintrag.module]] as Array<[string, string]>) : []),
    ...(eintrag.actorDiscordId ? ([['Handelnder', eintrag.actorDiscordId]] as Array<[string, string]>) : []),
    ...(eintrag.targetDiscordId ? ([['Ziel', eintrag.targetDiscordId]] as Array<[string, string]>) : []),
    ['Zeitpunkt', eintrag.createdAt.toISOString()],
  ];

  const roh =
    eintrag.metadata && typeof eintrag.metadata === 'object'
      ? JSON.stringify(eintrag.metadata, null, 2)
      : null;

  return (
    <div className="mt-2 space-y-2 rounded-md border border-border/60 bg-background/60 p-3 text-xs">
      <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
        {zeilen.map(([name, wert]) => (
          <div key={name} className="contents">
            <dt className="text-muted-foreground">{name}</dt>
            <dd className="break-all font-mono">{wert}</dd>
          </div>
        ))}
      </dl>
      {roh && roh !== '{}' ? (
        <pre className="max-h-64 overflow-auto rounded bg-secondary/60 p-2 font-mono text-[11px] leading-relaxed scrollbar-slim">
          {roh}
        </pre>
      ) : null}
    </div>
  );
}
