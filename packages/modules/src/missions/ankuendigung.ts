/**
 * Zwei Nachrichten je Mission: Start und Ergebnis.
 *
 * ## Zwei, nicht zweihundert
 *
 * Kein Fortschritt einzelner Mitglieder auf Discord. Bei hundertfuenfzig
 * Mitgliedern und einer Wochenmission waere das ein Kanal, in dem eine
 * Woche lang alle paar Minuten steht, dass jemand drei Minuten naeher am
 * Ziel ist. Wer seinen Stand sehen will, sieht ihn in der WebApp - dort
 * steht er live und ohne Benachrichtigung.
 *
 * ## Warum das Senden und das Merken zusammengehoeren
 *
 * Derselbe Gedanke wie bei Clip of the Week: der Durchgang laeuft jede
 * Minute und startet mit dem Bot neu. Deshalb ist der Zeitstempel der
 * gesendeten Nachricht das Gedaechtnis, und er wird unter einer Bedingung
 * gesetzt, die nur einmal zutrifft. Wer ihn setzen konnte, sendet; wer
 * nicht, schweigt - auch bei zwei Bot-Instanzen.
 *
 * Erst merken, dann senden: andersherum stuende die Nachricht nach einem
 * Absturz zwischen Senden und Merken ein zweites Mal im Kanal. Scheitert
 * dafuer das Senden nach dem Merken, fehlt eine Ankuendigung. Das ist die
 * ruhigere der beiden Moeglichkeiten - eine fehlende Nachricht faellt
 * niemandem auf die Nerven, eine doppelte schon.
 */
import { appUrl } from '@swisshub/config';
import { prisma, type Mission } from '@swisshub/database';
import { discord as defaultDiscord, type DiscordGateway } from '@swisshub/discord';
import type { DiscordEmbed } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { MISSIONS_ACCENT_COLOR, MISSIONS_MODULE_ID, type MissionsSettings } from './config';
import { getModuleSettings } from '../module-state';
import { missionTyp } from './typen';

const log = createLogger('missions:ankuendigung');

const zeitstempel = (datum: Date, stil: 'R' | 'f' = 'f'): string =>
  `<t:${Math.floor(datum.getTime() / 1000)}:${stil}>`;

function belohnungsText(mission: Mission): string {
  const teile: string[] = [];
  if (mission.belohnungXp > 0) {
    teile.push(`${mission.belohnungXp} XP`);
  }
  if (mission.belohnungPremiumTage > 0) {
    teile.push(`${mission.belohnungPremiumTage} Tage Premium`);
  }
  if (mission.belohnungAuszeichnung) {
    teile.push('eine Auszeichnung');
  }
  return teile.length > 0 ? teile.join(' und ') : 'die gemeinsame Ehre';
}

/** Den Start einer Mission ankuendigen - hoechstens einmal. */
export async function kuendigeStartAn(
  mission: Mission,
  gateway: DiscordGateway = defaultDiscord,
): Promise<boolean> {
  const settings = await getModuleSettings<MissionsSettings>(MISSIONS_MODULE_ID);
  if (!settings.announceStart || !settings.announcementChannelId) {
    return false;
  }

  const gewonnen = await prisma.mission.updateMany({
    where: { id: mission.id, angekuendigtStartAm: null },
    data: { angekuendigtStartAm: new Date() },
  });
  if (gewonnen.count !== 1) {
    return false;
  }

  const typ = missionTyp(mission.typ);
  const istChallenge = mission.art === 'CHALLENGE';

  const embed: DiscordEmbed = {
    title: istChallenge ? `Community Challenge: ${mission.titel}` : `Wochenmission: ${mission.titel}`,
    description: mission.beschreibung ?? typ?.erklaerung ?? undefined,
    color: MISSIONS_ACCENT_COLOR,
    fields: [
      {
        name: 'Ziel',
        value: istChallenge
          ? `${mission.ziel} ${typ?.einheit ?? ''} — gemeinsam als Server`
          : `${mission.ziel} ${typ?.einheit ?? ''}`,
        inline: true,
      },
      { name: 'Läuft bis', value: zeitstempel(mission.endetAm), inline: true },
      { name: 'Dafür gibt es', value: belohnungsText(mission), inline: false },
      ...(istChallenge
        ? [
            {
              name: 'Damit du mitzählst',
              value: `Mindestens ${mission.mindestBeitrag} ${typ?.einheit ?? ''} selbst beitragen.`,
              inline: false,
            },
          ]
        : []),
      { name: 'Dein Stand', value: `[In der WebApp ansehen](${appUrl('/missionen')})`, inline: false },
    ],
  };

  return sende(settings.announcementChannelId, embed, gateway, mission.id);
}

/** Das Ergebnis einer Mission ankuendigen - hoechstens einmal. */
export async function kuendigeAbschlussAn(
  mission: Mission,
  zielErreicht: boolean,
  belohnte: number,
  stand: number,
  gateway: DiscordGateway = defaultDiscord,
): Promise<boolean> {
  const settings = await getModuleSettings<MissionsSettings>(MISSIONS_MODULE_ID);
  if (!settings.announceAbschluss || !settings.announcementChannelId) {
    return false;
  }

  const gewonnen = await prisma.mission.updateMany({
    where: { id: mission.id, angekuendigtAbschlussAm: null },
    data: { angekuendigtAbschlussAm: new Date() },
  });
  if (gewonnen.count !== 1) {
    return false;
  }

  const typ = missionTyp(mission.typ);
  const istChallenge = mission.art === 'CHALLENGE';

  const embed: DiscordEmbed = {
    title: zielErreicht ? `Geschafft: ${mission.titel}` : `Vorbei: ${mission.titel}`,
    description: zielErreicht
      ? istChallenge
        ? `Gemeinsam ${stand} ${typ?.einheit ?? ''} — das Ziel von ${mission.ziel} steht.`
        : `${belohnte} Mitglieder haben das Ziel erreicht.`
      : istChallenge
        ? `Am Ende standen ${stand} von ${mission.ziel} ${typ?.einheit ?? ''}. Beim nächsten Mal.`
        : 'Diesmal hat es niemand geschafft. Beim nächsten Mal.',
    color: MISSIONS_ACCENT_COLOR,
    fields:
      zielErreicht && belohnte > 0
        ? [{ name: 'Belohnt', value: `${belohnte} Mitglieder`, inline: true }]
        : [],
  };

  return sende(settings.announcementChannelId, embed, gateway, mission.id);
}

async function sende(
  channelId: string,
  embed: DiscordEmbed,
  gateway: DiscordGateway,
  missionId: string,
): Promise<boolean> {
  try {
    await gateway.channels.send(channelId, { embeds: [embed] });
    return true;
  } catch (error) {
    log.warn('Ankündigung konnte nicht gesendet werden', { missionId, channelId, error });
    return false;
  }
}
