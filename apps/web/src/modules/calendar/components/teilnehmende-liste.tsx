'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check, Search, Undo2, UserRound, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { checkInTicketAction, revokeCheckInAction } from '@/modules/calendar/actions';

/**
 * Die Teilnehmenden eines Termins - eine Zeile je Person.
 *
 * ## Warum das neben der Bestellliste steht und nicht darin
 *
 * Weil es zwei Fragen sind. Die Bestellliste beantwortet «wer schuldet was» -
 * die Kassensicht. Diese hier beantwortet «wer kommt» - die Einlasssicht. Am
 * Abend der Veranstaltung steht jemand an der Tür und sucht einen **Namen**,
 * nicht eine Bestellung.
 *
 * Dieselben Daten, zwei Zugänge. Sie in eine Tabelle mit ausklappbaren Zeilen
 * zu zwingen hiesse, beide Aufgaben halb zu lösen.
 *
 * ## Warum bei jedem Gast steht, zu wem er gehört
 *
 * Weil ein Gast ohne SwissHub-Konto sonst ein Name ohne Kontext wäre. Steht
 * «Gast A» an der Tür und ist nicht in der Liste zu finden, muss jemand
 * wissen, wen er fragen kann - und das ist der Besteller.
 */

export type TicketZahlung = 'NOT_REQUIRED' | 'PENDING' | 'VERIFIED' | 'WAIVED' | 'REFUNDED';

export interface TeilnehmerZeileAnsicht {
  ticketId: string;
  name: string;
  art: 'MITGLIED' | 'GAST';
  bestellerName: string;
  bestellerDiscordId: string;
  status: 'ACTIVE' | 'CANCELLED';
  zahlung: TicketZahlung;
  definitiv: boolean;
  /** Bereits formatiert - oder `null`. */
  checkedInAt: string | null;
  checkedInByUsername: string | null;
  guestDiscordName: string | null;
  note: string | null;
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

export function TeilnehmendeListe({
  csrfToken,
  slug,
  zeilen,
  darfEinchecken,
}: {
  csrfToken: string;
  slug: string;
  zeilen: TeilnehmerZeileAnsicht[];
  darfEinchecken: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('alle');
  const [suche, setSuche] = useState('');
  const [pending, setPending] = useState<string | null>(null);

  const gefiltert = useMemo(() => {
    const begriff = suche.trim().toLowerCase();
    return zeilen.filter((zeile) => {
      const passt =
        filter === 'alle'
          ? true
          : filter === 'mitglieder'
            ? zeile.art === 'MITGLIED'
            : filter === 'gaeste'
              ? zeile.art === 'GAST'
              : filter === 'definitiv'
                ? zeile.definitiv
                : filter === 'vorlaeufig'
                  ? !zeile.definitiv && zeile.status === 'ACTIVE'
                  : filter === 'eingecheckt'
                    ? zeile.checkedInAt !== null
                    : zeile.checkedInAt === null && zeile.status === 'ACTIVE';
      if (!passt) {
        return false;
      }
      if (!begriff) {
        return true;
      }
      /*
       * Gesucht wird in allem, was jemand an der Tuer nennen koennte: dem
       * eigenen Namen, dem Discord-Namen, und dem Namen dessen, der bestellt
       * hat - «ich gehoere zu Manuel» ist der haeufigste Satz.
       */
      return (
        zeile.name.toLowerCase().includes(begriff) ||
        zeile.bestellerName.toLowerCase().includes(begriff) ||
        (zeile.guestDiscordName ?? '').toLowerCase().includes(begriff) ||
        zeile.bestellerDiscordId.includes(begriff)
      );
    });
  }, [zeilen, filter, suche]);

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

      {gefiltert.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Niemand passt zu dieser Auswahl.
        </p>
      ) : (
        /* Karten statt Tabelle: das hier wird am Abend auf einem Telefon
           gelesen, nicht am Schreibtisch. */
        <ul className="space-y-2">
          {gefiltert.map((zeile) => (
            <li
              key={zeile.ticketId}
              className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 space-y-1">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {zeile.art === 'GAST' ? (
                    <UserRound className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  ) : (
                    <Users className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  )}
                  <span className="truncate">{zeile.name}</span>
                  <Badge variant="outline">{zeile.art === 'GAST' ? 'Gast' : 'Mitglied'}</Badge>
                  <StandMarke zeile={zeile} />
                </p>

                {/*
                  Die Zuordnung - bei einem Gast die wichtigste Zeile der
                  ganzen Ansicht.
                */}
                <p className="text-xs text-muted-foreground">
                  {zeile.art === 'GAST' ? 'Gehört zu' : 'Bestellt durch'}: {zeile.bestellerName}
                  {zeile.guestDiscordName ? ` · Discord: ${zeile.guestDiscordName}` : null}
                </p>

                {zeile.checkedInAt ? (
                  <p className="text-xs text-muted-foreground">
                    Eingecheckt {zeile.checkedInAt}
                    {zeile.checkedInByUsername ? ` von ${zeile.checkedInByUsername}` : null}
                  </p>
                ) : null}
                {zeile.note ? <p className="text-xs text-muted-foreground">{zeile.note}</p> : null}
              </div>

              {darfEinchecken && zeile.status === 'ACTIVE' ? (
                <div className="flex shrink-0 gap-2">
                  {zeile.checkedInAt ? (
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
                      Check-in zurücknehmen
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      /*
                        Bei offener Zahlung bleibt der Knopf sichtbar und
                        anklickbar - der Dienst weist ab und sagt, warum.
                        Ihn auszublenden hiesse, an der Tuer raten zu lassen,
                        was fehlt.
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
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Was mit diesem Ticket ist.
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
      {zeile.zahlung === 'PENDING' ? 'Zahlung ausstehend' : 'Vorläufig'}
    </Badge>
  );
}
