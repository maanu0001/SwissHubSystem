import 'server-only';
import { cookies } from 'next/headers';
import { COOKIE, isProduction } from '@swisshub/config';
import { issueCsrfToken } from '@swisshub/auth';
import { spielwahl } from '@swisshub/modules';

/**
 * Wer hier ohne Konto zusieht.
 *
 * ## Warum ein Cookie und nicht mehr
 *
 * Ein Gast muss zwischen zwei Anfragen derselbe Gast bleiben - sonst waere
 * jede Stimme die eines Unbekannten und «du hast schon gewaehlt» nicht zu
 * beantworten. Dafuer genuegt eine Kennung, die der Browser zurueckschickt.
 *
 * Es ist ausdruecklich **keine Anmeldung**. Es gibt keinen Benutzer, keine
 * Sitzung in der Datenbank, keine Rollen und keine Berechtigungen; `can()`
 * wird fuer einen Gast nie gefragt, weil es fuer ihn nichts zu fragen gibt.
 * Was er darf, steht in `spielwahl/gast.ts` und wird dort durchgesetzt.
 *
 * ## Warum kein Fingerprinting
 *
 * Weil es die Frage nicht beantwortet, die es zu beantworten vorgibt. Ein
 * Geraetefingerabdruck erkennt zwei Browser desselben Rechners als denselben
 * Besucher - und damit zwei Leute auf einem Sofa als einen. Umgekehrt
 * scheitert er an einem Fenster im privaten Modus. Er waere also gleichzeitig
 * zu streng und zu lax, und er sammelt dafuer Daten ueber Leute, die nur
 * abstimmen wollten.
 *
 * Dasselbe gilt fuer die IP-Adresse: hinter einer sitzt eine Wohnung, ein
 * Studentenheim oder ein Mobilfunkanbieter mit zehntausend Kunden.
 *
 * Wer sein Cookie loescht, ist ein neuer Gast. Das ist der Preis anonymer
 * Teilnahme, und die Gegenmittel sind offen statt heimlich: die Gastteilnahme
 * muss je Runde eingeschaltet werden, ein Gast steht mit Namen in der
 * Teilnehmerliste, die Hoechstzahl der Plaetze gilt fuer ihn, und der Host
 * kann ihn entfernen.
 *
 * ## Warum das CSRF-Token daraus entsteht
 *
 * `issueCsrfToken` ist ein HMAC ueber eine Zeichenkette - im Normalfall die
 * Sitzungskennung. Ein Gast hat keine, wohl aber eine Kennung, die nur er und
 * der Server kennen: das Cookie ist `httpOnly`, eine fremde Seite kann es
 * nicht lesen. Damit ist das Token aus ihr ableitbar und von aussen nicht zu
 * erraten - genau die Eigenschaft, die ein CSRF-Token braucht.
 */

/** Die Lebensdauer des Cookies - so lang wie eine Session hoechstens laeuft. */
const GAST_COOKIE_TAGE = 7;

export interface GastBesucher {
  kennung: string;
  csrfToken: string;
}

/**
 * Die Kennung aus dem Cookie - oder `null`.
 *
 * Geprueft wird die Form, nicht nur die Anwesenheit. Ein Cookie, in das
 * jemand eine Discord-Kennung geschrieben hat, faellt hier durch und nicht
 * erst in der Aktion; dort faellt es ebenfalls durch
 * (`verlangeGastZugang`), aber eine Pruefung, die zweimal stattfindet, ist
 * eine, die man nicht vergessen kann.
 */
export async function gastKennung(): Promise<string | null> {
  const wert = (await cookies()).get(COOKIE.spielwahlGast)?.value;
  return wert && spielwahl.istGastKennung(wert) ? wert : null;
}

/**
 * Die Kennung dieses Besuchers - vorhanden oder neu vergeben.
 *
 * Aufrufbar nur, wo Next.js das Setzen von Cookies erlaubt: in einer Server
 * Action oder einem Route Handler. Auf einer Seite gerufen wuerde Next.js
 * werfen - deshalb liest die Seite mit `gastKennung()` und vergibt nichts.
 */
export async function sicherGastKennung(): Promise<GastBesucher> {
  const speicher = await cookies();
  const vorhanden = speicher.get(COOKIE.spielwahlGast)?.value;

  if (vorhanden && spielwahl.istGastKennung(vorhanden)) {
    return { kennung: vorhanden, csrfToken: issueCsrfToken(vorhanden) };
  }

  const kennung = spielwahl.neueGastKennung();
  speicher.set(COOKIE.spielwahlGast, kennung, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'lax',
    path: '/',
    maxAge: GAST_COOKIE_TAGE * 24 * 60 * 60,
  });
  return { kennung, csrfToken: issueCsrfToken(kennung) };
}

/** Das CSRF-Token eines Gastes - fuer die Seite, die seine Knoepfe zeichnet. */
export function gastCsrfToken(kennung: string): string {
  return issueCsrfToken(kennung);
}
