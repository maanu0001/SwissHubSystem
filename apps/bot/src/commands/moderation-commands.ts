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
async function antworte(interaction: ChatInputCommandInteraction, text: string): Promise<void> {
  await interaction.editReply({
    content: kurz(text, 1900),
    allowedMentions: { parse: [] },
  });
}

export const MODERATION_COMMAND_DEFINITIONS = [
  {
    name: 'note',
    description: 'Die internen Notize zu eme Mitglied aalueg (nur für s Team).',
    dmPermission: false,
    options: [
      {
        name: 'user',
        description: 'Wäm sini Notize?',
        type: ApplicationCommandOptionType.User,
        required: true,
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
  const betrachter = alsBetrachter(actor);

  if (!actor.can(EINTRITT) || !members.darfSehen(betrachter, 'notes', ziel.id)) {
    await antworte(interaction, NO_PERMISSION);
    return;
  }

  const guildId = await resolveGuildId();
  const notizen = await members.listMemberNotes(betrachter, ziel.id, guildId);

  if (notizen.length === 0) {
    await antworte(
      interaction,
      `Zu <@${ziel.id}> git s kei Notize. Im Member Center chasch eini aalege: ${appUrl(
        systemRoutes.mitglied(ziel.id),
      )}`,
    );
    return;
  }

  /*
   * Höchstens zehn in der Nachricht.
   *
   * Eine Discord-Nachricht fasst 2000 Zeichen, eine Notiz bis zu 2000. Was
   * nicht passt, gehört ins Member Center - und der Link dorthin steht
   * ohnehin darunter. Ein abgeschnittener Text, der aussieht wie die ganze
   * Liste, wäre die schlechtere Antwort.
   */
  const sichtbar = notizen.slice(0, 10);
  const zeilen = sichtbar.map((notiz) => {
    const kopf = [
      notiz.pinned ? '📌' : '•',
      notiz.category ? `[${entschaerfe(kurz(notiz.category, 40))}]` : null,
      `von ${entschaerfe(kurz(notiz.author.username, 40))}`,
      `am ${datum(notiz.createdAt)}`,
      notiz.editedAt ? '(bearbeitet)' : null,
    ]
      .filter((teil): teil is string => teil !== null)
      .join(' ');
    return `${kopf}\n> ${entschaerfe(kurz(notiz.content, 300))}`;
  });

  const rest = notizen.length - sichtbar.length;
  const fuss = [
    rest > 0 ? `… und ${rest} witeri.` : null,
    `Alli Notize: ${appUrl(systemRoutes.mitglied(ziel.id))}`,
  ]
    .filter((teil): teil is string => teil !== null)
    .join(' ');

  await antworte(
    interaction,
    `**Notize zu <@${ziel.id}>** (${notizen.length})\n\n${zeilen.join('\n\n')}\n\n${fuss}`,
  );

  log.info('Notizen über /note gelesen', { ziel: ziel.id, anzahl: notizen.length });
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
    await antworte(interaction, NO_PERMISSION);
    return;
  }

  const [uebersicht, guildId] = await Promise.all([members.getMemberSummary(ziel.id), resolveGuildId()]);

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
    await antworte(
      interaction,
      [
        `**${entschaerfe(ziel.username)}** <@${ziel.id}>`,
        `Discord User ID: \`${ziel.id}\``,
        `Konto erstellt: ${datum(erstellt)} (${alter(erstellt)})`,
        '',
        'Die Person isch **nöd uf dem Server**.',
      ].join('\n'),
    );
    return;
  }

  const zeilen: string[] = [
    `**${entschaerfe(uebersicht.displayName)}** <@${uebersicht.discordId}>`,
    `Benutzername: \`${uebersicht.username}\`${uebersicht.isBot ? ' · **Bot**' : ''}`,
    `Discord User ID: \`${uebersicht.discordId}\``,
  ];

  const nickname = await nicknameVon(uebersicht.discordId);
  if (nickname) {
    zeilen.push(`Servername: ${entschaerfe(nickname)}`);
  }

  zeilen.push(
    `Konto erstellt: ${datum(uebersicht.accountCreatedAt)} (${alter(uebersicht.accountCreatedAt)})`,
    `Server beigetrete: ${datum(uebersicht.joinedAt)} (${alter(uebersicht.joinedAt)})`,
  );
  if (uebersicht.boosting) {
    zeilen.push('Boostet de Server: ja');
  }
  if (uebersicht.timedOut) {
    zeilen.push('**Isch grad getimeoutet.**');
  }

  // --- Rollen, wenn erlaubt -------------------------------------------------
  if (members.darfSehen(betrachter, 'roles', ziel.id)) {
    const namen = uebersicht.roles.slice(0, 15).map((rolle) => entschaerfe(rolle.name));
    const uebrig = uebersicht.roles.length - namen.length;
    zeilen.push(
      '',
      `**Rolle (${uebersicht.roles.length})**`,
      namen.length === 0 ? 'keini' : `${namen.join(', ')}${uebrig > 0 ? ` … +${uebrig}` : ''}`,
    );
  }

  // --- Moderation, wenn erlaubt --------------------------------------------
  if (members.darfSehen(betrachter, 'moderation', ziel.id)) {
    const massnahmen = await prisma.moderationAction.count({
      where: { targetDiscordId: ziel.id },
    });
    zeilen.push(
      '',
      '**Moderation**',
      uebersicht.activeJail
        ? `Aktive Jail: ja (${uebersicht.activeJail.endsAt ? `bis ${datum(uebersicht.activeJail.endsAt)}` : 'permanent'})`
        : 'Aktive Jail: nei',
      `Massnahme im Protokoll: ${massnahmen}`,
    );
  }

  // --- Notizen, wenn erlaubt -----------------------------------------------
  if (members.darfSehen(betrachter, 'notes', ziel.id)) {
    const anzahl = await members.countMemberNotes(betrachter, ziel.id, guildId);
    zeilen.push('', `**Interni Notize:** ${anzahl}${anzahl > 0 ? ' - mit `/note` aalueg' : ''}`);
  }

  // --- SwissHub ------------------------------------------------------------
  const slug = await profile.slugVon(ziel.id);
  const konto = await prisma.user.count({ where: { discordId: ziel.id } });
  zeilen.push(
    '',
    '**SwissHub**',
    /*
     * Nur ob, nicht was. Keine E-Mail, keine OAuth-Angaben, keine
     * Sitzungskennungen - die Frage der Moderation ist «chan ich ihm en
     * WebApp-Link schicke?», und das ist ein Ja oder ein Nein.
     */
    `Konto: ${konto > 0 ? 'ja' : 'nei'}`,
    `Member Center: ${appUrl(systemRoutes.mitglied(ziel.id))}`,
  );
  if (slug) {
    zeilen.push(`Öffentlichs Profil: ${appUrl(systemRoutes.oeffentlichesProfil(slug))}`);
  }

  await antworte(interaction, zeilen.join('\n'));

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
    const fehler = error instanceof AppError ? error.userMessage : 'Das het leider nöd klappt.';
    log.warn('Moderationsbefehl gescheitert', {
      befehl: interaction.commandName,
      grund: error instanceof Error ? error.message : 'unbekannt',
    });
    await antworte(interaction, fehler);
  }
}
