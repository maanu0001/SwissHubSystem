import type { fragt } from '@swisshub/modules';

/**
 * Die Social-Media-Grafiken von «SwissHub fragt».
 *
 * ## Warum gezeichnet und nicht abfotografiert
 *
 * Ein Screenshot des Dashboards haette die Breite des Fensters, die Schrift des
 * Systems, eine Navigationsleiste und mit etwas Pech einen Ladezustand darin.
 * Hier entsteht das Bild aus einer Komponente in fester Groesse - dieselbe, die
 * auch die Vorschau im Studio zeigt.
 *
 * Gerendert wird mit `next/og` (Satori), wie schon die Folien von Wrapped. Kein
 * Puppeteer, kein Canvas: die Infrastruktur steht, sie laeuft im Docker-Bild,
 * und sie ist die einzige, die Vorschau und Export garantiert gleich aussehen
 * laesst - weil es dieselbe Komponente ist.
 *
 * ## Was Satori nicht kann
 *
 * Kein `clip-path`, kein `text-transform`, kein `box-shadow` mit Streuung, kein
 * `gap` in allen Faellen. Die Geometrie unten ist deshalb aus gedrehten
 * Rechtecken und Raendern gebaut, und Grossschreibung passiert in JavaScript.
 * Wer hier CSS ergaenzt, das der Browser versteht, bekommt im PNG ein leeres
 * Kaestchen - und das faellt erst beim Export auf.
 *
 * ## Die drei Vorlagen sind drei Kompositionen
 *
 * Nicht dieselbe Grafik in drei Farben. `winner` stellt eine Zahl gross in den
 * Raum, `results` ist eine Liste mit Balken, `duel` teilt die Flaeche in zwei
 * Haelften. Ein Test prueft, dass sie sich in der Struktur unterscheiden und
 * nicht nur im Farbwert.
 */

// --- Format und Masse --------------------------------------------------------

export type SocialFormat = fragt.Format;

export const SOCIAL_MASSE: Record<SocialFormat, { breite: number; hoehe: number }> = {
  /** Instagram Story und Reels-Cover. */
  story: { breite: 1080, hoehe: 1920 },
  /** Instagram Feed und Carousel. */
  feed: { breite: 1080, hoehe: 1350 },
  /** Quadratisch - der Klassiker, und was X und LinkedIn am liebsten nehmen. */
  quadrat: { breite: 1080, hoehe: 1080 },
};

// --- Farben ------------------------------------------------------------------
//
// Fest und nicht aus den Design-Tokens gelesen: die Tokens sind CSS-Variablen,
// und Satori kennt keine. Die Werte sind dieselben - `--swisshub-rot` ist
// #83060a, und das steht so auch im Discord-Embed (`FRAGT_ACCENT_COLOR`).

export const STANDARD_AKZENT = '#83060a';
export const STANDARD_AKZENT_HELL = '#b81219';
const SCHWARZ = '#0a0a0b';
const TIEF = '#131316';
const WEISS = '#ffffff';
const GEDAEMPFT = 'rgba(255,255,255,0.62)';
const LEISE = 'rgba(255,255,255,0.34)';
const LINIE = 'rgba(255,255,255,0.10)';

// --- Die Marke ---------------------------------------------------------------

/**
 * Was ein Server an seinen Grafiken selbst bestimmt.
 *
 * Drei Angaben, und sie gelten fuer **jede** Folie - Frage wie Ergebnis. Eine
 * Frage in Serverfarben und ein Ergebnis in SwissHub-Rot waeren zwei Accounts.
 *
 * Kein Feld ist Pflicht, und `STANDARD_MARKE` ist genau das, was vorher fest
 * im Code stand. Wer nichts einstellt, bekommt deshalb Bild fuer Bild dasselbe
 * wie bisher.
 */
export interface FolienMarke {
  /** Der satte Ton fuer Flaechen. Immer `#rrggbb` - siehe `normalisiereFarbe`. */
  akzent: string;
  /** Der hellere Ton fuer Schrift und Akzente auf dunklem Grund. */
  akzentHell: string;
  /**
   * Das Zeichen oben links.
   *
   * `null` heisst «das gezeichnete Signet» - ein rotes Rechteck und das
   * Wortzeichen daneben, ohne Datei. Eine Zeichenkette ist eine `data:`-URI
   * mit den Bytes darin, nie eine Adresse: Satori wuerde eine Adresse abrufen,
   * und dann haengt der Export an einem fremden Server. `'keins'` laesst die
   * Stelle leer.
   */
  logo: string | null | 'keins';
  /** Der Satz unten links. `null` heisst: der Standardsatz. */
  zusatztext: string | null;
}

/** Was gilt, solange ein Server nichts eingestellt hat - wie bisher. */
export const STANDARD_MARKE: FolienMarke = {
  akzent: STANDARD_AKZENT,
  akzentHell: STANDARD_AKZENT_HELL,
  logo: null,
  zusatztext: null,
};

// --- Hilfsmittel -------------------------------------------------------------

/**
 * Eine Schriftgroesse, die den Text noch unterbringt.
 *
 * ## Warum geschaetzt und nicht gemessen
 *
 * Satori misst Text erst beim Rendern, und da ist die Groesse schon gesetzt.
 * Eine echte Messung hiesse zweimal rendern.
 *
 * Geschaetzt wird ueber die Zeichenzahl: bei einer fetten Schrift ist ein
 * Zeichen im Schnitt etwa halb so breit wie hoch, also passen `breite / (0.52 *
 * groesse)` Zeichen in eine Zeile. Aus der erlaubten Zeilenzahl folgt die
 * Groesse.
 *
 * Die Schaetzung ist grosszuegig nach unten: eine Ueberschrift, die zwei Punkte
 * kleiner ist als noetig, sieht niemand. Eine, die ueber den Rand laeuft, sieht
 * jeder.
 */
function passendeGroesse(text: string, breite: number, basis: number, maxZeilen = 3): number {
  const zeichen = Math.max(text.length, 1);
  const proZeile = Math.max(Math.floor(breite / (0.52 * basis)), 1);
  const zeilen = Math.ceil(zeichen / proZeile);
  if (zeilen <= maxZeilen) {
    return basis;
  }
  // Linear verkleinern, bis die Zeilenzahl passt - mit einer Untergrenze, unter
  // der auch die beste Komposition unleserlich wird.
  return Math.max(Math.round(basis * (maxZeilen / zeilen)), 22);
}

/** Grossschreibung in JavaScript, weil Satori `text-transform` nicht kennt. */
const gross = (text: string): string => text.toLocaleUpperCase('de-CH');

/**
 * Die Marke oben links - in jeder Vorlage dieselbe, damit sie wiedererkennbar ist.
 *
 * ## Drei Faelle, und sie sind eine Entscheidung des Servers
 *
 * `'keins'` laesst die Stelle leer: fuer wen die Grafik in einem Account steht,
 * dessen Name schon darueber steht. Eine `data:`-URI zeichnet das Logo, das
 * unter Branding hochgeladen ist. `null` zeichnet das Signet - ein Rechteck in
 * der Akzentfarbe und das Wortzeichen daneben.
 *
 * ## Warum das Logo als Bytes kommt und nicht als Adresse
 *
 * Weil Satori eine Adresse abrufen wuerde. Der Export haengt dann an einem
 * Server, der antworten muss, waehrend jemand auf eine PNG-Datei wartet - und
 * bei einer Adresse aus fremder Hand waere es ausserdem ein Abruf, den
 * jemand anderes bestimmt. Die Bytes kommen deshalb von der Platte, gelesen
 * durch `readUpload`, und stehen fertig in der Komponente.
 */
function Marke({ klein, marke }: { klein: boolean; marke: FolienMarke }): React.JSX.Element | null {
  if (marke.logo === 'keins') {
    return null;
  }
  if (marke.logo !== null) {
    return (
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- Satori kennt
            kein next/image; die Bytes stehen ohnehin schon in der `src`. */}
        <img
          src={marke.logo}
          alt=""
          /*
           * Hoehe fest, Breite laeuft mit.
           *
           * Ein hochgeladenes Logo kann quadratisch oder breit sein. Beide auf
           * dieselbe Breite zu zwingen hiesse, eines davon zu verzerren - die
           * Hoehe ist die Groesse, die neben dem Text stimmen muss.
           */
          height={klein ? 44 : 54}
          style={{ height: klein ? 44 : 54, objectFit: 'contain' }}
        />
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      {/* Ein Rechteck in der Akzentfarbe als Signet - gezeichnet, keine Datei. */}
      <div
        style={{
          display: 'flex',
          width: klein ? 10 : 12,
          height: klein ? 34 : 42,
          backgroundColor: marke.akzentHell,
        }}
      />
      <div
        style={{
          display: 'flex',
          marginLeft: klein ? 16 : 20,
          fontSize: klein ? 26 : 32,
          fontWeight: 700,
          letterSpacing: klein ? 6 : 8,
          color: WEISS,
        }}
      >
        {gross('SwissHub fragt')}
      </div>
    </div>
  );
}

/** Der Satz, der unten links stand, bevor er einstellbar war. */
export const STANDARD_ZUSATZTEXT = 'Die SwissHub Community hat entschieden.';

/**
 * Die Schriftgroesse der Fusszeile - abhaengig davon, wie lang der Text ist.
 *
 * ## Warum das gerechnet und nicht festgesetzt ist
 *
 * Weil der Text einstellbar wurde. Der Standardsatz hat 39 Zeichen und passte
 * bei jeder Groesse; erlaubt sind jetzt 80. Bei 28 Punkt und 3 Punkt
 * Laufweite braucht ein Zeichen rund 18 Pixel - achtzig davon sind 1470, und
 * die Fusszeile hat etwa 640. Satori bricht dann um, die Zeile wird zwei oder
 * drei hoch, und sie schiebt den unteren Rand aus dem Bild. Das sieht man
 * nicht im Code und nicht in der Vorschau, sondern erst auf dem Telefon,
 * nachdem es gepostet ist.
 *
 * `passendeGroesse` rechnet die Groesse aus, bei der der Text in **eine**
 * Zeile passt - dieselbe Schaetzung, die die Ueberschriften benutzen, mit
 * derselben Untergrenze. Ein Text, der dafuer zu lang ist, wird klein und
 * bleibt lesbar; einer, der kurz ist, bekommt die volle Groesse und sieht aus
 * wie vorher.
 *
 * 640 ist die schmalere der beiden Flaechen (Story: 1080 minus zweimal 96
 * Rand, davon 72 Prozent). Die breitere mit demselben Wert zu rechnen macht
 * den Text dort eine Nuance kleiner als noetig - das sieht niemand, und eine
 * Zahl ist besser als zwei, die auseinanderlaufen koennen.
 */
const FUSS_BREITE = 640;

function fussGroesse(text: string, klein: boolean): number {
  return passendeGroesse(text, FUSS_BREITE, klein ? 24 : 28, 1);
}

/**
 * Die Fusszeile - die Zahl der Stimmen, nie erfunden.
 *
 * `stimmen: null` heisst «nicht zeigen» und nicht «null Stimmen». Deshalb
 * `null` und keine 0: eine 0 waere eine Aussage, und zwar eine falsche.
 */
function Fuss({
  klein,
  stimmen,
  zusatz,
}: {
  klein: boolean;
  stimmen: number | null;
  zusatz?: string;
}): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', height: 1, backgroundColor: LINIE, marginBottom: klein ? 20 : 26 }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div
          style={{
            display: 'flex',
            fontSize: fussGroesse(zusatz ?? STANDARD_ZUSATZTEXT, klein),
            letterSpacing: 3,
            color: GEDAEMPFT,
            maxWidth: '72%',
          }}
        >
          {gross(zusatz ?? STANDARD_ZUSATZTEXT)}
        </div>
        {stimmen === null ? null : (
          <div style={{ display: 'flex', fontSize: klein ? 24 : 28, color: LEISE }}>
            {stimmen} {stimmen === 1 ? 'Stimme' : 'Stimmen'}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Die Daten, die eine Folie braucht --------------------------------------

export interface SocialDaten {
  frageText: string;
  untertitel: string | null;
  ueberschrift: string;
  cta: string;
  /**
   * Die Zeilen aus dem festgeschriebenen Ergebnis.
   *
   * Sie kommen aus `FragtAbstimmung.ergebnis` und werden hier nur gezeichnet.
   * Es gibt in dieser Datei keinen Weg, eine Zahl zu setzen - das ist der Grund,
   * warum der Editor Texte aendern kann und Zahlen nicht.
   */
  zeilen: Array<{ label: string; prozent: number; stimmen: number; fuehrt: boolean }>;
  gesamt: number;
  gewinner: { label: string; prozent: number; stimmen: number } | null;
  /** Bei Gleichstand die beteiligten Antworten - dann gibt es keinen Gewinner. */
  gleichstand: string[];
  /**
   * Steht die absolute Stimmenzahl auf der Folie?
   *
   * Die **Prozente stehen immer** darauf - sie sind die Aussage, und ein
   * Ergebnis ohne sie waere keines. Abschaltbar ist nur die absolute Zahl:
   * bei 300 Stimmen traegt sie, bei 12 lenkt sie vom Ergebnis ab. Diese
   * Entscheidung trifft, wer die Grafik postet.
   *
   * Sie kommt aus dem Entwurf und ist die einzige Angabe von dort, die das
   * Bild veraendert. Verfaelschen kann sie nichts: sie laesst eine Zahl weg
   * oder nicht, sie setzt keine.
   */
  stimmenZeigen: boolean;
}

export interface FolienAuftrag {
  art: fragt.FolienArt;
  format: SocialFormat;
  daten: SocialDaten;
  /**
   * Farbe, Zeichen und Zusatztext dieses Servers.
   *
   * Optional, damit kein Aufrufer sie setzen **muss** - fehlt sie, gilt
   * `STANDARD_MARKE`, also genau das, was vorher fest im Code stand. Das ist
   * keine Nachsicht gegenueber Aufrufern, sondern die Zusage, dass eine
   * vergessene Marke ein richtiges Bild ergibt und kein schwarzes.
   */
  marke?: FolienMarke;
}

/** Ein Dateiname, der in einem ZIP und auf einem Telefon Sinn ergibt. */
export function folienDateiname(position: number, art: fragt.FolienArt, format: SocialFormat): string {
  return `swisshub-fragt-${String(position + 1).padStart(2, '0')}-${art}-${format}.png`;
}

// --- Die Folien --------------------------------------------------------------

/**
 * Die eine Einstiegsstelle.
 *
 * Vorschau und Export rufen dieselbe Funktion - das ist die Zusage, dass beide
 * dasselbe zeigen. Zwei Komponenten mit demselben Layout waeren zwei Layouts,
 * sobald eines davon angefasst wird.
 */
export function zeichneSocialFolie(auftrag: FolienAuftrag): React.JSX.Element {
  // Die Marke genau hier einsetzen und nicht in jeder Folie: so gibt es eine
  // Stelle, die entscheidet, was «nicht eingestellt» bedeutet.
  const vollstaendig: Erfuellt = { ...auftrag, marke: auftrag.marke ?? STANDARD_MARKE };
  switch (auftrag.art) {
    case 'frage':
      return <FolieFrage {...vollstaendig} />;
    case 'gewinner':
      return <FolieGewinner {...vollstaendig} />;
    case 'verteilung':
      return <FolieVerteilung {...vollstaendig} />;
    case 'duell':
      return <FolieDuell {...vollstaendig} />;
    case 'cta':
      return <FolieAufruf {...vollstaendig} />;
  }
}

/**
 * Die Schlagzeile einer Folie.
 *
 * ## Warum das eine Funktion ist und kein Feldzugriff
 *
 * Weil es zwei Quellen gibt und genau eine Regel, welche gilt. Jede Folie
 * zeichnete bisher `daten.frageText` - den Wortlaut, den die Leute beim
 * Abstimmen gelesen haben. Die **Ueberschrift** daneben ist redaktionell: sie
 * ist dafuer da, dass eine Frage auf Instagram anders klingen darf als auf
 * Discord. So stand es im Datenmodell, so stand es im Kommentar in `daten.ts`
 * - und sie wurde von keiner einzigen Folie gelesen.
 *
 * Das Feld war also einstellbar, wurde gespeichert und erschien per
 * Konstruktion nirgends. Kein Statuscode und kein Unit-Test ueber das DTO
 * zeigt das; man sieht es erst, wenn man das Bild anschaut.
 *
 * Jetzt gilt: steht eine Ueberschrift da, ist **sie** die Schlagzeile, auf
 * jeder Folie. Ist sie leer, bleibt es beim Wortlaut der Frage - das Verhalten
 * von vorher. Eine Stelle entscheidet das, damit die fuenf Folien nicht
 * auseinanderlaufen koennen.
 */
export function schlagzeile(daten: SocialDaten): string {
  const eigene = daten.ueberschrift.trim();
  return eigene === '' ? daten.frageText : eigene;
}

/** Ein Auftrag, dessen Marke schon gesetzt ist - was die Folien bekommen. */
type Erfuellt = FolienAuftrag & { marke: FolienMarke };

/** Die Vorlage eines Einzelbildes auf die Folienart abbilden. */
export function vorlageZuFolienArt(vorlage: fragt.Vorlage): fragt.FolienArt {
  return vorlage === 'winner' ? 'gewinner' : vorlage === 'duel' ? 'duell' : 'verteilung';
}

/** Der gemeinsame Rahmen: Hintergrund, Rand, Marke oben, Inhalt darunter. */
function Buehne({
  format,
  marke,
  children,
  fuss,
  /** Ein zweiter Farbton unten - gibt der Flaeche Tiefe ohne ein Bild. */
  glut = true,
}: {
  format: SocialFormat;
  marke: FolienMarke;
  children: React.ReactNode;
  fuss: React.ReactNode;
  glut?: boolean;
}): React.JSX.Element {
  const mass = SOCIAL_MASSE[format];
  const klein = format !== 'story';
  const rand = klein ? 76 : 96;

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: rand,
        position: 'relative',
        backgroundColor: SCHWARZ,
        color: WEISS,
        fontFamily: 'sans-serif',
      }}
    >
      {/*
        Die Tiefe im Hintergrund.

        Ein Verlauf von unten, kein erzeugtes Bild: die Aufgabe schliesst
        AI-Hintergruende aus, und ein Foto wuerde bei jedem Export anders
        aussehen. Zwei Farbflaechen und eine Kante geben der Flaeche
        genug - und sie sind auf einem Telefon in Sekundenbruchteilen da.
      */}
      {glut ? (
        <div
          style={{
            position: 'absolute',
            left: 0,
            bottom: 0,
            width: mass.breite,
            height: Math.round(mass.hoehe * 0.55),
            backgroundImage: `linear-gradient(to top, ${marke.akzent}33, ${SCHWARZ}00)`,
            display: 'flex',
          }}
        />
      ) : null}
      {/* Eine schraege Kante oben rechts - das wiederkehrende geometrische
          Zeichen dieser Serie. */}
      <div
        style={{
          position: 'absolute',
          top: -Math.round(mass.breite * 0.22),
          right: -Math.round(mass.breite * 0.28),
          width: Math.round(mass.breite * 0.7),
          height: Math.round(mass.breite * 0.7),
          backgroundColor: TIEF,
          transform: 'rotate(38deg)',
          display: 'flex',
        }}
      />

      <div style={{ display: 'flex', flexDirection: 'column', position: 'relative' }}>
        <Marke klein={klein} marke={marke} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', position: 'relative', flexGrow: 1 }}>
        {children}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', position: 'relative' }}>{fuss}</div>
    </div>
  );
}

/**
 * Folie 1 - die Frage.
 *
 * Ohne Zahlen. Das ist der Sinn: die erste Folie eines Carousels soll die Frage
 * stellen, nicht sie beantworten. Wer im Feed daruebergleitet, liest die Frage
 * und wischt weiter, um das Ergebnis zu sehen.
 */
function FolieFrage({ format, daten, marke }: Erfuellt): React.JSX.Element {
  const mass = SOCIAL_MASSE[format];
  const klein = format !== 'story';
  const innen = mass.breite - (klein ? 76 : 96) * 2;

  return (
    <Buehne
      format={format}
      marke={marke}
      glut={false}
      fuss={
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{ display: 'flex', height: 1, backgroundColor: LINIE, marginBottom: klein ? 20 : 26 }}
          />
          <div
            style={{
              display: 'flex',
              fontSize: fussGroesse(marke.zusatztext ?? 'Abgestimmt auf unserem Discord', klein),
              letterSpacing: 3,
              color: GEDAEMPFT,
            }}
          >
            {/*
              Der eingestellte Zusatztext gilt auch hier.
              
              Diese Folie hat eine eigene Fusszeile und keine `<Fuss>`: sie
              traegt keine Stimmenzahl, denn sie stellt die Frage und
              beantwortet sie nicht. Der Satz unten muss trotzdem derselbe sein
              wie auf dem Ergebnis - sonst steht die Frage in Serverfarben mit
              Serversatz und das Ergebnis daneben mit einem anderen.
            */}
            {gross(marke.zusatztext ?? 'Abgestimmt auf unserem Discord')}
          </div>
        </div>
      }
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          flexGrow: 1,
          paddingTop: klein ? 20 : 40,
        }}
      >
        {/* Die rote Marke vor der Frage - dasselbe Zeichen wie im Signet, nur
            gross. Sie fuehrt das Auge an den Textanfang. */}
        <div
          style={{ display: 'flex', width: klein ? 84 : 104, height: 8, backgroundColor: marke.akzentHell }}
        />
        <div
          style={{
            display: 'flex',
            marginTop: klein ? 34 : 46,
            fontSize: passendeGroesse(schlagzeile(daten), innen, klein ? 86 : 104, 4),
            fontWeight: 700,
            lineHeight: 1.08,
            color: WEISS,
          }}
        >
          {schlagzeile(daten)}
        </div>
        {daten.untertitel ? (
          <div
            style={{
              display: 'flex',
              marginTop: klein ? 28 : 36,
              fontSize: klein ? 34 : 40,
              lineHeight: 1.3,
              color: GEDAEMPFT,
            }}
          >
            {daten.untertitel}
          </div>
        ) : null}
      </div>
    </Buehne>
  );
}

/**
 * Folie «The Winner» - eine Zahl, gross.
 *
 * Die Komposition ist eine Zahl und ein Name, und alles andere ist klein. Bei
 * Gleichstand gibt es keinen Gewinner - dann steht das da, statt einer von zwei
 * gleichstarken Antworten.
 */
function FolieGewinner({ format, daten, marke }: Erfuellt): React.JSX.Element {
  const mass = SOCIAL_MASSE[format];
  const klein = format !== 'story';
  const innen = mass.breite - (klein ? 76 : 96) * 2;

  if (!daten.gewinner) {
    return <FolieOhneGewinner format={format} daten={daten} marke={marke} />;
  }

  return (
    <Buehne
      format={format}
      marke={marke}
      fuss={
        <Fuss
          klein={klein}
          stimmen={daten.stimmenZeigen ? daten.gesamt : null}
          {...(marke.zusatztext ? { zusatz: marke.zusatztext } : {})}
        />
      }
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          flexGrow: 1,
        }}
      >
        <div
          style={{
            display: 'flex',
            fontSize: passendeGroesse(schlagzeile(daten), innen, klein ? 40 : 48, 3),
            lineHeight: 1.18,
            color: GEDAEMPFT,
          }}
        >
          {schlagzeile(daten)}
        </div>

        {/*
          Die Prozentzahl.

          Absichtlich riesig und mit `lineHeight: 0.82` eng gesetzt: eine Zahl,
          die den Raum fuellt, ist auf einem Telefon im Vorbeiscrollen lesbar.
          Die Ziffern sind das Bild dieser Vorlage.
        */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            marginTop: klein ? 36 : 54,
          }}
        >
          <div
            style={{
              display: 'flex',
              fontSize: klein ? 300 : 380,
              fontWeight: 700,
              lineHeight: 0.82,
              color: WEISS,
            }}
          >
            {daten.gewinner.prozent}
          </div>
          <div
            style={{
              display: 'flex',
              marginTop: klein ? 30 : 44,
              marginLeft: klein ? 14 : 20,
              fontSize: klein ? 84 : 108,
              fontWeight: 700,
              color: marke.akzentHell,
            }}
          >
            %
          </div>
        </div>

        {/* Der Name des Gewinners, auf rotem Grund. Der Balken ist die zweite
            geometrische Form dieser Vorlage - er bindet Zahl und Name
            zusammen. */}
        <div
          style={{
            display: 'flex',
            marginTop: klein ? 30 : 44,
            paddingTop: klein ? 18 : 24,
            paddingBottom: klein ? 18 : 24,
            paddingLeft: klein ? 26 : 34,
            paddingRight: klein ? 26 : 34,
            backgroundColor: marke.akzent,
            maxWidth: '100%',
          }}
        >
          <div
            style={{
              display: 'flex',
              fontSize: passendeGroesse(daten.gewinner.label, innen - 68, klein ? 64 : 78, 2),
              fontWeight: 700,
              lineHeight: 1.1,
              color: WEISS,
            }}
          >
            {daten.gewinner.label}
          </div>
        </div>

        {daten.stimmenZeigen ? (
          <div
            style={{
              display: 'flex',
              marginTop: klein ? 22 : 30,
              fontSize: klein ? 28 : 32,
              color: LEISE,
            }}
          >
            {daten.gewinner.stimmen} von {daten.gesamt} {daten.gesamt === 1 ? 'Stimme' : 'Stimmen'}
          </div>
        ) : null}
      </div>
    </Buehne>
  );
}

/**
 * Wenn es keinen Gewinner gibt.
 *
 * Gleichstand oder null Stimmen. Beides ist ein Ergebnis und bekommt eine
 * eigene Aussage - eine Vorlage, die dann eine leere Flaeche zeigt oder
 * willkuerlich eine Antwort hervorhebt, waere eine Behauptung.
 */
function FolieOhneGewinner({
  format,
  daten,
  marke,
}: {
  format: SocialFormat;
  daten: SocialDaten;
  marke: FolienMarke;
}): React.JSX.Element {
  const mass = SOCIAL_MASSE[format];
  const klein = format !== 'story';
  const innen = mass.breite - (klein ? 76 : 96) * 2;
  const gleichstand = daten.gleichstand.length > 0;

  return (
    <Buehne
      format={format}
      marke={marke}
      fuss={
        <Fuss
          klein={klein}
          stimmen={daten.stimmenZeigen ? daten.gesamt : null}
          /*
           * «Kein Sieger» sticht den eingestellten Zusatztext.
           *
           * Der Satz ist hier nicht Schmuck, sondern die Erklaerung der Folie:
           * ohne ihn steht «Gleichstand» da und niemand weiss, ob das Absicht
           * ist. Ein Serversatz ueber Gleichstand erklaert nichts.
           */
          zusatz={gleichstand ? 'Kein Sieger. Auch das ist ein Ergebnis.' : (marke.zusatztext ?? undefined)}
        />
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', flexGrow: 1 }}>
        <div
          style={{
            display: 'flex',
            fontSize: passendeGroesse(schlagzeile(daten), innen, klein ? 40 : 48, 3),
            lineHeight: 1.18,
            color: GEDAEMPFT,
          }}
        >
          {schlagzeile(daten)}
        </div>
        <div
          style={{
            display: 'flex',
            marginTop: klein ? 40 : 56,
            fontSize: klein ? 96 : 124,
            fontWeight: 700,
            lineHeight: 1,
            color: WEISS,
          }}
        >
          {gleichstand ? gross('Gleichstand') : gross('Keine Stimmen')}
        </div>
        {gleichstand ? (
          <div
            style={{
              display: 'flex',
              marginTop: klein ? 30 : 42,
              fontSize: passendeGroesse(daten.gleichstand.join(' · '), innen, klein ? 48 : 58, 3),
              lineHeight: 1.2,
              color: marke.akzentHell,
              fontWeight: 700,
            }}
          >
            {daten.gleichstand.join('  ·  ')}
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              marginTop: klein ? 26 : 34,
              fontSize: klein ? 34 : 40,
              color: GEDAEMPFT,
            }}
          >
            Diesmal hat niemand abgestimmt.
          </div>
        )}
      </div>
    </Buehne>
  );
}

/**
 * Folie «The Results» - alle Antworten mit ihrer Verteilung.
 *
 * Eine Liste, kein Diagramm. Die Balken sind Rechtecke mit einer Breite in
 * Prozent - kein Achsenkreuz, keine Gitterlinien, keine Legende. Genau das
 * meint «keine generischen SaaS-Charts»: hier gibt es nichts zu entschluesseln,
 * die Zahl steht am Balken.
 */
function FolieVerteilung({ format, daten, marke }: Erfuellt): React.JSX.Element {
  const mass = SOCIAL_MASSE[format];
  const klein = format !== 'story';
  const innen = mass.breite - (klein ? 76 : 96) * 2;

  /*
   * Die Schriftgroesse richtet sich nach der Zahl der Zeilen.
   *
   * Fuenf Antworten in einem Quadrat brauchen weniger Hoehe je Zeile als zwei
   * in einer Story. Ohne diese Rechnung liefe die fuenfte Zeile aus dem Bild -
   * und zwar nur bei fuenf Antworten, also genau bei der Frage, die niemand
   * vorher testet.
   */
  const zeilen = Math.max(daten.zeilen.length, 1);
  const platz = mass.hoehe * (klein ? 0.46 : 0.52);
  const zeilenHoehe = platz / zeilen;
  const labelGroesse = Math.min(Math.max(Math.round(zeilenHoehe * 0.26), 24), klein ? 46 : 54);
  const zahlGroesse = Math.min(Math.max(Math.round(zeilenHoehe * 0.32), 28), klein ? 58 : 68);
  const balkenHoehe = Math.min(Math.max(Math.round(zeilenHoehe * 0.2), 12), 28);

  return (
    <Buehne
      format={format}
      marke={marke}
      fuss={
        <Fuss
          klein={klein}
          stimmen={daten.stimmenZeigen ? daten.gesamt : null}
          {...(marke.zusatztext ? { zusatz: marke.zusatztext } : {})}
        />
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', flexGrow: 1 }}>
        <div
          style={{
            display: 'flex',
            fontSize: passendeGroesse(schlagzeile(daten), innen, klein ? 52 : 62, 3),
            fontWeight: 700,
            lineHeight: 1.12,
            color: WEISS,
            marginBottom: klein ? 40 : 56,
          }}
        >
          {schlagzeile(daten)}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {daten.zeilen.map((zeile) => (
            <div
              key={zeile.label}
              style={{
                display: 'flex',
                flexDirection: 'column',
                marginBottom: Math.round(zeilenHoehe * 0.22),
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-end',
                  marginBottom: Math.round(balkenHoehe * 0.55),
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    fontSize: labelGroesse,
                    fontWeight: zeile.fuehrt ? 700 : 400,
                    lineHeight: 1.15,
                    // Die fuehrende Antwort in Weiss, die uebrigen gedaempft:
                    // der Unterschied ist auf einem Telefon schneller zu sehen
                    // als der Vergleich zweier Balkenlaengen.
                    color: zeile.fuehrt ? WEISS : GEDAEMPFT,
                    maxWidth: '72%',
                  }}
                >
                  {zeile.label}
                </div>
                <div
                  style={{
                    display: 'flex',
                    fontSize: zahlGroesse,
                    fontWeight: 700,
                    lineHeight: 1,
                    color: zeile.fuehrt ? marke.akzentHell : LEISE,
                  }}
                >
                  {zeile.prozent} %
                </div>
              </div>

              {/* Der Balken. Die Spur bleibt sichtbar, damit die Laenge einen
                  Bezug hat - ohne sie waere ein 12-%-Balken einfach ein
                  kurzer Strich. */}
              <div
                style={{
                  display: 'flex',
                  width: '100%',
                  height: balkenHoehe,
                  backgroundColor: 'rgba(255,255,255,0.08)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    // Auch eine Antwort mit 0 % bekommt einen Rest: eine
                    // Zeile ohne jeden Balken sieht aus wie ein Fehler.
                    width: `${Math.max(zeile.prozent, 1)}%`,
                    height: '100%',
                    backgroundColor: zeile.fuehrt ? marke.akzentHell : 'rgba(255,255,255,0.26)',
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </Buehne>
  );
}

/**
 * Folie «The Duel» - die Flaeche in zwei Haelften.
 *
 * Nur fuer zwei Antworten. Die Teilung wechselt mit dem Format: in der Story
 * uebereinander, im Feed und im Quadrat nebeneinander - weil eine hohe Flaeche
 * sich anders teilen laesst als eine breite, und eine Story mit zwei schmalen
 * Spalten waere zwei Spalten Text.
 */
function FolieDuell({ format, daten, marke }: Erfuellt): React.JSX.Element {
  const mass = SOCIAL_MASSE[format];
  const klein = format !== 'story';
  const uebereinander = format === 'story';

  // Ohne genau zwei Antworten ist die Duell-Komposition sinnlos - dann die
  // Liste. Besser eine passende Vorlage als eine leere Haelfte.
  if (daten.zeilen.length !== 2) {
    return <FolieVerteilung art="verteilung" format={format} daten={daten} marke={marke} />;
  }

  const [links, rechts] = daten.zeilen as [SocialDaten['zeilen'][0], SocialDaten['zeilen'][0]];
  /*
   * Wer unten als Absender steht.
   *
   * Diese Folie hat eine einzeilige Fusszeile statt `<Fuss>` - die beiden
   * Haelften fuellen die Flaeche, eine zweizeilige Zeile daneben haette keinen
   * Platz. Der Absender ist deshalb kurz, und ein eingestellter Zusatztext
   * ersetzt ihn: «SwissHub Community» steht sonst auch auf der Grafik eines
   * Servers, der nicht SwissHub ist.
   */
  const absender = marke.zusatztext ?? 'SwissHub Community';
  const fussZeile = daten.stimmenZeigen
    ? `${daten.gesamt} ${daten.gesamt === 1 ? 'Stimme' : 'Stimmen'} · ${absender}`
    : absender;
  const haelfteBreite = uebereinander ? mass.breite : mass.breite / 2;

  const Haelfte = ({
    zeile,
    fuehrend,
  }: {
    zeile: SocialDaten['zeilen'][0];
    fuehrend: boolean;
  }): React.JSX.Element => (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: uebereinander ? 'flex-start' : 'center',
        width: uebereinander ? '100%' : '50%',
        height: uebereinander ? '50%' : '100%',
        padding: klein ? 64 : 88,
        // Die Haelfte der fuehrenden Antwort ist rot, die andere fast schwarz.
        // Das ist die Aussage dieser Vorlage: eine Seite hat gewonnen.
        backgroundColor: fuehrend ? marke.akzent : TIEF,
      }}
    >
      <div
        style={{
          display: 'flex',
          fontSize: klein ? 150 : 190,
          fontWeight: 700,
          lineHeight: 0.9,
          color: fuehrend ? WEISS : 'rgba(255,255,255,0.5)',
        }}
      >
        {zeile.prozent}
        <div style={{ display: 'flex', fontSize: klein ? 56 : 70, marginTop: klein ? 14 : 20 }}>%</div>
      </div>
      <div
        style={{
          display: 'flex',
          marginTop: klein ? 22 : 30,
          fontSize: passendeGroesse(zeile.label, haelfteBreite - (klein ? 128 : 176), klein ? 54 : 64, 2),
          fontWeight: 700,
          lineHeight: 1.1,
          textAlign: uebereinander ? 'left' : 'center',
          color: fuehrend ? WEISS : 'rgba(255,255,255,0.72)',
        }}
      >
        {zeile.label}
      </div>
      {daten.stimmenZeigen ? (
        <div
          style={{
            display: 'flex',
            marginTop: klein ? 14 : 20,
            fontSize: klein ? 26 : 30,
            color: fuehrend ? 'rgba(255,255,255,0.7)' : LEISE,
          }}
        >
          {zeile.stimmen} {zeile.stimmen === 1 ? 'Stimme' : 'Stimmen'}
        </div>
      ) : null}
    </div>
  );

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        backgroundColor: SCHWARZ,
        fontFamily: 'sans-serif',
      }}
    >
      {/* Die beiden Haelften fuellen die Flaeche. Marke und Frage liegen als
          Ebene darueber - dadurch bleibt die Teilung sichtbar und der Text
          steht trotzdem im ersten Drittel, wo man ihn liest. */}
      <div
        style={{
          display: 'flex',
          flexDirection: uebereinander ? 'column' : 'row',
          width: '100%',
          height: '100%',
        }}
      >
        <Haelfte zeile={links} fuehrend={links.fuehrt} />
        <Haelfte zeile={rechts} fuehrend={rechts.fuehrt} />
      </div>

      {/* Die Trennlinie - und in ihrer Mitte das Zeichen. */}
      <div
        style={{
          position: 'absolute',
          ...(uebereinander
            ? { left: 0, top: mass.hoehe / 2 - 2, width: mass.breite, height: 4 }
            : { top: 0, left: mass.breite / 2 - 2, width: 4, height: mass.hoehe }),
          backgroundColor: SCHWARZ,
          display: 'flex',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: mass.breite / 2 - (klein ? 52 : 60),
          top: mass.hoehe / 2 - (klein ? 52 : 60),
          width: klein ? 104 : 120,
          height: klein ? 104 : 120,
          backgroundColor: SCHWARZ,
          borderRadius: klein ? 52 : 60,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            display: 'flex',
            fontSize: klein ? 38 : 44,
            fontWeight: 700,
            letterSpacing: 2,
            color: WEISS,
          }}
        >
          VS
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          left: klein ? 64 : 88,
          top: klein ? 56 : 76,
          display: 'flex',
          flexDirection: 'column',
          maxWidth: mass.breite - (klein ? 128 : 176),
        }}
      >
        <Marke klein={klein} marke={marke} />
        <div
          style={{
            display: 'flex',
            marginTop: klein ? 22 : 30,
            fontSize: passendeGroesse(
              schlagzeile(daten),
              mass.breite - (klein ? 128 : 176),
              klein ? 44 : 52,
              2,
            ),
            fontWeight: 700,
            lineHeight: 1.1,
            color: WEISS,
          }}
        >
          {schlagzeile(daten)}
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          left: klein ? 64 : 88,
          bottom: klein ? 48 : 64,
          display: 'flex',
          // Gemessen wird die **ganze** Zeile, nicht nur der Absender: Zahl und
          // Absender stehen hier zusammen, und zusammen laufen sie um.
          fontSize: fussGroesse(fussZeile, klein),
          letterSpacing: 3,
          color: 'rgba(255,255,255,0.7)',
        }}
      >
        {/* Ohne die Zahl bleibt der Absender stehen - eine leere Zeile waere
            eine Luecke, und die Zeile traegt hier auch den Absender. Der
            Absender ist der eingestellte Zusatztext, wenn es einen gibt. */}
        {gross(fussZeile)}
      </div>
    </div>
  );
}

/**
 * Folie «CTA» - der Aufruf.
 *
 * Die letzte Folie eines Carousels. Sie zeigt keine Zahlen: wer bis hierhin
 * gewischt hat, kennt sie.
 */
function FolieAufruf({ format, daten, marke }: Erfuellt): React.JSX.Element {
  const mass = SOCIAL_MASSE[format];
  const klein = format !== 'story';
  const innen = mass.breite - (klein ? 76 : 96) * 2;
  const aufruf = daten.cta.trim();

  return (
    <Buehne
      format={format}
      marke={marke}
      fuss={
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{ display: 'flex', height: 1, backgroundColor: LINIE, marginBottom: klein ? 20 : 26 }}
          />
          <div
            style={{
              display: 'flex',
              fontSize: fussGroesse(marke.zusatztext ?? 'Jede Woche eine neue Frage', klein),
              letterSpacing: 3,
              color: GEDAEMPFT,
            }}
          >
            {gross(marke.zusatztext ?? 'Jede Woche eine neue Frage')}
          </div>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', flexGrow: 1 }}>
        {/*
          Ein grosses rotes Feld, in dem der Aufruf steht. Die Vorlage hat
          genau ein Element - das ist ihre Aufgabe.

          Ohne Aufruf bleibt das Feld weg. Ein leeres farbiges Rechteck waere
          kein Aufruf, sondern eine Flaeche, die aussieht wie ein Fehler; und
          `passendeGroesse('')` rechnete dafuer auch noch die groesste Schrift
          aus. Wer die Folie ganz loswerden will, schaltet sie im Studio ab -
          das steht als Hinweis neben dem Feld.
        */}
        {aufruf === '' ? null : (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              padding: klein ? 52 : 68,
              backgroundColor: marke.akzent,
            }}
          >
            <div
              style={{
                display: 'flex',
                fontSize: passendeGroesse(aufruf, innen - (klein ? 104 : 136), klein ? 68 : 84, 4),
                fontWeight: 700,
                lineHeight: 1.14,
                color: WEISS,
              }}
            >
              {aufruf}
            </div>
          </div>
        )}
      </div>
    </Buehne>
  );
}
