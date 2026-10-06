/**
 * Die drei Auszeichnungen, die Fliesstext in der Doku tragen darf.
 *
 * `` `code` ``, `**fett**` und `[Beschriftung](/pfad)`. Das ist die ganze
 * Sprache - absichtlich. Ein Textfeld, in dem beliebiges Markdown erlaubt
 * waere, braeuchte einen Parser mit Verschachtelung, Fussnoten und
 * Sonderfaellen; dieselbe Wirkung erreichen hier drei Muster, die man in
 * einem Blick liest.
 *
 * Kein HTML. Der Text wird als React-Knoten zusammengesetzt und nie als
 * `dangerouslySetInnerHTML` eingehaengt - eine Doku, in deren Fliesstext
 * Markup landen kann, ist ein Einfallstor, auch wenn der Text aus dem
 * Repository kommt.
 */

/** Ein Stueck Fliesstext, schon zerlegt. */
export type InlineTeil =
  | { art: 'text'; text: string }
  | { art: 'code'; text: string }
  | { art: 'fett'; text: string }
  | { art: 'link'; text: string; href: string };

/*
 * Ein Muster fuer alle drei.
 *
 * Die Alternativen stehen in der Reihenfolge, in der sie gewinnen sollen:
 * Code zuerst, damit `**` innerhalb von Backticks Text bleibt.
 */
const MUSTER = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/gu;

/**
 * Zerlegt einen Text in seine Teile.
 *
 * Bleibt ein Muster unvollstaendig - ein einzelner Backtick, eine Klammer
 * ohne Ziel -, bleibt es Text. Lieber ein Sternchen zu sehen als eine
 * Fehlermeldung in einer Doku.
 */
export function zerlegeInline(text: string): InlineTeil[] {
  const teile: InlineTeil[] = [];
  let zuletzt = 0;

  for (const treffer of text.matchAll(MUSTER)) {
    const start = treffer.index;
    if (start > zuletzt) {
      teile.push({ art: 'text', text: text.slice(zuletzt, start) });
    }
    if (treffer[1] !== undefined) {
      teile.push({ art: 'code', text: treffer[1] });
    } else if (treffer[2] !== undefined) {
      teile.push({ art: 'fett', text: treffer[2] });
    } else if (treffer[3] !== undefined && treffer[4] !== undefined) {
      teile.push({ art: 'link', text: treffer[3], href: treffer[4] });
    }
    zuletzt = start + treffer[0].length;
  }

  if (zuletzt < text.length) {
    teile.push({ art: 'text', text: text.slice(zuletzt) });
  }
  return teile;
}

/**
 * Derselbe Text ohne Auszeichnungen.
 *
 * Fuer den Suchindex und die Textvorschau: wer «Permission Registry» sucht,
 * soll den Treffer auch finden, wenn der Begriff im Satz als Code steht.
 */
export function nurText(text: string): string {
  return zerlegeInline(text)
    .map((teil) => teil.text)
    .join('');
}

/** Alle Adressen, auf die ein Text zeigt - fuer die Linkpruefung im Test. */
export function linksIn(text: string): string[] {
  return zerlegeInline(text)
    .filter((teil): teil is Extract<InlineTeil, { art: 'link' }> => teil.art === 'link')
    .map((teil) => teil.href);
}
