'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Gift, Loader2 } from 'lucide-react';
import { formatDateTime } from '@swisshub/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Personensuche, type Personentreffer } from '@/components/shared/personensuche';
import {
  premiumPersonSuchenAction,
  premiumVergabeVorschauAction,
  premiumVergebenAction,
} from '@/modules/premium/actions';

/**
 * «Premium vergeben» (§9).
 *
 * ## Warum die Vorschau serverseitig gerechnet wird
 *
 * Das resultierende Enddatum haengt an drei Dingen, die der Browser nicht
 * zuverlaessig weiss: der bestehenden Laufzeit der Person, der Zeitzone
 * `Europe/Zurich` samt ihren Umstellungen, und der Monatsarithmetik (31.
 * Januar plus ein Monat ist der 28. Februar). Eine zweite Rechnung im Browser
 * waere eine zweite Wahrheit - und die Zahl, die der Admin sieht, waere
 * irgendwann nicht die, die gespeichert wird.
 *
 * Darum fragt dieses Formular bei jeder Aenderung dieselbe Funktion, die
 * spaeter auch vergibt. Was hier steht, ist das, was passiert.
 *
 * ## Warum keine Kennungseingabe
 *
 * §2. Gesucht wird ueber die zentrale `Personensuche` - dieselbe Komponente
 * wie im Workspace und bei den XP-Slot-Geschenken. Intern reist die
 * Discord-Kennung mit; eingegeben wird sie nie.
 */

export interface VergabeProdukt {
  id: string;
  name: string;
  leistungen: string[];
  /** Enthaelt das Angebot mehr als eine Leistung? Dann ist es ein Bundle. */
  bundle: boolean;
}

type Einheit = 'DAYS' | 'WEEKS' | 'MONTHS';

const EINHEITEN: Array<{ wert: Einheit; label: string }> = [
  { wert: 'DAYS', label: 'Tage' },
  { wert: 'WEEKS', label: 'Wochen' },
  { wert: 'MONTHS', label: 'Monate' },
];

/** Die drei Dauern aus der Spezifikation - als Knopf, nicht als Vorschrift. */
const SCHNELLWAHL: Array<{ amount: number; unit: Einheit; label: string }> = [
  { amount: 7, unit: 'DAYS', label: '7 Tage' },
  { amount: 4, unit: 'WEEKS', label: '4 Wochen' },
  { amount: 3, unit: 'MONTHS', label: '3 Monate' },
];

interface Vorschau {
  produktName: string;
  leistungen: string[];
  bestehend: {
    produktName: string;
    status: string;
    endsAt: string | null;
    bezahlt: boolean;
  } | null;
  startsAt: string;
  endsAt: string;
  mode: 'NEW' | 'EXTEND' | 'REPLACE';
  verworfeneTage: number;
}

const MODUS_TEXT: Record<Vorschau['mode'], string> = {
  NEW: 'Neu vergeben',
  EXTEND: 'Verlängert die bestehende Laufzeit',
  REPLACE: 'Ersetzt die bestehende Laufzeit',
};

export function VergabeFormular({
  csrfToken,
  produkte,
}: {
  csrfToken: string;
  produkte: VergabeProdukt[];
}): React.JSX.Element {
  const [person, setPerson] = useState<Personentreffer | null>(null);
  const [runde, setRunde] = useState(0);
  const [productId, setProductId] = useState(produkte[0]?.id ?? '');
  const [amount, setAmount] = useState(7);
  const [unit, setUnit] = useState<Einheit>('DAYS');
  const [modus, setModus] = useState<'extend' | 'replace'>('extend');
  const [startWahl, setStartWahl] = useState('');
  const [grund, setGrund] = useState('');
  const [vorschau, setVorschau] = useState<Vorschau | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [rechnet, setRechnet] = useState(false);

  const suchen = useCallback(
    (begriff: string) => premiumPersonSuchenAction({ csrfToken, begriff }),
    [csrfToken],
  );

  const gewaehlt = produkte.find((eintrag) => eintrag.id === productId) ?? null;

  /*
   * Die Vorschau haengt an allem, was das Ergebnis beeinflusst.
   *
   * `laufRef` verwirft veraltete Antworten: wer schnell von 7 Tagen auf 3
   * Monate stellt, soll nicht die Antwort zur alten Eingabe sehen, weil sie
   * zufaellig spaeter ankam. Dasselbe Muster wie in der Personensuche.
   */
  const laufRef = useRef(0);
  useEffect(() => {
    if (!person || !productId) {
      setVorschau(null);
      return;
    }
    const lauf = laufRef.current + 1;
    laufRef.current = lauf;
    setRechnet(true);

    const zeitgeber = setTimeout(() => {
      void premiumVergabeVorschauAction({
        csrfToken,
        discordId: person.discordId,
        productId,
        amount,
        unit,
        modus,
        startsAt: startWahl ? new Date(startWahl).toISOString() : null,
      })
        .then((antwort) => {
          if (laufRef.current !== lauf) {
            return;
          }
          setVorschau(antwort.ok ? antwort.data : null);
          if (!antwort.ok) {
            setVorschau(null);
          }
        })
        .finally(() => {
          if (laufRef.current === lauf) {
            setRechnet(false);
          }
        });
    }, 220);

    return () => clearTimeout(zeitgeber);
  }, [csrfToken, person, productId, amount, unit, modus, startWahl]);

  const vergeben = async (): Promise<void> => {
    if (!person || !productId) {
      return;
    }
    setLaeuft(true);
    const antwort = await premiumVergebenAction({
      csrfToken,
      discordId: person.discordId,
      productId,
      amount,
      unit,
      modus,
      startsAt: startWahl ? new Date(startWahl).toISOString() : null,
      grund: grund.trim() || null,
    });
    setLaeuft(false);

    if (!antwort.ok) {
      toast.error(antwort.error?.message ?? 'Die Vergabe ist fehlgeschlagen.');
      return;
    }
    const wort =
      antwort.data.mode === 'EXTEND'
        ? 'verlängert'
        : antwort.data.mode === 'REPLACE'
          ? 'ersetzt'
          : 'vergeben';
    toast.success(
      `Premium ${wort} - läuft bis ${formatDateTime(new Date(antwort.data.endsAt))}.${
        antwort.data.discordOk ? '' : ' Discord folgt beim nächsten Abgleich.'
      }`,
    );
    // Die Person bleibt stehen, damit man einer Person zwei Dinge geben kann -
    // aber die Suche startet neu, weil der Stand sich geaendert hat.
    setGrund('');
    setRunde((vorher) => vorher + 1);
  };

  if (produkte.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Es gibt noch keine Angebote. Unter <strong>Produkte</strong> lässt sich eines anlegen - eine Vergabe
        braucht ein Angebot, weil daran hängt, welche Leistungen sie gewährt.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="min-w-0">
          <Label className="text-xs">Person</Label>
          <div className="mt-1">
            <Personensuche<Personentreffer>
              key={`vergabe-${runde}`}
              suchen={suchen}
              ausgeschlossen={[]}
              wert={person}
              aufWahl={setPerson}
              beschriftung="Person für die Premium-Vergabe suchen"
              leerText="Niemand mit diesem Namen kann ein Premium-Abo sehen."
            />
          </div>
        </div>

        <div className="min-w-0">
          <Label className="text-xs" htmlFor="vergabe-produkt">
            Leistung
          </Label>
          <select
            id="vergabe-produkt"
            className="mt-1 h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm"
            value={productId}
            onChange={(ereignis) => setProductId(ereignis.target.value)}
          >
            {produkte.map((produkt) => (
              <option key={produkt.id} value={produkt.id}>
                {produkt.name}
                {produkt.bundle ? ' (Bundle)' : ''}
              </option>
            ))}
          </select>
          {gewaehlt ? (
            <p className="mt-1 flex flex-wrap gap-1">
              {gewaehlt.leistungen.map((leistung) => (
                <Badge key={leistung} variant="secondary" className="text-[10px]">
                  {leistung}
                </Badge>
              ))}
            </p>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-[1fr_1fr_1fr]">
        <div>
          <Label className="text-xs" htmlFor="vergabe-dauer">
            Dauer
          </Label>
          <Input
            id="vergabe-dauer"
            type="number"
            min={1}
            max={730}
            className="mt-1"
            value={amount}
            onChange={(ereignis) => setAmount(Math.max(1, Number(ereignis.target.value) || 1))}
          />
        </div>
        <div>
          <Label className="text-xs" htmlFor="vergabe-einheit">
            Einheit
          </Label>
          <select
            id="vergabe-einheit"
            className="mt-1 h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm"
            value={unit}
            onChange={(ereignis) => setUnit(ereignis.target.value as Einheit)}
          >
            {EINHEITEN.map((eintrag) => (
              <option key={eintrag.wert} value={eintrag.wert}>
                {eintrag.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label className="text-xs" htmlFor="vergabe-start">
            Start (optional)
          </Label>
          <Input
            id="vergabe-start"
            type="datetime-local"
            className="mt-1"
            value={startWahl}
            onChange={(ereignis) => setStartWahl(ereignis.target.value)}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">Leer = sofort.</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {SCHNELLWAHL.map((eintrag) => (
          <Button
            key={eintrag.label}
            type="button"
            size="sm"
            variant={amount === eintrag.amount && unit === eintrag.unit ? 'default' : 'outline'}
            onClick={() => {
              setAmount(eintrag.amount);
              setUnit(eintrag.unit);
            }}
          >
            {eintrag.label}
          </Button>
        ))}
      </div>

      {/*
        Die bestehende Laufzeit und was mit ihr passiert (§5).

        Der Block erscheint nur, wenn es eine gibt - und dann ist die Wahl
        zwischen Verlaengern und Ersetzen keine Nebensache, sondern die
        Hauptfrage. Darum steht sie hier und nicht oben bei den Feldern.
      */}
      {vorschau?.bestehend ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle aria-hidden="true" className="size-4 text-amber-500" />
            Diese Person hat bereits eine Laufzeit
          </p>
          <p className="mt-1 text-muted-foreground">
            {vorschau.bestehend.produktName}
            {vorschau.bestehend.endsAt ? ` bis ${formatDateTime(new Date(vorschau.bestehend.endsAt))}` : ''}
            {vorschau.bestehend.bezahlt ? ' · bezahltes Abonnement' : ''}
          </p>

          {vorschau.bestehend.bezahlt ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Ein bezahltes Abonnement lässt sich von Hand nicht verlängern oder ersetzen: sein Ende gehört
              dem Zahlungsanbieter, und ein von Hand gesetztes wäre beim nächsten Webhook wieder weg. Der Weg
              führt über die Abrechnung des Anbieters.
            </p>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant={modus === 'extend' ? 'default' : 'outline'}
                onClick={() => setModus('extend')}
              >
                Verlängern
              </Button>
              <Button
                type="button"
                size="sm"
                variant={modus === 'replace' ? 'default' : 'outline'}
                onClick={() => setModus('replace')}
              >
                Ersetzen
              </Button>
            </div>
          )}

          {modus === 'replace' && vorschau.verworfeneTage > 0 && !vorschau.bestehend.bezahlt ? (
            <p className="mt-2 text-xs text-destructive">
              Ersetzen verwirft {vorschau.verworfeneTage} {vorschau.verworfeneTage === 1 ? 'Tag' : 'Tage'}{' '}
              Restlaufzeit.
            </p>
          ) : null}
        </div>
      ) : null}

      <div>
        <Label className="text-xs" htmlFor="vergabe-grund">
          Grund / Notiz
        </Label>
        <Input
          id="vergabe-grund"
          className="mt-1"
          placeholder="Gewinn aus dem Turnier vom 4. Oktober"
          maxLength={500}
          value={grund}
          onChange={(ereignis) => setGrund(ereignis.target.value)}
        />
      </div>

      {/* Das Ergebnis - die Zahl, auf die es ankommt. */}
      <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
        {!person ? (
          <p className="text-muted-foreground">Wähle zuerst eine Person.</p>
        ) : rechnet && !vorschau ? (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Loader2 aria-hidden="true" className="size-4 animate-spin" /> Enddatum wird berechnet …
          </p>
        ) : vorschau ? (
          <div className="space-y-1">
            <p className="flex flex-wrap items-center gap-2">
              <Badge variant={vorschau.mode === 'REPLACE' ? 'destructive' : 'secondary'}>
                {MODUS_TEXT[vorschau.mode]}
              </Badge>
              {rechnet ? (
                <Loader2 aria-hidden="true" className="size-3 animate-spin text-muted-foreground" />
              ) : null}
            </p>
            <p>
              <span className="text-muted-foreground">Läuft von</span>{' '}
              <strong>{formatDateTime(new Date(vorschau.startsAt))}</strong>{' '}
              <span className="text-muted-foreground">bis</span>{' '}
              <strong className="text-[hsl(var(--primary-bright))]">
                {formatDateTime(new Date(vorschau.endsAt))}
              </strong>
            </p>
            <p className="text-xs text-muted-foreground">
              Gewährt: {vorschau.leistungen.join(', ') || 'keine Leistung hinterlegt'}
            </p>
          </div>
        ) : (
          <p className="text-muted-foreground">Das Enddatum lässt sich für diese Eingabe nicht berechnen.</p>
        )}
      </div>

      <Button
        type="button"
        className="w-full sm:w-auto"
        disabled={laeuft || person === null || vorschau === null || vorschau.bestehend?.bezahlt === true}
        onClick={() => void vergeben()}
      >
        <Gift aria-hidden="true" />
        {laeuft ? 'Wird vergeben …' : 'Vergeben'}
      </Button>
    </div>
  );
}
