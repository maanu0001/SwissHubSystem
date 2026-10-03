import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_xpslot_befehl');

/**
 * Die Nachricht von `/xp-slot` - einstellbar, aber nie leer.
 *
 * ## Was hier geprueft wird
 *
 * Dass der Befehl nicht mehr seinen eigenen Text kennt, sondern den
 * gespeicherten liest - und dass er trotzdem immer etwas Brauchbares
 * schickt. Das sind zwei Zusagen, die leicht gegeneinander laufen: ein Feld
 * ohne Eintrag darf kein leeres Embed ergeben, und ein unerreichbarer
 * Datenbankzugriff darf keinen Fehler statt einer Einladung ergeben.
 *
 * Die Adresse des Knopfs steht ausdruecklich mit darunter. Sie ist der Teil,
 * den niemand eintippen soll: sie kommt aus `appUrl`, und ein Test, der das
 * nicht festhaelt, merkt es nicht, wenn daraus eines Tages ein Textfeld wird.
 */
const { prisma } = await import('@swisshub/database');
const { level } = await import('@swisshub/modules');
const { appUrl } = await import('@swisshub/config');

const S = level.xpslot;
const V = S.BEFEHL_VORGABEN;
const TEAM = { discordId: '900000000000008311', username: 'teamler' };

/** Die vollstaendige Eingabe - leer heisst «Vorgabe». */
const LEER = {
  aktiv: true,
  titel: '',
  beschreibung: '',
  farbe: '',
  knopf: '',
  fusszeile: '',
  thumbnailUrl: '',
  bildUrl: '',
} as const;

async function leere(): Promise<void> {
  await prisma.xpSlotSymbol.deleteMany();
  await prisma.xpSlotConfig.deleteMany();
  await prisma.auditLog.deleteMany();
}

describeWithDatabase('XP-Slot: die Nachricht von /xp-slot', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await leere();
  });

  it('schickt die Vorgaben, solange niemand etwas eingestellt hat', async () => {
    // Noch keine Konfigurationszeile - der Fall «frisch aufgesetzt».
    const embed = await S.befehlsEmbed();

    expect(embed.titel).toBe(V.titel);
    expect(embed.beschreibung).toBe(V.beschreibung);
    expect(embed.knopf).toBe(V.knopf);
    expect(embed.fusszeile).toBe(V.fusszeile);
    expect(embed.farbe).toBe(S.farbzahl(V.farbe));
    expect(embed.thumbnailUrl).toBeNull();
    expect(embed.bildUrl).toBeNull();
  });

  it('nimmt Titel, Text, Farbe und Knopfbeschriftung aus der Einstellung', async () => {
    await S.speichereBefehl(
      {
        ...LEER,
        titel: 'Dräih am Rad',
        beschreibung: 'Fünf Walze, zäh Linie.',
        farbe: '#1f6feb',
        knopf: 'Jetzt spiele',
        fusszeile: 'Nur mit XP.',
      },
      TEAM,
    );

    const embed = await S.befehlsEmbed();
    expect(embed.titel).toBe('Dräih am Rad');
    expect(embed.beschreibung).toBe('Fünf Walze, zäh Linie.');
    expect(embed.knopf).toBe('Jetzt spiele');
    expect(embed.fusszeile).toBe('Nur mit XP.');
    // `#1f6feb` als Zahl - so, wie Discord die Farbe erwartet.
    expect(embed.farbe).toBe(0x1f6feb);
  });

  it('faellt je Feld einzeln auf die Vorgabe zurueck', async () => {
    // Nur der Titel ist eigen. Wer das aendert, will keinen Titel ohne Text
    // darunter - sondern seinen Titel und den Rest wie gehabt.
    await S.speichereBefehl({ ...LEER, titel: 'Nur de Titel' }, TEAM);

    const embed = await S.befehlsEmbed();
    expect(embed.titel).toBe('Nur de Titel');
    expect(embed.beschreibung).toBe(V.beschreibung);
    expect(embed.knopf).toBe(V.knopf);
    expect(embed.farbe).toBe(S.farbzahl(V.farbe));
  });

  it('macht aus einem geleerten Feld wieder die Vorgabe', async () => {
    await S.speichereBefehl({ ...LEER, titel: 'Vorübergehend' }, TEAM);
    await S.speichereBefehl({ ...LEER, titel: '   ' }, TEAM);

    const gespeichert = await prisma.xpSlotConfig.findUniqueOrThrow({ where: { id: 'default' } });
    // Leer wird zu `null`, und `null` loest beim Lesen die Vorgabe aus - es
    // braucht also keinen zweiten Mechanismus zum Zurueckstellen.
    expect(gespeichert.commandTitle).toBeNull();
    expect((await S.befehlsEmbed()).titel).toBe(V.titel);
  });

  it('nimmt bei abgeschalteter Gestaltung die schlichte Vorgabe', async () => {
    await S.speichereBefehl(
      { ...LEER, aktiv: false, titel: 'Ausgeschaltet', beschreibung: 'Unbenutzt' },
      TEAM,
    );

    const embed = await S.befehlsEmbed();
    /*
     * `aktiv: false` ist kein zweiter Befehlsschalter - ob `/xp-slot`
     * ueberhaupt laeuft, entscheidet die zentrale Befehlsverwaltung. Hier
     * heisst es: nimm die Vorgaben statt des gestalteten Textes.
     */
    expect(embed.aktiv).toBe(false);
    expect(embed.titel).toBe(V.titel);
    expect(embed.beschreibung).toBe(V.beschreibung);
  });

  it('baut die Adresse des Knopfs immer selbst', async () => {
    await S.speichereBefehl({ ...LEER, titel: 'Mit Adresse' }, TEAM);

    const embed = await S.befehlsEmbed();
    // Keine gespeicherte Adresse, kein Feld dafuer: sonst stuende dort auf
    // dem naechsten Server eine alte Domain.
    expect(embed.adresse).toBe(appUrl('/level/xp-slot'));
    expect(embed.adresse).toContain('/level/xp-slot');
  });

  it('nimmt nur https-Bildadressen', async () => {
    await expect(
      S.speichereBefehl({ ...LEER, thumbnailUrl: 'http://example.com/bild.png' }, TEAM),
    ).rejects.toThrow();
    await expect(S.speichereBefehl({ ...LEER, bildUrl: 'javascript:alert(1)' }, TEAM)).rejects.toThrow();

    await S.speichereBefehl({ ...LEER, bildUrl: 'https://example.com/bild.png' }, TEAM);
    expect((await S.befehlsEmbed()).bildUrl).toBe('https://example.com/bild.png');
  });

  it('weist eine Farbe ohne die Form #rrggbb zurueck', async () => {
    await expect(S.speichereBefehl({ ...LEER, farbe: 'rot' }, TEAM)).rejects.toThrow();
    // Und eine kaputte Farbe, die dennoch in der Zeile stuende, ergibt beim
    // Lesen die Vorgabe statt eines Embeds ohne Farbe.
    expect(S.farbzahl('nicht-hex')).toBe(S.farbzahl(V.farbe));
  });

  it('zeigt der Verwaltung leere Felder statt der Vorgabetexte', async () => {
    const einstellungen = await S.befehlsEinstellungen();
    /*
     * Der Unterschied zum Embed: im Formular bleibt das Feld leer, damit
     * «nichts eingestellt» sichtbar bleibt. Stuende der Vorgabetext darin,
     * waere er beim ersten Speichern als eigener Text festgeschrieben - und
     * eine spaetere Aenderung der Vorgabe ginge an diesem Server vorbei.
     */
    expect(einstellungen.titel).toBe('');
    expect(einstellungen.beschreibung).toBe('');
    expect(einstellungen.aktiv).toBe(true);
  });

  it('haelt die Aenderung in der Pruefspur fest - ohne den Text selbst', async () => {
    await S.speichereBefehl({ ...LEER, titel: 'Geheim', beschreibung: 'Auch geheim' }, TEAM);

    const eintrag = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'XP_SLOT_CONFIG_UPDATED' },
    });
    expect(eintrag.actorDiscordId).toBe(TEAM.discordId);
    expect(eintrag.targetLabel).toBe('/xp-slot Nachricht');
    const metadata = eintrag.metadata as { aktiv?: boolean; eigeneFelder?: string[] };
    expect(metadata.eigeneFelder).toEqual(['titel', 'beschreibung']);
    // Der Text gehoert in die Konfiguration, nicht in die Pruefspur.
    expect(JSON.stringify(eintrag.metadata)).not.toContain('Geheim');
  });
});
