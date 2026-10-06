import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requirePagePermission } from '@/server/auth';
import { DokuDetail } from '@/modules/docs/components/werk-ansicht';
import { ENTWICKLER_DOKU } from '@/modules/docs/werk';
import { seiteZu } from '@/modules/docs/register';

interface Props {
  params: Promise<{ pfad: string[] }>;
}

/**
 * Der Titel kommt aus dem Inhalt, nicht aus der Adresse.
 *
 * Ohne Treffer bleibt der Werktitel stehen - `notFound()` entscheidet gleich
 * danach, und eine aus dem URL-Segment gebastelte Ueberschrift waere bis
 * dahin eine Behauptung ueber eine Seite, die es nicht gibt.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { pfad } = await params;
  const treffer = seiteZu(ENTWICKLER_DOKU, pfad.join('/'));
  return {
    title: treffer ? `${treffer.seite.titel} - Entwickler-Dokumentation` : ENTWICKLER_DOKU.titel,
  };
}

/**
 * Eine Kapitelseite der Entwickler-Dokumentation.
 *
 * Der unbekannte Pfad wird **hier** abgefangen und nicht in `DokuDetail`:
 * `<DokuDetail/>` erzeugt nur ein Element, die Funktion laeuft erst beim
 * Rendern. Ein `=== null` auf das Element waere nie wahr, und `notFound()`
 * waere toter Code - ein unbekannter Pfad haette eine leere Seite ergeben.
 */
export default async function EntwicklerDokuSeite({ params }: Props): Promise<React.JSX.Element> {
  await requirePagePermission(ENTWICKLER_DOKU.permission);

  const { pfad } = await params;
  const slug = pfad.join('/');
  if (!seiteZu(ENTWICKLER_DOKU, slug)) notFound();

  return <DokuDetail werk={ENTWICKLER_DOKU} slug={slug} />;
}
