import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { profile } from '@swisshub/modules';
import { ProfilAnsicht } from '@/modules/profile/components/profil-ansicht';
import { requireMember } from '@/server/auth';

export const metadata: Metadata = { title: 'Mein Profil' };
export const dynamic = 'force-dynamic';

/**
 * Das eigene Community-Profil.
 *
 * **Die Kennung kommt aus der Sitzung**, nie aus der Adresszeile - es gibt
 * hier kein Ziel, das sich manipulieren liesse.
 *
 * `requireMember()` und nicht `requirePagePermission(...)`: das eigene Profil
 * haengt an der Anmeldung, nicht an einer Zuteilung. Wer sein Profil sehen
 * will, soll dafuer nicht erst Zugang zur Mitgliederverwaltung brauchen -
 * derselbe Grund, aus dem der Navigationseintrag `baseline` traegt.
 *
 * Die Akte unter `/profile` bleibt daneben bestehen: dort steht die
 * Selbstauskunft (Aktivitaet, Tickets, Premium), hier steht, was jemand
 * ueber sich erzaehlt. Zwei Fragen, zwei Seiten.
 */
export default async function MeinProfilPage(): Promise<React.JSX.Element> {
  const context = await requireMember();
  const ansicht = await profile.ladeProfil(context.user.discordId, context.user.discordId);

  if (!ansicht) {
    // Ohne Eintrag im Discord-Spiegel gibt es keinen Namen und kein Profil.
    // Das passiert nur, solange die erste Synchronisierung laeuft.
    notFound();
  }

  return <ProfilAnsicht ansicht={ansicht} />;
}
