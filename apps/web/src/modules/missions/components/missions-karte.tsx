import { formatRemaining } from '@swisshub/shared';
import type { missions } from '@swisshub/modules';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * Eine Mission als Karte.
 *
 * ## Warum ein Balken und keine Tabelle
 *
 * Die Frage, die jemand beim Oeffnen hat, ist «wie weit bin ich» - und die
 * Antwort ist eine Laenge, kein Zahlenpaar. Der Balken ist deshalb das
 * groesste Element der Karte und auch auf einem Telefon quer ueber die
 * Breite lesbar; die Zahlen stehen daneben, fuer den, der es genau wissen
 * will.
 *
 * Keine technischen Kennungen, keine Ereignisnamen, kein JSON. Was der Typ
 * misst, steht als Satz da («Zeit, die du in dieser Zeit in einem
 * Sprachkanal verbracht hast») - die Kennung `VOICE_MINUTEN` erscheint
 * nirgends.
 */
export function MissionsKarte({
  mission,
  jetzt,
}: {
  mission: missions.MissionsAnsicht;
  /*
   * Die Restzeit wird serverseitig gerechnet und als Text uebergeben - nicht
   * im Browser aus `new Date()`. Sonst zeigte die Karte beim ersten Rendern
   * auf dem Server etwas anderes als beim Nachziehen im Browser, und React
   * meldete eine Abweichung.
   */
  jetzt: Date;
}): React.JSX.Element {
  const istChallenge = mission.art === 'CHALLENGE';
  const rest = formatRemaining(mission.endetAm, jetzt);
  const geplant = mission.status === 'GEPLANT';
  const beendet = mission.status === 'ABGESCHLOSSEN';

  return (
    <article
      className={cn(
        'rounded-xl border border-border bg-card p-4 sm:p-5',
        mission.erfuellt && 'border-success/40 bg-success/5',
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={istChallenge ? 'default' : 'secondary'}>
              {istChallenge ? 'Community Challenge' : 'Wochenmission'}
            </Badge>
            {mission.erfuellt ? <Badge variant="success">Geschafft</Badge> : null}
            {geplant ? <Badge variant="outline">Startet noch</Badge> : null}
          </div>
          <h3 className="text-base font-semibold sm:text-lg">{mission.titel}</h3>
          <p className="text-sm text-muted-foreground">{mission.beschreibung ?? mission.erklaerung}</p>
        </div>
      </header>

      <div className="mt-4 space-y-2">
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="font-medium tabular-nums">
            {mission.stand} / {mission.ziel} {mission.einheit}
          </span>
          <span className="text-muted-foreground tabular-nums">{mission.prozent}%</span>
        </div>
        {/*
          Der Balken ist bewusst hoch (12px statt der ueblichen 4-6): auf
          einem Telefon in der Hand ist ein Haarstrich kein Fortschritt,
          sondern eine Linie.
        */}
        <div
          className="h-3 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={mission.prozent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Fortschritt: ${mission.titel}`}
        >
          <div
            className={cn(
              'h-full rounded-full transition-[width] duration-500',
              mission.erfuellt ? 'bg-success' : 'bg-primary',
            )}
            style={{ width: `${mission.prozent}%` }}
          />
        </div>
        {istChallenge ? (
          <p className="text-xs text-muted-foreground">
            Dein Beitrag: {mission.eigenerWert} {mission.einheit} · mitgezählt wirst du ab{' '}
            {mission.mindestBeitrag} {mission.einheit}
          </p>
        ) : null}
      </div>

      <footer className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>{belohnung(mission)}</span>
        {beendet ? <span>Beendet</span> : rest ? <span>Noch {rest}</span> : null}
        {mission.teilnehmende > 0 ? <span>{mission.teilnehmende} machen mit</span> : null}
      </footer>
    </article>
  );
}

function belohnung(mission: missions.MissionsAnsicht): string {
  const teile: string[] = [];
  if (mission.belohnungXp > 0) {
    teile.push(`${mission.belohnungXp} XP`);
  }
  if (mission.belohnungPremiumTage > 0) {
    teile.push(`${mission.belohnungPremiumTage} Tage Premium`);
  }
  if (mission.belohnungAuszeichnung) {
    teile.push('Auszeichnung');
  }
  return teile.length > 0 ? `Belohnung: ${teile.join(' + ')}` : 'Ohne Belohnung';
}
