import { prisma } from '@swisshub/database';
import type { VerificationRequest } from '@swisshub/database';
import { imSystemOeffnen, systemRoutes } from '../links';
import {
  BUTTON_STYLE,
  discord as defaultDiscord,
  type DiscordEmbed,
  type DiscordGateway,
  type DiscordMessagePayload,
  type SentMessage,
} from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { VERIFICATION_ACCENT_COLOR, type VerificationSettings } from './config';
import { planeErsteErinnerung } from './erinnerung';
import { statusLabel } from './service';

const logger = createLogger('verification:discord');

/**
 * Die Verifikation auf Discord.
 *
 * Die Meldung an die Moderation wird einmal gesendet und danach
 * fortgeschrieben - ihre Kennung steht am Vorgang. Wer den Kanal liest, soll
 * nicht drei Fassungen desselben Falls sehen, und wer die Entscheidung
 * verpasst hat, soll sie am urspruenglichen Beitrag erkennen.
 */

/** Kennungen der Knoepfe. Der Vorgang steckt darin - geprueft wird trotzdem. */
export const VERIFY_BUTTON = 'verification:approve';
export const REJECT_BUTTON = 'verification:reject';

export function buildButtonId(art: 'approve' | 'reject', requestId: string): string {
  return `${art === 'approve' ? VERIFY_BUTTON : REJECT_BUTTON}:${requestId}`;
}

/**
 * Die Vorgangskennung aus einer Knopf-ID lesen.
 *
 * Sie ist ein Hinweis, keine Vollmacht: was daraus folgt, entscheidet
 * ausschliesslich die serverseitige Pruefung im Bot.
 */
export function parseButtonId(customId: string): { art: 'approve' | 'reject'; requestId: string } | null {
  for (const [praefix, art] of [
    [`${VERIFY_BUTTON}:`, 'approve'],
    [`${REJECT_BUTTON}:`, 'reject'],
  ] as const) {
    if (customId.startsWith(praefix)) {
      const requestId = customId.slice(praefix.length);
      return requestId.length > 0 ? { art, requestId } : null;
    }
  }
  return null;
}

/**
 * Ein Zeitpunkt, wie Discord ihn darstellt.
 *
 * `<t:...:F>` zeigt jedem Leser seine eigene Zeitzone und sein eigenes
 * Datumsformat. Ein hier ausgerechneter Text waere die Zeitzone des Servers,
 * und die stimmt fuer niemanden verlaesslich.
 */
function zeitpunkt(wert: Date, stil: 'F' | 'R' = 'F'): string {
  return `<t:${Math.floor(wert.getTime() / 1000)}:${stil}>`;
}

function alter(von: Date | null, bis: Date): string {
  if (!von) {
    return 'unbekannt';
  }
  const tage = Math.floor((bis.getTime() - von.getTime()) / 86_400_000);
  if (tage >= 365) {
    const jahre = Math.floor(tage / 365);
    return `${jahre} Jahr${jahre === 1 ? '' : 'e'}`;
  }
  if (tage >= 1) {
    return `${tage} Tag${tage === 1 ? '' : 'e'}`;
  }
  const stunden = Math.max(1, Math.floor((bis.getTime() - von.getTime()) / 3_600_000));
  return `${stunden} Stunde${stunden === 1 ? '' : 'n'}`;
}

export function buildModEmbed(request: VerificationRequest): DiscordEmbed {
  const entschieden = request.decidedAt !== null;
  const kopf = entschieden
    ? request.status === 'VERIFIED'
      ? request.decidedBy === 'AI'
        ? '🤖 Automatisch verifiziert'
        : '✅ Verifiziert'
      : request.status === 'REJECTED'
        ? '❌ Abgelehnt und gebannt'
        : request.status === 'LEFT_SERVER'
          ? '↩️ Server verlassen'
          : request.status === 'EXPIRED'
            ? '⌛ Abgelaufen'
            : 'Abgeschlossen'
    : '🔎 Neue Verifikation';

  const felder = [
    // Die Kennung bleibt auch dann lesbar, wenn die Person den Server
    // verlassen hat und die Erwaehnung nur noch eine Zahl zeigt. Und sie ist
    // kopierbar, weil sie in Codezeichen steht.
    { name: 'Discord ID', value: `\`${request.discordId}\``, inline: true },
    {
      name: 'Konto erstellt',
      value: request.accountCreatedAt
        ? `${zeitpunkt(request.accountCreatedAt)}\n(${alter(request.accountCreatedAt, request.joinedAt)} vor dem Beitritt)`
        : 'unbekannt',
      inline: true,
    },
    { name: 'Server beigetreten', value: zeitpunkt(request.joinedAt), inline: true },
  ];

  if (request.latestMessage) {
    felder.push({
      name: request.messageCount > 1 ? `Nachricht (${request.messageCount} gesamt)` : 'Nachricht',
      // In ein Zitat gesetzt: der Text stammt von aussen und soll sich im
      // Embed nicht als Ueberschrift oder Erwaehnung ausgeben koennen. Dass
      // ein `@everyone` darin niemanden erreicht, entscheidet zusaetzlich
      // `allowedMentions` der Nachricht - der Text hier ist nur Anzeige.
      value: `>>> ${request.latestMessage.slice(0, 900)}`,
      inline: false,
    });
  }

  if (request.aiVerdict) {
    const wert =
      request.aiVerdict === 'FAILED'
        ? `Prüfung fehlgeschlagen — manuelle Prüfung erforderlich${request.aiError ? ` (${request.aiError.slice(0, 120)})` : ''}`
        : `${request.aiVerdict}${
            request.aiConfidence !== null ? ` · ${Math.round(request.aiConfidence * 100)} %` : ''
          }${request.aiReasonCode ? ` · ${request.aiReasonCode}` : ''}`;
    felder.push({ name: 'AI-Einordnung', value: wert, inline: false });
  }

  // Hinweise, keine Urteile. Sie stehen hier, damit ein Mensch sie
  // einbezieht - eine Sanktion loesen sie nie aus.
  const hinweise: string[] = [];
  if (
    request.accountCreatedAt &&
    request.joinedAt.getTime() - request.accountCreatedAt.getTime() < 24 * 3600_000
  ) {
    hinweise.push('Konto jünger als 24 Stunden');
  }
  if (!request.avatarHash) {
    hinweise.push('Kein Avatar gesetzt');
  }
  if (hinweise.length > 0) {
    felder.push({ name: 'Hinweise', value: hinweise.join(' · '), inline: false });
  }

  felder.push({ name: 'Status', value: statusZeile(request), inline: false });

  if (entschieden && request.decisionReason) {
    felder.push({ name: 'Grund', value: request.decisionReason.slice(0, 400), inline: false });
  }

  return {
    title: kopf,
    description: `**${request.displayName ?? request.username ?? 'Unbekannt'}**\n<@${request.discordId}>`,
    color: VERIFICATION_ACCENT_COLOR,
    fields: felder,
    ...(request.avatarHash
      ? {
          thumbnail: {
            url: `https://cdn.discordapp.com/avatars/${request.discordId}/${request.avatarHash}.png?size=128`,
          },
        }
      : {}),
    timestamp: (request.decidedAt ?? request.joinedAt).toISOString(),
    footer: { text: 'SwissHub • Verifikation' },
  };
}

/**
 * Der Status in einer Zeile - offen oder entschieden, und von wem.
 *
 * Der Moderator steht als Erwaehnung da: anklickbar, und er bleibt lesbar,
 * wenn sich sein Anzeigename spaeter aendert. Ob die Entscheidung auf Discord
 * oder im Dashboard fiel, steht dabei; wer den Kanal spaeter liest, soll
 * nicht raten muessen, warum die Knoepfe nichts mehr tun.
 */
function statusZeile(request: VerificationRequest): string {
  if (!request.decidedAt) {
    return 'Wartet auf Entscheidung';
  }

  const wer =
    request.decidedBy === 'AI'
      ? 'der AI-Prüfung'
      : request.decidedByDiscordId
        ? `<@${request.decidedByDiscordId}>`
        : (request.decidedByUsername ?? 'unbekannt');

  const wo =
    request.decidedBy !== 'HUMAN'
      ? ''
      : request.decidedSource === 'WEBAPP'
        ? ' über das SwissHub System'
        : request.decidedSource === 'DISCORD'
          ? ' über Discord'
          : '';

  const was =
    request.status === 'VERIFIED'
      ? 'Verifiziert'
      : request.status === 'REJECTED'
        ? 'Abgelehnt und gebannt'
        : statusLabel(request.status);

  return request.decidedBy === 'SYSTEM' ? was : `${was}${wo} von ${wer}`;
}

function buildComponents(request: VerificationRequest): DiscordMessagePayload['components'] {
  /*
   * Ein entschiedener Vorgang bietet nichts mehr zu entscheiden an - aber der
   * Weg ins System bleibt. Genau dort steht, was danach interessiert: die
   * Akte der Person, ihre bisherigen Vorgaenge und wer entschieden hat.
   */
  if (request.decidedAt) {
    return [
      {
        type: 1 as const,
        components: [imSystemOeffnen(systemRoutes.mitglied(request.discordId), 'Mitglied im System')],
      },
    ];
  }
  return [
    {
      type: 1 as const,
      components: [
        {
          type: 2 as const,
          style: BUTTON_STYLE.SUCCESS,
          label: 'Verifizieren',
          emoji: { name: '🟢' },
          custom_id: buildButtonId('approve', request.id),
        },
        {
          type: 2 as const,
          style: BUTTON_STYLE.DANGER,
          label: 'Bannen',
          emoji: { name: '🔴' },
          custom_id: buildButtonId('reject', request.id),
        },
        // Wer vor der Entscheidung nachsehen will, kommt von hier direkt in
        // die Warteschlange - mit Verlauf, Kontoalter und allem, was die
        // Nachricht nicht traegt.
        imSystemOeffnen(systemRoutes.verifikation(), 'In der Warteschlange'),
      ],
    },
  ];
}

function payload(
  request: VerificationRequest,
  options: { mentionRoleId?: string | null } = {},
): DiscordMessagePayload {
  return {
    ...(options.mentionRoleId ? { content: `<@&${options.mentionRoleId}>` } : {}),
    embeds: [buildModEmbed(request)],
    components: buildComponents(request),
    allowedMentions: options.mentionRoleId
      ? { parse: [] as never[], roles: [options.mentionRoleId] }
      : { parse: [] as never[] },
  };
}

/**
 * Jede Nachricht festhalten, die der Bot zu einem Vorgang geschrieben hat.
 *
 * **Eine Liste, kein Feld.** Genau daran ist das Aufraeumen gescheitert: ein
 * Vorgang kann mehr als eine Bot-Nachricht haben - ein wiederholtes
 * `guildMemberAdd`, ein zweiter Beitritt bei noch offenem Vorgang, ein
 * Neustart. Ein einzelnes Feld behielt die juengste und verlor jede
 * vorherige; die blieb im Kanal stehen, und nichts zeigte mehr auf sie. Ueber
 * den Text wiederfinden laesst sie sich nicht: das Aufraeumen ueberspringt
 * Bot-Nachrichten ausdruecklich, damit es keine fremde erwischt.
 *
 * Die alten Skalarfelder werden weiter mitgeschrieben - sie sind die
 * Rueckfallebene fuer Vorgaenge aus der Zeit davor und die Anzeige im
 * Dashboard.
 *
 * Scheitert das Festhalten, bleibt die Nachricht trotzdem gesendet. Der
 * Fehler wird protokolliert und nicht weitergereicht: eine Zustellung laesst
 * sich nicht zuruecknehmen.
 */
async function merkeBotNachricht(
  requestId: string,
  kind: 'GREETING' | 'WELCOME',
  channelId: string,
  messageId: string,
): Promise<void> {
  const feld =
    kind === 'GREETING'
      ? { greetingChannelId: channelId, greetingMessageId: messageId }
      : { welcomeChannelId: channelId, welcomeMessageId: messageId };

  await prisma
    .$transaction([
      prisma.verificationBotMessage.upsert({
        where: { requestId_discordMessageId: { requestId, discordMessageId: messageId } },
        create: { requestId, kind, channelId, discordMessageId: messageId },
        update: {},
      }),
      prisma.verificationRequest.update({ where: { id: requestId }, data: feld }),
    ])
    .then(() => {
      logger.info('verification.bot_message.recorded', { requestId, kind });
    })
    .catch((error: unknown) => {
      logger.warn('verification.bot_message.record_failed', { requestId, kind, error });
    });
}

/**
 * Die Begruessung im Verifikationskanal.
 *
 * Erwaehnt ausschliesslich die begruesste Person - `parse: []` sorgt dafuer,
 * dass ein Begruessungstext mit `@everyone` darin niemanden anpingt.
 *
 * **Nur einmal je Vorgang und Kanal.** Discord stellt `guildMemberAdd`
 * gelegentlich doppelt zu, und `startVerification` gibt bei einem offenen
 * Vorgang denselben zurueck - ohne diese Pruefung stuenden zwei Begruessungen
 * im Kanal, an dieselbe Person gerichtet.
 */
export async function sendGreeting(
  request: VerificationRequest,
  settings: VerificationSettings,
  gateway: DiscordGateway = defaultDiscord,
): Promise<SentMessage | null> {
  const kanal = settings.verificationChannelId;
  if (!kanal) {
    return null;
  }

  const bereitsBegruesst = await prisma.verificationBotMessage
    .findFirst({ where: { requestId: request.id, kind: 'GREETING', channelId: kanal } })
    .catch(() => null);
  if (bereitsBegruesst) {
    logger.info('verification.greeting.skipped', { requestId: request.id });
    return { id: bereitsBegruesst.discordMessageId, channelId: kanal };
  }

  const text = settings.greetingMessage.replaceAll('{user}', `<@${request.discordId}>`);
  try {
    const gesendet = await gateway.channels.send(kanal, {
      content: text.slice(0, 1900),
      allowedMentions: { parse: [] as never[], users: [request.discordId] },
    });
    await merkeBotNachricht(request.id, 'GREETING', kanal, gesendet.id);
    /*
     * Erst jetzt beginnt die Erinnerungsreihe.
     *
     * Nicht beim Beitritt: eine Erinnerung zeigt auf die Begruessung
     * («deine Verifikation ist noch offen» - welche denn?), und ohne sie
     * zeigte sie auf nichts. Scheitert das Senden oben, wird auch nichts
     * geplant, und der Vorgang wartet still - so, wie er soll.
     */
    await planeErsteErinnerung(request.id, settings);
    return gesendet;
  } catch (error) {
    logger.warn('Begrüssung konnte nicht gesendet werden', { requestId: request.id, error });
    return null;
  }
}

/**
 * Die Moderation ueber einen Fall unterrichten - oder die bestehende Meldung
 * fortschreiben.
 *
 * Ein Vorgang bekommt genau eine Meldung. Erwaehnt wird nur beim ersten Mal:
 * jede Aktualisierung erneut zu pingen waere genau das Fluten, das die
 * Einstellung verhindern soll.
 */
export async function pushModNotice(
  requestId: string,
  settings: VerificationSettings,
  options: { gateway?: DiscordGateway; erwaehnen?: boolean } = {},
): Promise<void> {
  const gateway = options.gateway ?? defaultDiscord;
  const request = await prisma.verificationRequest.findUnique({ where: { id: requestId } });
  if (!request || !settings.moderatorChannelId) {
    return;
  }

  if (request.modMessageId && request.modChannelId) {
    try {
      await gateway.channels.edit(request.modChannelId, request.modMessageId, payload(request));
      return;
    } catch (error) {
      // Die Meldung wurde geloescht. Eine neue zu senden ist hier richtig -
      // anders als bei einer Ankuendigung braucht die Moderation den Fall.
      logger.warn('Moderationsmeldung nicht auffindbar - wird neu gesendet', { requestId, error });
    }
  }

  try {
    const gesendet = await gateway.channels.send(
      settings.moderatorChannelId,
      payload(request, {
        mentionRoleId: options.erwaehnen ? settings.moderatorPingRoleId : null,
      }),
    );
    await prisma.verificationRequest.update({
      where: { id: requestId },
      data: { modChannelId: settings.moderatorChannelId, modMessageId: gesendet.id },
    });
  } catch (error) {
    logger.error('Moderation konnte nicht benachrichtigt werden', { requestId, error });
  }
}

/**
 * Die frisch freigeschaltete Person im Verifikationskanal informieren.
 *
 * Die Kennung wird festgehalten, denn diese Nachricht gehoert zu genau
 * diesem Vorgang: raeumt das Modul den Kanal anschliessend auf, muss sie
 * mit verschwinden. Ohne die Kennung bliebe sie stehen - eine Zeile, die
 * jemanden anspricht, der den Kanal von da an nicht mehr sieht - und der
 * einzige Weg, sie wiederzufinden, waere eine Textsuche.
 */
export async function sendWelcome(
  request: VerificationRequest,
  settings: VerificationSettings,
  gateway: DiscordGateway = defaultDiscord,
): Promise<void> {
  const text = settings.welcomeMessage.trim();
  if (!text || !settings.verificationChannelId) {
    return;
  }
  try {
    const gesendet = await gateway.channels.send(settings.verificationChannelId, {
      content: `<@${request.discordId}> ${text}`.slice(0, 1900),
      allowedMentions: { parse: [] as never[], users: [request.discordId] },
    });
    await merkeBotNachricht(request.id, 'WELCOME', settings.verificationChannelId, gesendet.id);
  } catch (error) {
    logger.warn('Willkommensnachricht fehlgeschlagen', { requestId: request.id, error });
  }
}

/** Abgeschlossene Vorgaenge zusaetzlich protokollieren. */
export async function writeLog(
  request: VerificationRequest,
  settings: VerificationSettings,
  gateway: DiscordGateway = defaultDiscord,
): Promise<void> {
  if (!settings.logChannelId) {
    return;
  }
  try {
    await gateway.channels.send(settings.logChannelId, {
      embeds: [buildModEmbed(request)],
      allowedMentions: { parse: [] as never[] },
    });
  } catch (error) {
    logger.warn('Protokolleintrag fehlgeschlagen', { requestId: request.id, error });
  }
}
