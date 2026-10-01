import { createLogger } from '@swisshub/logger';
import type { BildBefund } from './bild';
import { DISCORD_BILD_HOSTS, holeBild } from './herkunft';

const log = createLogger('emoji:fremd');

/**
 * Ein Emoji von einem anderen Server übernehmen.
 *
 * ## Was ein Emoji in einer Nachricht wirklich ist
 *
 * `<:pog:123456789012345678>` - ein Name und eine Kennung in spitzen Klammern.
 * Animierte beginnen mit `a`. Was Discord daraus zeichnet, liegt unter einer
 * fest vorhersagbaren Adresse auf seinem eigenen CDN:
 *
 *     https://cdn.discordapp.com/emojis/<id>.png     (fest)
 *     https://cdn.discordapp.com/emojis/<id>.gif     (animiert)
 *
 * Genau deshalb ist das Übernehmen überhaupt möglich, und genau deshalb ist es
 * **kein** Laden einer beliebigen Adresse: die Adresse wird hier gebaut und
 * nicht von jemandem eingegeben. Der Host ist Discords eigener, aus der festen
 * Liste in `herkunft.ts` - nicht aus einer Einstellung, die jemand ändern kann.
 *
 * ## Wie die Referenz in den Befehl kommt
 *
 * Wer das Emoji in einem Chat sieht, kopiert es und fügt es in das Textfeld des
 * Befehls ein - dort steht dann die rohe Form. Ohne Nitro lässt sich ein
 * fremdes Emoji nicht *tippen*, aber einfügen geht immer, und `\:name:` vor der
 * Nachricht zeigt die Rohform zum Kopieren. Darum nimmt der Befehl auch die
 * nackte Kennung und eine CDN-Adresse an: drei Wege zu derselben Zahl, damit
 * niemand am Format scheitert.
 *
 * ## Was ausdrücklich nicht geht
 *
 * **Standard-Emojis.** `🔥` ist ein Unicode-Zeichen und liegt auf keinem
 * Server - es gehört allen. Ein Versuch, es zu «kopieren», bekommt deshalb
 * einen Satz, der das erklärt, und keinen Fehlschlag beim Laden.
 *
 * **Rechte.** SwissHub weiss, von welcher Kennung die Bytes kamen. Ob das
 * Emoji übernommen werden *darf*, weiss es nicht - und schreibt dazu nichts.
 * Festgehalten wird die technische Herkunft, nichts weiter.
 */

/** Ein benutzerdefiniertes Emoji, wie Discord es in Nachrichten schreibt. */
const REFERENZ = /^<(a?):([A-Za-z0-9_]{2,32}):(\d{17,20})>$/u;

/** Die nackte Kennung - für den Fall, dass jemand nur sie hat. */
const NUR_KENNUNG = /^(\d{17,20})$/u;

/** Eine Adresse auf Discords Emoji-CDN. */
const CDN_ADRESSE = /^https?:\/\/[^/]+\/emojis\/(\d{17,20})\.(png|gif|webp|jpg)/u;

/**
 * Enthält die Eingabe ein Unicode-Emoji?
 *
 * Grob und absichtlich so: geprüft wird auf die Eigenschaft «Emoji-Darstellung»
 * statt auf eine Zeichenliste. Eine Liste wäre nach dem nächsten
 * Unicode-Jahrgang unvollständig, und die Antwort hier ist nur ein besserer
 * Satz - keine Sicherheitsentscheidung.
 */
function istUnicodeEmoji(eingabe: string): boolean {
  return /\p{Extended_Pictographic}/u.test(eingabe);
}

export interface EmojiReferenz {
  discordEmojiId: string;
  /** Der Name auf dem Herkunftsserver - `null`, wenn nur die Kennung kam. */
  urspruenglicherName: string | null;
  /**
   * Animiert laut Referenz.
   *
   * `null` heisst «steht nicht in der Eingabe» - dann wird beim Holen beides
   * probiert, und die Wahrheit steht am Ende ohnehin in den Bytes.
   */
  animiertLautReferenz: boolean | null;
}

export interface ReferenzBefund {
  ok: boolean;
  grund?: string;
  referenz?: EmojiReferenz;
}

/**
 * Eine Eingabe als Emoji-Referenz lesen.
 *
 * Gibt einen Grund zurück statt zu werfen: «das ist ein Standard-Emoji» ist
 * eine Auskunft und keine Störung.
 */
export function leseReferenz(eingabe: string): ReferenzBefund {
  const text = eingabe.trim();
  if (text.length === 0) {
    return { ok: false, grund: 'Da steht kein Emoji.' };
  }

  const voll = REFERENZ.exec(text);
  if (voll) {
    const [, animiert, name, id] = voll;
    return {
      ok: true,
      referenz: {
        discordEmojiId: id ?? '',
        urspruenglicherName: name ?? null,
        animiertLautReferenz: animiert === 'a',
      },
    };
  }

  const adresse = CDN_ADRESSE.exec(text);
  if (adresse) {
    return {
      ok: true,
      referenz: {
        discordEmojiId: adresse[1] ?? '',
        urspruenglicherName: null,
        // Die Endung der Adresse ist ein Hinweis, nicht die Wahrheit - die
        // Bytes entscheiden.
        animiertLautReferenz: adresse[2] === 'gif' ? true : null,
      },
    };
  }

  const kennung = NUR_KENNUNG.exec(text);
  if (kennung) {
    return {
      ok: true,
      referenz: {
        discordEmojiId: kennung[1] ?? '',
        urspruenglicherName: null,
        animiertLautReferenz: null,
      },
    };
  }

  if (istUnicodeEmoji(text)) {
    /*
     * Der häufigste Fehlgriff, und er verdient eine Erklärung.
     *
     * Ein Standard-Emoji liegt auf keinem Server - es ist ein Zeichen wie «A».
     * «Konnte nicht geladen werden» wäre hier die unbrauchbare Antwort.
     */
    return {
      ok: false,
      grund:
        'Das ist ein Standard-Emoji - das hat jeder Server schon. Kopiert werden können nur Server-Emojis.',
    };
  }

  return {
    ok: false,
    grund:
      'Das ist keine Emoji-Referenz. Kopiere das Emoji aus einem Chat (dort steht dann `<:name:123…>`), oder gib seine Kennung an.',
  };
}

/** Die Adresse eines Emoji-Bildes auf Discords CDN. */
export function cdnAdresse(discordEmojiId: string, animiert: boolean): string {
  return `https://${DISCORD_BILD_HOSTS[0]}/emojis/${discordEmojiId}.${animiert ? 'gif' : 'png'}`;
}

export interface UebernahmeErgebnis {
  ok: boolean;
  grund?: string;
  bytes?: Uint8Array;
  befund?: BildBefund;
  referenz?: EmojiReferenz;
  /** Die technische Herkunft - die Adresse, von der die Bytes kamen. */
  quelle?: string;
}

/**
 * Das Bild zu einer Referenz holen.
 *
 * Steht in der Referenz, ob das Emoji animiert ist, wird genau eine Adresse
 * geholt. Steht es nicht da (nackte Kennung), wird `.gif` zuerst versucht:
 * ein animiertes Emoji als `.png` zu holen liefert ein Einzelbild und damit
 * eine stille Verschlechterung - andersherum antwortet Discord schlicht mit
 * einem Fehler, und wir versuchen das andere.
 */
export async function uebernehmeEmoji(eingabe: string): Promise<UebernahmeErgebnis> {
  const gelesen = leseReferenz(eingabe);
  if (!gelesen.ok || !gelesen.referenz) {
    return { ok: false, ...(gelesen.grund ? { grund: gelesen.grund } : {}) };
  }
  const referenz = gelesen.referenz;

  const versuche = referenz.animiertLautReferenz === null ? [true, false] : [referenz.animiertLautReferenz];

  let letzterGrund: string | undefined;
  for (const animiert of versuche) {
    const adresse = cdnAdresse(referenz.discordEmojiId, animiert);
    // Dieselbe SSRF-Prüfung wie jeder Import, gegen Discords feste Hostliste.
    const geholt = await holeBild(adresse, DISCORD_BILD_HOSTS);
    if (geholt.ok && geholt.bytes) {
      return {
        ok: true,
        bytes: geholt.bytes,
        ...(geholt.befund ? { befund: geholt.befund } : {}),
        referenz,
        quelle: adresse,
      };
    }
    letzterGrund = geholt.grund;
    log.debug('Emoji-Bild nicht geholt', { id: referenz.discordEmojiId, animiert, grund: geholt.grund });
  }

  return {
    ok: false,
    referenz,
    grund:
      /*
       * Der Grund von Discord wäre hier meist «404» - das sagt niemandem, was
       * zu tun ist. Der häufige Fall ist ein Emoji, das es nicht mehr gibt,
       * oder eine Kennung, die beim Kopieren verstümmelt wurde.
       */
      `Zu dieser Kennung gibt es kein Bild auf Discord. Gibt es das Emoji noch? (${letzterGrund ?? 'keine Antwort'})`,
  };
}
