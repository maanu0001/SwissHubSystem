import type { Metadata } from 'next';
import Link from 'next/link';
import { Dices, LogIn, Swords, Users, Vote } from 'lucide-react';
import { can } from '@swisshub/auth';
import { resolveGuildId } from '@swisshub/discord';
import { isModuleEnabled, spielwahl } from '@swisshub/modules';
import { branding } from '@swisshub/config/client';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { ErrorState } from '@/components/shared/states';
import { buttonVariants } from '@/components/ui/button';
import { Schnellstart } from '@/modules/spielwahl/components/schnellstart';
import { csrfTokenFor, getOptionalAuthContext } from '@/server/auth';
import { ladeOffeneRunden, ladeVergangeneRunden, type RundeInListe } from '@/server/spielwahl';
import { cn } from '@/lib/utils';
import '@/modules/spielwahl/spielwahl.css';

export const metadata: Metadata = {
  title: 'Was spielen wir?',
  description: 'Gemeinsam entscheiden, was heute Abend läuft.',
  /*
   * Nicht indexieren - wie die Bühne daneben.
   *
   * Die Seite ist offen, aber sie ist kein Aushang: was hier steht, ist der
   * Freitagabend einer bestimmten Gemeinschaft, und wer eine Runde sucht,
   * kommt über Discord und nicht über eine Suchmaschine.
   */
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

/**
 * Die Übersicht - und zwar für jeden.
 *
 * Oben der eine Knopf, der zählt. Darunter, was gerade läuft - denn wer am
 * Freitagabend hier landet, will meistens nicht eine eigene Runde eröffnen,
 * sondern der beitreten, die schon offen ist.
 *
 * ## Warum sie nicht mehr in `(app)` liegt
 *
 * Weil sie dort hinter der Anmeldung lag, und das war der halbe Weg: die
 * Bühne `/was-spielen-wir/<token>` wurde öffentlich, diese Seite nicht. Wer
 * die Adresse ohne Einladungswert aufrief - und das tut jeder, der sie
 * eintippt oder dem Link im Kopfbereich folgt -, landete auf der Anmeldung.
 *
 * Jetzt liegt sie neben `(app)` wie die Bühne, das öffentliche Profil und die
 * Rangliste. Nur der Spielkatalog bleibt drinnen; einen Katalog pflegt man
 * nicht als Gast.
 *
 * ## Was ein Gast sieht - und was nicht
 *
 * Er sieht, **dass** etwas läuft, und kommt auf die Bühne. Er sieht nicht:
 *
 *  - den **Schnellstart**. Eine Runde eröffnen ist eine Mitgliedssache, und
 *    die Server Action dahinter prüft das ohnehin selbst.
 *  - den **Einladungswert**. `ladeOffeneRunden` gibt ihn nur an Leute heraus,
 *    die in der Runde schon dabei sind - mit einem leeren Betrachter also an
 *    niemanden. Der Weg führt über die Kennung, und die Bühne lässt einen
 *    Gast nur über den Einladungswert mitmachen.
 *  - **«Was ihr zuletzt gespielt habt».** Diese Liste ist die eigene
 *    Vorgeschichte; ohne Identität gibt es keine.
 */
export default async function SpielwahlPage(): Promise<React.JSX.Element> {
  if (!(await isModuleEnabled(spielwahl.SPIELWAHL_MODULE_ID))) {
    return <ErrorState title="Nicht verfügbar" description="«Was spielen wir?» ist derzeit ausgeschaltet." />;
  }

  const context = await getOptionalAuthContext();
  /*
   * «Mitglied» heisst hier: angemeldet, auf dem Server und mit Leserecht.
   *
   * Dieselbe Prüfung wie die Bühne nebenan, und bewusst keine Weiterleitung:
   * wer sie nicht besteht, bekommt die öffentliche Ansicht statt einer
   * Anmeldemaske. Das ist der ganze Zweck der Seite.
   */
  const mitglied = context?.isMember && can(context, spielwahl.SPIELWAHL_PERMISSIONS.view) ? context : null;

  const guildId = await resolveGuildId();
  const [offene, vergangene] = await Promise.all([
    /*
     * Ein leerer Betrachter ist kein Platzhalter, sondern die Aussage.
     *
     * `baueListe` vergleicht ihn mit den Teilnehmerkennungen; eine
     * Discord-Kennung ist nie leer, also ist niemand «dabei» - und genau
     * deshalb bleibt der Einladungswert in jeder Zeile leer. Die Sperre sitzt
     * damit in der Ladefunktion und nicht in dieser Seite.
     */
    ladeOffeneRunden(guildId, mitglied?.user.discordId ?? ''),
    mitglied ? ladeVergangeneRunden(guildId, mitglied.user.discordId) : Promise.resolve([]),
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-10">
      {mitglied ? <Schnellstart csrfToken={csrfTokenFor(mitglied)} /> : <GastEinladung />}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Läuft gerade
        </h2>
        {offene.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
            {/* Einem Gast «mach die erste auf» zu sagen, waere ein Knopf, den
                er nicht hat. */}
            {mitglied
              ? 'Keine offene Runde. Mach die erste auf - das dauert zwei Sekunden.'
              : 'Gerade läuft keine Runde.'}
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

/**
 * Was ein Gast oben sieht, wo ein Mitglied den Schnellstart hat.
 *
 * Keine Anmeldewand, sondern eine Einladung: die Runden darunter sind
 * sichtbar, und wer nur zuschauen will, braucht hier nichts zu tun. Der Satz
 * sagt deshalb, was die Anmeldung **bringt**, und nicht, was ohne sie fehlt.
 */
function GastEinladung(): React.JSX.Element {
  return (
    <div className="rounded-2xl border border-border bg-card/60 p-6 sm:p-8">
      <h1 className="text-xl font-semibold sm:text-2xl">Was spielen wir heute Abend?</h1>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground">
        Unten steht, was gerade läuft - mitschauen kannst du ohne Konto. Eine eigene Runde eröffnen, Spiele
        vorschlagen und den Spielkatalog pflegen können Mitglieder von {branding.name}.
      </p>
      <Link href="/login" className={cn(buttonVariants({ size: 'sm' }), 'mt-5')}>
        <LogIn aria-hidden="true" />
        Anmelden
      </Link>
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
