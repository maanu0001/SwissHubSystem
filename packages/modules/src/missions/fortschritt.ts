/**
 * Den Stand einer Mission fortschreiben.
 *
 * ## Gerechnet, nicht mitgezaehlt
 *
 * Jeder Durchgang fragt die Quelle nach dem **vollstaendigen** Stand im
 * Zeitraum und schreibt ihn hin. Er zaehlt nichts hoch. Das ist der ganze
 * Grund, warum dieses Modul keine eigene Ereigniserfassung braucht und
 * warum ein verpasster oder ein doppelter Durchgang folgenlos bleibt:
 *
 *   - Bot stand zwei Stunden still  → der naechste Durchgang holt alles nach
 *   - zwei Worker laufen gleichzeitig → beide schreiben dieselbe Zahl
 *   - ein Ereignis kam doppelt an    → die Quelle zaehlt es einmal
 *
 * Ein mitgezaehlter Fortschritt haette fuer jeden dieser drei Faelle eine
 * eigene Vorkehrung gebraucht.
 */
import { prisma, type Prisma } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { missionTyp, type MessFenster } from './typen';

const log = createLogger('missions:fortschritt');

export interface FortschrittStand {
  /** discordId → Wert, nur Mitglieder mit einem Wert groesser null. */
  werte: Map<string, number>;
  /** Die Summe ueber alle - der Stand einer Community Challenge. */
  summe: number;
}

interface MissionFuerMessung {
  id: string;
  guildId: string;
  typ: string;
  beginntAm: Date;
  endetAm: Date;
}

/**
 * Den Stand einer Mission aus ihrer Quelle holen.
 *
 * Das Zeitfenster endet beim frueheren von «jetzt» und «Missionsende». Sonst
 * ruechte das Fenster einer bereits beendeten Mission bei jedem Aufruf
 * weiter, und ihr Ergebnis aenderte sich nach dem Abschluss noch.
 */
export async function messeStand(mission: MissionFuerMessung, jetzt = new Date()): Promise<FortschrittStand> {
  const typ = missionTyp(mission.typ);
  if (!typ) {
    /*
     * Ein Typ, den die Registry nicht kennt. Moeglich, wenn eine Mission aus
     * einer Version stammt, die einen Typ kannte, den es nicht mehr gibt.
     * Kein Absturz und keine erfundene Null-Messung, die einen Fortschritt
     * zurueckdrehen wuerde - eine leere Antwort und ein Eintrag im Log.
     */
    log.warn('Unbekannter Missionstyp', { missionId: mission.id, typ: mission.typ });
    return { werte: new Map(), summe: 0 };
  }

  const bis = jetzt.getTime() < mission.endetAm.getTime() ? jetzt : mission.endetAm;
  const fenster: MessFenster = {
    guildId: mission.guildId,
    /*
     * Typen ohne Zeitfenster bekommen eines, das alles umfasst. Sie
     * ignorieren es ohnehin; die Alternative waere ein zweiter Weg durch
     * diese Funktion, nur um ein Argument nicht zu uebergeben.
     */
    von: typ.imZeitraum ? mission.beginntAm : new Date(0),
    bis: typ.imZeitraum ? bis : bis,
  };

  const gemessen = await typ.miss(fenster);

  let summe = 0;
  const werte = new Map<string, number>();
  for (const [discordId, wert] of gemessen) {
    if (wert <= 0) {
      continue;
    }
    werte.set(discordId, wert);
    summe += wert;
  }
  return { werte, summe };
}

/**
 * Den gemessenen Stand speichern.
 *
 * In einem Rutsch je Mission, nicht je Mitglied: bei zweihundert aktiven
 * Mitgliedern waeren das zweihundert Roundtrips im Minutentakt.
 *
 * Zeilen, die es schon gibt, werden ueberschrieben; Mitglieder, die im
 * Fenster nichts mehr beitragen, behalten ihren letzten Wert. Das ist
 * richtig so - die Quelle liefert bei einem Zeitfenster immer den ganzen
 * Zeitraum, und wer diese Woche 40 Minuten hatte, hat sie am Sonntag noch.
 */
export async function speichereStand(
  missionId: string,
  werte: Map<string, number>,
  jetzt = new Date(),
): Promise<number> {
  if (werte.size === 0) {
    return 0;
  }

  const eingaben: Prisma.PrismaPromise<unknown>[] = [];
  for (const [discordId, wert] of werte) {
    eingaben.push(
      prisma.missionFortschritt.upsert({
        where: { missionId_discordId: { missionId, discordId } },
        create: { missionId, discordId, wert, aktualisiertAm: jetzt },
        update: { wert, aktualisiertAm: jetzt },
      }),
    );
  }

  await prisma.$transaction(eingaben);
  return eingaben.length;
}

/** Messen und speichern in einem Schritt. */
export async function schreibeStandFort(
  mission: MissionFuerMessung,
  jetzt = new Date(),
): Promise<FortschrittStand> {
  const stand = await messeStand(mission, jetzt);
  await speichereStand(mission.id, stand.werte, jetzt);
  return stand;
}
