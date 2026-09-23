import { ChannelType } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { anwesendeImVoice } from '../../apps/bot/src/analytics-events';

/**
 * Wer sitzt gerade im Sprachkanal?
 *
 * Die Antwort steuert den laufenden Abgleich: was hier fehlt, wird als
 * «Kanal verlassen» verbucht. Ein zu kurzer Blick beendet damit die Sitzung
 * von Leuten, die weiterhin dasitzen - und genau das stand im Dashboard als
 * «Gerade im Sprachkanal: 0».
 *
 * Darum zwei Quellen: die Sprachzustaende des Servers und die Mitglieder der
 * Kanaele. Jede fuer sich kann leer sein, ohne dass der Kanal leer ist.
 */

const KANAL = { id: '700000000000000010', name: 'Treffpunkt', parentId: '600000000000000001' };
const AFK = { id: '700000000000000099', name: 'AFK', parentId: null };

interface Attrappe {
  voiceStates: unknown[];
  kanaele: unknown[];
  afkChannelId?: string | null;
}

const mitglied = (id: string, bot = false) => ({
  id,
  displayName: `Name ${id}`,
  user: { username: `user${id}`, bot, avatar: null },
});

function clientMit({ voiceStates, kanaele, afkChannelId = null }: Attrappe): never {
  const guild = {
    id: '000000000000000001',
    afkChannelId,
    voiceStates: { cache: new Map(voiceStates.map((z, i) => [String(i), z])) },
    channels: { cache: new Map(kanaele.map((k, i) => [String(i), k])) },
  };
  return { guilds: { cache: new Map([['000000000000000001', guild]]) } } as never;
}

const sprachkanal = (
  beschreibung: { id: string; name: string; parentId: string | null },
  mitglieder: ReturnType<typeof mitglied>[] = [],
) => ({
  ...beschreibung,
  type: ChannelType.GuildVoice,
  members: new Map(mitglieder.map((m) => [m.id, m])),
});

describe('Anwesenheit im Sprachkanal', () => {
  it('liest die Sprachzustände des Servers', () => {
    const anwesend = anwesendeImVoice(
      clientMit({
        voiceStates: [
          {
            id: '100000000000000001',
            channel: { ...KANAL, type: ChannelType.GuildVoice },
            member: mitglied('100000000000000001'),
          },
        ],
        kanaele: [],
      }),
      '000000000000000001',
    );

    expect(anwesend).toHaveLength(1);
    expect(anwesend[0]).toMatchObject({
      discordId: '100000000000000001',
      channelId: KANAL.id,
      channelName: 'Treffpunkt',
      parentId: KANAL.parentId,
      isBot: false,
      isAfk: false,
    });
  });

  it('findet jemanden auch, wenn nur der Kanal ihn kennt', () => {
    /*
     * Der Fall, der die Statistik leerlaufen liess: die Sprachzustände sind
     * noch nicht gefüllt - nach einem Neustart, nach einer wiederaufgenommenen
     * Verbindung -, der Kanal hat seine Mitglieder aber. Käme hier eine leere
     * Liste zurück, schlösse der Abgleich jeden laufenden Abschnitt.
     */
    const anwesend = anwesendeImVoice(
      clientMit({ voiceStates: [], kanaele: [sprachkanal(KANAL, [mitglied('100000000000000002')])] }),
      '000000000000000001',
    );

    expect(anwesend.map((p) => p.discordId)).toEqual(['100000000000000002']);
  });

  it('zählt niemanden doppelt, den beide Quellen kennen', () => {
    const person = mitglied('100000000000000003');
    const anwesend = anwesendeImVoice(
      clientMit({
        voiceStates: [{ id: person.id, channel: { ...KANAL, type: ChannelType.GuildVoice }, member: person }],
        kanaele: [sprachkanal(KANAL, [person])],
      }),
      '000000000000000001',
    );

    expect(anwesend).toHaveLength(1);
  });

  it('vereinigt, was nur je eine Quelle kennt', () => {
    const anwesend = anwesendeImVoice(
      clientMit({
        voiceStates: [
          { id: '100000000000000004', channel: { ...KANAL, type: ChannelType.GuildVoice }, member: null },
        ],
        kanaele: [sprachkanal(KANAL, [mitglied('100000000000000005')])],
      }),
      '000000000000000001',
    );

    expect(anwesend.map((p) => p.discordId).sort()).toEqual(['100000000000000004', '100000000000000005']);
  });

  it('hält einen Menschen für einen Menschen, auch wenn er nicht im Zwischenspeicher steht', () => {
    // `member` ist auf einem grossen Server der Normalfall: null. Würde das
    // als Bot gelesen, verschwänden fast alle aus der Statistik.
    const anwesend = anwesendeImVoice(
      clientMit({
        voiceStates: [
          { id: '100000000000000006', channel: { ...KANAL, type: ChannelType.GuildVoice }, member: null },
        ],
        kanaele: [],
      }),
      '000000000000000001',
    );

    expect(anwesend[0]?.isBot).toBe(false);
    expect(anwesend[0]?.username).toBeNull();
  });

  it('nimmt einen erkannten Bot als Bot auf', () => {
    /*
     * Nicht weglassen, sondern kennzeichnen. Ob ein Bot zählt, entscheidet
     * die Einstellung «Bots mit aufzeichnen». Fehlte er hier, sähe der
     * Abgleich einen aufgezeichneten Bot als abwesend an und schlösse
     * seinen Abschnitt jede Minute neu - die Zeit käme nie über eine
     * Minute hinaus.
     */
    const anwesend = anwesendeImVoice(
      clientMit({
        voiceStates: [],
        kanaele: [sprachkanal(KANAL, [mitglied('800000000000000001', true)])],
      }),
      '000000000000000001',
    );

    expect(anwesend).toHaveLength(1);
    expect(anwesend[0]?.isBot).toBe(true);
  });

  it('kennzeichnet den AFK-Kanal', () => {
    // Bleibt der Kennzeichnung wegen: AFK-Zeit ist keine Sprachzeit.
    const anwesend = anwesendeImVoice(
      clientMit({
        voiceStates: [],
        kanaele: [sprachkanal(AFK, [mitglied('100000000000000007')])],
        afkChannelId: AFK.id,
      }),
      '000000000000000001',
    );

    expect(anwesend[0]?.isAfk).toBe(true);
  });

  it('übergeht Textkanäle', () => {
    const anwesend = anwesendeImVoice(
      clientMit({
        voiceStates: [
          {
            id: '100000000000000008',
            channel: { id: '9', name: 'allgemein', parentId: null, type: ChannelType.GuildText },
            member: null,
          },
        ],
        kanaele: [{ id: '9', name: 'allgemein', parentId: null, type: ChannelType.GuildText }],
      }),
      '000000000000000001',
    );

    expect(anwesend).toEqual([]);
  });

  it('nimmt auch Bühnenkanäle auf', () => {
    const anwesend = anwesendeImVoice(
      clientMit({
        voiceStates: [],
        kanaele: [
          { ...sprachkanal(KANAL, [mitglied('100000000000000009')]), type: ChannelType.GuildStageVoice },
        ],
      }),
      '000000000000000001',
    );

    expect(anwesend).toHaveLength(1);
  });

  it('gibt eine leere Liste zurück, wenn der Server unbekannt ist', () => {
    // Nicht abstürzen, und nicht behaupten, es sei jemand da.
    expect(anwesendeImVoice(clientMit({ voiceStates: [], kanaele: [] }), '999999999999999999')).toEqual([]);
  });
});
