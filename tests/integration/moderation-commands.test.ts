import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_moderation_commands');

/**
 * `/note` und `/user` - durchgespielt, nicht nachgelesen.
 *
 * ## Warum gegen eine echte Datenbank und mit einer echten Interaktion
 *
 * Weil die Frage, um die es geht, aus drei Teilen besteht und jeder davon
 * woanders wohnt: die **Berechtigung** steht in `RolePermission`, die
 * **Notizen** in `MemberNote`, und die **Antwort** entsteht in einer
 * Discord-Interaktion. Ein Test mit einer Attrappe für die Berechtigung
 * prüfte seine Attrappe; ein Test, der nur die Textbausteine liest, prüfte
 * nichts von der Reihenfolge.
 *
 * Also: Rollenzuordnung in die Datenbank, Notiz in die Datenbank, eine
 * nachgebaute Interaktion in den Handler - und dann steht in der Antwort
 * entweder die Notiz oder die Absage.
 *
 * ## Was dabei festgenagelt wird
 *
 *  1. **Ohne Berechtigung die Absage** - und zwar bevor irgendetwas gelesen
 *     wird.
 *  2. **Immer ephemer.** `deferReply` muss `Ephemeral` tragen, auf jedem
 *     Pfad, auch dem der Absage.
 *  3. **Keine Erwähnung pingt.** `allowedMentions: { parse: [] }`.
 *  4. **Keine Geheimnisse.** In keiner Antwort steht eine E-Mail-Adresse,
 *     ein Token oder eine Sitzungskennung - geprüft gegen eine Zeile, die
 *     genau das enthält.
 */
const { prisma } = await import('@swisshub/database');
const { invalidateRoleConfiguration } = await import('@swisshub/permissions');
const { MEMBER_PERMISSIONS } = await import('@swisshub/permissions');
const { handleModerationCommand, MODERATION_COMMAND_DEFINITIONS, alter, entschaerfe, snowflakeDatum } =
  await import('../../apps/bot/src/commands/moderation-commands');

const GUILD = process.env.DISCORD_GUILD_ID ?? '000000000000000001';
const MOD = '100000000000000001';
const ZIEL = '100000000000000002';
const TEAM_ROLLE = '900000000000000111';

/** Was der Handler an `editReply` übergeben hat. */
interface Antwort {
  content?: string;
  embeds?: Array<{
    title?: string;
    description?: string;
    author?: { name: string; icon_url?: string };
    thumbnail?: { url: string };
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
    footer?: { text: string };
    color?: number;
  }>;
  components?: Array<{ components: Array<{ label?: string; url?: string; custom_id?: string }> }>;
  allowedMentions?: { parse?: string[] };
}

/**
 * Die Antwort als durchsuchbarer Text - Inhalt **und** Embed.
 *
 * Die Befehle antworten mit Karten statt mit Absätzen; die Zusagen dieser
 * Tests gelten aber unverändert dem, was dort steht. Diese Funktion legt
 * Titel, Beschreibung, alle Felder und die Fusszeile aneinander, damit eine
 * Prüfung auf «steht das drin» nicht wissen muss, in welchem Embed-Feld es
 * gelandet ist - und damit sie nicht schwächer wird, nur weil sich die Form
 * geändert hat. Die Geheimnisprüfung weiter unten hängt genau daran.
 */
function alsText(antwort: Antwort): string {
  const embed = antwort.embeds?.[0];
  return [
    antwort.content ?? '',
    embed?.author?.name ?? '',
    embed?.title ?? '',
    embed?.description ?? '',
    ...(embed?.fields ?? []).flatMap((eintrag) => [eintrag.name, eintrag.value]),
    embed?.footer?.text ?? '',
    // Auch die Adressen der Knöpfe: ein Link ist Inhalt, den jemand sieht.
    ...(antwort.components ?? []).flatMap((reihe) =>
      reihe.components.flatMap((knopf) => [knopf.label ?? '', knopf.url ?? '']),
    ),
  ].join('\n');
}

interface Mitschrift {
  deferFlags: number | undefined;
  antworten: Antwort[];
}

/**
 * Eine nachgebaute Interaktion.
 *
 * Nur die vier Dinge, die der Handler anfasst: `commandName`, `options`,
 * `user`/`member` für den Befehlskontext, und `deferReply`/`editReply` als
 * Mitschrift. Eine vollständige discord.js-Interaktion nachzubauen wäre
 * Arbeit an einer Attrappe; was hier zählt, ist, was herauskommt.
 */
function interaktion(
  befehl: 'note' | 'user',
  aufrufer: { id: string; roleIds: string[] },
  ziel: { id: string; username: string; notiz?: string },
): { interaction: unknown; mitschrift: Mitschrift } {
  const mitschrift: Mitschrift = { deferFlags: undefined, antworten: [] };
  const interaction = {
    commandName: befehl,
    isChatInputCommand: () => true,
    user: { id: aufrufer.id, username: 'mod', avatar: null },
    member: { roles: { cache: new Map(aufrufer.roleIds.map((id) => [id, { id }])) } },
    options: {
      /*
       * Dieselben Felder, die discord.js an einem `User` führt und die die
       * Handler anfassen: Kennung, Benutzername, Anzeigename und das
       * Avatarbild für die Karte. Ohne `displayAvatarURL` wirft der Handler,
       * und der Test sähe nur «Das het leider nöd klappt» - eine Attrappe,
       * die zu wenig kann, prüft dann die Fehlerbehandlung statt der Antwort.
       */
      getUser: (_name: string, _required?: boolean) => ({
        id: ziel.id,
        username: ziel.username,
        displayName: ziel.username,
        displayAvatarURL: () => `https://cdn.example/${ziel.id}.png`,
      }),
      getString: (_name: string) => ziel.notiz ?? null,
    },
    deferReply: (optionen: { flags?: number }) => {
      mitschrift.deferFlags = optionen.flags;
      return Promise.resolve();
    },
    editReply: (antwort: Antwort) => {
      mitschrift.antworten.push(antwort);
      return Promise.resolve();
    },
  };
  return { interaction, mitschrift };
}

/** Der Rolle eine Berechtigung geben - wie die Einstellungsseite es tut. */
async function erlaube(...berechtigungen: string[]): Promise<void> {
  await prisma.managedRole.upsert({
    where: { discordRoleId: TEAM_ROLLE },
    create: { discordRoleId: TEAM_ROLLE, label: 'Team' },
    update: {},
  });
  for (const permission of berechtigungen) {
    await prisma.rolePermission.create({
      data: { discordRoleId: TEAM_ROLLE, permission, effect: 'ALLOW' },
    });
  }
  /*
   * Die Rollenkonfiguration haelt einen kurzen Zwischenspeicher. Produktiv
   * verwirft ihn die Einstellungsseite bei jeder Aenderung; im Test dieser
   * Aufruf. Ohne ihn pruefte der Test die Konfiguration von vorhin.
   */
  invalidateRoleConfiguration();
}

/** Die letzte Antwort des Handlers. */
function letzte(mitschrift: Mitschrift): Antwort {
  const antwort = mitschrift.antworten.at(-1);
  expect(antwort, 'der Handler hat nicht geantwortet').toBeDefined();
  return antwort!;
}

const ABSAGE = 'Du hesch kei Berächtigung für de Befehl.';

describeWithDatabase('Moderationsbefehle /note und /user', () => {
  beforeAll(async () => {
    await pushSchema();
  });

  beforeEach(async () => {
    await prisma.memberNote.deleteMany({});
    await prisma.moderationAction.deleteMany({});
    await prisma.session.deleteMany({});
    await prisma.discordIdentityCache.deleteMany({});
    await prisma.rolePermission.deleteMany({});
    await prisma.managedRole.deleteMany({});
    await prisma.discordMemberCache.deleteMany({});
    await prisma.user.deleteMany({});
    invalidateRoleConfiguration();

    await prisma.discordMemberCache.createMany({
      data: [
        {
          discordId: ZIEL,
          username: 'zielperson',
          displayName: 'Zielperson',
          nickname: 'Zieli',
          roleIds: [],
          joinedAt: new Date('2024-02-01T12:00:00.000Z'),
          accountCreatedAt: new Date('2020-05-05T12:00:00.000Z'),
        },
        {
          discordId: MOD,
          username: 'mod',
          displayName: 'Mod',
          roleIds: [TEAM_ROLLE],
        },
      ],
    });
  });

  // --- Die Befehle selbst ---------------------------------------------------

  it('meldet genau zwei Befehle an, beide ohne DM', () => {
    expect(MODERATION_COMMAND_DEFINITIONS.map((eintrag) => eintrag.name)).toEqual(['note', 'user']);
    for (const eintrag of MODERATION_COMMAND_DEFINITIONS) {
      // Ein Moderationsbefehl in einer DM hätte keinen Serverkontext - und
      // damit keine Rollen, aus denen eine Berechtigung folgen könnte.
      expect(eintrag.dmPermission, eintrag.name).toBe(false);
      /*
       * Das Ziel ist immer verpflichtend - ohne Person gibt es nichts
       * anzusehen. Alles Weitere ist optional: `/note` hat den Schreibweg
       * als zweite Option, und der darf den Lesefall nicht erschweren.
       */
      expect(eintrag.options[0]?.name).toBe('user');
      expect(eintrag.options[0]?.required).toBe(true);
      for (const option of eintrag.options.slice(1)) {
        expect(option.required, `${eintrag.name}.${option.name}`).toBe(false);
      }
    }
  });

  // --- /note ---------------------------------------------------------------

  it('verweigert /note ohne Notizberechtigung', async () => {
    await erlaube(MEMBER_PERMISSIONS.view);
    await prisma.memberNote.create({
      data: {
        guildId: GUILD,
        targetDiscordId: ZIEL,
        authorDiscordId: MOD,
        authorUsername: 'mod',
        content: 'Geheime interne Einschätzung',
      },
    });

    const { interaction, mitschrift } = interaktion(
      'note',
      { id: MOD, roleIds: [TEAM_ROLLE] },
      { id: ZIEL, username: 'zielperson' },
    );
    await handleModerationCommand(interaction as never);

    expect(letzte(mitschrift).content).toBe(ABSAGE);
    // Und vor allem: der Notizinhalt steht nirgends in der Antwort.
    expect(letzte(mitschrift).content).not.toContain('Geheime interne Einschätzung');
  });

  it('verweigert /note auch mit Notizrecht, aber ohne Eintritt ins Member Center', async () => {
    /*
     * Zwei Schluessel, nicht einer. `members.view` ist der Eintritt, und ohne
     * ihn gibt es im Dashboard keinen Weg zu den Notizen - der Befehl soll
     * keine Abkuerzung daran vorbei sein.
     */
    await erlaube(MEMBER_PERMISSIONS.notesAll);
    const { interaction, mitschrift } = interaktion(
      'note',
      { id: MOD, roleIds: [TEAM_ROLLE] },
      { id: ZIEL, username: 'zielperson' },
    );
    await handleModerationCommand(interaction as never);

    expect(letzte(mitschrift).content).toBe(ABSAGE);
  });

  it('zeigt mit Berechtigung die Notizen aus der WebApp-Datenbank', async () => {
    await erlaube(MEMBER_PERMISSIONS.view, MEMBER_PERMISSIONS.notesAll);
    await prisma.memberNote.create({
      data: {
        guildId: GUILD,
        targetDiscordId: ZIEL,
        authorDiscordId: MOD,
        authorUsername: 'mod',
        content: 'Hat sich im Voice danebenbenommen',
        category: 'Moderation',
        pinned: true,
      },
    });

    const { interaction, mitschrift } = interaktion(
      'note',
      { id: MOD, roleIds: [TEAM_ROLLE] },
      { id: ZIEL, username: 'zielperson' },
    );
    await handleModerationCommand(interaction as never);

    const antwort = letzte(mitschrift);
    /*
     * Dieselbe Notiz, die im Member Center steht - keine zweite Datenbank.
     * Der Text ist entschaerft (Discord-Auszeichnung), deshalb wird auf ein
     * Stueck ohne Sonderzeichen geprueft.
     */
    const text = alsText(antwort);
    expect(text).toContain('danebenbenommen');
    expect(text).toContain('Moderation');
    expect(text).toContain('mod');
    // Und als Karte, nicht als Absatz: das ist die Zusage dieses Blocks.
    expect(antwort.embeds?.[0]?.fields?.length ?? 0).toBeGreaterThan(0);
  });

  it('unterscheidet «keine Notizen» von «nicht erlaubt»', async () => {
    await erlaube(MEMBER_PERMISSIONS.view, MEMBER_PERMISSIONS.notesAll);
    const { interaction, mitschrift } = interaktion(
      'note',
      { id: MOD, roleIds: [TEAM_ROLLE] },
      { id: ZIEL, username: 'zielperson' },
    );
    await handleModerationCommand(interaction as never);

    const antwort = letzte(mitschrift);
    /*
     * «Keine Notizen» ist eine Auskunft ueber die Person, «nicht erlaubt» eine
     * ueber den Fragenden. Dasselbe Wort fuer beides waere irrefuehrend - und
     * zwar in die unangenehme Richtung: man denkt, es gaebe nichts.
     */
    expect(antwort.content).not.toBe(ABSAGE);
    expect(alsText(antwort)).toContain('Kei Notize');
  });

  // --- /note mit Notiz: der Schreibweg --------------------------------------

  it('erfasst eine Notiz aus Discord in derselben Tabelle wie die WebApp', async () => {
    await erlaube(MEMBER_PERMISSIONS.view, MEMBER_PERMISSIONS.notesAll, MEMBER_PERMISSIONS.notesCreate);
    const { interaction, mitschrift } = interaktion(
      'note',
      { id: MOD, roleIds: [TEAM_ROLLE] },
      { id: ZIEL, username: 'zielperson', notiz: 'Isch bim Event uffällig gsi.' },
    );
    await handleModerationCommand(interaction as never);

    /*
     * Die Zusage dieses Blocks: **eine** Akte. Geprüft wird nicht, was der
     * Befehl geantwortet hat, sondern was in der Tabelle steht, aus der auch
     * das Member Center liest - eine zweite Notizdatenbank fiele hier auf,
     * weil diese Abfrage dann nichts fände.
     */
    const zeilen = await prisma.memberNote.findMany({ where: { targetDiscordId: ZIEL } });
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]?.content).toBe('Isch bim Event uffällig gsi.');
    // Der Autor kommt aus dem Befehlskontext und nicht aus der Eingabe.
    expect(zeilen[0]?.authorDiscordId).toBe(MOD);

    // Und die Antwort zeigt die aktualisierte Liste samt Bestätigung.
    const text = alsText(letzte(mitschrift));
    expect(text).toContain('gspeicheret');
    expect(text).toContain('uffällig');
  });

  it('schreibt nichts, wenn das Recht zum Schreiben fehlt', async () => {
    // Lesen erlaubt, schreiben nicht - genau die Trennung, die das Member
    // Center macht. Vorher gab es diesen Fall nicht, weil der Befehl nur las.
    await erlaube(MEMBER_PERMISSIONS.view, MEMBER_PERMISSIONS.notesAll);
    const { interaction, mitschrift } = interaktion(
      'note',
      { id: MOD, roleIds: [TEAM_ROLLE] },
      { id: ZIEL, username: 'zielperson', notiz: 'Das darf nicht ankommen.' },
    );
    await handleModerationCommand(interaction as never);

    expect(await prisma.memberNote.count({ where: { targetDiscordId: ZIEL } })).toBe(0);
    // Die Absage kommt aus dem Modul und ist ein Satz, keine Karte.
    expect(letzte(mitschrift).content ?? '').not.toBe('');
  });

  it('weist eine leere Notiz ab, statt einen leeren Eintrag anzulegen', async () => {
    await erlaube(MEMBER_PERMISSIONS.view, MEMBER_PERMISSIONS.notesAll, MEMBER_PERMISSIONS.notesCreate);
    const { interaction, mitschrift } = interaktion(
      'note',
      { id: MOD, roleIds: [TEAM_ROLLE] },
      { id: ZIEL, username: 'zielperson', notiz: '   ' },
    );
    await handleModerationCommand(interaction as never);

    expect(await prisma.memberNote.count({ where: { targetDiscordId: ZIEL } })).toBe(0);
    expect(letzte(mitschrift).content ?? '').toContain('leer');
  });

  it('liest weiterhin nur, wenn die Notiz-Option fehlt', async () => {
    /*
     * Der Lesefall darf durch den Schreibweg nicht zum Schreibfall werden.
     * Ohne die Option legt der Befehl nichts an - auch dann nicht, wenn der
     * Aufrufer schreiben dürfte.
     */
    await erlaube(MEMBER_PERMISSIONS.view, MEMBER_PERMISSIONS.notesAll, MEMBER_PERMISSIONS.notesCreate);
    const { interaction } = interaktion(
      'note',
      { id: MOD, roleIds: [TEAM_ROLLE] },
      { id: ZIEL, username: 'zielperson' },
    );
    await handleModerationCommand(interaction as never);

    expect(await prisma.memberNote.count({ where: { targetDiscordId: ZIEL } })).toBe(0);
  });

  it('gibt der Antwort einen Link in die WebApp und keinen Knopf ohne Handler', async () => {
    await erlaube(MEMBER_PERMISSIONS.view, MEMBER_PERMISSIONS.notesAll);
    const { interaction, mitschrift } = interaktion(
      'note',
      { id: MOD, roleIds: [TEAM_ROLLE] },
      { id: ZIEL, username: 'zielperson' },
    );
    await handleModerationCommand(interaction as never);

    const knoepfe = letzte(mitschrift).components?.[0]?.components ?? [];
    expect(knoepfe).toHaveLength(1);
    expect(knoepfe[0]?.url).toContain('/members/');
    /*
     * Kein `custom_id`: ein solcher Knopf löste eine Interaktion aus, die
     * niemand verteilt - Discord zeigte dem Team dann «Interaktion
     * fehlgeschlagen». Ein Link-Knopf braucht keinen Handler.
     */
    expect(knoepfe[0]?.custom_id).toBeUndefined();
  });

  // --- /user ---------------------------------------------------------------

  it('verweigert /user ohne das Recht, andere zu sehen', async () => {
    await erlaube(MEMBER_PERMISSIONS.view);
    const { interaction, mitschrift } = interaktion(
      'user',
      { id: MOD, roleIds: [TEAM_ROLLE] },
      { id: ZIEL, username: 'zielperson' },
    );
    await handleModerationCommand(interaction as never);

    expect(letzte(mitschrift).content).toBe(ABSAGE);
  });

  it('zeigt mit Berechtigung Identität, Konto- und Beitrittsalter', async () => {
    await erlaube(MEMBER_PERMISSIONS.view, MEMBER_PERMISSIONS.basicAll);
    const { interaction, mitschrift } = interaktion(
      'user',
      { id: MOD, roleIds: [TEAM_ROLLE] },
      { id: ZIEL, username: 'zielperson' },
    );
    await handleModerationCommand(interaction as never);

    const inhalt = alsText(letzte(mitschrift));
    expect(inhalt).toContain(ZIEL);
    /*
     * Der Anzeigename und das Beitrittsdatum kommen aus `getMemberSummary` -
     * derselben Funktion wie im Dashboard, also aus dem Discord-Zugang. Was
     * genau dort steht, ist nicht die Zusage dieses Tests; dass die
     * **Abschnitte** da sind, schon. Der Servername dagegen kommt aus dem
     * Mitgliederspiegel, und der ist hier gesetzt.
     */
    expect(inhalt).toContain('Zieli');
    expect(inhalt).toContain('Benutzername');
    expect(inhalt).toContain('Discord User ID');
    expect(inhalt).toContain('Konto erstellt');
    expect(inhalt).toContain('Server beigetrete');
    expect(inhalt).toContain('Member Center');
  });

  it('zeigt Rollen, Moderation und Notizzahl nur mit dem jeweiligen Recht', async () => {
    await prisma.memberNote.create({
      data: {
        guildId: GUILD,
        targetDiscordId: ZIEL,
        authorDiscordId: MOD,
        authorUsername: 'mod',
        content: 'Eine Notiz',
      },
    });

    // Nur die Basis: keine Abschnitte darüber hinaus.
    await erlaube(MEMBER_PERMISSIONS.view, MEMBER_PERMISSIONS.basicAll);
    const schmal = interaktion(
      'user',
      { id: MOD, roleIds: [TEAM_ROLLE] },
      { id: ZIEL, username: 'zielperson' },
    );
    await handleModerationCommand(schmal.interaction as never);
    const ohne = alsText(letzte(schmal.mitschrift));
    expect(ohne).not.toContain('Interni Notize');
    expect(ohne).not.toContain('Massnahme im Protokoll');
    expect(ohne).not.toContain('Rolle (');

    // Mit allen drei: die Abschnitte erscheinen.
    await erlaube(MEMBER_PERMISSIONS.rolesAll, MEMBER_PERMISSIONS.moderationAll, MEMBER_PERMISSIONS.notesAll);
    const breit = interaktion(
      'user',
      { id: MOD, roleIds: [TEAM_ROLLE] },
      { id: ZIEL, username: 'zielperson' },
    );
    await handleModerationCommand(breit.interaction as never);
    const mit = alsText(letzte(breit.mitschrift));
    expect(mit).toContain('Rolle (');
    expect(mit).toContain('Massnahme im Protokoll');
    expect(mit).toContain('Interni Notize');
  });

  it('nennt niemanden, der nicht auf dem Server ist, als Mitglied', async () => {
    await erlaube(MEMBER_PERMISSIONS.view, MEMBER_PERMISSIONS.basicAll);
    const fremd = '100000000000000777';
    const { interaction, mitschrift } = interaktion(
      'user',
      { id: MOD, roleIds: [TEAM_ROLLE] },
      { id: fremd, username: 'niemand' },
    );
    await handleModerationCommand(interaction as never);

    const inhalt = alsText(letzte(mitschrift));
    expect(inhalt).toContain('Nöd uf dem Server');
    // Das Kontoalter steht trotzdem da - es kommt aus der Snowflake.
    expect(inhalt).toContain('Konto erstellt');
  });

  // --- Die Zusagen über jede Antwort ---------------------------------------

  it.each(['note', 'user'] as const)('antwortet bei /%s immer ephemer', async (befehl) => {
    await erlaube(MEMBER_PERMISSIONS.view, MEMBER_PERMISSIONS.basicAll, MEMBER_PERMISSIONS.notesAll);
    const { interaction, mitschrift } = interaktion(
      befehl,
      { id: MOD, roleIds: [TEAM_ROLLE] },
      { id: ZIEL, username: 'zielperson' },
    );
    await handleModerationCommand(interaction as never);

    // 64 ist `MessageFlags.Ephemeral`. Die Zahl steht hier statt der
    // Konstante, damit der Test nicht dieselbe Quelle prüft wie der Code.
    expect(mitschrift.deferFlags).toBe(64);
  });

  it.each(['note', 'user'] as const)('pingt bei /%s niemanden an', async (befehl) => {
    await erlaube(MEMBER_PERMISSIONS.view, MEMBER_PERMISSIONS.basicAll, MEMBER_PERMISSIONS.notesAll);
    const { interaction, mitschrift } = interaktion(
      befehl,
      { id: MOD, roleIds: [TEAM_ROLLE] },
      { id: ZIEL, username: 'zielperson' },
    );
    await handleModerationCommand(interaction as never);

    /*
     * `<@id>` steht in der Antwort, weil Discord daraus den Namen macht - und
     * nicht, um jemanden zu rufen. Die Antwort ist ephemer, eine Erwaehnung
     * wuerde trotzdem benachrichtigen.
     */
    expect(letzte(mitschrift).allowedMentions).toEqual({ parse: [] });
  });

  it('bringt keine Geheimnisse in die Antwort', async () => {
    /*
     * Die Gegenprobe zu «keine Tokens, keine E-Mail-Adressen, keine
     * OAuth-Daten».
     *
     * Das Datenmodell hilft hier schon: `User` führt **keine** E-Mail und
     * keine OAuth-Tokens - das war eine Entscheidung und ist der Grund, warum
     * dieser Test sie nicht setzen kann. Was es gibt, ist eine Sitzung mit
     * ihrem `tokenHash` und der Identitätsspiegel; beides hängt am Benutzer
     * und ist über ihn erreichbar. Keiner der Werte darf in der Antwort
     * stehen.
     */
    const benutzer = await prisma.user.create({
      data: { discordId: ZIEL, username: 'zielperson' },
    });
    await prisma.session.create({
      data: {
        userId: benutzer.id,
        tokenHash: 'TOKENHASH-NICHT-ZEIGEN',
        expiresAt: new Date(Date.now() + 86_400_000),
        idleExpiresAt: new Date(Date.now() + 3_600_000),
        ipHash: 'IPHASH-NICHT-ZEIGEN',
        userAgent: 'AGENT-NICHT-ZEIGEN',
      },
    });
    await prisma.discordIdentityCache.create({
      data: { discordId: ZIEL, userId: benutzer.id, isMember: true, roleIds: [TEAM_ROLLE] },
    });
    await erlaube(
      MEMBER_PERMISSIONS.view,
      MEMBER_PERMISSIONS.basicAll,
      MEMBER_PERMISSIONS.rolesAll,
      MEMBER_PERMISSIONS.moderationAll,
      MEMBER_PERMISSIONS.notesAll,
    );

    const { interaction, mitschrift } = interaktion(
      'user',
      { id: MOD, roleIds: [TEAM_ROLLE] },
      { id: ZIEL, username: 'zielperson' },
    );
    await handleModerationCommand(interaction as never);

    const inhalt = alsText(letzte(mitschrift));
    for (const geheim of [
      'TOKENHASH-NICHT-ZEIGEN',
      'IPHASH-NICHT-ZEIGEN',
      'AGENT-NICHT-ZEIGEN',
      benutzer.id,
    ]) {
      expect(inhalt, geheim).not.toContain(geheim);
    }
    /*
     * Und gar keine Adresse, die wie eine E-Mail aussieht.
     *
     * Ein `@` allein kommt vor - `<@123…>` ist die Erwähnung, aus der Discord
     * den Namen macht. Was nicht vorkommen darf, ist ein `@` mit einer Domain
     * dahinter: das ist die Form, in der eine E-Mail versehentlich in eine
     * Ausgabe gerät.
     */
    expect(inhalt).not.toMatch(/@[\w.-]+\.[a-z]{2,}/iu);
    // Dass es ein Konto gibt, darf dastehen - das ist die Frage der
    // Moderation («chan ich ihm en Link schicke?»).
    expect(inhalt).toContain('SwissHub-Konto');
  });
});

/**
 * Die drei kleinen Rechnungen, die keine Datenbank brauchen.
 *
 * Sie stehen hier und nicht in einer eigenen Datei, weil sie zu diesen
 * Befehlen gehören - und weil ein Alter von «0 Jahre» oder ein Backtick, der
 * den Rest der Nachricht verschluckt, genau die Art Fehler ist, die man in
 * einer Antwort erst sieht, wenn sie schon draussen ist.
 */
describeWithDatabase('Moderationsbefehle: die Rechnungen darin', () => {
  beforeAll(async () => {
    await pushSchema();
  });

  it('nennt ein Alter in Tagen, Monaten und Jahren', () => {
    const jetzt = new Date('2026-10-02T12:00:00.000Z');
    expect(alter(new Date('2026-10-02T06:00:00.000Z'), jetzt)).toBe('heute');
    expect(alter(new Date('2026-10-01T06:00:00.000Z'), jetzt)).toBe('1 Tag');
    expect(alter(new Date('2026-09-20T12:00:00.000Z'), jetzt)).toBe('12 Tage');
    expect(alter(new Date('2026-07-02T12:00:00.000Z'), jetzt)).toBe('3 Monate');
    expect(alter(new Date('2024-10-02T12:00:00.000Z'), jetzt)).toBe('2 Jahre');
    expect(alter(new Date('2024-07-02T12:00:00.000Z'), jetzt)).toBe('2 Jahre, 3 Monate');
    expect(alter(null, jetzt)).toBe('unbekannt');
  });

  it('rechnet aus der Zukunft keine negative Zeit', () => {
    // Eine Systemuhr, die nachlaeuft, soll kein «-3 Tage» erzeugen.
    const jetzt = new Date('2026-10-02T12:00:00.000Z');
    expect(alter(new Date('2027-01-01T12:00:00.000Z'), jetzt)).toBe('heute');
  });

  it('entschärft Discord-Auszeichnung in fremdem Text', () => {
    /*
     * Eine Notiz kommt von einem Menschen. Ohne diesen Schritt wird `**fett**`
     * fett, ein Backtick oeffnet einen Codeblock, der den Rest der Nachricht
     * verschluckt, und `[Text](url)` wird ein Link.
     */
    expect(entschaerfe('**fett**')).toBe('\\*\\*fett\\*\\*');
    expect(entschaerfe('`code`')).toBe('\\`code\\`');
    expect(entschaerfe('[hier](https://example.invalid)')).toBe('\\[hier\\]\\(https://example.invalid\\)');
    expect(entschaerfe('> Zitat')).toBe('\\> Zitat');
    expect(entschaerfe('harmlos')).toBe('harmlos');
  });

  it('liest das Kontodatum aus einer Snowflake', () => {
    // Die erste Sekunde der Discord-Epoche: 1. Januar 2015, 00:00 UTC.
    expect(snowflakeDatum('4194304')).toBeNull(); // zu kurz für eine Kennung
    const datum = snowflakeDatum('175928847299117063');
    expect(datum?.toISOString()).toBe('2016-04-30T11:18:25.796Z');
    expect(snowflakeDatum('nicht-numerisch')).toBeNull();
  });
});
