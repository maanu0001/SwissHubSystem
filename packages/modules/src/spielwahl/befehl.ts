import { prisma, type Prisma } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';

const log = createLogger('spielwahl:befehl');

/**
 * Der Riegel gegen den zweiten Klick - und gegen den dritten Tab.
 *
 * ## Das Problem
 *
 * Ein Knopf, der eine Runde startet, wird gedrueckt, waehrend die Leitung
 * hakt. Nichts passiert sichtbar. Also noch einmal. Ohne Vorkehrung laufen
 * jetzt zwei Runden an, und die zweite ueberschreibt das Ergebnis der ersten.
 * Dasselbe entsteht, wenn jemand die Session in zwei Tabs offen hat oder der
 * Browser einen abgebrochenen Request selbst wiederholt.
 *
 * ## Die Loesung
 *
 * Der Aufrufer erzeugt je Handlung einen Schluessel und schickt ihn mit.
 * Eindeutig je Session. Kommt derselbe Schluessel noch einmal an, wird nicht
 * gehandelt, sondern die **erste** Antwort zurueckgegeben - der zweite Klick
 * sieht dasselbe wie der erste, und das ist genau richtig.
 *
 * ## Warum die Eindeutigkeit und nicht ein vorheriges `findFirst`
 *
 * Weil zwei gleichzeitige Anfragen beide nichts faenden und beide handelten.
 * Der Platz wird deshalb **belegt**, bevor gehandelt wird; wer dabei auf die
 * Eindeutigkeit laeuft, hat verloren und liest die Antwort des Gewinners.
 *
 * ## Und wenn die Handlung scheitert?
 *
 * Dann wird der Platz wieder freigegeben. Sonst waere ein einmaliger Fehler
 * - Netz weg, Datenbank kurz besetzt - eine dauerhafte Sperre fuer genau
 * diese Handlung, und der Knopf bliebe fuer immer wirkungslos.
 */
export interface BefehlEingabe {
  sessionId: string;
  schluessel: string;
  befehl: string;
  discordId: string;
}

const WARTE_MS = 25;
const VERSUCHE = 20;

export async function einmalig<T>(eingabe: BefehlEingabe, handlung: () => Promise<T>): Promise<T> {
  let belegt = false;

  try {
    await prisma.spielwahlCommand.create({
      data: {
        sessionId: eingabe.sessionId,
        schluessel: eingabe.schluessel,
        befehl: eingabe.befehl,
        discordId: eingabe.discordId,
      },
    });
    belegt = true;
  } catch (error) {
    if (!istEindeutigkeit(error)) {
      throw error;
    }
    return wiederhole<T>(eingabe);
  }

  try {
    const ergebnis = await handlung();
    await prisma.spielwahlCommand.updateMany({
      where: { sessionId: eingabe.sessionId, schluessel: eingabe.schluessel },
      data: { ergebnis: (ergebnis ?? null) as Prisma.InputJsonValue },
    });
    return ergebnis;
  } catch (error) {
    if (belegt) {
      /*
       * Der Platz wird freigegeben, damit ein erneuter Versuch moeglich
       * bleibt. Schlaegt auch das Aufraeumen fehl, bleibt es beim Fehler von
       * oben - der ist der interessantere.
       */
      await prisma.spielwahlCommand
        .deleteMany({ where: { sessionId: eingabe.sessionId, schluessel: eingabe.schluessel } })
        .catch(() => undefined);
    }
    throw error;
  }
}

/**
 * Die Antwort des Gewinners abholen.
 *
 * Der zweite Aufruf kann ankommen, **bevor** der erste fertig ist - dann
 * steht die Zeile schon, aber ohne Ergebnis. Statt sofort `null`
 * zurueckzugeben, wird kurz gewartet: eine halbe Sekunde in kleinen
 * Schritten. Laenger nicht; wer dann noch nichts hat, bekommt den Zustand
 * ueber den Live-Strom ohnehin nachgereicht.
 */
async function wiederhole<T>(eingabe: BefehlEingabe): Promise<T> {
  for (let versuch = 0; versuch < VERSUCHE; versuch += 1) {
    const zeile = await prisma.spielwahlCommand.findUnique({
      where: { sessionId_schluessel: { sessionId: eingabe.sessionId, schluessel: eingabe.schluessel } },
      select: { ergebnis: true },
    });
    if (!zeile) {
      // Der erste Versuch ist gescheitert und hat aufgeraeumt - der Weg ist
      // wieder frei, aber nicht fuer diesen Aufruf. Er meldet es weiter.
      break;
    }
    if (zeile.ergebnis !== null) {
      return zeile.ergebnis as T;
    }
    await new Promise((fertig) => setTimeout(fertig, WARTE_MS));
  }

  log.debug('Befehl wiederholt, ohne dass ein Ergebnis vorlag', {
    sessionId: eingabe.sessionId,
    befehl: eingabe.befehl,
  });
  return null as T;
}

function istEindeutigkeit(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';
}
