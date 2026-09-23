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
 * Die Staerke eines Bereichs, gedaempft - **ohne Deckel**.
 *
 * Die Wurzel statt der geraden Linie: der Unterschied zwischen 10 und 50
 * Stunden soll mehr wiegen als der zwischen 500 und 540.
 *
 * Kein Deckel bei 1, und das ist der Kern der Sache. Die erste Fassung
 * klemmte hier auf 1 - mit der Folge, dass eine aktive Person in vier
 * Bereichen gleichzeitig die Hoechstpunktzahl erreichte. Bei vier exakt
 * gleichen Werten entschied dann allein die Reihenfolge der Liste, und der
 * Allrounder-Testfall bekam «The Clip Machine». Ohne Deckel bleibt auch
 * oberhalb der Schwelle unterscheidbar, wer wo staerker ist.
 */
const staerke = (wert: number, bezug: number): number =>
  bezug <= 0 ? 0 : Math.sqrt(Math.max(0, wert) / bezug);

/**
 * Eine Schranke zwischen 0 und 1.
 *
 * Fuer Bedingungen, die erfuellt sein muessen, aber nichts zur Hoehe
 * beitragen sollen: «genug Sprachzeit, damit die Verteilung ueberhaupt
 * etwas aussagt». Ab dem Bezugswert ist sie 1 und waechst nicht weiter.
 */
const schranke = (wert: number, bezug: number): number => Math.min(1, staerke(wert, bezug));

/**
 * Ab wie vielen Stunden Sprachzeit die Tagesverteilung ueberhaupt etwas
 * aussagt. Darunter gibt es keinen Nachttyp - siehe unten.
 */
const MINDEST_VOICE_STUNDEN_NACHT = 20;

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
    voice_resident: staerke(voiceStunden, 250),
    /*
     * Die Nachtschicht.
     *
     * Zwei Bedingungen, und beide muessen stimmen.
     *
     * Erstens genug Sprachzeit - und zwar als **harte Schwelle**, nicht als
     * weicher Anstieg. Ein weicher war die erste Fassung, und sie liess
     * genau den Fall durch, den sie verhindern sollte: eine Stunde im Jahr,
     * davon alles um drei Uhr nachts, ergab einen Nachtanteil von 1 und
     * damit trotz winziger Rampe genug Punkte, um alles andere zu schlagen.
     * Unterhalb der Schwelle sagt die Verteilung schlicht nichts aus, und
     * dann soll sie auch nichts beitragen.
     *
     * Zweitens ein Anteil **deutlich** ueber der Haelfte: unterhalb von 45 %
     * ist ein Abendmensch noch kein Nachtmensch, und der Wert faellt auf
     * null.
     */
    night_owl: MINDEST_VOICE_STUNDEN_NACHT <= voiceStunden ? Math.max(0, (nacht - 0.45) / 0.35) * 1.5 : 0,
    // Ein Sieg wiegt schwerer als eine Einreichung, aber beides zaehlt.
    clip_machine: staerke(daten.clips.wins * 3 + daten.clips.approved, 8),
    competitor: staerke(
      daten.wettkampf.tournamentWins * 3 +
        daten.wettkampf.tournamentsPlayed * 2 +
        daten.wettkampf.eventsAttended,
      10,
    ),
    chatter: staerke(daten.messages.total, 3000),
    // Der Allrounder entsteht nicht aus einer Zahl, sondern daraus, dass
    // mehrere Bereiche gleichzeitig besetzt sind - siehe unten.
    allrounder: 0,
    /*
     * Die Verlaesslichen.
     *
     * Ein Grundwert, der allein aus Bestaendigkeit entsteht: 200 aktive Tage
     * sind bemerkenswert, auch ohne Rekord in irgendeiner Einzelkategorie.
     * Gedeckelt und gedaempft - er soll auffangen, nicht gewinnen, wo eine
     * deutliche Neigung vorliegt.
     */
    regular: schranke(daten.aktivitaet.activeDays, 200) * 0.72,
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
  /*
   * Das geometrische Mittel der drei staerksten Bereiche, mal einem
   * Zuschlag.
   *
   * Das Mittel allein wuerde nie gewinnen: es liegt zwangslaeufig unter dem
   * hoechsten Einzelwert. Der Zuschlag von 12 % sagt genau das aus, was der
   * Typ bedeuten soll - **Breite schlaegt eine einzelne Spitze**. Wer in
   * drei Bereichen fast so stark ist wie ein Spezialist in seinem, ist der
   * interessantere Fall.
   */
  scores.allrounder = Math.cbrt(dreiBeste.reduce((produkt, wert) => produkt * wert, 1)) * 1.12;

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
