import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { branding } from '@swisshub/config/client';
import Link from 'next/link';
import { ShieldOff } from 'lucide-react';
import { profile } from '@swisshub/modules';
import { OeffentlicheProfilseite } from '@/modules/profile/components/oeffentlich/oe-seite';
import { TeilenKnopf } from '@/modules/profile/components/teilen-knopf';

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
  const antwort = await lade(params);
  if (antwort.art === 'gesperrt') {
    /*
     * Kein Name, keine Beschreibung, kein Vorschaubild.
     *
     * Die Metadaten sind der Teil, der nach aussen geht, ohne dass jemand
     * die Seite oeffnet - in eine Discord-Nachricht, in eine Suchmaschine,
     * in eine Vorschau. Waeren sie hier vollstaendig, waere die Sperre
     * genau dort wirkungslos, wo das Profil am weitesten reist.
     */
    return {
      title: 'Profil nicht verfügbar',
      robots: { index: false, follow: false },
    };
  }
  if (antwort.art === 'keines') {
    // Auch die Metadaten verraten nichts: dieselbe Antwort wie die Seite.
    return { title: 'Profil nicht gefunden', robots: { index: false, follow: false } };
  }
  const oeffentlich = antwort.profil;

  const name = oeffentlich.identitaet.profilname ?? oeffentlich.identitaet.name;
  const titel = `${name} · ${branding.name}`;
  const beschreibung =
    oeffentlich.angaben?.tagline ??
    oeffentlich.angaben?.bio?.slice(0, 160) ??
    `Das ${branding.name}-Profil von ${name}.`;
  const pfad = `/u/${oeffentlich.slug}`;

  return {
    title: titel,
    description: beschreibung,
    alternates: { canonical: pfad },
    openGraph: {
      title: titel,
      description: beschreibung,
      url: pfad,
      type: 'profile',
      images: [{ url: `${pfad}/karte`, width: 1200, height: 630, alt: titel }],
    },
    twitter: {
      card: 'summary_large_image',
      title: titel,
      description: beschreibung,
      images: [`${pfad}/karte`],
    },
  };
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
  if (antwort.art === 'keines') {
    notFound();
  }
  const oeffentlich = antwort.profil;

  return (
    <>
      <OeffentlicheProfilseite profil={oeffentlich} />
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
