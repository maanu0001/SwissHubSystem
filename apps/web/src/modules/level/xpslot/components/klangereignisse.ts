'use client';

import { useCallback } from 'react';
import type { level } from '@swisshub/modules';
import type { Tonausgabe } from './tonausgabe';

/**
 * Die Klangereignisse des XP-Slots.
 *
 * ## Warum es diese Schicht gibt
 *
 * Weil der Ton vorher an der Zeit hing und nicht an dem, was zu sehen war.
 * Im Spielablauf stand zwischen zwei `await warte(...)` ein `ton.spiele(...)`
 * - und damit war die Synchronitaet eine Rechnung, die jedes Mal neu
 * aufgehen musste. Sie ging nicht immer auf: der Quick Spin hielt fuenf
 * Walzen an und spielte **einen** Stoppklang, weil an dieser Stelle ein
 * Aufruf stand und nicht fuenf.
 *
 * Jetzt meldet die Oberflaeche, **was passiert** - «Walze drei steht» -, und
 * hier steht, wie das klingt. Zwei Vorteile, und beide sind der Grund fuer
 * die Datei:
 *
 *  1. Der Klang kann nicht mehr neben der Bewegung landen, weil er an
 *     derselben Zeile haengt, die die Bewegung ausloest. Kein `setTimeout`
 *     entscheidet mehr darueber.
 *  2. Was wann klingt, steht an **einer** Stelle und ist abzaehlbar. Ein Test
 *     kann die Ereignisse eines Spins zaehlen - fuenf Walzenstopps, ein
 *     Spinstart, vier Linienklaenge - ohne die Oberflaeche zu starten.
 *
 * ## Was hier nicht hingehoert
 *
 * Entscheidungen. Ob ein Spin gewonnen hat, wie viele Freispiele offen sind
 * und was eine Linie wert ist, steht im Ergebnis des Servers; diese Schicht
 * uebersetzt nur. Sie liest nichts nach und rechnet nichts aus.
 */

/** Welcher Klang zu welcher Gewinnstufe gehoert. */
export const STUFEN_KLANG: Readonly<Record<level.xpslot.Gewinnstufe, string>> = {
  keine: 'no_win',
  klein: 'win_small',
  normal: 'win_normal',
  gross: 'win_big',
  mega: 'win_mega',
  jackpot: 'jackpot',
};

/**
 * Ein Ereignis der Inszenierung.
 *
 * Die Namen sind die des Konzepts, damit man beides nebeneinander lesen
 * kann; die Nutzlast ist deutsch wie der uebrige Code.
 */
export type SlotEreignis =
  /** Der Spin beginnt - Walzen an, Lauf an. */
  | { art: 'spinStarted' }
  /** Der Spin wurde abgewiesen: Lauf aus, kein Ergebnisklang. */
  | { art: 'spinAborted' }
  /** Genau eine Walze ist eingerastet. Je Walze einmal. */
  | { art: 'reelStopped'; walze: number }
  /** Alle Walzen stehen - der Lauf blendet aus. */
  | { art: 'reelsFinished' }
  /**
   * Der zweite Klick: alles sofort auf die Endposition.
   *
   * Auch hier bekommt jede noch laufende Walze ihren Stoppklang - `walzen`
   * sagt, wie viele es sind. Ein einziger Klang fuer fuenf gleichzeitig
   * haltende Walzen war der Mangel, der diese Datei ausgeloest hat. Den Lauf
   * beendet `reelsFinished`, das danach kommt - auch nach einem Sprung.
   */
  | { art: 'spinSkipped'; walzen: number }
  /** Die entscheidende Walze dreht weiter. Genau einmal je Spin. */
  | { art: 'bonusSweatStarted' }
  | { art: 'bonusTriggered'; retrigger: boolean }
  /**
   * Das Ergebnis eines Spins, wenn die Linien **nicht** einzeln kommen.
   *
   * Quick Spin, weniger Bewegung, ein einzelner Treffer: dann gibt es einen
   * Klang fuer das Ergebnis. Kommen mehrere Linien nacheinander, klingt
   * jede einzeln - und dieser Klang entfaellt, sonst waeren es fuenf Klaenge
   * fuer vier Linien.
   */
  | { art: 'spinResult'; stufe: level.xpslot.Gewinnstufe }
  /** Eine einzelne Gewinnlinie wird gezeigt - mit ihrer eigenen Stufe. */
  | { art: 'winLineShown'; stufe: level.xpslot.Gewinnstufe }
  | { art: 'allLinesFinished' }
  | { art: 'premiumWin' }
  | { art: 'bonusRevealed' }
  | { art: 'freespinsStarted' }
  | { art: 'freespinsFinished' }
  | { art: 'gambleStarted' }
  | { art: 'gambleLanded'; gewonnen: boolean }
  | { art: 'bonusFinished'; gewonnen: boolean }
  /** Die Grundstimmung: normale Musik oder Freispielmusik. */
  | { art: 'stimmung'; freispiel: boolean }
  | { art: 'uiClick' };

export type Melder = (ereignis: SlotEreignis) => void;

/**
 * Was ein Ereignis klingen laesst.
 *
 * Eine Funktion mit einem `switch` - absichtlich keine Tabelle. Mehrere
 * Faelle machen zwei Dinge (einen Klang **und** eine Schleife), und ein paar
 * haengen an einer Einstellung; eine Tabelle muesste das in Funktionen
 * verstecken und waere dann schwerer zu lesen als dieser Block.
 *
 * ## Warum eine freie Funktion und kein Hook
 *
 * Weil sie dann zaehlbar ist. Ein Test kann die Ereignisse eines Spins
 * durchschicken - ein Spinstart, fuenf Walzenstopps, vier Linien - und
 * nachsehen, was dabei gespielt wurde, ohne eine Oberflaeche zu starten und
 * ohne ein DOM. Genau das verlangt das Konzept: «Audio Events zaehlen».
 * Der Hook darunter ist nur die Bindung an React.
 */
export function klangFuer(ereignis: SlotEreignis, ton: Tonausgabe): void {
  switch (ereignis.art) {
    case 'spinStarted': {
      ton.spiele('spin_start');
      ton.starteSchleife('reel_loop');
      return;
    }
    case 'spinAborted': {
      ton.stoppeSchleife('reel_loop');
      return;
    }
    case 'reelStopped': {
      ton.spiele('reel_stop');
      return;
    }
    case 'reelsFinished': {
      ton.stoppeSchleife('reel_loop');
      return;
    }
    case 'spinSkipped': {
      /*
       * Fuenf Walzen, fuenf Stoppklaenge - in einem Atemzug.
       *
       * Der Stimmenpool der Tonausgabe macht daraus einen Aufschlag und
       * keinen Brei: jeder Klang bekommt eine eigene Stimme und seine
       * eigene kleine Abweichung in Tonhoehe. Genau das ist der
       * «cleane Quick-Stop-Mix» - und ausdruecklich nicht eine einzelne
       * Datei fuer alle Walzen.
       */
      for (let walze = 0; walze < ereignis.walzen; walze += 1) {
        ton.spiele('reel_stop');
      }
      return;
    }
    case 'bonusSweatStarted': {
      ton.spiele('bonus_sweat');
      return;
    }
    case 'bonusTriggered': {
      // Ein ausgeloester Bonus ersetzt den Gewinnklang, er kommt nicht
      // dazu: zwei Aussagen zur selben Zeit, und die wichtigere ginge
      // unter.
      ton.spiele(ereignis.retrigger ? 'retrigger' : 'bonus_trigger');
      return;
    }
    case 'spinResult':
    case 'winLineShown': {
      ton.spiele(STUFEN_KLANG[ereignis.stufe]);
      return;
    }
    case 'allLinesFinished': {
      // Kein eigener Klang: die Summe wurde eben vorgezeigt, Linie um
      // Linie. Ein Abschlussklang waere einer zu viel.
      return;
    }
    case 'premiumWin': {
      ton.spiele('premium_win');
      return;
    }
    case 'bonusRevealed': {
      ton.spiele('bonus_reveal');
      return;
    }
    case 'freespinsStarted': {
      ton.spiele('freespin_start');
      return;
    }
    case 'freespinsFinished': {
      ton.spiele('freespin_end');
      return;
    }
    case 'gambleStarted': {
      ton.spiele('gamble_start');
      ton.starteSchleife('gamble_spin');
      ton.spiele('gamble_tension');
      return;
    }
    case 'gambleLanded': {
      // Der Lauf hoert auf, wenn das Rad steht - nicht, wenn ein Timer
      // ablaeuft. `sofort` weil hier eine Bewegung endet: eine Ausblende
      // waere ein Nachlaufen nach dem sichtbaren Stillstand.
      ton.stoppeSchleife('gamble_spin', { sofort: true });
      ton.spiele(ereignis.gewonnen ? 'gamble_win' : 'gamble_lose');
      return;
    }
    case 'bonusFinished': {
      /*
       * Nur der gewonnene Abschluss klingt hier.
       *
       * Ein verlorener Bonus endet immer an der Leiter, und dort hat
       * `gambleLanded` schon `gamble_lose` gespielt. Ein zweiter Klang
       * darueber waere zwei Mal dieselbe Nachricht.
       */
      if (ereignis.gewonnen) {
        ton.spiele('freespin_end');
      }
      return;
    }
    case 'stimmung': {
      /*
       * Die Ueberblendung.
       *
       * Beide Aufrufe im selben Moment: die eine Schleife blendet aus,
       * waehrend die andere einblendet. Mehr braucht es nicht - die
       * Blenden liegen in der Tonausgabe, und sie sind fuer die
       * Musikslots lang genug, dass man den Wechsel als Wechsel hoert
       * und nicht als Schnitt.
       */
      if (ereignis.freispiel) {
        ton.stoppeSchleife('musik');
        ton.starteSchleife('freespin_loop');
      } else {
        ton.stoppeSchleife('freespin_loop');
        if (ton.einstellungen.musikAn) {
          ton.starteSchleife('musik');
        }
      }
      return;
    }
    case 'uiClick': {
      ton.spiele('ui_button');
      return;
    }
  }
}

/** Dieselbe Zuordnung, an React gebunden. */
export function useKlangEreignisse(ton: Tonausgabe): Melder {
  return useCallback((ereignis: SlotEreignis) => klangFuer(ereignis, ton), [ton]);
}
