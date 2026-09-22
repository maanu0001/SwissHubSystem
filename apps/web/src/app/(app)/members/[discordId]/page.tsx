import type { Metadata } from 'next';
import { systemRoutes } from '@swisshub/shared';
import { ZurueckLink } from '@/components/shared/zurueck-link';
import { MitgliedsAkte } from '@/modules/members/components/mitglieds-akte';

export const metadata: Metadata = { title: 'Mitglied' };
export const dynamic = 'force-dynamic';

/**
 * Die Akte eines Mitglieds.
 *
 * Die Route reicht nur durch. Wer welchen Abschnitt sehen darf, entscheidet
 * der Aggregator in `getMemberCenterProfile` - und zwar serverseitig und
 * anhand der Sitzung, nicht anhand der Kennung in der Adresszeile. Wer ein
 * fremdes Profil ohne Berechtigung aufruft, bekommt dieselbe Antwort wie bei
 * einem unbekannten Mitglied.
 */
export default async function MemberDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ discordId: string }>;
  searchParams: Promise<{ tab?: string; von?: string }>;
}): Promise<React.JSX.Element> {
  const { discordId } = await params;
  const { tab, von } = await searchParams;

  /*
   * Der Rückweg steht über der Akte, nicht darin.
   *
   * Eine Akte erreicht man aus der Mitgliederliste, aus einem Jail, aus der
   * Verifikation und aus einem Ticket. Welcher dieser Wege es war, weiss nur
   * die Adresse - deshalb reist er dort mit. Ohne ihn führt der Rückweg auf
   * die Mitgliederliste; das ist der kanonische Elternbereich und für einen
   * Deep Link aus Discord die richtige Antwort.
   */
  return (
    <>
      <ZurueckLink von={von} fallback={systemRoutes.mitglieder()} fallbackLabel="Mitglieder" />
      <MitgliedsAkte discordId={discordId} tab={tab} von={von} basisPfad={systemRoutes.mitglied(discordId)} />
    </>
  );
}
