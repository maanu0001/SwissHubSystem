import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { branding } from '@swisshub/config/client';
import { profile } from '@swisshub/modules';
import { ProfilAnsicht } from '@/modules/profile/components/profil-ansicht';
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
  return profile.ladeOeffentlichesProfil(slug);
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const oeffentlich = await lade(params);
  if (!oeffentlich) {
    // Auch die Metadaten verraten nichts: dieselbe Antwort wie die Seite.
    return { title: 'Profil nicht gefunden', robots: { index: false, follow: false } };
  }

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
  const oeffentlich = await lade(params);
  if (!oeffentlich) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <ProfilAnsicht ansicht={profile.alsAnsicht(oeffentlich)} />
      <div className="flex justify-center">
        <TeilenKnopf slug={oeffentlich.slug} name={oeffentlich.identitaet.name} variante="dezent" />
      </div>
    </div>
  );
}
