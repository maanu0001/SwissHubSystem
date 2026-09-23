import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type * as DiscordModulTyp from '@swisshub/discord';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

type DiscordModul = typeof DiscordModulTyp;

useTestSchema('test_verifikation_gesamt');

/**
 * Die Kennzahlen der Übersicht zeigen den Gesamtbestand.
 *
 * Vorher zählten sie den heutigen Tag. An einem ruhigen Tag stand dort
 * dreimal eine Null - und die sah aus wie «das System tut nichts» statt wie
 * «heute war wenig los». Was das Modul insgesamt geleistet hat, stand
 * nirgends.
 *
 * Die Wartezeit behält ihre Bedeutung: `decidedAt - joinedAt`, vom Beitritt
 * bis zur Entscheidung. Nur der Zeitraum ist ein anderer.
 */
const { prisma } = await import('@swisshub/database');
const { verification } = await import('@swisshub/modules');

const GUILD = '000000000000000001';

vi.mock('@swisshub/discord', async () => {
  const echt = await vi.importActual<DiscordModul>('@swisshub/discord');
  return { ...echt, resolveGuildId: async () => GUILD, tryResolveGuildId: async () => GUILD };
});

const JETZT = new Date(Date.UTC(2026, 8, 23, 12, 0, 0));
/** Tage vor `JETZT`, mitten am Tag. */
const TAG = (zurueck: number): Date => new Date(JETZT.getTime() - zurueck * 86_400_000);

let laufendeNummer = 0;

/** Ein entschiedener Vorgang mit vorgegebener Wartezeit. */
async function vorgang(optionen: {
  status: 'VERIFIED' | 'REJECTED' | 'EXPIRED';
  beigetreten: Date;
  wartetSekunden: number;
  durchAi?: boolean;
}): Promise<void> {
  laufendeNummer += 1;
  await prisma.verificationRequest.create({
    data: {
      guildId: GUILD,
      discordId: `10000000000000${String(1000 + laufendeNummer)}`,
      status: optionen.status,
      joinedAt: optionen.beigetreten,
      decidedAt: new Date(optionen.beigetreten.getTime() + optionen.wartetSekunden * 1000),
      decidedBy: optionen.durchAi ? 'AI' : 'HUMAN',
    },
  });
}

/** Ein Vorgang, der noch offen ist. */
async function offen(beigetreten: Date): Promise<void> {
  laufendeNummer += 1;
  await prisma.verificationRequest.create({
    data: {
      guildId: GUILD,
      discordId: `10000000000000${String(1000 + laufendeNummer)}`,
      status: 'WAITING_FOR_REVIEW',
      joinedAt: beigetreten,
    },
  });
}

describeWithDatabase('Verifikation: Kennzahlen über den Gesamtbestand', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE "VerificationRequest" RESTART IDENTITY CASCADE');
    laufendeNummer = 0;
  });

  it('zählt alle jemals verifizierten Vorgänge, nicht nur die von heute', async () => {
    // Der Fall aus der Anforderung: heute 2, historisch 150.
    for (let i = 0; i < 2; i += 1) {
      await vorgang({ status: 'VERIFIED', beigetreten: JETZT, wartetSekunden: 60 });
    }
    for (let i = 0; i < 148; i += 1) {
      await vorgang({ status: 'VERIFIED', beigetreten: TAG(5 + (i % 20)), wartetSekunden: 60 });
    }

    const zahlen = await verification.kennzahlen(JETZT);
    expect(zahlen.gesamtVerifiziert).toBe(150);
  });

  it('zählt alle jemals abgelehnten Vorgänge', async () => {
    await vorgang({ status: 'REJECTED', beigetreten: JETZT, wartetSekunden: 60 });
    await vorgang({ status: 'REJECTED', beigetreten: TAG(30), wartetSekunden: 60 });
    await vorgang({ status: 'REJECTED', beigetreten: TAG(90), wartetSekunden: 60 });

    expect((await verification.kennzahlen(JETZT)).gesamtAbgelehnt).toBe(3);
  });

  it('trennt Freischaltung und Ablehnung sauber', async () => {
    await vorgang({ status: 'VERIFIED', beigetreten: TAG(10), wartetSekunden: 60 });
    await vorgang({ status: 'REJECTED', beigetreten: TAG(10), wartetSekunden: 60 });
    // Abgelaufen ist weder das eine noch das andere.
    await vorgang({ status: 'EXPIRED', beigetreten: TAG(10), wartetSekunden: 900 });

    const zahlen = await verification.kennzahlen(JETZT);
    expect(zahlen.gesamtVerifiziert).toBe(1);
    expect(zahlen.gesamtAbgelehnt).toBe(1);
  });

  it('weist den Anteil der AI über den Gesamtbestand aus', async () => {
    await vorgang({ status: 'VERIFIED', beigetreten: TAG(40), wartetSekunden: 60, durchAi: true });
    await vorgang({ status: 'VERIFIED', beigetreten: TAG(40), wartetSekunden: 60, durchAi: true });
    await vorgang({ status: 'VERIFIED', beigetreten: TAG(40), wartetSekunden: 60 });

    const zahlen = await verification.kennzahlen(JETZT);
    expect(zahlen.gesamtVerifiziert).toBe(3);
    expect(zahlen.gesamtAiVerifiziert).toBe(2);
  });

  // --- Wartezeit ------------------------------------------------------------

  it('mittelt die Wartezeit über die gesamte Historie', async () => {
    // 60 s, 120 s, 300 s über drei verschiedene Tage → Schnitt 160 s.
    await vorgang({ status: 'VERIFIED', beigetreten: TAG(1), wartetSekunden: 60 });
    await vorgang({ status: 'VERIFIED', beigetreten: TAG(20), wartetSekunden: 120 });
    await vorgang({ status: 'REJECTED', beigetreten: TAG(60), wartetSekunden: 300 });

    const zahlen = await verification.kennzahlen(JETZT);
    expect(zahlen.schnittWartezeit).toBe(160);
    expect(zahlen.medianWartezeit).toBe(120);
    expect(zahlen.schnittBasis).toBe(3);
  });

  it('lässt offene Vorgänge aus dem Durchschnitt heraus', async () => {
    /*
     * Ihre Wartezeit steht noch nicht fest. Würde die bisher verstrichene
     * Zeit mitgerechnet, verschöbe sich der Schnitt mit jeder Minute, in der
     * niemand entscheidet - eine Zahl, die sich ändert, ohne dass etwas
     * geschehen ist.
     */
    await vorgang({ status: 'VERIFIED', beigetreten: TAG(1), wartetSekunden: 100 });
    await offen(TAG(30));

    const zahlen = await verification.kennzahlen(JETZT);
    expect(zahlen.schnittWartezeit).toBe(100);
    expect(zahlen.schnittBasis).toBe(1);
  });

  it('lässt abgelaufene Vorgänge aus dem Durchschnitt heraus', async () => {
    // Ein Ablauf ist keine Bearbeitungszeit, sondern eine Frist.
    await vorgang({ status: 'VERIFIED', beigetreten: TAG(1), wartetSekunden: 100 });
    await vorgang({ status: 'EXPIRED', beigetreten: TAG(1), wartetSekunden: 900 });

    expect((await verification.kennzahlen(JETZT)).schnittWartezeit).toBe(100);
  });

  it('sagt «nichts entschieden» statt einer erfundenen Null', async () => {
    await offen(TAG(2));

    const zahlen = await verification.kennzahlen(JETZT);
    expect(zahlen.schnittWartezeit).toBeNull();
    expect(zahlen.medianWartezeit).toBeNull();
    expect(zahlen.schnittBasis).toBe(0);
  });

  it('bleibt auch über 1000 Fälle hinaus richtig', async () => {
    /*
     * Die vorige Fassung holte höchstens 1000 Zeilen und rechnete in
     * JavaScript. Für einen Tag ging das auf; über die ganze Historie wäre
     * ab Zeile 1001 stillschweigend eine falsche Zahl herausgekommen.
     */
    const daten = Array.from({ length: 1200 }, (__, i) => ({
      guildId: GUILD,
      discordId: `2000000000000${String(100000 + i)}`,
      status: 'VERIFIED' as const,
      joinedAt: TAG(1),
      // 1200 Fälle mit exakt 200 s - ein Schnitt, der nur stimmt, wenn alle
      // gezählt wurden.
      decidedAt: new Date(TAG(1).getTime() + 200_000),
      decidedBy: 'HUMAN' as const,
    }));
    await prisma.verificationRequest.createMany({ data: daten });

    const zahlen = await verification.kennzahlen(JETZT);
    expect(zahlen.gesamtVerifiziert).toBe(1200);
    expect(zahlen.schnittBasis).toBe(1200);
    expect(zahlen.schnittWartezeit).toBe(200);
  });

  it('erfindet keine Historie, wenn es keine gibt', async () => {
    const zahlen = await verification.kennzahlen(JETZT);
    expect(zahlen.gesamtVerifiziert).toBe(0);
    expect(zahlen.gesamtAbgelehnt).toBe(0);
  });
});
