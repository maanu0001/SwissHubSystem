import { AUDIT_ACTIONS, Prisma, prisma, recordAudit } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { WRAPPED_MODULE_ID } from './config';
import type { Handelnder } from './kampagne';
import { AppError } from '@swisshub/shared';
import type { WrappedQuellen } from './daten';
import {
  ladeClipSieger,
  ladeGemeinschaftszahlen,
  ladeMonatsverlauf,
  ladeSpielauswahl,
  ladeTermine,
  ladeTurniere,
  bisherigerTagesRekord,
} from './gemeinschaft';
import { periodeVon, periodenLabel, type WrappedPeriode, type WrappedPeriodenArt } from './perioden';
import { ermittleQuellen } from './resolver';
import { waehleFolien, type AuswahlErgebnis, type StoryKontext } from './stories';
import { editorialSchema, varianteFuer, VORLAGEN_SCHEMA, type WrappedVorlage } from './vorlagen';

const log = createLogger('wrapped:ausgabe');

/**
 * Eine Ausgabe entsteht, wird bearbeitet und wird veroeffentlicht.
 *
 * ## Warum die Zeile vor den Daten kommt
 *
 * Erzeugt wird in zwei Schritten: erst die leere Ausgabe, dann die Folien.
 * Das sieht umstaendlich aus und ist der Kern der Sache - die Zeile traegt
 * den eindeutigen Schluessel `(guildId, type, periodKey)`. Zwei Arbeiter,
 * die im selben Augenblick beschliessen, den September zu erzeugen, kommen
 * beide bis zum `INSERT`; genau einer kommt durch, der andere sieht den
 * Verstoss und geht. Die teure Erhebung laeuft dadurch nur einmal.
 *
 * Waere es andersherum - erst rechnen, dann schreiben -, liefe die Erhebung
 * zweimal, und der Verlierer haette eine Minute Datenbankarbeit umsonst
 * gemacht.
 *
 * ## Warum ein Fehlschlag sichtbar bleibt
 *
 * Scheitert die Erhebung, bleibt die Ausgabe stehen - ohne Folien, mit
 * `failedAt` und Begruendung. Sie als fertig zu markieren waere eine Luege,
 * sie zu loeschen naehme dem naechsten Versuch die Spur.
 */

export type AusgabeArt = WrappedPeriodenArt;

/**
 * Wer handelt.
 *
 * Derselbe Typ wie im persoenlichen Rueckblick - `Handelnder` aus
 * `kampagne.ts`. Ein zweiter waere ein zweiter Ort, an dem jemand
 * entscheiden muesste, ob der Benutzername fehlen darf.
 */
export type AusgabeAkteur = Handelnder;

/** Alles, was die Stories brauchen - in einem Zug geholt. */
export async function sammleKontext(guildId: string, periode: WrappedPeriode): Promise<StoryKontext> {
  const [quellen, zahlen, turniere, termine, clips, spiele, rekord, momente] = await Promise.all([
    ermittleQuellen(guildId, { start: periode.start, end: periode.end, year: periode.jahr }),
    ladeGemeinschaftszahlen(guildId, periode),
    ladeTurniere(guildId, periode),
    ladeTermine(guildId, periode),
    ladeClipSieger(guildId, periode),
    ladeSpielauswahl(guildId, periode),
    bisherigerTagesRekord(guildId, periode),
    prisma.wrappedMoment.findMany({
      where: {
        guildId,
        happenedAt: { gte: periode.start, lt: periode.end },
        ...(periode.art === 'MONTHLY' ? { includeMonthly: true } : { includeYearly: true }),
      },
      select: {
        id: true,
        title: true,
        description: true,
        imagePath: true,
        happenedAt: true,
        priority: true,
      },
      orderBy: [{ priority: 'desc' }, { happenedAt: 'desc' }],
      take: 10,
    }),
  ]);

  // Der Monatsverlauf ist nur fuer die Jahresausgabe noetig - und dort teuer
  // genug, um ihn nicht ohne Anlass zu holen.
  const monate = periode.art === 'YEARLY' ? await ladeMonatsverlauf(guildId, periode.jahr) : null;

  return { guildId, periode, quellen, zahlen, turniere, termine, clips, spiele, rekord, monate, momente };
}

function titelFuer(periode: WrappedPeriode): { title: string; subtitle: string } {
  return periode.art === 'MONTHLY'
    ? {
        title: `SwissHub Wrapped ${periodenLabel(periode)}`,
        subtitle: 'So hat SwissHub diesen Monat gezockt.',
      }
    : { title: `SwissHub Wrapped ${periode.jahr}`, subtitle: 'Zwölf Monate. Eine Community.' };
}

/** Wurde der Verstoss gegen die Eindeutigkeit gemeldet? */
function istDoppelt(fehler: unknown): boolean {
  return fehler instanceof Prisma.PrismaClientKnownRequestError && fehler.code === 'P2002';
}

export interface ErzeugungsErgebnis {
  editionId: string;
  /** `false`, wenn die Ausgabe schon bestand - dann geschah nichts. */
  neu: boolean;
  folien: number;
  uebersprungen: number;
}

/**
 * Eine Ausgabe fuer einen abgeschlossenen Zeitraum erzeugen.
 *
 * Idempotent: ein zweiter Aufruf fuer denselben Zeitraum erzeugt nichts und
 * aendert nichts. Er gibt die bestehende Ausgabe zurueck.
 */
export async function erzeugeAusgabe(
  guildId: string,
  periode: WrappedPeriode,
  optionen: { akteur?: AusgabeAkteur; jetzt?: Date } = {},
): Promise<ErzeugungsErgebnis> {
  const jetzt = optionen.jetzt ?? new Date();
  if (jetzt.getTime() < periode.end.getTime()) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Dieser Zeitraum läuft noch. Ein Rückblick entsteht erst, wenn er vorbei ist.',
      internalMessage: `Zeitraum ${periode.key} endet erst ${periode.end.toISOString()}`,
    });
  }

  const { title, subtitle } = titelFuer(periode);

  /*
   * Erst nachsehen, dann anlegen.
   *
   * Die Eindeutigkeit bleibt der eigentliche Riegel - diese Abfrage ist nur
   * der leise Weg dorthin. Ohne sie laeuft der Job jede Minute in den
   * Verstoss, und Prisma schreibt jedes Mal eine Fehlerzeile ins Protokoll:
   * nach einem Tag waeren das 1440 Meldungen ueber etwas, das voellig in
   * Ordnung ist.
   */
  const schonDa = await prisma.wrappedEdition.findUnique({
    where: { guildId_type_periodKey: { guildId, type: periode.art, periodKey: periode.key } },
    select: { id: true, _count: { select: { slides: true } } },
  });
  if (schonDa) {
    return { editionId: schonDa.id, neu: false, folien: schonDa._count.slides, uebersprungen: 0 };
  }

  let edition;
  try {
    edition = await prisma.wrappedEdition.create({
      data: {
        guildId,
        type: periode.art,
        periodKey: periode.key,
        periodStart: periode.start,
        periodEnd: periode.end,
        title,
        subtitle,
        variant: varianteFuer(periode.key),
        sources: {},
        createdByDiscordId: optionen.akteur?.discordId ?? null,
      },
    });
  } catch (fehler) {
    if (!istDoppelt(fehler)) {
      throw fehler;
    }
    const bestehend = await prisma.wrappedEdition.findUnique({
      where: { guildId_type_periodKey: { guildId, type: periode.art, periodKey: periode.key } },
      select: { id: true, _count: { select: { slides: true } } },
    });
    // Ohne Zeile waere der Verstoss unerklaerlich - dann lieber weiterwerfen.
    if (!bestehend) {
      throw fehler;
    }
    return { editionId: bestehend.id, neu: false, folien: bestehend._count.slides, uebersprungen: 0 };
  }

  const ergebnis = await fuelleAusgabe(edition.id, guildId, periode);

  if (optionen.akteur) {
    await recordAudit({
      action: AUDIT_ACTIONS.WRAPPED_EDITION_CREATED,
      module: WRAPPED_MODULE_ID,
      actorDiscordId: optionen.akteur.discordId,
      actorUsername: optionen.akteur.username ?? null,
      targetLabel: title,
      metadata: {
        editionId: edition.id,
        type: periode.art,
        periodKey: periode.key,
        folien: ergebnis.folien,
      },
    });
  }

  return { editionId: edition.id, neu: true, ...ergebnis };
}

/** Die Folien einer bestehenden Ausgabe erheben und schreiben. */
async function fuelleAusgabe(
  editionId: string,
  guildId: string,
  periode: WrappedPeriode,
  behalte: Map<
    string,
    { editorial: Prisma.JsonValue; enabled: boolean; momentId: string | null }
  > = new Map(),
): Promise<{ folien: number; uebersprungen: number }> {
  let auswahl: AuswahlErgebnis;
  let quellen: WrappedQuellen;
  try {
    const kontext = await sammleKontext(guildId, periode);
    quellen = kontext.quellen;
    auswahl = waehleFolien(kontext);
  } catch (fehler) {
    /*
     * Gescheitert heisst gescheitert.
     *
     * Die Ausgabe bleibt ohne Folien stehen und traegt den Grund. Sie als
     * fertig zu markieren waere das Schlimmste, was hier passieren koennte:
     * jemand exportierte dann eine halbe Ausgabe und veroeffentlichte sie.
     */
    const grund = fehler instanceof Error ? fehler.message : String(fehler);
    await prisma.wrappedEdition.update({
      where: { id: editionId },
      data: { failedAt: new Date(), failureReason: grund.slice(0, 500), generatedAt: null },
    });
    log.error('Wrapped-Ausgabe konnte nicht erhoben werden', { editionId, periodKey: periode.key, fehler });
    throw fehler;
  }

  await prisma.$transaction([
    prisma.wrappedSlide.deleteMany({ where: { editionId } }),
    ...auswahl.folien.map((folie) => {
      const alt = behalte.get(folie.storyKey);
      return prisma.wrappedSlide.create({
        data: {
          editionId,
          storyKey: folie.storyKey,
          templateKey: folie.templateKey,
          position: folie.position,
          // Von Hand ausgeschaltete Folien bleiben ausgeschaltet.
          enabled: alt?.enabled ?? true,
          snapshotData: folie.daten as Prisma.InputJsonValue,
          editorialData: (alt?.editorial ?? folie.vorschlag) as Prisma.InputJsonValue,
          score: folie.score,
          momentId: folie.momentId ?? alt?.momentId ?? null,
        },
      });
    }),
    prisma.wrappedEdition.update({
      where: { id: editionId },
      data: {
        sources: quellen as unknown as Prisma.InputJsonValue,
        diagnostics: auswahl.gruende as unknown as Prisma.InputJsonValue,
        generatedAt: new Date(),
        failedAt: null,
        failureReason: null,
      },
    }),
  ]);

  return { folien: auswahl.folien.length, uebersprungen: auswahl.gruende.length };
}

/**
 * Einen Entwurf neu erheben.
 *
 * ## Was dabei erhalten bleibt
 *
 * Die redaktionellen Texte und die von Hand aus- oder eingeschalteten
 * Folien - sofern es die Story danach noch gibt. Wer eine Stunde an den
 * Begleitsaetzen gefeilt hat, soll sie nicht durch einen Klick auf «neu
 * erheben» verlieren.
 *
 * `texteBehalten: false` ist der ausdrueckliche Gegenbefehl: alles zurueck
 * auf die Vorschlaege. Die Oberflaeche fragt vorher nach.
 *
 * ## Warum nur Entwuerfe
 *
 * Eine eingefrorene Ausgabe neu zu erheben hiesse, eine veroeffentlichte
 * Zahl nachtraeglich zu aendern. Wer das will, entsperrt sie vorher - mit
 * eigener Berechtigung und eigenem Protokolleintrag.
 */
export async function regeneriereAusgabe(
  editionId: string,
  optionen: { akteur: AusgabeAkteur; texteBehalten?: boolean },
): Promise<{ folien: number; uebersprungen: number }> {
  const edition = await prisma.wrappedEdition.findUnique({
    where: { id: editionId },
    include: { slides: { select: { storyKey: true, editorialData: true, enabled: true, momentId: true } } },
  });
  if (!edition) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Ausgabe gibt es nicht.' });
  }
  if (edition.status !== 'DRAFT') {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Nur ein Entwurf lässt sich neu erheben. Entsperre die Ausgabe zuerst.',
      internalMessage: `Status ${edition.status}`,
    });
  }

  const periode = periodeVon(edition.type, edition.periodKey);
  if (!periode) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Der Zeitraum dieser Ausgabe lässt sich nicht mehr auflösen.',
      internalMessage: `Unlesbarer periodKey ${edition.periodKey}`,
    });
  }

  const behalte = new Map(
    optionen.texteBehalten === false
      ? []
      : edition.slides.map(
          (folie) =>
            [
              folie.storyKey,
              { editorial: folie.editorialData, enabled: folie.enabled, momentId: folie.momentId },
            ] as const,
        ),
  );

  const ergebnis = await fuelleAusgabe(edition.id, edition.guildId, periode, behalte);

  await prisma.wrappedEdition.update({
    where: { id: editionId },
    data: { updatedByDiscordId: optionen.akteur.discordId },
  });
  await recordAudit({
    action: AUDIT_ACTIONS.WRAPPED_EDITION_REGENERATED,
    module: WRAPPED_MODULE_ID,
    actorDiscordId: optionen.akteur.discordId,
    actorUsername: optionen.akteur.username ?? null,
    targetLabel: edition.title,
    metadata: {
      editionId,
      periodKey: edition.periodKey,
      texteBehalten: optionen.texteBehalten !== false,
      folien: ergebnis.folien,
    },
  });

  return ergebnis;
}

// --- Bearbeiten -------------------------------------------------------------

/** Den redaktionellen Text einer Folie aendern - nie die Zahlen. */
export async function speichereEditorial(
  slideId: string,
  eingabe: unknown,
  akteur: AusgabeAkteur,
): Promise<void> {
  const folie = await prisma.wrappedSlide.findUnique({
    where: { id: slideId },
    select: { id: true, editionId: true, storyKey: true, edition: { select: { status: true } } },
  });
  if (!folie) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Folie gibt es nicht.' });
  }
  if (folie.edition.status !== 'DRAFT') {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Diese Ausgabe ist eingefroren. Entsperre sie, um noch etwas zu ändern.',
    });
  }

  const geprueft = editorialSchema.parse(eingabe);
  await prisma.wrappedSlide.update({
    where: { id: slideId },
    data: { editorialData: geprueft as unknown as Prisma.InputJsonValue },
  });
  await prisma.wrappedEdition.update({
    where: { id: folie.editionId },
    data: { updatedByDiscordId: akteur.discordId },
  });
}

/** Eine Folie ein- oder ausschalten. */
export async function schalteFolie(slideId: string, enabled: boolean, akteur: AusgabeAkteur): Promise<void> {
  const folie = await prisma.wrappedSlide.findUnique({
    where: { id: slideId },
    select: { storyKey: true, editionId: true, edition: { select: { status: true, periodKey: true } } },
  });
  if (!folie) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Folie gibt es nicht.' });
  }
  if (folie.edition.status !== 'DRAFT') {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Diese Ausgabe ist eingefroren.' });
  }

  await prisma.wrappedSlide.update({ where: { id: slideId }, data: { enabled } });
  await recordAudit({
    action: enabled ? AUDIT_ACTIONS.WRAPPED_SLIDE_ENABLED : AUDIT_ACTIONS.WRAPPED_SLIDE_DISABLED,
    module: WRAPPED_MODULE_ID,
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username ?? null,
    targetLabel: folie.edition.periodKey,
    metadata: { editionId: folie.editionId, storyKey: folie.storyKey },
  });
}

/** Die Reihenfolge der Folien setzen. */
export async function ordneFolien(
  editionId: string,
  slideIds: readonly string[],
  akteur: AusgabeAkteur,
): Promise<void> {
  const edition = await prisma.wrappedEdition.findUnique({
    where: { id: editionId },
    select: { status: true },
  });
  if (!edition) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Ausgabe gibt es nicht.' });
  }
  if (edition.status !== 'DRAFT') {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Diese Ausgabe ist eingefroren.' });
  }

  await prisma.$transaction([
    // `updateMany` mit der Ausgabe in der Bedingung: eine fremde Folien-
    // kennung trifft dann keine Zeile, statt eine fremde zu verschieben.
    ...slideIds.map((slideId, index) =>
      prisma.wrappedSlide.updateMany({ where: { id: slideId, editionId }, data: { position: index } }),
    ),
    prisma.wrappedEdition.update({
      where: { id: editionId },
      data: { updatedByDiscordId: akteur.discordId },
    }),
  ]);
}

// --- Zustaende --------------------------------------------------------------

/**
 * Einfrieren.
 *
 * Danach aendert sich nichts mehr von selbst - weder durch einen neuen
 * Durchgang noch dadurch, dass jemand ein Turnier umbenennt. Genau dafuer
 * stehen die Zahlen in `snapshotData` und nicht in einer Abfrage.
 */
export async function finalisiereAusgabe(editionId: string, akteur: AusgabeAkteur): Promise<void> {
  const edition = await prisma.wrappedEdition.findUnique({
    where: { id: editionId },
    select: { status: true, periodKey: true, generatedAt: true, _count: { select: { slides: true } } },
  });
  if (!edition) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Ausgabe gibt es nicht.' });
  }
  if (edition.status !== 'DRAFT') {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Nur ein Entwurf lässt sich einfrieren.' });
  }
  if (!edition.generatedAt || edition._count.slides === 0) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Diese Ausgabe hat keine Folien. Erhebe sie zuerst.',
    });
  }

  /*
   * Bedingtes Update statt Lesen-und-Schreiben: zwei gleichzeitige Klicks
   * auf «Einfrieren» ergeben genau einen Protokolleintrag.
   */
  const { count } = await prisma.wrappedEdition.updateMany({
    where: { id: editionId, status: 'DRAFT' },
    data: { status: 'FINALIZED', finalizedAt: new Date(), updatedByDiscordId: akteur.discordId },
  });
  if (count === 0) {
    return;
  }

  await recordAudit({
    action: AUDIT_ACTIONS.WRAPPED_EDITION_FINALIZED,
    module: WRAPPED_MODULE_ID,
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username ?? null,
    targetLabel: edition.periodKey,
    metadata: { editionId, folien: edition._count.slides },
  });
}

/** Wieder zum Entwurf machen - ausdrueckliche Handlung, eigene Berechtigung. */
export async function entsperreAusgabe(editionId: string, akteur: AusgabeAkteur): Promise<void> {
  const edition = await prisma.wrappedEdition.findUnique({
    where: { id: editionId },
    select: { status: true, periodKey: true },
  });
  if (!edition) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Ausgabe gibt es nicht.' });
  }
  if (edition.status === 'DRAFT') {
    return;
  }

  const { count } = await prisma.wrappedEdition.updateMany({
    where: { id: editionId, status: { in: ['FINALIZED', 'PUBLISHED', 'ARCHIVED'] } },
    data: { status: 'DRAFT', finalizedAt: null, updatedByDiscordId: akteur.discordId },
  });
  if (count === 0) {
    return;
  }

  await recordAudit({
    action: AUDIT_ACTIONS.WRAPPED_EDITION_UNLOCKED,
    module: WRAPPED_MODULE_ID,
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username ?? null,
    targetLabel: edition.periodKey,
    metadata: { editionId, vorher: edition.status },
  });
}

/**
 * Als veroeffentlicht markieren.
 *
 * Das System postet nichts. Es haelt fest, dass jemand die Bilder
 * hinausgegeben hat - damit im naechsten Monat niemand raetselt, ob der
 * September je draussen war.
 */
export async function markiereVeroeffentlicht(editionId: string, akteur: AusgabeAkteur): Promise<void> {
  const edition = await prisma.wrappedEdition.findUnique({
    where: { id: editionId },
    select: { status: true, periodKey: true },
  });
  if (!edition) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Ausgabe gibt es nicht.' });
  }
  if (edition.status !== 'FINALIZED') {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Erst einfrieren, dann veröffentlichen - sonst ändern sich die Bilder noch.',
    });
  }

  const { count } = await prisma.wrappedEdition.updateMany({
    where: { id: editionId, status: 'FINALIZED' },
    data: { status: 'PUBLISHED', publishedAt: new Date(), updatedByDiscordId: akteur.discordId },
  });
  if (count === 0) {
    return;
  }

  await recordAudit({
    action: AUDIT_ACTIONS.WRAPPED_EDITION_PUBLISHED,
    module: WRAPPED_MODULE_ID,
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username ?? null,
    targetLabel: edition.periodKey,
    metadata: { editionId },
  });
}

// --- Lesen ------------------------------------------------------------------

export interface AusgabeFolie {
  id: string;
  storyKey: string;
  templateKey: WrappedVorlage;
  position: number;
  enabled: boolean;
  daten: unknown;
  editorial: { ueberschrift: string; text: string };
  score: number;
  momentId: string | null;
}

export interface AusgabeAnsicht {
  id: string;
  guildId: string;
  type: AusgabeArt;
  periodKey: string;
  periodStart: Date;
  periodEnd: Date;
  status: 'DRAFT' | 'FINALIZED' | 'PUBLISHED' | 'ARCHIVED';
  title: string;
  subtitle: string | null;
  variant: string;
  generatedAt: Date | null;
  finalizedAt: Date | null;
  publishedAt: Date | null;
  failureReason: string | null;
  folien: AusgabeFolie[];
  /** Warum etwas fehlt - aus `diagnostics`. */
  gruende: Array<{ storyKey: string; label: string; lage: string; erklaerung: string }>;
}

/**
 * Eine Ausgabe zum Anzeigen.
 *
 * Jede Folie geht durch das Schema ihrer Vorlage - auch beim Lesen. Die
 * Spalte ist aelter als der naechste Stand des Codes, und was hier
 * herauskommt, landet in einem Bild, das jemand veroeffentlicht. Passt es
 * nicht, faellt die Folie weg statt halb gezeichnet zu werden.
 */
export async function ladeAusgabe(editionId: string): Promise<AusgabeAnsicht | null> {
  const edition = await prisma.wrappedEdition.findUnique({
    where: { id: editionId },
    include: { slides: { orderBy: { position: 'asc' } } },
  });
  if (!edition) {
    return null;
  }

  const folien: AusgabeFolie[] = [];
  for (const folie of edition.slides) {
    const vorlage = VORLAGEN_SCHEMA[folie.templateKey as WrappedVorlage];
    const daten = vorlage?.safeParse(folie.snapshotData);
    const editorial = editorialSchema.safeParse(folie.editorialData);
    if (!vorlage || !daten?.success) {
      log.warn('Folie passt nicht mehr zu ihrer Vorlage - übersprungen', {
        editionId,
        slideId: folie.id,
        templateKey: folie.templateKey,
      });
      continue;
    }
    folien.push({
      id: folie.id,
      storyKey: folie.storyKey,
      templateKey: folie.templateKey as WrappedVorlage,
      position: folie.position,
      enabled: folie.enabled,
      daten: daten.data,
      editorial: editorial.success ? editorial.data : { ueberschrift: '', text: '' },
      score: folie.score,
      momentId: folie.momentId,
    });
  }

  return {
    id: edition.id,
    guildId: edition.guildId,
    type: edition.type,
    periodKey: edition.periodKey,
    periodStart: edition.periodStart,
    periodEnd: edition.periodEnd,
    status: edition.status,
    title: edition.title,
    subtitle: edition.subtitle,
    variant: edition.variant,
    generatedAt: edition.generatedAt,
    finalizedAt: edition.finalizedAt,
    publishedAt: edition.publishedAt,
    failureReason: edition.failureReason,
    folien,
    gruende: Array.isArray(edition.diagnostics) ? (edition.diagnostics as AusgabeAnsicht['gruende']) : [],
  };
}
