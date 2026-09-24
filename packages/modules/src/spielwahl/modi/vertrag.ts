import type { Prisma, SpielwahlModus, SpielwahlRound, SpielwahlSession } from '@swisshub/database';
import type { RandomSource } from '../../zufall';

/**
 * Was ein Entscheidungsmodus koennen muss.
 *
 * ## Warum ueberhaupt ein Vertrag
 *
 * Weil das Rad nicht der letzte Modus sein wird. «Team-Auslosung» und
 * «Challenge-Roulette» stehen schon in der Produktidee, und ein vierter Modus
 * soll eine Datei sein und kein Eingriff in die Session-Orchestrierung.
 *
 * Die Trennung laeuft genau entlang einer Frage: **wie** wird entschieden?
 * Alles andere - wer mitmacht, welche Kandidaten es gibt, wann eine Runde
 * beginnt, wie der Zustand fortschreitet - gehoert der Session und ist fuer
 * alle Modi gleich.
 *
 * ## Die drei Zeitpunkte
 *
 *   - `starte`   Die Runde beginnt. Hier faellt beim Roulette bereits der
 *                Gewinner; beim Voting und bei der Ausscheidung entsteht der
 *                Rahmen, in dem gestimmt wird.
 *   - `stimme`   Jemand stimmt ab. Das Roulette kennt diesen Zeitpunkt nicht.
 *   - `pruefe`   Kann die Runde jetzt enden? Wird vom Timer, vom Live-Strom
 *                und vom Bot aufgerufen - beliebig oft, auch gleichzeitig.
 *
 * `pruefe` **muss** wiederholbar sein: dass es zweimal aufgerufen wird, ist
 * der Normalfall und kein Fehler.
 */

export interface ModusKontext {
  tx: Prisma.TransactionClient;
  session: SpielwahlSession;
  /** Die Kandidaten der Runde in der Reihenfolge, in der sie eingefroren wurden. */
  kandidaten: string[];
  /**
   * Wer gerade mitspielt - Grundlage fuer «alle haben gestimmt».
   *
   * Die Kennungen und nicht nur ihre Zahl. Der Unterschied wurde an einem
   * Abend sichtbar, an dem der Host nach seiner Stimme ging: fuenf Stimmen
   * bei fuenf Anwesenden sahen nach «alle fertig» aus, obwohl eine davon von
   * jemandem kam, der nicht mehr da war - und der letzte Anwesende kam nicht
   * mehr zum Zug. Seine Stimme zaehlt weiter, sie zaehlt nur nicht mehr als
   * Anwesenheit.
   */
  anwesende: string[];
  jetzt: Date;
}

export interface StartErgebnis {
  /** Was in der Runde festgehalten wird, ueber die gemeinsamen Felder hinaus. */
  daten: Partial<Prisma.SpielwahlRoundUncheckedCreateInput>;
}

export interface StimmEingabe {
  tx: Prisma.TransactionClient;
  session: SpielwahlSession;
  runde: SpielwahlRound;
  discordId: string;
  candidateId: string;
  /** Bei der Ausscheidung die Nummer des Duells, sonst 0. */
  duell: number;
  jetzt: Date;
}

/** Was aus einer abgeschlossenen Runde herauskommt. */
export interface Ausgang {
  /** Der Sieger - oder `null`, wenn die Runde noch weiterlaeuft. */
  gewinnerCandidateId: string | null;
  /** Wie er zustande kam. Steht spaeter auf der Buehne. */
  entscheidungsart?: string;
  /** Aenderungen an der Runde, die der Modus vornehmen will. */
  daten?: Prisma.SpielwahlRoundUncheckedUpdateInput;
  /** Die Runde laeuft weiter - etwa zum naechsten Duell. */
  weiter?: boolean;
  /**
   * Kein Sieger, sondern eine Stichwahl unter diesen Kandidaten.
   *
   * Die aktuelle Runde endet, und die Orchestrierung eroeffnet sofort eine
   * neue - mit demselben Modus, aber nur noch mit diesen Kandidaten. Bewusst
   * ein eigenes Feld und kein `null` mit Nebenbedeutung: «es gibt keinen
   * Sieger» und «es geht mit dreien weiter» sind zwei verschiedene
   * Nachrichten, und wer sie in eine presst, verwechselt sie spaeter.
   */
  stichwahlUnter?: string[];
}

export interface EntscheidungsModus {
  key: SpielwahlModus;
  label: string;
  /** Ein Satz, der auf der Buehne steht, bevor es losgeht. */
  beschreibung: string;
  /** Braucht dieser Modus Stimmen? */
  stimmt: boolean;
  /**
   * Der Rahmen der Runde.
   *
   * Bekommt eine Zufallsquelle, die aus dem Seed der Runde gespeist wird -
   * damit laesst sich jede Auslosung nachrechnen.
   */
  starte(kontext: ModusKontext, random: RandomSource): Promise<StartErgebnis>;
  /** Eine Stimme entgegennehmen. Fehlt, wenn der Modus nicht abstimmt. */
  stimme?(eingabe: StimmEingabe): Promise<void>;
  /** Kann die Runde enden? Muss wiederholbar sein. */
  pruefe(kontext: ModusKontext, runde: SpielwahlRound, random: RandomSource): Promise<Ausgang>;
}
