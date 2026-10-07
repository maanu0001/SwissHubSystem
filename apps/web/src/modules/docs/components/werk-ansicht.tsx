import Link from 'next/link';
import { ArrowRight, BookOpen } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DokuNavigation, type NavKategorie } from './doku-navigation';
import { DokuSuche } from './doku-suche';
import { DokuSeiteAnsicht } from './seite';
import { seitenHref, seiteZu, sucheIndex } from '../register';
import type { DokuWerk } from '../typen';

/**
 * Das Geruest beider Dokumentationen.
 *
 * Start- und Detailseite benutzen dasselbe Layout: links Suche und Inhalt, in
 * der Mitte der Text. Die Startseite tauscht nur den Mittelteil gegen eine
 * Kachelliste - Navigation, Suche und Breiten bleiben identisch, damit ein
 * Klick auf eine Kachel nicht aussieht wie der Wechsel in eine andere
 * Anwendung.
 *
 * Wie die Navigation auf einem Telefon erscheint, entscheidet sie selbst
 * (Schubfach) - hier steht nur, wo sie steht.
 */
function Geruest({ werk, children }: { werk: DokuWerk; children: React.ReactNode }): React.JSX.Element {
  const index = sucheIndex(werk);
  const kategorien: NavKategorie[] = werk.kategorien.map((kategorie) => ({
    id: kategorie.id,
    titel: kategorie.titel,
    seiten: kategorie.seiten.map((seite) => ({
      slug: seite.slug,
      titel: seite.titel,
      href: seitenHref(werk, seite),
    })),
  }));

  return (
    /*
     * Eine Spalte bis `lg`, zwei darueber - und auf dem Telefon liegen Suche
     * und Inhalts-Knopf **nebeneinander** statt uebereinander. Untereinander
     * kosteten sie zwei Zeilen plus Abstand, bevor der Artikel anfing; auf
     * einem 844px hohen Bildschirm ist das ein knappes Zehntel der Hoehe fuer
     * zwei Bedienelemente.
     */
    <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:gap-8">
      <div className="flex min-w-0 items-center gap-2 lg:block lg:w-64 lg:shrink-0 lg:space-y-3">
        {/* `min-w-0` am Suchfeld: ohne das schiebt sein Inhalt die Zeile auf. */}
        <div className="min-w-0 flex-1">
          <DokuSuche index={index} platzhalter={`In ${werk.titel} suchen`} />
        </div>
        <DokuNavigation kategorien={kategorien} titel={werk.titel} />
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Startseite eines Werks: Kategorien als Karten mit ihren Kapiteln. */
export function DokuStart({ werk }: { werk: DokuWerk }): React.JSX.Element {
  return (
    <Geruest werk={werk}>
      <div className="min-w-0 max-w-3xl space-y-5 sm:space-y-6">
        <header className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <BookOpen className="size-4" aria-hidden="true" />
            <span>Dokumentation</span>
          </div>
          <h1 className="text-[2rem] font-semibold leading-[1.15] tracking-tight sm:text-3xl sm:leading-tight">
            {werk.titel}
          </h1>
          <p className="text-base leading-7 text-muted-foreground sm:text-[0.95rem]">{werk.kurz}</p>
        </header>

        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          {werk.kategorien.map((kategorie) => (
            <Card key={kategorie.id} className="min-w-0">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{kategorie.titel}</CardTitle>
                <CardDescription>
                  {kategorie.seiten.length} {kategorie.seiten.length === 1 ? 'Kapitel' : 'Kapitel'}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <ul className="space-y-1">
                  {kategorie.seiten.map((seite) => (
                    <li key={seite.slug} className="min-w-0">
                      <Link
                        href={seitenHref(werk, seite)}
                        className="group flex min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent/50"
                      >
                        <ArrowRight
                          className="mt-1 size-3.5 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-primary-bright"
                          aria-hidden="true"
                        />
                        <span className="min-w-0">
                          <span className="block font-medium text-foreground">{seite.titel}</span>
                          <span className="block text-xs text-muted-foreground">{seite.kurz}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </Geruest>
  );
}

/**
 * Detailseite eines Werks.
 *
 * Gibt `null` zurueck, wenn der Pfad zu keiner Seite gehoert. Was dann
 * passiert, entscheidet die Route - sie kennt `notFound()`, diese Komponente
 * nicht.
 */
export function DokuDetail({ werk, slug }: { werk: DokuWerk; slug: string }): React.JSX.Element | null {
  const treffer = seiteZu(werk, slug);
  if (!treffer) return null;

  return (
    <Geruest werk={werk}>
      <DokuSeiteAnsicht werk={werk} kategorie={treffer.kategorie} seite={treffer.seite} />
    </Geruest>
  );
}
