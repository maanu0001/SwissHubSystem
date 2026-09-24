import { prisma } from '@swisshub/database';
import type { SpielwahlModus, SpielwahlRolle, SpielwahlStatus } from '@swisshub/database';
import { loadPersonen } from '../members/avatars';
import { leseBaum, type Baum } from './modi';
import { listeKandidaten, type KandidatAnsicht } from './kandidaten';

/**
 * Der Stand einer Session, wie ihn alle sehen.
 *
 * ## Warum ein Schnappschuss und keine Ereignisliste
 *
 * Eine Ereignisliste waere sparsamer und in jeder anderen Hinsicht
 * schlechter. Ein Client, der zwanzig Sekunden offline war, muesste die
 * verpassten Ereignisse nachholen; ein Client, der neu dazukommt, braucht
 * ohnehin den ganzen Stand; und ein Ereignis, das unterwegs verloren geht,
 * liesse einen Browser dauerhaft falsch stehen.
 *
 * Ein Schnappschuss mit Revisionsnummer hat keines dieser Probleme: wer
 * einen neueren bekommt, ersetzt seinen; wer einen aelteren bekommt, wirft
 * ihn weg. Reconnect ist dadurch kein Sonderfall, sondern der Normalfall.
 *
 * ## Was **nicht** darin steht
 *
 * Waehrend einer geheimen Abstimmung: wer was gewaehlt hat, und wie die
 * Zwischenstaende sind. Der Server sendet es nicht - er sendet nicht etwa
 * alles und blendet es in der Oberflaeche aus. Was der Browser nicht hat,
 * kann niemand aufdecken.
 *
 * Die eigene Stimme steht darin, denn die kennt der Absender ohnehin.
 */

export interface TeilnehmerAnsicht {
  discordId: string;
  rolle: SpielwahlRolle;
  /** Hat diese Person in der laufenden Abstimmung schon gewaehlt? */
  hatGewaehlt: boolean;
  /*
   * Name und Bild reisen mit.
   *
   * Sonst muesste die Oberflaeche je Teilnehmer nachschlagen - bei zwoelf
   * Leuten zwoelf Abfragen, und zwar bei jeder Aenderung neu. Aufgeloest
   * wird ueber `loadPersonen`, dieselbe Stelle wie im Audit-Protokoll.
   */
  anzeigename: string;
  avatarHash: string | null;
}

export interface RundeAnsicht {
  id: string;
  nummer: number;
  modus: SpielwahlModus;
  kandidaten: string[];
  /** Serverzeit, nach der nichts mehr angenommen wird. */
  endsAt: string | null;
  /** Wann die Runde begann - Grundlage fuer den Einstieg mitten in der Animation. */
  startedAt: string;
  gewinnerCandidateId: string | null;
  entscheidungsart: string | null;
  /** Die Herleitung der Ziehung - sichtbar, damit sie pruefbar ist. */
  seed: string;
  losPunkt: number | null;
  losGesamt: number | null;
  /** Ausscheidung: der Turnierbaum und das laufende Duell. */
  baum: Baum | null;
  duellIndex: number;
  /** Wie viele schon gewaehlt haben - auch bei geheimer Abstimmung. */
  abgegeben: number;
  /** Die Stimmen je Kandidat. Bei geheimer Abstimmung erst nach dem Ende. */
  stimmen: Record<string, number> | null;
  /** Wofuer der Betrachter selbst gestimmt hat. */
  eigeneStimmen: string[];
}

export interface SessionAnsicht {
  id: string;
  inviteToken: string;
  status: SpielwahlStatus;
  modus: SpielwahlModus;
  revision: number;
  hostDiscordId: string;
  /** Serverzeit beim Erstellen des Schnappschusses - der Bezugspunkt jedes Countdowns. */
  jetzt: string;
  expiresAt: string;
  einstellungen: {
    vorschlaegeProPerson: number;
    maxTeilnehmer: number;
    freieVorschlaege: boolean;
    abstimmdauerSek: number;
    stimmenProPerson: number;
    geheimeStimmen: boolean;
    gleichstand: 'STICHWAHL' | 'ZUFALL';
    rouletteGewichtet: boolean;
    beitrittWaehrendRunde: boolean;
    nachlosenErlaubt: boolean;
    nachgelost: boolean;
  };
  teilnehmer: TeilnehmerAnsicht[];
  kandidaten: KandidatAnsicht[];
  runde: RundeAnsicht | null;
  ergebnisCandidateId: string | null;
  /** Wer zusieht. Steht ausdruecklich da, statt sich aus der Rolle raten zu lassen. */
  betrachter: string;
  /** Die Rolle des Betrachters - `null`, wenn er nur zusieht. */
  eigeneRolle: SpielwahlRolle | null;
  /** Wie viele eigene Vorschlaege der Betrachter noch hat. */
  eigeneVorschlaegeOffen: number;
}

export async function baueAnsicht(
  sessionId: string,
  betrachterDiscordId: string,
  jetzt = new Date(),
): Promise<SessionAnsicht | null> {
  const session = await prisma.spielwahlSession.findUnique({
    where: { id: sessionId },
    include: {
      participants: { where: { leftAt: null }, orderBy: [{ rolle: 'asc' }, { joinedAt: 'asc' }] },
      currentRound: true,
    },
  });
  if (!session) {
    return null;
  }

  const kandidaten = await listeKandidaten(sessionId);
  const runde = session.currentRound;

  let ansicht: RundeAnsicht | null = null;
  const gewaehltHat = new Set<string>();
  if (runde) {
    const stimmen = await prisma.spielwahlVote.findMany({
      where: { roundId: runde.id, duell: runde.duellIndex },
      select: { discordId: true, candidateId: true },
    });

    /*
     * Die Entscheidung, wann Zahlen herausgehen.
     *
     * Offen abgestimmt: immer. Geheim: erst, wenn die Runde fertig ist. Der
     * Unterschied steht genau hier und nirgends sonst - eine Oberflaeche, die
     * Zahlen bekommt und sie verschweigt, verschweigt sie nur so lange, bis
     * jemand die Netzwerkanfragen ansieht.
     */
    const aufgedeckt = !session.geheimeStimmen || runde.status !== 'LAEUFT';

    const zaehlung: Record<string, number> = {};
    if (aufgedeckt) {
      for (const kandidat of runde.kandidaten) {
        zaehlung[kandidat] = 0;
      }
      for (const stimme of stimmen) {
        zaehlung[stimme.candidateId] = (zaehlung[stimme.candidateId] ?? 0) + 1;
      }
    }

    for (const stimme of stimmen) {
      gewaehltHat.add(stimme.discordId);
    }

    ansicht = {
      id: runde.id,
      nummer: runde.nummer,
      modus: runde.modus,
      kandidaten: runde.kandidaten,
      endsAt: runde.endsAt?.toISOString() ?? null,
      startedAt: runde.startedAt.toISOString(),
      gewinnerCandidateId: runde.gewinnerCandidateId,
      entscheidungsart: runde.entscheidungsart,
      seed: runde.seed,
      losPunkt: runde.losPunkt,
      losGesamt: runde.losGesamt,
      baum: runde.baum ? leseBaum(runde.baum) : null,
      duellIndex: runde.duellIndex,
      abgegeben: gewaehltHat.size,
      stimmen: aufgedeckt ? zaehlung : null,
      eigeneStimmen: stimmen
        .filter((stimme) => stimme.discordId === betrachterDiscordId)
        .map((stimme) => stimme.candidateId),
    };
  }

  const personen = await loadPersonen(session.participants.map((teilnehmer) => teilnehmer.discordId));
  const eigene = session.participants.find((teilnehmer) => teilnehmer.discordId === betrachterDiscordId);
  const eigeneUnterstuetzungen = await prisma.spielwahlSupport.count({
    where: { discordId: betrachterDiscordId, candidate: { sessionId } },
  });

  return {
    id: session.id,
    inviteToken: session.inviteToken,
    status: session.status,
    modus: session.modus,
    revision: session.revision,
    hostDiscordId: session.hostDiscordId,
    jetzt: jetzt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    einstellungen: {
      vorschlaegeProPerson: session.vorschlaegeProPerson,
      maxTeilnehmer: session.maxTeilnehmer,
      freieVorschlaege: session.freieVorschlaege,
      abstimmdauerSek: session.abstimmdauerSek,
      stimmenProPerson: session.stimmenProPerson,
      geheimeStimmen: session.geheimeStimmen,
      gleichstand: session.gleichstand,
      rouletteGewichtet: session.rouletteGewichtet,
      beitrittWaehrendRunde: session.beitrittWaehrendRunde,
      nachlosenErlaubt: session.nachlosenErlaubt,
      nachgelost: session.nachgelostAm !== null,
    },
    teilnehmer: session.participants.map((teilnehmer) => {
      const person = personen.get(teilnehmer.discordId);
      return {
        discordId: teilnehmer.discordId,
        rolle: teilnehmer.rolle,
        hatGewaehlt: gewaehltHat.has(teilnehmer.discordId),
        anzeigename: person?.displayName ?? 'Unbekannt',
        avatarHash: person?.avatarHash ?? null,
      };
    }),
    kandidaten,
    runde: ansicht,
    ergebnisCandidateId: session.ergebnisCandidateId,
    betrachter: betrachterDiscordId,
    eigeneRolle: eigene?.rolle ?? null,
    eigeneVorschlaegeOffen: Math.max(0, session.vorschlaegeProPerson - eigeneUnterstuetzungen),
  };
}

/** Nur die Revision - fuer den Live-Strom, der nur wissen will, ob sich etwas geaendert hat. */
export async function revisionVon(sessionId: string): Promise<number | null> {
  const session = await prisma.spielwahlSession.findUnique({
    where: { id: sessionId },
    select: { revision: true },
  });
  return session?.revision ?? null;
}
