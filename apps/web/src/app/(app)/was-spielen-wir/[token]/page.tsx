import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { can } from '@swisshub/auth';
import { resolveGuildId } from '@swisshub/discord';
import { isModuleEnabled, spielwahl } from '@swisshub/modules';
import { ErrorState } from '@/components/shared/states';
import { Buehne } from '@/modules/spielwahl/components/buehne';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';

export const metadata: Metadata = {
  title: 'Was spielen wir?',
  /*
   * Die ganze Anwendung steht schon auf `noindex` (siehe `app/layout.tsx`).
   * Hier steht es noch einmal, weil diese Seite ueber einen Link aus Discord
   * betreten wird - und eine Seite, deren Adresse in Nachrichten wandert,
   * soll auch dann nicht in einem Index landen, wenn oben jemand aufraeumt.
   */
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

/**
 * Eine Spielauswahl.
 *
 * ## Die Adresse
 *
 * Erreichbar über den Einladungswert - 128 zufällige Bit, nicht zu raten.
 * Als Rückfall auch über die interne Kennung: die steht in der Übersicht,
 * und wer dort eine Runde sieht, soll sie öffnen können, ohne dass ihm
 * jemand den Einladungslink schickt.
 *
 * **Beides führt durch dieselbe Prüfung.** Die Adresse allein berechtigt zu
 * nichts: angemeldet, Mitglied der Guild, Recht auf das Modul - und die
 * Session muss zur eigenen Guild gehören. Ein Einladungslink, der an einen
 * Aussenstehenden gerät, öffnet ihm die Anmeldung und danach eine
 * Absage.
 *
 * ## Warum kein Beitritt beim Öffnen
 *
 * Wer einem Link folgt, wollte vielleicht nur nachsehen. Beigetreten wird
 * mit einem Klick - sichtbar, und für alle anderen auch.
 */
export default async function SpielwahlSessionPage({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission(spielwahl.SPIELWAHL_PERMISSIONS.view);

  if (!(await isModuleEnabled(spielwahl.SPIELWAHL_MODULE_ID))) {
    return <ErrorState title="Nicht verfügbar" description="«Was spielen wir?» ist derzeit ausgeschaltet." />;
  }

  const { token } = await params;
  const guildId = await resolveGuildId();

  const session = spielwahl.einladungsSchema.safeParse(token).success
    ? await spielwahl.findeUeberEinladung(guildId, token)
    : spielwahl.sessionIdSchema.safeParse(token).success
      ? await spielwahl.finde(guildId, token)
      : null;

  if (!session) {
    notFound();
  }

  const stand = await spielwahl.baueAnsicht(session.id, context.user.discordId);
  if (!stand) {
    notFound();
  }

  return (
    <Buehne
      anfang={stand}
      csrfToken={csrfTokenFor(context)}
      darfModerieren={can(context, spielwahl.SPIELWAHL_PERMISSIONS.manage)}
    />
  );
}
