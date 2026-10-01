import { env } from '@swisshub/config';
import { prisma } from '@swisshub/database';
import type { EmojiAntrag } from '@swisshub/database';
import {
  discord as defaultDiscord,
  type DiscordGateway,
  type DiscordMessagePayload,
} from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { hmacSha256, safeEqual } from '@swisshub/shared/crypto';
import { getModuleSettings } from '../module-state';
import { EMOJI_MODULE_ID, type EmojiSettings } from './config';

const log = createLogger('emoji:discord');

/**
 * Die Discord-Seite des Emoji-Moduls.
 *
 * ## Zwei Nachrichten, zwei Zwecke
 *
 * Die **Moderationsmeldung** ist eine Arbeitsanweisung: sie steht im Kanal des
 * Teams, zeigt das vorgeschlagene Bild und trägt die Knöpfe «Annehmen»,
 * «Ablehnen» und «Abstimmen lassen». Sie wird **bearbeitet** und nicht neu
 * gesendet - sonst wächst der Kanal mit jedem Statuswechsel um eine Nachricht,
 * und am Ende weiss niemand, welche die aktuelle ist.
 *
 * Die **Abstimmungsnachricht** ist eine Einladung: sie steht im Kanal der
 * Community und trägt einen Knopf. Auch sie wird fortgeschrieben, damit der
 * Zwischenstand dort steht, wo geklickt wird.
 *
 * ## Warum das Bild über eine SwissHub-Adresse kommt
 *
 * Weil die Bytes im Upload-Verzeichnis liegen und nicht öffentlich. Das Embed
 * verweist auf eine Route, die prüft, ob der Abrufende sie sehen darf - ein
 * Verweis auf eine Datei im Verzeichnis gäbe es nicht, weil es keinen gibt.
 *
 * Solange SwissHub von aussen nicht erreichbar ist, bleibt das Embed ohne
 * Vorschaubild. Es nennt dann Grösse und Masse im Text - weniger schön,
 * aber nicht kaputt.
 */

const KNOPF_PRAEFIX = 'emoji';

export type KnopfArt = 'annehmen' | 'ablehnen' | 'abstimmung' | 'stimme';

/**
 * Eine Knopf-Kennung.
 *
 * Discord erlaubt 100 Zeichen. Präfix, Art und eine cuid (25) bleiben weit
 * darunter; geprüft wird es trotzdem, weil ein zu langer Wert erst beim Senden
 * auffällt und dann die ganze Nachricht verhindert.
 */
export function knopfId(art: KnopfArt, antragId: string): string {
  const id = `${KNOPF_PRAEFIX}:${art}:${antragId}`;
  if (id.length > 100) {
    throw new Error(`Knopf-Kennung zu lang für Discord (${id.length} Zeichen): ${id}`);
  }
  return id;
}

/**
 * Einen Klick zuordnen - oder `null`.
 *
 * `null` und kein Fehler: der Bot sieht jeden Klick auf dem Server, auch die
 * der anderen Module. Eine Ausnahme je fremdem Klick wäre ein Fehlerlog, das
 * sich selbst füllt.
 */
export function parseKnopfId(customId: string): { art: KnopfArt; antragId: string } | null {
  const teile = customId.split(':');
  if (teile.length !== 3 || teile[0] !== KNOPF_PRAEFIX) {
    return null;
  }
  const [, art, antragId] = teile;
  if (art !== 'annehmen' && art !== 'ablehnen' && art !== 'abstimmung' && art !== 'stimme') {
    return null;
  }
  // cuid: beginnt mit `c`, danach Kleinbuchstaben und Ziffern.
  if (!antragId || !/^c[a-z0-9]{20,30}$/u.test(antragId)) {
    return null;
  }
  return { art, antragId };
}

/**
 * Die Adresse, unter der das Vorschaubild eines Vorschlags liegt.
 *
 * ## Warum sie eine Signatur trägt
 *
 * Weil Discord das Vorschaubild **ohne Sitzung** holt: der CDN lädt die
 * Adresse aus dem Embed, und er hat kein Konto. Eine Route mit
 * `requireMember()` zeigte im Moderationskanal deshalb nie ein Bild.
 *
 * Also eine Adresse, die ohne Anmeldung geht - aber nicht erratbar ist. Die
 * Kennung allein wäre zu wenig: cuid ist kein Geheimnis. Angehängt wird
 * deshalb ein HMAC über die Kennung; ohne `AUTH_SECRET` lässt er sich nicht
 * herstellen, und er verrät nichts über andere Vorschläge.
 *
 * Was dadurch öffentlich ist: ein Bild, das ein Mitglied eingereicht hat, für
 * jeden, der den vollständigen Link hat. Das ist dieselbe Offenheit wie die
 * eines Discord-Anhangs - und von dort kommt es meist.
 */
export function vorschauPfad(antragId: string): string {
  return `/api/emoji/vorschau/${antragId}?s=${vorschauSignatur(antragId)}`;
}

/** Die Signatur zu einer Kennung - gekürzt, weil 32 Hexzeichen reichen. */
export function vorschauSignatur(antragId: string): string {
  return hmacSha256(env.AUTH_SECRET, `emoji-vorschau:${antragId}`).slice(0, 32);
}

/** Stimmt die Signatur? Zeitkonstant, damit sie sich nicht erraten lässt. */
export function vorschauSignaturGueltig(antragId: string, signatur: string): boolean {
  return safeEqual(vorschauSignatur(antragId), signatur);
}

function kb(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function herkunftstext(antrag: EmojiAntrag): string {
  /*
   * Nur Technik, keine Rechteaussage.
   *
   * «Hochgeladen» oder «von dieser Adresse geholt» ist, was SwissHub weiss.
   * Wem das Bild gehört, weiss es nicht - und ein Satz darüber wäre eine
   * Behauptung, für die niemand hier eine Grundlage hat.
   */
  const woher =
    antrag.herkunft === 'UPLOAD'
      ? 'im Dashboard hochgeladen'
      : antrag.herkunft === 'DISCORD_ANHANG'
        ? 'als Anhang in Discord geschickt'
        : 'von einer freigegebenen Adresse geholt';
  return antrag.herkunftNotiz ? `${woher} (${antrag.herkunftNotiz})` : woher;
}

const FARBE = {
  offen: 0x5865f2,
  abstimmung: 0xfaa61a,
  angenommen: 0x57f287,
  abgelehnt: 0xed4245,
  abgelaufen: 0x747f8d,
} as const;

function zustandstext(antrag: EmojiAntrag, stimmen: number): string {
  switch (antrag.status) {
    case 'OFFEN':
      return 'Wartet auf eine Entscheidung.';
    case 'ABSTIMMUNG':
      return `Abstimmung läuft: **${stimmen}** von **${antrag.stimmenZiel ?? '?'}** Stimmen.`;
    case 'ANGENOMMEN':
      return `Angenommen - liegt als \`:${antrag.emojiName ?? antrag.name}:\` auf dem Server.`;
    case 'ABGELEHNT':
      return antrag.ablehnungsGrund ? `Abgelehnt: ${antrag.ablehnungsGrund}` : 'Abgelehnt.';
    case 'ABGELAUFEN':
      /*
       * «Abgelaufen» ist keine Ablehnung, und der Text sagt das.
       *
       * Sonst liest der Antragsteller eine Entscheidung, die niemand getroffen
       * hat - und hört auf zu fragen.
       */
      return `Die Abstimmung endete mit **${stimmen}** von **${antrag.stimmenZiel ?? '?'}** Stimmen. Entschieden ist damit nichts.`;
  }
}

function farbe(antrag: EmojiAntrag): number {
  switch (antrag.status) {
    case 'OFFEN':
      return FARBE.offen;
    case 'ABSTIMMUNG':
      return FARBE.abstimmung;
    case 'ANGENOMMEN':
      return FARBE.angenommen;
    case 'ABGELEHNT':
      return FARBE.abgelehnt;
    case 'ABGELAUFEN':
      return FARBE.abgelaufen;
  }
}

/** Das Embed der Moderationsmeldung. */
export function moderationsPayload(
  antrag: EmojiAntrag,
  stimmen: number,
  optionen: { basisUrl?: string; abstimmungMoeglich?: boolean } = {},
): DiscordMessagePayload {
  const masze = antrag.breite && antrag.hoehe ? `${antrag.breite}×${antrag.hoehe} px, ` : '';
  const offen = antrag.status === 'OFFEN';

  return {
    embeds: [
      {
        title: `Emoji-Vorschlag: :${antrag.name}:`,
        description: zustandstext(antrag, stimmen),
        color: farbe(antrag),
        fields: [
          { name: 'Vorgeschlagen von', value: `<@${antrag.antragstellerId}>`, inline: true },
          { name: 'Art', value: antrag.animiert ? 'animiert' : 'fest', inline: true },
          { name: 'Datei', value: `${masze}${kb(antrag.bytes)}`, inline: true },
          { name: 'Herkunft', value: herkunftstext(antrag), inline: false },
          ...(antrag.begruendung ? [{ name: 'Begründung', value: antrag.begruendung }] : []),
        ],
        ...(optionen.basisUrl && (antrag.status === 'OFFEN' || antrag.status === 'ABSTIMMUNG')
          ? { thumbnail: { url: `${optionen.basisUrl}${vorschauPfad(antrag.id)}` } }
          : {}),
      },
    ],
    // Knöpfe nur, solange sie etwas tun. Ein Knopf an einem entschiedenen
    // Vorschlag ist eine Einladung zu einer Fehlermeldung.
    components: offen
      ? [
          {
            type: 1,
            components: [
              { type: 2, style: 3, label: 'Annehmen', custom_id: knopfId('annehmen', antrag.id) },
              { type: 2, style: 4, label: 'Ablehnen', custom_id: knopfId('ablehnen', antrag.id) },
              ...(optionen.abstimmungMoeglich
                ? ([
                    {
                      type: 2 as const,
                      style: 2 as const,
                      label: 'Abstimmen lassen',
                      custom_id: knopfId('abstimmung', antrag.id),
                    },
                  ] as const)
                : []),
            ],
          },
        ]
      : [],
  };
}

/** Das Embed der Abstimmung im Community-Kanal. */
export function abstimmungsPayload(
  antrag: EmojiAntrag,
  stimmen: number,
  optionen: { basisUrl?: string } = {},
): DiscordMessagePayload {
  const laeuft = antrag.status === 'ABSTIMMUNG';
  const ziel = antrag.stimmenZiel ?? 0;
  const frist = antrag.abstimmungEndetAm
    ? `<t:${Math.floor(antrag.abstimmungEndetAm.getTime() / 1000)}:R>`
    : 'offen';

  return {
    embeds: [
      {
        title: `Neues Emoji? :${antrag.name}:`,
        description: laeuft
          ? `**${stimmen}** von **${ziel}** Stimmen. Endet ${frist}.`
          : zustandstext(antrag, stimmen),
        color: farbe(antrag),
        footer: { text: `Vorgeschlagen von einem Mitglied · ${antrag.animiert ? 'animiert' : 'fest'}` },
        ...(optionen.basisUrl && laeuft
          ? { thumbnail: { url: `${optionen.basisUrl}${vorschauPfad(antrag.id)}` } }
          : {}),
      },
    ],
    components: laeuft
      ? [
          {
            type: 1,
            components: [
              {
                type: 2,
                style: 1,
                label: `Dafür (${stimmen}/${ziel})`,
                custom_id: knopfId('stimme', antrag.id),
              },
            ],
          },
        ]
      : [],
  };
}

async function stimmenVon(antragId: string): Promise<number> {
  return prisma.emojiStimme.count({ where: { antragId } });
}

export interface MeldungsOptionen {
  gateway?: DiscordGateway;
  basisUrl?: string;
  /** Nur eine bestehende Meldung fortschreiben - niemals eine neue anlegen. */
  nurAktualisieren?: boolean;
}

/**
 * Die Moderationsmeldung senden oder fortschreiben.
 *
 * Dasselbe Verfahren wie bei der Verifikation: liegt eine Kennung vor, wird
 * bearbeitet; schlägt das fehl (die Nachricht wurde gelöscht), wird neu
 * gesendet - **ausser** `nurAktualisieren` ist gesetzt. Dann ist der Vorgang
 * abgeschlossen, und eine neue Arbeitsanweisung für etwas Entschiedenes wäre
 * eine Aufforderung, die niemand erfüllen kann.
 */
export async function schreibeModerationsmeldung(
  antragId: string,
  optionen: MeldungsOptionen = {},
): Promise<void> {
  const gateway = optionen.gateway ?? defaultDiscord;
  const settings = await getModuleSettings<EmojiSettings>(EMOJI_MODULE_ID);
  const antrag = await prisma.emojiAntrag.findUnique({ where: { id: antragId } });
  if (!antrag || !settings.moderationChannelId) {
    return;
  }

  const payload = moderationsPayload(antrag, await stimmenVon(antragId), {
    ...(optionen.basisUrl ? { basisUrl: optionen.basisUrl } : {}),
    abstimmungMoeglich: settings.abstimmungAktiv,
  });

  if (antrag.modChannelId && antrag.modMessageId) {
    try {
      await gateway.channels.edit(antrag.modChannelId, antrag.modMessageId, payload);
      return;
    } catch (error) {
      if (optionen.nurAktualisieren) {
        log.debug('Moderationsmeldung nicht mehr vorhanden - kein Ersatz nötig', { antragId });
        return;
      }
      log.warn('Moderationsmeldung nicht auffindbar - wird neu gesendet', { antragId, error });
    }
  } else if (optionen.nurAktualisieren) {
    return;
  }

  try {
    const gesendet = await gateway.channels.send(settings.moderationChannelId, payload);
    await prisma.emojiAntrag.update({
      where: { id: antragId },
      data: { modChannelId: gesendet.channelId, modMessageId: gesendet.id },
    });
  } catch (error) {
    /*
     * Der Vorschlag steht trotzdem.
     *
     * Ein falsch gesetzter Kanal oder ein fehlendes Schreibrecht darf nicht
     * dazu führen, dass die Einreichung scheitert - im Dashboard ist sie
     * sichtbar, und dort kann das Team sie bearbeiten.
     */
    log.error('Moderationsmeldung konnte nicht gesendet werden', {
      antragId,
      channelId: settings.moderationChannelId,
      error,
    });
  }
}

/** Die Abstimmungsnachricht senden oder fortschreiben. */
export async function schreibeAbstimmungsnachricht(
  antragId: string,
  optionen: MeldungsOptionen = {},
): Promise<void> {
  const gateway = optionen.gateway ?? defaultDiscord;
  const settings = await getModuleSettings<EmojiSettings>(EMOJI_MODULE_ID);
  const antrag = await prisma.emojiAntrag.findUnique({ where: { id: antragId } });
  if (!antrag || !settings.abstimmungChannelId) {
    return;
  }

  const payload = abstimmungsPayload(antrag, await stimmenVon(antragId), {
    ...(optionen.basisUrl ? { basisUrl: optionen.basisUrl } : {}),
  });

  if (antrag.abstimmungChannelId && antrag.abstimmungMessageId) {
    try {
      await gateway.channels.edit(antrag.abstimmungChannelId, antrag.abstimmungMessageId, payload);
      return;
    } catch (error) {
      /*
       * Hier wird **nicht** neu gesendet.
       *
       * Eine Abstimmung, deren Nachricht jemand gelöscht hat, ein zweites Mal
       * zu stellen hiesse, denselben Vorschlag zweimal zur Wahl zu bringen -
       * mit einem Stimmenstand, der schon läuft. Der Stand steht weiter im
       * Dashboard.
       */
      log.warn('Abstimmungsnachricht nicht auffindbar', { antragId, error });
      return;
    }
  }

  if (optionen.nurAktualisieren || antrag.status !== 'ABSTIMMUNG') {
    return;
  }

  try {
    const gesendet = await gateway.channels.send(settings.abstimmungChannelId, payload);
    await prisma.emojiAntrag.update({
      where: { id: antragId },
      data: { abstimmungChannelId: gesendet.channelId, abstimmungMessageId: gesendet.id },
    });
  } catch (error) {
    log.error('Abstimmung konnte nicht gepostet werden', {
      antragId,
      channelId: settings.abstimmungChannelId,
      error,
    });
  }
}
