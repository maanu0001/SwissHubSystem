'use client';

import { useCallback, useRef } from 'react';
import { WrappedStory } from './story';
import { wrappedFortschrittAction } from './aktionen';
import type { WrappedDaten } from '@swisshub/modules/wrapped/daten';

/**
 * Der Rueckblick eines Mitglieds.
 *
 * ## Warum es diese Huelle ueberhaupt gibt
 *
 * Die Buehne selbst weiss nichts von Kampagnen, Berechtigungen oder
 * Fortschritt - und das soll so bleiben. Hier wird genau eine Sache
 * ergaenzt: dass sich der Server merkt, wie weit jemand gekommen ist,
 * damit ein zweiter Aufruf dort fortsetzen kann, wo der erste aufhoerte.
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
  daten,
  sceneKeys,
  jahr,
  zurueckHref,
  startIndex,
  csrfToken,
}: {
  campaignId: string;
  daten: WrappedDaten;
  sceneKeys: string[];
  jahr: number;
  zurueckHref: string;
  startIndex: number;
  csrfToken: string;
}): React.JSX.Element {
  const zuletzt = useRef(0);

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

  return (
    <WrappedStory
      daten={daten}
      sceneKeys={sceneKeys}
      jahr={jahr}
      zurueckHref={zurueckHref}
      startIndex={startIndex}
      aufSzene={(info) => melde(info.key, false)}
      aufEnde={() => melde(sceneKeys[sceneKeys.length - 1] ?? 'finale', true)}
    />
  );
}
