import Link from 'next/link';
import { AlertTriangle, ArrowRight, ChevronRight, Info, Lightbulb, ShieldAlert, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CodeBlock } from './code-block';
import { zerlegeInline } from '../inline';
import type { DokuBlock, HinweisTon } from '../typen';

/**
 * Die Darstellung der Inhaltsbloecke.
 *
 * Eine Serverkomponente - nur der Codeblock und die Suche brauchen den
 * Browser. Das haelt die Doku schnell: eine Seite mit vierzig Absaetzen
 * schickt Markup und kein Rendering.
 */

/** Fliesstext mit den drei erlaubten Auszeichnungen. */
export function Inline({ text }: { text: string }): React.JSX.Element {
  return (
    <>
      {zerlegeInline(text).map((teil, index) => {
        if (teil.art === 'code') {
          return (
            <code
              key={index}
              className="rounded bg-muted/60 px-1 py-0.5 font-mono text-[0.86em] text-primary-bright [overflow-wrap:anywhere]"
            >
              {teil.text}
            </code>
          );
        }
        if (teil.art === 'fett') {
          return (
            <strong key={index} className="font-semibold text-foreground">
              {teil.text}
            </strong>
          );
        }
        if (teil.art === 'link') {
          /*
           * Interne Adressen als `Link`, externe als `a`.
           *
           * Die Doku verlinkt fast nur nach innen; wo doch nach draussen,
           * soll der Browser das uebernehmen und Next.js nicht versuchen,
           * eine fremde Adresse vorzuladen.
           */
          return teil.href.startsWith('/') ? (
            <Link
              key={index}
              href={teil.href}
              className="font-medium text-primary-bright underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
            >
              {teil.text}
            </Link>
          ) : (
            <a
              key={index}
              href={teil.href}
              rel="noreferrer noopener"
              target="_blank"
              className="font-medium text-primary-bright underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
            >
              {teil.text}
            </a>
          );
        }
        return <span key={index}>{teil.text}</span>;
      })}
    </>
  );
}

const HINWEIS: Record<HinweisTon, { label: string; icon: typeof Info; rahmen: string; chip: string }> = {
  info: {
    label: 'Info',
    icon: Info,
    rahmen: 'border-border/70 bg-muted/30',
    chip: 'bg-muted text-muted-foreground',
  },
  tipp: {
    label: 'Tipp',
    icon: Lightbulb,
    rahmen: 'border-success/30 bg-success/5',
    chip: 'bg-success/15 text-success',
  },
  wichtig: {
    label: 'Wichtig',
    icon: Star,
    rahmen: 'border-primary/30 bg-primary/5',
    chip: 'bg-primary/15 text-primary-bright',
  },
  achtung: {
    label: 'Achtung',
    icon: AlertTriangle,
    rahmen: 'border-destructive/35 bg-destructive/5',
    chip: 'bg-destructive/15 text-destructive',
  },
  admin: {
    label: 'Nur Administration',
    icon: ShieldAlert,
    rahmen: 'border-warning/30 bg-warning/5',
    chip: 'bg-warning/15 text-warning',
  },
};

/**
 * Ein Ablauf als Kette.
 *
 * Auf dem Telefon untereinander mit Pfeil nach unten, ab `sm` nebeneinander.
 * Kein horizontales Scrollen: eine Kette, die man wegschieben muss, erzaehlt
 * ihren Ablauf nicht mehr.
 */
function Fluss({
  stationen,
}: {
  stationen: readonly { label: string; detail?: string }[];
}): React.JSX.Element {
  return (
    <ol className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-stretch">
      {stationen.map((station, index) => (
        <li key={station.label} className="flex min-w-0 items-center gap-2 sm:contents">
          <div className="min-w-0 flex-1 rounded-lg border border-border/60 bg-card/60 px-3 py-2 sm:flex-none sm:basis-[calc(33.333%-1.5rem)]">
            <p className="truncate text-sm font-medium">{station.label}</p>
            {station.detail ? (
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{station.detail}</p>
            ) : null}
          </div>
          {index < stationen.length - 1 ? (
            <ArrowRight
              aria-hidden="true"
              className="size-4 shrink-0 rotate-90 text-primary/60 sm:my-auto sm:rotate-0"
            />
          ) : null}
        </li>
      ))}
    </ol>
  );
}

/**
 * Ein Inhaltsblock.
 *
 * `darf` entscheidet ueber den Modulknopf und nur ueber ihn. Es kommt von der
 * Seite herein, weil diese Komponente den Betrachter nicht kennt und auch
 * nicht kennen soll - sie stellt dar, sie entscheidet nicht.
 *
 * Ohne `darf` erscheint kein Knopf. Das ist die vorsichtige Richtung: ein
 * Aufrufer, der das Praedikat vergisst, zeigt einen Knopf zu wenig statt
 * einen, der in einer Fehlermeldung endet.
 */
export function Block({
  block,
  darf,
}: {
  block: DokuBlock;
  darf?: (permission: string) => boolean;
}): React.JSX.Element | null {
  switch (block.art) {
    case 'absatz':
      return (
        <p className="text-base leading-7 text-muted-foreground sm:text-[0.95rem]">
          <Inline text={block.text} />
        </p>
      );

    case 'liste': {
      const Tag = block.geordnet === true ? 'ol' : 'ul';
      return (
        <Tag
          className={cn(
            'space-y-1.5 pl-4 text-base leading-7 text-muted-foreground sm:pl-5 sm:text-[0.95rem]',
            block.geordnet === true ? 'list-decimal' : 'list-disc',
          )}
        >
          {block.punkte.map((punkt, index) => (
            <li key={index} className="marker:text-primary/60">
              <Inline text={punkt} />
            </li>
          ))}
        </Tag>
      );
    }

    case 'code':
      return <CodeBlock inhalt={block.inhalt} sprache={block.sprache} titel={block.titel} />;

    case 'tabelle':
      /*
       * Die Tabelle scrollt in ihrem eigenen Kasten.
       *
       * `block w-full overflow-x-auto` am Wrapper und `min-w-0` oben: eine
       * Berechtigungstabelle mit vier Spalten passt auf 360 Pixel nicht, und
       * sie soll dort auch nicht umgebrochen werden - dann liest man Zeilen,
       * die nicht zusammengehoeren.
       */
      return (
        <div className="w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-border/60">
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border/60 bg-muted/30">
                  {block.kopf.map((zelle) => (
                    <th key={zelle} className="px-3 py-2 text-xs font-semibold uppercase tracking-wide">
                      <Inline text={zelle} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.zeilen.map((zeile, index) => (
                  <tr key={index} className="border-b border-border/40 last:border-0">
                    {zeile.map((zelle, spalte) => (
                      <td
                        key={spalte}
                        className={cn(
                          'px-3 py-2 align-top text-muted-foreground',
                          spalte === 0 && 'font-medium text-foreground',
                        )}
                      >
                        <Inline text={zelle} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );

    case 'hinweis': {
      const art = HINWEIS[block.ton];
      const Icon = art.icon;
      return (
        <div className={cn('min-w-0 rounded-xl border p-2.5 sm:p-3', art.rahmen)}>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold',
                art.chip,
              )}
            >
              <Icon className="size-3" aria-hidden="true" />
              {block.titel ?? art.label}
            </span>
          </div>
          <p className="mt-2 text-[0.9rem] leading-6 text-muted-foreground">
            <Inline text={block.text} />
          </p>
        </div>
      );
    }

    case 'schritte':
      return (
        <ol className="space-y-3">
          {block.punkte.map((punkt, index) => (
            <li key={index} className="flex min-w-0 gap-3">
              <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-semibold text-primary-bright">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[0.95rem] font-medium sm:text-sm">
                  <Inline text={punkt.titel} />
                </p>
                {punkt.text ? (
                  <p className="mt-0.5 text-[0.9rem] leading-6 text-muted-foreground">
                    <Inline text={punkt.text} />
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      );

    case 'fluss':
      return <Fluss stationen={block.stationen} />;

    case 'felder':
      return (
        <dl className="min-w-0 divide-y divide-border/40 overflow-hidden rounded-xl border border-border/60">
          {block.eintraege.map((eintrag) => (
            <div key={eintrag.name} className="px-3 py-2 sm:flex sm:gap-4">
              <dt className="shrink-0 font-mono text-[12.5px] font-medium text-primary-bright sm:w-52">
                {eintrag.name}
              </dt>
              <dd className="mt-0.5 min-w-0 flex-1 text-[0.95rem] leading-6 text-muted-foreground sm:mt-0 sm:text-[0.9rem]">
                <Inline text={eintrag.text} />
              </dd>
            </div>
          ))}
        </dl>
      );

    case 'modulknopf':
      /*
       * §61: der Knopf erscheint nur, wenn der Betrachter das Modul auch
       * oeffnen darf. Ein Knopf, der zuverlaessig in «Keine Berechtigung»
       * fuehrt, ist schlimmer als keiner - er sieht wie ein Angebot aus.
       *
       * Ein Riegel ist das nicht: die Zielseite prueft selbst. Hier geht es
       * darum, niemandem einen Weg zu zeigen, den es fuer ihn nicht gibt.
       */
      if (!darf?.(block.permission)) {
        return null;
      }
      return (
        <Link
          href={block.href}
          className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-sm font-medium text-primary-bright transition-colors hover:bg-primary/20"
        >
          {block.label}
          <ChevronRight className="size-4" aria-hidden="true" />
        </Link>
      );
  }
}
