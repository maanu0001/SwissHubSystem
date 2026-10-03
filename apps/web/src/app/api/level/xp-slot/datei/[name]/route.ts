import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';
import { level } from '@swisshub/modules';
import { getActionAuthContext } from '@/server/auth';

/**
 * Liefert ein Symbolbild oder einen Klang des XP-Slots aus.
 *
 * ## Warum ein Route Handler und nicht `public/`
 *
 * Weil der Content-Type dann aus der Endung kaeme und das Verzeichnis
 * statisch bedient wuerde. Hier wird er **gesetzt** - aus dem Namen, den der
 * Server selbst erzeugt hat, nachdem er das Format an den echten Bytes
 * festgestellt hat. Eine hochgeladene Datei kann damit nie als HTML oder
 * Skript auf der eigenen Domain laufen; `nosniff` dazu.
 *
 * ## Warum Anmeldung, aber keine Spielberechtigung
 *
 * Angemeldet sein muss man: ohne Pruefung waere das hier ein oeffentlicher
 * Ablage-Endpunkt, und die Namen stehen im HTML der Spielseite. Die
 * Spielberechtigung wird bewusst **nicht** verlangt - ein Walzensymbol ist
 * kein Geheimnis, und die Seite laedt zwanzig Dateien, von denen jede sonst
 * eine Rollenauflosung kosten wuerde.
 *
 * ## Warum kein Range
 *
 * Die Klaenge sind wenige hundert Kilobyte und werden vollstaendig
 * vorgeladen; ein Walzenstopp wird nicht vorgespult. Fuer die
 * Hintergrundmusik gilt dasselbe - sie laeuft als Schleife von vorne.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BILD_TYP: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
): Promise<Response> {
  const context = await getActionAuthContext('cached');
  if (!context) {
    return new NextResponse(null, { status: 401 });
  }

  const { name } = await params;
  const S = level.xpslot;

  const klangFormat = S.klangFormat(name);
  const pfad = klangFormat ? S.klangPfad(name) : S.symbolbildPfad(name);
  if (!pfad) {
    // Ein Name, den diese Anwendung nie erzeugt hat. Kein Hinweis darauf,
    // woran es lag.
    return new NextResponse(null, { status: 404 });
  }

  const typ = klangFormat ? S.KLANG_CONTENT_TYPE[klangFormat] : BILD_TYP[name.split('.').pop() ?? ''];
  if (!typ) {
    return new NextResponse(null, { status: 404 });
  }

  const groesse = await stat(pfad)
    .then((eintrag) => eintrag.size)
    .catch(() => null);
  if (groesse === null) {
    return new NextResponse(null, { status: 404 });
  }

  return new NextResponse(Readable.toWeb(createReadStream(pfad)) as ReadableStream, {
    headers: {
      'Content-Type': typ,
      // Der Name ist zufaellig und der Inhalt aendert sich nie - eine neue
      // Datei hat einen neuen Namen. `immutable` ist hier buchstaeblich wahr.
      'Cache-Control': 'private, max-age=31536000, immutable',
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
      'Content-Length': String(groesse),
    },
  });
}
