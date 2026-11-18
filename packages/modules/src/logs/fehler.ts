import { createHash } from 'node:crypto';
import { prisma } from '@swisshub/database';
import type { ErrorLogEntry, ErrorLogSource } from '@swisshub/database';
import { AppError, type AppErrorCode } from '@swisshub/shared';
import { createLogger } from '@swisshub/logger';

const log = createLogger('logs:fehler');

/**
 * Der zentrale Fehler-Log.
 *
 * ## Was er ist
 *
 * **Eine Stelle, an der jeder Fehler landet, der niemandem auffallen wuerde.**
 * Ein gescheiterter Slash-Befehl sagt dem Aufrufer «das het leider nöd
 * klappt» und verschwindet; eine gescheiterte Server Action zeigt einen Toast
 * und verschwindet. Beides steht im Serverprotokoll - und dort liest es
 * niemand, solange nicht schon jemand gemeldet hat, dass etwas kaputt ist.
 *
 * Deshalb geht ein Fehler von hier nach Discord, in den Kanal der Kategorie
 * `ERRORS`. Ist keiner eingerichtet, bleibt der Eintrag in der Tabelle - der
 * Log hoert nicht auf zu zaehlen, nur weil niemand zuhoert.
 *
 * ## Die drei Regeln, die ihn benutzbar halten
 *
 * 1. **Zusammenfassen statt melden.** Gleiche Fehler bekommen denselben
 *    `fingerprint` und damit eine Zeile. Ein kaputter Befehl, den fuenfzig
 *    Leute versuchen, ist eine Meldung mit «50×» und nicht fuenfzig
 *    Meldungen.
 * 2. **Ruhezeit.** Nach einer Meldung bleibt derselbe Fehler eine halbe
 *    Stunde still. Danach darf er sich wieder melden - sonst waere ein
 *    Fehler, der seit Tagen laeuft, irgendwann aus dem Kanal verschwunden.
 * 3. **Nur echte Fehler.** Eine fehlende Berechtigung ist kein Fehler,
 *    sondern eine Antwort. Siehe `MELDEPFLICHTIG`.
 *
 * ## Und die Regel, die ihn unbedenklich haelt
 *
 * **Nichts kommt unbereinigt hier durch.** Eine Fehlermeldung zitiert gern
 * die Anfrage, die sie ausgeloest hat - und eine Anfrage traegt Tokens,
 * Schluessel und Verbindungszeichenfolgen. `bereinige` ist deshalb nicht
 * optional, sondern der einzige Weg in die Tabelle, und ein Test haelt das
 * fest.
 *
 * ## Diese Datei wirft nie
 *
 * Sie wird aus `catch`-Bloecken aufgerufen. Ein Fehler beim Melden eines
 * Fehlers darf den urspruenglichen nicht verdecken und erst recht nicht die
 * Antwort an den Benutzer verhindern.
 */

/** Nach einer Meldung bleibt derselbe Fehler so lange still. */
export const RUHEZEIT_MS = 30 * 60_000;

/**
 * Welche `AppError`-Codes ueberhaupt gemeldet werden.
 *
 * Die ueberwiegende Mehrheit der `AppError` ist **kein** Fehler: «dir fehlt
 * die Berechtigung», «die Eingaben sind ungueltig», «zu viele Anfragen» sind
 * Antworten des Systems an einen Benutzer. Sie in einen Fehlerkanal zu
 * schreiben hiesse, ihn mit dem Normalbetrieb zu fluten - und die drei Faelle
 * darunter, die wirklich jemand ansehen muss, darin zu begraben.
 *
 * Diese drei sind es:
 *
 * - `INTERNAL` - etwas ist schiefgegangen, und niemand hat vorhergesehen, was.
 * - `CONFIGURATION_MISSING` - eine Einstellung fehlt. Der Benutzer kann
 *   nichts dafuer und nichts dagegen.
 * - `SECRET_UNREADABLE` - ein gespeichertes Geheimnis laesst sich nicht
 *   lesen. Still bleiben hiesse, eine kaputte Integration erst dann zu
 *   bemerken, wenn jemand sie braucht.
 *
 * Alles, was **kein** `AppError` ist, wird gemeldet. Ein `TypeError` ist nie
 * eine Antwort an einen Benutzer.
 */
export const MELDEPFLICHTIG: ReadonlySet<AppErrorCode> = new Set<AppErrorCode>([
  'INTERNAL',
  'CONFIGURATION_MISSING',
  'SECRET_UNREADABLE',
]);

/** Laengen, mit denen ein Embed-Feld noch zurechtkommt. */
const GRENZEN = { meldung: 500, stapel: 1200, kontextWert: 200 } as const;

/**
 * Was ersetzt wird, bevor etwas gespeichert wird.
 *
 * Jede Zeile hier ist ein Weg, auf dem ein Geheimnis in eine Fehlermeldung
 * geraet, und keine davon ist erfunden:
 *
 * - Ein Discord-Bot-Token steht in der `Authorization`-Kopfzeile, die ein
 *   gescheiterter HTTP-Aufruf gern mitzitiert.
 * - Eine Verbindungszeichenfolge steht in jeder Datenbankfehlermeldung.
 * - `?token=…` steht in URLs, die in einem Stapel auftauchen.
 *
 * Der Reihenfolge nach: erst das Benannte, dann das Allgemeine. Das
 * allgemeine Muster am Ende faengt, was uebrig bleibt - lange Zeichenfolgen
 * ohne Leerzeichen und ohne Schraegstrich. **Ohne Schraegstrich** ist dabei
 * der Punkt: mit ihm verschluckte es jeden Dateipfad im Stapel und machte
 * den Log wertlos.
 */
const MUSTER: readonly { suche: RegExp; ersatz: string }[] = [
  // Discord-Bot-Token: drei Teile, Punkt getrennt.
  { suche: /\b[\w-]{23,28}\.[\w-]{6}\.[\w-]{27,}\b/gu, ersatz: '[token]' },
  // Authorization: Bearer / Bot / Basic …
  { suche: /\b(Bearer|Bot|Basic|Token)\s+[\w.~+/=-]{8,}/giu, ersatz: '$1 [entfernt]' },
  // Verbindungszeichenfolge mit Passwort: schema://benutzer:passwort@host
  { suche: /([a-z][\w+.-]*:\/\/)[^\s:/@]+:[^\s@]+@/giu, ersatz: '$1[zugang]@' },
  // Benannter Wert: token=…, "secret": "…", apiKey: …
  {
    suche:
      /\b(token|secret|password|passwd|pwd|api[_-]?key|apikey|access[_-]?key|private[_-]?key|authorization|signature|cookie|session)\b(["']?\s*[:=]\s*["']?)[^\s,;"'&)}\]]+/giu,
    ersatz: '$1$2[entfernt]',
  },
  // E-Mail-Adressen - personenbezogen und in einem Fehlerkanal nicht noetig.
  { suche: /\b[\w.%+-]+@[\w-]+\.[\w.-]{2,}\b/gu, ersatz: '[email]' },
  // Was uebrig bleibt: lange Zeichenfolgen ohne Schraegstrich (siehe oben).
  { suche: /\b[A-Za-z0-9+_-]{40,}\b/gu, ersatz: '[lang]' },
];

/**
 * Entfernt aus einem Text, was nicht nach Discord gehoert.
 *
 * Oeffentlich, weil der Test sie direkt prueft - und weil jeder Aufrufer, der
 * selbst etwas in den Kontext legt, denselben Weg nehmen soll.
 */
export function bereinige(text: string): string {
  let ergebnis = text;
  for (const { suche, ersatz } of MUSTER) {
    ergebnis = ergebnis.replace(suche, ersatz);
  }
  return ergebnis;
}

/** Schluessel, deren Wert gar nicht erst gelesen wird. */
const HEIKLER_SCHLUESSEL =
  /token|secret|password|passwd|pwd|credential|api[_-]?key|apikey|private[_-]?key|authorization|cookie|signature|session|salt|hash/iu;

/**
 * Bereinigt einen Zusammenhang - flach und ohne Ueberraschungen.
 *
 * Nur die oberste Ebene, und jeder Wert wird zu Text. Verschachtelte Objekte
 * durchzureichen hiesse, nicht zu wissen, was man speichert: ein Aufrufer, der
 * «einfach das Request-Objekt» mitgibt, legte damit Kopfzeilen und Rumpf in
 * die Tabelle. Wer etwas aus der Tiefe braucht, benennt es selbst.
 *
 * Ein Schluessel, der nach einem Geheimnis klingt, verliert seinen Wert
 * vollstaendig - nicht bereinigt, sondern ersetzt. Bei einem Feld namens
 * `password` ist der Inhalt definitionsgemaess geheim, und kein Muster muss
 * das erst erkennen.
 */
export function bereinigeKontext(
  kontext: Record<string, unknown> | undefined,
): Record<string, string> | undefined {
  if (!kontext) {
    return undefined;
  }
  const ergebnis: Record<string, string> = {};
  for (const [schluessel, wert] of Object.entries(kontext)) {
    if (wert === undefined || wert === null) {
      continue;
    }
    if (HEIKLER_SCHLUESSEL.test(schluessel)) {
      ergebnis[schluessel] = '[entfernt]';
      continue;
    }
    const text =
      typeof wert === 'string' || typeof wert === 'number' || typeof wert === 'boolean'
        ? String(wert)
        : /*
           * Kein `JSON.stringify` ueber beliebige Tiefe.
           *
           * Es ist genau der Griff, mit dem ein ganzes Request-Objekt in die
           * Tabelle rutscht. Wer ein Feld aus einem Objekt braucht, gibt es
           * einzeln mit.
           */
          `[${typeof wert}]`;
    ergebnis[schluessel] = bereinige(text).slice(0, GRENZEN.kontextWert);
  }
  return Object.keys(ergebnis).length > 0 ? ergebnis : undefined;
}

/**
 * Was denselben Fehler zum selben Fehler macht.
 *
 * Quelle, Ort, Code und die **entstellte** Meldung. Entstellt heisst: Zahlen,
 * Kennungen und Pfade werden ersetzt, bevor gehasht wird. Sonst waere
 * «Mitglied 123 nicht gefunden» ein anderer Fehler als «Mitglied 456 nicht
 * gefunden» - zwei Zeilen, zwei Meldungen, derselbe Bug.
 *
 * Der Hash und nicht der Text, weil der Text lang ist und der Schluessel
 * eindeutig sein muss.
 */
export function fingerprintVon(eingabe: {
  source: ErrorLogSource;
  origin: string;
  code: string | null;
  message: string;
}): string {
  const entstellt = eingabe.message
    // Discord-Kennungen und andere lange Zahlen.
    .replace(/\d{5,}/gu, '#')
    // cuid/uuid und aehnliche Kennungen.
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{8,}\b/giu, '#')
    .replace(/\bc[a-z0-9]{20,}\b/giu, '#')
    // Zeilen- und Spaltenangaben eines Stapels, die in der Meldung stehen.
    .replace(/:\d+:\d+/gu, ':#:#')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 300);

  return createHash('sha256')
    .update(`${eingabe.source}|${eingabe.origin}|${eingabe.code ?? ''}|${entstellt}`)
    .digest('hex')
    .slice(0, 40);
}

export interface FehlerMeldung {
  source: ErrorLogSource;
  /** Befehlsname, Aktionsname oder Pfad - kurz und wiedererkennbar. */
  origin: string;
  /** Der gefangene Fehler, unveraendert. */
  fehler: unknown;
  /** Wen es getroffen hat - nur die Kennung. */
  actorDiscordId?: string | null;
  /** Weiterer Zusammenhang. Flach; siehe `bereinigeKontext`. */
  kontext?: Record<string, unknown>;
}

/** Der Code eines Fehlers - `AppErrorCode`, sonst der Klassenname. */
function codeVon(fehler: unknown): string | null {
  if (fehler instanceof AppError) {
    return fehler.code;
  }
  if (fehler instanceof Error) {
    return fehler.name || null;
  }
  return null;
}

/** Soll dieser Fehler ueberhaupt gemeldet werden? */
export function istMeldepflichtig(fehler: unknown): boolean {
  if (fehler instanceof AppError) {
    return MELDEPFLICHTIG.has(fehler.code);
  }
  return true;
}

/** Die Meldung eines Fehlers - bereinigt und gekuerzt. */
function meldungVon(fehler: unknown): string {
  const roh =
    fehler instanceof AppError
      ? (fehler.internalMessage ?? fehler.message)
      : fehler instanceof Error
        ? fehler.message
        : typeof fehler === 'string'
          ? fehler
          : 'Unbekannter Fehler';
  const text = bereinige(roh).slice(0, GRENZEN.meldung).trim();
  return text.length > 0 ? text : 'Unbekannter Fehler';
}

/** Der Stapel - bereinigt, gekuerzt, oder nichts. */
function stapelVon(fehler: unknown): string | null {
  if (!(fehler instanceof Error) || !fehler.stack) {
    return null;
  }
  /*
   * Nur die obersten Zeilen.
   *
   * Ein Stapel aus Next.js oder discord.js ist dutzende Zeilen lang, und ab
   * der sechsten steht nur noch Fremdcode. Was die Ursache zeigt, steht oben.
   */
  const zeilen = fehler.stack.split('\n').slice(0, 8).join('\n');
  return bereinige(zeilen).slice(0, GRENZEN.stapel);
}

/**
 * Einen Fehler melden.
 *
 * Wirft nie und wartet auf nichts, was sie nicht braucht. Der Aufrufer darf
 * `void meldeFehler(...)` schreiben - die Antwort an den Benutzer soll nicht
 * darauf warten, dass eine Zeile geschrieben ist.
 */
export async function meldeFehler(meldung: FehlerMeldung): Promise<void> {
  try {
    if (!istMeldepflichtig(meldung.fehler)) {
      return;
    }

    const origin = bereinige(meldung.origin).slice(0, 120) || 'unbekannt';
    const code = codeVon(meldung.fehler);
    const message = meldungVon(meldung.fehler);
    const fingerprint = fingerprintVon({ source: meldung.source, origin, code, message });

    const jetzt = new Date();
    const zeile = await prisma.errorLogEntry.upsert({
      where: { fingerprint },
      create: {
        fingerprint,
        source: meldung.source,
        origin,
        code,
        message,
        stack: stapelVon(meldung.fehler),
        context: bereinigeKontext(meldung.kontext),
        actorDiscordId: meldung.actorDiscordId ?? null,
        firstSeenAt: jetzt,
        lastSeenAt: jetzt,
      },
      /*
       * Beim Wiedersehen gewinnt das Neue.
       *
       * Meldung, Stapel und Kontext werden ueberschrieben, nicht behalten:
       * derselbe Fingerprint heisst «dieselbe Art von Fehler», nicht «genau
       * derselbe Wortlaut». Der letzte Fall ist der, den jemand gerade
       * untersucht.
       *
       * `firstSeenAt` bleibt - es ist die Antwort auf «seit wann».
       */
      update: {
        occurrences: { increment: 1 },
        lastSeenAt: jetzt,
        message,
        code,
        stack: stapelVon(meldung.fehler),
        context: bereinigeKontext(meldung.kontext),
        actorDiscordId: meldung.actorDiscordId ?? null,
      },
    });

    await vielleichtMelden(zeile.id, jetzt);
  } catch (error) {
    /*
     * Hier endet es.
     *
     * Kein erneutes `meldeFehler` - das waere die Schleife, aus der ein
     * kaputter Fehler-Log den ganzen Server lahmlegt. Eine Warnung im
     * Protokoll ist das Richtige: wenn selbst das Melden nicht geht, ist das
     * Protokoll die einzige Stelle, die noch funktioniert.
     */
    log.warn('Fehler konnte nicht protokolliert werden', { error });
  }
}

/**
 * Meldet nach Discord, wenn die Ruhezeit vorbei ist.
 *
 * Der Anspruch wird **in der Datenbank** gestellt und nicht hier: ein
 * `updateMany` mit Bedingung auf `notifiedAt` kann nur einmal gewinnen.
 * Zwei gleichzeitige Fehler desselben Musters - der Normalfall bei einem
 * kaputten Befehl - erzeugen damit eine Meldung und nicht zwei.
 *
 * `notifiedCount` wandert in den Dedupe-Schluessel der Zustellung. Ohne das
 * waere die zweite Meldung desselben Eintrags eine Doppelung und wuerde
 * verworfen.
 */
async function vielleichtMelden(id: string, jetzt: Date): Promise<void> {
  const anspruch = await prisma.errorLogEntry.updateMany({
    where: {
      id,
      OR: [{ notifiedAt: null }, { notifiedAt: { lt: new Date(jetzt.getTime() - RUHEZEIT_MS) } }],
    },
    data: { notifiedAt: jetzt, notifiedCount: { increment: 1 } },
  });
  if (anspruch.count === 0) {
    return;
  }

  const zeile = await prisma.errorLogEntry.findUnique({ where: { id } });
  if (!zeile) {
    return;
  }

  /*
   * Der Dispatcher wird spaet geladen.
   *
   * Er laedt die Formatter, die Formatter laden die Registry - und der
   * Dispatcher wird diese Datei laden, um Fehler zu formatieren. Ein
   * gewoehnlicher Import oben waere ein Zyklus.
   */
  const { dispatchFehler } = await import('./dispatcher');
  await dispatchFehler(zeile);
}

/** Die jüngsten Einträge - für eine Übersicht oder einen Bericht. */
export async function ladeFehler(
  optionen: { grenze?: number; source?: ErrorLogSource } = {},
): Promise<ErrorLogEntry[]> {
  return prisma.errorLogEntry.findMany({
    where: optionen.source ? { source: optionen.source } : {},
    orderBy: { lastSeenAt: 'desc' },
    take: Math.min(Math.max(optionen.grenze ?? 50, 1), 200),
  });
}
