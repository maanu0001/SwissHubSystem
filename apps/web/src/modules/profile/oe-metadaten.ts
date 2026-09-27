import type { Metadata } from 'next';
import { branding } from '@swisshub/config/client';
import type { profile } from '@swisshub/modules';

/**
 * Die Metadaten einer oeffentlichen Profilseite.
 *
 * ## Warum das nicht in `page.tsx` steht
 *
 * Damit es pruefbar ist. Die Seite selbst zieht die Oberflaeche nach - den
 * Teilen-Knopf, die Buehne, den Streaming-Abschnitt - und die brauchen einen
 * Browser. Ein Test, der sie laedt, laedt damit `document` und `navigator`
 * mit; im gemeinsamen TypeScript-Projekt gibt es die nicht, und der Typecheck
 * der Pakete und des Bots faellt an einer Datei aus, die nichts damit zu tun
 * hat.
 *
 * Hier steht nur, was auch ohne Browser gilt: aus einer Antwort des Dienstes
 * wird ein Metadatenobjekt. Genau das prueft
 * `tests/integration/profil-2-metadaten.test.ts` - und das ist der Teil, auf
 * den es ankommt, denn Metadaten gehen nach aussen, **ohne** dass jemand die
 * Seite oeffnet.
 *
 * ## Vier Antworten, vier Ausgaben
 *
 * Gesperrt, umgezogen, nicht vorhanden, vorhanden. Die ersten drei geben
 * bewusst nichts her - eine Vorschau, die mehr zeigt als die Seite, waere die
 * bequemste Luecke des ganzen Moduls.
 */
export function profilMetadaten(antwort: profile.OeffentlicheAntwort): Metadata {
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
  if (antwort.art === 'umgezogen') {
    /*
     * Die Seite leitet gleich weiter - hier stehen deshalb keine Inhalte.
     * `noindex` ist dabei kein Widerspruch zur Weiterleitung: Next liefert fuer
     * die alte Adresse ohnehin eine 308, und eine Suchmaschine soll den alten
     * Slug nicht als eigene Seite fuehren.
     */
    return { title: 'Profil umgezogen', robots: { index: false, follow: true } };
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

  /*
   * Die Vorschaukarte mit einem Stand in der Adresse.
   *
   * Discord, WhatsApp und Telegram behalten ein Vorschaubild lange - manche
   * Tage. Gegen ihren Zwischenspeicher hilft kein `Cache-Control`, sondern nur
   * eine andere Adresse. `v` ist deshalb ein Kuerzel aus dem, was die Karte
   * zeigt: Theme, Name, Level, erstes Spiel. Aendert sich davon etwas, ist es
   * eine neue Adresse - und die Vorschau wird neu geholt.
   *
   * Ein Zeitstempel waere die naheliegende Alternative und die schlechtere: er
   * aendert sich bei jedem Aufruf, und dann rastert jeder Crawler jedes Mal neu.
   */
  const stand = kartenStand(oeffentlich);

  return {
    title: titel,
    description: beschreibung,
    alternates: { canonical: pfad },
    /*
     * `noindex` fuer ein Profil, das nicht indexiert werden will.
     *
     * **Kein Zugriffsschutz** - der Link funktioniert weiterhin fuer jeden, der
     * ihn hat, und die Einstellung sagt das auch so. `follow` bleibt an: die
     * Links des Mitglieds sollen weiterhin zaehlen, es geht nur darum, dass
     * diese Seite nicht in einer Suchmaschine steht.
     */
    robots: oeffentlich.indexierbar ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: {
      title: titel,
      description: beschreibung,
      url: pfad,
      type: 'profile',
      siteName: branding.name,
      locale: 'de_CH',
      images: [{ url: `${pfad}/karte?v=${stand}`, width: 1200, height: 630, alt: titel }],
    },
    twitter: {
      card: 'summary_large_image',
      title: titel,
      description: beschreibung,
      images: [`${pfad}/karte?v=${stand}`],
    },
  };
}

/**
 * Ein kurzes Kuerzel aus dem, was auf der Vorschaukarte steht.
 *
 * Nur aus **oeffentlichen** Feldern - das ist die Bedingung. Ein Kuerzel, das
 * ein verborgenes Feld einbezieht, wuerde sich aendern, wenn jemand etwas
 * Privates aendert, und waere damit ein Kanal, ueber den sich von aussen
 * beobachten laesst, dass es das gibt.
 *
 * Kein Hash: eine kurze, lesbare Zeichenfolge reicht, um eine Adresse von der
 * vorigen zu unterscheiden. Sie muss nicht geheim und nicht kollisionsfrei sein.
 */
function kartenStand(profil: profile.OeffentlichesProfil): string {
  const teile = [
    profil.gestaltung.theme,
    profil.identitaet.avatarHash ?? '0',
    profil.identitaet.profilname ?? profil.identitaet.name,
    profil.level ? String(profil.level.level) : '0',
    profil.spiele?.[0]?.name ?? '',
    profil.angaben?.tagline ?? '',
  ].join('|');

  // Ein einfacher Streuwert - deterministisch und kurz. Nicht kryptografisch,
  // und er muss es nicht sein: er unterscheidet Adressen, er schuetzt nichts.
  let wert = 0;
  for (const zeichen of teile) {
    wert = (wert * 31 + zeichen.codePointAt(0)!) % 0xffffffff;
  }
  return wert.toString(36);
}
