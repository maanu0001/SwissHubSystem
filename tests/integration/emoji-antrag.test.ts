import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_emoji');

// Vor dem ersten Import: `UPLOAD_DIR` wird beim Laden des Moduls gelesen.
process.env.SWISSHUB_UPLOAD_DIR = await mkdtemp(join(tmpdir(), 'swisshub-emoji-'));

/**
 * Vorschläge, Entscheidungen und die zehnte Stimme.
 *
 * ## Warum die Abstimmung einen echten Test braucht
 *
 * Weil die naheliegende Umsetzung - einfügen, zählen, bei zehn annehmen - unter
 * `READ COMMITTED` falsch ist und trotzdem fast immer richtig aussieht. Zwei
 * Leute klicken gleichzeitig; beide zählen neun, weil keiner die noch nicht
 * festgeschriebene Stimme des anderen sieht. Das Ziel wird erreicht und löst
 * nichts aus.
 *
 * Ein Test, der zehnmal nacheinander abstimmt, findet das nie. Der Test unten
 * stimmt deshalb **gleichzeitig** ab.
 */
const { prisma, clearRevisionCaches } = await import('@swisshub/database');
const { emoji, setModuleEnabled, setModuleSettings } = await import('@swisshub/modules');
const { discord } = await import('@swisshub/discord');

const ANTRAGSTELLER = '900000000000006001';
const MODERATOR = '900000000000006002';

/** Ein echtes kleines PNG - die Prüfung liest die Bytes. */
function png(nummer: number): Uint8Array {
  const bytes = new Uint8Array(40);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x00, 0x00, 0x00, 0x0d], 8);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const sicht = new DataView(bytes.buffer);
  sicht.setUint32(16, 64);
  sicht.setUint32(20, 64);
  // Ein Unterschied hinten: sonst hätten alle Bilder dieselbe Prüfsumme und
  // der Doppelschutz würde jeden zweiten Vorschlag ablehnen.
  sicht.setUint32(36, nummer);
  return bytes;
}

/** Ein animiertes GIF - für die getrennte Platzrechnung. */
function gif(nummer: number): Uint8Array {
  const bytes = new Uint8Array(26);
  bytes.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0);
  const sicht = new DataView(bytes.buffer);
  sicht.setUint16(6, 64, true);
  sicht.setUint16(8, 64, true);
  bytes.set([0x21, 0xf9, 0x04], 13);
  bytes.set([0x21, 0xf9, 0x04], 17);
  sicht.setUint16(22, nummer, true);
  return bytes;
}

async function einstellungen(
  werte: Partial<{
    antraegeAktiv: boolean;
    abstimmungAktiv: boolean;
    stimmenZiel: number;
    abstimmungMinuten: number;
    maxOffeneJeMitglied: number;
    reservePlaetze: number;
    erlaubteHosts: string;
  }> = {},
): Promise<void> {
  await setModuleSettings(
    emoji.EMOJI_MODULE_ID,
    {
      antraegeAktiv: true,
      moderationChannelId: '',
      abstimmungAktiv: true,
      abstimmungChannelId: '',
      stimmenZiel: 10,
      abstimmungMinuten: 10,
      maxOffeneJeMitglied: 3,
      erlaubteHosts: 'cdn.discordapp.com',
      reservePlaetze: 0,
      ...werte,
    },
    'test',
  );
  clearRevisionCaches();
}

/**
 * Die Emojis des Mock-Servers auf den Anfang zurücksetzen.
 *
 * Der Mock hält seinen Zustand im Prozess, nicht in der Datenbank - ein
 * `TRUNCATE` räumt ihn also nicht weg. Ohne das hier scheitert der zweite
 * Test, der «pog» vorschlägt, am Emoji, das der erste angelegt hat: ein
 * Fehlschlag, der nach einem Fehler in der Namensprüfung aussieht und keiner
 * ist.
 */
const MOCK_ANFANG = ['swisshub', 'pog_animiert'];

async function raeumeMockEmojisAuf(): Promise<void> {
  for (const eintrag of await discord.emojis.list()) {
    if (!MOCK_ANFANG.includes(eintrag.name)) {
      await discord.emojis.remove(eintrag.id);
    }
  }
}

/** Einen Vorschlag einreichen und seine Kennung zurückgeben. */
async function reicheEin(name: string, bytes = png(1)): Promise<string> {
  const ergebnis = await emoji.reicheEin({
    name,
    bytes,
    antragstellerId: ANTRAGSTELLER,
    herkunft: 'UPLOAD',
    herkunftNotiz: 'test.png',
  });
  expect(ergebnis.ok, ergebnis.grund).toBe(true);
  return ergebnis.antrag?.id ?? '';
}

describeWithDatabase('Emoji: Vorschläge einreichen', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "EmojiStimme","EmojiAntrag","ModuleState","AuditLog" RESTART IDENTITY CASCADE',
    );
    clearRevisionCaches();
    await setModuleEnabled(emoji.EMOJI_MODULE_ID, true, 'test');
    await einstellungen();
    await raeumeMockEmojisAuf();
  });

  it('nimmt einen gültigen Vorschlag an und legt die Bytes ab', async () => {
    const ergebnis = await emoji.reicheEin({
      name: 'POG',
      bytes: png(1),
      antragstellerId: ANTRAGSTELLER,
      herkunft: 'UPLOAD',
    });

    expect(ergebnis.ok).toBe(true);
    // Der Name wird kleingeschrieben gespeichert.
    expect(ergebnis.antrag?.name).toBe('pog');
    expect(ergebnis.antrag?.status).toBe('OFFEN');
    // Und die Datei lässt sich zurücklesen - sonst wäre die Annahme später
    // ein Vorschlag ohne Bild.
    expect(await emoji.liesAb(ergebnis.antrag?.dateiName ?? '')).not.toBeNull();
  });

  it('lehnt einen unmöglichen Namen ab, bevor etwas gespeichert wird', async () => {
    const ergebnis = await emoji.reicheEin({
      name: 'mein emoji',
      bytes: png(1),
      antragstellerId: ANTRAGSTELLER,
      herkunft: 'UPLOAD',
    });
    expect(ergebnis.ok).toBe(false);
    expect(await prisma.emojiAntrag.count()).toBe(0);
  });

  it('lehnt dasselbe Bild unter anderem Namen ab', async () => {
    await reicheEin('pog', png(7));
    const zweiter = await emoji.reicheEin({
      name: 'poggers',
      bytes: png(7),
      antragstellerId: MODERATOR,
      herkunft: 'UPLOAD',
    });
    expect(zweiter.ok).toBe(false);
    expect(zweiter.grund).toContain('pog');
  });

  it('lehnt denselben Namen zweimal ab', async () => {
    await reicheEin('pog', png(1));
    const zweiter = await emoji.reicheEin({
      name: 'pog',
      bytes: png(2),
      antragstellerId: MODERATOR,
      herkunft: 'UPLOAD',
    });
    expect(zweiter.ok).toBe(false);
  });

  it('lehnt einen Namen ab, den es auf dem Server schon gibt', async () => {
    // Der Mock-Server hat «swisshub» von Anfang an.
    const ergebnis = await emoji.reicheEin({
      name: 'swisshub',
      bytes: png(3),
      antragstellerId: ANTRAGSTELLER,
      herkunft: 'UPLOAD',
    });
    expect(ergebnis.ok).toBe(false);
    expect(ergebnis.grund).toContain('Server');
  });

  it('begrenzt die offenen Vorschläge je Mitglied', async () => {
    await einstellungen({ maxOffeneJeMitglied: 2 });
    await reicheEin('eins', png(11));
    await reicheEin('zwei', png(12));

    const dritter = await emoji.reicheEin({
      name: 'drei',
      bytes: png(13),
      antragstellerId: ANTRAGSTELLER,
      herkunft: 'UPLOAD',
    });
    expect(dritter.ok).toBe(false);

    // Nach einer Entscheidung ist der Platz wieder frei: die Grenze zählt
    // offene Vorschläge, nicht alle.
    const ersterId = (await prisma.emojiAntrag.findFirstOrThrow({ where: { name: 'eins' } })).id;
    await emoji.lehneAb(ersterId, MODERATOR, 'passt nicht');
    const danach = await emoji.reicheEin({
      name: 'drei',
      bytes: png(13),
      antragstellerId: ANTRAGSTELLER,
      herkunft: 'UPLOAD',
    });
    expect(danach.ok, danach.grund).toBe(true);
  });

  it('lehnt ab, solange Vorschläge ausgeschaltet sind', async () => {
    await einstellungen({ antraegeAktiv: false });
    const ergebnis = await emoji.reicheEin({
      name: 'pog',
      bytes: png(1),
      antragstellerId: ANTRAGSTELLER,
      herkunft: 'UPLOAD',
    });
    expect(ergebnis.ok).toBe(false);
  });

  it('schreibt den Vorschlag ins Audit Log', async () => {
    await reicheEin('pog');
    const eintrag = await prisma.auditLog.findFirst({ where: { action: 'EMOJI_REQUESTED' } });
    expect(eintrag?.actorDiscordId).toBe(ANTRAGSTELLER);
    expect(eintrag?.module).toBe('emoji');
  });

  it('merkt sich nur die technische Herkunft', async () => {
    /*
     * Keine Rechteaussage. Was SwissHub weiss, ist «hochgeladen» oder «von
     * dieser Adresse geholt» - wem das Bild gehört, weiss es nicht.
     */
    const id = await reicheEin('pog');
    const antrag = await prisma.emojiAntrag.findUniqueOrThrow({ where: { id } });
    expect(antrag.herkunft).toBe('UPLOAD');
    expect(antrag.herkunftNotiz).toBe('test.png');
  });
});

describeWithDatabase('Emoji: entscheiden', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "EmojiStimme","EmojiAntrag","ModuleState","AuditLog" RESTART IDENTITY CASCADE',
    );
    clearRevisionCaches();
    await setModuleEnabled(emoji.EMOJI_MODULE_ID, true, 'test');
    await einstellungen();
    await raeumeMockEmojisAuf();
  });

  it('nimmt einen Vorschlag an und legt das Emoji auf dem Server ab', async () => {
    const id = await reicheEin('pog');

    const ergebnis = await emoji.nimmAn(id, MODERATOR);

    expect(ergebnis.ok, ergebnis.grund).toBe(true);
    expect(ergebnis.emojiId).toBeTruthy();
    const katalog = await discord.emojis.list();
    expect(katalog.some((eintrag) => eintrag.name === 'pog')).toBe(true);
  });

  it('räumt die Kopie weg, sobald das Emoji bei Discord liegt', async () => {
    const id = await reicheEin('pog');
    const vorher = await prisma.emojiAntrag.findUniqueOrThrow({ where: { id } });

    await emoji.nimmAn(id, MODERATOR);

    // Die Bytes liegen jetzt bei Discord - eine zweite Kopie wäre Speicher für
    // nichts. Der Eintrag bleibt und nennt die Emoji-Kennung.
    expect(await emoji.liesAb(vorher.dateiName)).toBeNull();
    const nachher = await prisma.emojiAntrag.findUniqueOrThrow({ where: { id } });
    expect(nachher.emojiId).toBeTruthy();
  });

  it('antwortet auf den zweiten Klick ruhig statt doppelt hochzuladen', async () => {
    const id = await reicheEin('pog');
    await emoji.nimmAn(id, MODERATOR);

    const zweiter = await emoji.nimmAn(id, MODERATOR);

    expect(zweiter.ok).toBe(false);
    expect(zweiter.grund).toContain('schon entschieden');
    const katalog = await discord.emojis.list();
    expect(katalog.filter((eintrag) => eintrag.name === 'pog')).toHaveLength(1);
  });

  it('lädt bei zwei gleichzeitigen Annahmen nur einmal hoch', async () => {
    /*
     * Zwei Moderatoren, derselbe Knopf, dieselbe Sekunde. Ohne den bedingten
     * Statuswechsel entstünden zwei Uploads - und der zweite scheiterte am
     * Namen, nachdem der erste schon lag.
     */
    const id = await reicheEin('pog');

    const [a, b] = await Promise.all([emoji.nimmAn(id, MODERATOR), emoji.nimmAn(id, ANTRAGSTELLER)]);

    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const katalog = await discord.emojis.list();
    expect(katalog.filter((eintrag) => eintrag.name === 'pog')).toHaveLength(1);
  });

  it('lehnt ab und behält den Grund', async () => {
    const id = await reicheEin('pog');

    await emoji.lehneAb(id, MODERATOR, 'Zu nah am bestehenden Logo.');

    const antrag = await prisma.emojiAntrag.findUniqueOrThrow({ where: { id } });
    expect(antrag.status).toBe('ABGELEHNT');
    // Der Grund geht an die Person, nicht ins Nichts.
    expect(antrag.ablehnungsGrund).toBe('Zu nah am bestehenden Logo.');
    expect(await prisma.auditLog.count({ where: { action: 'EMOJI_REQUEST_REJECTED' } })).toBe(1);
  });

  it('nimmt einen abgelehnten Vorschlag nicht nachträglich an', async () => {
    const id = await reicheEin('pog');
    await emoji.lehneAb(id, MODERATOR, null);

    const ergebnis = await emoji.nimmAn(id, MODERATOR);
    expect(ergebnis.ok).toBe(false);
  });

  it('rechnet feste und animierte Plätze getrennt', async () => {
    const vorher = await emoji.ladePlatzstand();
    const id = await reicheEin('animiert_test', gif(1));
    await emoji.nimmAn(id, MODERATOR);
    const nachher = await emoji.ladePlatzstand();

    // Ein animiertes Emoji belegt einen animierten Platz - und keinen festen.
    expect(nachher.animiert.belegt).toBe(vorher.animiert.belegt + 1);
    expect(nachher.fest.belegt).toBe(vorher.fest.belegt);
  });
});

describeWithDatabase('Emoji: die Abstimmung', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "EmojiStimme","EmojiAntrag","ModuleState","AuditLog" RESTART IDENTITY CASCADE',
    );
    clearRevisionCaches();
    await setModuleEnabled(emoji.EMOJI_MODULE_ID, true, 'test');
    await einstellungen();
    await raeumeMockEmojisAuf();
  });

  it('startet eine Abstimmung mit Ziel und Frist in der Zeile', async () => {
    const id = await reicheEin('pog');

    const ergebnis = await emoji.starteAbstimmung(id, MODERATOR);

    expect(ergebnis.ok, ergebnis.grund).toBe(true);
    const antrag = await prisma.emojiAntrag.findUniqueOrThrow({ where: { id } });
    expect(antrag.status).toBe('ABSTIMMUNG');
    expect(antrag.stimmenZiel).toBe(10);
    // Die Frist steht in der Datenbank, nicht in einem Timer: ein Neustart
    // verliert sie dadurch nicht.
    expect(antrag.abstimmungEndetAm).not.toBeNull();
  });

  it('friert Ziel und Frist beim Start ein', async () => {
    const id = await reicheEin('pog');
    await emoji.starteAbstimmung(id, MODERATOR);

    // Mitten in der Abstimmung das Ziel hochsetzen darf die laufende nicht
    // rückwirkend verändern.
    await einstellungen({ stimmenZiel: 50 });

    const stand = await emoji.abstimmungsStand(id);
    expect(stand?.ziel).toBe(10);
  });

  it('zählt jede Stimme einmal', async () => {
    await einstellungen({ stimmenZiel: 3 });
    const id = await reicheEin('pog');
    await emoji.starteAbstimmung(id, MODERATOR);

    expect((await emoji.stimmeAb(id, 'w1')).art).toBe('gezaehlt');
    const zweimal = await emoji.stimmeAb(id, 'w1');
    expect(zweimal.art).toBe('schon_gestimmt');
    expect(zweimal.stimmen).toBe(1);
  });

  it('nimmt den Vorschlag bei der Zielstimme an und lädt hoch', async () => {
    await einstellungen({ stimmenZiel: 3 });
    const id = await reicheEin('pog');
    await emoji.starteAbstimmung(id, MODERATOR);

    await emoji.stimmeAb(id, 'w1');
    await emoji.stimmeAb(id, 'w2');
    const letzte = await emoji.stimmeAb(id, 'w3');

    expect(letzte.art).toBe('ziel_erreicht');
    expect(letzte.emojiId).toBeTruthy();
    const katalog = await discord.emojis.list();
    expect(katalog.some((eintrag) => eintrag.name === 'pog')).toBe(true);
  });

  it('behandelt die Zielstimme auch bei gleichzeitigen Klicks atomar', async () => {
    /*
     * **Der Test, um den es geht.**
     *
     * Zehn Stimmen gleichzeitig. Ohne die Zeilensperre zählen zwei davon
     * beide zu wenig, weil keine die noch nicht festgeschriebene Stimme der
     * anderen sieht - das Ziel wird erreicht und löst nichts aus.
     *
     * Geprüft wird nicht «es ist angenommen», sondern «genau einer hat es
     * ausgelöst»: zwei Auslöser wären zwei Uploads.
     */
    await einstellungen({ stimmenZiel: 10 });

    /*
     * Nur die beiden letzten Stimmen laufen gleichzeitig - und das ist der
     * Punkt.
     *
     * Zehn Klicks auf einmal abzufeuern sieht nach dem härteren Test aus, ist
     * aber der schwächere: der Verbindungspool von Prisma lässt nur wenige
     * Transaktionen gleichzeitig zu, die übrigen warten, und die wartenden
     * sehen die festgeschriebenen Stimmen der vorigen. Das Rennen entscheidet
     * sich dann oft von selbst richtig - ein Test, der je nach Laune grün ist.
     *
     * Hier stehen acht Stimmen schon fest, und genau die neunte und die zehnte
     * starten zusammen. Ohne die Zeilensperre zählen beide acht plus die
     * eigene, also neun, und keine löst aus: der Vorschlag bleibt mit zehn
     * Stimmen offen stehen. Fünf Runden, weil auch zwei Aufrufe sich
     * theoretisch hintereinander einsortieren können.
     */
    for (const runde of [1, 2, 3, 4, 5]) {
      const id = await reicheEin(`rennen_${runde}`, png(100 + runde));
      await emoji.starteAbstimmung(id, MODERATOR);
      await prisma.emojiStimme.createMany({
        data: Array.from({ length: 8 }, (_, index) => ({
          antragId: id,
          discordId: `vorher-${runde}-${index}`,
        })),
      });

      const ergebnisse = await Promise.all([
        emoji.stimmeAb(id, `letzte-a-${runde}`),
        emoji.stimmeAb(id, `letzte-b-${runde}`),
      ]);

      const erreicht = ergebnisse.filter((ergebnis) => ergebnis.art === 'ziel_erreicht');
      expect(erreicht, `Runde ${runde}: genau ein Auslöser`).toHaveLength(1);
      expect(await prisma.emojiStimme.count({ where: { antragId: id } })).toBe(10);
      const antrag = await prisma.emojiAntrag.findUniqueOrThrow({ where: { id } });
      expect(antrag.status).toBe('ANGENOMMEN');
      const katalog = await discord.emojis.list();
      expect(katalog.filter((eintrag) => eintrag.name === `rennen_${runde}`)).toHaveLength(1);
    }
  });

  it('nimmt keine Stimme mehr an, wenn die Frist um ist', async () => {
    await einstellungen({ stimmenZiel: 3 });
    const id = await reicheEin('pog');
    await emoji.starteAbstimmung(id, MODERATOR);
    // Die Frist zurückdatieren: so sieht die Lage aus, bevor der Job vorbeikommt.
    await prisma.emojiAntrag.update({
      where: { id },
      data: { abstimmungEndetAm: new Date(Date.now() - 1000) },
    });

    const ergebnis = await emoji.stimmeAb(id, 'w1');

    expect(ergebnis.art).toBe('abgelaufen');
    expect(await prisma.emojiStimme.count({ where: { antragId: id } })).toBe(0);
  });

  it('beendet eine abgelaufene Abstimmung ohne genug Stimmen - und lehnt sie nicht ab', async () => {
    await einstellungen({ stimmenZiel: 10 });
    const id = await reicheEin('pog');
    await emoji.starteAbstimmung(id, MODERATOR);
    await emoji.stimmeAb(id, 'w1');
    await prisma.emojiAntrag.update({
      where: { id },
      data: { abstimmungEndetAm: new Date(Date.now() - 1000) },
    });

    const bericht = await emoji.lasseAbstimmungenAblaufen();

    expect(bericht.abgelaufen).toBe(1);
    const antrag = await prisma.emojiAntrag.findUniqueOrThrow({ where: { id } });
    // «Abgelaufen» ist keine Ablehnung: niemand hat etwas entschieden.
    expect(antrag.status).toBe('ABGELAUFEN');
    expect(antrag.ablehnungsGrund).toBeNull();
    const eintrag = await prisma.auditLog.findFirst({ where: { action: 'EMOJI_VOTE_EXPIRED' } });
    expect((eintrag?.metadata as { stimmen?: number }).stimmen).toBe(1);
  });

  it('nimmt beim Ablauf an, wenn das Ziel doch erreicht war', async () => {
    /*
     * Der seltene Fall: die letzte Stimme kam an, der Upload scheiterte an
     * einem Discord-Ausfall, der Vorschlag ging zurück auf OFFEN. Jetzt steht
     * er mit erreichtem Ziel da - ihn als «abgelaufen» zu schliessen wäre die
     * falsche Auskunft.
     */
    await einstellungen({ stimmenZiel: 2 });
    const id = await reicheEin('pog');
    await emoji.starteAbstimmung(id, MODERATOR);
    await prisma.emojiStimme.createMany({
      data: [
        { antragId: id, discordId: 'w1' },
        { antragId: id, discordId: 'w2' },
      ],
    });
    await prisma.emojiAntrag.update({
      where: { id },
      data: { abstimmungEndetAm: new Date(Date.now() - 1000) },
    });

    const bericht = await emoji.lasseAbstimmungenAblaufen();

    expect(bericht.nachtraeglichAngenommen).toBe(1);
    expect(bericht.abgelaufen).toBe(0);
    const antrag = await prisma.emojiAntrag.findUniqueOrThrow({ where: { id } });
    expect(antrag.status).toBe('ANGENOMMEN');
    expect(antrag.emojiId).toBeTruthy();
  });

  it('lässt sich nach einer abgelaufenen Abstimmung noch entscheiden', async () => {
    await einstellungen({ stimmenZiel: 10 });
    const id = await reicheEin('pog');
    await emoji.starteAbstimmung(id, MODERATOR);
    await prisma.emojiAntrag.update({
      where: { id },
      data: { abstimmungEndetAm: new Date(Date.now() - 1000) },
    });
    await emoji.lasseAbstimmungenAblaufen();

    /*
     * Eine Abstimmung ohne Ergebnis darf das Team nicht einsperren. Dass
     * `nimmAn` hier ablehnt, ist Absicht - der Vorschlag ist nicht mehr
     * `OFFEN`. Was zählt: er ist auffindbar und sein Zustand erklärbar.
     */
    const antrag = await prisma.emojiAntrag.findUniqueOrThrow({ where: { id } });
    expect(antrag.status).toBe('ABGELAUFEN');
    expect(antrag.entschiedenVon).toBeNull();
  });

  it('nimmt keine Stimme an, solange die Abstimmung ausgeschaltet ist', async () => {
    await einstellungen({ stimmenZiel: 3 });
    const id = await reicheEin('pog');
    await emoji.starteAbstimmung(id, MODERATOR);
    await einstellungen({ abstimmungAktiv: false, stimmenZiel: 3 });

    expect((await emoji.stimmeAb(id, 'w1')).art).toBe('ausgeschaltet');
  });

  it('lehnt Stimmen auf einen Vorschlag ohne Abstimmung ab', async () => {
    const id = await reicheEin('pog');
    expect((await emoji.stimmeAb(id, 'w1')).art).toBe('nicht_offen');
  });
});

describeWithDatabase('Emoji: der Bereich', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "EmojiStimme","EmojiAntrag","ModuleState","AuditLog" RESTART IDENTITY CASCADE',
    );
    clearRevisionCaches();
    await setModuleEnabled(emoji.EMOJI_MODULE_ID, true, 'test');
    await einstellungen();
    await raeumeMockEmojisAuf();
  });

  it('sortiert die Vorschläge nach ihrem Zustand', async () => {
    const offen = await reicheEin('offen_eins', png(21));
    const inAbstimmung = await reicheEin('abstimmung_eins', png(22));
    const abgelehnt = await reicheEin('abgelehnt_eins', png(23));
    await emoji.starteAbstimmung(inAbstimmung, MODERATOR);
    await emoji.lehneAb(abgelehnt, MODERATOR, null);

    const bereich = await emoji.ladeBereich();

    expect(bereich.offene.map((antrag) => antrag.id)).toEqual([offen]);
    expect(bereich.abstimmungen.map((antrag) => antrag.id)).toEqual([inAbstimmung]);
    expect(bereich.entschieden.map((antrag) => antrag.id)).toEqual([abgelehnt]);
  });

  it('nennt den Verlauf aus dem zentralen Audit Log', async () => {
    // Kein zweiter Verlauf daneben - derselbe, nur gefiltert.
    await reicheEin('pog');
    const bereich = await emoji.ladeBereich();
    expect(bereich.verlauf.some((eintrag) => eintrag.action === 'EMOJI_REQUESTED')).toBe(true);
  });

  it('meldet, was in der Einrichtung fehlt', async () => {
    const bereich = await emoji.ladeBereich();
    // Vorschläge sind an, aber kein Moderationskanal gesetzt: das funktioniert
    // und ist trotzdem einen Hinweis wert.
    expect(bereich.einrichtung.ohneModerationskanal).toBe(true);
    expect(bereich.einrichtung.erlaubteHosts).toEqual(['cdn.discordapp.com']);
  });

  it('meldet einen ausgeschalteten Import als solchen', async () => {
    await einstellungen({ erlaubteHosts: '' });
    const bereich = await emoji.ladeBereich();
    expect(bereich.einrichtung.ohneImport).toBe(true);
  });

  it('sagt, dass ein angenommener Vorschlag kein Vorschaubild mehr hat', async () => {
    const id = await reicheEin('pog');
    await emoji.nimmAn(id, MODERATOR);

    const bereich = await emoji.ladeBereich();
    const antrag = bereich.entschieden.find((eintrag) => eintrag.id === id);
    // Sonst fordert die Oberfläche ein Bild an, das aufgeräumt wurde, und
    // zeigt ein kaputtes.
    expect(antrag?.bildVerfuegbar).toBe(false);
    expect(antrag?.emojiName).toBe('pog');
  });

  it('findet die eigenen Vorschläge eines Mitglieds', async () => {
    await reicheEin('pog', png(31));
    const eigene = await emoji.ladeEigeneAntraege(ANTRAGSTELLER);
    expect(eigene).toHaveLength(1);
    expect(await emoji.ladeEigeneAntraege(MODERATOR)).toHaveLength(0);
  });
});

describeWithDatabase('Emoji: die Meldungen auf Discord', () => {
  /**
   * Die Moderationsmeldung wird bearbeitet, nicht neu gesendet.
   *
   * Sonst wächst der Kanal mit jedem Statuswechsel um eine Nachricht, und am
   * Ende weiss niemand, welche die aktuelle ist - bei einem Vorschlag, der
   * durch Abstimmung, Annahme und Aufräumen geht, sind das vier.
   */
  /** Ein Zugang, der festhält, was gesendet und was bearbeitet wurde. */
  function attrappe(options: { editScheitert?: boolean; sendScheitert?: boolean } = {}) {
    const gesendet: Array<{ channelId: string }> = [];
    const bearbeitet: Array<{ channelId: string; messageId: string }> = [];
    const gateway = {
      channels: {
        send: async (channelId: string) => {
          if (options.sendScheitert) {
            throw new Error('Missing Permissions');
          }
          gesendet.push({ channelId });
          return { id: `m-${gesendet.length}`, channelId };
        },
        edit: async (channelId: string, messageId: string) => {
          if (options.editScheitert) {
            throw new Error('Unknown Message');
          }
          bearbeitet.push({ channelId, messageId });
        },
      },
    };
    return { gateway, gesendet, bearbeitet };
  }

  const MOD_KANAL = '900000000000007001';

  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "EmojiStimme","EmojiAntrag","ModuleState","AuditLog" RESTART IDENTITY CASCADE',
    );
    clearRevisionCaches();
    /*
     * Der globale Zugang bleibt der Mock.
     *
     * Die Attrappe unten kennt nur `channels` - sie ersetzt den ganzen Zugang
     * nicht, sondern wird den Melde-Funktionen als `gateway` mitgegeben.
     * Andernfalls scheiterte schon das Einreichen an `discord.emojis.list()`,
     * und der Test prüfte dann einen Fehler, den er selbst gebaut hat.
     */
    await raeumeMockEmojisAuf();
    await setModuleEnabled(emoji.EMOJI_MODULE_ID, true, 'test');
    await setModuleSettings(
      emoji.EMOJI_MODULE_ID,
      {
        antraegeAktiv: true,
        moderationChannelId: MOD_KANAL,
        abstimmungAktiv: true,
        abstimmungChannelId: '',
        stimmenZiel: 10,
        abstimmungMinuten: 10,
        maxOffeneJeMitglied: 3,
        erlaubteHosts: 'cdn.discordapp.com',
        reservePlaetze: 0,
      },
      'test',
    );
    clearRevisionCaches();
  });

  it('sendet die Meldung einmal und bearbeitet sie danach', async () => {
    const id = await reicheEin('pog', png(41));
    const discord = attrappe();

    await emoji.schreibeModerationsmeldung(id, { gateway: discord.gateway as never });
    await emoji.schreibeModerationsmeldung(id, { gateway: discord.gateway as never });
    await emoji.schreibeModerationsmeldung(id, { gateway: discord.gateway as never });

    expect(discord.gesendet).toHaveLength(1);
    expect(discord.bearbeitet).toHaveLength(2);
    expect(discord.bearbeitet[0]?.channelId).toBe(MOD_KANAL);
  });

  it('merkt sich Kanal und Nachricht, damit der Neustart sie wiederfindet', async () => {
    const id = await reicheEin('pog', png(42));
    const discord = attrappe();

    await emoji.schreibeModerationsmeldung(id, { gateway: discord.gateway as never });

    const antrag = await prisma.emojiAntrag.findUniqueOrThrow({ where: { id } });
    expect(antrag.modChannelId).toBe(MOD_KANAL);
    expect(antrag.modMessageId).toBeTruthy();
  });

  it('sendet neu, wenn jemand die Meldung gelöscht hat', async () => {
    const id = await reicheEin('pog', png(43));
    await emoji.schreibeModerationsmeldung(id, { gateway: attrappe().gateway as never });

    // Die Nachricht ist weg - die Moderation braucht den Fall aber.
    const kaputt = attrappe({ editScheitert: true });
    await emoji.schreibeModerationsmeldung(id, { gateway: kaputt.gateway as never });

    expect(kaputt.gesendet).toHaveLength(1);
  });

  it('legt mit «nurAktualisieren» niemals nach', async () => {
    /*
     * Der Fall ist abgeschlossen, und was mit ihm geschah, steht im Verlauf.
     * Eine neue Meldung wäre eine Arbeitsanweisung für etwas, das niemand mehr
     * bearbeiten kann.
     */
    const id = await reicheEin('pog', png(44));
    await emoji.schreibeModerationsmeldung(id, { gateway: attrappe().gateway as never });

    const kaputt = attrappe({ editScheitert: true });
    await emoji.schreibeModerationsmeldung(id, {
      gateway: kaputt.gateway as never,
      nurAktualisieren: true,
    });

    expect(kaputt.gesendet).toEqual([]);
  });

  it('legt mit «nurAktualisieren» auch ohne bestehende Meldung nichts an', async () => {
    const id = await reicheEin('pog', png(45));
    const discord = attrappe();

    await emoji.schreibeModerationsmeldung(id, {
      gateway: discord.gateway as never,
      nurAktualisieren: true,
    });

    expect(discord.gesendet).toEqual([]);
    expect(discord.bearbeitet).toEqual([]);
  });

  it('verliert den Vorschlag nicht, wenn die Meldung scheitert', async () => {
    /*
     * Ein falsch gesetzter Kanal oder ein fehlendes Schreibrecht darf keine
     * Einreichung kosten: im Dashboard ist sie sichtbar, und dort kann das Team
     * sie bearbeiten.
     */
    const id = await reicheEin('pog', png(46));
    const kaputt = attrappe({ sendScheitert: true });

    await expect(
      emoji.schreibeModerationsmeldung(id, { gateway: kaputt.gateway as never }),
    ).resolves.toBeUndefined();

    const antrag = await prisma.emojiAntrag.findUniqueOrThrow({ where: { id } });
    expect(antrag.status).toBe('OFFEN');
    expect(antrag.modMessageId).toBeNull();
  });

  it('schreibt nichts, solange kein Moderationskanal gesetzt ist', async () => {
    await setModuleSettings(
      emoji.EMOJI_MODULE_ID,
      {
        antraegeAktiv: true,
        moderationChannelId: '',
        abstimmungAktiv: true,
        abstimmungChannelId: '',
        stimmenZiel: 10,
        abstimmungMinuten: 10,
        maxOffeneJeMitglied: 3,
        erlaubteHosts: 'cdn.discordapp.com',
        reservePlaetze: 0,
      },
      'test',
    );
    clearRevisionCaches();
    const id = await reicheEin('pog', png(47));
    const discord = attrappe();

    await emoji.schreibeModerationsmeldung(id, { gateway: discord.gateway as never });

    expect(discord.gesendet).toEqual([]);
  });

  it('stellt eine Abstimmung nach einer gelöschten Nachricht nicht zweimal', async () => {
    /*
     * Denselben Vorschlag zweimal zur Wahl zu bringen - mit einem Stimmenstand,
     * der schon läuft - wäre schlimmer als eine fehlende Nachricht. Der Stand
     * steht weiter im Dashboard.
     */
    await setModuleSettings(
      emoji.EMOJI_MODULE_ID,
      {
        antraegeAktiv: true,
        moderationChannelId: MOD_KANAL,
        abstimmungAktiv: true,
        abstimmungChannelId: '900000000000007002',
        stimmenZiel: 10,
        abstimmungMinuten: 10,
        maxOffeneJeMitglied: 3,
        erlaubteHosts: 'cdn.discordapp.com',
        reservePlaetze: 0,
      },
      'test',
    );
    clearRevisionCaches();
    const id = await reicheEin('pog', png(48));
    await emoji.starteAbstimmung(id, MODERATOR);
    await emoji.schreibeAbstimmungsnachricht(id, { gateway: attrappe().gateway as never });

    const kaputt = attrappe({ editScheitert: true });
    await emoji.schreibeAbstimmungsnachricht(id, { gateway: kaputt.gateway as never });

    expect(kaputt.gesendet).toEqual([]);
  });
});

describeWithDatabase('Emoji: direkt zur Abstimmung', () => {
  /**
   * Der Weg von `/emoji_vote`.
   *
   * Einreichen und Abstimmung starten in einem Zug - und zwar von einem
   * Mitglied, nicht vom Team. Was dabei trotzdem gilt: alle Pruefungen von
   * `reicheEin`. Die Abstimmung ersetzt die Entscheidung, nicht die Schranken.
   */
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "EmojiStimme","EmojiAntrag","ModuleState","AuditLog" RESTART IDENTITY CASCADE',
    );
    clearRevisionCaches();
    await raeumeMockEmojisAuf();
    await setModuleEnabled(emoji.EMOJI_MODULE_ID, true, 'test');
    await einstellungen({ stimmenZiel: 3, abstimmungMinuten: 10 });
  });

  const vorschlag = (name: string, bytes = png(61)) => ({
    name,
    bytes,
    antragstellerId: ANTRAGSTELLER,
    herkunft: 'IMPORT' as const,
    herkunftNotiz: 'Discord-Emoji 123456789012345678 (:pog:)',
  });

  it('legt den Vorschlag an und stellt ihn sofort zur Abstimmung', async () => {
    const ergebnis = await emoji.reicheEinUndStelleZurAbstimmung(vorschlag('pog'));

    expect(ergebnis.ok, ergebnis.grund).toBe(true);
    expect(ergebnis.antrag?.status).toBe('ABSTIMMUNG');
    expect(ergebnis.ziel).toBe(3);
    expect(ergebnis.minuten).toBe(10);
    // Die Frist steht in der Zeile, nicht in einem Timer.
    expect(ergebnis.antrag?.abstimmungEndetAm).not.toBeNull();
  });

  it('bringt das Emoji auf den Server, sobald das Ziel erreicht ist', async () => {
    const ergebnis = await emoji.reicheEinUndStelleZurAbstimmung(vorschlag('pog', png(62)));
    const id = ergebnis.antrag?.id ?? '';

    await emoji.stimmeAb(id, 'w1');
    await emoji.stimmeAb(id, 'w2');
    const letzte = await emoji.stimmeAb(id, 'w3');

    expect(letzte.art).toBe('ziel_erreicht');
    const katalog = await discord.emojis.list();
    expect(katalog.some((eintrag) => eintrag.name === 'pog')).toBe(true);
  });

  it('haelt die Pruefungen von reicheEin ein', async () => {
    // Ein unmoeglicher Name darf auch auf diesem Weg nicht durch.
    const schlecht = await emoji.reicheEinUndStelleZurAbstimmung(vorschlag('mein emoji', png(63)));
    expect(schlecht.ok).toBe(false);
    expect(await prisma.emojiAntrag.count()).toBe(0);

    // Und die Grenze offener Vorschlaege je Mitglied gilt ebenso.
    await einstellungen({ stimmenZiel: 3, maxOffeneJeMitglied: 1 });
    await emoji.reicheEinUndStelleZurAbstimmung(vorschlag('eins', png(64)));
    const zweiter = await emoji.reicheEinUndStelleZurAbstimmung(vorschlag('zwei', png(65)));
    expect(zweiter.ok).toBe(false);
  });

  it('laesst den Vorschlag stehen, wenn die Abstimmung aus ist', async () => {
    await einstellungen({ abstimmungAktiv: false });
    const ergebnis = await emoji.reicheEinUndStelleZurAbstimmung(vorschlag('pog', png(66)));

    expect(ergebnis.ok).toBe(false);
    /*
     * Und zwar **bevor** etwas angelegt wird: die Pruefung steht vor dem
     * Einreichen. Ein Vorschlag, der ohne Abstimmung liegenbleibt, waere hier
     * nicht falsch - aber er waere eine Ueberraschung.
     */
    expect(await prisma.emojiAntrag.count()).toBe(0);
  });

  it('merkt sich die Herkunft als Kennung, nicht als Rechteaussage', async () => {
    const ergebnis = await emoji.reicheEinUndStelleZurAbstimmung(vorschlag('pog', png(67)));
    const antrag = await prisma.emojiAntrag.findUniqueOrThrow({
      where: { id: ergebnis.antrag?.id ?? '' },
    });

    expect(antrag.herkunft).toBe('IMPORT');
    expect(antrag.herkunftNotiz).toContain('123456789012345678');
    for (const wort of ['Copyright', 'Urheber', 'Lizenz', 'Eigentum']) {
      expect(antrag.herkunftNotiz ?? '', wort).not.toContain(wort);
    }
  });
});
