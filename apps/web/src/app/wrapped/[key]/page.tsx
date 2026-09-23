import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@swisshub/database';
import { wrapped } from '@swisshub/modules';
import { isModuleEnabled } from '@swisshub/modules';
import { resolveGuildId } from '@swisshub/discord';
import { WrappedAnsicht } from '@/modules/wrapped/ansicht';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import type { WrappedDaten } from '@swisshub/modules/wrapped/daten';

export const metadata: Metadata = { title: 'Dein Jahr' };
export const dynamic = 'force-dynamic';

/**
 * Der eigene Rueckblick.
 *
 * ## Warum ausserhalb des App-Layouts
 *
 * Weil es eine Vollbild-Geschichte ist und keine Unterseite. Seitenleiste,
 * Kopfzeile und Brotkrumen daneben wuerden aus einem Erlebnis eine
 * Ansichtsseite machen.
 *
 * ## Was hier gelesen wird - und was nicht
 *
 * Gelesen wird ausschliesslich die **eigene** Momentaufnahme. Es gibt
 * keinen Parameter, mit dem sich der Rueckblick einer anderen Person
 * oeffnen liesse; die Kennung kommt aus der Anmeldung, nicht aus der
 * Adresse. Wer die Zahlen anderer sehen will, findet hier nichts.
 *
 * ## Warum eingefrorene Daten und keine frische Rechnung
 *
 * Ein Rueckblick auf ein Jahr darf sich nicht aendern, waehrend man ihn
 * anschaut. Was in der Momentaufnahme steht, stand dort schon, als sie
 * geschrieben wurde - und es steht in vier Wochen noch genauso da.
 */
export default async function WrappedSeite({
  params,
}: {
  params: Promise<{ key: string }>;
}): Promise<React.JSX.Element> {
  const { key } = await params;
  /*
   * Auch der eigene Rueckblick haengt an einer Berechtigung.
   *
   * Nicht, weil jemand davor geschuetzt werden muesste, seine eigenen
   * Zahlen zu sehen, sondern weil das Team entscheiden koennen soll, ab
   * wann der Rueckblick fuer wen offen ist - etwa erst fuer verifizierte
   * Mitglieder. Die Vorlage «Mitglied» bringt das Recht mit.
   */
  const context = await requirePagePermission(wrapped.WRAPPED_PERMISSIONS.viewOwn);

  const [aktiv, guildId] = await Promise.all([isModuleEnabled(wrapped.WRAPPED_MODULE_ID), resolveGuildId()]);
  if (!aktiv) {
    notFound();
  }

  const campaign = await prisma.wrappedCampaign.findUnique({
    where: { guildId_key: { guildId, key } },
  });
  /*
   * Ein Entwurf ist fuer niemanden sichtbar - auch nicht fuer das Team.
   *
   * Wer im Studio etwas sehen will, benutzt die Vorschau. Diese Adresse
   * kennt nur einen Zustand: veroeffentlicht. Damit gibt es keinen Weg, auf
   * dem ein halbfertiger Rueckblick versehentlich in einem Chat landet.
   */
  if (!campaign || campaign.status !== 'PUBLISHED') {
    notFound();
  }

  const momentaufnahme = await prisma.wrappedSnapshot.findUnique({
    where: { campaignId_discordId: { campaignId: campaign.id, discordId: context.user.discordId } },
  });
  if (!momentaufnahme) {
    return <KeinRueckblick jahr={campaign.displayYear} />;
  }

  /*
   * Fortsetzen, wo es aufhoerte.
   *
   * Nur, wenn jemand nicht bis zum Ende gekommen ist: wer den Rueckblick
   * fertig gesehen hat, will ihn beim zweiten Mal von vorn - sonst laege er
   * sofort wieder auf dem Abspann.
   */
  const gesehen = await prisma.wrappedView.findUnique({
    where: { campaignId_discordId: { campaignId: campaign.id, discordId: context.user.discordId } },
    select: { lastSceneKey: true, completedAt: true },
  });
  const sceneKeys = momentaufnahme.sceneKeys;
  const fortsetzen =
    gesehen && !gesehen.completedAt && gesehen.lastSceneKey ? sceneKeys.indexOf(gesehen.lastSceneKey) : -1;

  const csrfToken = await csrfTokenFor(context);

  return (
    <WrappedAnsicht
      campaignId={campaign.id}
      schluessel={campaign.key}
      csrfToken={csrfToken}
      daten={momentaufnahme.data as unknown as WrappedDaten}
      sceneKeys={sceneKeys}
      jahr={campaign.displayYear}
      startIndex={fortsetzen > 0 ? fortsetzen : 0}
      teilenErlaubt={campaign.shareCardsEnabled}
      zurueckHref="/dashboard"
    />
  );
}

/**
 * Kein Rueckblick fuer diese Person.
 *
 * Der haeufigste Grund ist der freundlichste: sie war im Zeitraum kaum da.
 * Das soll auch so klingen - eine Fehlerseite waere hier eine Ohrfeige.
 */
function KeinRueckblick({ jahr }: { jahr: number }): React.JSX.Element {
  return (
    <main className="grid min-h-dvh place-items-center bg-[hsl(0_0%_4%)] px-6 text-center text-white">
      <div className="max-w-md space-y-4">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-white/40">
          SwissHub Wrapped {jahr}
        </p>
        <h1 className="text-balance text-3xl font-bold">Für dich gibt es diesmal keinen Rückblick.</h1>
        <p className="text-white/60">
          Dafür braucht es ein paar Tage im Jahr, an denen du da warst. Nächstes Jahr sieht das bestimmt
          anders aus.
        </p>
        <Link
          href="/dashboard"
          className="inline-flex rounded-full border border-white/20 px-5 py-2.5 text-sm font-medium transition hover:border-white/50"
        >
          Zurück
        </Link>
      </div>
    </main>
  );
}
