import { prisma } from '@swisshub/database';
import { discord as defaultDiscord, type DiscordGateway } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { CLIPS_MODULE_ID } from './config';
import { getModuleSettings } from '../module-state';
import { holeOderErstelleRunde, fuehreUebergaengeAus } from './wettbewerb';
import { kuendigeStartAn, kuendigeVotingAn, kuendigeGewinnerAn } from './ankuendigung';
import type { ClipsSettings } from './config';

const log = createLogger('clips:tick');

/**
 * Ein Durchgang der Zeitsteuerung.
 *
 * Drei Schritte, jeder fuer sich wiederholbar:
 *
 *   1. die Runde dieser Woche anlegen, falls es sie noch nicht gibt
 *   2. faellige Uebergaenge nachholen
 *   3. ankuendigen, was noch nicht angekuendigt ist
 *
 * Der dritte Schritt haengt bewusst **nicht** am zweiten. Waere er die Folge
 * eines Uebergangs, ginge die Ankuendigung verloren, sobald Discord im
 * falschen Moment nicht erreichbar ist - der Uebergang hat stattgefunden,
 * und die Nachricht kommt nie. So fragt jeder Durchgang neu: gibt es eine
 * Phase, zu der noch nichts gesagt wurde?
 */

/**
 * Wie lange eine Gewinner-Ankuendigung nachgeholt wird.
 *
 * Ein Bot, der zwei Stunden stand, soll den Gewinner noch verkuenden. Ein
 * Modul, das drei Wochen spaeter eingeschaltet wird, soll nicht drei alte
 * Gewinner auf einmal in den Kanal schuetten.
 *
 * Nur fuer den Gewinner. Start und Voting sind Einladungen und gelten,
 * solange ihre Phase laeuft - eine Einladung zum Einreichen ist am Mittwoch
 * genauso richtig wie am Montag.
 */
const NACHHOLFRIST_MS = 6 * 60 * 60 * 1000;

export interface TickErgebnis {
  angelegt: boolean;
  eroeffnet: number;
  zumVoting: number;
  finalisiert: number;
  angekuendigt: number;
}

export async function runClipsTick(
  guildId: string,
  jetzt = new Date(),
  gateway: DiscordGateway = defaultDiscord,
): Promise<TickErgebnis> {
  const settings = await getModuleSettings<ClipsSettings>(CLIPS_MODULE_ID);

  let angelegt = false;
  if (settings.autoCreateWeekly) {
    const vorher = await prisma.clipCompetition.count({ where: { guildId } });
    await holeOderErstelleRunde(guildId, jetzt);
    angelegt = (await prisma.clipCompetition.count({ where: { guildId } })) > vorher;
  }

  const uebergaenge = await fuehreUebergaengeAus(guildId, jetzt);
  const angekuendigt = await kuendigeOffeneAn(guildId, jetzt, gateway);

  if (
    angelegt ||
    uebergaenge.eroeffnet.length > 0 ||
    uebergaenge.zumVoting.length > 0 ||
    uebergaenge.finalisiert.length > 0 ||
    angekuendigt > 0
  ) {
    log.info('Clip-Runden fortgeschrieben', {
      angelegt,
      eroeffnet: uebergaenge.eroeffnet.length,
      zumVoting: uebergaenge.zumVoting.length,
      finalisiert: uebergaenge.finalisiert.length,
      angekuendigt,
    });
  }

  return {
    angelegt,
    eroeffnet: uebergaenge.eroeffnet.length,
    zumVoting: uebergaenge.zumVoting.length,
    finalisiert: uebergaenge.finalisiert.length,
    angekuendigt,
  };
}

/**
 * Was noch gesagt werden muss.
 *
 * Betrachtet werden nur die letzten Runden - aeltere sind erledigt.
 * Entscheidend ist die Phase, nicht der Augenblick des Uebergangs: eine
 * Einladung zum Einreichen gilt, solange eingereicht werden kann, und der
 * Aufruf zum Abstimmen, solange abgestimmt wird. Haenge die Ankuendigung am
 * Uebergang selbst, ginge sie verloren, sobald Discord in genau dieser
 * Minute nicht erreichbar ist.
 */
async function kuendigeOffeneAn(guildId: string, jetzt: Date, gateway: DiscordGateway): Promise<number> {
  const runden = await prisma.clipCompetition.findMany({
    where: { guildId, status: { in: ['SUBMISSION', 'VOTING', 'FINALIZING', 'COMPLETED'] } },
    orderBy: { number: 'desc' },
    take: 3,
  });

  let gesendet = 0;
  for (const runde of runden) {
    // Start: solange wirklich eingereicht werden kann.
    if (runde.status === 'SUBMISSION' && !runde.startMessageId && jetzt < runde.submissionEndsAt) {
      if (await kuendigeStartAn(runde, gateway)) {
        gesendet += 1;
      }
    }

    // Voting: solange wirklich abgestimmt werden kann.
    if (runde.status === 'VOTING' && !runde.votingMessageId && jetzt < runde.votingEndsAt) {
      if (await kuendigeVotingAn(runde, gateway)) {
        gesendet += 1;
      }
    }

    /*
     * Der Gewinner ist keine Einladung, sondern ein Ereignis.
     *
     * Er wird deshalb nur kurz nach dem Abschluss verkuendet. Eine Meldung
     * ueber den Gewinner der vorletzten Woche kommt zu spaet, um noch etwas
     * zu bedeuten.
     */
    const frischAbgeschlossen =
      runde.finalizedAt !== null && jetzt.getTime() - runde.finalizedAt.getTime() <= NACHHOLFRIST_MS;
    if (runde.status === 'COMPLETED' && !runde.winnerMessageId && frischAbgeschlossen) {
      if (await kuendigeGewinnerAn(runde, gateway)) {
        gesendet += 1;
      }
    }
  }
  return gesendet;
}
