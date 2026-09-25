import { NavIcon } from '@/components/layout/nav-icon';

/**
 * Die Bausteine der oeffentlichen Profilseite.
 *
 * Klein gehalten und ohne eigenes Wissen ueber das Theme: was sie
 * unterscheidet, sind die Klassen, die ihr Elternteil traegt. Eine
 * Komponente, die selbst entscheidet, wie sie in einem bestimmten Theme
 * aussieht, waere die siebte Stelle, an der das Theme steht.
 */

/** Ein Abschnitt mit Ueberschrift - die Grundeinheit der Seite. */
export function OeAbschnitt({
  titel,
  notiz,
  verzug = 0,
  className,
  children,
}: {
  titel: string;
  notiz?: string | null;
  verzug?: number;
  className?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section
      className={`po-auftritt po-karte po-hebt p-5 sm:p-6 ${className ?? ''}`}
      style={{ '--po-verzug': `${verzug}ms` } as React.CSSProperties}
    >
      <h2 className="po-abschnitt-titel">
        <span className="po-titel">{titel}</span>
        {notiz ? <span className="shrink-0 text-xs text-muted-foreground">{notiz}</span> : null}
      </h2>
      {children}
    </section>
  );
}

/**
 * Ein Abzeichen im Kopfbereich.
 *
 * Keine eigene Farbe: es nimmt den Akzent des Themes. Ein Abzeichen, das
 * seine Farbe selbst mitbringt, saehe in fuenf von sieben Themes falsch aus.
 */
export function OeAbzeichen({
  symbol,
  children,
  betont,
}: {
  symbol?: string;
  children: React.ReactNode;
  betont?: boolean;
}): React.JSX.Element {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
        betont
          ? 'bg-[hsl(var(--profil-akzent)/0.18)] text-[hsl(var(--profil-akzent))]'
          : 'bg-[hsl(var(--profil-flaeche)/0.9)] text-muted-foreground'
      }`}
      style={betont ? undefined : { border: '1px solid hsl(var(--profil-rand))' }}
    >
      {symbol ? (
        <span className="[&_svg]:size-3.5" aria-hidden="true">
          <NavIcon name={symbol} />
        </span>
      ) : null}
      {children}
    </span>
  );
}

/**
 * Eine Zeile aus Merkmalen - Sprachen, Plattformen, Spielzeiten.
 *
 * Fehlt die Liste oder ist sie leer, kommt `null` zurueck. Ein Kasten mit
 * der Ueberschrift «Sprachen» und nichts darunter ist schlimmer als kein
 * Kasten.
 */
export function OeMerkmale({
  titel,
  werte,
}: {
  titel: string;
  werte: readonly string[] | undefined;
}): React.JSX.Element | null {
  if (!werte || werte.length === 0) {
    return null;
  }
  return (
    <div>
      <p className="text-[0.7rem] uppercase tracking-wider text-muted-foreground">{titel}</p>
      <p className="mt-1 text-sm">{werte.join(' · ')}</p>
    </div>
  );
}
