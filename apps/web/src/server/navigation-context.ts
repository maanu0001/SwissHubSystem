import 'server-only';
import { RUECKKEHR_PARAM, istInterneRoute, mitRueckkehr, type SystemRoute } from '@swisshub/shared';

/**
 * Der Kontext, aus dem jemand kam.
 *
 * Filter, Suche, Sortierung und Seitenzahl stehen in dieser Anwendung
 * durchgehend in der Adresse - die Listen sind `<form method="get">`, die
 * Blätterung sind `<Link>`. Damit erledigen Zurück, Vorwärts und Neuladen
 * im Browser den grössten Teil von selbst, und es braucht keinen globalen
 * Zustand, der dasselbe noch einmal nachhält.
 *
 * Was fehlte, war der Weg von der Detailseite zurück: Wer ein Ticket aus
 * «offen, gefiltert, Seite 3» öffnet und danach auf den Elternbereich
 * klickt, landete auf Seite 1 ohne Filter. Diese Datei schliesst genau diese
 * Lücke - die Adresse der Liste reist als Parameter mit.
 */

/**
 * Die aktuelle Listenadresse, wie sie im Rückweg stehen soll.
 *
 * Aus Pfad und den Suchparametern der Seite zusammengesetzt. Der
 * Rückkehrparameter selbst wird ausgelassen: sonst trüge die Liste ihren
 * eigenen Vorgänger mit, und der dessen Vorgänger - bei jedem Schritt eine
 * Adresse länger.
 */
export function listenKontext(
  pfad: SystemRoute,
  /**
   * Die Suchparameter der Seite, so wie Next.js sie liefert.
   *
   * Bewusst `Readonly<Record<…>>` und nicht ein Modultyp: jede Liste hat ihr
   * eigenes Suchschema, und der Rückweg interessiert sich für keines davon -
   * er trägt weiter, was da ist.
   */
  suche: object,
): SystemRoute {
  const params = new URLSearchParams();
  for (const [schluessel, wert] of Object.entries(suche) as Array<[string, unknown]>) {
    if (schluessel === RUECKKEHR_PARAM || wert === undefined) {
      continue;
    }
    for (const einzeln of Array.isArray(wert) ? wert : [wert]) {
      if (typeof einzeln === 'string' && einzeln !== '') {
        params.append(schluessel, einzeln);
      }
    }
  }
  const abfrage = params.toString();
  return abfrage === '' ? pfad : `${pfad}?${abfrage}`;
}

/**
 * Eine Detailadresse, die den Rückweg mitnimmt.
 *
 * Der eine Weg, auf dem eine Liste auf ihre Detailseiten zeigt.
 */
export function detailHref(ziel: SystemRoute, kontext: SystemRoute | null | undefined): SystemRoute {
  return mitRueckkehr(ziel, kontext);
}

/** Der geprüfte Rückkehrparameter einer Detailseite. */
export function rueckkehrAus(suche: { [RUECKKEHR_PARAM]?: string | string[] } | undefined): string | null {
  const wert = suche?.[RUECKKEHR_PARAM];
  const einzeln = Array.isArray(wert) ? wert[0] : wert;
  return istInterneRoute(einzeln) ? einzeln : null;
}

export { RUECKKEHR_PARAM };
