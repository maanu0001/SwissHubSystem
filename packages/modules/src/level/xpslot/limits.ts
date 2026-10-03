import type { Prisma } from '@swisshub/database';
import type { WirksameWerte } from './konfiguration';

/**
 * Was zum Lesen des Stands genuegt.
 *
 * Eine Transaktion **und** der gewoehnliche Client erfuellen das. Ohne diesen
 * Typ stuende an der Lesestelle ein `as unknown as`, und ein Cast ist keine
 * Begruendung - hier steht, was wirklich gebraucht wird.
 */
export type StandLeser = Pick<Prisma.TransactionClient, 'xpSlotDaily' | 'xpSlotSession'>;

/**
 * Die Grenzen, die der Slot durchsetzt.
 *
 * ## Warum serverseitig und nicht im Browser
 *
 * Weil eine Grenze, die nur die Oberflaeche kennt, keine Grenze ist. Jeder
 * Spin geht durch `pruefeGrenzen`, und zwar innerhalb der Transaktion, in der
 * auch gebucht wird - sonst waere zwischen Pruefung und Buchung Platz fuer den
 * Spin, der die Grenze ueberschreitet.
 *
 * ## Warum Tag und Sitzung getrennt
 *
 * Sie beantworten verschiedene Fragen. Der Tag begrenzt, wie viel jemand an
 * einem Tag verlieren oder gewinnen kann - das ist der Schutz. Die Sitzung
 * begrenzt, wie lange jemand in einem Zug durchspielt, und die Pause danach
 * ist eine Unterbrechung, kein Verbot. Beide Grenzen sind einstellbar und
 * beide sind standardmaessig **aus**: eine Grenze, die niemand gesetzt hat,
 * soll nicht aus dem Code kommen.
 *
 * `0` heisst durchgehend «keine Grenze». Das ist bewusst dieselbe Bedeutung
 * wie im Datenmodell, damit niemand `null` und `0` unterscheiden muss.
 */

/** Der Tag in UTC, auf Mitternacht geschnitten. */
export function tagesschluessel(jetzt: Date): Date {
  return new Date(Date.UTC(jetzt.getUTCFullYear(), jetzt.getUTCMonth(), jetzt.getUTCDate()));
}

export interface GrenzStand {
  /** Verlust des Tages: Einsatz minus Gewinn, nie negativ. */
  tagesverlust: number;
  tagesgewinn: number;
  spinsHeute: number;
  spinsInSitzung: number;
  /** Wie viele Sekunden die Pause noch laeuft. `0` = keine Pause. */
  pauseSekunden: number;
}

export interface GrenzErgebnis {
  ok: boolean;
  grund: string | null;
  stand: GrenzStand;
}

/**
 * Liest den Stand und entscheidet, ob ein weiterer Spin erlaubt ist.
 *
 * `einsatz` ist der Einsatz des naechsten Spins: die Tagesverlustgrenze ist
 * sonst erst ueberschritten, wenn sie schon ueberschritten ist. Ein Freispiel
 * uebergibt `0` - es kostet nichts und kann keine Verlustgrenze reissen.
 */
export async function pruefeGrenzen(
  tx: StandLeser,
  discordId: string,
  einsatz: number,
  wirksam: WirksameWerte,
  jetzt: Date,
): Promise<GrenzErgebnis> {
  const tag = tagesschluessel(jetzt);
  const [heute, sitzung] = await Promise.all([
    tx.xpSlotDaily.findUnique({ where: { discordId_day: { discordId, day: tag } } }),
    tx.xpSlotSession.findUnique({ where: { discordId } }),
  ]);

  const gesetzt = heute?.staked ?? 0;
  const gewonnen = heute?.won ?? 0;
  const verlust = Math.max(0, gesetzt - gewonnen);
  const netto = Math.max(0, gewonnen - gesetzt);

  /*
   * Die Sitzung endet nicht, sie laeuft aus.
   *
   * Es gibt keinen Knopf «Sitzung beenden» und keinen Job, der sie schliesst:
   * wer die Sitzungsgrenze erreicht, macht die eingestellte Pause, und danach
   * beginnt die Sitzung von vorne. Eine Sitzung, die ein Job beendet, waere
   * eine Sitzung, die nach einem Neustart des Bots nie endet.
   */
  const pauseMs = wirksam.sitzungspauseSekunden * 1000;
  const seitLetztem = sitzung ? jetzt.getTime() - sitzung.lastSpinAt.getTime() : Number.MAX_SAFE_INTEGER;
  const sitzungAbgelaufen = pauseMs > 0 && seitLetztem >= pauseMs;
  const spinsInSitzung = sitzung && !sitzungAbgelaufen ? sitzung.spins : 0;

  const stand: GrenzStand = {
    tagesverlust: verlust,
    tagesgewinn: netto,
    spinsHeute: heute?.spins ?? 0,
    spinsInSitzung,
    pauseSekunden: 0,
  };

  if (wirksam.maxTagesverlust > 0 && verlust + einsatz > wirksam.maxTagesverlust) {
    return {
      ok: false,
      grund: `Für heute ist deine Verlustgrenze von ${wirksam.maxTagesverlust} XP erreicht. Morgen geht es weiter.`,
      stand,
    };
  }
  if (wirksam.maxTagesgewinn > 0 && netto >= wirksam.maxTagesgewinn) {
    return {
      ok: false,
      grund: `Du hast heute die Gewinngrenze von ${wirksam.maxTagesgewinn} XP erreicht. Morgen geht es weiter.`,
      stand,
    };
  }
  if (wirksam.maxSpinsJeSitzung > 0 && spinsInSitzung >= wirksam.maxSpinsJeSitzung) {
    if (pauseMs > 0) {
      const verbleibend = Math.max(0, Math.ceil((pauseMs - seitLetztem) / 1000));
      return {
        ok: false,
        grund: `${wirksam.maxSpinsJeSitzung} Spins in einer Sitzung sind genug. Mach ${minuten(verbleibend)} Pause.`,
        stand: { ...stand, pauseSekunden: verbleibend },
      };
    }
    return {
      ok: false,
      grund: `${wirksam.maxSpinsJeSitzung} Spins in einer Sitzung sind genug.`,
      stand,
    };
  }

  return { ok: true, grund: null, stand };
}

function minuten(sekunden: number): string {
  if (sekunden < 60) {
    return `${sekunden} Sekunden`;
  }
  const wert = Math.ceil(sekunden / 60);
  return wert === 1 ? 'eine Minute' : `${wert} Minuten`;
}

/**
 * Schreibt den Stand nach einem Spin fort.
 *
 * Ein Freispiel zaehlt als Spin und als Gewinn, aber nicht als Einsatz - es
 * hat keinen. Wuerde es als Einsatz zaehlen, waeren Freispiele der schnellste
 * Weg in die Tagesverlustgrenze.
 */
export async function schreibeStand(
  tx: Prisma.TransactionClient,
  discordId: string,
  einsatz: number,
  gewinn: number,
  jetzt: Date,
  sitzungNeu: boolean,
): Promise<void> {
  const tag = tagesschluessel(jetzt);
  await tx.xpSlotDaily.upsert({
    where: { discordId_day: { discordId, day: tag } },
    create: { discordId, day: tag, spins: 1, staked: einsatz, won: gewinn },
    update: { spins: { increment: 1 }, staked: { increment: einsatz }, won: { increment: gewinn } },
  });

  if (sitzungNeu) {
    await tx.xpSlotSession.upsert({
      where: { discordId },
      create: {
        discordId,
        startedAt: jetzt,
        lastSpinAt: jetzt,
        spins: 1,
        staked: einsatz,
        won: gewinn,
        bestWin: gewinn,
      },
      update: {
        startedAt: jetzt,
        lastSpinAt: jetzt,
        spins: 1,
        staked: einsatz,
        won: gewinn,
        bestWin: gewinn,
      },
    });
    return;
  }

  const vorhanden = await tx.xpSlotSession.findUnique({ where: { discordId } });
  await tx.xpSlotSession.upsert({
    where: { discordId },
    create: {
      discordId,
      startedAt: jetzt,
      lastSpinAt: jetzt,
      spins: 1,
      staked: einsatz,
      won: gewinn,
      bestWin: gewinn,
    },
    update: {
      lastSpinAt: jetzt,
      spins: { increment: 1 },
      staked: { increment: einsatz },
      won: { increment: gewinn },
      bestWin: Math.max(vorhanden?.bestWin ?? 0, gewinn),
    },
  });
}
