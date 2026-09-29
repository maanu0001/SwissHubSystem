'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CheckCircle2, Clock, LogOut, Minus, Plus, QrCode, UserPlus, Users, Wallet } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import { registerAction, unregisterAction } from '@/modules/calendar/actions';

/**
 * Anmeldung und Bestellung auf der Detailseite.
 *
 * ## Die Reihenfolge, um die es geht
 *
 * Tickets wählen → Gäste eintragen → Preis sehen → **Anmelden** → und erst
 * danach der TWINT-Code.
 *
 * Vorher stand der Code vor dem Knopf. Das sah hilfreich aus und war es
 * nicht: der Betrag hängt an der Ticketzahl, und wer den Code sieht, bevor er
 * die Zahl festgelegt hat, überweist auf gut Glück. Hinterher steht ein
 * Betrag auf dem Konto, der zu keiner Bestellung passt, und jemand muss ihn
 * zuordnen.
 *
 * Jetzt zeigt der Kasten vor der Anmeldung den **Preis je Ticket** und den
 * Hinweis, dass per TWINT gezahlt wird - genug, um zu entscheiden. Der Code
 * kommt, wenn der Betrag feststeht.
 *
 * ## Was nach der Anmeldung dort steht
 *
 * Dass die Teilnahme **noch nicht** definitiv ist. Kein Wort wie «Ticket
 * gekauft» oder «Zahlung erfolgreich»: SwissHub sieht keine Kontobewegung,
 * und ein Satz, der eine behauptet, ist eine Lüge gegenüber der Person, die
 * ihn liest.
 *
 * ## Kein vorgezogener Zustandswechsel
 *
 * Ob eine Bestellung bestätigt wird oder auf die Warteliste kommt,
 * entscheidet der Server - beim letzten freien Platz weiss der Browser es
 * nicht besser.
 */

export type Zahlungsstand = 'NOT_REQUIRED' | 'PENDING' | 'VERIFIED' | 'WAIVED' | 'REFUNDED';

export interface MeineTicketAnsicht {
  ticketId: string;
  name: string;
  art: 'MITGLIED' | 'GAST';
  istIch: boolean;
  checkedInAt: string | null;
}

export interface MeineBestellungAnsicht {
  status: 'CONFIRMED' | 'WAITLIST';
  position: number | null;
  /** `null`, wenn der Termin nichts kostet. */
  zahlung: Zahlungsstand | null;
  /** Fertig formatiert - die Schreibweise steht im Modul. */
  gesamtbetrag: string;
  preisJeTicket: string;
  tickets: MeineTicketAnsicht[];
}

export interface EintrittsAnsicht {
  /** Preis je Ticket, fertig formatiert. */
  preisJeTicket: string;
  hinweise: string | null;
  /** Die Adresse des QR-Codes - oder `null`, wenn keiner hinterlegt ist. */
  qrAdresse: string | null;
  /** Rappen je Ticket, für die Vorschau im Formular. */
  rappenJeTicket: number;
  waehrung: string;
}

/** Ein Gast im Formular, ehe er abgeschickt ist. */
interface GastEntwurf {
  fuerMich: boolean;
  guestFirstName: string;
  guestLastName: string;
  guestEmail: string;
  guestDiscordName: string;
}

const leererGast = (): GastEntwurf => ({
  fuerMich: false,
  guestFirstName: '',
  guestLastName: '',
  guestEmail: '',
  guestDiscordName: '',
});

/** Rappen als «CHF 45.–» - dieselbe Schreibweise wie im Modul. */
function betrag(rappen: number, waehrung: string): string {
  const ganz = Math.trunc(rappen / 100);
  const rest = Math.abs(rappen % 100);
  return rest === 0
    ? `${waehrung} ${ganz.toLocaleString('de-CH')}.–`
    : `${waehrung} ${ganz.toLocaleString('de-CH')}.${String(rest).padStart(2, '0')}`;
}

export function AnmeldeBereich({
  csrfToken,
  eventId,
  darfTeilnehmen,
  gesperrtGrund,
  abmeldenGrund,
  meine,
  belegung,
  eintritt,
  wartelisteMoeglich,
  fragen,
}: {
  csrfToken: string;
  eventId: string;
  darfTeilnehmen: boolean;
  gesperrtGrund: string | null;
  abmeldenGrund: string | null;
  meine: MeineBestellungAnsicht | null;
  belegung: { confirmed: number; capacity: number; waitlist: number; full: boolean };
  eintritt: EintrittsAnsicht | null;
  wartelisteMoeglich: boolean;
  fragen: Array<{
    id: string;
    label: string;
    hint: string | null;
    required: boolean;
    choices: string[];
  }>;
}): React.JSX.Element {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [abmeldenOffen, setAbmeldenOffen] = useState(false);
  const [antworten, setAntworten] = useState<Record<string, string>>({});
  /*
   * Das erste Ticket ist fuer einen selbst - das ist der Normalfall.
   *
   * Wer nur fuer andere bestellt, nimmt den Haken weg. Den Haken vorgewaehlt
   * zu lassen spart dem haeufigen Fall einen Klick und kostet den seltenen
   * einen.
   */
  const [gaeste, setGaeste] = useState<GastEntwurf[]>([{ ...leererGast(), fuerMich: true }]);

  const anzahl = gaeste.length;
  const freiePlaetze = belegung.capacity > 0 ? Math.max(0, belegung.capacity - belegung.confirmed) : null;

  /*
   * Die Vorschau rechnet dieselbe Formel wie der Server: Anzahl mal Preis.
   *
   * Verbindlich ist die des Servers - diese hier ist Auskunft, damit niemand
   * im Kopf multiplizieren muss.
   */
  const gesamt = useMemo(
    () => (eintritt ? betrag(eintritt.rappenJeTicket * anzahl, eintritt.waehrung) : null),
    [eintritt, anzahl],
  );

  const setzeGast = (index: number, teil: Partial<GastEntwurf>): void =>
    setGaeste((alt) => alt.map((gast, i) => (i === index ? { ...gast, ...teil } : gast)));

  const anmelden = async (): Promise<void> => {
    setPending(true);
    try {
      const ergebnis = await registerAction({
        csrfToken,
        eventId,
        answers: antworten,
        tickets: gaeste.map((gast) => ({
          fuerMich: gast.fuerMich,
          guestFirstName: gast.fuerMich ? '' : gast.guestFirstName,
          guestLastName: gast.fuerMich ? '' : gast.guestLastName,
          guestEmail: gast.fuerMich ? '' : gast.guestEmail,
          guestDiscordName: gast.fuerMich ? '' : gast.guestDiscordName,
          note: '',
        })),
      });
      if (!ergebnis.ok) {
        toast.error(ergebnis.error?.message ?? 'Das hat nicht geklappt.');
        return;
      }
      /*
       * Was hier steht, muss stimmen.
       *
       * Bei einem kostenpflichtigen Abend ist «Du bist angemeldet» die halbe
       * Wahrheit: die Anmeldung ist da, die Teilnahme ist es nicht.
       */
      toast.success(
        ergebnis.data?.waitlisted
          ? `Ihr steht auf der Warteliste (Platz ${ergebnis.data.position}).`
          : eintritt
            ? 'Anmeldung eingegangen. Die Teilnahme ist noch nicht definitiv.'
            : anzahl > 1
              ? `${anzahl} Tickets reserviert.`
              : 'Du bist angemeldet.',
      );
      setAntworten({});
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  const abmelden = async (): Promise<void> => {
    setPending(true);
    try {
      const ergebnis = await unregisterAction({ csrfToken, eventId });
      if (!ergebnis.ok) {
        toast.error(ergebnis.error?.message ?? 'Das hat nicht geklappt.');
        throw new Error('Abmeldung fehlgeschlagen');
      }
      toast.success('Die Anmeldung wurde zurückgezogen.');
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  const plaetze =
    belegung.capacity > 0 ? `${belegung.confirmed} / ${belegung.capacity}` : `${belegung.confirmed}`;

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-semibold">Teilnahme</h2>
        <span className="tabular-nums text-sm text-muted-foreground">{plaetze} Plätze</span>
      </div>

      {belegung.waitlist > 0 ? (
        <p className="text-xs text-muted-foreground">{belegung.waitlist} auf der Warteliste.</p>
      ) : null}

      {meine ? (
        <>
          <MeinStand meine={meine} />

          {/*
            Jetzt erst der QR-Code - der Betrag steht fest.

            Er bleibt stehen, solange die Zahlung offen ist: genau dem die
            Anweisung wegzunehmen, der sie noch braucht, wäre die falsche
            Sparsamkeit.
          */}
          {eintritt && meine.zahlung === 'PENDING' ? (
            <ZahlungsKasten
              eintritt={eintritt}
              gesamtbetrag={meine.gesamtbetrag}
              anzahl={meine.tickets.length}
            />
          ) : null}

          <MeineTickets tickets={meine.tickets} />

          {abmeldenGrund ? (
            <p className="text-xs text-muted-foreground">{abmeldenGrund}</p>
          ) : (
            <>
              <Button
                variant="outline"
                className="w-full"
                disabled={pending}
                onClick={() => setAbmeldenOffen(true)}
              >
                <LogOut aria-hidden="true" />
                {meine.tickets.length > 1 ? 'Ganze Anmeldung zurückziehen' : 'Teilnahme zurückziehen'}
              </Button>
              <ConfirmationDialog
                open={abmeldenOffen}
                onOpenChange={setAbmeldenOffen}
                title={meine.tickets.length > 1 ? 'Alle Tickets zurückziehen?' : 'Teilnahme zurückziehen?'}
                description={
                  meine.tickets.length > 1
                    ? `Damit werden alle ${meine.tickets.length} Tickets dieser Anmeldung storniert - auch die deiner Gäste.`
                    : belegung.waitlist > 0
                      ? 'Dein Platz geht an die erste passende Anmeldung auf der Warteliste.'
                      : 'Du kannst dich später wieder anmelden, solange Plätze frei sind und die Frist läuft.'
                }
                confirmLabel="Zurückziehen"
                destructive
                onConfirm={abmelden}
              />
            </>
          )}
        </>
      ) : gesperrtGrund ? (
        <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          {gesperrtGrund}
        </p>
      ) : !darfTeilnehmen ? (
        <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          Für die Anmeldung fehlt dir die Berechtigung.
        </p>
      ) : belegung.full && !wartelisteMoeglich ? (
        <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          Dieses Event ist ausgebucht.
        </p>
      ) : (
        <>
          {/* Vor der Anmeldung: Preis und Zahlungsweg - aber kein QR-Code. */}
          {eintritt ? <PreisHinweis eintritt={eintritt} /> : null}

          <TicketWaehler
            gaeste={gaeste}
            freiePlaetze={freiePlaetze}
            aufWarteliste={belegung.full}
            onAendern={setzeGast}
            onHinzufuegen={() => setGaeste((alt) => [...alt, leererGast()])}
            onEntfernen={() => setGaeste((alt) => alt.slice(0, -1))}
          />

          {gesamt ? (
            <div className="flex items-baseline justify-between rounded-lg border border-border bg-muted/30 px-3 py-2">
              <span className="text-sm">
                {anzahl} × {eintritt!.preisJeTicket}
              </span>
              <span className="text-lg font-semibold tabular-nums">{gesamt}</span>
            </div>
          ) : null}

          {fragen.length > 0 ? (
            <div className="space-y-3">
              {fragen.map((frage) => (
                <div key={frage.id} className="space-y-1.5">
                  <Label htmlFor={`frage-${frage.id}`}>
                    {frage.label}
                    {frage.required ? ' *' : ''}
                  </Label>
                  {frage.choices.length > 0 ? (
                    <select
                      id={`frage-${frage.id}`}
                      value={antworten[frage.id] ?? ''}
                      onChange={(event) =>
                        setAntworten((wert) => ({ ...wert, [frage.id]: event.target.value }))
                      }
                      className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm"
                    >
                      <option value="">Bitte wählen</option>
                      {frage.choices.map((auswahl) => (
                        <option key={auswahl} value={auswahl}>
                          {auswahl}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      id={`frage-${frage.id}`}
                      value={antworten[frage.id] ?? ''}
                      maxLength={500}
                      onChange={(event) =>
                        setAntworten((wert) => ({ ...wert, [frage.id]: event.target.value }))
                      }
                    />
                  )}
                  {frage.hint ? <p className="text-xs text-muted-foreground">{frage.hint}</p> : null}
                </div>
              ))}
            </div>
          ) : null}

          {/*
            «Anmelden» - nicht «Anmeldung bestätigen».

            Der Knopf tut, was er sagt, und sagt es so, wie man es im Gespräch
            sagen würde. «Bestätigen» klingt nach einem Schritt, der einem
            anderen folgt, und hier folgt keiner.
          */}
          <Button className="w-full" disabled={pending} onClick={() => void anmelden()}>
            <UserPlus aria-hidden="true" />
            {belegung.full ? 'Auf die Warteliste' : 'Anmelden'}
          </Button>

          {belegung.full ? (
            <p className="text-xs text-muted-foreground">
              Das Event ist voll. Wird genug frei, rückt die erste passende Anmeldung nach.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * Wie viele Tickets, und für wen.
 *
 * ## Warum ein Stepper und kein Zahlenfeld
 *
 * Weil die Zahl klein ist und jede Änderung ein Feld auf- oder zuklappt. Ein
 * Eingabefeld, in dem jemand «12» tippt, müsste zwölf Gästekarten erzeugen
 * und beim Löschen der Ziffer wieder alle - mit den eingetippten Namen darin.
 */
function TicketWaehler({
  gaeste,
  freiePlaetze,
  aufWarteliste,
  onAendern,
  onHinzufuegen,
  onEntfernen,
}: {
  gaeste: GastEntwurf[];
  freiePlaetze: number | null;
  aufWarteliste: boolean;
  onAendern: (index: number, teil: Partial<GastEntwurf>) => void;
  onHinzufuegen: () => void;
  onEntfernen: () => void;
}): React.JSX.Element {
  const anzahl = gaeste.length;
  // Zehn ist die Grenze des Servers. Und nie mehr, als noch frei ist -
  // ausser die ganze Bestellung geht ohnehin auf die Warteliste.
  const hoechstens = aufWarteliste ? 10 : Math.min(10, freiePlaetze ?? 10);

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="ticketanzahl">Wie viele Tickets möchtest du reservieren?</Label>
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Ein Ticket weniger"
            disabled={anzahl <= 1}
            onClick={onEntfernen}
          >
            <Minus aria-hidden="true" />
          </Button>
          <span
            id="ticketanzahl"
            aria-live="polite"
            className="min-w-[3ch] text-center text-2xl font-semibold tabular-nums"
          >
            {anzahl}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Ein Ticket mehr"
            disabled={anzahl >= hoechstens}
            onClick={onHinzufuegen}
          >
            <Plus aria-hidden="true" />
          </Button>
          <span className="text-xs text-muted-foreground">
            {freiePlaetze !== null && !aufWarteliste
              ? `${freiePlaetze} Plätze frei`
              : 'Für dich und deine Begleitung'}
          </span>
        </div>
      </div>

      <div className="space-y-3">
        {gaeste.map((gast, index) => (
          <div key={index} className="space-y-2 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">
                {gast.fuerMich
                  ? 'Ticket für dich'
                  : `Gast ${gaeste.slice(0, index).filter((g) => !g.fuerMich).length + 1}`}
              </span>
              {index === 0 ? (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={gast.fuerMich}
                    onChange={(event) => onAendern(index, { fuerMich: event.target.checked })}
                    className="size-4 rounded border-border"
                  />
                  Ein Ticket ist für mich selbst
                </label>
              ) : null}
            </div>

            {gast.fuerMich ? (
              <p className="text-xs text-muted-foreground">Dein Name kommt aus deinem SwissHub-Profil.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor={`gast-vorname-${index}`} className="text-xs">
                    Name *
                  </Label>
                  <Input
                    id={`gast-vorname-${index}`}
                    value={gast.guestFirstName}
                    maxLength={80}
                    placeholder="Vorname"
                    onChange={(event) => onAendern(index, { guestFirstName: event.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`gast-nachname-${index}`} className="text-xs">
                    Nachname
                  </Label>
                  <Input
                    id={`gast-nachname-${index}`}
                    value={gast.guestLastName}
                    maxLength={80}
                    onChange={(event) => onAendern(index, { guestLastName: event.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`gast-mail-${index}`} className="text-xs">
                    E-Mail
                  </Label>
                  <Input
                    id={`gast-mail-${index}`}
                    type="email"
                    value={gast.guestEmail}
                    maxLength={200}
                    onChange={(event) => onAendern(index, { guestEmail: event.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`gast-discord-${index}`} className="text-xs">
                    Discord-Name
                  </Label>
                  <Input
                    id={`gast-discord-${index}`}
                    value={gast.guestDiscordName}
                    maxLength={64}
                    onChange={(event) => onAendern(index, { guestDiscordName: event.target.value })}
                  />
                </div>
                {/*
                  Nur der Name ist Pflicht. Ein Gast braucht kein Discord und
                  kein SwissHub-Konto - dafür ist diese Karte da.
                */}
                <p className="text-xs text-muted-foreground sm:col-span-2">
                  Nur der Name ist nötig. Deine Begleitung braucht weder Discord noch ein SwissHub-Konto.
                </p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Preis und Zahlungsweg - **vor** der Anmeldung.
 *
 * Ausdrücklich ohne QR-Code: der Betrag steht erst fest, wenn die Ticketzahl
 * feststeht. Was hier steht, reicht für die Entscheidung «komme ich?».
 */
function PreisHinweis({ eintritt }: { eintritt: EintrittsAnsicht }): React.JSX.Element {
  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <Wallet className="size-4 shrink-0" aria-hidden="true" />
        Eintritt: {eintritt.preisJeTicket} pro Person
      </p>
      <p className="text-xs text-muted-foreground">
        Bezahlt wird per TWINT. Die Zahlungsinformationen mit dem QR-Code erscheinen direkt nach der
        Anmeldung.
      </p>
      {eintritt.hinweise ? (
        <p className="whitespace-pre-line text-xs text-muted-foreground">{eintritt.hinweise}</p>
      ) : null}
    </div>
  );
}

/**
 * Die Zahlungsansicht - **nach** der Anmeldung.
 *
 * ## Warum der QR-Code so gross ist
 *
 * Weil er gescannt wird, und zwar von einem Telefon in der anderen Hand. Ein
 * Code mit 80 Pixeln ist auf dem Bildschirm hübsch und in der Praxis nicht zu
 * gebrauchen.
 *
 * Der weisse Grund ist kein Stilmittel: ein QR-Code mit durchsichtigem
 * Hintergrund auf dunkler Fläche ist invertiert, und einen invertierten Code
 * erkennen viele Kameras nicht.
 */
function ZahlungsKasten({
  eintritt,
  gesamtbetrag,
  anzahl,
}: {
  eintritt: EintrittsAnsicht;
  gesamtbetrag: string;
  anzahl: number;
}): React.JSX.Element {
  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex items-baseline justify-between">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Wallet className="size-4 shrink-0" aria-hidden="true" />
          Zu bezahlen
        </span>
        <span className="text-xl font-semibold tabular-nums">{gesamtbetrag}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        {anzahl} {anzahl === 1 ? 'Ticket' : 'Tickets'} × {eintritt.preisJeTicket}
      </p>

      {eintritt.hinweise ? (
        /*
          `whitespace-pre-line` und kein Markdown: was die Organisation hier
          schreibt, ist ein Hinweis und kein Dokument. Absätze bleiben, alles
          andere bleibt Text.
        */
        <p className="whitespace-pre-line text-xs text-muted-foreground">{eintritt.hinweise}</p>
      ) : null}

      {eintritt.qrAdresse ? (
        <div className="space-y-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={eintritt.qrAdresse}
            alt="TWINT-QR-Code zum Bezahlen des Eintritts"
            className="mx-auto h-48 w-48 rounded-lg bg-white object-contain p-2 sm:h-56 sm:w-56"
          />
          <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
            <QrCode className="size-3.5 shrink-0" aria-hidden="true" />
            Mit der TWINT-App scannen und {gesamtbetrag} überweisen.
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Für dieses Event ist kein QR-Code hinterlegt. Die Organisation sagt dir, wie du bezahlen kannst.
        </p>
      )}
    </div>
  );
}

/** Wer über diese Anmeldung kommt. */
function MeineTickets({ tickets }: { tickets: MeineTicketAnsicht[] }): React.JSX.Element | null {
  if (tickets.length === 0) {
    return null;
  }
  return (
    <div className="space-y-1.5">
      <p className="flex items-center gap-2 text-sm font-medium">
        <Users className="size-4 shrink-0" aria-hidden="true" />
        {tickets.length === 1 ? 'Dein Ticket' : `${tickets.length} Tickets`}
      </p>
      <ul className="space-y-1">
        {tickets.map((ticket, index) => (
          <li
            key={ticket.ticketId}
            className="flex items-center gap-2 rounded-lg border border-border/60 px-3 py-1.5 text-sm"
          >
            <span className="text-xs tabular-nums text-muted-foreground">{index + 1}.</span>
            <span className="truncate">{ticket.name}</span>
            {ticket.istIch ? (
              <Badge variant="outline" className="ml-auto shrink-0">
                Du
              </Badge>
            ) : (
              <Badge variant="outline" className="ml-auto shrink-0">
                Gast
              </Badge>
            )}
            {ticket.checkedInAt ? (
              <Badge variant="default" className="shrink-0">
                eingecheckt
              </Badge>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Der eigene Stand - Platz und Zahlung in einem Satz.
 *
 * ## Warum die Formulierungen hier so genau sind
 *
 * Weil sie das Einzige sind, woran sich jemand hält, der bezahlt hat und
 * wissen will, ob es angekommen ist. «Du bist angemeldet» bei offener Zahlung
 * wäre falsch, «Zahlung erfolgreich» wäre eine Behauptung über ein Konto, in
 * das SwissHub nie geschaut hat, und «Ticket gekauft» wäre beides.
 */
function MeinStand({ meine }: { meine: MeineBestellungAnsicht }): React.JSX.Element {
  const warteliste = meine.status === 'WAITLIST';
  const offen = meine.zahlung === 'PENDING' || meine.zahlung === 'REFUNDED';

  const ton =
    offen || warteliste
      ? 'border-amber-500/40 bg-amber-500/10 text-amber-500'
      : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500';

  const anzahl = meine.tickets.length;
  const titel = warteliste
    ? `Ihr steht auf der Warteliste${meine.position ? ` (Platz ${meine.position})` : ''}.`
    : meine.zahlung === 'PENDING'
      ? 'Anmeldung eingegangen.'
      : meine.zahlung === 'REFUNDED'
        ? 'Die Zahlung wurde zurückerstattet.'
        : anzahl > 1
          ? `${anzahl} Tickets reserviert.`
          : 'Du bist angemeldet.';

  // Dieselben Worte, die der Admin in seiner Liste sieht - damit eine
  // Rückfrage nicht an zwei Vokabularen scheitert.
  const marke =
    meine.zahlung === 'PENDING'
      ? 'ZAHLUNG AUSSTEHEND'
      : meine.zahlung === 'VERIFIED'
        ? 'TEILNAHME BESTÄTIGT'
        : meine.zahlung === 'WAIVED'
          ? 'ZAHLUNG ERLASSEN · TEILNAHME BESTÄTIGT'
          : meine.zahlung === 'REFUNDED'
            ? 'ZAHLUNG ERSTATTET'
            : null;

  return (
    <div className={`space-y-2 rounded-lg border p-3 text-sm ${ton}`}>
      <p className="flex items-center gap-2">
        {offen || warteliste ? (
          <Clock className="size-4 shrink-0" aria-hidden="true" />
        ) : (
          <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
        )}
        {titel}
      </p>

      {marke ? <p className="text-xs font-semibold tracking-wide">{marke}</p> : null}

      {meine.zahlung === 'PENDING' ? (
        <p className="text-xs opacity-90">
          {anzahl > 1 ? 'Eure Teilnahme ist' : 'Deine Teilnahme ist'} noch nicht definitiv. Nach Eingang der
          Zahlung wird die Anmeldung vom SwissHub-Team bestätigt.
        </p>
      ) : null}
      {meine.zahlung === 'VERIFIED' ? (
        <p className="text-xs opacity-90">
          Die Zahlung wurde vom SwissHub-Team bestätigt
          {anzahl > 1 ? ` - alle ${anzahl} Tickets sind definitiv.` : '.'}
        </p>
      ) : null}
      {meine.zahlung === 'WAIVED' ? (
        <p className="text-xs opacity-90">
          Für {anzahl > 1 ? 'euch' : 'dich'} fällt kein Eintritt an. Die Teilnahme ist definitiv.
        </p>
      ) : null}
    </div>
  );
}
