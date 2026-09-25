import type { Metadata } from 'next';
import { MitgliedsAkte } from '@/modules/members/components/mitglieds-akte';
import { requireMember } from '@/server/auth';

export const metadata: Metadata = { title: 'Mein Profil' };
export const dynamic = 'force-dynamic';

/**
 * Mein Profil - dieselbe Akte wie bei jedem anderen Mitglied.
 *
 * ## Warum das hier keine eigene Darstellung mehr ist
 *
 * Es gab zwei interne Profilansichten: die Akte unter `/members/<id>` und
 * eine zweite, aufwendig gestaltete unter dieser Adresse. Zwei Layouts fuer
 * dieselbe Frage - und die Berechtigungen mussten an beiden Stellen richtig
 * stehen. Auffaellig wird so etwas erst, wenn sie es an einer Stelle nicht
 * mehr tun.
 *
 * Die aufwendige Darstellung ist nicht verschwunden, sie hat nur einen Ort:
 * die **oeffentliche** Profilseite unter `/u/<slug>`. Dorthin fuehrt der
 * Knopf oben in der Akte - und was dort steht, entscheidet weiterhin die
 * Privatsphaere-Einstellung und nicht diese Seite.
 *
 * ## Was die Akte im eigenen Profil zeigt
 *
 * Nur, was dieses Mitglied sehen darf. Der Aggregator entscheidet das
 * anhand der Sitzung, nicht anhand der Adresse - es gibt hier kein Ziel,
 * das sich manipulieren liesse, und keine Moderationsdaten, die erst in der
 * Anzeige ausgeblendet wuerden.
 *
 * `requireMember()` und nicht `requirePagePermission(...)`: das eigene
 * Profil haengt an der Anmeldung, nicht an einer Zuteilung. Wer es sehen
 * will, soll dafuer nicht erst Zugang zur Mitgliederverwaltung brauchen.
 */
export default async function MeinProfilPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}): Promise<React.JSX.Element> {
  const context = await requireMember();
  const { tab } = await searchParams;

  return <MitgliedsAkte discordId={context.user.discordId} tab={tab} basisPfad="/profil" />;
}
