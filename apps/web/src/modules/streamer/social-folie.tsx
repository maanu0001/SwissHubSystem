import type { OeffentlicherStreamerDaten } from '@swisshub/modules/streamer/typen';

/**
 * Die Spotlight-Grafik fuer Social Media.
 *
 * ## Warum gezeichnet und nicht abfotografiert
 *
 * Ein Screenshot des Dashboards haette die Breite des Fensters, die Schrift des
 * Systems, eine Navigationsleiste und mit etwas Pech einen Ladezustand darin.
 * Hier entsteht das Bild aus einer Komponente in fester Groesse - **derselben**,
 * die auch die Vorschau im Studio zeigt. Das ist der einzige Weg, auf dem
 * Vorschau und Export garantiert gleich aussehen (§10.4).
 *
 * Gerendert wird mit `next/og` (Satori), wie bei Wrapped und «SwissHub fragt».
 * Kein Puppeteer, kein Canvas, keine zusaetzliche Infrastruktur.
 *
 * ## Was Satori nicht kann
 *
 * Kein `clip-path`, kein `text-transform`, kein `box-shadow` mit Streuung, kein
 * `gap` in jedem Fall. Grossschreibung passiert deshalb in JavaScript, und die
 * Geometrie ist aus Rechtecken und Raendern gebaut. Wer hier CSS ergaenzt, das
 * der Browser versteht, bekommt im PNG ein leeres Kaestchen - und das faellt
 * erst beim Export auf.
 *
 * ## Warum kein AI-Hintergrund und keine Neonwand
 *
 * Weil das Bild einen Menschen vorstellt. Was darauf Aufmerksamkeit bekommt,
 * ist sein Name, sein Bild und wo man ihn findet. Ein generierter Hintergrund
 * waere Dekor, das mit der Person nichts zu tun hat - und in drei Monaten
 * erkennt man ihn als das, was er ist.
 *
 * Das Banner traegt die Flaeche, weil es dem Streamer gehoert. Hat er keines,
 * traegt sie der Verlauf seines Profils - auch der ist seine Wahl, und er ist
 * kein Platzhalter.
 */

// --- Format und Masse --------------------------------------------------------

export const SPOTLIGHT_FORMATE = ['story', 'feed', 'quadrat'] as const;
export type SpotlightFormat = (typeof SPOTLIGHT_FORMATE)[number];

export const SPOTLIGHT_MASSE: Record<SpotlightFormat, { breite: number; hoehe: number }> = {
  /** Instagram Story und Reels-Cover. */
  story: { breite: 1080, hoehe: 1920 },
  /** Instagram Feed und Carousel. */
  feed: { breite: 1080, hoehe: 1350 },
  /** Quadratisch - was X und LinkedIn am liebsten nehmen. */
  quadrat: { breite: 1080, hoehe: 1080 },
};

export function istFormat(wert: string): wert is SpotlightFormat {
  return (SPOTLIGHT_FORMATE as readonly string[]).includes(wert);
}

// --- Farben ------------------------------------------------------------------
//
// Fest und nicht aus den Design-Tokens: die Tokens sind CSS-Variablen, und
// Satori kennt keine. Die Werte sind dieselben - `--swisshub-rot` ist #83060a,
// und das steht so auch in `STREAMER_ACCENT_COLOR` fuer das Discord-Embed.

const ROT = '#83060a';
const ROT_HELL = '#c2181f';
const SCHWARZ = '#0a0a0b';
const WEISS = '#ffffff';
const GEDAEMPFT = 'rgba(255,255,255,0.66)';
const LEISE = 'rgba(255,255,255,0.38)';
const LINIE = 'rgba(255,255,255,0.12)';

/** Grossschreibung in JavaScript - `text-transform` kennt Satori nicht. */
const gross = (text: string): string => text.toLocaleUpperCase('de-CH');

/**
 * Die Masse je Format.
 *
 * Nicht dieselbe Grafik dreimal skaliert: eine Story hat 1920 Pixel Hoehe und
 * darf atmen, ein Quadrat hat 1080 und muss gedraengter sein. Die Zahlen hier
 * sind der Unterschied zwischen «passt» und «Text klebt am Rand».
 */
interface Rhythmus {
  /** Hoehe der Bannerflaeche oben. */
  bannerHoehe: number;
  /** Kantenlaenge des Profilbilds. */
  bildGroesse: number;
  /** Schriftgrad des Namens. */
  name: number;
  /** Schriftgrad der Beschreibung. */
  text: number;
  polster: number;
  /** Hoehe des Aufruf-Balkens unten. */
  aufruf: number;
}

const RHYTHMUS: Record<SpotlightFormat, Rhythmus> = {
  story: { bannerHoehe: 760, bildGroesse: 260, name: 96, text: 38, polster: 76, aufruf: 150 },
  feed: { bannerHoehe: 560, bildGroesse: 210, name: 78, text: 32, polster: 64, aufruf: 124 },
  quadrat: { bannerHoehe: 430, bildGroesse: 180, name: 66, text: 29, polster: 56, aufruf: 110 },
};

export interface SpotlightTexte {
  ueberschrift: string | null;
  beschreibung: string | null;
  cta: string | null;
}

export interface SpotlightEingabe {
  format: SpotlightFormat;
  streamer: OeffentlicherStreamerDaten;
  texte: SpotlightTexte;
  /**
   * Das Profilbild als Adresse oder Daten-URI.
   *
   * Als Parameter und nicht aus dem Streamer gelesen: der Export holt das Bild
   * selbst und reicht es als Daten-URI herein, weil Satori sonst waehrend des
   * Zeichnens einen Netzaufruf macht - und ein langsames CDN waere ein
   * Export, der ins Zeitlimit laeuft.
   */
  bildQuelle: string | null;
  /** Das Banner, ebenso. `null` = nur der Verlauf. */
  bannerQuelle: string | null;
}

/**
 * Die Grafik.
 *
 * Eine Komposition, drei Masse. Von oben nach unten: Bannerflaeche mit
 * Verlauf darueber, darin oben die Zeile «Streamer Spotlight»; darunter, halb
 * ins Banner ragend, das Profilbild; dann Name, Plattformzeile, Beschreibung,
 * Spiele; unten der rote Aufruf-Balken mit dem Kanal.
 */
export function zeichneSpotlight(eingabe: SpotlightEingabe): React.ReactElement {
  const { format, streamer, texte, bildQuelle, bannerQuelle } = eingabe;
  const { breite, hoehe } = SPOTLIGHT_MASSE[format];
  const mass = RHYTHMUS[format];

  const hauptkanal = streamer.kanaele[0] ?? null;
  const kanalZeile = hauptkanal
    ? `${hauptkanal.plattform === 'TWITCH' ? 'twitch.tv' : 'youtube.com'}/${hauptkanal.handle}`
    : '';

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
      {/* --- Bannerflaeche ---------------------------------------------------- */}
      <div
        style={{
          display: 'flex',
          position: 'absolute',
          top: 0,
          left: 0,
          width: breite,
          height: mass.bannerHoehe,
          /*
           * Der Verlauf des Profils. Satori versteht `linear-gradient` und
           * `radial-gradient`; die Werte kommen aus derselben Registry, aus
           * der sie auch im Profilkopf kommen.
           */
          backgroundImage: streamer.bannerVerlauf,
          backgroundColor: SCHWARZ,
        }}
      >
        {bannerQuelle ? (
          // Satori kennt `next/image` nicht; hier wird ein PNG gezeichnet,
          // keine Seite.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={bannerQuelle}
            alt=""
            width={breite}
            height={mass.bannerHoehe}
            style={{ width: breite, height: mass.bannerHoehe, objectFit: 'cover' }}
          />
        ) : null}
      </div>

      {/*
        Der Verlauf ins Schwarz.

        Zwei Ebenen statt einer: ein einzelner Verlauf ueber die ganze Hoehe
        wuerde die Mitte des Banners mattieren. So bleibt es oben klar und
        verschwindet erst unten - und der Name darunter steht auf Schwarz und
        nicht auf einem Bild, dessen Helligkeit niemand kennt.
      */}
      <div
        style={{
          display: 'flex',
          position: 'absolute',
          top: mass.bannerHoehe - 320,
          left: 0,
          width: breite,
          height: 320,
          backgroundImage: `linear-gradient(to bottom, rgba(10,10,11,0) 0%, ${SCHWARZ} 100%)`,
        }}
      />

      {/* Ein roter Schimmer oben links - dasselbe Motiv wie in der Anwendung. */}
      <div
        style={{
          display: 'flex',
          position: 'absolute',
          top: 0,
          left: 0,
          width: breite,
          height: Math.round(mass.bannerHoehe * 0.7),
          backgroundImage: `radial-gradient(70% 90% at 8% 0%, rgba(131,6,10,0.55) 0%, rgba(10,10,11,0) 62%)`,
        }}
      />

      {/* --- Die Zeile oben ---------------------------------------------------- */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          position: 'absolute',
          top: mass.polster,
          left: mass.polster,
        }}
      >
        <div
          style={{
            display: 'flex',
            width: 8,
            height: format === 'story' ? 44 : 34,
            backgroundColor: ROT_HELL,
            marginRight: 18,
          }}
        />
        <div
          style={{
            display: 'flex',
            fontSize: format === 'story' ? 30 : 24,
            fontWeight: 700,
            letterSpacing: 6,
            color: WEISS,
          }}
        >
          {gross(texte.ueberschrift ?? 'Streamer Spotlight')}
        </div>
      </div>

      {/* --- Profilbild -------------------------------------------------------- */}
      <div
        style={{
          display: 'flex',
          position: 'absolute',
          top: mass.bannerHoehe - Math.round(mass.bildGroesse / 2),
          left: mass.polster,
          width: mass.bildGroesse,
          height: mass.bildGroesse,
          /*
           * Der rote Rand ist die Fassung des Bildes. Kein Schatten: Satori
           * zeichnet `box-shadow` mit Streuung nicht, und ein Rand haelt hier
           * ohnehin besser - er trennt das Bild vom Banner darunter.
           */
          border: `6px solid ${ROT_HELL}`,
          borderRadius: 32,
          overflow: 'hidden',
          backgroundColor: '#18181b',
        }}
      >
        {bildQuelle ? (
          // eslint-disable-next-line @next/next/no-img-element -- siehe oben
          <img
            src={bildQuelle}
            alt=""
            width={mass.bildGroesse}
            height={mass.bildGroesse}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : null}
      </div>

      {/* --- Der Textblock ----------------------------------------------------- */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          position: 'absolute',
          top: mass.bannerHoehe + Math.round(mass.bildGroesse / 2) + 44,
          left: mass.polster,
          width: breite - mass.polster * 2,
        }}
      >
        <div
          style={{
            display: 'flex',
            fontSize: mass.name,
            fontWeight: 800,
            lineHeight: 1.02,
            letterSpacing: -2,
            /*
             * Lange Namen: der Schriftgrad bleibt, aber der Umbruch ist
             * erlaubt. Automatisch zu schrumpfen waere eine Grafik, deren
             * Name je Streamer anders gross ist - und im Feed faellt das auf.
             */
          }}
        >
          {streamer.name}
        </div>

        {kanalZeile ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              marginTop: 22,
              fontSize: format === 'quadrat' ? 26 : 30,
              color: ROT_HELL,
              fontWeight: 700,
            }}
          >
            {kanalZeile}
          </div>
        ) : null}

        {texte.beschreibung ? (
          <div
            style={{
              display: 'flex',
              marginTop: 26,
              fontSize: mass.text,
              lineHeight: 1.45,
              color: GEDAEMPFT,
              maxWidth: breite - mass.polster * 2,
            }}
          >
            {texte.beschreibung}
          </div>
        ) : null}

        {/*
          Die Spiele - nur die, die oeffentlich sind.

          Sie kommen aus `OeffentlicherStreamerDaten`, und dort stehen sie nur,
          wenn die Person ihre Spiele oeffentlich zeigt. Das Studio filtert
          nichts: was es nicht bekommt, kann es nicht zeichnen.
        */}
        {streamer.spiele.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', marginTop: 34 }}>
            {streamer.spiele.slice(0, format === 'quadrat' ? 3 : 4).map((spiel) => (
              <div
                key={spiel.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  marginRight: 14,
                  marginBottom: 14,
                  paddingLeft: 22,
                  paddingRight: 22,
                  paddingTop: 12,
                  paddingBottom: 12,
                  border: `2px solid ${LINIE}`,
                  borderRadius: 999,
                  fontSize: format === 'quadrat' ? 24 : 28,
                  color: WEISS,
                }}
              >
                {spiel.name}
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {/* --- Der Aufruf unten -------------------------------------------------- */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          position: 'absolute',
          bottom: 0,
          left: 0,
          width: breite,
          height: mass.aufruf,
          backgroundColor: ROT,
          paddingLeft: mass.polster,
          paddingRight: mass.polster,
        }}
      >
        {texte.cta ? (
          <div style={{ display: 'flex', fontSize: format === 'quadrat' ? 30 : 36, fontWeight: 700 }}>
            {texte.cta}
          </div>
        ) : null}
        <div
          style={{
            display: 'flex',
            marginTop: texte.cta ? 8 : 0,
            fontSize: format === 'quadrat' ? 20 : 24,
            letterSpacing: 4,
            color: 'rgba(255,255,255,0.75)',
            fontWeight: 600,
          }}
        >
          {gross('SwissHub Streamer Hub')}
        </div>
      </div>

      {/* Eine feine Linie ueber dem Balken - die Kante, die ihn traegt. */}
      <div
        style={{
          display: 'flex',
          position: 'absolute',
          bottom: mass.aufruf,
          left: 0,
          width: breite,
          height: 3,
          backgroundColor: LEISE,
        }}
      />
    </div>
  );
}

/** Der Dateiname eines Exports - sprechend, damit im Downloadordner Ordnung bleibt. */
export function spotlightDateiname(name: string, format: SpotlightFormat): string {
  const sauber = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 40);
  return `swisshub-spotlight-${sauber || 'streamer'}-${format}.png`;
}
