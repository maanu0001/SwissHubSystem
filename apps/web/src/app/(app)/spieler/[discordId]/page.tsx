import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { profile } from '@swisshub/modules';
import { systemRoutes } from '@swisshub/shared';
import { ProfilAnsicht } from '@/modules/profile/components/profil-ansicht';
import { ZurueckLink } from '@/components/shared/zurueck-link';
import { requireMember } from '@/server/auth';

export const metadata: Metadata = { title: 'Profil' };
export const dynamic = 'force-dynamic';

/**
 * Das Profil eines anderen Mitglieds.
 *
 * Die Kennung aus der Adresse sagt **wen** man ansieht - was man davon zu
 * sehen bekommt, entscheidet der Dienst anhand der Kennung aus der Sitzung.
 * Ein Abschnitt, den jemand auf privat gestellt hat, wird dort gar nicht
 * erst geladen; ihn hier auszublenden waere zu spaet.
 *
 * Wer die eigene Kennung eintippt, landet auf «Mein Profil» - sonst gaebe es
 * zwei Adressen fuer dieselbe Seite, und eine davon ohne den Bearbeiten-Knopf.
 */
export default async function FremdesProfilPage({
  params,
  searchParams,
}: {
  params: Promise<{ discordId: string }>;
  searchParams: Promise<{ von?: string }>;
}): Promise<React.JSX.Element> {
  const context = await requireMember();
  const [{ discordId }, { von }] = await Promise.all([params, searchParams]);

  if (discordId === context.user.discordId) {
    redirect(systemRoutes.profil());
  }

  const ansicht = await profile.ladeProfil(discordId, context.user.discordId);
  if (!ansicht) {
    notFound();
  }

  return (
    <div className="space-y-4">
      <ZurueckLink von={von} fallback={systemRoutes.entdecken()} fallbackLabel="Mitglieder entdecken" />
      <ProfilAnsicht ansicht={ansicht} />
    </div>
  );
}
