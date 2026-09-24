import { AUDIT_ACTIONS, prisma, recordAudit } from '@swisshub/database';
import { AppError } from '@swisshub/shared';
import { z } from 'zod';
import { CONTENT_TYPE, deleteUpload, readUpload, storeLogoUpload } from '../branding/storage';
import { WRAPPED_MODULE_ID } from './config';
import type { AusgabeAkteur } from './ausgabe';

/**
 * Community Moments.
 *
 * ## Warum es sie gibt
 *
 * Ein Rueckblick nur aus Zahlen ist ein Bericht. Was einen Monat
 * ausgemacht hat, steht selten in einer Tabelle: die GameNight, an der
 * zweiunddreissig Leute waren, der Screenshot aus dem Turnierfinale, das
 * Meme, ueber das eine Woche geredet wurde.
 *
 * ## Warum nichts davon automatisch entsteht
 *
 * Weil es nichts gibt, woraus es entstehen koennte. Kein System weiss, ob
 * ein Abend lustig war. Ein Moment kommt deshalb immer von einem Menschen -
 * und landet auch nur dort in einer Ausgabe, wo jemand ihn haben will.
 *
 * ## Wohin das Bild geht
 *
 * In dasselbe Upload-Verzeichnis wie Logo, Spielcover und Profilbanner,
 * ueber dieselben Funktionen. Eine zweite Bildverwaltung waere eine zweite
 * Stelle, an der ein Format geprueft werden muesste - und die erste
 * vergessene Pruefung liefert eine als PNG deklarierte HTML-Datei aus.
 */

export const MAX_MOMENT_BYTES = 6 * 1024 * 1024;
const BILD_GRENZEN = { maxBytes: MAX_MOMENT_BYTES, minSize: 400, maxSize: 6000 };

export const momentSchema = z.object({
  title: z.string().trim().min(2, 'Der Titel braucht mindestens zwei Zeichen.').max(80),
  description: z
    .string()
    .trim()
    .max(200, 'Höchstens 200 Zeichen - auf einer Folie ist kein Platz für mehr.')
    .transform((wert) => (wert.length === 0 ? null : wert))
    .nullable()
    .default(null),
  /** Tag des Geschehens als `YYYY-MM-DD`. Entscheidet, in welche Ausgabe er faellt. */
  happenedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, 'Bitte ein Datum im Format JJJJ-MM-TT.'),
  includeMonthly: z.boolean().default(true),
  includeYearly: z.boolean().default(false),
  priority: z.coerce.number().int().min(0).max(100).default(0),
});

export type MomentEingabe = z.infer<typeof momentSchema>;

function alsZeitpunkt(tag: string): Date {
  // Mittags statt um Mitternacht: ein Moment vom 1. September soll auch dann
  // im September liegen, wenn die Zeitzone um eine Stunde verschiebt.
  return new Date(`${tag}T12:00:00.000Z`);
}

export async function erstelleMoment(
  guildId: string,
  eingabe: MomentEingabe,
  akteur: AusgabeAkteur,
): Promise<{ id: string }> {
  const moment = await prisma.wrappedMoment.create({
    data: {
      guildId,
      title: eingabe.title,
      description: eingabe.description,
      happenedAt: alsZeitpunkt(eingabe.happenedOn),
      includeMonthly: eingabe.includeMonthly,
      includeYearly: eingabe.includeYearly,
      priority: eingabe.priority,
      createdByDiscordId: akteur.discordId,
    },
    select: { id: true },
  });

  await recordAudit({
    action: AUDIT_ACTIONS.WRAPPED_MOMENT_CREATED,
    module: WRAPPED_MODULE_ID,
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username ?? null,
    targetLabel: eingabe.title,
    metadata: { momentId: moment.id, happenedOn: eingabe.happenedOn },
  });

  return moment;
}

export async function aendereMoment(
  momentId: string,
  eingabe: MomentEingabe,
  akteur: AusgabeAkteur,
): Promise<void> {
  const vorher = await prisma.wrappedMoment.findUnique({
    where: { id: momentId },
    select: { title: true },
  });
  if (!vorher) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diesen Moment gibt es nicht.' });
  }

  await prisma.wrappedMoment.update({
    where: { id: momentId },
    data: {
      title: eingabe.title,
      description: eingabe.description,
      happenedAt: alsZeitpunkt(eingabe.happenedOn),
      includeMonthly: eingabe.includeMonthly,
      includeYearly: eingabe.includeYearly,
      priority: eingabe.priority,
      updatedByDiscordId: akteur.discordId,
    },
  });

  await recordAudit({
    action: AUDIT_ACTIONS.WRAPPED_MOMENT_UPDATED,
    module: WRAPPED_MODULE_ID,
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username ?? null,
    targetLabel: eingabe.title,
    metadata: { momentId },
  });
}

/**
 * Einen Moment loeschen.
 *
 * **Nicht, solange er in einer eingefrorenen Ausgabe steht.** Die Folie
 * bliebe zwar lesbar - Titel und Text stehen in ihrem Schnappschuss -, aber
 * das Bild verschwaende, und eine veroeffentlichte Ausgabe saehe beim
 * naechsten Export anders aus als beim letzten. Wer ihn wirklich loswerden
 * will, entsperrt die Ausgabe und nimmt die Folie heraus.
 */
export async function loescheMoment(momentId: string, akteur: AusgabeAkteur): Promise<void> {
  const moment = await prisma.wrappedMoment.findUnique({
    where: { id: momentId },
    select: {
      title: true,
      imagePath: true,
      slides: {
        where: { edition: { status: { in: ['FINALIZED', 'PUBLISHED', 'ARCHIVED'] } } },
        select: { edition: { select: { title: true } } },
        take: 1,
      },
    },
  });
  if (!moment) {
    return;
  }
  const gebunden = moment.slides[0];
  if (gebunden) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: `Dieser Moment steht in «${gebunden.edition.title}» und die Ausgabe ist eingefroren. Entsperre sie zuerst.`,
    });
  }

  await prisma.wrappedMoment.delete({ where: { id: momentId } });
  if (moment.imagePath) {
    await deleteUpload(moment.imagePath).catch(() => undefined);
  }

  await recordAudit({
    action: AUDIT_ACTIONS.WRAPPED_MOMENT_DELETED,
    module: WRAPPED_MODULE_ID,
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username ?? null,
    targetLabel: moment.title,
    metadata: { momentId },
  });
}

export async function speichereMomentBild(
  momentId: string,
  daten: Uint8Array,
  mimeType: string | null,
): Promise<void> {
  const vorher = await prisma.wrappedMoment.findUnique({
    where: { id: momentId },
    select: { imagePath: true },
  });
  if (!vorher) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diesen Moment gibt es nicht.' });
  }

  const gespeichert = await storeLogoUpload(daten, mimeType, 'wrappedmoment', BILD_GRENZEN);
  await prisma.wrappedMoment.update({
    where: { id: momentId },
    data: { imagePath: gespeichert.fileName },
  });

  // Erst nach dem erfolgreichen Schreiben - sonst zeigte die Zeile auf eine
  // Datei, die es nicht mehr gibt.
  if (vorher.imagePath) {
    await deleteUpload(vorher.imagePath).catch(() => undefined);
  }
}

/** Das Bild eines Moments - ueber eine Route, nicht als Datei im Web. */
/**
 * Das Bild eines Moments als `data:`-URI.
 *
 * ## Warum das noetig ist
 *
 * Im Schnappschuss einer Folie steht eine Adresse - `/api/wrapped/moment/…`.
 * Fuer den Browser ist das richtig: er ruft sie mit der Sitzung des
 * Betrachters ab. Fuer die Zeichenmaschine des Exports ist es unbrauchbar,
 * und zwar doppelt. Sie laeuft im Server und **wirft** bei einer relativen
 * Adresse - nicht fuer die eine Folie, sondern fuer das ganze Archiv. Und
 * selbst mit absoluter Adresse rief sie die Route ohne Sitzung auf und
 * bekaeme eine 401.
 *
 * Genau das ist im Betrieb passiert: eine Ausgabe mit einem bebilderten
 * Community Moment liess sich nicht exportieren, waehrend die Vorschau im
 * Editor das Bild anstandslos zeigte - dort zeichnet ein Browser.
 *
 * Die Bytes liegen ohnehin auf der Platte. Sie hier zu lesen und als
 * `data:`-URI weiterzureichen ist ein Dateizugriff statt eines HTTP-Aufrufs
 * auf den eigenen Server - kuerzer, sicherer und ohne Sitzungsfrage.
 *
 * `null` heisst: kein Bild, nicht lesbar, oder es gibt den Moment nicht.
 * Die Folie wird dann ohne Bild gezeichnet.
 */
export async function momentBildDatenUri(momentId: string): Promise<string | null> {
  const datei = await leseMomentBild(momentId);
  if (!datei) {
    return null;
  }
  return `data:${datei.contentType};base64,${datei.data.toString('base64')}`;
}

export async function leseMomentBild(
  momentId: string,
): Promise<{ data: Buffer; contentType: string } | null> {
  const moment = await prisma.wrappedMoment.findUnique({
    where: { id: momentId },
    select: { imagePath: true },
  });
  if (!moment?.imagePath) {
    return null;
  }
  const datei = await readUpload(moment.imagePath);
  return datei ? { data: datei.data, contentType: CONTENT_TYPE[datei.format] } : null;
}

export interface MomentZeile {
  id: string;
  title: string;
  description: string | null;
  happenedAt: Date;
  hatBild: boolean;
  includeMonthly: boolean;
  includeYearly: boolean;
  priority: number;
  /** In wie vielen Ausgaben er bereits steht. */
  verwendet: number;
}

export async function listeMomente(guildId: string, limit = 60): Promise<MomentZeile[]> {
  const momente = await prisma.wrappedMoment.findMany({
    where: { guildId },
    orderBy: { happenedAt: 'desc' },
    take: limit,
    select: {
      id: true,
      title: true,
      description: true,
      happenedAt: true,
      imagePath: true,
      includeMonthly: true,
      includeYearly: true,
      priority: true,
      _count: { select: { slides: true } },
    },
  });

  return momente.map((moment) => ({
    id: moment.id,
    title: moment.title,
    description: moment.description,
    happenedAt: moment.happenedAt,
    hatBild: moment.imagePath !== null,
    includeMonthly: moment.includeMonthly,
    includeYearly: moment.includeYearly,
    priority: moment.priority,
    verwendet: moment._count.slides,
  }));
}
