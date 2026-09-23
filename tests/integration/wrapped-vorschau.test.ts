import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_wrapped_vorschau');

/**
 * Die Vorschau darf nichts hinterlassen.
 *
 * ## Warum das eine eigene Datei wert ist
 *
 * Im Studio lässt sich der Rückblick einer **echten Person** ansehen, bevor
 * irgendetwas veröffentlicht ist. Das ist nur vertretbar, solange dabei für
 * diese Person nichts geschieht: keine Momentaufnahme, kein XP, keine
 * Benachrichtigung, kein Discord-Beitrag, kein Vermerk «hat seinen Rückblick
 * gesehen», kein Achievement.
 *
 * Ein Kommentar über dem Code ist dafür keine Zusage, sondern eine
 * Behauptung. Diese Datei macht daraus eine Prüfung: sie zählt **vorher und
 * nachher** die Zeilen jeder Tabelle, in die etwas geraten könnte, und
 * besteht nur, wenn keine einzige dazugekommen ist.
 *
 * ## Warum die Zeilenzahl und nicht ein Spion auf der Prisma-Ebene
 *
 * Weil ein Spion nur das sieht, was er kennt. Ein neuer Seitenweg - etwa
 * über rohes SQL - liefe daran vorbei. Die Zeilenzahl sieht das Ergebnis,
 * unabhängig vom Weg dorthin.
 *
 * ## Und wenn jemand eine Tabelle vergisst?
 *
 * Gezählt wird nicht aus einer gepflegten Liste, sondern aus dem
 * Katalog von PostgreSQL: jede Tabelle im Schema. Eine neue Tabelle ist
 * damit automatisch mitgeprüft.
 */
const { prisma } = await import('@swisshub/database');
const { wrapped } = await import('@swisshub/modules');

const GUILD = '000000000000000001';
const ANNA = '100000000000000001';
const BEN = '100000000000000002';

async function leeren(): Promise<void> {
  await prisma.analyticsVoiceSegment.deleteMany({});
  await prisma.analyticsUserDaily.deleteMany({});
  await prisma.analyticsMemberProfile.deleteMany({});
  await prisma.wrappedView.deleteMany({});
  await prisma.wrappedSnapshot.deleteMany({});
  await prisma.wrappedScene.deleteMany({});
  await prisma.wrappedGenerationRun.deleteMany({});
  await prisma.wrappedCampaign.deleteMany({});
}

/** Die Zeilenzahl jeder Tabelle des Schemas - als Abdruck des Zustands. */
async function abdruck(): Promise<Record<string, number>> {
  const tabellen = await prisma.$queryRaw<Array<{ name: string }>>`
    SELECT c.relname AS "name"
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind = 'r'
       AND n.nspname = current_schema()
     ORDER BY c.relname
  `;

  const zaehlung: Record<string, number> = {};
  for (const tabelle of tabellen) {
    /*
     * Der Name kommt aus dem Systemkatalog, nicht aus einer Eingabe - und
     * wird trotzdem in Anfuehrungszeichen gesetzt. Prisma kennt fuer
     * Bezeichner keine Platzhalter; die Regel «kein Bezeichner ohne
     * Anfuehrungszeichen» soll auch dort gelten, wo sie gerade nicht
     * gebraucht wird.
     */
    const name = tabelle.name.replaceAll('"', '""');
    const [zeile] = await prisma.$queryRawUnsafe<Array<{ anzahl: bigint }>>(
      `SELECT COUNT(*)::bigint AS "anzahl" FROM "${name}"`,
    );
    zaehlung[tabelle.name] = Number(zeile?.anzahl ?? 0);
  }
  return zaehlung;
}

async function personMitJahr(discordId: string, name: string): Promise<void> {
  await prisma.analyticsMemberProfile.create({
    data: { guildId: GUILD, discordId, username: name.toLowerCase(), displayName: name, isBot: false },
  });

  const tage = Array.from({ length: 120 }, (_, index) => ({
    guildId: GUILD,
    discordId,
    day: new Date(Date.UTC(2026, 0, 1 + index * 2)),
    messages: 12 + (index % 9),
    voiceSeconds: 2400 + (index % 5) * 600,
    voiceSessions: 1,
  }));
  await prisma.analyticsUserDaily.createMany({ data: tage });

  const abschnitte = Array.from({ length: 40 }, (_, index) => {
    const von = new Date(Date.UTC(2026, 0, 2 + index * 4, 20, 0, 0));
    return {
      guildId: GUILD,
      sessionId: `${discordId}-${index}`,
      discordId,
      channelId: '400000000000000001',
      channelName: 'Gaming 1',
      joinedAt: von,
      leftAt: new Date(von.getTime() + 2 * 3600_000),
      seconds: 7200,
      isAfk: false,
      isBot: false,
    };
  });
  await prisma.analyticsVoiceSegment.createMany({ data: abschnitte });
}

async function kampagne(): Promise<Awaited<ReturnType<typeof prisma.wrappedCampaign.create>>> {
  return prisma.wrappedCampaign.create({
    data: {
      guildId: GUILD,
      key: '2026',
      title: 'SwissHub Wrapped 2026',
      displayYear: 2026,
      periodStart: new Date(Date.UTC(2026, 0, 1)),
      periodEnd: new Date(Date.UTC(2027, 0, 1)),
      scenes: {
        create: wrapped.WRAPPED_SZENEN.map((szene) => ({
          sceneKey: szene.key,
          enabled: szene.standardAktiv,
          position: szene.position,
        })),
      },
    },
  });
}

describeWithDatabase('Wrapped: Vorschau ist folgenlos', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await leeren();
  });

  it('verändert keine einzige Zeile - bei einer echten Person', async () => {
    const { baueVorschau } = await import('../../apps/web/src/server/wrapped-vorschau');
    await personMitJahr(ANNA, 'Anna');
    await personMitJahr(BEN, 'Ben');
    const campaign = await kampagne();

    const vorher = await abdruck();
    const ergebnis = await baueVorschau(campaign, { quelle: 'person', discordId: ANNA });
    const nachher = await abdruck();

    // Die Vorschau hat tatsächlich etwas gerechnet - sonst prüfte der
    // Vergleich unten nur, dass nichts passiert, wenn nichts passiert.
    expect(ergebnis.daten.messages.total).toBeGreaterThan(0);
    expect(ergebnis.sceneKeys.length).toBeGreaterThan(2);
    expect(ergebnis.herkunft).toBe('live');

    expect(nachher).toEqual(vorher);
  });

  it('legt insbesondere keine Momentaufnahme und keinen Ansichtsvermerk an', async () => {
    const { baueVorschau } = await import('../../apps/web/src/server/wrapped-vorschau');
    await personMitJahr(ANNA, 'Anna');
    const campaign = await kampagne();

    await baueVorschau(campaign, { quelle: 'person', discordId: ANNA });

    /*
     * Diese beiden Zahlen stehen zusaetzlich zur allgemeinen Pruefung oben.
     *
     * Der Zeilenvergleich faengt sie mit ab - aber wenn er eines Tages
     * scheitert, soll aus der Meldung sofort hervorgehen, ob es um genau
     * diese zwei Tabellen geht. Sie sind der Kern der Zusage.
     */
    expect(await prisma.wrappedSnapshot.count()).toBe(0);
    expect(await prisma.wrappedView.count()).toBe(0);
  });

  it('verändert nichts - auch mit erfundenen Zahlen', async () => {
    const { baueVorschau } = await import('../../apps/web/src/server/wrapped-vorschau');
    const campaign = await kampagne();

    const vorher = await abdruck();
    const ergebnis = await baueVorschau(campaign, {
      quelle: 'fixture',
      persona: 'allrounder',
      ueberschreibung: { voiceSeconds: 999 * 3600, messages: 999_999 },
    });
    const nachher = await abdruck();

    expect(ergebnis.herkunft).toBe('fixture');
    expect(ergebnis.daten.messages.total).toBe(999_999);
    expect(nachher).toEqual(vorher);
  });

  it('erzeugt dieselbe Geschichte wie die spätere Momentaufnahme', async () => {
    /*
     * Der Kern des Nutzens: wer in der Vorschau etwas abnimmt, soll genau
     * das bekommen. Waere die Vorschau ein zweiter Rechenweg, koennte sie
     * beliebig abweichen - und die Abnahme waere wertlos.
     */
    const { baueVorschau } = await import('../../apps/web/src/server/wrapped-vorschau');
    await personMitJahr(ANNA, 'Anna');
    const campaign = await kampagne();

    const vorschau = await baueVorschau(campaign, { quelle: 'person', discordId: ANNA });

    await wrapped.starteDurchgang(campaign.id, { discordId: '900000000000000001' });
    let weiter = true;
    while (weiter) {
      const lauf = await prisma.wrappedGenerationRun.findFirst({ where: { campaignId: campaign.id } });
      const antwort = await wrapped.verarbeiteStapel(lauf!.id);
      weiter = antwort.weiter;
    }

    const momentaufnahme = await prisma.wrappedSnapshot.findUnique({
      where: { campaignId_discordId: { campaignId: campaign.id, discordId: ANNA } },
    });

    expect(momentaufnahme).not.toBeNull();
    expect(momentaufnahme?.sceneKeys).toEqual(vorschau.sceneKeys);
    expect(momentaufnahme?.archetype).toBe(vorschau.daten.archetyp.key);

    const gespeichert = momentaufnahme?.data as unknown as typeof vorschau.daten;
    expect(gespeichert.voice.seconds).toBe(vorschau.daten.voice.seconds);
    expect(gespeichert.messages.total).toBe(vorschau.daten.messages.total);
    expect(gespeichert.aktivitaet.activeDays).toBe(vorschau.daten.aktivitaet.activeDays);
  });

  it('weist eine Testperson zurück, die es nicht gibt', async () => {
    const { baueVorschau } = await import('../../apps/web/src/server/wrapped-vorschau');
    const campaign = await kampagne();

    await expect(baueVorschau(campaign, { quelle: 'fixture', persona: 'gibtsnicht' })).rejects.toThrow();
    await expect(baueVorschau(campaign, { quelle: 'person', discordId: '' })).rejects.toThrow();
  });
});
