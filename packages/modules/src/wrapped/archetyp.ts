import type { WrappedArchetyp, WrappedDaten } from './daten';

/**
 * Welcher Typ jemand in diesem Jahr war.
 *
 * ## Was das ist - und was nicht
 *
 * Ein spielerisches Etikett auf **Aktivitaetszahlen**. Nichts weiter. Keine
 * Persoenlichkeitsaussage, keine Bewertung, keine Eigenschaft, die man
 * jemandem zuschreiben koennte. «The Voice Resident» heisst: diese Person war
 * viel im Sprachkanal. Es heisst nicht, dass sie gespraechig, einsam oder
 * sonst etwas ist.
 *
 * Genau deshalb steht unten kein Wort ueber Charakter, und genau deshalb ist
 * die Rechnung offengelegt: die Punktwerte wandern in die Momentaufnahme, und
 * wer fragt, bekommt eine Antwort.
 *
 * ## Warum regelbasiert und nicht generiert
 *
 * Drei Gruende, und jeder allein wuerde reichen:
 *
 *   - **Nachvollziehbarkeit.** Wer wissen will, warum er «The Night Owl» ist,
 *     soll eine Antwort bekommen, die stimmt.
 *   - **Wiederholbarkeit.** Dieselben Daten ergeben denselben Typ - heute,
 *     morgen und in der Momentaufnahme. Ein Modell, das zweimal gefragt
 *     zweimal anders antwortet, waere hier ein Fehler.
 *   - **Kosten.** Sechstausend Momentaufnahmen sind sechstausend Anfragen.
 *
 * ## Die Rechnung
 *
 * Jeder Typ hat einen Punktwert zwischen 0 und 1. Gewonnen hat der hoechste;
 * bei Gleichstand entscheidet die feste Reihenfolge in `TYPEN` - damit das
 * Ergebnis auch dann eindeutig ist, wenn zwei Werte auf die Nachkommastelle
 * zusammenfallen.
 *
 * Die Schwellen sind grosszuegig gewaehlt. Sie sollen unterscheiden, nicht
 * ausschliessen: 100 Stunden Sprachzeit im Jahr sind viel, 1000 sind nicht
 * zehnmal so viel wert.
 */

export const ARCHETYPEN = [
  {
    key: 'voice_resident',
    label: 'The Voice Resident',
    claim: 'Du hattest hier quasi eine Adresse.',
  },
  {
    key: 'night_owl',
    label: 'The Night Owl',
    claim: 'Deine beste Zeit begann, als die anderen schon schliefen.',
  },
  {
    key: 'clip_machine',
    label: 'The Clip Machine',
    claim: 'Wenn etwas passierte, hast du es festgehalten.',
  },
  {
    key: 'competitor',
    label: 'The Competitor',
    claim: 'Du bist angetreten, wenn es zählte.',
  },
  {
    key: 'chatter',
    label: 'The Chatter',
    claim: 'Ohne dich war es im Chat spürbar ruhiger.',
  },
  {
    key: 'allrounder',
    label: 'The Allrounder',
    claim: 'Du warst überall - und das nicht zu knapp.',
  },
  {
    key: 'regular',
    label: 'The Regular',
    claim: 'Du warst da. Immer wieder. Das zählt.',
  },
] as const;

export type ArchetypKey = (typeof ARCHETYPEN)[number]['key'];

export const ARCHETYP_NACH_KEY = new Map(ARCHETYPEN.map((eintrag) => [eintrag.key, eintrag]));

/**
 * Ein Wert zwischen 0 und 1, gedaempft.
 *
 * Die Wurzel statt der geraden Linie: der Unterschied zwischen 10 und 50
 * Stunden soll mehr wiegen als der zwischen 500 und 540. Sonst gewinnt in
 * jeder Kategorie, wer die groessten Zahlen hat, und alle anderen bekommen
 * denselben Typ.
 */
const anteil = (wert: number, bezug: number): number =>
  bezug <= 0 ? 0 : Math.min(1, Math.sqrt(Math.max(0, wert) / bezug));

type Teildaten = Omit<WrappedDaten, 'highlight' | 'archetyp'>;

/** Der Anteil der Sprachzeit, der zwischen 22 und 05 Uhr liegt. */
export function nachtanteil(hours: number[]): number {
  const gesamt = hours.reduce((summe, wert) => summe + wert, 0);
  if (gesamt <= 0) {
    return 0;
  }
  const nachts = [22, 23, 0, 1, 2, 3, 4].reduce((summe, index) => summe + (hours[index] ?? 0), 0);
  return nachts / gesamt;
}

export function bestimmeArchetyp(daten: Teildaten): WrappedArchetyp {
  const voiceStunden = daten.voice.seconds / 3600;
  const nacht = nachtanteil(daten.voice.hours);

  const scores: Record<string, number> = {
    // 250 Stunden im Jahr sind knapp fünf pro Woche - das ist «wohnt hier».
    voice_resident: anteil(voiceStunden, 250),
    /*
     * Die Nachtschicht.
     *
     * Der Anteil allein genuegt nicht: wer zweimal im Jahr um drei Uhr eine
     * halbe Stunde dasitzt, hat einen Nachtanteil von 1. Deshalb muss auch
     * genug Sprachzeit zusammenkommen - der Anteil wird mit ihr gewichtet.
     */
    night_owl: nacht * anteil(voiceStunden, 60),
    // Ein Sieg wiegt schwerer als eine Einreichung, aber beides zaehlt.
    clip_machine: anteil(daten.clips.wins * 3 + daten.clips.approved, 8),
    competitor: anteil(
      daten.wettkampf.tournamentWins * 3 +
        daten.wettkampf.tournamentsPlayed * 2 +
        daten.wettkampf.eventsAttended,
      10,
    ),
    chatter: anteil(daten.messages.total, 3000),
    // Der Allrounder entsteht nicht aus einer Zahl, sondern daraus, dass
    // mehrere Bereiche gleichzeitig besetzt sind - siehe unten.
    allrounder: 0,
    /*
     * Die Verlaesslichen.
     *
     * Ein Grundwert, der allein aus Bestaendigkeit entsteht: 200 aktive Tage
     * sind bemerkenswert, auch ohne Rekord in irgendeiner Einzelkategorie.
     * Absichtlich gedeckelt - er soll auffangen, nicht gewinnen, wo eine
     * deutliche Neigung vorliegt.
     */
    regular: anteil(daten.aktivitaet.activeDays, 200) * 0.72,
  };

  /*
   * Der Allrounder.
   *
   * Nicht «gut in allem», sondern «in mehreren Bereichen spuerbar dabei».
   * Gerechnet als das geometrische Mittel der drei staerksten Bereiche: wer
   * nur einen besetzt, bekommt null, weil ein Faktor null ist. Genau das
   * unterscheidet ihn vom Spezialisten.
   */
  const bereiche = [
    scores.voice_resident ?? 0,
    scores.chatter ?? 0,
    scores.competitor ?? 0,
    scores.clip_machine ?? 0,
  ].sort((a, b) => b - a);
  const dreiBeste = bereiche.slice(0, 3);
  scores.allrounder = Math.cbrt(dreiBeste.reduce((produkt, wert) => produkt * wert, 1));

  let gewaehlt: ArchetypKey = 'regular';
  let beste = -1;
  for (const eintrag of ARCHETYPEN) {
    const wert = scores[eintrag.key] ?? 0;
    // Streng groesser: bei Gleichstand bleibt der frueher genannte Typ
    // stehen. Die Reihenfolge in `ARCHETYPEN` ist damit die Tie-Break-Regel.
    if (wert > beste) {
      beste = wert;
      gewaehlt = eintrag.key;
    }
  }

  return {
    key: gewaehlt,
    scores: Object.fromEntries(
      Object.entries(scores).map(([schluessel, wert]) => [schluessel, Math.round(wert * 1000) / 1000]),
    ),
  };
}
