import type { Metadata } from 'next';
import { requirePagePermission } from '@/server/auth';
import { DokuStart } from '@/modules/docs/components/werk-ansicht';
import { ENTWICKLER_DOKU } from '@/modules/docs/werk';

export const metadata: Metadata = { title: 'Entwickler-Dokumentation' };

/**
 * Startseite der Entwickler-Dokumentation.
 *
 * Der Riegel steht hier und nicht in der Navigation. Dass der Eintrag in der
 * Seitenleiste nur mit Berechtigung erscheint, ist Bedienkomfort - wer die
 * Adresse kennt, tippt sie sonst trotzdem ein.
 */
export default async function EntwicklerDokuPage(): Promise<React.JSX.Element> {
  await requirePagePermission(ENTWICKLER_DOKU.permission);
  return <DokuStart werk={ENTWICKLER_DOKU} />;
}
