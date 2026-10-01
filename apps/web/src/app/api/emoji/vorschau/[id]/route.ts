import { NextResponse } from 'next/server';
import { prisma } from '@swisshub/database';
import { emoji, isModuleEnabled } from '@swisshub/modules';

/**
 * Das Vorschaubild eines Emoji-Vorschlags.
 *
 * ## Warum diese Route ohne Anmeldung auskommt
 *
 * Weil Discord das Bild holt. Der CDN lädt die Adresse aus dem Embed der
 * Moderationsmeldung, und er hat kein Konto - eine Route mit `requireMember()`
 * zeigte im Kanal des Teams deshalb nie etwas, nur einen leeren Rahmen.
 *
 * Statt der Anmeldung steht eine Signatur in der Adresse: ein HMAC über die
 * Kennung mit `AUTH_SECRET`. Ohne ihn geht nichts; mit ihm genau dieses eine
 * Bild. Die Kennung allein wäre zu wenig - eine cuid ist kein Geheimnis.
 *
 * Was dadurch offen liegt: ein Bild, das ein Mitglied eingereicht hat, für
 * jeden, der den vollständigen Link hat. Dieselbe Offenheit wie bei einem
 * Discord-Anhang - und von dort kommt es meistens.
 *
 * ## Warum trotzdem `nosniff` und ein fester Typ
 *
 * Weil die Bytes von aussen kommen. `pruefeBild` hat sie an ihren ersten Bytes
 * als Bild erkannt, aber der Browser soll nicht noch einmal raten dürfen: eine
 * Datei, die als Bild durchgeht und als Dokument gelesen wird, liefe im
 * Ursprung dieser Anwendung.
 *
 * ## Warum ein angenommener Vorschlag hier 404 liefert
 *
 * Weil seine Kopie aufgeräumt ist - die Bytes liegen bei Discord. Das ist kein
 * Fehler, sondern der gewünschte Zustand; das Embed verweist dann auch nicht
 * mehr hierher.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!(await isModuleEnabled(emoji.EMOJI_MODULE_ID))) {
    return new NextResponse(null, { status: 404 });
  }

  const { id } = await params;
  if (!/^c[a-z0-9]{20,30}$/u.test(id)) {
    return new NextResponse(null, { status: 404 });
  }

  const signatur = new URL(request.url).searchParams.get('s') ?? '';
  if (!emoji.vorschauSignaturGueltig(id, signatur)) {
    // 404 und nicht 403: ein anderer Code verriete, dass es den Vorschlag gibt.
    return new NextResponse(null, { status: 404 });
  }

  const antrag = await prisma.emojiAntrag.findUnique({
    where: { id },
    select: { id: true, dateiName: true, mimeTyp: true },
  });
  if (!antrag) {
    return new NextResponse(null, { status: 404 });
  }

  const bytes = await emoji.liesAb(antrag.id, antrag.dateiName);
  if (!bytes) {
    return new NextResponse(null, { status: 404 });
  }

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'content-type': antrag.mimeTyp,
      'content-length': String(bytes.byteLength),
      'x-content-type-options': 'nosniff',
      /*
       * Kurz zwischenspeichern, nicht lange.
       *
       * Discord holt das Bild einmal und behält es; ein Browser im Dashboard
       * lädt es bei jedem Neuzeichnen. Fünf Minuten sparen die Wiederholungen
       * und halten den Fall klein, dass ein aufgeräumter Vorschlag noch
       * irgendwo angezeigt wird.
       */
      'cache-control': 'private, max-age=300',
    },
  });
}
