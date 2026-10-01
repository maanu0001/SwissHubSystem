/**
 * Wie ein Emoji-Name aussehen darf.
 *
 * ## Warum das nicht Discord entscheidet
 *
 * Weil Discord erst beim Hochladen widerspricht - und dann mit «Invalid Form
 * Body». Ein Vorschlag, der drei Tage in der Moderation liegt und beim
 * Annehmen an seinem Namen scheitert, ist eine Enttäuschung, die am Anfang
 * vermeidbar war.
 *
 * ## Discords Regeln, soweit sie dokumentiert sind
 *
 * Zwei bis zweiunddreissig Zeichen, Buchstaben, Ziffern und Unterstrich. Keine
 * Bindestriche, keine Leerzeichen, keine Umlaute - was im Chat als
 * `:name:` getippt wird, muss ohne Nachdenken tippbar sein.
 *
 * Grossbuchstaben nimmt Discord an, zeigt aber den Namen, wie er geschrieben
 * wurde. `vorschlag` wird deshalb kleingeschrieben: zwei Emojis, die sich nur
 * in der Schreibweise unterscheiden, sind im Chat nicht unterscheidbar und
 * damit eine Falle.
 */

export const EMOJI_NAME_MIN = 2;
export const EMOJI_NAME_MAX = 32;

/** Was Discord als Emoji-Name annimmt. */
const ERLAUBT = /^[a-z0-9_]+$/u;

export interface NamensBefund {
  ok: boolean;
  /** Der Name, wie er gespeichert würde. */
  name: string;
  grund?: string;
}

/**
 * Einen vorgeschlagenen Namen aufräumen und prüfen.
 *
 * Aufräumen heisst: Kleinschreibung, Rand ohne Leerzeichen, Doppelpunkte weg -
 * wer `:pog:` eintippt, meint `pog` und soll keine Fehlermeldung bekommen.
 * Was darüber hinaus falsch ist, wird **nicht** stillschweigend ersetzt: aus
 * «mein emoji» automatisch `mein_emoji` zu machen hiesse, einen Namen zu
 * vergeben, den niemand gewählt hat.
 */
export function pruefeEmojiName(eingabe: string): NamensBefund {
  const name = eingabe
    .trim()
    .replace(/^:+|:+$/gu, '')
    .toLowerCase();

  if (name.length < EMOJI_NAME_MIN) {
    return {
      ok: false,
      name,
      grund: `Der Name braucht mindestens ${EMOJI_NAME_MIN} Zeichen.`,
    };
  }
  if (name.length > EMOJI_NAME_MAX) {
    return { ok: false, name, grund: `Der Name darf höchstens ${EMOJI_NAME_MAX} Zeichen haben.` };
  }
  if (!ERLAUBT.test(name)) {
    return {
      ok: false,
      name,
      grund:
        'Erlaubt sind Buchstaben a-z, Ziffern und Unterstrich - keine Leerzeichen, Umlaute oder Bindestriche.',
    };
  }
  /*
   * Ein Name aus lauter Unterstrichen ist formal erlaubt und praktisch
   * unbrauchbar: `:___:` sieht im Chat wie ein Darstellungsfehler aus.
   */
  if (!/[a-z0-9]/u.test(name)) {
    return { ok: false, name, grund: 'Der Name braucht mindestens einen Buchstaben oder eine Ziffer.' };
  }

  return { ok: true, name };
}
