/**
 * Eine Mission abschliessen.
 *
 * ## Warum der Abschluss nur einmal stattfindet
 *
 * Der Uebergang nach ABGESCHLOSSEN ist die Stelle, an der Belohnungen
 * entstehen. Er laeuft deshalb nicht als «lesen, pruefen, schreiben»,
 * sondern als **eine bedingte Schreiboperation**:
 *
 *     updateMany({ where: { id, status: LAEUFT }, data: { status: ABGESCHLOSSEN } })
 *
 * Die Datenbank sperrt die Zeile fuer die Dauer der Operation. Von zwei
 * gleichzeitigen Durchgaengen bekommt genau einer `count: 1` und macht
 * weiter; der andere bekommt `0` und geht. Kein Vorrechnen in der Anwendung,
 * keine Sperrtabelle, kein Zeitfenster, in dem beide «laeuft noch» lesen.
 *
 * Die Belohnung selbst ist danach noch einmal einzeln gesichert (siehe
 * `belohnung.ts`). Zwei Riegel fuer dieselbe Zusage - der zweite traegt
 * auch dann, wenn spaeter jemand von Hand nachfasst.
 */
import { AUDIT_ACTIONS, prisma, safeRecordAudit } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { MISSIONS_MODULE_ID } from './config';
import { belohne, type VergabeErgebnis } from './belohnung';
import { schreibeStandFort } from './fortschritt';

const log = createLogger('missions:abschluss');

export interface AbschlussErgebnis {
  missionId: string;
  /** Hat **dieser** Durchgang abgeschlossen? `false` heisst: jemand war schneller. */
  abgeschlossen: boolean;
  /** Bei einer Challenge: wurde das gemeinsame Ziel erreicht? */
  zielErreicht: boolean;
  /** Der erreichte Stand - je Mitglied bei WOCHE, als Summe bei CHALLENGE. */
  stand: number;
  belohnt: VergabeErgebnis[];
}

/**
 * Wer eine Mission erfuellt hat.
 *
 * Bei einer **Wochenmission** jeder, der das Ziel selbst erreicht hat.
 *
 * Bei einer **Community Challenge** zuerst die Frage, ob die Summe das Ziel
 * erreicht hat - und wenn ja, wer genug beigetragen hat. Der Mindestbeitrag
 * ist die Antwort darauf, dass sonst jedes Servermitglied belohnt wuerde,
 * das in der Woche einmal «hi» geschrieben hat, waehrend zwanzig andere die
 * Challenge getragen haben.
 */
export function berechtigte(
  art: 'WOCHE' | 'CHALLENGE',
  ziel: number,
  mindestBeitrag: number,
  werte: Map<string, number>,
  summe: number,
): { zielErreicht: boolean; ids: string[] } {
  if (art === 'WOCHE') {
    const ids = [...werte].filter(([, wert]) => wert >= ziel).map(([id]) => id);
    return { zielErreicht: ids.length > 0, ids };
  }

  if (summe < ziel) {
    return { zielErreicht: false, ids: [] };
  }

  /*
   * `Math.max(1, ...)` statt der rohen Einstellung: ein Mindestbeitrag von 0
   * hiesse, dass auch belohnt wird, wer nichts getan hat. Die Eingabe im
   * Dashboard laesst das schon nicht zu; hier steht es noch einmal, weil
   * eine Zeile aus einer frueheren Version eine 0 tragen koennte.
   */
  const schwelle = Math.max(1, mindestBeitrag);
  const ids = [...werte].filter(([, wert]) => wert >= schwelle).map(([id]) => id);
  return { zielErreicht: true, ids };
}

/**
 * Eine faellige Mission abschliessen.
 *
 * Gibt `abgeschlossen: false` zurueck, wenn ein anderer Durchgang schneller
 * war - kein Fehler, sondern der Normalfall bei zwei Workern.
 */
export async function schliesseAb(missionId: string, jetzt = new Date()): Promise<AbschlussErgebnis> {
  const leer: AbschlussErgebnis = {
    missionId,
    abgeschlossen: false,
    zielErreicht: false,
    stand: 0,
    belohnt: [],
  };

  const mission = await prisma.mission.findUnique({ where: { id: missionId } });
  if (!mission || mission.status !== 'LAEUFT') {
    return leer;
  }

  /*
   * Ein letztes Mal messen, bevor der Riegel faellt.
   *
   * Zwischen dem letzten Durchgang und dem Ende koennen Minuten liegen, und
   * was in dieser Zeit passiert ist, gehoert noch zur Mission. Wer um 23:58
   * die letzten zehn Minuten Voice geschafft hat, soll sie zaehlen sehen.
   */
  const stand = await schreibeStandFort(mission, jetzt);

  /*
   * Der Riegel. Ab hier hat genau ein Durchgang das Recht zu belohnen.
   */
  const gewonnen = await prisma.mission.updateMany({
    where: { id: missionId, status: 'LAEUFT' },
    data: { status: 'ABGESCHLOSSEN', abgeschlossenAm: jetzt },
  });
  if (gewonnen.count !== 1) {
    log.info('Abschluss lief bereits', { missionId });
    return leer;
  }

  const { zielErreicht, ids } = berechtigte(
    mission.art,
    mission.ziel,
    mission.mindestBeitrag,
    stand.werte,
    stand.summe,
  );

  const belohnt: VergabeErgebnis[] = [];
  if (zielErreicht) {
    for (const discordId of ids) {
      /*
       * Nacheinander, nicht parallel. Jede Vergabe schreibt XP, ein Abo und
       * eine Auszeichnung; zweihundert davon gleichzeitig waeren
       * zweihundert Transaktionen auf denselben Tabellen. Der Abschluss
       * laeuft einmal pro Woche und darf eine Minute dauern.
       */
      const ergebnis = await belohne(
        mission.id,
        mission.titel,
        discordId,
        {
          xp: mission.belohnungXp,
          premiumTage: mission.belohnungPremiumTage,
          auszeichnung: mission.belohnungAuszeichnung,
        },
        jetzt,
      ).catch((error: unknown) => {
        log.warn('Belohnung fehlgeschlagen', { missionId, discordId, error });
        return null;
      });
      if (ergebnis) {
        belohnt.push(ergebnis);
      }
    }
  }

  /*
   * Ein Eintrag je Mission, nicht je Mitglied und nicht je Fortschritt.
   *
   * Das Protokoll ist die Chronik der Entscheidungen des Teams; ein
   * Fortschrittsbalken ist keine. Was hier stehen muss, ist die eine
   * Entscheidung, die das System getroffen hat: welche Mission endete, ob
   * das Ziel erreicht wurde und wie viele belohnt wurden.
   */
  await safeRecordAudit({
    action: AUDIT_ACTIONS.MISSION_ABGESCHLOSSEN,
    module: MISSIONS_MODULE_ID,
    actorDiscordId: null,
    actorUsername: null,
    targetLabel: mission.titel,
    success: zielErreicht,
    metadata: {
      missionId: mission.id,
      art: mission.art,
      typ: mission.typ,
      ziel: mission.ziel,
      stand: mission.art === 'CHALLENGE' ? stand.summe : stand.werte.size,
      zielErreicht,
      belohnt: belohnt.length,
    },
  });

  return {
    missionId,
    abgeschlossen: true,
    zielErreicht,
    stand: mission.art === 'CHALLENGE' ? stand.summe : stand.werte.size,
    belohnt,
  };
}
