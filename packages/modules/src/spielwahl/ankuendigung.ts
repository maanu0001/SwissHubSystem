import { appUrl } from '@swisshub/config';
import { prisma } from '@swisshub/database';
import { discord as defaultDiscord, BUTTON_STYLE, type DiscordGateway } from '@swisshub/discord';
import type { DiscordEmbed, DiscordMessagePayload } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { systemRoutes } from '@swisshub/shared';
import type { SpielwahlSession } from '@swisshub/database';
import { SPIELWAHL_ACCENT_COLOR } from './config';
import { MODUS_TEXT, STATUS_TEXT } from './zustand';

const log = createLogger('spielwahl:ankuendigung');

/**
 * Die Runde auf Discord.
 *
 * ## Eine Nachricht, nicht fünf
 *
 * Eine Spielauswahl dauert zehn Minuten und ändert dabei fünfmal ihren
 * Zustand. Für jeden davon eine Nachricht zu senden, hiesse, einen Kanal mit
 * einem Ereignis zu füllen, das schon vorbei ist, bevor jemand nachliest.
 *
 * Deshalb: **eine** Nachricht, die aktualisiert wird. Die Kennung steht in
 * der Session; wer sie setzen konnte, hat gesendet, alle weiteren Aufrufe
 * bearbeiten. Am Ende steht dort das Ergebnis - und wer den Kanal später
 * liest, sieht genau das, was ihn interessiert.
 *
 * ## Warum niemand erwähnt wird
 *
 * Weil eine Runde für sechs Leute keinen Anlass gibt, sechstausend zu
 * benachrichtigen. `allowedMentions: { parse: [] }` gilt auch für einen
 * Titel, in dem zufällig `@everyone` steht - ein freier Vorschlag geht durch
 * die Eingabeprüfung, aber verlassen will man sich darauf nicht.
 */

/** Das Embed einer Runde. */
export async function baueEmbed(session: SpielwahlSession): Promise<DiscordEmbed> {
  const [teilnehmer, kandidaten, gewinner] = await Promise.all([
    prisma.spielwahlParticipant.count({ where: { sessionId: session.id, leftAt: null } }),
    prisma.spielwahlCandidate.count({ where: { sessionId: session.id } }),
    session.ergebnisCandidateId
      ? prisma.spielwahlCandidate.findUnique({
          where: { id: session.ergebnisCandidateId },
          select: { nameSnapshot: true, coverSnapshot: true, game: { select: { coverUrl: true } } },
        })
      : null,
  ]);

  // Der Schnappschuss: so hiess das Spiel, als es gewonnen hat.
  const gewonnen = gewinner?.nameSnapshot ?? null;
  const fertig = session.status === 'ABGESCHLOSSEN';
  const beendet = session.status === 'ABGEBROCHEN';

  const embed: DiscordEmbed = {
    title: fertig && gewonnen ? `🎮 ${gewonnen}` : 'Was spielen wir?',
    description: fertig
      ? 'Entschieden. Viel Spass!'
      : beendet
        ? 'Diese Runde ist beendet.'
        : 'Tritt bei, schlag dein Spiel vor - und dann entscheidet ihr gemeinsam.',
    color: SPIELWAHL_ACCENT_COLOR,
    fields: [
      {
        /*
         * Der Host steht als Erwähnung da - sie wird nicht zugestellt
         * (`allowedMentions` ist leer), zeigt aber den Namen, den der Server
         * gerade für ihn führt. Eine abgeschriebene Kopie wäre nach der
         * nächsten Umbenennung falsch.
         */
        name: 'Host',
        value: `<@${session.hostDiscordId}>`,
        inline: true,
      },
      { name: 'Dabei', value: `${teilnehmer}`, inline: true },
      { name: 'Modus', value: MODUS_TEXT[session.modus], inline: true },
      { name: 'Status', value: STATUS_TEXT[session.status], inline: true },
      { name: 'Im Rennen', value: `${kandidaten} Spiele`, inline: true },
    ],
  };

  /*
   * Discord laedt das Bild selbst nach und braucht dafuer eine oeffentlich
   * erreichbare Adresse. Ein hochgeladenes Cover liegt hinter einer Route,
   * die die Anmeldung prueft - fuer das Embed kommt deshalb nur die verlinkte
   * Adresse in Frage, und sonst gar keine.
   */
  const cover = gewinner?.game?.coverUrl ?? gewinner?.coverSnapshot;
  if (fertig && cover && cover.startsWith('https://')) {
    embed.image = { url: cover };
  }

  return embed;
}

function baueNachricht(session: SpielwahlSession, embed: DiscordEmbed): DiscordMessagePayload {
  const offen = session.status !== 'ABGESCHLOSSEN' && session.status !== 'ABGEBROCHEN';

  return {
    embeds: [embed],
    // Keine Erwähnungen. Auch dann nicht, wenn im Titel eines Spiels eine steht.
    allowedMentions: { parse: [] },
    components: offen
      ? [
          {
            type: 1,
            components: [
              {
                type: 2,
                style: BUTTON_STYLE.LINK,
                label: 'Mitmachen',
                url: appUrl(systemRoutes.spielwahlSession(session.inviteToken)),
                emoji: { name: '🎲' },
              },
            ],
          },
        ]
      : [],
  };
}

/**
 * Die Runde auf Discord stellen oder die bestehende Nachricht auffrischen.
 *
 * Gibt zurück, ob etwas gesendet oder bearbeitet wurde.
 *
 * ## Der Riegel gegen die zweite Nachricht
 *
 * Der Platz wird **vor** dem Senden belegt, und zwar unter der Bedingung,
 * dass er frei ist. Zwei gleichzeitige Aufrufe treffen dieselbe Zeile; genau
 * einer belegt sie. Scheitert danach das Senden, wird der Platz wieder
 * freigegeben - sonst gälte die Runde für immer als angekündigt, und die
 * Nachricht käme nie.
 */
export async function stelleAufDiscord(
  session: SpielwahlSession,
  kanalId: string,
  gateway: DiscordGateway = defaultDiscord,
): Promise<boolean> {
  const embed = await baueEmbed(session);
  const nachricht = baueNachricht(session, embed);

  if (session.announcementMessageId && session.announcementChannelId) {
    try {
      await gateway.channels.edit(session.announcementChannelId, session.announcementMessageId, nachricht);
      return true;
    } catch (error) {
      /*
       * Die Nachricht ist weg - gelöscht, oder der Kanal ist es. Kein Grund,
       * eine neue zu senden: wer sie gelöscht hat, wollte sie nicht.
       */
      log.debug('Beitrag liess sich nicht auffrischen', {
        sessionId: session.id,
        grund: error instanceof Error ? error.message : 'unbekannt',
      });
      return false;
    }
  }

  const platzhalter = `pending:${session.id}`;
  const belegt = await prisma.spielwahlSession.updateMany({
    where: { id: session.id, announcementMessageId: null },
    data: { announcementMessageId: platzhalter, announcementChannelId: kanalId },
  });
  if (belegt.count !== 1) {
    return false;
  }

  try {
    const gesendet = await gateway.channels.send(kanalId, nachricht);
    await prisma.spielwahlSession.update({
      where: { id: session.id },
      data: { announcementMessageId: gesendet.id, announcementChannelId: kanalId },
    });
    log.info('Runde auf Discord gestellt', { sessionId: session.id, kanalId });
    return true;
  } catch (error) {
    await prisma.spielwahlSession
      .updateMany({
        where: { id: session.id, announcementMessageId: platzhalter },
        data: { announcementMessageId: null },
      })
      .catch(() => undefined);
    log.warn('Runde liess sich nicht auf Discord stellen', {
      sessionId: session.id,
      grund: error instanceof Error ? error.message : 'unbekannt',
    });
    return false;
  }
}

/**
 * Sessions, deren Discord-Beitrag veraltet ist.
 *
 * Die Nachricht wird nicht bei jeder Änderung aufgefrischt - während einer
 * Abstimmung ändert sich der Stand im Sekundentakt, und Discord begrenzt die
 * Zahl der Bearbeitungen zu Recht. Stattdessen sieht der Bot regelmässig
 * nach; dass der Teilnehmerzähler ein paar Sekunden hinterherhinkt, merkt
 * niemand, der ohnehin auf der Bühne zuschaut.
 */
export async function frischeBeitraegeAuf(gateway: DiscordGateway = defaultDiscord): Promise<number> {
  const sessions = await prisma.spielwahlSession.findMany({
    where: {
      announcementMessageId: { not: null },
      announcementChannelId: { not: null },
      updatedAt: { gt: new Date(Date.now() - 10 * 60_000) },
    },
    take: 25,
  });

  let aufgefrischt = 0;
  for (const session of sessions) {
    if (session.announcementMessageId?.startsWith('pending:')) {
      continue;
    }
    if (await stelleAufDiscord(session, session.announcementChannelId!, gateway)) {
      aufgefrischt += 1;
    }
  }
  return aufgefrischt;
}
