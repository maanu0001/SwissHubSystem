import type { SystemRoute } from '@swisshub/shared';

/**
 * Benachrichtigungen im Dashboard.
 *
 * Sie entstehen aus den **bestehenden** Domain Events, die die Module ohnehin
 * melden - nicht aus einem zweiten Satz Discord-Listener und nicht aus dem
 * Audit Log. Das Audit Log hält fest, was geschehen ist; eine
 * Benachrichtigung sagt jemandem, dass etwas auf ihn wartet.
 *
 * Der Unterschied ist der ganze Grund, warum die Liste unten kurz ist: eine
 * Glocke mit dreihundert Einträgen am Tag öffnet niemand mehr, und dann geht
 * auch die eine Meldung unter, auf die es ankam. Aufgenommen wird ein
 * Ereignis nur, wenn daraus ein Handlungsbedarf folgt.
 */

/** Woraus sich der Empfängerkreis ergibt. */
export type Empfaengerkreis =
  | {
      /**
       * Alle, die diese Berechtigung besitzen.
       *
       * Die Prüfung läuft über die bestehende Permission Engine - dieselbe,
       * die auch die Seite prüft, auf die der Deep Link zeigt. Eine zweite
       * Rechteberechnung gäbe es hier nicht.
       */
      art: 'berechtigung';
      permission: string;
      /** Nur, solange dieses Modul eingeschaltet ist. */
      moduleId?: string;
    }
  | {
      /** Genau eine Person - aus den Nutzdaten des Ereignisses. */
      art: 'person';
      discordId: (payload: Record<string, unknown>) => string | null;
    };

export interface Benachrichtigungsregel {
  /** Das Domain Event, auf das sie hört. */
  eventType: string;
  /** Die Art - sie entscheidet über Symbol und Beschriftung. */
  kind: string;
  empfaenger: Empfaengerkreis;
  /**
   * Der Inhalt. Gibt `null` zurück, wenn aus diesem Ereignis keine Meldung
   * folgen soll - etwa weil die Nutzdaten nicht taugen.
   */
  bauen(eingabe: {
    payload: Record<string, unknown>;
    actorId: string | null;
    subjectId: string | null;
    entityId: string | null;
  }): {
    titel: string;
    text?: string | null;
    route?: SystemRoute | null;
    /**
     * Gleichartige Meldungen teilen sich eine Zeile.
     *
     * Fünf gescheiterte Läufe derselben Automation sind eine Meldung mit
     * einer Zahl, nicht fünf Meldungen.
     */
    gruppe?: string | null;
  } | null;
}

/** Symbol und Beschriftung einer Art - die Oberfläche liest sie hier. */
export interface Benachrichtigungsart {
  kind: string;
  label: string;
  /** Name eines Lucide-Symbols. */
  icon: string;
}
