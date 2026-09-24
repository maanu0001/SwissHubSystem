import { drawWeighted, type RandomSource, type WeightedTicket } from '../../zufall';
import type { Ausgang, EntscheidungsModus, ModusKontext, StartErgebnis } from './vertrag';

/**
 * Das Roulette.
 *
 * ## Der Gewinner steht, bevor sich etwas dreht
 *
 * `starte` zieht ihn - auf dem Server, mit `crypto.randomInt` ueber
 * `drawWeighted`, derselben Ziehung, die auch das XP-Gluecksrad verwendet.
 * Was der Browser danach zeigt, ist eine Animation zu einem feststehenden
 * Ergebnis. Der Client bestimmt nichts; er bekommt den Gewinner, den
 * gezogenen Punkt und die Gesamtsumme und rechnet daraus den Winkel.
 *
 * Dass alle dasselbe sehen, folgt daraus von selbst: es gibt nur ein
 * Ergebnis, und es steht in der Datenbank. Wer zu spaet kommt, bekommt beim
 * Verbinden den laufenden Stand samt Startzeitpunkt und steigt an der
 * richtigen Stelle ein.
 *
 * ## Die Gewichtung
 *
 * Standardmaessig hat **jedes Spiel ein Los**, egal wie viele es genannt
 * haben. Wer will, dass Unterstuetzer zaehlen, schaltet es ein - und dann
 * sagt die Buehne es auch. Eine Gewichtung, die sich aus der Zahl der
 * Vorschlaege ergibt, ohne dass jemand sie beschlossen hat, waere eine
 * gefaelschte Auslosung mit ehrlichem Zufallsgenerator.
 *
 * ## Was ein aufmerksamer Zuschauer sehen kann
 *
 * Der Gewinner reist zum Start der Animation mit - er muss, sonst koennte
 * das Rad nicht zu ihm drehen. Wer die Netzwerkanfragen mitliest, weiss das
 * Ergebnis also einige Sekunden frueher. Das ist der Preis dafuer, dass die
 * Animation im Browser laeuft, und er ist bezahlbar: **beeinflussen** laesst
 * sich damit nichts.
 */
export const roulette: EntscheidungsModus = {
  key: 'ROULETTE',
  label: 'Roulette',
  beschreibung: 'Ein Rad, ein Los je Spiel, ein Ergebnis - gezogen auf dem Server.',
  stimmt: false,

  async starte(kontext: ModusKontext, random: RandomSource): Promise<StartErgebnis> {
    const lose = await baueLose(kontext);
    const ziehung = drawWeighted(lose, random);
    if (!ziehung) {
      throw new Error('spielwahl/roulette: keine Kandidaten mit Gewicht');
    }

    return {
      daten: {
        gewinnerCandidateId: ziehung.winner.entryId,
        losPunkt: ziehung.ticket,
        losGesamt: ziehung.totalWeight,
        entscheidungsart: kontext.session.rouletteGewichtet ? 'roulette-gewichtet' : 'roulette',
        /*
         * Die Dauer der Animation steht in der Runde und nicht im Browser:
         * ein spaeter Zuschauer soll ausrechnen koennen, wie weit das Rad
         * schon ist, und dafuer braucht er dieselbe Zahl wie alle anderen.
         */
        endsAt: new Date(kontext.jetzt.getTime() + DREHDAUER_MS),
      },
    };
  },

  async pruefe(kontext, runde): Promise<Ausgang> {
    if (!runde.endsAt || kontext.jetzt < runde.endsAt) {
      return { gewinnerCandidateId: null, weiter: true };
    }
    return {
      gewinnerCandidateId: runde.gewinnerCandidateId,
      entscheidungsart: runde.entscheidungsart ?? 'roulette',
    };
  },
};

/**
 * Wie lange sich das Rad dreht.
 *
 * Zehn Sekunden, wie beim XP-Gluecksrad - dort hat sich gezeigt, dass
 * kuerzer vorbei ist, ehe jemand hinschaut. Am Ergebnis aendert die Zahl
 * nichts; sie bestimmt nur, wie lange man es nicht sieht.
 */
export const DREHDAUER_MS = 10_000;

/**
 * Die Lose.
 *
 * Ohne Gewichtung genau eines je Kandidat. Mit Gewichtung so viele, wie
 * Unterstuetzer dahinterstehen - mindestens aber eines, sonst fiele ein
 * Kandidat, dessen Vorschlagender die Runde verlassen hat, still aus dem
 * Rennen.
 */
async function baueLose(kontext: ModusKontext): Promise<WeightedTicket[]> {
  if (!kontext.session.rouletteGewichtet) {
    return kontext.kandidaten.map((candidateId) => ({
      entryId: candidateId,
      discordId: candidateId,
      weight: 1,
    }));
  }

  const zaehlung = await kontext.tx.spielwahlSupport.groupBy({
    by: ['candidateId'],
    where: { candidateId: { in: [...kontext.kandidaten] } },
    _count: { _all: true },
  });
  const nach = new Map(zaehlung.map((zeile) => [zeile.candidateId, zeile._count._all]));

  return kontext.kandidaten.map((candidateId) => ({
    entryId: candidateId,
    discordId: candidateId,
    weight: Math.max(1, nach.get(candidateId) ?? 1),
  }));
}
