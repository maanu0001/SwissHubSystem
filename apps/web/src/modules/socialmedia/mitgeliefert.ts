import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createLogger } from '@swisshub/logger';

const log = createLogger('web:socialmedia-mitgeliefert');

/**
 * Dateien, die mit der Anwendung ausgeliefert werden - Schriften und Signet.
 *
 * ## Warum das eine eigene Datei ist
 *
 * Weil beide dasselbe Problem haben und es sonst zweimal geloest wuerde: sie
 * liegen im Repository, werden zur Laufzeit als **Bytes** gebraucht, und das
 * Arbeitsverzeichnis ist nicht ueberall dasselbe. Im Container startet die
 * WebApp als npm-Workspace, `process.cwd()` ist dann `apps/web`; ein Test
 * laeuft aus der Wurzel. Deshalb wird nicht ein Pfad geraten, sondern eine
 * kurze Liste von Kandidaten probiert - der erste, der sich lesen laesst,
 * gewinnt.
 *
 * ## Warum nicht nachladen
 *
 * Der Produktionsserver hat bewusst keinen freien Ausgang ins Netz, und ein
 * Export, der auf eine fremde Antwort wartet, waehrend jemand auf eine Datei
 * wartet, waere die falsche Abhaengigkeit (§37). Die Bytes liegen hier.
 */

/** Gelesen wird einmal je Prozess - ein Export soll nicht die Platte anfassen. */
const zwischenspeicher = new Map<string, Promise<Buffer>>();

/*
 * Die Wurzeln, unter denen `public/` liegen kann.
 *
 * `apps/web` zuerst: das ist der Laufzeitfall, und der soll nicht erst einen
 * Fehlversuch kosten.
 */
const WURZELN = ['.', 'apps/web', '../..'] as const;

async function lies(relativ: string): Promise<Buffer> {
  const fehler: string[] = [];
  for (const wurzel of WURZELN) {
    const pfad = resolve(join(process.cwd(), wurzel, 'public', relativ));
    try {
      return await readFile(pfad);
    } catch (error) {
      fehler.push(`${pfad}: ${(error as NodeJS.ErrnoException).code ?? 'Fehler'}`);
    }
  }
  throw new Error(`Mitgelieferte Datei «${relativ}» nicht gefunden - versucht: ${fehler.join(', ')}`);
}

function gepuffert(relativ: string): Promise<Buffer> {
  const vorhanden = zwischenspeicher.get(relativ);
  if (vorhanden) {
    return vorhanden;
  }
  const lauf = lies(relativ);
  zwischenspeicher.set(relativ, lauf);
  // Ein Fehlschlag darf sich nicht festsetzen: liegt die Datei beim naechsten
  // Versuch da, soll sie gelesen werden und nicht ein alter Fehler kommen.
  lauf.catch(() => zwischenspeicher.delete(relativ));
  return lauf;
}

// --- Schriften ---------------------------------------------------------------

export const SCHRIFT = 'Inter';

/**
 * Die drei Schnitte, mit denen die Posts gesetzt sind.
 *
 * ## Warum sie ueberhaupt mitkommen muessen
 *
 * `next/og` bringt genau **eine** Schriftdatei mit, Noto Sans Regular. Ohne
 * eigene Schnitte wird `fontWeight: 800` nicht etwa genaehert, sondern
 * stillschweigend ignoriert - gemessen: derselbe Text in 400 und in 800 ergab
 * byteweise dasselbe PNG. Eine Ueberschrift unterschied sich von ihrem
 * Fliesstext damit nur in der Groesse, und das ist der Grund, aus dem die
 * Grafiken flach und beliebig wirkten.
 *
 * Drei Schnitte und nicht fuenf: 400 traegt den Fliesstext, 600 die kleinen
 * Beschriftungen und Fakten, 800 die Ueberschriften. Jeder weitere waere eine
 * weitere Datei im Abbild fuer eine Stufe, die man nicht sieht.
 */
export const SCHNITTE = [400, 600, 800] as const;
export type SchriftSchnitt = (typeof SCHNITTE)[number];

export interface GeladeneSchrift {
  name: string;
  data: Buffer;
  weight: SchriftSchnitt;
  style: 'normal';
}

/**
 * Die Schriften fuer `ImageResponse`.
 *
 * Schlaegt das Lesen fehl, wird **nicht** geworfen: ein Post in der falschen
 * Schrift ist aerglich, ein Editor, der statt einer Vorschau einen Fehler
 * zeigt, ist kaputt. Der Fehlschlag steht im Log, und ein Test prueft, dass
 * die Dateien da sind und sich laden lassen - damit kann dieser Rueckfall
 * nicht unbemerkt zum Normalzustand werden.
 */
export async function ladeSchriften(): Promise<GeladeneSchrift[] | undefined> {
  try {
    return await Promise.all(
      SCHNITTE.map(async (schnitt) => ({
        name: SCHRIFT,
        data: await gepuffert(`schriften/inter-${schnitt}.ttf`),
        weight: schnitt,
        style: 'normal' as const,
      })),
    );
  } catch (error) {
    log.error('Schriften fuer den Post-Export nicht lesbar - es gilt die Standardschrift', { error });
    return undefined;
  }
}

// --- Signet ------------------------------------------------------------------

/**
 * Das SwissHub-Signet als `data:`-URI.
 *
 * Satori wuerde eine Adresse abrufen; die Bytes stehen deshalb fertig in der
 * `src`. `null` heisst «nicht lesbar» - gezeichnet wird dann die Wortmarke,
 * und der Post bleibt ein Post.
 */
export async function ladeSignet(): Promise<string | null> {
  try {
    const bytes = await gepuffert('branding/swisshub-logo.png');
    return `data:image/png;base64,${bytes.toString('base64')}`;
  } catch (error) {
    log.error('SwissHub-Signet nicht lesbar - es gilt die gezeichnete Wortmarke', { error });
    return null;
  }
}
