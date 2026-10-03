'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  AlertTriangle,
  BarChart3,
  CalendarClock,
  Check,
  Coins,
  Dice5,
  FlaskConical,
  Gauge,
  Gift,
  History,
  Image as BildIcon,
  LayoutDashboard,
  Music,
  Palette,
  RotateCcw,
  Save,
  Settings,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import type { level } from '@swisshub/modules';
import { formatSwissNumber } from '@swisshub/shared';
import { formatDateTime } from '../../components/raffle-shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import { cn } from '@/lib/utils';
import { istEigenesBild, quelle, STANDARD_KLAENGE, symbolBild } from '../adressen';
import {
  designSpeichernAction,
  eventAktivierenAction,
  eventBeendenAction,
  eventPruefenAction,
  feedSpeichernAction,
  freispieleEntziehenAction,
  freispieleFristAction,
  freispieleGewaehrenAction,
  klangEntfernenAction,
  klangStellenAction,
  konfigSpeichernAction,
  paketAnlegenAction,
  paketLoeschenAction,
  paytableSpeichernAction,
  statusSetzenAction,
  symbolSpeichernAction,
  testlaufAction,
} from '../../xpslot-actions';

/**
 * Die Verwaltung des XP-Slots.
 *
 * ## Zwoelf Bereiche, nicht mehr
 *
 * Uebersicht, Spielregeln, Symbole, Paytable, Bonus, Freespins, Design,
 * Sounds, Events, Statistik, Historie, Einstellungen. Die Liste steht so im
 * Konzept, und sie ist eine Obergrenze: ein dreizehnter Bereich waere ein
 * Zeichen, dass etwas an die falsche Stelle geraten ist.
 *
 * ## Warum die Quote nach jedem Speichern dasteht
 *
 * Weil jede Zahl hier sie veraendert. Wer ein Gewicht anfasst, aendert die
 * Auszahlungsquote des Automaten - und soll es im selben Moment sehen, nicht
 * beim naechsten Oeffnen eines anderen Tabs. Die Quote kommt aus derselben
 * Rechnung, mit der gespielt wird.
 */

type Uebersicht = Awaited<ReturnType<typeof level.xpslot.leseKonfiguration>>;
type Rtp = ReturnType<typeof level.xpslot.rtpVon>;
type Pakete = Awaited<ReturnType<typeof level.xpslot.pakete>>;
type Freispiele = Awaited<ReturnType<typeof level.xpslot.offeneFreispiele>>['pakete'];
type Events = Awaited<ReturnType<typeof level.xpslot.eventListe>>;
type Kennzahlen = Awaited<ReturnType<typeof level.xpslot.kennzahlen>>;
type Verlauf = Awaited<ReturnType<typeof level.xpslot.verlauf>>;
type Testergebnis = Awaited<ReturnType<typeof level.xpslot.testlauf>>['ergebnis'];

const BEREICHE = [
  { key: 'uebersicht', label: 'Übersicht', icon: LayoutDashboard },
  { key: 'regeln', label: 'Spielregeln', icon: Gauge },
  { key: 'symbole', label: 'Symbole', icon: BildIcon },
  { key: 'paytable', label: 'Paytable', icon: Coins },
  { key: 'bonus', label: 'Bonus', icon: Sparkles },
  { key: 'freespins', label: 'Freespins', icon: Gift },
  { key: 'design', label: 'Design', icon: Palette },
  { key: 'sounds', label: 'Sounds', icon: Music },
  { key: 'events', label: 'Events', icon: CalendarClock },
  { key: 'statistik', label: 'Statistik', icon: BarChart3 },
  { key: 'historie', label: 'Historie', icon: History },
  { key: 'einstellungen', label: 'Einstellungen', icon: Settings },
] as const;

type Bereich = (typeof BEREICHE)[number]['key'];

export interface VerwaltungProps {
  csrfToken: string;
  konfiguration: Uebersicht;
  rtp: Rtp;
  pakete: Pakete;
  freispiele: Freispiele;
  events: Events;
  kennzahlen: Kennzahlen;
  verlauf: Verlauf;
  klangSlots: ReadonlyArray<{ key: string; label: string; gruppe: string }>;
  testfaelle: ReadonlyArray<{ key: string; label: string }>;
  darfFreispiele: boolean;
}

export function SlotVerwaltung(props: VerwaltungProps): React.JSX.Element {
  const [bereich, setBereich] = useState<Bereich>('uebersicht');

  return (
    <div className="space-y-4">
      <nav className="flex flex-wrap gap-1.5 rounded-xl border border-border bg-card p-1.5">
        {BEREICHE.map((eintrag) => {
          const Symbol = eintrag.icon;
          return (
            <button
              key={eintrag.key}
              type="button"
              onClick={() => setBereich(eintrag.key)}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                bereich === eintrag.key
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Symbol aria-hidden="true" className="size-3.5" />
              {eintrag.label}
            </button>
          );
        })}
      </nav>

      {bereich === 'uebersicht' ? <UebersichtTab {...props} /> : null}
      {bereich === 'regeln' ? <RegelnTab {...props} nurBonus={false} /> : null}
      {bereich === 'bonus' ? <RegelnTab {...props} nurBonus /> : null}
      {bereich === 'symbole' ? <SymboleTab {...props} /> : null}
      {bereich === 'paytable' ? <PaytableTab {...props} /> : null}
      {bereich === 'freespins' ? <FreespinsTab {...props} /> : null}
      {bereich === 'design' ? <DesignTab {...props} /> : null}
      {bereich === 'sounds' ? <SoundsTab {...props} /> : null}
      {bereich === 'events' ? <EventsTab {...props} /> : null}
      {bereich === 'statistik' ? <StatistikTab {...props} /> : null}
      {bereich === 'historie' ? <HistorieTab {...props} /> : null}
      {bereich === 'einstellungen' ? <EinstellungenTab {...props} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bausteine
// ---------------------------------------------------------------------------

function Kasten({
  titel,
  hinweis,
  children,
}: {
  titel: string;
  hinweis?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="text-sm font-semibold">{titel}</h2>
      {hinweis ? <p className="mt-0.5 text-xs text-muted-foreground">{hinweis}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Kachel({
  label,
  wert,
  hinweis,
}: {
  label: string;
  wert: string;
  hinweis?: string | null;
}): React.JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-background/50 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-lg font-bold tabular-nums">{wert}</p>
      {hinweis ? <p className="text-[11px] text-muted-foreground">{hinweis}</p> : null}
    </div>
  );
}

/** Die Quote mit Bewertung - der wichtigste Wert dieser Seite. */
function RtpAnzeige({ rtp }: { rtp: Rtp }): React.JSX.Element {
  const lage = rtp.rtp < 0.92 ? 'zu_tief' : rtp.rtp > 0.95 ? 'zu_hoch' : 'im_ziel';
  return (
    <div
      className={cn(
        'rounded-xl border p-4',
        lage === 'im_ziel' ? 'border-success/40 bg-success/5' : 'border-warning/40 bg-warning/5',
      )}
    >
      <div className="flex flex-wrap items-baseline gap-3">
        <p className="text-3xl font-black tabular-nums">{(rtp.rtp * 100).toFixed(1)} %</p>
        <p className="text-xs text-muted-foreground">Zielspanne 92 bis 95 %</p>
        {lage !== 'im_ziel' ? (
          <span className="flex items-center gap-1 text-xs font-medium text-warning">
            <AlertTriangle aria-hidden="true" className="size-3.5" />
            {lage === 'zu_tief' ? 'unter der Zielspanne' : 'über der Zielspanne'}
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs font-medium text-success">
            <Check aria-hidden="true" className="size-3.5" />
            in der Zielspanne
          </span>
        )}
      </div>
      <div className="mt-3 grid gap-2 text-xs sm:grid-cols-4">
        <p>
          Grundspiel <strong className="tabular-nums">{(rtp.rtpGrundspiel * 100).toFixed(1)} %</strong>
        </p>
        <p>
          Freispiele <strong className="tabular-nums">{(rtp.rtpBonus * 100).toFixed(1)} %</strong>
        </p>
        <p>
          Bonus alle{' '}
          <strong className="tabular-nums">{Math.round(1 / Math.max(1e-9, rtp.bonusChance))}</strong> Spins
        </p>
        <p>
          Jackpot alle{' '}
          <strong className="tabular-nums">
            {formatSwissNumber(Math.round(1 / Math.max(1e-12, rtp.jackpotChance)))}
          </strong>{' '}
          Spins
        </p>
      </div>
      {rtp.fehler.length > 0 ? (
        <ul className="mt-3 space-y-1 text-xs text-destructive">
          {rtp.fehler.map((zeile) => (
            <li key={zeile}>{zeile}</li>
          ))}
        </ul>
      ) : null}
      {rtp.hinweise.length > 0 ? (
        <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
          {rtp.hinweise.map((zeile) => (
            <li key={zeile}>{zeile}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Ein kleiner Haken um ein Speichern mit Rueckmeldung. */
function useSpeichern(): {
  laeuft: boolean;
  fuehreAus: (
    aufgabe: () => Promise<{ ok: boolean; error?: { message: string }; data?: unknown }>,
    erfolg: string,
    danach?: () => void,
  ) => Promise<unknown>;
} {
  const [laeuft, setLaeuft] = useState(false);
  const router = useRouter();

  const fuehreAus = useCallback(
    async (
      aufgabe: () => Promise<{ ok: boolean; error?: { message: string }; data?: unknown }>,
      erfolg: string,
      /*
       * Fuer den Fall, dass das Formular den geaenderten Wert selbst halten
       * muss. `router.refresh()` laedt die Serverdaten neu, aber ein `useState`
       * im Formular bleibt stehen - sonst zeigte das Feld nach dem
       * Zuruecksetzen weiter den alten Dateinamen.
       */
      danach?: () => void,
    ) => {
      setLaeuft(true);
      try {
        const antwort = await aufgabe();
        if (!antwort.ok) {
          toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
          return null;
        }
        toast.success(erfolg);
        danach?.();
        router.refresh();
        return antwort.data ?? null;
      } finally {
        setLaeuft(false);
      }
    },
    [router],
  );

  return { laeuft, fuehreAus };
}

/**
 * Ein Knopf mit Rueckfrage.
 *
 * Der gemeinsame `ConfirmationDialog` ist gesteuert - er kennt keinen eigenen
 * Ausloeser. Diese kleine Huelle haelt den Zustand und spart die drei Zeilen
 * an jeder Aufrufstelle.
 */
function RueckfrageKnopf({
  titel,
  beschreibung,
  bestaetigen,
  kind,
  onBestaetigt,
}: {
  titel: string;
  beschreibung: string;
  bestaetigen: string;
  kind: React.ReactNode;
  onBestaetigt: () => void;
}): React.JSX.Element {
  const [offen, setOffen] = useState(false);

  return (
    <>
      <span onClick={() => setOffen(true)} role="presentation">
        {kind}
      </span>
      <ConfirmationDialog
        open={offen}
        onOpenChange={setOffen}
        title={titel}
        description={beschreibung}
        confirmLabel={bestaetigen}
        destructive
        onConfirm={() => {
          onBestaetigt();
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Übersicht
// ---------------------------------------------------------------------------

function UebersichtTab({
  konfiguration,
  rtp,
  kennzahlen,
  freispiele,
  pakete,
  events,
}: VerwaltungProps): React.JSX.Element {
  const w = konfiguration.wirksam;
  const aktivesPaket = pakete.find((paket) => paket.aktiv);
  const laufendesEvent = events.find((eintrag) => eintrag.laeuft);

  return (
    <div className="space-y-4">
      <RtpAnzeige rtp={rtp} />
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
        <Kachel
          label="Status"
          wert={STATUS_LABEL[w.status] ?? w.status}
          hinweis={konfiguration.config.maintenanceNote}
        />
        <Kachel label="Spins gesamt" wert={formatSwissNumber(kennzahlen.spins)} />
        <Kachel label="XP eingesetzt" wert={formatSwissNumber(kennzahlen.xpEin)} />
        <Kachel label="XP ausgezahlt" wert={formatSwissNumber(kennzahlen.xpAus)} />
        <Kachel
          label="Echte Quote"
          wert={kennzahlen.rtpEcht === null ? '–' : `${(kennzahlen.rtpEcht * 100).toFixed(1)} %`}
          hinweis={`aus ${formatSwissNumber(kennzahlen.bezahlteSpins)} bezahlten Spins`}
        />
        <Kachel label="Jackpot-Multiplikator" wert={`${w.jackpotMultiplikator}×`} />
        <Kachel label="Aktives Sound-Paket" wert={aktivesPaket?.name ?? 'keines'} />
        <Kachel label="Eventmodus" wert={laufendesEvent?.name ?? 'keiner'} />
        <Kachel
          label="Offene Freispielpakete"
          wert={String(freispiele.length)}
          hinweis={`${freispiele.reduce((wert, paket) => wert + paket.offen, 0)} Freispiele offen`}
        />
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Aktiv',
  MAINTENANCE: 'Wartung',
  DISABLED: 'Abgeschaltet',
  EVENT_ONLY: 'Nur im Event',
};

// ---------------------------------------------------------------------------
// Spielregeln und Bonus
// ---------------------------------------------------------------------------

function RegelnTab({
  csrfToken,
  konfiguration,
  nurBonus,
}: VerwaltungProps & { nurBonus: boolean }): React.JSX.Element {
  const w = konfiguration.wirksam;
  const { laeuft, fuehreAus } = useSpeichern();
  const [werte, setWerte] = useState({
    einsaetze: w.einsaetze.join(', '),
    minEinsatz: w.minEinsatz,
    maxEinsatz: w.maxEinsatz,
    jackpotMultiplikator: w.jackpotMultiplikator,
    jackpotNurEcht: w.jackpotNurEcht,
    wildErsetztAlles: w.wildErsetztAlles,
    bonusAusloeser: w.bonusAusloeser,
    bonusFreispiele: w.bonusFreispiele,
    leiter1: w.leiter1,
    leiter2: w.leiter2,
    gambleChance1Bp: w.gambleChance1Bp,
    gambleChance2Bp: w.gambleChance2Bp,
    retriggerSpins: w.retriggerSpins,
    stickyWilds: w.stickyWilds,
    premiumAktiv: konfiguration.config.premiumEnabled,
    maxGewinnMultiplikator: w.maxGewinnMultiplikator,
    maxTagesverlust: w.maxTagesverlust,
    maxTagesgewinn: w.maxTagesgewinn,
    maxSpinsJeSitzung: w.maxSpinsJeSitzung,
    sitzungspauseSekunden: w.sitzungspauseSekunden,
    autoSpinZahlen: w.autoSpinZahlen.join(', '),
    tierGross: w.tierGross,
    tierMega: w.tierMega,
  });

  const zahlenListe = (text: string): number[] =>
    text
      .split(/[,\s]+/u)
      .map((teil) => Number.parseInt(teil, 10))
      .filter((wert) => Number.isFinite(wert) && wert > 0);

  const speichern = (): void => {
    void fuehreAus(
      () =>
        konfigSpeichernAction({
          csrfToken,
          einsaetze: zahlenListe(werte.einsaetze),
          minEinsatz: werte.minEinsatz,
          maxEinsatz: werte.maxEinsatz,
          jackpotMultiplikator: werte.jackpotMultiplikator,
          jackpotNurEcht: werte.jackpotNurEcht,
          wildErsetztAlles: werte.wildErsetztAlles,
          bonusAusloeser: werte.bonusAusloeser,
          bonusFreispiele: werte.bonusFreispiele,
          leiter1: werte.leiter1,
          leiter2: werte.leiter2,
          gambleChance1Bp: werte.gambleChance1Bp,
          gambleChance2Bp: werte.gambleChance2Bp,
          retriggerSpins: werte.retriggerSpins,
          stickyWilds: werte.stickyWilds,
          premiumAktiv: werte.premiumAktiv,
          maxGewinnMultiplikator: werte.maxGewinnMultiplikator,
          maxTagesverlust: werte.maxTagesverlust,
          maxTagesgewinn: werte.maxTagesgewinn,
          maxSpinsJeSitzung: werte.maxSpinsJeSitzung,
          sitzungspauseSekunden: werte.sitzungspauseSekunden,
          autoSpinZahlen: zahlenListe(werte.autoSpinZahlen),
          tierGross: werte.tierGross,
          tierMega: werte.tierMega,
        }),
      'Gespeichert.',
    );
  };

  const Zahl = ({
    feld,
    label,
    hinweis,
  }: {
    feld: keyof typeof werte;
    label: string;
    hinweis?: string;
  }): React.JSX.Element => (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        className="mt-1"
        value={String(werte[feld])}
        onChange={(ereignis) => setWerte((vorher) => ({ ...vorher, [feld]: Number(ereignis.target.value) }))}
      />
      {hinweis ? <p className="mt-1 text-[11px] text-muted-foreground">{hinweis}</p> : null}
    </div>
  );

  const Schalter = ({
    feld,
    label,
    hinweis,
  }: {
    feld: keyof typeof werte;
    label: string;
    hinweis?: string;
  }): React.JSX.Element => (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
      <div>
        <p className="text-xs font-medium">{label}</p>
        {hinweis ? <p className="text-[11px] text-muted-foreground">{hinweis}</p> : null}
      </div>
      <Switch
        checked={Boolean(werte[feld])}
        onCheckedChange={(wert) => setWerte((vorher) => ({ ...vorher, [feld]: wert }))}
      />
    </div>
  );

  return (
    <div className="space-y-4">
      {konfiguration.event ? (
        <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
          Gerade läuft der Eventmodus «{konfiguration.event.name}». Er überschreibt Teile dieser Werte,
          solange er läuft - was hier steht, gilt danach wieder.
        </p>
      ) : null}

      {nurBonus ? (
        <>
          <Kasten titel="Bonus" hinweis="Wie der Bonus ausgelöst wird und was er bringt.">
            <div className="grid gap-3 sm:grid-cols-3">
              <Zahl feld="bonusAusloeser" label="Bonussymbole zum Auslösen" />
              <Zahl feld="bonusFreispiele" label="Garantierte Freispiele" />
              <Zahl feld="retriggerSpins" label="Freispiele bei Retrigger" />
            </div>
          </Kasten>
          <Kasten
            titel="Risikoleiter"
            hinweis="Chancen in Basispunkten: 3400 sind 34,00 Prozent. Vorsicht - Freispiele mit Sticky Wilds sind überproportional wertvoll, bei 50 Prozent lohnt sich Riskieren und die Quote steigt über 100 Prozent."
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Zahl feld="leiter1" label="Erste Stufe (Freispiele)" />
              <Zahl feld="gambleChance1Bp" label="Chance erste Stufe (bp)" />
              <Zahl feld="leiter2" label="Zweite Stufe (Freispiele)" />
              <Zahl feld="gambleChance2Bp" label="Chance zweite Stufe (bp)" />
            </div>
          </Kasten>
          <Kasten titel="Freispielmodus">
            <div className="grid gap-3 sm:grid-cols-2">
              <Schalter
                feld="stickyWilds"
                label="Sticky Wilds"
                hinweis="Wilds bleiben für die ganze Bonusrunde stehen."
              />
              <Schalter
                feld="premiumAktiv"
                label="Premium-Gewinne"
                hinweis="Wirkt nur, solange ein Eventmodus läuft - so steht es im Konzept."
              />
            </div>
          </Kasten>
        </>
      ) : (
        <>
          <Kasten titel="Einsätze" hinweis="Nur diese Beträge sind spielbar. Kommagetrennt.">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="sm:col-span-3">
                <Label className="text-xs">Spielbare Einsätze</Label>
                <Input
                  className="mt-1"
                  value={werte.einsaetze}
                  onChange={(ereignis) =>
                    setWerte((vorher) => ({ ...vorher, einsaetze: ereignis.target.value }))
                  }
                />
              </div>
              <Zahl feld="minEinsatz" label="Kleinster Einsatz" />
              <Zahl feld="maxEinsatz" label="Grösster Einsatz" />
              <div>
                <Label className="text-xs">Auto-Spin-Zahlen</Label>
                <Input
                  className="mt-1"
                  value={werte.autoSpinZahlen}
                  onChange={(ereignis) =>
                    setWerte((vorher) => ({ ...vorher, autoSpinZahlen: ereignis.target.value }))
                  }
                />
                <p className="mt-1 text-[11px] text-muted-foreground">Niemals unbegrenzt.</p>
              </div>
            </div>
          </Kasten>

          <Kasten titel="Jackpot und Wild">
            <div className="grid gap-3 sm:grid-cols-2">
              <Zahl
                feld="jackpotMultiplikator"
                label="Jackpot-Multiplikator (× Einsatz)"
                hinweis="Fünf Logos auf einer Linie. Kein mitwachsender Pott."
              />
              <Zahl
                feld="maxGewinnMultiplikator"
                label="Höchstgewinn je Spin (× Einsatz)"
                hinweis="0 bedeutet kein Deckel."
              />
              <Schalter
                feld="jackpotNurEcht"
                label="Jackpot nur mit echten Logos"
                hinweis="Ohne diese Regel wäre ein Wild im Jackpot eine Hintertür."
              />
              <Schalter
                feld="wildErsetztAlles"
                label="Wild ersetzt auch Logo, Premium und Bonus"
                hinweis="Macht das Wild zum wertvollsten Symbol - hebt die Quote deutlich."
              />
            </div>
          </Kasten>

          <Kasten
            titel="Gewinnstufen"
            hinweis="Vielfache des Einsatzes. Sie steuern Inszenierung und Auto-Spin-Stopps."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Zahl feld="tierGross" label="Big Win ab (×)" />
              <Zahl feld="tierMega" label="Mega Win ab (×)" />
            </div>
          </Kasten>

          <Kasten titel="Grenzen" hinweis="0 bedeutet durchgehend: keine Grenze.">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Zahl feld="maxTagesverlust" label="Max. Verlust pro Tag (XP)" />
              <Zahl feld="maxTagesgewinn" label="Max. Gewinn pro Tag (XP)" />
              <Zahl feld="maxSpinsJeSitzung" label="Max. Spins je Sitzung" />
              <Zahl feld="sitzungspauseSekunden" label="Pause danach (Sekunden)" />
            </div>
          </Kasten>
        </>
      )}

      <Button disabled={laeuft} onClick={speichern}>
        <Save aria-hidden="true" />
        Speichern
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Symbole
// ---------------------------------------------------------------------------

function SymboleTab({ csrfToken, konfiguration }: VerwaltungProps): React.JSX.Element {
  const { laeuft, fuehreAus } = useSpeichern();

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Rolle und Schlüssel stehen im Code - sie bestimmen, was ein Symbol im Spiel tut. Alles andere ist
        einstellbar. Ein Gewicht von 0 nimmt das Symbol von den Walzen.
      </p>
      {konfiguration.symbole.map((symbol) => (
        <SymbolZeile
          key={symbol.key}
          csrfToken={csrfToken}
          symbol={symbol}
          laeuft={laeuft}
          fuehreAus={fuehreAus}
        />
      ))}
    </div>
  );
}

function SymbolZeile({
  csrfToken,
  symbol,
  laeuft,
  fuehreAus,
}: {
  csrfToken: string;
  symbol: Uebersicht['symbole'][number];
  laeuft: boolean;
  fuehreAus: ReturnType<typeof useSpeichern>['fuehreAus'];
}): React.JSX.Element {
  const [werte, setWerte] = useState({
    name: symbol.name,
    aktiv: symbol.active,
    gewicht: symbol.weight,
    glow: symbol.glow,
    bildPfad: symbol.imagePath,
    bildUrl: symbol.imageUrl ?? '',
    auszahlung3: symbol.payout3Bp,
    auszahlung4: symbol.payout4Bp,
    auszahlung5: symbol.payout5Bp,
    premiumTage3: symbol.premiumDays3,
    premiumTage4: symbol.premiumDays4,
    premiumTage5: symbol.premiumDays5,
  });
  const [laedt, setLaedt] = useState(false);
  /*
   * Dieselbe Aufloesung wie im Spiel - Vorschau und Produktivansicht duerfen
   * nicht auseinanderlaufen. Ohne eigenes Bild steht hier das mitgelieferte.
   */
  const bild = symbolBild({ key: symbol.key, bildPfad: werte.bildPfad, bildUrl: werte.bildUrl || null });
  const eigenes = istEigenesBild({ bildPfad: werte.bildPfad, bildUrl: werte.bildUrl || null });

  const hochladen = async (datei: File): Promise<void> => {
    setLaedt(true);
    try {
      const form = new FormData();
      form.set('csrfToken', csrfToken);
      form.set('art', 'bild');
      form.set('datei', datei);
      const antwort = await fetch('/api/level/xp-slot/upload', { method: 'POST', body: form });
      const ergebnis = (await antwort.json()) as
        { ok: true; data: { dateiname: string } } | { ok: false; error: { message: string } };
      if (!ergebnis.ok) {
        toast.error(ergebnis.error.message);
        return;
      }
      setWerte((vorher) => ({ ...vorher, bildPfad: ergebnis.data.dateiname }));
      toast.success('Bild hochgeladen. Noch speichern.');
    } finally {
      setLaedt(false);
    }
  };

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start gap-4">
        <div className="shrink-0 text-center">
          <div className="grid size-16 place-items-center rounded-lg border border-border bg-background/60">
            {bild ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={bild} alt="" className="size-12 object-contain" />
            ) : (
              <span className="text-xs text-muted-foreground">kein Bild</span>
            )}
          </div>
          {/*
            Woher das Bild kommt, steht unter dem Bild und nicht im Text
            daneben: wer acht Symbole durchsieht, sucht genau hier.
          */}
          <p
            className={cn(
              'mt-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
              eigenes ? 'bg-primary/15 text-[hsl(var(--primary-bright))]' : 'bg-muted text-muted-foreground',
            )}
          >
            {eigenes ? 'Eigenes' : 'Standard'}
          </p>
        </div>
        <div className="flex-1 space-y-3">
          <div className="grid gap-3 sm:grid-cols-4">
            <div>
              <Label className="text-xs">Name</Label>
              <Input
                className="mt-1"
                value={werte.name}
                onChange={(ereignis) => setWerte((v) => ({ ...v, name: ereignis.target.value }))}
              />
            </div>
            <div>
              <Label className="text-xs">Rolle</Label>
              <Input className="mt-1" value={symbol.role} disabled />
            </div>
            <div>
              <Label className="text-xs">Gewicht</Label>
              <Input
                type="number"
                className="mt-1"
                value={String(werte.gewicht)}
                onChange={(ereignis) => setWerte((v) => ({ ...v, gewicht: Number(ereignis.target.value) }))}
              />
            </div>
            <div className="flex items-end gap-3 pb-1">
              <label className="flex items-center gap-2 text-xs">
                <Switch
                  checked={werte.aktiv}
                  onCheckedChange={(wert) => setWerte((v) => ({ ...v, aktiv: wert }))}
                />
                aktiv
              </label>
              <label className="flex items-center gap-2 text-xs">
                <Switch
                  checked={werte.glow}
                  onCheckedChange={(wert) => setWerte((v) => ({ ...v, glow: wert }))}
                />
                Glow
              </label>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {([3, 4, 5] as const).map((stufe) => (
              <div key={stufe}>
                <Label className="text-xs">{stufe}× gleich (bp des Einsatzes)</Label>
                <Input
                  type="number"
                  className="mt-1"
                  value={String(werte[`auszahlung${stufe}` as const])}
                  onChange={(ereignis) =>
                    setWerte((v) => ({ ...v, [`auszahlung${stufe}`]: Number(ereignis.target.value) }))
                  }
                />
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  = {(werte[`auszahlung${stufe}` as const] / 10000).toFixed(2)}× Einsatz
                </p>
              </div>
            ))}
          </div>

          {symbol.role === 'PREMIUM' ? (
            <div className="grid gap-3 sm:grid-cols-3">
              {([3, 4, 5] as const).map((stufe) => (
                <div key={stufe}>
                  <Label className="text-xs">{stufe}× gleich: Premium-Tage</Label>
                  <Input
                    type="number"
                    className="mt-1"
                    value={String(werte[`premiumTage${stufe}` as const])}
                    onChange={(ereignis) =>
                      setWerte((v) => ({ ...v, [`premiumTage${stufe}`]: Number(ereignis.target.value) }))
                    }
                  />
                </div>
              ))}
            </div>
          ) : null}

          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1">
              <Label className="text-xs">Bildadresse (Alternative zum Hochladen)</Label>
              <Input
                className="mt-1"
                value={werte.bildUrl}
                placeholder="https://..."
                onChange={(ereignis) => setWerte((v) => ({ ...v, bildUrl: ereignis.target.value }))}
              />
            </div>
            <label className={cn('cursor-pointer', laedt && 'pointer-events-none opacity-50')}>
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-muted">
                <Upload aria-hidden="true" className="size-3.5" />
                {laedt ? 'Lädt...' : 'PNG oder WEBP'}
              </span>
              <input
                type="file"
                accept="image/png,image/webp,image/jpeg"
                className="hidden"
                onChange={(ereignis) => {
                  const datei = ereignis.target.files?.[0];
                  if (datei) {
                    void hochladen(datei);
                  }
                }}
              />
            </label>
            {/*
              Zuruecksetzen heisst: die Referenz loeschen und speichern.

              Es wird nichts kopiert und nichts wiederhergestellt - das
              Standardbild liegt im Auslieferungsverzeichnis und gilt immer
              dann, wenn hier nichts steht. Darum ist der Knopf still, wenn
              ohnehin schon der Standard laeuft.
            */}
            {eigenes ? (
              <Button
                size="sm"
                variant="outline"
                disabled={laeuft}
                onClick={() =>
                  void fuehreAus(
                    () =>
                      symbolSpeichernAction({
                        csrfToken,
                        key: symbol.key,
                        name: werte.name,
                        aktiv: werte.aktiv,
                        gewicht: werte.gewicht,
                        glow: werte.glow,
                        bildPfad: null,
                        bildUrl: null,
                        auszahlung3: werte.auszahlung3,
                        auszahlung4: werte.auszahlung4,
                        auszahlung5: werte.auszahlung5,
                        premiumTage3: werte.premiumTage3,
                        premiumTage4: werte.premiumTage4,
                        premiumTage5: werte.premiumTage5,
                      }),
                    `${werte.name} nutzt wieder das Standardsymbol.`,
                    () => setWerte((v) => ({ ...v, bildPfad: null, bildUrl: '' })),
                  )
                }
              >
                <RotateCcw aria-hidden="true" />
                Auf Standard zurücksetzen
              </Button>
            ) : null}
            <Button
              size="sm"
              disabled={laeuft}
              onClick={() =>
                void fuehreAus(
                  () =>
                    symbolSpeichernAction({
                      csrfToken,
                      key: symbol.key,
                      name: werte.name,
                      aktiv: werte.aktiv,
                      gewicht: werte.gewicht,
                      glow: werte.glow,
                      bildPfad: werte.bildPfad,
                      bildUrl: werte.bildUrl.trim() || null,
                      auszahlung3: werte.auszahlung3,
                      auszahlung4: werte.auszahlung4,
                      auszahlung5: werte.auszahlung5,
                      premiumTage3: werte.premiumTage3,
                      premiumTage4: werte.premiumTage4,
                      premiumTage5: werte.premiumTage5,
                    }),
                  `${werte.name} gespeichert.`,
                )
              }
            >
              <Save aria-hidden="true" />
              Speichern
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Paytable
// ---------------------------------------------------------------------------

function PaytableTab({ csrfToken, konfiguration, rtp }: VerwaltungProps): React.JSX.Element {
  const { laeuft, fuehreAus } = useSpeichern();
  const [jackpot, setJackpot] = useState(konfiguration.wirksam.jackpotMultiplikator);
  const [zeilen, setZeilen] = useState(() =>
    konfiguration.symbole.map((symbol) => ({
      key: symbol.key,
      name: symbol.name,
      rolle: symbol.role,
      auszahlung3: symbol.payout3Bp,
      auszahlung4: symbol.payout4Bp,
      auszahlung5: symbol.payout5Bp,
      premiumTage3: symbol.premiumDays3,
      premiumTage4: symbol.premiumDays4,
      premiumTage5: symbol.premiumDays5,
    })),
  );

  const setze = (key: string, feld: string, wert: number): void =>
    setZeilen((vorher) => vorher.map((zeile) => (zeile.key === key ? { ...zeile, [feld]: wert } : zeile)));

  return (
    <div className="space-y-4">
      <RtpAnzeige rtp={rtp} />
      <Kasten
        titel="Auszahlungstabelle"
        hinweis="Werte in Basispunkten des Einsatzes: 10000 sind ein ganzer Einsatz. Zehn Linien zahlen gleichzeitig, deshalb sind die Werte klein."
      >
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="p-2 text-left font-medium">Symbol</th>
                <th className="p-2 text-right font-medium">3×</th>
                <th className="p-2 text-right font-medium">4×</th>
                <th className="p-2 text-right font-medium">5×</th>
                <th className="p-2 text-right font-medium">Premium-Tage 3/4/5</th>
              </tr>
            </thead>
            <tbody>
              {zeilen.map((zeile) => (
                <tr key={zeile.key} className="border-t border-border">
                  <td className="p-2 font-medium">
                    {zeile.name}
                    <span className="ml-1 text-[10px] uppercase text-muted-foreground">{zeile.rolle}</span>
                  </td>
                  {([3, 4, 5] as const).map((stufe) => (
                    <td key={stufe} className="p-2">
                      <Input
                        type="number"
                        className="h-8 text-right"
                        value={String(zeile[`auszahlung${stufe}` as const])}
                        onChange={(ereignis) =>
                          setze(zeile.key, `auszahlung${stufe}`, Number(ereignis.target.value))
                        }
                      />
                    </td>
                  ))}
                  <td className="p-2">
                    <div className="flex gap-1">
                      {([3, 4, 5] as const).map((stufe) => (
                        <Input
                          key={stufe}
                          type="number"
                          className="h-8 w-16 text-right"
                          disabled={zeile.rolle !== 'PREMIUM'}
                          value={String(zeile[`premiumTage${stufe}` as const])}
                          onChange={(ereignis) =>
                            setze(zeile.key, `premiumTage${stufe}`, Number(ereignis.target.value))
                          }
                        />
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-xs">Jackpot-Multiplikator (× Einsatz)</Label>
            <Input
              type="number"
              className="mt-1 w-40"
              value={String(jackpot)}
              onChange={(ereignis) => setJackpot(Number(ereignis.target.value))}
            />
          </div>
          <Button
            disabled={laeuft}
            onClick={() =>
              void fuehreAus(
                () =>
                  paytableSpeichernAction({
                    csrfToken,
                    jackpotMultiplikator: jackpot,
                    zeilen: zeilen.map((zeile) => ({
                      key: zeile.key,
                      auszahlung3: zeile.auszahlung3,
                      auszahlung4: zeile.auszahlung4,
                      auszahlung5: zeile.auszahlung5,
                      premiumTage3: zeile.premiumTage3,
                      premiumTage4: zeile.premiumTage4,
                      premiumTage5: zeile.premiumTage5,
                    })),
                  }),
                'Auszahlungstabelle gespeichert.',
              )
            }
          >
            <Save aria-hidden="true" />
            Speichern
          </Button>
        </div>
      </Kasten>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Freespins
// ---------------------------------------------------------------------------

function FreespinsTab({
  csrfToken,
  konfiguration,
  freispiele,
  darfFreispiele,
}: VerwaltungProps): React.JSX.Element {
  const { laeuft, fuehreAus } = useSpeichern();
  const [neu, setNeu] = useState({
    discordId: '',
    anzahl: 10,
    einsatz: konfiguration.wirksam.einsaetze[0] ?? 10,
    laeuftAb: '',
    grund: '',
  });

  if (!darfFreispiele) {
    return (
      <Kasten titel="Freespins">
        <p className="text-xs text-muted-foreground">
          Freispiele zu gewähren braucht die Berechtigung «XP-Slot-Freispiele vergeben». Ein Freispiel hat
          echten XP-Wert, deshalb steht sie getrennt.
        </p>
      </Kasten>
    );
  }

  return (
    <div className="space-y-4">
      <Kasten
        titel="Freispiele gewähren"
        hinweis="Der Einsatz gehört zum Paket und lässt sich von der Person nicht ändern."
      >
        <div className="grid gap-3 sm:grid-cols-5">
          <div className="sm:col-span-2">
            <Label className="text-xs">Discord-Kennung</Label>
            <Input
              className="mt-1"
              placeholder="123456789012345678"
              value={neu.discordId}
              onChange={(ereignis) => setNeu((v) => ({ ...v, discordId: ereignis.target.value.trim() }))}
            />
          </div>
          <div>
            <Label className="text-xs">Anzahl</Label>
            <Input
              type="number"
              className="mt-1"
              value={String(neu.anzahl)}
              onChange={(ereignis) => setNeu((v) => ({ ...v, anzahl: Number(ereignis.target.value) }))}
            />
          </div>
          <div>
            <Label className="text-xs">Einsatz</Label>
            <select
              className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={String(neu.einsatz)}
              onChange={(ereignis) => setNeu((v) => ({ ...v, einsatz: Number(ereignis.target.value) }))}
            >
              {konfiguration.wirksam.einsaetze.map((wert) => (
                <option key={wert} value={wert}>
                  {wert} XP
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs">Läuft ab (optional)</Label>
            <Input
              type="date"
              className="mt-1"
              value={neu.laeuftAb}
              onChange={(ereignis) => setNeu((v) => ({ ...v, laeuftAb: ereignis.target.value }))}
            />
          </div>
          <div className="sm:col-span-4">
            <Label className="text-xs">Grund (steht im Protokoll)</Label>
            <Input
              className="mt-1"
              value={neu.grund}
              onChange={(ereignis) => setNeu((v) => ({ ...v, grund: ereignis.target.value }))}
            />
          </div>
          <div className="flex items-end">
            <Button
              className="w-full"
              disabled={laeuft || neu.discordId.length < 17}
              onClick={() =>
                void fuehreAus(
                  () =>
                    freispieleGewaehrenAction({
                      csrfToken,
                      discordId: neu.discordId,
                      anzahl: neu.anzahl,
                      einsatz: neu.einsatz,
                      laeuftAb: neu.laeuftAb ? new Date(neu.laeuftAb) : null,
                      grund: neu.grund.trim() || null,
                    }),
                  'Freispiele gewährt.',
                )
              }
            >
              <Gift aria-hidden="true" />
              Gewähren
            </Button>
          </div>
        </div>
      </Kasten>

      <Kasten titel="Offene Pakete" hinweis={`${freispiele.length} Pakete mit offenen Freispielen.`}>
        {freispiele.length === 0 ? (
          <p className="text-xs text-muted-foreground">Gerade sind keine Freispiele offen.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="p-2 text-left font-medium">Person</th>
                  <th className="p-2 text-right font-medium">Offen / gewährt</th>
                  <th className="p-2 text-right font-medium">Einsatz</th>
                  <th className="p-2 text-left font-medium">Läuft ab</th>
                  <th className="p-2 text-left font-medium">Grund</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {freispiele.map((paket) => (
                  <tr key={paket.id} className="border-t border-border">
                    <td className="p-2 font-mono text-[11px]">{paket.discordId}</td>
                    <td className="p-2 text-right tabular-nums">
                      {paket.offen} / {paket.gewaehrt}
                    </td>
                    <td className="p-2 text-right tabular-nums">{paket.einsatz} XP</td>
                    <td className="p-2">
                      <Input
                        type="date"
                        className="h-8 w-36"
                        defaultValue={paket.laeuftAb ? paket.laeuftAb.toISOString().slice(0, 10) : ''}
                        onBlur={(ereignis) =>
                          void fuehreAus(
                            () =>
                              freispieleFristAction({
                                csrfToken,
                                packageId: paket.id,
                                laeuftAb: ereignis.target.value ? new Date(ereignis.target.value) : null,
                              }),
                            'Frist geändert.',
                          )
                        }
                      />
                    </td>
                    <td className="p-2 text-muted-foreground">{paket.grund ?? '–'}</td>
                    <td className="p-2 text-right">
                      <RueckfrageKnopf
                        titel="Freispiele entziehen?"
                        beschreibung={`${paket.offen} offene Freispiele verschwinden. Was gespielt wurde, bleibt gebucht - ein Entzug holt keine Gewinne zurück.`}
                        bestaetigen="Entziehen"
                        kind={
                          <Button size="sm" variant="ghost">
                            <Trash2 aria-hidden="true" />
                          </Button>
                        }
                        onBestaetigt={() =>
                          void fuehreAus(
                            () => freispieleEntziehenAction({ csrfToken, packageId: paket.id }),
                            'Freispiele entzogen.',
                          )
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Kasten>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Design
// ---------------------------------------------------------------------------

function DesignTab({ csrfToken, konfiguration, pakete }: VerwaltungProps): React.JSX.Element {
  const { laeuft, fuehreAus } = useSpeichern();
  const c = konfiguration.config;
  const [werte, setWerte] = useState({
    hintergrundPfad: c.backgroundPath,
    hintergrundUrl: c.backgroundUrl ?? '',
    logoPfad: c.logoPath,
    logoUrl: c.logoUrl ?? '',
    akzentfarbe: c.accentColor ?? '#83060a',
    overlay: c.overlayOpacity,
    glow: c.glowStrength,
    knopfStil: c.spinButtonStyle,
    soundPackId: c.activeSoundPackId ?? '',
  });

  const hintergrund = quelle(werte.hintergrundPfad, werte.hintergrundUrl || null);

  return (
    <div className="space-y-4">
      <Kasten titel="Vorschau" hinweis="Dieselben Werte, mit denen die Spielseite zeichnet.">
        <div
          className="slot-buehne grid h-40 place-items-center"
          style={{ ['--primary-bright' as string]: undefined }}
        >
          {hintergrund ? (
            <div className="slot-buehne__bild" style={{ backgroundImage: `url(${hintergrund})` }} />
          ) : null}
          <div className="slot-buehne__schleier" style={{ opacity: werte.overlay / 100 }} />
          <div className="slot-buehne__puls" style={{ opacity: werte.glow / 100 }} />
          <p className="relative text-sm font-semibold" style={{ color: werte.akzentfarbe }}>
            XP-Slot
          </p>
        </div>
      </Kasten>

      <Kasten titel="Gestaltung">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-xs">Hintergrundbild (Adresse)</Label>
            <Input
              className="mt-1"
              value={werte.hintergrundUrl}
              onChange={(ereignis) => setWerte((v) => ({ ...v, hintergrundUrl: ereignis.target.value }))}
            />
          </div>
          <div>
            <Label className="text-xs">Logo (Adresse)</Label>
            <Input
              className="mt-1"
              value={werte.logoUrl}
              onChange={(ereignis) => setWerte((v) => ({ ...v, logoUrl: ereignis.target.value }))}
            />
          </div>
          <div>
            <Label className="text-xs">Akzentfarbe</Label>
            <Input
              type="color"
              className="mt-1 h-10"
              value={werte.akzentfarbe}
              onChange={(ereignis) => setWerte((v) => ({ ...v, akzentfarbe: ereignis.target.value }))}
            />
          </div>
          <div>
            <Label className="text-xs">Spin-Knopf</Label>
            <select
              className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={werte.knopfStil}
              onChange={(ereignis) => setWerte((v) => ({ ...v, knopfStil: ereignis.target.value }))}
            >
              <option value="puls">Pulsierend</option>
              <option value="ring">Leuchtring</option>
              <option value="flach">Flach und ruhig</option>
            </select>
          </div>
          <div>
            <Label className="text-xs">Overlay-Stärke: {werte.overlay} %</Label>
            <input
              type="range"
              min={0}
              max={100}
              className="mt-2 w-full accent-[hsl(var(--primary-bright))]"
              value={werte.overlay}
              onChange={(ereignis) => setWerte((v) => ({ ...v, overlay: Number(ereignis.target.value) }))}
            />
          </div>
          <div>
            <Label className="text-xs">Leuchtstärke: {werte.glow} %</Label>
            <input
              type="range"
              min={0}
              max={100}
              className="mt-2 w-full accent-[hsl(var(--primary-bright))]"
              value={werte.glow}
              onChange={(ereignis) => setWerte((v) => ({ ...v, glow: Number(ereignis.target.value) }))}
            />
          </div>
          <div>
            <Label className="text-xs">Aktives Sound-Paket</Label>
            <select
              className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={werte.soundPackId}
              onChange={(ereignis) => setWerte((v) => ({ ...v, soundPackId: ereignis.target.value }))}
            >
              <option value="">keines</option>
              {pakete.map((paket) => (
                <option key={paket.id} value={paket.id}>
                  {paket.name} ({paket.belegt} Klänge)
                </option>
              ))}
            </select>
          </div>
        </div>
        <Button
          className="mt-4"
          disabled={laeuft}
          onClick={() =>
            void fuehreAus(
              () =>
                designSpeichernAction({
                  csrfToken,
                  hintergrundPfad: werte.hintergrundPfad,
                  hintergrundUrl: werte.hintergrundUrl.trim() || null,
                  logoPfad: werte.logoPfad,
                  logoUrl: werte.logoUrl.trim() || null,
                  akzentfarbe: werte.akzentfarbe || null,
                  overlay: werte.overlay,
                  glow: werte.glow,
                  knopfStil: werte.knopfStil,
                  soundPackId: werte.soundPackId || null,
                }),
              'Design gespeichert.',
            )
          }
        >
          <Save aria-hidden="true" />
          Speichern
        </Button>
      </Kasten>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sounds
// ---------------------------------------------------------------------------

function SoundsTab({ csrfToken, pakete, klangSlots }: VerwaltungProps): React.JSX.Element {
  const { laeuft, fuehreAus } = useSpeichern();
  const [neu, setNeu] = useState({ name: '', art: 'STANDARD' as 'STANDARD' | 'EVENT' | 'SPECIAL' });
  const [offen, setOffen] = useState<string | null>(pakete[0]?.id ?? null);
  const gruppen = useMemo(() => [...new Set(klangSlots.map((slot) => slot.gruppe))], [klangSlots]);

  return (
    <div className="space-y-4">
      <Kasten
        titel="Neues Sound-Paket"
        hinweis="Ein Paket ist ein vollständiger Satz. Es muss nicht vollständig gefüllt sein - ein leerer Slot ist still."
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1">
            <Label className="text-xs">Name</Label>
            <Input
              className="mt-1"
              value={neu.name}
              onChange={(ereignis) => setNeu((v) => ({ ...v, name: ereignis.target.value }))}
            />
          </div>
          <div>
            <Label className="text-xs">Art</Label>
            <select
              className="mt-1 h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={neu.art}
              onChange={(ereignis) => setNeu((v) => ({ ...v, art: ereignis.target.value as typeof v.art }))}
            >
              <option value="STANDARD">Standard</option>
              <option value="EVENT">Event</option>
              <option value="SPECIAL">Special</option>
            </select>
          </div>
          <Button
            disabled={laeuft || neu.name.trim().length < 2}
            onClick={() =>
              void fuehreAus(
                () => paketAnlegenAction({ csrfToken, name: neu.name, art: neu.art }),
                'Paket angelegt.',
              )
            }
          >
            Anlegen
          </Button>
        </div>
      </Kasten>

      {pakete.map((paket) => (
        <section key={paket.id} className="rounded-xl border border-border bg-card">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 p-4 text-left"
            onClick={() => setOffen(offen === paket.id ? null : paket.id)}
          >
            <span>
              <span className="text-sm font-semibold">{paket.name}</span>
              <span className="ml-2 text-xs text-muted-foreground">
                {paket.art} · {paket.belegt} von {klangSlots.length} Slots
                {paket.aktiv ? ' · aktiv' : ''}
              </span>
            </span>
            <Music aria-hidden="true" className="size-4 text-muted-foreground" />
          </button>

          {offen === paket.id ? (
            <div className="space-y-4 border-t border-border p-4">
              {gruppen.map((gruppe) => (
                <div key={gruppe}>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {gruppe}
                  </p>
                  <div className="space-y-1.5">
                    {paket.klaenge
                      .filter((klang) => klang.gruppe === gruppe)
                      .map((klang) => (
                        <KlangZeile
                          key={klang.slot}
                          csrfToken={csrfToken}
                          packId={paket.id}
                          klang={klang}
                          laeuft={laeuft}
                          fuehreAus={fuehreAus}
                        />
                      ))}
                  </div>
                </div>
              ))}

              {!paket.aktiv ? (
                <RueckfrageKnopf
                  titel="Sound-Paket löschen?"
                  beschreibung="Die hinterlegten Dateien werden mitgelöscht. Das aktive Paket lässt sich nicht löschen."
                  bestaetigen="Löschen"
                  kind={
                    <Button size="sm" variant="ghost">
                      <Trash2 aria-hidden="true" />
                      Paket löschen
                    </Button>
                  }
                  onBestaetigt={() =>
                    void fuehreAus(
                      () => paketLoeschenAction({ csrfToken, packId: paket.id }),
                      'Paket gelöscht.',
                    )
                  }
                />
              ) : null}
            </div>
          ) : null}
        </section>
      ))}
    </div>
  );
}

function KlangZeile({
  csrfToken,
  packId,
  klang,
  laeuft,
  fuehreAus,
}: {
  csrfToken: string;
  packId: string;
  klang: Pakete[number]['klaenge'][number];
  laeuft: boolean;
  fuehreAus: ReturnType<typeof useSpeichern>['fuehreAus'];
}): React.JSX.Element {
  const [laedt, setLaedt] = useState(false);
  // Fuer diesen Slot mitgeliefert - oder nicht. Die beiden Musikslots haben
  // bewusst keinen Standard, deshalb kann das hier `null` sein.
  const standard = STANDARD_KLAENGE[klang.slot] ?? null;

  const hochladen = async (datei: File): Promise<void> => {
    setLaedt(true);
    try {
      const form = new FormData();
      form.set('csrfToken', csrfToken);
      form.set('art', 'klang');
      form.set('slot', klang.slot);
      form.set('packId', packId);
      form.set('datei', datei);
      const antwort = await fetch('/api/level/xp-slot/upload', { method: 'POST', body: form });
      const ergebnis = (await antwort.json()) as
        { ok: true; data: { dateiname: string } } | { ok: false; error: { message: string } };
      if (!ergebnis.ok) {
        toast.error(ergebnis.error.message);
        return;
      }
      toast.success(`${klang.label} ersetzt.`);
      window.location.reload();
    } finally {
      setLaedt(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2">
      <span className="min-w-[10rem] flex-1 text-xs font-medium">
        {klang.label}
        {klang.musik ? <span className="ml-1 text-[10px] text-muted-foreground">Schleife</span> : null}
        <span
          className={cn(
            'ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
            klang.dateiname
              ? 'bg-primary/15 text-[hsl(var(--primary-bright))]'
              : 'bg-muted text-muted-foreground',
          )}
        >
          {klang.dateiname ? 'Eigener' : standard ? 'Standard' : 'Leer'}
        </span>
      </span>

      {klang.dateiname ? (
        <>
          {/* Die Vorschau ist ein gewoehnlicher Player - mehr braucht es nicht. */}
          <audio
            controls
            preload="none"
            src={`/api/level/xp-slot/datei/${klang.dateiname}`}
            className="h-8 max-w-[14rem]"
          />
          <input
            type="range"
            min={0}
            max={100}
            defaultValue={klang.lautstaerke}
            aria-label={`Lautstärke ${klang.label}`}
            className="w-20 accent-[hsl(var(--primary-bright))]"
            onMouseUp={(ereignis) =>
              void fuehreAus(
                () =>
                  klangStellenAction({
                    csrfToken,
                    packId,
                    slot: klang.slot,
                    lautstaerke: Number((ereignis.target as HTMLInputElement).value),
                  }),
                'Lautstärke gespeichert.',
              )
            }
          />
          <Switch
            checked={klang.an}
            onCheckedChange={(wert) =>
              void fuehreAus(
                () => klangStellenAction({ csrfToken, packId, slot: klang.slot, an: wert }),
                wert ? 'Eingeschaltet.' : 'Ausgeschaltet.',
              )
            }
          />
          <Button
            size="sm"
            variant="ghost"
            disabled={laeuft}
            onClick={() =>
              void fuehreAus(
                () => klangEntfernenAction({ csrfToken, packId, slot: klang.slot }),
                'Klang entfernt.',
              )
            }
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </>
      ) : standard ? (
        /*
          Kein eigener Klang - also der mitgelieferte, und zwar derselbe, den
          das Spiel spielt. Die Vorschau darf hier nicht anders klingen als
          dort, sonst prueft die Verwaltung etwas, das es im Spiel nicht gibt.
        */
        <>
          <audio controls preload="none" src={standard} className="h-8 max-w-[14rem]" />
          <span className="text-[11px] text-muted-foreground">mitgeliefert - Hochladen ersetzt ihn</span>
        </>
      ) : (
        <span className="text-[11px] text-muted-foreground">leer - still</span>
      )}

      <label className={cn('cursor-pointer', laedt && 'pointer-events-none opacity-50')}>
        <span className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-[11px] font-medium hover:bg-muted">
          <Upload aria-hidden="true" className="size-3" />
          {laedt ? 'Lädt...' : 'MP3/OGG/WAV'}
        </span>
        <input
          type="file"
          accept="audio/mpeg,audio/ogg,audio/wav,audio/mp4"
          className="hidden"
          onChange={(ereignis) => {
            const datei = ereignis.target.files?.[0];
            if (datei) {
              void hochladen(datei);
            }
          }}
        />
      </label>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function EventsTab({ csrfToken, events }: VerwaltungProps): React.JSX.Element {
  const { laeuft, fuehreAus } = useSpeichern();
  const [pruefung, setPruefung] = useState<
    Record<string, { ok: boolean; fehler: string[]; warnungen: string[]; rtp: number | null }>
  >({});

  return (
    <div className="space-y-4">
      <Kasten
        titel="Eventmodus"
        hinweis="Ein Event überschreibt Teile der Konfiguration, solange es läuft - danach gilt wieder die Grundstellung, ohne dass jemand etwas zurücksetzt. Es läuft immer höchstens eines."
      >
        {events.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Noch kein Eventmodus angelegt. Events entstehen über die Server Action «level.xpslot.event.neu» -
            die Oberfläche dafür folgt mit dem ersten echten Event, damit hier kein Formular für Felder steht,
            die noch niemand gebraucht hat.
          </p>
        ) : (
          <div className="space-y-2">
            {events.map((event) => {
              const p = pruefung[event.id];
              return (
                <div key={event.id} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">
                        {event.name}
                        {event.laeuft ? (
                          <span className="ml-2 rounded bg-success/15 px-1.5 py-0.5 text-[10px] uppercase text-success">
                            läuft
                          </span>
                        ) : null}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {event.von ? event.von.toISOString().slice(0, 10) : 'ohne Start'} bis{' '}
                        {event.bis ? event.bis.toISOString().slice(0, 10) : 'offen'} ·{' '}
                        {Object.keys(event.ueberschreibungen).length} überschriebene Werte
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={laeuft}
                        onClick={() =>
                          void (async () => {
                            const antwort = await eventPruefenAction({ csrfToken, eventId: event.id });
                            if (antwort.ok) {
                              setPruefung((vorher) => ({ ...vorher, [event.id]: antwort.data }));
                            } else {
                              toast.error(antwort.error.message);
                            }
                          })()
                        }
                      >
                        <FlaskConical aria-hidden="true" />
                        Prüfen
                      </Button>
                      {event.aktiv ? (
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={laeuft}
                          onClick={() =>
                            void fuehreAus(
                              () => eventBeendenAction({ csrfToken, eventId: event.id }),
                              'Eventmodus beendet.',
                            )
                          }
                        >
                          Beenden
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          disabled={laeuft}
                          onClick={() =>
                            void fuehreAus(
                              () => eventAktivierenAction({ csrfToken, eventId: event.id }),
                              'Eventmodus aktiviert.',
                            )
                          }
                        >
                          Aktivieren
                        </Button>
                      )}
                    </div>
                  </div>

                  {p ? (
                    <div className="mt-2 space-y-1 text-[11px]">
                      <p className={p.ok ? 'text-success' : 'text-destructive'}>
                        {p.ok ? 'Aktivierbar.' : 'Aktivierung blockiert.'}
                        {p.rtp !== null ? ` Quote: ${(p.rtp * 100).toFixed(1)} %` : ''}
                      </p>
                      {p.fehler.map((zeile) => (
                        <p key={zeile} className="text-destructive">
                          {zeile}
                        </p>
                      ))}
                      {p.warnungen.map((zeile) => (
                        <p key={zeile} className="text-warning">
                          {zeile}
                        </p>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </Kasten>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Statistik
// ---------------------------------------------------------------------------

function StatistikTab({ kennzahlen }: VerwaltungProps): React.JSX.Element {
  const maximum = Math.max(1, ...kennzahlen.jeTag.map((tag) => Math.max(tag.einsatz, tag.gewinn)));

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
        <Kachel label="Spins" wert={formatSwissNumber(kennzahlen.spins)} />
        <Kachel label="Bezahlte Spins" wert={formatSwissNumber(kennzahlen.bezahlteSpins)} />
        <Kachel label="Freispiele" wert={formatSwissNumber(kennzahlen.freispiele)} />
        <Kachel label="Spielende" wert={formatSwissNumber(kennzahlen.spieler)} />
        <Kachel label="XP ein" wert={formatSwissNumber(kennzahlen.xpEin)} />
        <Kachel label="XP aus" wert={formatSwissNumber(kennzahlen.xpAus)} />
        <Kachel
          label="Saldo"
          wert={`${kennzahlen.saldo > 0 ? '+' : ''}${formatSwissNumber(kennzahlen.saldo)}`}
          hinweis={kennzahlen.saldo < 0 ? 'der Slot hat ausgezahlt' : 'im System geblieben'}
        />
        <Kachel
          label="Echte Quote"
          wert={kennzahlen.rtpEcht === null ? '–' : `${(kennzahlen.rtpEcht * 100).toFixed(1)} %`}
          hinweis={`theoretisch ${(kennzahlen.rtpTheoretisch * 100).toFixed(1)} %`}
        />
        <Kachel
          label="Ø Einsatz"
          wert={kennzahlen.einsatzSchnitt === null ? '–' : kennzahlen.einsatzSchnitt.toFixed(0)}
        />
        <Kachel label="Grösster Gewinn" wert={formatSwissNumber(kennzahlen.groessterGewinn)} />
        <Kachel label="Grösster Verlust" wert={formatSwissNumber(kennzahlen.groessterVerlust)} />
        <Kachel label="Jackpots" wert={String(kennzahlen.jackpots)} />
        <Kachel label="Bonusrunden" wert={String(kennzahlen.bonusRunden)} />
        <Kachel label="Freispiele gewonnen" wert={String(kennzahlen.freispieleGewonnen)} />
        <Kachel
          label="Premium-Gewinne"
          wert={String(kennzahlen.premiumGewinne)}
          hinweis={`${kennzahlen.premiumTage} Tage`}
        />
        <Kachel label="Grosse Gewinne" wert={String(kennzahlen.grosseGewinne)} />
      </div>

      <Kasten titel="Je Tag" hinweis="Einsatz und Gewinn im gewählten Zeitraum.">
        {kennzahlen.jeTag.length === 0 ? (
          <p className="text-xs text-muted-foreground">Noch keine Spins.</p>
        ) : (
          <div className="space-y-1">
            {kennzahlen.jeTag.slice(-30).map((tag) => (
              <div key={tag.tag} className="flex items-center gap-2 text-[11px]">
                <span className="w-20 shrink-0 text-muted-foreground">{tag.tag}</span>
                <span className="w-12 shrink-0 text-right tabular-nums">{tag.spins}</span>
                <span className="flex h-3 flex-1 items-center gap-0.5">
                  <span
                    className="h-full rounded-sm bg-primary/60"
                    style={{ width: `${(tag.einsatz / maximum) * 100}%` }}
                  />
                </span>
                <span className="flex h-3 flex-1 items-center">
                  <span
                    className="h-full rounded-sm bg-[hsl(var(--primary-bright))]"
                    style={{ width: `${(tag.gewinn / maximum) * 100}%` }}
                  />
                </span>
              </div>
            ))}
            <p className="pt-1 text-[10px] text-muted-foreground">
              Links Einsatz, rechts Gewinn. Gleiche Skala.
            </p>
          </div>
        )}
      </Kasten>

      <Kasten titel="Aktivste Spielende">
        {kennzahlen.aktivste.length === 0 ? (
          <p className="text-xs text-muted-foreground">Noch keine Spins.</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="p-2 text-left font-medium">Person</th>
                <th className="p-2 text-right font-medium">Spins</th>
                <th className="p-2 text-right font-medium">Einsatz</th>
                <th className="p-2 text-right font-medium">Gewinn</th>
              </tr>
            </thead>
            <tbody>
              {kennzahlen.aktivste.map((zeile) => (
                <tr key={zeile.discordId} className="border-t border-border">
                  <td className="p-2 font-mono text-[11px]">{zeile.discordId}</td>
                  <td className="p-2 text-right tabular-nums">{zeile.spins}</td>
                  <td className="p-2 text-right tabular-nums">{formatSwissNumber(zeile.einsatz)}</td>
                  <td className="p-2 text-right tabular-nums">{formatSwissNumber(zeile.gewinn)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Kasten>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Historie
// ---------------------------------------------------------------------------

function HistorieTab({ verlauf }: VerwaltungProps): React.JSX.Element {
  return (
    <Kasten
      titel="Spielverlauf"
      hinweis={`${formatSwissNumber(verlauf.gesamt)} Spins historisiert. Testläufe sind ausgeblendet.`}
    >
      {verlauf.eintraege.length === 0 ? (
        <p className="text-xs text-muted-foreground">Noch keine Spins.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="p-2 text-left font-medium">Zeit</th>
                <th className="p-2 text-left font-medium">Person</th>
                <th className="p-2 text-right font-medium">Einsatz</th>
                <th className="p-2 text-left font-medium">Art</th>
                <th className="p-2 text-left font-medium">Linien</th>
                <th className="p-2 text-right font-medium">Brutto</th>
                <th className="p-2 text-right font-medium">Netto</th>
                <th className="p-2 text-right font-medium">XP danach</th>
                <th className="p-2 text-left font-medium">Besonderes</th>
              </tr>
            </thead>
            <tbody>
              {verlauf.eintraege.map((eintrag) => (
                <tr key={eintrag.id} className="border-t border-border">
                  <td className="p-2 whitespace-nowrap text-muted-foreground">
                    {formatDateTime(eintrag.zeit)}
                  </td>
                  <td className="p-2 font-mono text-[11px]">{eintrag.discordId}</td>
                  <td className="p-2 text-right tabular-nums">{eintrag.einsatz}</td>
                  <td className="p-2">{ART_LABEL[eintrag.art] ?? eintrag.art}</td>
                  <td className="p-2">
                    {eintrag.linien.length === 0
                      ? '–'
                      : eintrag.linien
                          .map((linie) => `${linie.linie + 1}: ${linie.symbolKey}×${linie.laenge}`)
                          .join(', ')}
                  </td>
                  <td className="p-2 text-right tabular-nums">{eintrag.brutto}</td>
                  <td
                    className={cn(
                      'p-2 text-right tabular-nums',
                      eintrag.netto < 0 ? 'text-destructive' : 'text-success',
                    )}
                  >
                    {eintrag.netto > 0 ? '+' : ''}
                    {eintrag.netto}
                  </td>
                  <td className="p-2 text-right tabular-nums">{eintrag.xpNachher}</td>
                  <td className="p-2">
                    {[
                      eintrag.jackpot ? 'Jackpot' : null,
                      eintrag.bonus ? 'Bonus' : null,
                      eintrag.premiumTage > 0 ? `${eintrag.premiumTage} Tage Premium` : null,
                      eintrag.eventName,
                    ]
                      .filter(Boolean)
                      .join(' · ') || '–'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Kasten>
  );
}

const ART_LABEL: Record<string, string> = {
  PAID: 'bezahlt',
  FREESPIN_PACKAGE: 'Freispielpaket',
  BONUS_ROUND: 'Bonusrunde',
  TEST: 'Testlauf',
};

// ---------------------------------------------------------------------------
// Einstellungen (Status, Feed, Testmodus)
// ---------------------------------------------------------------------------

function EinstellungenTab({ csrfToken, konfiguration, testfaelle }: VerwaltungProps): React.JSX.Element {
  const { laeuft, fuehreAus } = useSpeichern();
  const c = konfiguration.config;
  const [status, setStatus] = useState(c.status);
  const [hinweis, setHinweis] = useState(c.maintenanceNote ?? '');
  const [feed, setFeed] = useState({
    kanalId: c.feedChannelId ?? '',
    bigWin: c.feedBigWin,
    jackpot: c.feedJackpot,
    premium: c.feedPremium,
  });
  const [test, setTest] = useState({
    einsatz: konfiguration.wirksam.einsaetze[0] ?? 10,
    fall: testfaelle[0]?.key ?? 'zufall',
  });
  const [testergebnis, setTestergebnis] = useState<Testergebnis | null>(null);

  return (
    <div className="space-y-4">
      <Kasten titel="Status" hinweis="Der Status gilt zusätzlich zum Modulstatus des Level-Systems.">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-xs">Zustand</Label>
            <select
              aria-label="Zustand des Slots"
              className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={status}
              onChange={(ereignis) => setStatus(ereignis.target.value as typeof status)}
            >
              <option value="ACTIVE">Aktiv</option>
              <option value="MAINTENANCE">Wartung</option>
              <option value="EVENT_ONLY">Nur während eines Events</option>
              <option value="DISABLED">Abgeschaltet</option>
            </select>
          </div>
          <div>
            <Label className="text-xs">Wartungshinweis</Label>
            <Input
              className="mt-1"
              value={hinweis}
              placeholder="Wir schrauben am Jackpot."
              onChange={(ereignis) => setHinweis(ereignis.target.value)}
            />
          </div>
        </div>
        <Button
          className="mt-3"
          disabled={laeuft}
          onClick={() =>
            void fuehreAus(
              () => statusSetzenAction({ csrfToken, status, hinweis: hinweis.trim() || null }),
              'Status gesetzt.',
            )
          }
        >
          <Save aria-hidden="true" />
          Status setzen
        </Button>
      </Kasten>

      <Kasten
        titel="Gewinn-Feed auf Discord"
        hinweis="Nur grosse Gewinne. Ein Kanal mit jedem Gewinn ist ein Kanal, den niemand liest."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-xs">Kanalkennung</Label>
            <Input
              className="mt-1"
              value={feed.kanalId}
              placeholder="leer = keine Meldungen"
              onChange={(ereignis) => setFeed((v) => ({ ...v, kanalId: ereignis.target.value.trim() }))}
            />
          </div>
          <div className="flex flex-wrap items-end gap-4 pb-1">
            <label className="flex items-center gap-2 text-xs">
              <Switch
                checked={feed.jackpot}
                onCheckedChange={(wert) => setFeed((v) => ({ ...v, jackpot: wert }))}
              />
              Jackpot
            </label>
            <label className="flex items-center gap-2 text-xs">
              <Switch
                checked={feed.premium}
                onCheckedChange={(wert) => setFeed((v) => ({ ...v, premium: wert }))}
              />
              Premium
            </label>
            <label className="flex items-center gap-2 text-xs">
              <Switch
                checked={feed.bigWin}
                onCheckedChange={(wert) => setFeed((v) => ({ ...v, bigWin: wert }))}
              />
              Big / Mega Win
            </label>
          </div>
        </div>
        <Button
          className="mt-3"
          disabled={laeuft}
          onClick={() =>
            void fuehreAus(
              () =>
                feedSpeichernAction({
                  csrfToken,
                  kanalId: feed.kanalId || null,
                  bigWin: feed.bigWin,
                  jackpot: feed.jackpot,
                  premium: feed.premium,
                }),
              'Feed gespeichert.',
            )
          }
        >
          <Save aria-hidden="true" />
          Speichern
        </Button>
      </Kasten>

      <Kasten
        titel="Testmodus"
        hinweis="Vollständiges Ergebnis, keine Folgen: keine XP, kein Freispiel verbraucht, keine Bonusrunde, keine Statistik, kein Premium, keine Meldung auf Discord."
      >
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-xs">Einsatz</Label>
            <select
              aria-label="Testeinsatz"
              className="mt-1 h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={String(test.einsatz)}
              onChange={(ereignis) => setTest((v) => ({ ...v, einsatz: Number(ereignis.target.value) }))}
            >
              {konfiguration.wirksam.einsaetze.map((wert) => (
                <option key={wert} value={wert}>
                  {wert} XP
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <Label className="text-xs">Testfall</Label>
            <select
              aria-label="Testfall"
              className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={test.fall}
              onChange={(ereignis) => setTest((v) => ({ ...v, fall: ereignis.target.value }))}
            >
              {testfaelle.map((fall) => (
                <option key={fall.key} value={fall.key}>
                  {fall.label}
                </option>
              ))}
            </select>
          </div>
          <Button
            disabled={laeuft}
            onClick={() =>
              void (async () => {
                const antwort = await testlaufAction({
                  csrfToken,
                  einsatz: test.einsatz,
                  fall: test.fall as 'zufall',
                });
                if (!antwort.ok) {
                  toast.error(antwort.error.message);
                  return;
                }
                setTestergebnis(antwort.data);
                toast.success('Testlauf durchgeführt - nichts gebucht.');
              })()
            }
          >
            <Dice5 aria-hidden="true" />
            Testlauf
          </Button>
        </div>

        {testergebnis ? (
          <div className="mt-4 rounded-lg border border-primary/30 bg-background/60 p-3 text-xs">
            <p className="mb-2 font-semibold">
              TEST · {testergebnis.gewinn} XP ({testergebnis.stufe}){testergebnis.jackpot ? ' · Jackpot' : ''}
              {testergebnis.bonusAusgeloest ? ' · Bonus' : ''}
              {testergebnis.premiumTage > 0 ? ` · ${testergebnis.premiumTage} Tage Premium` : ''}
              {testergebnis.sweatAbWalze !== null ? ` · Sweat ab Walze ${testergebnis.sweatAbWalze + 1}` : ''}
            </p>
            <div className="grid grid-cols-5 gap-1">
              {Array.from({ length: 5 }, (_unused, walze) => (
                <div key={walze} className="space-y-1">
                  {Array.from({ length: 3 }, (_leer, reihe) => (
                    <div
                      key={reihe}
                      className="rounded border border-border bg-card px-1 py-1.5 text-center text-[10px]"
                    >
                      {testergebnis.grid[walze * 3 + reihe]}
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <p className="mt-2 text-muted-foreground">
              {testergebnis.treffer.length === 0
                ? 'Keine Linie.'
                : testergebnis.treffer
                    .map(
                      (treffer) =>
                        `Linie ${treffer.linie + 1}: ${treffer.symbolKey}×${treffer.laenge} = ${treffer.gewinn} XP`,
                    )
                    .join(' · ')}
            </p>
          </div>
        ) : null}
      </Kasten>
    </div>
  );
}
