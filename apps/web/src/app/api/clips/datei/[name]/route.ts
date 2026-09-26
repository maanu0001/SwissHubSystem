import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { clips } from '@swisshub/modules';
import { getActionAuthContext } from '@/server/auth';

/**
 * Liefert eine hochgeladene Clipdatei aus.
 *
 * ## Warum nicht aus `public/`
 *
 * Weil der Content-Type dann aus der Endung käme und das Verzeichnis statisch
 * bedient würde. Hier wird er **gesetzt** - aus dem Container, den der
 * Dateiname trägt und den `speichereVideo` an den echten Bytes festgestellt
 * hat. Eine hochgeladene Datei kann damit nie als HTML oder Skript auf der
 * eigenen Domain laufen, selbst wenn die Erkennung eines Tages irrt:
 * `nosniff` dazu, und der Browser hält sich an `video/mp4`.
 *
 * ## Warum Anmeldung
 *
 * Weil die Clips im angemeldeten Bereich stehen. Ohne Prüfung wäre das hier
 * ein öffentlicher Ablage-Endpunkt: wer einen Namen kennt, lädt beliebig oft -
 * und die Namen stehen im HTML jeder Clipseite. Der Zufall im Namen ist ein
 * Schutz gegen Raten, kein Ersatz für eine Zugangsprüfung.
 *
 * Bewusst **ohne** Abfrage, ob der Clip noch freigegeben ist: ein Player
 * stellt für ein Video Dutzende Range-Anfragen, und jede würde eine
 * Datenbankabfrage kosten. Die Sichtbarkeit entscheidet die Seite, die den
 * Clip überhaupt zeigt; und ein entfernter Clip verliert seine Datei - danach
 * antwortet diese Route 404, ohne etwas gefragt zu haben.
 *
 * ## Warum Range
 *
 * Ohne `Range` lädt ein `<video>` die Datei von vorne bis zur gesuchten
 * Stelle - bei 100 MB heisst Vorspulen dann: alles laden. Safari verlangt
 * `206` sogar, um überhaupt abzuspielen. Und die Datei wird **gestreamt**,
 * nicht gelesen: `readFile` auf 100 MB wären 100 MB im Arbeitsspeicher je
 * Zuschauer.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Header, die jede Antwort dieser Route trägt. */
function kopf(container: 'mp4' | 'webm'): Record<string, string> {
  return {
    'Content-Type': clips.VIDEO_CONTENT_TYPE[container],
    // Der Name ist zufällig und der Inhalt ändert sich nie - eine neue Datei
    // hat einen neuen Namen. `immutable` ist hier buchstäblich wahr.
    'Cache-Control': 'private, max-age=31536000, immutable',
    'Content-Disposition': 'inline',
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'bytes',
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
): Promise<Response> {
  const context = await getActionAuthContext('cached');
  if (!context) {
    return new Response(null, { status: 401 });
  }

  const { name } = await params;
  const container = clips.videoContainer(name);
  const pfad = clips.videoPfad(name);
  if (!container || !pfad) {
    // Ein Name, den diese Anwendung nie erzeugt hat. Kein Hinweis darauf,
    // woran es lag.
    return new Response(null, { status: 404 });
  }

  const groesse = await clips.videoGroesse(name);
  if (groesse === null) {
    return new Response(null, { status: 404 });
  }

  const range = request.headers.get('range');
  if (!range) {
    return new Response(Readable.toWeb(createReadStream(pfad)) as ReadableStream, {
      headers: { ...kopf(container), 'Content-Length': String(groesse) },
    });
  }

  /*
   * Nur die Form, die Browser wirklich schicken: `bytes=<von>-<bis>`, `bis`
   * optional. Mehrere Bereiche in einer Anfrage wären eine
   * `multipart/byteranges`-Antwort; kein Player braucht das für ein Video,
   * und eine halb richtige Implementierung wäre schlechter als keine.
   */
  const treffer = /^bytes=(\d*)-(\d*)$/u.exec(range.trim());
  if (!treffer) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${groesse}` } });
  }

  const [, vonRoh = '', bisRoh = ''] = treffer;
  let von = vonRoh === '' ? 0 : Number(vonRoh);
  let bis = bisRoh === '' ? groesse - 1 : Number(bisRoh);

  // `bytes=-500`: die letzten 500 Bytes. Manche Player holen so den Index
  // eines MP4, dessen `moov`-Box am Ende steht.
  if (vonRoh === '' && bisRoh !== '') {
    von = Math.max(0, groesse - Number(bisRoh));
    bis = groesse - 1;
  }

  if (!Number.isFinite(von) || !Number.isFinite(bis) || von > bis || von >= groesse) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${groesse}` } });
  }
  bis = Math.min(bis, groesse - 1);

  return new Response(Readable.toWeb(createReadStream(pfad, { start: von, end: bis })) as ReadableStream, {
    status: 206,
    headers: {
      ...kopf(container),
      'Content-Length': String(bis - von + 1),
      'Content-Range': `bytes ${von}-${bis}/${groesse}`,
    },
  });
}
