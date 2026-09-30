import { notFound, permanentRedirect } from 'next/navigation';
import { profile, streamer } from '@swisshub/modules';
import { systemRoutes } from '@swisshub/shared';

/**
 * Die alte Streamer-Profilseite - jetzt nur noch ein Wegweiser.
 *
 * ## Warum sie verschwindet
 *
 * Weil es zwei oeffentliche Profile derselben Person gab: `/u/<slug>` und
 * `/streamer/<slug>`. Zwei Adressen, zwei Gestaltungen, zwei Stellen, an denen
 * ein neues Feld erscheinen muss - und die erste Frage, die sich jemand
 * stellte, war, welche davon die richtige ist. Die Antwort ist jetzt eine:
 * `/u/<slug>`, mit einem Streaming-Abschnitt, der Kanaele, Live-Stand,
 * Sprachen, bis zu drei eigene Clips und die hervorgehobene Zeile traegt.
 *
 * ## Warum eine Weiterleitung und kein 404
 *
 * Weil die Adresse veroeffentlicht ist. Sie steht in Twitch-Bios, in
 * Discord-Nachrichten, in Spotlight-Beitraegen und moeglicherweise auf einem
 * gedruckten Flyer. Ein 404 waere fuer jeden dieser Verweise ein Bruch, und
 * zwar einer, von dem niemand erfaehrt.
 *
 * `permanentRedirect` (308): eine Suchmaschine soll das neue Ziel uebernehmen,
 * und ein Browser darf sich die Auskunft merken.
 *
 * ## Warum das Ziel aus der Datenbank kommt
 *
 * Der Slug aus der Adresse wird **nicht** weitergereicht. Nachgesehen wird, zu
 * welchem Mitglied er gehoert, und dessen Profiladresse ist das Ziel - ueber
 * `systemRoutes.oeffentlichesProfil`, das encodiert. Aus einem praeparierten
 * Slug kann damit keine Weiterleitung auf eine fremde Domain werden, und ein
 * zwischenzeitlich umbenanntes Profil landet am richtigen Ort statt in einer
 * Kette.
 */
export const dynamic = 'force-dynamic';

export default async function AlteStreamerSeite({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<never> {
  // Derselbe Schalter wie auf der Uebersicht: ist der oeffentliche Teil aus,
  // gibt es auch keinen Weg von hier nach dort.
  if (!(await streamer.oeffentlichErlaubt())) {
    notFound();
  }

  const { slug } = await params;
  const antwort = await profile.ladeOeffentlichesProfilOderSperre(slug);

  /*
   * Nur weiterleiten, wenn dort auch etwas steht.
   *
   * Ein gesperrtes oder nicht oeffentliches Profil bekaeme sonst eine
   * Weiterleitung auf eine Seite, die 404 antwortet - zwei Anfragen fuer
   * dieselbe Auskunft. Und dieselbe Antwort fuer «gibt es nicht», «nicht
   * freigegeben» und «gesperrt»: wer sie unterscheiden koennte, koennte
   * Adressen durchprobieren.
   */
  if (antwort.art === 'keines' || antwort.art === 'gesperrt') {
    notFound();
  }
  const ziel = antwort.art === 'umgezogen' ? antwort.slug : antwort.profil.slug;
  permanentRedirect(systemRoutes.oeffentlichesProfil(ziel));
}
