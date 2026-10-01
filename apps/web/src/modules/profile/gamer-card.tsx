import type { profile } from '@swisshub/modules';
import { stufe } from './auszeichnungs-stufe';

/**
 * Die Gamer Card - das eigene Profil als Bild zum Teilen.
 *
 * ## Warum gezeichnet und nicht fotografiert
 *
 * Ein Screenshot der Profilseite saehe bei jedem anders aus: andere
 * Schriftgroesse, anderer Ausschnitt, ein Stueck Browserrahmen, eine
 * Scrollleiste. Hier entsteht ein Bild mit festen Massen, das in jedem
 * Instagram-Feed gleich aussieht - und in dem kein Dashboard vorkommt.
 *
 * ## Warum das nicht die Profilseite ist
 *
 * Weil eine Seite und ein Bild verschiedene Dinge sind. Die Seite hat Links,
 * Animationen, Scrollhoehe; das Bild hat einen Blick. Was auf die Karte kommt,
 * ist deshalb eine **Auswahl**: Name, Bild, bis zu vier Spiele, bis zu drei
 * Auszeichnungen, Level, Adresse. Alles andere wuerde bei 1080 Pixel Breite zu
 * klein, um es zu lesen.
 *
 * ## Was Satori nicht kann - und was daraus folgt
 *
 * Satori kennt nur einen Teil von CSS. Eine Eigenschaft, die jeder Browser
 * versteht, laesst das Rendern scheitern und liefert eine leere Datei:
 * `clip-path`, `text-transform`, ein `box-shadow` mit Streuung, `gap` in
 * manchen Faellen. Deshalb hier:
 *
 * - **Kein `text-transform`.** Grossschreibung passiert in JavaScript.
 * - **Kein `clip-path`.** Die Kantenformen der Themes kommen nicht mit; die
 *   Karte hat eigene, einfache Kanten.
 * - **Jedes Element mit `display: flex`.** Satori setzt `div` nicht von selbst
 *   auf Flex, und ohne es stapeln sich Kinder uebereinander.
 * - **`hsl()` in Kommaform.** Die Theme-Variablen sind HSL-Tripel ohne
 *   Funktion (`358 79% 52%`); die moderne Leerzeichen-Syntax ist hier nicht
 *   verlaesslich.
 *
 * ## Und die Theme-Animationen
 *
 * Sie kommen nicht mit, und das ist richtig: ein PNG bewegt sich nicht. Was
 * mitkommt, sind die **Farben** des Themes - aus derselben Registry, die die
 * Seite benutzt. Die Karte eines Prestige-Profils sieht deshalb nach Prestige
 * aus, ohne dass hier ein zweites Prestige-Design stuende.
 *
 * ## Und die Auszeichnungsstufen
 *
 * Sie standen hier als graues «GOLD» am rechten Rand - drei Auszeichnungen
 * nebeneinander sahen damit identisch aus, und ausgerechnet auf dem Bild,
 * das jemand teilt, war Gold von Bronze nicht zu unterscheiden.
 *
 * Nachgezeichnet wird deshalb, was die Seite mit CSS macht, und zwar mit dem,
 * was Satori kann: eigene Rahmenfarbe, eigener Flaechenverlauf, eigenes
 * Symbolfeld und eine eigene Eckenrundung je Stufe - Gold am kantigsten,
 * Bronze am weichsten. Dazu die Marke aus ein bis drei Strichen. Die Werte
 * stehen in `auszeichnungs-stufe`, also an derselben Stelle wie die der
 * Seite; die Karte ist dadurch keine zweite Auslegung derselben Sache,
 * sondern dieselbe Auslegung in einem anderen Werkzeug.
 *
 * Kein `clip-path` - Satori kennt ihn nicht. Die facettierten Ecken der
 * Goldkarte werden hier zu einer sehr kleinen Rundung; die Abstufung bleibt
 * lesbar, weil sie eine Abstufung ist und keine bestimmte Form.
 */

export const GAMER_CARD_FORMATE = ['story', 'quadrat', 'feed'] as const;
export type GamerCardFormat = (typeof GAMER_CARD_FORMATE)[number];

export const GAMER_CARD_MASSE: Record<GamerCardFormat, { breite: number; hoehe: number }> = {
  /** Instagram Story und Reels-Cover. */
  story: { breite: 1080, hoehe: 1920 },
  /** Quadratisch - was X, LinkedIn und Discord am liebsten nehmen. */
  quadrat: { breite: 1080, hoehe: 1080 },
  /** Instagram Feed und Carousel. */
  feed: { breite: 1080, hoehe: 1350 },
};

export function istGamerCardFormat(wert: string): wert is GamerCardFormat {
  return (GAMER_CARD_FORMATE as readonly string[]).includes(wert);
}

/**
 * Der Rhythmus je Format.
 *
 * Drei Zahlensaetze statt einer Skalierung: eine Story ist nicht ein gestrecktes
 * Quadrat. Sie hat Platz fuer mehr untereinander, und ihre Schrift darf
 * groesser sein, weil sie auf einem Telefon bildschirmfuellend laeuft.
 */
const RHYTHMUS: Record<
  GamerCardFormat,
  {
    polster: number;
    bannerHoehe: number;
    avatar: number;
    name: number;
    zeile: number;
    text: number;
    chip: number;
    qr: number;
    /**
     * Wie viele Spiele hoechstens - eine Frage des Geschmacks, nicht des Platzes.
     *
     * Wie viele *passen*, rechnet `platzAufteilen` aus. Diese Zahl deckelt
     * das Ergebnis nach oben: auf einer Story waeren acht Zeilen zwar
     * unterzubringen, aber eine Gamer Card ist keine Bibliothek. Wer alles
     * sehen will, folgt dem QR-Code.
     */
    spiele: number;
  }
> = {
  story: {
    polster: 88,
    bannerHoehe: 560,
    avatar: 260,
    name: 92,
    zeile: 40,
    text: 34,
    chip: 32,
    qr: 200,
    spiele: 4,
  },
  quadrat: {
    polster: 64,
    /*
     * Die Kopfzone des Quadrats ist die knappste.
     *
     * 1080 Pixel Hoehe muessen Kopfzone, Name, Motto, Kennzahlen, Spielliste
     * und den Fussbalken tragen. Die Zahl ist deshalb kein runder Wert,
     * sondern das Ergebnis: hoch genug, dass das Profilbild nicht an der
     * Markenzeile klebt, niedrig genug, dass unten alles hineinpasst.
     *
     * «Hineinpasst» schliesst den Abstand der Plattformreihe zum Fussbalken
     * ein. Bei 222 ging die Rechnung rechnerisch auf - die Karte war
     * vollstaendig -, aber das Fuellfeld hatte keinen Spielraum mehr und gab
     * seinen unteren Abstand her: der Chip «PC» sass auf der roten Kante.
     * Nicht abgeschnitten, und trotzdem falsch.
     *
     * Die fehlenden gut dreissig Pixel kommen zur Haelfte von hier und zur
     * Haelfte vom QR-Code darunter. Allein aus der Kopfzone genommen, rutschte
     * das Profilbild bis an die Markenzeile - der Fehler, den diese Zahl
     * gerade verhindern soll.
     */
    bannerHoehe: 206,
    avatar: 164,
    name: 66,
    zeile: 30,
    text: 26,
    chip: 25,
    /* 104 statt 120: der Code bleibt bei 1080 Pixel Bildbreite gut scanbar,
       und der Fussbalken wird um dieselben sechzehn Pixel flacher. */
    qr: 104,
    spiele: 3,
  },
  feed: {
    polster: 72,
    /*
     * 300 und nicht 340.
     *
     * Bei 340 blieb im vollen Profil zwischen der Auszeichnung und der
     * Plattformreihe eine Handbreit Leere stehen: sie reichte fuer keine
     * weitere Zeile, und die Karte zeigte von vier eingetragenen Spielen
     * genau eines. Vierzig Pixel weniger Kopfzone sind vierzig Pixel mehr
     * Inhalt - genug fuer die zweite Zeile, und die Kopfzone bleibt gross
     * genug, dass das Profilbild frei vor ihr steht.
     */
    bannerHoehe: 300,
    avatar: 210,
    name: 76,
    zeile: 34,
    text: 29,
    chip: 28,
    qr: 150,
    spiele: 3,
  },
};

/**
 * Die Abstaende der Karte - einmal benannt.
 *
 * ## Warum das nicht einfach Zahlen im Markup sind
 *
 * Weil sie zweimal gebraucht werden: beim Zeichnen und beim **Rechnen**. Wie
 * viele Spiele und Auszeichnungen auf eine Karte passen, haengt an genau
 * diesen Werten - und eine Rechnung, die eine eigene Kopie davon haelt, ist
 * die Rechnung, die nach dem naechsten Umbau danebenliegt. Wer hier eine Zahl
 * aendert, aendert beides zugleich.
 */
const ABSTAND = {
  /** Der Ring um das Profilbild. */
  avatarRing: 5,
  /** Zwischen Profilbild und Name. */
  nameOben: 26,
  /** Zwischen Name und Kennung. */
  kennungOben: 10,
  /** Zwischen Kennung und Motto. */
  mottoOben: 14,
  /** Ueber der Kennzahlenzeile. */
  kennzahlenOben: 34,
  /** Links und rechts des Trennpunkts zwischen zwei Kennzahlen. */
  punktLuft: 14,
  /** Ueber der Spielliste. */
  spieleOben: 34,
  /** Zwischen «SPIELT» und der ersten Zeile. */
  spieleTitelUnten: 16,
  /** Zwischen zwei Spielzeilen. */
  spielLuft: 10,
  /** Ueber den Auszeichnungen. */
  auszeichnungenOben: 32,
  /** Innen, ober- und unterhalb einer Auszeichnung. */
  auszeichnungPolster: 13,
  /** Zwischen zwei Auszeichnungen. */
  auszeichnungUnten: 12,
  /** Die Scheibe vor dem Namen einer Auszeichnung. */
  auszeichnungSymbol: 24,
  /** Innen, ober- und unterhalb eines Plattform-Chips. */
  chipPolster: 10,
  /** Ueber einer Chip- oder Kanalreihe. */
  chipOben: 12,
  /** Jede Linie und jeder Rahmen dieser Karte. */
  linie: 2,
} as const;

/**
 * Wie hoch eine Textzeile wird.
 *
 * Steht in der Zeichnung ein `lineHeight`, gehoert er hier als Argument hin -
 * dann bleiben die beiden beieinander. Ohne Angabe gilt 1.36, und diese Zahl
 * ist **gemessen**, nicht die CSS-Vorgabe: Satori legt das Zeilenfeld nicht
 * ueber `fontSize * 1.2`, sondern ueber die Metrik der Schrift - Oberlaenge,
 * Unterlaenge und Zeilenabstand -, und die serifenlose Standardschrift kommt
 * damit auf rund 1.36 em.
 *
 * Mit 1.2 lag die Rechnung je Zeile vier bis fuenf Pixel zu niedrig. Einzeln
 * unsichtbar, ueber ein Dutzend Zeilen aber genug, dass im Feed-Format die
 * Plattformreihe wieder auf dem Fussbalken sass. Gefunden hat das der
 * Pixeltest, nicht das Auge.
 */
function zeilenHoehe(schriftgroesse: number, hoehe = 1.36): number {
  return Math.round(schriftgroesse * hoehe);
}

/**
 * Wie viel die Rechnung daneben liegen darf.
 *
 * Satori rundet an anderen Stellen als diese Rechnung, und ein Rahmen von
 * zwei Pixeln wird bei ungeraden Werten einmal zu drei. Ein paar Pixel Reserve
 * sind hier die ehrlichere Loesung als eine Rechnung, die auf den Pixel stimmen
 * muesste - und wenn sie es doch einmal nicht tut, faellt nur eine Zeile weg,
 * die auch haette bleiben koennen. Der umgekehrte Fehler waere ein
 * abgeschnittener Fussbalken.
 */
const RESERVE = 10;

interface Aufteilung {
  /** Wie viele Spielzeilen gezeigt werden. */
  spiele: number;
  /** Wie viele Auszeichnungen gezeigt werden. */
  auszeichnungen: number;
}

/**
 * Was in den Mittelteil passt.
 *
 * ## Warum gerechnet und nicht je Format eingetragen
 *
 * Vorher standen hier zwei Zahlen pro Format: wie viele Spiele allein, und wie
 * viele, wenn auch Auszeichnungen dazukommen. Sechs geratene Werte, und keiner
 * davon kannte die Faelle, die es wirklich gibt - ein Profil ohne Motto hat
 * fuenfzig Pixel mehr, eines ohne Level eine ganze Kennzahlenleiste weniger,
 * und drei Auszeichnungen sind hoeher als drei Spiele. Auf dem quadratischen
 * Format schnitt der Fussbalken deshalb die letzte Auszeichnung durch.
 *
 * Hier wird stattdessen abgezaehlt, was die Karte an Hoehe hat und was die
 * Bloecke davon brauchen. Das Ergebnis passt sich jedem Profil an, statt den
 * unguenstigsten Fall zu raten - und es kommt ohne Messung aus, weil jede
 * Hoehe aus `ABSTAND`, `RHYTHMUS` und der Schriftgroesse folgt.
 *
 * ## Die Reihenfolge der Zugestaendnisse
 *
 * 1. **Ein Spiel** steht immer, wenn es eines gibt - eine Gamer Card ohne ein
 *    einziges Spiel waere eine Visitenkarte.
 * 2. **Die Auszeichnungen** kommen als Naechstes, so viele wie passen. Sie sind
 *    das, was eine Karte von der anderen unterscheidet.
 * 3. **Weitere Spiele** fuellen, was dann noch frei ist - bis zur Obergrenze
 *    des Formats.
 *
 * Was nicht mehr passt, faellt weg. Es wird nichts angeschnitten und nichts
 * verkleinert: eine halbe Auszeichnung ist keine.
 */
function platzAufteilen(
  format: GamerCardFormat,
  vorrat: {
    spiele: number;
    auszeichnungen: number;
    kennzahlen: number;
    plattformen: number;
    kanaele: number;
  },
  mitMotto: boolean,
): Aufteilung {
  const mass = RHYTHMUS[format];
  const { hoehe } = GAMER_CARD_MASSE[format];

  /*
   * Die Kopfzone: Banner, das darueber ragende Profilbild, Name, Motto.
   *
   * Das Bild ragt um `avatar * 0.55` in den Banner hinein - derselbe Anteil
   * wie im Markup, und deshalb steht er dort als `-Math.round(...)`.
   */
  const kopf =
    mass.bannerHoehe -
    Math.round(mass.avatar * 0.55) +
    mass.avatar +
    ABSTAND.nameOben +
    zeilenHoehe(mass.name, 1.02) +
    // Die Kennung steht immer - sie kommt aus dem Slug, und ohne Slug gaebe
    // es die Karte nicht.
    ABSTAND.kennungOben +
    zeilenHoehe(mass.text) +
    (mitMotto ? ABSTAND.mottoOben + zeilenHoehe(mass.zeile, 1.25) : 0);

  // Eine Zeile, keine Leiste: kein Rahmen, kein Innenpolster, nur Text.
  const kennzahlen = vorrat.kennzahlen > 0 ? ABSTAND.kennzahlenOben + zeilenHoehe(mass.text) : 0;

  const plattformen =
    vorrat.plattformen > 0
      ? ABSTAND.chipOben +
        2 * ABSTAND.chipPolster +
        2 * ABSTAND.linie +
        zeilenHoehe(Math.round(mass.chip * 0.86))
      : 0;

  // Die Kanaele sind blosse Textzeilen - kein Rahmen, kein Polster.
  const kanaele = vorrat.kanaele > 0 ? ABSTAND.chipOben + zeilenHoehe(Math.round(mass.chip * 0.86)) : 0;

  const spielKopf = ABSTAND.spieleOben + zeilenHoehe(Math.round(mass.text * 0.72)) + ABSTAND.spieleTitelUnten;
  /*
   * Die erste Spielzeile ist groesser als die uebrigen - sie traegt die
   * Hervorhebung, die vorher die Ziffer «01» trug. Gerechnet wird mit der
   * groesseren: eine Rechnung, die den Normalfall nimmt und den Sonderfall
   * vergisst, liegt genau dann daneben, wenn es knapp wird.
   */
  const ersteSpielZeile = zeilenHoehe(Math.round(mass.chip * 1.12));
  const spielZeile = ABSTAND.spielLuft + zeilenHoehe(mass.chip);
  const ausZeile =
    2 * ABSTAND.auszeichnungPolster +
    2 * ABSTAND.linie +
    Math.max(ABSTAND.auszeichnungSymbol + 2 * ABSTAND.linie, zeilenHoehe(Math.round(mass.text * 0.92))) +
    ABSTAND.auszeichnungUnten;

  let rest =
    hoehe -
    kopf -
    kennzahlen -
    kanaele -
    plattformen -
    gamerCardFussHoehe(format) -
    GAMER_CARD_FUSS_LUFT -
    RESERVE;

  const ergebnis: Aufteilung = { spiele: 0, auszeichnungen: 0 };

  if (vorrat.spiele > 0 && rest >= spielKopf + ersteSpielZeile) {
    rest -= spielKopf + ersteSpielZeile;
    ergebnis.spiele = 1;
  }

  if (vorrat.auszeichnungen > 0 && rest >= ABSTAND.auszeichnungenOben + ausZeile) {
    rest -= ABSTAND.auszeichnungenOben;
    while (ergebnis.auszeichnungen < vorrat.auszeichnungen && rest >= ausZeile) {
      rest -= ausZeile;
      ergebnis.auszeichnungen++;
    }
  }

  while (ergebnis.spiele < Math.min(vorrat.spiele, mass.spiele) && rest >= spielZeile) {
    rest -= spielZeile;
    ergebnis.spiele++;
  }

  return ergebnis;
}

/**
 * Der Abstand der Plattformreihe zum Fussbalken.
 *
 * Er ist die Luft, die eine Karte von einer Karte mit einem Fehler
 * unterscheidet: ohne ihn sitzt der letzte Chip auf der roten Kante. Weil er
 * das **Erste** ist, was ein zu enges Format hergibt - das Fuellfeld darf
 * schrumpfen, damit der Fussbalken bleibt -, ist er zugleich der Messwert, an
 * dem sich ein zu enges Format erkennen laesst. Der Test in
 * `profil-gamer-card` misst ihn an den Pixeln nach.
 */
export const GAMER_CARD_FUSS_LUFT = 22;

/**
 * Die Hoehe des Fussbalkens.
 *
 * Der QR-Code bestimmt sie, plus ein fester Rand. Vorher war der Rand ein
 * Anteil des Polsters, und auf dem quadratischen Format wurde der Balken
 * dadurch so hoch, dass der Inhalt darueber unten aus der Karte lief. Eine
 * feste Zahl ist hier die ehrlichere: der Balken haelt einen QR-Code und
 * zwei Zeilen, und das ist in jedem Format dieselbe Aufgabe.
 *
 * Exportiert, weil der Test ihn braucht: er misst am fertigen PNG nach, wie
 * hoch das Akzentband unten tatsaechlich ist. Eine zweite Zahl im Test waere
 * eine, die beim naechsten Umbau stehen bleibt.
 */
export function gamerCardFussHoehe(format: GamerCardFormat): number {
  return RHYTHMUS[format].qr + 44;
}

// --- Farben ------------------------------------------------------------------
//
// Fest und nicht aus den Design-Tokens: die Tokens sind CSS-Variablen, und
// Satori kennt keine. Die Werte sind dieselben - `--swisshub-rot` ist #83060a.

const SCHWARZ = '#07070a';
const WEISS = '#f6f3f3';
const GEDAEMPFT = '#a89c9d';

/**
 * Ein HSL-Tripel in eine Farbe, die Satori sicher versteht.
 *
 * Aus `358 79% 52%` wird `hsl(358, 79%, 52%)`. Die Kommaform ist die alte und
 * die verlaesslichere; die Leerzeichen-Syntax gilt hier nicht als gesichert,
 * und eine Farbe, die nicht gelesen wird, ergibt schwarzen Text auf schwarzem
 * Grund - nicht einen Fehler, den man sieht.
 *
 * Ein Wert, der nicht nach einem Tripel aussieht, wird **nicht** geraten:
 * dann gilt die Rueckfallfarbe. Die Variablen kommen aus der Registry, nie aus
 * der Datenbank - aber diese Funktion muss das nicht voraussetzen.
 */
export function hslFarbe(tripel: string | undefined, rueckfall: string): string {
  if (!tripel) {
    return rueckfall;
  }
  const teile = tripel.trim().split(/\s+/u);
  if (teile.length !== 3) {
    return rueckfall;
  }
  const [h, s, l] = teile;
  if (!/^-?[\d.]+$/u.test(h ?? '') || !/^[\d.]+%$/u.test(s ?? '') || !/^[\d.]+%$/u.test(l ?? '')) {
    return rueckfall;
  }
  return `hsl(${h}, ${s}, ${l})`;
}

export interface GamerCardEingabe {
  format: GamerCardFormat;
  profil: profile.OeffentlichesProfil;
  /** Die vollstaendige oeffentliche Adresse - sie steht auf der Karte. */
  adresse: string;
  /**
   * Das Profilbild als Daten-URI.
   *
   * Als Parameter und nicht aus dem Profil gelesen: die Route holt es selbst
   * und reicht es herein, weil Satori sonst waehrend des Zeichnens einen
   * Netzaufruf macht - und ein langsames CDN waere ein Export, der ins
   * Zeitlimit laeuft.
   */
  bildQuelle: string | null;
  /** Das Banner, ebenso. `null` = nur der Verlauf des Themes. */
  bannerQuelle: string | null;
  /** Der QR-Code als Daten-URI, wenn er mit aufs Bild soll. */
  qrQuelle: string | null;
}

/**
 * Die Karte.
 *
 * ## Der Aufbau, von oben nach unten
 *
 * Kopfzone mit Bannerbild oder Themeverlauf und der Marke; darin, auf die
 * Unterkante gesetzt, das Profilbild. Darunter Name und Motto, eine Zeile mit
 * Kennzahlen, die Spielliste, die Auszeichnungen. Ganz unten ein Balken in der
 * Akzentfarbe mit Adresse und QR-Code.
 *
 * ## Was am alten Aufbau nicht stimmte
 *
 * Er war oben schwer und unten leer. Alles sass im oberen Drittel, und auf dem
 * Story-Format blieben darunter achthundert Pixel Schwarz - eine Karte, die
 * aussah, als waere das Laden abgebrochen. Drei Ursachen, und alle drei sind
 * behoben:
 *
 *  - **Die Bloecke standen einfach untereinander.** Jetzt traegt der Raum
 *    zwischen Inhalt und Fuss ein `flexGrow`-Feld, und die Kopfzone waechst
 *    mit dem Format. Was uebrig bleibt, ist Luft mit Absicht und kein Loch.
 *  - **Spiele waren gleich laute rote Pillen.** Drei nebeneinander, alle
 *    gleich wichtig - das Auge fand keinen Anfang. Jetzt eine nummerierte
 *    Liste: der erste Eintrag traegt die Akzentfarbe, die uebrigen sind ruhig.
 *    Eine Rangfolge ist ausserdem eine Auskunft; drei Pillen waren keine.
 *  - **Es gab nichts zu lesen ausser dem Namen.** Die Kennzahlenzeile nimmt,
 *    was ohnehin dasteht - Level, Zahl der Spiele, Zahl der Auszeichnungen -
 *    und macht daraus den Teil, der eine Gamer Card von einer Visitenkarte
 *    unterscheidet.
 *
 * ## Deterministisch, und das ist keine Nebenbemerkung
 *
 * Auf dieser Karte steht ausschliesslich, was im Profil steht. Kein Text wird
 * erfunden, kein Bild erzeugt, nichts von einem Modell ergaenzt. Dieselbe
 * Person mit demselben Profil bekommt heute und in einem Jahr Pixel fuer Pixel
 * dieselbe Karte - es gibt in dieser Datei keine Zufallsquelle und keinen
 * Aufruf nach aussen. Wer etwas anderes auf der Karte haben will, aendert sein
 * Profil.
 *
 * Das ist auch der Grund, warum eine duenne Karte duenn bleiben darf: ein
 * Profil ohne Spiele bekommt keine erfundenen. Es bekommt eine Karte mit
 * Namen, Motto und Adresse - und die Kennzahlenzeile faellt weg, statt mit
 * Nullen dazustehen.
 */
export function zeichneGamerCard(eingabe: GamerCardEingabe): React.ReactElement {
  const { format, profil, adresse, bildQuelle, bannerQuelle, qrQuelle } = eingabe;
  const { breite, hoehe } = GAMER_CARD_MASSE[format];
  const mass = RHYTHMUS[format];

  const akzent = hslFarbe(profil.gestaltung.variablen['--profil-akzent'], '#e63a41');
  const flaeche = hslFarbe(profil.gestaltung.variablen['--profil-flaeche'], '#15141a');
  const rand = hslFarbe(profil.gestaltung.variablen['--profil-rand'], '#2b2830');

  const name = profil.identitaet.profilname ?? profil.identitaet.name;
  const motto = profil.angaben?.tagline ?? null;
  const alleSpiele = profil.spiele ?? [];
  const plattformen = (profil.angaben?.plattformen ?? []).slice(0, 3);
  /*
   * Die Kanaele - woanders zu finden.
   *
   * Sie standen bisher nicht auf der Karte, obwohl das Profil sie fuehrt und
   * sie auf der oeffentlichen Seite sichtbar sind. Eine Visitenkarte ohne den
   * Weg zum Kanal ist eine halbe.
   *
   * `socials` fehlt im DTO, wenn die Besitzerin den Abschnitt nicht
   * oeffentlich gestellt hat - der Dienst laesst das Feld dann weg, und hier
   * wird nichts geprueft, was dort schon entschieden ist. Hoechstens drei,
   * weil eine vierte Zeile die Karte wieder fuellt, statt sie zu beruhigen.
   */
  const kanaele = (profil.socials ?? []).slice(0, 3).map((eintrag) => eintrag.handle);
  const level = profil.level;

  /*
   * Die Kennzahlen - nur die, die es gibt.
   *
   * Ein Profil ohne sichtbares Level bekommt keine Zeile «Level -», und eines
   * ohne Spiele keine «0 Spiele». Eine Null ist eine Behauptung ueber jemanden,
   * und auf einer Karte, die geteilt wird, die unfreundlichste.
   */
  const kennzahlen: Array<{ wert: string; label: string; hervor: boolean }> = [];
  if (level) {
    kennzahlen.push({
      wert: String(level.level),
      label: level.hoechstlevel ? 'Prestige' : 'Level',
      hervor: true,
    });
  }
  if (alleSpiele.length > 0) {
    kennzahlen.push({
      wert: String(alleSpiele.length),
      label: alleSpiele.length === 1 ? 'Spiel' : 'Spiele',
      hervor: false,
    });
  }
  if (profil.hervorgehobene.length > 0) {
    kennzahlen.push({
      wert: String(profil.hervorgehobene.length),
      label: profil.hervorgehobene.length === 1 ? 'Auszeichnung' : 'Auszeichnungen',
      hervor: false,
    });
  }

  /*
   * Und erst jetzt, mit allem Bekannten: was passt hinein?
   *
   * Die Kennzahlenleiste steht schon fest - sie ist schmal und gehoert zum
   * Kopf -, also kann die Aufteilung sie mitzaehlen. Was sie zurueckgibt, sind
   * die Zahlen, mit denen weiter unten geschnitten wird. Die Zahl der Spiele
   * in den Kennzahlen bleibt davon unberuehrt: dort steht, wie viele jemand
   * eingetragen hat, nicht wie viele auf die Karte passten.
   */
  const aufteilung = platzAufteilen(
    format,
    {
      spiele: alleSpiele.length,
      auszeichnungen: profil.hervorgehobene.length,
      kennzahlen: kennzahlen.length,
      plattformen: plattformen.length,
      kanaele: kanaele.length,
    },
    motto !== null,
  );
  const auszeichnungen = profil.hervorgehobene.slice(0, aufteilung.auszeichnungen);
  const spiele = alleSpiele.slice(0, aufteilung.spiele).map((spiel) => spiel.name);

  const fussHoehe = gamerCardFussHoehe(format);
  /** Was zwischen den Polstern uebrig bleibt - die Breite fuer jede Zeile. */
  const innenBreite = breite - 2 * mass.polster;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: breite,
        height: hoehe,
        backgroundColor: SCHWARZ,
        color: WEISS,
        fontFamily: 'sans-serif',
        position: 'relative',
      }}
    >
      {/* --- Kopfzone: Banner oder Verlauf --- */}
      <div
        style={{
          display: 'flex',
          position: 'relative',
          width: breite,
          height: mass.bannerHoehe,
          backgroundImage: profil.gestaltung.bannerVerlauf,
          backgroundColor: flaeche,
        }}
      >
        {bannerQuelle ? (
          /* eslint-disable-next-line @next/next/no-img-element -- Satori kennt
             `next/image` nicht; hier wird ein PNG gezeichnet, keine Seite. */
          <img
            src={bannerQuelle}
            alt=""
            width={breite}
            height={mass.bannerHoehe}
            style={{ width: breite, height: mass.bannerHoehe, objectFit: 'cover' }}
          />
        ) : null}

        {/*
          Ein Band in der Akzentfarbe, schraeg ueber die Kopfzone.

          Der einzige rein gestalterische Teil der Karte - und der Grund, warum
          sie auch ohne Bannerbild nicht leer wirkt. `transform: rotate` kann
          Satori; ein `clip-path` koennte es nicht, und `skew` ist unsicher.
          Deshalb ein gedrehtes Rechteck, breiter als die Karte, damit die
          Schnittkanten ausserhalb liegen.
        */}
        <div
          style={{
            display: 'flex',
            position: 'absolute',
            left: -Math.round(breite * 0.2),
            top: Math.round(mass.bannerHoehe * 0.58),
            width: Math.round(breite * 1.5),
            height: Math.round(mass.bannerHoehe * 0.1),
            backgroundImage: `linear-gradient(to right, ${akzent} 0%, rgba(0,0,0,0) 85%)`,
            opacity: 0.55,
            transform: 'rotate(-7deg)',
          }}
        />

        {/* Der Uebergang zur Flaeche - ohne ihn steht dort eine Kante. */}
        <div
          style={{
            display: 'flex',
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: Math.round(mass.bannerHoehe * 0.7),
            backgroundImage: `linear-gradient(to bottom, rgba(7,7,10,0) 0%, ${SCHWARZ} 100%)`,
          }}
        />

        {/*
          Die Marke, oben in der Mitte.

          Sie stand links, und das war der letzte Rest der alten, linksbuendigen
          Karte: eine Komposition auf der Mittelachse mit einer Zeile, die an
          der linken Kante klebt, sieht aus wie zwei Entwuerfe uebereinander.
        */}
        <div
          style={{
            display: 'flex',
            position: 'absolute',
            top: mass.polster,
            left: 0,
            right: 0,
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <div
            style={{ display: 'flex', width: 14, height: 14, borderRadius: 999, backgroundColor: akzent }}
          />
          {/* Grossschreibung in JavaScript: `text-transform` laesst Satori
              scheitern, und dann kommt eine leere Datei heraus. */}
          <div
            style={{
              display: 'flex',
              marginLeft: 16,
              fontSize: Math.round(mass.text * 0.78),
              letterSpacing: 5,
              color: WEISS,
            }}
          >
            {'SwissHub Gamer Card'.toUpperCase()}
          </div>
        </div>
      </div>

      {/* --- Kopf: Bild, Name, Kennung, Motto - auf der Mittelachse --- */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          paddingLeft: mass.polster,
          paddingRight: mass.polster,
          marginTop: -Math.round(mass.avatar * 0.55),
        }}
      >
        <div
          style={{
            display: 'flex',
            width: mass.avatar,
            height: mass.avatar,
            // Rund statt abgerundetes Quadrat: ein Kreis hat keine Richtung
            // und sitzt damit auf einer Mittelachse ruhiger als eine Form,
            // deren Ecken nach aussen zeigen.
            borderRadius: 999,
            border: `${ABSTAND.avatarRing}px solid ${akzent}`,
            backgroundColor: flaeche,
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          {bildQuelle ? (
            /* eslint-disable-next-line @next/next/no-img-element -- siehe oben */
            <img
              src={bildQuelle}
              alt=""
              width={mass.avatar}
              height={mass.avatar}
              style={{ width: mass.avatar, height: mass.avatar, objectFit: 'cover' }}
            />
          ) : (
            /*
             * Ohne Profilbild die Anfangsbuchstaben.
             *
             * Besser als ein Platzhalterbild, das aussieht wie ein Ladefehler.
             */
            <div
              style={{
                display: 'flex',
                fontSize: Math.round(mass.avatar * 0.38),
                fontWeight: 700,
                color: GEDAEMPFT,
              }}
            >
              {initialen(name)}
            </div>
          )}
        </div>

        {/*
          Name, Kennung und Motto stehen einzeilig - und zwar doppelt gesichert.

          Die Zeichengrenze kommt aus Breite und Schriftgroesse
          (`zeilenGrenze`), und `whiteSpace: nowrap` steht als Riegel dahinter:
          selbst ein Name aus lauter breiten Zeichen bleibt einzeilig. Er wird
          dann am Rand beschnitten statt umgebrochen - unschoen, aber lokal,
          waehrend ein Umbruch die ganze Karte nach unten schiebt und unten
          eine Zeile abschneidet, die niemand mit dem Namen in Verbindung
          bringt.
        */}
        <div
          style={{
            display: 'flex',
            marginTop: ABSTAND.nameOben,
            fontSize: mass.name,
            fontWeight: 700,
            lineHeight: 1.02,
            letterSpacing: -1,
            color: WEISS,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
          }}
        >
          {kuerze(name, zeilenGrenze(innenBreite, mass.name))}
        </div>

        {/*
          Die Kennung - das, was man eintippt.

          Sie stand bisher nur klein im Fussbalken als Teil der Adresse. Wer
          die Karte sieht, soll aber wissen, wie die Person heisst **und** wie
          man sie findet; der QR-Code ist dafuer der bequeme Weg, nicht der
          einzige.
        */}
        <div
          style={{
            display: 'flex',
            marginTop: ABSTAND.kennungOben,
            fontSize: mass.text,
            letterSpacing: 1,
            color: akzent,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
          }}
        >
          {`@${kuerze(profil.slug, zeilenGrenze(innenBreite, mass.text))}`}
        </div>

        {motto ? (
          <div
            style={{
              display: 'flex',
              marginTop: ABSTAND.mottoOben,
              fontSize: mass.zeile,
              color: GEDAEMPFT,
              lineHeight: 1.25,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
            }}
          >
            {kuerze(motto, zeilenGrenze(innenBreite, mass.zeile))}
          </div>
        ) : null}
      </div>

      {/*
        Der Mittelteil - und der Riegel gegen eine Karte ohne Abschluss.

        `flexShrink: 1` und `overflow: hidden`: Satori bricht nicht um und
        schrumpft von sich aus nichts. Was nicht passt, liefe sonst unten aus
        der Karte, und zwar zusammen mit dem Fussbalken - eine Gamer Card ohne
        Adresse und ohne QR-Code.

        Die Budgets aus `platzAufteilen` sind so gesetzt, dass es nicht dazu
        kommt. Diese zwei Zeilen sind die Zusicherung fuer den Fall, dass sich
        eine Schriftgroesse, ein Sprachumbruch oder ein neues Feld einmal
        anders verhaelt als gerechnet: dann fehlt eine Zeile, aber die Karte
        ist vollstaendig.
      */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          flexGrow: 1,
          flexShrink: 1,
          overflow: 'hidden',
          paddingLeft: mass.polster,
          paddingRight: mass.polster,
        }}
      >
        {/*
          Die Kennzahlen - eine Zeile statt dreier Kaesten.

          Vorher stand hier ein Streifen mit Linie oben, Linie unten und zwei
          senkrechten Trennern dazwischen: fuenf Striche fuer drei Zahlen. Die
          Karte sah dadurch aus wie eine Tabelle, und die Zahlen wirkten
          wichtiger als der Name darueber.

          Jetzt eine Zeile auf der Mittelachse, getrennt durch Punkte. Gezeigt
          wird weiterhin nur, was es gibt: ein Profil ohne Level bekommt keine
          Zeile «Level -» und eines ohne Spiele keine «0 Spiele». Eine Null ist
          eine Behauptung ueber jemanden, und auf einer Karte, die geteilt
          wird, die unfreundlichste.
        */}
        {kennzahlen.length > 0 ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              marginTop: ABSTAND.kennzahlenOben,
            }}
          >
            {kennzahlen.map((zahl, index) => (
              <div key={zahl.label} style={{ display: 'flex', alignItems: 'center' }}>
                {index > 0 ? (
                  <div
                    style={{
                      display: 'flex',
                      marginLeft: ABSTAND.punktLuft,
                      marginRight: ABSTAND.punktLuft,
                      fontSize: mass.text,
                      color: rand,
                    }}
                  >
                    ·
                  </div>
                ) : null}
                <div
                  style={{
                    display: 'flex',
                    fontSize: mass.text,
                    fontWeight: 700,
                    color: zahl.hervor ? akzent : WEISS,
                  }}
                >
                  {zahl.wert}
                </div>
                <div
                  style={{
                    display: 'flex',
                    marginLeft: 10,
                    fontSize: Math.round(mass.text * 0.78),
                    letterSpacing: 2,
                    color: GEDAEMPFT,
                  }}
                >
                  {zahl.label.toUpperCase()}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {/*
          Die Spiele - Namen auf der Achse, ohne Rahmen und ohne Nummern.

          Die Rangliste mit «01», «02» und einer Trennlinie je Zeile war der
          zweite Grund fuer die Tabellenwirkung. Die Reihenfolge steht
          weiterhin fest - die erste Zeile ist die, die jemand zuerst nennt -,
          und sie ist an der Hervorhebung zu erkennen statt an einer Ziffer.
        */}
        {spiele.length > 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              marginTop: ABSTAND.spieleOben,
            }}
          >
            <div
              style={{
                display: 'flex',
                fontSize: Math.round(mass.text * 0.72),
                letterSpacing: 4,
                color: rand,
                marginBottom: ABSTAND.spieleTitelUnten,
              }}
            >
              {'Spielt'.toUpperCase()}
            </div>
            {spiele.map((spiel, index) => (
              <div
                key={`spiel-${spiel}`}
                style={{
                  display: 'flex',
                  marginTop: index === 0 ? 0 : ABSTAND.spielLuft,
                  fontSize: index === 0 ? Math.round(mass.chip * 1.12) : mass.chip,
                  fontWeight: index === 0 ? 700 : 500,
                  color: index === 0 ? WEISS : GEDAEMPFT,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                }}
              >
                {kuerze(spiel, zeilenGrenze(innenBreite, mass.chip))}
              </div>
            ))}
          </div>
        ) : null}

        {/*
          Die Auszeichnungen - hier bleibt der Rahmen, und zwar absichtlich.

          Er ist die einzige Umrandung, die etwas sagt: Form, Marke und Wort
          tragen zusammen die Stufe, und zwar unabhaengig von der Farbe. Etwa
          jeder zwoelfte Mann unterscheidet Rot und Gruen schlecht; Braun, Grau
          und Gelb nebeneinander sind fuer einen Teil davon drei Grautoene. Sie
          hier zu Textzeilen zu glaetten waere ruhiger und zugleich weniger
          lesbar - und «ruhig» ist kein Grund, eine Auskunft wegzulassen.

          Ruhiger geworden ist das Mass: die Zeilen sind schmaler als die Karte
          und sitzen auf der Achse, statt von Rand zu Rand zu laufen.
        */}
        {auszeichnungen.length > 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              marginTop: ABSTAND.auszeichnungenOben,
            }}
          >
            {auszeichnungen.map((eintrag, index) => {
              const stufenbild = stufe(eintrag.stufe);
              return (
                <div
                  key={eintrag.key}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    marginTop: index === 0 ? 0 : ABSTAND.auszeichnungUnten,
                    paddingTop: ABSTAND.auszeichnungPolster,
                    paddingBottom: ABSTAND.auszeichnungPolster,
                    paddingLeft: 22,
                    paddingRight: 22,
                    /* Die Ecke traegt die Stufe mit: Gold kantig, Bronze weich. */
                    borderRadius: stufenbild.bild.radius,
                    backgroundImage: stufenbild.bild.flaeche,
                    border: `${ABSTAND.linie}px solid ${stufenbild.bild.rand}`,
                  }}
                >
                  {/* Das Symbolfeld - auf der Seite ein eingepraegtes Feld, hier
                    eine Scheibe in der Farbe der Stufe. Gold bekommt einen
                    Ring, damit es auch in Graustufen die aufwendigste bleibt. */}
                  <div
                    style={{
                      display: 'flex',
                      width: ABSTAND.auszeichnungSymbol,
                      height: ABSTAND.auszeichnungSymbol,
                      borderRadius: 999,
                      backgroundColor: stufenbild.bild.feld,
                      border:
                        eintrag.stufe === 'gold'
                          ? `${ABSTAND.linie}px solid ${stufenbild.bild.schrift}`
                          : `${ABSTAND.linie}px solid ${stufenbild.bild.rand}`,
                      marginRight: 16,
                    }}
                  />
                  <div
                    style={{
                      display: 'flex',
                      fontSize: Math.round(mass.text * 0.92),
                      fontWeight: 600,
                      color: WEISS,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                    }}
                  >
                    {kuerze(eintrag.label, 24)}
                  </div>

                  {/* Die Marke: ein bis drei Striche. Das einzige Merkmal, das
                    keine Farbe ist - und damit das einzige, das auch auf einem
                    Ausdruck in Graustufen noch die Stufe sagt. */}
                  <div style={{ display: 'flex', alignItems: 'center', marginLeft: 20, gap: 4 }}>
                    {Array.from({ length: stufenbild.striche }, (_, strich) => (
                      <div
                        key={strich}
                        style={{
                          display: 'flex',
                          width: 4,
                          height: 14 + stufenbild.striche * 2,
                          borderRadius: 999,
                          backgroundColor: stufenbild.bild.schrift,
                        }}
                      />
                    ))}
                    <div
                      style={{
                        display: 'flex',
                        marginLeft: 10,
                        fontSize: Math.round(mass.text * 0.72),
                        letterSpacing: 2,
                        color: stufenbild.bild.schrift,
                      }}
                    >
                      {stufenbild.label.toUpperCase()}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}

        {/*
          Das Feld, das den Rest fuellt.

          Es ist die Antwort auf die leere untere Haelfte: was an Hoehe uebrig
          bleibt, sammelt sich hier, und der Fussbalken sitzt dadurch immer
          unten - bei einem vollen Profil ebenso wie bei einem duennen.

          Darin stehen die Kanaele und die Plattformen, beide auf der Achse.
          Die Kanaele sind das, womit jemand ausserhalb von SwissHub zu finden
          ist; sie standen bisher gar nicht auf der Karte, obwohl das Profil
          sie fuehrt.
        */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'flex-end',
            flexGrow: 1,
            paddingBottom: GAMER_CARD_FUSS_LUFT,
          }}
        >
          {kanaele.length > 0 ? (
            <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap' }}>
              {kanaele.map((kanal) => (
                <div
                  key={`kanal-${kanal}`}
                  style={{
                    display: 'flex',
                    marginLeft: 7,
                    marginRight: 7,
                    marginTop: ABSTAND.chipOben,
                    fontSize: Math.round(mass.chip * 0.86),
                    color: GEDAEMPFT,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {kanal}
                </div>
              ))}
            </div>
          ) : null}

          {plattformen.length > 0 ? (
            <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap' }}>
              {plattformen.map((plattform) => (
                <div
                  key={`plattform-${plattform}`}
                  style={{
                    display: 'flex',
                    marginLeft: 6,
                    marginRight: 6,
                    marginTop: ABSTAND.chipOben,
                    paddingLeft: 20,
                    paddingRight: 20,
                    paddingTop: ABSTAND.chipPolster,
                    paddingBottom: ABSTAND.chipPolster,
                    borderRadius: 999,
                    border: `${ABSTAND.linie}px solid ${rand}`,
                    fontSize: Math.round(mass.chip * 0.86),
                    letterSpacing: 2,
                    color: GEDAEMPFT,
                  }}
                >
                  {plattform.toUpperCase()}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {/*
        --- Fussbalken: Adresse und QR ---

        Die beiden stehen als **Gruppe** in der Mitte statt an den
        Aussenkanten. Mathematisch zentriert waere jedes fuer sich; das sieht
        auf einem Balken wie zwei getrennte Dinge aus. Zusammen gelesen sind
        sie eine Sache: hier steht die Adresse, und hier ist der bequeme Weg
        dorthin.
      */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: fussHoehe,
          // Er schrumpft nicht mit: er ist das, was bleiben muss.
          flexShrink: 0,
          paddingLeft: mass.polster,
          paddingRight: mass.polster,
          backgroundColor: akzent,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div
            style={{
              display: 'flex',
              fontSize: Math.round(mass.text * 0.7),
              letterSpacing: 4,
              color: 'rgba(0,0,0,0.6)',
            }}
          >
            {'Profil ansehen'.toUpperCase()}
          </div>
          <div
            style={{
              display: 'flex',
              marginTop: 10,
              fontSize: mass.zeile,
              fontWeight: 700,
              color: SCHWARZ,
              whiteSpace: 'nowrap',
            }}
          >
            {ohneSchema(adresse)}
          </div>
        </div>

        {qrQuelle ? (
          <div
            style={{
              display: 'flex',
              width: mass.qr,
              height: mass.qr,
              marginLeft: 28,
              padding: 12,
              borderRadius: 20,
              backgroundColor: WEISS,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- siehe oben */}
            <img
              src={qrQuelle}
              alt=""
              width={mass.qr - 24}
              height={mass.qr - 24}
              style={{ width: mass.qr - 24, height: mass.qr - 24 }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Satori bricht nicht um - zu lange Texte muessen vorher enden. */
function kuerze(wert: string, grenze: number): string {
  return wert.length <= grenze ? wert : `${wert.slice(0, grenze - 1)}…`;
}

/**
 * Die mittlere Zeichenbreite als Anteil der Schriftgroesse.
 *
 * Gemessen an den gerenderten Karten, nicht geschaetzt: die serifenlose
 * Standardschrift kommt in deutschen Namen auf rund 0,5 em je Zeichen. 0,55
 * laesst Luft nach oben - genug fuer einen Namen mit vielen breiten Buchstaben,
 * ohne dass eine Zeile dadurch halb leer bliebe.
 *
 * Genau messen koennte man hier nicht: Satori kennt die Schriftmasse, diese
 * Datei nicht. Deshalb eine Schaetzung mit Reserve **und** `whiteSpace:
 * nowrap` als Riegel dahinter - die Schaetzung sorgt fuer die Auslassung an
 * der richtigen Stelle, der Riegel dafuer, dass es in jedem Fall eine Zeile
 * bleibt.
 */
const MITTLERE_ZEICHENBREITE = 0.55;

/** Wie viele Zeichen dieser Schriftgroesse in eine Zeile dieser Breite passen. */
function zeilenGrenze(breite: number, schriftgroesse: number): number {
  return Math.max(8, Math.floor(breite / (schriftgroesse * MITTLERE_ZEICHENBREITE)));
}

/**
 * Die Anfangsbuchstaben eines Namens.
 *
 * `Array.from` und nicht `slice`: ein Name, der mit einem Emoji beginnt, besteht
 * aus mehreren Code-Einheiten, und `slice(0, 2)` schnitte mitten hinein - heraus
 * kaeme ein Ersatzzeichen.
 */
function initialen(name: string): string {
  const zeichen = Array.from(name.trim());
  return zeichen.slice(0, 2).join('').toUpperCase() || '?';
}

/** `https://system.swisshub.gg/u/manu` → `system.swisshub.gg/u/manu`. */
function ohneSchema(adresse: string): string {
  return kuerze(adresse.replace(/^https?:\/\//u, ''), 34);
}

/** Der Dateiname des Downloads. */
export function gamerCardDateiname(name: string, format: GamerCardFormat): string {
  const sauber = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 40);
  return `swisshub-gamer-card-${sauber || 'profil'}-${format}.png`;
}
