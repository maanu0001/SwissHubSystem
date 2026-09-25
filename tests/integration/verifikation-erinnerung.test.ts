import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_verifikation_erinnerung');

/**
 * Erinnerungen statt Frist.
 *
 * ## Was sich geaendert hat
 *
 * Frueher lief ein Vorgang ohne Nachricht nach einer Viertelstunde ab, und
 * wer bis dahin nichts geschrieben hatte, flog vom Server. Das traf
 * zuverlaessig die Falschen - jemanden im Zug, jemanden, der die Begruessung
 * schlicht nicht gesehen hat.
 *
 * Jetzt geschieht zunaechst gar nichts, und in Abstaenden erinnert der Bot.
 * Diese Datei haelt beide Haelften fest: dass niemand mehr hinausfliegt, und
 * dass die Erinnerung genau dann kommt, wenn sie soll - und genau dann
 * aufhoert, wenn sie soll.
 *
 * **Kein echtes Discord.** Der Zugang ist eine Attrappe, die mitschreibt.
 * Ein Test, der Erwaehnungen an echte Mitglieder sendet, waere Belaestigung.
 */
const { prisma } = await import('@swisshub/database');
const { verification, setModuleEnabled, setModuleSettings } = await import('@swisshub/modules');

const UNVERIFIZIERT = '900000000000000501';
const MITGLIED = '900000000000000502';
const KANAL = '900000000000000601';
const STUNDE = 3600_000;

interface Gesendet {
  channelId: string;
  content: string;
  allowedMentions: unknown;
}

/**
 * Ein Discord-Zugang, der mitschreibt.
 *
 * `nachrichten` ist der Kanal, wie er nach aussen aussieht - was gesendet
 * wurde und noch nicht geloescht ist. Genau daran laesst sich pruefen, dass
 * die Begruessung stehen bleibt und nur die Erinnerung verschwindet.
 */
function attrappe(optionen: { mitgliedFehlt?: boolean; sendenScheitert?: boolean } = {}) {
  const nachrichten = new Map<string, Gesendet>();
  const gesendet: Gesendet[] = [];
  const geloescht: string[] = [];
  let zaehler = 0;

  const gateway = {
    members: {
      get: vi.fn(async (discordId: string) =>
        optionen.mitgliedFehlt
          ? null
          : {
              discordId,
              username: 'neu',
              displayName: 'Neu',
              globalName: null,
              nickname: null,
              avatarHash: null,
              isBot: false,
              roleIds: [UNVERIFIZIERT],
              joinedAt: new Date(),
              accountCreatedAt: new Date('2020-01-01'),
              boosting: false,
              timedOutUntil: null,
            },
      ),
      setRoles: vi.fn(async () => undefined),
      kick: vi.fn(async () => undefined),
    },
    bans: { add: vi.fn(async () => undefined) },
    channels: {
      send: vi.fn(async (channelId: string, payload: Record<string, unknown>) => {
        if (optionen.sendenScheitert) {
          throw new Error('Discord antwortet nicht');
        }
        zaehler += 1;
        const id = `msg-${zaehler}`;
        const zeile = {
          channelId,
          content: String(payload.content ?? ''),
          allowedMentions: payload.allowedMentions,
        };
        nachrichten.set(id, zeile);
        gesendet.push(zeile);
        return { id, channelId };
      }),
      edit: vi.fn(async () => undefined),
      delete: vi.fn(async (_channelId: string, messageId: string) => {
        geloescht.push(messageId);
        nachrichten.delete(messageId);
      }),
      message: vi.fn(async (_channelId: string, messageId: string) =>
        nachrichten.has(messageId)
          ? { id: messageId, authorId: 'bot', authorIsBot: true, createdAt: new Date() }
          : null,
      ),
    },
  } as unknown as NonNullable<Parameters<typeof verification.sendeErinnerung>[2]>['gateway'];

  return { gateway, nachrichten, gesendet, geloescht };
}

/** Kein echtes Warten - sonst dauerte jeder Test zwei Sekunden. */
const sofort = async (): Promise<void> => undefined;

async function einstellungen(teil: Record<string, unknown> = {}): Promise<void> {
  await setModuleSettings(
    verification.VERIFICATION_MODULE_ID,
    {
      unverifiedRoleId: UNVERIFIZIERT,
      memberRoleId: MITGLIED,
      verificationChannelId: KANAL,
      aiEnabled: false,
      aiAutoVerify: false,
      ...teil,
    },
    'test',
  );
}

type Einstellungen = Awaited<ReturnType<typeof verification.verificationSettings>>;
const hole = (): Promise<Einstellungen> => verification.verificationSettings();

/** Ein neuer Beitritt mit gesendeter Begruessung. */
async function neuerFall(discordId: string, gateway: Parameters<typeof verification.sendGreeting>[2]) {
  const request = await verification.startVerification({
    discordId,
    username: 'neuling',
    displayName: 'Neuling',
    accountCreatedAt: new Date('2020-01-01'),
  });
  await verification.sendGreeting(request, await hole(), gateway);
  return verification.requireRequest(request.id);
}

/** Den Termin auf «jetzt faellig» stellen. */
async function faelligStellen(requestId: string): Promise<void> {
  await prisma.verificationRequest.update({
    where: { id: requestId },
    data: { nextReminderAt: new Date(Date.now() - 1000) },
  });
}

describeWithDatabase('Verifikation: Erinnerungen', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "VerificationMessage","VerificationBotMessage","VerificationRequest","ModerationAction","AuditLog" RESTART IDENTITY CASCADE',
    );
    await setModuleEnabled(verification.VERIFICATION_MODULE_ID, true, 'test');
    await einstellungen();
  });

  // --- Der Zeitplan -------------------------------------------------------

  it('plant die erste Erinnerung erst mit der Begruessung', async () => {
    const { gateway } = attrappe();
    const roh = await verification.startVerification({ discordId: '900000000000009801' });
    // Vor der Begruessung: kein Termin. Eine Erinnerung ohne die Nachricht,
    // auf die sie zeigt, waere eine Erwaehnung ohne Anlass.
    expect((await verification.requireRequest(roh.id)).nextReminderAt).toBeNull();

    await verification.sendGreeting(roh, await hole(), gateway);
    const nachher = await verification.requireRequest(roh.id);
    expect(nachher.nextReminderAt).not.toBeNull();
    const abstand = nachher.nextReminderAt!.getTime() - Date.now();
    expect(abstand).toBeGreaterThan(23 * STUNDE);
    expect(abstand).toBeLessThan(25 * STUNDE);
  });

  it('erinnert vor Ablauf des Abstands nicht', async () => {
    const { gateway, gesendet } = attrappe();
    await neuerFall('900000000000009802', gateway);
    gesendet.length = 0;

    await verification.runVerificationTick(new Date(), gateway);
    expect(gesendet).toEqual([]);
  });

  it('erinnert, sobald der Termin faellig ist - und loescht die Erinnerung wieder', async () => {
    const { gateway, gesendet, geloescht, nachrichten } = attrappe();
    const fall = await neuerFall('900000000000009803', gateway);
    const begruessung = [...nachrichten.keys()][0]!;
    gesendet.length = 0;
    await faelligStellen(fall.id);

    const ergebnis = await verification.sendeErinnerung(fall.id, await hole(), {
      gateway,
      warte: sofort,
    });

    expect(ergebnis?.gesendet).toBe(true);
    expect(ergebnis?.geloescht).toBe(true);
    expect(gesendet).toHaveLength(1);
    expect(gesendet[0]?.content).toContain('<@900000000000009803>');
    // Die Erinnerung ist weg, die Begruessung steht.
    expect(geloescht).toHaveLength(1);
    expect(geloescht[0]).not.toBe(begruessung);
    expect(nachrichten.has(begruessung)).toBe(true);
  });

  it('erwaehnt ausschliesslich die betroffene Person', async () => {
    const { gateway, gesendet } = attrappe();
    await einstellungen({ reminderMessage: '@everyone @here {user} bitte melden' });
    const fall = await neuerFall('900000000000009804', gateway);
    gesendet.length = 0;
    await faelligStellen(fall.id);

    await verification.sendeErinnerung(fall.id, await hole(), { gateway, warte: sofort });

    /*
     * Der Text darf alles enthalten - pingen darf er nur die eine Person.
     * `parse: []` schaltet jede aus dem Text abgeleitete Erwaehnung ab,
     * `users` erlaubt danach ausdruecklich die eine.
     */
    expect(gesendet[0]?.allowedMentions).toEqual({ parse: [], users: ['900000000000009804'] });
  });

  it('haelt den Abstand zwischen zwei Erinnerungen ein', async () => {
    const { gateway } = attrappe();
    await einstellungen({ reminderIntervalHours: 6 });
    const fall = await neuerFall('900000000000009805', gateway);
    await faelligStellen(fall.id);

    const jetzt = new Date();
    await verification.sendeErinnerung(fall.id, await hole(), { gateway, jetzt, warte: sofort });

    const nachher = await verification.requireRequest(fall.id);
    expect(nachher.reminderCount).toBe(1);
    expect(nachher.lastReminderAt).not.toBeNull();
    const abstand = nachher.nextReminderAt!.getTime() - jetzt.getTime();
    expect(Math.round(abstand / STUNDE)).toBe(6);
  });

  it('erinnert auch nach Tagen noch - und wirft niemanden hinaus', async () => {
    const { gateway, gesendet } = attrappe();
    const fall = await neuerFall('900000000000009806', gateway);
    gesendet.length = 0;

    for (let tag = 0; tag < 5; tag += 1) {
      await faelligStellen(fall.id);
      await verification.sendeErinnerung(fall.id, await hole(), { gateway, warte: sofort });
    }

    const nachher = await verification.requireRequest(fall.id);
    expect(nachher.reminderCount).toBe(5);
    expect(nachher.status).toBe('WAITING_FOR_MESSAGE');
    expect(nachher.decidedAt).toBeNull();
    expect(gesendet).toHaveLength(5);
  });

  // --- Doppelausfuehrung --------------------------------------------------

  it('sendet bei zwei gleichzeitigen Arbeitern nur eine Erinnerung', async () => {
    const { gateway, gesendet } = attrappe();
    const fall = await neuerFall('900000000000009807', gateway);
    gesendet.length = 0;
    await faelligStellen(fall.id);

    const settings = await hole();
    const [a, b] = await Promise.all([
      verification.sendeErinnerung(fall.id, settings, { gateway, warte: sofort }),
      verification.sendeErinnerung(fall.id, settings, { gateway, warte: sofort }),
    ]);

    // Genau einer bekommt den Anspruch, der andere `null`.
    expect([a, b].filter((eintrag) => eintrag !== null)).toHaveLength(1);
    expect(gesendet).toHaveLength(1);
  });

  // --- Beendigungsbedingungen --------------------------------------------

  it('hoert auf, sobald jemand geschrieben hat', async () => {
    const { gateway, gesendet } = attrappe();
    const fall = await neuerFall('900000000000009808', gateway);
    gesendet.length = 0;

    await verification.recordMessage({
      discordId: '900000000000009808',
      messageId: 'm-1',
      content: 'Hoi zäme, ich bi grad am CS spiele.',
    });
    await faelligStellen(fall.id);
    await verification.runVerificationTick(new Date(), gateway);

    expect(gesendet).toEqual([]);
  });

  it('hoert auf, sobald jemand verifiziert ist', async () => {
    const { gateway, gesendet } = attrappe();
    const fall = await neuerFall('900000000000009809', gateway);
    gesendet.length = 0;

    await verification.entscheide(fall.id, { status: 'VERIFIED', by: 'SYSTEM' });
    expect((await verification.requireRequest(fall.id)).nextReminderAt).toBeNull();

    await faelligStellen(fall.id);
    const ergebnis = await verification.sendeErinnerung(fall.id, await hole(), {
      gateway,
      warte: sofort,
    });
    expect(ergebnis?.ende).toBe('entschieden');
    expect(gesendet).toEqual([]);
  });

  it('hoert auf, sobald jemand gebannt ist', async () => {
    const { gateway, gesendet } = attrappe();
    const fall = await neuerFall('900000000000009810', gateway);
    gesendet.length = 0;

    await verification.entscheide(fall.id, { status: 'REJECTED', by: 'SYSTEM', reason: 'Bot' });
    await faelligStellen(fall.id);
    await verification.sendeErinnerung(fall.id, await hole(), { gateway, warte: sofort });

    expect(gesendet).toEqual([]);
  });

  it('hoert auf, sobald jemand den Server verlassen hat', async () => {
    const { gateway, gesendet } = attrappe();
    const fall = await neuerFall('900000000000009811', gateway);
    gesendet.length = 0;

    await verification.markLeft(fall.guildId, '900000000000009811', { gateway });
    expect((await verification.requireRequest(fall.id)).nextReminderAt).toBeNull();

    await faelligStellen(fall.id);
    await verification.sendeErinnerung(fall.id, await hole(), { gateway, warte: sofort });
    expect(gesendet).toEqual([]);
  });

  it('erwaehnt niemanden, der auf Discord nicht mehr da ist', async () => {
    /*
     * `guildMemberRemove` kann ausbleiben - ein Verbindungsabriss genuegt.
     * Dann steht der Vorgang noch offen, die Person ist aber weg. Vor der
     * Erwaehnung wird deshalb nachgesehen.
     */
    const { gateway } = attrappe();
    const fall = await neuerFall('900000000000009812', gateway);
    await faelligStellen(fall.id);

    const weg = attrappe({ mitgliedFehlt: true });
    const ergebnis = await verification.sendeErinnerung(fall.id, await hole(), {
      gateway: weg.gateway,
      warte: sofort,
    });

    expect(ergebnis?.ende).toBe('kein_mitglied');
    expect(weg.gesendet).toEqual([]);
    expect((await verification.requireRequest(fall.id)).nextReminderAt).toBeNull();
  });

  it('hoert auf, wenn die urspruengliche Verifikationsnachricht geloescht wurde', async () => {
    const { gateway, gesendet, nachrichten } = attrappe();
    const fall = await neuerFall('900000000000009813', gateway);
    gesendet.length = 0;
    // Jemand raeumt den Kanal auf.
    nachrichten.clear();
    await faelligStellen(fall.id);

    const ergebnis = await verification.sendeErinnerung(fall.id, await hole(), {
      gateway,
      warte: sofort,
    });

    expect(ergebnis?.ende).toBe('original_geloescht');
    expect(gesendet).toEqual([]);
    expect((await verification.requireRequest(fall.id)).nextReminderAt).toBeNull();
  });

  it('macht weiter, wenn das ausdruecklich eingestellt ist', async () => {
    await einstellungen({ reminderContinueAfterOriginalDeleted: true });
    const { gateway, gesendet, nachrichten } = attrappe();
    const fall = await neuerFall('900000000000009814', gateway);
    gesendet.length = 0;
    nachrichten.clear();
    await faelligStellen(fall.id);

    const ergebnis = await verification.sendeErinnerung(fall.id, await hole(), {
      gateway,
      warte: sofort,
    });

    expect(ergebnis?.gesendet).toBe(true);
    expect(gesendet).toHaveLength(1);
  });

  it('erinnert auch bei eingeschalteter Fortsetzung nicht ohne gueltigen Vorgang', async () => {
    await einstellungen({ reminderContinueAfterOriginalDeleted: true });
    const { gateway, gesendet, nachrichten } = attrappe();
    const fall = await neuerFall('900000000000009815', gateway);
    gesendet.length = 0;
    nachrichten.clear();
    await verification.entscheide(fall.id, { status: 'VERIFIED', by: 'SYSTEM' });
    await faelligStellen(fall.id);

    await verification.sendeErinnerung(fall.id, await hole(), { gateway, warte: sofort });
    expect(gesendet).toEqual([]);
  });

  it('beendet die Reihe, wenn kein Verifikationskanal mehr eingestellt ist', async () => {
    const { gateway, gesendet } = attrappe();
    const fall = await neuerFall('900000000000009816', gateway);
    gesendet.length = 0;
    await einstellungen({ verificationChannelId: null });
    await faelligStellen(fall.id);

    const ergebnis = await verification.sendeErinnerung(fall.id, await hole(), {
      gateway,
      warte: sofort,
    });
    expect(ergebnis?.ende).toBe('kein_kanal');
    expect(gesendet).toEqual([]);
  });

  it('beendet die Reihe, wenn Erinnerungen abgeschaltet werden', async () => {
    const { gateway, gesendet } = attrappe();
    const fall = await neuerFall('900000000000009817', gateway);
    gesendet.length = 0;
    await einstellungen({ reminderEnabled: false });
    await faelligStellen(fall.id);

    const ergebnis = await verification.sendeErinnerung(fall.id, await hole(), {
      gateway,
      warte: sofort,
    });
    expect(ergebnis?.ende).toBe('abgeschaltet');
    expect(gesendet).toEqual([]);
    expect((await verification.requireRequest(fall.id)).nextReminderAt).toBeNull();
  });

  it('plant gar nichts, wenn Erinnerungen von Anfang an aus sind', async () => {
    await einstellungen({ reminderEnabled: false });
    const { gateway } = attrappe();
    const fall = await neuerFall('900000000000009818', gateway);
    expect(fall.nextReminderAt).toBeNull();
  });

  it('beendet die Reihe, wenn Discord das Loeschen der Begruessung meldet', async () => {
    const { gateway, nachrichten } = attrappe();
    const fall = await neuerFall('900000000000009819', gateway);
    const begruessung = [...nachrichten.keys()][0]!;

    expect(await verification.begruessungGeloescht(begruessung)).toBe(true);
    expect((await verification.requireRequest(fall.id)).nextReminderAt).toBeNull();
  });

  it('laesst eine fremde geloeschte Nachricht in Ruhe', async () => {
    const { gateway } = attrappe();
    const fall = await neuerFall('900000000000009820', gateway);
    expect(await verification.begruessungGeloescht('irgendeine-fremde-id')).toBe(false);
    expect((await verification.requireRequest(fall.id)).nextReminderAt).not.toBeNull();
  });

  // --- Stoerungen ---------------------------------------------------------

  it('beendet die Reihe nicht, wenn Discord gerade nicht antwortet', async () => {
    /*
     * Eine Stoerung ist kein «geloescht». Wer beides gleich behandelt,
     * beendet bei jedem Schluckauf Reihen, die weiterlaufen sollten - und
     * es faellt niemandem auf, denn es geschieht ja nichts.
     */
    const { gateway } = attrappe();
    const fall = await neuerFall('900000000000009821', gateway);
    await faelligStellen(fall.id);

    const kaputt = attrappe({ sendenScheitert: true });
    (kaputt.gateway!.channels as unknown as { message: unknown }).message = vi.fn(async () => {
      throw new Error('Discord antwortet nicht');
    });

    const ergebnis = await verification.sendeErinnerung(fall.id, await hole(), {
      gateway: kaputt.gateway,
      warte: sofort,
    });

    expect(ergebnis?.ende).toBeNull();
    expect((await verification.requireRequest(fall.id)).nextReminderAt).not.toBeNull();
  });

  it('verschiebt den Termin auch dann, wenn das Senden scheitert', async () => {
    const { gateway } = attrappe();
    const fall = await neuerFall('900000000000009822', gateway);
    await faelligStellen(fall.id);

    const kaputt = attrappe({ sendenScheitert: true });
    // Die Begruessung soll als vorhanden gelten - es geht allein ums Senden.
    (kaputt.gateway!.channels as unknown as { message: unknown }).message = vi.fn(async () => ({
      id: 'x',
      authorId: 'bot',
      authorIsBot: true,
      createdAt: new Date(),
    }));

    const jetzt = new Date();
    const ergebnis = await verification.sendeErinnerung(fall.id, await hole(), {
      gateway: kaputt.gateway,
      jetzt,
      warte: sofort,
    });

    expect(ergebnis?.gesendet).toBe(false);
    const nachher = await verification.requireRequest(fall.id);
    // Kein Dauerfeuer: der Termin steht in der Zukunft, der Zaehler blieb.
    expect(nachher.nextReminderAt!.getTime()).toBeGreaterThan(jetzt.getTime());
    expect(nachher.reminderCount).toBe(0);
  });

  it('haelt die Erinnerung fuer gesendet, auch wenn das Loeschen scheitert', async () => {
    const { gateway, gesendet } = attrappe();
    const fall = await neuerFall('900000000000009823', gateway);
    gesendet.length = 0;
    await faelligStellen(fall.id);
    (gateway!.channels as unknown as { delete: unknown }).delete = vi.fn(async () => {
      throw new Error('Manage Messages fehlt');
    });

    const ergebnis = await verification.sendeErinnerung(fall.id, await hole(), {
      gateway,
      warte: sofort,
    });

    expect(ergebnis?.gesendet).toBe(true);
    expect(ergebnis?.geloescht).toBe(false);
  });

  // --- Austritt -----------------------------------------------------------

  it('loescht beim Austritt die urspruengliche Botnachricht', async () => {
    const { gateway, nachrichten, geloescht } = attrappe();
    const fall = await neuerFall('900000000000009824', gateway);
    const begruessung = [...nachrichten.keys()][0]!;

    await verification.markLeft(fall.guildId, '900000000000009824', { gateway });

    expect(geloescht).toContain(begruessung);
    expect(nachrichten.has(begruessung)).toBe(false);
    expect((await verification.requireRequest(fall.id)).status).toBe('LEFT_SERVER');
  });

  it('bleibt beim zweiten Austritt still', async () => {
    const { gateway, geloescht } = attrappe();
    const fall = await neuerFall('900000000000009825', gateway);

    await verification.markLeft(fall.guildId, '900000000000009825', { gateway });
    const nachErstem = geloescht.length;
    const zweiter = await verification.markLeft(fall.guildId, '900000000000009825', { gateway });

    expect(zweiter).toBeNull();
    expect(geloescht).toHaveLength(nachErstem);
  });

  it('kommt damit zurecht, dass die Botnachricht schon weg ist', async () => {
    const { gateway, nachrichten } = attrappe();
    const fall = await neuerFall('900000000000009826', gateway);
    nachrichten.clear();
    (gateway!.channels as unknown as { delete: unknown }).delete = vi.fn(async () => {
      throw new Error('Unknown Message');
    });

    await expect(
      verification.markLeft(fall.guildId, '900000000000009826', { gateway }),
    ).resolves.not.toBeNull();
    expect((await verification.requireRequest(fall.id)).status).toBe('LEFT_SERVER');
  });

  it('laesst nach erneutem Beitritt keinen alten Termin weiterlaufen', async () => {
    const { gateway, gesendet } = attrappe();
    const erster = await neuerFall('900000000000009827', gateway);
    await verification.markLeft(erster.guildId, '900000000000009827', { gateway });

    // Neuer Beitritt: ein neuer Vorgang, ein neuer Termin. Der alte bleibt
    // geschlossen und meldet sich nicht mehr.
    const zweiter = await neuerFall('900000000000009827', gateway);
    expect(zweiter.id).not.toBe(erster.id);
    gesendet.length = 0;

    await faelligStellen(erster.id);
    await verification.runVerificationTick(new Date(), gateway);
    expect(gesendet).toEqual([]);
  });
});
