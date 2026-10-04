import { prisma, recordAudit, AUDIT_ACTIONS } from '@swisshub/database';
import { discord, type DiscordMessagePayload, type DiscordSelectOption } from '@swisshub/discord';
import { AppError, sanitizeText } from '@swisshub/shared';
import { createLogger } from '@swisshub/logger';
import { getModuleSettings, isModuleEnabled } from '../module-state';
import { listCachedRoles } from '../discord/sync';
import { SERVERROLLEN_MODULE_ID, type ServerrollenSettings } from './config';
import { botPosition } from './dienst';
import { pruefeSelbstzuweisung } from './sicherheit';

const log = createLogger('modules:serverrollen:embed');

/**
 * Eine Rollengruppe als Nachricht auf Discord.
 *
 * ## Warum ein Auswahlmenue und nicht Knoepfe
 *
 * Weil eine Gruppe wachsen darf. Discord erlaubt fuenf Knoepfe je Reihe und
 * fuenf Reihen; eine Gruppe «Spiele» mit zwanzig Rollen passt da nicht hinein,
 * und zwanzig Knoepfe waeren auch dort, wo sie passen, eine Wand. Ein Menue
 * traegt 25 Optionen, zeigt Beschreibungen und sagt im Platzhalter, worum es
 * geht.
 *
 * ## Warum eine Nachricht und nicht jedes Mal eine neue
 *
 * Weil eine alte Nachricht weiter bedient wird. Wer nach einer Rollenaenderung
 * eine zweite Nachricht postet, hat zwei Menues im Kanal - und das erste
 * zeigt Rollen, die es nicht mehr gibt. Darum steht die Nachrichtenkennung in
 * der Gruppe, und «aktualisieren» schreibt genau diese Nachricht neu.
 *
 * Verschwindet sie trotzdem - jemand hat sie geloescht -, dann sagt der
 * Zustand das, und veroeffentlichen legt eine neue an. Das ist der einzige
 * Weg, auf dem eine zweite Nachricht entsteht, und er beginnt mit einem
 * Klick.
 *
 * ## Was das Menue nicht kann
 *
 * **Es kann nicht anzeigen, was jemand schon hat.** Die Nachricht steht
 * einmal im Kanal und wird von allen gelesen; `default: true` an einer Option
 * waere fuer alle gesetzt. Discord hat dafuer keine personalisierte Ansicht.
 *
 * Daraus folgt die Bedienung: **die Auswahl ist der Wunsch**, nicht ein
 * Zusatz. Wer in einer Sammelgruppe «Valorant» und «CS2» waehlt, hat danach
 * genau diese beiden Rollen der Gruppe - eine dritte, die vorher gesetzt war,
 * faellt weg. So lassen sich Rollen auch ueber das Menue abgeben, ohne einen
 * zweiten Knopf dafuer. Die Antwort nennt beides, damit niemand raten muss.
 *
 * Bei einer Gruppe mit «nur eine Rolle» gibt es zusaetzlich die Option
 * «Keine» - sonst liesse sich die letzte Rolle nicht abgeben.
 */

/**
 * Der Namensraum der Interaktion.
 *
 * Hinten steht die **Gruppenkennung** und nicht die Rolle. Das ist der ganze
 * Punkt: welche Rollen erlaubt sind, liest der Server aus der Gruppe. Stuende
 * die Rolle in der Kennung, waere die entscheidende Angabe eine, die der
 * Client schickt.
 */
export const SERVERROLLEN_SELECT_PREFIX = 'swisshub:serverrollen:select:';

/** Der Wert der Option «Keine» - kein Rollenwert und deshalb nicht zu verwechseln. */
export const KEINE_WAHL = 'keine';

/** Die Gruppenkennung aus einer Interaktion - `null`, wenn sie nicht hierher gehoert. */
export function leseGruppenId(customId: string): string | null {
  if (!customId.startsWith(SERVERROLLEN_SELECT_PREFIX)) {
    return null;
  }
  const rest = customId.slice(SERVERROLLEN_SELECT_PREFIX.length).trim();
  return rest.length > 0 ? rest : null;
}

/** Discord nimmt hoechstens 25 Optionen je Menue. */
const MAX_OPTIONEN = 25;
/** Die Markenfarbe, wenn keine eingestellt ist. */
const VORGABE_FARBE = '#e11d2e';
const farbMuster = /^#[0-9a-fA-F]{6}$/u;

/** `#rrggbb` als Zahl, wie Discord sie erwartet. */
export function embedFarbzahl(hex: string | null): number {
  const sauber = (hex ?? '').trim();
  return Number.parseInt((farbMuster.test(sauber) ? sauber : VORGABE_FARBE).slice(1), 16);
}

export interface GruppenOption {
  discordRoleId: string;
  name: string;
  beschreibung: string | null;
  /**
   * Kann sich ein Mitglied diese Rolle selbst geben?
   *
   * Entscheidet, ob sie im **Menue** steht. Im Embed steht sie unabhaengig
   * davon: eine Gruppe erklaert ihre Rollen, auch die, die das Team vergibt.
   * Wer «Über 18» nur auf Nachfrage bekommt, soll trotzdem lesen koennen,
   * was sie bedeutet.
   */
  vergebbar: boolean;
}

/**
 * **Alle** Rollen einer Gruppe, mit Vermerk, ob sie vergebbar sind.
 *
 * Zwei Fragen, eine Abfrage: was das Embed auflistet (alles) und was im Menue
 * steht (das Vergebbare). Sie getrennt zu laden waere dieselbe Arbeit zweimal
 * - und zwei Gelegenheiten, dass die Listen auseinanderlaufen.
 *
 * Gefiltert wird nur, was es auf Discord nicht mehr gibt: eine Rolle ohne
 * Eintrag im Zwischenspeicher hat keinen Namen, keine Farbe und keine
 * Erwaehnung, die funktioniert.
 */
export async function gruppenRollen(categoryId: string): Promise<GruppenOption[]> {
  const einstellungen = await getModuleSettings<ServerrollenSettings>(SERVERROLLEN_MODULE_ID);
  const [metadaten, rollen, position] = await Promise.all([
    prisma.serverRoleMeta.findMany({ where: { categoryId }, orderBy: [{ sortOrder: 'asc' }] }),
    listCachedRoles(),
    botPosition(),
  ]);
  const nachId = new Map(rollen.map((rolle) => [rolle.id, rolle]));

  const offen: GruppenOption[] = [];
  for (const meta of metadaten) {
    const rolle = nachId.get(meta.discordRoleId);
    if (!rolle) {
      continue;
    }
    const urteil = pruefeSelbstzuweisung({
      rolle: { permissions: rolle.permissions, managed: rolle.managed, position: rolle.position },
      selfAssignable: meta.selfAssignable && einstellungen.selbstvergabeAktiv,
      botPosition: position,
      /*
       * Die Voraussetzung wird hier bewusst nicht geprueft.
       *
       * Das Menue steht fuer alle im Kanal; ob jemand die verlangte andere
       * Rolle hat, ist je Person verschieden. Eine Option auszublenden, weil
       * **irgendwer** sie nicht nehmen darf, waere falsch. Geprueft wird sie
       * beim Absenden - dort ist die Person bekannt.
       */
      voraussetzungRoleId: null,
    });
    offen.push({
      discordRoleId: rolle.id,
      name: rolle.name,
      beschreibung: meta.beschreibung,
      vergebbar: urteil.erlaubt,
    });
  }
  return offen;
}

/**
 * Nur die, die im Menue stehen duerfen.
 *
 * Gekappt auf 25: Discords Grenze fuer ein Auswahlmenue. Das Embed listet
 * weiter alle auf - dort gibt es diese Grenze nicht, nur die der Zeichenzahl.
 */
export async function waehlbareRollen(categoryId: string): Promise<GruppenOption[]> {
  return (await gruppenRollen(categoryId)).filter((rolle) => rolle.vergebbar).slice(0, MAX_OPTIONEN);
}

/**
 * Die Nachricht einer Gruppe - Embed und Menue.
 *
 * Immer aus dem aktuellen Stand gebaut: Titel, Text und Farbe aus der Gruppe,
 * die Optionen aus ihren Rollen. Nichts davon steht zweimal irgendwo
 * zwischengespeichert, und darum zeigt eine aktualisierte Nachricht genau,
 * was eingestellt ist.
 */
export async function baueGruppenNachricht(categoryId: string): Promise<DiscordMessagePayload> {
  const gruppe = await prisma.serverRoleCategory.findUnique({ where: { id: categoryId } });
  if (!gruppe) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Gruppe gibt es nicht.' });
  }

  const alle = await gruppenRollen(categoryId);
  const vergebbar = alle.filter((rolle) => rolle.vergebbar).slice(0, MAX_OPTIONEN);
  const titel = gruppe.embedTitel?.trim() || gruppe.name;
  const einleitung =
    gruppe.embedBeschreibung?.trim() ||
    gruppe.hinweis?.trim() ||
    (gruppe.exklusiv ? 'Wähle deine Rolle - die bisherige wird ersetzt.' : 'Wähle deine Rollen.');

  /*
   * Die Liste der Rollen - mit Erwaehnung und Beschreibung.
   *
   * ## Warum die Erwaehnung und nicht der Name
   *
   * Weil `<@&id>` auf Discord in der Farbe der Rolle erscheint und
   * anklickbar ist. Das ist dieselbe Darstellung, in der man die Rolle im
   * Chat kennt - ein abgeschriebener Name ist dagegen eine zweite Wahrheit,
   * die nach dem ersten Umbenennen falsch ist.
   *
   * ## Warum das niemanden anpingt
   *
   * Eine Erwaehnung in einem **Embed** benachrichtigt auf Discord ohnehin
   * niemanden. Zusaetzlich traegt die Nachricht `allowedMentions` mit leerem
   * `parse`, und das ist die eigentliche Zusage: auch wenn jemand spaeter
   * Text in den Nachrichtenkoerper legt, pingt diese Gruppe keine dreihundert
   * Leute an.
   *
   * ## Warum alle Rollen und nicht nur die vergebbaren
   *
   * Weil die Gruppe ihre Rollen **erklaert**. «Über 18» bekommt man vom Team,
   * nicht aus dem Menue - lesen soll man trotzdem koennen, was sie bedeutet
   * und dass es sie gibt. Was man selbst nehmen kann, sagt das Menue
   * darunter.
   */
  const zeilen = alle.map((rolle) => {
    const kopf = `<@&${rolle.discordRoleId}>`;
    return rolle.beschreibung ? `${kopf}\n${rolle.beschreibung}` : kopf;
  });

  const beschreibung = [einleitung, ...(zeilen.length > 0 ? ['', zeilen.join('\n\n')] : [])].join('\n');

  const optionen: DiscordSelectOption[] = vergebbar.map((rolle) => ({
    label: rolle.name.slice(0, 100),
    value: rolle.discordRoleId,
    ...(rolle.beschreibung ? { description: rolle.beschreibung.slice(0, 100) } : {}),
  }));

  /*
   * «Keine» nur in einer Exklusivgruppe.
   *
   * Dort ist es der einzige Weg zurueck: wer genau eine Rolle waehlen kann,
   * kann die letzte sonst nicht abgeben. In einer Sammelgruppe braucht es den
   * Eintrag nicht - dort heisst «nichts ausgewaehlt» schon «keine davon», und
   * eine Option, die dasselbe tut wie eine leere Auswahl, waere Ballast.
   */
  if (gruppe.exklusiv && optionen.length > 0) {
    optionen.push({
      label: 'Keine',
      value: KEINE_WAHL,
      description: 'Rolle dieser Gruppe abgeben',
    });
  }

  const embed = {
    title: titel.slice(0, 256),
    // Discords Grenze fuer eine Embed-Beschreibung sind 4096 Zeichen.
    description: beschreibung.slice(0, 4096),
    color: embedFarbzahl(gruppe.embedFarbe),
    ...(gruppe.exklusiv
      ? { footer: { text: 'Nur eine Rolle aus dieser Gruppe' } }
      : { footer: { text: 'Deine Auswahl ersetzt deine bisherigen Rollen dieser Gruppe' } }),
  };

  /*
   * Kein Pingen - unabhaengig davon, was im Text steht.
   *
   * Erwaehnungen in einem Embed benachrichtigen ohnehin niemanden; das hier
   * ist der Guertel zum Hosentraeger. Eine Rollengruppe mit dreihundert
   * Mitgliedern ist genau die Nachricht, bei der ein versehentlicher Ping
   * wehtut.
   */
  const stumm = { parse: [] as Array<'users' | 'roles' | 'everyone'> };

  if (optionen.length === 0) {
    /*
     * Keine vergebbare Rolle: kein Menue.
     *
     * Discord weist ein Auswahlmenue ohne Optionen ab, und ein abgeblendetes
     * Menue waere eine Tuer, die sichtbar verschlossen ist - ohne dass
     * jemand sie geoeffnet haben wollte. Das Embed bleibt und tut, was es
     * ohnehin tut: die Rollen der Gruppe erklaeren. Dass hier nichts zu
     * holen ist, steht als Satz darunter und nicht als graue Komponente.
     */
    return {
      embeds: [
        {
          ...embed,
          description:
            `${embed.description}\n\n*Diese Rollen vergibt das Team - hier gibt es nichts zu wählen.*`.slice(
              0,
              4096,
            ),
        },
      ],
      allowedMentions: stumm,
    };
  }

  return {
    embeds: [embed],
    allowedMentions: stumm,
    components: [
      {
        type: 1,
        components: [
          {
            type: 3,
            custom_id: `${SERVERROLLEN_SELECT_PREFIX}${gruppe.id}`,
            placeholder: gruppe.exklusiv ? 'Rolle wählen' : 'Rollen wählen',
            /*
             * `min_values: 0` ist kein Detail.
             *
             * Ohne die Null koennte niemand eine leere Auswahl absenden - und
             * genau das ist in einer Sammelgruppe das Abgeben der letzten
             * Rolle. In der Exklusivgruppe uebernimmt das die Option «Keine»;
             * beides zu haben schadet nicht und spart eine Sonderregel.
             */
            min_values: 0,
            max_values: gruppe.exklusiv ? 1 : optionen.length,
            options: optionen,
          },
        ],
      },
    ],
  };
}

export type EmbedZustand = 'nicht_veroeffentlicht' | 'veroeffentlicht' | 'nachricht_fehlt';

export interface EmbedStand {
  aktiv: boolean;
  channelId: string | null;
  messageId: string | null;
  titel: string | null;
  beschreibung: string | null;
  farbe: string | null;
  aktualisiertAm: Date | null;
  zustand: EmbedZustand;
  /** Wie viele Rollen im Menue stehen wuerden. */
  anzahlOptionen: number;
}

/**
 * Der Zustand des Embeds - fuer das Dashboard.
 *
 * Dass die Nachricht wirklich noch steht, wird **nachgefragt** und nicht aus
 * der gespeicherten Kennung geschlossen. Eine Kennung bleibt stehen, wenn
 * jemand die Nachricht im Kanal loescht; «veroeffentlicht» zu zeigen, wo
 * nichts mehr steht, waere die Auskunft, die man am wenigsten brauchen kann.
 */
export async function embedStand(categoryId: string): Promise<EmbedStand> {
  const gruppe = await prisma.serverRoleCategory.findUnique({ where: { id: categoryId } });
  if (!gruppe) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Gruppe gibt es nicht.' });
  }

  const anzahlOptionen = (await waehlbareRollen(categoryId)).length;
  const gemeinsam = {
    aktiv: gruppe.embedAktiv,
    channelId: gruppe.embedChannelId,
    messageId: gruppe.embedMessageId,
    titel: gruppe.embedTitel,
    beschreibung: gruppe.embedBeschreibung,
    farbe: gruppe.embedFarbe,
    aktualisiertAm: gruppe.embedAktualisiertAm,
    anzahlOptionen,
  };

  if (!gruppe.embedChannelId || !gruppe.embedMessageId) {
    return { ...gemeinsam, zustand: 'nicht_veroeffentlicht' };
  }

  const nachricht = await discord.channels
    .message(gruppe.embedChannelId, gruppe.embedMessageId)
    .catch(() => null);
  return { ...gemeinsam, zustand: nachricht ? 'veroeffentlicht' : 'nachricht_fehlt' };
}

export interface EmbedAkteur {
  discordId: string;
  username: string;
}

export interface EmbedEingabe {
  channelId?: string | null;
  titel?: string | null;
  beschreibung?: string | null;
  farbe?: string | null;
  aktiv?: boolean;
}

/** Die Textfelder des Embeds schreiben - ohne zu senden. */
export async function speichereEmbedEinstellungen(categoryId: string, eingabe: EmbedEingabe): Promise<void> {
  const gruppe = await prisma.serverRoleCategory.findUnique({ where: { id: categoryId } });
  if (!gruppe) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Gruppe gibt es nicht.' });
  }
  if (eingabe.farbe != null && eingabe.farbe.trim() !== '' && !farbMuster.test(eingabe.farbe.trim())) {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Die Farbe muss wie «#e11d2e» aussehen.' });
  }

  /*
   * Ein Kanalwechsel loest die alte Nachricht ab.
   *
   * Sie steht noch im alten Kanal, und von dort kann sie nicht mitgenommen
   * werden - Discord kennt kein Verschieben. Die Kennung zu behalten hiesse:
   * «aktualisieren» schreibt weiter in den alten Kanal, obwohl im Dashboard
   * ein neuer steht. Also wird sie vergessen, und der naechste Klick
   * veroeffentlicht neu. Die alte Nachricht wird vorher entfernt, damit kein
   * zweites Menue stehen bleibt.
   */
  const neuerKanal = eingabe.channelId !== undefined && eingabe.channelId !== gruppe.embedChannelId;
  if (neuerKanal && gruppe.embedChannelId && gruppe.embedMessageId) {
    await discord.channels
      .delete(gruppe.embedChannelId, gruppe.embedMessageId, 'Serverrollen: Kanal gewechselt')
      .catch((fehler: unknown) => {
        log.warn('Altes Rollenmenü liess sich nicht entfernen', {
          categoryId,
          grund: fehler instanceof Error ? fehler.message : 'unbekannt',
        });
      });
  }

  await prisma.serverRoleCategory.update({
    where: { id: categoryId },
    data: {
      ...(eingabe.channelId !== undefined ? { embedChannelId: eingabe.channelId || null } : {}),
      ...(eingabe.titel !== undefined
        ? { embedTitel: eingabe.titel ? sanitizeText(eingabe.titel, 120).trim() || null : null }
        : {}),
      ...(eingabe.beschreibung !== undefined
        ? {
            embedBeschreibung: eingabe.beschreibung
              ? sanitizeText(eingabe.beschreibung, 500).trim() || null
              : null,
          }
        : {}),
      ...(eingabe.farbe !== undefined ? { embedFarbe: eingabe.farbe?.trim() || null } : {}),
      ...(eingabe.aktiv !== undefined ? { embedAktiv: eingabe.aktiv } : {}),
      ...(neuerKanal ? { embedMessageId: null, embedAktualisiertAm: null } : {}),
    },
  });
}

/**
 * Veroeffentlichen oder aktualisieren.
 *
 * Eine Funktion fuer beides, weil es derselbe Vorgang ist: die Nachricht soll
 * danach den aktuellen Stand zeigen. Steht sie schon, wird sie geschrieben;
 * steht sie nicht - oder nicht mehr -, entsteht sie. Zwei getrennte Wege
 * waeren zwei Gelegenheiten, in den falschen Zustand zu laufen.
 */
export async function sendeGruppenEmbed(
  categoryId: string,
  akteur: EmbedAkteur,
): Promise<{ messageId: string; neu: boolean }> {
  if (!(await isModuleEnabled(SERVERROLLEN_MODULE_ID))) {
    throw new AppError('CONFLICT', { userMessage: 'Serverrollen sind derzeit ausgeschaltet.' });
  }
  const gruppe = await prisma.serverRoleCategory.findUnique({ where: { id: categoryId } });
  if (!gruppe) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Gruppe gibt es nicht.' });
  }
  if (!gruppe.embedChannelId) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Wähle zuerst einen Kanal für diese Gruppe.',
    });
  }

  const nachricht = await baueGruppenNachricht(categoryId);
  const channelId = gruppe.embedChannelId;

  let messageId = gruppe.embedMessageId;
  let neu = false;

  if (messageId) {
    try {
      await discord.channels.edit(channelId, messageId, nachricht);
    } catch (fehler) {
      /*
       * Die Nachricht ist weg - dann eine neue.
       *
       * Das ist kein Fehlerfall, den man melden muesste: jemand hat im Kanal
       * aufgeraeumt. Zu scheitern hiesse, dass die Gruppe auf Discord fuer
       * immer verstummt, bis jemand merkt, dass er «entfernen» und dann
       * «veroeffentlichen» klicken muss.
       */
      log.info('Rollenmenü war nicht mehr da - es wird neu gesendet', {
        categoryId,
        grund: fehler instanceof Error ? fehler.message : 'unbekannt',
      });
      messageId = null;
    }
  }

  if (!messageId) {
    const gesendet = await discord.channels.send(channelId, nachricht);
    messageId = gesendet.id;
    neu = true;
  }

  await prisma.serverRoleCategory.update({
    where: { id: categoryId },
    data: { embedMessageId: messageId, embedAktiv: true, embedAktualisiertAm: new Date() },
  });

  await recordAudit({
    action: neu ? AUDIT_ACTIONS.SERVERROLE_EMBED_PUBLISHED : AUDIT_ACTIONS.SERVERROLE_EMBED_UPDATED,
    module: SERVERROLLEN_MODULE_ID,
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username,
    targetLabel: gruppe.name,
    success: true,
    metadata: {
      categoryId,
      channelId,
      messageId,
      exklusiv: gruppe.exklusiv,
      optionen:
        (nachricht.components?.[0]?.components[0] as { options?: unknown[] } | undefined)?.options?.length ??
        0,
    },
  });

  return { messageId, neu };
}

/**
 * Die Nachricht entfernen.
 *
 * Geloescht wird auf Discord **und** vergessen in der Datenbank. Nur zu
 * vergessen hiesse, ein bedienbares Menue stehen zu lassen, das niemand mehr
 * aktualisiert; nur zu loeschen hiesse, dass das Dashboard weiter von einer
 * Nachricht erzaehlt, die es nicht gibt.
 *
 * Ist die Nachricht schon weg, ist das kein Fehler - das Ziel ist erreicht.
 */
export async function entferneGruppenEmbed(categoryId: string, akteur: EmbedAkteur): Promise<void> {
  const gruppe = await prisma.serverRoleCategory.findUnique({ where: { id: categoryId } });
  if (!gruppe) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Gruppe gibt es nicht.' });
  }

  if (gruppe.embedChannelId && gruppe.embedMessageId) {
    await discord.channels
      .delete(gruppe.embedChannelId, gruppe.embedMessageId, 'Serverrollen: Menü entfernt')
      .catch((fehler: unknown) => {
        log.info('Rollenmenü war schon weg', {
          categoryId,
          grund: fehler instanceof Error ? fehler.message : 'unbekannt',
        });
      });
  }

  await prisma.serverRoleCategory.update({
    where: { id: categoryId },
    data: { embedMessageId: null, embedAktiv: false, embedAktualisiertAm: null },
  });

  await recordAudit({
    action: AUDIT_ACTIONS.SERVERROLE_EMBED_REMOVED,
    module: SERVERROLLEN_MODULE_ID,
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username,
    targetLabel: gruppe.name,
    success: true,
    metadata: { categoryId, channelId: gruppe.embedChannelId, messageId: gruppe.embedMessageId },
  });
}

/**
 * Das Menue einer Gruppe neu schreiben, wenn sich etwas geaendert hat.
 *
 * Still und ohne Audit: das ist Nachfuehren und keine Entscheidung. Wer eine
 * Rolle zur Gruppe legt, will nicht zusaetzlich «aktualisieren» klicken
 * muessen - und ein Eintrag im Log je Textaenderung waere Rauschen.
 *
 * Fehlschlaege werden geschluckt. Die Aenderung an der Gruppe ist das
 * Wesentliche; dass die Nachricht auf Discord einen Moment aelter ist, darf
 * das Speichern nicht umwerfen.
 */
export async function frischeGruppenEmbedAuf(categoryId: string): Promise<void> {
  const gruppe = await prisma.serverRoleCategory.findUnique({
    where: { id: categoryId },
    select: { embedAktiv: true, embedChannelId: true, embedMessageId: true },
  });
  if (!gruppe?.embedAktiv || !gruppe.embedChannelId || !gruppe.embedMessageId) {
    return;
  }
  try {
    const nachricht = await baueGruppenNachricht(categoryId);
    await discord.channels.edit(gruppe.embedChannelId, gruppe.embedMessageId, nachricht);
    await prisma.serverRoleCategory.update({
      where: { id: categoryId },
      data: { embedAktualisiertAm: new Date() },
    });
  } catch (fehler) {
    log.warn('Rollenmenü liess sich nicht nachführen', {
      categoryId,
      grund: fehler instanceof Error ? fehler.message : 'unbekannt',
    });
  }
}
