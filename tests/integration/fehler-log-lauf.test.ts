import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_fehler_log');

/**
 * Der Fehler-Log im Lauf - gegen eine echte Datenbank.
 *
 * ## Warum das eine Datenbank braucht
 *
 * Weil das Zusammenfassen genau daran haengt: `upsert` auf einen eindeutigen
 * `fingerprint`, `increment` auf den Zaehler, und ein `updateMany` mit
 * Bedingung, das den Anspruch auf die naechste Meldung stellt. Drei Dinge,
 * die es ohne Datenbank nicht gibt - und das `updateMany` ist die Zusage,
 * dass zwei gleichzeitige Fehler **eine** Meldung ergeben und nicht zwei.
 *
 * Die reinen Funktionen - Bereinigung, Fingerprint, Meldepflicht - stehen in
 * `tests/unit/fehler-log.test.ts`, wo sie keine Datenbank brauchen.
 */
const { prisma } = await import('@swisshub/database');
const { logs } = await import('@swisshub/modules');
const { AppError } = await import('@swisshub/shared');

/**
 * Eine Attrappe in der Form eines Discord-Bot-Tokens.
 *
 * Zusammengesetzt und nicht als Zeichenkette hingeschrieben - aus einem
 * Grund, der beim ersten Versuch zuschlug: GitHubs Push Protection erkennt
 * die **Form** und lehnt den Push ab. Sie hat damit recht, auch wenn der
 * Wert erfunden ist: ein Literal dieser Form im Repository ist fuer jeden
 * Scanner ein Fund, und jeder spaetere Push bliebe daran haengen.
 *
 * Fuer den Test aendert das nichts. Geprueft wird `bereinige`, und die
 * arbeitet auf dem Wert zur Laufzeit - nicht auf dem Quelltext.
 */
function tokenAttrappe(): string {
  const teile = ['MTIzNDU2Nzg5MDEyMzQ1Njc4', 'GaBcDe', 'A'.repeat(28)];
  return teile.join('.');
}

describeWithDatabase('Fehler-Log', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.errorLogEntry.deleteMany();
    await prisma.discordLogChannel.deleteMany();
    await prisma.discordLogDelivery.deleteMany();
  });

  it('fasst denselben Fehler zu einer Zeile zusammen und zaehlt ihn', async () => {
    /*
     * Der ganze Zweck. Ein kaputter Befehl scheitert bei jedem, der ihn
     * versucht - und eine Nachricht je Versuch macht aus einem Log-Kanal eine
     * Lawine, in der die zweite Ursache untergeht.
     *
     * Verschiedene Kennungen im Text, derselbe Fehler: die Entstellung vor
     * dem Hash sorgt dafuer, dass daraus eine Zeile wird.
     */
    for (const id of ['123456789012345678', '987654321098765432', '111111111111111111']) {
      await logs.meldeFehler({
        source: 'DISCORD_COMMAND',
        origin: '/level',
        fehler: new Error(`Mitglied ${id} nicht gefunden`),
        actorDiscordId: id,
      });
    }

    const zeilen = await prisma.errorLogEntry.findMany();
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]?.occurrences).toBe(3);
    // Gemeldet wurde genau einmal - die Ruhezeit haelt die zwei weiteren still.
    expect(zeilen[0]?.notifiedCount).toBe(1);
    expect(zeilen[0]?.message).toContain('nicht gefunden');
  });

  it('haelt zwei verschiedene Fehler getrennt', async () => {
    await logs.meldeFehler({
      source: 'DISCORD_COMMAND',
      origin: '/level',
      fehler: new Error('Mitglied nicht gefunden'),
    });
    await logs.meldeFehler({
      source: 'DISCORD_COMMAND',
      origin: '/jail',
      fehler: new Error('Mitglied nicht gefunden'),
    });

    const zeilen = await prisma.errorLogEntry.findMany({ orderBy: { origin: 'asc' } });
    expect(zeilen.map((zeile) => zeile.origin)).toEqual(['/jail', '/level']);
  });

  it('schreibt keine Antwort an einen Benutzer in den Log', async () => {
    /*
     * «Dir fehlt die Berechtigung» ist eine Antwort des Systems und kein
     * Fehler. Sie in einen Fehlerkanal zu schreiben hiesse, ihn mit dem
     * Normalbetrieb zu fluten.
     */
    await logs.meldeFehler({ source: 'WEBAPP', origin: 'action:x', fehler: new AppError('FORBIDDEN') });
    await logs.meldeFehler({
      source: 'WEBAPP',
      origin: 'action:x',
      fehler: new AppError('VALIDATION_FAILED'),
    });
    expect(await prisma.errorLogEntry.count()).toBe(0);

    // Was niemand vorhergesehen hat, kommt hinein.
    await logs.meldeFehler({ source: 'WEBAPP', origin: 'action:x', fehler: new AppError('INTERNAL') });
    expect(await prisma.errorLogEntry.count()).toBe(1);
  });

  it('meldet nach der Ruhezeit wieder - und zaehlt die Meldung mit', async () => {
    /*
     * Ohne das zweite Melden waere ein Fehler, der seit Tagen laeuft,
     * irgendwann aus dem Kanal verschwunden - er sieht dann aus wie behoben.
     *
     * `notifiedCount` wandert in den Dedupe-Schluessel der Zustellung: ohne
     * ihn waere die zweite Meldung eine Doppelung und wuerde verworfen.
     */
    await logs.meldeFehler({ source: 'BOT', origin: 'job:sync', fehler: new Error('kaputt') });
    const erste = await prisma.errorLogEntry.findFirstOrThrow();
    expect(erste.notifiedCount).toBe(1);

    // Die Ruhezeit kuenstlich ablaufen lassen.
    await prisma.errorLogEntry.update({
      where: { id: erste.id },
      data: { notifiedAt: new Date(Date.now() - logs.RUHEZEIT_MS - 1000) },
    });

    await logs.meldeFehler({ source: 'BOT', origin: 'job:sync', fehler: new Error('kaputt') });
    const zweite = await prisma.errorLogEntry.findFirstOrThrow();
    expect(zweite.occurrences).toBe(2);
    expect(zweite.notifiedCount).toBe(2);
  });

  it('bleibt innerhalb der Ruhezeit still', async () => {
    await logs.meldeFehler({ source: 'BOT', origin: 'job:sync', fehler: new Error('kaputt') });
    await logs.meldeFehler({ source: 'BOT', origin: 'job:sync', fehler: new Error('kaputt') });
    const zeile = await prisma.errorLogEntry.findFirstOrThrow();
    expect(zeile.occurrences).toBe(2);
    expect(zeile.notifiedCount).toBe(1);
  });

  it('meldet bei zehn gleichzeitigen Fehlern genau einmal', async () => {
    /*
     * Der Normalfall bei einem kaputten Befehl: zehn Leute klicken im selben
     * Moment. Der Anspruch auf die Meldung wird deshalb **in der Datenbank**
     * gestellt - ein `updateMany` mit Bedingung kann nur einmal gewinnen.
     * Eine Pruefung im Code haette hier zehn Nachrichten erzeugt.
     */
    await Promise.all(
      Array.from({ length: 10 }, () =>
        logs.meldeFehler({ source: 'WEBAPP', origin: '/u/[slug]', fehler: new Error('gleichzeitig') }),
      ),
    );

    const zeilen = await prisma.errorLogEntry.findMany();
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]?.occurrences).toBe(10);
    expect(zeilen[0]?.notifiedCount).toBe(1);
  });

  it('haelt firstSeenAt fest und schreibt lastSeenAt fort', async () => {
    // «Seit wann» und «wie oft» sind die zwei Fragen, die eine Nachricht in
    // einem Kanal nicht beantwortet.
    await logs.meldeFehler({ source: 'BOT', origin: 'job:sync', fehler: new Error('x') });
    const erste = await prisma.errorLogEntry.findFirstOrThrow();

    await prisma.errorLogEntry.update({
      where: { id: erste.id },
      data: { firstSeenAt: new Date(Date.now() - 86_400_000) },
    });
    const vorher = await prisma.errorLogEntry.findFirstOrThrow();

    await logs.meldeFehler({ source: 'BOT', origin: 'job:sync', fehler: new Error('x') });
    const nachher = await prisma.errorLogEntry.findFirstOrThrow();

    expect(nachher.firstSeenAt.getTime()).toBe(vorher.firstSeenAt.getTime());
    expect(nachher.lastSeenAt.getTime()).toBeGreaterThanOrEqual(vorher.lastSeenAt.getTime());
  });

  it('legt kein Geheimnis in die Tabelle', async () => {
    /*
     * Die Zusicherung, auf die es ankommt. Eine Fehlermeldung zitiert gern
     * die Anfrage, die sie ausgeloest hat - und eine Anfrage an Discord
     * traegt den Bot-Token in der Kopfzeile.
     *
     * Geprueft wird die **ganze Zeile** als Text: Meldung, Stapel und
     * Kontext zusammen. Ein Test, der nur die Meldung ansieht, haette eine
     * Luecke genau dort, wo der Aufrufer selbst etwas mitgibt.
     */
    const attrappe = tokenAttrappe();
    await logs.meldeFehler({
      source: 'WEBAPP',
      origin: 'action:integration',
      fehler: new Error(`POST https://discord.com/api failed: Authorization: Bot ${attrappe}`),
      kontext: {
        authorization: `Bot ${attrappe}`,
        datenbank: 'postgresql://swisshub:gehe1mnis@db:5432/app',
        pfad: '/api/x',
      },
    });

    const zeile = await prisma.errorLogEntry.findFirstOrThrow();
    const ganzeZeile = JSON.stringify(zeile);
    for (const geheim of [...attrappe.split('.'), attrappe, 'gehe1mnis']) {
      expect(ganzeZeile, geheim).not.toContain(geheim);
    }
    // Was bleiben soll, bleibt: der Ort und der harmlose Zusammenhang.
    expect(zeile.origin).toBe('action:integration');
    expect(JSON.stringify(zeile.context)).toContain('/api/x');
    expect((zeile.context as Record<string, string>).authorization).toBe('[entfernt]');
  });

  it('kommt ohne eingerichteten Kanal durch, ohne etwas zu verlieren', async () => {
    /*
     * Die Kategorie `ERRORS` wird von keiner Migration auf einen Kanal
     * gelegt. Auf einem Server, auf dem niemand sie eingerichtet hat, endet
     * jede Meldung mit «kein Ziel» - und der Eintrag steht trotzdem in der
     * Tabelle. Der Log hoert nicht auf zu zaehlen, nur weil niemand zuhoert.
     */
    expect(await prisma.discordLogChannel.count()).toBe(0);
    await logs.meldeFehler({ source: 'BOT', origin: 'job:sync', fehler: new Error('ohne Kanal') });

    expect(await prisma.errorLogEntry.count()).toBe(1);
    expect(await prisma.discordLogDelivery.count()).toBe(0);
  });

  it('reiht bei eingerichtetem Kanal eine Zustellung ein', async () => {
    await prisma.discordLogChannel.create({
      data: {
        category: 'ERRORS',
        guildId: '200000000000000000',
        channelId: '300000000000000001',
        enabled: true,
        health: 'HEALTHY',
      },
    });

    await logs.meldeFehler({
      source: 'DISCORD_COMMAND',
      origin: '/level',
      fehler: new Error('mit Kanal'),
      actorDiscordId: '900000000000000001',
    });

    const zustellungen = await prisma.discordLogDelivery.findMany();
    expect(zustellungen).toHaveLength(1);
    expect(zustellungen[0]?.category).toBe('ERRORS');
    expect(zustellungen[0]?.channelId).toBe('300000000000000001');
    // Der Zaehler steht im Schluessel, damit die zweite Meldung durchkommt.
    const eintrag = await prisma.errorLogEntry.findFirstOrThrow();
    // `quelle:logId:channelId`, und `logId` traegt die Meldungsnummer.
    expect(zustellungen[0]?.dedupeKey).toBe(`fehler:${eintrag.id}:1:300000000000000001`);
  });

  it('laesst die zweite Meldung desselben Fehlers durch die Doppelungssperre', async () => {
    /*
     * Ohne `notifiedCount` im Schluessel waere jede Meldung nach der ersten
     * eine Doppelung desselben Eintrags - der Fehler verschwaende still aus
     * dem Kanal, obwohl er weiterlaeuft. Genau das wird hier geprueft.
     */
    await prisma.discordLogChannel.create({
      data: {
        category: 'ERRORS',
        guildId: '200000000000000000',
        channelId: '300000000000000001',
        enabled: true,
        health: 'HEALTHY',
      },
    });

    await logs.meldeFehler({ source: 'BOT', origin: 'job:sync', fehler: new Error('zweimal') });
    const eintrag = await prisma.errorLogEntry.findFirstOrThrow();
    await prisma.errorLogEntry.update({
      where: { id: eintrag.id },
      data: { notifiedAt: new Date(Date.now() - logs.RUHEZEIT_MS - 1000) },
    });
    await logs.meldeFehler({ source: 'BOT', origin: 'job:sync', fehler: new Error('zweimal') });

    const schluessel = (await prisma.discordLogDelivery.findMany()).map((zeile) => zeile.dedupeKey).sort();
    expect(schluessel).toEqual([
      `fehler:${eintrag.id}:1:300000000000000001`,
      `fehler:${eintrag.id}:2:300000000000000001`,
    ]);
  });

  it('sendet nicht in einen abgeschalteten Kanal', async () => {
    // `enabled: false` heisst «die Kategorie ist aus» - nicht «spaeter».
    await prisma.discordLogChannel.create({
      data: {
        category: 'ERRORS',
        guildId: '200000000000000000',
        channelId: '300000000000000001',
        enabled: false,
        health: 'DISABLED',
      },
    });

    await logs.meldeFehler({ source: 'BOT', origin: 'job:sync', fehler: new Error('aus') });
    expect(await prisma.errorLogEntry.count()).toBe(1);
    expect(await prisma.discordLogDelivery.count()).toBe(0);
  });

  it('wirft nie - auch nicht bei Unsinn als Fehler', async () => {
    /*
     * Diese Funktion wird aus `catch`-Bloecken aufgerufen. Ein Fehler beim
     * Melden eines Fehlers darf den urspruenglichen nicht verdecken und erst
     * recht nicht die Antwort an den Benutzer verhindern.
     */
    await expect(logs.meldeFehler({ source: 'BOT', origin: '', fehler: undefined })).resolves.toBeUndefined();
    await expect(
      logs.meldeFehler({ source: 'BOT', origin: 'x'.repeat(5000), fehler: { seltsam: true } }),
    ).resolves.toBeUndefined();

    const zeilen = await prisma.errorLogEntry.findMany();
    expect(zeilen).toHaveLength(2);
    // Der Ort wird gekuerzt, nicht abgelehnt - und «leer» wird benannt.
    expect(zeilen.map((zeile) => zeile.origin.length <= 120)).toEqual([true, true]);
    expect(zeilen.some((zeile) => zeile.origin === 'unbekannt')).toBe(true);
  });
});
