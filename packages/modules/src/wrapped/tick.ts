import { prisma } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { kuendigeWrappedAn } from './ankuendigung';
import { verarbeiteStapel } from './momentaufnahme';

const log = createLogger('wrapped:tick');

/**
 * Der Durchgang, der die Momentaufnahmen erzeugt.
 *
 * ## Warum im Bot und nicht in der Anfrage
 *
 * Sechstausend Momentaufnahmen dauern Minuten. Eine HTTP-Anfrage, die so
 * lange offen bleibt, laeuft in jedes Zeitlimit zwischen Browser, Proxy und
 * Server - und beim ersten davon waere der Durchgang weg. Im Bot ist er ein
 * Job wie jeder andere: er laeuft, bis er fertig ist, und ein Neustart setzt
 * ihn fort.
 *
 * ## Warum mehrere Stapel je Aufruf
 *
 * Ein Stapel je Minute waere bei sechzig Stapeln eine Stunde. Der Job
 * arbeitet deshalb, solange er darf, und gibt danach ab - der naechste
 * Durchgang macht weiter. Die Zeitscheibe ist grosszuegig genug, um
 * voranzukommen, und kurz genug, dass der Job nicht die ganze Schleife des
 * Bots blockiert.
 */

/** Wie lange ein Aufruf hoechstens arbeitet. */
const ZEITSCHEIBE_MS = 25_000;

export interface WrappedTickErgebnis {
  stapel: number;
  verarbeitet: number;
  fertig: boolean;
  /** Ob in diesem Durchgang eine Ankuendigung nach Discord ging. */
  angekuendigt: boolean;
}

/**
 * Die Ankuendigung nachholen.
 *
 * ## Warum nicht beim Veroeffentlichen selbst
 *
 * Weil das in der WebApp geschieht und die keinen Discord-Client hat, der
 * fuer eine solche Nachricht zustaendig waere. Vor allem aber: haenge die
 * Ankuendigung am Knopfdruck, dann entscheidet ein Netzwerkfehler in genau
 * dieser Sekunde darueber, ob sechstausend Leute je erfahren, dass es ihren
 * Rueckblick gibt.
 *
 * Hier ist sie ein Zustand statt eines Ereignisses: «veroeffentlicht und
 * noch nicht angekuendigt» wird beim naechsten Durchlauf nachgeholt, und
 * beim uebernaechsten wieder, bis es geklappt hat. Genau einmal gesendet
 * wird trotzdem - darum kuemmert sich `kuendigeWrappedAn`.
 */
async function holeAnkuendigungNach(): Promise<boolean> {
  const offen = await prisma.wrappedCampaign.findFirst({
    where: {
      status: 'PUBLISHED',
      announceEnabled: true,
      announcementMessageId: null,
      announcementChannelId: { not: null },
    },
    orderBy: { publishedAt: 'asc' },
  });
  return offen ? kuendigeWrappedAn(offen) : false;
}

export async function runWrappedTick(jetzt = () => Date.now()): Promise<WrappedTickErgebnis> {
  const angekuendigt = await holeAnkuendigungNach();

  const run = await prisma.wrappedGenerationRun.findFirst({
    where: { status: { in: ['QUEUED', 'RUNNING'] } },
    orderBy: { createdAt: 'asc' },
  });
  if (!run) {
    return { stapel: 0, verarbeitet: 0, fertig: true, angekuendigt };
  }

  const beginn = jetzt();
  let stapel = 0;
  let vorher = run.processed;
  let weiter = true;

  while (weiter && jetzt() - beginn < ZEITSCHEIBE_MS) {
    const ergebnis = await verarbeiteStapel(run.id);
    weiter = ergebnis.weiter;
    stapel += 1;
    vorher = ergebnis.fortschritt.processed;
  }

  log.info('Wrapped-Momentaufnahmen fortgeschrieben', {
    runId: run.id,
    stapel,
    verarbeitet: vorher,
    fertig: !weiter,
  });
  return { stapel, verarbeitet: vorher, fertig: !weiter, angekuendigt };
}
