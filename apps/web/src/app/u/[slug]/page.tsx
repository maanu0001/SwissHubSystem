import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { branding } from '@swisshub/config/client';
import Link from 'next/link';
import { ShieldOff } from 'lucide-react';
import { profile, streamer } from '@swisshub/modules';
import { systemRoutes } from '@swisshub/shared';
import { OeffentlicheProfilseite } from '@/modules/profile/components/oeffentlich/oe-seite';
import { TeilenKnopf } from '@/modules/profile/components/teilen-knopf';
import { ProfilStreamingAbschnitt } from '@/modules/streamer/components/profil-streaming';
import { profilMetadaten } from '@/modules/profile/oe-metadaten';

/**
 * Das oeffentliche Profil.
 *
 * ## Warum hier kein `requireMember()` steht
 *
 * Weil es das nicht darf. Die Seite liegt ausserhalb von `(app)`, und das
 * ist der ganze Zweck: ein geteilter Link soll fuer jeden funktionieren.
 *
 * ## Was diese Seite nicht entscheidet
 *
 * Sie entscheidet nichts ueber Sichtbarkeit. `ladeOeffentlichesProfil`
 * liefert entweder ein Profil, das seine Besitzerin oeffentlich gestellt
 * hat, oder `null` - und was darin steht, hat der Dienst anhand der
 * Abschnittseinstellungen zusammengestellt. Hier etwas auszublenden waere
 * zu spaet; die Daten waeren dann schon im HTML.
 *
 * ## Warum jeder Fehlschlag gleich aussieht
 *
 * Unbekannte Adresse, Mitglied nicht mehr da, Profil nicht oeffentlich:
 * dreimal dieselbe 404. Wer die drei unterscheiden koennte, koennte
 * Adressen durchprobieren und erfahren, wer ein Profil hat, das er nicht
 * zeigt. Diese Auskunft gehoert niemandem ausser der Person selbst.
 */

/** Ohne Zwischenspeicher waere eine Profilaenderung stundenlang unsichtbar. */
export const revalidate = 60;

async function lade(params: Promise<{ slug: string }>) {
  const { slug } = await params;
  return profile.ladeOeffentlichesProfilOderSperre(slug);
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  return profilMetadaten(await lade(params));
}

export default async function OeffentlichesProfilPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<React.JSX.Element> {
  const antwort = await lade(params);
  if (antwort.art === 'gesperrt') {
    return <Gesperrt />;
  }
  if (antwort.art === 'umgezogen') {
    /*
     * Die Adresse hat sich geaendert, die Person ist dieselbe.
     *
     * `permanentRedirect` (308) und nicht 302: der alte Link steht in Bios und
     * auf gedruckten Karten, und eine Suchmaschine soll den neuen uebernehmen.
     *
     * Das Ziel kommt aus **unserer** Datenbank und wird hier encodiert - nicht
     * aus der Adresse. Damit kann aus einem praeparierten Slug keine
     * Weiterleitung auf eine fremde Domain werden.
     */
    permanentRedirect(systemRoutes.oeffentlichesProfil(antwort.slug));
  }
  if (antwort.art === 'keines') {
    notFound();
  }
  const oeffentlich = antwort.profil;

  /*
   * Streaming kommt erst hier dazu, nicht in `ladeOeffentlichesProfil`.
   *
   * Das Profilmodul soll nicht wissen, dass es einen Streamer Hub gibt - und
   * der Dienst entscheidet selbst, wem er antwortet: nur einem freigegebenen
   * Streamer mit aktivem Kanal, sonst `null`. Die Abschnittseinstellungen des
   * Profils gelten hier nicht, weil diese Daten nicht aus dem Profil kommen;
   * sie sind auf `/streamer` ohnehin oeffentlich.
   */
  const streaming = await streamer.ladeProfilStreaming(oeffentlich.identitaet.discordId, oeffentlich.slug);

  return (
    <>
      <OeffentlicheProfilseite
        profil={oeffentlich}
        streaming={streaming ? <ProfilStreamingAbschnitt streaming={streaming} verzug={80} /> : undefined}
      />
      <div className="mt-8 flex justify-center">
        <TeilenKnopf slug={oeffentlich.slug} variante="dezent" />
      </div>
    </>
  );
}

/**
 * Die Seite, die ein Besucher bei einer Sperre sieht.
 *
 * ## Was hier bewusst nicht steht
 *
 * Kein Name, kein Datum, kein Grund. Der Grund der Moderation ist eine
 * interne Angabe; er steht in der Akte und geht niemanden sonst etwas an -
 * schon gar nicht jemanden, der zufaellig einem geteilten Link gefolgt ist.
 *
 * Und kein Hinweis darauf, dass hier moderiert wurde. «Derzeit nicht
 * oeffentlich verfuegbar» deckt beides ab: eine Sperre und eine Seite, die
 * gerade umgestellt wird. Ein «wurde gesperrt» waere eine Anschuldigung,
 * die auf einer Seite steht, die jeder aufrufen kann.
 */
function Gesperrt(): React.JSX.Element {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 px-6 text-center">
      <ShieldOff className="size-10 text-muted-foreground" aria-hidden="true" />
      <h1 className="text-xl font-semibold">Dieses Profil ist derzeit nicht öffentlich verfügbar.</h1>
      <p className="max-w-md text-sm text-muted-foreground">Schau später noch einmal vorbei.</p>
      <Link
        href="/"
        className="mt-2 inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm transition-colors hover:border-foreground/30"
      >
        Zu {branding.name}
      </Link>
    </div>
  );
}
