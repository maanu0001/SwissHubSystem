import type { ActionResult } from '@swisshub/shared';
import {
  spielwahlAnnehmenAction,
  spielwahlBeitretenAction,
  spielwahlEroeffnenAction,
  spielwahlHierAction,
  spielwahlKandidatEntfernenAction,
  spielwahlModusSetzenAction,
  spielwahlNeuLosenAction,
  spielwahlNochEineAction,
  spielwahlPhaseOeffnenAction,
  spielwahlPhaseSchliessenAction,
  spielwahlSchliessenAction,
  spielwahlSpieleSuchenAction,
  spielwahlStartenAction,
  spielwahlStimmeAction,
  spielwahlVerlassenAction,
  spielwahlVorschlagenAction,
  spielwahlZurueckziehenAction,
} from '@/modules/spielwahl/aktionen';
import {
  gastAnnehmenAction,
  gastBeitretenAction,
  gastEroeffnenAction,
  gastHierAction,
  gastKandidatEntfernenAction,
  gastModusSetzenAction,
  gastNeuLosenAction,
  gastNochEineAction,
  gastPhaseOeffnenAction,
  gastPhaseSchliessenAction,
  gastSchliessenAction,
  gastSpieleSuchenAction,
  gastStartenAction,
  gastStimmeAction,
  gastVerlassenAction,
  gastVorschlagAction,
  gastZurueckziehenAction,
} from '@/modules/spielwahl/gast-aktionen';

/**
 * Die Befehle einer Spielauswahl - zweimal dasselbe, einmal je Identität.
 *
 * ## Warum eine Tabelle und nicht Fragezeichen im Code
 *
 * Es gibt zwei Arten von Identität in diesem Modul und nur eine Oberfläche.
 * Ein Mitglied läuft durch `defineAction` (Anmeldung, Mitgliedschaft, CSRF
 * gegen die Sitzung, Berechtigung); ein Besucher ohne Konto läuft durch
 * `defineOeffentlicheAktion` (Gastkennung aus dem Cookie, CSRF gegen diese
 * Kennung, `verlangeGastZugang` statt der drei entfallenen Glieder).
 *
 * Zwei Ketten, weil es zwei Arten von Identität sind - aber **ein** Ablauf.
 * Die Bühne, die Lobby, die Regeln und die Steuerung bekommen deshalb diese
 * Tabelle und nicht die Aktionen selbst. Ohne sie stünde in jeder
 * Komponente `gast ? gastX : spielwahlX`, und die Stelle, an der das beim
 * nächsten Knopf vergessen wird, ist immer die öffentliche.
 *
 * ## Dass die Tabelle vollständig ist, ist hier nachprüfbar
 *
 * Beide Sätze erfüllen dasselbe Interface. Ein Befehl, den es nur für
 * Mitglieder gibt, lässt sich nicht eintragen, ohne dass der Compiler den
 * fehlenden Gegenpart nennt - und ein Befehl, den eine Komponente direkt
 * importiert statt hier zu holen, fällt im Diff auf, weil die Komponenten
 * `aktionen` sonst nicht mehr importieren.
 *
 * Was hier **nicht** steht und absichtlich nicht:
 *
 *  - **Den Spielkatalog pflegen** (`games-aktionen.ts`, `spielwahl.manage`).
 *  - **Eine fremde Runde moderieren.** `schliessen` schliesst für ein
 *    Mitglied mit `spielwahl.manage` auch eine fremde Runde - das entscheidet
 *    die Aktion selbst, nicht diese Tabelle. Der Gastbefehl kann es nicht.
 *  - **Jemanden ernennen oder entfernen.** Dafür gibt es keine Oberfläche,
 *    also auch keinen Eintrag.
 */

/**
 * Ein Befehl nimmt ein Formularobjekt und gibt ein Ergebnis zurück.
 *
 * `& Record<string, unknown>` ist kein Schmuck: eine Server Action nimmt
 * `Record<string, unknown> & { csrfToken?: string }`, weil sie ihre Eingabe
 * erst mit einem Zod-Schema prüft. Ohne den Zusatz wäre keine der Aktionen
 * diesem Typ zuweisbar - ein `interface` hat keine Indexsignatur. Für den
 * Aufrufer ändert sich nichts: ein Objektliteral erfüllt beides.
 */
type Befehl<TEingabe, TErgebnis = unknown> = (
  eingabe: TEingabe & Record<string, unknown>,
) => Promise<ActionResult<TErgebnis>>;

/** Was jeder Befehl mitbekommt: die Runde und das Token dieser Identität. */
interface Basis {
  sessionId: string;
  csrfToken: string;
}

/** Befehle, die den Zustand aller ändern, tragen einen Idempotenzschlüssel. */
interface MitSchluessel extends Basis {
  schluessel: string;
}

export interface Befehlssatz {
  beitreten: Befehl<Basis & { name?: string; schluessel?: string }>;
  verlassen: Befehl<Basis>;
  hier: Befehl<Basis>;
  stimme: Befehl<Basis & { candidateId: string; duell: number }>;

  vorschlagen: Befehl<MitSchluessel & { gameId?: string; freierName?: string }>;
  zurueckziehen: Befehl<Basis & { candidateId: string }>;
  kandidatEntfernen: Befehl<Basis & { candidateId: string }>;
  spieleSuchen: Befehl<Basis & { query: string }, { spiele: SpielTreffer[] }>;

  phaseSchliessen: Befehl<MitSchluessel>;
  phaseOeffnen: Befehl<MitSchluessel>;
  regelnSetzen: Befehl<Basis & Record<string, unknown>>;
  starten: Befehl<MitSchluessel>;
  neuLosen: Befehl<MitSchluessel>;
  nochEine: Befehl<MitSchluessel>;
  annehmen: Befehl<MitSchluessel>;
  schliessen: Befehl<Basis>;
}

/** Ein Treffer der Spielsuche - dieselbe Form in beiden Sätzen. */
export interface SpielTreffer {
  id: string;
  name: string;
  bannerUrl: string | null;
  maxSquadSize: number | null;
}

export const MITGLIEDSBEFEHLE: Befehlssatz = {
  beitreten: spielwahlBeitretenAction,
  verlassen: spielwahlVerlassenAction,
  hier: spielwahlHierAction,
  stimme: spielwahlStimmeAction,

  vorschlagen: spielwahlVorschlagenAction,
  zurueckziehen: spielwahlZurueckziehenAction,
  kandidatEntfernen: spielwahlKandidatEntfernenAction,
  spieleSuchen: spielwahlSpieleSuchenAction,

  phaseSchliessen: spielwahlPhaseSchliessenAction,
  phaseOeffnen: spielwahlPhaseOeffnenAction,
  regelnSetzen: spielwahlModusSetzenAction,
  starten: spielwahlStartenAction,
  neuLosen: spielwahlNeuLosenAction,
  nochEine: spielwahlNochEineAction,
  annehmen: spielwahlAnnehmenAction,
  schliessen: spielwahlSchliessenAction,
};

export const GASTBEFEHLE: Befehlssatz = {
  beitreten: gastBeitretenAction,
  verlassen: gastVerlassenAction,
  hier: gastHierAction,
  stimme: gastStimmeAction,

  vorschlagen: gastVorschlagAction,
  zurueckziehen: gastZurueckziehenAction,
  kandidatEntfernen: gastKandidatEntfernenAction,
  spieleSuchen: gastSpieleSuchenAction,

  phaseSchliessen: gastPhaseSchliessenAction,
  phaseOeffnen: gastPhaseOeffnenAction,
  regelnSetzen: gastModusSetzenAction,
  starten: gastStartenAction,
  neuLosen: gastNeuLosenAction,
  nochEine: gastNochEineAction,
  annehmen: gastAnnehmenAction,
  schliessen: gastSchliessenAction,
};

/**
 * Das Eröffnen steht neben der Tabelle, nicht darin.
 *
 * Es hat keine `sessionId` - es ist der Befehl, der eine anlegt. Und es
 * braucht für einen Gast ein Feld, das ein Mitglied nicht hat: den Namen,
 * unter dem er als Host in der Liste steht. Ein gemeinsamer Eintrag müsste
 * beides optional machen und hätte damit genau die Unschärfe, gegen die die
 * Tabelle gebaut ist.
 */
export const EROEFFNEN = {
  mitglied: spielwahlEroeffnenAction as Befehl<
    { csrfToken: string; modus: string },
    { sessionId: string; inviteToken: string }
  >,
  gast: gastEroeffnenAction as Befehl<
    { csrfToken: string; modus: string; name: string },
    { sessionId: string; inviteToken: string }
  >,
};
