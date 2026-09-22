import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { routenBezeichnung } from '@swisshub/modules';
import { sichereRueckkehr, type SystemRoute } from '@swisshub/shared';
import { cn } from '@/lib/utils';

interface ZurueckLinkProps {
  /**
   * Die mitgereiste Rückkehradresse - ungeprüft, so wie sie in der Adresse
   * stand. Geprüft wird hier, an einer Stelle.
   */
  von?: string | null;
  /** Wohin es geht, wenn keine brauchbare Adresse mitkam. */
  fallback: SystemRoute;
  /** Beschriftung, wenn die Registry keine kennt. */
  fallbackLabel?: string;
  className?: string;
}

/**
 * «← Zurück zu …» auf einer Detailseite.
 *
 * Der Nutzen steckt im mitgereisten Kontext: Wer über «Offene Tickets,
 * gefiltert, Seite 3» hierherkam, will genau dorthin zurück - nicht auf eine
 * frisch zurückgesetzte Liste. Die Adresse der Liste reist deshalb im
 * Parameter `von` mit, samt Filter, Suche und Seitenzahl.
 *
 * **Immer ein Rückfall.** Eine Detailseite, die man über einen Deep Link aus
 * Discord betritt, hat keinen Kontext - und braucht trotzdem einen Weg nach
 * oben. Der Rückfall ist der kanonische Elternbereich.
 *
 * **Nie eine fremde Adresse.** `sichereRueckkehr` lässt ausschliesslich
 * interne Pfade durch; alles andere fällt auf den Elternbereich zurück. Ohne
 * diese Prüfung wäre der Parameter eine offene Weiterleitung, und ein
 * präparierter Link in einem Discord-Kanal führte nach einem Klick auf
 * «Zurück» auf eine fremde Seite, die wie SwissHub aussieht.
 */
export function ZurueckLink({
  von,
  fallback,
  fallbackLabel,
  className,
}: ZurueckLinkProps): React.JSX.Element {
  const ziel = sichereRueckkehr(von, fallback);
  const label = routenBezeichnung(ziel) ?? fallbackLabel ?? routenBezeichnung(fallback) ?? 'Übersicht';

  return (
    <Link
      href={ziel}
      className={cn(
        'inline-flex min-h-8 items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground',
        className,
      )}
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      Zurück zu {label}
    </Link>
  );
}
