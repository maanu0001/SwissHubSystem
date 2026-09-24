import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { members, profile } from '@swisshub/modules';
import { snowflakeSchema } from '@swisshub/shared';
import { PageHeader } from '@/components/shared/page-header';
import { FremdesProfilFormular } from '@/modules/members/components/fremdes-profil-formular';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';

export const metadata: Metadata = { title: 'Profil bearbeiten' };
export const dynamic = 'force-dynamic';

/**
 * Das oeffentliche Profil eines Mitglieds von aussen bearbeiten.
 *
 * ## Warum das eine eigene Seite ist
 *
 * Der Editor unter «Mein Profil» arbeitet ausschliesslich mit der Kennung
 * aus der Sitzung - er nimmt gar kein Ziel entgegen, und das ist dort
 * genau richtig. Hier gibt es ein Ziel, und deshalb gibt es auch eine
 * Berechtigung dafuer.
 *
 * ## Was hier nicht steht
 *
 * Vitrine, Spiele, Gestaltung und Privatsphaere. Sie gehoeren der Person:
 * wie sie ihr Profil einfaerbt und was sie in ihre Vitrine stellt, ist
 * keine Moderationsfrage. Was hier steht, sind die Felder, bei denen die
 * Verwaltung tatsaechlich eingreifen muss - ein Name, der gegen die Regeln
 * verstoesst, ein Text, der weg muss.
 *
 * Die Berechtigung prueft nicht nur diese Seite, sondern auch die Aktion
 * dahinter. Wer die Adresse errät, kommt bis zum Formular und nicht weiter.
 */
export default async function FremdesProfilBearbeitenPage({
  params,
}: {
  params: Promise<{ discordId: string }>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission(members.MEMBER_PERMISSIONS.profileEdit);
  const { discordId } = await params;

  const geprueft = snowflakeSchema.safeParse(discordId);
  if (!geprueft.success) {
    notFound();
  }

  const ansicht = await profile.ladeProfil(geprueft.data, geprueft.data);
  if (!ansicht) {
    notFound();
  }

  const zeile = await profile.ladeProfilZeile(geprueft.data);

  return (
    <>
      <Link
        href={`/members/${geprueft.data}?tab=community`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Zurück zur Mitgliedsakte
      </Link>

      <PageHeader
        title={`Profil von ${ansicht.identitaet.discordName}`}
        description="Die öffentlichen Angaben dieses Mitglieds. Jede Änderung steht im Protokoll."
      />

      <FremdesProfilFormular
        discordId={geprueft.data}
        csrfToken={csrfTokenFor(context)}
        start={{
          displayName: zeile.displayName,
          tagline: zeile.tagline,
          bio: zeile.bio,
          languages: zeile.languages,
          platforms: zeile.platforms,
          playtimes: zeile.playtimes,
          comms: zeile.comms,
          playStyle: zeile.playStyle,
          availability: zeile.availability,
        }}
      />
    </>
  );
}
