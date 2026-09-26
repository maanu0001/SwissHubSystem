import { prisma } from '@swisshub/database';
import { discord as defaultDiscord, BUTTON_STYLE, type DiscordGateway } from '@swisshub/discord';
import type { DiscordEmbed, DiscordMessagePayload } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import type { Prisma, StreamerKanal, StreamerSession } from '@swisshub/database';
import { STREAMER_ACCENT_COLOR, type StreamerSettings } from './config';
import { plattform, streamAdresse, vorschaubild } from './plattform';

/**
 * Die Live-Ankuendigung auf Discord.
 *
 * ## Genau eine je Stream - und warum das keine Pruefung im Code ist
 *
 * `StreamerAnkuendigung.sessionId` ist `@@unique`. Eine Ankuendigung anzulegen
 * ist damit die **Belegung des Platzes**: gelingt das `create`, darf gesendet
 * werden; kommt ein `P2002` zurueck, hat es jemand anders schon getan.
 *
 * Das ist der Unterschied zu einer Pruefung «gibt es schon eine?». Die waere
 * ein Zeitfenster - zwei Durchgaenge pruefen gleichzeitig, beide finden nichts,
 * beide senden. Die Bedingung in der Datenbank hat dieses Fenster nicht.
 *
 * Daraus folgt, was §9.3 verlangt:
 *
 * - **Bot-Neustart.** Die Zeile bleibt, der neue Prozess bekommt `P2002`.
 * - **Erneute API-Meldung.** Dieselbe `stream.id` ergibt dieselbe Session,
 *   also dieselbe Zeile.
 * - **Kurzer Unterbruch.** Twitch behaelt die `stream.id`; die Session wird
 *   wiedereroeffnet, nicht neu angelegt - und die Ankuendigung bleibt die von
 *   vorher.
 *
 * ## Warum ein Streamer nicht zu spaet angekuendigt wird
 *
 * Eine Ankuendigung hat nur einen Wert, wenn sie kommt, waehrend der Stream
 * laeuft und noch jemand einsteigen kann. War der Bot drei Stunden aus, ist
 * «X ist jetzt live» fuer einen Stream, der bald endet, kein Dienst an der
 * Gemeinschaft - sondern Laerm. Deshalb `HOECHSTALTER_MS`.
 */

const log = createLogger('streamer:ankuendigung');

/**
 * Wie alt eine Session hoechstens sein darf, um noch angekuendigt zu werden.
 *
 * Eine halbe Stunde. Darunter ist «jetzt live» wahr; darueber war der Bot weg,
 * und die Nachricht kaeme fuer einen Stream, der laengst laeuft.
 */
export const HOECHSTALTER_MS = 30 * 60 * 1000;

/** Wie oft ein Senden wiederholt wird, bevor es aufgegeben wird. */
export const MAX_VERSUCHE = 3;

export type SessionMitKanal = StreamerSession & {
  kanal: StreamerKanal & { profil: { discordId: string; ankuendigungAktiv: boolean; status: string } };
};

/**
 * Erwaehnungen aus dem Einstellungstext - aber nie `@everyone`.
 *
 * Erlaubt werden ausschliesslich die Rollen, die im Text stehen. `parse: []`
 * heisst: Discord loest von sich aus nichts auf. Ein `@everyone` im Text bleibt
 * damit Text - es sieht wie eine Erwaehnung aus und pingt niemanden.
 *
 * Zusaetzlich wird es aus dem Text entfernt, damit es nicht einmal so aussieht.
 */
export function bereiteErwaehnung(text: string): {
  inhalt: string | undefined;
  allowedMentions: DiscordMessagePayload['allowedMentions'];
} {
  const ohneAlle = text.replaceAll('@everyone', '').replaceAll('@here', '').trim();
  if (ohneAlle === '') {
    return { inhalt: undefined, allowedMentions: { parse: [] } };
  }
  const rollen = [...ohneAlle.matchAll(/<@&(\d{17,20})>/gu)].map((treffer) => treffer[1]!);
  return {
    inhalt: ohneAlle,
    allowedMentions: { parse: [], ...(rollen.length > 0 ? { roles: [...new Set(rollen)] } : {}) },
  };
}

/**
 * Die Ueberschrift aus der Vorlage.
 *
 * Ein Platzhalter, fuer den es keinen Wert gibt, wird **entfernt** und nicht
 * durch «unbekannt» ersetzt. «X ist live mit unbekannt» ist schlechter als
 * «X ist live».
 */
export function setzeVorlageEin(
  vorlage: string,
  werte: { streamer: string; titel: string | null; spiel: string | null; plattform: string; url: string },
): string {
  const ersetzt = vorlage
    .replaceAll('{streamer}', werte.streamer)
    .replaceAll('{titel}', werte.titel ?? '')
    .replaceAll('{spiel}', werte.spiel ?? '')
    .replaceAll('{plattform}', werte.plattform)
    .replaceAll('{url}', werte.url);
  // Doppelte Leerzeichen, die durch weggelassene Platzhalter entstehen.
  return ersetzt.replace(/\s{2,}/gu, ' ').trim();
}

export interface AnkuendigungsDaten {
  /** Der Anzeigename aus dem Mitgliedsprofil - nicht aus der Plattform. */
  anzeigename: string;
  /** Die Adresse des Profilbilds, falls es eines gibt. */
  profilbildUrl: string | null;
  /** Die oeffentliche Streamer-Seite bei SwissHub, falls es sie gibt. */
  swisshubUrl: string | null;
}

/** Das Embed einer Live-Ankuendigung. */
export function baueEmbed(
  session: SessionMitKanal,
  daten: AnkuendigungsDaten,
  settings: StreamerSettings,
): DiscordMessagePayload {
  const angaben = plattform(session.kanal.plattform);
  const url =
    session.streamUrl ??
    streamAdresse(session.kanal.plattform, session.kanal.handle, session.externeSessionId);

  const titel = setzeVorlageEin(settings.ankuendigungVorlage, {
    streamer: daten.anzeigename,
    titel: session.titel,
    spiel: session.spiel,
    plattform: angaben.label,
    url,
  });

  const felder: DiscordEmbed['fields'] = [];
  if (session.spiel) {
    felder.push({ name: 'Spiel', value: session.spiel, inline: true });
  }
  felder.push({ name: 'Plattform', value: angaben.label, inline: true });
  /*
   * Die Zuschauerzahl nur, wenn die Plattform sie geliefert hat. Eine Null
   * waere eine Behauptung, und zwar eine, die einem Streamer schadet.
   */
  if (session.zuschauer !== null) {
    felder.push({ name: 'Zuschauer', value: String(session.zuschauer), inline: true });
  }

  const embed: DiscordEmbed = {
    title: session.titel ?? titel,
    url,
    color: STREAMER_ACCENT_COLOR,
    author: {
      name: titel,
      ...(daten.profilbildUrl ? { icon_url: daten.profilbildUrl } : {}),
      ...(daten.swisshubUrl ? { url: daten.swisshubUrl } : {}),
    },
    fields: felder,
    footer: { text: 'SwissHub Streamer Hub' },
    timestamp: session.gestartetAm.toISOString(),
  };

  /*
   * Das Vorschaubild mit eingesetzten Massen. Twitch liefert `{width}` und
   * `{height}` als Platzhalter; wer sie stehenlaesst, bekommt ein 404 und ein
   * Embed mit grauer Flaeche.
   *
   * Der Zeitstempel dahinter umgeht Discords Bildzwischenspeicher: ohne ihn
   * zeigt die zweite Ankuendigung desselben Kanals das Bild der ersten.
   */
  const bild = vorschaubild(session.vorschaubildUrl, 1280, 720);
  if (bild) {
    embed.image = { url: `${bild}${bild.includes('?') ? '&' : '?'}t=${session.gestartetAm.getTime()}` };
  }

  const erwaehnung = bereiteErwaehnung(settings.ankuendigungMention);

  return {
    ...(erwaehnung.inhalt ? { content: erwaehnung.inhalt } : {}),
    allowedMentions: erwaehnung.allowedMentions,
    embeds: [embed],
    components: [
      {
        type: 1,
        components: [
          { type: 2, style: BUTTON_STYLE.LINK, label: `Auf ${angaben.label} anschauen`, url },
          ...(daten.swisshubUrl
            ? [
                {
                  type: 2 as const,
                  style: BUTTON_STYLE.LINK,
                  label: 'Streamer-Profil',
                  url: daten.swisshubUrl,
                },
              ]
            : []),
        ],
      },
    ],
  };
}

export type SendeErgebnis =
  | { art: 'gesendet'; messageId: string }
  | { art: 'uebersprungen'; grund: string }
  | { art: 'gescheitert'; grund: string };

/**
 * Eine Session ankuendigen - hoechstens einmal.
 *
 * Die Reihenfolge ist die ganze Absicherung:
 *
 * 1. Platz belegen (`create` auf die eindeutige `sessionId`).
 * 2. Senden.
 * 3. Kennung nachtragen.
 *
 * Scheitert Schritt 2, bleibt die Zeile **stehen** - mit Fehler und
 * Versuchszaehler. Sie wieder zu loeschen waere naheliegend und falsch: dann
 * koennte ein zweiter Durchgang senden, waehrend der erste noch auf Discord
 * wartet. Lieber ein Versuch mehr an derselben Zeile als zwei Nachrichten.
 */
export async function kuendigeAn(
  session: SessionMitKanal,
  daten: AnkuendigungsDaten,
  settings: StreamerSettings,
  jetzt: Date = new Date(),
  gateway: DiscordGateway = defaultDiscord,
): Promise<SendeErgebnis> {
  if (!settings.ankuendigungAktiv || settings.ankuendigungChannelId === '') {
    return { art: 'uebersprungen', grund: 'Live-Ankündigungen sind aus.' };
  }
  if (!session.kanal.profil.ankuendigungAktiv) {
    return { art: 'uebersprungen', grund: 'Dieser Streamer möchte nicht angekündigt werden.' };
  }
  if (session.kanal.profil.status !== 'APPROVED') {
    return { art: 'uebersprungen', grund: 'Der Streamer ist nicht freigegeben.' };
  }
  if (jetzt.getTime() - session.gestartetAm.getTime() > HOECHSTALTER_MS) {
    return { art: 'uebersprungen', grund: 'Der Stream läuft zu lange - eine Ankündigung käme zu spät.' };
  }

  // Die Ruhezeit je Streamer: gegen den, der dreimal am Abend neu startet.
  if (settings.cooldownMinuten > 0) {
    const seit = new Date(jetzt.getTime() - settings.cooldownMinuten * 60_000);
    const letzte = await prisma.streamerAnkuendigung.findFirst({
      where: {
        gesendetAm: { gte: seit },
        session: { kanal: { profilId: session.kanal.profilId } },
      },
      select: { id: true },
    });
    if (letzte) {
      return { art: 'uebersprungen', grund: 'Ruhezeit - dieser Streamer wurde vor kurzem angekündigt.' };
    }
  }

  // Die Obergrenze des Tages, ueber alle Streamer.
  const tagesbeginn = new Date(jetzt);
  tagesbeginn.setUTCHours(0, 0, 0, 0);
  const heute = await prisma.streamerAnkuendigung.count({
    where: { gesendetAm: { gte: tagesbeginn } },
  });
  if (heute >= settings.maxProTag) {
    log.warn('Tagesobergrenze für Live-Ankündigungen erreicht', { heute, grenze: settings.maxProTag });
    return { art: 'uebersprungen', grund: `Tagesobergrenze von ${settings.maxProTag} erreicht.` };
  }

  // --- Platz belegen ---------------------------------------------------------
  let bestehend: { id: string; messageId: string | null; versuche: number } | null = null;
  try {
    const angelegt = await prisma.streamerAnkuendigung.create({
      data: { sessionId: session.id, channelId: settings.ankuendigungChannelId },
      select: { id: true, messageId: true, versuche: true },
    });
    bestehend = angelegt;
  } catch (ursache) {
    if ((ursache as Prisma.PrismaClientKnownRequestError)?.code !== 'P2002') {
      throw ursache;
    }
    // Schon belegt. Gesendet? Dann fertig. Sonst ein weiterer Versuch.
    const vorhanden = await prisma.streamerAnkuendigung.findUnique({
      where: { sessionId: session.id },
      select: { id: true, messageId: true, versuche: true },
    });
    if (!vorhanden) {
      return { art: 'uebersprungen', grund: 'Die Ankündigung wurde inzwischen entfernt.' };
    }
    if (vorhanden.messageId) {
      return { art: 'uebersprungen', grund: 'Diese Session wurde schon angekündigt.' };
    }
    if (vorhanden.versuche >= MAX_VERSUCHE) {
      return { art: 'uebersprungen', grund: `Nach ${MAX_VERSUCHE} Versuchen aufgegeben.` };
    }
    bestehend = vorhanden;
  }

  // --- Senden ----------------------------------------------------------------
  try {
    const gesendet = await gateway.channels.send(
      settings.ankuendigungChannelId,
      baueEmbed(session, daten, settings),
    );
    await prisma.streamerAnkuendigung.update({
      where: { id: bestehend.id },
      // `jetzt` und nicht `new Date()`: die Tagesobergrenze zaehlt ueber
      // `gesendetAm`, und sie rechnet mit derselben Zeit wie dieser Durchgang.
      data: { messageId: gesendet.id, gesendetAm: jetzt, fehler: null },
    });
    log.info('Live-Ankündigung gesendet', {
      sessionId: session.id,
      plattform: session.kanal.plattform,
      handle: session.kanal.handle,
    });
    return { art: 'gesendet', messageId: gesendet.id };
  } catch (ursache) {
    const grund = ursache instanceof Error ? ursache.message : String(ursache);
    await prisma.streamerAnkuendigung.update({
      where: { id: bestehend.id },
      data: { fehler: grund.slice(0, 300), versuche: { increment: 1 } },
    });
    log.warn('Live-Ankündigung konnte nicht gesendet werden', { sessionId: session.id, grund });
    return { art: 'gescheitert', grund };
  }
}
