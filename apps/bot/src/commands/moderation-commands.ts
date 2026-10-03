import { ApplicationCommandOptionType, MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { appUrl } from '@swisshub/config';
import { createLogger } from '@swisshub/logger';
import { AppError, systemRoutes } from '@swisshub/shared';
import { MEMBER_PERMISSIONS } from '@swisshub/permissions';
import { members, profile } from '@swisshub/modules';
import { prisma } from '@swisshub/database';
import { resolveGuildId } from '@swisshub/discord';
import { buildCommandActor, NO_PERMISSION, type CommandActor } from './context';

const log = createLogger('bot:commands:moderation');

/**
 * `/note` und `/user` - die Moderationsbefehle.
 *
 * ## Was sie sind
 *
 * Zwei Fenster in Daten, die es schon gibt. `/note` zeigt die internen
 * Notizen aus dem Member Center, `/user` eine kurze Übersicht über ein
 * Mitglied. Beide **lesen nur**.
 *
 * ## Warum keine eigene Datenhaltung
 *
 * Weil es für dieselbe Sache nur eine Wahrheit geben darf. Eine Notiz, die
 * über Discord entsteht und in einer zweiten Tabelle landet, ist eine Notiz,
 * die im Member Center fehlt - und umgekehrt. Die Folge wäre nicht
 * «doppelte Pflege», sondern eine Moderation, die nicht weiss, was über
 * jemanden vermerkt ist.
 *
 * Deshalb: `members.listMemberNotes` und `members.getMemberSummary`,
 * dieselben Funktionen wie im Dashboard. Diese Datei ist ein Adapter von
 * Discord auf das Modul und enthält keine Fachlogik - **auch keine
 * Berechtigungslogik**: `darfSehen` entscheidet, und zwar dasselbe
 * `darfSehen`, das die Profilseite abschnittsweise fragt.
 *
 * ## Warum immer ephemer
 *
 * Eine Notiz ist eine Einschätzung von Menschen über Menschen. Sie geht
 * niemanden ausser dem Team etwas an - nicht den Kanal, in dem der Befehl
 * getippt wurde, und auch nicht die betroffene Person. `/user` ist dasselbe
 * in schwächerer Form: Beitrittsdatum und Rollen sind nicht geheim, aber die
 * Zusammenstellung ist eine Abfrage und keine Mitteilung.
 *
 * Es gibt deshalb keinen Pfad in dieser Datei, der ohne
 * `MessageFlags.Ephemeral` antwortet.
 *
 * ## Was nie in einer Antwort steht
 *
 * Keine Zugangsdaten, keine E-Mail-Adresse, keine OAuth-Angaben, keine
 * Sitzungskennungen. `/user` sagt, **ob** jemand ein SwissHub-Konto hat, und
 * nicht mehr - das ist für die Moderation die Frage («kann ich ihm einen
 * WebApp-Link schicken?»), und alles Weitere wäre ein Datenabfluss über einen
 * Chatbefehl.
 */

/** Der Rollenname der Berechtigung, die beide Befehle voraussetzen. */
const EINTRITT = MEMBER_PERMISSIONS.view;

/**
 * Die Laengengrenze einer Notiz - Discord soll dasselbe erlauben wie das Modul.
 *
 * `members.NOTIZ_MAX` ist die Grenze, an der `pruefeNotiz` abweist. Stuende
 * hier eine groessere Zahl, liesse Discord einen Text zu, den die Fachschicht
 * ablehnt; stuende hier eine kleinere, waere Discord strenger als die WebApp
 * und niemand wuesste warum. Discord erlaubt fuer eine Option hoechstens 6000
 * Zeichen, darum die Deckelung.
 */
const NOTIZ_MAX = Math.min(members.NOTIZ_MAX, 6000);

/**
 * Der einzige Antwortweg dieser Datei.
 *
 * ## Warum eine Funktion und nicht `editReply` an acht Stellen
 *
 * Wegen `allowedMentions`. Die Antworten enthalten `<@id>`, weil Discord
 * daraus den Namen macht - nicht, um jemanden zu rufen. Ohne
 * `allowedMentions: { parse: [] }` löst jede davon eine Benachrichtigung aus,
 * und das ist bei einer Notiz über diese Person besonders unangenehm.
 *
 * Acht `editReply`-Aufrufe sind acht Gelegenheiten, es zu vergessen - und die
 * eine, die man vergisst, ist die auf dem seltenen Pfad: «keine Notizen»,
 * «nicht auf dem Server», die Absage. Genau das war hier schon einmal der
 * Fall, und der Test dazu hat es gefunden. Deshalb gibt es jetzt nur noch
 * diesen Weg hinaus.
 *
 * Gekürzt wird hier ebenfalls: eine Discord-Nachricht fasst 2000 Zeichen, und
 * eine abgeschnittene Nachricht ist besser als eine abgewiesene.
 */
interface Antwort {
  /** Ein Satz - fuer Absagen und Hinweise, fuer die ein Embed zu viel waere. */
  text?: string;
  /** Die Karte - fuer alles, was Struktur hat. */
  embed?: Embed;
  /** Ein Link in die WebApp. Nur Link-Knoepfe: sie brauchen keinen Handler. */
  knopf?: { label: string; url: string };
}

async function antworte(interaction: ChatInputCommandInteraction, antwort: Antwort): Promise<void> {
  await interaction.editReply({
    ...(antwort.text ? { content: kurz(antwort.text, 1900) } : {}),
    ...(antwort.embed ? { embeds: [antwort.embed] } : {}),
    /*
     * Knoepfe nur als Link.
     *
     * Ein Link-Knopf loest keine Interaktion aus - Discord oeffnet die
     * Adresse, und der Bot erfaehrt nichts davon. Deshalb braucht er keinen
     * Eintrag im Interaktions-Verteiler und kann hier nicht zu einem
     * Knopf werden, auf den niemand antwortet. Ein Knopf mit `custom_id`
     * waere genau das, solange ihn kein Handler kennt.
     */
    ...(antwort.knopf
      ? {
          components: [
            {
              type: 1,
              components: [{ type: 2, style: 5, label: antwort.knopf.label, url: antwort.knopf.url }],
            },
          ],
        }
      : {}),
    allowedMentions: { parse: [] },
  });
}

/**
 * Die Farbe der Moderationskarten.
 *
 * Derselbe Ton wie die Jail-Liste - das ist die Farbe, die das Team an
 * Moderationsantworten schon kennt. Eine zweite waere eine zweite Sprache
 * fuer dieselbe Sache.
 */
const MODERATIONSFARBE = 0x83060a;

/** Ein Embed, wie Discord es erwartet - nur die Felder, die hier vorkommen. */
interface Embed {
  title?: string;
  description?: string;
  color?: number;
  author?: { name: string; icon_url?: string };
  thumbnail?: { url: string };
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: { text: string };
}

/**
 * Ein Feld fuer ein Embed - oder nichts.
 *
 * Discord weist ein Embed mit einem leeren `value` ab. Ein Abschnitt, fuer
 * den es keine Daten gibt, soll aber nicht die ganze Antwort kosten - und
 * «unbekannt» hinzuschreiben waere eine Angabe, wo keine ist.
 */
function feld(name: string, wert: string | null, inline = true): NonNullable<Embed['fields']> {
  const inhalt = (wert ?? '').trim();
  return inhalt === '' ? [] : [{ name, value: kurz(inhalt, 1024), inline }];
}

export const MODERATION_COMMAND_DEFINITIONS = [
  {
    name: 'note',
    description: 'Notize zu eme Mitglied aalueg oder eini erfasse (nur für s Team).',
    dmPermission: false,
    options: [
      {
        name: 'user',
        description: 'Wäm sini Notize?',
        type: ApplicationCommandOptionType.User,
        required: true,
      },
      {
        /*
         * Der optionale Schreibweg.
         *
         * Ohne diesen Wert liest der Befehl, mit ihm schreibt er - und zeigt
         * danach dieselbe Liste wie sonst. Zwei Befehle (`/note` und
         * `/note_add`) waeren zwei Namen fuer eine Akte; so bleibt es ein
         * Befehl, und der Unterschied steht im Aufruf.
         */
        name: 'note',
        description: 'Neui Notiz - wenn leer, wird nur glese.',
        type: ApplicationCommandOptionType.String,
        required: false,
        max_length: NOTIZ_MAX,
      },
    ],
  },
  {
    name: 'user',
    description: 'Churzi Übersicht zu eme Mitglied (nur für s Team).',
    dmPermission: false,
    options: [
      {
        name: 'user',
        description: 'Über wän?',
        type: ApplicationCommandOptionType.User,
        required: true,
      },
    ],
  },
] as const;

export const MODERATION_COMMAND_NAMES = new Set(
  MODERATION_COMMAND_DEFINITIONS.map((eintrag) => eintrag.name),
);

type ModerationCommandName = (typeof MODERATION_COMMAND_DEFINITIONS)[number]['name'];

/**
 * Der `MemberViewer` aus dem Befehlskontext.
 *
 * Dieselbe Form, die das Dashboard an `darfSehen` gibt: Kennung, aktuelle
 * Discord-Rollen und `can`. Es gibt bewusst keine zweite Ableitung der Rechte
 * - sie wäre genau die Stelle, an der Discord und Dashboard auseinanderliefen.
 */
function alsBetrachter(actor: CommandActor): members.MemberViewer {
  return {
    discordId: actor.discordId,
    roleIds: actor.roleIds,
    can: (permission) => actor.can(permission),
  };
}

/** Ein Datum, wie es ein Mensch in der Schweiz liest. */
function datum(wert: Date | null): string {
  if (!wert) {
    return 'unbekannt';
  }
  return wert.toLocaleString('de-CH', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Zurich',
  });
}

/**
 * Wie lange etwas her ist - in Tagen, Monaten oder Jahren.
 *
 * Für die Moderation ist «seit drei Tagen dabei» die Auskunft, nicht das
 * Datum. Beides steht da, weil das eine die Einordnung und das andere der
 * Beleg ist.
 */
export function alter(wert: Date | null, jetzt = new Date()): string {
  if (!wert) {
    return 'unbekannt';
  }
  const tage = Math.max(0, Math.floor((jetzt.getTime() - wert.getTime()) / 86_400_000));
  if (tage < 1) {
    return 'heute';
  }
  if (tage < 31) {
    return `${tage} ${tage === 1 ? 'Tag' : 'Tage'}`;
  }
  if (tage < 365) {
    const monate = Math.floor(tage / 30);
    return `${monate} ${monate === 1 ? 'Monat' : 'Monate'}`;
  }
  const jahre = Math.floor(tage / 365);
  const rest = Math.floor((tage % 365) / 30);
  return rest > 0
    ? `${jahre} ${jahre === 1 ? 'Jahr' : 'Jahre'}, ${rest} ${rest === 1 ? 'Monat' : 'Monate'}`
    : `${jahre} ${jahre === 1 ? 'Jahr' : 'Jahre'}`;
}

/**
 * Discord-Auszeichnung aus einem Text entschärfen.
 *
 * Eine Notiz kommt von einem Menschen und wird in einer Discord-Nachricht
 * ausgegeben. Ohne diesen Schritt wird `**fett**` fett, `@everyone` zu einer
 * Erwähnung und ein Backtick zum Codeblock, der den Rest der Nachricht
 * verschluckt.
 *
 * Erwähnungen fängt zusätzlich `allowedMentions` ab - das ist die wirksame
 * Sperre. Hier geht es um Lesbarkeit: was jemand getippt hat, soll so
 * dastehen, wie er es getippt hat.
 */
export function entschaerfe(text: string): string {
  return text.replace(/([\\`*_~|>[\]()#-])/gu, '\\$1');
}

/** Auf eine Länge kürzen, die Discord noch annimmt. */
function kurz(text: string, grenze: number): string {
  const sauber = text.replace(/\s+/gu, ' ').trim();
  return sauber.length <= grenze ? sauber : `${sauber.slice(0, grenze - 1)}…`;
}

// ---------------------------------------------------------------------------
// /note
// ---------------------------------------------------------------------------

/**
 * Die Notizen eines Mitglieds.
 *
 * `listMemberNotes` prüft selbst, ob der Betrachter sie sehen darf, und gibt
 * dann eine leere Liste zurück. Eine leere Liste ist aber zweierlei - «keine
 * Notizen» und «nicht erlaubt» -, und das darf nicht dasselbe Wort bekommen:
 * «keine Notizen» ist eine Auskunft über die Person, «nicht erlaubt» eine über
 * den Fragenden. Deshalb wird hier vorher gefragt.
 */
async function zeigeNotizen(interaction: ChatInputCommandInteraction, actor: CommandActor): Promise<void> {
  const ziel = interaction.options.getUser('user', true);
  const neueNotiz = interaction.options.getString('note');
  const betrachter = alsBetrachter(actor);

  /*
   * Lesen und Schreiben sind zwei Rechte.
   *
   * Wer Notizen sehen darf, darf nicht automatisch welche anlegen - das
   * unterscheidet das Member Center, und hier gilt dasselbe. Der Eintritt ist
   * in beiden Faellen `darfSehen(…, 'notes', …)`; das Schreiben verlangt
   * zusaetzlich `notesCreate`, und zwar nicht hier, sondern in
   * `members.createMemberNote` - eine Pruefung an der Stelle, die auch das
   * Dashboard benutzt.
   */
  if (!actor.can(EINTRITT) || !members.darfSehen(betrachter, 'notes', ziel.id)) {
    await antworte(interaction, { text: NO_PERMISSION });
    return;
  }

  const guildId = await resolveGuildId();
  const mitgliedUrl = appUrl(systemRoutes.mitglied(ziel.id));

  let hinweis: string | null = null;
  if (neueNotiz !== null) {
    const geschrieben = await erfasseNotiz(betrachter, actor, ziel, neueNotiz, guildId);
    if (geschrieben.fehler !== null) {
      await antworte(interaction, { text: geschrieben.fehler });
      return;
    }
    hinweis = geschrieben.hinweis;
  }

  const notizen = await members.listMemberNotes(betrachter, ziel.id, guildId);
  const name = ziel.displayName || ziel.username;

  if (notizen.length === 0) {
    await antworte(interaction, {
      embed: {
        color: MODERATIONSFARBE,
        author: { name, icon_url: ziel.displayAvatarURL({ size: 128 }) },
        title: 'Kei Notize',
        description: `Zu <@${ziel.id}> isch nüt vermerkt.`,
        footer: { text: 'SwissHub System · Moderation' },
      },
      knopf: { label: 'Im Member Center erfasse', url: mitgliedUrl },
    });
    return;
  }

  /*
   * Hoechstens zehn als Felder.
   *
   * Ein Embed fasst 25 Felder und insgesamt 6000 Zeichen; zehn Notizen mit je
   * bis zu 300 Zeichen bleiben sicher darunter, auch mit Kopfzeilen. Was
   * nicht passt, gehoert ins Member Center - und der Knopf dorthin steht
   * ohnehin darunter. Eine abgeschnittene Liste, die aussieht wie die ganze,
   * waere die schlechtere Antwort.
   */
  const sichtbar = notizen.slice(0, 10);
  const felder = sichtbar.flatMap((notiz) => {
    const kopf = [
      notiz.pinned ? '📌' : null,
      notiz.category ? `[${entschaerfe(kurz(notiz.category, 40))}]` : null,
      entschaerfe(kurz(notiz.author.username, 40)),
      `· ${datum(notiz.createdAt)}`,
      notiz.editedAt ? '· bearbeitet' : null,
    ]
      .filter((teil): teil is string => teil !== null)
      .join(' ');
    return feld(kurz(kopf, 256), entschaerfe(kurz(notiz.content, 300)), false);
  });

  const rest = notizen.length - sichtbar.length;
  await antworte(interaction, {
    embed: {
      color: MODERATIONSFARBE,
      author: { name, icon_url: ziel.displayAvatarURL({ size: 128 }) },
      title: `${notizen.length} ${notizen.length === 1 ? 'Moderationsnotiz' : 'Moderationsnotize'}`,
      description: [hinweis, `<@${ziel.id}> · \`${ziel.id}\``].filter(Boolean).join('\n'),
      fields: felder,
      footer: {
        text: rest > 0 ? `… und ${rest} witeri im SwissHub System` : 'SwissHub System · Moderation',
      },
    },
    knopf: { label: 'Im Member Center öffne', url: mitgliedUrl },
  });

  log.info('Notizen über /note gelesen', {
    ziel: ziel.id,
    anzahl: notizen.length,
    geschrieben: hinweis !== null,
  });
}

/**
 * Eine Notiz aus Discord erfassen.
 *
 * ## Warum hier nichts geprueft wird, was das Modul prueft
 *
 * Der Text geht unveraendert an `members.createMemberNote`. Dort sitzen die
 * Berechtigung (`notesCreate`), die Laengengrenze und `sanitizeText` - und
 * zwar dieselben, die auch das Member Center durchlaeuft. Eine eigene
 * Pruefung hier waere eine zweite Regel fuer denselben Text, und die beiden
 * laufen auseinander, sobald eine davon angepasst wird.
 *
 * Geprueft wird hier genau eines: dass ueberhaupt etwas dasteht. Discord
 * laesst eine Option mit Leerzeichen zu, und eine leere Notiz ist kein
 * Eintrag, sondern ein Versehen.
 */
async function erfasseNotiz(
  betrachter: members.MemberViewer,
  actor: CommandActor,
  ziel: { id: string; username: string; displayName: string },
  text: string,
  guildId: string,
): Promise<{ hinweis: string | null; fehler: string | null }> {
  if (text.trim() === '') {
    return { hinweis: null, fehler: 'Die Notiz isch leer - schryb öppis ine oder lah d Option wäg.' };
  }

  try {
    await members.createMemberNote(
      betrachter,
      { discordId: actor.discordId, username: actor.username },
      {
        targetDiscordId: ziel.id,
        targetLabel: ziel.displayName || ziel.username,
        content: text,
      },
    );
  } catch (fehler) {
    /*
     * Die Absage des Moduls weitergeben, nicht uebersetzen.
     *
     * `AppError` traegt eine `userMessage`, die fuer Menschen geschrieben ist
     * - «Du darfst keine Notizen schreiben.» Sie hier neu zu formulieren
     * hiesse, zwei Saetze fuer denselben Fall zu pflegen.
     */
    if (fehler instanceof AppError) {
      return { hinweis: null, fehler: fehler.userMessage ?? NO_PERMISSION };
    }
    throw fehler;
  }

  log.info('Notiz über /note erfasst', { ziel: ziel.id, autor: actor.discordId, guildId });
  return { hinweis: '✅ Notiz gspeicheret.', fehler: null };
}

// ---------------------------------------------------------------------------
// /user
// ---------------------------------------------------------------------------

/**
 * Die Kurzübersicht eines Mitglieds.
 *
 * ## Abschnittsweise, nicht alles oder nichts
 *
 * Der Eintritt ist `members.view` zusammen mit `darfSehen(…, 'basic', …)` -
 * wer über **andere** nichts sehen darf, kommt nicht herein. Was danach
 * dasteht, entscheidet derselbe `darfSehen` je Abschnitt: Rollen, Moderation,
 * Notizen. Ein Moderator ohne Notizrecht sieht keine Notizzahl, und das ist
 * dieselbe Grenze wie im Member Center - nicht eine zweite, die hier erfunden
 * wurde.
 */
async function zeigeUebersicht(interaction: ChatInputCommandInteraction, actor: CommandActor): Promise<void> {
  const ziel = interaction.options.getUser('user', true);
  const betrachter = alsBetrachter(actor);

  if (!actor.can(EINTRITT) || !members.darfSehen(betrachter, 'basic', ziel.id)) {
    await antworte(interaction, { text: NO_PERMISSION });
    return;
  }

  const [uebersicht, guildId] = await Promise.all([members.getMemberSummary(ziel.id), resolveGuildId()]);
  const mitgliedUrl = appUrl(systemRoutes.mitglied(ziel.id));
  const bild = ziel.displayAvatarURL({ size: 256 });

  /*
   * Nicht (mehr) auf dem Server.
   *
   * Das ist eine Auskunft und kein Fehler: wer nach jemandem fragt, der
   * gegangen ist, soll das erfahren. Die Kennung und das Kontoalter stehen
   * trotzdem da - sie kommen aus der Snowflake und brauchen keine
   * Mitgliedschaft.
   */
  if (!uebersicht) {
    const erstellt = snowflakeDatum(ziel.id);
    await antworte(interaction, {
      embed: {
        color: MODERATIONSFARBE,
        author: { name: ziel.displayName || ziel.username, icon_url: bild },
        thumbnail: { url: bild },
        title: 'Nöd uf dem Server',
        description: `<@${ziel.id}> · \`${ziel.id}\``,
        fields: [
          ...feld('Benutzername', ziel.username),
          ...feld('Konto erstellt', erstellt ? `${datum(erstellt)}\n${alter(erstellt)}` : null),
        ],
        footer: { text: 'SwissHub System · Moderation' },
      },
      knopf: { label: 'Im Member Center öffne', url: mitgliedUrl },
    });
    return;
  }

  const nickname = await nicknameVon(uebersicht.discordId);

  /*
   * Die Abschnitte als Felder - und jeder einzelne hinter seiner Erlaubnis.
   *
   * Dieselbe abschnittsweise Grenze wie im Member Center: ein Moderator ohne
   * Notizrecht sieht keine Notizzahl, einer ohne Rollenrecht keine Rollen.
   * `darfSehen` entscheidet das, nicht diese Datei.
   */
  const felder: NonNullable<Embed['fields']> = [
    ...feld('Benutzername', `\`${uebersicht.username}\`${uebersicht.isBot ? ' · **Bot**' : ''}`),
    ...feld('Anzeigename', entschaerfe(uebersicht.displayName)),
    ...feld('Servername', nickname ? entschaerfe(nickname) : null),
    ...feld('Discord User ID', `\`${uebersicht.discordId}\``),
    ...feld('Konto erstellt', `${datum(uebersicht.accountCreatedAt)}\n${alter(uebersicht.accountCreatedAt)}`),
    ...feld('Server beigetrete', `${datum(uebersicht.joinedAt)}\n${alter(uebersicht.joinedAt)}`),
  ];

  const zustand = [
    uebersicht.boosting ? '💎 boostet de Server' : null,
    uebersicht.timedOut ? '🔇 isch grad getimeoutet' : null,
    uebersicht.activeJail
      ? `🔒 i de Jail${uebersicht.activeJail.endsAt ? ` bis ${datum(uebersicht.activeJail.endsAt)}` : ' (permanent)'}`
      : null,
  ].filter((teil): teil is string => teil !== null);
  felder.push(...feld('Zuestand', zustand.length > 0 ? zustand.join('\n') : null, false));

  if (members.darfSehen(betrachter, 'roles', ziel.id)) {
    const namen = uebersicht.roles.slice(0, 15).map((rolle) => entschaerfe(rolle.name));
    const uebrig = uebersicht.roles.length - namen.length;
    felder.push(
      ...feld(
        `Rolle (${uebersicht.roles.length})`,
        namen.length === 0 ? 'keini' : `${namen.join(', ')}${uebrig > 0 ? ` … +${uebrig}` : ''}`,
        false,
      ),
      // Die hoechste Rolle steht bei Discord vorn - `getMemberSummary` liefert
      // sie in der Serverreihenfolge, also ist das erste Element die oberste.
      ...feld('Höchsti Rolle', uebersicht.roles[0] ? entschaerfe(uebersicht.roles[0].name) : null),
    );
  }

  if (members.darfSehen(betrachter, 'moderation', ziel.id)) {
    const massnahmen = await prisma.moderationAction.count({ where: { targetDiscordId: ziel.id } });
    felder.push(...feld('Massnahme im Protokoll', String(massnahmen)));
  }

  if (members.darfSehen(betrachter, 'notes', ziel.id)) {
    const anzahl = await members.countMemberNotes(betrachter, ziel.id, guildId);
    felder.push(...feld('Interni Notize', anzahl === 0 ? '0' : `${anzahl} · mit \`/note\` aalueg`));
  }

  /*
   * Nur ob, nicht was. Keine E-Mail, keine OAuth-Angaben, keine
   * Sitzungskennungen - die Frage der Moderation ist «chan ich ihm en
   * WebApp-Link schicke?», und das ist ein Ja oder ein Nein.
   */
  const slug = await profile.slugVon(ziel.id);
  const konto = await prisma.user.count({ where: { discordId: ziel.id } });
  felder.push(...feld('SwissHub-Konto', konto > 0 ? 'ja' : 'nei'));
  if (slug) {
    felder.push(...feld('Öffentlichs Profil', appUrl(systemRoutes.oeffentlichesProfil(slug)), false));
  }

  await antworte(interaction, {
    embed: {
      color: MODERATIONSFARBE,
      author: { name: uebersicht.displayName, icon_url: bild },
      thumbnail: { url: bild },
      description: `<@${uebersicht.discordId}>`,
      fields: felder,
      footer: { text: 'SwissHub System · Moderation' },
    },
    knopf: { label: 'Im Member Center öffne', url: mitgliedUrl },
  });

  log.info('Mitgliedsübersicht über /user gelesen', { ziel: ziel.id });
}

/**
 * Der Servername (Nickname), falls gesetzt.
 *
 * `MemberSummary` führt `displayName` - das ist der Nickname, sonst der
 * globale Name, sonst der Benutzername. Für die Moderation ist aber
 * interessant, ob es **einen Nickname gibt**: «heisst hier anders als
 * überall» ist eine Information. Er steht im Spiegel der Mitgliederliste,
 * derselben Tabelle, aus der auch die Suche im Dashboard liest.
 */
async function nicknameVon(discordId: string): Promise<string | null> {
  const zeile = await prisma.discordMemberCache.findUnique({
    where: { discordId },
    select: { nickname: true },
  });
  return zeile?.nickname ?? null;
}

/**
 * Das Erstellungsdatum eines Discord-Kontos aus seiner Kennung.
 *
 * Eine Snowflake trägt den Zeitstempel in den oberen 42 Bit, gerechnet ab dem
 * ersten Januar 2015. Deshalb lässt sich das Kontoalter auch für jemanden
 * nennen, der nicht auf dem Server ist - es braucht keine Abfrage.
 */
const DISCORD_EPOCHE = 1_420_070_400_000n;

export function snowflakeDatum(kennung: string): Date | null {
  if (!/^\d{17,20}$/u.test(kennung)) {
    return null;
  }
  return new Date(Number((BigInt(kennung) >> 22n) + DISCORD_EPOCHE));
}

// ---------------------------------------------------------------------------
// Verteilung
// ---------------------------------------------------------------------------

export async function handleModerationCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!MODERATION_COMMAND_NAMES.has(interaction.commandName as ModerationCommandName)) {
    return;
  }

  /*
   * Ephemer, und zwar vor allem anderen.
   *
   * `deferReply` legt fest, wie die Antwort aussieht - auch die Fehlerantwort.
   * Stünde das weiter unten, gäbe es einen Pfad, auf dem eine Absage oder ein
   * Fehler im Kanal landet, und bei einem Moderationsbefehl ist schon die
   * Absage eine Auskunft, die niemanden ausser dem Fragenden angeht.
   */
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const actor = await buildCommandActor(interaction);

    switch (interaction.commandName as ModerationCommandName) {
      case 'note':
        await zeigeNotizen(interaction, actor);
        return;
      case 'user':
        await zeigeUebersicht(interaction, actor);
        return;
    }
  } catch (error) {
    const fehler =
      error instanceof AppError ? (error.userMessage ?? NO_PERMISSION) : 'Das het leider nöd klappt.';
    log.warn('Moderationsbefehl gescheitert', {
      befehl: interaction.commandName,
      grund: error instanceof Error ? error.message : 'unbekannt',
    });
    await antworte(interaction, { text: fehler });
  }
}
