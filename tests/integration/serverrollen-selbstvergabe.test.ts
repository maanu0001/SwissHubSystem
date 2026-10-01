import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_serverrollen');

/**
 * Eine Rolle selbst nehmen - und warum das zweimal geprüft wird.
 *
 * ## Der Fall, der nur hier auffällt
 *
 * Das Dashboard hakt eine harmlose Rolle zur Selbstvergabe an. Wochen später
 * bekommt dieselbe Rolle auf Discord «Mitglieder kicken» - niemand denkt dabei
 * an SwissHub. Der Haken steht weiter in der Datenbank.
 *
 * `pruefeSelbstzuweisung` allein beweist nur, dass die Regel stimmt. Dass sie
 * auch **beim Klick** angewandt wird und nicht nur beim Setzen des Hakens,
 * zeigt erst dieser Test: er ändert die Rechte der Rolle im
 * Zwischenspeicher und ruft dann `aendereEigeneRolle` auf.
 *
 * ## Warum ein echter Discord-Zugang hier eine Attrappe ist
 *
 * Weil geprüft wird, **ob** `roles.add` gerufen wird - nicht, was Discord
 * daraus macht. Die Attrappe hält die Aufrufe fest; ein gesperrter Versuch
 * darf keinen einzigen auslösen.
 */
const { prisma, clearRevisionCaches } = await import('@swisshub/database');
const { serverrollen, setModuleEnabled, setModuleSettings } = await import('@swisshub/modules');
const { setDiscordGateway, DISCORD_PERMISSIONS } = await import('@swisshub/discord');

const MITGLIED = '900000000000005001';
const BOT = '900000000000005002';
const BOT_ROLLE = '900000000000005101';
const FREI = '900000000000005102';
const GEFAEHRLICH = '900000000000005103';
const UEBER_DEM_BOT = '900000000000005104';

interface RollenZeile {
  roleId: string;
  name: string;
  color?: number;
  position: number;
  managed?: boolean;
  permissions?: string;
}

const STANDARD_ROLLEN: RollenZeile[] = [
  { roleId: BOT_ROLLE, name: 'SwissHub Bot', position: 50, managed: true },
  { roleId: FREI, name: 'Valorant', color: 0x5865f2, position: 10 },
  {
    roleId: GEFAEHRLICH,
    name: 'Content',
    position: 12,
    permissions: DISCORD_PERMISSIONS.KICK_MEMBERS.toString(),
  },
  { roleId: UEBER_DEM_BOT, name: 'Admin-Team', position: 90 },
];

async function schreibeRollen(rollen: RollenZeile[]): Promise<void> {
  await prisma.discordRoleCache.deleteMany();
  for (const rolle of rollen) {
    await prisma.discordRoleCache.create({
      data: {
        roleId: rolle.roleId,
        name: rolle.name,
        color: rolle.color ?? 0,
        position: rolle.position,
        managed: rolle.managed ?? false,
        permissions: rolle.permissions ?? '0',
      },
    });
  }
  // Der Rollen-Zwischenspeicher gilt eine Minute. Ohne dieses Leeren sähe der
  // naechste Aufruf den Stand von vor der Änderung - und der Test prüfte nichts.
  clearRevisionCaches();
}

/** Ein Discord-Zugang, der festhält, was ihm aufgetragen wurde. */
function attrappe(eigeneRollen: string[] = []) {
  const vergeben: Array<{ discordId: string; roleId: string }> = [];
  const entzogen: Array<{ discordId: string; roleId: string }> = [];
  const gateway = {
    members: {
      get: vi.fn(async (discordId: string) =>
        discordId === BOT
          ? mitgliedsAttrappe(BOT, [BOT_ROLLE])
          : mitgliedsAttrappe(discordId, eigeneRollen),
      ),
    },
    roles: {
      list: vi.fn(async () => []),
      add: vi.fn(async (discordId: string, roleId: string) => {
        vergeben.push({ discordId, roleId });
      }),
      remove: vi.fn(async (discordId: string, roleId: string) => {
        entzogen.push({ discordId, roleId });
      }),
    },
    bot: {
      identity: vi.fn(async () => ({ discordId: BOT, username: 'Bot' })),
      member: vi.fn(async () => mitgliedsAttrappe(BOT, [BOT_ROLLE])),
      highestRolePosition: vi.fn(async () => 50),
    },
    guild: { get: vi.fn(async () => ({ id: '1', name: 'SwissHub', ownerId: '9' })) },
  };
  return { gateway, vergeben, entzogen };
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

/*
 * Die Einstellungen als eigene Form und nicht als `Partial<ServerrollenSettings>`:
 * das Modul kommt hier per `await import`, ist also ein Wert und kein
 * Typ-Namensraum. Drei Felder abzuschreiben ist billiger als ein zweiter
 * Importpfad nur fuer den Typ.
 */
async function einstellungen(
  werte: Partial<{ oeffentlichAktiv: boolean; untertitel: string; selbstvergabeAktiv: boolean }> = {},
): Promise<void> {
  await setModuleSettings(
    serverrollen.SERVERROLLEN_MODULE_ID,
    {
      oeffentlichAktiv: true,
      untertitel: 'Was die Rollen bedeuten.',
      selbstvergabeAktiv: true,
      ...werte,
    },
    'test',
  );
  clearRevisionCaches();
}

describeWithDatabase('Serverrollen: eine Rolle selbst nehmen', () => {
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
    await schreibeRollen(STANDARD_ROLLEN);
  });

  it('vergibt eine freigegebene, harmlose Rolle', async () => {
    const discord = attrappe();
    setDiscordGateway(discord.gateway as never);
    await serverrollen.speichereRolle(FREI, { selfAssignable: true, beschreibung: 'Für Valorant-Abende' });

    const ergebnis = await serverrollen.aendereEigeneRolle(MITGLIED, FREI, 'hinzufuegen');

    expect(ergebnis.erfolg).toBe(true);
    expect(discord.vergeben).toEqual([{ discordId: MITGLIED, roleId: FREI }]);
  });

  it('nimmt sie auf Wunsch wieder weg', async () => {
    const discord = attrappe([FREI]);
    setDiscordGateway(discord.gateway as never);
    await serverrollen.speichereRolle(FREI, { selfAssignable: true });

    const ergebnis = await serverrollen.aendereEigeneRolle(MITGLIED, FREI, 'entfernen');

    expect(ergebnis.erfolg).toBe(true);
    expect(discord.entzogen).toEqual([{ discordId: MITGLIED, roleId: FREI }]);
  });

  it('behält den Haken, aber sperrt, sobald die Rolle kritische Rechte bekommt', async () => {
    /*
     * Der eigentliche Fall. Die Freigabe wird zu einem Zeitpunkt gesetzt, an
     * dem die Rolle harmlos ist - erst danach bekommt sie «Mitglieder kicken».
     * Niemand nimmt den Haken zurück, weil niemand an SwissHub denkt.
     */
    const discord = attrappe();
    setDiscordGateway(discord.gateway as never);
    await serverrollen.speichereRolle(GEFAEHRLICH, {}); // Zeile anlegen
    await prisma.serverRoleMeta.update({
      where: { discordRoleId: GEFAEHRLICH },
      data: { selfAssignable: true },
    });

    const ergebnis = await serverrollen.aendereEigeneRolle(MITGLIED, GEFAEHRLICH, 'hinzufuegen');

    expect(ergebnis.erfolg).toBe(false);
    expect(ergebnis.urteil?.grund).toBe('kritische_rechte');
    // Und zwar ohne einen einzigen Aufruf an Discord.
    expect(discord.vergeben).toEqual([]);
  });

  it('lässt sich den Haken für eine kritische Rolle gar nicht erst setzen', async () => {
    const discord = attrappe();
    setDiscordGateway(discord.gateway as never);
    await expect(
      serverrollen.speichereRolle(GEFAEHRLICH, { selfAssignable: true }),
    ).rejects.toThrow();
  });

  it('sperrt eine Rolle über der Bot-Rolle', async () => {
    const discord = attrappe();
    setDiscordGateway(discord.gateway as never);
    await serverrollen.speichereRolle(UEBER_DEM_BOT, {});
    await prisma.serverRoleMeta.update({
      where: { discordRoleId: UEBER_DEM_BOT },
      data: { selfAssignable: true },
    });

    const ergebnis = await serverrollen.aendereEigeneRolle(MITGLIED, UEBER_DEM_BOT, 'hinzufuegen');

    expect(ergebnis.erfolg).toBe(false);
    expect(ergebnis.urteil?.grund).toBe('ueber_der_bot_rolle');
    expect(discord.vergeben).toEqual([]);
  });

  it('schreibt einen gesperrten Versuch ins Audit Log', async () => {
    /*
     * Nicht, weil jemand etwas Böses getan hätte - der Normalfall ist eine
     * veraltete Seite. Sondern weil ein Muster das Erste wäre, was man sehen
     * will: zehn Versuche auf eine Admin-Rolle sind etwas anderes als einer.
     */
    setDiscordGateway(attrappe().gateway as never);
    await serverrollen.speichereRolle(GEFAEHRLICH, {});
    await prisma.serverRoleMeta.update({
      where: { discordRoleId: GEFAEHRLICH },
      data: { selfAssignable: true },
    });

    await serverrollen.aendereEigeneRolle(MITGLIED, GEFAEHRLICH, 'hinzufuegen');

    const eintrag = await prisma.auditLog.findFirst({
      where: { action: 'SERVERROLE_SELF_DENIED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(eintrag?.success).toBe(false);
    expect(eintrag?.actorDiscordId).toBe(MITGLIED);
  });

  it('schreibt eine erfolgreiche Vergabe ins Audit Log', async () => {
    setDiscordGateway(attrappe().gateway as never);
    await serverrollen.speichereRolle(FREI, { selfAssignable: true });

    await serverrollen.aendereEigeneRolle(MITGLIED, FREI, 'hinzufuegen');

    const eintrag = await prisma.auditLog.findFirst({ where: { action: 'SERVERROLE_SELF_ADDED' } });
    expect(eintrag?.success).toBe(true);
    expect(eintrag?.targetLabel).toBe('Valorant');
  });

  it('antwortet auf den zweiten Klick ruhig statt mit einem Fehler', async () => {
    const discord = attrappe([FREI]);
    setDiscordGateway(discord.gateway as never);
    await serverrollen.speichereRolle(FREI, { selfAssignable: true });

    const ergebnis = await serverrollen.aendereEigeneRolle(MITGLIED, FREI, 'hinzufuegen');

    expect(ergebnis.erfolg).toBe(true);
    // Nichts zu tun ist kein Fehler - und schickt auch nichts an Discord.
    expect(discord.vergeben).toEqual([]);
  });

  it('verweigert das Abgeben, wenn die Rolle bleiben soll', async () => {
    const discord = attrappe([FREI]);
    setDiscordGateway(discord.gateway as never);
    await serverrollen.speichereRolle(FREI, { selfAssignable: true, selfRemovable: false });

    const ergebnis = await serverrollen.aendereEigeneRolle(MITGLIED, FREI, 'entfernen');

    expect(ergebnis.erfolg).toBe(false);
    expect(discord.entzogen).toEqual([]);
  });

  it('sperrt alles, solange der Hauptschalter aus ist', async () => {
    const discord = attrappe();
    setDiscordGateway(discord.gateway as never);
    await serverrollen.speichereRolle(FREI, { selfAssignable: true });
    await einstellungen({ selbstvergabeAktiv: false });

    const ergebnis = await serverrollen.aendereEigeneRolle(MITGLIED, FREI, 'hinzufuegen');

    expect(ergebnis.erfolg).toBe(false);
    expect(discord.vergeben).toEqual([]);
  });

  it('verlangt die vorausgesetzte Rolle beim Zugriff, nicht nur in der Anzeige', async () => {
    const discord = attrappe([]);
    setDiscordGateway(discord.gateway as never);
    await serverrollen.speichereRolle(FREI, { selfAssignable: true, voraussetzungRoleId: UEBER_DEM_BOT });

    const ohne = await serverrollen.aendereEigeneRolle(MITGLIED, FREI, 'hinzufuegen');
    expect(ohne.erfolg).toBe(false);
    expect(ohne.urteil?.grund).toBe('voraussetzung_fehlt');

    const mit = attrappe([UEBER_DEM_BOT]);
    setDiscordGateway(mit.gateway as never);
    const danach = await serverrollen.aendereEigeneRolle(MITGLIED, FREI, 'hinzufuegen');
    expect(danach.erfolg).toBe(true);
  });
});

describeWithDatabase('Serverrollen: die öffentliche Seite', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "ServerRoleMeta","ServerRoleCategory","DiscordRoleCache","ModuleState","AuditLog" RESTART IDENTITY CASCADE',
    );
    clearRevisionCaches();
    setDiscordGateway(attrappe().gateway as never);
    await setModuleEnabled(serverrollen.SERVERROLLEN_MODULE_ID, true, 'test');
    await einstellungen();
    await schreibeRollen(STANDARD_ROLLEN);
  });

  it('gibt nichts heraus, solange der Schalter aus ist', async () => {
    await einstellungen({ oeffentlichAktiv: false });
    // `null` und nicht «leere Seite»: die Seite antwortet damit mit 404.
    expect(await serverrollen.ladeOeffentlicheRollen()).toBeNull();
  });

  it('gibt nichts heraus, solange das Modul aus ist', async () => {
    await setModuleEnabled(serverrollen.SERVERROLLEN_MODULE_ID, false, 'test');
    clearRevisionCaches();
    expect(await serverrollen.ladeOeffentlicheRollen()).toBeNull();
  });

  it('zeigt nur Rollen, zu denen etwas eingetragen ist', async () => {
    await serverrollen.speichereRolle(FREI, { beschreibung: 'Für Valorant-Abende' });

    const seite = await serverrollen.ladeOeffentlicheRollen();

    const namen = (seite?.kategorien ?? []).flatMap((gruppe) => gruppe.rollen.map((r) => r.name));
    expect(namen).toEqual(['Valorant']);
  });

  it('nimmt Name und Farbe von Discord und nicht aus eigener Pflege', async () => {
    await serverrollen.speichereRolle(FREI, { beschreibung: 'Für Valorant-Abende' });

    // Auf Discord umbenannt und umgefärbt - die Seite muss sofort folgen.
    await schreibeRollen(
      STANDARD_ROLLEN.map((rolle) =>
        rolle.roleId === FREI ? { ...rolle, name: 'VALORANT', color: 0xff4655 } : rolle,
      ),
    );

    const seite = await serverrollen.ladeOeffentlicheRollen();
    const rolle = seite?.kategorien[0]?.rollen[0];
    expect(rolle?.name).toBe('VALORANT');
    expect(rolle?.farbe).toBe('#ff4655');
  });

  it('sortiert Rollen ohne Gruppe nach «Sonstige», statt sie zu verlieren', async () => {
    const gruppe = await serverrollen.erstelleKategorie({ name: 'Spiele' });
    await serverrollen.speichereRolle(FREI, { categoryId: gruppe, beschreibung: 'mit Gruppe' });
    await serverrollen.speichereRolle(UEBER_DEM_BOT, { beschreibung: 'ohne Gruppe' });

    const seite = await serverrollen.ladeOeffentlicheRollen();

    expect(seite?.kategorien.map((eintrag) => eintrag.name)).toEqual(['Spiele', 'Sonstige']);
  });

  it('verrät nicht, welche Rechte eine Rolle trägt', async () => {
    /*
     * Auf der öffentlichen Seite wäre eine Rechteliste eine Einkaufsliste für
     * jemanden, der sie nicht haben soll. Der Grund steht als Satz da, die
     * Rechte bleiben im Dashboard.
     */
    await serverrollen.speichereRolle(GEFAEHRLICH, { beschreibung: 'Content-Team' });
    await prisma.serverRoleMeta.update({
      where: { discordRoleId: GEFAEHRLICH },
      data: { selfAssignable: true },
    });

    const seite = await serverrollen.ladeOeffentlicheRollen();
    const rolle = seite?.kategorien[0]?.rollen[0];

    expect(rolle?.selbstVergebbar).toBe(false);
    expect(rolle?.sperrText).toBeTruthy();
    expect(JSON.stringify(seite)).not.toContain('KICK_MEMBERS');
  });

  it('blendet eine versteckte Gruppe samt Rollen aus', async () => {
    const gruppe = await serverrollen.erstelleKategorie({ name: 'Intern', publicVisible: false });
    await serverrollen.speichereRolle(FREI, { categoryId: gruppe, beschreibung: 'intern' });

    const seite = await serverrollen.ladeOeffentlicheRollen();
    expect(seite?.kategorien).toEqual([]);
  });

  it('hält eine Rolle, die es auf Discord nicht mehr gibt, aus der Seite heraus', async () => {
    await serverrollen.speichereRolle(FREI, { beschreibung: 'Für Valorant-Abende' });
    await schreibeRollen(STANDARD_ROLLEN.filter((rolle) => rolle.roleId !== FREI));

    const seite = await serverrollen.ladeOeffentlicheRollen();
    expect(seite?.kategorien).toEqual([]);
    // Die Beschreibung bleibt aber stehen - nach einem Rollen-Neuaufbau wäre
    // sie sonst weg, und das wäre Textarbeit für nichts.
    expect(await prisma.serverRoleMeta.findUnique({ where: { discordRoleId: FREI } })).not.toBeNull();
  });
});
