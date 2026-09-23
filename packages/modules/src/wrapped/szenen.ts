import type { WrappedDaten } from './daten';

/**
 * Welche Kapitel es gibt.
 *
 * ## Warum eine Registry und keine Verzweigung
 *
 * Die Alternative waere eine Komponente mit vierzehn Faellen - und beim
 * fuenfzehnten Kapitel eine mit fuenfzehn. Hier steht je Szene eine Zeile:
 * Schluessel, Name, wann sie sinnvoll ist, wie sie hereinkommt. Eine neue
 * Szene heisst: ein Eintrag hier, eine Komponente dort, fertig.
 *
 * Die Darstellung steht bewusst **nicht** hier. Dieses Paket laeuft auch im
 * Bot, und der braucht keine React-Komponenten. Die Oberflaeche bildet die
 * Schluessel auf ihre Komponenten ab.
 *
 * ## Eignung
 *
 * Jede Szene sagt selbst, ob sie fuer eine Person etwas zu erzaehlen hat.
 * Das ist die wichtigste Regel des ganzen Moduls: **eine Szene mit einer
 * Null ist schlimmer als keine Szene.** «Du warst 0 Stunden im Voice» auf
 * einem ganzen Bildschirm ist kein Rueckblick, sondern ein Vorwurf.
 *
 * Die Schwellen liegen deshalb nicht bei «mehr als nichts», sondern dort, wo
 * eine Zahl tatsaechlich etwas bedeutet.
 */

/** Wie eine Szene hereinkommt. Die Oberflaeche kennt diese Muster. */
export type WrappedUebergang =
  'mask_reveal' | 'typographic_scale' | 'object_continuity' | 'slide_depth' | 'particle_reform' | 'morph';

export interface WrappedSzene {
  key: string;
  /** Name im Studio. */
  label: string;
  /** Ein Satz darueber, was die Szene zeigt - im Szenen-Editor sichtbar. */
  beschreibung: string;
  /** Vorgabereihenfolge. Das Studio darf sie aendern. */
  position: number;
  /** Vorgabe fuer neue Kampagnen. */
  standardAktiv: boolean;
  /** Von dieser Quelle haengt die Szene ab - fuer die Datenpruefung. */
  quelle: keyof WrappedDaten['quellen'] | null;
  uebergang: WrappedUebergang;
  /**
   * Hat diese Szene fuer diese Person etwas zu sagen?
   *
   * Nur lesen, nie rechnen: die Zahlen stehen bereits fest, wenn diese
   * Funktion laeuft.
   */
  eignung(daten: WrappedDaten): boolean;
}

/** Eine Szene, die immer laeuft - Anfang und Ende der Geschichte. */
const immer = (): boolean => true;

export const WRAPPED_SZENEN: readonly WrappedSzene[] = [
  {
    key: 'intro',
    label: 'Intro',
    beschreibung: 'Die Begrüssung mit Name, Avatar und Jahreszahl.',
    position: 0,
    standardAktiv: true,
    quelle: null,
    uebergang: 'mask_reveal',
    eignung: immer,
  },
  {
    key: 'voice_total',
    label: 'Sprachzeit',
    beschreibung: 'Die gesamte Zeit im Sprachkanal, als grosse Zahl.',
    position: 1,
    standardAktiv: true,
    quelle: 'voice',
    // Eine halbe Stunde im ganzen Jahr ist keine Geschichte. Darunter
    // entfaellt die Szene - und mit ihr alles, was auf ihr aufbaut.
    eignung: (daten) => daten.voice.seconds >= 1800,
    uebergang: 'typographic_scale',
  },
  {
    key: 'voice_channel',
    label: 'Lieblingskanal',
    beschreibung: 'Der Sprachkanal mit der meisten Zeit.',
    position: 2,
    standardAktiv: true,
    quelle: 'voice',
    eignung: (daten) => (daten.voice.topChannels[0]?.seconds ?? 0) >= 900,
    uebergang: 'slide_depth',
  },
  {
    key: 'voice_mates',
    label: 'Voice Mates',
    beschreibung: 'Mit wem jemand am häufigsten im selben Kanal sass.',
    position: 3,
    standardAktiv: true,
    quelle: 'voice',
    /*
     * Mindestens zwei - mit einer einzigen Person ist es keine Konstellation,
     * sondern eine Behauptung ueber genau eine Beziehung. Und mindestens eine
     * Stunde gemeinsame Zeit: wer sich einmal fuenf Minuten begegnet ist, ist
     * kein «Mate».
     */
    eignung: (daten) =>
      daten.voice.mates.length >= 2 && (daten.voice.mates[0]?.sharedSecondsRounded ?? 0) >= 3600,
    uebergang: 'particle_reform',
  },
  {
    key: 'messages',
    label: 'Nachrichten',
    beschreibung: 'Wie viel jemand geschrieben hat.',
    position: 4,
    standardAktiv: true,
    quelle: 'messages',
    eignung: (daten) => daten.messages.total >= 50,
    uebergang: 'typographic_scale',
  },
  {
    key: 'prime_time',
    label: 'Prime Time',
    beschreibung: 'Die Tageszeit mit der meisten Sprachzeit.',
    position: 5,
    standardAktiv: true,
    quelle: 'voice',
    /*
     * Die Prime Time entsteht aus der Sprachzeit - Nachrichten haben in
     * diesem System keine Uhrzeit je Person. Unter zwei Stunden im Jahr
     * ergibt die Verteilung ueber 24 Stunden keine Aussage, sondern Rauschen.
     */
    eignung: (daten) => daten.voice.seconds >= 7200,
    uebergang: 'morph',
  },
  {
    key: 'games',
    label: 'Spiele',
    beschreibung: 'Die Spiele aus der Spielersuche - ausdrücklich nicht «meistgespielt».',
    position: 6,
    standardAktiv: true,
    quelle: 'games',
    eignung: (daten) => (daten.spiele.top[0]?.sessions ?? 0) >= 3,
    uebergang: 'slide_depth',
  },
  {
    key: 'level',
    label: 'Level',
    beschreibung: 'Der Weg von Level zu Level.',
    position: 7,
    standardAktiv: true,
    quelle: 'level',
    // Ein Level-Sprung oder wenigstens ein spuerbarer XP-Zuwachs. Ohne
    // beides bliebe «Level 12 → Level 12» stehen.
    eignung: (daten) =>
      daten.level !== null && (daten.level.levelEnd > daten.level.levelStart || daten.level.xpGained >= 1000),
    uebergang: 'object_continuity',
  },
  {
    key: 'clips',
    label: 'Clips',
    beschreibung: 'Der erfolgreichste eigene Clip des Jahres.',
    position: 8,
    standardAktiv: true,
    quelle: 'clips',
    eignung: (daten) => daten.clips.best !== null,
    uebergang: 'mask_reveal',
  },
  {
    key: 'events',
    label: 'Events & Turniere',
    beschreibung: 'Teilnahmen an Turnieren und Terminen.',
    position: 9,
    standardAktiv: true,
    quelle: 'events',
    eignung: (daten) => daten.wettkampf.tournamentsPlayed + daten.wettkampf.eventsAttended > 0,
    uebergang: 'slide_depth',
  },
  {
    key: 'active_days',
    label: 'Aktive Tage',
    beschreibung: 'An wie vielen Tagen jemand da war.',
    position: 10,
    standardAktiv: true,
    quelle: null,
    eignung: (daten) => daten.aktivitaet.activeDays >= 20,
    uebergang: 'particle_reform',
  },
  {
    key: 'highlight',
    label: 'Dein Moment',
    beschreibung: 'Der eine Fakt, der bei dieser Person heraussticht.',
    position: 11,
    standardAktiv: true,
    quelle: null,
    eignung: (daten) => daten.highlight !== null,
    uebergang: 'typographic_scale',
  },
  {
    key: 'archetype',
    label: 'Dein Typ',
    beschreibung: 'Das spielerische Etikett auf den Aktivitätszahlen.',
    position: 12,
    standardAktiv: true,
    quelle: null,
    eignung: immer,
    uebergang: 'morph',
  },
  {
    key: 'finale',
    label: 'Finale',
    beschreibung: 'Der Abschluss mit den wichtigsten Zahlen und der Share Card.',
    position: 13,
    standardAktiv: true,
    quelle: null,
    eignung: immer,
    uebergang: 'mask_reveal',
  },
] as const;

export const SZENE_NACH_KEY = new Map(WRAPPED_SZENEN.map((szene) => [szene.key, szene]));

export interface SzenenEinstellung {
  sceneKey: string;
  enabled: boolean;
  position: number;
}

/**
 * Die Geschichte dieser Person - in der richtigen Reihenfolge.
 *
 * Zwei Filter hintereinander: was der Server ueberhaupt zeigt (Einstellung)
 * und was diese Person zu erzaehlen hat (Eignung). Eine Szene, deren
 * Schluessel es im Code nicht mehr gibt, faellt still heraus - eine alte
 * Einstellung soll keinen Absturz ausloesen.
 */
export function baueGeschichte(daten: WrappedDaten, einstellungen: SzenenEinstellung[]): string[] {
  const nachKey = new Map(einstellungen.map((eintrag) => [eintrag.sceneKey, eintrag]));

  return WRAPPED_SZENEN.filter((szene) => {
    const einstellung = nachKey.get(szene.key);
    // Ohne Eintrag gilt die Vorgabe aus der Registry: eine neu hinzugekommene
    // Szene erscheint damit auch in einer aelteren Kampagne, statt zu fehlen.
    if (einstellung ? !einstellung.enabled : !szene.standardAktiv) {
      return false;
    }
    /*
     * Fehlt die Datenquelle fuer den ganzen Server, entfaellt die Szene fuer
     * alle - unabhaengig davon, was bei dieser Person steht. Ohne diese
     * Regel zeigte ein Server ohne Clip-Modul eine Clip-Szene, sobald
     * irgendwo eine alte Zeile herumliegt.
     */
    if (szene.quelle && daten.quellen[szene.quelle].lage === 'fehlt') {
      return false;
    }
    return szene.eignung(daten);
  })
    .sort((a, b) => {
      const links = nachKey.get(a.key)?.position ?? a.position;
      const rechts = nachKey.get(b.key)?.position ?? b.position;
      return links - rechts || a.position - b.position;
    })
    .map((szene) => szene.key);
}

/**
 * Was eine Person bekaeme - Szene fuer Szene, mit Begruendung.
 *
 * Fuer die Abdeckungsmatrix im Studio: sie soll nicht nur zeigen, dass eine
 * Szene fehlt, sondern warum. «Keine Daten» und «vom Team ausgeschaltet»
 * sind zwei verschiedene Befunde, und nur einer davon ist ein Problem.
 */
export type SzenenBefund = 'aktiv' | 'ausgeschaltet' | 'keine-quelle' | 'zu-wenig-daten';

export function pruefeAbdeckung(
  daten: WrappedDaten,
  einstellungen: SzenenEinstellung[],
): Array<{ szene: WrappedSzene; befund: SzenenBefund }> {
  const nachKey = new Map(einstellungen.map((eintrag) => [eintrag.sceneKey, eintrag]));

  return WRAPPED_SZENEN.map((szene) => {
    const einstellung = nachKey.get(szene.key);
    if (einstellung ? !einstellung.enabled : !szene.standardAktiv) {
      return { szene, befund: 'ausgeschaltet' as const };
    }
    if (szene.quelle && daten.quellen[szene.quelle].lage === 'fehlt') {
      return { szene, befund: 'keine-quelle' as const };
    }
    return { szene, befund: szene.eignung(daten) ? ('aktiv' as const) : ('zu-wenig-daten' as const) };
  });
}
