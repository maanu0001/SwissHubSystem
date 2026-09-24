import { conflict, policyViolation } from '@swisshub/shared';
import { drawWeighted, type RandomSource } from '../../zufall';
import type { Ausgang, EntscheidungsModus, ModusKontext, StartErgebnis, StimmEingabe } from './vertrag';

/**
 * Die Abstimmung.
 *
 * ## Was den Ausschlag gibt
 *
 * Die Uhr des Servers. Der Countdown auf dem Bildschirm ist Darstellung: er
 * rechnet aus `endsAt` aus, wie viel noch bleibt, und wenn die Uhr eines
 * Geraets falsch geht, geht nur dessen Countdown falsch. Angenommen wird eine
 * Stimme genau dann, wenn sie **beim Server** vor `endsAt` ankommt.
 *
 * ## Warum die Eindeutigkeit in der Datenbank sitzt
 *
 * Zwei Klicks auf denselben Titel, zwei offene Tabs, ein wiederholter
 * Request: alle drei kommen gleichzeitig an, und alle drei finden beim
 * Nachsehen «noch keine Stimme». Ein `findFirst` davor loest das nicht,
 * sondern verschiebt es. Deshalb ist `(roundId, duell, discordId,
 * candidateId)` eindeutig, und der zweite Schreibversuch laeuft dagegen.
 *
 * ## Geheime Stimmen
 *
 * Waehrend der Abstimmung sendet der Server keine Zwischenstaende - nur, wie
 * viele schon gewaehlt haben. Sichtbare Zwischenstaende ziehen die Stimmen
 * zum Fuehrenden; das ist beim Clip-Wettbewerb derselbe Grund fuer dieselbe
 * Entscheidung.
 */
export const voting: EntscheidungsModus = {
  key: 'VOTING',
  label: 'Abstimmung',
  beschreibung: 'Alle wählen gleichzeitig. Die Serverzeit entscheidet, wann Schluss ist.',
  stimmt: true,

  async starte(kontext: ModusKontext): Promise<StartErgebnis> {
    return {
      daten: {
        endsAt: new Date(kontext.jetzt.getTime() + kontext.session.abstimmdauerSek * 1000),
        entscheidungsart: 'abstimmung',
      },
    };
  },

  async stimme(eingabe: StimmEingabe): Promise<void> {
    if (eingabe.runde.endsAt && eingabe.jetzt >= eingabe.runde.endsAt) {
      throw conflict('Die Abstimmung ist vorbei.');
    }
    if (!eingabe.runde.kandidaten.includes(eingabe.candidateId)) {
      throw conflict('Dieses Spiel steht in dieser Runde nicht zur Wahl.');
    }

    const schon = await eingabe.tx.spielwahlVote.findMany({
      where: { roundId: eingabe.runde.id, duell: eingabe.duell, discordId: eingabe.discordId },
      select: { id: true, candidateId: true },
    });

    const eigene = schon.find((stimme) => stimme.candidateId === eingabe.candidateId);
    if (eigene) {
      // Noch einmal auf dasselbe geklickt heisst: zurueckziehen.
      await eingabe.tx.spielwahlVote.delete({ where: { id: eigene.id } });
      return;
    }

    if (schon.length >= eingabe.session.stimmenProPerson) {
      if (eingabe.session.stimmenProPerson === 1) {
        /*
         * Bei einer Stimme ist «etwas anderes anklicken» eindeutig gemeint
         * als Umentscheiden und nicht als Fehler. Bei mehreren waere es
         * zweideutig - dort sagt die Meldung, was zu tun ist.
         */
        await eingabe.tx.spielwahlVote.deleteMany({
          where: { roundId: eingabe.runde.id, duell: eingabe.duell, discordId: eingabe.discordId },
        });
      } else {
        throw policyViolation(
          `Du hast deine ${eingabe.session.stimmenProPerson} Stimmen vergeben. Nimm eine zurück, indem du sie noch einmal anklickst.`,
        );
      }
    }

    await eingabe.tx.spielwahlVote.create({
      data: {
        roundId: eingabe.runde.id,
        duell: eingabe.duell,
        discordId: eingabe.discordId,
        candidateId: eingabe.candidateId,
      },
    });
  },

  async pruefe(kontext, runde, random): Promise<Ausgang> {
    const abgelaufen = runde.endsAt !== null && kontext.jetzt >= runde.endsAt;

    const stimmen = await kontext.tx.spielwahlVote.findMany({
      where: { roundId: runde.id, duell: 0 },
      select: { discordId: true, candidateId: true },
    });

    /*
     * Frueher fertig, wenn alle Anwesenden ihre Stimmen vergeben haben.
     *
     * Das ist die haeufigste Art, wie eine Abstimmung endet - auf den
     * Countdown zu warten, obwohl alle laengst gewaehlt haben, ist die
     * langweiligste Sekunde des Abends.
     *
     * Gezaehlt werden nur die Stimmen der **Anwesenden**. Wer gegangen ist,
     * behaelt seine Stimme, aber sie macht die Runde nicht fertig - sonst
     * kaeme der Letzte, der noch da ist, nicht mehr dazu.
     */
    const anwesende = new Set(kontext.anwesende);
    const daStimmen = stimmen.filter((stimme) => anwesende.has(stimme.discordId));
    const alleFertig =
      anwesende.size > 0 && reichtFuerAlle(daStimmen, kontext.session.stimmenProPerson, anwesende.size);

    if (!abgelaufen && !alleFertig) {
      return { gewinnerCandidateId: null, weiter: true };
    }

    return entscheide(stimmen, runde.kandidaten, kontext.session.gleichstand, random);
  },
};

function reichtFuerAlle(
  stimmen: ReadonlyArray<{ discordId: string }>,
  proPerson: number,
  anwesend: number,
): boolean {
  const je = new Map<string, number>();
  for (const stimme of stimmen) {
    je.set(stimme.discordId, (je.get(stimme.discordId) ?? 0) + 1);
  }
  let vollstaendig = 0;
  for (const anzahl of je.values()) {
    if (anzahl >= proPerson) {
      vollstaendig += 1;
    }
  }
  return vollstaendig >= anwesend;
}

export interface Rangfolge {
  candidateId: string;
  stimmen: number;
}

/** Die Rangfolge einer Abstimmung - Kandidaten ohne Stimme inbegriffen. */
export function raenge(
  stimmen: ReadonlyArray<{ candidateId: string }>,
  kandidaten: readonly string[],
): Rangfolge[] {
  const zaehler = new Map<string, number>(kandidaten.map((id) => [id, 0]));
  for (const stimme of stimmen) {
    if (zaehler.has(stimme.candidateId)) {
      zaehler.set(stimme.candidateId, (zaehler.get(stimme.candidateId) ?? 0) + 1);
    }
  }
  return [...zaehler.entries()]
    .map(([candidateId, anzahl]) => ({ candidateId, stimmen: anzahl }))
    .sort(
      (a, b) =>
        b.stimmen - a.stimmen || kandidaten.indexOf(a.candidateId) - kandidaten.indexOf(b.candidateId),
    );
}

/**
 * Wer gewonnen hat - und was bei Gleichstand geschieht.
 *
 * Drei Faelle, und der dritte ist der interessante:
 *
 *   1. **Niemand hat gestimmt.** Dann entscheidet das Los unter allen. Die
 *      Alternative waere, die Runde ohne Ergebnis enden zu lassen - und damit
 *      eine Gruppe, die sich gerade nicht einigen konnte, ganz ohne Antwort.
 *   2. **Ein Bester.** Er gewinnt.
 *   3. **Gleichstand.** Entweder eine Stichwahl nur unter den Gleichauf-
 *      Kandidaten, oder ein Los unter ihnen - wie der Host es eingestellt
 *      hat, festgelegt **vor** der Abstimmung.
 *
 * Eine Stichwahl mit nur einem verbliebenen Kandidaten gaebe es nicht; der
 * Fall kann nicht eintreten, weil ein Gleichstand mindestens zwei braucht.
 */
export function entscheide(
  stimmen: ReadonlyArray<{ candidateId: string }>,
  kandidaten: readonly string[],
  gleichstand: 'STICHWAHL' | 'ZUFALL',
  random: RandomSource,
): Ausgang {
  const rangfolge = raenge(stimmen, kandidaten);
  const beste = rangfolge[0]?.stimmen ?? 0;
  const gleichauf = rangfolge
    .filter((eintrag) => eintrag.stimmen === beste)
    .map((eintrag) => eintrag.candidateId);

  if (beste === 0) {
    const los = drawWeighted(
      kandidaten.map((id) => ({ entryId: id, discordId: id, weight: 1 })),
      random,
    );
    return { gewinnerCandidateId: los?.winner.entryId ?? null, entscheidungsart: 'los-ohne-stimmen' };
  }

  if (gleichauf.length === 1) {
    return { gewinnerCandidateId: gleichauf[0]!, entscheidungsart: 'abstimmung' };
  }

  if (gleichstand === 'ZUFALL') {
    const los = drawWeighted(
      gleichauf.map((id) => ({ entryId: id, discordId: id, weight: 1 })),
      random,
    );
    return { gewinnerCandidateId: los?.winner.entryId ?? null, entscheidungsart: 'los-bei-gleichstand' };
  }

  return { gewinnerCandidateId: null, entscheidungsart: 'stichwahl', stichwahlUnter: gleichauf };
}
