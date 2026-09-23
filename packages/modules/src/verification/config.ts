import { z } from 'zod';
import { registerModule, type ModuleDefinition } from '../registry';
import type { SettingsField } from '../settings/fields';
import type { ModuleHealthCheck, ModuleHealthContext } from '../health/types';

export const VERIFICATION_MODULE_ID = 'verification';

/** SwissHub-Rot, wie in den uebrigen Modulen. */
export const VERIFICATION_ACCENT_COLOR = 0x83060a;

/**
 * Berechtigungen der Verifikation.
 *
 * Bewusst getrennt zwischen `approve` und `reject`: freischalten ist eine
 * Gefaelligkeit, ablehnen ist ein Bann. Wer das eine darf, darf deshalb noch
 * lange nicht das andere - und die AI bekommt ohnehin keine dieser
 * Berechtigungen, weil sie kein Subjekt der Rechtepruefung ist, sondern
 * ausschliesslich den einen erlaubten Pfad im Dienst aufruft.
 *
 * Keine Pruefung auf Rollennamen. Was jemand darf, steht unter
 * Server → Berechtigungen.
 */
export const VERIFICATION_PERMISSIONS = {
  view: 'verification.view',
  /** Warteschlange oeffnen und Faelle ansehen. */
  review: 'verification.review',
  approve: 'verification.approve',
  /** Ablehnen heisst bannen - eigene, kritische Berechtigung. */
  reject: 'verification.reject',
  historyView: 'verification.history.view',
  aiManage: 'verification.ai.manage',
  settingsManage: 'verification.settings.manage',
} as const;

export type VerificationPermission = (typeof VERIFICATION_PERMISSIONS)[keyof typeof VERIFICATION_PERMISSIONS];

/**
 * Vorgabetext der Begruessung.
 *
 * `{user}` wird durch die Erwaehnung ersetzt. Der Text steht in den
 * Einstellungen und ist dort vollstaendig ersetzbar - hier steht nur, womit
 * ein frisch eingeschaltetes Modul anfaengt.
 */
export const DEFAULT_GREETING = [
  'Hoi {user} 👋',
  '',
  'Willkommen bei SwissHub!',
  '',
  'Damit wir den Server vor Spam- und Bot-Accounts schützen können, bitten wir dich',
  'kurz zu zeigen, dass du ein echter Mensch bist.',
  '',
  'Schreib bitte einfach einen kurzen Satz auf Schweizerdeutsch in diesen Kanal.',
  'Zum Beispiel, was du gerade spielst oder wie dein Tag war.',
  '',
  'Ein Moderator schaut sich deine Nachricht an und schaltet dich frei.',
].join('\n');

export const verificationSettingsSchema = z.object({
  // --- Rollen und Kanaele ------------------------------------------------
  /** Rolle, die neue Mitglieder erhalten. Ohne sie laeuft nichts. */
  unverifiedRoleId: z.string().nullable().default(null),
  /** Rolle nach erfolgreicher Verifikation. */
  memberRoleId: z.string().nullable().default(null),
  /**
   * Zweite Rolle nach erfolgreicher Verifikation.
   *
   * Getrennt von der Mitgliederrolle, weil die beiden verschiedene Fragen
   * beantworten: «Mitglied» oeffnet den Server, «Verifiziert» sagt, dass
   * jemand die Pruefung bestanden hat. Auf vielen Servern haengen daran
   * verschiedene Rechte, und wer beides in eine Rolle zwingt, kann sie
   * spaeter nicht mehr trennen.
   *
   * Freiwillig: wer nur eine Rolle vergibt, laesst sie leer.
   */
  verifiedRoleId: z.string().nullable().default(null),
  /** Kanal, in dem sich neue Mitglieder melden. */
  verificationChannelId: z.string().nullable().default(null),
  /** Wohin die Moderation benachrichtigt wird. */
  moderatorChannelId: z.string().nullable().default(null),
  /** Rolle, die bei einem neuen Fall erwaehnt wird. */
  moderatorPingRoleId: z.string().nullable().default(null),
  /** Zusaetzlicher Protokollkanal. */
  logChannelId: z.string().nullable().default(null),
  /**
   * Kanal fuer die Meldung nach erfolgreicher Verifikation.
   *
   * Der dritte Kanal des Moduls, und er hat einen anderen Zweck als die
   * beiden anderen - deshalb ein eigenes Feld und keine Doppelnutzung:
   *
   * - `verificationChannelId` ist der Ort, an dem noch **nicht** verifizierte
   *   Mitglieder schreiben. Nach der Entscheidung sehen sie ihn nicht mehr.
   * - `moderatorChannelId` gehoert dem Team; dort wird entschieden.
   * - Dieser Kanal gehoert der **Gemeinschaft**: hier steht, wer neu dazu
   *   gehoert, und hier koennen andere es lesen.
   *
   * Leer = keine Meldung. Das ist die Vorgabe, denn ein Kanal, den niemand
   * ausgesucht hat, ist kein guter Ort fuer eine oeffentliche Ankuendigung.
   */
  postVerificationChannelId: z.string().nullable().default(null),

  greetingMessage: z.string().max(2000).default(DEFAULT_GREETING),

  // --- Meldung nach erfolgreicher Verifikation -----------------------------
  /**
   * Ueberschrift der Meldung im Ergebniskanal.
   *
   * Sie und der Text darunter sind das, was die Gemeinschaft liest - deshalb
   * gehoeren beide ins Dashboard und nicht in den Code.
   */
  postVerificationTitle: z.string().max(200).default('Neu dabei'),
  /**
   * Der Text der Meldung.
   *
   * Platzhalter werden serverseitig ersetzt, und zwar nur diese drei:
   * `{user}` wird zur Erwaehnung, `{username}` und `{displayName}` zu den
   * jeweiligen Namen. Mehr gibt es bewusst nicht - eine Vorlage, die
   * beliebige Ausdruecke auswertet, waere eine Ausfuehrungsumgebung in einem
   * Textfeld.
   */
  postVerificationMessage: z
    .string()
    .max(2000)
    .default('{user} ist jetzt verifiziert. Willkommen bei SwissHub!'),
  /** Farbe des Embeds. */
  postVerificationColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/u, 'Bitte eine Hex-Farbe wie #83060A angeben.')
    .default('#3BA55D'),
  /**
   * Die Person in der Meldung erwaehnen.
   *
   * Aus als Vorgabe. Eine Erwaehnung benachrichtigt - und wer gerade
   * freigeschaltet wurde, hat die Nachricht des Bots ohnehin schon gelesen.
   * Wer den Ping will, schaltet ihn ein.
   */
  postVerificationMention: z.boolean().default(false),

  // --- Aufraeumen ----------------------------------------------------------
  /**
   * Den Verifikationskanal nach der Entscheidung aufraeumen.
   *
   * Entfernt werden ausschliesslich die Nachrichten der betroffenen Person
   * und die an sie gerichtete Begruessung des Bots. Nachrichten anderer
   * bleiben unberuehrt - der Kanal wird nicht geleert.
   */
  cleanupEnabled: z.boolean().default(true),
  /** Nachricht an die frisch freigeschaltete Person. Leer = keine. */
  welcomeMessage: z
    .string()
    .max(500)
    .default('Du wurdest erfolgreich verifiziert. Willkommen bei SwissHub! 🎉'),

  // --- AI ----------------------------------------------------------------
  /** Nachrichten ueberhaupt von der AI einordnen lassen. */
  aiEnabled: z.boolean().default(false),
  /**
   * Darf ein sicheres AI-Ergebnis selbst freischalten?
   *
   * Getrennt von `aiEnabled`: man kann die Einordnung erst eine Weile
   * mitlaufen lassen und den Vorschlag nur anzeigen, ehe man ihr das
   * Freischalten ueberlaesst.
   */
  aiAutoVerify: z.boolean().default(false),
  /**
   * Ab welcher Sicherheit selbsttaetig freigeschaltet wird.
   *
   * Bewusst hoch: ein faelschlich freigeschalteter Bot ist teurer als eine
   * Minute Wartezeit fuer ein echtes Mitglied.
   */
  aiThreshold: z.number().min(0.5).max(1).default(0.95),
  /**
   * Anbieter, Schluessel und Modell stehen NICHT hier.
   *
   * Sie werden zentral unter System -> Integrationen -> AI gepflegt und von
   * allen Modulen geteilt. Dieses Modul entscheidet nur, OB es die AI nutzt,
   * ob sie selbst freischalten darf und ab welcher Sicherheit - alles
   * Weitere waere derselbe Schluessel an einer zweiten Stelle.
   */
  /** Hoechstzahl der AI-Anfragen je Vorgang - Kostenbremse. */
  aiMaxAttempts: z.number().int().min(1).max(10).default(2),

  // --- Ablauf ------------------------------------------------------------
  /**
   * Nach dieser Zeit **ohne Nachricht** gilt der Vorgang als abgelaufen.
   *
   * In Minuten, weil Stunden die kuerzeste sinnvolle Frist nicht ausdruecken
   * konnten: eine Viertelstunde ist genug, um eine Zeile zu schreiben, und
   * kurz genug, dass ein Bot-Konto nicht tagelang im Server steht.
   *
   * **Die Frist gilt der Person, nicht der Moderation.** Gezaehlt wird nur,
   * solange der Vorgang auf eine Nachricht wartet. Sobald eine vorliegt,
   * wartet er auf eine Entscheidung - und ein Moderator, der sich Zeit
   * laesst, darf niemanden den Platz kosten. Das ist keine zusaetzliche
   * Pruefung, sondern der Zustand selbst: die faellige Abfrage kennt
   * ausschliesslich `WAITING_FOR_MESSAGE`.
   *
   * Eine eigene Deadline-Spalte braucht es dafuer nicht: `joinedAt` steht
   * bereits in der Datenbank, und die Frist ist eine Einstellung. Beides
   * uebersteht jeden Neustart, und wer die Frist aendert, aendert sie fuer
   * alle - nicht nur fuer die, die danach beitreten.
   */
  expireAfterMinutes: z.number().int().min(1).max(43_200).default(15),
  expireEnabled: z.boolean().default(true),
  /**
   * Nach Ablauf vom Server werfen.
   *
   * Ein Kick, **niemals ein Bann**: wer nichts geschrieben hat, hat nichts
   * getan. Er soll jederzeit wiederkommen koennen - deshalb geht vorher eine
   * Nachricht mit der Einladung raus.
   */
  kickOnExpire: z.boolean().default(true),

  /**
   * Was der Person vor dem Kick geschrieben wird.
   *
   * Dieselben drei Platzhalter wie ueberall im Modul, dazu `{invite}` fuer
   * den Einladungslink. Steht keiner zur Verfuegung, faellt der Platzhalter
   * ersatzlos weg - eine Nachricht mit einem leeren Link waere schlimmer als
   * eine ohne.
   */
  timeoutDmMessage: z
    .string()
    .max(1500)
    .default(
      'Hoi {displayName}\n\nDu wurdest von SwissHub entfernt, weil die Verifikation nicht innerhalb der Frist abgeschlossen wurde.\n\nDas ist keine Sperre: du kannst jederzeit wieder beitreten und die Verifikation neu starten.\n\n{invite}',
    ),
  /**
   * Der Einladungslink fuer die Rueckkehr.
   *
   * Leer heisst nicht «kein Link»: dann wird eine bestehende, unbefristete
   * Einladung des Servers verwendet. Erzeugt wird keine - eine neue
   * Einladung je Zeitueberschreitung waere eine Flut von Links, die niemand
   * mehr zuordnen kann, und sie braucht ein Recht, das der Bot nicht haben
   * muss.
   */
  rejoinInviteUrl: z
    .string()
    .trim()
    .max(200)
    .refine((wert) => wert === '' || /^https:\/\/(discord\.gg|discord\.com\/invite)\/[\w-]+$/u.test(wert), {
      message: 'Bitte einen Discord-Einladungslink angeben (https://discord.gg/…).',
    })
    .default(''),

  /**
   * Bereits verifizierte Personen bei erneutem Beitritt durchwinken.
   *
   * An als Vorgabe: wer schon einmal geprueft wurde, soll nicht jedes Mal
   * erneut antreten. Ein Bann bleibt davon unberuehrt - der greift auf
   * Discord-Ebene, ehe dieses Modul ueberhaupt etwas sieht.
   */
  trustReturningMembers: z.boolean().default(true),

  // --- Benachrichtigungen ------------------------------------------------
  notifyOnMessage: z.boolean().default(true),
  notifyOnAiVerify: z.boolean().default(true),
  notifyOnReject: z.boolean().default(true),

  /** Wie lange die Verifikationsnachricht aufbewahrt wird. */
  retentionDays: z.number().int().min(7).max(365).default(90),
});

export type VerificationSettings = z.infer<typeof verificationSettingsSchema>;

/** Obergrenze der Frist in Minuten - dreissig Tage. */
const FRIST_HOECHSTENS = 43_200;

/** Die Frist stand einmal in Stunden - und diese Zahl war ihre Vorgabe. */
const FRIST_ALTE_VORGABE_STUNDEN = 48;

/**
 * Was gespeichert steht, ehe es geprueft wird.
 *
 * Die Frist stand einmal in Stunden, und die Vorgabe waren achtundvierzig.
 * Beim Umstieg auf Minuten sind das zwei verschiedene Faelle, und sie
 * verdienen zwei verschiedene Antworten:
 *
 * - **Ein abweichender Wert wurde gewaehlt.** Wer die Frist damals auf zwoelf
 *   oder auf hundertsechzig Stunden gestellt hat, hat eine Entscheidung
 *   getroffen. Sie wird umgerechnet und bleibt bestehen.
 * - **Achtundvierzig stand einfach da.** Das ist keine Entscheidung, sondern
 *   die Vorgabe von damals - gespeichert, weil das Formular beim ersten
 *   Speichern alle Felder mitschickt. Sie wird durch die heutige Vorgabe
 *   ersetzt.
 *
 * Ein Umweg fuer eine Uebergangszeit, und er steht an genau einer Stelle:
 * dem Schema, mit dem das Modul seine Einstellungen liest. Das
 * ausgeschriebene `verificationSettingsSchema` bleibt daneben unveraendert -
 * es ist die Form, die das Dashboard speichert und die Tests pruefen.
 *
 * Sobald jemand die Einstellungen einmal speichert, ist der Umweg fuer diese
 * Installation erledigt: danach steht `expireAfterMinutes` in der Datenbank
 * und `expireAfterHours` gar nicht mehr.
 */
const verificationSettingsGelesen = z.preprocess((roh) => {
  if (!roh || typeof roh !== 'object' || Array.isArray(roh)) {
    return roh;
  }
  const werte = roh as Record<string, unknown>;
  if (werte.expireAfterMinutes !== undefined || typeof werte.expireAfterHours !== 'number') {
    return roh;
  }
  if (werte.expireAfterHours === FRIST_ALTE_VORGABE_STUNDEN) {
    // Die alte Vorgabe traegt keine Aussage - die heutige tritt an ihre Stelle.
    const { expireAfterHours: _alt, ...rest } = werte;
    return rest;
  }
  const minuten = Math.round(werte.expireAfterHours * 60);
  return {
    ...werte,
    expireAfterMinutes: Math.min(FRIST_HOECHSTENS, Math.max(1, minuten)),
  };
}, verificationSettingsSchema);

const verificationSettingsFields: SettingsField[] = [
  {
    key: 'unverifiedRoleId',
    label: 'Rolle «Noch nicht verifiziert»',
    description:
      'Erhält jedes neue Mitglied. Diese Rolle sollte auf Discord ausschliesslich den Verifikationskanal sehen.',
    type: 'discord-role',
    mustBeManageable: true,
    required: true,
    group: 'Rollen & Kanäle',
  },
  {
    key: 'memberRoleId',
    label: 'Rolle «Mitglied»',
    description: 'Wird nach erfolgreicher Verifikation vergeben.',
    type: 'discord-role',
    mustBeManageable: true,
    required: true,
    group: 'Rollen & Kanäle',
  },
  {
    key: 'verifiedRoleId',
    label: 'Rolle «Verifiziert»',
    description:
      'Wird zusätzlich zur Mitgliederrolle vergeben. Optional - leer lassen, wenn eine Rolle genügt.',
    type: 'discord-role',
    mustBeManageable: true,
    group: 'Rollen & Kanäle',
  },
  {
    key: 'verificationChannelId',
    label: 'Verifikationskanal',
    description: 'Hier begrüsst der Bot und hier schreiben neue Mitglieder.',
    type: 'discord-channel',
    channelKinds: ['text'],
    required: true,
    group: 'Rollen & Kanäle',
  },
  {
    key: 'moderatorChannelId',
    label: 'Moderations-Kanal',
    description: 'Wohin die Meldung über einen neuen Fall geht.',
    type: 'discord-channel',
    channelKinds: ['text'],
    required: true,
    group: 'Rollen & Kanäle',
  },
  {
    key: 'moderatorPingRoleId',
    label: 'Moderator-Erwähnung',
    description: 'Wird bei einem neuen Fall erwähnt. Ohne Eintrag pingt die Meldung niemanden.',
    type: 'discord-role',
    group: 'Rollen & Kanäle',
  },
  {
    key: 'logChannelId',
    label: 'Protokoll-Kanal',
    description: 'Optional: zusätzlicher Kanal für abgeschlossene Vorgänge.',
    type: 'discord-channel',
    channelKinds: ['text'],
    group: 'Rollen & Kanäle',
  },
  {
    key: 'postVerificationChannelId',
    label: 'Kanal nach erfolgreicher Verifikation',
    description:
      'Wohin die Meldung über ein frisch verifiziertes Mitglied geht. Nicht der Verifikationskanal - den sieht die Person danach nicht mehr. Leer lassen, um nichts zu melden.',
    type: 'discord-channel',
    channelKinds: ['text'],
    group: 'Rollen & Kanäle',
  },
  {
    key: 'greetingMessage',
    label: 'Begrüssungstext',
    description: '{user} wird durch die Erwähnung ersetzt.',
    type: 'textarea',
    maxLength: 2000,
    group: 'Texte',
  },
  {
    key: 'welcomeMessage',
    label: 'Nachricht nach Freischaltung',
    description:
      'Wird im Verifikationskanal gesendet. Leer lassen, um nichts zu senden - etwa, wenn stattdessen der Ergebniskanal genutzt wird.',
    type: 'text',
    maxLength: 500,
    group: 'Texte',
  },
  {
    key: 'postVerificationTitle',
    label: 'Meldung: Überschrift',
    description: 'Steht über der Meldung im Ergebniskanal.',
    type: 'text',
    maxLength: 200,
    group: 'Meldung nach Verifikation',
  },
  {
    key: 'postVerificationMessage',
    label: 'Meldung: Text',
    description:
      '{user} wird zur Erwähnung, {username} und {displayName} zu den Namen. Andere Platzhalter bleiben stehen.',
    type: 'textarea',
    maxLength: 2000,
    group: 'Meldung nach Verifikation',
  },
  {
    key: 'postVerificationColor',
    label: 'Meldung: Farbe',
    description: 'Hex-Farbe des Embeds.',
    type: 'text',
    maxLength: 7,
    placeholder: '#3BA55D',
    group: 'Meldung nach Verifikation',
  },
  {
    key: 'postVerificationMention',
    label: 'Person in der Meldung erwähnen',
    description:
      'Aus als Vorgabe: eine Erwähnung benachrichtigt, und wer freigeschaltet wurde, weiss es bereits.',
    type: 'boolean',
    group: 'Meldung nach Verifikation',
  },
  {
    key: 'cleanupEnabled',
    label: 'Verifikationskanal aufräumen',
    description:
      'Entfernt nach Freischaltung oder Bann die Nachrichten der betroffenen Person und die an sie gerichtete Begrüssung. Nachrichten anderer bleiben stehen.',
    type: 'boolean',
    group: 'Ablauf',
  },
  {
    key: 'aiEnabled',
    label: 'AI-Prüfung aktiv',
    description:
      'Die AI ordnet eingehende Nachrichten ein. Sie kann ausschliesslich freischalten oder an die Moderation abgeben - niemals ablehnen, bannen oder kicken.',
    type: 'boolean',
    group: 'AI',
  },
  {
    key: 'aiAutoVerify',
    label: 'AI darf selbst freischalten',
    description:
      'Aus: die Einordnung wird nur angezeigt, entschieden wird von Hand. An: ab der eingestellten Sicherheit schaltet die AI frei.',
    type: 'boolean',
    group: 'AI',
  },
  {
    key: 'aiThreshold',
    label: 'Sicherheit für automatische Freischaltung',
    description: 'Darunter entscheidet immer ein Mensch. 0.95 heisst 95 %.',
    type: 'number',
    min: 0.5,
    max: 1,
    step: 0.01,
    group: 'AI',
  },
  {
    key: 'aiMaxAttempts',
    label: 'AI-Anfragen je Vorgang',
    description: 'Begrenzt die Kosten, wenn jemand mehrfach schreibt.',
    type: 'number',
    min: 1,
    max: 10,
    unit: 'Anfragen',
    group: 'AI',
  },
  {
    key: 'expireEnabled',
    label: 'Vorgänge ablaufen lassen',
    description: 'Wer nichts schreibt, wird nach der eingestellten Frist als abgelaufen geführt.',
    type: 'boolean',
    group: 'Ablauf',
  },
  {
    key: 'expireAfterMinutes',
    label: 'Frist ohne Nachricht',
    description:
      'Gezählt wird nur, solange der Vorgang auf eine Nachricht wartet. Wer geschrieben hat, wartet auf die Moderation - und läuft nicht ab.',
    type: 'number',
    min: 1,
    max: 43200,
    unit: 'Minuten',
    group: 'Ablauf',
  },
  {
    key: 'kickOnExpire',
    label: 'Nach Ablauf vom Server entfernen',
    description:
      'Ein Kick ist kein Bann - die Person kann jederzeit wiederkommen. Vorher erhält sie eine Nachricht mit dem Grund und der Einladung.',
    type: 'boolean',
    group: 'Ablauf',
  },
  {
    key: 'timeoutDmMessage',
    label: 'Nachricht vor dem Entfernen',
    description:
      '{user}, {username} und {displayName} werden ersetzt, {invite} durch den Einladungslink. Leer lassen, um nichts zu senden.',
    type: 'textarea',
    maxLength: 1500,
    group: 'Ablauf',
  },
  {
    key: 'rejoinInviteUrl',
    label: 'Einladungslink für die Rückkehr',
    description:
      'Leer lassen, um eine bestehende unbefristete Einladung des Servers zu verwenden. Es wird keine neue erzeugt.',
    type: 'text',
    maxLength: 200,
    placeholder: 'https://discord.gg/…',
    group: 'Ablauf',
  },
  {
    key: 'trustReturningMembers',
    label: 'Bereits Verifizierte durchwinken',
    description: 'Wer schon einmal geprüft wurde, muss beim erneuten Beitritt nicht erneut antreten.',
    type: 'boolean',
    group: 'Ablauf',
  },
  {
    key: 'notifyOnMessage',
    label: 'Meldung bei neuer Nachricht',
    type: 'boolean',
    group: 'Benachrichtigungen',
  },
  {
    key: 'notifyOnAiVerify',
    label: 'Meldung bei AI-Freischaltung',
    type: 'boolean',
    group: 'Benachrichtigungen',
  },
  {
    key: 'notifyOnReject',
    label: 'Meldung bei Ablehnung',
    type: 'boolean',
    group: 'Benachrichtigungen',
  },
  {
    key: 'retentionDays',
    label: 'Aufbewahrung der Nachricht',
    description:
      'Danach wird der Nachrichtentext gelöscht. Der Vorgang selbst bleibt für die Nachvollziehbarkeit erhalten.',
    type: 'number',
    min: 7,
    max: 365,
    unit: 'Tage',
    group: 'Datenschutz',
  },
];

/**
 * Was an der Verifikation schiefstehen kann, ohne dass es auffaellt.
 *
 * Die Faelle hier sind allesamt still: neue Mitglieder bleiben haengen, die
 * Moderation erfaehrt nichts davon, und auf der Webseite sieht alles richtig
 * aus. Deshalb sind es Fehler und keine Hinweise.
 */
async function verificationHealthChecks(context: ModuleHealthContext): Promise<ModuleHealthCheck[]> {
  const checks: ModuleHealthCheck[] = [];
  const { getModuleSettings } = await import('../module-state');
  const settings = await getModuleSettings<VerificationSettings>(VERIFICATION_MODULE_ID);
  const fix = `/modules/${VERIFICATION_MODULE_ID}`;

  const rolle = (
    id: string | null,
    label: string,
    mussVergebbarSein: boolean,
    options: { pflicht?: boolean } = {},
  ): void => {
    if (!id) {
      if (options.pflicht === false) {
        // Freiwillig: keine Meldung. Eine Warnung fuer etwas, das man
        // bewusst leer laesst, ist Laerm.
        return;
      }
      checks.push({
        label,
        status: 'error',
        detail: 'Nicht gesetzt - der Ablauf startet nicht.',
        fixHref: fix,
      });
      return;
    }
    const eintrag = context.roles.find((wert) => wert.id === id);
    if (!eintrag) {
      checks.push({
        label,
        status: 'error',
        detail: 'Diese Rolle gibt es auf Discord nicht mehr.',
        fixHref: fix,
      });
      return;
    }
    // Der Bot kann nur Rollen vergeben, die unter seiner hoechsten stehen.
    // Ohne diese Pruefung faellt es erst auf, wenn das erste neue Mitglied
    // ohne Rolle im Server steht.
    if (mussVergebbarSein && eintrag.position >= context.botHighestPosition) {
      checks.push({
        label,
        status: 'error',
        detail: `«${eintrag.name}» steht über der Bot-Rolle - der Bot kann sie nicht vergeben.`,
        fixHref: fix,
      });
      return;
    }
    checks.push({ label, status: 'ok', detail: eintrag.name });
  };

  rolle(settings.unverifiedRoleId, 'Rolle «Noch nicht verifiziert»', true);
  rolle(settings.memberRoleId, 'Rolle «Mitglied»', true);
  // Die zweite Rolle ist freiwillig - aber wenn sie eingestellt ist, muss der
  // Bot sie vergeben koennen. Sonst faellt es erst auf, wenn das erste
  // Mitglied halb verifiziert dasteht.
  rolle(settings.verifiedRoleId, 'Rolle «Verifiziert»', true, { pflicht: false });

  const kanal = (id: string | null, label: string, pflicht: boolean): void => {
    if (!id) {
      if (pflicht) {
        checks.push({ label, status: 'error', detail: 'Nicht gesetzt.', fixHref: fix });
      }
      return;
    }
    const eintrag = context.channels.find((wert) => wert.id === id);
    checks.push(
      eintrag
        ? { label, status: 'ok', detail: `#${eintrag.name}` }
        : { label, status: 'error', detail: 'Dieser Channel existiert nicht mehr.', fixHref: fix },
    );
  };

  kanal(settings.verificationChannelId, 'Verifikationskanal', true);
  kanal(settings.moderatorChannelId, 'Moderations-Kanal', true);
  kanal(settings.logChannelId, 'Protokoll-Kanal', false);
  kanal(settings.postVerificationChannelId, 'Kanal nach Verifikation', false);

  // Der haeufigste Konfigurationsfehler an dieser Stelle: der Ergebniskanal
  // ist derselbe wie der Verifikationskanal. Dort sieht die frisch
  // verifizierte Person nichts mehr - sie verliert den Zugang genau in dem
  // Moment, in dem die Meldung erscheint.
  if (
    settings.postVerificationChannelId &&
    settings.postVerificationChannelId === settings.verificationChannelId
  ) {
    checks.push({
      label: 'Kanal nach Verifikation',
      status: 'warning',
      detail:
        'Zeigt auf den Verifikationskanal. Den sieht niemand mehr, sobald er verifiziert ist - die Meldung liest also keiner.',
      fixHref: fix,
    });
  }

  /*
   * Der Ablauf ist still, wenn er nicht tut, was jemand erwartet.
   *
   * «Vorgaenge laufen ab» und «niemand wird entfernt» ergeben zusammen einen
   * Zustand, in dem abgelaufene Vorgaenge zwar als abgelaufen gefuehrt
   * werden, die Person aber mit der Rolle «Noch nicht verifiziert» im Server
   * sitzen bleibt - unsichtbar fuer alle und auf Dauer.
   */
  if (settings.expireEnabled) {
    const frist =
      settings.expireAfterMinutes < 60
        ? `${settings.expireAfterMinutes} Minuten`
        : `${Math.round(settings.expireAfterMinutes / 60)} Stunden`;
    checks.push(
      settings.kickOnExpire
        ? { label: 'Frist ohne Nachricht', status: 'ok', detail: `${frist}, danach Kick.` }
        : {
            label: 'Frist ohne Nachricht',
            status: 'warning',
            detail: `${frist}. Es wird niemand entfernt - abgelaufene Vorgänge bleiben mit der Rolle «Noch nicht verifiziert» im Server stehen.`,
            fixHref: fix,
          },
    );
  } else {
    checks.push({
      label: 'Frist ohne Nachricht',
      status: 'warning',
      detail: 'Abgeschaltet. Wer nie schreibt, bleibt unbegrenzt im Server stehen.',
      fixHref: fix,
    });
  }

  // Ohne Message Content sieht der Bot den Text nicht - und ohne Text gibt es
  // nichts zu pruefen. Das Modul waere dann eine Attrappe.
  const { discord } = await import('@swisshub/discord');
  const messageContent = await discord.bot.messageContentAllowed().catch(() => null);
  if (messageContent === null) {
    checks.push({ label: 'Message Content Intent', status: 'warning', detail: 'Nicht prüfbar.' });
  } else if (!messageContent) {
    checks.push({
      label: 'Message Content Intent',
      status: 'error',
      detail:
        'Im Discord Developer Portal nicht freigeschaltet. Ohne ihn liest der Bot keine Nachrichten - die Verifikation kann nicht funktionieren.',
    });
  } else {
    checks.push({ label: 'Message Content Intent', status: 'ok', detail: 'Freigeschaltet.' });
  }

  // AI: eingeschaltet, aber ohne Schluessel - dann prueft nichts, und
  // niemand merkt es.
  if (settings.aiEnabled) {
    const { readAiSettings, aiUsable } = await import('../ai/settings');
    const ai = await readAiSettings();
    checks.push(
      (await aiUsable())
        ? { label: 'AI-Prüfung', status: 'ok', detail: `Aktiv (${ai.provider}, ${ai.model}).` }
        : {
            label: 'AI-Prüfung',
            status: 'error',
            detail: ai.enabled
              ? 'Eingeschaltet, aber unter System → Integrationen → AI ist kein Schlüssel hinterlegt. Es wird nichts geprüft.'
              : 'Hier eingeschaltet, aber die zentrale AI-Integration ist aus. Es wird nichts geprüft.',
            fixHref: '/system/integrationen/ai',
          },
    );
  }

  return checks;
}

export const verificationModule: ModuleDefinition = registerModule({
  id: VERIFICATION_MODULE_ID,
  name: 'Verifikation',
  description:
    'Neue Mitglieder schreiben einen Satz auf Schweizerdeutsch und werden von der Moderation - oder sicher genug von der AI - freigeschaltet.',
  icon: 'ShieldCheck',
  permissionPrefix: 'verification',
  defaultEnabled: false,
  settingsSchema: verificationSettingsGelesen,
  settingsFields: verificationSettingsFields,
  healthChecks: verificationHealthChecks,
  permissions: [
    {
      key: VERIFICATION_PERMISSIONS.view,
      label: 'Verifikation ansehen',
      description: 'Übersicht und Kennzahlen des Moduls sehen.',
      module: VERIFICATION_MODULE_ID,
    },
    {
      key: VERIFICATION_PERMISSIONS.review,
      label: 'Warteschlange bearbeiten',
      description: 'Wartende Fälle mit Nachricht und Kontoangaben einsehen.',
      module: VERIFICATION_MODULE_ID,
    },
    {
      key: VERIFICATION_PERMISSIONS.approve,
      label: 'Mitglieder freischalten',
      description: 'Einen Fall verifizieren und die Mitgliederrolle vergeben.',
      module: VERIFICATION_MODULE_ID,
    },
    {
      key: VERIFICATION_PERMISSIONS.reject,
      label: 'Ablehnen und bannen',
      description: 'Einen Fall ablehnen. Das bannt die Person - deshalb getrennt vom Freischalten vergeben.',
      module: VERIFICATION_MODULE_ID,
      critical: true,
    },
    {
      key: VERIFICATION_PERMISSIONS.historyView,
      label: 'Verlauf einsehen',
      description: 'Abgeschlossene Vorgänge mit Ergebnis, Entscheider und Grund.',
      module: VERIFICATION_MODULE_ID,
    },
    {
      key: VERIFICATION_PERMISSIONS.aiManage,
      label: 'AI-Prüfung verwalten',
      description: 'AI ein- und ausschalten, Schwelle und Modell festlegen.',
      module: VERIFICATION_MODULE_ID,
      critical: true,
    },
    {
      key: VERIFICATION_PERMISSIONS.settingsManage,
      label: 'Verifikation einrichten',
      description: 'Rollen, Kanäle, Texte und Fristen festlegen.',
      module: VERIFICATION_MODULE_ID,
      critical: true,
    },
  ],
  navigation: [
    {
      href: '/verifikation',
      label: 'Verifikation',
      description: 'Neue Mitglieder prüfen und freischalten',
      permission: VERIFICATION_PERMISSIONS.view,
      icon: 'ShieldCheck',
      group: 'moderation',
      order: 30,
      altPermissions: [VERIFICATION_PERMISSIONS.review, VERIFICATION_PERMISSIONS.settingsManage],
    },
  ],
});
