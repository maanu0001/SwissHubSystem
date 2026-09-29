'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check, ExternalLink, Search, Undo2, UserRound, Users } from 'lucide-react';
import { systemRoutes } from '@swisshub/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { checkInTicketAction, revokeCheckInAction } from '@/modules/calendar/actions';

/**
 * Die Teilnehmenden eines Termins - gruppiert nach Bestellung.
 *
 * ## Warum das neben der Bestellliste steht und nicht darin
 *
 * Weil es zwei Fragen sind. Die Bestellliste beantwortet «wer schuldet was» -
 * die Kassensicht. Diese hier beantwortet «wer kommt» - die Einlasssicht. Am
 * Abend der Veranstaltung steht jemand an der Tür und sucht einen **Namen**,
 * nicht eine Bestellung.
 *
 * ## Warum gruppiert und nicht flach
 *
 * Weil ein Gast ohne seinen Besteller ein Name ohne Zusammenhang ist. Flach
 * gelesen steht da:
 *
 *     Manuel
 *     Anna
 *     Gast A
 *     Peter
 *     Gast B
 *
 * und niemand weiss, zu wem Gast A gehört. Genau das ist an der Tür die
 * Frage. Gruppiert steht die Antwort in der Form:
 *
 *     Manuel
 *       Gast A
 *       Gast B
 *
 * Eine Einrückung und eine Linie sagen mehr als jede Beschriftung «gehört
 * zu» - und auf dem Telefon bleibt der Zusammenhang erhalten, weil die Gäste
 * innerhalb derselben Karte stehen und nicht als eigene Zeilen darunter.
 *
 * ## Warum der Status je Person steht
 *
 * Weil er auseinandergehen kann. Wer zwei Tickets bezahlt und später ein
 * drittes dazukauft, hat zwei definitive Leute und einen vorläufigen. Den
 * Stand des Bestellers auf alle zu übertragen hiesse, einen von beiden falsch
 * darzustellen - und an der Tür jemanden hereinzulassen, für den nichts
 * eingegangen ist.
 */

export type TicketZahlung = 'NOT_REQUIRED' | 'PENDING' | 'VERIFIED' | 'WAIVED' | 'REFUNDED';

export interface TeilnehmerZeileAnsicht {
  ticketId: string;
  name: string;
  art: 'MITGLIED' | 'GAST';
  bestellerName: string;
  bestellerDiscordId: string;
  status: 'ACTIVE' | 'CANCELLED';
  /** Der Stand dieses einen Tickets. */
  zahlung: TicketZahlung;
  definitiv: boolean;
  /** Bereits formatiert - oder `null`. */
  checkedInAt: string | null;
  checkedInByUsername: string | null;
  guestDiscordName: string | null;
  note: string | null;
  /** Die öffentliche Profiladresse - nur bei Mitgliedern, sonst `null`. */
  profilSlug: string | null;
}

export interface TeilnehmerGruppeAnsicht {
  registrationId: string;
  bestellerName: string;
  bestellerDiscordId: string;
  bestellerSlug: string | null;
  bestellungStatus: string;
  /** Das Ticket des Bestellers selbst - `null`, wenn er nur Gäste mitbringt. */
  kopf: TeilnehmerZeileAnsicht | null;
  weitere: TeilnehmerZeileAnsicht[];
  anzahl: number;
}

type Filter = 'alle' | 'mitglieder' | 'gaeste' | 'definitiv' | 'vorlaeufig' | 'eingecheckt' | 'offen';

const FILTER: Array<{ wert: Filter; label: string }> = [
  { wert: 'alle', label: 'Alle' },
  { wert: 'mitglieder', label: 'Mitglieder' },
  { wert: 'gaeste', label: 'Gäste' },
  { wert: 'definitiv', label: 'Definitiv' },
  { wert: 'vorlaeufig', label: 'Vorläufig' },
  { wert: 'eingecheckt', label: 'Eingecheckt' },
  { wert: 'offen', label: 'Nicht eingecheckt' },
];

/** Passt diese Person zur Auswahl? */
function passt(zeile: TeilnehmerZeileAnsicht, filter: Filter): boolean {
  switch (filter) {
    case 'alle':
      return true;
    case 'mitglieder':
      return zeile.art === 'MITGLIED';
    case 'gaeste':
      return zeile.art === 'GAST';
    case 'definitiv':
      return zeile.definitiv;
    case 'vorlaeufig':
      return !zeile.definitiv;
    case 'eingecheckt':
      return zeile.checkedInAt !== null;
    default:
      return zeile.checkedInAt === null;
  }
}

/**
 * Passt diese Person zur Suche?
 *
 * Gesucht wird in allem, was jemand an der Tür nennen könnte: dem eigenen
 * Namen, dem Discord-Namen, und dem Namen dessen, der bestellt hat - «ich
 * gehöre zu Manuel» ist der häufigste Satz.
 */
function trifft(zeile: TeilnehmerZeileAnsicht, begriff: string): boolean {
  if (!begriff) {
    return true;
  }
  return (
    zeile.name.toLowerCase().includes(begriff) ||
    zeile.bestellerName.toLowerCase().includes(begriff) ||
    (zeile.guestDiscordName ?? '').toLowerCase().includes(begriff) ||
    zeile.bestellerDiscordId.includes(begriff)
  );
}

export function TeilnehmendeListe({
  csrfToken,
  slug,
  gruppen,
  darfEinchecken,
}: {
  csrfToken: string;
  slug: string;
  gruppen: TeilnehmerGruppeAnsicht[];
  darfEinchecken: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('alle');
  const [suche, setSuche] = useState('');
  const [pending, setPending] = useState<string | null>(null);

  /*
   * Gefiltert wird je Person, die Gruppe bleibt.
   *
   * Eine Gruppe, von der nur ein Gast zur Auswahl passt, zeigt weiter den
   * Namen ihres Bestellers - sonst stünde «Gast A» wieder ohne Zusammenhang
   * da, und der Filter hätte genau das kaputtgemacht, wofür die Gruppierung
   * da ist. Passt niemand, fällt die Gruppe ganz weg.
   */
  const sichtbar = useMemo(() => {
    const begriff = suche.trim().toLowerCase();
    return gruppen
      .map((gruppe) => {
        const kopf = gruppe.kopf && passt(gruppe.kopf, filter) && trifft(gruppe.kopf, begriff);
        const weitere = gruppe.weitere.filter((zeile) => passt(zeile, filter) && trifft(zeile, begriff));
        return { gruppe, kopfSichtbar: Boolean(kopf), weitere };
      })
      .filter((eintrag) => eintrag.kopfSichtbar || eintrag.weitere.length > 0);
  }, [gruppen, filter, suche]);

  const gezeigt = sichtbar.reduce(
    (summe, eintrag) => summe + (eintrag.kopfSichtbar ? 1 : 0) + eintrag.weitere.length,
    0,
  );

  async function fuehreAus(
    ticketId: string,
    aufgabe: () => Promise<{ ok: boolean; error?: { message?: string }; data?: unknown }>,
    erfolg: (daten: unknown) => string,
  ): Promise<void> {
    setPending(ticketId);
    try {
      const ergebnis = await aufgabe();
      if (!ergebnis.ok) {
        toast.error(ergebnis.error?.message ?? 'Das hat nicht geklappt.');
        return;
      }
      toast.success(erfolg(ergebnis.data));
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  function einchecken(zeile: TeilnehmerZeileAnsicht): React.JSX.Element | null {
    if (!darfEinchecken || zeile.status !== 'ACTIVE') {
      return null;
    }
    if (zeile.checkedInAt) {
      return (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending === zeile.ticketId}
          onClick={() =>
            void fuehreAus(
              zeile.ticketId,
              () => revokeCheckInAction({ csrfToken, ticketId: zeile.ticketId, slug }),
              () => 'Check-in zurückgenommen.',
            )
          }
        >
          <Undo2 aria-hidden="true" />
          Zurücknehmen
        </Button>
      );
    }
    return (
      <Button
        type="button"
        size="sm"
        /*
          Bei offener Zahlung bleibt der Knopf sichtbar und anklickbar - der
          Dienst weist ab und sagt, warum. Ihn auszublenden hiesse, an der Tür
          raten zu lassen, was fehlt.
        */
        variant={zeile.definitiv ? 'default' : 'outline'}
        disabled={pending === zeile.ticketId}
        onClick={() =>
          void fuehreAus(
            zeile.ticketId,
            () => checkInTicketAction({ csrfToken, ticketId: zeile.ticketId, slug }),
            (daten) =>
              (daten as { geaendert?: boolean })?.geaendert === false
                ? `${zeile.name} war bereits eingecheckt.`
                : `${zeile.name} ist eingecheckt.`,
          )
        }
      >
        <Check aria-hidden="true" />
        Einchecken
      </Button>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap gap-1.5">
          {FILTER.map((eintrag) => (
            <Button
              key={eintrag.wert}
              type="button"
              size="sm"
              variant={filter === eintrag.wert ? 'default' : 'outline'}
              onClick={() => setFilter(eintrag.wert)}
            >
              {eintrag.label}
            </Button>
          ))}
        </div>
        <div className="min-w-[14rem] flex-1 space-y-1.5">
          <Label htmlFor="teilnehmer-suche" className="sr-only">
            Teilnehmende suchen
          </Label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="teilnehmer-suche"
              value={suche}
              placeholder="Name, Gast, Discord-Name oder Besteller"
              onChange={(event) => setSuche(event.target.value)}
              className="pl-9"
            />
          </div>
        </div>
      </div>

      {sichtbar.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Niemand passt zu dieser Auswahl.
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {gezeigt} {gezeigt === 1 ? 'Person' : 'Personen'} in {sichtbar.length}{' '}
            {sichtbar.length === 1 ? 'Anmeldung' : 'Anmeldungen'}
          </p>

          {/* Karten statt Tabelle: das hier wird am Abend auf einem Telefon
              gelesen, nicht am Schreibtisch. */}
          <ul className="space-y-2">
            {sichtbar.map(({ gruppe, kopfSichtbar, weitere }) => (
              <li key={gruppe.registrationId} className="overflow-hidden rounded-lg border border-border">
                {kopfSichtbar && gruppe.kopf ? (
                  <PersonZeile zeile={gruppe.kopf} aktion={einchecken(gruppe.kopf)} />
                ) : (
                  /*
                    Der Besteller kommt selbst nicht - die Gruppe braucht
                    trotzdem seinen Namen. Er ist an der Tür der
                    Ansprechpartner für seine Gäste, auch wenn er nicht da ist.
                  */
                  <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/30 p-3 text-sm">
                    <Users className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <MitgliedName name={gruppe.bestellerName} slug={gruppe.bestellerSlug} />
                    <span className="text-xs text-muted-foreground">
                      bringt Gäste mit, kommt selbst nicht
                    </span>
                  </div>
                )}

                {weitere.length > 0 ? (
                  /*
                    Die Gäste innerhalb derselben Karte, eingerückt und mit
                    einer Linie am linken Rand. Als eigene Karten darunter
                    wären sie auf dem Telefon wieder von ihrem Besteller
                    getrennt - und die Zuordnung ist der ganze Punkt.
                  */
                  <ul className="divide-y divide-border border-t border-border bg-muted/20">
                    {weitere.map((zeile) => (
                      <li key={zeile.ticketId} className="pl-4 sm:pl-8">
                        <div className="border-l-2 border-border pl-3">
                          <PersonZeile zeile={zeile} aktion={einchecken(zeile)} klein />
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * Der Name eines Mitglieds - verlinkt, wenn es ein öffentliches Profil gibt.
 *
 * Ob es eines gibt, hat der Server entschieden: `profilSlug` ist nur gesetzt,
 * wenn das Profil auf `PUBLIC` steht und nicht gesperrt ist. Ohne Slug bleibt
 * der Name Text - ein Link ins Leere wäre schlimmer als keiner, und einen
 * Gastnamen als Adresse zu deuten führte auf ein fremdes Profil.
 *
 * Der bestehende Linkstil, kein eigener Knopf: ein «Profil ansehen»-Knopf je
 * Zeile wäre in einer Liste mit dreissig Leuten dreissigmal dasselbe Wort.
 */
function MitgliedName({ name, slug }: { name: string; slug: string | null }): React.JSX.Element {
  if (!slug) {
    return <span className="truncate">{name}</span>;
  }
  return (
    <Link
      /*
        Die Adresse kommt aus `systemRoutes` und nicht aus einer Zeichenkette
        hier. Sie stand einmal an neun Stellen, mal mit Kodierung, mal ohne -
        seither gibt es genau eine Stelle, und ein Test haelt das fest.
      */
      href={systemRoutes.oeffentlichesProfil(slug)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex max-w-full items-center gap-1 truncate underline decoration-dotted underline-offset-4 hover:text-primary hover:decoration-solid"
    >
      <span className="truncate">{name}</span>
      <ExternalLink className="size-3 shrink-0 opacity-60" aria-hidden="true" />
      <span className="sr-only">Öffentliches Profil öffnen</span>
    </Link>
  );
}

/** Eine Person - Kopf oder Gast, dieselbe Zeile in zwei Grössen. */
function PersonZeile({
  zeile,
  aktion,
  klein = false,
}: {
  zeile: TeilnehmerZeileAnsicht;
  aktion: React.JSX.Element | null;
  klein?: boolean;
}): React.JSX.Element {
  return (
    <div
      className={`flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between ${
        klein ? 'py-2' : ''
      }`}
    >
      <div className="min-w-0 space-y-1">
        <p className={`flex flex-wrap items-center gap-2 ${klein ? 'text-sm' : 'font-medium'}`}>
          {zeile.art === 'GAST' ? (
            <UserRound className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          ) : (
            <Users className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          )}
          {zeile.art === 'MITGLIED' ? (
            <MitgliedName name={zeile.name} slug={zeile.profilSlug} />
          ) : (
            <span className="truncate">{zeile.name}</span>
          )}
          <Badge variant="outline">{zeile.art === 'GAST' ? 'Gast' : 'Mitglied'}</Badge>
          <StandMarke zeile={zeile} />
        </p>

        {zeile.guestDiscordName ? (
          <p className="text-xs text-muted-foreground">Discord: {zeile.guestDiscordName}</p>
        ) : null}
        {zeile.checkedInAt ? (
          <p className="text-xs text-muted-foreground">
            Eingecheckt {zeile.checkedInAt}
            {zeile.checkedInByUsername ? ` von ${zeile.checkedInByUsername}` : null}
          </p>
        ) : null}
        {zeile.note ? <p className="text-xs text-muted-foreground">{zeile.note}</p> : null}
      </div>

      {aktion ? <div className="flex shrink-0 gap-2">{aktion}</div> : null}
    </div>
  );
}

/**
 * Was mit dieser Person ist.
 *
 * «Definitiv» und «vorläufig» sind zwei Marken, nicht eine mit zwei Farben:
 * am Einlass ist der Unterschied die ganze Auskunft.
 */
function StandMarke({ zeile }: { zeile: TeilnehmerZeileAnsicht }): React.JSX.Element {
  if (zeile.status === 'CANCELLED') {
    return <Badge variant="outline">Storniert</Badge>;
  }
  if (zeile.checkedInAt) {
    return <Badge variant="default">Eingecheckt</Badge>;
  }
  if (zeile.definitiv) {
    return (
      <Badge variant="secondary">{zeile.zahlung === 'WAIVED' ? 'Definitiv · erlassen' : 'Definitiv'}</Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-amber-500/40 text-amber-500">
      Zahlung ausstehend
    </Badge>
  );
}
