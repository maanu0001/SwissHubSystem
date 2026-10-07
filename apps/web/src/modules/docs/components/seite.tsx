import Link from 'next/link';
import { ChevronLeft, ChevronRight, Link2 } from 'lucide-react';
import { can } from '@swisshub/auth';
import { requireAuth } from '@/server/auth';
import { Block } from './blocks';
import { AufDieserSeite } from './auf-dieser-seite';
import { inhaltsverzeichnis } from '../register';
import type { DokuKategorie, DokuSeite, DokuWerk } from '../typen';

/**
 * Eine Dokumentationsseite - Brotkrumen, Inhalt, «Auf dieser Seite».
 *
 * ## Die Lesebreite
 *
 * `max-w-3xl` am Textbereich. Auf 1920 Pixel waere eine Spalte ueber die
 * ganze Breite zwar «ausgenutzt», aber kaum lesbar: das Auge verliert am
 * Zeilenende die Zeile. Der freie Platz rechts traegt ab `xl` das
 * Inhaltsverzeichnis der Seite.
 */

/** Eine Ueberschrift mit Anker und Klick-zum-Kopieren-Symbol. */
function Ueberschrift({
  anker,
  titel,
  ebene,
}: {
  anker: string;
  titel: string;
  ebene: 2 | 3;
}): React.JSX.Element {
  const Tag = ebene === 2 ? 'h2' : 'h3';
  return (
    <Tag
      id={anker}
      className={
        ebene === 2
          ? // `scroll-mt`: ohne das verschwindet die Ueberschrift beim Sprung
            // auf einen Anker hinter der festen Kopfzeile.
            //
            // Die Groesse steigt auf dem Telefon, nicht auf dem Rechner: 22px
            // unter einer 32px-H1 und ueber 16px Text ist eine Stufenfolge,
            // die man beim Scrollen sieht. Auf dem Rechner bleibt es bei
            // 18px - dort traegt die schmalere Spalte die Gliederung mit.
            'group scroll-mt-24 text-[1.375rem] font-semibold leading-snug tracking-tight sm:text-lg'
          : 'group scroll-mt-24 text-[1.0625rem] font-semibold leading-snug sm:text-[0.95rem]'
      }
    >
      <a href={`#${anker}`} className="inline-flex items-center gap-1.5">
        {titel}
        <Link2 aria-hidden="true" className="size-3.5 opacity-0 transition-opacity group-hover:opacity-60" />
        <span className="sr-only">Link zu diesem Abschnitt</span>
      </a>
    </Tag>
  );
}

/**
 * Eine Kapitelseite.
 *
 * Asynchron, weil der Betrachter hier einmal gebraucht wird: `darf`
 * entscheidet, welche Modulknoepfe erscheinen. Die Abfrage steht an **einer**
 * Stelle und wird nach unten gereicht - haette jeder Knopf selbst gefragt,
 * laeuft pro Seite ein Dutzend Mal dieselbe Aufloesung.
 */
export async function DokuSeiteAnsicht({
  werk,
  kategorie,
  seite,
}: {
  werk: DokuWerk;
  kategorie: DokuKategorie;
  seite: DokuSeite;
}): Promise<React.JSX.Element> {
  const context = await requireAuth();
  const darf = (permission: string): boolean => can(context, permission);
  const toc = inhaltsverzeichnis(seite);

  return (
    /*
     * Eine Spalte bis `xl`, zwei darueber.
     *
     * ## Was hier kaputt war
     *
     * Hier stand `flex min-w-0 gap-8` ohne Breakpoint, daneben ein
     * `<aside className="w-56 shrink-0">`. Die Randspalte war damit auf
     * **jeder** Breite 224px breit und gab wegen `shrink-0` nie nach - auch
     * dann, wenn ihr Inhalt (`AufDieserSeite`, intern `hidden xl:block`) gar
     * nichts anzeigte. Auf einem 390px-Telefon blieben nach 16px Shell-Padding
     * je Seite, 224px Randspalte und 32px Abstand rund **100px** fuer den
     * Text uebrig. Das war die Wortkaskade: eine unsichtbare Spalte, die
     * Platz reservierte.
     *
     * Deshalb steckt die Randspalte jetzt selbst in `hidden 2xl:block`. Unter
     * `2xl` ist sie nicht unsichtbar, sondern **nicht da** - sie kann keinen
     * Platz belegen, den sie nicht nutzt.
     *
     * ## Warum `2xl` und nicht `xl`
     *
     * Gemessen am gebauten Server: auf 1366px standen bei `xl` drei Spalten
     * nebeneinander - App-Navigation 256, Doku-Navigation 256, Randspalte 224 -
     * und dem Text blieben 494px, also 41 Zeichen pro Zeile. Das ist derselbe
     * Fehler wie auf dem Telefon, nur milder: eine Spalte zu viel fuer die
     * vorhandene Breite.
     *
     * Ab `2xl` (1536px) ist Platz fuer alle drei; auf 1920px traegt der
     * Artikel dann 768px und 81 Zeichen. Unter `2xl` weicht die Randspalte,
     * und 1366px kommt auf 750px Lesebreite. Die Gliederung einer Seite steht
     * ohnehin auch im Schubfach - der Platz, den sie auf einem Laptop kostet,
     * steht in keinem Verhaeltnis dazu.
     */
    <div className="flex min-w-0 flex-col 2xl:flex-row 2xl:gap-8">
      {/*
        `max-w-3xl` greift erst ab 768px und begrenzt daher nur die Lesebreite
        am Rechner. Auf dem Telefon bindet es nicht - dort entscheidet
        `w-full`, und der Text nutzt die Breite, die da ist.
      */}
      <article className="w-full min-w-0 max-w-3xl flex-1 space-y-5 sm:space-y-6">
        {/*
          Brotkrumen in zwei Fassungen.

          Am Rechner der ganze Pfad. Auf dem Telefon nur ein Rueckweg: drei
          Glieder brauchten dort zwei bis drei Zeilen, und das Blatt des Pfades
          stand ohnehin unmittelbar darunter als H1. Eine Zeile, die wiederholt,
          was die naechste sagt, ist verlorener Platz.
        */}
        <nav aria-label="Pfad" className="min-w-0">
          <Link
            href={werk.basis}
            className="inline-flex min-h-8 min-w-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground sm:hidden"
          >
            <ChevronLeft aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="truncate">{werk.titel}</span>
          </Link>

          <span className="hidden min-w-0 flex-wrap items-center gap-1 text-xs sm:flex">
            <Link href={werk.basis} className="text-muted-foreground hover:text-foreground">
              {werk.titel}
            </Link>
            <ChevronRight aria-hidden="true" className="size-3 shrink-0 text-muted-foreground/60" />
            <span className="text-muted-foreground">{kategorie.titel}</span>
            <ChevronRight aria-hidden="true" className="size-3 shrink-0 text-muted-foreground/60" />
            <span className="min-w-0 truncate font-medium text-foreground">{seite.titel}</span>
          </span>
        </nav>

        <header className="space-y-2">
          <h1 className="text-[2rem] font-semibold leading-[1.15] tracking-tight sm:text-2xl sm:leading-tight">
            {seite.titel}
          </h1>
          <p className="text-base leading-7 text-muted-foreground sm:text-[0.95rem]">{seite.kurz}</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {seite.bereich ? (
              <span className="rounded-md bg-muted/60 px-1.5 py-0.5">Bereich: {seite.bereich}</span>
            ) : null}
            {/*
              Auf dem Telefon nur «Aktualisiert», am Rechner der ganze Satz.
              Dasselbe Datum, ein Wort weniger - das reicht, damit die Zeile
              neben dem Bereichs-Chip nicht umbricht.
            */}
            <span>
              <span className="sm:hidden">Aktualisiert: </span>
              <span className="hidden sm:inline">Zuletzt aktualisiert: </span>
              {seite.aktualisiert}
            </span>
          </div>
        </header>

        {seite.abschnitte.map((abschnitt) => (
          <section key={abschnitt.anker} className="space-y-3 border-t border-border/40 pt-4 sm:pt-5">
            <Ueberschrift anker={abschnitt.anker} titel={abschnitt.titel} ebene={2} />
            {abschnitt.blocks.map((block, index) => (
              <Block key={index} block={block} darf={darf} />
            ))}
            {(abschnitt.unter ?? []).map((unter) => (
              <div key={unter.anker} className="space-y-3 pt-2">
                <Ueberschrift anker={unter.anker} titel={unter.titel} ebene={3} />
                {unter.blocks.map((block, index) => (
                  <Block key={index} block={block} darf={darf} />
                ))}
              </div>
            ))}
          </section>
        ))}
      </article>

      {/*
        `hidden xl:block` am Wrapper und nicht nur im Inhalt: ein Element, das
        sich nur selbst versteckt, belegt als Flex-Kind weiterhin seine
        Breite. Genau daran lag die zu schmale Lesespalte.
      */}
      <aside className="hidden 2xl:block 2xl:w-56 2xl:shrink-0">
        <AufDieserSeite eintraege={toc} />
      </aside>
    </div>
  );
}
