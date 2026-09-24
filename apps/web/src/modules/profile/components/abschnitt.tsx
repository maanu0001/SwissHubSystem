/**
 * Der Rahmen eines Profilabschnitts.
 *
 * Eine Ueberschrift, optional eine Randnotiz, darunter der Inhalt - mehr
 * nicht. Bewusst keine Karte in der Karte: die Profilseite besteht ohnehin
 * schon aus Flaechen, und jede zusaetzliche Umrandung macht sie enger statt
 * klarer.
 */
export function Abschnitt({
  titel,
  notiz,
  verzug = 0,
  children,
}: {
  titel: string;
  notiz?: React.ReactNode;
  /** Millisekunden, um die der Auftritt spaeter beginnt. */
  verzug?: number;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="pr-auftritt" style={{ '--pr-verzug': `${verzug}ms` } as React.CSSProperties}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">{titel}</h3>
        {notiz ? <div className="text-xs text-muted-foreground">{notiz}</div> : null}
      </div>
      {children}
    </section>
  );
}
