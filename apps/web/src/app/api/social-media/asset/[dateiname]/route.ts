import { NextResponse } from 'next/server';
import { can } from '@swisshub/auth';
import { branding, socialmedia } from '@swisshub/modules';
import { getActionAuthContext } from '@/server/auth';

/**
 * Ein hochgeladenes Postbild - fuer die kleinen Vorschauen im Editor.
 *
 * ## Warum eine eigene Route und nicht `public/`
 *
 * Weil das Upload-Verzeichnis ausserhalb des statisch bedienten Bereichs
 * liegt und liegen soll. Der Content-Type wird hier **fest gesetzt** und
 * nicht aus der Datei abgeleitet; mit `nosniff` dazu kann eine hochgeladene
 * Datei niemals als HTML oder Skript ausgeliefert werden - dasselbe Verfahren
 * wie bei `/api/branding/logo` und den Workspace-Anhaengen.
 *
 * ## Warum nicht oeffentlich
 *
 * Anders als das Serverlogo ist ein Postmotiv nichts, was schon draussen ist:
 * es kann der Entwurf einer Ankuendigung sein, die noch nicht angekuendigt
 * wurde. Deshalb dasselbe Recht wie die Bibliothek.
 *
 * Der Dateiname wird nicht geprueft, **bereinigt** oder zusammengesetzt -
 * `readUpload` prueft ihn gegen die Namen, die das System selbst erzeugt, und
 * haelt den aufgeloesten Pfad im Upload-Verzeichnis. `../` kann damit nicht
 * ausbrechen; es gibt keinen Weg, auf dem es es koennte.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ dateiname: string }> },
): Promise<Response> {
  const context = await getActionAuthContext('cached');
  if (!context?.isMember) {
    return new NextResponse(null, { status: 401 });
  }
  if (!can(context, socialmedia.SOCIAL_MEDIA_PERMISSIONS.postView)) {
    return new NextResponse(null, { status: 403 });
  }

  const { dateiname } = await params;
  const datei = await branding.readUpload(dateiname);
  if (!datei) {
    return new NextResponse(null, { status: 404 });
  }

  return new NextResponse(new Uint8Array(datei.data), {
    headers: {
      'Content-Type': branding.CONTENT_TYPE[datei.format],
      // Ein neuer Upload bekommt einen neuen Namen, also eine neue Adresse -
      // lange Cachezeiten brauchen hier kein Cache-Busting.
      'Cache-Control': 'private, max-age=31536000, immutable',
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
