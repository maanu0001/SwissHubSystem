import Link from 'next/link';
import { BookOpen } from 'lucide-react';
import { can } from '@swisshub/auth';
import { requireAuth } from '@/server/auth';
import { seitenHref, seiteZu } from '../register';
import { TEAM_DOKU } from '../werk';

/**
 * Der Hinweis «Dokumentation» auf einer Modulseite.
 *
 * ## Warum er nichts anzeigt, wenn etwas fehlt
 *
 * Drei Bedingungen, und jede einzelne laesst den Hinweis verschwinden: der
 * Betrachter darf die Team-Dokumentation sehen, das Werk kennt den Slug, und
 * die Seite dahinter existiert. Ein Link auf ein Kapitel, das umbenannt wurde,
 * waere eine Sackgasse mitten in einem Modul - und ein Link, der fuer die
 * Haelfte des Teams in einer Fehlermeldung endet, kostet mehr Vertrauen als
 * der fehlende Link.
 *
 * Deshalb wird der Slug hier **aufgeloest** und nicht zusammengesetzt: dass
 * ein toter Link nie entsteht, haengt nicht an der Aufmerksamkeit dessen, der
 * eine Modulseite anfasst.
 *
 * ## Warum das keine Sicherheitspruefung ist
 *
 * `can` entscheidet nur, ob der Hinweis erscheint. Wer die Adresse kennt,
 * laeuft trotzdem in `requirePagePermission` der Doku-Route. Diese Komponente
 * ist Wegweiser, kein Riegel.
 */
export async function DokuHinweis({ slug }: { slug: string }): Promise<React.JSX.Element | null> {
  const treffer = seiteZu(TEAM_DOKU, slug);
  if (!treffer) return null;

  const context = await requireAuth();
  if (!can(context, TEAM_DOKU.permission)) return null;

  return (
    <Link
      href={seitenHref(TEAM_DOKU, treffer.seite)}
      className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <BookOpen className="size-4 shrink-0" aria-hidden="true" />
      <span>Dokumentation</span>
    </Link>
  );
}
