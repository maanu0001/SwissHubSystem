import { spielwahl } from '@swisshub/modules';
import { createLogger } from '@swisshub/logger';
import { resolveGuildId } from '@swisshub/discord';
import { getActionAuthContext } from '@/server/auth';
import { hoere, spielwahlThema } from '@/server/live-bus';

const log = createLogger('web:spielwahl-live');

/**
 * Der Live-Stand einer Spielauswahl.
 *
 * ## Warum Server-Sent Events
 *
 * Dieselbe Begruendung wie beim Turnier-Leitstand und beim Musikstrom: der
 * Strom laeuft nur in eine Richtung, Befehle gehen ueber die bestehenden
 * Aktionen. SSE ist gewoehnliches HTTP, der Browser verbindet von selbst
 * neu, und es braucht keinen zweiten Weg durch nginx.
 *
 * ## Was hier anders ist als beim Turnier
 *
 * Der Turnier-Leitstand fragt alle fuenf Sekunden nach. Hier weckt jede
 * Aenderung die offenen Stroeme sofort (siehe `live-bus.ts`); der
 * Datenbanktakt ist nur noch der Boden fuer Aenderungen, die aus einem
 * anderen Prozess kommen - etwa vom Bot.
 *
 * ## Reconnect
 *
 * Kein Sonderfall. Beim Verbinden geht der vollstaendige Stand hinaus, und
 * jede Nachricht traegt die Revision. Ein Browser, der fuenfzehn Sekunden
 * offline war, bekommt beim Wiederverbinden den aktuellen Stand und wirft
 * seinen alten weg - es gibt nichts nachzuholen.
 *
 * Die Revision fliesst auch als SSE-`id` mit. Der Browser schickt sie beim
 * Wiederverbinden als `Last-Event-ID`; damit laesst sich der erste
 * Schnappschuss sparen, wenn sich nichts geaendert hat.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Der Grundtakt. Nur der Boden - geweckt wird ereignisgesteuert. */
const TAKT_MS = 2_000;
/** Lebenszeichen gegen Proxys, die stille Verbindungen schliessen. */
const HERZSCHLAG_MS = 20_000;
/**
 * Nach dieser Zeit endet der Strom von selbst.
 *
 * Der Browser verbindet danach neu und wird dabei erneut geprueft: wer die
 * Session verlassen hat oder aus der Guild ausgetreten ist, ist spaetestens
 * dann draussen.
 */
const HOECHSTDAUER_MS = 30 * 60_000;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const context = await getActionAuthContext('cached');
  if (!context) {
    return new Response(null, { status: 401 });
  }

  const { id } = await params;
  if (!spielwahl.sessionIdSchema.safeParse(id).success) {
    return new Response(null, { status: 400 });
  }

  /*
   * Die Guild gehoert in die Abfrage.
   *
   * Eine Sessionkennung in der Adresszeile sagt nichts darueber aus, ob sie
   * den Anfragenden etwas angeht. Gelesen wird nur, was zur Guild gehoert, in
   * der er Mitglied ist.
   */
  const guildId = await resolveGuildId();
  const session = await spielwahl.finde(guildId, id);
  if (!session) {
    return new Response(null, { status: 404 });
  }

  const betrachter = context.user.discordId;
  const kodierer = new TextEncoder();
  const thema = spielwahlThema(id);

  const letzteBekannte = Number.parseInt(request.headers.get('last-event-id') ?? '', 10);

  const strom = new ReadableStream<Uint8Array>({
    async start(steuerung) {
      let offen = true;
      let gesendeteRevision = Number.isFinite(letzteBekannte) ? letzteBekannte : -1;
      let letzterHerzschlag = Date.now();
      let laeuft = false;
      const start = Date.now();

      const schliessen = (): void => {
        if (!offen) {
          return;
        }
        offen = false;
        clearInterval(uhr);
        abmelden();
        try {
          steuerung.close();
        } catch {
          // Der Browser war schneller - nichts zu tun.
        }
      };

      const senden = (ereignis: string, daten: unknown, id?: number): void => {
        if (!offen) {
          return;
        }
        try {
          const kopf = id === undefined ? '' : `id: ${id}\n`;
          steuerung.enqueue(kodierer.encode(`${kopf}event: ${ereignis}\ndata: ${JSON.stringify(daten)}\n\n`));
        } catch {
          schliessen();
        }
      };

      const pruefen = async (): Promise<void> => {
        if (!offen || laeuft) {
          return;
        }
        laeuft = true;
        try {
          if (Date.now() - start > HOECHSTDAUER_MS) {
            senden('neuverbinden', {});
            schliessen();
            return;
          }

          /*
           * Erst die faellige Runde abschliessen, dann lesen.
           *
           * `pruefe` ist wiederholbar und von mehreren Seiten aufrufbar -
           * jeder offene Strom tut es, der Bot tut es. Genau einer schliesst
           * die Runde tatsaechlich ab; damit endet eine Abstimmung auch
           * dann puenktlich, wenn der Host laengst das Fenster geschlossen
           * hat.
           */
          await spielwahl.pruefe(id);

          const revision = await spielwahl.revisionVon(id);
          if (revision === null) {
            schliessen();
            return;
          }

          if (revision !== gesendeteRevision) {
            const stand = await spielwahl.baueAnsicht(id, betrachter);
            if (!stand) {
              schliessen();
              return;
            }
            gesendeteRevision = stand.revision;
            letzterHerzschlag = Date.now();
            senden('stand', stand, stand.revision);
            return;
          }

          if (Date.now() - letzterHerzschlag > HERZSCHLAG_MS) {
            letzterHerzschlag = Date.now();
            // Ein Kommentar - der Browser sieht ihn nicht, der Proxy schon.
            steuerung.enqueue(kodierer.encode(': .\n\n'));
          }
        } catch (error) {
          log.warn('Live-Strom gestört', {
            sessionId: id,
            grund: error instanceof Error ? error.message : 'unbekannt',
          });
          schliessen();
        } finally {
          laeuft = false;
        }
      };

      const abmelden = hoere(thema, () => void pruefen());
      const uhr = setInterval(() => void pruefen(), TAKT_MS);
      request.signal.addEventListener('abort', schliessen);

      await pruefen();
    },
  });

  return new Response(strom, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}
