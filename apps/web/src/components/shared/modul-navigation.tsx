'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NavIcon } from '@/components/layout/nav-icon';
import { cn } from '@/lib/utils';

/**
 * Die Unternavigation eines Moduls - fuer alle Module dieselbe.
 *
 * ## Warum es sie gibt
 *
 * Ein Modul mit mehreren Bereichen bekommt in der Seitenleiste genau einen
 * Eintrag - das ist Absicht, sonst stuenden dort dreissig. Der Preis dafuer
 * ist, dass die uebrigen Bereiche einen Weg brauchen, und zwar von **jeder**
 * Seite des Moduls aus.
 *
 * Genau daran ist Wrapped gescheitert: die Seitenleiste fuehrte ins Studio,
 * und von dort gab es keinen Link auf Ausgaben oder Community Moments.
 * Umgekehrt schon - die Ausgaben verlinkten beides. Wer den Einstieg nahm,
 * den die Navigation anbot, landete in einer Sackgasse.
 *
 * ## Warum sie jetzt allen Modulen gehoert
 *
 * Weil es sie vorher elfmal gab. Neben dieser Leiste lagen zehn eigene
 * `section-nav.tsx` - in Analytics, Jail, Kommunikation, Level, Moderation,
 * Musik, Premium, Tickets, Turnieren und Voice - in drei verschiedenen
 * Gestalten: Reiter mit Unterstrich, Pillen ueber einer Linie, und ein
 * Segmentschalter in einem Kasten. Dieselbe Frage, drei Antworten, je
 * nachdem, welches Modul man gerade offen hatte.
 *
 * Es ist nicht so, dass die zehn falsch gebaut gewesen waeren. Sie waren
 * zehnmal derselbe Gedanke, und beim elften Mal wusste niemand mehr, welcher
 * der Richtige war.
 *
 * ## Warum sie eine Client-Komponente ist
 *
 * Wegen `aktiv`. Eine Serverkomponente muss sich sagen lassen, wo sie steht -
 * jede Seite reicht ihren Schluessel herein. Das ist genauer, weil eine
 * Unterseite (`/fragt/ergebnisse/<id>`) weiss, zu welchem Reiter sie gehoert,
 * waehrend ein Pfadvergleich sie fuer keinen haelt.
 *
 * Die zehn uebernommenen Leisten hatten diesen Schluessel nie; sie lasen den
 * Pfad. Beides bleibt moeglich: **mit** `aktiv` entscheidet die Seite, **ohne**
 * entscheidet der Pfad. So konnten die zehn Module umziehen, ohne dass in
 * fuenfundzwanzig Seiten eine neue Angabe auftauchen musste.
 *
 * Welche Bereiche jemand ueberhaupt sieht, entsteht weiterhin serverseitig -
 * die Liste kommt fertig herein. Diese Leiste ist Darstellung, keine
 * Sicherheit: jede Seite prueft ihre Berechtigung zusaetzlich selbst.
 */

export interface ModulNavigationEintrag {
  /**
   * Stabiler Schluessel - die Seite nennt ihn als `aktiv`.
   *
   * Optional: ohne ihn ist die Adresse der Schluessel. Das ist die Form, in
   * der die uebernommenen Modulleisten arbeiten.
   */
  key?: string;
  label: string;
  href: string;
  /** Name eines Symbols aus `nav-icon.tsx`. */
  icon?: string;
  /** Kurzer Zusatz unter der Beschriftung. Auf schmalen Geräten ausgeblendet. */
  hinweis?: string;
  /**
   * Eine Zahl oder ein kurzes Wort hinter der Beschriftung.
   *
   * Fuer das, was wartet: offene Tickets, neue Bewerbungen. `0` wird nicht
   * angezeigt - eine Null ist keine Nachricht.
   */
  badge?: string | number;
  /**
   * Sichtbar, aber nicht anwaehlbar.
   *
   * Fuer einen Bereich, den es gibt, der aber gerade nichts zu zeigen hat.
   * Ihn wegzulassen waere die andere Moeglichkeit und meistens die bessere -
   * ein Bereich, der verschwindet, ist schwerer zu finden als einer, der
   * grau ist.
   */
  deaktiviert?: boolean;
}

/** Der Schluessel eines Eintrags - ausdruecklich oder seine Adresse. */
function schluessel(eintrag: ModulNavigationEintrag): string {
  return eintrag.key ?? eintrag.href;
}

/**
 * Welcher Eintrag zum aktuellen Pfad gehoert.
 *
 * Der **laengste** passende Praefix, nicht der erste. Bei `/tickets` und
 * `/tickets/panels` wuerde eine Gleichheitspruefung auf `/tickets/panels`
 * keinen Reiter hervorheben und eine Praefixpruefung beide - der laengste
 * Treffer ist der einzige, der in beiden Faellen stimmt.
 */
function ausDemPfad(eintraege: readonly ModulNavigationEintrag[], pfad: string | null): string | null {
  if (!pfad) {
    return null;
  }
  let treffer: ModulNavigationEintrag | null = null;
  for (const eintrag of eintraege) {
    const passt = pfad === eintrag.href || pfad.startsWith(`${eintrag.href}/`);
    if (passt && (!treffer || eintrag.href.length > treffer.href.length)) {
      treffer = eintrag;
    }
  }
  return treffer ? schluessel(treffer) : null;
}

export function ModulNavigation({
  eintraege,
  aktiv,
  label,
  className,
}: {
  eintraege: readonly ModulNavigationEintrag[];
  /** Der Schluessel des aktuellen Bereichs. Ohne ihn entscheidet der Pfad. */
  aktiv?: string;
  /** Beschriftung für Screenreader, z.B. «Bereiche in SwissHub Wrapped». */
  label: string;
  className?: string;
}): React.JSX.Element | null {
  const pfad = usePathname();

  /*
   * Ein einzelner Bereich ist keine Navigation.
   *
   * Wer nur die Community Moments pflegen darf, bekommt keine Leiste mit
   * einem Knopf darin - das sieht nach einer Auswahl aus, die es nicht gibt.
   */
  if (eintraege.length < 2) {
    return null;
  }

  const aktuell = aktiv ?? ausDemPfad(eintraege, pfad);

  return (
    <nav
      aria-label={label}
      /* Seitlich scrollend statt umbrechend: auf 320 px passen drei
         Beschriftungen nicht nebeneinander, und zwei Zeilen Reiter sind
         schlimmer als ein Wisch. Die negativen Ränder lassen den Inhalt am
         Bildschirmrand auslaufen, damit sichtbar ist, dass es weitergeht. */
      className={cn('relative -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0', className)}
    >
      <ul className="flex min-w-max gap-1 border-b border-border">
        {eintraege.map((eintrag) => {
          const key = schluessel(eintrag);
          const istAktiv = key === aktuell;
          const inhalt = (
            <>
              {eintrag.icon ? <NavIcon name={eintrag.icon} /> : null}
              {eintrag.label}
              {eintrag.hinweis ? (
                <span className="hidden text-xs font-normal text-muted-foreground md:inline">
                  {eintrag.hinweis}
                </span>
              ) : null}
              {/* Eine Null ist keine Nachricht - sie wird weggelassen. */}
              {eintrag.badge !== undefined && eintrag.badge !== 0 && eintrag.badge !== '0' ? (
                <span className="rounded-full bg-secondary px-1.5 py-0.5 text-xs font-medium tabular-nums text-secondary-foreground">
                  {eintrag.badge}
                </span>
              ) : null}
              {istAktiv ? (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary-bright"
                />
              ) : null}
            </>
          );

          /*
           * `min-h-11` ist keine Gestaltungsfrage.
           *
           * 44 Pixel ist die Groesse, ab der ein Ziel auf einem Telefon
           * zuverlaessig zu treffen ist. Eine Reiterzeile, die man dreimal
           * antippen muss, ist auf dem Geraet, auf dem die meisten das System
           * benutzen, keine Navigation.
           */
          const klassen = cn(
            'relative flex min-h-11 items-center gap-2 whitespace-nowrap px-3 text-sm transition-colors [&_svg]:size-4',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
            istAktiv ? 'font-semibold text-foreground' : 'text-muted-foreground hover:text-foreground',
          );

          return (
            <li key={key}>
              {eintrag.deaktiviert ? (
                /*
                 * Kein Link, sondern ein Text.
                 *
                 * Ein `<a>` ohne `href` ist fuer die Tastatur kein Ziel und
                 * fuer einen Screenreader kein Link - das ist hier richtig:
                 * es gibt nichts anzusteuern. `aria-disabled` sagt, dass der
                 * Bereich existiert und gerade nicht offensteht.
                 */
                <span aria-disabled="true" className={cn(klassen, 'cursor-not-allowed opacity-50')}>
                  {inhalt}
                </span>
              ) : (
                <Link href={eintrag.href} aria-current={istAktiv ? 'page' : undefined} className={klassen}>
                  {inhalt}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
