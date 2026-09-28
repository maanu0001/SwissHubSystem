/**
 * Ein Durchgang der Zeitsteuerung.
 *
 * Drei Schritte, jeder fuer sich wiederholbar:
 *
 *   1. geplante Missionen starten, deren Beginn erreicht ist
 *   2. den Fortschritt der laufenden Missionen fortschreiben
 *   3. faellige Missionen abschliessen und belohnen
 *
 * ## Kein eigener Scheduler
 *
 * Dieser Durchgang laeuft im bestehenden Job-Runner des Bots, wie die
 * Clips, SwissHub fragt und die Turniere. Keine zweite Zeitsteuerung, kein
 * `setTimeout`, das einen Neustart nicht ueberlebt. Die Datenbank bleibt
 * Source of Truth: was waehrend eines Ausfalls faellig wurde, wird beim
 * naechsten Durchgang nachgeholt.
 *
 * ## Warum der Fortschritt nicht jede Minute laeuft
 *
 * Schritt 2 fragt je laufender Mission eine Aggregation ueber eine grosse
 * Tabelle. Jede Minute waere das sechzigmal in der Stunde eine Arbeit, deren
 * Ergebnis sich in derselben Stunde kaum aendert - niemand sammelt sechzig
 * Voice-Minuten in sechzig Minuten.
 *
 * Alle fuenf Minuten reicht: ein Fortschrittsbalken, der hoechstens fuenf
 * Minuten hinterherhinkt, ist einer, dem niemand beim Altern zusieht. Die
 * Minute wird aus dem Zeitstempel abgeleitet und nicht gemerkt - ein Zaehler
 * im Speicher waere nach jedem Neustart auf Null.
 *
 * Schritt 1 und 3 laufen dagegen jede Minute: «endet um 20:00» heisst 20:00,
 * und in der Minute danach soll die Belohnung stehen. Schritt 3 misst vor
 * dem Abschluss ohnehin noch einmal - der letzte Stand ist also immer
 * genau, unabhaengig vom Fuenf-Minuten-Takt.
 */
import { prisma } from '@swisshub/database';
import { discord as defaultDiscord, type DiscordGateway } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { schliesseAb } from './abschluss';
import { kuendigeAbschlussAn, kuendigeStartAn } from './ankuendigung';
import { schreibeStandFort } from './fortschritt';

const log = createLogger('missions:tick');

/** Wie oft der Fortschritt fortgeschrieben wird. Siehe oben. */
const FORTSCHRITT_TAKT_MINUTEN = 5;

export interface MissionsTickErgebnis {
  gestartet: number;
  fortgeschrieben: number;
  abgeschlossen: number;
  belohnt: number;
  angekuendigt: number;
}

export async function runMissionsTick(
  guildId: string,
  jetzt = new Date(),
  gateway: DiscordGateway = defaultDiscord,
): Promise<MissionsTickErgebnis> {
  const ergebnis: MissionsTickErgebnis = {
    gestartet: 0,
    fortgeschrieben: 0,
    abgeschlossen: 0,
    belohnt: 0,
    angekuendigt: 0,
  };

  // --- 1. Was faellig ist, beginnt -----------------------------------------
  const zuStarten = await prisma.mission.findMany({
    where: { guildId, status: 'GEPLANT', beginntAm: { lte: jetzt } },
  });
  for (const mission of zuStarten) {
    /*
     * Bedingt, damit von zwei Durchgaengen nur einer startet - und damit
     * nur einer ankuendigt. Ohne diese Bedingung stuende die Einladung
     * doppelt im Kanal.
     */
    const gewonnen = await prisma.mission.updateMany({
      where: { id: mission.id, status: 'GEPLANT' },
      data: { status: 'LAEUFT' },
    });
    if (gewonnen.count !== 1) {
      continue;
    }
    ergebnis.gestartet += 1;
    if (await kuendigeStartAn(mission, gateway)) {
      ergebnis.angekuendigt += 1;
    }
  }

  const laufende = await prisma.mission.findMany({ where: { guildId, status: 'LAEUFT' } });

  // --- 2. Der Fortschritt der laufenden ------------------------------------
  if (jetzt.getMinutes() % FORTSCHRITT_TAKT_MINUTEN === 0) {
    for (const mission of laufende) {
      if (mission.endetAm.getTime() <= jetzt.getTime()) {
        // Endet gleich - Schritt 3 misst ohnehin noch einmal.
        continue;
      }
      await schreibeStandFort(mission, jetzt).catch((error: unknown) => {
        log.warn('Fortschritt konnte nicht geschrieben werden', { missionId: mission.id, error });
        return null;
      });
      ergebnis.fortgeschrieben += 1;
    }
  }

  // --- 3. Was vorbei ist, wird abgeschlossen -------------------------------
  for (const mission of laufende) {
    if (mission.endetAm.getTime() > jetzt.getTime()) {
      continue;
    }
    const abschluss = await schliesseAb(mission.id, jetzt);
    if (!abschluss.abgeschlossen) {
      continue;
    }
    ergebnis.abgeschlossen += 1;
    ergebnis.belohnt += abschluss.belohnt.length;
    if (
      await kuendigeAbschlussAn(
        mission,
        abschluss.zielErreicht,
        abschluss.belohnt.length,
        abschluss.stand,
        gateway,
      )
    ) {
      ergebnis.angekuendigt += 1;
    }
  }

  return ergebnis;
}
