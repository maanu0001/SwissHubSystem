'use client';

import { useEffect, useState } from 'react';

/**
 * Die Zeit, die bleibt.
 *
 * ## Warum erst nach dem Einhaengen gerechnet wird
 *
 * Der Server rendert zu einem Zeitpunkt, der Browser zu einem anderen. Wer
 * beide dieselbe Sekunde anzeigen laesst, bekommt eine Hydrationswarnung und
 * einen sichtbaren Sprung. Der erste Durchgang zeigt deshalb den Zielpunkt
 * als Datum; die Uhr beginnt, sobald der Browser uebernommen hat.
 *
 * ## Warum kein `setTimeout` auf das Ende
 *
 * Diese Uhr zaehlt nur herunter. Was am Ende geschieht, entscheidet die
 * Zeitsteuerung des Bots gegen die Datenbank - ein Browserfenster, das seit
 * Freitag offen steht, schliesst keine Runde ab.
 */
export function Countdown({ ziel, label }: { ziel: string; label: string }): React.JSX.Element {
  const [verbleibend, setVerbleibend] = useState<number | null>(null);

  useEffect(() => {
    const zielZeit = new Date(ziel).getTime();
    const rechne = (): void => setVerbleibend(Math.max(0, zielZeit - Date.now()));
    rechne();
    const uhr = window.setInterval(rechne, 1000);
    return () => window.clearInterval(uhr);
  }, [ziel]);

  if (verbleibend === null) {
    return (
      <span className="text-sm text-muted-foreground">
        {label}{' '}
        <time dateTime={ziel} suppressHydrationWarning>
          {new Date(ziel).toLocaleString('de-CH', {
            weekday: 'long',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Europe/Zurich',
          })}
        </time>
      </span>
    );
  }

  const sekunden = Math.floor(verbleibend / 1000);
  const tage = Math.floor(sekunden / 86400);
  const stunden = Math.floor((sekunden % 86400) / 3600);
  const minuten = Math.floor((sekunden % 3600) / 60);
  const rest = sekunden % 60;

  const teile: Array<{ wert: number; einheit: string }> =
    tage > 0
      ? [
          { wert: tage, einheit: 'T' },
          { wert: stunden, einheit: 'Std' },
          { wert: minuten, einheit: 'Min' },
        ]
      : [
          { wert: stunden, einheit: 'Std' },
          { wert: minuten, einheit: 'Min' },
          { wert: rest, einheit: 'Sek' },
        ];

  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="flex items-baseline gap-1.5" aria-live="off">
        {teile.map((teil) => (
          <span key={teil.einheit} className="flex items-baseline gap-0.5">
            <span className="text-xl font-semibold tabular-nums">{String(teil.wert).padStart(2, '0')}</span>
            <span className="text-xs text-muted-foreground">{teil.einheit}</span>
          </span>
        ))}
      </span>
    </div>
  );
}
