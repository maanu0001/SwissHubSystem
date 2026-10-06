import Link from 'next/link';
import { Check, Crown } from 'lucide-react';
import type { PremiumProduct } from '@swisshub/database';
import { formatGeldbetrag } from '@swisshub/shared';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface PricingCardsProps {
  products: PremiumProduct[];
  highlightedSlug: string;
  /** Slug des bereits gebuchten Angebots - `null`, wenn keines läuft. */
  currentSlug: string | null;
  loggedIn: boolean;
  /**
   * Kann gerade gekauft werden? (§27)
   *
   * `false`, solange kein Zahlungsanbieter vollstaendig konfiguriert ist. Die
   * Angebote bleiben dann sichtbar - sie sind ja echt -, nur der Knopf fuehrt
   * nicht in einen Checkout, der die Buchung ablehnen muesste.
   */
  kaufbar: boolean;
  /** Warum nicht - in einem Satz, ohne Innereien. */
  grund: string | null;
}

const featuresOf = (product: PremiumProduct): string[] =>
  Array.isArray(product.features)
    ? product.features.filter((entry): entry is string => typeof entry === 'string')
    : [];

/**
 * Die drei Angebote.
 *
 * Wer bereits abonniert hat, sieht weiterhin alle Karten - nur mit anderer
 * Beschriftung. Ein zweites Abonnement entsteht dabei nie: der Knopf des
 * laufenden Angebots führt in die Verwaltung, nicht in den Checkout.
 */
export function PricingCards({
  products,
  highlightedSlug,
  currentSlug,
  loggedIn,
  kaufbar,
  grund,
}: PricingCardsProps): React.JSX.Element {
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      {products.map((product) => {
        const hervorgehoben = product.slug === highlightedSlug;
        const aktuell = product.slug === currentSlug;

        return (
          <article
            key={product.id}
            className={cn(
              'relative flex flex-col rounded-xl border bg-card p-6',
              hervorgehoben
                ? 'border-primary/60 shadow-[0_0_40px_-24px_hsl(var(--primary-bright))]'
                : 'border-border',
              aktuell && 'ring-1 ring-primary/40',
            )}
          >
            {hervorgehoben ? (
              <span className="absolute -top-3 left-6 rounded-full bg-accent-gradient px-3 py-1 text-xs font-semibold text-primary-foreground">
                Bestes Angebot
              </span>
            ) : null}
            {aktuell ? (
              <span className="absolute -top-3 right-6 rounded-full border border-primary/50 bg-card px-3 py-1 text-xs font-semibold text-primary-bright">
                Dein aktuelles Abo
              </span>
            ) : null}

            <header className="space-y-1">
              <h3 className="flex items-center gap-2 text-lg font-semibold">
                {hervorgehoben ? <Crown className="size-4 text-primary-bright" aria-hidden="true" /> : null}
                {product.name}
              </h3>
              <p className="text-sm text-muted-foreground">{product.description}</p>
            </header>

            <p className="mt-5 flex items-baseline gap-2">
              <span className="text-3xl font-semibold tabular-nums">
                {formatGeldbetrag(product.priceMinor, product.currency)}
              </span>
              <span className="text-sm text-muted-foreground">
                {product.durationDays === null ? 'pro Monat' : `für ${product.durationDays} Tage`}
              </span>
            </p>

            <ul className="mt-5 flex-1 space-y-2 text-sm">
              {featuresOf(product).map((feature) => (
                <li key={feature} className="flex items-start gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-primary-bright" aria-hidden="true" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>

            <div className="mt-6">
              {aktuell ? (
                <Link href="/premium/me" className={cn(buttonVariants({ variant: 'outline' }), 'w-full')}>
                  Abo verwalten
                </Link>
              ) : currentSlug ? (
                // Ein Wechsel setzt voraus, dass das laufende Abo endet - ein
                // zweites entsteht nie. Der Knopf führt deshalb dorthin, wo das
                // geht, statt in einen Checkout, der die Buchung ablehnen müsste.
                <Link href="/premium/me" className={cn(buttonVariants({ variant: 'outline' }), 'w-full')}>
                  Wechsel über mein Abo
                </Link>
              ) : !kaufbar ? (
                /*
                  Deaktiviert und nicht verschwiegen (§27).

                  Ein Knopf, der in einen Fehler fuehrt, ist schlechter als
                  einer, der vorher sagt, dass er nicht geht. Deshalb ein
                  `span` statt eines Links: nichts anzuklicken, und
                  `aria-disabled` sagt es auch der Vorlesesoftware.
                */
                <span
                  aria-disabled="true"
                  className={cn(
                    buttonVariants({ variant: 'outline' }),
                    'w-full cursor-not-allowed opacity-60',
                  )}
                >
                  Derzeit nicht buchbar
                </span>
              ) : (
                <Link
                  href={
                    loggedIn
                      ? `/premium/checkout/${product.slug}`
                      : `/login?redirect=${encodeURIComponent(`/premium/checkout/${product.slug}`)}`
                  }
                  className={cn(buttonVariants({ variant: hervorgehoben ? 'default' : 'outline' }), 'w-full')}
                >
                  Jetzt abonnieren
                </Link>
              )}
            </div>
          </article>
        );
      })}
      {!kaufbar ? (
        <p className="text-sm text-muted-foreground lg:col-span-3">
          {grund ?? 'Der Kauf von Premium ist derzeit nicht verfügbar.'} Bestehende Abonnemente laufen
          unverändert weiter.
        </p>
      ) : null}
    </div>
  );
}
