import { ARCHETYP_NACH_KEY } from './archetyp';
import { primeTimeStunde } from './vorlage';
import type { WrappedDaten } from './daten';

/**
 * Was die Szenen sagen.
 *
 * ## Warum das hier steht und nicht in den Komponenten
 *
 * Damit es jemand lesen kann, ohne JSX zu lesen. Die Texte sind der halbe
 * Rueckblick - sie entscheiden, ob sich jemand gesehen fuehlt oder
 * vermessen. Sie gehoeren an eine Stelle, an der man sie am Stueck
 * durchgehen und aendern kann.
 *
 * ## Warum Varianten
 *
 * «Du warst dieses Jahr ziemlich viel hier» passt bei 200 Stunden und wirkt
 * hoehnisch bei drei. Jede Szene hat deshalb Stufen, und die Stufe ergibt
 * sich aus der Zahl. Das ist der ganze Trick: nicht der Text passt sich an,
 * sondern es gibt mehrere, und die Zahl waehlt.
 *
 * ## Was hier nicht passiert
 *
 * Kein Modell, kein Aufruf, keine Erzeugung beim Seitenaufbau. Sechstausend
 * Rueckblicke waeren sechstausend Anfragen - und keine zwei davon waeren
 * gleich, auch nicht bei denselben Zahlen.
 *
 * ## Tonfall
 *
 * Zugewandt, trocken, nie herablassend. Niemand wird fuer wenig Aktivitaet
 * gerueffelt und niemand fuer viel bemitleidet. Im Zweifel: weniger Witz,
 * mehr Waerme.
 */

export interface SzenenText {
  /** Der Satz vor der Zahl. */
  setup: string;
  /** Der Satz nach der Zahl. */
  pointe?: string;
}

const stufe = (wert: number, grenzen: [number, number, number]): 0 | 1 | 2 | 3 => {
  if (wert >= grenzen[2]) {
    return 3;
  }
  if (wert >= grenzen[1]) {
    return 2;
  }
  if (wert >= grenzen[0]) {
    return 1;
  }
  return 0;
};

/** «Fast acht komplette Tage» - der Vergleich, der eine grosse Zahl greifbar macht. */
export function voiceVergleich(sekunden: number): string | null {
  const tage = sekunden / 86400;
  if (tage >= 1) {
    const gerundet = Math.floor(tage);
    const rest = tage - gerundet;
    const wort = gerundet === 1 ? 'ein kompletter Tag' : `${gerundet} komplette Tage`;
    return rest >= 0.5 ? `Mehr als ${wort}.` : `Das sind ${wort}.`;
  }
  const stunden = Math.round(sekunden / 3600);
  return stunden >= 3 ? `Das sind ${stunden} Stunden am Stück gerechnet.` : null;
}

const VOICE: SzenenText[] = [
  { setup: 'Du warst dieses Jahr ab und zu da.' },
  { setup: 'Du warst dieses Jahr regelmässig im Voice.' },
  { setup: 'Du warst dieses Jahr nicht gerade selten hier.' },
  { setup: 'Du hattest hier praktisch eine Adresse.' },
];

const MESSAGES: SzenenText[] = [
  { setup: 'Du hast dich gemeldet, wenn es etwas zu sagen gab.' },
  { setup: 'Du hattest offenbar einiges zu sagen.' },
  { setup: 'Ohne dich wäre es im Chat deutlich ruhiger gewesen.' },
  { setup: 'Du hast den Chat dieses Jahr mitgetragen.' },
];

/** Der Text zur Prime Time - abhaengig von der Tageszeit, nicht von der Menge. */
export function primeTimeText(stundeWert: number): SzenenText {
  if (stundeWert >= 23 || stundeWert < 5) {
    return {
      setup: 'Deine Zeit begann, als die meisten schon offline waren.',
      pointe: 'Wir stellen keine Fragen.',
    };
  }
  if (stundeWert < 9) {
    return { setup: 'Du warst schon wach, als andere noch Kaffee suchten.', pointe: 'Früh dran. Jeden Tag.' };
  }
  if (stundeWert < 13) {
    return {
      setup: 'Dein Tag hat früh angefangen.',
      pointe: 'Vormittags gehörte der Server ein Stück weit dir.',
    };
  }
  if (stundeWert < 18) {
    return { setup: 'Nachmittags warst du am häufigsten da.', pointe: 'Zwischen Alltag und Abend.' };
  }
  return { setup: 'Abends lief es bei dir zur Hochform auf.', pointe: 'Prime Time.' };
}

export function voiceText(sekunden: number): SzenenText {
  const stunden = sekunden / 3600;
  return VOICE[stufe(stunden, [20, 80, 250])] ?? VOICE[0]!;
}

export function messagesText(anzahl: number): SzenenText {
  return MESSAGES[stufe(anzahl, [300, 1500, 5000])] ?? MESSAGES[0]!;
}

export function kanalText(sekunden: number): SzenenText {
  const stunden = sekunden / 3600;
  if (stunden >= 100) {
    return { setup: 'Hier hast du offenbar gewohnt.' };
  }
  if (stunden >= 30) {
    return { setup: 'Ein Kanal war dabei deutlich dein Zuhause.' };
  }
  return { setup: 'Am liebsten warst du hier.' };
}

export function matesText(anzahl: number): SzenenText {
  return anzahl >= 5
    ? { setup: 'Alleine warst du selten.' }
    : { setup: 'Ein paar Leute waren besonders oft dabei.' };
}

export function levelText(von: number, bis: number): SzenenText {
  const sprung = bis - von;
  if (sprung >= 20) {
    return { setup: 'Und nebenbei bist du ordentlich gewachsen.' };
  }
  if (sprung >= 5) {
    return { setup: 'Dein Level ist mitgewachsen.' };
  }
  return { setup: 'Schritt für Schritt nach oben.' };
}

export function clipsText(siege: number): SzenenText {
  if (siege >= 2) {
    return { setup: 'Und manchmal hast du geliefert.', pointe: 'Mehr als einmal.' };
  }
  if (siege === 1) {
    return { setup: 'Und einmal hast du den ganzen Server abgeräumt.' };
  }
  return { setup: 'Und manchmal hast du geliefert.' };
}

export function eventsText(turniere: number, siege: number): SzenenText {
  if (siege > 0) {
    return { setup: 'Du bist angetreten - und hast gewonnen.' };
  }
  if (turniere >= 3) {
    return { setup: 'Du warst dabei, wenn es ernst wurde.' };
  }
  return { setup: 'Du warst dabei, wenn etwas lief.' };
}

export function aktiveTageText(tage: number): SzenenText {
  if (tage >= 300) {
    return { setup: 'Es gab kaum einen Tag ohne dich.' };
  }
  if (tage >= 180) {
    return { setup: 'An mehr als der Hälfte aller Tage warst du hier.' };
  }
  return { setup: 'Du warst immer wieder da.' };
}

export function spieleText(name: string): SzenenText {
  return { setup: `Am häufigsten hast du nach Leuten für ${name} gesucht.` };
}

/** Der Anspruch des Typs - aus der Archetyp-Registry. */
export function archetypText(key: string): SzenenText {
  return { setup: ARCHETYP_NACH_KEY.get(key as never)?.claim ?? 'Das war dein Jahr.' };
}

/**
 * Die Vorgabetexte fuer Eroeffnung und Abschluss einer Kampagne.
 *
 * Sie stehen als Vorschlag im Studio und sind dort aenderbar - daher die
 * Platzhalter.
 */
export const STANDARD_INTRO = 'Dein Jahr. Deine Mates. Dein SwissHub.';
export const STANDARD_OUTRO = 'Danke, dass du Teil von SwissHub bist.';

/**
 * Die Zeile unter dem Intro - je nachdem, ob jemand neu dazugekommen ist.
 *
 * Ein Rueckblick auf ein Jahr, von dem jemand nur vier Monate dabei war, darf
 * nicht so tun, als waere er ueber zwoelf Monate gegangen.
 */
export function introZeile(daten: WrappedDaten): string {
  const name = daten.person.displayName ?? daten.person.username ?? 'Du';
  return daten.person.imZeitraumBeigetreten
    ? `${name}, das war dein erstes Stück SwissHub.`
    : `${name}, das war dein ${daten.period.year}.`;
}

/** Die Prime-Time-Stunde als Text, oder `null`. */
export function primeTime(daten: WrappedDaten): { stunde: number; text: SzenenText } | null {
  const stundeWert = primeTimeStunde(daten.voice.hours);
  return stundeWert === null ? null : { stunde: stundeWert, text: primeTimeText(stundeWert) };
}
