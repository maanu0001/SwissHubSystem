/**
 * Profil-Themes - die visuelle Ebene ueber dem Profil.
 *
 * ## Was ein Theme ist und was nicht
 *
 * Ein Theme aendert **nur die Darstellung** der oeffentlichen Profilseite.
 * Es entscheidet nichts darueber, welche Daten dort stehen - das tun
 * weiterhin die Privatsphaere-Einstellungen. Banner, Avatar, Bio, Spiele
 * und Auszeichnungen bleiben dieselben Bausteine; sie bekommen eine andere
 * Buehne.
 *
 * ## Warum das kein zweites Gestaltungssystem ist
 *
 * `gestaltung.ts` daneben regelt Akzent, Flaechenton und Bannervorlage -
 * die Wahl, die **jedem** Mitglied offensteht. Diese Datei legt eine
 * zusaetzliche Schicht darauf: eine vollstaendige Farbwelt samt Kulisse.
 * Beide schreiben in dieselben CSS-Variablen; wer ein Theme waehlt,
 * ueberschreibt damit seine Akzentwahl auf der oeffentlichen Seite, und wer
 * keines waehlt, behaelt sie unveraendert.
 *
 * Kein zweites System heisst hier: es gibt weiterhin genau einen Ort, an
 * dem aus einem gespeicherten Schluessel CSS-Variablen werden, und das ist
 * `gestaltungsVariablen` - die Funktion nimmt jetzt ein Theme entgegen.
 *
 * ## Warum nur Schluessel gespeichert werden
 *
 * Derselbe Grund wie nebenan: gespeichert wird `"crimson"`, nie eine Farbe
 * und schon gar kein CSS. Was der Schluessel nicht trifft, faellt auf den
 * Standard zurueck. Aus einer Profilspalte kann damit nie ein Stylesheet
 * werden - die Auswahl ist eine Liste, keine Eingabe.
 *
 * ## Warum die Animation nur ein Klassenname ist
 *
 * `kulisse` ist ein Klassenname, keine CSS-Regel. Die Bewegung steht in
 * `profil-themes.css` - einmal, als CSS-Animation auf `transform` und
 * `opacity`, und damit auf der GPU statt im Hauptthread. Kein JavaScript
 * laeuft dafuer, nichts rendert neu, und `prefers-reduced-motion` schaltet
 * sie an einer Stelle ab.
 */

export type ProfilThemeId = 'classic' | 'crimson' | 'aurora' | 'cyber' | 'matrix' | 'nebula' | 'prestige';

export interface ProfilTheme {
  id: ProfilThemeId;
  label: string;
  beschreibung: string;
  /** Braucht es ein aktives Abonnement? */
  premium: boolean;
  /**
   * Die CSS-Variablen der Seite.
   *
   * Dieselben Namen, die `gestaltung.ts` setzt - ein Theme ueberschreibt
   * sie. `null` bedeutet: nichts ueberschreiben, die Wahl des Mitglieds
   * gilt. Das ist der Standardfall.
   */
  tokens: Record<string, string> | null;
  /** Klassenname der Kulisse - siehe `profil-themes.css`. */
  kulisse: string;
  /**
   * Der Bannerverlauf des Themes - oder `null` fuer Classic.
   *
   * ## Warum ein Theme das Banner mitbringt
   *
   * Ohne das sass in einem tuerkisen Aurora-Profil ein dunkelroter
   * Bannerkopf: die Bannervorlage ist eine eigene Wahl und wusste nichts
   * vom Theme. Das sah nicht nach zwei Entscheidungen aus, sondern nach
   * einem Fehler.
   *
   * ## Was weiterhin gilt
   *
   * Ein **hochgeladenes** Banner schlaegt alles. Es ist ein Bild, das
   * jemand ausgesucht hat; es durch einen Verlauf zu ersetzen, waere der
   * Verlust einer Einstellung. Der Verlauf hier ersetzt nur die
   * *Vorlage* - und auch die bleibt gespeichert und kommt zurueck, sobald
   * wieder Classic gilt.
   */
  bannerVerlauf: string | null;
  /** Zwei Farben fuer die Kachel in der Auswahl. */
  vorschau: { von: string; bis: string };
}

/**
 * Die Themes.
 *
 * Sechs Premium-Gestaltungen, und jede hat eine eigene Idee - nicht
 * sechsmal dieselbe Flaeche in einer anderen Farbe. Die Kulisse steht je
 * Theme in `profil-themes.css`; was sie tut, steht dort im Kommentar.
 */
const THEMES: readonly ProfilTheme[] = [
  {
    id: 'classic',
    label: 'SwissHub Classic',
    beschreibung: 'Die Hausgestaltung. Deine Akzentfarbe bestimmt das Bild.',
    premium: false,
    // Kein Ueberschreiben: hier gilt, was das Mitglied unter «Design»
    // gewaehlt hat. Deshalb ist der Standard auch kein Rueckschritt.
    tokens: null,
    kulisse: 'pt-classic',
    bannerVerlauf: null,
    vorschau: { von: '#1a1a1d', bis: '#0b0b0d' },
  },
  {
    id: 'crimson',
    label: 'Crimson Pulse',
    beschreibung: 'SwissHub-Rot auf Schwarz. Lichtlinien, die langsam atmen.',
    premium: true,
    tokens: {
      '--profil-flaeche': '354 24% 8%',
      '--profil-rand': '354 30% 18%',
      '--profil-akzent': '358 85% 58%',
      '--profil-akzent-gedaempft': '358 60% 14%',
    },
    kulisse: 'pt-crimson',
    bannerVerlauf:
      'radial-gradient(120% 150% at 15% 0%, hsl(358 65% 26%) 0%, transparent 58%), linear-gradient(160deg, hsl(354 30% 10%) 0%, hsl(354 24% 5%) 100%)',
    vorschau: { von: '#e02630', bis: '#2a070c' },
  },
  {
    id: 'aurora',
    label: 'Midnight Aurora',
    beschreibung: 'Tiefe Nacht, durch die farbige Schleier ziehen.',
    premium: true,
    tokens: {
      '--profil-flaeche': '230 26% 9%',
      '--profil-rand': '225 28% 19%',
      '--profil-akzent': '168 72% 55%',
      '--profil-akzent-gedaempft': '190 45% 15%',
    },
    kulisse: 'pt-aurora',
    bannerVerlauf:
      'radial-gradient(110% 130% at 25% 10%, hsl(168 55% 24%) 0%, transparent 56%), radial-gradient(95% 120% at 78% 15%, hsl(262 55% 28%) 0%, transparent 60%), linear-gradient(180deg, hsl(230 26% 11%) 0%, hsl(230 26% 6%) 100%)',
    vorschau: { von: '#3ddbb0', bis: '#1a1440' },
  },
  {
    id: 'cyber',
    label: 'Cyber Blue',
    beschreibung: 'Kühles Blau, ein wanderndes Raster, kein Neon-Kitsch.',
    premium: true,
    tokens: {
      '--profil-flaeche': '215 40% 8%',
      '--profil-rand': '204 55% 20%',
      '--profil-akzent': '196 92% 58%',
      '--profil-akzent-gedaempft': '204 60% 14%',
    },
    kulisse: 'pt-cyber',
    bannerVerlauf:
      'radial-gradient(110% 140% at 50% -10%, hsl(196 70% 26%) 0%, transparent 60%), repeating-linear-gradient(90deg, transparent 0 46px, hsl(196 80% 40% / 0.14) 46px 47px, transparent 47px 94px), linear-gradient(180deg, hsl(215 40% 10%) 0%, hsl(215 40% 5%) 100%)',
    vorschau: { von: '#35c6f4', bis: '#071a2b' },
  },
  {
    id: 'matrix',
    label: 'Emerald Matrix',
    beschreibung: 'Schwarz und Smaragd. Partikel, die nach unten treiben.',
    premium: true,
    tokens: {
      '--profil-flaeche': '155 22% 6%',
      '--profil-rand': '152 32% 16%',
      '--profil-akzent': '150 76% 50%',
      '--profil-akzent-gedaempft': '152 45% 12%',
    },
    kulisse: 'pt-matrix',
    bannerVerlauf:
      'radial-gradient(110% 140% at 50% -10%, hsl(152 60% 20%) 0%, transparent 58%), linear-gradient(180deg, hsl(155 22% 8%) 0%, hsl(155 22% 4%) 100%)',
    vorschau: { von: '#27d77f', bis: '#04150d' },
  },
  {
    id: 'nebula',
    label: 'Violet Nebula',
    beschreibung: 'Violette Weite mit Tiefe - zwei Ebenen, die sich versetzt bewegen.',
    premium: true,
    tokens: {
      '--profil-flaeche': '268 30% 10%',
      '--profil-rand': '272 34% 22%',
      '--profil-akzent': '276 82% 68%',
      '--profil-akzent-gedaempft': '272 50% 16%',
    },
    kulisse: 'pt-nebula',
    bannerVerlauf:
      'radial-gradient(100% 130% at 30% 5%, hsl(276 60% 32%) 0%, transparent 58%), radial-gradient(90% 120% at 80% 30%, hsl(310 55% 30%) 0%, transparent 60%), linear-gradient(180deg, hsl(268 30% 12%) 0%, hsl(268 30% 6%) 100%)',
    vorschau: { von: '#b06bf0', bis: '#1b0b33' },
  },
  {
    id: 'prestige',
    label: 'Golden Prestige',
    beschreibung: 'Schwarz und Gold. Ein Lichtreflex, der einmal darüberläuft.',
    premium: true,
    tokens: {
      '--profil-flaeche': '40 14% 7%',
      '--profil-rand': '40 28% 18%',
      '--profil-akzent': '42 88% 60%',
      '--profil-akzent-gedaempft': '40 45% 13%',
    },
    kulisse: 'pt-prestige',
    bannerVerlauf:
      'radial-gradient(110% 150% at 50% -20%, hsl(42 55% 26%) 0%, transparent 58%), linear-gradient(180deg, hsl(40 16% 9%) 0%, hsl(40 14% 4%) 100%)',
    vorschau: { von: '#e8b44a', bis: '#16120a' },
  },
];

const NACH_ID = new Map(THEMES.map((eintrag) => [eintrag.id, eintrag]));

export const STANDARD_THEME = THEMES[0] as ProfilTheme;

export function alleProfilThemes(): readonly ProfilTheme[] {
  return THEMES;
}

/**
 * Ein Theme nachschlagen.
 *
 * Nie `undefined`: ein Schluessel, den es nicht mehr gibt - etwa weil ein
 * Theme zurueckgezogen wurde -, ist ein Standard und kein Fehler. Das
 * Profil bleibt lesbar.
 */
export function profilTheme(id: string | null | undefined): ProfilTheme {
  return (id ? NACH_ID.get(id as ProfilThemeId) : undefined) ?? STANDARD_THEME;
}

export function istProfilTheme(id: string): boolean {
  return NACH_ID.has(id as ProfilThemeId);
}

/**
 * Welches Theme tatsaechlich gilt.
 *
 * ## Der Fall, um den es hier geht
 *
 * Jemand waehlt «Golden Prestige» und laesst sein Abonnement auslaufen. Die
 * **Wahl bleibt gespeichert** - sie zu loeschen hiesse, jemanden nach der
 * Rueckkehr noch einmal waehlen zu lassen und ihm die alte Entscheidung
 * stillschweigend zu nehmen. Was aufhoert, ist die Wirkung: oeffentlich
 * steht wieder die Standardgestaltung.
 *
 * Kommt das Abonnement zurueck, wirkt dieselbe gespeicherte Wahl wieder.
 * Es braucht dafuer keinen Zeitgeber und keinen Nachlauf - die Frage wird
 * beim Zeichnen gestellt, nicht beim Ablaufen beantwortet.
 */
export function wirksamesTheme(gewaehlt: string | null | undefined, hatPremium: boolean): ProfilTheme {
  const theme = profilTheme(gewaehlt);
  return theme.premium && !hatPremium ? STANDARD_THEME : theme;
}
