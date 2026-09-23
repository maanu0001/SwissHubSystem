'use client';

import { useCallback, useRef, useState } from 'react';
import { WrappedStory } from './story';
import { wrappedFortschrittAction } from './aktionen';
import { TeilenLeiste } from './components/teilen-leiste';
import type { WrappedDaten } from '@swisshub/modules/wrapped/daten';

/**
 * Der Rueckblick eines Mitglieds.
 *
 * ## Warum es diese Huelle ueberhaupt gibt
 *
 * Die Buehne selbst weiss nichts von Kampagnen, Berechtigungen oder
 * Fortschritt - und das soll so bleiben. Hier kommen genau zwei Dinge
 * dazu: dass sich der Server merkt, wie weit jemand gekommen ist, und die
 * Leiste zum Teilen am Ende.
 *
 * ## Warum nicht jede Szene gemeldet wird
 *
 * Vierzehn Szenen waeren vierzehn Anfragen fuer eine Sache, die nur beim
 * Verlassen der Seite zaehlt. Gemeldet wird deshalb die erste Szene - damit
 * «geoeffnet» stimmt -, danach hoechstens alle paar Sekunden eine, und das
 * Ende. Wer durchblaettert, erzeugt trotzdem nicht mehr als eine Handvoll
 * Anfragen.
 */
const MINDESTABSTAND_MS = 4000;

export function WrappedAnsicht({
  campaignId,
  schluessel,
  daten,
  sceneKeys,
  jahr,
  zurueckHref,
  startIndex,
  csrfToken,
  teilenErlaubt,
}: {
  campaignId: string;
  /** Der Schluessel in der Adresse - die Karten haengen daran. */
  schluessel: string;
  daten: WrappedDaten;
  sceneKeys: string[];
  jahr: number;
  zurueckHref: string;
  startIndex: number;
  csrfToken: string;
  teilenErlaubt: boolean;
}): React.JSX.Element {
  const zuletzt = useRef(0);
  const [amEnde, setAmEnde] = useState(false);
  const [lauf, setLauf] = useState(0);

  const melde = useCallback(
    (sceneKey: string, abgeschlossen: boolean): void => {
      const jetzt = Date.now();
      if (!abgeschlossen && jetzt - zuletzt.current < MINDESTABSTAND_MS) {
        return;
      }
      zuletzt.current = jetzt;
      /*
       * Bewusst ohne `await` und ohne Fehlermeldung.
       *
       * Ob der Server sich den Fortschritt merkt, ist fuer die Geschichte
       * ohne Belang. Eine Fehlermeldung mitten im Rueckblick waere das
       * Gegenteil von dem, wofuer es ihn gibt.
       */
      void wrappedFortschrittAction({ csrfToken, campaignId, sceneKey, abgeschlossen }).catch(
        () => undefined,
      );
    },
    [campaignId, csrfToken],
  );

  const letzte = sceneKeys[sceneKeys.length - 1] ?? 'finale';

  return (
    <WrappedStory
      /*
       * Der Schluessel setzt die Geschichte zurueck.
       *
       * «Nochmal» heisst: von der ersten Szene an, mit allen Animationen
       * von vorn. Ein zurueckgesetzter Index allein wuerde die Szene
       * wiederverwenden, und eine CSS-Animation startet nur an einem
       * frischen Element.
       */
      key={lauf}
      daten={daten}
      sceneKeys={sceneKeys}
      jahr={jahr}
      zurueckHref={zurueckHref}
      startIndex={lauf === 0 ? startIndex : 0}
      aufSzene={(info) => {
        melde(info.key, false);
        // Die Leiste gehoert an den Abspann und nirgendwo sonst.
        setAmEnde(info.index === info.gesamt - 1);
      }}
      aufEnde={() => {
        melde(letzte, true);
        setAmEnde(true);
      }}
      overlay={
        amEnde && teilenErlaubt ? (
          <TeilenLeiste
            schluessel={schluessel}
            aufZurueck={() => {
              setAmEnde(false);
              setLauf((bisher) => bisher + 1);
            }}
          />
        ) : null
      }
    />
  );
}
