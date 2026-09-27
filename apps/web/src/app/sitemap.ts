import type { MetadataRoute } from 'next';
import { appUrl } from '@swisshub/config';
import { profile } from '@swisshub/modules';

/**
 * Die Sitemap.
 *
 * ## Die eine Regel
 *
 * **Hier steht nur, was ausdruecklich oeffentlich und indexierbar ist.** Ein
 * Profil auf «nicht indexiert» gehoert nicht in eine Sitemap - eine Sitemap ist
 * eine Einladung an Suchmaschinen, und `noindex` im Kopf der Seite und eine
 * Einladung hier waeren zwei widerspruechliche Anweisungen.
 *
 * Ebenso draussen: privates Profil, von der Moderation gesperrt, kein Slug.
 * Die Abfrage unten nennt alle vier Bedingungen, und sie steht **in der
 * Datenbank** und nicht in einem Filter danach - eine Liste, die erst gebaut
 * und dann gesiebt wird, ist eine Liste, die einmal vollstaendig existiert hat.
 *
 * ## Warum ohne Obergrenze, aber mit Deckel
 *
 * Eine Sitemap darf 50 000 Eintraege haben. Sollte SwissHub das je erreichen,
 * braucht es eine Sitemap-Index-Datei - bis dahin waere sie Aufwand fuer einen
 * Fall, den es nicht gibt. Der Deckel steht trotzdem hier, damit die Route bei
 * einem unerwarteten Datenstand nicht minutenlang antwortet.
 */
/**
 * Nicht beim Bauen erzeugen, sondern beim Abruf.
 *
 * Diese Route fragt die Datenbank. Next erzeugt Metadaten-Routen ohne diese
 * Zeile **beim Build** vorab - im Docker-Build gibt es dort keine Datenbank,
 * und `next build` bricht ab. In der Pipeline gibt es eine, und das waere der
 * unangenehmere Fall: die Sitemap waere dann der Datenstand des Build-Zeitpunkts,
 * ausgeliefert mit der Adresse der Wegwerf-Umgebung, und zwar dauerhaft.
 *
 * Eine Sitemap muss aktuell sein - ein Profil, das heute oeffentlich wird, soll
 * heute darin stehen. Sie wird selten abgerufen, und die Abfrage dahinter ist
 * eine einzige mit Obergrenze.
 */
export const dynamic = 'force-dynamic';

/** Die Grenze eines einzelnen Sitemap-Dokuments nach der Spezifikation. */
const MAX_EINTRAEGE = 50_000;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const profile_ = await profile.indexierbareProfile(MAX_EINTRAEGE);

  return [
    {
      url: appUrl('/'),
      changeFrequency: 'weekly',
      priority: 1,
    },
    ...profile_.map((eintrag) => ({
      url: appUrl(`/u/${encodeURIComponent(eintrag.slug)}`),
      lastModified: eintrag.geaendertAm,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })),
  ];
}
