import { beforeAll, beforeEach, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_fragt_stimmen_detail');

/**
 * Wer für welche Antwort gestimmt hat - und wer das sehen darf.
 *
 * ## Die zwei Seiten derselben Sache
 *
 * Berechtigte Teammitglieder sollen die einzelnen Stimmen sehen. Alle
 * anderen sollen sie **nicht** sehen, und zwar nicht «nicht angezeigt
 * bekommen», sondern gar nicht erst geliefert bekommen.
 *
 * Die zweite Hälfte ist die, die leicht verloren geht: es genügt, dass
 * irgendeine Abfrage `voterDiscordId` mitnimmt, damit die Kennungen im HTML
 * jeder Seite stehen, die sie aufruft. Der letzte Test dieser Datei liest
 * deshalb den Quelltext des Moduls und hält fest, welche Stellen das Feld
 * überhaupt anfassen dürfen.
 */
const { prisma } = await import('@swisshub/database');
const { fragt } = await import('@swisshub/modules');

const GUILD = '100000000000000001';
const KANAL = '910000000000000001';

const mitglied = (n: number) => `93000000000000${String(n).padStart(4, '0')}`;

/** Eine offene Abstimmung mit zwei Antwortmoeglichkeiten. */
async function abstimmung() {
  const frage = await prisma.fragtFrage.create({
    data: {
      guildId: GUILD,
      text: 'Was spielen wir am Freitag?',
      typ: 'UMFRAGE',
      kategorie: 'Gaming',
      optionen: {
        create: [
          { label: 'Minecraft', position: 0 },
          { label: 'Valheim', position: 1 },
        ],
      },
    },
    include: { optionen: { orderBy: { position: 'asc' } } },
  });

  const lauf = await prisma.fragtAbstimmung.create({
    data: {
      guildId: GUILD,
      frageId: frage.id,
      frageText: frage.text,
      typ: frage.typ,
      channelId: KANAL,
      opensAt: new Date(Date.now() - 3600_000),
      closesAt: new Date(Date.now() + 3600_000),
    },
  });

  return { frage, lauf, optionen: frage.optionen };
}

describeWithDatabase('SwissHub fragt: Stimmen im Detail', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "FragtStimme","FragtEntwurf","FragtAbstimmung","FragtOption","FragtFrage","DiscordMemberCache","AuditLog" RESTART IDENTITY CASCADE',
    );
  });

  it('liefert je Stimme Mitglied, Antwort und Zeitpunkt', async () => {
    const { lauf, optionen } = await abstimmung();
    await prisma.discordMemberCache.create({
      data: {
        discordId: mitglied(1),
        username: 'anna',
        displayName: 'Anna',
        searchText: 'anna',
      },
    });
    await prisma.fragtStimme.create({
      data: { abstimmungId: lauf.id, optionId: optionen[0]!.id, voterDiscordId: mitglied(1) },
    });

    const detail = await fragt.ladeStimmenDetail(lauf.id);
    expect(detail.zeilen).toHaveLength(1);
    expect(detail.zeilen[0]).toMatchObject({
      discordId: mitglied(1),
      name: 'Anna',
      antwort: 'Minecraft',
      geaendert: false,
    });
    expect(detail.zeilen[0]!.abgegebenAm).toBeInstanceOf(Date);
  });

  it('zählt je Antwort dieselbe Zahl wie das aggregierte Ergebnis', async () => {
    const { lauf, optionen } = await abstimmung();
    for (const n of [1, 2, 3]) {
      await prisma.fragtStimme.create({
        data: { abstimmungId: lauf.id, optionId: optionen[0]!.id, voterDiscordId: mitglied(n) },
      });
    }
    await prisma.fragtStimme.create({
      data: { abstimmungId: lauf.id, optionId: optionen[1]!.id, voterDiscordId: mitglied(4) },
    });

    const detail = await fragt.ladeStimmenDetail(lauf.id);
    expect(detail.proAntwort).toEqual([
      { optionId: optionen[0]!.id, antwort: 'Minecraft', position: 0, stimmen: 3 },
      { optionId: optionen[1]!.id, antwort: 'Valheim', position: 1, stimmen: 1 },
    ]);

    // Und dieselbe Zahl kommt aus der oeffentlichen Auszaehlung.
    const oeffentlich = await fragt.ladeAbstimmung(lauf.id);
    expect(oeffentlich?.ergebnis?.gesamt).toBe(4);
  });

  it('filtert nach Antwort, ohne die Zahlen zu verändern', async () => {
    /*
     * Sonst zeigte der Filter «Valheim» eine Abstimmung mit einer Stimme,
     * und jemand laese daraus ein Ergebnis, das es nicht gibt.
     */
    const { lauf, optionen } = await abstimmung();
    await prisma.fragtStimme.create({
      data: { abstimmungId: lauf.id, optionId: optionen[0]!.id, voterDiscordId: mitglied(1) },
    });
    await prisma.fragtStimme.create({
      data: { abstimmungId: lauf.id, optionId: optionen[1]!.id, voterDiscordId: mitglied(2) },
    });

    const gefiltert = await fragt.ladeStimmenDetail(lauf.id, { optionId: optionen[1]!.id });
    expect(gefiltert.zeilen).toHaveLength(1);
    expect(gefiltert.zeilen[0]!.antwort).toBe('Valheim');
    // Die Zahlen bleiben die der ganzen Abstimmung.
    expect(gefiltert.proAntwort.find((e) => e.antwort === 'Minecraft')?.stimmen).toBe(1);
  });

  it('sucht nach Name und Kennung', async () => {
    const { lauf, optionen } = await abstimmung();
    await prisma.discordMemberCache.create({
      data: { discordId: mitglied(1), username: 'anna', displayName: 'Anna', searchText: 'anna' },
    });
    await prisma.discordMemberCache.create({
      data: { discordId: mitglied(2), username: 'beat', displayName: 'Beat', searchText: 'beat' },
    });
    for (const n of [1, 2]) {
      await prisma.fragtStimme.create({
        data: { abstimmungId: lauf.id, optionId: optionen[0]!.id, voterDiscordId: mitglied(n) },
      });
    }

    expect((await fragt.ladeStimmenDetail(lauf.id, { suche: 'anna' })).zeilen).toHaveLength(1);
    expect((await fragt.ladeStimmenDetail(lauf.id, { suche: mitglied(2) })).zeilen).toHaveLength(1);
    expect((await fragt.ladeStimmenDetail(lauf.id, { suche: 'niemand' })).zeilen).toHaveLength(0);
  });

  it('stellt ein nicht mehr vorhandenes Mitglied sinnvoll dar', async () => {
    /*
     * Ausgetreten oder gebannt. Die Stimme bleibt gezaehlt - sie wurde
     * abgegeben, und eine Auswertung, aus der Stimmen verschwinden, sobald
     * jemand geht, waere keine. Was bleibt, ist die Kennung; einen Namen zu
     * erfinden waere schlimmer als keiner.
     */
    const { lauf, optionen } = await abstimmung();
    await prisma.fragtStimme.create({
      data: { abstimmungId: lauf.id, optionId: optionen[0]!.id, voterDiscordId: mitglied(9) },
    });

    const detail = await fragt.ladeStimmenDetail(lauf.id);
    expect(detail.zeilen).toHaveLength(1);
    expect(detail.zeilen[0]!.name).toBeNull();
    expect(detail.zeilen[0]!.discordId).toBe(mitglied(9));
    expect(detail.proAntwort[0]!.stimmen).toBe(1);
  });

  it('erkennt eine nachträglich geänderte Stimme', async () => {
    const { lauf, optionen } = await abstimmung();
    const stimme = await prisma.fragtStimme.create({
      data: { abstimmungId: lauf.id, optionId: optionen[0]!.id, voterDiscordId: mitglied(1) },
    });
    // Eine Meinungsaenderung ist ein `update` derselben Zeile - deshalb
    // liegt der Unterschied in den Zeitstempeln.
    await prisma.fragtStimme.update({
      where: { id: stimme.id },
      data: { optionId: optionen[1]!.id, updatedAt: new Date(Date.now() + 60_000) },
    });

    const detail = await fragt.ladeStimmenDetail(lauf.id);
    expect(detail.zeilen[0]!.geaendert).toBe(true);
    expect(detail.zeilen[0]!.antwort).toBe('Valheim');
  });

  // --- Die Trennung --------------------------------------------------------

  it('gibt im öffentlichen Ergebnis keine einzelne Stimme heraus', async () => {
    const { lauf, optionen } = await abstimmung();
    for (const n of [1, 2]) {
      await prisma.fragtStimme.create({
        data: { abstimmungId: lauf.id, optionId: optionen[0]!.id, voterDiscordId: mitglied(n) },
      });
    }

    const ansicht = await fragt.ladeAbstimmung(lauf.id);
    const text = JSON.stringify(ansicht);
    for (const n of [1, 2]) {
      expect(text, 'Eine Discord-Kennung steht im aggregierten Ergebnis').not.toContain(mitglied(n));
    }
    // Zahlen ja, Namen nein.
    expect(ansicht?.ergebnis?.zeilen[0]?.stimmen).toBe(2);
  });

  it('gibt in der Übersicht und der Beteiligung keine einzelne Stimme heraus', async () => {
    const { lauf, optionen } = await abstimmung();
    await prisma.fragtStimme.create({
      data: { abstimmungId: lauf.id, optionId: optionen[0]!.id, voterDiscordId: mitglied(1) },
    });
    await prisma.fragtAbstimmung.update({
      where: { id: lauf.id },
      data: { status: 'CLOSED', closedAt: new Date(), finalVotes: 1 },
    });

    for (const daten of [
      await fragt.ladeUebersicht(GUILD),
      await fragt.ladeBeteiligung(GUILD),
      await fragt.ladeAbgeschlossene(GUILD),
    ]) {
      expect(JSON.stringify(daten)).not.toContain(mitglied(1));
    }
  });

  it('beantwortet die eigene Stimme nur für die fragende Person', async () => {
    const { lauf, optionen } = await abstimmung();
    await prisma.fragtStimme.create({
      data: { abstimmungId: lauf.id, optionId: optionen[0]!.id, voterDiscordId: mitglied(1) },
    });

    expect(await fragt.eigeneStimme(lauf.id, mitglied(1))).toMatchObject({ label: 'Minecraft' });
    expect(await fragt.eigeneStimme(lauf.id, mitglied(2))).toBeNull();
  });

  it('fasst voterDiscordId nur an den zwei erlaubten Stellen an', async () => {
    /*
     * Der Test, der die Trennung haelt.
     *
     * «Das Frontend versteckt es» ist keine Zugriffskontrolle - wer eine
     * Server Component mit den Kennungen fuellt, schickt sie im HTML mit.
     * Geprueft wird deshalb an der Quelle: genau zwei Funktionen duerfen das
     * Feld lesen, und beide sind es mit Grund.
     *
     * Kommt eine dritte dazu, faellt dieser Test - und wer ihn dann anpasst,
     * hat den Satz oben gelesen.
     */
    const abfragen = readFileSync(join(process.cwd(), 'packages/modules/src/fragt/abfragen.ts'), 'utf8');
    // Kommentare weg - dort steht `voterDiscordId` in der Begruendung.
    const code = abfragen.replaceAll(/\/\*[\s\S]*?\*\//gu, '').replaceAll(/\/\/.*$/gmu, '');

    const stellen = [...code.matchAll(/voterDiscordId/gu)].length;
    // `eigeneStimme` nennt es zweimal (Parameter und zusammengesetzter
    // Schluessel), `ladeStimmenDetail` viermal: Auswahl, Abbildung, Namen,
    // Suche. Die Zahl ist absichtlich knapp - sie soll auffallen.
    expect(stellen, 'voterDiscordId steht an einer unerwarteten Stelle').toBeLessThanOrEqual(6);

    for (const name of ['ladeUebersicht', 'ladeBeteiligung', 'ladeAbgeschlossene']) {
      const ab = code.indexOf(`export async function ${name}`);
      expect(ab, `${name} fehlt`).toBeGreaterThan(-1);
      const bis = code.indexOf('\nexport ', ab + 10);
      const rumpf = code.slice(ab, bis === -1 ? undefined : bis);
      expect(rumpf, `${name} liest voterDiscordId`).not.toContain('voterDiscordId');
    }
  });
});
