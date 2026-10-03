import { prisma } from '@swisshub/database';
import { discord } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { appUrl } from '@swisshub/config';

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
 * ## Warum das nichts abbricht
 *
 * Ein Kanal kann geloescht, umbenannt oder dem Bot entzogen worden sein. Dass
 * eine Aufgabe nicht entsteht, weil die Benachrichtigung darueber nicht
 * durchkam, waere der falsche Handel - das Projekt ist das Wesentliche, die
 * Meldung die Beigabe. Fehlschlaege stehen im Protokoll.
 *
 * ## Warum nie ein Ping
 *
 * `allowedMentions: { parse: [] }` bei jeder Nachricht. Ein Titel wie
 * «@everyone fragen» loeste sonst genau das aus - der Text kommt aus einem
 * Formular, und was darin steht, entscheidet nicht ueber Benachrichtigungen
 * eines ganzen Servers.
 */

/** Die Farbe der Embeds - dasselbe Rot wie ueberall. */
const FARBE = 0xe02630;

interface Meldung {
  titel: string;
  beschreibung?: string | null;
  felder?: Array<{ name: string; value: string }>;
  /** Wohin der Knopf fuehrt - eine Adresse in der WebApp. */
  pfad?: string;
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
  if (!projectId) {
    return;
  }
  const projekt = await prisma.workspaceProject
    .findUnique({ where: { id: projectId }, select: { title: true, discordChannelId: true } })
    .catch(() => null);
  if (!projekt?.discordChannelId) {
    return;
  }

  try {
    await discord.channels.send(projekt.discordChannelId, {
      embeds: [
        {
          color: FARBE,
          title: kurz(meldung.titel, 240),
          ...(meldung.beschreibung ? { description: kurz(meldung.beschreibung, 2000) } : {}),
          author: { name: kurz(projekt.title, 240) },
          ...(meldung.felder && meldung.felder.length > 0
            ? {
                fields: meldung.felder.slice(0, 5).map((feld) => ({
                  name: kurz(feld.name, 240),
                  value: kurz(feld.value, 1000),
                  inline: true,
                })),
              }
            : {}),
          timestamp: new Date().toISOString(),
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
  } catch (fehler) {
    log.warn('Projektmeldung konnte nicht gesendet werden', { projectId, fehler });
  }
}

/** Discord kappt hart; lieber selbst kuerzen als eine abgelehnte Nachricht. */
function kurz(text: string, grenze: number): string {
  return text.length <= grenze ? text : `${text.slice(0, grenze - 1)}…`;
}
