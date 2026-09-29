'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check, Gift, RotateCcw, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import { revokePaymentAction, verifyPaymentAction, waivePaymentAction } from '@/modules/calendar/actions';

/**
 * Anmeldungen und Zahlungen eines kostenpflichtigen Termins.
 *
 * ## Was diese Ansicht beantwortet
 *
 * Genau eine Frage, und die stellt sich am Abend vor der Veranstaltung:
 * **wer hat bezahlt und wer nicht?** Alles hier ist darauf ausgerichtet -
 * fünf Zahlen oben, ein Filter daneben, und je Zeile der Knopf, der den
 * einen Schritt tut, der als Nächstes ansteht.
 *
 * Keine Zahlungsanalyse, keine Umsatzkurve, kein Export. Es geht um die
 * Teilnehmer eines Abends; die Liste passt auf einen Bildschirm.
 *
 * ## Warum bestätigen einen Dialog hat und erlassen auch
 *
 * Weil beide Knöpfe etwas festschreiben, das sich nur mit einer eigenen
 * Berechtigung wieder aufheben lässt. Der Dialog fragt nicht «bist du
 * sicher» - das fragt niemanden etwas. Er fragt, ob der Zahlungseingang
 * **tatsächlich geprüft** wurde, und nennt den Betrag dazu. Das ist die
 * Frage, bei der jemand kurz innehält.
 *
 * ## Was hier nicht von selbst passiert
 *
 * Nichts. Kein Status wechselt durch Zeitablauf, durch einen Durchgang oder
 * dadurch, dass jemand den QR-Code angesehen hat. Jede Änderung in dieser
 * Liste ist ein Klick eines Menschen, und jeder steht im Audit Log.
 */

export type Zahlungsstatus = 'NOT_REQUIRED' | 'PENDING' | 'VERIFIED' | 'WAIVED' | 'REFUNDED';

export interface ZahlungsZeileAnsicht {
  registrationId: string;
  name: string;
  discordId: string;
  status: 'CONFIRMED' | 'WAITLIST' | 'CANCELLED';
  waitlistPosition: number | null;
  /** Bereits formatiert - die Schreibweise steht im Modul, nicht hier. */
  angemeldetAm: string;
  betrag: string;
  zahlung: Zahlungsstatus;
  bestaetigtAm: string | null;
  bestaetigtVon: string | null;
  grund: string | null;
}

export interface ZahlungsKennzahlenAnsicht {
  angemeldet: number;
  ausstehend: number;
  bestaetigt: number;
  erlassen: number;
  storniert: number;
  erstattet: number;
  eingegangen: string;
  offen: string;
}

type Filter = 'alle' | 'ausstehend' | 'bestaetigt' | 'erlassen' | 'storniert';

const FILTER: Array<{ wert: Filter; label: string }> = [
  { wert: 'alle', label: 'Alle' },
  { wert: 'ausstehend', label: 'Zahlung ausstehend' },
  { wert: 'bestaetigt', label: 'Bestätigt' },
  { wert: 'erlassen', label: 'Erlassen' },
  { wert: 'storniert', label: 'Storniert' },
];

/** Die Erlassgründe als Auswahl - Freitext ginge auch, aber selten besser. */
const ERLASS_GRUENDE = ['Crew', 'Sponsor', 'Gast', 'Gewinn', 'Sonstiges'];

export function ZahlungsUebersicht({
  csrfToken,
  slug,
  zeilen,
  kennzahlen,
  darfBestaetigen,
  darfErlassen,
  darfZuruecknehmen,
}: {
  csrfToken: string;
  slug: string;
  zeilen: ZahlungsZeileAnsicht[];
  kennzahlen: ZahlungsKennzahlenAnsicht;
  darfBestaetigen: boolean;
  darfErlassen: boolean;
  darfZuruecknehmen: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('alle');
  const [suche, setSuche] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [bestaetigen, setBestaetigen] = useState<ZahlungsZeileAnsicht | null>(null);
  const [erlassen, setErlassen] = useState<ZahlungsZeileAnsicht | null>(null);
  const [erlassGrund, setErlassGrund] = useState(ERLASS_GRUENDE[0]!);
  const [zuruecknehmen, setZuruecknehmen] = useState<ZahlungsZeileAnsicht | null>(null);

  /*
   * Gefiltert wird im Browser.
   *
   * Der Filter ist eine Ansichtssache und keine Abfrage: die Zeilen sind
   * ohnehin alle da - es sind die Teilnehmer eines Abends -, und ein
   * Serverbesuch je Klick waere eine Wartezeit fuer nichts. Der Dienst kennt
   * denselben Filter trotzdem; er wird dort gebraucht, wo jemand die Liste
   * anders abholt.
   */
  const gefiltert = useMemo(() => {
    const begriff = suche.trim().toLowerCase();
    return zeilen.filter((zeile) => {
      const passtFilter =
        filter === 'alle'
          ? true
          : filter === 'storniert'
            ? zeile.status === 'CANCELLED'
            : zeile.status !== 'CANCELLED' &&
              ((filter === 'ausstehend' && zeile.zahlung === 'PENDING') ||
                (filter === 'bestaetigt' && zeile.zahlung === 'VERIFIED') ||
                (filter === 'erlassen' && zeile.zahlung === 'WAIVED'));
      if (!passtFilter) {
        return false;
      }
      if (!begriff) {
        return true;
      }
      return zeile.name.toLowerCase().includes(begriff) || zeile.discordId.includes(begriff);
    });
  }, [zeilen, filter, suche]);

  async function fuehreAus(
    registrationId: string,
    aufgabe: () => Promise<{ ok: boolean; error?: { message?: string } }>,
    erfolg: string,
  ): Promise<void> {
    setPending(registrationId);
    try {
      const ergebnis = await aufgabe();
      if (!ergebnis.ok) {
        toast.error(ergebnis.error?.message ?? 'Das hat nicht geklappt.');
        return;
      }
      toast.success(erfolg);
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Kennzahl label="Angemeldet" wert={kennzahlen.angemeldet} />
        <Kennzahl label="Zahlung ausstehend" wert={kennzahlen.ausstehend} ton="warnung" />
        <Kennzahl label="Bestätigt" wert={kennzahlen.bestaetigt} ton="gut" hinweis={kennzahlen.eingegangen} />
        <Kennzahl label="Erlassen" wert={kennzahlen.erlassen} />
        <Kennzahl label="Storniert" wert={kennzahlen.storniert} />
      </div>

      {kennzahlen.ausstehend > 0 ? (
        <p className="text-xs text-muted-foreground">
          Noch offen: {kennzahlen.offen}. SwissHub prüft keine Zahlungseingänge - dieser Betrag ist die Summe
          dessen, was noch niemand bestätigt hat.
        </p>
      ) : null}

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
          <Label htmlFor="zahlung-suche" className="sr-only">
            Mitglied suchen
          </Label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="zahlung-suche"
              value={suche}
              placeholder="Name oder Discord-Kennung"
              onChange={(event) => setSuche(event.target.value)}
              className="pl-9"
            />
          </div>
        </div>
      </div>

      {gefiltert.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Keine Anmeldung passt zu dieser Auswahl.
        </p>
      ) : (
        <ul className="space-y-2">
          {gefiltert.map((zeile) => (
            <li
              key={zeile.registrationId}
              className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 space-y-1">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  <span className="truncate">{zeile.name}</span>
                  <StatusMarke zeile={zeile} />
                </p>
                <p className="text-xs text-muted-foreground">
                  Angemeldet: {zeile.angemeldetAm} · {zeile.betrag}
                  {zeile.status === 'WAITLIST' && zeile.waitlistPosition
                    ? ` · Warteliste Platz ${zeile.waitlistPosition}`
                    : null}
                </p>
                {/* Wer freigegeben hat und wann - die Auskunft, die man bei
                    einer Rueckfrage tatsaechlich braucht. */}
                {zeile.bestaetigtVon && zeile.bestaetigtAm ? (
                  <p className="text-xs text-muted-foreground">
                    {zeile.zahlung === 'WAIVED' ? 'Erlassen' : 'Bestätigt'} von {zeile.bestaetigtVon} ·{' '}
                    {zeile.bestaetigtAm}
                    {zeile.grund ? ` · ${zeile.grund}` : null}
                  </p>
                ) : null}
              </div>

              <div className="flex shrink-0 flex-wrap gap-2">
                {zeile.zahlung === 'PENDING' || zeile.zahlung === 'REFUNDED' ? (
                  <>
                    {darfBestaetigen && zeile.status !== 'CANCELLED' ? (
                      <Button
                        type="button"
                        size="sm"
                        disabled={pending === zeile.registrationId}
                        onClick={() => setBestaetigen(zeile)}
                      >
                        <Check aria-hidden="true" />
                        Zahlung bestätigen
                      </Button>
                    ) : null}
                    {darfErlassen && zeile.status !== 'CANCELLED' ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={pending === zeile.registrationId}
                        onClick={() => {
                          setErlassGrund(ERLASS_GRUENDE[0]!);
                          setErlassen(zeile);
                        }}
                      >
                        <Gift aria-hidden="true" />
                        Zahlung erlassen
                      </Button>
                    ) : null}
                  </>
                ) : null}

                {(zeile.zahlung === 'VERIFIED' || zeile.zahlung === 'WAIVED') && darfZuruecknehmen ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending === zeile.registrationId}
                    onClick={() => setZuruecknehmen(zeile)}
                  >
                    <RotateCcw aria-hidden="true" />
                    Bestätigung zurücknehmen
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmationDialog
        open={bestaetigen !== null}
        onOpenChange={(offen) => !offen && setBestaetigen(null)}
        title="Zahlungseingang bestätigen?"
        description={
          bestaetigen
            ? `Hast du den Zahlungseingang von ${bestaetigen.betrag} durch ${bestaetigen.name} tatsächlich geprüft? Die Teilnahme wird damit definitiv.`
            : ''
        }
        confirmLabel="Zahlung bestätigen"
        onConfirm={async () => {
          const zeile = bestaetigen;
          if (!zeile) {
            return;
          }
          setBestaetigen(null);
          await fuehreAus(
            zeile.registrationId,
            () => verifyPaymentAction({ csrfToken, registrationId: zeile.registrationId, slug }),
            'Zahlung bestätigt. Die Teilnahme ist definitiv.',
          );
        }}
      />

      <ConfirmationDialog
        open={erlassen !== null}
        onOpenChange={(offen) => !offen && setErlassen(null)}
        title="Zahlung erlassen?"
        description={
          erlassen
            ? `${erlassen.name} nimmt ohne Zahlung teil. Der Eintrag wird als «erlassen» geführt - nicht als bezahlt.`
            : ''
        }
        confirmLabel="Zahlung erlassen"
        onConfirm={async () => {
          const zeile = erlassen;
          if (!zeile) {
            return;
          }
          setErlassen(null);
          await fuehreAus(
            zeile.registrationId,
            () =>
              waivePaymentAction({
                csrfToken,
                registrationId: zeile.registrationId,
                grund: erlassGrund,
                slug,
              }),
            'Zahlung erlassen. Die Teilnahme ist definitiv.',
          );
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="erlass-grund">Grund</Label>
          <select
            id="erlass-grund"
            value={erlassGrund}
            onChange={(event) => setErlassGrund(event.target.value)}
            className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm"
          >
            {ERLASS_GRUENDE.map((grund) => (
              <option key={grund} value={grund}>
                {grund}
              </option>
            ))}
          </select>
        </div>
      </ConfirmationDialog>

      <ConfirmationDialog
        open={zuruecknehmen !== null}
        onOpenChange={(offen) => !offen && setZuruecknehmen(null)}
        title="Bestätigung zurücknehmen?"
        description={
          zuruecknehmen
            ? `Die Zahlung von ${zuruecknehmen.name} gilt danach wieder als ausstehend, und die Teilnahme ist nicht mehr definitiv. Der Vorgang wird protokolliert.`
            : ''
        }
        confirmLabel="Zurücknehmen"
        destructive
        onConfirm={async () => {
          const zeile = zuruecknehmen;
          if (!zeile) {
            return;
          }
          setZuruecknehmen(null);
          await fuehreAus(
            zeile.registrationId,
            () =>
              revokePaymentAction({
                csrfToken,
                registrationId: zeile.registrationId,
                ziel: 'PENDING',
                slug,
              }),
            'Bestätigung zurückgenommen.',
          );
        }}
      />
    </div>
  );
}

function Kennzahl({
  label,
  wert,
  hinweis,
  ton = 'neutral',
}: {
  label: string;
  wert: number;
  hinweis?: string;
  ton?: 'neutral' | 'gut' | 'warnung';
}): React.JSX.Element {
  const farbe = ton === 'gut' ? 'text-emerald-500' : ton === 'warnung' ? 'text-amber-500' : 'text-foreground';
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-2xl font-semibold tabular-nums ${farbe}`}>{wert}</p>
      {hinweis ? <p className="text-xs text-muted-foreground">{hinweis}</p> : null}
    </div>
  );
}

/**
 * Die Statusmarke einer Zeile.
 *
 * «Erlassen» und «Bestätigt» sind zwei Marken und nicht eine, obwohl beide
 * heissen, dass die Person teilnehmen darf. Wer sie zusammenzöge, hätte
 * später eine Kasse, in der ein Betrag fehlt, den niemand je geschickt hat.
 */
function StatusMarke({ zeile }: { zeile: ZahlungsZeileAnsicht }): React.JSX.Element {
  if (zeile.status === 'CANCELLED') {
    return <Badge variant="outline">Storniert</Badge>;
  }
  switch (zeile.zahlung) {
    case 'PENDING':
      return <Badge variant="secondary">Zahlung ausstehend</Badge>;
    case 'VERIFIED':
      return <Badge variant="default">Teilnahme bestätigt</Badge>;
    case 'WAIVED':
      return <Badge variant="default">Erlassen</Badge>;
    case 'REFUNDED':
      return <Badge variant="destructive">Erstattet</Badge>;
    default:
      return <Badge variant="outline">Kostenlos</Badge>;
  }
}
