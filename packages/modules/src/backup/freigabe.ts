import 'server-only';
import { prisma } from '@swisshub/database';
import type { RestoreFreigabeStatus } from '@prisma/client';
import { createLogger } from '@swisshub/logger';
import { AppError } from '@swisshub/shared';

const log = createLogger('backup:freigabe');

/**
 * Das Vier-Augen-Prinzip fuer produktive Wiederherstellungen.
 *
 * ==========================================================================
 * WARUM DIE BESTEHENDE PERMISSION ENGINE HIERFUER NICHT GENUEGT
 * ==========================================================================
 *
 * Sie kann sehr fein vergeben - `backup.restore_request` und
 * `backup.restore_approve` sind zwei getrennte Berechtigungen, und wer nur die
 * erste hat, kann nicht freigeben. Was sie nicht kann: verlangen, dass ZWEI
 * VERSCHIEDENE Personen zustimmen. `can(context, permission)` ist eine Aussage
 * ueber genau einen Handelnden; ein Konto mit beiden Berechtigungen koennte
 * beide Schritte allein gehen.
 *
 * Fuer die eine Operation, bei der ein einzelner Irrtum nicht ausreichen soll,
 * ist das zu wenig. Ein produktiver Restore verwirft alles, was nach dem
 * Zielzeitpunkt geschehen ist - jede Nachricht, jede Moderation, jeden
 * Ticketverlauf. Er muss moeglich sein, und er darf nicht bequem sein.
 *
 * Deshalb diese Schicht. Sie prueft, was die Engine nicht pruefen kann:
 * `freigegebenVon !== angefordertVon`.
 *
 * WAS SIE NICHT TUT: sie loest keinen Restore aus. Die WebApp kann das nicht -
 * es gibt keine solche Operation im Controller. Eine freigegebene Anforderung
 * ist der NACHWEIS, den `swisshub-recovery` auf der Kommandozeile prueft,
 * bevor es die Produktion anfasst.
 * ==========================================================================
 */

/** Was wiederhergestellt werden soll. */
export const RESTORE_UMFANG = {
  datenbank: 'produktiv-datenbank',
  dateien: 'produktiv-dateien',
  vollstaendig: 'produktiv-vollstaendig',
} as const;

export type RestoreUmfang = (typeof RESTORE_UMFANG)[keyof typeof RESTORE_UMFANG];

export const UMFANG_LABEL: Record<string, string> = {
  [RESTORE_UMFANG.datenbank]: 'Nur die Datenbank',
  [RESTORE_UMFANG.dateien]: 'Nur die Uploads',
  [RESTORE_UMFANG.vollstaendig]: 'Datenbank und Uploads',
};

/**
 * Wie lange eine Freigabe gilt.
 *
 * Vier Stunden: genug fuer eine Wiederherstellung samt Vorbereitung, zu kurz
 * um in einem halben Jahr noch zu wirken. Eine Freigabe ohne Frist ist eine
 * dauerhafte Befugnis, und genau die soll hier nicht entstehen.
 */
export const GUELTIGKEIT_STUNDEN = 4;

export interface FreigabeAnforderung {
  umfang: RestoreUmfang;
  /** `null` heisst «jungstmoeglicher Stand». */
  zielZeitpunkt: Date | null;
  begruendung: string;
  angefordertVon: string;
  angefordertVonName: string | null;
}

export interface FreigabeZeile {
  id: string;
  umfang: string;
  umfangLabel: string;
  zielZeitpunkt: Date | null;
  begruendung: string;
  angefordertVon: string;
  angefordertVonName: string | null;
  angefordertAm: Date;
  freigegebenVon: string | null;
  freigegebenVonName: string | null;
  freigegebenAm: Date | null;
  gueltigBis: Date;
  status: RestoreFreigabeStatus;
  abgelehntVon: string | null;
  abgelehntAm: Date | null;
  abgelehntGrund: string | null;
  verwendetAm: Date | null;
  /** Ist sie jetzt noch einlösbar? Gerechnet, nicht gespeichert. */
  jetztGueltig: boolean;
}

function zuZeile(eintrag: {
  id: string;
  umfang: string;
  zielZeitpunkt: Date | null;
  begruendung: string;
  angefordertVon: string;
  angefordertVonName: string | null;
  angefordertAm: Date;
  freigegebenVon: string | null;
  freigegebenVonName: string | null;
  freigegebenAm: Date | null;
  gueltigBis: Date;
  status: RestoreFreigabeStatus;
  abgelehntVon: string | null;
  abgelehntAm: Date | null;
  abgelehntGrund: string | null;
  verwendetAm: Date | null;
}): FreigabeZeile {
  return {
    ...eintrag,
    umfangLabel: UMFANG_LABEL[eintrag.umfang] ?? eintrag.umfang,
    jetztGueltig: eintrag.status === 'FREIGEGEBEN' && eintrag.gueltigBis > new Date(),
  };
}

/**
 * Eine Anforderung stellen.
 *
 * Sie loest nichts aus. Nach diesem Aufruf steht eine Zeile in der Datenbank
 * und ein Eintrag im Audit Log - und es fehlt die zweite Person.
 */
export async function fordereRestoreAn(eingabe: FreigabeAnforderung): Promise<FreigabeZeile> {
  const begruendung = eingabe.begruendung.trim();
  if (begruendung.length < 20) {
    throw new AppError('VALIDATION_FAILED', {
      internalMessage: 'Begruendung zu kurz.',
      userMessage:
        'Die Begruendung muss mindestens 20 Zeichen haben. Sie ist das, was in einem halben Jahr die Frage beantwortet, weshalb an diesem Tag Daten verworfen wurden.',
      details: { fieldErrors: { begruendung: 'Mindestens 20 Zeichen.' } },
    });
  }

  // Nicht zwei offene Anforderungen derselben Person: die zweite waere ein
  // Weg, die erste in der Liste untergehen zu lassen.
  const offen = await prisma.restoreFreigabe.count({
    where: {
      angefordertVon: eingabe.angefordertVon,
      status: { in: ['ANGEFORDERT', 'FREIGEGEBEN'] },
      gueltigBis: { gt: new Date() },
    },
  });
  if (offen > 0) {
    throw new AppError('CONFLICT', {
      internalMessage: 'Es gibt schon eine offene Anforderung dieser Person.',
      userMessage:
        'Es liegt bereits eine offene Restore-Anforderung von dir vor. Sie ist zuerst zu verwenden oder zurueckzuziehen.',
    });
  }

  const eintrag = await prisma.restoreFreigabe.create({
    data: {
      umfang: eingabe.umfang,
      zielZeitpunkt: eingabe.zielZeitpunkt,
      begruendung,
      angefordertVon: eingabe.angefordertVon,
      angefordertVonName: eingabe.angefordertVonName,
      gueltigBis: new Date(Date.now() + GUELTIGKEIT_STUNDEN * 3_600_000),
    },
  });

  log.warn('Produktiver Restore angefordert', {
    id: eintrag.id,
    umfang: eingabe.umfang,
    von: eingabe.angefordertVon,
  });
  return zuZeile(eintrag);
}

/**
 * Freigeben - durch eine ANDERE Person.
 *
 * Die Pruefung darauf ist der ganze Zweck dieser Funktion. Sie steht hier und
 * nicht in der Datenbank, weil sie hier eine verstaendliche Meldung geben kann
 * - und weil ein Datenbank-CHECK darueber in Prisma nicht zu fuehren ist.
 */
export async function gebeRestoreFrei(
  id: string,
  freigebenderDiscordId: string,
  freigebenderName: string | null,
): Promise<FreigabeZeile> {
  const eintrag = await prisma.restoreFreigabe.findUnique({ where: { id } });
  if (!eintrag) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Anforderung gibt es nicht.' });
  }
  if (eintrag.status !== 'ANGEFORDERT') {
    throw new AppError('CONFLICT', {
      internalMessage: `Status ist ${eintrag.status}.`,
      userMessage: `Diese Anforderung ist nicht mehr offen (Zustand: ${eintrag.status}).`,
    });
  }
  if (eintrag.gueltigBis <= new Date()) {
    await prisma.restoreFreigabe.update({ where: { id }, data: { status: 'ABGELAUFEN' } });
    throw new AppError('CONFLICT', {
      internalMessage: 'Anforderung abgelaufen.',
      userMessage: `Diese Anforderung ist abgelaufen (sie galt bis ${eintrag.gueltigBis.toLocaleString('de-CH')}). Eine neue ist zu stellen.`,
    });
  }

  // DIE Pruefung.
  if (eintrag.angefordertVon === freigebenderDiscordId) {
    log.warn('Selbstfreigabe eines produktiven Restores abgelehnt', {
      id,
      discordId: freigebenderDiscordId,
    });
    throw new AppError('FORBIDDEN', {
      internalMessage: 'Selbstfreigabe.',
      userMessage:
        'Eine eigene Anforderung kann man nicht selbst freigeben. Ein produktiver Restore verwirft alles nach dem Zielzeitpunkt - dafuer braucht es die Zustimmung einer zweiten Person.',
    });
  }

  const aktualisiert = await prisma.restoreFreigabe.update({
    where: { id },
    data: {
      status: 'FREIGEGEBEN',
      freigegebenVon: freigebenderDiscordId,
      freigegebenVonName: freigebenderName,
      freigegebenAm: new Date(),
    },
  });

  log.warn('Produktiver Restore freigegeben', {
    id,
    von: freigebenderDiscordId,
    angefordertVon: eintrag.angefordertVon,
  });
  return zuZeile(aktualisiert);
}

/** Zurueckziehen oder ablehnen. Beides ist derselbe Vorgang. */
export async function lehneRestoreAb(id: string, discordId: string, grund: string): Promise<FreigabeZeile> {
  const eintrag = await prisma.restoreFreigabe.findUnique({ where: { id } });
  if (!eintrag) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Anforderung gibt es nicht.' });
  }
  if (eintrag.status === 'VERWENDET') {
    throw new AppError('CONFLICT', {
      userMessage: 'Diese Freigabe wurde bereits verwendet - sie laesst sich nicht mehr zurueckziehen.',
    });
  }

  const aktualisiert = await prisma.restoreFreigabe.update({
    where: { id },
    data: {
      status: 'ABGELEHNT',
      abgelehntVon: discordId,
      abgelehntAm: new Date(),
      abgelehntGrund: grund.trim().slice(0, 500) || null,
    },
  });
  log.info('Restore-Anforderung zurueckgezogen', { id, von: discordId });
  return zuZeile(aktualisiert);
}

/** Die Liste fuer das Recovery Center. */
export async function listeFreigaben(grenze = 25): Promise<FreigabeZeile[]> {
  // Abgelaufene beim Lesen nachtragen: ein Zeitpunkt in der Vergangenheit
  // macht eine Freigabe ungueltig, und der Status soll das sagen, statt dass
  // die Oberflaeche es jedes Mal selbst ausrechnet.
  await prisma.restoreFreigabe.updateMany({
    where: { status: { in: ['ANGEFORDERT', 'FREIGEGEBEN'] }, gueltigBis: { lte: new Date() } },
    data: { status: 'ABGELAUFEN' },
  });

  const zeilen = await prisma.restoreFreigabe.findMany({
    orderBy: { angefordertAm: 'desc' },
    take: grenze,
  });
  return zeilen.map(zuZeile);
}

/**
 * Die eine gueltige Freigabe, falls es sie gibt.
 *
 * Genau diese Funktion fragt `swisshub-recovery` ab - ueber SQL, nicht ueber
 * diesen Code: das Werkzeug darf nicht von der WebApp abhaengen. Die Abfrage
 * steht in docs/DISASTER-RECOVERY.md, damit beide Seiten dasselbe pruefen.
 */
export async function findeGueltigeFreigabe(): Promise<FreigabeZeile | null> {
  const eintrag = await prisma.restoreFreigabe.findFirst({
    where: { status: 'FREIGEGEBEN', gueltigBis: { gt: new Date() } },
    orderBy: { freigegebenAm: 'desc' },
  });
  return eintrag ? zuZeile(eintrag) : null;
}
