import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';
import type { DiscordGateway } from '@swisshub/discord';

useTestSchema('test_fragt_abstimmung');

/**
 * Abstimmen auf Discord, von der Frage bis zum festgeschriebenen Ergebnis.
 *
 * ## Warum gegen eine echte Datenbank
 *
 * Weil die ganzen Vorkehrungen aus zwei Eindeutigkeitsbedingungen bestehen:
 *
 *   - `@@unique([abstimmungId, voterDiscordId])` - eine Stimme je Person
 *   - `@@unique([frageId, opensAt])` - eine Veroeffentlichung je Termin
 *
 * Beides gibt es in einer Nachbildung von Prisma nicht. Ein Test dagegen wuerde
 * bestaetigen, dass die Nachbildung tut, was man ihr beigebracht hat, und ueber
 * die Datenbank nichts aussagen.
 *
 * ## Was hier tatsaechlich schiefgehen kann
 *
 *   - **Doppelklick auf denselben Knopf** - zwei Stimmen statt einer
 *   - **Meinungsaenderung** - beide Stimmen zaehlen, oder keine
 *   - **Zwei gleichzeitige Klicks auf verschiedene Antworten** - zwei Zeilen
 *   - **Neustart des Planers** - zwei Embeds im Kanal
 *   - **Klick nach Ablauf** - eine Stimme, die zu spaet kam
 *
 * Die ersten drei loesen unten echte `Promise.all` aus, nicht Aufrufe
 * nacheinander.
 */
const { prisma } = await import('@swisshub/database');
const { fragt, setModuleEnabled, setModuleSettings } = await import('@swisshub/modules');

const GUILD = '000000000000000001';
const KANAL = '200000000000000001';
const ERGEBNIS_KANAL = '200000000000000002';
const ANNA = '100000000000000001';
const BEN = '100000000000000002';
const CARLA = '100000000000000003';
const MOD = '100000000000000009';

/** Freitag, 25.09.2026, 18:00 Zuerich. */
const FREITAG_18 = new Date('2026-09-25T16:00:00.000Z');
/** Freitag, 18:05 Zuerich - der Planer laeuft kurz nach dem Termin. */
const KURZ_DANACH = new Date('2026-09-25T16:05:00.000Z');

const actor = (discordId: string): { discordId: string; username: string } => ({
  discordId,
  username: `nutzer-${discordId.slice(-2)}`,
});

/** Ein Gateway, das mitschreibt. */
function gateway(): {
  send: ReturnType<typeof vi.fn>;
  edit: ReturnType<typeof vi.fn>;
  modul: DiscordGateway;
} {
  const send = vi.fn(async (channelId: string) => ({
    id: `msg-${send.mock.calls.length}`,
    channelId,
  }));
  const edit = vi.fn(async () => undefined);
  return { send, edit, modul: { channels: { send, edit } } as unknown as DiscordGateway };
}

async function einstellungen(teile: Record<string, unknown> = {}): Promise<void> {
  await setModuleEnabled(fragt.FRAGT_MODULE_ID, true, 'test');
  await setModuleSettings(
    fragt.FRAGT_MODULE_ID,
    {
      autoPublish: true,
      channelId: KANAL,
      resultChannelId: null,
      publishDay: 5,
      publishHour: 18,
      publishMinute: 0,
      timezone: 'Europe/Zurich',
      durationHours: 48,
      selectionMode: 'automatisch',
      liveResults: false,
      autoPublishResults: true,
      resultMention: 'keine',
      resultMentionRoleId: null,
      ...teile,
    },
    'test',
  );
}

async function frage(
  text: string,
  antworten: string[],
  status: 'DRAFT' | 'READY' = 'READY',
): Promise<{ id: string; optionen: Array<{ id: string; label: string }> }> {
  const angelegt = await fragt.erstelleFrage(GUILD, actor(MOD), {
    text,
    kategorie: 'Games',
    typ: antworten.length === 2 ? 'ENTWEDER_ODER' : 'UMFRAGE',
    antworten,
  });
  if (status === 'READY') {
    await fragt.setzeStatus(angelegt.id, actor(MOD), 'READY');
  }
  return { id: angelegt.id, optionen: angelegt.optionen };
}

async function stelle(
  text: string,
  antworten: string[],
  opensAt = FREITAG_18,
): Promise<{ abstimmungId: string; optionen: Array<{ id: string; label: string }> }> {
  const { id, optionen } = await frage(text, antworten);
  const { modul } = gateway();
  const ausgang = await fragt.veroeffentliche(
    {
      guildId: GUILD,
      frageId: id,
      opensAt,
      channelId: KANAL,
      dauerStunden: 48,
      zwischenstandSichtbar: false,
    },
    modul,
  );
  return { abstimmungId: ausgang.abstimmung.id, optionen };
}

describeWithDatabase('SwissHub fragt: abstimmen', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.fragtStimme.deleteMany({});
    await prisma.fragtEntwurf.deleteMany({});
    await prisma.fragtAbstimmung.deleteMany({});
    await prisma.fragtOption.deleteMany({});
    await prisma.fragtFrage.deleteMany({});
    await einstellungen();
  });

  // --- Veroeffentlichen -----------------------------------------------------

  it('stellt eine Frage und legt die Nachricht an', async () => {
    const { modul, send } = gateway();
    const { id } = await frage('Welches Game verdient ein Remake?', ['Half-Life', 'Burnout']);

    const ausgang = await fragt.veroeffentliche(
      {
        guildId: GUILD,
        frageId: id,
        opensAt: FREITAG_18,
        channelId: KANAL,
        dauerStunden: 48,
        zwischenstandSichtbar: false,
      },
      modul,
    );

    expect(ausgang.art).toBe('veroeffentlicht');
    expect(send).toHaveBeenCalledTimes(1);
    expect(ausgang.abstimmung.messageId).toBe('msg-1');
    // Der Fragetext ist kopiert, nicht verlinkt.
    expect(ausgang.abstimmung.frageText).toBe('Welches Game verdient ein Remake?');
    expect(ausgang.abstimmung.closesAt.getTime() - FREITAG_18.getTime()).toBe(48 * 3_600_000);
    // Die Frage selbst laeuft jetzt.
    expect((await prisma.fragtFrage.findUniqueOrThrow({ where: { id } })).status).toBe('ACTIVE');
  });

  it('stellt dieselbe Frage zum selben Termin nicht zweimal', async () => {
    /*
     * Der Schutz gegen doppelte Embeds. Zehn Durchgaenge des Planers - oder
     * einer nach einem Neustart - ergeben eine Abstimmung und eine Nachricht.
     */
    const { id } = await frage('Doppelt?', ['A', 'B']);
    const { modul, send } = gateway();

    for (let lauf = 0; lauf < 10; lauf += 1) {
      await fragt.veroeffentliche(
        {
          guildId: GUILD,
          frageId: id,
          opensAt: FREITAG_18,
          channelId: KANAL,
          dauerStunden: 48,
          zwischenstandSichtbar: false,
        },
        modul,
      );
    }

    expect(await prisma.fragtAbstimmung.count({ where: { frageId: id } })).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('haelt auch zwei gleichzeitige Veroeffentlichungen aus', async () => {
    // Zwei Worker, dieselbe Sekunde. Die Bedingung in der Datenbank entscheidet.
    const { id } = await frage('Gleichzeitig?', ['A', 'B']);
    const eingabe = {
      guildId: GUILD,
      frageId: id,
      opensAt: FREITAG_18,
      channelId: KANAL,
      dauerStunden: 48,
      zwischenstandSichtbar: false,
    };

    const ergebnisse = await Promise.all([
      fragt.veroeffentliche(eingabe, gateway().modul),
      fragt.veroeffentliche(eingabe, gateway().modul),
    ]);

    expect(await prisma.fragtAbstimmung.count({ where: { frageId: id } })).toBe(1);
    // Genau einer hat veroeffentlicht, der andere hat die vorhandene bekommen.
    expect(ergebnisse.filter((eintrag) => eintrag.art === 'veroeffentlicht')).toHaveLength(1);
  });

  it('holt eine Nachricht nach, die beim ersten Versuch nicht abging', async () => {
    /*
     * Discord war nicht erreichbar. Ohne diesen Weg liefe die Abstimmung stumm
     * bis zum Ablauf, und niemand koennte abstimmen.
     */
    const { id } = await frage('Stumm?', ['A', 'B']);
    const kaputt = {
      channels: {
        send: vi.fn(async () => {
          throw new Error('Discord antwortet nicht');
        }),
      },
    } as unknown as DiscordGateway;

    await expect(
      fragt.veroeffentliche(
        {
          guildId: GUILD,
          frageId: id,
          opensAt: FREITAG_18,
          channelId: KANAL,
          dauerStunden: 48,
          zwischenstandSichtbar: false,
        },
        kaputt,
      ),
    ).rejects.toThrow();

    // Die Zeile ist da, ohne Nachricht.
    const abstimmung = await prisma.fragtAbstimmung.findFirstOrThrow({ where: { frageId: id } });
    expect(abstimmung.messageId).toBeNull();

    // Der naechste Durchgang holt sie nach - und legt keine zweite Abstimmung an.
    const { modul, send } = gateway();
    await fragt.runFragtTick(GUILD, KURZ_DANACH, modul);
    expect(send).toHaveBeenCalledTimes(1);
    expect((await prisma.fragtAbstimmung.findUniqueOrThrow({ where: { id: abstimmung.id } })).messageId).toBe(
      'msg-1',
    );
    expect(await prisma.fragtAbstimmung.count({ where: { frageId: id } })).toBe(1);
  });

  // --- Abstimmen ------------------------------------------------------------

  it('zaehlt eine Stimme', async () => {
    const { abstimmungId, optionen } = await stelle('Frage', ['Minecraft', 'CS2']);
    const ausgang = await fragt.stimmeAb(abstimmungId, optionen[0]!.id, { discordId: ANNA });

    expect(ausgang).toEqual({ art: 'gezaehlt', label: 'Minecraft' });
    expect((await fragt.zaehleStimmen(abstimmungId)).gesamt).toBe(1);
  });

  it('macht aus zehn Klicks auf denselben Knopf eine Stimme', async () => {
    const { abstimmungId, optionen } = await stelle('Frage', ['A', 'B']);

    // Gleichzeitig, nicht nacheinander - der Doppelklick ist ein Wettlauf.
    const ausgaenge = await Promise.all(
      Array.from({ length: 10 }, () => fragt.stimmeAb(abstimmungId, optionen[0]!.id, { discordId: ANNA })),
    );

    expect(await prisma.fragtStimme.count({ where: { abstimmungId } })).toBe(1);
    // Mindestens einer hat gezaehlt, die uebrigen melden «unveraendert».
    expect(ausgaenge.filter((eintrag) => eintrag.art === 'gezaehlt').length).toBeGreaterThanOrEqual(1);
  });

  it('ersetzt die Stimme bei einer Meinungsaenderung', async () => {
    const { abstimmungId, optionen } = await stelle('Frage', ['Controller', 'Maus']);

    await fragt.stimmeAb(abstimmungId, optionen[0]!.id, { discordId: ANNA });
    const geaendert = await fragt.stimmeAb(abstimmungId, optionen[1]!.id, { discordId: ANNA });

    expect(geaendert).toEqual({ art: 'geaendert', label: 'Maus', vorher: 'Controller' });
    // Eine Zeile, nicht zwei - und sie zeigt auf die neue Antwort.
    expect(await prisma.fragtStimme.count({ where: { abstimmungId } })).toBe(1);
    const ergebnis = await fragt.zaehleStimmen(abstimmungId);
    expect(ergebnis.gesamt).toBe(1);
    expect(ergebnis.zeilen.find((zeile) => zeile.label === 'Maus')?.stimmen).toBe(1);
    expect(ergebnis.zeilen.find((zeile) => zeile.label === 'Controller')?.stimmen).toBe(0);
  });

  it('verliert bei zwei gleichzeitigen Klicks auf verschiedene Antworten keine Stimme', async () => {
    /*
     * Der Fall, den ein Loeschen-und-Einfuegen zerstoert: zwischen dem Loeschen
     * und dem Einfuegen liegt der zweite Klick. Dann waere die alte Stimme weg
     * und die neue zweimal da - oder gar keine.
     */
    const { abstimmungId, optionen } = await stelle('Frage', ['A', 'B']);

    await Promise.all([
      fragt.stimmeAb(abstimmungId, optionen[0]!.id, { discordId: ANNA }),
      fragt.stimmeAb(abstimmungId, optionen[1]!.id, { discordId: ANNA }),
    ]);

    expect(await prisma.fragtStimme.count({ where: { abstimmungId } })).toBe(1);
    expect((await fragt.zaehleStimmen(abstimmungId)).gesamt).toBe(1);
  });

  it('nimmt nach Ablauf keine Stimme mehr an', async () => {
    /*
     * Der Button bleibt stehen, bis der naechste Durchgang ihn entfernt. In
     * dieser Minute wuerde eine Stimme sonst gezaehlt - die Serverzeit
     * entscheidet, nicht ob ein Knopf klickbar ist.
     */
    const { abstimmungId, optionen } = await stelle('Frage', ['A', 'B']);
    const nachher = new Date(FREITAG_18.getTime() + 49 * 3_600_000);

    expect(await fragt.stimmeAb(abstimmungId, optionen[0]!.id, { discordId: ANNA }, nachher)).toEqual({
      art: 'beendet',
    });
    expect(await prisma.fragtStimme.count({ where: { abstimmungId } })).toBe(0);
  });

  it('lehnt eine Antwort ab, die nicht zu dieser Frage gehoert', async () => {
    /*
     * Die Kennung kommt aus einem Button, und ein Button ist ein Wert, den man
     * nachbauen kann. Ohne diese Pruefung liesse sich eine Stimme in eine
     * Abstimmung legen, in der diese Antwort nicht steht - und die Auszaehlung
     * fand sie nie wieder.
     */
    const erste = await stelle('Erste', ['A', 'B']);
    const zweite = await stelle('Zweite', ['C', 'D'], new Date(FREITAG_18.getTime() + 60_000));

    expect(await fragt.stimmeAb(erste.abstimmungId, zweite.optionen[0]!.id, { discordId: ANNA })).toEqual({
      art: 'unbekannt',
    });
    expect(await prisma.fragtStimme.count({ where: { abstimmungId: erste.abstimmungId } })).toBe(0);
  });

  it('meldet eine unbekannte Abstimmung, ohne zu werfen', async () => {
    // Eine sehr alte Nachricht, deren Abstimmung geloescht wurde.
    expect(
      await fragt.stimmeAb('clh0000000000000000000000', 'clh0000000000000000000001', {
        discordId: ANNA,
      }),
    ).toEqual({ art: 'unbekannt' });
  });

  // --- Schliessen -----------------------------------------------------------

  it('schreibt das Ergebnis fest und ersetzt die Nachricht', async () => {
    const { abstimmungId, optionen } = await stelle('Frage', ['Minecraft', 'CS2']);
    await fragt.stimmeAb(abstimmungId, optionen[0]!.id, { discordId: ANNA });
    await fragt.stimmeAb(abstimmungId, optionen[0]!.id, { discordId: BEN });
    await fragt.stimmeAb(abstimmungId, optionen[1]!.id, { discordId: CARLA });

    const { modul, edit } = gateway();
    const ausgang = await fragt.schliesse(abstimmungId, new Date(), modul);

    expect(ausgang.art).toBe('geschlossen');
    if (ausgang.art !== 'geschlossen') {
      return;
    }
    expect(ausgang.ergebnis.gesamt).toBe(3);
    expect(ausgang.ergebnis.gewinner?.label).toBe('Minecraft');
    expect(ausgang.ergebnis.gewinner?.prozent).toBe(67);

    const abstimmung = await prisma.fragtAbstimmung.findUniqueOrThrow({ where: { id: abstimmungId } });
    expect(abstimmung.status).toBe('CLOSED');
    expect(abstimmung.finalVotes).toBe(3);
    // Der Schnappschuss - nicht nachgerechnet, sondern gespeichert.
    expect(fragt.ausSnapshot(abstimmung.ergebnis)?.gesamt).toBe(3);
    // Die Nachricht ist ersetzt, die Buttons sind weg.
    expect(edit).toHaveBeenCalledTimes(1);
    expect(edit.mock.calls[0]?.[2]).toMatchObject({ components: [] });
  });

  it('schliesst auch bei zehn Durchgaengen nur einmal', async () => {
    /*
     * Ohne die Bedingung `status: ACTIVE` im `updateMany` waere ein Neustart
     * des Planers zwei Ergebnismeldungen, zwei Entwuerfe und zwei
     * Audit-Eintraege.
     */
    const { abstimmungId, optionen } = await stelle('Frage', ['A', 'B']);
    await fragt.stimmeAb(abstimmungId, optionen[0]!.id, { discordId: ANNA });

    const { modul, edit } = gateway();
    const ausgaenge = [];
    for (let lauf = 0; lauf < 10; lauf += 1) {
      ausgaenge.push(await fragt.schliesse(abstimmungId, new Date(), modul));
    }

    expect(ausgaenge.filter((eintrag) => eintrag.art === 'geschlossen')).toHaveLength(1);
    expect(edit).toHaveBeenCalledTimes(1);
    expect(await prisma.fragtEntwurf.count({ where: { abstimmungId } })).toBe(1);
  });

  it('legt beim Schliessen einen Social-Media-Entwurf an', async () => {
    const { abstimmungId, optionen } = await stelle('Frage', ['A', 'B', 'C']);
    await fragt.stimmeAb(abstimmungId, optionen[0]!.id, { discordId: ANNA });
    await fragt.schliesse(abstimmungId, new Date(), gateway().modul);

    const entwurf = await prisma.fragtEntwurf.findUniqueOrThrow({ where: { abstimmungId } });
    expect(entwurf.status).toBe('OFFEN');
    expect(entwurf.cta.length).toBeGreaterThan(0);
    // Drei Antworten: vier Folien.
    expect(fragt.leseFolien(entwurf.folien, 'UMFRAGE')).toHaveLength(4);
  });

  it('haelt einen Gleichstand als Gleichstand fest', async () => {
    const { abstimmungId, optionen } = await stelle('Frage', ['Controller', 'Maus']);
    await fragt.stimmeAb(abstimmungId, optionen[0]!.id, { discordId: ANNA });
    await fragt.stimmeAb(abstimmungId, optionen[1]!.id, { discordId: BEN });

    const ausgang = await fragt.schliesse(abstimmungId, new Date(), gateway().modul);
    if (ausgang.art !== 'geschlossen') {
      throw new Error('nicht geschlossen');
    }
    // Kein kuenstlicher Gewinner.
    expect(ausgang.ergebnis.gewinner).toBeNull();
    expect(ausgang.ergebnis.gleichstand).toHaveLength(2);
  });

  it('schliesst eine Abstimmung ohne eine einzige Stimme sauber ab', async () => {
    const { abstimmungId } = await stelle('Frage', ['A', 'B']);
    const ausgang = await fragt.schliesse(abstimmungId, new Date(), gateway().modul);
    if (ausgang.art !== 'geschlossen') {
      throw new Error('nicht geschlossen');
    }
    expect(ausgang.ergebnis.gesamt).toBe(0);
    expect(ausgang.ergebnis.gewinner).toBeNull();
    // Die Antworten stehen trotzdem im Schnappschuss - sie standen zur Wahl.
    expect(ausgang.ergebnis.zeilen).toHaveLength(2);
  });

  it('meldet das Ergebnis in einen eigenen Kanal, aber nicht doppelt in denselben', async () => {
    /*
     * Steht die Meldung im selben Kanal wie die Frage, entfaellt sie: die
     * Nachricht der Frage zeigt dort schon das Ergebnis.
     */
    const { abstimmungId, optionen } = await stelle('Frage', ['A', 'B']);
    await fragt.stimmeAb(abstimmungId, optionen[0]!.id, { discordId: ANNA });

    const { modul, send } = gateway();
    await fragt.schliesse(abstimmungId, new Date(), modul);
    expect(send).not.toHaveBeenCalled();

    // Mit eigenem Ergebniskanal kommt eine Meldung.
    await einstellungen({ resultChannelId: ERGEBNIS_KANAL });
    const zweite = await stelle('Zweite', ['A', 'B'], new Date(FREITAG_18.getTime() + 60_000));
    const zweitesGateway = gateway();
    await fragt.schliesse(zweite.abstimmungId, new Date(), zweitesGateway.modul);
    expect(zweitesGateway.send).toHaveBeenCalledTimes(1);
    expect(zweitesGateway.send.mock.calls[0]?.[0]).toBe(ERGEBNIS_KANAL);
  });

  // --- Der Planer -----------------------------------------------------------

  it('veroeffentlicht zum faelligen Termin - und beim naechsten Durchgang nicht erneut', async () => {
    await frage('Automatisch gestellt', ['A', 'B']);
    const { modul, send } = gateway();

    for (let lauf = 0; lauf < 5; lauf += 1) {
      await fragt.runFragtTick(GUILD, KURZ_DANACH, modul);
    }

    expect(await prisma.fragtAbstimmung.count({ where: { guildId: GUILD } })).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    const abstimmung = await prisma.fragtAbstimmung.findFirstOrThrow({ where: { guildId: GUILD } });
    // Der Termin ist der gerechnete, nicht «jetzt».
    expect(abstimmung.opensAt.toISOString()).toBe(FREITAG_18.toISOString());
  });

  it('schliesst faellige Abstimmungen im Durchgang', async () => {
    const { abstimmungId, optionen } = await stelle('Laeuft ab', ['A', 'B']);
    await fragt.stimmeAb(abstimmungId, optionen[0]!.id, { discordId: ANNA });

    // Zwei Tage und eine Minute spaeter - aber kein neuer Termin faellig.
    const spaeter = new Date(FREITAG_18.getTime() + 48 * 3_600_000 + 60_000);
    const ergebnis = await fragt.runFragtTick(GUILD, spaeter, gateway().modul);

    expect(ergebnis.geschlossen).toBe(1);
    expect((await prisma.fragtAbstimmung.findUniqueOrThrow({ where: { id: abstimmungId } })).status).toBe(
      'CLOSED',
    );
  });

  it('stellt keine zweite Frage, solange eine laeuft', async () => {
    await stelle('Laeuft schon', ['A', 'B']);
    await frage('Wartet', ['C', 'D']);

    const ergebnis = await fragt.runFragtTick(GUILD, KURZ_DANACH, gateway().modul);
    expect(ergebnis.veroeffentlicht).toBe(0);
    expect(await prisma.fragtAbstimmung.count({ where: { guildId: GUILD } })).toBe(1);
  });

  it('waehlt im Modus «manuell» nur, was geplant ist', async () => {
    await einstellungen({ selectionMode: 'manuell' });
    await frage('Nicht geplant', ['A', 'B']);

    expect((await fragt.runFragtTick(GUILD, KURZ_DANACH, gateway().modul)).veroeffentlicht).toBe(0);

    // Mit Termin wird sie gestellt.
    const geplant = await frage('Geplant', ['C', 'D']);
    await fragt.planeFrage(geplant.id, actor(MOD), new Date(Date.now() + 60_000));
    await prisma.fragtFrage.update({ where: { id: geplant.id }, data: { geplantAt: FREITAG_18 } });

    expect((await fragt.runFragtTick(GUILD, KURZ_DANACH, gateway().modul)).veroeffentlicht).toBe(1);
    const abstimmung = await prisma.fragtAbstimmung.findFirstOrThrow({ where: { guildId: GUILD } });
    expect(abstimmung.frageText).toBe('Geplant');
  });

  it('nimmt nicht zweimal hintereinander dieselbe Frage', async () => {
    const erste = await frage('Erste', ['A', 'B']);
    await frage('Zweite', ['C', 'D']);

    // Erste Woche.
    await fragt.runFragtTick(GUILD, KURZ_DANACH, gateway().modul);
    const eine = await prisma.fragtAbstimmung.findFirstOrThrow({ where: { guildId: GUILD } });
    await fragt.schliesse(eine.id, new Date(), gateway().modul);
    await fragt.setzeStatus(eine.frageId, actor(MOD), 'READY');

    // Zweite Woche.
    const naechsteWoche = new Date(KURZ_DANACH.getTime() + 7 * 24 * 3_600_000);
    await fragt.runFragtTick(GUILD, naechsteWoche, gateway().modul);

    const alle = await prisma.fragtAbstimmung.findMany({
      where: { guildId: GUILD },
      orderBy: { opensAt: 'asc' },
    });
    expect(alle).toHaveLength(2);
    expect(alle[1]?.frageId).not.toBe(alle[0]?.frageId);
    expect(alle[0]?.frageId).toBe(erste.id);
  });

  it('waehlt ausschliesslich freigegebene Fragen', async () => {
    // Nur ein Entwurf vorhanden - die Automatik darf ihn nicht nehmen.
    await frage('Nur ein Entwurf', ['A', 'B'], 'DRAFT');
    expect((await fragt.runFragtTick(GUILD, KURZ_DANACH, gateway().modul)).veroeffentlicht).toBe(0);
    expect(await prisma.fragtAbstimmung.count({ where: { guildId: GUILD } })).toBe(0);
  });

  it('stellt nichts, wenn die Automatik aus ist', async () => {
    await einstellungen({ autoPublish: false });
    await frage('Bereit', ['A', 'B']);
    expect((await fragt.runFragtTick(GUILD, KURZ_DANACH, gateway().modul)).veroeffentlicht).toBe(0);
  });

  it('stellt nichts ohne eingestellten Kanal', async () => {
    await einstellungen({ channelId: null });
    await frage('Bereit', ['A', 'B']);
    expect((await fragt.runFragtTick(GUILD, KURZ_DANACH, gateway().modul)).veroeffentlicht).toBe(0);
  });

  // --- Die Bibliothek -------------------------------------------------------

  it('laesst die Antworten einer gestellten Frage nicht mehr aendern', async () => {
    /*
     * Die Stimmen zeigen auf die `FragtOption`-Zeilen. Eine davon umzubenennen
     * wuerde die Stimmen von damals einer anderen Antwort zuordnen - und die
     * Ergebnisgrafik waere rueckwirkend falsch.
     */
    const { abstimmungId, optionen } = await stelle('Schon gestellt', ['A', 'B']);
    await fragt.stimmeAb(abstimmungId, optionen[0]!.id, { discordId: ANNA });
    const abstimmung = await prisma.fragtAbstimmung.findUniqueOrThrow({ where: { id: abstimmungId } });
    await fragt.schliesse(abstimmungId, new Date(), gateway().modul);

    await expect(
      fragt.bearbeiteFrage(abstimmung.frageId, actor(MOD), { antworten: ['X', 'Y'] }),
    ).rejects.toMatchObject({
      userMessage: expect.stringContaining('Antwortmöglichkeiten'),
    });

    // Der Text darf sich aendern - die Abstimmung traegt ihre eigene Kopie.
    await fragt.bearbeiteFrage(abstimmung.frageId, actor(MOD), { text: 'Anders formuliert' });
    expect((await prisma.fragtAbstimmung.findUniqueOrThrow({ where: { id: abstimmungId } })).frageText).toBe(
      'Schon gestellt',
    );
  });

  it('gibt beim Duplizieren eine Kopie mit eigenen Antwortzeilen', async () => {
    const { abstimmungId } = await stelle('Original', ['A', 'B']);
    const abstimmung = await prisma.fragtAbstimmung.findUniqueOrThrow({ where: { id: abstimmungId } });

    const kopie = await fragt.dupliziereFrage(abstimmung.frageId, actor(MOD));
    expect(kopie.status).toBe('DRAFT');
    expect(kopie.optionen.map((option) => option.label)).toEqual(['A', 'B']);
    // Eigene Zeilen - sonst haetten die Stimmen von damals an ihnen gehangen.
    expect(kopie.optionen.map((option) => option.id)).not.toContain(abstimmung.frageId);
    await expect(fragt.bearbeiteFrage(kopie.id, actor(MOD), { antworten: ['X', 'Y'] })).resolves.toBeTruthy();
  });

  it('lehnt zu wenige und doppelte Antworten ab', async () => {
    await expect(
      fragt.erstelleFrage(GUILD, actor(MOD), {
        text: 'Zu wenig',
        kategorie: 'Games',
        typ: 'UMFRAGE',
        antworten: ['nur eine'],
      }),
    ).rejects.toMatchObject({ userMessage: expect.stringContaining('mindestens') });

    await expect(
      fragt.erstelleFrage(GUILD, actor(MOD), {
        text: 'Doppelt',
        kategorie: 'Games',
        typ: 'UMFRAGE',
        antworten: ['Minecraft', 'minecraft'],
      }),
    ).rejects.toMatchObject({ userMessage: expect.stringContaining('zweimal') });
  });

  it('gibt Hot Take die festen Antworten, egal was mitkommt', async () => {
    const angelegt = await fragt.erstelleFrage(GUILD, actor(MOD), {
      text: 'Singleplayer ist besser als Multiplayer.',
      kategorie: 'Meinung',
      typ: 'HOT_TAKE',
      antworten: ['Ja', 'Nein', 'Vielleicht'],
    });
    expect(angelegt.optionen.map((option) => option.label)).toEqual(['Stimme zu', 'Stimme nicht zu']);
  });

  it('spielt die vorbereiteten Fragen als Entwurf ein - und nicht zweimal', async () => {
    const erste = await fragt.spieleSeedEin(GUILD, MOD);
    expect(erste).toBe(fragt.SEED_FRAGEN.length);
    expect(await fragt.spieleSeedEin(GUILD, MOD)).toBe(0);

    // Alle als Entwurf: nichts davon kann von selbst auf Discord landen.
    const eingespielt = await prisma.fragtFrage.findMany({ where: { guildId: GUILD } });
    expect(eingespielt.every((zeile) => zeile.status === 'DRAFT')).toBe(true);
    expect((await fragt.runFragtTick(GUILD, KURZ_DANACH, gateway().modul)).veroeffentlicht).toBe(0);
  });

  it('nennt die eigene Stimme nur der Person selbst', async () => {
    const { abstimmungId, optionen } = await stelle('Frage', ['A', 'B']);
    await fragt.stimmeAb(abstimmungId, optionen[0]!.id, { discordId: ANNA });

    expect(await fragt.eigeneStimme(abstimmungId, ANNA)).toMatchObject({ label: 'A' });
    // Ben hat nicht gestimmt - und erfaehrt nichts ueber Anna.
    expect(await fragt.eigeneStimme(abstimmungId, BEN)).toBeNull();
  });
});
