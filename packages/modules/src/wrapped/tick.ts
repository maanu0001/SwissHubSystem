import { prisma } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { kuendigeWrappedAn } from './ankuendigung';
import { istVerwaist, markiereGescheitert, verarbeiteStapel } from './momentaufnahme';
import type { WrappedGenerationRun } from '@swisshub/database';

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

/**
 * Den naechsten Lauf holen - und tote unterwegs wegraeumen.
 *
 * ## Warum das Aufraeumen hierher gehoert
 *
 * Genommen wird immer der **aelteste** offene Lauf. Das ist richtig: wer
 * zuerst bestellt hat, kommt zuerst dran. Es hat aber eine Kehrseite, die
 * lange unbemerkt blieb - ein Lauf, der nie fertig wird, steht damit fuer
 * immer vorne. Jeder Takt holte ihn, scheiterte an ihm und kam nie zu den
 * spaeteren. Ein einziger kaputter Durchgang legte die Momentaufnahmen des
 * ganzen Systems still.
 *
 * Deshalb wird hier nicht nur genommen, sondern auch geraeumt: ein Lauf ohne
 * Lebenszeichen wird geschlossen, und die Suche geht weiter. Mehr als eine
 * Handvoll je Takt nicht - sonst raeumte ein Takt statt zu arbeiten.
 */
async function naechsterLauf(): Promise<WrappedGenerationRun | null> {
  for (let versuch = 0; versuch < 5; versuch += 1) {
    const run = await prisma.wrappedGenerationRun.findFirst({
      where: { status: { in: ['QUEUED', 'RUNNING'] } },
      orderBy: { createdAt: 'asc' },
    });
    if (!run) {
      return null;
    }
    if (!istVerwaist(run)) {
      return run;
    }
    await markiereGescheitert(
      run.id,
      'Der Durchgang wurde geschlossen, weil ihn seit ueber zehn Minuten niemand fortgeschrieben hat.',
    );
  }
  return null;
}

export async function runWrappedTick(jetzt = () => Date.now()): Promise<WrappedTickErgebnis> {
  const angekuendigt = await holeAnkuendigungNach();

  const run = await naechsterLauf();
  if (!run) {
    return { stapel: 0, verarbeitet: 0, fertig: true, angekuendigt };
  }

  const beginn = jetzt();
  let stapel = 0;
  let vorher = run.processed;
  let weiter = true;

  while (weiter && jetzt() - beginn < ZEITSCHEIBE_MS) {
    /*
     * Ein Fehler beendet diesen Lauf - nicht den Takt.
     *
     * `verarbeiteStapel` schliesst einen Lauf, dessen Vorbereitung
     * scheitert, selbst als `FAILED`. Was hier noch ankommt, ist alles
     * Uebrige: ein Abriss zur Datenbank mitten im Schreiben etwa. Auch das
     * darf den Lauf nicht offen zuruecklassen, denn offen heisst: der
     * naechste Takt nimmt ihn wieder, und uebernaechste auch.
     */
    let ergebnis;
    try {
      ergebnis = await verarbeiteStapel(run.id);
    } catch (fehler) {
      const grund = fehler instanceof Error ? fehler.message : String(fehler);
      await markiereGescheitert(run.id, grund);
      log.error('Wrapped-Stapel abgebrochen', { runId: run.id, fehler });
      return { stapel, verarbeitet: vorher, fertig: true, angekuendigt };
    }
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
