/**
 * Die Missionswoche.
 *
 * ## Warum hier nichts neu gerechnet wird
 *
 * Die Umrechnung zwischen Zuercher Wanduhrzeit und UTC steht bereits in
 * `clips/woche.ts` - zweimal angewandter Versatz, damit auch die beiden
 * Umstellungstage stimmen. Sie hier noch einmal zu schreiben hiesse, zwei
 * Antworten auf dieselbe Frage zu haben; am letzten Sonntag im Oktober
 * waeren sie verschieden.
 *
 * Was dieses Modul braucht und die Clips nicht haben, ist ein **frei
 * waehlbarer** Wochenbeginn: die Clip-Runde beginnt am Montag, die
 * Missionswoche dort, wo das Team sie hinlegt.
 */
import { ausZuercherZeit, zuercherTeile } from '../clips/woche';

export { ausZuercherZeit };

export interface Missionswoche {
  /** Beginn, als UTC-Zeitpunkt. */
  beginn: Date;
  /** Ende - der Beginn der naechsten Woche, also nicht mehr enthalten. */
  ende: Date;
}

/**
 * Die Missionswoche, in der ein Zeitpunkt liegt.
 *
 * `wochenstartTag` ist 1 (Montag) bis 7 (Sonntag), wie in den Einstellungen.
 * Liegt der Zeitpunkt vor dem Beginn dieser Woche, gehoert er noch zur
 * vorherigen - sonst faengt jeden Montagmorgen um 00:01 eine Woche an, die
 * um 00:00 schon begonnen hat.
 */
export function missionswoche(
  zeitpunkt: Date,
  wochenstartTag: number,
  wochenstartStunde: number,
): Missionswoche {
  const teile = zuercherTeile(zeitpunkt);

  // Wie viele Tage liegt der letzte Wochenstart zurueck? 0 bis 6.
  let zurueck = (teile.wochentag - wochenstartTag + 7) % 7;

  let beginn = zuercherTagesBeginn(teile.jahr, teile.monat, teile.tag - zurueck, wochenstartStunde);
  if (beginn.getTime() > zeitpunkt.getTime()) {
    // Heute ist der Starttag, aber die Stunde ist noch nicht erreicht.
    zurueck += 7;
    beginn = zuercherTagesBeginn(teile.jahr, teile.monat, teile.tag - zurueck, wochenstartStunde);
  }

  /*
   * Das Ende: derselbe Wochentag, dieselbe Wanduhrzeit, sieben Kalendertage
   * spaeter.
   *
   * Ueber den **Kalender**, nicht ueber «Beginn plus sieben mal 24
   * Stunden». In der Woche einer Zeitumstellung hat die Woche 167 oder 169
   * Stunden; wer sie in Millisekunden rechnet, landet am falschen Tag oder
   * zur falschen Stunde. Gerechnet wird deshalb auf dem Zuercher Datum des
   * **Beginns** - nicht auf dem eines abgeleiteten Zeitpunkts, dessen
   * Zuercher Tag selbst schon von der Umstellung verschoben sein kann.
   */
  const beginnTeile = zuercherTeile(beginn);
  const ende = zuercherTagesBeginn(
    beginnTeile.jahr,
    beginnTeile.monat,
    beginnTeile.tag + 7,
    wochenstartStunde,
  );

  return { beginn, ende };
}

/**
 * Ein Zuercher Kalendertag zur angegebenen Stunde, als UTC-Zeitpunkt.
 *
 * `tag` darf ausserhalb des Monats liegen - 0, -3 oder 38 sind erlaubt.
 * `Date.UTC` rechnet den Kalender (Monatswechsel, Schaltjahre); die Zeitzone
 * kommt erst danach dazu, ueber `ausZuercherZeit`.
 */
function zuercherTagesBeginn(jahr: number, monat: number, tag: number, stunde: number): Date {
  const kalender = new Date(Date.UTC(jahr, monat - 1, tag));
  return ausZuercherZeit(
    kalender.getUTCFullYear(),
    kalender.getUTCMonth() + 1,
    kalender.getUTCDate(),
    stunde,
    0,
  );
}
