import { NextResponse } from 'next/server';
import { can } from '@swisshub/auth';
import { moderation, profile } from '@swisshub/modules';
import { csrfTokenFor, getOptionalAuthContext } from '@/server/auth';

/**
 * Die Kommentare eines oeffentlichen Profils - fuer den Browser.
 *
 * ## Warum das nicht auf der Seite selbst gerendert wird
 *
 * Die Profilseite hat `revalidate = 60`: sie wird einmal gebaut und danach
 * eine Minute lang aus dem Zwischenspeicher ausgeliefert. Das ist der ganze
 * Sinn der Seite - ein geteilter Link wird oft geoeffnet, und jedes Mal das
 * vollstaendige Profil neu zusammenzustellen waere Verschwendung.
 *
 * Die Kommentare passen nicht in diesen Zwischenspeicher, und zwar aus einem
 * Grund, der sich nicht umgehen laesst: **sie sehen fuer jeden Besucher
 * anders aus.** Neben dem eigenen Kommentar steht ein Loeschknopf, neben
 * einem fremden nicht, und die Moderation sieht ihn ueberall. Eine Seite, die
 * das mitspeichert, zeigt dem naechsten Besucher die Knoepfe des vorigen.
 *
 * Die Seite auf `dynamic` umzustellen waere die andere Loesung gewesen - und
 * haette den Zwischenspeicher des ganzen Profils fuer einen Abschnitt am Fuss
 * geopfert. Deshalb dieser Weg: das Profil bleibt gespeichert, die Kommentare
 * kommen frisch.
 *
 * ## Warum hier ein CSRF-Token herausgegeben wird
 *
 * Er ist kein Geheimnis gegenueber seinem Besitzer: dieselbe Person bekommt
 * ihn auf jeder angemeldeten Seite als Prop. Er haengt an ihrer Sitzung und
 * ist fuer eine fremde wertlos. Lesen kann ihn nur, wer das Cookie
 * mitschickt - und eine fremde Seite kann die Antwort nicht lesen, weil
 * dieser Endpunkt keine fremde Herkunft zulaesst.
 *
 * ## Warum `kommentare/[slug]` und nicht `[slug]/kommentare`
 *
 * Unter `/api/profil` liegt schon `[discordId]`. Zwei verschieden benannte
 * dynamische Geschwister auf derselben Ebene nimmt Next.js nicht an - es
 * bricht beim Start ab: «You cannot use different slug names for the same
 * dynamic path». Also eine Ebene tiefer, hinter einem festen Segment. Genau
 * so liegen `qr/[slug]` und `gamer-card/[slug]` daneben.
 *
 * ## Warum dieselbe Pruefung wie die Seite
 *
 * `discordIdZuSlug` loest die Adresse unter denselben Regeln auf:
 * veroeffentlicht, nicht gesperrt. Ein privates oder gesperrtes Profil gibt
 * hier so wenig her wie unter `/u/<slug>` - sonst waere dieser Endpunkt der
 * Umweg um die Sperre.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;

  const profilDiscordId = await profile.discordIdZuSlug(slug);
  if (!profilDiscordId) {
    return NextResponse.json({ fehler: 'Unbekannt' }, { status: 404 });
  }

  const kontext = await getOptionalAuthContext();
  /*
   * Angemeldet heisst hier: angemeldet **und** Mitglied.
   *
   * Eine Server Action verlangt die Mitgliedschaft ohnehin. Wer sie nicht
   * hat, bekaeme sonst ein Formular, das beim Abschicken scheitert - und
   * haette keine Erklaerung dafuer.
   *
   * Waehrend einer Vorschau ist alles Schreibende gesperrt; kein Formular
   * also, statt eines, das dieselbe Sperre erst am Ende meldet.
   */
  const schreibend = kontext !== null && kontext.isMember && !kontext.preview;

  const kommentare = await profile.ladeKommentare(profilDiscordId, {
    discordId: schreibend ? kontext.user.discordId : null,
    darfModerieren: schreibend ? can(kontext, moderation.MODERATION_PERMISSIONS.profileLock) : false,
  });

  return NextResponse.json(
    {
      csrfToken: schreibend ? csrfTokenFor(kontext) : null,
      kommentare: kommentare.map((kommentar) => ({
        id: kommentar.id,
        autorDiscordId: kommentar.autorDiscordId,
        autorName: kommentar.autorName,
        text: kommentar.text,
        geschriebenAm: kommentar.geschriebenAm.toISOString(),
        loeschbar: kommentar.loeschbar,
      })),
    },
    /*
     * Niemals zwischenspeichern.
     *
     * Die Antwort enthaelt die Loeschrechte des Fragenden und seinen
     * CSRF-Token. Ein Zwischenspeicher davor - im Browser, in einem Proxy -
     * reichte beides an den naechsten weiter.
     */
    { headers: { 'Cache-Control': 'no-store, private' } },
  );
}
