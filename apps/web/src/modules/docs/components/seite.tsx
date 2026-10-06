import Link from 'next/link';
import { ChevronRight, Link2 } from 'lucide-react';
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
            'group scroll-mt-24 text-lg font-semibold tracking-tight'
          : 'group scroll-mt-24 text-[0.95rem] font-semibold'
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
    <div className="flex min-w-0 gap-8">
      <article className="min-w-0 max-w-3xl flex-1 space-y-6">
        {/* Brotkrumen: Werk → Kategorie → Seite. */}
        <nav aria-label="Pfad" className="flex min-w-0 flex-wrap items-center gap-1 text-xs">
          <Link href={werk.basis} className="text-muted-foreground hover:text-foreground">
            {werk.titel}
          </Link>
          <ChevronRight aria-hidden="true" className="size-3 shrink-0 text-muted-foreground/60" />
          <span className="text-muted-foreground">{kategorie.titel}</span>
          <ChevronRight aria-hidden="true" className="size-3 shrink-0 text-muted-foreground/60" />
          <span className="min-w-0 truncate font-medium text-foreground">{seite.titel}</span>
        </nav>

        <header className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">{seite.titel}</h1>
          <p className="text-[0.95rem] leading-7 text-muted-foreground">{seite.kurz}</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {seite.bereich ? (
              <span className="rounded-md bg-muted/60 px-1.5 py-0.5">Bereich: {seite.bereich}</span>
            ) : null}
            <span>Zuletzt aktualisiert: {seite.aktualisiert}</span>
          </div>
        </header>

        {seite.abschnitte.map((abschnitt) => (
          <section key={abschnitt.anker} className="space-y-3 border-t border-border/40 pt-5">
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

      <aside className="w-56 shrink-0">
        <AufDieserSeite eintraege={toc} />
      </aside>
    </div>
  );
}
