import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_verifikation_timeout');

/**
 * Wer nicht antwortet, verlässt den Server wieder.
 *
 * Die gefährlichste Zusage steht zuerst: **die Frist gilt der Person, nicht
 * der Moderation.** Wer geschrieben hat, wartet auf uns - und darf nicht
 * dafür bezahlen, dass gerade niemand aus dem Team Zeit hat. Ein Kick aus
 * diesem Grund wäre kaum zu bemerken und kaum zu erklären.
 *
 * Die zweite: **genau einmal.** Zwei Durchgänge, zwei Worker, ein Neustart
 * mittendrin - keiner davon darf eine zweite Nachricht, einen zweiten Kick
 * oder einen zweiten Audit-Eintrag erzeugen.
 *
 * Die dritte: **kein Zeitgeber im Arbeitsspeicher.** Die Frist ergibt sich
 * aus `joinedAt` und der Einstellung; ein Neustart ändert daran nichts.
 */
const { prisma } = await import('@swisshub/database');
const { verification, setModuleEnabled, setModuleSettings } = await import('@swisshub/modules');

const VERIFIKATIONSKANAL = '900000000000000601';
const MOD_KANAL = '900000000000000602';
const LOG_KANAL = '900000000000000604';
const NEULING = '100000000000000201';

interface Attrappe {
  gateway: Parameters<typeof verification.runVerificationTick>[1];
  gekickt: Array<{ discordId: string; grund?: string }>;
  dms: Array<{ discordId: string; content: string }>;
  geloescht: string[];
  gesendet: Array<{ channelId: string }>;
  dmZustellbar: boolean;
  einladungen: Array<{ code: string; expiresAt: Date | null; maxUses: number }>;
}

/** Alle Rechte, die das Aufräumen braucht. */
const ALLE_RECHTE = (1n << 10n) | (1n << 13n) | (1n << 16n);

function attrappe(): Attrappe {
  const zustand: Partial<Attrappe> = {
    gekickt: [],
    dms: [],
    geloescht: [],
    gesendet: [],
    dmZustellbar: true,
    einladungen: [{ code: 'swisshub', expiresAt: null, maxUses: 0 }],
  };
  let zaehler = 0;

  zustand.gateway = {
    members: {
      kick: vi.fn(async (discordId: string, grund?: string) => {
        zustand.gekickt!.push({ discordId, grund });
      }),
    },
    bans: { add: vi.fn(async () => undefined) },
    guild: { invites: vi.fn(async () => zustand.einladungen) },
    channels: {
      send: vi.fn(async (channelId: string) => {
        zaehler += 1;
        zustand.gesendet!.push({ channelId });
        return { id: `80000000000000000${zaehler}`, channelId };
      }),
      sendDirect: vi.fn(async (discordId: string, payload: { content?: string }) => {
        if (!zustand.dmZustellbar) {
          return false;
        }
        zustand.dms!.push({ discordId, content: payload.content ?? '' });
        return true;
      }),
      delete: vi.fn(async (_channelId: string, messageId: string) => {
        zustand.geloescht!.push(messageId);
      }),
      history: vi.fn(async () => []),
      botPermissions: vi.fn(async () => ALLE_RECHTE),
    },
  } as unknown as Attrappe['gateway'];

  return zustand as Attrappe;
}

const EINSTELLUNGEN = {
  verificationChannelId: VERIFIKATIONSKANAL,
  moderatorChannelId: MOD_KANAL,
  logChannelId: LOG_KANAL,
  expireEnabled: true,
  expireAfterMinutes: 15,
  kickOnExpire: true,
  cleanupEnabled: true,
};

/** Ein Vorgang, der vor `minutenHer` Minuten begonnen hat. */
async function vorgang(
  minutenHer: number,
  status: 'WAITING_FOR_MESSAGE' | 'WAITING_FOR_REVIEW' | 'VERIFIED' | 'REJECTED' = 'WAITING_FOR_MESSAGE',
  discordId = NEULING,
) {
  const entschieden = status === 'VERIFIED' || status === 'REJECTED';
  return prisma.verificationRequest.create({
    data: {
      guildId: 'g1',
      discordId,
      username: `user-${discordId}`,
      displayName: `Anzeige ${discordId}`,
      status,
      joinedAt: new Date(Date.now() - minutenHer * 60_000),
      ...(entschieden ? { decidedAt: new Date(), decidedBy: 'HUMAN' } : {}),
    },
  });
}

async function begruessung(requestId: string, messageId: string): Promise<void> {
  await prisma.verificationBotMessage.create({
    data: { requestId, kind: 'GREETING', channelId: VERIFIKATIONSKANAL, discordMessageId: messageId },
  });
}

const einstellungen = async () => verification.verificationSettings();

describeWithDatabase('Verifikation: Zeitüberschreitung', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "VerificationMessage","VerificationBotMessage","VerificationRequest","ModuleState","AuditLog" RESTART IDENTITY CASCADE',
    );
    await setModuleEnabled(verification.VERIFICATION_MODULE_ID, true, 'test');
    await setModuleSettings(verification.VERIFICATION_MODULE_ID, EINSTELLUNGEN, 'test');
    verification._setzeAufbewahrungZurueck();
  });

  // --- Wem die Frist gilt ---------------------------------------------------

  it('A: lässt nach fünf Minuten niemanden gehen', async () => {
    await vorgang(5);
    const mock = attrappe();

    const ergebnis = await verification.runVerificationTick(new Date(), mock.gateway);

    expect(ergebnis.abgelaufen).toBe(0);
    expect(mock.gekickt).toHaveLength(0);
  });

  it('B: lässt auch nach 14:59 niemanden gehen', async () => {
    // Die Grenze ist eine Grenze und kein ungefährer Zeitpunkt.
    await prisma.verificationRequest.create({
      data: {
        guildId: 'g1',
        discordId: NEULING,
        username: 'knapp',
        status: 'WAITING_FOR_MESSAGE',
        joinedAt: new Date(Date.now() - (15 * 60_000 - 1000)),
      },
    });
    const mock = attrappe();

    expect((await verification.runVerificationTick(new Date(), mock.gateway)).abgelaufen).toBe(0);
    expect(mock.gekickt).toHaveLength(0);
  });

  it('I: lässt niemanden gehen, der nur noch auf die Moderation wartet', async () => {
    /*
     * Der wichtigste Fall dieser Datei. Wer geschrieben hat, hat getan, was
     * von ihm verlangt war. Ihn nach einer Viertelstunde zu kicken, weil
     * gerade niemand aus dem Team Zeit hatte, wäre kaum zu bemerken und
     * kaum zu erklären - und es liesse sich nicht einmal von aussen von
     * einem Bann unterscheiden.
     */
    await vorgang(240, 'WAITING_FOR_REVIEW');
    const mock = attrappe();

    const ergebnis = await verification.runVerificationTick(new Date(), mock.gateway);

    expect(ergebnis.abgelaufen).toBe(0);
    expect(mock.gekickt).toHaveLength(0);
    expect(mock.dms).toHaveLength(0);
  });

  it('H: lässt eine bereits verifizierte Person nie gehen', async () => {
    await vorgang(240, 'VERIFIED');
    const mock = attrappe();

    expect((await verification.runVerificationTick(new Date(), mock.gateway)).abgelaufen).toBe(0);
    expect(mock.gekickt).toHaveLength(0);
  });

  it('J: rührt einen bereits gebannten Vorgang nicht mehr an', async () => {
    await vorgang(240, 'REJECTED');
    const mock = attrappe();

    expect((await verification.runVerificationTick(new Date(), mock.gateway)).abgelaufen).toBe(0);
    expect(mock.gekickt).toHaveLength(0);
  });

  // --- Der Ablauf selbst ----------------------------------------------------

  it('C: schreibt, räumt auf, kickt und protokolliert', async () => {
    const request = await vorgang(16);
    await begruessung(request.id, '600000000000000001');
    await prisma.verificationMessage.create({
      data: { requestId: request.id, discordMessageId: '600000000000000002', content: 'hoi' },
    });
    const mock = attrappe();

    const ergebnis = await verification.runVerificationTick(new Date(), mock.gateway);

    expect(ergebnis.abgelaufen).toBe(1);
    expect(ergebnis.gekickt).toBe(1);

    // Die Nachricht kommt vor dem Kick - danach teilt der Bot mit der Person
    // keinen Server mehr.
    expect(mock.dms).toHaveLength(1);
    expect(mock.dms[0]!.discordId).toBe(NEULING);
    expect(mock.dms[0]!.content).toContain('Verifikation');
    expect(mock.dms[0]!.content).toContain('https://discord.gg/swisshub');

    // Aufgeräumt wird beides: die Nachricht der Person und die des Bots.
    expect(mock.geloescht.sort()).toEqual(['600000000000000001', '600000000000000002']);

    expect(mock.gekickt).toEqual([
      { discordId: NEULING, grund: 'Verifikation nicht innerhalb von 15 Minuten abgeschlossen' },
    ]);

    const frisch = await prisma.verificationRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(frisch.status).toBe('EXPIRED');
    expect(frisch.decidedBy).toBe('SYSTEM');
  });

  it('schreibt vor dem Kick, nicht danach', async () => {
    /*
     * Nach dem Kick teilt der Bot mit der Person keinen Server mehr, und
     * Discord verweigert das Öffnen des Direktkanals. Die Erklärung käme
     * dann nie an - und ein Kick ohne Erklärung ist von einem Bann nicht zu
     * unterscheiden.
     */
    await vorgang(16);
    const mock = attrappe();
    const reihenfolge: string[] = [];
    const dm = mock.gateway!.channels.sendDirect;
    const kick = mock.gateway!.members.kick;
    mock.gateway!.channels.sendDirect = vi.fn(async (...args: unknown[]) => {
      reihenfolge.push('dm');
      return (dm as (...a: unknown[]) => Promise<boolean>)(...args);
    }) as never;
    mock.gateway!.members.kick = vi.fn(async (...args: unknown[]) => {
      reihenfolge.push('kick');
      return (kick as (...a: unknown[]) => Promise<void>)(...args);
    }) as never;

    await verification.runVerificationTick(new Date(), mock.gateway);

    expect(reihenfolge).toEqual(['dm', 'kick']);
  });

  it('schreibt den Vorgang ins Audit Log - als System, nicht als Moderator', async () => {
    await vorgang(16);
    const mock = attrappe();

    await verification.runVerificationTick(new Date(), mock.gateway);

    const eintrag = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'VERIFICATION_TIMEOUT_KICK' },
    });
    expect(eintrag.actorDiscordId).toBe('system');
    expect(eintrag.actorUsername).toContain('Zeitsteuerung');
    expect(eintrag.targetDiscordId).toBe(NEULING);
    expect(eintrag.success).toBe(true);

    const daten = eintrag.metadata as Record<string, unknown>;
    expect(daten.grund).toBe('Keine Antwort innerhalb von 15 Minuten');
    expect(daten.dm).toBe('GESENDET');
    expect(daten.kick).toBe('ERFOLGT');
    expect(daten.aufraeumen).toBe('COMPLETED');
  });

  it('spiegelt den Vorgang in den eingestellten Protokollkanal', async () => {
    // Über dieselbe Funktion wie jede andere Entscheidung - kein zweiter
    // Weg und kein fest verdrahteter Kanal.
    await vorgang(16);
    const mock = attrappe();

    await verification.runVerificationTick(new Date(), mock.gateway);

    expect(mock.gesendet.map((eintrag) => eintrag.channelId)).toContain(LOG_KANAL);
  });

  it('D: kickt auch, wenn die Direktnachricht nicht zugestellt wird', async () => {
    // Geschlossene Direktnachrichten sind eine Einstellung, die der Person
    // zusteht - kein Grund, sie im Server zu lassen.
    await vorgang(16);
    const mock = attrappe();
    mock.dmZustellbar = false;

    const ergebnis = await verification.runVerificationTick(new Date(), mock.gateway);

    expect(ergebnis.gekickt).toBe(1);
    expect(mock.gekickt).toHaveLength(1);

    const eintrag = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'VERIFICATION_TIMEOUT_KICK' },
    });
    expect((eintrag.metadata as Record<string, unknown>).dm).toBe('FEHLGESCHLAGEN');
  });

  it('kickt auch, wenn die Direktnachricht mit einem Fehler endet', async () => {
    await vorgang(16);
    const mock = attrappe();
    mock.gateway!.channels.sendDirect = vi.fn(async () => {
      throw new Error('Discord antwortet nicht');
    }) as never;

    expect((await verification.runVerificationTick(new Date(), mock.gateway)).gekickt).toBe(1);
  });

  it('kickt auch, wenn das Aufräumen scheitert', async () => {
    // Die Entscheidung ist gefallen; ein Kanal, in dem nichts gelöscht
    // werden kann, hält sie nicht auf.
    const request = await vorgang(16);
    await begruessung(request.id, '600000000000000001');
    const mock = attrappe();
    mock.gateway!.channels.botPermissions = vi.fn(async () => 0n) as never;

    const ergebnis = await verification.runVerificationTick(new Date(), mock.gateway);

    expect(ergebnis.gekickt).toBe(1);
    const eintrag = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'VERIFICATION_TIMEOUT_KICK' },
    });
    expect((eintrag.metadata as Record<string, unknown>).aufraeumen).toBe('FAILED');
  });

  it('nimmt den Ablauf nicht zurück, wenn der Kick scheitert', async () => {
    const request = await vorgang(16);
    const mock = attrappe();
    mock.gateway!.members.kick = vi.fn(async () => {
      throw new Error('Fehlende Rechte');
    }) as never;

    const ergebnis = await verification.runVerificationTick(new Date(), mock.gateway);

    expect(ergebnis.abgelaufen).toBe(1);
    expect(ergebnis.gekickt).toBe(0);
    expect((await prisma.verificationRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe(
      'EXPIRED',
    );
    const eintrag = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'VERIFICATION_TIMEOUT_KICK' },
    });
    expect(eintrag.success).toBe(false);
    expect((eintrag.metadata as Record<string, unknown>).kick).toBe('FEHLGESCHLAGEN');
  });

  it('bannt niemanden', async () => {
    // Ein Kick ist kein Bann. Wer nichts geschrieben hat, hat nichts getan.
    await vorgang(16);
    const mock = attrappe();

    await verification.runVerificationTick(new Date(), mock.gateway);

    expect(mock.gateway!.bans.add).not.toHaveBeenCalled();
  });

  // --- Genau einmal ---------------------------------------------------------

  it('F: führt den Vorgang auch bei zwei gleichzeitigen Durchgängen genau einmal aus', async () => {
    /*
     * Zwei Worker sehen dieselbe abgelaufene Zeile. Der Riegel steht in der
     * Datenbank: `entscheide` setzt `decidedAt` bedingt, und genau einer
     * kommt durch. Ohne ihn bekäme die Person zwei Nachrichten und zwei
     * Kicks - und im Audit Log stünde sie zweimal.
     */
    await vorgang(16);
    const mockA = attrappe();
    const mockB = attrappe();

    const [a, b] = await Promise.all([
      verification.runVerificationTick(new Date(), mockA.gateway),
      verification.runVerificationTick(new Date(), mockB.gateway),
    ]);

    expect(a.abgelaufen + b.abgelaufen).toBe(1);
    expect(mockA.dms.length + mockB.dms.length).toBe(1);
    expect(mockA.gekickt.length + mockB.gekickt.length).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'VERIFICATION_TIMEOUT_KICK' } })).toBe(1);
  });

  it('tut beim zweiten Durchgang nichts mehr', async () => {
    await vorgang(16);
    const mock = attrappe();

    await verification.runVerificationTick(new Date(), mock.gateway);
    const zweiter = await verification.runVerificationTick(new Date(), mock.gateway);

    expect(zweiter.abgelaufen).toBe(0);
    expect(mock.gekickt).toHaveLength(1);
    expect(mock.dms).toHaveLength(1);
  });

  it('E: greift nach einem Neustart weiterhin - die Frist steht in der Datenbank', async () => {
    /*
     * Ein `setTimeout` über eine Viertelstunde wäre nach dem ersten
     * Deployment weg, und niemand hätte es bemerkt. Hier gibt es keinen:
     * der Vorgang trägt seinen Beitrittszeitpunkt, die Frist steht in den
     * Einstellungen, und ein frisch gestarteter Durchgang rechnet beides
     * neu zusammen.
     */
    const request = await vorgang(10);
    const mock = attrappe();
    expect((await verification.runVerificationTick(new Date(), mock.gateway)).abgelaufen).toBe(0);

    // «Neustart»: ein neuer Durchgang, ein neuer Zugang, nichts im
    // Arbeitsspeicher - nur eine spätere Uhrzeit.
    const spaeter = new Date(Date.now() + 6 * 60_000);
    const nachNeustart = attrappe();
    const ergebnis = await verification.runVerificationTick(spaeter, nachNeustart.gateway);

    expect(ergebnis.abgelaufen).toBe(1);
    expect(nachNeustart.gekickt).toHaveLength(1);
    expect((await prisma.verificationRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe(
      'EXPIRED',
    );
  });

  // --- Rückkehr -------------------------------------------------------------

  it('G: hält einen Vorgang an, dessen Person schon selbst gegangen ist', async () => {
    const request = await vorgang(16);
    await verification.markLeft('g1', NEULING);
    const mock = attrappe();

    const ergebnis = await verification.runVerificationTick(new Date(), mock.gateway);

    expect(ergebnis.abgelaufen).toBe(0);
    expect(mock.gekickt).toHaveLength(0);
    expect((await prisma.verificationRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe(
      'LEFT_SERVER',
    );
  });

  it('lässt einen alten Timeout den neuen Vorgang nach der Rückkehr nicht treffen', async () => {
    /*
     * Nach dem Kick kommt die Person über die Einladung zurück. Sie bekommt
     * einen neuen Vorgang mit neuer Frist - und der alte ist entschieden
     * und für die fällige Abfrage nicht mehr vorhanden. Ohne das könnte der
     * abgeschlossene Vorgang die Rückkehr sofort wieder beenden.
     */
    const alt = await vorgang(16);
    const mock = attrappe();
    await verification.runVerificationTick(new Date(), mock.gateway);
    expect(mock.gekickt).toHaveLength(1);

    const neu = await vorgang(0, 'WAITING_FOR_MESSAGE');
    const nachRueckkehr = attrappe();
    const ergebnis = await verification.runVerificationTick(new Date(), nachRueckkehr.gateway);

    expect(ergebnis.abgelaufen).toBe(0);
    expect(nachRueckkehr.gekickt).toHaveLength(0);
    expect((await prisma.verificationRequest.findUniqueOrThrow({ where: { id: alt.id } })).status).toBe(
      'EXPIRED',
    );
    expect((await prisma.verificationRequest.findUniqueOrThrow({ where: { id: neu.id } })).status).toBe(
      'WAITING_FOR_MESSAGE',
    );
  });

  // --- Einstellungen --------------------------------------------------------

  it('tut nichts, solange der Ablauf abgeschaltet ist', async () => {
    await setModuleSettings(
      verification.VERIFICATION_MODULE_ID,
      { ...EINSTELLUNGEN, expireEnabled: false },
      'test',
    );
    await vorgang(240);
    const mock = attrappe();

    expect((await verification.runVerificationTick(new Date(), mock.gateway)).abgelaufen).toBe(0);
    expect(mock.gekickt).toHaveLength(0);
  });

  it('lässt den Vorgang ablaufen, ohne zu kicken, wenn der Kick abgeschaltet ist', async () => {
    await setModuleSettings(
      verification.VERIFICATION_MODULE_ID,
      { ...EINSTELLUNGEN, kickOnExpire: false },
      'test',
    );
    await vorgang(16);
    const mock = attrappe();

    const ergebnis = await verification.runVerificationTick(new Date(), mock.gateway);

    expect(ergebnis.abgelaufen).toBe(1);
    expect(ergebnis.gekickt).toBe(0);
    expect(mock.gekickt).toHaveLength(0);
    // Und ohne Kick auch keine Abschiedsnachricht - es gibt nichts zu erklären.
    expect(mock.dms).toHaveLength(0);
  });

  it('achtet eine abweichend eingestellte Frist', async () => {
    await setModuleSettings(
      verification.VERIFICATION_MODULE_ID,
      { ...EINSTELLUNGEN, expireAfterMinutes: 60 },
      'test',
    );
    await vorgang(30);
    const mock = attrappe();

    expect((await verification.runVerificationTick(new Date(), mock.gateway)).abgelaufen).toBe(0);
    expect(
      (await verification.runVerificationTick(new Date(Date.now() + 31 * 60_000), mock.gateway)).abgelaufen,
    ).toBe(1);
  });

  it('behält eine früher bewusst gewählte Frist in Stunden', async () => {
    // Zwölf Stunden hat jemand eingestellt - das ist eine Entscheidung und
    // kein Überbleibsel.
    await prisma.moduleState.update({
      where: { moduleId: verification.VERIFICATION_MODULE_ID },
      data: { settings: { ...EINSTELLUNGEN, expireAfterHours: 12, expireAfterMinutes: undefined } },
    });

    expect((await einstellungen()).expireAfterMinutes).toBe(12 * 60);
  });

  it('ersetzt die alte Vorgabe von 48 Stunden durch die heutige', async () => {
    /*
     * Achtundvierzig Stunden war die Vorgabe von damals. Sie steht in der
     * Datenbank, weil das Formular beim ersten Speichern alle Felder
     * mitschickt - nicht, weil jemand sie gewählt hätte. Bliebe sie stehen,
     * liefe die neue Frist auf keiner bestehenden Installation an, und der
     * Zustand wäre von aussen nicht von «kaputt» zu unterscheiden.
     */
    await prisma.moduleState.update({
      where: { moduleId: verification.VERIFICATION_MODULE_ID },
      data: { settings: { ...EINSTELLUNGEN, expireAfterHours: 48, expireAfterMinutes: undefined } },
    });

    expect((await einstellungen()).expireAfterMinutes).toBe(15);
  });

  it('lässt eine ausdrücklich gespeicherte Minutenfrist unangetastet', async () => {
    await prisma.moduleState.update({
      where: { moduleId: verification.VERIFICATION_MODULE_ID },
      data: { settings: { ...EINSTELLUNGEN, expireAfterHours: 48, expireAfterMinutes: 90 } },
    });

    expect((await einstellungen()).expireAfterMinutes).toBe(90);
  });

  // --- Die Nachricht --------------------------------------------------------

  it('setzt die Platzhalter der Vorlage ein', async () => {
    await setModuleSettings(
      verification.VERIFICATION_MODULE_ID,
      { ...EINSTELLUNGEN, timeoutDmMessage: 'Hoi {displayName} ({username}) · {invite}' },
      'test',
    );
    await vorgang(16);
    const mock = attrappe();

    await verification.runVerificationTick(new Date(), mock.gateway);

    expect(mock.dms[0]!.content).toBe(
      `Hoi Anzeige ${NEULING} (user-${NEULING}) · https://discord.gg/swisshub`,
    );
  });

  it('nimmt den eingestellten Einladungslink, wenn einer hinterlegt ist', async () => {
    await setModuleSettings(
      verification.VERIFICATION_MODULE_ID,
      { ...EINSTELLUNGEN, rejoinInviteUrl: 'https://discord.gg/eigener' },
      'test',
    );
    await vorgang(16);
    const mock = attrappe();

    await verification.runVerificationTick(new Date(), mock.gateway);

    expect(mock.dms[0]!.content).toContain('https://discord.gg/eigener');
    expect(mock.gateway!.guild.invites).not.toHaveBeenCalled();
  });

  it('erzeugt keine Einladung, sondern nimmt eine unbefristete bestehende', async () => {
    await vorgang(16);
    const mock = attrappe();
    mock.einladungen = [
      { code: 'laeuft-ab', expiresAt: new Date(Date.now() + 3600_000), maxUses: 0 },
      { code: 'dauerhaft', expiresAt: null, maxUses: 0 },
    ];

    await verification.runVerificationTick(new Date(), mock.gateway);

    expect(mock.dms[0]!.content).toContain('https://discord.gg/dauerhaft');
    expect(mock.dms[0]!.content).not.toContain('laeuft-ab');
  });

  it('sendet ohne Link, wenn es keine brauchbare Einladung gibt', async () => {
    // Eine Nachricht mit einem leeren Platzhalter wäre schlimmer als eine
    // ohne Link - sie erklärt immer noch, warum jemand gehen musste.
    await vorgang(16);
    const mock = attrappe();
    mock.gateway!.guild.invites = vi.fn(async () => {
      throw new Error('Fehlendes Recht MANAGE_GUILD');
    }) as never;

    await verification.runVerificationTick(new Date(), mock.gateway);

    expect(mock.dms).toHaveLength(1);
    expect(mock.dms[0]!.content).not.toContain('discord.gg');
    expect(mock.dms[0]!.content).toContain('wieder beitreten');
    expect(mock.gekickt).toHaveLength(1);
  });

  it('sendet nichts, wenn die Vorlage leer ist - kickt aber trotzdem', async () => {
    await setModuleSettings(
      verification.VERIFICATION_MODULE_ID,
      { ...EINSTELLUNGEN, timeoutDmMessage: '' },
      'test',
    );
    await vorgang(16);
    const mock = attrappe();

    const ergebnis = await verification.runVerificationTick(new Date(), mock.gateway);

    expect(mock.dms).toHaveLength(0);
    expect(ergebnis.gekickt).toBe(1);

    // «Nicht versucht» ist etwas anderes als «fehlgeschlagen».
    const eintrag = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'VERIFICATION_TIMEOUT_KICK' },
    });
    expect((eintrag.metadata as Record<string, unknown>).dm).toBe('NICHT_VERSUCHT');
  });

  // --- Mehrere auf einmal ---------------------------------------------------

  it('behandelt mehrere fällige Vorgänge in einem Durchgang', async () => {
    await vorgang(20, 'WAITING_FOR_MESSAGE', '100000000000000301');
    await vorgang(30, 'WAITING_FOR_MESSAGE', '100000000000000302');
    await vorgang(5, 'WAITING_FOR_MESSAGE', '100000000000000303');
    const mock = attrappe();

    const ergebnis = await verification.runVerificationTick(new Date(), mock.gateway);

    expect(ergebnis.abgelaufen).toBe(2);
    expect(mock.gekickt.map((eintrag) => eintrag.discordId).sort()).toEqual([
      '100000000000000301',
      '100000000000000302',
    ]);
  });

  it('hält den Durchgang nicht an, wenn ein einzelner Vorgang scheitert', async () => {
    await vorgang(20, 'WAITING_FOR_MESSAGE', '100000000000000301');
    await vorgang(30, 'WAITING_FOR_MESSAGE', '100000000000000302');
    const mock = attrappe();
    let ersterAufruf = true;
    mock.gateway!.channels.botPermissions = vi.fn(async () => {
      if (ersterAufruf) {
        ersterAufruf = false;
        throw new Error('Discord antwortet nicht');
      }
      return ALLE_RECHTE;
    }) as never;

    const ergebnis = await verification.runVerificationTick(new Date(), mock.gateway);

    expect(ergebnis.abgelaufen).toBe(2);
    expect(mock.gekickt).toHaveLength(2);
  });
});
