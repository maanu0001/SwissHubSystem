import { randomBytes } from 'node:crypto';
import { z } from 'zod';

/**
 * Gaeste ohne Discord-Konto.
 *
 * ## Warum es sie gibt
 *
 * Eine Spielauswahl entsteht oft im Sprachkanal, und nicht jeder, der
 * mitspielt, hat sich je in der WebApp angemeldet - der Kollege, der zum
 * ersten Mal dabei ist, das Geschwister auf dem zweiten Rechner, die drei
 * Leute im Wohnzimmer, die sich ein Handy teilen. Fuer sie war die Runde
 * bisher eine Anmeldeseite.
 *
 * ## Was ein Gast darf
 *
 * **Den ganzen gewoehnlichen Ablauf einer Runde.** Eine Runde eroeffnen, ihr
 * beitreten, Spiele vorschlagen, einen Vorschlag zuruecknehmen, abstimmen,
 * die Vorschlagsphase schliessen und wieder oeffnen, die Runde starten,
 * einmal neu auslosen, das Ergebnis annehmen, noch eine Runde anhaengen, die
 * eigene Runde beenden.
 *
 * Hier stand einmal **«Zusehen und abstimmen. Nichts weiter.»** Das war der
 * Entwurf einer Gastrolle als Zuschauerrolle, und er hat die Frage, um die es
 * dem Modul geht, nicht beantwortet: sechs Leute sitzen im Sprachkanal, einer
 * oeffnet die Runde - und wenn genau der keinen Account hat, war der Abend
 * gelaufen. «Was spielen wir» ist kein Verwaltungsvorgang, sondern eine Frage
 * unter Freunden, und eine Frage unter Freunden verlangt keinen Ausweis.
 *
 * ## Was ein Gast nicht darf
 *
 * Zwei Dinge, und zwar beide, weil sie **ueber die eigene Runde hinausgehen**:
 *
 *  1. **Den Spielkatalog pflegen.** Der Katalog gehoert allen Modulen -
 *     Turnieren, Clips, Spielwahl - und ueberlebt jede Runde. Wer ihn
 *     aendert, aendert etwas fuer Leute, die nicht dabei sind. Das steht
 *     unter `spielwahl.manage` und bleibt dort.
 *  2. **Fremde Runden moderieren.** Eine entgleiste Runde schliesst die
 *     Moderation ueber `spielwahl.manage`, und auch das bleibt dort.
 *
 * Und eines bleibt eine Regel der Zurechenbarkeit statt der Zustaendigkeit:
 * **in der Runde eines Mitglieds wird ein Gast nicht zum Host.** Wer eine
 * Runde eroeffnet, fuehrt sie; wer als Gast einer Mitgliedsrunde beitritt,
 * bleibt Teilnehmer, auch wenn der Host geht. Sonst waere ein geteilter Link
 * ein Weg, die Fuehrung einer fremden Runde zu uebernehmen. Durchgesetzt wird
 * das in `darfFuehrungTragen` in `session.ts`.
 *
 * Erzwungen wird all das **serverseitig**, im Modul und in den oeffentlichen
 * Aktionen - nicht dadurch, dass die Oberflaeche einen Knopf weglaesst. Eine
 * Server Action ist ein Endpunkt; wer die Adresse kennt, ruft sie auf.
 *
 * ## Die Grenze, die nicht am Cookie haengt
 *
 * Eine Kennung im Cookie ist loeschbar, und damit ist jede Grenze, die auf
 * ihr sitzt - `offeneProPerson`, die Ratengrenze -, fuer einen entschlossenen
 * Besucher keine. Weil ein Gast nun Runden **anlegen** kann, braucht es eine
 * Grenze, die er nicht umgehen kann: `gastRundenGrenze` begrenzt die Zahl
 * gleichzeitig offener Runden mit einem Gast als Host, serverweit und
 * absolut. Siehe `config.ts`.
 *
 * ## Die Kennung
 *
 * `gast:` und 32 Hexzeichen - 128 Bit aus `randomBytes`. Sie steht in
 * `SpielwahlParticipant.discordId` und `SpielwahlVote.discordId`, in derselben
 * Spalte wie eine Discord-Kennung.
 *
 * **Das ist Absicht und kein Missbrauch der Spalte.** Die Alternative waere
 * eine zweite Teilnehmer- und eine zweite Stimmentabelle, und damit zwei Orte,
 * an denen gezaehlt, entfernt, gesperrt und aufgeraeumt werden muesste - jede
 * Auswertung braeuchte fortan eine Vereinigung, und wer sie einmal vergisst,
 * verliert die Stimmen der Gaeste oder zaehlt Teilnehmer doppelt. Ein Praefix
 * kostet eine Funktion; eine zweite Tabellenfamilie kostet jede Abfrage.
 *
 * Das Praefix ist zugleich der Riegel: eine Discord-Kennung besteht nur aus
 * Ziffern und kann deshalb niemals eine Gastkennung sein, und eine
 * Gastkennung niemals eine Discord-Kennung. Wer den Wert seines Cookies
 * aendert, kann damit keine fremde Person werden - er kann nur ein anderer
 * Gast sein, und das kann er ohnehin, indem er das Cookie loescht.
 *
 * ## Was ausdruecklich nicht geprueft wird
 *
 * Kein Fingerprinting, keine Geraeteerkennung, keine Auswertung der
 * IP-Adresse zur Wiedererkennung. Ein Gast, der sein Cookie loescht, ist ein
 * neuer Gast - das ist der Preis anonymer Teilnahme, und er ist bezahlbar:
 * die Gastteilnahme muss je Runde eingeschaltet werden, ein Gast erscheint
 * als Teilnehmer mit Namen, die Hoechstzahl der Plaetze gilt fuer ihn wie
 * fuer alle, und der Host kann ihn entfernen. Wer eine Abstimmung faelschen
 * will, sitzt sichtbar in der Teilnehmerliste.
 */

export const GAST_PRAEFIX = 'gast:';

/** Die Form einer Gastkennung. Nichts anderes wird als Gast akzeptiert. */
export const GAST_MUSTER = /^gast:[0-9a-f]{32}$/u;

/** Ist das eine Gastkennung - und eine gueltige? */
export function istGastKennung(kennung: string): boolean {
  return GAST_MUSTER.test(kennung);
}

/**
 * Eine neue Gastkennung.
 *
 * Auf dem Server gezogen, mit `randomBytes`. Im Browser erzeugt waere sie
 * frei waehlbar - und eine frei waehlbare Kennung ist keine Kennung.
 */
export function neueGastKennung(): string {
  return `${GAST_PRAEFIX}${randomBytes(16).toString('hex')}`;
}

/**
 * Der Name, den ein Gast sich gibt.
 *
 * Dieselbe Erlaubnisliste wie bei einem freien Spieltitel, nur kuerzer: das
 * ist ein Name in einer Teilnehmerliste und nicht ein Textfeld. Erlaubt sind
 * Buchstaben, Ziffern, Leerzeichen und die paar Satzzeichen, die in
 * Spitznamen vorkommen; ausgeschlossen ist damit alles, was wie eine Adresse,
 * ein Tag oder eine Steuersequenz aussieht.
 *
 * Geprueft wird serverseitig. Der Name geht in eine Liste, die andere Leute
 * lesen - die Pruefung im Formular ist eine Bequemlichkeit.
 */
export const gastNameSchema = z
  .string()
  .trim()
  .min(2, 'Mindestens zwei Zeichen.')
  .max(24, 'Höchstens 24 Zeichen.')
  .regex(/^[\p{L}\p{N} .'_-]+$/u, 'Nur Buchstaben, Ziffern, Leerzeichen und . - _ ’ sind erlaubt.')
  // Ein Name aus Punkten ist kein Name.
  .refine((wert) => /[\p{L}\p{N}]/u.test(wert), 'Der Name braucht Buchstaben oder Ziffern.');
