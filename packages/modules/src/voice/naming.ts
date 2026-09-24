/**
 * Kanalnamen aus einer Vorlage.
 *
 * Discord erlaubt 100 Zeichen. Problematische Zeichen fliegen raus, damit der
 * Name nicht abgelehnt wird - und damit niemand ueber den Kanalnamen etwas
 * unterbringt, was in einer Kanalliste nichts zu suchen hat.
 */

/**
 * Zeichen, die im Namen bleiben duerfen.
 *
 * ## Warum hier mehr steht als frueher
 *
 * Die Liste war an Textkanaelen orientiert. Discord normalisiert deren
 * Namen selbst - Kleinschreibung, Leerzeichen zu Bindestrichen -, und wer
 * davon ausgeht, haelt eine enge Liste fuer noetig. Fuer **Sprachkanaele**
 * gilt das nicht: dort bleibt stehen, was man eingibt, und ein Trennstrich
 * wie `|` ist dort so ueblich wie ein Bindestrich.
 *
 * Genau daran scheiterte `🔊| Stübli`: das Zeichen stand nicht in der
 * Liste und fiel lautlos heraus. Dazugekommen sind deshalb die
 * Trennzeichen, die man in Kanalnamen tatsaechlich sieht - `|`, `/`, `&`,
 * `+`, `~`, `:`, `,`, `«»` und die typografischen Anfuehrungszeichen.
 *
 * ## Was weiterhin faellt
 *
 * `@`, `#` und `<`. Ein Kanalname erzeugt zwar keine Erwaehnung, aber
 * `@everyone` in einer Kanalliste ist ein Trick, den niemand braucht. Diese
 * drei bleiben draussen, und das ist der einzige Grund, warum es diese
 * Liste ueberhaupt gibt.
 */
const ERLAUBT =
  /[^\p{L}\p{N}\p{Zs}\p{Emoji_Presentation}\p{Extended_Pictographic}\-_.'’·•!?()[\]|/&+~:,«»"]/gu;

/**
 * Saeubert einen eingesetzten Wert.
 *
 * `@`, `#` und `<` fallen dabei weg. Ein Kanalname erzeugt zwar keine
 * Erwaehnung, aber `@everyone` im Namen einer Kanalliste ist trotzdem ein
 * Trick, den niemand braucht.
 */
export function saeubere(wert: string, laenge = 40): string {
  return wert.replace(ERLAUBT, '').replace(/\s+/gu, ' ').trim().slice(0, laenge);
}

/**
 * Die Platzhalter, die eine Namensvorlage kennt.
 *
 * Beide Schreibweisen - `{username}` ist die dokumentierte, `@username`
 * die, die jedem zuerst einfaellt. Die Liste steht hier, weil `baueKanalName`
 * unten sie einsetzt: Pruefung, Hinweis in der Oberflaeche und Einsetzen
 * lesen damit dieselbe Quelle.
 */
export const PLATZHALTER = [
  '{username}',
  '{displayName}',
  '{game}',
  '{number}',
  '@username',
  '@displayName',
  '@game',
  '@number',
] as const;

export interface NamensWerte {
  username: string;
  displayName?: string | null;
  game?: string | null;
  number?: number | null;
}

/**
 * Setzt eine Namensvorlage ein.
 *
 * Unbekannte Platzhalter bleiben stehen - sie als Fehler zu behandeln haette
 * zur Folge, dass ein Tippfehler in den Einstellungen das Erstellen von Talks
 * verhindert. Ein sichtbarer Platzhalter im Kanalnamen faellt auf und laesst
 * sich beheben; ein Talk, der gar nicht entsteht, nicht unbedingt.
 */
export function baueKanalName(vorlage: string, werte: NamensWerte): string {
  const username = saeubere(werte.username, 25) || 'Talk';
  const displayName = saeubere(werte.displayName ?? werte.username, 25) || username;
  const game = saeubere(werte.game ?? '', 30);

  /*
   * Zwei Schreibweisen fuer denselben Platzhalter.
   *
   * `{username}` ist die dokumentierte. `@username` schreibt, wer an
   * Discord denkt - und das tut hier jeder. Beide zu unterstuetzen kostet
   * eine Zeile; die Alternative war eine Fehlermeldung, die den Unterschied
   * erklaeren muss, und ein Admin, der sie nicht versteht.
   *
   * Die `@`-Form wird **zuerst** ersetzt, damit das `@` verschwunden ist,
   * bevor irgendetwas anderes passiert. Was danach noch an `@` uebrig ist,
   * stand nicht fuer einen Platzhalter.
   */
  const gebaut = vorlage
    .replace(/@username\b/gu, username)
    .replace(/@displayName\b/gu, displayName)
    .replace(/@game\b/gu, game || 'Gaming')
    .replace(/@number\b/gu, werte.number ? String(werte.number) : '')
    .replace(/\{username\}/gu, username)
    .replace(/\{displayName\}/gu, displayName)
    .replace(/\{game\}/gu, game || 'Gaming')
    .replace(/\{number\}/gu, werte.number ? String(werte.number) : '');

  const gekuerzt = gebaut.replace(/\s+/gu, ' ').trim().slice(0, 100);
  return gekuerzt || `${username} Stübli`.slice(0, 100);
}

/**
 * Prueft einen von Hand eingegebenen Namen.
 *
 * Liefert den gesaeuberten Namen oder einen Grund, warum er nicht geht. Ein
 * Name, der nach dem Saeubern leer ist, ist keiner - sonst hiesse der Kanal
 * hinterher gar nichts.
 */
export function pruefeName(eingabe: string): { ok: true; name: string } | { ok: false; grund: string } {
  const roh = eingabe.trim();
  if (roh.length === 0) {
    return { ok: false, grund: 'Der Name darf nicht leer sein.' };
  }
  if (roh.length > 100) {
    return { ok: false, grund: 'Der Name darf höchstens 100 Zeichen haben.' };
  }

  const sauber = saeubere(roh, 100);
  if (sauber.length === 0) {
    return { ok: false, grund: 'Dieser Name besteht nur aus Zeichen, die Discord nicht annimmt.' };
  }
  if (sauber.length < 2) {
    return { ok: false, grund: 'Der Name braucht mindestens zwei Zeichen.' };
  }
  return { ok: true, name: sauber };
}
