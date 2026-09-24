import { formatSwissNumber } from '@swisshub/shared';
import type { WrappedQuellen } from './daten';
import { monatsName, periodenLabel, type WrappedPeriode, type WrappedPeriodenArt } from './perioden';
import type { WrappedEditorial, WrappedVorlage } from './vorlagen';
import type {
  ClipSieger,
  Gemeinschaftszahlen,
  MonatsWert,
  SpielWahlErgebnis,
  TerminBilanz,
  TurnierErgebnis,
} from './gemeinschaft';

/**
 * Welche Folien es geben kann - und wann nicht.
 *
 * ## Die wichtigste Zeile dieses Moduls
 *
 * Jede Story sagt selbst, ob sie etwas zu sagen hat. Hat sie nichts, gibt
 * sie einen **Grund** zurueck und keine Folie. Sie gibt niemals eine Null
 * zurueck, kein «ca.», keinen Platzhalter.
 *
 * «0 Turniere» auf einer Instagram-Story ist kein Rueckblick, sondern eine
 * Entschuldigung. Und eine geschaetzte Zahl auf einem Bild, das
 * hinausgeht, ist schlimmer als gar kein Bild: sie laesst sich nicht mehr
 * zurueckholen.
 *
 * ## Warum die Gruende gespeichert werden
 *
 * Sonst steht das Team vor einer Ausgabe mit fuenf Folien und weiss nicht,
 * ob die sechste fehlt, weil nichts passiert ist, oder weil etwas kaputt
 * ist. Die Gruende landen in `WrappedEdition.diagnostics` und sind im
 * Editor einsehbar.
 *
 * ## Warum eine Registry
 *
 * Die Alternative waere eine Funktion mit fuenfzehn Faellen - und beim
 * sechzehnten eine mit sechzehn. Hier ist eine neue Story ein Eintrag in
 * der Liste unten. Sie braucht keine Aenderung am Ablauf, an der Auswahl,
 * am Editor oder am Zeichner.
 */

/**
 * Warum eine Folie nicht entstanden ist.
 *
 * `nicht_erhoben` heisst: die Datenquelle misst in diesem Zeitraum nicht -
 * das Analytics-Modul war aus, oder es gab die Funktion noch nicht.
 * `nichts_passiert` heisst: gemessen wurde, aber es gab nichts. Das ist ein
 * Unterschied, den ein Rueckblick kennen muss: das eine ist eine Luecke,
 * das andere ein ruhiger Monat.
 */
export type WrappedDatenlage =
  'nicht_erhoben' | 'nur_teilweise_erhoben' | 'nichts_passiert' | 'zu_wenig_vergleich';

export interface StoryKontext {
  guildId: string;
  periode: WrappedPeriode;
  /** Die Datenlage des Zeitraums - aus dem bestehenden Resolver. */
  quellen: WrappedQuellen;
  zahlen: Gemeinschaftszahlen;
  turniere: TurnierErgebnis[];
  termine: TerminBilanz;
  clips: ClipSieger[];
  spiele: SpielWahlErgebnis[];
  /** Der bisherige Tagesrekord vor dem Zeitraum - `null` heisst: kein Vergleich. */
  rekord: { voiceSeconds: number; tage: number } | null;
  /** Nur bei Jahresausgaben gefuellt. */
  monate: MonatsWert[] | null;
  /** Die freigegebenen Community-Momente des Zeitraums. */
  momente: Array<{
    id: string;
    title: string;
    description: string | null;
    imagePath: string | null;
    happenedAt: Date;
    priority: number;
  }>;
}

export interface StoryFolie {
  art: 'folie';
  templateKey: WrappedVorlage;
  daten: unknown;
  /** Der Textvorschlag. Bearbeitbar - die Zahlen darunter nicht. */
  vorschlag: WrappedEditorial;
  /** Wie bemerkenswert. Hoeher heisst weiter vorne. */
  score: number;
  /** Verweis auf einen Community-Moment, falls es einer ist. */
  momentId?: string;
}

export interface StoryEntfaellt {
  art: 'entfaellt';
  lage: WrappedDatenlage;
  erklaerung: string;
}

export type StoryAusgang = StoryFolie | StoryEntfaellt;

export interface WrappedStory {
  key: string;
  label: string;
  beschreibung: string;
  perioden: readonly WrappedPeriodenArt[];
  /** Intro und Outro stehen fest - sie werden nicht nach Punkten sortiert. */
  fest?: 'anfang' | 'ende';
  erhebe(kontext: StoryKontext): StoryAusgang;
}

// --- Hilfen -----------------------------------------------------------------

const entfaellt = (lage: WrappedDatenlage, erklaerung: string): StoryEntfaellt => ({
  art: 'entfaellt',
  lage,
  erklaerung,
});

const zahl = (wert: number): string => formatSwissNumber(wert);

/** Sekunden als ganze Stunden - abgerundet, nie aufgerundet. */
const stunden = (sekunden: number): number => Math.floor(sekunden / 3600);

/**
 * Die Messabdeckung einer Quelle pruefen.
 *
 * ## Nur fuer Sprachzeit und Nachrichten
 *
 * Nur diese beiden **werden gemessen**, und nur bei ihnen gibt es eine Marke
 * dafuer, seit wann. Wer im Maerz das Analytics-Modul eingeschaltet hat, hat
 * fuer Januar keine Zahlen - und eine Summe ueber die halbe Strecke hiesse
 * etwas anderes als «im ersten Quartal». `teilweise` ist deshalb ein Grund,
 * die Folie wegzulassen.
 *
 * ## Warum Turniere, Termine, Clips und Auswahlrunden hier fehlen
 *
 * Weil sie nicht gemessen werden. Es sind fachliche Zeilen, die es gibt oder
 * nicht gibt; die Frage «wurde das erhoben» passt nicht auf sie.
 *
 * Sie einmal falsch gestellt zu haben kostete beinahe eine Folie: die
 * Datenlage zaehlte Turniere nach ihrem **Anlagedatum**, und ein im August
 * entschiedenes Turnier, das im September angelegt worden war, galt damit
 * als «nicht erhoben» - obwohl der Sieger feststand. Diese Stories pruefen
 * jetzt selbst, ob sie etwas gefunden haben. Eine leere Liste heisst
 * «nichts passiert», und das ist die Wahrheit.
 */
function pruefeQuelle(quelle: WrappedQuellen[keyof WrappedQuellen], name: string): StoryEntfaellt | null {
  if (quelle.lage === 'fehlt') {
    return entfaellt('nicht_erhoben', `${name} wurde in diesem Zeitraum nicht erhoben.`);
  }
  if (quelle.lage === 'teilweise') {
    const prozent = Math.round(quelle.abdeckung * 100);
    return entfaellt(
      'nur_teilweise_erhoben',
      `${name} wurde erst ab dem ${quelle.seit?.slice(0, 10) ?? '?'} erhoben - das deckt nur ${prozent} % des Zeitraums ab.`,
    );
  }
  return null;
}

// --- Die Stories ------------------------------------------------------------

const INTRO: WrappedStory = {
  key: 'intro',
  label: 'Eröffnung',
  beschreibung: 'Marke, Zeitraum, ein Satz. Steht immer am Anfang.',
  perioden: ['MONTHLY', 'YEARLY'],
  fest: 'anfang',
  erhebe: (kontext) => ({
    art: 'folie',
    templateKey: 'INTRO',
    daten: { periode: periodenLabel(kontext.periode), jahr: kontext.periode.jahr },
    vorschlag: {
      ueberschrift: 'SwissHub Wrapped',
      text:
        kontext.periode.art === 'MONTHLY'
          ? 'So hat SwissHub diesen Monat gezockt.'
          : 'Zwölf Monate. Eine Community.',
    },
    score: 0,
  }),
};

const COMMUNITY: WrappedStory = {
  key: 'community',
  label: 'Community',
  beschreibung: 'Aktive Mitglieder und Zuwachs.',
  perioden: ['MONTHLY', 'YEARLY'],
  erhebe: (kontext) => {
    const { zahlen } = kontext;
    if (zahlen.tageMitDaten === 0) {
      return entfaellt('nicht_erhoben', 'Für diesen Zeitraum liegen keine Tageswerte der Statistik vor.');
    }
    if (zahlen.aktiveMitglieder === 0) {
      return entfaellt('nichts_passiert', 'In diesem Zeitraum war niemand aktiv.');
    }
    return {
      art: 'folie',
      templateKey: 'TWO_STAT',
      daten: {
        links: { wert: zahl(zahlen.aktiveMitglieder), label: 'aktive Mitglieder' },
        rechts: { wert: `+${zahl(zahlen.joins)}`, label: 'neu dazugekommen' },
      },
      vorschlag: { ueberschrift: 'Die Community', text: '' },
      // Immer interessant, aber selten das Aufregendste.
      score: 650,
    };
  },
};

const VOICE_TOTAL: WrappedStory = {
  key: 'voice_total',
  label: 'Sprachzeit',
  beschreibung: 'Die gesamte Zeit im Sprachkanal, als grosse Zahl.',
  perioden: ['MONTHLY', 'YEARLY'],
  erhebe: (kontext) => {
    const fehlt = pruefeQuelle(kontext.quellen.voice, 'Die Sprachzeit');
    if (fehlt) {
      return fehlt;
    }
    const gesamt = stunden(kontext.zahlen.voiceSeconds);
    if (gesamt < 1) {
      return entfaellt('nichts_passiert', 'Im Sprachkanal kam keine volle Stunde zusammen.');
    }
    /*
     * «Das sind mehr als N Tage» - nur wenn es stimmt und etwas bedeutet.
     *
     * Unter zwei Tagen ist der Satz keine Hilfe, sondern eine Verkleinerung.
     * Gerechnet wird abgerundet, damit «mehr als» buchstaeblich zutrifft.
     */
    const tage = Math.floor(gesamt / 24);
    return {
      art: 'folie',
      templateKey: 'HERO_NUMBER',
      daten: {
        wert: zahl(gesamt),
        label: 'Voice-Stunden',
        zusatz: tage >= 2 ? `Das sind mehr als ${zahl(tage)} Tage am Stück.` : null,
      },
      vorschlag: { ueberschrift: 'Im Voice', text: '' },
      score: 600,
    };
  },
};

const VOICE_RECORD: WrappedStory = {
  key: 'voice_record',
  label: 'Voice-Rekord',
  beschreibung: 'Der stärkste Tag - nur mit belegbarem Vergleich.',
  perioden: ['MONTHLY', 'YEARLY'],
  erhebe: (kontext) => {
    const fehlt = pruefeQuelle(kontext.quellen.voice, 'Die Sprachzeit');
    if (fehlt) {
      return fehlt;
    }
    const bester = kontext.zahlen.besterVoiceTag;
    if (!bester || bester.voiceSeconds <= 0) {
      return entfaellt('nichts_passiert', 'Es gab keinen Tag mit Sprachzeit.');
    }
    /*
     * «Rekord» ist eine Behauptung ueber alle Zeiten.
     *
     * Sie darf nur dastehen, wenn alle Zeiten auch vorliegen. Ohne Tage vor
     * dem Zeitraum gibt es keinen Vergleich - und ohne Vergleich keine
     * Folie. Dreissig Tage sind die Untergrenze: mit einer Woche Vorlauf
     * waere jeder zweite Tag ein «Rekord».
     */
    if (!kontext.rekord || kontext.rekord.tage < 30) {
      return entfaellt(
        'zu_wenig_vergleich',
        'Vor diesem Zeitraum liegen weniger als 30 gemessene Tage - ein Rekord liesse sich damit nicht belegen.',
      );
    }
    if (bester.voiceSeconds <= kontext.rekord.voiceSeconds) {
      return entfaellt('nichts_passiert', 'Der beste Tag blieb unter dem bisherigen Bestwert.');
    }
    return {
      art: 'folie',
      templateKey: 'HERO_NUMBER',
      daten: {
        wert: zahl(stunden(bester.voiceSeconds)),
        label: 'Stunden an einem Tag',
        zusatz: `Neuer Bestwert - am ${bester.tag.split('-').reverse().join('.')}.`,
      },
      vorschlag: { ueberschrift: 'Der stärkste Tag', text: '' },
      // Ein belegter Rekord ist das Interessanteste, was Zahlen hergeben.
      score: 850,
    };
  },
};

const MESSAGES: WrappedStory = {
  key: 'messages',
  label: 'Nachrichten',
  beschreibung: 'Geschriebene Nachrichten im Zeitraum.',
  perioden: ['MONTHLY', 'YEARLY'],
  erhebe: (kontext) => {
    const fehlt = pruefeQuelle(kontext.quellen.messages, 'Die Nachrichtenzahl');
    if (fehlt) {
      return fehlt;
    }
    if (kontext.zahlen.messages < 100) {
      return entfaellt('nichts_passiert', 'Es kamen weniger als 100 Nachrichten zusammen.');
    }
    return {
      art: 'folie',
      templateKey: 'HERO_NUMBER',
      daten: { wert: zahl(kontext.zahlen.messages), label: 'Nachrichten', zusatz: null },
      vorschlag: { ueberschrift: 'Geschrieben', text: '' },
      score: 450,
    };
  },
};

const TOURNAMENT_WINNER: WrappedStory = {
  key: 'tournament_winner',
  label: 'Turniersieger',
  beschreibung: 'Das grösste abgeschlossene Turnier mit seinem Sieger.',
  perioden: ['MONTHLY', 'YEARLY'],
  erhebe: (kontext) => {
    // Das groesste zuerst - ein Turnier mit sechzehn Teams erzaehlt mehr als
    // eines mit dreien.
    const beste = [...kontext.turniere]
      .filter((turnier) => turnier.sieger !== null)
      .sort((a, b) => b.teilnehmer - a.teilnehmer)[0];
    if (!beste) {
      return entfaellt(
        'nichts_passiert',
        'In diesem Zeitraum wurde kein Turnier mit einem Sieger abgeschlossen.',
      );
    }
    return {
      art: 'folie',
      templateKey: 'WINNER',
      daten: {
        kategorie: 'Champion',
        name: beste.sieger as string,
        untertitel: beste.name,
        kennzahl: { wert: zahl(beste.teilnehmer), label: 'Teilnehmer' },
      },
      vorschlag: { ueberschrift: beste.name, text: '' },
      score: 900,
    };
  },
};

const TOURNAMENT_OVERVIEW: WrappedStory = {
  key: 'tournament_overview',
  label: 'Turnierbilanz',
  beschreibung: 'Turniere und Matches im Zeitraum.',
  perioden: ['MONTHLY', 'YEARLY'],
  erhebe: (kontext) => {
    if (kontext.turniere.length === 0) {
      return entfaellt('nichts_passiert', 'Es wurde kein Turnier abgeschlossen.');
    }
    const matches = kontext.turniere.reduce((summe, turnier) => summe + turnier.matches, 0);
    if (matches === 0) {
      return entfaellt('nichts_passiert', 'Zu den Turnieren sind keine Matches erfasst.');
    }
    return {
      art: 'folie',
      templateKey: 'TWO_STAT',
      daten: {
        links: {
          wert: zahl(kontext.turniere.length),
          label: kontext.turniere.length === 1 ? 'Turnier' : 'Turniere',
        },
        rechts: { wert: zahl(matches), label: 'Matches' },
      },
      vorschlag: { ueberschrift: 'Gespielt', text: '' },
      // Nur interessant, wenn nicht ohnehin schon der Sieger dasteht.
      score: 520,
    };
  },
};

const EVENT_OVERVIEW: WrappedStory = {
  key: 'event_overview',
  label: 'Events',
  beschreibung: 'Termine und Anmeldungen.',
  perioden: ['MONTHLY', 'YEARLY'],
  erhebe: (kontext) => {
    const { termine } = kontext;
    if (termine.termine === 0) {
      return entfaellt('nichts_passiert', 'Es fand kein Termin statt.');
    }
    if (termine.anmeldungen === 0) {
      return entfaellt('nichts_passiert', 'Zu den Terminen gab es keine bestätigten Anmeldungen.');
    }
    return {
      art: 'folie',
      templateKey: 'TWO_STAT',
      daten: {
        links: { wert: zahl(termine.termine), label: termine.termine === 1 ? 'Event' : 'Events' },
        // «Angemeldet» und nicht «dabei»: der Kalender erhebt kein
        // Einchecken, also weiss niemand, wer tatsaechlich da war.
        rechts: { wert: zahl(termine.anmeldungen), label: 'Anmeldungen' },
      },
      vorschlag: { ueberschrift: 'Zusammen unterwegs', text: '' },
      score: 550,
    };
  },
};

const CLIP_WINNER: WrappedStory = {
  key: 'clip_winner',
  label: 'Clip of the Week',
  beschreibung: 'Der meistgewählte Clip des Zeitraums.',
  perioden: ['MONTHLY', 'YEARLY'],
  erhebe: (kontext) => {
    const bester = [...kontext.clips].sort((a, b) => b.stimmen - a.stimmen)[0];
    if (!bester) {
      return entfaellt('nichts_passiert', 'Es wurde keine Clip-Runde abgeschlossen.');
    }
    return {
      art: 'folie',
      templateKey: 'WINNER',
      daten: {
        kategorie: 'Clip of the Week',
        name: bester.titel,
        untertitel: bester.einreicher ? `von ${bester.einreicher}` : null,
        kennzahl: { wert: zahl(bester.stimmen), label: bester.stimmen === 1 ? 'Stimme' : 'Stimmen' },
      },
      vorschlag: { ueberschrift: 'Clip of the Week', text: '' },
      score: 700,
    };
  },
};

const GAME_PICK: WrappedStory = {
  key: 'game_pick',
  label: 'Meistgewähltes Spiel',
  beschreibung: 'Was «Was spielen wir?» am häufigsten ausgewählt hat.',
  perioden: ['MONTHLY', 'YEARLY'],
  erhebe: (kontext) => {
    const [bestes, zweites] = kontext.spiele;
    if (!bestes) {
      return entfaellt('nichts_passiert', 'Es wurde keine Auswahlrunde abgeschlossen.');
    }
    /*
     * Bei Gleichstand keine Kuer.
     *
     * Zwei Spiele mit je drei Runden - dann gibt es kein
     * «meistgewaehltes», und eines davon zum Sieger zu erklaeren waere
     * eine Entscheidung, die die Daten nicht hergeben.
     */
    if (zweites && zweites.runden === bestes.runden) {
      return entfaellt(
        'nichts_passiert',
        `Gleichstand: ${bestes.name} und ${zweites.name} kamen beide auf ${bestes.runden} Runden.`,
      );
    }
    return {
      art: 'folie',
      templateKey: 'WINNER',
      daten: {
        // Ausdruecklich nicht «Spiel des Monats»: eine solche Auszeichnung
        // gibt es auf dem SwissHub nicht. Gezaehlt wird, was in den
        // Auswahlrunden gewonnen hat.
        kategorie: 'Am häufigsten gewählt',
        name: bestes.name,
        untertitel: null,
        kennzahl: { wert: zahl(bestes.runden), label: bestes.runden === 1 ? 'Runde' : 'Runden' },
      },
      vorschlag: { ueberschrift: 'Das haben wir gespielt', text: '' },
      score: 600,
    };
  },
};

const COMMUNITY_MOMENT: WrappedStory = {
  key: 'community_moment',
  label: 'Community Moment',
  beschreibung: 'Ein besonderer Moment - mit Bild, von Hand gepflegt.',
  perioden: ['MONTHLY', 'YEARLY'],
  erhebe: (kontext) => {
    // Hoechste Prioritaet zuerst, bei Gleichstand der juengste.
    const bester = [...kontext.momente].sort(
      (a, b) => b.priority - a.priority || b.happenedAt.getTime() - a.happenedAt.getTime(),
    )[0];
    if (!bester) {
      return entfaellt(
        'nichts_passiert',
        'Für diesen Zeitraum ist kein Community Moment freigegeben. Momente werden von Hand gepflegt - automatisch entsteht hier nichts.',
      );
    }
    return {
      art: 'folie',
      templateKey: 'IMAGE_MOMENT',
      daten: {
        titel: bester.title,
        text: bester.description,
        bild: bester.imagePath ? `/api/wrapped/moment/${bester.id}` : null,
        datum: bester.happenedAt.toISOString().slice(0, 10).split('-').reverse().join('.'),
      },
      vorschlag: { ueberschrift: 'Community Moment', text: '' },
      score: 800,
      momentId: bester.id,
    };
  },
};

const MONTH_OVERVIEW: WrappedStory = {
  key: 'month_overview',
  label: 'Das Jahr nach Monaten',
  beschreibung: 'Zwölf Balken - und der stärkste Monat.',
  perioden: ['YEARLY'],
  erhebe: (kontext) => {
    const fehlt = pruefeQuelle(kontext.quellen.voice, 'Die Sprachzeit');
    if (fehlt) {
      return fehlt;
    }
    const monate = kontext.monate;
    if (!monate || monate.length !== 12) {
      return entfaellt('nicht_erhoben', 'Der Monatsverlauf liess sich nicht ermitteln.');
    }
    if (monate.every((monat) => monat.voiceSeconds === 0)) {
      return entfaellt('nichts_passiert', 'In keinem Monat kam Sprachzeit zusammen.');
    }
    /*
     * «Der staerkste Monat» braucht alle zwoelf.
     *
     * Wurde erst ab Juli gemessen, ist der Juli zwangslaeufig der erste mit
     * Daten - ihn zum staerksten zu erklaeren waere eine Aussage ueber die
     * Messung, nicht ueber den Server. Die Folie bleibt dann, der Titel
     * faellt weg.
     */
    const alleGemessen = monate.every((monat) => monat.voiceSeconds > 0);
    const bester = monate.reduce((beste, monat) => (monat.voiceSeconds > beste.voiceSeconds ? monat : beste));
    return {
      art: 'folie',
      templateKey: 'MONTH_OVERVIEW',
      daten: {
        kategorie: 'Voice über das Jahr',
        einheit: 'Stunden',
        monate: monate.map((monat) => ({
          name: monatsName(monat.monat).slice(0, 3),
          wert: stunden(monat.voiceSeconds),
          anzeige: zahl(stunden(monat.voiceSeconds)),
        })),
        bester: alleGemessen ? monatsName(bester.monat) : null,
      },
      vorschlag: { ueberschrift: 'Zwölf Monate', text: '' },
      score: 750,
    };
  },
};

const YEAR_NUMBERS: WrappedStory = {
  key: 'year_numbers',
  label: 'Das Jahr in Zahlen',
  beschreibung: 'Sprachzeit und aktive Mitglieder über das ganze Jahr.',
  perioden: ['YEARLY'],
  erhebe: (kontext) => {
    const fehlt = pruefeQuelle(kontext.quellen.voice, 'Die Sprachzeit');
    if (fehlt) {
      return fehlt;
    }
    const gesamt = stunden(kontext.zahlen.voiceSeconds);
    if (gesamt < 24 || kontext.zahlen.aktiveMitglieder === 0) {
      return entfaellt('nichts_passiert', 'Für eine Jahresbilanz kam zu wenig zusammen.');
    }
    return {
      art: 'folie',
      templateKey: 'TWO_STAT',
      daten: {
        links: { wert: zahl(gesamt), label: 'Voice-Stunden' },
        rechts: { wert: zahl(kontext.zahlen.aktiveMitglieder), label: 'aktive Mitglieder' },
      },
      vorschlag: { ueberschrift: `${kontext.periode.jahr} in Zahlen`, text: '' },
      score: 880,
    };
  },
};

const OUTRO: WrappedStory = {
  key: 'outro',
  label: 'Abschluss',
  beschreibung: 'Dank und Adresse. Steht immer am Ende.',
  perioden: ['MONTHLY', 'YEARLY'],
  fest: 'ende',
  erhebe: (kontext) => ({
    art: 'folie',
    templateKey: 'OUTRO',
    daten: { periode: periodenLabel(kontext.periode) },
    vorschlag: {
      ueberschrift:
        kontext.periode.art === 'MONTHLY'
          ? `Das war ${periodenLabel(kontext.periode)}.`
          : `Das war ${kontext.periode.jahr}.`,
      text: 'Danke, dass ihr SwissHub zu dem macht, was es ist.',
    },
    score: 0,
  }),
};

export const WRAPPED_STORIES: readonly WrappedStory[] = [
  INTRO,
  YEAR_NUMBERS,
  TOURNAMENT_WINNER,
  VOICE_RECORD,
  COMMUNITY_MOMENT,
  MONTH_OVERVIEW,
  CLIP_WINNER,
  COMMUNITY,
  GAME_PICK,
  VOICE_TOTAL,
  EVENT_OVERVIEW,
  TOURNAMENT_OVERVIEW,
  MESSAGES,
  OUTRO,
];

export function storyNach(key: string): WrappedStory | undefined {
  return WRAPPED_STORIES.find((story) => story.key === key);
}

/** Wie viele Folien eine Ausgabe hoechstens bekommt. */
export const FOLIEN_OBERGRENZE: Record<WrappedPeriodenArt, number> = {
  // Fuenf bis acht laut Vorgabe - die Obergrenze verhindert, dass ein
  // besonders reicher Monat zu einem Karussell wird, das niemand durchwischt.
  MONTHLY: 8,
  YEARLY: 15,
};

export interface AuswahlErgebnis {
  folien: Array<StoryFolie & { storyKey: string; position: number }>;
  /** Je uebersprungener Story ein Grund - fuer den Editor. */
  gruende: Array<{ storyKey: string; label: string; lage: WrappedDatenlage; erklaerung: string }>;
}

/**
 * Welche Folien die Ausgabe bekommt.
 *
 * ## Warum sortiert und nicht in Registry-Reihenfolge
 *
 * Damit nicht jeder Monat gleich aussieht. Ein Monat mit einem Turnierfinale
 * beginnt mit dem Turnier; ein ruhiger Monat mit der Sprachzeit. Die
 * Punktwerte stehen fest in der jeweiligen Story - es wird nichts gewuerfelt
 * und nichts geraten, und derselbe Zeitraum ergibt zweimal dieselbe Folge.
 *
 * ## Warum Intro und Outro nicht mitsortiert werden
 *
 * Weil eine Geschichte vorne anfaengt und hinten aufhoert. Die beiden haben
 * deshalb keinen Punktwert, sondern einen Platz.
 */
export function waehleFolien(kontext: StoryKontext): AuswahlErgebnis {
  const gruende: AuswahlErgebnis['gruende'] = [];
  const anfang: StoryFolie[] = [];
  const mitte: Array<StoryFolie & { storyKey: string }> = [];
  const ende: StoryFolie[] = [];
  const anfangKeys: string[] = [];
  const endeKeys: string[] = [];

  for (const story of WRAPPED_STORIES) {
    if (!story.perioden.includes(kontext.periode.art)) {
      continue;
    }
    const ausgang = story.erhebe(kontext);
    if (ausgang.art === 'entfaellt') {
      gruende.push({
        storyKey: story.key,
        label: story.label,
        lage: ausgang.lage,
        erklaerung: ausgang.erklaerung,
      });
      continue;
    }
    if (story.fest === 'anfang') {
      anfang.push(ausgang);
      anfangKeys.push(story.key);
    } else if (story.fest === 'ende') {
      ende.push(ausgang);
      endeKeys.push(story.key);
    } else {
      mitte.push({ ...ausgang, storyKey: story.key });
    }
  }

  const obergrenze = FOLIEN_OBERGRENZE[kontext.periode.art] - anfang.length - ende.length;
  const sortiert = [...mitte].sort((a, b) => b.score - a.score || a.storyKey.localeCompare(b.storyKey));
  const genommen = sortiert.slice(0, Math.max(0, obergrenze));

  for (const uebrig of sortiert.slice(genommen.length)) {
    const story = storyNach(uebrig.storyKey);
    gruende.push({
      storyKey: uebrig.storyKey,
      label: story?.label ?? uebrig.storyKey,
      lage: 'nichts_passiert',
      erklaerung: `Nicht aufgenommen - die Ausgabe fasst höchstens ${FOLIEN_OBERGRENZE[kontext.periode.art]} Folien, und andere Folien waren in diesem Zeitraum aussagekräftiger.`,
    });
  }

  const folien = [
    ...anfang.map((folie, index) => ({ ...folie, storyKey: anfangKeys[index] as string })),
    ...genommen,
    ...ende.map((folie, index) => ({ ...folie, storyKey: endeKeys[index] as string })),
  ].map((folie, position) => ({ ...folie, position }));

  return { folien, gruende };
}
