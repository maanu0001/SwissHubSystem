import { AUDIT_ACTIONS, prisma, recordAudit } from '@swisshub/database';
import { AppError, sanitizeText } from '@swisshub/shared';
import { createLogger } from '@swisshub/logger';
import type { FragtFrage, FragtFrageStatus, FragtFragetyp, FragtOption } from '@swisshub/database';
import { FRAGT_MODULE_ID } from './config';
import { fragetyp } from './typen';

const log = createLogger('fragt:bibliothek');

/**
 * Die Fragenbibliothek.
 *
 * ## Warum Fragen und Abstimmungen getrennt sind
 *
 * Eine Frage ist eine Vorlage. Eine Abstimmung ist ein Vorgang, der
 * stattgefunden hat.
 *
 * Diese Trennung ist der Grund, warum eine Frage bearbeitet werden darf,
 * obwohl sie schon einmal gestellt wurde: die Abstimmung von damals traegt
 * ihren eigenen Fragetext und ihre eigenen Stimmen. Was hier geaendert wird,
 * gilt fuer das naechste Mal.
 *
 * ## Was trotzdem nicht geht
 *
 * **Antwortmoeglichkeiten einer laufenden oder vergangenen Abstimmung
 * veraendern.** Die Stimmen zeigen auf `FragtOption`-Zeilen; wuerde eine davon
 * umbenannt oder verschoben, waeren die Stimmen von damals ploetzlich einer
 * anderen Antwort zugeordnet. Genau das verbietet die Aufgabe, und genau das
 * verhindert `verlangeAntwortenAenderbar`.
 */

export interface Handelnder {
  discordId: string;
  username?: string | null;
}

export interface FrageMitOptionen extends FragtFrage {
  optionen: FragtOption[];
}

export interface FrageEingabe {
  text: string;
  untertitel?: string | null;
  kategorie: string;
  typ: FragtFragetyp;
  /** Die Antworten in der gewuenschten Reihenfolge. */
  antworten: string[];
  tags?: string[];
  dauerStunden?: number;
  medienDatei?: string | null;
}

/**
 * Wie lang eine Antwort sein darf.
 *
 * Discord begrenzt eine Buttonbeschriftung auf 80 Zeichen. Laenger
 * anzunehmen hiesse, eine Frage zu speichern, die sich nicht stellen laesst -
 * und das faellt erst beim Veroeffentlichen auf, im schlechtesten Fall
 * nachts durch die Automatik.
 */
export const ANTWORT_MAX = 80;
export const FRAGE_MAX = 240;

/** Antworten pruefen und saeubern - dieselbe Regel fuer jeden Aufrufer. */
export function pruefeAntworten(typ: FragtFragetyp, antworten: string[]): string[] {
  const angaben = fragetyp(typ);

  if (angaben.festeOptionen) {
    // Hot Take: die Antworten stehen fest, was der Aufrufer schickt, zaehlt nicht.
    return [...angaben.festeOptionen];
  }

  const sauber = antworten
    .map((antwort) => sanitizeText(antwort, ANTWORT_MAX).trim())
    .filter((antwort) => antwort.length > 0);

  if (sauber.length < angaben.minOptionen) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: `«${angaben.label}» braucht mindestens ${angaben.minOptionen} Antwortmöglichkeiten.`,
    });
  }
  if (sauber.length > angaben.maxOptionen) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: `«${angaben.label}» erlaubt höchstens ${angaben.maxOptionen} Antwortmöglichkeiten.`,
    });
  }

  /*
   * Keine zwei gleichen Antworten.
   *
   * Nicht aus Ordnungsliebe: zwei Buttons mit derselben Beschriftung sind fuer
   * das Mitglied nicht unterscheidbar, und das Ergebnis waere zweimal dieselbe
   * Antwort mit je der Haelfte der Stimmen.
   */
  const gesehen = new Set<string>();
  for (const antwort of sauber) {
    const schluessel = antwort.toLocaleLowerCase('de-CH');
    if (gesehen.has(schluessel)) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: `«${antwort}» steht zweimal in der Liste.`,
      });
    }
    gesehen.add(schluessel);
  }

  return sauber;
}

function pruefeText(text: string): string {
  const sauber = sanitizeText(text, FRAGE_MAX).trim();
  if (sauber.length < 5) {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Die Frage ist zu kurz.' });
  }
  return sauber;
}

export async function erstelleFrage(
  guildId: string,
  actor: Handelnder,
  eingabe: FrageEingabe,
): Promise<FrageMitOptionen> {
  const text = pruefeText(eingabe.text);
  const antworten = pruefeAntworten(eingabe.typ, eingabe.antworten);
  const kategorie = sanitizeText(eingabe.kategorie, 40).trim() || 'Allgemein';

  const frage = await prisma.fragtFrage.create({
    data: {
      guildId,
      text,
      untertitel: eingabe.untertitel ? sanitizeText(eingabe.untertitel, 240).trim() || null : null,
      kategorie,
      typ: eingabe.typ,
      status: 'DRAFT',
      tags: (eingabe.tags ?? [])
        .map((tag) => sanitizeText(tag, 24).trim())
        .filter(Boolean)
        .slice(0, 8),
      dauerStunden: eingabe.dauerStunden ?? 48,
      medienDatei: eingabe.medienDatei ?? null,
      createdByDiscordId: actor.discordId,
      optionen: {
        create: antworten.map((label, index) => ({ label, position: index })),
      },
    },
    include: { optionen: { orderBy: { position: 'asc' } } },
  });

  await recordAudit({
    action: AUDIT_ACTIONS.FRAGT_QUESTION_CREATED,
    module: FRAGT_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username ?? null,
    targetLabel: text,
    metadata: { frageId: frage.id, typ: eingabe.typ, antworten: antworten.length },
  });

  return frage;
}

/**
 * Darf an den Antworten dieser Frage noch etwas geaendert werden?
 *
 * Nein, sobald es zu ihr eine Abstimmung gibt - laufend oder abgeschlossen.
 * Die Stimmen zeigen auf die `FragtOption`-Zeilen; eine davon umzubenennen
 * wuerde die Stimmen von damals einer anderen Antwort zuordnen, und die
 * Ergebnisgrafik waere rueckwirkend falsch.
 *
 * Der Fragetext selbst darf sich aendern - die Abstimmung traegt ihre eigene
 * Kopie.
 */
async function verlangeAntwortenAenderbar(frageId: string): Promise<void> {
  const abstimmungen = await prisma.fragtAbstimmung.count({ where: { frageId } });
  if (abstimmungen > 0) {
    throw new AppError('CONFLICT', {
      userMessage:
        'Diese Frage stand schon auf Discord - die Antwortmöglichkeiten lassen sich nicht mehr ändern, sonst würden die abgegebenen Stimmen einer anderen Antwort zugeordnet. Dupliziere die Frage, wenn du sie anders stellen willst.',
      internalMessage: `Frage ${frageId} hat ${abstimmungen} Abstimmungen`,
    });
  }
}

export async function bearbeiteFrage(
  frageId: string,
  actor: Handelnder,
  eingabe: Partial<FrageEingabe>,
): Promise<FrageMitOptionen> {
  const vorhanden = await prisma.fragtFrage.findUnique({
    where: { id: frageId },
    include: { optionen: true },
  });
  if (!vorhanden) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Frage gibt es nicht.' });
  }
  if (vorhanden.status === 'ACTIVE') {
    throw new AppError('CONFLICT', {
      userMessage: 'Diese Frage läuft gerade auf Discord. Warte, bis die Abstimmung geschlossen ist.',
    });
  }

  // Der Typ bestimmt, wie viele Antworten erlaubt sind - deshalb zuerst.
  const typ = eingabe.typ ?? vorhanden.typ;
  const antwortenGeaendert = eingabe.antworten !== undefined || eingabe.typ !== undefined;
  if (antwortenGeaendert) {
    await verlangeAntwortenAenderbar(frageId);
  }

  const antworten = antwortenGeaendert
    ? pruefeAntworten(
        typ,
        eingabe.antworten ?? vorhanden.optionen.sort((a, b) => a.position - b.position).map((o) => o.label),
      )
    : null;

  const frage = await prisma.$transaction(async (tx) => {
    if (antworten) {
      /*
       * Ersetzen statt abgleichen.
       *
       * Ohne Abstimmungen gibt es keine Stimmen, die auf diese Zeilen zeigen -
       * ein Abgleich Zeile fuer Zeile waere Aufwand ohne Wirkung. Mit
       * Abstimmungen kommen wir hier gar nicht her.
       */
      await tx.fragtOption.deleteMany({ where: { frageId } });
      await tx.fragtOption.createMany({
        data: antworten.map((label, index) => ({ frageId, label, position: index })),
      });
    }

    return tx.fragtFrage.update({
      where: { id: frageId },
      data: {
        ...(eingabe.text !== undefined ? { text: pruefeText(eingabe.text) } : {}),
        ...(eingabe.untertitel !== undefined
          ? { untertitel: eingabe.untertitel ? sanitizeText(eingabe.untertitel, 240).trim() || null : null }
          : {}),
        ...(eingabe.kategorie !== undefined
          ? { kategorie: sanitizeText(eingabe.kategorie, 40).trim() || 'Allgemein' }
          : {}),
        ...(eingabe.typ !== undefined ? { typ } : {}),
        ...(eingabe.tags !== undefined
          ? {
              tags: eingabe.tags
                .map((tag) => sanitizeText(tag, 24).trim())
                .filter(Boolean)
                .slice(0, 8),
            }
          : {}),
        ...(eingabe.dauerStunden !== undefined ? { dauerStunden: eingabe.dauerStunden } : {}),
        ...(eingabe.medienDatei !== undefined ? { medienDatei: eingabe.medienDatei } : {}),
      },
      include: { optionen: { orderBy: { position: 'asc' } } },
    });
  });

  await recordAudit({
    action: AUDIT_ACTIONS.FRAGT_QUESTION_UPDATED,
    module: FRAGT_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username ?? null,
    targetLabel: frage.text,
    metadata: { frageId, antwortenGeaendert },
  });

  return frage;
}

/**
 * Status setzen - freigeben, zuruecknehmen, archivieren.
 *
 * Nur die Uebergaenge, die eine Person auslöst. `SCHEDULED` und `ACTIVE`
 * setzen die Planung und die Veroeffentlichung; sie stehen deshalb nicht hier.
 */
export async function setzeStatus(
  frageId: string,
  actor: Handelnder,
  status: 'DRAFT' | 'READY' | 'ARCHIVED',
): Promise<FragtFrage> {
  const vorhanden = await prisma.fragtFrage.findUnique({ where: { id: frageId } });
  if (!vorhanden) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Frage gibt es nicht.' });
  }
  if (vorhanden.status === 'ACTIVE') {
    throw new AppError('CONFLICT', {
      userMessage: 'Diese Frage läuft gerade. Schliesse zuerst die Abstimmung.',
    });
  }

  if (status === 'READY') {
    // Eine Frage ohne genug Antworten freizugeben hiesse, der Automatik etwas
    // zu geben, woran sie spaeter scheitert - nachts, ohne Publikum.
    const optionen = await prisma.fragtOption.count({ where: { frageId } });
    const angaben = fragetyp(vorhanden.typ);
    if (optionen < angaben.minOptionen) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: `Diese Frage hat nur ${optionen} Antwortmöglichkeiten - «${angaben.label}» braucht ${angaben.minOptionen}.`,
      });
    }
  }

  const frage = await prisma.fragtFrage.update({
    where: { id: frageId },
    data: {
      status,
      archivedAt: status === 'ARCHIVED' ? new Date() : null,
      // Wer zurueck auf Entwurf oder ins Archiv geht, ist nicht mehr geplant.
      ...(status === 'READY' ? {} : { geplantAt: null }),
    },
  });

  await recordAudit({
    action:
      status === 'ARCHIVED' ? AUDIT_ACTIONS.FRAGT_QUESTION_ARCHIVED : AUDIT_ACTIONS.FRAGT_QUESTION_UPDATED,
    module: FRAGT_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username ?? null,
    targetLabel: frage.text,
    metadata: { frageId, status },
  });

  log.info('Fragestatus geaendert', { frageId, status, von: vorhanden.status });
  return frage;
}

/**
 * Eine Frage duplizieren.
 *
 * Der Weg, eine schon gestellte Frage anders zu stellen: die Kopie hat eigene
 * Antwortzeilen und damit keine Stimmen, die an ihnen haengen.
 */
export async function dupliziereFrage(frageId: string, actor: Handelnder): Promise<FrageMitOptionen> {
  const vorlage = await prisma.fragtFrage.findUnique({
    where: { id: frageId },
    include: { optionen: { orderBy: { position: 'asc' } } },
  });
  if (!vorlage) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Frage gibt es nicht.' });
  }

  const kopie = await prisma.fragtFrage.create({
    data: {
      guildId: vorlage.guildId,
      text: vorlage.text,
      untertitel: vorlage.untertitel,
      kategorie: vorlage.kategorie,
      typ: vorlage.typ,
      // Immer als Entwurf: eine Kopie ist nicht geprueft, nur weil das
      // Original es war.
      status: 'DRAFT',
      tags: vorlage.tags,
      dauerStunden: vorlage.dauerStunden,
      medienDatei: vorlage.medienDatei,
      createdByDiscordId: actor.discordId,
      optionen: {
        create: vorlage.optionen.map((option) => ({ label: option.label, position: option.position })),
      },
    },
    include: { optionen: { orderBy: { position: 'asc' } } },
  });

  await recordAudit({
    action: AUDIT_ACTIONS.FRAGT_QUESTION_CREATED,
    module: FRAGT_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username ?? null,
    targetLabel: kopie.text,
    metadata: { frageId: kopie.id, kopieVon: frageId },
  });

  return kopie;
}

export interface BibliothekFilter {
  status?: FragtFrageStatus[];
  typ?: FragtFragetyp;
  kategorie?: string;
  suche?: string;
}

export async function listeFragen(
  guildId: string,
  filter: BibliothekFilter = {},
  grenze = 100,
): Promise<FrageMitOptionen[]> {
  const suche = filter.suche?.trim();
  return prisma.fragtFrage.findMany({
    where: {
      guildId,
      ...(filter.status?.length ? { status: { in: filter.status } } : {}),
      ...(filter.typ ? { typ: filter.typ } : {}),
      ...(filter.kategorie ? { kategorie: filter.kategorie } : {}),
      ...(suche
        ? {
            OR: [
              { text: { contains: suche, mode: 'insensitive' } },
              { untertitel: { contains: suche, mode: 'insensitive' } },
              { optionen: { some: { label: { contains: suche, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    },
    include: { optionen: { orderBy: { position: 'asc' } } },
    orderBy: [{ updatedAt: 'desc' }],
    take: Math.min(grenze, 200),
  });
}

export async function holeFrage(frageId: string): Promise<FrageMitOptionen | null> {
  return prisma.fragtFrage.findUnique({
    where: { id: frageId },
    include: { optionen: { orderBy: { position: 'asc' } } },
  });
}

/** Die vorhandenen Kategorien - fuer Filter und Vorschlaege. */
export async function kategorien(guildId: string): Promise<string[]> {
  const zeilen = await prisma.fragtFrage.groupBy({
    by: ['kategorie'],
    where: { guildId },
    orderBy: { kategorie: 'asc' },
  });
  return zeilen.map((zeile) => zeile.kategorie);
}
