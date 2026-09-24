import { levelProgress } from './curve';
import { kuerzeAufBreite, messeText } from './dejavu-metriken';
import {
  PRESTIGE_TEXTFARBE,
  STANDARD_TEXTFARBE,
  normalisiereTextfarbe,
  relativeLeuchtdichte,
} from './kartenfarbe';

/*
 * Die Farblogik reicht diese Datei weiter.
 *
 * Nicht aus Bequemlichkeit: `./card` ist der client-sichere Einstiegspunkt
 * (`@swisshub/modules/level/karte`), und die Vorschau im Browser braucht
 * genau dieselbe Pruefung und dieselben Standardfarben wie die Karte selbst.
 * Ein zweiter Einstiegspunkt daneben waere eine zweite Gelegenheit, dass
 * Vorschau und Karte auseinanderlaufen.
 */
export * from './kartenfarbe';
export { kuerzeAufBreite, messeText } from './dejavu-metriken';

/**
 * Die Levelkarte.
 *
 * ## Ein Bauplan, zwei Ausgaben
 *
 * Hier entsteht ein SVG. Das Dashboard zeigt es unveraendert an, der Bot
 * rastert dasselbe SVG mit `sharp` zu PNG und haengt es an die Antwort auf
 * `/level`. Was hier steht, steht deshalb auch im Chat - eine Aenderung an
 * einer CSS-Vorschau waere eine Aenderung an nichts.
 *
 * ## Was die Gestaltung traegt
 *
 * Im Bot-Abbild ist genau eine Schriftfamilie installiert: DejaVu Sans, in
 * normal und fett. Eine Hierarchie ueber verschiedene Schriften gibt es also
 * nicht - sie entsteht hier ueber Groesse, Schnitt, Laufweite, Deckkraft und
 * Abstand. Das ist keine Einschraenkung, die man bedauert, sondern die
 * Bedingung, unter der die Karte entworfen ist.
 *
 * Aus demselben Grund wird jede Textbreite gemessen und nicht geschaetzt
 * (`dejavu-metriken.ts`): die Karte weiss, wie breit ein Name wird, bevor
 * sie ihn setzt. Deshalb kann der Name so weit laufen, wie tatsaechlich
 * Platz ist - und nicht so weit, wie eine mittlere Zeichenbreite vermuten
 * laesst.
 *
 * ## Lesbarkeit vor beliebigem Hintergrund
 *
 * Hinter der Karte kann ein selbst gewaehltes Bild liegen, und die Schrift
 * darauf kann eine selbst gewaehlte Farbe haben. Beides zusammen kann
 * schiefgehen. Dagegen stehen hier zwei Dinge: ein abdunkelnder Verlauf ueber
 * dem Bild und ein feiner Saum um jede Schrift, dessen Helligkeit sich nach
 * der Textfarbe richtet. Die gewaehlte Farbe bleibt dabei die gewaehlte
 * Farbe - sie wird nie stillschweigend durch eine besser lesbare ersetzt.
 */

/** Masse der normalen Karte - unveraendert, damit sie im Chat vertraut wirkt. */
export const CARD_WIDTH = 900;
export const CARD_HEIGHT = 225;

/** Die Karte fuer das Hoechstlevel ist hoeher und golden. */
export const PRESTIGE_CARD_HEIGHT = 341;

/** Der Grundton der Karte, unter allem anderen. */
const GRUNDTON = '#121214';

/** Womit abgedunkelt wird - nicht reines Schwarz, das wirkt tot. */
const SCHLEIER = '#08080A';

const SCHRIFT = 'DejaVu Sans, Noto Sans, Helvetica, Arial, sans-serif';

/** Schweizer Tausendertrennung mit Apostroph - wie beim Vorgänger. */
export function formatXp(value: number): string {
  return Math.trunc(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/gu, '’');
}

const escapeXml = (value: string): string =>
  value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&apos;');

/**
 * Kürzt einen Namen auf die verfügbare Breite.
 *
 * Bleibt als Name erhalten, weil andere Stellen darauf verweisen; gemessen
 * wird inzwischen mit den echten Vorschubbreiten von DejaVu Sans.
 */
function truncateName(name: string, maxWidth: number, fontSize: number, fett = true): string {
  return kuerzeAufBreite(name, maxWidth, fontSize, fett);
}

export interface LevelCardInput {
  displayName: string;
  xp: number;
  rank: number;
  /** Akzentfarbe als Hex, z.B. `#83060A`. */
  accentColor?: string;
  /**
   * Textfarbe der Karte, als Hex.
   *
   * Leer heisst: die Standardfarbe - Weiss, im Hoechstlevel Gold. Was hier
   * ankommt, wird noch einmal geprueft: diese Funktion wird auch aus dem Bot
   * aufgerufen, und sie darf sich nicht darauf verlassen, dass jemand vorher
   * nachgesehen hat.
   */
  textColor?: string | null;
  /**
   * Quelle des Avatars.
   *
   * Im Browser (Dashboard-Vorschau) darf hier eine Adresse stehen. Beim
   * Rastern im Bot muss es ein `data:`-URI sein: aus der Bilddatei heraus soll
   * dort kein Netzwerkzugriff passieren.
   */
  avatarSrc?: string | null;
  /** Quelle des Hintergrundbilds - dieselbe Regel wie beim Avatar. */
  bannerSrc?: string | null;
  maxLevelTotalXp?: number;
}

/** Was sich zwischen normaler Karte und Hoechstlevel-Karte unterscheidet. */
interface Raster {
  hoehe: number;
  avatarGroesse: number;
  avatarX: number;
  textX: number;
  rechtsX: number;
  /** Schriftgrade und Grundlinien, von oben nach unten. */
  augenbraueGrad: number;
  augenbraueY: number | null;
  nameGrad: number;
  nameY: number;
  metaGrad: number;
  metaY: number;
  levelLabelGrad: number;
  levelLabelY: number;
  levelZahlGrad: number;
  levelZahlY: number;
  balkenY: number;
  balkenHoehe: number;
  fussGrad: number;
  fussY: number;
  prozentGrad: number;
}

function raster(prestige: boolean): Raster {
  return prestige
    ? {
        hoehe: PRESTIGE_CARD_HEIGHT,
        avatarGroesse: 180,
        avatarX: 44,
        textX: 260,
        rechtsX: 856,
        augenbraueGrad: 15,
        augenbraueY: 104,
        nameGrad: 46,
        nameY: 162,
        metaGrad: 22,
        metaY: 200,
        levelLabelGrad: 14,
        levelLabelY: 118,
        levelZahlGrad: 56,
        levelZahlY: 180,
        balkenY: 240,
        balkenHoehe: 16,
        fussGrad: 17,
        fussY: 296,
        prozentGrad: 19,
      }
    : {
        hoehe: CARD_HEIGHT,
        avatarGroesse: 132,
        avatarX: 34,
        textX: 196,
        rechtsX: 866,
        augenbraueGrad: 13,
        augenbraueY: null,
        nameGrad: 38,
        nameY: 86,
        metaGrad: 19,
        metaY: 118,
        levelLabelGrad: 13,
        levelLabelY: 64,
        levelZahlGrad: 44,
        levelZahlY: 110,
        balkenY: 150,
        balkenHoehe: 13,
        fussGrad: 15,
        fussY: 192,
        prozentGrad: 17,
      };
}

/**
 * Der Saum um die Schrift.
 *
 * Heller Text bekommt einen dunklen Saum, dunkler Text einen hellen - damit
 * beides sich vom Untergrund abhebt, ohne dass die Farbe selbst angetastet
 * wird. Die Schwelle liegt bei der Leuchtdichte, nicht bei der Helligkeit
 * eines einzelnen Kanals: Dunkelblau ist dunkel, auch wenn sein Blauwert
 * hoch ist.
 */
function saumfarbe(textfarbe: string): string {
  return relativeLeuchtdichte(textfarbe) < 0.22 ? '#F2F2F4' : SCHLEIER;
}

interface TextOptionen {
  x: number;
  y: number;
  grad: number;
  fett?: boolean;
  deckkraft?: number;
  laufweite?: number;
  /** `end` setzt den Text rechtsbuendig an `x`, `middle` mittig darueber. */
  anker?: 'start' | 'end' | 'middle';
}

/**
 * Ein Text, zweimal gezeichnet.
 *
 * Zuerst nur als Kontur in der Saumfarbe, darueber der eigentliche Text.
 * Zwei Elemente statt eines Filters oder `paint-order`: beides koennte ein
 * Renderer anders oder gar nicht umsetzen, zwei uebereinanderliegende Texte
 * dagegen kann jeder. Die Kontur laeuft nach aussen wie nach innen, deshalb
 * ist sie schmal gehalten - sie soll die Buchstaben absetzen und nicht
 * verdicken.
 */
function text(inhalt: string, farbe: string, saum: string, o: TextOptionen): string {
  const gemeinsam =
    `x="${o.x}" y="${o.y}" font-size="${o.grad}"` +
    (o.fett ? ' font-weight="bold"' : '') +
    (o.laufweite ? ` letter-spacing="${o.laufweite}"` : '') +
    (o.anker && o.anker !== 'start' ? ` text-anchor="${o.anker}"` : '');
  const sicher = escapeXml(inhalt);
  const breite = Math.max(1.6, o.grad * 0.085);
  /*
   * Der Saum folgt der Deckkraft des Textes.
   *
   * Sonst bekaeme die zurueckgenommene Zeile unter dem Namen einen Saum, der
   * kraeftiger ist als sie selbst - aus einer leisen Angabe wuerde eine
   * umrandete.
   */
  const saumDeckkraft = (0.5 * (o.deckkraft ?? 1)).toFixed(3);
  return (
    `<text ${gemeinsam} fill="none" stroke="${saum}" stroke-width="${breite.toFixed(2)}" stroke-linejoin="round" stroke-opacity="${saumDeckkraft}">${sicher}</text>` +
    `<text ${gemeinsam} fill="${farbe}"${o.deckkraft !== undefined ? ` fill-opacity="${o.deckkraft}"` : ''}>${sicher}</text>`
  );
}

/** Baut die Levelkarte als SVG-Zeichenkette. */
export function renderLevelCardSvg(input: LevelCardInput): string {
  const progress = levelProgress(input.xp, input.maxLevelTotalXp);
  const prestige = progress.isMaxLevel;
  const g = raster(prestige);
  const width = CARD_WIDTH;
  const height = g.hoehe;

  const accent = /^#[0-9A-Fa-f]{6}$/u.test(input.accentColor ?? '')
    ? (input.accentColor as string).toUpperCase()
    : '#83060A';

  // Die gewaehlte Farbe gilt fuer alle Texte der Karte - auch im
  // Hoechstlevel. Wer Gold durch etwas anderes ersetzt, hat das so gewollt.
  const textfarbe =
    normalisiereTextfarbe(input.textColor) ?? (prestige ? PRESTIGE_TEXTFARBE : STANDARD_TEXTFARBE);
  const saum = saumfarbe(textfarbe);
  const zier = prestige ? PRESTIGE_TEXTFARBE : accent;

  const avatarR = g.avatarGroesse / 2;
  const avatarY = Math.round((height - g.avatarGroesse) / 2);
  const avatarCx = g.avatarX + avatarR;
  const avatarCy = avatarY + avatarR;

  // --- Die rechte Levelmarke -------------------------------------------------
  // Erst messen, dann den Namen begrenzen: der Name darf so weit laufen, wie
  // hier wirklich nichts mehr steht.
  const levelZahl = String(progress.level);
  const levelLabel = 'LEVEL';
  const levelLabelLaufweite = prestige ? 4 : 3.4;
  const levelBlockBreite = Math.max(
    messeText(levelZahl, g.levelZahlGrad, true),
    messeText(levelLabel, g.levelLabelGrad, true) + levelLabelLaufweite * levelLabel.length,
  );

  const nameMaxBreite = g.rechtsX - levelBlockBreite - 30 - g.textX;
  const name = truncateName(input.displayName, Math.max(60, nameMaxBreite), g.nameGrad);

  // --- Die Zeilen ------------------------------------------------------------
  const metaZeile = `Rang #${input.rank}  ·  ${formatXp(progress.xp)} XP`;
  const fussZeile = prestige
    ? 'Höchstlevel erreicht'
    : `Nächstes Level: ${formatXp(progress.nextLevelXp)} XP`;
  const prozent = Math.round(progress.progress * 100);
  const prozentText = `${prozent} %`;

  // --- Der Fortschrittsbalken ------------------------------------------------
  const balkenX = g.textX;
  const balkenBreite = g.rechtsX - balkenX;
  const balkenR = g.balkenHoehe / 2;
  const fuellBreite = Math.round(balkenBreite * progress.progress);
  /*
   * Ein Fortschritt von einem Prozent ist schmaler als der Radius der
   * abgerundeten Enden - gezeichnet wuerde dann ein verformter Tropfen. Ab
   * einem Fortschritt ueber null bekommt der Balken deshalb mindestens seine
   * eigene Hoehe, und der Radius folgt der tatsaechlichen Breite.
   */
  const fuellSichtbar = progress.progress > 0 ? Math.max(g.balkenHoehe, fuellBreite) : 0;

  const hintergrund = input.bannerSrc
    ? `<image href="${escapeXml(input.bannerSrc)}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice" />`
    : `<rect x="0" y="0" width="${width}" height="${height}" fill="url(#akzentverlauf)" />`;

  const avatar = input.avatarSrc
    ? `<image href="${escapeXml(input.avatarSrc)}" x="${g.avatarX}" y="${avatarY}" width="${g.avatarGroesse}" height="${g.avatarGroesse}" clip-path="url(#avatarClip)" preserveAspectRatio="xMidYMid slice" />`
    : `<circle cx="${avatarCx}" cy="${avatarCy}" r="${avatarR}" fill="#1F2023" />
    ${text('?', textfarbe, saum, { x: avatarCx, y: avatarCy + Math.round(avatarR * 0.33), grad: Math.round(avatarR * 0.9), fett: true, deckkraft: 0.35, anker: 'middle' })}`;

  const augenbraue =
    prestige && g.augenbraueY !== null
      ? text('HÖCHSTLEVEL', textfarbe, saum, {
          x: g.textX,
          y: g.augenbraueY,
          grad: g.augenbraueGrad,
          fett: true,
          deckkraft: 0.72,
          laufweite: 5,
        })
      : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Levelkarte von ${escapeXml(name)}, Level ${progress.level}, Rang ${input.rank}, ${formatXp(progress.xp)} XP, ${prozent} Prozent bis zum nächsten Level">
  <defs>
    <clipPath id="kartenrand">
      <rect x="0" y="0" width="${width}" height="${height}" rx="22" />
    </clipPath>
    <clipPath id="avatarClip">
      <circle cx="${avatarCx}" cy="${avatarCy}" r="${avatarR}" />
    </clipPath>
    <linearGradient id="akzentverlauf" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${accent}" stop-opacity="0.95" />
      <stop offset="0.6" stop-color="${accent}" stop-opacity="0.62" />
      <stop offset="1" stop-color="${accent}" stop-opacity="0.3" />
    </linearGradient>
    <!--
      Der Verlauf, der die Karte lesbar macht: links, wo der Text steht,
      kraeftig; rechts nur noch angedeutet, damit vom Hintergrundbild etwas
      uebrig bleibt.

      Ueber einem Bild muss er viel leisten - es kann hell sein, bunt, unruhig.
      Ueber der Akzentfarbe muss er fast nichts leisten: die ist bereits dunkel
      und ruhig. Derselbe Verlauf fuer beides machte entweder das Bild
      unlesbar oder die Farbkarte flach und schwarz.
    -->
    <linearGradient id="schleier" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${SCHLEIER}" stop-opacity="${input.bannerSrc ? 0.82 : 0.42}" />
      <stop offset="0.55" stop-color="${SCHLEIER}" stop-opacity="${input.bannerSrc ? 0.6 : 0.24}" />
      <stop offset="1" stop-color="${SCHLEIER}" stop-opacity="${input.bannerSrc ? 0.44 : 0.12}" />
    </linearGradient>
    <linearGradient id="fussschatten" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${SCHLEIER}" stop-opacity="0" />
      <stop offset="1" stop-color="${SCHLEIER}" stop-opacity="0.35" />
    </linearGradient>
    <linearGradient id="balkenfuellung" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${zier}" />
      <stop offset="1" stop-color="${textfarbe}" />
    </linearGradient>
  </defs>

  <g clip-path="url(#kartenrand)">
    <rect x="0" y="0" width="${width}" height="${height}" fill="${GRUNDTON}" />
    ${hintergrund}
    <rect x="0" y="0" width="${width}" height="${height}" fill="url(#schleier)" />
    <rect x="0" y="${Math.round(height * 0.55)}" width="${width}" height="${height - Math.round(height * 0.55)}" fill="url(#fussschatten)" />

    <!-- Die Kante links: das eine Rot, das die Karte auch ohne Hintergrundbild erkennbar macht. -->
    <rect x="0" y="0" width="7" height="${height}" fill="${zier}" />

    ${avatar}
    <circle cx="${avatarCx}" cy="${avatarCy}" r="${avatarR - 2}" fill="none" stroke="${zier}" stroke-opacity="0.9" stroke-width="${prestige ? 5 : 4}" />
    <circle cx="${avatarCx}" cy="${avatarCy}" r="${avatarR - 6}" fill="none" stroke="${textfarbe}" stroke-opacity="0.22" stroke-width="1.5" />

    <g font-family="${SCHRIFT}">
      ${augenbraue}
      ${text(name, textfarbe, saum, { x: g.textX, y: g.nameY, grad: g.nameGrad, fett: true })}
      ${text(metaZeile, textfarbe, saum, { x: g.textX, y: g.metaY, grad: g.metaGrad, deckkraft: 0.82 })}

      ${text(levelLabel, textfarbe, saum, { x: g.rechtsX, y: g.levelLabelY, grad: g.levelLabelGrad, fett: true, deckkraft: 0.58, laufweite: levelLabelLaufweite, anker: 'end' })}
      ${text(levelZahl, textfarbe, saum, { x: g.rechtsX, y: g.levelZahlY, grad: g.levelZahlGrad, fett: true, anker: 'end' })}

      ${text(fussZeile, textfarbe, saum, { x: g.textX, y: g.fussY, grad: g.fussGrad, deckkraft: 0.66 })}
      ${text(prozentText, textfarbe, saum, { x: g.rechtsX, y: g.fussY, grad: g.prozentGrad, fett: true, deckkraft: 0.9, anker: 'end' })}
    </g>

    <rect x="${balkenX}" y="${g.balkenY}" width="${balkenBreite}" height="${g.balkenHoehe}" rx="${balkenR}" fill="${SCHLEIER}" fill-opacity="0.55" />
    <rect x="${balkenX}" y="${g.balkenY}" width="${balkenBreite}" height="${g.balkenHoehe}" rx="${balkenR}" fill="none" stroke="${textfarbe}" stroke-opacity="0.16" stroke-width="1" />
    ${fuellSichtbar > 0 ? `<rect x="${balkenX}" y="${g.balkenY}" width="${fuellSichtbar}" height="${g.balkenHoehe}" rx="${balkenR}" fill="url(#balkenfuellung)" fill-opacity="0.95" />` : ''}
  </g>
</svg>`;
}
