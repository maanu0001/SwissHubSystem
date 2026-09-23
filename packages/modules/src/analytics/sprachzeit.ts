import { prisma } from '@swisshub/database';
import { aufStundenVerteilen, aufTageVerteilen, tagesBeginn } from './zeit';
import type { Zeitraum } from './zeitraum';

/**
 * Die laufende Sprachzeit.
 *
 * ## Warum es diese Datei gibt
 *
 * Die Statistik las ihre Sprachzeit aus den Tages- und Stundenaggregaten.
 * Die bekommen ihre Sekunden aber erst, wenn ein Abschnitt **endet**: beim
 * Verlassen des Kanals rechnet `schliesseOffene` die Dauer aus und verteilt
 * sie. Wer seit anderthalb Stunden im Sprachkanal sitzt, steht bis dahin mit
 * null Sekunden in jeder Summe - sichtbar war nur seine Sitzung, weil die
 * beim Betreten gezaehlt wird. Genau so entstand «Sprachzeit 0 h, 1
 * Sitzungen».
 *
 * Die Antwort ist nicht, die Aggregate sekuendlich fortzuschreiben. In der
 * Datenbank stehen die Tatsachen - `joinedAt` und `leftAt` -, und daraus
 * laesst sich der Stand zu jedem Zeitpunkt ausrechnen. Ein Zaehler, der
 * jede Sekunde hochgeschrieben wird, waere dieselbe Zahl, nur teurer und
 * mit mehr Moeglichkeiten, falsch zu sein.
 *
 * ## Was hier gerechnet wird
 *
 * Ausschliesslich der **offene** Teil: Abschnitte mit `leftAt = null`. Was
 * geschlossen ist, steht in den Aggregaten, und beides wird addiert. Eine
 * Doppelzaehlung kann dabei nicht entstehen, weil `schliesseOffene` in
 * derselben Aktualisierung `leftAt` setzt und die Sekunden verbucht: ein
 * Abschnitt ist entweder hier oder dort, nie in beidem.
 *
 * Das macht auch den Uebergang beim Verlassen unauffaellig - vorher 1.49 h
 * live, nachher 1.50 h aus dem Aggregat, dieselbe Zahl aus einer anderen
 * Quelle.
 *
 * ## Wie teuer das ist
 *
 * Eine Abfrage ueber `leftAt = null`, dafuer gibt es einen Index. Die Menge
 * waechst nicht mit der Geschichte, sondern mit der Zahl der Leute, die
 * **gerade jetzt** in einem Sprachkanal sitzen - ein paar Dutzend. Die
 * Ueberlappung wird danach im Speicher gerechnet.
 */

/** Eine Sitzung, die gerade laeuft. */
interface OffenerAbschnitt {
  discordId: string;
  channelId: string;
  channelName: string | null;
  parentId: string | null;
  joinedAt: Date;
}

export interface KanalAnteil {
  sekunden: number;
  channelName: string | null;
  parentId: string | null;
}

export interface LaufendeSprachzeit {
  /** Serverzeit, auf die sich alle Werte beziehen. */
  asOf: Date;
  /** Summe der laufenden Anteile im Fenster. */
  sekunden: number;
  /**
   * Wie viele Sitzungen gerade **in dieses Fenster hinein** wachsen.
   *
   * Fuer einen abgeschlossenen Zeitraum in der Vergangenheit ist das null:
   * dort waechst nichts mehr, auch wenn die Sitzung noch laeuft. Die
   * Oberflaeche rechnet mit dieser Zahl zwischen zwei Abgleichen weiter -
   * je laufender Sitzung eine Sekunde je Sekunde.
   */
  wachsend: number;
  /** Wer im Fenster eine laufende Sitzung hat. */
  mitglieder: Set<string>;
  jeMitglied: Map<string, number>;
  jeKanal: Map<string, KanalAnteil>;
  /** Zuercher Tagesschluessel (`YYYY-MM-DD`) auf Sekunden. */
  jeTag: Map<string, number>;
  /** Stundenbeginn als Millisekunden auf Sekunden. */
  jeStunde: Map<number, number>;
}

export function leereSprachzeit(asOf = new Date()): LaufendeSprachzeit {
  return {
    asOf,
    sekunden: 0,
    wachsend: 0,
    mitglieder: new Set(),
    jeMitglied: new Map(),
    jeKanal: new Map(),
    jeTag: new Map(),
    jeStunde: new Map(),
  };
}

/**
 * Der Anteil einer Sitzung, der in ein Fenster faellt.
 *
 * Die eine Formel, auf der alles steht:
 *
 *     von  = MAX(joinedAt, fensterVon)
 *     bis  = MIN(leftAt ?? jetzt, fensterBis)
 *     dauer = MAX(0, bis - von)
 *
 * Sie gilt fuer laufende und fuer abgeschlossene Sitzungen gleichermassen.
 * Wer um 23:30 betritt und um 01:00 noch da ist, hat fuer «heute» genau eine
 * Stunde - nicht anderthalb, und nicht null.
 */
export function anteilSekunden(
  joinedAt: Date,
  leftAt: Date | null,
  fensterVon: Date,
  fensterBis: Date,
  jetzt: Date,
): number {
  const beginn = Math.max(joinedAt.getTime(), fensterVon.getTime());
  const ende = Math.min((leftAt ?? jetzt).getTime(), fensterBis.getTime(), jetzt.getTime());
  return Math.max(0, Math.round((ende - beginn) / 1000));
}

/**
 * Das Fenster, in dem die laufende Zeit gezaehlt wird.
 *
 * Es muss genau das abdecken, was die Aggregate abdecken - sonst zaehlte die
 * eine Haelfte einen Zeitraum, den die andere nicht kennt. Die Aggregate
 * rechnen in Zuercher Kalendertagen; ein Zeitraum «letzte 30 Tage», der um
 * 14:00 beginnt, holt deshalb den ganzen Starttag. Genau dort beginnt auch
 * der laufende Anteil.
 */
export function sprachzeitFenster(zeitraum: Pick<Zeitraum, 'von' | 'bis'>): {
  von: Date;
  bis: Date;
} {
  return { von: tagesBeginn(zeitraum.von), bis: zeitraum.bis };
}

interface Optionen {
  /** Bots mitzaehlen. Standard: nein - dieselbe Regel wie beim Aufzeichnen. */
  mitBots?: boolean;
  /** Fuer Tests: die Serverzeit, auf die gerechnet wird. */
  jetzt?: Date;
}

/**
 * Die laufende Sprachzeit eines Fensters, nach allen Dimensionen aufgeteilt.
 *
 * Eine Abfrage, ein Durchgang, und danach liegt alles bereit, was die
 * Statistik braucht: Gesamtsumme, je Mitglied, je Kanal, je Tag, je Stunde.
 * Die Alternative waere je Kachel eine eigene Rechnung gewesen - und damit
 * fuenf Gelegenheiten, dass sie auseinanderlaufen.
 *
 * **Abschnitte im AFK-Kanal zaehlen nicht.** Dieselbe Regel wie beim
 * Verbuchen: Zeit im AFK-Kanal ist Anwesenheit, keine Aktivitaet. Stuende sie
 * hier drin und dort nicht, saenke die Sprachzeit in dem Moment, in dem
 * jemand den Kanal verlaesst.
 */
export async function laufendeSprachzeit(
  guildId: string,
  fenster: { von: Date; bis: Date },
  optionen: Optionen = {},
): Promise<LaufendeSprachzeit> {
  const jetzt = optionen.jetzt ?? new Date();
  const ergebnis = leereSprachzeit(jetzt);

  if (!guildId) {
    return ergebnis;
  }

  const offene: OffenerAbschnitt[] = await prisma.analyticsVoiceSegment.findMany({
    where: {
      guildId,
      leftAt: null,
      // Zeit im AFK-Kanal ist Anwesenheit, keine Aktivitaet.
      isAfk: false,
      ...(optionen.mitBots ? {} : { isBot: false }),
    },
    select: {
      discordId: true,
      channelId: true,
      channelName: true,
      parentId: true,
      joinedAt: true,
    },
  });

  for (const abschnitt of offene) {
    const sekunden = anteilSekunden(abschnitt.joinedAt, null, fenster.von, fenster.bis, jetzt);
    if (sekunden <= 0) {
      continue;
    }

    ergebnis.sekunden += sekunden;
    ergebnis.mitglieder.add(abschnitt.discordId);
    ergebnis.jeMitglied.set(
      abschnitt.discordId,
      (ergebnis.jeMitglied.get(abschnitt.discordId) ?? 0) + sekunden,
    );

    const kanal = ergebnis.jeKanal.get(abschnitt.channelId);
    if (kanal) {
      kanal.sekunden += sekunden;
    } else {
      ergebnis.jeKanal.set(abschnitt.channelId, {
        sekunden,
        channelName: abschnitt.channelName,
        parentId: abschnitt.parentId,
      });
    }

    // Dieselbe Aufteilung wie beim Verbuchen eines geschlossenen Abschnitts:
    // eine Sitzung von 23:30 bis 01:00 gehoert zu 30 Minuten dem einen Tag
    // und zu 60 Minuten dem naechsten.
    const von = new Date(Math.max(abschnitt.joinedAt.getTime(), fenster.von.getTime()));
    const bis = new Date(Math.min(fenster.bis.getTime(), jetzt.getTime()));
    for (const eimer of aufTageVerteilen(von, bis)) {
      ergebnis.jeTag.set(eimer.schluessel, (ergebnis.jeTag.get(eimer.schluessel) ?? 0) + eimer.sekunden);
    }
    for (const eimer of aufStundenVerteilen(von, bis)) {
      const schluessel = eimer.schluessel.getTime();
      ergebnis.jeStunde.set(schluessel, (ergebnis.jeStunde.get(schluessel) ?? 0) + eimer.sekunden);
    }

    // Waechst dieser Anteil noch? Nur, wenn das Fenster bis in die Gegenwart
    // reicht. Ein abgeschlossener Zeitraum in der Vergangenheit bekommt
    // nichts mehr dazu, auch wenn die Sitzung weiterlaeuft.
    if (fenster.bis.getTime() >= jetzt.getTime()) {
      ergebnis.wachsend += 1;
    }
  }

  return ergebnis;
}
