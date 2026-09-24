/**
 * Die verleihbaren Auszeichnungen pflegen.
 *
 * ## Warum diese Datei entstanden ist
 *
 * Die fuenf verleihbaren Arten standen als `readonly`-Konstante im
 * Quelltext. Verleihen liess sich damit - anlegen nicht. Wer eine sechste
 * wollte, brauchte einen Entwickler, einen Commit und ein Deployment. Das
 * ist der Grund, warum im Betrieb keine Verwaltung dafuer auffindbar war:
 * es gab keine.
 *
 * ## Was ausdruecklich nicht hierherkommt
 *
 * Die **gerechneten** Auszeichnungen. Sie stehen in `auszeichnungen.ts`,
 * entstehen aus Turnieren, Clip-Siegen und dem Level und haben weiterhin
 * keine Tabelle. Wer sie verwaltbar machte, koennte einen Turniersieg
 * vergeben, den es nie gab.
 *
 * Diese Trennung ist hier keine Konvention, sondern eine Pruefung:
 * `erstelleAuszeichnungsArt` weist jeden Schluessel ab, den `ARTEN`
 * bereits kennt. Der Riegel sitzt beim Anlegen und nicht beim Verleihen -
 * ein Schluessel, den es nicht gibt, laesst sich auch nicht vergeben.
 *
 * ## Drei Zustaende, nicht zwei
 *
 *   - **aktiv** - steht in der Mitgliederakte zur Vergabe.
 *   - **abgeschaltet** (`enabled = false`) - wird nicht mehr vergeben.
 *     Bestehende Verleihungen bleiben und bleiben sichtbar.
 *   - **archiviert** - aus der Verwaltungsliste genommen. Ebenfalls ohne
 *     Wirkung auf das, was schon verliehen ist.
 *
 * Und daneben das echte Entfernen. Es gibt es, weil der Auftrag es verlangt
 * - aber nur fuer Definitionen, die **niemand** hat. Eine Definition zu
 * loeschen, die an dreissig Profilen haengt, hiesse dreissig Auszeichnungen
 * stillschweigend zu entwerten; `entferneAuszeichnungsArt` sagt dann, wie
 * viele es sind, und verweist aufs Archivieren.
 */
import { AUDIT_ACTIONS, Prisma, prisma, safeRecordAudit } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { AppError, conflict } from '@swisshub/shared';
import { MEMBER_PERMISSIONS } from '@swisshub/permissions';
import { AUSZEICHNUNGS_SYMBOLE, auszeichnungsArt, type Stufe, type VerleihbareArt } from './auszeichnungen';

const log = createLogger('profile:auszeichnungs-arten');

/** Die Berechtigung fuer die globale Verwaltung - nicht die fuers Verleihen. */
export const AUSZEICHNUNGS_ARTEN_PERMISSION = MEMBER_PERMISSIONS.awardsDefine;

/** Wer verwaltet - und was er darf. */
export interface ArtenActor {
  discordId: string;
  username: string;
  can(permission: string): boolean;
}

/** Eine Art, wie die Verwaltung sie sieht. */
export interface VerwalteteArt extends VerleihbareArt {
  id: string;
  /** Wird sie noch vergeben? */
  aktiv: boolean;
  /** Aus der Verwaltungsliste genommen. */
  archiviert: boolean;
  sortierung: number;
  /** Wie viele Mitglieder sie haben. Nur dort gefuellt, wo es gezaehlt wurde. */
  verliehen?: number;
}

export interface ArtEingabe {
  label: string;
  beschreibung: string;
  symbol: string;
  stufe: Stufe;
  aktiv: boolean;
  sortierung?: number;
}

const STUFEN: readonly Stufe[] = ['bronze', 'silber', 'gold'];

/** Eine Zeile in das, was die Anwendung sonst kennt. */
function ausZeile(zeile: {
  id: string;
  key: string;
  label: string;
  description: string;
  symbol: string;
  tier: string;
  enabled: boolean;
  archivedAt: Date | null;
  sortOrder: number;
}): VerwalteteArt {
  return {
    id: zeile.id,
    key: zeile.key,
    label: zeile.label,
    beschreibung: zeile.description,
    symbol: zeile.symbol,
    // Eine unbekannte Stufe waere sonst ein Absturz in der Farbtabelle der
    // Oberflaeche. Bronze ist die unauffaelligste Antwort darauf.
    stufe: STUFEN.includes(zeile.tier as Stufe) ? (zeile.tier as Stufe) : 'bronze',
    aktiv: zeile.enabled,
    archiviert: zeile.archivedAt !== null,
    sortierung: zeile.sortOrder,
  };
}

/**
 * Aus einem Namen einen Schluessel.
 *
 * Kleingeschrieben, ohne Umlautprobleme, mit Bindestrichen. Der Schluessel
 * steht danach in jeder Verleihung und aendert sich nie wieder - deshalb
 * wird er aus dem **ersten** Namen gebildet und nicht bei jeder Umbenennung
 * neu. Wer den Namen aendert, aendert den Namen; die Verleihungen bleiben.
 */
export function schluesselAus(label: string): string {
  /*
   * Die Umlaute zuerst, und zwar nach deutscher Lesart.
   *
   * Die Zerlegung nach NFD wuerde aus einem «oe» ein «o» machen - aus
   * «Groesster Fan» wuerde `grosster-fan`, und das liest niemand als
   * denselben Namen. Deshalb erst die vier Umlaute und das scharfe S von
   * Hand, dann die Zerlegung fuer alles Uebrige (Accents in geliehenen
   * Woertern).
   *
   * Das scharfe S steht als Codepunkt da und nicht als Zeichen: im
   * Quelltext dieses Projekts gilt Schweizer Rechtschreibung, und ein Test
   * wacht darueber.
   */
  const UMLAUTE: ReadonlyArray<readonly [RegExp, string]> = [
    [/ä/gu, 'ae'],
    [/ö/gu, 'oe'],
    [/ü/gu, 'ue'],
    [/Ä/gu, 'Ae'],
    [/Ö/gu, 'Oe'],
    [/Ü/gu, 'Ue'],
    [/\u00df/gu, 'ss'],
  ];

  let text = label;
  for (const [muster, ersatz] of UMLAUTE) {
    text = text.replace(muster, ersatz);
  }

  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 48);
}

export interface ArtenFilter {
  /** Auch die abgeschalteten. Fuer die Verwaltung. */
  mitAbgeschalteten?: boolean;
  /** Auch die archivierten. Setzt `mitAbgeschalteten` voraus. */
  mitArchivierten?: boolean;
}

/**
 * Die verleihbaren Arten.
 *
 * Ohne Angabe: die aktiven, nicht archivierten - also das, was sich
 * tatsaechlich vergeben laesst. Die Verwaltung fragt ausdruecklich nach
 * mehr.
 */
export async function listeAuszeichnungsArten(filter: ArtenFilter = {}): Promise<VerwalteteArt[]> {
  const where: Prisma.AwardDefinitionWhereInput = {};
  if (!filter.mitAbgeschalteten) {
    where.enabled = true;
  }
  if (!filter.mitArchivierten) {
    where.archivedAt = null;
  }

  const zeilen = await prisma.awardDefinition.findMany({
    where,
    orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
  });
  return zeilen.map(ausZeile);
}

/**
 * Dieselbe Liste, dazu die Zahl der Verleihungen je Art.
 *
 * Eine Gruppierung statt N Zaehlungen: die Verwaltungsseite zeigt jede Art,
 * und jede einzeln zu zaehlen waere eine Abfrage je Zeile.
 */
export async function listeAuszeichnungsArtenMitZahlen(filter: ArtenFilter = {}): Promise<VerwalteteArt[]> {
  const [arten, gruppen] = await Promise.all([
    listeAuszeichnungsArten(filter),
    prisma.memberAward.groupBy({ by: ['key'], _count: { _all: true } }),
  ]);
  const zahl = new Map(gruppen.map((gruppe) => [gruppe.key, gruppe._count._all]));
  return arten.map((art) => ({ ...art, verliehen: zahl.get(art.key) ?? 0 }));
}

/**
 * Die Arten zu bestimmten Schluesseln - auch abgeschaltete und archivierte.
 *
 * Fuer die Anzeige am Profil. Wer eine Auszeichnung hat, behaelt sie, auch
 * wenn sie nicht mehr vergeben wird; sie deshalb namenlos darzustellen
 * waere die schlechtere Antwort.
 */
export async function auszeichnungsArtenNach(keys: readonly string[]): Promise<VerwalteteArt[]> {
  if (keys.length === 0) {
    return [];
  }
  const zeilen = await prisma.awardDefinition.findMany({ where: { key: { in: [...keys] } } });
  return zeilen.map(ausZeile);
}

/**
 * Eine Art, die sich gerade vergeben laesst.
 *
 * `null` heisst: gibt es nicht, ist abgeschaltet oder ist archiviert. Alle
 * drei Faelle enden im selben Ergebnis - der Aufrufer darf nicht vergeben.
 */
export async function vergebbareArt(key: string): Promise<VerwalteteArt | null> {
  const zeile = await prisma.awardDefinition.findFirst({
    where: { key, enabled: true, archivedAt: null },
  });
  return zeile ? ausZeile(zeile) : null;
}

function verlangeBerechtigung(actor: ArtenActor): void {
  if (!actor.can(AUSZEICHNUNGS_ARTEN_PERMISSION)) {
    throw new AppError('FORBIDDEN', {
      userMessage: 'Du darfst die Auszeichnungen nicht verwalten.',
    });
  }
}

function pruefeEingabe(eingabe: ArtEingabe): void {
  if (!STUFEN.includes(eingabe.stufe)) {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Diese Stufe gibt es nicht.' });
  }
  if (!AUSZEICHNUNGS_SYMBOLE.includes(eingabe.symbol)) {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Dieses Symbol steht nicht zur Auswahl.' });
  }
}

export async function erstelleAuszeichnungsArt(
  eingabe: ArtEingabe,
  actor: ArtenActor,
): Promise<VerwalteteArt> {
  verlangeBerechtigung(actor);
  pruefeEingabe(eingabe);

  const key = schluesselAus(eingabe.label);
  if (key.length < 2) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage:
        'Aus diesem Namen lässt sich kein Schlüssel bilden. Bitte Buchstaben oder Ziffern verwenden.',
    });
  }

  /*
   * Der Riegel gegen gerechnete Auszeichnungen.
   *
   * Ohne ihn liesse sich eine Art «Turniersieg» mit dem Schluessel
   * `turnier-sieg` anlegen - und ab dann stuende am Profil ein Turniersieg,
   * den niemand gewonnen hat. Die Pruefung sitzt hier und nicht beim
   * Verleihen: was es nicht gibt, laesst sich nicht vergeben.
   */
  if (auszeichnungsArt(key)) {
    throw conflict(
      `«${eingabe.label}» heisst wie eine Auszeichnung, die aus echten Daten gerechnet wird. Diese lässt sich nicht von Hand vergeben - bitte einen anderen Namen wählen.`,
    );
  }

  try {
    const zeile = await prisma.awardDefinition.create({
      data: {
        key,
        label: eingabe.label,
        description: eingabe.beschreibung,
        symbol: eingabe.symbol,
        tier: eingabe.stufe,
        enabled: eingabe.aktiv,
        ...(eingabe.sortierung !== undefined ? { sortOrder: eingabe.sortierung } : {}),
        createdByDiscordId: actor.discordId,
      },
    });

    await safeRecordAudit({
      action: AUDIT_ACTIONS.PROFILE_AWARD_TYPE_CREATED,
      module: 'members',
      actorDiscordId: actor.discordId,
      actorUsername: actor.username,
      targetLabel: zeile.label,
      metadata: { key: zeile.key, stufe: zeile.tier, symbol: zeile.symbol },
    });

    log.info('Auszeichnung angelegt', { key: zeile.key });
    return ausZeile(zeile);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw conflict(`Es gibt bereits eine Auszeichnung mit dem Schlüssel «${key}».`);
    }
    throw error;
  }
}

/**
 * Name, Beschreibung, Symbol, Stufe und Reihenfolge aendern.
 *
 * Der Schluessel bleibt, was er ist. Ihn mitzuaendern hiesse, die
 * Verleihungen umzuhaengen - und jede, die dabei durchrutscht, stuende
 * danach als Auszeichnung ohne Namen am Profil.
 */
export async function bearbeiteAuszeichnungsArt(
  id: string,
  eingabe: ArtEingabe,
  actor: ArtenActor,
): Promise<VerwalteteArt> {
  verlangeBerechtigung(actor);
  pruefeEingabe(eingabe);

  const vorher = await prisma.awardDefinition.findUnique({ where: { id } });
  if (!vorher) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Auszeichnung wurde nicht gefunden.' });
  }

  const zeile = await prisma.awardDefinition.update({
    where: { id },
    data: {
      label: eingabe.label,
      description: eingabe.beschreibung,
      symbol: eingabe.symbol,
      tier: eingabe.stufe,
      enabled: eingabe.aktiv,
      ...(eingabe.sortierung !== undefined ? { sortOrder: eingabe.sortierung } : {}),
    },
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.PROFILE_AWARD_TYPE_UPDATED,
    module: 'members',
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetLabel: zeile.label,
    metadata: {
      key: zeile.key,
      // Nur das tatsaechlich Geaenderte - das haelt das Protokoll lesbar.
      geaendert: [
        vorher.label !== zeile.label ? 'label' : null,
        vorher.description !== zeile.description ? 'beschreibung' : null,
        vorher.symbol !== zeile.symbol ? 'symbol' : null,
        vorher.tier !== zeile.tier ? 'stufe' : null,
        vorher.enabled !== zeile.enabled ? 'aktiv' : null,
        vorher.sortOrder !== zeile.sortOrder ? 'sortierung' : null,
      ].filter(Boolean),
    },
  });

  return ausZeile(zeile);
}

/**
 * Archivieren.
 *
 * Idempotent ueber ein bedingtes `updateMany`: wer den Wechsel als Erster
 * vollzieht, schreibt den Protokolleintrag. Ein zweiter Aufruf aendert
 * nichts und schreibt nichts.
 */
export async function archiviereAuszeichnungsArt(id: string, actor: ArtenActor): Promise<boolean> {
  verlangeBerechtigung(actor);

  const zeile = await prisma.awardDefinition.findUnique({ where: { id } });
  if (!zeile) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Auszeichnung wurde nicht gefunden.' });
  }

  const { count } = await prisma.awardDefinition.updateMany({
    where: { id, archivedAt: null },
    // Archiviert heisst auch abgeschaltet. Eine archivierte Art, die
    // weiterhin `enabled` waere, stuende in keiner Verwaltungsliste und
    // liesse sich trotzdem vergeben.
    data: { archivedAt: new Date(), enabled: false },
  });
  if (count === 0) {
    return false;
  }

  await safeRecordAudit({
    action: AUDIT_ACTIONS.PROFILE_AWARD_TYPE_ARCHIVED,
    module: 'members',
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetLabel: zeile.label,
    metadata: { key: zeile.key },
  });
  return true;
}

/** Und wieder zurueck - abgeschaltet, bis jemand sie bewusst einschaltet. */
export async function holeAuszeichnungsArtZurueck(id: string, actor: ArtenActor): Promise<boolean> {
  verlangeBerechtigung(actor);

  const zeile = await prisma.awardDefinition.findUnique({ where: { id } });
  if (!zeile) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Auszeichnung wurde nicht gefunden.' });
  }

  const { count } = await prisma.awardDefinition.updateMany({
    where: { id, archivedAt: { not: null } },
    data: { archivedAt: null },
  });
  if (count === 0) {
    return false;
  }

  await safeRecordAudit({
    action: AUDIT_ACTIONS.PROFILE_AWARD_TYPE_RESTORED,
    module: 'members',
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetLabel: zeile.label,
    metadata: { key: zeile.key },
  });
  return true;
}

/**
 * Sicher entfernen.
 *
 * «Sicher» heisst hier: nur, wenn sie niemand hat. Eine Definition zu
 * loeschen, an der dreissig Profile haengen, entwertete dreissig
 * Auszeichnungen stillschweigend - die Zeilen blieben stehen und zeigten
 * ins Leere.
 *
 * Deshalb zaehlt diese Funktion zuerst und sagt im Fehlerfall, wie viele es
 * sind. Wer eine vergebene Art loswerden will, archiviert sie; wer sie
 * wirklich loeschen will, entzieht sie vorher.
 */
export async function entferneAuszeichnungsArt(id: string, actor: ArtenActor): Promise<void> {
  verlangeBerechtigung(actor);

  const zeile = await prisma.awardDefinition.findUnique({ where: { id } });
  if (!zeile) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Auszeichnung wurde nicht gefunden.' });
  }

  const vergeben = await prisma.memberAward.count({ where: { key: zeile.key } });
  if (vergeben > 0) {
    throw conflict(
      `«${zeile.label}» ist an ${vergeben} ${vergeben === 1 ? 'Mitglied' : 'Mitglieder'} verliehen. Archiviere sie, oder entziehe sie zuerst.`,
    );
  }

  await prisma.awardDefinition.delete({ where: { id } });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.PROFILE_AWARD_TYPE_DELETED,
    module: 'members',
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetLabel: zeile.label,
    metadata: { key: zeile.key },
  });

  log.info('Auszeichnung entfernt', { key: zeile.key });
}

/**
 * Der Bestand, mit dem die Tabelle startet.
 *
 * Dieselben fuenf, die frueher im Quelltext standen. Sie stehen hier
 * **nicht** als zweite Wahrheit: gelesen wird ausschliesslich aus der
 * Datenbank. Diese Liste fuellt eine leere Tabelle, und zwar genau dann,
 * wenn sie leer ist - in der Produktion tut das die Migration, hier ist es
 * fuer `db push` und fuer Tests.
 */
export const ERSTAUSSTATTUNG: readonly (VerleihbareArt & { sortierung: number })[] = [
  {
    key: 'og-member',
    label: 'OG Member',
    beschreibung: 'War da, als der SwissHub noch klein war.',
    symbol: 'Flame',
    stufe: 'gold',
    sortierung: 10,
  },
  {
    key: 'community-legend',
    label: 'Community Legend',
    beschreibung: 'Hat den SwissHub zu dem gemacht, was er ist.',
    symbol: 'Crown',
    stufe: 'gold',
    sortierung: 20,
  },
  {
    key: 'helfer',
    label: 'Gute Seele',
    beschreibung: 'Hilft anderen, ohne dass jemand danach fragt.',
    symbol: 'HeartHandshake',
    stufe: 'silber',
    sortierung: 30,
  },
  {
    key: 'event-held',
    label: 'Event-Held',
    beschreibung: 'Hat einen Abend getragen, an den sich alle erinnern.',
    symbol: 'PartyPopper',
    stufe: 'silber',
    sortierung: 40,
  },
  {
    key: 'bug-jaeger',
    label: 'Bug-Jäger',
    beschreibung: 'Hat einen Fehler gefunden, den sonst niemand gesehen hat.',
    symbol: 'Bug',
    stufe: 'bronze',
    sortierung: 50,
  },
] as const;

/**
 * Die Erstausstattung anlegen - aber nur in eine leere Tabelle.
 *
 * Ohne die Bedingung wuerde eine entfernte Art beim naechsten Start wieder
 * auftauchen. Gibt die Zahl der angelegten Zeilen zurueck; 0 heisst, dass
 * schon etwas dastand.
 */
export async function legeErstausstattungAn(): Promise<number> {
  if ((await prisma.awardDefinition.count()) > 0) {
    return 0;
  }
  const { count } = await prisma.awardDefinition.createMany({
    data: ERSTAUSSTATTUNG.map((art) => ({
      key: art.key,
      label: art.label,
      description: art.beschreibung,
      symbol: art.symbol,
      tier: art.stufe,
      sortOrder: art.sortierung,
    })),
    skipDuplicates: true,
  });
  return count;
}
