import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_verifikation_auto_delete');

/**
 * Die Verifikationsnachricht räumt sich selbst weg.
 *
 * ## Wogegen das hilft
 *
 * Ein Bot-Konto tritt bei, bekommt seine Begrüssung und tut danach nichts
 * mehr. Ein totes Konto ebenso. Die Nachricht bleibt stehen - eine
 * Aufforderung an jemanden, der sie nie lesen wird -, und bei einem Server
 * mit Zulauf besteht der Verifikationskanal nach einem halben Jahr fast nur
 * noch aus ihnen.
 *
 * ## Was diese Datei vor allem festhält
 *
 * Dass es dabei bleibt. Drei Zusagen, und jede einzelne wäre leicht zu
 * verlieren:
 *
 *  1. **Es wird niemand entfernt.** Vor dieser Fassung gab es einmal eine
 *     Frist, die vom Server warf; sie ist ersatzlos entfallen, weil sie
 *     zuverlässig die Falschen traf. Hier läuft eine Frist ab, und es
 *     verschwindet eine Nachricht - sonst nichts.
 *  2. **Reminder und Delete sind unabhängig.** «Erinnere täglich, räume nach
 *     drei Tagen auf» muss gehen, ohne dass das Aufräumen die Erinnerungen
 *     beendet.
 *  3. **Doppelt gelöscht wird nie.** Auch nicht, wenn zwei Durchgänge sich
 *     begegnen, und auch nicht, wenn jemand von Hand schneller war.
 *
 * **Kein echtes Discord.** Der Zugang ist eine Attrappe, die mitschreibt.
 */
const { prisma } = await import('@swisshub/database');
const { verification, setModuleEnabled, setModuleSettings } = await import('@swisshub/modules');
const { DiscordApiError } = await import('@swisshub/discord');

const UNVERIFIZIERT = '900000000000000701';
const MITGLIED = '900000000000000702';
const KANAL = '900000000000000801';
const STUNDE = 3600_000;

interface Gesendet {
  channelId: string;
  content: string;
}

/**
 * Ein Discord-Zugang, der mitschreibt.
 *
 * `nachrichten` ist der Kanal, wie er von aussen aussieht: was gesendet und
 * noch nicht gelöscht wurde. Genau daran lässt sich ablesen, ob die
 * Begrüssung noch dasteht.
 */
function attrappe(optionen: { loeschenScheitert?: boolean; schonWeg?: boolean } = {}) {
  const nachrichten = new Map<string, Gesendet>();
  const geloescht: string[] = [];
  let zaehler = 0;

  const gateway = {
    members: {
      get: vi.fn(async (discordId: string) => ({
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
      })),
      setRoles: vi.fn(async () => undefined),
      kick: vi.fn(async () => undefined),
    },
    bans: { add: vi.fn(async () => undefined) },
    channels: {
      send: vi.fn(async (channelId: string, payload: Record<string, unknown>) => {
        zaehler += 1;
        const id = `msg-${zaehler}`;
        nachrichten.set(id, { channelId, content: String(payload.content ?? '') });
        return { id, channelId };
      }),
      edit: vi.fn(async () => undefined),
      delete: vi.fn(async (_channelId: string, messageId: string) => {
        if (optionen.schonWeg) {
          // Genau das, was Discord sagt, wenn jemand schneller war.
          throw new DiscordApiError(404, 10008, 'DELETE /channels/x/messages/y', 'Unknown Message');
        }
        if (optionen.loeschenScheitert) {
          throw new DiscordApiError(500, undefined, 'DELETE /channels/x/messages/y', 'Server Error');
        }
        geloescht.push(messageId);
        nachrichten.delete(messageId);
      }),
      message: vi.fn(async (_channelId: string, messageId: string) =>
        nachrichten.has(messageId)
          ? { id: messageId, authorId: 'bot', authorIsBot: true, createdAt: new Date() }
          : null,
      ),
    },
  } as unknown as Parameters<typeof verification.sendGreeting>[2];

  return { gateway, nachrichten, geloescht };
}

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

const begruessungen = (requestId: string) =>
  prisma.verificationBotMessage.findMany({ where: { requestId, kind: 'GREETING' } });

describeWithDatabase('Verifikation: Nachricht automatisch löschen', () => {
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

  // --- Der Schalter -------------------------------------------------------

  it('plant ohne eingeschaltetes Auto-Delete keinen Termin', async () => {
    const { gateway } = attrappe();
    const fall = await neuerFall('900000000000009901', gateway);

    const zeilen = await begruessungen(fall.id);
    expect(zeilen).toHaveLength(1);
    // `NULL` heisst «kein Termin» - und die Abfrage findet die Zeile deshalb
    // nie faellig vor.
    expect(zeilen[0]!.deleteAt).toBeNull();
  });

  it('plant mit eingeschaltetem Auto-Delete den Termin aus dem Intervall', async () => {
    await einstellungen({ greetingAutoDeleteEnabled: true, greetingAutoDeleteSeconds: 24 * 3600 });
    const { gateway } = attrappe();
    const fall = await neuerFall('900000000000009902', gateway);

    const zeile = (await begruessungen(fall.id))[0]!;
    expect(zeile.deleteAt).not.toBeNull();
    const abstand = zeile.deleteAt!.getTime() - Date.now();
    expect(abstand).toBeGreaterThan(23 * STUNDE);
    expect(abstand).toBeLessThan(25 * STUNDE);
  });

  it('nimmt ein benutzerdefiniertes Intervall', async () => {
    // Sechs Stunden - einer der vorgeschlagenen Werte, und zugleich der
    // Beleg, dass nicht irgendwo 24 hartcodiert steht.
    await einstellungen({ greetingAutoDeleteEnabled: true, greetingAutoDeleteSeconds: 6 * 3600 });
    const { gateway } = attrappe();
    const fall = await neuerFall('900000000000009903', gateway);

    const zeile = (await begruessungen(fall.id))[0]!;
    const abstand = zeile.deleteAt!.getTime() - Date.now();
    expect(abstand).toBeGreaterThan(5 * STUNDE);
    expect(abstand).toBeLessThan(7 * STUNDE);
  });

  it('lässt eine schon gesendete Nachricht von einer späteren Änderung unberührt', async () => {
    /*
     * Der Termin wird einmal beim Senden gerechnet. Wer das Intervall von 72
     * auf 6 Stunden stellt, loescht sonst beim naechsten Durchgang alles,
     * was aelter als sechs Stunden ist - auf einen Schlag.
     */
    await einstellungen({ greetingAutoDeleteEnabled: true, greetingAutoDeleteSeconds: 72 * 3600 });
    const { gateway } = attrappe();
    const fall = await neuerFall('900000000000009904', gateway);
    const vorher = (await begruessungen(fall.id))[0]!.deleteAt!;

    await einstellungen({ greetingAutoDeleteEnabled: true, greetingAutoDeleteSeconds: 3600 });
    await verification.loescheFaelligeBegruessungen(new Date(), gateway);

    const nachher = (await begruessungen(fall.id))[0]!;
    expect(nachher.deleteAt!.getTime()).toBe(vorher.getTime());
    expect(nachher.deletedAt).toBeNull();
  });

  // --- Das Löschen selbst --------------------------------------------------

  it('löscht die Nachricht, sobald die Frist abgelaufen ist', async () => {
    await einstellungen({ greetingAutoDeleteEnabled: true, greetingAutoDeleteSeconds: 3600 });
    const { gateway, nachrichten, geloescht } = attrappe();
    const fall = await neuerFall('900000000000009905', gateway);
    const messageId = [...nachrichten.keys()][0]!;

    const ergebnis = await verification.loescheFaelligeBegruessungen(
      new Date(Date.now() + 2 * STUNDE),
      gateway,
    );

    expect(ergebnis.geloescht).toBe(1);
    expect(geloescht).toEqual([messageId]);
    expect(nachrichten.has(messageId)).toBe(false);
    expect((await begruessungen(fall.id))[0]!.deletedAt).not.toBeNull();
  });

  it('löscht vor Ablauf der Frist nichts', async () => {
    await einstellungen({ greetingAutoDeleteEnabled: true, greetingAutoDeleteSeconds: 24 * 3600 });
    const { gateway, geloescht } = attrappe();
    await neuerFall('900000000000009906', gateway);

    const ergebnis = await verification.loescheFaelligeBegruessungen(new Date(), gateway);
    expect(ergebnis.geloescht).toBe(0);
    expect(geloescht).toEqual([]);
  });

  it('überlebt einen Neustart - der Termin steht in der Datenbank', async () => {
    /*
     * Kein `setTimeout`: der ueberlebt kein Deployment. Der Beleg ist, dass
     * ein Durchgang, der nichts von der Begruessung weiss, sie trotzdem
     * findet - genau das tut ein frisch gestarteter Bot.
     */
    await einstellungen({ greetingAutoDeleteEnabled: true, greetingAutoDeleteSeconds: 3600 });
    const { gateway: erster, nachrichten } = attrappe();
    const fall = await neuerFall('900000000000009907', erster);
    const messageId = [...nachrichten.keys()][0]!;

    // Ein zweiter, voellig frischer Zugang - wie nach einem Neustart.
    const { gateway: zweiter, geloescht } = attrappe();
    await verification.loescheFaelligeBegruessungen(new Date(Date.now() + 2 * STUNDE), zweiter);

    expect(geloescht).toEqual([messageId]);
    expect((await begruessungen(fall.id))[0]!.deletedAt).not.toBeNull();
  });

  it('löscht nicht zweimal', async () => {
    await einstellungen({ greetingAutoDeleteEnabled: true, greetingAutoDeleteSeconds: 3600 });
    const { gateway, geloescht } = attrappe();
    await neuerFall('900000000000009908', gateway);

    const spaeter = new Date(Date.now() + 2 * STUNDE);
    await verification.loescheFaelligeBegruessungen(spaeter, gateway);
    const zweiter = await verification.loescheFaelligeBegruessungen(spaeter, gateway);

    expect(zweiter.geloescht).toBe(0);
    expect(geloescht).toHaveLength(1);
  });

  it('lässt zwei gleichzeitige Durchgänge nur einen löschen', async () => {
    /*
     * Zwischen «gefunden» und «geloescht» liegt ein Netzaufruf, und in der
     * Zeit kann ein zweiter Worker dieselbe Zeile finden. Der Riegel ist die
     * bedingte Aktualisierung von `deletedAt`.
     */
    await einstellungen({ greetingAutoDeleteEnabled: true, greetingAutoDeleteSeconds: 3600 });
    const { gateway, geloescht } = attrappe();
    await neuerFall('900000000000009909', gateway);

    const spaeter = new Date(Date.now() + 2 * STUNDE);
    const [eins, zwei] = await Promise.all([
      verification.loescheFaelligeBegruessungen(spaeter, gateway),
      verification.loescheFaelligeBegruessungen(spaeter, gateway),
    ]);

    expect(eins.geloescht + zwei.geloescht).toBe(1);
    expect(geloescht).toHaveLength(1);
  });

  it('behandelt eine bereits gelöschte Nachricht als Erfolg', async () => {
    /*
     * Discord antwortet mit 404 «Unknown Message». Das ist genau der Zustand,
     * den wir herstellen wollten - jemand war von Hand schneller. Kein
     * Fehler, kein zweiter Versuch, kein Fehlerlaerm.
     */
    await einstellungen({ greetingAutoDeleteEnabled: true, greetingAutoDeleteSeconds: 3600 });
    const { gateway } = attrappe();
    const fall = await neuerFall('900000000000009910', gateway);

    const { gateway: schonWeg } = attrappe({ schonWeg: true });
    const ergebnis = await verification.loescheFaelligeBegruessungen(
      new Date(Date.now() + 2 * STUNDE),
      schonWeg,
    );

    expect(ergebnis.schonWeg).toBe(1);
    expect(ergebnis.fehlgeschlagen).toBe(0);
    // Der Vermerk bleibt stehen: der gewuenschte Zustand ist erreicht.
    expect((await begruessungen(fall.id))[0]!.deletedAt).not.toBeNull();
  });

  it('versucht es beim nächsten Durchgang erneut, wenn Discord ausfällt', async () => {
    /*
     * Ein 500 ist etwas anderes als ein 404: die Nachricht steht noch im
     * Kanal. Sie als «geloescht» zu vermerken hiesse, sie fuer immer
     * stehenzulassen.
     */
    await einstellungen({ greetingAutoDeleteEnabled: true, greetingAutoDeleteSeconds: 3600 });
    const { gateway } = attrappe();
    const fall = await neuerFall('900000000000009911', gateway);

    const { gateway: kaputt } = attrappe({ loeschenScheitert: true });
    const ergebnis = await verification.loescheFaelligeBegruessungen(
      new Date(Date.now() + 2 * STUNDE),
      kaputt,
    );

    expect(ergebnis.fehlgeschlagen).toBe(1);
    expect(ergebnis.geloescht).toBe(0);
    expect((await begruessungen(fall.id))[0]!.deletedAt).toBeNull();
  });

  // --- Die Abgrenzung: was NICHT geschieht ---------------------------------

  it('kickt, bannt und verifiziert niemanden', async () => {
    /*
     * Die wichtigste Zusage der ganzen Datei. Frueher warf eine Frist vom
     * Server; hier laeuft eine Frist ab, und es verschwindet eine Nachricht.
     */
    await einstellungen({ greetingAutoDeleteEnabled: true, greetingAutoDeleteSeconds: 3600 });
    const { gateway } = attrappe();
    const fall = await neuerFall('900000000000009912', gateway);

    await verification.loescheFaelligeBegruessungen(new Date(Date.now() + 2 * STUNDE), gateway);

    const nachher = await verification.requireRequest(fall.id);
    expect(nachher.status).toBe('WAITING_FOR_MESSAGE');
    expect(nachher.decidedAt).toBeNull();
    const zugang = gateway as unknown as {
      members: { kick: { mock: { calls: unknown[] } }; setRoles: { mock: { calls: unknown[] } } };
      bans: { add: { mock: { calls: unknown[] } } };
    };
    expect(zugang.members.kick.mock.calls).toHaveLength(0);
    expect(zugang.bans.add.mock.calls).toHaveLength(0);
    expect(zugang.members.setRoles.mock.calls).toHaveLength(0);
  });

  it('beendet die Erinnerungsreihe nicht', async () => {
    /*
     * Reminder und Delete sind unabhängig - «erinnere täglich, räume nach
     * drei Tagen auf» muss gehen. Eine gelöschte Begrüssung beendet die
     * Reihe nur, wenn ein **Mensch** aufgeräumt hat.
     */
    await einstellungen({
      greetingAutoDeleteEnabled: true,
      greetingAutoDeleteSeconds: 3600,
      reminderEnabled: true,
      reminderIntervalHours: 24,
      reminderContinueAfterOriginalDeleted: false,
    });
    const { gateway, nachrichten } = attrappe();
    const fall = await neuerFall('900000000000009913', gateway);
    const messageId = [...nachrichten.keys()][0]!;
    expect((await verification.requireRequest(fall.id)).nextReminderAt).not.toBeNull();

    await verification.loescheFaelligeBegruessungen(new Date(Date.now() + 2 * STUNDE), gateway);

    // Das Ereignis, das Discord danach schickt: «diese Nachricht ist weg».
    const beendet = await verification.begruessungGeloescht(messageId);
    expect(beendet).toBe(false);
    expect((await verification.requireRequest(fall.id)).nextReminderAt).not.toBeNull();
  });

  it('beendet die Reihe weiterhin, wenn ein Mensch aufräumt', async () => {
    // Die Gegenprobe: ohne Vermerk gilt die alte Regel unveraendert.
    await einstellungen({ reminderEnabled: true, reminderContinueAfterOriginalDeleted: false });
    const { gateway, nachrichten } = attrappe();
    const fall = await neuerFall('900000000000009914', gateway);
    const messageId = [...nachrichten.keys()][0]!;

    const beendet = await verification.begruessungGeloescht(messageId);
    expect(beendet).toBe(true);
    expect((await verification.requireRequest(fall.id)).nextReminderAt).toBeNull();
  });

  it('vermerkt die eigene Löschung auch beim Austritt', async () => {
    /*
     * `loescheBegruessung` laeuft, wenn jemand den Server verlaesst. Auch
     * dort muss der Vermerk stehen, sonst deutete das Discord-Ereignis
     * danach auf einen Menschen - und der spaetere Fristlauf liefe ins Leere.
     */
    await einstellungen({ greetingAutoDeleteEnabled: true, greetingAutoDeleteSeconds: 3600 });
    const { gateway, nachrichten } = attrappe();
    const fall = await neuerFall('900000000000009915', gateway);
    const messageId = [...nachrichten.keys()][0]!;

    const ergebnis = await verification.loescheBegruessung(fall.id, { gateway });
    expect(ergebnis.geloescht).toBe(1);
    expect((await begruessungen(fall.id))[0]!.deletedAt).not.toBeNull();

    // Und der spaetere Fristlauf findet nichts mehr.
    const spaeter = await verification.loescheFaelligeBegruessungen(
      new Date(Date.now() + 2 * STUNDE),
      gateway,
    );
    expect(spaeter.geloescht).toBe(0);
    expect(await verification.begruessungGeloescht(messageId)).toBe(false);
  });

  it('läuft im Durchgang mit und meldet die Zahl', async () => {
    await einstellungen({ greetingAutoDeleteEnabled: true, greetingAutoDeleteSeconds: 3600 });
    const { gateway } = attrappe();
    await neuerFall('900000000000009916', gateway);
    await neuerFall('900000000000009917', gateway);

    const ergebnis = await verification.runVerificationTick(new Date(Date.now() + 2 * STUNDE), gateway);
    expect(ergebnis.begruessungenEntfernt).toBe(2);
  });

  it('lässt die Begrüssung stehen, wenn das Auto-Delete aus ist', async () => {
    /*
     * Ohne Termin gibt es keine faellige Zeile - die Abfrage findet nichts.
     *
     * Geprueft wird, dass die **Begruessung** stehen bleibt, und nicht, dass
     * der Durchgang gar nichts loescht: er loescht in diesem Zeitraum auch
     * die Erinnerung, die er selbst gesendet hat, und die soll weg.
     */
    const { gateway, nachrichten } = attrappe();
    const fall = await neuerFall('900000000000009918', gateway);
    const messageId = [...nachrichten.keys()][0]!;

    const ergebnis = await verification.runVerificationTick(new Date(Date.now() + 30 * 24 * STUNDE), gateway);
    expect(ergebnis.begruessungenEntfernt).toBe(0);
    expect(nachrichten.has(messageId)).toBe(true);
    expect((await begruessungen(fall.id))[0]!.deletedAt).toBeNull();
  });
});
