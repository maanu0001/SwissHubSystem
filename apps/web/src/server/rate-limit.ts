import { consumeRateLimit, type RateLimitRule } from '@swisshub/database';
import { AppError } from '@swisshub/shared';

/**
 * Serverseitige Rate Limits.
 *
 * Die Limits sind bewusst grosszügig genug für echte Moderationsarbeit, aber
 * eng genug, um Automatisierung und Missbrauch zu bremsen.
 */
export const RATE_LIMITS = {
  login: { limit: 10, windowMs: 10 * 60 * 1000 },
  oauthCallback: { limit: 20, windowMs: 10 * 60 * 1000 },
  memberSearch: { limit: 40, windowMs: 60 * 1000 },
  memberCenter: { limit: 60, windowMs: 5 * 60 * 1000 },
  moderationWrite: { limit: 30, windowMs: 5 * 60 * 1000 },
  // Der Abruf einer Archivdatei ist einzeln billig, in Serie aber ein
  // Abzug des ganzen Archivs.
  analyticsDownload: { limit: 60, windowMs: 5 * 60 * 1000 },
  // Ein Export zieht bis zu 5000 Zeilen - selten und teuer.
  analyticsExport: { limit: 5, windowMs: 10 * 60 * 1000 },
  jailCreate: { limit: 10, windowMs: 5 * 60 * 1000 },
  jailRelease: { limit: 20, windowMs: 5 * 60 * 1000 },
  // Fasst in einem Zug jede gejailte Person an. Zweimal hintereinander gibt
  // es dafuer keinen Grund; die zweite Ausfuehrung waere ein Versehen.
  jailPurge: { limit: 2, windowMs: 60 * 60 * 1000 },
  settingsWrite: { limit: 30, windowMs: 5 * 60 * 1000 },
  discordAction: { limit: 60, windowMs: 5 * 60 * 1000 },
  reconciliation: { limit: 5, windowMs: 15 * 60 * 1000 },
  discordSync: { limit: 10, windowMs: 5 * 60 * 1000 },
  setupWrite: { limit: 20, windowMs: 15 * 60 * 1000 },
  voteJailStart: { limit: 10, windowMs: 10 * 60 * 1000 },
  communicationSend: { limit: 15, windowMs: 10 * 60 * 1000 },
  brandingUpload: { limit: 10, windowMs: 30 * 60 * 1000 },
  jailImport: { limit: 10, windowMs: 30 * 60 * 1000 },
  gameWrite: { limit: 60, windowMs: 10 * 60 * 1000 },
  levelWrite: { limit: 40, windowMs: 5 * 60 * 1000 },
  /**
   * Den eigenen Lesezustand aendern.
   *
   * Grosszuegig: wer zehn Meldungen durchgeht, drueckt zehnmal, und das
   * ist gewoehnliche Benutzung. Die Grenze bremst nur Automatisierung.
   */
  notificationRead: { limit: 120, windowMs: 5 * 60 * 1000 },
  /**
   * Eine Vorschau starten oder beenden.
   *
   * Eng: wer die Oberflaeche aus vier Blickwinkeln ansehen will, braucht
   * vier Umschaltungen, nicht vierzig. Die Grenze bremst das Durchprobieren
   * von Kennungen.
   */
  previewSwitch: { limit: 20, windowMs: 10 * 60 * 1000 },
  // Faehrt in einem Zug ueber jeden XP-Stand auf dem Server. Zweimal
  // hintereinander gibt es dafuer keinen Grund; die zweite Ausfuehrung
  // waere ein Versehen.
  levelReset: { limit: 2, windowMs: 60 * 60 * 1000 },
  /**
   * Teilnahme an einer Verlosung.
   *
   * Knapp bemessen: eine Person nimmt pro Verlosung genau einmal teil, mehr
   * als eine Handvoll Versuche gibt es also nicht zu tun. Gegen den
   * Doppelklick wirkt ohnehin schon der eindeutige Schlüssel.
   */
  raffleEnter: { limit: 10, windowMs: 5 * 60 * 1000 },
  raffleManage: { limit: 40, windowMs: 5 * 60 * 1000 },
  /** Ziehen und neu ziehen - selten und folgenreich. */
  raffleDraw: { limit: 10, windowMs: 10 * 60 * 1000 },
  /**
   * Wiedergabesteuerung.
   *
   * Grosszuegig: wer Musik hoert, drueckt oft auf Skip, und ein zu enges
   * Limit macht den Player unbenutzbar. Es bremst nur Automatisierung.
   */
  musicControl: { limit: 120, windowMs: 5 * 60 * 1000 },
  /**
   * Suche.
   *
   * Enger, weil jede Anfrage eine fremde Quelle belastet - der Legacy-Bot
   * hatte hier gar keinen Schutz.
   */
  musicSearch: { limit: 40, windowMs: 60 * 1000 },
  /** Eine Session starten oder beenden - selten und folgenreich. */
  musicSession: { limit: 20, windowMs: 10 * 60 * 1000 },
  /** Antworten, Notizen, Statusaenderungen - Support arbeitet zuegig. */
  ticketWrite: { limit: 120, windowMs: 5 * 60 * 1000 },
  /** Neue Tickets - eng, damit das Panel nicht als Spamknopf dient. */
  ticketCreate: { limit: 3, windowMs: 10 * 60 * 1000 },
  /** Kategorien und Panels pflegen - Verwaltung, nicht Alltag. */
  ticketAdmin: { limit: 40, windowMs: 10 * 60 * 1000 },
  /** Anmelden, Team gruenden, einchecken - selten und folgenreich. */
  tournamentParticipate: { limit: 20, windowMs: 10 * 60 * 1000 },
  /**
   * Das eigene Profil pflegen.
   *
   * Grosszuegig: der Editor speichert je Abschnitt, und wer sein Profil
   * einrichtet, speichert in zehn Minuten leicht zwanzigmal. Die Grenze
   * bremst Automatisierung, nicht das Einrichten.
   */
  profilWrite: { limit: 90, windowMs: 10 * 60 * 1000 },
  /** Ein Profilbanner hochladen - jedes Mal ein paar Megabyte. */
  profilUpload: { limit: 10, windowMs: 30 * 60 * 1000 },
  /**
   * Ein ganzes Wrapped-Archiv exportieren.
   *
   * Eng: jeder Aufruf rastert bis zu fuenfzehn Bilder zu je 1080x1920. Das
   * ist nichts, was man versehentlich oft tut - und nichts, was der Server
   * nebenbei mitmacht.
   */
  wrappedExport: { limit: 12, windowMs: 10 * 60 * 1000 },
  /** Einladungen: eng, damit die Teamsuche nicht zum Rundmail wird. */
  tournamentInvite: { limit: 30, windowMs: 10 * 60 * 1000 },
  /** Resultate melden und bestaetigen - waehrend eines Turniers zuegig. */
  tournamentResult: { limit: 60, windowMs: 5 * 60 * 1000 },
  /** Turnierverwaltung: Bracket, Matches, Preise, Leitung. */
  tournamentAdmin: { limit: 120, windowMs: 10 * 60 * 1000 },
  /**
   * Den eigenen Talk verwalten.
   *
   * Grosszuegig: waehrend eines Abends wird schon mal gesperrt, geoeffnet und
   * jemand hereingelassen. Die eigentliche Bremse beim Umbenennen ist die
   * Abkuehlzeit im Dienst - sie schuetzt vor dem Discord-Rate-Limit, das
   * dieses Fenster nicht kennt.
   */
  voiceOwn: { limit: 60, windowMs: 5 * 60 * 1000 },
  /** Hubs, Presets und fremde Talks - Verwaltung, nicht Alltag. */
  voiceAdmin: { limit: 60, windowMs: 10 * 60 * 1000 },
  /**
   * An- und Abmelden zu einem Event.
   *
   * Knapp: eine Person meldet sich je Event einmal an. Gegen den Doppelklick
   * wirkt ohnehin schon der eindeutige Schluessel.
   */
  calendarParticipate: { limit: 20, windowMs: 10 * 60 * 1000 },
  /** Events anlegen, bearbeiten, ankuendigen - Verwaltung, nicht Alltag. */
  calendarAdmin: { limit: 80, windowMs: 10 * 60 * 1000 },
  /**
   * Verifikationen entscheiden.
   *
   * Grosszuegig: nach einer Spamwelle arbeitet die Moderation eine lange
   * Warteschlange ab, und ein enges Fenster machte genau dann die Arbeit
   * unmoeglich, wenn sie noetig ist.
   */
  verificationReview: { limit: 120, windowMs: 5 * 60 * 1000 },

  /**
   * Zugangsdaten ändern.
   *
   * Eng: es gibt keinen Grund, in fünf Minuten zwanzig Mal ein Token zu
   * setzen. Wer es doch versucht, hat entweder ein Problem oder ist nicht der,
   * für den er sich ausgibt.
   */
  integrationWrite: { limit: 20, windowMs: 5 * 60 * 1000 },

  /**
   * «Verbindung testen».
   *
   * Jeder Test kostet eine echte Anfrage beim Anbieter und bei der AI auch
   * Geld (§48). Zehn in fünf Minuten reichen zum Einrichten und verhindern,
   * dass ein festgehaltener Knopf hundert Anfragen auslöst.
   */
  integrationTest: { limit: 10, windowMs: 5 * 60 * 1000 },

  /**
   * Automationen bauen und pflegen.
   *
   * Grosszuegig: wer eine Automation baut, speichert oft - jeder Schritt,
   * jede Bedingung. Ein enges Fenster machte das Bauen zur Geduldsprobe,
   * ohne etwas zu schuetzen: gespeichert wird ein Entwurf, der nichts tut.
   */
  automationWrite: { limit: 120, windowMs: 5 * 60 * 1000 },

  /**
   * Eine Automation ein- oder ausschalten.
   *
   * Enger als das Bearbeiten: erst das Einschalten macht aus einem Entwurf
   * etwas, das von selbst handelt.
   */
  automationToggle: { limit: 30, windowMs: 5 * 60 * 1000 },

  /**
   * Von Hand starten und Probelauf.
   *
   * Ein echter Lauf wirkt auf Discord; ein Probelauf kostet zwar nichts,
   * kann aber die AI befragen. Zwanzig in fuenf Minuten reichen zum Testen
   * und verhindern, dass ein festgehaltener Knopf hundert Laeufe ausloest.
   */
  automationExecute: { limit: 20, windowMs: 5 * 60 * 1000 },

  /**
   * Eine Uebertragung vorbereiten oder anwenden.
   *
   * Sehr eng. Ein Export liest die halbe Konfiguration, ein Probelauf
   * rechnet sie durch, und das Anwenden schreibt sie - nichts davon macht
   * jemand zwanzigmal in fuenf Minuten. Die Grenze schuetzt hier nicht vor
   * Missbrauch, sondern vor einem festgehaltenen Knopf.
   */
  migration: { limit: 10, windowMs: 5 * 60 * 1000 },

  /**
   * Einen Entbannungsantrag einreichen.
   *
   * Sehr eng, und das ist der Punkt: es gibt genau einen Grund, in einer
   * Stunde mehrfach einzureichen, und der ist Missbrauch. Ein ehrlicher
   * Antragsteller braucht einen Versuch. Der Doppelklick faengt ohnehin schon
   * der Idempotenzschluessel ab - diese Grenze faengt den Rest.
   */
  appealSubmit: { limit: 3, windowMs: 60 * 60 * 1000 },

  /**
   * Nachrichten und Rueckzug eines Antragstellers.
   *
   * Grosszuegiger als das Einreichen: eine Rueckfrage kann mehrere Antworten
   * brauchen. Eng genug, dass der Nachrichtenbereich kein Chat wird.
   */
  appealMessage: { limit: 20, windowMs: 10 * 60 * 1000 },

  /** Was das Team im Fall tut - uebernehmen, kommentieren, schreiben. */
  appealStaff: { limit: 120, windowMs: 5 * 60 * 1000 },

  /**
   * Entscheidungen.
   *
   * Eng, weil jede Entscheidung endgueltig ist und eine davon jemanden auf
   * den Server zurueckholt. Wer in fuenf Minuten zwanzig Faelle entscheidet,
   * liest sie nicht.
   */
  appealDecision: { limit: 20, windowMs: 5 * 60 * 1000 },

  /** Die AI-Zusammenfassung. Jede Anfrage kostet Geld (§48). */
  appealAi: { limit: 15, windowMs: 10 * 60 * 1000 },

  /** Anhaenge herunterladen. */
  appealDownload: { limit: 60, windowMs: 5 * 60 * 1000 },

  /**
   * Einen Clip einreichen.
   *
   * Eng, weil die Regel ohnehin einen Clip je Woche erlaubt. Was darueber
   * hinaus ankommt, ist entweder ein Versehen oder ein Versuch, die
   * Erkennung mit Adressen zu fuettern, bis eine durchrutscht.
   */
  clipSubmit: { limit: 10, windowMs: 10 * 60 * 1000 },

  /**
   * Abstimmen.
   *
   * Grosszuegiger als die Zahl der Stimmen: Stimmen lassen sich
   * zuruecknehmen und umsetzen, und wer sich beim Durchsehen zweimal
   * umentscheidet, soll dabei nicht ausgebremst werden.
   */
  clipVote: { limit: 60, windowMs: 5 * 60 * 1000 },

  /** Zufaelligen Clip ziehen - ein Knopf, den man gerne mehrfach drueckt. */
  clipRandom: { limit: 60, windowMs: 5 * 60 * 1000 },

  /** Einen Clip melden. */
  clipReport: { limit: 10, windowMs: 10 * 60 * 1000 },

  /**
   * Die Vorschau im Einreich-Assistenten.
   *
   * Sie prueft nur die Adresse - kein Abruf, kein fremder Server. Trotzdem
   * begrenzt: sie ist die Stelle, an der jemand hundert Adressen
   * durchprobieren wuerde, um zu sehen, welche Form durchkommt.
   */
  clipMetadata: { limit: 60, windowMs: 5 * 60 * 1000 },

  /** Die Gewinnerkarte zeichnen - je Aufruf ein gerendertes Bild. */
  clipShare: { limit: 20, windowMs: 10 * 60 * 1000 },

  /** Moderation und Verwaltung der Runden. */
  clipModerate: { limit: 120, windowMs: 10 * 60 * 1000 },

  /** Kampagnen anlegen, aendern, Szenen sortieren. */
  wrappedStudio: { limit: 120, windowMs: 10 * 60 * 1000 },
  /*
   * Clipdateien hochladen - eng.
   *
   * Jeder Versuch kostet Bandbreite und bis zu 100 MB Plattenplatz, bevor
   * ueberhaupt geprueft ist, ob die Datei ein Video ist. Fuenf Versuche in
   * zehn Minuten reichen fuer eine Einreichung samt zwei Fehlversuchen und
   * machen aus dem Endpunkt kein Werkzeug, mit dem sich die Platte fuellen
   * laesst.
   */
  clipUpload: { limit: 5, windowMs: 10 * 60 * 1000 },

  /**
   * Die Vorschau im Studio.
   *
   * Sie schreibt nichts, rechnet aber je Aufruf einen kompletten Rueckblick
   * durch - ueber ein Dutzend Abfragen, darunter zwei ueber die
   * Sprachabschnitte. Ohne Begrenzung waere ein offener Vorschau-Tab mit
   * Autoklick eine Last auf der Datenbank.
   */
  wrappedVorschau: { limit: 60, windowMs: 5 * 60 * 1000 },

  /** Veroeffentlichen, zurueckziehen, archivieren - selten und folgenreich. */
  wrappedFreigabe: { limit: 20, windowMs: 10 * 60 * 1000 },

  /**
   * Eine periodische Ausgabe erheben.
   *
   * Je Aufruf ein Durchgang ueber einen ganzen Monat oder ein ganzes Jahr -
   * bei der Jahresausgabe zwei Abfragen ueber saemtliche Personentage. Das
   * ist nichts, was man oft hintereinander tut.
   */
  wrappedGenerate: { limit: 20, windowMs: 10 * 60 * 1000 },

  /** Eine Karte zum Teilen zeichnen - je Aufruf ein gerendertes Bild. */
  wrappedShare: { limit: 30, windowMs: 10 * 60 * 1000 },

  /** Den eigenen Fortschritt im Rueckblick merken. */
  wrappedFortschritt: { limit: 240, windowMs: 10 * 60 * 1000 },

  /**
   * Eine Runde eroeffnen.
   *
   * Eng: eine Session ist ein Einladungslink, ein Discord-Beitrag und eine
   * Zeile, die zwoelf Stunden steht. Wer in zehn Minuten fuenf eroeffnet,
   * probiert etwas aus - mehr braucht dafuer niemand.
   */
  spielwahlEroeffnen: { limit: 5, windowMs: 10 * 60 * 1000 },

  /**
   * Beitreten, vorschlagen, zuruecknehmen, Ready.
   *
   * Grosszuegig: waehrend der Lobby tippt und klickt eine Gruppe viel, und
   * jeder Vorschlag ist eine Zeile. Die fachlichen Grenzen (Vorschlaege je
   * Person, Teilnehmerzahl) sitzen ohnehin daneben.
   */
  spielwahlMitmachen: { limit: 180, windowMs: 5 * 60 * 1000 },

  /**
   * Abstimmen.
   *
   * Eine Stimme laesst sich zuruecknehmen und umsetzen; bei einem
   * Ausscheidungsturnier mit fuenfzehn Duellen sind das schnell dreissig
   * Klicks. Die Eindeutigkeit sitzt in der Datenbank, nicht hier.
   */
  spielwahlStimme: { limit: 240, windowMs: 5 * 60 * 1000 },

  /**
   * Was nur der Host tut - Phase schliessen, Runde starten, nachlosen,
   * Ergebnis annehmen, jemanden entfernen.
   *
   * Enger als das Mitmachen, weil jede dieser Handlungen den Zustand fuer
   * alle aendert.
   */
  spielwahlFuehrung: { limit: 60, windowMs: 5 * 60 * 1000 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMITS;

/** Verbraucht ein Kontingent und wirft bei Überschreitung `RATE_LIMITED`. */
export async function enforceRateLimit(name: RateLimitName, identity: string): Promise<void> {
  const rule = RATE_LIMITS[name];
  const result = await consumeRateLimit(`${name}:${identity}`, rule);
  if (!result.allowed) {
    const seconds = Math.ceil(result.retryAfterMs / 1000);
    throw new AppError('RATE_LIMITED', {
      userMessage: `Zu viele Anfragen. Bitte in ${seconds} Sekunden erneut versuchen.`,
      details: { retryAfterSeconds: seconds },
    });
  }
}
