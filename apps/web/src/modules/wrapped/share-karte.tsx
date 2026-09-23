import { formatSwissNumber } from '@swisshub/shared';
import { ARCHETYP_NACH_KEY } from '@swisshub/modules/wrapped/archetyp';
import { primeTimeStunde } from '@swisshub/modules/wrapped/vorlage';
import type { WrappedDaten } from '@swisshub/modules/wrapped/daten';

/**
 * Die Karten zum Teilen.
 *
 * ## Warum gezeichnet und nicht abfotografiert
 *
 * Ein Screenshot sieht bei jedem anders aus - andere Schrift, anderer
 * Ausschnitt, halbe Browserleiste. Eine gezeichnete Karte ist ueberall
 * dieselbe und traegt die Marke, statt sie zufaellig zu streifen.
 *
 * ## Was **nie** auf eine Karte kommt
 *
 * Discord-Kennungen, interne Kennungen, E-Mail-Adressen, alles aus
 * Moderation, Tickets, Jail oder Verifikation, und keine privaten
 * Protokolle. Eine Karte ist ein Bild, das weitergeschickt wird - was
 * darauf steht, ist ausserhalb des Servers. Deshalb steht darauf
 * ausschliesslich, was der Rueckblick ohnehin schon erzaehlt hat.
 *
 * Bei den Mates gilt dieselbe Zurueckhaltung wie in der Szene: Namen ja,
 * Zeitangaben nein. Wie lange jemand mit wem zusammensass, ist eine
 * Auskunft ueber Leute, die diese Karte nicht verschickt haben.
 *
 * ## Warum ein eigenes Bauteil und nicht zwei Adressen mit je eigenem Code
 *
 * Weil dieselbe Karte an zwei Stellen gebraucht wird: das Mitglied laedt
 * sie herunter, und das Studio zeigt sie in der Vorschau. Zwei Fassungen
 * waeren zwei Gestaltungen, von denen eine irgendwann veraltet.
 *
 * ## Zwei Eigenheiten der Zeichenmaschine
 *
 * `ImageResponse` ist kein Browser.
 *
 * **Erstens** braucht ein `div` mit mehr als einem Kind ein
 * ausdrueckliches `display` - und `«Text {wert}»` sind zwei Kinder.
 * Zusammengesetzte Saetze stehen deshalb als eine Zeichenkette; die
 * Alternative waere ein `display: flex` an jedem Textabsatz, und das erste
 * vergessene faellt erst beim Abruf auf.
 *
 * **Zweitens** steht nur ein einziger Schriftschnitt zur Verfuegung. Eine
 * Schrift mit mehreren Staerken muesste als Datei mitgeliefert oder beim
 * Zeichnen geholt werden; beides will dieser Dienst nicht. Also traegt
 * **Groesse und Farbe** die Hierarchie, nicht die Strichstaerke - `bold`
 * waere hier eine Angabe, die nichts bewirkt und beim Lesen des Codes
 * etwas anderes verspricht, als das Bild zeigt.
 */

export type KartenFormat = 'uebersicht' | 'mates' | 'archetyp';
export type KartenSeite = 'story' | 'quadrat';

export const KARTEN_FORMATE: ReadonlyArray<{ key: KartenFormat; label: string; beschreibung: string }> = [
  { key: 'uebersicht', label: 'Übersicht', beschreibung: 'Die vier Zahlen des Jahres.' },
  { key: 'mates', label: 'Mates', beschreibung: 'Mit wem das Jahr verbracht wurde - ohne Zeitangaben.' },
  { key: 'archetyp', label: 'Typ', beschreibung: 'Das Etikett, gross.' },
];

export const KARTEN_MASSE: Record<KartenSeite, { breite: number; hoehe: number }> = {
  story: { breite: 1080, hoehe: 1920 },
  quadrat: { breite: 1080, hoehe: 1080 },
};

const ROT = '#e02630';
const ROT_DUNKEL = '#83060a';
const WEISS = '#f6f2f2';
const GEDAEMPFT = '#a49798';
const LEISE = '#6f6364';

/**
 * Eine Schriftgroesse, bei der die laengste Zeile noch hineinpasst.
 *
 * ## Warum gerechnet und nicht gemessen
 *
 * Die Zeichenmaschine kennt keinen Umbruch mitten im Wort. «THE
 * ALLROUNDER» bricht nach «THE», und «ALLROUNDER» steht dann als ein
 * Stueck da - bei 156 Pixeln sind das rund 1120 Pixel Breite auf einer
 * Karte, die 872 hergibt. Das Wort lief rechts aus dem Bild, und ein
 * Etikett, das man nicht ganz lesen kann, ist schlimmer als ein
 * kleineres.
 *
 * Messen geht hier nicht: es gibt kein Layout, das man befragen koennte.
 * Gerechnet wird deshalb mit dem breitesten Wort und einer
 * Faustzahl - 0,7 Geviert je Zeichen, grosszuegig gewaehlt, damit die
 * Schaetzung eher zu klein als zu breit ausfaellt.
 */
const ZEICHENBREITE = 0.7;

export function passendeGroesse(text: string, innen: number, basis: number): number {
  const laengstes = Math.max(1, ...text.split(/\s+/u).map((wort) => wort.length));
  const moeglich = Math.floor(innen / (laengstes * ZEICHENBREITE));
  return Math.min(basis, moeglich);
}

/** Lange Namen enden mit einem Auslassungszeichen statt ausserhalb des Bildes. */
export function kuerze(text: string, laenge: number): string {
  return text.length <= laenge ? text : `${text.slice(0, laenge - 1).trimEnd()}…`;
}

/**
 * Ein Dateiname, der auf jedem Betriebssystem funktioniert.
 *
 * Aus «Mänu / Kölliker» wird «maenu-koelliker». Nicht aus Schoenheit:
 * Schraegstriche und Doppelpunkte sind auf mindestens einem verbreiteten
 * System verboten, und ein Download, der nicht gespeichert werden kann,
 * ist kein Download.
 */
export function dateiname(jahr: number, name: string, format: KartenFormat): string {
  const sauber = name
    .toLowerCase()
    .replaceAll('ä', 'ae')
    .replaceAll('ö', 'oe')
    .replaceAll('ü', 'ue')
    // Als Fluchtzeichen, nicht als Buchstabe: in diesem Projekt steht
    // nirgends ein Eszett im Quelltext, und ein Test haelt das fest. Der
    // Buchstabe muss hier trotzdem behandelt werden - er kommt in Namen vor,
    // die von Discord kommen, und die richten sich nicht nach uns.
    .replaceAll('\u00df', 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 40);
  const teil = sauber.length > 0 ? `-${sauber}` : '';
  const zusatz = format === 'uebersicht' ? '' : `-${format}`;
  return `swisshub-wrapped-${jahr}${teil}${zusatz}.png`;
}

export function zeichneKarte({
  daten,
  format,
  seite,
  jahr,
  host,
}: {
  daten: WrappedDaten;
  format: KartenFormat;
  seite: KartenSeite;
  jahr: number;
  host: string;
}): React.JSX.Element {
  const mass = KARTEN_MASSE[seite];
  // Im Quadrat ist alles enger; die Schrift folgt dem, damit nichts
  // herauslaeuft und die Karte nicht leer wirkt.
  const eng = seite === 'quadrat';
  const rand = eng ? 80 : 104;
  const name = kuerze(daten.person.displayName ?? daten.person.username ?? 'Du', 24);

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: rand,
        background: 'linear-gradient(165deg, #2a070c 0%, #140507 42%, #09090a 100%)',
        color: WEISS,
        fontFamily: 'sans-serif',
        position: 'relative',
      }}
    >
      {/*
        Die Jahreszahl als Grundton.

        Sie traegt nichts zum Inhalt bei und alles zur Wiedererkennung: eine
        Karte, die man im Verlauf eines Chats sieht, soll in einem Blick als
        «Wrapped» lesbar sein.
      */}
      <div
        style={{
          position: 'absolute',
          display: 'flex',
          right: -60,
          bottom: eng ? -130 : -190,
          fontSize: eng ? 520 : 720,
          lineHeight: 1,
          letterSpacing: -30,
          color: 'rgba(255,255,255,0.035)',
        }}
      >
        {String(jahr)}
      </div>

      <Kopf jahr={jahr} eng={eng} />
      <Rumpf daten={daten} format={format} eng={eng} name={name} innen={mass.breite - rand * 2} />
      <Fuss host={host} name={name} breite={mass.breite} rand={rand} eng={eng} />
    </div>
  );
}

function Kopf({ jahr, eng }: { jahr: number; eng: boolean }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
      <div style={{ width: 18, height: 18, borderRadius: 999, background: ROT }} />
      <div
        style={{
          fontSize: eng ? 30 : 36,
          letterSpacing: 8,
          textTransform: 'uppercase',
          color: GEDAEMPFT,
        }}
      >
        {`SwissHub Wrapped ${jahr}`}
      </div>
    </div>
  );
}

function Rumpf({
  daten,
  format,
  eng,
  name,
  innen,
}: {
  daten: WrappedDaten;
  format: KartenFormat;
  eng: boolean;
  name: string;
  /** Die nutzbare Breite - Grundlage fuer `passendeGroesse`. */
  innen: number;
}): React.JSX.Element {
  if (format === 'archetyp') {
    const typ = ARCHETYP_NACH_KEY.get(daten.archetyp.key as never);
    const etikett = (typ?.label ?? 'The Regular').toUpperCase();
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: eng ? 26 : 40 }}>
        <div style={{ fontSize: eng ? 38 : 48, color: GEDAEMPFT }}>{`${name} war`}</div>
        <div
          style={{
            display: 'flex',
            fontSize: passendeGroesse(etikett, innen, eng ? 118 : 156),
            lineHeight: 1,
            letterSpacing: -4,
          }}
        >
          {etikett}
        </div>
        <div style={{ display: 'flex', fontSize: eng ? 40 : 52, color: GEDAEMPFT, maxWidth: 840 }}>
          {typ?.claim ?? 'Das war dein Jahr.'}
        </div>
      </div>
    );
  }

  if (format === 'mates') {
    /*
     * Namen ja, Zeiten nein.
     *
     * In der Szene steht bewusst keine Zeitangabe neben einer anderen
     * Person - auf einer Karte, die den Server verlaesst, erst recht nicht.
     * Die Reihenfolge sagt schon genug.
     */
    const mates = daten.voice.mates.slice(0, eng ? 4 : 5);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: eng ? 28 : 44 }}>
        <div style={{ display: 'flex', fontSize: eng ? 52 : 68 }}>{`Alleine war ${name} selten.`}</div>
        {mates.length === 0 ? (
          <div style={{ display: 'flex', fontSize: eng ? 38 : 48, color: GEDAEMPFT }}>
            Dieses Jahr vor allem für sich.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: eng ? 16 : 24 }}>
            {mates.map((mate, index) => (
              <div key={mate.discordId} style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
                <div
                  style={{
                    display: 'flex',
                    width: eng ? 62 : 78,
                    height: eng ? 62 : 78,
                    borderRadius: 999,
                    background: index === 0 ? ROT : ROT_DUNKEL,
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: eng ? 30 : 38,
                  }}
                >
                  {String(index + 1)}
                </div>
                <div
                  style={{
                    display: 'flex',
                    fontSize: passendeGroesse(
                      kuerze(mate.displayName ?? mate.username ?? '—', 20),
                      // Das Kaestchen mit der Nummer und der Abstand gehen ab.
                      innen - (eng ? 90 : 106),
                      eng ? 52 : 68,
                    ),
                  }}
                >
                  {kuerze(mate.displayName ?? mate.username ?? '—', 20)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const stunde = primeTimeStunde(daten.voice.hours);
  const zahlen = [
    { wert: formatSwissNumber(Math.round(daten.voice.seconds / 3600)), label: 'Stunden im Voice' },
    { wert: formatSwissNumber(daten.messages.total), label: 'Nachrichten' },
    { wert: formatSwissNumber(daten.aktivitaet.activeDays), label: 'aktive Tage' },
    stunde === null
      ? { wert: formatSwissNumber(daten.aktivitaet.longestStreak), label: 'Tage am Stück' }
      : { wert: `${String(stunde).padStart(2, '0')}:00`, label: 'Prime Time' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: eng ? 34 : 56 }}>
      <div style={{ display: 'flex', fontSize: eng ? 52 : 68 }}>{`Das war das Jahr von ${name}.`}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: eng ? 28 : 52 }}>
        {zahlen.map((eintrag) => (
          <div
            key={eintrag.label}
            style={{
              display: 'flex',
              flexDirection: 'column',
              /*
                Zwei Spalten, und zwar knapp.

                Innen bleiben 872 Pixel (1080 minus zweimal Rand). Mit 412
                und 52 Abstand waren es 876 - vier zu viel, und die Kacheln
                brachen in eine einzige Spalte um. Die Karte war dann zwar
                nicht kaputt, aber doppelt so lang wie gedacht.
              */
              width: eng ? 424 : 400,
              gap: 2,
            }}
          >
            <div
              style={{
                display: 'flex',
                fontSize: eng ? 108 : 150,
                lineHeight: 1.05,
                letterSpacing: -5,
                color: WEISS,
              }}
            >
              {eintrag.wert}
            </div>
            <div style={{ display: 'flex', fontSize: eng ? 30 : 38, color: GEDAEMPFT }}>{eintrag.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Fuss({
  host,
  name,
  breite,
  rand,
  eng,
}: {
  host: string;
  name: string;
  breite: number;
  rand: number;
  eng: boolean;
}): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: eng ? 22 : 30 }}>
      {/* Die Linie aus dem Logo - dasselbe Zeichen wie in der Geschichte. */}
      <div
        style={{
          display: 'flex',
          width: breite - rand * 2,
          height: 7,
          borderRadius: 999,
          background: `linear-gradient(90deg, ${ROT} 0%, ${ROT_DUNKEL} 78%, rgba(131,6,10,0) 100%)`,
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', fontSize: eng ? 34 : 40 }}>{name}</div>
        <div style={{ display: 'flex', fontSize: eng ? 28 : 32, color: LEISE }}>{host}</div>
      </div>
    </div>
  );
}
