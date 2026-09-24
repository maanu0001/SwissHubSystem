/**
 * Aussehen eines Profils - Akzent, Thema, Bannervorlage.
 *
 * ## Warum nur Schluessel gespeichert werden
 *
 * Gespeichert wird `"gletscher"`, nicht `"195 80% 55%"` und schon gar nicht
 * `"red; background:url(...)"`. Der Schluessel wird hier nachgeschlagen; was
 * er nicht trifft, faellt auf den Standard zurueck. Damit kann aus einer
 * Profilspalte nie ein Stylesheet werden - die Auswahl ist eine Liste, keine
 * Eingabe.
 *
 * Das ist der ganze Schutz vor «frei eingebettetem CSS»: nicht filtern,
 * sondern gar nicht erst annehmen.
 *
 * ## Warum die Farben hier stehen und nicht in Tailwind
 *
 * Eine Tailwind-Klasse liesse sich nicht zur Laufzeit aus einem Schluessel
 * bauen - `text-${akzent}` existiert nach dem Build nicht. Die Ansicht setzt
 * deshalb eine CSS-Variable auf den Wert von hier. Der Wert stammt aus dieser
 * Datei, nie aus der Datenbank.
 */

export interface Akzent {
  key: string;
  label: string;
  /** HSL-Tripel ohne `hsl()`, so wie die uebrigen Variablen im Theme. */
  hsl: string;
  /** Etwas dunkler - fuer Flaechen hinter Text. */
  hslGedaempft: string;
}

const AKZENTE: readonly Akzent[] = [
  // Der Standard ist das helle SwissHub-Rot aus globals.css. Wer nichts
  // waehlt, bekommt das Haus-Rot - kein zufaelliges Zuteilen.
  { key: 'rot', label: 'SwissHub-Rot', hsl: '358 79% 52%', hslGedaempft: '358 70% 16%' },
  { key: 'gletscher', label: 'Gletscher', hsl: '195 85% 55%', hslGedaempft: '195 60% 16%' },
  { key: 'enzian', label: 'Enzian', hsl: '222 85% 62%', hslGedaempft: '222 55% 18%' },
  { key: 'alpenrose', label: 'Alpenrose', hsl: '330 78% 60%', hslGedaempft: '330 50% 18%' },
  { key: 'foehn', label: 'Föhn', hsl: '28 92% 56%', hslGedaempft: '28 60% 16%' },
  { key: 'alpweide', label: 'Alpweide', hsl: '142 62% 48%', hslGedaempft: '142 45% 14%' },
  { key: 'amethyst', label: 'Amethyst', hsl: '270 72% 64%', hslGedaempft: '270 45% 18%' },
  { key: 'schiefer', label: 'Schiefer', hsl: '215 16% 64%', hslGedaempft: '215 12% 18%' },
];

const AKZENT_NACH_KEY = new Map(AKZENTE.map((a) => [a.key, a]));

export const STANDARD_AKZENT = AKZENTE[0] as Akzent;

export function alleAkzente(): readonly Akzent[] {
  return AKZENTE;
}

/** Nie `undefined`: eine unbekannte Wahl ist ein Standard, kein Fehler. */
export function akzent(key: string | null | undefined): Akzent {
  return (key ? AKZENT_NACH_KEY.get(key) : undefined) ?? STANDARD_AKZENT;
}

export function istAkzent(key: string): boolean {
  return AKZENT_NACH_KEY.has(key);
}

/**
 * Bannervorlagen fuer Profile ohne eigenes Bild.
 *
 * «Der Profil-Header muss auch ohne individuelles Banner hervorragend
 * aussehen» - also gibt es hier keine graue Flaeche als Notloesung, sondern
 * acht Verlaeufe, die fuer sich stehen. Ein hochgeladenes Bild gilt vor der
 * Vorlage; die Vorlage verschwindet dann, bleibt aber gespeichert und kommt
 * zurueck, wenn das Bild geloescht wird.
 */
export interface Bannervorlage {
  key: string;
  label: string;
  /** Vollstaendiger `background-image`-Wert - aus dieser Datei, nie von aussen. */
  verlauf: string;
}

const BANNER: readonly Bannervorlage[] = [
  {
    key: 'nacht',
    label: 'Nacht',
    verlauf:
      'radial-gradient(120% 140% at 12% 0%, hsl(358 60% 22%) 0%, transparent 55%), linear-gradient(160deg, hsl(240 8% 10%) 0%, hsl(240 6% 4%) 100%)',
  },
  {
    key: 'gipfel',
    label: 'Gipfel',
    verlauf:
      'radial-gradient(110% 130% at 85% 10%, hsl(195 62% 26%) 0%, transparent 58%), linear-gradient(200deg, hsl(215 22% 12%) 0%, hsl(240 6% 5%) 100%)',
  },
  {
    key: 'daemmerung',
    label: 'Dämmerung',
    verlauf: 'linear-gradient(115deg, hsl(272 45% 22%) 0%, hsl(330 48% 24%) 45%, hsl(28 60% 26%) 100%)',
  },
  {
    key: 'tiefschnee',
    label: 'Tiefschnee',
    verlauf:
      'radial-gradient(90% 160% at 50% -20%, hsl(210 30% 28%) 0%, transparent 60%), linear-gradient(180deg, hsl(215 18% 12%) 0%, hsl(240 6% 5%) 100%)',
  },
  {
    key: 'lagerfeuer',
    label: 'Lagerfeuer',
    verlauf:
      'radial-gradient(100% 140% at 20% 100%, hsl(20 70% 30%) 0%, transparent 62%), linear-gradient(200deg, hsl(0 30% 12%) 0%, hsl(240 6% 5%) 100%)',
  },
  {
    key: 'nordlicht',
    label: 'Nordlicht',
    verlauf:
      'radial-gradient(120% 120% at 70% 0%, hsl(160 55% 26%) 0%, transparent 55%), radial-gradient(90% 120% at 10% 20%, hsl(222 60% 26%) 0%, transparent 60%), linear-gradient(180deg, hsl(230 18% 10%) 0%, hsl(240 6% 4%) 100%)',
  },
  {
    key: 'arena',
    label: 'Arena',
    verlauf:
      'repeating-linear-gradient(135deg, hsl(240 6% 8%) 0px, hsl(240 6% 8%) 14px, hsl(240 6% 10%) 14px, hsl(240 6% 10%) 28px), linear-gradient(180deg, hsl(358 50% 18%) 0%, transparent 70%)',
  },
  {
    key: 'granit',
    label: 'Granit',
    verlauf:
      'radial-gradient(130% 130% at 50% 0%, hsl(240 5% 16%) 0%, transparent 60%), linear-gradient(180deg, hsl(240 5% 9%) 0%, hsl(240 6% 4%) 100%)',
  },
];

const BANNER_NACH_KEY = new Map(BANNER.map((b) => [b.key, b]));

export const STANDARD_BANNER = BANNER[0] as Bannervorlage;

export function alleBannervorlagen(): readonly Bannervorlage[] {
  return BANNER;
}

export function bannervorlage(key: string | null | undefined): Bannervorlage {
  return (key ? BANNER_NACH_KEY.get(key) : undefined) ?? STANDARD_BANNER;
}

export function istBannervorlage(key: string): boolean {
  return BANNER_NACH_KEY.has(key);
}

/**
 * Themen - die Grundstimmung der Profilseite.
 *
 * Heute zwei, und beide dunkel: SwissHub ist eine dunkle Oberflaeche, ein
 * helles Profil darin waere ein Fremdkoerper. «Erweiterbar» heisst, dass ein
 * drittes Thema hier eine Zeile ist - nicht, dass jetzt schon zehn
 * dastehen muessen.
 */
export interface Thema {
  key: string;
  label: string;
  beschreibung: string;
  /** Flaechenton der Karten als HSL-Tripel. */
  hslFlaeche: string;
  /** Randton als HSL-Tripel. */
  hslRand: string;
}

const THEMEN: readonly Thema[] = [
  {
    key: 'swisshub',
    label: 'SwissHub',
    beschreibung: 'Die Hausfarben - dunkel, ruhig, roter Akzent.',
    hslFlaeche: '240 6% 7%',
    hslRand: '240 5% 14%',
  },
  {
    key: 'kohle',
    label: 'Kohle',
    beschreibung: 'Tiefer und kontrastreicher - der Akzent traegt allein.',
    hslFlaeche: '240 8% 5%',
    hslRand: '240 6% 11%',
  },
  {
    key: 'nebel',
    label: 'Nebel',
    beschreibung: 'Etwas heller und weicher, mit mehr Luft zwischen den Flächen.',
    hslFlaeche: '235 8% 11%',
    hslRand: '235 7% 19%',
  },
];

const THEMA_NACH_KEY = new Map(THEMEN.map((t) => [t.key, t]));

export const STANDARD_THEMA = THEMEN[0] as Thema;

export function alleThemen(): readonly Thema[] {
  return THEMEN;
}

export function thema(key: string | null | undefined): Thema {
  return (key ? THEMA_NACH_KEY.get(key) : undefined) ?? STANDARD_THEMA;
}

export function istThema(key: string): boolean {
  return THEMA_NACH_KEY.has(key);
}

/**
 * Die CSS-Variablen einer Gestaltung.
 *
 * Zusammengesetzt aus Werten dieser Datei - der Aufrufer reicht nur
 * Schluessel herein. Was hier herauskommt, darf in ein `style`-Attribut.
 */
export function gestaltungsVariablen(
  themaKey: string | null | undefined,
  akzentKey: string | null | undefined,
): Record<string, string> {
  const t = thema(themaKey);
  const a = akzent(akzentKey);
  return {
    '--profil-flaeche': t.hslFlaeche,
    '--profil-rand': t.hslRand,
    '--profil-akzent': a.hsl,
    '--profil-akzent-gedaempft': a.hslGedaempft,
  };
}
