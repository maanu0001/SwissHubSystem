import type { Metadata } from 'next';
import Link from 'next/link';
import { Dices, Swords, Users, Vote } from 'lucide-react';
import { can } from '@swisshub/auth';
import { resolveGuildId } from '@swisshub/discord';
import { isModuleEnabled, spielwahl } from '@swisshub/modules';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { ErrorState } from '@/components/shared/states';
import { Schnellstart } from '@/modules/spielwahl/components/schnellstart';
import { csrfTokenFor, getOptionalAuthContext } from '@/server/auth';
import { gastCsrfToken, gastKennung } from '@/server/gast';
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
 * Er sieht denselben **Schnellstart** wie ein Mitglied, nur mit einem
 * Namensfeld davor: eine Runde eröffnen ist keine Mitgliedssache mehr. Hier
 * stand früher stattdessen eine Einladung, sich anzumelden - und das war der
 * Grund, warum «Was spielen wir» ohne Konto nicht funktionierte. Wer zählt,
 * ist der, der am Freitagabend fragt, nicht der, der ein Konto hat.
 *
 * Zwei Dinge sieht er weiterhin nicht, und keines davon ist eine Hürde:
 *
 *  - den **Einladungswert** fremder Runden. `ladeOffeneRunden` gibt ihn nur
 *    an Leute heraus, die in der Runde schon dabei sind - mit einem leeren
 *    Betrachter also an niemanden. Der Weg in eine fremde Runde führt über
 *    ihre Kennung, und die Bühne lässt einen Gast nur über den
 *    Einladungswert mitmachen. Seine **eigene** Runde bekommt er beim
 *    Eröffnen, mit Einladungswert.
 *  - **«Was ihr zuletzt gespielt habt».** Diese Liste ist die eigene
 *    Vorgeschichte; sie hängt an der Kennung, und die eines Gastes lebt im
 *    Cookie. Sie wäre also wahlweise leer oder irreführend.
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

  /*
   * Die Gastkennung - nur gelesen, nie vergeben.
   *
   * Eine Seite darf keine Cookies setzen; die Kennung entsteht bei der ersten
   * Aktion (`defineOeffentlicheAktion`). Wer die Seite zum ersten Mal öffnet,
   * hat deshalb noch keine: er sieht die Runden, bekommt keinen
   * Einladungswert und ein leeres CSRF-Token. Sein erster Klick vergibt
   * beides, die Seite lädt neu, und ab dann stimmt es.
   */
  const gastkennung = mitglied ? null : await gastKennung();

  const guildId = await resolveGuildId();
  const [offene, vergangene] = await Promise.all([
    /*
     * Der Betrachter ist die eigene Kennung - auch die eines Gastes.
     *
     * Davon hängt `binDabei` ab und damit, ob eine Zeile den
     * Einladungswert trägt. Hier stand nur die Mitgliedskennung, und für
     * einen Gast ein leerer Wert: der Gast, der eine Runde eröffnet hatte,
     * bekam **seine eigene** Runde ohne Einladungswert angeboten und landete
     * dahinter auf einer Anmeldeaufforderung.
     *
     * Ein leerer Wert bleibt die Aussage «niemand» - für den Besucher, der
     * noch kein Cookie hat. `baueListe` behandelt ihn ausdrücklich so.
     */
    ladeOffeneRunden(guildId, mitglied?.user.discordId ?? gastkennung ?? ''),
    /*
     * «Was ihr zuletzt gespielt habt» nur für Mitglieder.
     *
     * Die Liste hängt an der eigenen Kennung. Die eines Gastes lebt im
     * Cookie und ist nach dem Löschen eine andere - die Liste wäre also
     * wahlweise leer oder, nach einem geteilten Gerät, die eines anderen.
     */
    mitglied ? ladeVergangeneRunden(guildId, mitglied.user.discordId) : Promise.resolve([]),
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-10">
      {mitglied ? (
        <Schnellstart csrfToken={csrfTokenFor(mitglied)} />
      ) : (
        <Schnellstart csrfToken={gastkennung ? gastCsrfToken(gastkennung) : ''} gast />
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Läuft gerade
        </h2>
        {offene.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
            {/* Derselbe Satz für alle: den Knopf dazu hat jetzt auch ein
                Besucher ohne Konto. */}
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
          {/*
            Ein Gast-Host hat keinen Discord-Avatar - und `DiscordAvatar`
            baute daraus eine Adresse, die nie etwas liefert. Das Monogramm
            ist hier die richtige Antwort und kein Notbehelf.
          */}
          {runde.hostIstGast ? (
            <span
              aria-hidden="true"
              className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-xs font-bold uppercase text-muted-foreground"
            >
              {runde.hostName.slice(0, 1)}
            </span>
          ) : (
            <DiscordAvatar
              discordId={runde.hostDiscordId}
              avatarHash={runde.hostAvatar}
              name={runde.hostName}
              size={32}
            />
          )}
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
