/**
 * Die Adressen der WebApp - an einer Stelle.
 *
 * Zwei Dinge hängen daran, und beide gingen ohne diese Datei schief.
 *
 * **Erstens Deep Links.** Der Bot schreibt Nachrichten, die ins System
 * verweisen; das System verweist zurück nach Discord. Stünde der Pfad eines
 * Tickets in einer Discord-Datei und in drei Komponenten, wäre die
 * Umbenennung einer Route ein Fehler, den erst ein Mitglied bemerkt - beim
 * Klick, auf einer 404.
 *
 * **Zweitens der Rückweg.** «Zurück zu Tickets» trägt die Adresse der Liste
 * mit. Eine Adresse, die aus einem Query-Parameter stammt, ist eine Adresse
 * aus fremder Hand: ohne Prüfung wäre sie eine offene Weiterleitung. Was als
 * intern gilt, steht deshalb hier und nicht an jeder Verwendungsstelle.
 *
 * Bewusst in `@swisshub/shared`: WebApp **und** Bot bauen dieselben Pfade,
 * und `shared` ist das einzige Paket, das beide ohne Umweg laden. Die
 * absolute Adresse entsteht daraus mit `appUrl()` aus `@swisshub/config` -
 * dort steht die Domain, genau einmal.
 */

/** Ein Pfad innerhalb der WebApp, immer mit führendem `/`. */
export type SystemRoute = string;

const id = (value: string): string => encodeURIComponent(value);

/**
 * Die Ziele, auf die von aussen verwiesen wird.
 *
 * Nur, was tatsächlich verlinkt wird - das ist keine Abbildung des gesamten
 * Routenbaums. Eine Funktion, die niemand aufruft, ginge beim nächsten Umbau
 * still kaputt.
 */
export const systemRoutes = {
  dashboard: (): SystemRoute => '/dashboard',

  /** Ein einzelnes Ticket. */
  ticket: (ticketId: string): SystemRoute => `/tickets/${id(ticketId)}`,
  tickets: (): SystemRoute => '/tickets',
  offeneTickets: (): SystemRoute => '/tickets/offen',

  /** Die Akte eines Mitglieds - die Sicht der Moderation. */
  mitglied: (discordId: string): SystemRoute => `/members/${id(discordId)}`,

  /*
   * Das Community-Profil - die Sicht der Mitglieder aufeinander.
   *
   * Bewusst eine andere Adresse als `mitglied`: hinter `/members` steht die
   * Akte mit Tickets, Jails und Notizen, hier steht, was jemand ueber sich
   * selbst erzaehlt. Zwei Sichten, zwei Adressen, zwei Berechtigungen.
   *
   * `profil()` ohne Kennung ist das eigene - und es kommt aus der Sitzung,
   * nicht aus der Adresszeile.
   */
  /*
   * Das eigene Profil liegt unter `/profil`, ein fremdes unter `/spieler`.
   *
   * Zwei Wurzeln und nicht eine, weil die Kopfzeile ihren Titel ueber den
   * laengsten passenden Praefix sucht: unter `/profil/<id>` stuende sonst
   * «Mein Profil» ueber dem Profil eines anderen. `/spieler` traegt seinen
   * Namen deshalb selbst - im Profilkopf, wo er hingehoert.
   */
  profil: (discordId?: string): SystemRoute => (discordId ? `/spieler/${id(discordId)}` : '/profil'),
  profilBearbeiten: (): SystemRoute => '/profil/bearbeiten',
  entdecken: (): SystemRoute => '/entdecken',
  /**
   * Die Selbstauskunft.
   *
   * Zeigt auf dieselbe Adresse wie `profil()`: beides ist die eigene Akte,
   * und es gibt sie nur einmal. Der Name bleibt, weil Aufrufer ihn
   * verwenden - `/profile` leitet weiter.
   */
  meineDaten: (): SystemRoute => '/profil',

  /*
   * Was spielen wir? - die gemeinsame Spielauswahl.
   *
   * Die Session wird ueber ihren Einladungswert adressiert und nicht ueber
   * ihre Kennung: der Wert steht in Discord-Nachrichten und Adresszeilen,
   * die interne Kennung soll das nicht.
   */
  spielwahl: (): SystemRoute => '/was-spielen-wir',
  spielwahlSession: (inviteToken: string): SystemRoute => `/was-spielen-wir/${id(inviteToken)}`,
  spielekatalog: (): SystemRoute => '/was-spielen-wir/games',

  /** Clip of the Week - der Wettbewerb der Community. */
  clips: (): SystemRoute => '/clips',
  clipEinreichen: (): SystemRoute => '/clips/einreichen',
  clipsZufall: (): SystemRoute => '/clips/zufall',
  clipModeration: (): SystemRoute => '/clips/moderation',
  clipVerwalten: (): SystemRoute => '/clips/verwalten',

  /*
   * SwissHub Wrapped.
   *
   * Der Rueckblick selbst liegt **ausserhalb** der Anwendungsgruppe: er ist
   * eine Vollbild-Geschichte und keine Seite mit Seitenleiste. Das Studio
   * liegt im System-Bereich, wo es hingehoert.
   */
  wrapped: (key: string): SystemRoute => `/wrapped/${id(key)}`,
  wrappedStudio: (): SystemRoute => '/system/wrapped',
  wrappedKampagne: (campaignId: string): SystemRoute => `/system/wrapped/${id(campaignId)}`,
  wrappedVorschau: (campaignId: string): SystemRoute => `/system/wrapped/${id(campaignId)}/vorschau`,
  /**
   * Die nackte Buehne fuer den Rahmen in der Werkbank.
   *
   * Ausserhalb der Anwendungsgruppe, weil sie in einem `iframe` steckt: nur
   * so sind `vw`, `dvh` und die Breakpoints die des gewaehlten Geraets und
   * nicht die des Browserfensters. Eine Vorschau, in der ein Telefon die
   * Schriftgroessen eines Desktops zeigt, prueft nichts.
   */
  wrappedBuehne: (campaignId: string): SystemRoute => `/wrapped-buehne/${id(campaignId)}`,

  /*
   * Die periodischen Ausgaben - Monat und Jahr.
   *
   * Unter dem Studio und nicht daneben: es ist dasselbe Modul, dieselbe
   * Berechtigung und dieselbe Arbeit. Eine zweite Hauptnavigation dafuer
   * waere ein zweiter Ort, an dem man Wrapped sucht.
   */
  wrappedAusgaben: (): SystemRoute => '/system/wrapped/ausgaben',
  wrappedAusgabe: (editionId: string): SystemRoute => `/system/wrapped/ausgaben/${id(editionId)}`,
  wrappedMomente: (): SystemRoute => '/system/wrapped/momente',
  hallOfFame: (): SystemRoute => '/clips/hall-of-fame',
  clipRunde: (key: string): SystemRoute => `/clips/runde/${id(key)}`,
  mitglieder: (): SystemRoute => '/members',

  /**
   * Die verleihbaren Auszeichnungen - die Liste selbst, nicht die Vergabe.
   *
   * Unter `/members`, weil es dazugehoert: verliehen wird in der
   * Mitgliederakte, und was sich verleihen laesst, steht hier. Ein eigener
   * Hauptbereich dafuer waere ein zweiter Ort, an dem man Auszeichnungen
   * sucht.
   */
  auszeichnungen: (): SystemRoute => '/members/auszeichnungen',

  /** Die Warteschlange der Verifikation. */
  verifikation: (): SystemRoute => '/verifikation/warteschlange',

  /** Ein einzelner Jail-Vorgang. */
  jail: (jailId: string): SystemRoute => `/moderation/jail/${id(jailId)}`,
  jails: (): SystemRoute => '/moderation/jail',
  moderation: (): SystemRoute => '/moderation',

  /** Ein Termin im Community-Kalender. */
  event: (slug: string): SystemRoute => `/kalender/${id(slug)}`,
  kalender: (): SystemRoute => '/kalender',

  /** Eine Automation und ein einzelner Lauf. */
  automation: (automationId: string): SystemRoute => `/automationen/${id(automationId)}`,
  automationen: (): SystemRoute => '/automationen',
  automationLauf: (runId: string): SystemRoute => `/automationen/laeufe/${id(runId)}`,

  /** Ein Turnier und eine einzelne Partie. */
  turnier: (tournamentId: string): SystemRoute => `/turniere/${id(tournamentId)}`,
  turniere: (): SystemRoute => '/turniere',
  turnierMatch: (tournamentId: string, matchId: string): SystemRoute =>
    `/turniere/${id(tournamentId)}/matches/${id(matchId)}`,

  /** Das XP-Glücksrad. */
  gluecksrad: (): SystemRoute => '/xp-gluecksrad',

  /** Systembereiche, auf die Benachrichtigungen zeigen. */
  integrationen: (): SystemRoute => '/integrationen',
  migration: (): SystemRoute => '/migration',
  audit: (): SystemRoute => '/audit',
} as const;

/**
 * Ist das eine Adresse innerhalb dieser Anwendung?
 *
 * Die Antwort entscheidet über offene Weiterleitungen, deshalb ist sie
 * bewusst eng und zählt auf, was erlaubt ist, statt zu raten, was verboten
 * wäre:
 *
 * - Ein einzelner führender Schrägstrich. `//example.org` ist für den Browser
 *   eine absolute Adresse auf ein fremdes Schema - genau die Falle.
 * - Kein Backslash. `/\example.org` wird von manchen Browsern wie `//`
 *   gelesen.
 * - Kein Doppelpunkt vor dem ersten Schrägstrich, also kein `javascript:`.
 * - Keine Steuerzeichen; ein eingeschobenes `\n` oder `\t` trennt Prüfung und
 *   Verwendung.
 *
 * Fragmente (`#`) sind erlaubt, Abfragen (`?`) ebenfalls - beides gehört zum
 * Kontext, der erhalten bleiben soll.
 */
export function istInterneRoute(value: unknown): value is SystemRoute {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) {
    return false;
  }
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return false;
  }
  // Steuerzeichen sind hier ausdruecklich gesucht: ein eingeschobenes `\n`
  // oder `\t` trennt Pruefung und Verwendung. Die Regel `no-control-regex`
  // warnt vor genau dem Muster, das hier die Absicht ist.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F]/u.test(value)) {
    return false;
  }
  // Ein Schema kann nur vor dem ersten Schrägstrich stehen - und der steht
  // hier an erster Stelle. Die Prüfung bleibt trotzdem stehen: sie kostet
  // nichts und faengt eine kuenftige Lockerung des Anfangs mit ab.
  const bisSchraegstrich = value.slice(1).split('/')[0] ?? '';
  return !bisSchraegstrich.includes(':');
}

/**
 * Eine Rückkehradresse, der man folgen darf.
 *
 * Gibt den geprüften Wert zurück oder den kanonischen Rückfall. Der Rückfall
 * ist keine Höflichkeit, sondern die Regel: eine Detailseite, die man über
 * einen Deep Link aus Discord betritt, hat keinen Verlauf - und soll trotzdem
 * einen Weg nach oben anbieten.
 */
export function sichereRueckkehr(value: unknown, rueckfall: SystemRoute): SystemRoute {
  return istInterneRoute(value) ? value : rueckfall;
}

/** Der Parameter, in dem die Rückkehradresse mitreist. */
export const RUECKKEHR_PARAM = 'von';

/**
 * Hängt die Rückkehradresse an einen Zielpfad.
 *
 * Eine Adresse, die selbst schon eine Rückkehr trägt, bekommt keine zweite:
 * sonst schaukelten sich bei jedem Schritt die Parameter auf, bis die Adresse
 * nicht mehr in ein Browserfeld passt.
 */
export function mitRueckkehr(ziel: SystemRoute, von: string | null | undefined): SystemRoute {
  if (!istInterneRoute(von)) {
    return ziel;
  }
  const [pfad, fragment] = ziel.split('#', 2) as [string, string?];
  const trenner = pfad.includes('?') ? '&' : '?';
  const neu = `${pfad}${trenner}${RUECKKEHR_PARAM}=${encodeURIComponent(von)}`;
  return fragment === undefined ? neu : `${neu}#${fragment}`;
}
