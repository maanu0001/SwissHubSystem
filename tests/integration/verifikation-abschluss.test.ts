import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_verifikation_abschluss');

/**
 * Was nach der Entscheidung geschieht.
 *
 * Zwei Dinge, und beide sind Folgearbeit: die Meldung im Ergebniskanal und
 * das Aufräumen des Verifikationskanals. Entschieden ist zu diesem Zeitpunkt
 * bereits - und genau daraus folgen die Zusagen, die hier geprüft werden.
 *
 * Die gefährlichste steht zuerst: **es wird nur gelöscht, was dieser Person
 * gehört.** Ein Aufräumen, das den Kanal leert, wäre schlimmer als gar
 * keines - es nähme anderen Wartenden ihre Nachricht weg, und niemand
 * bemerkte es, bis sich jemand beschwert.
 *
 * Die zweite: **die Meldung entsteht genau einmal.** Ein zweiter Klick, eine
 * doppelt zugestellte Interaktion, ein Wiederholungslauf - keiner davon darf
 * eine zweite Ankündigung erzeugen.
 */
const { prisma } = await import('@swisshub/database');
const { verification, setModuleEnabled, setModuleSettings } = await import('@swisshub/modules');

const VERIFIKATIONSKANAL = '900000000000000601';
const ERGEBNISKANAL = '900000000000000603';
const NEULING = '100000000000000101';
const ANDERER = '100000000000000102';

type Betrachter = Parameters<typeof verification.nachEntscheidung>[2];

interface Attrappe {
  gateway: NonNullable<Betrachter>['gateway'];
  gesendet: Array<{ channelId: string; content?: string; title?: string; description?: string }>;
  geloescht: Array<{ channelId: string; messageId: string }>;
  verlauf: Array<{ id: string; authorId: string; authorIsBot: boolean; createdAt: Date }>;
  rechte: bigint;
}

/** Alle Rechte, die das Aufräumen braucht. */
const ALLE_RECHTE = (1n << 10n) | (1n << 13n) | (1n << 16n);

function attrappe(): Attrappe {
  const zustand: Attrappe = {
    gesendet: [],
    geloescht: [],
    verlauf: [],
    rechte: ALLE_RECHTE,
    gateway: undefined,
  };
  let zaehler = 0;

  zustand.gateway = {
    channels: {
      send: vi.fn(async (channelId: string, payload: Record<string, unknown>) => {
        zaehler += 1;
        const embed = (payload.embeds as Array<Record<string, unknown>> | undefined)?.[0];
        zustand.gesendet.push({
          channelId,
          content: payload.content as string | undefined,
          title: embed?.title as string | undefined,
          description: embed?.description as string | undefined,
        });
        return { id: `70000000000000000${zaehler}`, channelId };
      }),
      delete: vi.fn(async (channelId: string, messageId: string) => {
        zustand.geloescht.push({ channelId, messageId });
        const stelle = zustand.verlauf.findIndex((zeile) => zeile.id === messageId);
        if (stelle >= 0) {
          zustand.verlauf.splice(stelle, 1);
        }
      }),
      history: vi.fn(async () => zustand.verlauf.map((zeile) => ({ ...zeile }))),
      botPermissions: vi.fn(async () => zustand.rechte),
    },
  } as unknown as NonNullable<Betrachter>['gateway'];

  return zustand;
}

async function vorgang(
  discordId: string,
  status: 'VERIFIED' | 'REJECTED' | 'WAITING_FOR_REVIEW' = 'VERIFIED',
) {
  return prisma.verificationRequest.create({
    data: {
      guildId: 'g1',
      discordId,
      username: `user-${discordId}`,
      displayName: `Anzeige ${discordId}`,
      status,
      joinedAt: new Date(Date.now() - 3600_000),
      ...(status === 'VERIFIED' || status === 'REJECTED' ? { decidedAt: new Date() } : {}),
    },
  });
}

async function nachricht(requestId: string, discordMessageId: string): Promise<void> {
  await prisma.verificationMessage.create({
    data: { requestId, discordMessageId, content: 'Hallo, ich bin neu hier.' },
  });
}

const EINSTELLUNGEN = {
  verificationChannelId: VERIFIKATIONSKANAL,
  postVerificationChannelId: ERGEBNISKANAL,
  cleanupEnabled: true,
};

describeWithDatabase('Verifikation: Abschluss', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "VerificationMessage","VerificationRequest","ModuleState","AuditLog" RESTART IDENTITY CASCADE',
    );
    await setModuleEnabled(verification.VERIFICATION_MODULE_ID, true, 'test');
    await setModuleSettings(verification.VERIFICATION_MODULE_ID, EINSTELLUNGEN, 'test');
  });

  const einstellungen = async () => verification.verificationSettings();

  // --- Die Meldung ----------------------------------------------------------

  it('meldet eine erfolgreiche Verifikation im Ergebniskanal', async () => {
    const request = await vorgang(NEULING);
    const mock = attrappe();

    const ergebnis = await verification.sendeErfolgsmeldung(request, await einstellungen(), {
      gateway: mock.gateway,
    });

    expect(ergebnis.gesendet).toBe(true);
    expect(mock.gesendet).toHaveLength(1);
    expect(mock.gesendet[0]!.channelId).toBe(ERGEBNISKANAL);
  });

  it('meldet nicht in den Verifikationskanal', async () => {
    // Den sieht die Person nach der Freischaltung nicht mehr - eine
    // Ankündigung dort läse niemand ausser den noch Wartenden.
    const request = await vorgang(NEULING);
    const mock = attrappe();

    await verification.sendeErfolgsmeldung(request, await einstellungen(), { gateway: mock.gateway });

    expect(mock.gesendet.every((zeile) => zeile.channelId !== VERIFIKATIONSKANAL)).toBe(true);
  });

  it('meldet genau einmal, auch bei einem zweiten Aufruf', async () => {
    const request = await vorgang(NEULING);
    const mock = attrappe();
    const settings = await einstellungen();

    const erster = await verification.sendeErfolgsmeldung(request, settings, { gateway: mock.gateway });
    const frisch = await prisma.verificationRequest.findUniqueOrThrow({ where: { id: request.id } });
    const zweiter = await verification.sendeErfolgsmeldung(frisch, settings, { gateway: mock.gateway });

    expect(erster.gesendet).toBe(true);
    expect(zweiter.gesendet).toBe(false);
    expect(zweiter.bereitsGemeldet).toBe(true);
    expect(mock.gesendet).toHaveLength(1);
  });

  it('meldet auch dann nur einmal, wenn zwei Aufrufe gleichzeitig kommen', async () => {
    // Bot und WebApp sind zwei Prozesse; eine Prüfung in JavaScript
    // entschiede das Rennen nicht. Die bedingte Aktualisierung schon.
    const request = await vorgang(NEULING);
    const mock = attrappe();
    const settings = await einstellungen();

    await Promise.all([
      verification.sendeErfolgsmeldung(request, settings, { gateway: mock.gateway }),
      verification.sendeErfolgsmeldung(request, settings, { gateway: mock.gateway }),
    ]);

    expect(mock.gesendet).toHaveLength(1);
  });

  it('meldet nach einem Bann gar nicht', async () => {
    const request = await vorgang(NEULING, 'REJECTED');
    const mock = attrappe();

    const ergebnis = await verification.nachEntscheidung(request, await einstellungen(), {
      gateway: mock.gateway,
    });

    expect(ergebnis.meldung.gesendet).toBe(false);
    expect(mock.gesendet).toHaveLength(0);
  });

  it('meldet bei einem noch offenen Vorgang nicht', async () => {
    const request = await vorgang(NEULING, 'WAITING_FOR_REVIEW');
    const mock = attrappe();

    const ergebnis = await verification.sendeErfolgsmeldung(request, await einstellungen(), {
      gateway: mock.gateway,
    });

    expect(ergebnis.gesendet).toBe(false);
    expect(mock.gesendet).toHaveLength(0);
  });

  it('meldet nicht, solange kein Ergebniskanal eingestellt ist', async () => {
    await setModuleSettings(
      verification.VERIFICATION_MODULE_ID,
      { ...EINSTELLUNGEN, postVerificationChannelId: null },
      'test',
    );
    const request = await vorgang(NEULING);
    const mock = attrappe();

    const ergebnis = await verification.sendeErfolgsmeldung(request, await einstellungen(), {
      gateway: mock.gateway,
    });

    expect(ergebnis.gesendet).toBe(false);
    expect(ergebnis.grund).toBe('kein Kanal');
  });

  it('setzt die Vorlage aus dem Dashboard ein', async () => {
    await setModuleSettings(
      verification.VERIFICATION_MODULE_ID,
      {
        ...EINSTELLUNGEN,
        postVerificationTitle: 'Willkommen, {displayName}',
        postVerificationMessage: '{user} alias {username} ist jetzt dabei.',
      },
      'test',
    );
    const request = await vorgang(NEULING);
    const mock = attrappe();

    await verification.sendeErfolgsmeldung(request, await einstellungen(), { gateway: mock.gateway });

    expect(mock.gesendet[0]!.title).toBe(`Willkommen, Anzeige ${NEULING}`);
    expect(mock.gesendet[0]!.description).toBe(`<@${NEULING}> alias user-${NEULING} ist jetzt dabei.`);
  });

  it('lässt unbekannte Platzhalter wörtlich stehen', async () => {
    // Ehrlicher als ein leerer String: wer sich vertippt, sieht es.
    expect(
      verification.fuelleVorlage('{user} {gibtEsNicht}', {
        discordId: NEULING,
        username: 'neu',
        displayName: 'Neu',
      }),
    ).toBe(`<@${NEULING}> {gibtEsNicht}`);
  });

  it('nimmt die Marke zurück, wenn das Senden scheitert', async () => {
    // Sonst bliebe ein Vorgang als «gemeldet» stehen, der nie gemeldet
    // wurde - und ein zweiter Versuch käme nicht mehr durch.
    const request = await vorgang(NEULING);
    const mock = attrappe();
    mock.gateway!.channels.send = vi.fn(async () => {
      throw new Error('Discord antwortet nicht');
    }) as never;

    const ergebnis = await verification.sendeErfolgsmeldung(request, await einstellungen(), {
      gateway: mock.gateway,
    });

    expect(ergebnis.gesendet).toBe(false);
    const frisch = await prisma.verificationRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(frisch.successMessageAt).toBeNull();
    expect(frisch.successMessageId).toBeNull();
    // Die Verifikation selbst bleibt unberührt.
    expect(frisch.status).toBe('VERIFIED');
  });

  // --- Das Aufräumen --------------------------------------------------------

  it('entfernt die Nachrichten der Person und ihre Begrüssung', async () => {
    const request = await vorgang(NEULING);
    await nachricht(request.id, '600000000000000001');
    await nachricht(request.id, '600000000000000002');
    await prisma.verificationRequest.update({
      where: { id: request.id },
      data: { greetingChannelId: VERIFIKATIONSKANAL, greetingMessageId: '600000000000000003' },
    });
    const mock = attrappe();

    const ergebnis = await verification.raeumeVerifikationskanal(
      await prisma.verificationRequest.findUniqueOrThrow({ where: { id: request.id } }),
      await einstellungen(),
      { gateway: mock.gateway },
    );

    expect(ergebnis.status).toBe('COMPLETED');
    expect(mock.geloescht.map((zeile) => zeile.messageId).sort()).toEqual([
      '600000000000000001',
      '600000000000000002',
      '600000000000000003',
    ]);
    expect(mock.geloescht.every((zeile) => zeile.channelId === VERIFIKATIONSKANAL)).toBe(true);
  });

  it('lässt die Nachrichten anderer Personen unangetastet', async () => {
    // Die gefährlichste Zusage dieses Moduls.
    const meiner = await vorgang(NEULING);
    const fremder = await vorgang(ANDERER);
    await nachricht(meiner.id, '600000000000000001');
    await nachricht(fremder.id, '600000000000000099');
    const mock = attrappe();
    mock.verlauf = [
      { id: '600000000000000099', authorId: ANDERER, authorIsBot: false, createdAt: new Date() },
      { id: '600000000000000098', authorId: ANDERER, authorIsBot: false, createdAt: new Date() },
    ];

    await verification.raeumeVerifikationskanal(meiner, await einstellungen(), {
      gateway: mock.gateway,
    });

    expect(mock.geloescht.map((zeile) => zeile.messageId)).toEqual(['600000000000000001']);
  });

  it('lässt fremde Bot-Nachrichten stehen', async () => {
    const request = await vorgang(NEULING);
    const mock = attrappe();
    mock.verlauf = [
      { id: '600000000000000050', authorId: '800000000000000001', authorIsBot: true, createdAt: new Date() },
    ];

    await verification.raeumeVerifikationskanal(request, await einstellungen(), {
      gateway: mock.gateway,
    });

    expect(mock.geloescht).toHaveLength(0);
  });

  it('findet auch Nachrichten, die nie erfasst wurden', async () => {
    // Der Bot kann zwischendurch gestanden haben. Der begrenzte Blick in den
    // Kanal schliesst genau diese Lücke.
    const request = await vorgang(NEULING);
    const mock = attrappe();
    mock.verlauf = [
      { id: '600000000000000010', authorId: NEULING, authorIsBot: false, createdAt: new Date() },
    ];

    await verification.raeumeVerifikationskanal(request, await einstellungen(), {
      gateway: mock.gateway,
    });

    expect(mock.geloescht.map((zeile) => zeile.messageId)).toEqual(['600000000000000010']);
  });

  it('behandelt eine bereits gelöschte Nachricht als erledigt', async () => {
    const { DiscordApiError } = await import('@swisshub/discord');
    const request = await vorgang(NEULING);
    await nachricht(request.id, '600000000000000001');
    const mock = attrappe();
    mock.gateway!.channels.delete = vi.fn(async () => {
      throw new DiscordApiError(404, 10008, '/channels/x/messages/y', 'Unknown Message');
    }) as never;

    const ergebnis = await verification.raeumeVerifikationskanal(request, await einstellungen(), {
      gateway: mock.gateway,
    });

    expect(ergebnis.status).toBe('COMPLETED');
    expect(ergebnis.schonWeg).toBe(1);
    expect(ergebnis.fehlgeschlagen).toBe(0);
  });

  it('lässt sich mehrfach ausführen, ohne zu scheitern', async () => {
    const request = await vorgang(NEULING);
    await nachricht(request.id, '600000000000000001');
    const mock = attrappe();
    const settings = await einstellungen();

    const erster = await verification.raeumeVerifikationskanal(request, settings, {
      gateway: mock.gateway,
    });
    const zweiter = await verification.raeumeVerifikationskanal(request, settings, {
      gateway: mock.gateway,
    });

    expect(erster.status).toBe('COMPLETED');
    expect(zweiter.status).toBe('COMPLETED');
  });

  it('bricht ohne die nötigen Rechte sauber ab', async () => {
    const request = await vorgang(NEULING);
    await nachricht(request.id, '600000000000000001');
    const mock = attrappe();
    mock.rechte = 0n;

    const ergebnis = await verification.raeumeVerifikationskanal(request, await einstellungen(), {
      gateway: mock.gateway,
    });

    expect(ergebnis.status).toBe('FAILED');
    expect(ergebnis.grund).toContain('Nachrichten verwalten');
    // Nicht zwanzig Anfragen mit zwanzig Fehlern.
    expect(mock.geloescht).toHaveLength(0);
    const frisch = await prisma.verificationRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(frisch.cleanupStatus).toBe('FAILED');
  });

  it('meldet einen unvollständigen Durchlauf als solchen', async () => {
    const request = await vorgang(NEULING);
    await nachricht(request.id, '600000000000000001');
    const mock = attrappe();
    mock.gateway!.channels.delete = vi.fn(async () => {
      throw new Error('Discord antwortet nicht');
    }) as never;

    const ergebnis = await verification.raeumeVerifikationskanal(request, await einstellungen(), {
      gateway: mock.gateway,
    });

    expect(ergebnis.status).toBe('PARTIAL');
    expect(ergebnis.fehlgeschlagen).toBe(1);
  });

  it('unterscheidet «nicht lesbar» von «nur bis zur Lesegrenze»', async () => {
    /*
     * Zwei verschiedene Aussagen, und die eine darf nicht für die andere
     * einstehen: «bis zur Lesegrenze» heisst, es kann noch etwas geben;
     * «nicht lesbar» heisst, niemand weiss es. Entfernt wird in beiden
     * Fällen, was festgehalten war - gemeldet aber unterschiedlich.
     */
    const request = await vorgang(NEULING);
    await nachricht(request.id, '600000000000000001');
    const mock = attrappe();
    mock.gateway!.channels.history = vi.fn(async () => {
      throw new Error('Discord antwortet nicht');
    }) as never;

    const ergebnis = await verification.raeumeVerifikationskanal(request, await einstellungen(), {
      gateway: mock.gateway,
    });

    expect(ergebnis.status).toBe('PARTIAL');
    expect(ergebnis.geloescht).toBe(1);
    expect(ergebnis.fehlgeschlagen).toBe(0);
    expect(ergebnis.grund).toContain('nicht lesen');
    expect(ergebnis.grund).not.toContain('Lesegrenze');
  });

  it('räumt nicht auf, wenn es abgeschaltet ist', async () => {
    await setModuleSettings(
      verification.VERIFICATION_MODULE_ID,
      { ...EINSTELLUNGEN, cleanupEnabled: false },
      'test',
    );
    const request = await vorgang(NEULING);
    await nachricht(request.id, '600000000000000001');
    const mock = attrappe();

    const ergebnis = await verification.raeumeVerifikationskanal(request, await einstellungen(), {
      gateway: mock.gateway,
    });

    expect(ergebnis.status).toBe('SKIPPED');
    expect(mock.geloescht).toHaveLength(0);
  });

  it('fasst die Begrüssung nicht an, wenn sie in einem anderen Kanal steht', async () => {
    // Der Kanal kann seit dem Senden umgestellt worden sein.
    const request = await vorgang(NEULING);
    await prisma.verificationRequest.update({
      where: { id: request.id },
      data: { greetingChannelId: '900000000000000699', greetingMessageId: '600000000000000003' },
    });
    const mock = attrappe();

    await verification.raeumeVerifikationskanal(
      await prisma.verificationRequest.findUniqueOrThrow({ where: { id: request.id } }),
      await einstellungen(),
      { gateway: mock.gateway },
    );

    expect(mock.geloescht).toHaveLength(0);
  });

  it('entfernt jede Begrüssung, auch wenn mehrere gesendet wurden', async () => {
    /*
     * Die Ursache, aus der heraus die Bot-Nachricht stehenblieb.
     *
     * `startVerification` gibt bei einem offenen Vorgang denselben zurück,
     * und ein wiederholtes `guildMemberAdd` liess den Bot ein zweites Mal
     * begrüssen. Ein einzelnes Feld behielt die jüngste Kennung - die
     * frühere Begrüssung blieb im Kanal, und nichts zeigte mehr auf sie.
     * Über den Text wiederfinden lässt sie sich nicht: Bot-Nachrichten
     * werden beim Blick in den Kanal ausdrücklich übersprungen.
     */
    const request = await vorgang(NEULING);
    for (const messageId of ['600000000000000011', '600000000000000012', '600000000000000013']) {
      await prisma.verificationBotMessage.create({
        data: {
          requestId: request.id,
          kind: 'GREETING',
          channelId: VERIFIKATIONSKANAL,
          discordMessageId: messageId,
        },
      });
    }
    // Das alte Einzelfeld kennt nur die letzte.
    await prisma.verificationRequest.update({
      where: { id: request.id },
      data: { greetingChannelId: VERIFIKATIONSKANAL, greetingMessageId: '600000000000000013' },
    });
    const mock = attrappe();

    const ergebnis = await verification.raeumeVerifikationskanal(
      await prisma.verificationRequest.findUniqueOrThrow({ where: { id: request.id } }),
      await einstellungen(),
      { gateway: mock.gateway },
    );

    expect(ergebnis.status).toBe('COMPLETED');
    expect(mock.geloescht.map((zeile) => zeile.messageId).sort()).toEqual([
      '600000000000000011',
      '600000000000000012',
      '600000000000000013',
    ]);
  });

  it('räumt eine Bot-Nachricht aus einem anderen Kanal nicht weg', async () => {
    const request = await vorgang(NEULING);
    await prisma.verificationBotMessage.create({
      data: {
        requestId: request.id,
        kind: 'GREETING',
        channelId: '900000000000000699',
        discordMessageId: '600000000000000021',
      },
    });
    const mock = attrappe();

    await verification.raeumeVerifikationskanal(request, await einstellungen(), { gateway: mock.gateway });

    expect(mock.geloescht).toHaveLength(0);
  });

  it('entfernt auch die Nachricht an die frisch freigeschaltete Person', async () => {
    // Die zweite Bot-Nachricht dieses Vorgangs. Bliebe sie stehen, spräche
    // der Kanal dauerhaft jemanden an, der ihn nicht mehr sieht.
    const request = await vorgang(NEULING);
    await prisma.verificationRequest.update({
      where: { id: request.id },
      data: { welcomeChannelId: VERIFIKATIONSKANAL, welcomeMessageId: '600000000000000004' },
    });
    const mock = attrappe();

    await verification.raeumeVerifikationskanal(
      await prisma.verificationRequest.findUniqueOrThrow({ where: { id: request.id } }),
      await einstellungen(),
      { gateway: mock.gateway },
    );

    expect(mock.geloescht.map((zeile) => zeile.messageId)).toEqual(['600000000000000004']);
  });

  it('entfernt sie auch, wenn sie erst nach dem Laden des Vorgangs entstand', async () => {
    /*
     * Der Ablauf im Betrieb: erst wird entschieden, dann wird die Nachricht
     * gesendet, dann wird aufgeräumt. Der Vorgang in der Hand des Aufrufers
     * stammt aus Schritt eins und kennt die Nachricht aus Schritt zwei
     * nicht. Würde das Aufräumen nur ihm glauben, bliebe genau diese
     * Nachricht liegen.
     */
    const request = await vorgang(NEULING);
    const mock = attrappe();
    const werte = await einstellungen();

    await verification.sendWelcome(request, werte, mock.gateway);

    const festgehalten = await prisma.verificationRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    expect(festgehalten.welcomeMessageId).not.toBeNull();
    expect(festgehalten.welcomeChannelId).toBe(VERIFIKATIONSKANAL);

    // Bewusst mit dem VERALTETEN Objekt aufgerufen.
    await verification.raeumeVerifikationskanal(request, werte, { gateway: mock.gateway });

    expect(mock.geloescht.map((zeile) => zeile.messageId)).toEqual([festgehalten.welcomeMessageId]);
  });

  // --- Beides zusammen ------------------------------------------------------

  it('meldet und räumt nach einer Freischaltung', async () => {
    const request = await vorgang(NEULING);
    await nachricht(request.id, '600000000000000001');
    const mock = attrappe();

    const ergebnis = await verification.nachEntscheidung(request, await einstellungen(), {
      gateway: mock.gateway,
    });

    expect(ergebnis.meldung.gesendet).toBe(true);
    expect(ergebnis.aufraeumen.status).toBe('COMPLETED');
    expect(mock.geloescht.map((zeile) => zeile.messageId)).toEqual(['600000000000000001']);
  });

  it('räumt nach einem Bann, ohne zu melden', async () => {
    const request = await vorgang(NEULING, 'REJECTED');
    await nachricht(request.id, '600000000000000001');
    const mock = attrappe();

    const ergebnis = await verification.nachEntscheidung(request, await einstellungen(), {
      gateway: mock.gateway,
    });

    expect(ergebnis.meldung.gesendet).toBe(false);
    expect(mock.gesendet).toHaveLength(0);
    expect(mock.geloescht.map((zeile) => zeile.messageId)).toEqual(['600000000000000001']);
  });

  it('räumt auch dann, wenn die Meldung scheitert', async () => {
    const request = await vorgang(NEULING);
    await nachricht(request.id, '600000000000000001');
    const mock = attrappe();
    mock.gateway!.channels.send = vi.fn(async () => {
      throw new Error('Discord antwortet nicht');
    }) as never;

    const ergebnis = await verification.nachEntscheidung(request, await einstellungen(), {
      gateway: mock.gateway,
    });

    expect(ergebnis.meldung.gesendet).toBe(false);
    expect(ergebnis.aufraeumen.status).toBe('COMPLETED');
  });

  it('gibt der Oberfläche einen Hinweis, wenn etwas offenblieb', async () => {
    const request = await vorgang(NEULING);
    await nachricht(request.id, '600000000000000001');
    const mock = attrappe();
    mock.rechte = 0n;

    const ergebnis = await verification.nachEntscheidung(request, await einstellungen(), {
      gateway: mock.gateway,
    });

    expect(verification.abschlussHinweis(ergebnis)).toContain('Nachrichten verwalten');
  });

  it('schweigt, wenn alles glatt lief', async () => {
    const request = await vorgang(NEULING);
    const mock = attrappe();

    const ergebnis = await verification.nachEntscheidung(request, await einstellungen(), {
      gateway: mock.gateway,
    });

    expect(verification.abschlussHinweis(ergebnis)).toBeNull();
  });
});
