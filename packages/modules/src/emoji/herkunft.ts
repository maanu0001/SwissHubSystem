import { pruefeZieladresse } from '@swisshub/automation';
import { createLogger } from '@swisshub/logger';
import { EMOJI_MAX_BYTES, erkenneArt, pruefeBild, type BildBefund } from './bild';

const log = createLogger('emoji:herkunft');

/**
 * Ein Bild von einer Adresse holen - und warum das die gefährlichste Zeile des
 * Moduls ist.
 *
 * ## Was hier **nicht** passiert
 *
 * Es wird keine beliebige Adresse geladen. Eine Anfrage aus dem Inneren des
 * Servers heraus ist ein Angriff, der wie eine Bequemlichkeit aussieht:
 * `http://169.254.169.254/` liefert bei manchen Anbietern Zugangsdaten der
 * Maschine, `http://localhost:5432` ist die Datenbank, und eine Weiterleitung
 * führt von einer harmlosen Adresse genau dorthin.
 *
 * ## Drei Schranken, hintereinander
 *
 * 1. **Freigabeliste für den Host.** Das Team trägt ein, von wo importiert
 *    werden darf - voreingestellt sind Discords eigene Bild-Adressen. Ein
 *    leeres Feld heisst: gar kein Import. Das ist die Schranke, die «keine
 *    beliebigen URL-Abrufe» überhaupt erst wahr macht; alles Weitere schützt
 *    nur noch den Fall, dass ein freigegebener Name woanders hinzeigt.
 * 2. **Dieselbe SSRF-Prüfung wie die Automation-Webhooks.**
 *    `pruefeZieladresse` ist nicht nachgebaut, sondern importiert: nur HTTPS,
 *    keine Zugangsdaten in der Adresse, kein anderer Port, Namensauflösung und
 *    jede aufgelöste Adresse muss aussen liegen. Eine zweite Umsetzung wäre
 *    eine zweite Wahrheit - und eine davon wäre eines Tages die veraltete.
 * 3. **Keine Weiterleitungen, Frist, Grössengrenze.** Sonst wäre Schritt 2
 *    wertlos: die erste Adresse wäre öffentlich, die zweite nicht. Gelesen wird
 *    höchstens so viel, wie ein Emoji sein darf - eine Gegenstelle, die ein
 *    Gigabyte schickt, füllt keinen Speicher.
 *
 * ## Was gespeichert wird
 *
 * Die geprüfte Adresse, als technische Herkunft. Keine Aussage darüber, wem das
 * Bild gehört oder wer es verwenden darf - das weiss SwissHub nicht.
 */

/** Wie lange auf die Gegenstelle gewartet wird. */
export const IMPORT_FRIST_MS = 8_000;

/**
 * Discords eigene Bild-Adressen.
 *
 * Fest und nicht einstellbar, weil sie etwas anderes sind als die
 * Freigabeliste: ein Anhang an einem Slash Command kommt aus Discords eigener
 * Nutzlast und nicht aus einem Textfeld. Die Adresse hat niemand getippt - und
 * genau deshalb darf sie geholt werden, auch wenn das Team den Import
 * ausgeschaltet hat.
 *
 * Die Liste pinnt sie trotzdem fest: ohne sie wäre jede Adresse, die als
 * «Anhang» hereinkommt, eine beliebige Adresse.
 */
export const DISCORD_BILD_HOSTS: readonly string[] = [
  'cdn.discordapp.com',
  'media.discordapp.net',
] as const;

/**
 * Den Anhang eines Slash Commands holen.
 *
 * Derselbe Weg wie `holeBild`, nur mit der festen Discord-Liste statt der
 * eingestellten. Die SSRF-Prüfung gilt genauso: ein CDN-Name, der auf eine
 * interne Adresse zeigt, wäre dasselbe Loch, egal woher der Link kam.
 */
export async function holeDiscordAnhang(
  url: string,
  optionen: { fristMs?: number } = {},
): Promise<ImportErgebnis> {
  return holeBild(url, DISCORD_BILD_HOSTS, optionen);
}

export interface ImportErgebnis {
  ok: boolean;
  grund?: string;
  bytes?: Uint8Array;
  befund?: BildBefund;
  /** Die geprüfte Adresse - technische Herkunft, nichts weiter. */
  quelle?: string;
}

/**
 * Die Freigabeliste aus den Einstellungen lesen.
 *
 * Komma oder Zeilenumbruch trennen; Leerzeichen und ein versehentliches
 * `https://` davor werden abgeschnitten, weil beides der häufigste Tippfehler
 * ist und kein anderer Host.
 */
export function erlaubteHostsAus(eingabe: string): string[] {
  return eingabe
    .split(/[\n,;]+/u)
    .map((eintrag) => eintrag.trim().toLowerCase().replace(/^https?:\/\//u, '').replace(/\/.*$/u, ''))
    .filter((eintrag) => eintrag.length > 0);
}

/**
 * Passt der Host zur Freigabeliste?
 *
 * Ein Eintrag deckt den Host selbst und seine Unterdomänen ab -
 * `discordapp.net` erlaubt `media.discordapp.net`. Geprüft wird auf
 * Punktgrenze: sonst liesse `evil-discordapp.net` sich als Treffer von
 * `discordapp.net` ausgeben.
 */
export function hostErlaubt(host: string, erlaubt: readonly string[]): boolean {
  const klein = host.toLowerCase();
  return erlaubt.some((eintrag) => klein === eintrag || klein.endsWith(`.${eintrag}`));
}

/**
 * Ein Bild holen.
 *
 * Gibt niemals eine Ausnahme weiter, die wie ein Programmfehler aussieht: ein
 * nicht erreichbarer Host ist eine Antwort und keine Störung. Geworfen wird
 * hier nichts.
 */
export async function holeBild(
  rohAdresse: string,
  erlaubteHosts: readonly string[],
  optionen: { fristMs?: number } = {},
): Promise<ImportErgebnis> {
  if (erlaubteHosts.length === 0) {
    return {
      ok: false,
      grund: 'Der Import von Adressen ist ausgeschaltet. Lade die Datei hoch, oder trage in den Moduleinstellungen einen erlaubten Host ein.',
    };
  }

  let adresse: URL;
  try {
    adresse = new URL(rohAdresse);
  } catch {
    return { ok: false, grund: 'Das ist keine gültige Adresse.' };
  }

  const host = adresse.hostname.replace(/^\[|\]$/gu, '').toLowerCase();
  if (!hostErlaubt(host, erlaubteHosts)) {
    /*
     * Die Freigabeliste steht in der Antwort.
     *
     * Sie ist kein Geheimnis - das Team hat sie selbst eingetragen - und ohne
     * sie rät die Person, warum ihre Adresse nicht geht.
     */
    return {
      ok: false,
      grund: `Von «${host}» holt SwissHub keine Bilder. Erlaubt sind: ${erlaubteHosts.join(', ')}.`,
    };
  }

  // Erst jetzt die allgemeine Prüfung: sie löst Namen auf und kostet eine
  // Abfrage. Ein nicht freigegebener Host braucht sie nicht.
  const befund = await pruefeZieladresse(adresse.toString());
  if (!befund.erlaubt) {
    return { ok: false, grund: befund.grund ?? 'Diese Adresse ist nicht erlaubt.' };
  }

  const abbruch = new AbortController();
  const wecker = setTimeout(() => abbruch.abort(), optionen.fristMs ?? IMPORT_FRIST_MS);
  try {
    const antwort = await fetch(adresse, {
      // Eine Weiterleitung wäre eine zweite, ungeprüfte Adresse.
      redirect: 'error',
      signal: abbruch.signal,
      headers: { accept: 'image/png,image/jpeg,image/gif,image/webp' },
    });

    if (!antwort.ok) {
      return { ok: false, grund: `Die Gegenstelle antwortete mit ${antwort.status}.` };
    }

    /*
     * Die angekündigte Länge wird geprüft, aber nicht geglaubt.
     *
     * Ein Header ist eine Behauptung. Gelesen wird deshalb trotzdem nur bis
     * zur Grenze - wer die Ankündigung glaubt, lädt das Gigabyte doch.
     */
    const angekuendigt = Number(antwort.headers.get('content-length') ?? '0');
    if (angekuendigt > EMOJI_MAX_BYTES) {
      return {
        ok: false,
        grund: `Die Gegenstelle kündigt ${Math.round(angekuendigt / 1024)} KB an - erlaubt sind ${Math.round(EMOJI_MAX_BYTES / 1024)} KB.`,
      };
    }

    const bytes = await liesBegrenzt(antwort, EMOJI_MAX_BYTES);
    if (!bytes) {
      return {
        ok: false,
        grund: `Die Antwort ist grösser als ${Math.round(EMOJI_MAX_BYTES / 1024)} KB.`,
      };
    }

    // Was angekommen ist, wird an seinen Bytes geprüft - der Content-Type der
    // Gegenstelle ist dabei ohne Bedeutung.
    if (!erkenneArt(bytes)) {
      return { ok: false, grund: 'Was dort liegt, ist kein PNG, JPEG, GIF oder WebP.' };
    }
    const bildBefund = pruefeBild(bytes);
    if (!bildBefund.ok) {
      return { ok: false, grund: bildBefund.grund, befund: bildBefund };
    }

    return { ok: true, bytes, befund: bildBefund, quelle: adresse.toString() };
  } catch (error) {
    const abgebrochen = error instanceof Error && error.name === 'AbortError';
    log.debug('Import gescheitert', { host, abgebrochen });
    return {
      ok: false,
      grund: abgebrochen
        ? 'Die Gegenstelle hat nicht rechtzeitig geantwortet.'
        : 'Die Adresse liess sich nicht laden. Weiterleitungen sind dabei nicht erlaubt.',
    };
  } finally {
    clearTimeout(wecker);
  }
}

/**
 * Den Körper lesen, aber nur bis zur Grenze.
 *
 * `null` heisst «mehr als erlaubt». Abgebrochen wird beim Lesen und nicht
 * danach: `arrayBuffer()` lädt erst alles und fragt dann - das ist genau der
 * Speicher, den die Grenze verhindern soll.
 */
async function liesBegrenzt(antwort: Response, grenze: number): Promise<Uint8Array | null> {
  const strom = antwort.body;
  if (!strom) {
    return new Uint8Array();
  }
  const leser = strom.getReader();
  const teile: Uint8Array[] = [];
  let gesamt = 0;
  try {
    for (;;) {
      const { done, value } = await leser.read();
      if (done) {
        break;
      }
      gesamt += value.byteLength;
      if (gesamt > grenze) {
        return null;
      }
      teile.push(value);
    }
  } finally {
    await leser.cancel().catch(() => undefined);
  }

  const alles = new Uint8Array(gesamt);
  let position = 0;
  for (const teil of teile) {
    alles.set(teil, position);
    position += teil.byteLength;
  }
  return alles;
}
