import type { VorlagenDaten, WrappedVariante, WrappedVorlage } from '@swisshub/modules/wrapped/vorlagen';
import { kuerze, passendeGroesse } from './share-karte';

/**
 * Eine Folie einer periodischen Ausgabe - gezeichnet.
 *
 * ## Warum dieselbe Datei fuer Vorschau und Export
 *
 * Weil sonst zwei Gestaltungen entstuenden und eine davon irgendwann
 * veraltet. Was hier herauskommt, ist gewoehnliches React mit Inline-Stilen:
 * `ImageResponse` rastert es zu PNG, und der Browser stellt genau dasselbe
 * dar, nur kleiner skaliert. Vorschau und Export koennen damit nicht
 * auseinanderlaufen - es gibt nur eine Fassung.
 *
 * ## Zwei Eigenheiten der Zeichenmaschine
 *
 * `ImageResponse` ist kein Browser. **Erstens** braucht jedes `div` mit mehr
 * als einem Kind ein ausdrueckliches `display`. **Zweitens** steht nur ein
 * Schriftschnitt zur Verfuegung - **Groesse und Farbe** tragen deshalb die
 * Hierarchie, nicht die Strichstaerke. Beides gilt hier genauso wie bei den
 * Share Cards, und aus demselben Grund steht es auch hier.
 *
 * ## Was eine Folie zeigt
 *
 * Wenig. Eine Zahl, eine Beschriftung, hoechstens einen Satz. Eine Folie
 * wird auf einem Telefon in ein bis zwei Sekunden gelesen oder gar nicht -
 * zwanzig kleine Zahlen darauf sind zwanzig ungelesene Zahlen.
 */

export type AusgabeFormat = 'story' | 'feed';

export const AUSGABE_MASSE: Record<AusgabeFormat, { breite: number; hoehe: number }> = {
  /** Instagram Story. */
  story: { breite: 1080, hoehe: 1920 },
  /** Instagram Feed / Carousel. */
  feed: { breite: 1080, hoehe: 1350 },
};

const ROT = '#e02630';
const ROT_TIEF = '#83060a';
const WEISS = '#f6f2f2';
const GEDAEMPFT = '#a49798';
const LEISE = '#6f6364';

/**
 * Die Kulisse einer Variante.
 *
 * Drei Kompositionen, damit nicht jeder Monat gleich aussieht - und alle
 * drei aus denselben zwei Elementen: ein roter Schein und eine Geometrie in
 * sehr niedrigem Kontrast. Ein Wrapped soll wiedererkennbar SwissHub sein;
 * drei voellig verschiedene Gestaltungen waeren drei Marken.
 */
function Kulisse({
  variante,
  breite,
  hoehe,
}: {
  variante: WrappedVariante;
  breite: number;
  hoehe: number;
}): React.JSX.Element {
  if (variante === 'raster') {
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            backgroundImage: `linear-gradient(to right, rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.05) 1px, transparent 1px)`,
            backgroundSize: '90px 90px',
          }}
        />
        <div
          style={{
            position: 'absolute',
            display: 'flex',
            top: -hoehe * 0.14,
            left: -breite * 0.42,
            width: breite * 1.05,
            height: breite * 1.05,
            borderRadius: 9999,
            background: `radial-gradient(circle, ${ROT_TIEF}55 0%, ${ROT_TIEF}22 42%, transparent 74%)`,
          }}
        />
      </div>
    );
  }

  if (variante === 'bogen') {
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
        <div
          style={{
            position: 'absolute',
            display: 'flex',
            bottom: -breite * 0.75,
            left: -breite * 0.25,
            width: breite * 1.5,
            height: breite * 1.5,
            borderRadius: 9999,
            border: `3px solid rgba(255,255,255,0.075)`,
          }}
        />
        <div
          style={{
            position: 'absolute',
            display: 'flex',
            bottom: -breite * 0.95,
            left: -breite * 0.45,
            width: breite * 1.9,
            height: breite * 1.9,
            borderRadius: 9999,
            border: `3px solid rgba(255,255,255,0.05)`,
          }}
        />
        <div
          style={{
            position: 'absolute',
            display: 'flex',
            bottom: -hoehe * 0.2,
            right: -breite * 0.35,
            width: breite,
            height: breite,
            borderRadius: 9999,
            background: `radial-gradient(circle, ${ROT_TIEF}4d 0%, ${ROT_TIEF}1f 42%, transparent 76%)`,
          }}
        />
      </div>
    );
  }

  // «kante» - eine Diagonale, die das Bild teilt.
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
      <div
        style={{
          position: 'absolute',
          display: 'flex',
          top: 0,
          right: 0,
          width: 0,
          height: 0,
          borderStyle: 'solid',
          borderWidth: `0 ${breite * 0.9}px ${hoehe * 0.42}px 0`,
          borderColor: `transparent rgba(255,255,255,0.045) transparent transparent`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          display: 'flex',
          top: -hoehe * 0.12,
          right: -breite * 0.2,
          width: breite * 0.95,
          height: breite * 0.95,
          borderRadius: 9999,
          background: `radial-gradient(circle, ${ROT_TIEF}55 0%, ${ROT_TIEF}22 42%, transparent 74%)`,
        }}
      />
    </div>
  );
}

function Kopfzeile({ titel, klein }: { titel: string; klein: boolean }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
      <div style={{ display: 'flex', width: 16, height: 16, borderRadius: 999, background: ROT }} />
      <div
        style={{
          display: 'flex',
          fontSize: klein ? 26 : 30,
          letterSpacing: 7,
          textTransform: 'uppercase',
          color: GEDAEMPFT,
        }}
      >
        {titel}
      </div>
    </div>
  );
}

function Fusszeile({ host, klein }: { host: string; klein: boolean }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', fontSize: klein ? 24 : 28, letterSpacing: 4, color: LEISE }}>{host}</div>
      <div style={{ display: 'flex', width: 64, height: 5, background: ROT }} />
    </div>
  );
}

/** Die grosse Zahl - das wiederkehrende Motiv des ganzen Systems. */
function GrosseZahl({
  wert,
  label,
  innen,
  basis,
  labelGroesse,
}: {
  wert: string;
  label: string;
  innen: number;
  basis: number;
  labelGroesse: number;
}): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          display: 'flex',
          fontSize: passendeGroesse(wert, innen, basis),
          lineHeight: 1,
          letterSpacing: -8,
          color: WEISS,
        }}
      >
        {wert}
      </div>
      <div
        style={{
          display: 'flex',
          marginTop: 18,
          fontSize: labelGroesse,
          letterSpacing: 6,
          textTransform: 'uppercase',
          color: ROT,
        }}
      >
        {label}
      </div>
    </div>
  );
}

export interface FolienEingabe {
  templateKey: WrappedVorlage;
  daten: unknown;
  editorial: { ueberschrift: string; text: string };
}

/**
 * Der Rumpf je Vorlage.
 *
 * Bewusst eine Verzweigung und keine Registry: die acht Faelle unterscheiden
 * sich in ihrer Gestaltung und nicht in ihren Daten, und eine Registry
 * daraus zu machen hiesse, acht Komponenten in eine Tabelle zu schreiben,
 * ohne dass je etwas anderes daraus geholt wuerde.
 */
function Rumpf({
  folie,
  innen,
  klein,
}: {
  folie: FolienEingabe;
  innen: number;
  klein: boolean;
}): React.JSX.Element {
  const zahlBasis = klein ? 230 : 300;
  const labelGroesse = klein ? 34 : 40;

  switch (folie.templateKey) {
    case 'INTRO': {
      const daten = folie.daten as VorlagenDaten<'INTRO'>;
      return (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {/*
            Die Ueberschrift nur, wenn jemand eine geschrieben hat.

            Vorher stand hier «SwissHub Wrapped» als Vorgabe - und damit
            zweimal dasselbe auf einem Bild: einmal in der Kopfzeile, einmal
            gross darunter. Der Zeitraum traegt die Folie, die Marke steht
            oben.
          */}
          {folie.editorial.ueberschrift ? (
            <div
              style={{
                display: 'flex',
                fontSize: klein ? 56 : 70,
                lineHeight: 1.05,
                letterSpacing: -2,
                color: WEISS,
              }}
            >
              {folie.editorial.ueberschrift}
            </div>
          ) : null}
          <div
            style={{
              display: 'flex',
              marginTop: folie.editorial.ueberschrift ? 14 : 0,
              fontSize: passendeGroesse(daten.periode, innen, klein ? 130 : 168),
              lineHeight: 1,
              letterSpacing: -4,
              color: ROT,
            }}
          >
            {daten.periode.toUpperCase()}
          </div>
          {folie.editorial.text ? (
            <div
              style={{
                display: 'flex',
                marginTop: klein ? 34 : 48,
                fontSize: klein ? 36 : 44,
                lineHeight: 1.35,
                color: GEDAEMPFT,
              }}
            >
              {folie.editorial.text}
            </div>
          ) : null}
        </div>
      );
    }

    case 'HERO_NUMBER': {
      const daten = folie.daten as VorlagenDaten<'HERO_NUMBER'>;
      return (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <GrosseZahl
            wert={daten.wert}
            label={daten.label}
            innen={innen}
            basis={zahlBasis}
            labelGroesse={labelGroesse}
          />
          {daten.zusatz ? (
            <div
              style={{
                display: 'flex',
                marginTop: klein ? 30 : 42,
                fontSize: klein ? 34 : 40,
                lineHeight: 1.35,
                color: GEDAEMPFT,
              }}
            >
              {daten.zusatz}
            </div>
          ) : null}
          {folie.editorial.text ? (
            <div
              style={{
                display: 'flex',
                marginTop: 18,
                fontSize: klein ? 32 : 36,
                lineHeight: 1.35,
                color: LEISE,
              }}
            >
              {folie.editorial.text}
            </div>
          ) : null}
        </div>
      );
    }

    case 'TWO_STAT': {
      const daten = folie.daten as VorlagenDaten<'TWO_STAT'>;
      // Zwei Zahlen untereinander, nicht nebeneinander: nebeneinander
      // muessten beide klein sein, und dann traegt keine mehr.
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: klein ? 48 : 68 }}>
          <GrosseZahl
            wert={daten.links.wert}
            label={daten.links.label}
            innen={innen}
            basis={klein ? 180 : 230}
            labelGroesse={labelGroesse}
          />
          <GrosseZahl
            wert={daten.rechts.wert}
            label={daten.rechts.label}
            innen={innen}
            basis={klein ? 140 : 180}
            labelGroesse={labelGroesse}
          />
        </div>
      );
    }

    case 'WINNER': {
      const daten = folie.daten as VorlagenDaten<'WINNER'>;
      const name = kuerze(daten.name, 40).toUpperCase();
      return (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              display: 'flex',
              fontSize: klein ? 30 : 34,
              letterSpacing: 7,
              textTransform: 'uppercase',
              color: ROT,
            }}
          >
            {daten.kategorie}
          </div>
          <div
            style={{
              display: 'flex',
              marginTop: 22,
              fontSize: passendeGroesse(name, innen, klein ? 104 : 132),
              lineHeight: 1.02,
              letterSpacing: -3,
              color: WEISS,
            }}
          >
            {name}
          </div>
          {daten.untertitel ? (
            <div
              style={{
                display: 'flex',
                marginTop: 20,
                fontSize: klein ? 34 : 40,
                color: GEDAEMPFT,
              }}
            >
              {kuerze(daten.untertitel, 46)}
            </div>
          ) : null}
          {daten.kennzahl ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 16,
                marginTop: klein ? 40 : 56,
              }}
            >
              <div style={{ display: 'flex', fontSize: klein ? 82 : 104, lineHeight: 1, color: WEISS }}>
                {daten.kennzahl.wert}
              </div>
              <div
                style={{
                  display: 'flex',
                  fontSize: klein ? 30 : 34,
                  letterSpacing: 4,
                  textTransform: 'uppercase',
                  color: GEDAEMPFT,
                }}
              >
                {daten.kennzahl.label}
              </div>
            </div>
          ) : null}
        </div>
      );
    }

    case 'RANKING': {
      const daten = folie.daten as VorlagenDaten<'RANKING'>;
      return (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              display: 'flex',
              fontSize: klein ? 30 : 34,
              letterSpacing: 7,
              textTransform: 'uppercase',
              color: ROT,
            }}
          >
            {daten.kategorie}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 30 }}>
            {daten.eintraege.map((eintrag, index) => (
              <div
                key={eintrag.name}
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  paddingTop: klein ? 20 : 26,
                  paddingBottom: klein ? 20 : 26,
                  borderBottom: '1px solid rgba(255,255,255,0.08)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 22 }}>
                  <div
                    style={{
                      display: 'flex',
                      width: klein ? 44 : 54,
                      fontSize: klein ? 34 : 40,
                      color: index === 0 ? ROT : LEISE,
                    }}
                  >
                    {String(index + 1)}
                  </div>
                  <div style={{ display: 'flex', fontSize: klein ? 42 : 52, color: WEISS }}>
                    {kuerze(eintrag.name, 24)}
                  </div>
                </div>
                <div style={{ display: 'flex', fontSize: klein ? 40 : 48, color: GEDAEMPFT }}>
                  {eintrag.wert}
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    case 'IMAGE_MOMENT': {
      const daten = folie.daten as VorlagenDaten<'IMAGE_MOMENT'>;
      return (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {daten.bild ? (
            <div
              style={{
                display: 'flex',
                width: innen,
                height: klein ? 620 : 860,
                overflow: 'hidden',
                borderRadius: 14,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={daten.bild}
                alt=""
                width={innen}
                height={klein ? 620 : 860}
                style={{ objectFit: 'cover' }}
              />
            </div>
          ) : null}
          <div
            style={{
              display: 'flex',
              marginTop: daten.bild ? (klein ? 34 : 46) : 0,
              fontSize: passendeGroesse(daten.titel, innen, klein ? 72 : 88),
              lineHeight: 1.08,
              letterSpacing: -2,
              color: WEISS,
            }}
          >
            {kuerze(daten.titel, 60)}
          </div>
          {daten.text ? (
            <div
              style={{
                display: 'flex',
                marginTop: 18,
                fontSize: klein ? 32 : 38,
                lineHeight: 1.35,
                color: GEDAEMPFT,
              }}
            >
              {kuerze(daten.text, 120)}
            </div>
          ) : null}
        </div>
      );
    }

    case 'MONTH_OVERVIEW': {
      const daten = folie.daten as VorlagenDaten<'MONTH_OVERVIEW'>;
      const hoechster = Math.max(1, ...daten.monate.map((monat) => monat.wert));
      const balkenHoehe = klein ? 380 : 540;
      return (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              display: 'flex',
              fontSize: klein ? 30 : 34,
              letterSpacing: 7,
              textTransform: 'uppercase',
              color: ROT,
            }}
          >
            {daten.kategorie}
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              gap: klein ? 10 : 14,
              height: balkenHoehe,
              marginTop: klein ? 40 : 56,
            }}
          >
            {daten.monate.map((monat) => (
              <div
                key={monat.name}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  flex: 1,
                  height: '100%',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    width: '100%',
                    height: Math.max(4, Math.round((monat.wert / hoechster) * (balkenHoehe - 46))),
                    background: monat.name === daten.bester?.slice(0, 3) ? ROT : 'rgba(255,255,255,0.16)',
                    borderRadius: 4,
                  }}
                />
                <div
                  style={{
                    display: 'flex',
                    marginTop: 14,
                    fontSize: klein ? 22 : 26,
                    color: LEISE,
                  }}
                >
                  {monat.name}
                </div>
              </div>
            ))}
          </div>
          {daten.bester ? (
            <div
              style={{
                display: 'flex',
                marginTop: klein ? 34 : 46,
                fontSize: klein ? 36 : 44,
                color: GEDAEMPFT,
              }}
            >
              {`Stärkster Monat: ${daten.bester}`}
            </div>
          ) : null}
        </div>
      );
    }

    case 'OUTRO': {
      const daten = folie.daten as VorlagenDaten<'OUTRO'>;
      return (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              display: 'flex',
              fontSize: passendeGroesse(
                folie.editorial.ueberschrift || daten.periode,
                innen,
                klein ? 96 : 124,
              ),
              lineHeight: 1.05,
              letterSpacing: -3,
              color: WEISS,
            }}
          >
            {folie.editorial.ueberschrift || `Das war ${daten.periode}.`}
          </div>
          {folie.editorial.text ? (
            <div
              style={{
                display: 'flex',
                marginTop: klein ? 36 : 50,
                fontSize: klein ? 36 : 44,
                lineHeight: 1.35,
                color: GEDAEMPFT,
              }}
            >
              {folie.editorial.text}
            </div>
          ) : null}
        </div>
      );
    }

    default:
      return <div style={{ display: 'flex' }} />;
  }
}

/**
 * Eine ganze Folie.
 *
 * `titel` steht in der Kopfzeile jeder Folie - «SwissHub Wrapped September
 * 2026». Bei einem Karussell sieht man immer nur ein Bild; ohne die Zeile
 * waere ab Folie zwei nicht mehr erkennbar, worum es geht.
 */
export function zeichneAusgabeFolie({
  folie,
  format,
  variante,
  titel,
  host,
}: {
  folie: FolienEingabe;
  format: AusgabeFormat;
  variante: WrappedVariante;
  titel: string;
  host: string;
}): React.JSX.Element {
  const mass = AUSGABE_MASSE[format];
  const klein = format === 'feed';
  const rand = klein ? 84 : 104;
  const innen = mass.breite - rand * 2;

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: rand,
        /*
         * Neutral, nicht rot.
         *
         * Vorher begann der Verlauf oben links mit einem roten Ton - und
         * damit war die Ecke immer die hellste, egal welche Variante. Der
         * Schein der Variante ging darin unter, und drei Varianten sahen
         * aus wie eine. Die Farbe kommt jetzt aus der Kulisse.
         */
        background: 'linear-gradient(168deg, #141416 0%, #0c0c0e 46%, #09090a 100%)',
        color: WEISS,
        fontFamily: 'sans-serif',
        position: 'relative',
      }}
    >
      <Kulisse variante={variante} breite={mass.breite} hoehe={mass.hoehe} />
      <Kopfzeile titel={titel} klein={klein} />
      <Rumpf folie={folie} innen={innen} klein={klein} />
      <Fusszeile host={host} klein={klein} />
    </div>
  );
}

/**
 * Der Dateiname einer Folie im Archiv.
 *
 * Nummeriert, damit die Reihenfolge im Entpacker stimmt - ein Karussell,
 * dessen Bilder alphabetisch durcheinandergeraten, erzaehlt eine andere
 * Geschichte. Nur Zeichen, die der ZIP-Schreiber durchlaesst.
 */
export function folienDateiname(position: number, storyKey: string): string {
  const sauber = storyKey.replace(/[^a-z0-9]+/giu, '-').replace(/^-+|-+$/gu, '') || 'folie';
  return `${String(position + 1).padStart(2, '0')}-${sauber}.png`;
}
