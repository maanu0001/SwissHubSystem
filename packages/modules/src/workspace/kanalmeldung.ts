import { prisma } from '@swisshub/database';
import { discord } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { appUrl } from '@swisshub/config';
import { ereignisart, istEreignis } from './ereignisse';

const log = createLogger('workspace:kanal');

/**
 * Was im Kanal eines Projekts landet.
 *
 * ## Warum je Projekt und nicht je Modul
 *
 * Weil ein Workspace mit zwölf Projekten in einem einzigen Kanal ein Kanal
 * ist, den niemand liest. Das Projekt «Turnier Herbst» interessiert die Leute,
 * die daran arbeiten - und die sitzen in ihrem Kanal. Ohne Kanal am Projekt
 * passiert nichts: eine Meldung in einen Kanal, den niemand gewaehlt hat,
 * waere eine Entscheidung, die niemand getroffen hat.
 *
 * ## Drei Riegel, bevor etwas gesendet wird
 *
 * 1. Ein Kanal muss eingetragen sein.
 * 2. Der Hauptschalter muss an sein.
 * 3. Die Ereignisart muss in der Auswahl des Projekts stehen.
 *
 * Alle drei gehoeren hierher und nicht an die Aufrufstellen: sonst prueft die
 * eine Stelle zwei davon, die naechste eine, und die dritte gar keine.
 *
 * ## Warum das nichts abbricht
 *
 * Ein Kanal kann geloescht, umbenannt oder dem Bot entzogen worden sein. Dass
 * eine Aufgabe nicht entsteht, weil die Benachrichtigung darueber nicht
 * durchkam, waere der falsche Handel - das Projekt ist das Wesentliche, die
 * Meldung die Beigabe. Fehlschlaege stehen im Protokoll **und** am Projekt,
 * damit sie jemand sieht, ohne im Serverlog zu suchen.
 *
 * ## Warum nie ein Ping
 *
 * `allowedMentions: { parse: [] }` bei jeder Nachricht. Ein Titel wie
 * «@everyone fragen» loeste sonst genau das aus - der Text kommt aus einem
 * Formular, und was darin steht, entscheidet nicht ueber Benachrichtigungen
 * eines ganzen Servers.
 */

/** Die Farbe, wenn eine Ereignisart keine eigene hat. */
const FARBE = 0xe02630;

export interface Meldung {
  /** Die Ereignisart aus `WORKSPACE_EREIGNISSE`. */
  ereignis: string;
  titel: string;
  beschreibung?: string | null;
  felder?: Array<{ name: string; value: string }>;
  /** Wohin der Knopf fuehrt - eine Adresse in der WebApp. */
  pfad?: string;
  /**
   * Wer es ausgeloest hat. Als Erwaehnung gerendert, aber ohne zu pingen:
   * `<@id>` zeigt den Namen, `allowedMentions` verhindert die Benachrichtigung.
   */
  akteurDiscordId?: string | null;
}

/**
 * Der Dublettenschutz.
 *
 * Wer eine Aufgabe dreimal hintereinander auf «in Arbeit» und zurueck zieht,
 * soll nicht dreimal denselben Satz im Kanal erzeugen. Gemerkt wird je
 * Kanal, Ereignis und Aufgabe der Zeitpunkt der letzten Meldung; innerhalb
 * des Fensters faellt die zweite weg.
 *
 * Bewusst im Prozessspeicher und nicht in der Datenbank: es geht um Sekunden,
 * nicht um Tage, und eine Tabelle dafuer waere Buchhaltung ueber etwas, das
 * nach einer Minute niemanden mehr interessiert. Nach einem Neustart ist die
 * Karte leer - dann kommt eine Meldung einmal zu viel, und das ist der
 * guenstigere Fehler.
 */
const FENSTER_MS = 20_000;
const zuletzt = new Map<string, number>();

function istDublette(schluessel: string, jetzt: number): boolean {
  const vorher = zuletzt.get(schluessel);
  if (vorher !== undefined && jetzt - vorher < FENSTER_MS) {
    return true;
  }
  zuletzt.set(schluessel, jetzt);
  // Die Karte waechst sonst mit jeder Aufgabe, die es je gab.
  if (zuletzt.size > 500) {
    for (const [key, zeit] of zuletzt) {
      if (jetzt - zeit > FENSTER_MS) {
        zuletzt.delete(key);
      }
    }
  }
  return false;
}

/** Nur fuer Tests: den Dublettenschutz zuruecksetzen. */
export function vergissMeldungen(): void {
  zuletzt.clear();
}

/**
 * Eine Meldung in den Kanal des Projekts - oder gar nichts.
 *
 * `projectId` darf `null` sein: eine Aufgabe ohne Projekt hat keinen Kanal,
 * und das ist kein Fehlerfall, sondern der zweite Normalfall.
 */
export async function meldeImProjektkanal(
  projectId: string | null | undefined,
  meldung: Meldung,
): Promise<void> {
  if (!projectId || !istEreignis(meldung.ereignis)) {
    return;
  }
  const projekt = await prisma.workspaceProject
    .findUnique({
      where: { id: projectId },
      select: { title: true, discordChannelId: true, discordUpdates: true, discordEvents: true },
    })
    .catch(() => null);
  if (!projekt?.discordChannelId || !projekt.discordUpdates) {
    return;
  }
  if (!projekt.discordEvents.includes(meldung.ereignis)) {
    return;
  }

  const jetzt = Date.now();
  if (istDublette(`${projekt.discordChannelId}:${meldung.ereignis}:${meldung.pfad ?? ''}`, jetzt)) {
    return;
  }

  const art = ereignisart(meldung.ereignis);
  const felder = [
    ...(meldung.felder ?? []),
    ...(meldung.akteurDiscordId ? [{ name: 'Von', value: `<@${meldung.akteurDiscordId}>` as string }] : []),
  ];

  try {
    await discord.channels.send(projekt.discordChannelId, {
      embeds: [
        {
          color: art?.farbe ?? FARBE,
          // Die Ereignisart steht als Autor ueber dem Titel - man sieht
          // «Aufgabe abgeschlossen», bevor man den Aufgabennamen liest.
          author: { name: art?.label ?? 'Workspace' },
          title: kurz(meldung.titel, 240),
          ...(meldung.beschreibung ? { description: kurz(meldung.beschreibung, 2000) } : {}),
          ...(felder.length > 0
            ? {
                fields: felder.slice(0, 6).map((feld) => ({
                  name: kurz(feld.name, 240),
                  value: kurz(feld.value, 1000),
                  inline: true,
                })),
              }
            : {}),
          footer: { text: kurz(projekt.title, 240) },
          timestamp: new Date(jetzt).toISOString(),
        },
      ],
      ...(meldung.pfad
        ? {
            components: [
              {
                type: 1,
                components: [{ type: 2, style: 5, label: 'Im Workspace öffnen', url: appUrl(meldung.pfad) }],
              },
            ],
          }
        : {}),
      // Siehe oben: der Text kommt aus einem Formular.
      allowedMentions: { parse: [] },
    });

    // Ein geglueckter Versand loescht den alten Fehler - sonst stuende die
    // Warnung am Projekt, bis jemand sie von Hand wegraeumt.
    await prisma.workspaceProject
      .updateMany({
        where: { id: projectId, discordFehlerAt: { not: null } },
        data: { discordFehlerAt: null, discordFehlerText: null },
      })
      .catch(() => undefined);
  } catch (fehler) {
    const text = fehler instanceof Error ? fehler.message : 'Unbekannter Fehler';
    log.warn('Projektmeldung konnte nicht gesendet werden', {
      projectId,
      ereignis: meldung.ereignis,
      fehler,
    });
    /*
     * Der Fehler wird vermerkt, nicht geworfen.
     *
     * Die Aufgabe ist zu diesem Zeitpunkt gespeichert; eine Ausnahme hier
     * wuerde die Handlung scheitern lassen, die laengst gelungen ist. Auch
     * das Vermerken selbst darf nichts umwerfen - darum noch ein `catch`.
     */
    await prisma.workspaceProject
      .update({
        where: { id: projectId },
        data: { discordFehlerAt: new Date(jetzt), discordFehlerText: kurz(text, 300) },
      })
      .catch(() => undefined);
  }
}

/** Discord kappt hart; lieber selbst kuerzen als eine abgelehnte Nachricht. */
function kurz(text: string, grenze: number): string {
  return text.length <= grenze ? text : `${text.slice(0, grenze - 1)}…`;
}
