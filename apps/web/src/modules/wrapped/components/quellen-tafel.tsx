import { CircleAlert, CircleCheck, CircleSlash } from 'lucide-react';
import type { WrappedQuelle, WrappedQuellen } from '@swisshub/modules/wrapped/daten';

/**
 * Die Gesundheit der Datenquellen.
 *
 * ## Warum das vor dem Veroeffentlichen sichtbar sein muss
 *
 * Wenn bei allen Mitgliedern die Clip-Szene fehlt, hat das genau einen
 * Grund: das Clip-Modul hat im Zeitraum keine Daten geliefert. Ohne diese
 * Tafel sieht man nur das Ergebnis - «Szene erscheint nicht» - und sucht
 * den Fehler in der Szene.
 *
 * ## Was «teilweise» heisst
 *
 * Die Quelle gibt es, aber erst seit einem Datum innerhalb des Zeitraums.
 * Die Zahlen sind dann echt und trotzdem unvollstaendig: wer im Januar
 * zwanzig Clips eingereicht hat, taucht nicht auf, wenn die Erfassung erst
 * im Maerz begann. Das ist kein Fehler, aber es gehoert gesagt.
 */

const LAGE = {
  vollstaendig: {
    label: 'vollständig',
    klasse: 'text-success',
    Symbol: CircleCheck,
  },
  teilweise: {
    label: 'teilweise',
    klasse: 'text-warning',
    Symbol: CircleAlert,
  },
  fehlt: {
    label: 'fehlt',
    klasse: 'text-muted-foreground',
    Symbol: CircleSlash,
  },
} as const;

const NAMEN: Array<{ key: keyof WrappedQuellen; label: string; woher: string }> = [
  { key: 'voice', label: 'Sprachzeit', woher: 'Analytics – Sprachabschnitte' },
  { key: 'messages', label: 'Nachrichten', woher: 'Analytics – Tageswerte' },
  { key: 'level', label: 'Level & XP', woher: 'XP-Journal' },
  { key: 'clips', label: 'Clips', woher: 'Clip of the Week' },
  { key: 'events', label: 'Termine', woher: 'Kalender' },
  { key: 'tournaments', label: 'Turniere', woher: 'Turniersystem' },
  { key: 'games', label: 'Spiele', woher: 'Was spielen wir?' },
];

const datum = (wert: string | null): string | null =>
  wert === null
    ? null
    : new Date(wert).toLocaleDateString('de-CH', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        timeZone: 'Europe/Zurich',
      });

export function QuellenTafel({ quellen }: { quellen: WrappedQuellen }): React.JSX.Element {
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {NAMEN.map((eintrag) => (
        <Zeile key={eintrag.key} label={eintrag.label} woher={eintrag.woher} quelle={quellen[eintrag.key]} />
      ))}
    </ul>
  );
}

function Zeile({
  label,
  woher,
  quelle,
}: {
  label: string;
  woher: string;
  quelle: WrappedQuelle;
}): React.JSX.Element {
  const lage = LAGE[quelle.lage];
  const seit = datum(quelle.seit);

  return (
    <li className="flex items-start gap-3 rounded-lg border border-border p-3">
      <lage.Symbol className={`mt-0.5 size-4 shrink-0 ${lage.klasse}`} aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-sm font-medium">
          {label} <span className={`text-xs font-normal ${lage.klasse}`}>· {lage.label}</span>
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {woher}
          {seit ? ` · erst ab ${seit}` : ''}
          {quelle.lage === 'teilweise' ? ` · ${Math.round(quelle.abdeckung * 100)} % des Zeitraums` : ''}
        </p>
      </div>
    </li>
  );
}
