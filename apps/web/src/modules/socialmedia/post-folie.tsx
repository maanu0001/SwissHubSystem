import type { socialmedia } from '@swisshub/modules';

/**
 * Die Zeichenquelle des Post Creators - **die einzige** (§38).
 *
 * ## Warum das der Kern der Aufgabe ist
 *
 * Die Vorgabe ist unmissverstaendlich: was im Preview sichtbar ist, muss im
 * Export gleich aussehen, und eine zweite Preview-Implementierung darf es
 * nicht geben. Beides ist hier nicht Disziplin, sondern Bauart - die Vorschau
 * im Editor ist ein `<img>` auf dieselbe Route, die auch die Datei liefert.
 * Es gibt keinen zweiten Weg zu einem Bild, also kann es keinen Unterschied
 * geben.
 *
 * Gerendert wird mit `next/og` (Satori), wie «SwissHub fragt» und Wrapped.
 * Kein Puppeteer, kein Screenshot: die Pipeline steht, laeuft im Docker-Bild
 * und liefert exakte Pixelmasse (§47).
 *
 * ## Was Satori nicht kann
 *
 * Kein `clip-path`, kein `text-transform`, kein gestreutes `box-shadow`, keine
 * CSS-Variablen, kein `background-image` mit Gradient-Funktionen in allen
 * Faellen. Die Geometrie unten ist deshalb aus Rechtecken, Raendern und
 * Drehungen gebaut, und Grossschreibung passiert in JavaScript. Wer hier CSS
 * ergaenzt, das ein Browser versteht, bekommt im PNG ein leeres Kaestchen -
 * und das faellt erst beim Export auf.
 *
 * ## Die beiden Achsen
 *
 * `DESIGN` ist das Geruest (wo was liegt), `BLOCK` ist der Inhalt (was in der
 * Mitte steht). Sechs Geruste und sieben Bloecke statt achtundsiebzig
 * handgebauter Kompositionen - und trotzdem echte Layoutunterschiede, nicht
 * nur andere Farben: `clean` setzt links auf hellem Grund, `bold` laesst die
 * Ueberschrift randlos laufen, `minimal` zentriert in viel Leere,
 * `tournament` baut Kopfband und Faktenstreifen, `dark` stellt eine
 * Bildbahn an den Rand, `spotlight` legt ein Namensschild ueber ein rundes
 * Motiv.
 *
 * ## Die Formate passen das Layout an, sie strecken es nicht (§46)
 *
 * `Buehne` traegt je Format eigene Raender, eine eigene Typoskala und die
 * Angabe, ob hoch gebaut werden darf. Die Story bekommt dadurch Luft und
 * mehr Stufen, das Quadrat ruecken die Zonen zusammen. Ein einziges Layout
 * auf drei Hoehen gezogen waere das, was die Vorgabe ausschliesst.
 */

type PostFormat = socialmedia.PostFormat;
type PostDesign = socialmedia.PostDesign;
type PostInhalt = socialmedia.PostInhalt;
type InhaltsBlock = socialmedia.InhaltsBlock;
type PostBaum = socialmedia.PostBaum;

// --- Farben ------------------------------------------------------------------
//
// Feste Werte und keine Design-Tokens: die Tokens sind CSS-Variablen, und
// Satori kennt keine. `#83060a` ist dasselbe SwissHub-Rot wie in «SwissHub
// fragt» und im Discord-Embed.

export const POST_AKZENT = '#83060a';
export const POST_AKZENT_HELL = '#b81219';

const SCHWARZ = '#0a0a0b';
const TIEF = '#16161a';
const WEISS = '#ffffff';
const PAPIER = '#f5f5f6';
const TINTE = '#121214';

interface Farben {
  grund: string;
  /** Die zweite Flaeche - Karten, Baender, Kaesten. */
  flaeche: string;
  schrift: string;
  gedaempft: string;
  leise: string;
  linie: string;
  akzent: string;
  akzentHell: string;
  /** Schrift auf der Akzentflaeche. */
  aufAkzent: string;
}

function farbenFuer(design: PostDesign, akzent: string, akzentHell: string): Farben {
  const dunkel = design === 'bold' || design === 'tournament' || design === 'dark' || design === 'spotlight';
  return dunkel
    ? {
        grund: design === 'dark' || design === 'spotlight' ? SCHWARZ : TIEF,
        flaeche: 'rgba(255,255,255,0.06)',
        schrift: WEISS,
        gedaempft: 'rgba(255,255,255,0.64)',
        leise: 'rgba(255,255,255,0.34)',
        linie: 'rgba(255,255,255,0.12)',
        akzent,
        akzentHell,
        aufAkzent: WEISS,
      }
    : {
        grund: design === 'minimal' ? WEISS : PAPIER,
        flaeche: 'rgba(0,0,0,0.04)',
        schrift: TINTE,
        gedaempft: 'rgba(18,18,20,0.62)',
        leise: 'rgba(18,18,20,0.34)',
        linie: 'rgba(18,18,20,0.12)',
        akzent,
        akzentHell: akzent,
        aufAkzent: WEISS,
      };
}

// --- Buehne ------------------------------------------------------------------

export const POST_MASSE: Readonly<Record<PostFormat, { breite: number; hoehe: number }>> = {
  quadrat: { breite: 1080, hoehe: 1080 },
  feed: { breite: 1080, hoehe: 1350 },
  story: { breite: 1080, hoehe: 1920 },
};

interface Buehne {
  format: PostFormat;
  breite: number;
  hoehe: number;
  /** Aussenrand - in der Story mehr, weil dort mehr Flaeche ist. */
  rand: number;
  /** Typoskala. Nicht die Flaeche skaliert, sondern die Schrift. */
  skala: number;
  /** Darf hoch gebaut werden - mit zusaetzlichen Stufen? */
  hoch: boolean;
  /**
   * Sicherer Bereich oben und unten (§46).
   *
   * In der Story liegen Profilzeile und Antwortfeld von Instagram ueber dem
   * Bild. Was dort steht, ist weg - deshalb beginnt der Inhalt weiter unten
   * und endet weiter oben. Im Feed gibt es das nicht.
   */
  sicherOben: number;
  sicherUnten: number;
}

function buehneFuer(format: PostFormat): Buehne {
  const mass = POST_MASSE[format];
  if (format === 'story') {
    return { format, ...mass, rand: 96, skala: 1.1, hoch: true, sicherOben: 220, sicherUnten: 260 };
  }
  if (format === 'feed') {
    return { format, ...mass, rand: 84, skala: 1, hoch: true, sicherOben: 0, sicherUnten: 0 };
  }
  return { format, ...mass, rand: 76, skala: 0.92, hoch: false, sicherOben: 0, sicherUnten: 0 };
}

const gross = (text: string): string => text.toLocaleUpperCase('de-CH');

/**
 * Eine Schriftgroesse, die den Text noch unterbringt.
 *
 * Dieselbe Schaetzung wie in «SwissHub fragt» und aus demselben Grund: Satori
 * misst Text erst beim Rendern, da ist die Groesse schon gesetzt, und eine
 * echte Messung hiesse zweimal rendern. Ein Zeichen ist bei fetter Schrift
 * etwa halb so breit wie hoch.
 *
 * Grosszuegig nach unten: eine Ueberschrift zwei Punkte kleiner als noetig
 * sieht niemand, eine ueber dem Rand sieht jeder.
 */
function passend(text: string, breite: number, basis: number, maxZeilen = 3, unten = 24): number {
  const zeichen = Math.max(text.length, 1);
  const proZeile = Math.max(Math.floor(breite / (0.52 * basis)), 1);
  const zeilen = Math.ceil(zeichen / proZeile);
  if (zeilen <= maxZeilen) {
    return basis;
  }
  return Math.max(Math.round(basis * (maxZeilen / zeilen)), unten);
}

/** Datum in Schweizer Schreibweise - aus `jjjj-mm-tt`, ohne Zeitzonenrechnung. */
function datumText(iso: string | undefined): string | null {
  if (!iso) {
    return null;
  }
  const teile = iso.split('-');
  if (teile.length !== 3) {
    return null;
  }
  return `${teile[2]}.${teile[1]}.${teile[0]}`;
}

/** Die Zeilen eines Textfeldes - eine Zeile je Punkt, Leerzeilen weg. */
function zeilen(text: string | undefined, max: number): string[] {
  if (!text) {
    return [];
  }
  return text
    .split('\n')
    .map((zeile) => zeile.trim())
    .filter((zeile) => zeile !== '')
    .slice(0, max);
}

// --- Die aufgeloesten Bilder -------------------------------------------------

/**
 * Bilder als `data:`-URI, nie als Adresse.
 *
 * Satori wuerde eine Adresse abrufen - der Export haengt dann an einem Server,
 * der antworten muss, waehrend jemand auf eine Datei wartet, und bei einer
 * fremden Adresse waere es ein Abruf, den jemand anderes bestimmt (§37). Die
 * Bytes kommen deshalb von der Platte und stehen fertig in der Komponente.
 */
export interface PostBilder {
  bild?: string;
  hintergrundbild?: string;
  logo?: string;
  /**
   * Das mitgelieferte SwissHub-Signet.
   *
   * Steht neben `logo`, nicht an dessen Stelle: `logo` ist das hochgeladene
   * Zeichen eines Teams oder Partners und schlaegt das Signet, wenn es da
   * ist. Ohne Upload ist das Signet die Vorgabe - und das ist der Normalfall,
   * denn ein Post des Servers traegt das Zeichen des Servers.
   */
  signet?: string;
  sponsoren?: string[];
  teamLogoA?: string;
  teamLogoB?: string;
}

export interface PostAuftrag {
  typId: string;
  typLabel: string;
  block: InhaltsBlock;
  design: PostDesign;
  format: PostFormat;
  inhalt: PostInhalt;
  bilder: PostBilder;
  /*
   * Der Baum steht im Inhalt, nicht daneben.
   *
   * Hier stand `baum?: TurnierBaum | null` - der Baum kam aus dem Turnier und
   * nicht aus dem Post. Das machte den Typ von einem Turniereintrag abhaengig
   * und den Export unveraenderlich. Jetzt ist er ein Feld wie jedes andere:
   * `inhalt.bracket`, gespeichert, aenderbar, aus einem Turnier befuellbar.
   */
}

// --- Bausteine ---------------------------------------------------------------

/**
 * Das Zeichen oben.
 *
 * ## Drei Faelle, in dieser Reihenfolge
 *
 * 1. Ein **hochgeladenes** Logo - das Zeichen eines Teams oder Partners.
 *    Es steht allein: neben einem fremden Zeichen waere das SwissHub-Signet
 *    eine Behauptung ueber die Urheberschaft, die der Post nicht aufstellt.
 * 2. Das **SwissHub-Signet** mit Wortmarke. Der Normalfall, und das ist
 *    Absicht: ein Post des Servers traegt das Zeichen des Servers, ohne dass
 *    jemand es einschalten muss.
 * 3. Nur die **gezeichnete Wortmarke** - wenn die Signetdatei nicht lesbar
 *    war. Ein Post ohne jedes Zeichen waere der schlechtere Rueckfall.
 *
 * Signet und Wortmarke sind ein Block und keine zwei Elemente nebeneinander:
 * der Abstand zwischen ihnen ist fest, die Wortmarke sitzt auf der optischen
 * Mitte des Signets, und beide skalieren mit derselben Zahl. So bleibt das
 * Verhaeltnis in allen drei Formaten dasselbe.
 */
function Marke({
  buehne,
  farben,
  logo,
  signet,
  zeigen,
}: {
  buehne: Buehne;
  farben: Farben;
  logo: string | undefined;
  signet: string | undefined;
  zeigen: boolean;
}): React.JSX.Element | null {
  if (!zeigen) {
    return null;
  }
  const hoehe = Math.round(46 * buehne.skala);
  if (logo) {
    return (
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- Satori kennt
            kein next/image; die Bytes stehen ohnehin schon in der `src`. */}
        <img src={logo} alt="" height={hoehe} style={{ height: hoehe, objectFit: 'contain' }} />
      </div>
    );
  }

  const wortmarke = (
    <div
      style={{
        display: 'flex',
        fontSize: Math.round(27 * buehne.skala),
        fontWeight: 800,
        letterSpacing: Math.round(4 * buehne.skala),
        color: farben.schrift,
      }}
    >
      {gross('SwissHub')}
    </div>
  );

  if (signet) {
    const zeichen = Math.round(52 * buehne.skala);
    return (
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- siehe oben. */}
        <img
          src={signet}
          alt=""
          width={zeichen}
          height={zeichen}
          style={{
            width: zeichen,
            height: zeichen,
            objectFit: 'contain',
            marginRight: Math.round(16 * buehne.skala),
          }}
        />
        {wortmarke}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <div
        style={{
          display: 'flex',
          width: Math.round(8 * buehne.skala),
          height: Math.round(34 * buehne.skala),
          backgroundColor: farben.akzentHell,
          marginRight: Math.round(16 * buehne.skala),
        }}
      />
      {wortmarke}
    </div>
  );
}

/** Die Fusszeile - ein Satz, und nur wenn es einen gibt. */
function Fuss({
  buehne,
  farben,
  text,
  mitLinie,
}: {
  buehne: Buehne;
  farben: Farben;
  text: string | undefined;
  mitLinie: boolean;
}): React.JSX.Element | null {
  if (!text) {
    return null;
  }
  const groesse = passend(text, buehne.breite - 2 * buehne.rand, Math.round(24 * buehne.skala), 1, 16);
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {mitLinie ? (
        <div
          style={{
            display: 'flex',
            height: 1,
            backgroundColor: farben.linie,
            marginBottom: Math.round(22 * buehne.skala),
          }}
        />
      ) : null}
      <div
        style={{
          display: 'flex',
          fontSize: groesse,
          fontWeight: 600,
          letterSpacing: 2,
          color: farben.leise,
        }}
      >
        {gross(text)}
      </div>
    </div>
  );
}

/** Der Handlungsaufruf als Pille - gezeichnet, kein Schatten. */
function Aufruf({
  buehne,
  farben,
  text,
  aufFarbe = false,
}: {
  buehne: Buehne;
  farben: Farben;
  text: string | undefined;
  /** Liegt die Pille auf der Akzentflaeche? Dann wird sie hell statt farbig. */
  aufFarbe?: boolean;
}): React.JSX.Element | null {
  if (!text) {
    return null;
  }
  return (
    <div
      style={{
        display: 'flex',
        alignSelf: 'flex-start',
        paddingTop: Math.round(18 * buehne.skala),
        paddingBottom: Math.round(18 * buehne.skala),
        paddingLeft: Math.round(32 * buehne.skala),
        paddingRight: Math.round(32 * buehne.skala),
        backgroundColor: aufFarbe ? WEISS : farben.akzent,
        /*
         * Eckig, nicht rund.
         *
         * Die volle Pille (`borderRadius: 999`) ist die Form, die jeder
         * Baukasten vorgibt, und genau deshalb sieht sie nach Baukasten aus.
         * Ein leicht gebrochener Kasten sitzt ruhiger neben den geraden
         * Kanten, aus denen die Geruste sonst bestehen.
         */
        borderRadius: 8,
        fontSize: Math.round(28 * buehne.skala),
        fontWeight: 800,
        letterSpacing: 1,
        color: aufFarbe ? farben.akzent : farben.aufAkzent,
      }}
    >
      {gross(text)}
    </div>
  );
}

/** Ein Fakt: kleine Beschriftung, darunter der Wert. */
function Fakt({
  buehne,
  farben,
  label,
  wert,
}: {
  buehne: Buehne;
  farben: Farben;
  label: string;
  wert: string;
}): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          display: 'flex',
          fontSize: Math.round(19 * buehne.skala),
          fontWeight: 600,
          letterSpacing: 3,
          color: farben.leise,
        }}
      >
        {gross(label)}
      </div>
      <div
        style={{
          display: 'flex',
          marginTop: Math.round(10 * buehne.skala),
          fontSize: Math.round(36 * buehne.skala),
          fontWeight: 800,
          color: farben.schrift,
        }}
      >
        {wert}
      </div>
    </div>
  );
}

/** Welche Fakten dieser Post hat - Datum, Zeit, Ort, in dieser Reihenfolge. */
function faktenVon(inhalt: PostInhalt): Array<{ label: string; wert: string }> {
  const liste: Array<{ label: string; wert: string }> = [];
  const datum = datumText(inhalt.datum);
  if (datum) liste.push({ label: 'Datum', wert: datum });
  if (inhalt.zeit) liste.push({ label: 'Zeit', wert: `${inhalt.zeit} Uhr` });
  if (inhalt.ort) liste.push({ label: 'Ort', wert: inhalt.ort });
  return liste;
}

// --- Die Inhaltsbloecke ------------------------------------------------------

interface BlockArgs {
  buehne: Buehne;
  farben: Farben;
  auftrag: PostAuftrag;
  /*
   * Das Geruest, in dem der Block steht.
   *
   * Der Block braucht es nur an einer Stelle - dem Handlungsaufruf. Bei
   * `bold` liegt er auf dem Farbkeil, und eine Pille in derselben Farbe auf
   * derselben Farbe ist keine Pille mehr, sondern blosser Text. Das sieht man
   * erst im Bild, nicht im Code.
   */
  /** Breite, die dem Block zur Verfuegung steht. */
  breite: number;
  /** Mittig setzen? `minimal` und `spotlight` tun das. */
  zentriert: boolean;
  /** Wie gross die Ueberschrift sein darf - je Geruest anders. */
  titelBasis: number;
}

function Titelblock({
  buehne,
  farben,
  auftrag,
  breite,
  zentriert,
  titelBasis,
}: BlockArgs): React.JSX.Element {
  const { inhalt } = auftrag;
  const titel = inhalt.titel ?? '';
  const groesse = passend(titel, breite, titelBasis, buehne.hoch ? 4 : 3, 30);
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: zentriert ? 'center' : 'flex-start',
      }}
    >
      {inhalt.untertitel ? (
        <div
          style={{
            display: 'flex',
            fontSize: Math.round(23 * buehne.skala),
            /*
             * Halbfett und enger gesperrt.
             *
             * Sechs Punkte Sperrung bei Normalschrift liessen den Kicker
             * auseinanderfallen - er las sich als Buchstabenreihe, nicht als
             * Zeile. Halbfett traegt die Sperrung; drei Punkte genuegen dann,
             * um ihn von der Ueberschrift abzusetzen.
             */
            fontWeight: 600,
            letterSpacing: 3,
            color: farben.akzentHell,
            marginBottom: Math.round(20 * buehne.skala),
            textAlign: zentriert ? 'center' : 'left',
          }}
        >
          {gross(inhalt.untertitel)}
        </div>
      ) : null}
      {titel ? (
        <div
          style={{
            display: 'flex',
            fontSize: groesse,
            /*
             * 1.03 war fuer eine Normalschrift gerechnet. Im echten fetten
             * Schnitt stossen die Zeilen dabei aneinander - 1.08 ist der Wert,
             * bei dem zwei Zeilen noch als Block wirken, aber nicht kleben.
             */
            lineHeight: 1.08,
            fontWeight: 800,
            color: farben.schrift,
            maxWidth: breite,
            textAlign: zentriert ? 'center' : 'left',
          }}
        >
          {titel}
        </div>
      ) : null}
    </div>
  );
}

/** Aufzaehlung - ein Akzentquadrat je Zeile. */
function Punkte({
  buehne,
  farben,
  eintraege,
  breite,
  zentriert,
}: {
  buehne: Buehne;
  farben: Farben;
  eintraege: string[];
  breite: number;
  zentriert: boolean;
}): React.JSX.Element | null {
  if (eintraege.length === 0) {
    return null;
  }
  const groesse = Math.round(32 * buehne.skala);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', maxWidth: breite }}>
      {eintraege.map((zeile, index) => (
        <div
          key={`${index}-${zeile.slice(0, 12)}`}
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            marginTop: index === 0 ? 0 : Math.round(16 * buehne.skala),
            justifyContent: zentriert ? 'center' : 'flex-start',
          }}
        >
          {zentriert ? null : (
            <div
              style={{
                display: 'flex',
                width: Math.round(9 * buehne.skala),
                height: Math.round(9 * buehne.skala),
                marginTop: Math.round(groesse * 0.52),
                marginRight: Math.round(22 * buehne.skala),
                backgroundColor: farben.akzentHell,
              }}
            />
          )}
          <div
            style={{
              display: 'flex',
              fontSize: groesse,
              lineHeight: 1.34,
              color: farben.gedaempft,
              textAlign: zentriert ? 'center' : 'left',
            }}
          >
            {zeile}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Eine Seite einer Begegnung - Zeichen, Name, optional Punkte. */
function Seite({
  buehne,
  farben,
  name,
  logo,
  punkte,
  sieger,
  breite,
}: {
  buehne: Buehne;
  farben: Farben;
  name: string;
  logo: string | undefined;
  punkte: number | null;
  sieger: boolean;
  breite: number;
}): React.JSX.Element {
  const groesse = passend(name || '—', breite, Math.round(52 * buehne.skala), 2, 26);
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        width: breite,
      }}
    >
      {logo ? (
        <div style={{ display: 'flex', marginBottom: Math.round(20 * buehne.skala) }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- siehe `Marke`. */}
          <img
            src={logo}
            alt=""
            height={Math.round(120 * buehne.skala)}
            style={{ height: Math.round(120 * buehne.skala), objectFit: 'contain' }}
          />
        </div>
      ) : null}
      {/*
        Die Namensflaeche hat eine feste Hoehe - zwei Zeilen.

        Ohne sie steht ein einzeiliger Name hoeher als ein zweizeiliger, und
        die Punktestaende darunter liegen nicht mehr auf einer Linie. Bei
        einem Resultat ist genau das der Eindruck «da stimmt etwas nicht»:
        die beiden Zahlen gehoeren nebeneinander, nicht versetzt.
      */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: Math.round(groesse * 2.1),
          fontSize: groesse,
          fontWeight: 800,
          color: sieger ? farben.akzentHell : farben.schrift,
          textAlign: 'center',
          maxWidth: breite,
        }}
      >
        {name || '—'}
      </div>
      {punkte === null ? null : (
        <div
          style={{
            display: 'flex',
            marginTop: Math.round(14 * buehne.skala),
            fontSize: Math.round(96 * buehne.skala),
            fontWeight: 800,
            lineHeight: 1,
            color: sieger ? farben.akzentHell : farben.gedaempft,
          }}
        >
          {punkte}
        </div>
      )}
    </div>
  );
}

function Begegnung({ buehne, farben, auftrag, breite }: BlockArgs): React.JSX.Element {
  const paar = auftrag.inhalt.teams ?? { a: '', b: '' };
  const punkte = auftrag.inhalt.punkte ?? null;
  const siegerA = punkte !== null && punkte.a > punkte.b;
  const siegerB = punkte !== null && punkte.b > punkte.a;

  /*
   * Hoch in der Story, nebeneinander im Quadrat.
   *
   * Zwei Namen im Quadrat nebeneinander haben je 40 Prozent der Breite - das
   * reicht fuer «SwissHub Allstars» gerade. In der Story ist dieselbe
   * Anordnung Verschwendung: dort ist Hoehe da, und uebereinander wird jeder
   * Name doppelt so gross. Das ist die Layoutanpassung, die §46 meint - nicht
   * dieselbe Zeile in die Hoehe gezogen.
   */
  const untereinander = buehne.format === 'story';
  const seitenBreite = untereinander ? breite : Math.round(breite * 0.4);

  const trenner = (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: untereinander ? Math.round(34 * buehne.skala) : 0,
        marginBottom: untereinander ? Math.round(34 * buehne.skala) : 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          paddingTop: Math.round(8 * buehne.skala),
          paddingBottom: Math.round(8 * buehne.skala),
          paddingLeft: Math.round(22 * buehne.skala),
          paddingRight: Math.round(22 * buehne.skala),
          backgroundColor: farben.akzent,
          fontSize: Math.round(34 * buehne.skala),
          fontWeight: 800,
          letterSpacing: 4,
          color: farben.aufAkzent,
        }}
      >
        VS
      </div>
    </div>
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: untereinander ? 'column' : 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: breite,
      }}
    >
      <Seite
        buehne={buehne}
        farben={farben}
        name={paar.a}
        logo={auftrag.bilder.teamLogoA}
        punkte={punkte ? punkte.a : null}
        sieger={siegerA}
        breite={seitenBreite}
      />
      {trenner}
      <Seite
        buehne={buehne}
        farben={farben}
        name={paar.b}
        logo={auftrag.bilder.teamLogoB}
        punkte={punkte ? punkte.b : null}
        sieger={siegerB}
        breite={seitenBreite}
      />
    </div>
  );
}

/**
 * Der Turnierbaum.
 *
 * Eine Spalte je Runde, zwei Zeilen je Match. Mehr als vier Runden werden
 * **von hinten** genommen - der Final gehoert auf das Bild, die erste Runde
 * eines Turniers mit 64 Teams nicht. Sie waere bei 1080 Pixeln Breite
 * ohnehin unleserlich, und ein unleserlicher Baum ist schlechter als ein
 * ausschnittweiser.
 */
function Baum({ buehne, farben, auftrag, breite }: BlockArgs): React.JSX.Element {
  const baum: PostBaum | undefined = auftrag.inhalt.bracket;
  if (!baum || baum.runden.length === 0) {
    return (
      <div style={{ display: 'flex', fontSize: Math.round(30 * buehne.skala), color: farben.leise }}>
        Noch keine Begegnungen erfasst.
      </div>
    );
  }

  /*
   * Was aufs Bild passt, haengt am Format - nicht an einer Teamzahl.
   *
   * Vier, acht oder sechzehn Teams sind einfach verschieden viele Paarungen
   * in der ersten Runde; der Baum ist datengetrieben und kennt keine feste
   * Groesse. Begrenzt wird nach dem, was bei 1080 Pixeln noch lesbar ist:
   * mehr Spalten machen die Namen schmaler, mehr Zeilen machen sie kleiner.
   *
   * Beschnitten wird **von hinten**: der Final gehoert auf das Bild, die
   * erste Runde eines Turniers mit 64 Teams nicht.
   */
  /*
   * Vier Spalten in jedem Format - die Breite ist ueberall dieselbe.
   *
   * Hier stand drei fuer die Story, und damit fiel dort das Achtelfinal
   * weg, waehrend es im Quadrat stand. Alle drei Formate sind 1080 Pixel
   * breit; was sie unterscheidet, ist die Hoehe. Die Spaltenzahl haengt an
   * der Breite und darf deshalb nicht je Format verschieden sein.
   *
   * Vier Spalten tragen ein Turnier mit sechzehn Teams vollstaendig. Wer
   * mehr hat, verliert die erste Runde - und das ist die richtige, weil der
   * Final auf das Bild gehoert und die erste Runde eines 64er-Turniers bei
   * 1080 Pixeln ohnehin unleserlich waere.
   */
  const maxSpalten = 4;
  const runden = baum.runden.slice(-maxSpalten);
  const spalte = Math.floor((breite - (runden.length - 1) * 24) / runden.length);
  /*
   * Acht Begegnungen - eine erste Runde mit sechzehn Teams.
   *
   * Hier stand sechs, und damit fehlten im Achtelfinal eines 16er-Turniers
   * genau zwei Paarungen. Im Export sah das nicht nach «gekuerzt» aus,
   * sondern nach falsch: vier Spalten, und die erste zeigt nur drei Viertel
   * ihrer Teams. Platz ist da - die Schrift wird enger, nicht die Liste
   * kuerzer.
   */
  const maxPaarungen = buehne.format === 'story' ? 10 : 8;

  /*
   * Die Schrift richtet sich nach der vollsten Spalte.
   *
   * Acht Paarungen in einer Spalte brauchen kleinere Zeilen als zwei, sonst
   * laeuft die Spalte unten aus dem Bild. Gerechnet wird aus der hoechsten
   * Paarungszahl aller gezeigten Runden, damit alle Spalten dieselbe Schrift
   * tragen - verschieden grosse Namen nebeneinander lesen sich wie ein
   * Fehler.
   */
  const dichteste = Math.max(...runden.map((runde) => Math.min(runde.paarungen.length, maxPaarungen)));
  const enge = dichteste >= 9 ? 0.6 : dichteste >= 7 ? 0.72 : dichteste >= 5 ? 0.86 : 1;
  const schrift = Math.round(21 * buehne.skala * enge);
  const luft = Math.round(14 * buehne.skala * enge);

  return (
    <div style={{ display: 'flex', flexDirection: 'row', width: breite, alignItems: 'flex-start' }}>
      {runden.map((runde, index) => (
        <div
          key={`${runde.label}-${index}`}
          style={{
            display: 'flex',
            flexDirection: 'column',
            width: spalte,
            marginLeft: index === 0 ? 0 : 24,
          }}
        >
          <div
            style={{
              display: 'flex',
              fontSize: Math.round(20 * buehne.skala),
              letterSpacing: 3,
              color: farben.akzentHell,
              marginBottom: Math.round(14 * buehne.skala),
            }}
          >
            {gross(runde.label)}
          </div>
          {runde.paarungen.slice(0, maxPaarungen).map((paarung, stelle) => (
            <div
              key={`${index}-${stelle}`}
              style={{
                display: 'flex',
                flexDirection: 'column',
                marginBottom: luft,
                backgroundColor: farben.flaeche,
                borderLeft: `3px solid ${paarung.sieger ? farben.akzentHell : farben.linie}`,
              }}
            >
              {(['a', 'b'] as const).map((seite, zeile) => {
                const eintrag = paarung[seite];
                const gewinnt = paarung.sieger === seite;
                return (
                  <div
                    key={`${index}-${stelle}-${seite}`}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      paddingTop: Math.round(10 * buehne.skala * enge),
                      paddingBottom: Math.round(10 * buehne.skala * enge),
                      paddingLeft: Math.round(14 * buehne.skala),
                      paddingRight: Math.round(14 * buehne.skala),
                      borderTop: zeile === 1 ? `1px solid ${farben.linie}` : 'none',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        fontSize: schrift,
                        fontWeight: gewinnt ? 700 : 400,
                        color: gewinnt ? farben.schrift : farben.gedaempft,
                        maxWidth: spalte - Math.round(80 * buehne.skala),
                      }}
                    >
                      {eintrag.name === '' ? '—' : eintrag.name}
                    </div>
                    {eintrag.punkte === undefined ? null : (
                      <div
                        style={{
                          display: 'flex',
                          fontSize: schrift,
                          fontWeight: 700,
                          color: gewinnt ? farben.akzentHell : farben.leise,
                        }}
                      >
                        {eintrag.punkte}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Ein Name gross - fuer den Gewinner. */
function Person({ buehne, farben, auftrag, breite, zentriert }: BlockArgs): React.JSX.Element {
  const name = auftrag.inhalt.gewinner ?? '';
  const groesse = passend(name || '—', breite, Math.round(96 * buehne.skala), 2, 44);
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: zentriert ? 'center' : 'flex-start',
      }}
    >
      {auftrag.inhalt.titel ? (
        <div
          style={{
            display: 'flex',
            fontSize: Math.round(28 * buehne.skala),
            letterSpacing: 6,
            color: farben.akzentHell,
            marginBottom: Math.round(16 * buehne.skala),
            textAlign: zentriert ? 'center' : 'left',
          }}
        >
          {gross(auftrag.inhalt.titel)}
        </div>
      ) : null}
      {/*
        Die Platzierung als Band ueber dem Namen.

        Sie steht auf der Akzentflaeche und nicht einfach als Zeile: «1. Platz»
        ist die Aussage des Bildes, der Name ist ihr Gegenstand. Ohne
        Hervorhebung lasen sich Titel, Platzierung und Name als drei gleich
        wichtige Zeilen - und das ist keine Rangfolge.
      */}
      {auftrag.inhalt.platzierung ? (
        <div
          style={{
            display: 'flex',
            marginBottom: Math.round(18 * buehne.skala),
            paddingTop: Math.round(8 * buehne.skala),
            paddingBottom: Math.round(8 * buehne.skala),
            paddingLeft: Math.round(18 * buehne.skala),
            paddingRight: Math.round(18 * buehne.skala),
            borderRadius: 8,
            backgroundColor: farben.akzent,
            color: '#ffffff',
            fontSize: Math.round(26 * buehne.skala),
            fontWeight: 800,
            letterSpacing: 2,
          }}
        >
          {gross(auftrag.inhalt.platzierung)}
        </div>
      ) : null}
      <div
        style={{
          display: 'flex',
          fontSize: groesse,
          lineHeight: 1.02,
          fontWeight: 800,
          color: farben.schrift,
          maxWidth: breite,
          textAlign: zentriert ? 'center' : 'left',
        }}
      >
        {name || '—'}
      </div>
      {auftrag.inhalt.untertitel ? (
        <div
          style={{
            display: 'flex',
            marginTop: Math.round(18 * buehne.skala),
            fontSize: Math.round(32 * buehne.skala),
            color: farben.gedaempft,
            textAlign: zentriert ? 'center' : 'left',
            maxWidth: breite,
          }}
        >
          {auftrag.inhalt.untertitel}
        </div>
      ) : null}
      {/* Der Endstand - gross, weil ein Ergebnis eine Zahl ist. */}
      {auftrag.inhalt.punkte ? (
        <div
          style={{
            display: 'flex',
            marginTop: Math.round(20 * buehne.skala),
            fontSize: Math.round(54 * buehne.skala),
            fontWeight: 800,
            color: farben.akzentHell,
          }}
        >
          {`${auftrag.inhalt.punkte.a} : ${auftrag.inhalt.punkte.b}`}
        </div>
      ) : null}
    </div>
  );
}

/** Die Partnerzeichen in einer Reihe. */
function Sponsoren({
  buehne,
  logos,
}: {
  buehne: Buehne;
  logos: string[] | undefined;
}): React.JSX.Element | null {
  if (!logos || logos.length === 0) {
    return null;
  }
  const hoehe = Math.round((logos.length > 3 ? 70 : 96) * buehne.skala);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center' }}>
      {logos.map((logo, index) => (
        <div
          key={`${index}-${logo.slice(0, 10)}`}
          style={{
            display: 'flex',
            marginRight: Math.round(32 * buehne.skala),
            marginTop: Math.round(18 * buehne.skala),
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- siehe `Marke`. */}
          <img src={logo} alt="" height={hoehe} style={{ height: hoehe, objectFit: 'contain' }} />
        </div>
      ))}
    </div>
  );
}

/**
 * Der Inhaltsblock des Typs.
 *
 * Die eine Stelle, an der sich entscheidet, was in der Mitte steht - und sie
 * ist nach `block` verzweigt, nicht nach `typId`. Zwei Typen mit derselben
 * Form (Event und Turnier-Ankuendigung sind beide ein Termin) teilen damit die
 * Darstellung, ohne dass einer von beiden Sonderfall waere.
 */
function Inhalt(args: BlockArgs): React.JSX.Element {
  const { buehne, farben, auftrag, breite, zentriert } = args;
  const fakten = faktenVon(auftrag.inhalt);
  const punkte = zeilen(auftrag.inhalt.text, buehne.hoch ? 6 : 4);

  if (auftrag.block === 'begegnung' || auftrag.block === 'ergebnis') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', width: breite }}>
        <Titelblock {...args} titelBasis={Math.round(52 * buehne.skala)} />
        <div style={{ display: 'flex', marginTop: Math.round(48 * buehne.skala) }}>
          <Begegnung {...args} />
        </div>
        {fakten.length > 0 ? (
          <div
            style={{
              display: 'flex',
              marginTop: Math.round(44 * buehne.skala),
              justifyContent: 'space-between',
              width: breite,
            }}
          >
            {fakten.map((fakt) => (
              <Fakt key={fakt.label} buehne={buehne} farben={farben} label={fakt.label} wert={fakt.wert} />
            ))}
          </div>
        ) : null}
        {punkte.length > 0 ? (
          <div style={{ display: 'flex', marginTop: Math.round(32 * buehne.skala) }}>
            <Punkte buehne={buehne} farben={farben} eintraege={punkte} breite={breite} zentriert={false} />
          </div>
        ) : null}
      </div>
    );
  }

  if (auftrag.block === 'baum') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', width: breite }}>
        <Titelblock {...args} titelBasis={Math.round(56 * buehne.skala)} />
        <div style={{ display: 'flex', marginTop: Math.round(40 * buehne.skala) }}>
          <Baum {...args} />
        </div>
        <Sponsoren buehne={buehne} logos={auftrag.bilder.sponsoren} />
      </div>
    );
  }

  if (auftrag.block === 'person') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', width: breite }}>
        <Person {...args} />
        {punkte.length > 0 ? (
          <div
            style={{
              display: 'flex',
              marginTop: Math.round(34 * buehne.skala),
              justifyContent: zentriert ? 'center' : 'flex-start',
            }}
          >
            <Punkte
              buehne={buehne}
              farben={farben}
              eintraege={punkte}
              breite={breite}
              zentriert={zentriert}
            />
          </div>
        ) : null}
        {/*
          Partnerzeichen und Aufruf gehoeren auch hier hin.

          Sie standen nur im unteren Zweig, und damit hatte ein Gewinnerpost
          kein Sponsorenband und keinen Handlungsaufruf - obwohl genau diese
          beiden auf einem Gewinnerpost ueblich sind. Ein Feld, das der Editor
          anbietet und das Bild nicht zeigt, ist schlimmer als ein fehlendes.
        */}
        <Sponsoren buehne={buehne} logos={auftrag.bilder.sponsoren} />
        {auftrag.inhalt.cta ? (
          <div
            style={{
              display: 'flex',
              marginTop: Math.round(36 * buehne.skala),
              justifyContent: zentriert ? 'center' : 'flex-start',
            }}
          >
            <Aufruf
              buehne={buehne}
              farben={farben}
              text={auftrag.inhalt.cta}
              aufFarbe={auftrag.design === 'bold'}
            />
          </div>
        ) : null}
      </div>
    );
  }

  // `aussage`, `termin` und `liste` teilen den Aufbau und unterscheiden sich
  // in dem, was dazukommt: Fakten beim Termin, Aufzaehlung bei der Liste.
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: breite,
        alignItems: zentriert ? 'center' : 'flex-start',
      }}
    >
      <Titelblock {...args} />
      {auftrag.block === 'termin' && fakten.length > 0 ? (
        <div
          style={{
            display: 'flex',
            marginTop: Math.round(40 * buehne.skala),
            width: breite,
            justifyContent: zentriert ? 'center' : 'flex-start',
          }}
        >
          {fakten.map((fakt, index) => (
            <div
              key={fakt.label}
              style={{
                display: 'flex',
                marginRight: index === fakten.length - 1 ? 0 : Math.round(56 * buehne.skala),
              }}
            >
              <Fakt buehne={buehne} farben={farben} label={fakt.label} wert={fakt.wert} />
            </div>
          ))}
        </div>
      ) : null}
      {punkte.length > 0 ? (
        <div style={{ display: 'flex', marginTop: Math.round(34 * buehne.skala) }}>
          <Punkte buehne={buehne} farben={farben} eintraege={punkte} breite={breite} zentriert={zentriert} />
        </div>
      ) : null}
      <Sponsoren buehne={buehne} logos={auftrag.bilder.sponsoren} />
      {auftrag.inhalt.link ? (
        <div
          style={{
            display: 'flex',
            marginTop: Math.round(28 * buehne.skala),
            fontSize: Math.round(26 * buehne.skala),
            color: farben.leise,
          }}
        >
          {auftrag.inhalt.link.replace(/^https:\/\//u, '')}
        </div>
      ) : null}
      {auftrag.inhalt.cta ? (
        <div style={{ display: 'flex', marginTop: Math.round(40 * buehne.skala) }}>
          <Aufruf
            buehne={buehne}
            farben={farben}
            text={auftrag.inhalt.cta}
            aufFarbe={auftrag.design === 'bold'}
          />
        </div>
      ) : null}
    </div>
  );
}

// --- Die sechs Geruste -------------------------------------------------------

interface GeruestArgs {
  buehne: Buehne;
  farben: Farben;
  auftrag: PostAuftrag;
}

/** Der Hintergrund - abgedunkelt, damit Schrift darauf lesbar bleibt. */
function Hintergrund({
  bild,
  dunkel,
}: {
  bild: string | undefined;
  dunkel: boolean;
}): React.JSX.Element | null {
  if (!bild) {
    return null;
  }
  return (
    <div style={{ display: 'flex', position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- siehe `Marke`. */}
      <img src={bild} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      {/*
        Die Abdunkelung als eigene Flaeche und nicht als Filter: Satori kennt
        `filter: brightness()` nicht zuverlaessig, eine halbtransparente
        Flaeche darueber immer.
      */}
      <div
        style={{
          display: 'flex',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: dunkel ? 'rgba(10,10,11,0.68)' : 'rgba(245,245,246,0.78)',
        }}
      />
    </div>
  );
}

function Clean({ buehne, farben, auftrag }: GeruestArgs): React.JSX.Element {
  const bandHoehe = auftrag.bilder.bild ? Math.round(buehne.hoehe * 0.3) : 0;
  const inhaltsBreite = buehne.breite - 2 * buehne.rand;
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: buehne.breite,
        height: buehne.hoehe,
        backgroundColor: farben.grund,
        position: 'relative',
      }}
    >
      <Hintergrund bild={auftrag.bilder.hintergrundbild} dunkel={false} />
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          paddingTop: buehne.rand + buehne.sicherOben,
          paddingLeft: buehne.rand,
          paddingRight: buehne.rand,
          paddingBottom: buehne.rand,
        }}
      >
        <Marke
          buehne={buehne}
          farben={farben}
          logo={auftrag.bilder.logo}
          signet={auftrag.bilder.signet}
          zeigen={auftrag.inhalt.branding !== false}
        />
        {/* Eine feine Akzentlinie statt einer Flaeche - das ruhigste Mittel,
            die Marke mit dem Inhalt zu verbinden. */}
        <div
          style={{
            display: 'flex',
            width: Math.round(96 * buehne.skala),
            height: 4,
            backgroundColor: farben.akzent,
            marginTop: Math.round(40 * buehne.skala),
          }}
        />
        <div style={{ display: 'flex', flex: 1, alignItems: 'center' }}>
          <Inhalt
            buehne={buehne}
            farben={farben}
            auftrag={auftrag}
            breite={inhaltsBreite}
            zentriert={false}
            titelBasis={Math.round(84 * buehne.skala)}
          />
        </div>
        <Fuss buehne={buehne} farben={farben} text={auftrag.inhalt.fusszeile} mitLinie />
      </div>
      {bandHoehe > 0 ? (
        <div style={{ display: 'flex', width: buehne.breite, height: bandHoehe }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- siehe `Marke`. */}
          <img
            src={auftrag.bilder.bild}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </div>
      ) : null}
    </div>
  );
}

function Bold({ buehne, farben, auftrag }: GeruestArgs): React.JSX.Element {
  const inhaltsBreite = buehne.breite - 2 * Math.round(buehne.rand * 0.72);
  const streifen = Math.round(150 * buehne.skala);
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: buehne.breite,
        height: buehne.hoehe,
        backgroundColor: farben.grund,
        position: 'relative',
      }}
    >
      <Hintergrund bild={auftrag.bilder.hintergrundbild} dunkel />
      {/*
        Der Keil.

        Ein gedrehtes Rechteck, das unten links aus dem Bild laeuft - Satori
        kennt kein `clip-path`, und eine Drehung ist das, was bleibt.

        Er lag frueher bei 0.52 und um 12 Grad gedreht. Im Bild schnitt seine
        Kante dadurch mitten durch die letzte Zeile der Ueberschrift und durch
        die Aufzaehlung: derselbe Text stand zur Haelfte auf Schwarz und zur
        Haelfte auf Rot. Eine Flaeche, die den Inhalt zerteilt statt ihn zu
        tragen, ist genau die unruhige Komposition, um die es hier geht.

        Jetzt beginnt er tiefer und steht flacher. Er liest sich als Sockel,
        auf dem der Inhalt steht - und nicht als Schnitt quer durchs Bild.
      */}
      <div
        style={{
          display: 'flex',
          position: 'absolute',
          left: -Math.round(buehne.breite * 0.3),
          top: Math.round(buehne.hoehe * 0.72),
          width: Math.round(buehne.breite * 1.6),
          height: buehne.hoehe,
          backgroundColor: farben.akzent,
          transform: 'rotate(-7deg)',
        }}
      />
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          paddingTop: Math.round(buehne.rand * 0.72) + buehne.sicherOben,
          paddingLeft: Math.round(buehne.rand * 0.72),
          paddingRight: Math.round(buehne.rand * 0.72),
          paddingBottom: buehne.sicherUnten,
        }}
      >
        <Marke
          buehne={buehne}
          farben={farben}
          logo={auftrag.bilder.logo}
          signet={auftrag.bilder.signet}
          zeigen={auftrag.inhalt.branding !== false}
        />
        <div style={{ display: 'flex', flex: 1, alignItems: 'center' }}>
          <Inhalt
            buehne={buehne}
            farben={farben}
            auftrag={auftrag}
            breite={inhaltsBreite}
            zentriert={false}
            /* Randlos gross - das ist der Charakter dieses Geruests. */
            titelBasis={Math.round(126 * buehne.skala)}
          />
        </div>
      </div>
      {/* Der Faktenstreifen unten: volle Breite, voller Ton, kein Rand. */}
      <div
        style={{
          display: 'flex',
          width: buehne.breite,
          minHeight: streifen,
          backgroundColor: SCHWARZ,
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingLeft: Math.round(buehne.rand * 0.72),
          paddingRight: Math.round(buehne.rand * 0.72),
          marginBottom: buehne.sicherUnten > 0 ? buehne.sicherUnten - streifen / 2 : 0,
        }}
      >
        <Fuss buehne={buehne} farben={farben} text={auftrag.inhalt.fusszeile} mitLinie={false} />
      </div>
    </div>
  );
}

function Minimal({ buehne, farben, auftrag }: GeruestArgs): React.JSX.Element {
  const einzug = Math.round(buehne.rand * 0.6);
  const inhaltsBreite = buehne.breite - 2 * (einzug + Math.round(64 * buehne.skala));
  return (
    <div
      style={{
        display: 'flex',
        width: buehne.breite,
        height: buehne.hoehe,
        backgroundColor: farben.grund,
        position: 'relative',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Der Haarlinienrahmen - das einzige Ornament dieses Geruests. */}
      <div
        style={{
          display: 'flex',
          position: 'absolute',
          top: einzug + buehne.sicherOben / 2,
          left: einzug,
          right: einzug,
          bottom: einzug + buehne.sicherUnten / 2,
          border: `1px solid ${farben.linie}`,
        }}
      />
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          width: inhaltsBreite,
        }}
      >
        <div style={{ display: 'flex', marginBottom: Math.round(44 * buehne.skala) }}>
          <Marke
            buehne={buehne}
            farben={farben}
            logo={auftrag.bilder.logo}
            signet={auftrag.bilder.signet}
            zeigen={auftrag.inhalt.branding !== false}
          />
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: Math.round(20 * buehne.skala),
            letterSpacing: 8,
            color: farben.leise,
            marginBottom: Math.round(28 * buehne.skala),
          }}
        >
          {gross(auftrag.typLabel)}
        </div>
        <Inhalt
          buehne={buehne}
          farben={farben}
          auftrag={auftrag}
          breite={inhaltsBreite}
          zentriert
          titelBasis={Math.round(72 * buehne.skala)}
        />
        <div
          style={{
            display: 'flex',
            width: Math.round(60 * buehne.skala),
            height: 1,
            backgroundColor: farben.akzent,
            marginTop: Math.round(40 * buehne.skala),
          }}
        />
        {auftrag.inhalt.fusszeile ? (
          <div
            style={{
              display: 'flex',
              marginTop: Math.round(28 * buehne.skala),
              fontSize: Math.round(20 * buehne.skala),
              letterSpacing: 4,
              color: farben.leise,
              textAlign: 'center',
            }}
          >
            {gross(auftrag.inhalt.fusszeile)}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Tournament({ buehne, farben, auftrag }: GeruestArgs): React.JSX.Element {
  const kopf = Math.round(118 * buehne.skala);
  const inhaltsBreite = buehne.breite - 2 * buehne.rand;
  const fakten = faktenVon(auftrag.inhalt);
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: buehne.breite,
        height: buehne.hoehe,
        backgroundColor: farben.grund,
        position: 'relative',
      }}
    >
      <Hintergrund bild={auftrag.bilder.hintergrundbild} dunkel />
      {/* Kopfband: volle Breite im Akzentton, Marke links, Anlass rechts. */}
      <div
        style={{
          display: 'flex',
          width: buehne.breite,
          height: kopf,
          marginTop: buehne.sicherOben,
          backgroundColor: farben.akzent,
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingLeft: buehne.rand,
          paddingRight: buehne.rand,
        }}
      >
        <Marke
          buehne={buehne}
          farben={farben}
          logo={auftrag.bilder.logo}
          signet={auftrag.bilder.signet}
          zeigen={auftrag.inhalt.branding !== false}
        />
        <div
          style={{
            display: 'flex',
            fontSize: Math.round(24 * buehne.skala),
            letterSpacing: 5,
            color: farben.aufAkzent,
          }}
        >
          {gross(auftrag.typLabel)}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          flex: 1,
          alignItems: 'center',
          paddingLeft: buehne.rand,
          paddingRight: buehne.rand,
          paddingTop: Math.round(48 * buehne.skala),
          paddingBottom: Math.round(48 * buehne.skala),
        }}
      >
        <Inhalt
          buehne={buehne}
          farben={farben}
          auftrag={auftrag}
          breite={inhaltsBreite}
          zentriert={false}
          titelBasis={Math.round(88 * buehne.skala)}
        />
      </div>

      {/*
        Der Faktenstreifen: drei Spalten mit Haarlinien dazwischen.

        Nur, wenn der Block die Fakten nicht schon selbst zeigt - bei einer
        Begegnung stehen Datum und Ort oben, und sie zweimal zu setzen waere
        kein Layout, sondern ein Fehler.
      */}
      {fakten.length > 0 && auftrag.block !== 'begegnung' && auftrag.block !== 'ergebnis' ? (
        <div
          style={{
            display: 'flex',
            width: buehne.breite,
            borderTop: `1px solid ${farben.linie}`,
            paddingTop: Math.round(32 * buehne.skala),
            paddingBottom: Math.round(32 * buehne.skala),
            paddingLeft: buehne.rand,
            paddingRight: buehne.rand,
            marginBottom: buehne.sicherUnten,
          }}
        >
          {fakten.map((fakt, index) => (
            <div
              key={fakt.label}
              style={{
                display: 'flex',
                flex: 1,
                paddingLeft: index === 0 ? 0 : Math.round(28 * buehne.skala),
                borderLeft: index === 0 ? 'none' : `1px solid ${farben.linie}`,
              }}
            >
              <Fakt buehne={buehne} farben={farben} label={fakt.label} wert={fakt.wert} />
            </div>
          ))}
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            paddingLeft: buehne.rand,
            paddingRight: buehne.rand,
            paddingBottom: Math.round(40 * buehne.skala) + buehne.sicherUnten,
          }}
        >
          <Fuss buehne={buehne} farben={farben} text={auftrag.inhalt.fusszeile} mitLinie />
        </div>
      )}
    </div>
  );
}

function Dark({ buehne, farben, auftrag }: GeruestArgs): React.JSX.Element {
  const bahn = auftrag.bilder.bild ? Math.round(buehne.breite * 0.36) : 0;
  const inhaltsBreite = buehne.breite - 2 * buehne.rand - bahn - (bahn > 0 ? 40 : 0);
  return (
    <div
      style={{
        display: 'flex',
        width: buehne.breite,
        height: buehne.hoehe,
        backgroundColor: farben.grund,
        position: 'relative',
      }}
    >
      <Hintergrund bild={auftrag.bilder.hintergrundbild} dunkel />
      {/* Der Eckkeil oben rechts - gedreht, weil es kein `clip-path` gibt. */}
      <div
        style={{
          display: 'flex',
          position: 'absolute',
          top: -Math.round(buehne.breite * 0.26),
          right: -Math.round(buehne.breite * 0.26),
          width: Math.round(buehne.breite * 0.62),
          height: Math.round(buehne.breite * 0.62),
          backgroundColor: farben.akzent,
          transform: 'rotate(42deg)',
        }}
      />

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          paddingTop: buehne.rand + buehne.sicherOben,
          paddingLeft: buehne.rand,
          paddingBottom: buehne.rand + buehne.sicherUnten,
          paddingRight: bahn > 0 ? 20 : buehne.rand,
        }}
      >
        <Marke
          buehne={buehne}
          farben={farben}
          logo={auftrag.bilder.logo}
          signet={auftrag.bilder.signet}
          zeigen={auftrag.inhalt.branding !== false}
        />
        <div style={{ display: 'flex', flex: 1, alignItems: 'center' }}>
          {/* Der Textblock mit Akzentkante links - der versetzte Aufbau,
              der dieses Geruest von `clean` unterscheidet. */}
          <div
            style={{
              display: 'flex',
              borderLeft: `6px solid ${farben.akzentHell}`,
              paddingLeft: Math.round(36 * buehne.skala),
            }}
          >
            <Inhalt
              buehne={buehne}
              farben={farben}
              auftrag={auftrag}
              breite={inhaltsBreite - Math.round(42 * buehne.skala)}
              zentriert={false}
              titelBasis={Math.round(76 * buehne.skala)}
            />
          </div>
        </div>
        <Fuss buehne={buehne} farben={farben} text={auftrag.inhalt.fusszeile} mitLinie />
      </div>

      {bahn > 0 ? (
        <div style={{ display: 'flex', width: bahn, height: buehne.hoehe }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- siehe `Marke`. */}
          <img
            src={auftrag.bilder.bild}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </div>
      ) : null}
    </div>
  );
}

function Spotlight({ buehne, farben, auftrag }: GeruestArgs): React.JSX.Element {
  const kreis = Math.round(buehne.breite * (buehne.format === 'story' ? 0.56 : 0.46));
  const inhaltsBreite = buehne.breite - 2 * buehne.rand;
  const schildBreite = Math.round(inhaltsBreite * 0.86);
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: buehne.breite,
        height: buehne.hoehe,
        backgroundColor: farben.grund,
        position: 'relative',
        alignItems: 'center',
      }}
    >
      <Hintergrund bild={auftrag.bilder.hintergrundbild} dunkel />
      {/*
        Hier lag ein «Lichthof»: vier konzentrische Kreise in Akzentfarbe mit
        wenig Deckkraft, zusammen ueber die ganze Flaeche.

        Er ist entfernt, und das ist die Hauptaenderung an diesem Geruest. Er
        sollte Licht andeuten, aber Satori kennt keinen Radialgradienten - was
        herauskam, waren vier Ringe mit sichtbaren Kanten, die zufaellig im
        Bild lagen und nichts gliederten. Genau diese Art Form laesst eine
        Grafik automatisch erzeugt aussehen: sie ist da, weil sie sich zeichnen
        liess, nicht weil der Inhalt sie braucht.

        An ihre Stelle tritt nichts. Ein dunkler Grund, ein rundes Motiv und
        ein Namensschild sind drei Elemente, und drei Elemente ordnen sich von
        selbst - ein viertes haette nur etwas zu verdecken.
      */}

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          width: buehne.breite,
          paddingTop: Math.round(buehne.rand * 0.7) + buehne.sicherOben,
        }}
      >
        <Marke
          buehne={buehne}
          farben={farben}
          logo={auftrag.bilder.logo}
          signet={auftrag.bilder.signet}
          zeigen={auftrag.inhalt.branding !== false}
        />
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          width: buehne.breite,
          paddingLeft: buehne.rand,
          paddingRight: buehne.rand,
        }}
      >
        {auftrag.bilder.bild ? (
          <div
            style={{
              display: 'flex',
              width: kreis,
              height: kreis,
              borderRadius: 9999,
              border: `6px solid ${farben.akzentHell}`,
              overflow: 'hidden',
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- siehe `Marke`. */}
            <img
              src={auftrag.bilder.bild}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </div>
        ) : null}
        {/*
          Das Namensschild.

          Mit Motiv ist es ein Kasten, der dessen untere Kante ueberlappt -
          daher der negative obere Rand und der deckende Grund. Ein negativer
          Rand und keine absolute Platzierung: so bleibt der Fluss erhalten,
          auch wenn kein Bild da ist und der Kreis fehlt.

          Ohne Motiv gaebe derselbe Kasten einen leeren Rahmen um den Text,
          und das sah im Bild nach vergessenem Platzhalter aus; dann steht der
          Text frei auf dem Grund.
        */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            marginTop: auftrag.bilder.bild ? -Math.round(44 * buehne.skala) : 0,
            backgroundColor: auftrag.bilder.bild ? farben.grund : 'transparent',
            border: auftrag.bilder.bild ? `2px solid ${farben.akzentHell}` : 'none',
            paddingTop: Math.round(26 * buehne.skala),
            paddingBottom: Math.round(26 * buehne.skala),
            paddingLeft: Math.round(40 * buehne.skala),
            paddingRight: Math.round(40 * buehne.skala),
            /*
             * Schmaler als die Inhaltsflaeche.
             *
             * Mit voller Breite stand das Schild von Rand zu Rand und sah aus
             * wie ein Kasten um die Seite, nicht wie ein Schild auf dem Bild.
             * Es ist ein Element, kein Rahmen - und das sieht man erst,
             * wenn links und rechts Luft bleibt.
             */
            width: schildBreite,
          }}
        >
          <Inhalt
            buehne={buehne}
            farben={farben}
            auftrag={auftrag}
            breite={schildBreite - Math.round(88 * buehne.skala)}
            zentriert
            titelBasis={Math.round(68 * buehne.skala)}
          />
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          width: buehne.breite,
          paddingLeft: buehne.rand,
          paddingRight: buehne.rand,
          paddingBottom: Math.round(buehne.rand * 0.8) + buehne.sicherUnten,
        }}
      >
        <Fuss buehne={buehne} farben={farben} text={auftrag.inhalt.fusszeile} mitLinie={false} />
      </div>
    </div>
  );
}

const GERUEST: Record<PostDesign, (args: GeruestArgs) => React.JSX.Element> = {
  clean: Clean,
  bold: Bold,
  minimal: Minimal,
  tournament: Tournament,
  dark: Dark,
  spotlight: Spotlight,
};

/**
 * Die eine Funktion, die ein Bild beschreibt.
 *
 * Vorschau und Export rufen sie - durch dieselbe Route, mit demselben
 * Datensatz. Es gibt keinen zweiten Weg zu einem Bild (§38).
 */
export function zeichnePost(auftrag: PostAuftrag): React.JSX.Element {
  const buehne = buehneFuer(auftrag.format);
  const akzent = auftrag.inhalt.akzentfarbe ?? POST_AKZENT;
  const akzentHell = akzent === POST_AKZENT ? POST_AKZENT_HELL : akzent;
  const farben = farbenFuer(auftrag.design, akzent, akzentHell);
  const Geruest = GERUEST[auftrag.design];
  return <Geruest buehne={buehne} farben={farben} auftrag={auftrag} />;
}

/** Der Dateiname eines Exports - Typ, Format, nichts aus fremder Hand. */
export function postDateiname(typId: string, format: PostFormat, titel: string): string {
  const stamm = titel
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 40);
  return `swisshub-${typId}-${stamm === '' ? 'post' : stamm}-${format}.png`;
}
