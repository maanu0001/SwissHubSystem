import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { prisma } from '@swisshub/database';
import { profile } from '@swisshub/modules';
import { PageHeader } from '@/components/shared/page-header';
import { ProfilEditor } from '@/modules/profile/components/editor/profil-editor';
import { csrfTokenFor, requireMember } from '@/server/auth';

export const metadata: Metadata = { title: 'Profil bearbeiten' };
export const dynamic = 'force-dynamic';

/**
 * Der Profil-Editor.
 *
 * **Bearbeitet wird ausschliesslich das eigene Profil.** Es gibt hier keinen
 * Adressteil und keinen Parameter, der ein anderes benennen koennte; die
 * Kennung kommt aus der Sitzung und geht von hier direkt in den Dienst.
 *
 * `requireMember()` und keine Berechtigung: wer ein Profil hat, darf es
 * pflegen. Eine Verwaltungsberechtigung dafuer zu verlangen hiesse, dass ein
 * gewoehnliches Mitglied sein eigenes Profil nicht bearbeiten kann.
 */
export default async function ProfilBearbeitenPage(): Promise<React.JSX.Element> {
  const context = await requireMember();

  const [daten, spiegel] = await Promise.all([
    profile.ladeEditor(context.user.discordId),
    prisma.discordMemberCache.findUnique({
      where: { discordId: context.user.discordId },
      select: { displayName: true, avatarHash: true },
    }),
  ]);

  if (!spiegel) {
    notFound();
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Profil bearbeiten"
        description="Sechs Abschnitte, jeder speichert für sich. Die Vorschau oben zeigt, wie dein Kopf aussieht."
      />
      <ProfilEditor
        csrfToken={csrfTokenFor(context)}
        daten={daten}
        identitaet={{
          discordId: context.user.discordId,
          discordName: spiegel.displayName,
          avatarHash: spiegel.avatarHash,
        }}
      />
    </div>
  );
}
