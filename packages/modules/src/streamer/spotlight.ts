import { AUDIT_ACTIONS, prisma, recordAudit } from '@swisshub/database';
import { appUrl } from '@swisshub/config';
import { discord as defaultDiscord, BUTTON_STYLE, type DiscordGateway } from '@swisshub/discord';
import { AppError, sanitizeText, systemRoutes } from '@swisshub/shared';
import { createLogger } from '@swisshub/logger';
import type { StreamerSpotlight } from '@swisshub/database';
import { STREAMER_ACCENT_COLOR, STREAMER_MODULE_ID, type StreamerSettings } from './config';
import { getModuleSettings } from '../module-state';
import { ladeOeffentlichenStreamer, type OeffentlicherStreamer } from './oeffentlich';
import { plattform } from './plattform';

/**
 * Streamer Spotlight - der Social-Media-Entwurf.
 *
 * ## Was gespeichert wird, und was nicht
 *
 * Gespeichert wird **redaktioneller Text**: Ueberschrift, Beschreibung,
 * Handlungsaufruf. Das sind die Felder, an denen jemand feilen soll.
 *
 * Nicht gespeichert werden Name, Spiele, Plattform, Kanaladresse oder
 * Profilbild. Die kommen beim Zeichnen aus `ladeOeffentlichenStreamer` - also
 * aus genau derselben Quelle, aus der auch die oeffentliche Seite liest.
 *
 * Der Grund ist derselbe wie bei den Abstimmungszahlen in «SwissHub fragt»: was
 * nicht gespeichert ist, kann nicht abweichen von dem, was stimmt. Ein Name in
 * einer Spotlight-Zeile wuerde nach einer Umbenennung falsch - und niemand
 * merkte es, bis die Grafik auf Instagram steht.
 *
 * Daraus folgt auch die Antwort auf §10.1: nur freigegebene Daten. Ein Streamer,
 * dessen Spiele privat sind, hat keine Spiele auf der Grafik - nicht weil das
 * Studio sie filtert, sondern weil die oeffentliche Ansicht sie nicht enthaelt.
 *
 * ## Warum nichts von selbst nach Instagram geht
 *
 * Weil es dafuer keine Schnittstelle gibt und in dieser Fassung keine geben
 * soll. Ein Spotlight ist eine PNG-Datei zum Herunterladen. Der Weg auf
 * Instagram geht durch einen Menschen - und «als veroeffentlicht markieren»
 * ist Buchhaltung, keine Veroeffentlichung.
 */

const log = createLogger('streamer:spotlight');

const fehler = (text: string): never => {
  throw new AppError('VALIDATION_FAILED', { userMessage: text });
};

const sauber = (text: string | null | undefined, grenze: number): string | null => {
  const bereinigt = sanitizeText(text ?? '')
    .trim()
    .slice(0, grenze);
  return bereinigt === '' ? null : bereinigt;
};

/** Die Vorschlagstexte eines frischen Entwurfs. */
export function vorschlag(streamer: OeffentlicherStreamer): {
  ueberschrift: string;
  beschreibung: string;
  cta: string;
} {
  const spiel = streamer.spiele[0]?.name;
  return {
    ueberschrift: 'STREAMER SPOTLIGHT',
    beschreibung:
      streamer.beschreibung ??
      (spiel
        ? `${streamer.name} streamt ${spiel} aus der SwissHub-Community.`
        : `${streamer.name} streamt aus der SwissHub-Community.`),
    cta: 'Folge dem Kanal und schau vorbei.',
  };
}

/**
 * Einen Entwurf anlegen.
 *
 * Nur fuer freigegebene Streamer mit oeffentlicher Seite: aus einem Profil, das
 * es oeffentlich nicht gibt, laesst sich keine Grafik bauen, die man zeigen
 * darf.
 */
export async function erstelleSpotlight(
  profilId: string,
  actorDiscordId: string,
): Promise<StreamerSpotlight> {
  const profil = await prisma.streamerProfil.findUnique({
    where: { id: profilId },
    select: { id: true, status: true, discordId: true },
  });
  if (!profil) {
    fehler('Diesen Streamer gibt es nicht.');
    throw new Error('unerreichbar');
  }
  if (profil.status !== 'APPROVED') {
    fehler('Nur ein freigegebener Streamer lässt sich vorstellen.');
  }

  const mitgliedsprofil = await prisma.memberProfile.findUnique({
    where: { discordId: profil.discordId },
    select: { publicSlug: true },
  });
  const streamer = mitgliedsprofil?.publicSlug
    ? await ladeOeffentlichenStreamer(mitgliedsprofil.publicSlug)
    : null;
  if (!streamer) {
    fehler(
      'Dieser Streamer hat keine öffentliche Seite. Solange sein Profil nicht öffentlich steht, gibt es keine freigegebenen Daten für eine Grafik.',
    );
    throw new Error('unerreichbar');
  }

  const texte = vorschlag(streamer);
  return prisma.streamerSpotlight.create({
    data: {
      profilId,
      erstelltVon: actorDiscordId,
      ueberschrift: texte.ueberschrift,
      beschreibung: texte.beschreibung,
      cta: texte.cta,
    },
  });
}

export async function bearbeiteSpotlight(
  spotlightId: string,
  eingabe: { ueberschrift?: string; beschreibung?: string; cta?: string },
): Promise<StreamerSpotlight> {
  const bestehend = await prisma.streamerSpotlight.findUnique({ where: { id: spotlightId } });
  if (!bestehend) {
    fehler('Diesen Entwurf gibt es nicht.');
    throw new Error('unerreichbar');
  }
  if (bestehend.status === 'VEROEFFENTLICHT') {
    /*
     * Ein veroeffentlichter Entwurf bleibt, wie er war. Sonst zeigte die
     * Nachricht auf Discord einen anderen Text als den, der hier steht - und
     * niemand koennte nachvollziehen, was tatsaechlich gesendet wurde.
     */
    fehler('Dieser Spotlight ist veröffentlicht und lässt sich nicht mehr ändern.');
  }
  return prisma.streamerSpotlight.update({
    where: { id: spotlightId },
    data: {
      ...(eingabe.ueberschrift !== undefined ? { ueberschrift: sauber(eingabe.ueberschrift, 60) } : {}),
      ...(eingabe.beschreibung !== undefined ? { beschreibung: sauber(eingabe.beschreibung, 280) } : {}),
      ...(eingabe.cta !== undefined ? { cta: sauber(eingabe.cta, 80) } : {}),
    },
  });
}

export interface SpotlightDaten {
  spotlight: StreamerSpotlight;
  /** Die freigegebenen Daten - dieselbe Quelle wie die oeffentliche Seite. */
  streamer: OeffentlicherStreamer;
}

/**
 * Alles, was zum Zeichnen gebraucht wird.
 *
 * Die eine Stelle, die Vorschau und Export versorgt. Zwei Stellen waeren zwei
 * Datensaetze, und der Export saehe irgendwann anders aus als die Vorschau -
 * genau das, was §10.4 ausschliesst.
 */
export async function holeSpotlightDaten(spotlightId: string): Promise<SpotlightDaten | null> {
  const spotlight = await prisma.streamerSpotlight.findUnique({
    where: { id: spotlightId },
    include: { profil: { select: { discordId: true, status: true } } },
  });
  if (!spotlight) {
    return null;
  }
  const mitgliedsprofil = await prisma.memberProfile.findUnique({
    where: { discordId: spotlight.profil.discordId },
    select: { publicSlug: true },
  });
  if (!mitgliedsprofil?.publicSlug) {
    return null;
  }
  const streamer = await ladeOeffentlichenStreamer(mitgliedsprofil.publicSlug);
  if (!streamer) {
    return null;
  }
  return { spotlight, streamer };
}

export async function finalisiere(spotlightId: string): Promise<StreamerSpotlight> {
  const ergebnis = await prisma.streamerSpotlight.updateMany({
    where: { id: spotlightId, status: 'DRAFT' },
    data: { status: 'FINAL' },
  });
  if (ergebnis.count === 0) {
    fehler('Nur ein Entwurf lässt sich abschliessen.');
  }
  const frisch = await prisma.streamerSpotlight.findUnique({ where: { id: spotlightId } });
  if (!frisch) {
    throw new Error('Der Spotlight ist verschwunden, während er abgeschlossen wurde.');
  }
  return frisch;
}

export interface Veroeffentlichung {
  gesendet: boolean;
  grund?: string;
}

/**
 * Einen Spotlight auf Discord senden - hoechstens einmal.
 *
 * Die Belegung ist derselbe Mechanismus wie bei den Live-Ankuendigungen, nur an
 * einem anderen Feld: `updateMany` mit der Bedingung «noch keine Kennung». Wer
 * sie setzen konnte, sendet; wer nicht, schweigt. Zwei Klicks auf dieselbe
 * Schaltflaeche ergeben eine Nachricht.
 *
 * Es gibt keinen Weg, das automatisch auszuloesen: diese Funktion wird
 * ausschliesslich von einer Server Action mit `streamer.publish` gerufen. Kein
 * Job ruft sie.
 */
export async function veroeffentlicheAufDiscord(
  spotlightId: string,
  actorDiscordId: string,
  gateway: DiscordGateway = defaultDiscord,
): Promise<Veroeffentlichung> {
  const settings = await getModuleSettings<StreamerSettings>(STREAMER_MODULE_ID);
  if (settings.spotlightChannelId === '') {
    return {
      gesendet: false,
      grund: 'Es ist kein Spotlight-Kanal eingestellt. System → Module → Streamer Hub.',
    };
  }

  const daten = await holeSpotlightDaten(spotlightId);
  if (!daten) {
    return {
      gesendet: false,
      grund: 'Diesen Entwurf gibt es nicht mehr, oder der Streamer ist nicht öffentlich.',
    };
  }

  const platzhalter = `pending:${Date.now()}`;
  const belegt = await prisma.streamerSpotlight.updateMany({
    where: { id: spotlightId, discordMessageId: null },
    data: { discordMessageId: platzhalter },
  });
  if (belegt.count === 0) {
    return { gesendet: false, grund: 'Dieser Spotlight wurde schon veröffentlicht.' };
  }

  const { streamer, spotlight } = daten;
  const hauptkanal = streamer.kanaele[0];
  const seite = `${appUrl()}${systemRoutes.streamerOeffentlichProfil(streamer.slug)}`;

  try {
    const gesendet = await gateway.channels.send(settings.spotlightChannelId, {
      allowedMentions: { parse: [] },
      embeds: [
        {
          title: spotlight.ueberschrift ?? 'Streamer Spotlight',
          description: [`**${streamer.name}**`, spotlight.beschreibung ?? '', spotlight.cta ?? '']
            .filter((zeile) => zeile !== '')
            .join('\n\n'),
          url: seite,
          color: STREAMER_ACCENT_COLOR,
          ...(streamer.avatarHash
            ? {
                thumbnail: {
                  url: `https://cdn.discordapp.com/avatars/${streamer.discordId}/${streamer.avatarHash}.png?size=256`,
                },
              }
            : {}),
          fields: [
            ...(streamer.spiele.length > 0
              ? [
                  {
                    name: 'Spielt',
                    value: streamer.spiele.map((spiel) => spiel.name).join(', '),
                    inline: true,
                  },
                ]
              : []),
            ...(hauptkanal
              ? [{ name: 'Plattform', value: plattform(hauptkanal.plattform).label, inline: true }]
              : []),
          ],
          footer: { text: 'SwissHub Streamer Hub' },
        },
      ],
      components: hauptkanal
        ? [
            {
              type: 1,
              components: [
                {
                  type: 2,
                  style: BUTTON_STYLE.LINK,
                  label: `Auf ${plattform(hauptkanal.plattform).label} folgen`,
                  url: hauptkanal.adresse,
                },
                { type: 2, style: BUTTON_STYLE.LINK, label: 'Streamer-Profil', url: seite },
              ],
            },
          ]
        : undefined,
    });

    await prisma.streamerSpotlight.updateMany({
      where: { id: spotlightId, discordMessageId: platzhalter },
      data: {
        discordMessageId: gesendet.id,
        discordChannelId: settings.spotlightChannelId,
        veroeffentlichtAm: new Date(),
        status: 'VEROEFFENTLICHT',
      },
    });

    await recordAudit({
      action: AUDIT_ACTIONS.STREAMER_SPOTLIGHT_PUBLISHED,
      module: STREAMER_MODULE_ID,
      actorDiscordId,
      targetDiscordId: streamer.discordId,
      success: true,
      metadata: { spotlightId, kanal: settings.spotlightChannelId },
    });
    log.info('Spotlight veröffentlicht', { spotlightId });
    return { gesendet: true };
  } catch (ursache) {
    /*
     * Den Platz wieder freigeben - aber nur den eigenen. Ohne das waere ein
     * Discord-Fehler ein Entwurf, der sich nie mehr veroeffentlichen laesst.
     */
    await prisma.streamerSpotlight.updateMany({
      where: { id: spotlightId, discordMessageId: platzhalter },
      data: { discordMessageId: null },
    });
    const grund = ursache instanceof Error ? ursache.message : String(ursache);
    log.warn('Spotlight konnte nicht gesendet werden', { spotlightId, grund });
    return { gesendet: false, grund };
  }
}

/** Die Entwürfe - neueste zuerst. */
export async function listeSpotlights(
  grenze = 30,
): Promise<Array<StreamerSpotlight & { anzeigename: string; slug: string | null }>> {
  const entwuerfe = await prisma.streamerSpotlight.findMany({
    take: grenze,
    orderBy: { createdAt: 'desc' },
    include: { profil: { select: { discordId: true } } },
  });
  if (entwuerfe.length === 0) {
    return [];
  }
  const discordIds = [...new Set(entwuerfe.map((entwurf) => entwurf.profil.discordId))];
  const [mitglieder, profile] = await Promise.all([
    prisma.discordMemberCache.findMany({
      where: { discordId: { in: discordIds } },
      select: { discordId: true, displayName: true, username: true },
    }),
    prisma.memberProfile.findMany({
      where: { discordId: { in: discordIds } },
      select: { discordId: true, displayName: true, publicSlug: true },
    }),
  ]);
  const nachId = new Map(mitglieder.map((eintrag) => [eintrag.discordId, eintrag]));
  const profilNachId = new Map(profile.map((eintrag) => [eintrag.discordId, eintrag]));

  return entwuerfe.map((entwurf) => {
    const mitglied = nachId.get(entwurf.profil.discordId);
    const profil = profilNachId.get(entwurf.profil.discordId);
    return {
      ...entwurf,
      anzeigename:
        profil?.displayName?.trim() ||
        mitglied?.displayName?.trim() ||
        mitglied?.username?.trim() ||
        'Unbekannt',
      slug: profil?.publicSlug ?? null,
    };
  });
}
