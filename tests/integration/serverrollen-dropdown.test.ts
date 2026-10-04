import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_serverrollen_dropdown');

/**
 * Das Rollenmenü auf Discord - und die Exklusivregel dahinter.
 *
 * ## Was hier geprüft wird und warum gegen eine echte Datenbank
 *
 * Weil die entscheidende Aussage eine über **Zustand** ist: nach einer Wahl in
 * einer exklusiven Gruppe darf die Person genau eine Rolle daraus haben, und
 * zwar auch dann, wenn das Menü etwas anderes schickt. Das lässt sich nur
 * zeigen, wenn Gruppen, Rollenzuordnungen und Freigaben wirklich in Tabellen
 * stehen - eine Attrappe der Datenbank würde genau die Frage wegabstrahieren.
 *
 * Discord ist dagegen eine Attrappe: geprüft wird, **was** der Dienst
 * aufträgt. Dass ein Tausch ein einziges `setRoles` ist und nicht zwei
 * Aufrufe, ist eine Aussage über unseren Code; was Discord daraus macht, ist
 * keine.
 */
const { prisma, clearRevisionCaches } = await import('@swisshub/database');
const { serverrollen, setModuleEnabled, setModuleSettings } = await import('@swisshub/modules');
const { setDiscordGateway, DISCORD_PERMISSIONS } = await import('@swisshub/discord');

const MITGLIED = '900000000000006001';
const BOT = '900000000000006002';
const BOT_ROLLE = '900000000000006101';
const MAENNLICH = '900000000000006102';
const WEIBLICH = '900000000000006103';
const VALORANT = '900000000000006104';
const CS2 = '900000000000006105';
const GEFAEHRLICH = '900000000000006106';
const UEBER_DEM_BOT = '900000000000006107';
const KANAL = '700000000000006001';

interface RollenZeile {
  roleId: string;
  name: string;
  position: number;
  managed?: boolean;
  permissions?: string;
}

const ROLLEN: RollenZeile[] = [
  { roleId: BOT_ROLLE, name: 'SwissHub Bot', position: 50, managed: true },
  { roleId: MAENNLICH, name: 'Männlich', position: 10 },
  { roleId: WEIBLICH, name: 'Weiblich', position: 9 },
  { roleId: VALORANT, name: 'Valorant', position: 8 },
  { roleId: CS2, name: 'CS2', position: 7 },
  {
    roleId: GEFAEHRLICH,
    name: 'Content',
    position: 6,
    permissions: DISCORD_PERMISSIONS.MANAGE_ROLES.toString(),
  },
  { roleId: UEBER_DEM_BOT, name: 'Admin-Team', position: 90 },
];

async function schreibeRollen(): Promise<void> {
  await prisma.discordRoleCache.deleteMany();
  for (const rolle of ROLLEN) {
    await prisma.discordRoleCache.create({
      data: {
        roleId: rolle.roleId,
        name: rolle.name,
        color: 0,
        position: rolle.position,
        managed: rolle.managed ?? false,
        permissions: rolle.permissions ?? '0',
      },
    });
  }
  clearRevisionCaches();
}

/**
 * Ein Discord-Zugang, der mitschreibt - und der seine Rollen behält.
 *
 * `setRoles` schreibt in denselben Zustand, den `members.get` liest. Ohne das
 * liesse sich «nie zwei Rollen gleichzeitig» nicht prüfen: die zweite Wahl
 * sähe die erste nicht und hätte nichts zu tauschen.
 */
function attrappe(start: string[] = []) {
  let eigene = [...start];
  const gesetzt: Array<{ discordId: string; roleIds: string[] }> = [];
  const gesendet: Array<{ channelId: string; payload: unknown }> = [];
  const bearbeitet: Array<{ channelId: string; messageId: string; payload: unknown }> = [];
  const geloescht: Array<{ channelId: string; messageId: string }> = [];
  /** Nachrichten, die es im Kanal «gibt». */
  const vorhanden = new Set<string>();
  let naechsteId = 1;
  /** Soll `edit` scheitern - als wäre die Nachricht gelöscht? */
  let editScheitert = false;

  const gateway = {
    members: {
      get: vi.fn(async (discordId: string) =>
        discordId === BOT ? mitgliedsAttrappe(BOT, [BOT_ROLLE]) : mitgliedsAttrappe(discordId, eigene),
      ),
      setRoles: vi.fn(async (discordId: string, roleIds: string[]) => {
        gesetzt.push({ discordId, roleIds });
        eigene = [...roleIds];
      }),
    },
    roles: {
      list: vi.fn(async () => []),
      add: vi.fn(async (_discordId: string, roleId: string) => {
        eigene = [...eigene, roleId];
      }),
      remove: vi.fn(async (_discordId: string, roleId: string) => {
        eigene = eigene.filter((eintrag) => eintrag !== roleId);
      }),
    },
    channels: {
      list: vi.fn(async () => []),
      send: vi.fn(async (channelId: string, payload: unknown) => {
        const id = `msg-${naechsteId++}`;
        vorhanden.add(id);
        gesendet.push({ channelId, payload });
        return { id, channelId };
      }),
      edit: vi.fn(async (channelId: string, messageId: string, payload: unknown) => {
        if (editScheitert || !vorhanden.has(messageId)) {
          throw new Error('Unknown Message');
        }
        bearbeitet.push({ channelId, messageId, payload });
      }),
      delete: vi.fn(async (channelId: string, messageId: string) => {
        vorhanden.delete(messageId);
        geloescht.push({ channelId, messageId });
      }),
      message: vi.fn(async (_channelId: string, messageId: string) =>
        vorhanden.has(messageId)
          ? { id: messageId, authorId: BOT, authorIsBot: true, createdAt: new Date() }
          : null,
      ),
    },
    bot: {
      identity: vi.fn(async () => ({ discordId: BOT, username: 'Bot' })),
      member: vi.fn(async () => mitgliedsAttrappe(BOT, [BOT_ROLLE])),
      highestRolePosition: vi.fn(async () => 50),
    },
    guild: { get: vi.fn(async () => ({ id: '1', name: 'SwissHub', ownerId: '9' })) },
  };

  return {
    gateway,
    gesetzt,
    gesendet,
    bearbeitet,
    geloescht,
    rollenVon: () => [...eigene],
    loescheNachricht: (id: string) => vorhanden.delete(id),
    setzeEditFehler: (wert: boolean) => {
      editScheitert = wert;
    },
  };
}

function mitgliedsAttrappe(discordId: string, roleIds: string[]) {
  return {
    discordId,
    username: 'tester',
    displayName: 'Tester',
    globalName: null,
    nickname: null,
    avatarHash: null,
    isBot: discordId === BOT,
    roleIds,
    joinedAt: new Date(),
    accountCreatedAt: new Date('2020-01-01'),
    boosting: false,
    timedOutUntil: null,
  };
}

async function einstellungen(selbstvergabeAktiv = true): Promise<void> {
  await setModuleSettings(
    serverrollen.SERVERROLLEN_MODULE_ID,
    { oeffentlichAktiv: true, untertitel: 'Rollen.', selbstvergabeAktiv },
    'test',
  );
  clearRevisionCaches();
}

/** Eine Gruppe mit ihren freigegebenen Rollen. */
async function gruppeMit(
  name: string,
  exklusiv: boolean,
  rollen: Array<{ id: string; selfRemovable?: boolean; frei?: boolean }>,
): Promise<string> {
  const id = await serverrollen.erstelleKategorie({ name, exklusiv });
  for (const [index, rolle] of rollen.entries()) {
    await prisma.serverRoleMeta.create({
      data: {
        discordRoleId: rolle.id,
        categoryId: id,
        sortOrder: index,
        selfAssignable: rolle.frei ?? true,
        selfRemovable: rolle.selfRemovable ?? true,
      },
    });
  }
  return id;
}

const AKTEUR = { discordId: '900000000000006999', username: 'admin' };

describeWithDatabase('Serverrollen: Dropdown und Exklusivgruppen', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "ServerRoleMeta","ServerRoleCategory","DiscordRoleCache","ModuleState","AuditLog" RESTART IDENTITY CASCADE',
    );
    clearRevisionCaches();
    await setModuleEnabled(serverrollen.SERVERROLLEN_MODULE_ID, true, 'test');
    await einstellungen();
    await schreibeRollen();
  });

  // --- Exklusivgruppe ------------------------------------------------------

  it('tauscht in einer exklusiven Gruppe und lässt nie zwei Rollen zu', async () => {
    const welt = attrappe([]);
    setDiscordGateway(welt.gateway as never);
    const gruppe = await gruppeMit('Geschlecht', true, [{ id: MAENNLICH }, { id: WEIBLICH }]);

    const erste = await serverrollen.setzeGruppenauswahl(MITGLIED, gruppe, [MAENNLICH]);
    expect(erste.erfolg).toBe(true);
    expect(welt.rollenVon()).toContain(MAENNLICH);

    const zweite = await serverrollen.setzeGruppenauswahl(MITGLIED, gruppe, [WEIBLICH]);
    expect(zweite.erfolg).toBe(true);
    /*
     * Die eigentliche Zusage: **genau eine**.
     *
     * Nicht «Weiblich ist dabei» - das wäre auch wahr, wenn Männlich noch da
     * wäre. Gezählt wird, wie viele Rollen der Gruppe übrig sind.
     */
    const ausDerGruppe = welt.rollenVon().filter((id) => id === MAENNLICH || id === WEIBLICH);
    expect(ausDerGruppe).toEqual([WEIBLICH]);
    expect(zweite.weg).toEqual(['Männlich']);
    expect(zweite.dazu).toEqual(['Weiblich']);
  });

  it('macht den Tausch in einem einzigen Aufruf', async () => {
    const welt = attrappe([MAENNLICH]);
    setDiscordGateway(welt.gateway as never);
    const gruppe = await gruppeMit('Geschlecht', true, [{ id: MAENNLICH }, { id: WEIBLICH }]);

    await serverrollen.setzeGruppenauswahl(MITGLIED, gruppe, [WEIBLICH]);

    /*
     * Zwischen zwei Aufrufen gäbe es einen Moment mit zwei Rollen oder mit
     * keiner - je nachdem, welcher zuerst kommt und welcher scheitert.
     */
    expect(welt.gesetzt).toHaveLength(1);
    expect(welt.gesetzt[0]?.roleIds).toEqual([WEIBLICH]);
    expect(welt.gateway.roles.add).not.toHaveBeenCalled();
    expect(welt.gateway.roles.remove).not.toHaveBeenCalled();
  });

  it('gibt die letzte Rolle einer exklusiven Gruppe über die leere Auswahl ab', async () => {
    const welt = attrappe([MAENNLICH]);
    setDiscordGateway(welt.gateway as never);
    const gruppe = await gruppeMit('Geschlecht', true, [{ id: MAENNLICH }, { id: WEIBLICH }]);

    const ergebnis = await serverrollen.setzeGruppenauswahl(MITGLIED, gruppe, []);
    expect(ergebnis.erfolg).toBe(true);
    expect(welt.rollenVon()).not.toContain(MAENNLICH);
  });

  it('weist mehr als eine Wahl in einer exklusiven Gruppe ab', async () => {
    const welt = attrappe([]);
    setDiscordGateway(welt.gateway as never);
    const gruppe = await gruppeMit('Geschlecht', true, [{ id: MAENNLICH }, { id: WEIBLICH }]);

    const ergebnis = await serverrollen.setzeGruppenauswahl(MITGLIED, gruppe, [MAENNLICH, WEIBLICH]);
    expect(ergebnis.erfolg).toBe(false);
    // Und zwar ohne etwas zu tun: eine Absage ändert nichts.
    expect(welt.gesetzt).toHaveLength(0);
  });

  // --- Sammelgruppe --------------------------------------------------------

  it('lässt in einer Sammelgruppe mehrere Rollen zu und nimmt sie wieder weg', async () => {
    const welt = attrappe([]);
    setDiscordGateway(welt.gateway as never);
    const gruppe = await gruppeMit('Spiele', false, [{ id: VALORANT }, { id: CS2 }]);

    const beide = await serverrollen.setzeGruppenauswahl(MITGLIED, gruppe, [VALORANT, CS2]);
    expect(beide.erfolg).toBe(true);
    expect(welt.rollenVon()).toEqual(expect.arrayContaining([VALORANT, CS2]));

    /*
     * Die Auswahl ist der Wunsch, nicht ein Zusatz.
     *
     * Wer nur noch CS2 markiert, will nur noch CS2 - genau so lässt sich über
     * dasselbe Menü eine Rolle abgeben, ohne einen zweiten Knopf dafür.
     */
    const nurEines = await serverrollen.setzeGruppenauswahl(MITGLIED, gruppe, [CS2]);
    expect(nurEines.weg).toEqual(['Valorant']);
    expect(welt.rollenVon()).not.toContain(VALORANT);
    expect(welt.rollenVon()).toContain(CS2);
  });

  it('lässt Rollen anderer Gruppen unberührt', async () => {
    const welt = attrappe([VALORANT]);
    setDiscordGateway(welt.gateway as never);
    await gruppeMit('Spiele', false, [{ id: VALORANT }, { id: CS2 }]);
    const geschlecht = await gruppeMit('Geschlecht', true, [{ id: MAENNLICH }, { id: WEIBLICH }]);

    await serverrollen.setzeGruppenauswahl(MITGLIED, geschlecht, [MAENNLICH]);

    // Eine exklusive Gruppe räumt ihre eigene Gruppe auf - nicht den Rest.
    expect(welt.rollenVon()).toEqual(expect.arrayContaining([VALORANT, MAENNLICH]));
  });

  // --- Sicherheit ----------------------------------------------------------

  it('blockiert eine Rolle, die nicht zu dieser Gruppe gehört', async () => {
    const welt = attrappe([]);
    setDiscordGateway(welt.gateway as never);
    const gruppe = await gruppeMit('Geschlecht', true, [{ id: MAENNLICH }, { id: WEIBLICH }]);

    const ergebnis = await serverrollen.setzeGruppenauswahl(MITGLIED, gruppe, [UEBER_DEM_BOT]);
    expect(ergebnis.erfolg).toBe(false);
    expect(welt.gesetzt).toHaveLength(0);

    // Und es steht im Log: eine fremde Rollenkennung ist kein Alltag.
    const eintrag = await prisma.auditLog.findFirst({
      where: { action: 'SERVERROLE_SELF_DENIED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(eintrag).not.toBeNull();
    expect(JSON.stringify(eintrag?.metadata)).toContain('fremde_rolle');
  });

  it('blockiert eine Rolle mit kritischen Rechten, obwohl sie in der Gruppe steht', async () => {
    const welt = attrappe([]);
    setDiscordGateway(welt.gateway as never);
    const gruppe = await gruppeMit('Spiele', false, [{ id: VALORANT }, { id: GEFAEHRLICH }]);

    const ergebnis = await serverrollen.setzeGruppenauswahl(MITGLIED, gruppe, [GEFAEHRLICH]);
    expect(ergebnis.erfolg).toBe(false);
    expect(welt.gesetzt).toHaveLength(0);
  });

  it('blockiert eine Rolle über der Bot-Hierarchie', async () => {
    const welt = attrappe([]);
    setDiscordGateway(welt.gateway as never);
    const gruppe = await gruppeMit('Spiele', false, [{ id: UEBER_DEM_BOT }]);

    const ergebnis = await serverrollen.setzeGruppenauswahl(MITGLIED, gruppe, [UEBER_DEM_BOT]);
    expect(ergebnis.erfolg).toBe(false);
    expect(welt.gesetzt).toHaveLength(0);
  });

  it('nimmt beim Tausch keine Rolle weg, die man nicht selbst abgeben darf', async () => {
    const welt = attrappe([MAENNLICH]);
    setDiscordGateway(welt.gateway as never);
    const gruppe = await gruppeMit('Geschlecht', true, [
      { id: MAENNLICH, selfRemovable: false },
      { id: WEIBLICH },
    ]);

    const ergebnis = await serverrollen.setzeGruppenauswahl(MITGLIED, gruppe, [WEIBLICH]);
    expect(ergebnis.erfolg).toBe(false);
    expect(ergebnis.nachricht).toContain('Männlich');
    expect(welt.rollenVon()).toEqual([MAENNLICH]);
  });

  it('schweigt, wenn die Selbstvergabe ausgeschaltet ist', async () => {
    const welt = attrappe([]);
    setDiscordGateway(welt.gateway as never);
    const gruppe = await gruppeMit('Spiele', false, [{ id: VALORANT }]);
    await einstellungen(false);

    const ergebnis = await serverrollen.setzeGruppenauswahl(MITGLIED, gruppe, [VALORANT]);
    expect(ergebnis.erfolg).toBe(false);
    expect(welt.gesetzt).toHaveLength(0);
  });

  // --- Die Nachricht -------------------------------------------------------

  it('baut ein Menü aus der aktuellen Gruppenkonfiguration', async () => {
    const welt = attrappe([]);
    setDiscordGateway(welt.gateway as never);
    const gruppe = await gruppeMit('Geschlecht', true, [{ id: MAENNLICH }, { id: WEIBLICH }]);

    const nachricht = await serverrollen.baueGruppenNachricht(gruppe);
    const menue = nachricht.components?.[0]?.components[0] as {
      type: number;
      custom_id: string;
      min_values?: number;
      max_values?: number;
      options: Array<{ label: string; value: string }>;
    };

    expect(menue.type).toBe(3);
    expect(menue.custom_id).toBe(`${serverrollen.SERVERROLLEN_SELECT_PREFIX}${gruppe}`);
    // Exklusiv: höchstens eine Wahl, dazu die Option zum Abgeben.
    expect(menue.max_values).toBe(1);
    expect(menue.options.map((option) => option.value)).toEqual([
      MAENNLICH,
      WEIBLICH,
      serverrollen.KEINE_WAHL,
    ]);
    expect(nachricht.embeds?.[0]?.title).toBe('Geschlecht');
  });

  it('erlaubt in einer Sammelgruppe mehrere Werte und bietet kein «Keine» an', async () => {
    const welt = attrappe([]);
    setDiscordGateway(welt.gateway as never);
    const gruppe = await gruppeMit('Spiele', false, [{ id: VALORANT }, { id: CS2 }]);

    const menue = (await serverrollen.baueGruppenNachricht(gruppe)).components?.[0]?.components[0] as {
      min_values?: number;
      max_values?: number;
      options: Array<{ value: string }>;
    };
    expect(menue.max_values).toBe(2);
    // Leere Auswahl genügt zum Abgeben - eine Option dafür wäre dasselbe zweimal.
    expect(menue.min_values).toBe(0);
    expect(menue.options.map((option) => option.value)).toEqual([VALORANT, CS2]);
  });

  it('lässt gesperrte Rollen aus dem Menü heraus', async () => {
    const welt = attrappe([]);
    setDiscordGateway(welt.gateway as never);
    const gruppe = await gruppeMit('Spiele', false, [
      { id: VALORANT },
      { id: GEFAEHRLICH },
      { id: UEBER_DEM_BOT },
      { id: CS2, frei: false },
    ]);

    const optionen = await serverrollen.waehlbareRollen(gruppe);
    // Nur die freigegebene und sichere Rolle bleibt übrig.
    expect(optionen.map((option) => option.discordRoleId)).toEqual([VALORANT]);
  });

  it('veröffentlicht, aktualisiert dieselbe Nachricht und entfernt sie wieder', async () => {
    const welt = attrappe([]);
    setDiscordGateway(welt.gateway as never);
    const gruppe = await gruppeMit('Geschlecht', true, [{ id: MAENNLICH }, { id: WEIBLICH }]);
    await serverrollen.speichereEmbedEinstellungen(gruppe, { channelId: KANAL, titel: 'Wähle' });

    const erste = await serverrollen.sendeGruppenEmbed(gruppe, AKTEUR);
    expect(erste.neu).toBe(true);
    expect(welt.gesendet).toHaveLength(1);

    const zweite = await serverrollen.sendeGruppenEmbed(gruppe, AKTEUR);
    expect(zweite.neu).toBe(false);
    expect(zweite.messageId).toBe(erste.messageId);
    // Keine zweite Nachricht: ein altes Menü im Kanal würde weiter bedient.
    expect(welt.gesendet).toHaveLength(1);
    expect(welt.bearbeitet).toHaveLength(1);

    await serverrollen.entferneGruppenEmbed(gruppe, AKTEUR);
    expect(welt.geloescht).toEqual([{ channelId: KANAL, messageId: erste.messageId }]);
    const danach = await prisma.serverRoleCategory.findUniqueOrThrow({ where: { id: gruppe } });
    expect(danach.embedMessageId).toBeNull();
    expect(danach.embedAktiv).toBe(false);
  });

  it('sendet neu, wenn die Nachricht im Kanal gelöscht wurde', async () => {
    const welt = attrappe([]);
    setDiscordGateway(welt.gateway as never);
    const gruppe = await gruppeMit('Spiele', false, [{ id: VALORANT }]);
    await serverrollen.speichereEmbedEinstellungen(gruppe, { channelId: KANAL });

    const erste = await serverrollen.sendeGruppenEmbed(gruppe, AKTEUR);
    welt.loescheNachricht(erste.messageId);

    /*
     * Ein Fehlschlag beim Bearbeiten ist hier kein Fehler, sondern eine
     * Auskunft: jemand hat im Kanal aufgeräumt. Zu scheitern hiesse, dass die
     * Gruppe auf Discord verstummt, bis jemand «entfernen» und dann
     * «veröffentlichen» klickt.
     */
    const zweite = await serverrollen.sendeGruppenEmbed(gruppe, AKTEUR);
    expect(zweite.neu).toBe(true);
    expect(zweite.messageId).not.toBe(erste.messageId);
    expect(welt.gesendet).toHaveLength(2);
  });

  it('meldet im Zustand, wenn die Nachricht fehlt', async () => {
    const welt = attrappe([]);
    setDiscordGateway(welt.gateway as never);
    const gruppe = await gruppeMit('Spiele', false, [{ id: VALORANT }]);

    expect((await serverrollen.embedStand(gruppe)).zustand).toBe('nicht_veroeffentlicht');

    await serverrollen.speichereEmbedEinstellungen(gruppe, { channelId: KANAL });
    const gesendet = await serverrollen.sendeGruppenEmbed(gruppe, AKTEUR);
    expect((await serverrollen.embedStand(gruppe)).zustand).toBe('veroeffentlicht');

    welt.loescheNachricht(gesendet.messageId);
    const stand = await serverrollen.embedStand(gruppe);
    expect(stand.zustand).toBe('nachricht_fehlt');
    // Die Zahl der Optionen steht daneben - sie entscheidet, ob Senden Sinn hat.
    expect(stand.anzahlOptionen).toBe(1);
  });

  it('löst die alte Nachricht ab, wenn der Kanal wechselt', async () => {
    const welt = attrappe([]);
    setDiscordGateway(welt.gateway as never);
    const gruppe = await gruppeMit('Spiele', false, [{ id: VALORANT }]);
    await serverrollen.speichereEmbedEinstellungen(gruppe, { channelId: KANAL });
    const erste = await serverrollen.sendeGruppenEmbed(gruppe, AKTEUR);

    await serverrollen.speichereEmbedEinstellungen(gruppe, { channelId: '700000000000006002' });

    // Die alte ist weg und die Kennung vergessen - sonst schriebe
    // «aktualisieren» weiter in den alten Kanal.
    expect(welt.geloescht).toEqual([{ channelId: KANAL, messageId: erste.messageId }]);
    const danach = await prisma.serverRoleCategory.findUniqueOrThrow({ where: { id: gruppe } });
    expect(danach.embedMessageId).toBeNull();
  });

  it('führt das Menü nach, wenn die Gruppe exklusiv wird', async () => {
    const welt = attrappe([]);
    setDiscordGateway(welt.gateway as never);
    const gruppe = await gruppeMit('Spiele', false, [{ id: VALORANT }, { id: CS2 }]);
    await serverrollen.speichereEmbedEinstellungen(gruppe, { channelId: KANAL });
    await serverrollen.sendeGruppenEmbed(gruppe, AKTEUR);
    const vorher = welt.bearbeitet.length;

    await serverrollen.bearbeiteKategorie(gruppe, { exklusiv: true });

    /*
     * Ohne Nachführen stünde im Kanal ein Menü, das zwei Wahlen anbietet,
     * während der Dienst die zweite abweist - eine falsche Zusage.
     */
    expect(welt.bearbeitet.length).toBe(vorher + 1);
    const letzte = welt.bearbeitet.at(-1)?.payload as {
      components: Array<{ components: Array<{ max_values?: number }> }>;
    };
    expect(letzte.components[0]?.components[0]?.max_values).toBe(1);
  });

  it('führt das Menü nach, wenn eine Rolle dazukommt', async () => {
    const welt = attrappe([]);
    setDiscordGateway(welt.gateway as never);
    const gruppe = await gruppeMit('Spiele', false, [{ id: VALORANT }]);
    await serverrollen.speichereEmbedEinstellungen(gruppe, { channelId: KANAL });
    await serverrollen.sendeGruppenEmbed(gruppe, AKTEUR);

    await serverrollen.speichereRolle(CS2, { categoryId: gruppe, selfAssignable: true });

    const letzte = welt.bearbeitet.at(-1)?.payload as {
      components: Array<{ components: Array<{ options: Array<{ value: string }> }> }>;
    };
    expect(letzte.components[0]?.components[0]?.options.map((option) => option.value)).toEqual([
      VALORANT,
      CS2,
    ]);
  });

  // --- Die Kennung des Menüs ----------------------------------------------

  it('liest die Gruppenkennung nur aus dem eigenen Namensraum', async () => {
    const gruppe = 'abc123';
    expect(serverrollen.leseGruppenId(`${serverrollen.SERVERROLLEN_SELECT_PREFIX}${gruppe}`)).toBe(gruppe);
    // Fremde Kennungen gehen den Bot hier nichts an.
    expect(serverrollen.leseGruppenId('swisshub:voice:select:access:1')).toBeNull();
    expect(serverrollen.leseGruppenId(serverrollen.SERVERROLLEN_SELECT_PREFIX)).toBeNull();
    expect(serverrollen.leseGruppenId('')).toBeNull();
  });

  // --- Spalten -------------------------------------------------------------

  it('deckelt die Spaltenzahl auf eins bis vier', async () => {
    const welt = attrappe([]);
    setDiscordGateway(welt.gateway as never);
    const gruppe = await serverrollen.erstelleKategorie({ name: 'Spiele', spalten: 9 });
    expect((await prisma.serverRoleCategory.findUniqueOrThrow({ where: { id: gruppe } })).spalten).toBe(4);

    await serverrollen.bearbeiteKategorie(gruppe, { spalten: 0 });
    expect((await prisma.serverRoleCategory.findUniqueOrThrow({ where: { id: gruppe } })).spalten).toBe(1);

    await serverrollen.bearbeiteKategorie(gruppe, { spalten: 3 });
    expect((await prisma.serverRoleCategory.findUniqueOrThrow({ where: { id: gruppe } })).spalten).toBe(3);
  });

  it('gibt die Spaltenzahl an die öffentliche Seite weiter', async () => {
    const welt = attrappe([]);
    setDiscordGateway(welt.gateway as never);
    const gruppe = await gruppeMit('Spiele', false, [{ id: VALORANT }]);
    await serverrollen.bearbeiteKategorie(gruppe, { spalten: 3 });

    const seite = await serverrollen.ladeOeffentlicheRollen();
    expect(seite?.kategorien.find((eintrag) => eintrag.id === gruppe)?.spalten).toBe(3);
  });

  it('legt neue Gruppen mit einer Spalte an', async () => {
    const gruppe = await serverrollen.erstelleKategorie({ name: 'Neu' });
    // Eine Migration und ein Anlegen sollen kein Layout verändern, nach dem
    // niemand gefragt hat.
    expect((await prisma.serverRoleCategory.findUniqueOrThrow({ where: { id: gruppe } })).spalten).toBe(1);
    expect((await prisma.serverRoleCategory.findUniqueOrThrow({ where: { id: gruppe } })).embedAktiv).toBe(
      false,
    );
  });
});
