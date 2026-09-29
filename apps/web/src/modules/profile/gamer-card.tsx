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
    spiele: number;
  }
> = {
  story: {
    polster: 88,
    bannerHoehe: 620,
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
    bannerHoehe: 360,
    avatar: 180,
    name: 66,
    zeile: 30,
    text: 26,
    chip: 25,
    qr: 150,
    spiele: 3,
  },
  feed: {
    polster: 72,
    bannerHoehe: 450,
    avatar: 210,
    name: 76,
    zeile: 34,
    text: 29,
    chip: 28,
    qr: 170,
    spiele: 4,
  },
};

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
 * Von oben nach unten: Bannerflaeche mit Verlauf, darin die Zeile «Gamer Card»;
 * darunter, halb ins Banner ragend, das Profilbild; dann Name, Motto, die
 * Spielreihe, die Auszeichnungen; unten ein Balken mit Level, Adresse und - wenn
 * gewuenscht - dem QR-Code.
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
  const spiele = (profil.spiele ?? []).slice(0, mass.spiele).map((spiel) => spiel.name);
  const plattformen = (profil.angaben?.plattformen ?? []).slice(0, 3);
  const auszeichnungen = profil.hervorgehobene.slice(0, 3);
  const level = profil.level;

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
      {/* --- Bannerflaeche --- */}
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

        {/* Ein Verlauf nach unten, damit der Uebergang zur Flaeche nicht als
            Kante sichtbar ist. Zwei Stopps reichen - Satori rechnet sie sauber. */}
        <div
          style={{
            display: 'flex',
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: Math.round(mass.bannerHoehe * 0.6),
            backgroundImage: `linear-gradient(to bottom, rgba(7,7,10,0) 0%, ${SCHWARZ} 100%)`,
          }}
        />

        <div
          style={{
            display: 'flex',
            position: 'absolute',
            top: mass.polster,
            left: mass.polster,
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

      {/* --- Kopf: Bild und Name --- */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          paddingLeft: mass.polster,
          paddingRight: mass.polster,
          marginTop: -Math.round(mass.avatar / 2),
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <div
            style={{
              display: 'flex',
              width: mass.avatar,
              height: mass.avatar,
              borderRadius: 32,
              border: `6px solid ${akzent}`,
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
               * Dieselbe Loesung wie im Avatar selbst - und besser als ein
               * Platzhalterbild, das aussieht wie ein Ladefehler.
               */
              <div
                style={{
                  display: 'flex',
                  fontSize: Math.round(mass.avatar * 0.4),
                  fontWeight: 700,
                  color: GEDAEMPFT,
                }}
              >
                {initialen(name)}
              </div>
            )}
          </div>

          {level && !istSchmal(format) ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                marginLeft: 28,
                marginBottom: 10,
              }}
            >
              <div style={{ display: 'flex', fontSize: mass.name, fontWeight: 700, color: akzent }}>
                {level.level}
              </div>
              <div
                style={{
                  display: 'flex',
                  fontSize: Math.round(mass.text * 0.7),
                  letterSpacing: 3,
                  color: GEDAEMPFT,
                }}
              >
                {(level.hoechstlevel ? 'Prestige' : 'Level').toUpperCase()}
              </div>
            </div>
          ) : null}
        </div>

        <div
          style={{
            display: 'flex',
            marginTop: 28,
            fontSize: mass.name,
            fontWeight: 700,
            lineHeight: 1.05,
            color: WEISS,
          }}
        >
          {kuerze(name, format === 'quadrat' ? 18 : 22)}
        </div>

        {motto ? (
          <div
            style={{
              display: 'flex',
              marginTop: 12,
              fontSize: mass.zeile,
              color: GEDAEMPFT,
              lineHeight: 1.25,
            }}
          >
            {kuerze(motto, format === 'story' ? 64 : 52)}
          </div>
        ) : null}

        {/* Level auf dem schmalen Format unter dem Namen - neben dem Bild
            waere dort kein Platz, und die Zahl soll nicht kleiner werden. */}
        {level && istSchmal(format) ? (
          <div style={{ display: 'flex', marginTop: 16, alignItems: 'baseline' }}>
            <div style={{ display: 'flex', fontSize: mass.name, fontWeight: 700, color: akzent }}>
              {level.level}
            </div>
            <div
              style={{
                display: 'flex',
                marginLeft: 12,
                fontSize: Math.round(mass.text * 0.8),
                letterSpacing: 3,
                color: GEDAEMPFT,
              }}
            >
              {(level.hoechstlevel ? 'Prestige' : 'Level').toUpperCase()}
            </div>
          </div>
        ) : null}
      </div>

      {/* --- Spiele und Plattformen --- */}
      {spiele.length > 0 || plattformen.length > 0 ? (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            paddingLeft: mass.polster,
            paddingRight: mass.polster,
            marginTop: 36,
          }}
        >
          {spiele.map((spiel) => (
            <div
              key={`spiel-${spiel}`}
              style={{
                display: 'flex',
                marginRight: 12,
                marginBottom: 12,
                paddingLeft: 22,
                paddingRight: 22,
                paddingTop: 12,
                paddingBottom: 12,
                borderRadius: 999,
                backgroundColor: akzent,
                fontSize: mass.chip,
                fontWeight: 600,
                color: SCHWARZ,
              }}
            >
              {kuerze(spiel, 26)}
            </div>
          ))}
          {plattformen.map((plattform) => (
            <div
              key={`plattform-${plattform}`}
              style={{
                display: 'flex',
                marginRight: 12,
                marginBottom: 12,
                paddingLeft: 22,
                paddingRight: 22,
                paddingTop: 12,
                paddingBottom: 12,
                borderRadius: 999,
                border: `2px solid ${rand}`,
                fontSize: mass.chip,
                color: GEDAEMPFT,
              }}
            >
              {plattform}
            </div>
          ))}
        </div>
      ) : null}

      {/* --- Auszeichnungen --- */}
      {auszeichnungen.length > 0 ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            paddingLeft: mass.polster,
            paddingRight: mass.polster,
            marginTop: 24,
          }}
        >
          {auszeichnungen.map((eintrag) => {
            const stufenbild = stufe(eintrag.stufe);
            return (
              <div
                key={eintrag.key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  marginBottom: 12,
                  paddingTop: 14,
                  paddingBottom: 14,
                  paddingLeft: 20,
                  paddingRight: 20,
                  /* Die Ecke traegt die Stufe mit: Gold kantig, Bronze weich. */
                  borderRadius: stufenbild.bild.radius,
                  backgroundImage: stufenbild.bild.flaeche,
                  border: `2px solid ${stufenbild.bild.rand}`,
                }}
              >
                {/* Das Symbolfeld - auf der Seite ein eingepraegtes Feld, hier
                    eine Scheibe in der Farbe der Stufe. Gold bekommt einen
                    Ring, damit es auch in Graustufen die aufwendigste bleibt. */}
                <div
                  style={{
                    display: 'flex',
                    width: 26,
                    height: 26,
                    borderRadius: 999,
                    backgroundColor: stufenbild.bild.feld,
                    border:
                      eintrag.stufe === 'gold'
                        ? `2px solid ${stufenbild.bild.schrift}`
                        : `2px solid ${stufenbild.bild.rand}`,
                    marginRight: 18,
                  }}
                />
                <div style={{ display: 'flex', fontSize: mass.text, fontWeight: 600, color: WEISS }}>
                  {kuerze(eintrag.label, 26)}
                </div>

                {/* Die Marke: ein bis drei Striche. Das einzige Merkmal, das
                    keine Farbe ist - und damit das einzige, das auch auf einem
                    Ausdruck in Graustufen noch die Stufe sagt. */}
                <div style={{ display: 'flex', alignItems: 'center', marginLeft: 'auto', gap: 4 }}>
                  {Array.from({ length: stufenbild.striche }, (_, index) => (
                    <div
                      key={index}
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

      {/* --- Fussbalken: Adresse und QR --- */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          marginTop: 'auto',
          paddingLeft: mass.polster,
          paddingRight: mass.polster,
          paddingTop: 32,
          paddingBottom: mass.polster,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
          <div
            style={{
              display: 'flex',
              fontSize: Math.round(mass.text * 0.7),
              letterSpacing: 4,
              color: GEDAEMPFT,
            }}
          >
            {'Profil ansehen'.toUpperCase()}
          </div>
          <div
            style={{
              display: 'flex',
              marginTop: 10,
              fontSize: mass.zeile,
              fontWeight: 600,
              color: akzent,
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

      {/* Der Akzentstreifen am unteren Rand - ein Abschluss, keine Dekoration. */}
      <div
        style={{
          display: 'flex',
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: 12,
          backgroundColor: akzent,
        }}
      />
    </div>
  );
}

/** Hat dieses Format zu wenig Breite fuer Bild und Level nebeneinander? */
function istSchmal(format: GamerCardFormat): boolean {
  return format === 'quadrat';
}

/** Satori bricht nicht um - zu lange Texte muessen vorher enden. */
function kuerze(wert: string, grenze: number): string {
  return wert.length <= grenze ? wert : `${wert.slice(0, grenze - 1)}…`;
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
