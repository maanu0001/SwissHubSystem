import type { Metadata } from 'next';
import Link from 'next/link';
import { Dices, Swords, Users, Vote } from 'lucide-react';
import { resolveGuildId } from '@swisshub/discord';
import { isModuleEnabled, spielwahl } from '@swisshub/modules';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { ErrorState } from '@/components/shared/states';
import { Schnellstart } from '@/modules/spielwahl/components/schnellstart';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { ladeOffeneRunden, ladeVergangeneRunden, type RundeInListe } from '@/server/spielwahl';
import { cn } from '@/lib/utils';
import '@/modules/spielwahl/spielwahl.css';

export const metadata: Metadata = {
  title: 'Was spielen wir?',
  description: 'Gemeinsam entscheiden, was heute Abend läuft.',
};
export const dynamic = 'force-dynamic';

/**
 * Die Übersicht.
 *
 * Oben der eine Knopf, der zählt. Darunter, was gerade läuft - denn wer am
 * Freitagabend hier landet, will meistens nicht eine eigene Runde eröffnen,
 * sondern der beitreten, die schon offen ist.
 */
export default async function SpielwahlPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(spielwahl.SPIELWAHL_PERMISSIONS.view);

  if (!(await isModuleEnabled(spielwahl.SPIELWAHL_MODULE_ID))) {
    return <ErrorState title="Nicht verfügbar" description="«Was spielen wir?» ist derzeit ausgeschaltet." />;
  }

  const guildId = await resolveGuildId();
  const [offene, vergangene] = await Promise.all([
    ladeOffeneRunden(guildId, context.user.discordId),
    ladeVergangeneRunden(guildId, context.user.discordId),
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-10">
      <Schnellstart csrfToken={csrfTokenFor(context)} />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Läuft gerade
        </h2>
        {offene.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
            Keine offene Runde. Mach die erste auf - das dauert zwei Sekunden.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {offene.map((runde) => (
              <li key={runde.id}>
                <Rundenkarte runde={runde} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {vergangene.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Was ihr zuletzt gespielt habt
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {vergangene.map((runde) => (
              <li
                key={runde.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{runde.ergebnisName ?? '—'}</span>
                  <span className="block text-xs text-muted-foreground">
                    {new Date(runde.createdAt).toLocaleDateString('de-CH', {
                      day: '2-digit',
                      month: 'short',
                    })}{' '}
                    · {runde.teilnehmer} dabei
                  </span>
                </span>
                <ModusSymbol modus={runde.modus} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

const STATUS_FARBE: Record<string, string> = {
  LOBBY: 'bg-emerald-500/15 text-emerald-300',
  BEREIT: 'bg-amber-500/15 text-amber-300',
  ENTSCHEIDUNG: 'bg-[hsl(var(--primary)/0.25)] text-[hsl(var(--primary-bright))]',
  ERGEBNIS: 'bg-sky-500/15 text-sky-300',
};

function Rundenkarte({ runde }: { runde: RundeInListe }): React.JSX.Element {
  /*
   * Wer dabei ist, geht ueber den Einladungswert - das ist die Adresse, die
   * er ohnehin schon hat. Wer nicht dabei ist, geht ueber die Kennung; die
   * Seite dahinter erkennt beides.
   */
  const ziel = `/was-spielen-wir/${runde.binDabei && runde.inviteToken ? runde.inviteToken : runde.id}`;

  return (
    <Link
      href={ziel}
      className={cn(
        'group flex h-full flex-col gap-3 rounded-2xl border border-border bg-card p-4 transition',
        'hover:-translate-y-0.5 hover:border-[hsl(var(--primary)/0.5)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <DiscordAvatar
            discordId={runde.hostDiscordId}
            avatarHash={runde.hostAvatar}
            name={runde.hostName}
            size={32}
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{runde.hostName}</p>
            <p className="text-xs text-muted-foreground">{runde.binHost ? 'deine Runde' : 'lädt ein'}</p>
          </div>
        </div>
        <span
          className={cn(
            'shrink-0 rounded-full px-2.5 py-1 text-[0.65rem] font-bold uppercase tracking-wide',
            STATUS_FARBE[runde.status] ?? 'bg-muted text-muted-foreground',
          )}
        >
          {spielwahl.STATUS_TEXT[runde.status]}
        </span>
      </div>

      <div className="mt-auto flex items-center gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Users className="size-3.5" aria-hidden="true" />
          {runde.teilnehmer}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <ModusSymbol modus={runde.modus} />
          {spielwahl.MODUS_TEXT[runde.modus]}
        </span>
        <span>{runde.kandidaten} Spiele</span>
      </div>
    </Link>
  );
}

function ModusSymbol({ modus }: { modus: RundeInListe['modus'] }): React.JSX.Element {
  const Symbol = modus === 'ROULETTE' ? Dices : modus === 'VOTING' ? Vote : Swords;
  return <Symbol className="size-3.5" aria-hidden="true" />;
}
