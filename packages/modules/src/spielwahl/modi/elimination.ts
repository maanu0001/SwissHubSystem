import { conflict } from '@swisshub/shared';
import { drawWeighted, mische, type RandomSource } from '../../zufall';
import { aktuellesDuell, hoechsteNr, leseBaum, type Baum, type Paarung } from '../baum';
import type { Ausgang, EntscheidungsModus, ModusKontext, StartErgebnis, StimmEingabe } from './vertrag';

/*
 * Die Form des Baums liegt in `spielwahl/baum.ts` - ohne Abhaengigkeiten,
 * damit die Buehne im Browser dieselbe Funktion verwendet und nicht eine
 * zweite, die irgendwann auf ein anderes Duell zeigt.
 */
export { aktuellesDuell, hoechsteNr, leseBaum, type Baum, type Paarung, type Stufe } from '../baum';

/**
 * Die Ausscheidung.
 *
 * ## Ein Duell nach dem anderen
 *
 * Nicht alle Paarungen gleichzeitig. Vier Duelle nebeneinander waeren eine
 * Tabelle mit acht Knoepfen; nacheinander ist es eine Gameshow. Alle stimmen
 * ueber dasselbe Duell ab, der Sieger zieht weiter, dann das naechste.
 *
 * ## Das Freilos
 *
 * Bei ungerader Kandidatenzahl bleibt einer uebrig. Er bekommt ein Freilos
 * und steht in der naechsten Stufe - das ist unvermeidlich. Vermeidbar ist
 * nur, dass jemand es **vergibt**: die Kandidaten werden einmal gemischt, und
 * das Freilos geht an den letzten der Mischung. Der Wert, aus dem die
 * Mischung entsteht, steht in der Runde und ist sichtbar; wer ihn hat, kann
 * sie nachbauen.
 *
 * Und wer in einer Stufe ein Freilos hatte, bekommt in der naechsten keines,
 * solange es jemanden ohne gibt. Sonst koennte derselbe Titel sich durch ein
 * Turnier tragen lassen, ohne einmal angetreten zu sein.
 *
 * ## Der Baum
 *
 * Steht in `baum` als Liste von Stufen. Jede Stufe hat ihre Paarungen und
 * deren Sieger; eine leere Seite einer Paarung ist ein Freilos. Er waechst
 * mit dem Turnier, statt vorab vollstaendig angelegt zu werden - die Stufen
 * nach der ersten stehen erst fest, wenn die vorige entschieden ist.
 */

export function baueStufe(
  kandidaten: readonly string[],
  random: RandomSource,
  ohneFreilos: readonly string[] = [],
  abNr = 0,
): Paarung[] {
  const gemischt = mische(kandidaten, random);

  if (gemischt.length % 2 === 1 && ohneFreilos.length > 0) {
    const letzter = gemischt[gemischt.length - 1]!;
    if (ohneFreilos.includes(letzter)) {
      const tauschbar = gemischt.findIndex((eintrag) => !ohneFreilos.includes(eintrag));
      if (tauschbar >= 0) {
        gemischt[gemischt.length - 1] = gemischt[tauschbar]!;
        gemischt[tauschbar] = letzter;
      }
    }
  }

  const paarungen: Paarung[] = [];
  let nr = abNr;
  for (let index = 0; index + 1 < gemischt.length; index += 2) {
    paarungen.push({ nr, a: gemischt[index]!, b: gemischt[index + 1]!, sieger: null });
    nr += 1;
  }
  if (gemischt.length % 2 === 1) {
    const frei = gemischt[gemischt.length - 1]!;
    paarungen.push({ nr, a: frei, b: null, sieger: frei, art: 'freilos' });
  }
  return paarungen;
}

export const elimination: EntscheidungsModus = {
  key: 'ELIMINATION',
  label: 'Ausscheidung',
  beschreibung: 'Zwei Spiele, eine Abstimmung, einer bleibt. So lange, bis eines übrig ist.',
  stimmt: true,

  async starte(kontext: ModusKontext, random: RandomSource): Promise<StartErgebnis> {
    const paarungen = baueStufe(kontext.kandidaten, random);
    const baum: Baum = { stufen: [{ nummer: 1, paarungen }] };

    const ersteOffene = paarungen.find((paarung) => paarung.sieger === null);
    return {
      daten: {
        baum: baum as unknown as never,
        duellIndex: ersteOffene?.nr ?? paarungen[0]?.nr ?? 0,
        endsAt: new Date(kontext.jetzt.getTime() + kontext.session.abstimmdauerSek * 1000),
        entscheidungsart: 'ausscheidung',
      },
    };
  },

  async stimme(eingabe: StimmEingabe): Promise<void> {
    if (eingabe.runde.endsAt && eingabe.jetzt >= eingabe.runde.endsAt) {
      throw conflict('Dieses Duell ist vorbei.');
    }
    if (eingabe.duell !== eingabe.runde.duellIndex) {
      throw conflict('Das Duell ist weitergegangen. Deine Stimme gilt dem aktuellen.');
    }

    const paarung = aktuellesDuell(leseBaum(eingabe.runde.baum), eingabe.duell);
    if (!paarung || (paarung.a !== eingabe.candidateId && paarung.b !== eingabe.candidateId)) {
      throw conflict('Dieses Spiel steht in diesem Duell nicht zur Wahl.');
    }

    /*
     * Im Duell gibt es genau eine Stimme je Person. Ein zweiter Klick auf
     * dasselbe nimmt sie zurueck, ein Klick auf das andere setzt sie um -
     * dieselbe Handhabung wie bei einer Abstimmung mit einer Stimme, damit
     * man nicht zwei Bedienlogiken lernen muss.
     */
    const schon = await eingabe.tx.spielwahlVote.findMany({
      where: { roundId: eingabe.runde.id, duell: eingabe.duell, discordId: eingabe.discordId },
      select: { id: true, candidateId: true },
    });
    const eigene = schon.find((stimme) => stimme.candidateId === eingabe.candidateId);
    if (eigene) {
      await eingabe.tx.spielwahlVote.delete({ where: { id: eigene.id } });
      return;
    }
    if (schon.length > 0) {
      await eingabe.tx.spielwahlVote.deleteMany({
        where: { roundId: eingabe.runde.id, duell: eingabe.duell, discordId: eingabe.discordId },
      });
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
    const baum = leseBaum(runde.baum);
    const paarung = aktuellesDuell(baum, runde.duellIndex);
    if (!paarung) {
      return { gewinnerCandidateId: null, weiter: true };
    }

    // Ein Freilos wird nicht abgestimmt - weiter zum naechsten Duell.
    if (paarung.b === null) {
      return naechsterSchritt(kontext, runde, baum, random);
    }

    const stimmen = await kontext.tx.spielwahlVote.findMany({
      where: { roundId: runde.id, duell: runde.duellIndex },
      select: { discordId: true, candidateId: true },
    });

    const abgelaufen = runde.endsAt !== null && kontext.jetzt >= runde.endsAt;
    // Nur die Stimmen der Anwesenden machen ein Duell fertig - siehe `voting`.
    const anwesende = new Set(kontext.anwesende);
    const daStimmen = stimmen.filter((stimme) => anwesende.has(stimme.discordId));
    const alleDa =
      anwesende.size > 0 && new Set(daStimmen.map((stimme) => stimme.discordId)).size >= anwesende.size;
    if (!abgelaufen && !alleDa) {
      return { gewinnerCandidateId: null, weiter: true };
    }

    const fuerA = stimmen.filter((stimme) => stimme.candidateId === paarung.a).length;
    const fuerB = stimmen.filter((stimme) => stimme.candidateId === paarung.b).length;

    if (fuerA > fuerB) {
      paarung.sieger = paarung.a;
      paarung.art = 'stimmen';
    } else if (fuerB > fuerA) {
      paarung.sieger = paarung.b;
      paarung.art = 'stimmen';
    } else {
      /*
       * Gleichstand im Duell.
       *
       * Eine Stichwahl waere hier dasselbe Duell noch einmal - und beim
       * zweiten Gleichstand stuende man wieder da. Deshalb entscheidet das
       * Los, und zwar auch dann, wenn der Host «Stichwahl» eingestellt hat:
       * die Einstellung gilt der Abstimmung ueber viele Titel, wo eine
       * engere Auswahl tatsaechlich weiterhilft.
       */
      const los = drawWeighted(
        [paarung.a, paarung.b!].map((id) => ({ entryId: id, discordId: id, weight: 1 })),
        random,
      );
      paarung.sieger = los?.winner.entryId ?? paarung.a;
      paarung.art = 'los';
    }

    return naechsterSchritt(kontext, runde, baum, random);
  },
};

/**
 * Nach einem entschiedenen Duell.
 *
 * Entweder das naechste Duell derselben Stufe, oder die naechste Stufe aus
 * den Siegern, oder - wenn nur noch einer steht - das Ende.
 */
function naechsterSchritt(
  kontext: ModusKontext,
  runde: { duellIndex: number },
  baum: Baum,
  random: RandomSource,
): Ausgang {
  const stufe = baum.stufen[baum.stufen.length - 1]!;

  const naechstesOffene = stufe.paarungen.find(
    (paarung) => paarung.nr > runde.duellIndex && paarung.sieger === null,
  );
  if (naechstesOffene) {
    return {
      gewinnerCandidateId: null,
      weiter: true,
      daten: {
        baum: baum as unknown as never,
        duellIndex: naechstesOffene.nr,
        endsAt: new Date(kontext.jetzt.getTime() + kontext.session.abstimmdauerSek * 1000),
      },
    };
  }

  const sieger = stufe.paarungen.map((paarung) => paarung.sieger).filter((id): id is string => id !== null);

  if (sieger.length <= 1) {
    return {
      gewinnerCandidateId: sieger[0] ?? null,
      entscheidungsart: 'ausscheidung',
      daten: { baum: baum as unknown as never },
    };
  }

  const hattenFreilos = stufe.paarungen
    .filter((paarung) => paarung.b === null && paarung.sieger)
    .map((paarung) => paarung.sieger!);

  const neue = baueStufe(sieger, random, hattenFreilos, hoechsteNr(baum) + 1);
  baum.stufen.push({ nummer: stufe.nummer + 1, paarungen: neue });

  const ersteOffene = neue.find((paarung) => paarung.sieger === null);
  return {
    gewinnerCandidateId: null,
    weiter: true,
    daten: {
      baum: baum as unknown as never,
      duellIndex: ersteOffene?.nr ?? neue[0]?.nr ?? 0,
      endsAt: new Date(kontext.jetzt.getTime() + kontext.session.abstimmdauerSek * 1000),
    },
  };
}
