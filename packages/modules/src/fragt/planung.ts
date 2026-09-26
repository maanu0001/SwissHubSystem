import { AUDIT_ACTIONS, prisma, recordAudit } from '@swisshub/database';
import { AppError } from '@swisshub/shared';
import { ortszeitAlsUtc, teileIn } from '@swisshub/shared';
import type { FragtFrage } from '@swisshub/database';
import { FRAGT_MODULE_ID, type FragtSettings } from './config';
import type { Handelnder } from './bibliothek';

/**
 * Wann gefragt wird, und welche Frage.
 *
 * ## Warum der Termin gerechnet und nicht gemerkt wird
 *
 * Weil ein gemerkter Termin nach einem Neustart verloren waere - oder, noch
 * schlimmer, doppelt vorhanden. Aus «Freitag 18:00 in Europe/Zurich» und der
 * aktuellen Zeit laesst sich der letzte faellige Termin jederzeit wieder
 * ausrechnen, und zwar von jedem Durchgang auf denselben Wert.
 *
 * Dieser Wert wird zu `FragtAbstimmung.opensAt`, und darauf liegt die
 * Bedingung `@@unique([frageId, opensAt])`. Damit ist der deterministische
 * Termin nicht nur bequem, sondern die halbe Absicherung gegen doppelte
 * Veroeffentlichungen: zwei Durchgaenge rechnen dasselbe aus und kollidieren.
 */

/**
 * Der letzte faellige Veroeffentlichungstermin - oder `null`.
 *
 * Gesucht wird der juengste Termin, der nicht in der Zukunft liegt und
 * hoechstens `nachholfristMs` alt ist.
 *
 * ## Warum eine Nachholfrist
 *
 * Damit ein Bot, der zwei Stunden stand, die Frage noch stellt - und einer,
 * der drei Wochen aus war, nicht drei alte Fragen auf einmal nachschiebt. Die
 * Frist ist kuerzer als eine Woche, deshalb kann hoechstens ein Termin offen
 * sein.
 */
export function faelligerTermin(
  jetzt: Date,
  einstellungen: Pick<FragtSettings, 'publishDay' | 'publishHour' | 'publishMinute' | 'timezone'>,
  nachholfristMs = 6 * 60 * 60 * 1000,
): Date | null {
  const zone = einstellungen.timezone;
  const teile = teileIn(jetzt, zone);

  /*
   * `wochentag` ist 0 = Sonntag, die Einstellung 1 = Montag … 7 = Sonntag.
   *
   * Beides ist eine verbreitete Zaehlweise, und genau deshalb gehoert die
   * Umrechnung an eine Stelle mit einem Kommentar daneben.
   */
  const heute = teile.wochentag === 0 ? 7 : teile.wochentag;
  const ziel = einstellungen.publishDay;

  // Wie viele Tage zurueck liegt der letzte Zieltag, heute eingeschlossen?
  const tageZurueck = (heute - ziel + 7) % 7;

  const kandidat = ortszeitAlsUtc(
    zone,
    teile.jahr,
    teile.monat,
    teile.tag - tageZurueck,
    einstellungen.publishHour,
    einstellungen.publishMinute,
  );

  /*
   * Ist der Kandidat noch in der Zukunft, war heute der Zieltag, aber die
   * Uhrzeit ist noch nicht erreicht. Dann gilt der Termin der Vorwoche.
   */
  const termin =
    kandidat > jetzt
      ? ortszeitAlsUtc(
          zone,
          teile.jahr,
          teile.monat,
          teile.tag - tageZurueck - 7,
          einstellungen.publishHour,
          einstellungen.publishMinute,
        )
      : kandidat;

  return jetzt.getTime() - termin.getTime() <= nachholfristMs ? termin : null;
}

/** Der naechste Termin in der Zukunft - fuer die Anzeige im Dashboard. */
export function naechsterTermin(
  jetzt: Date,
  einstellungen: Pick<FragtSettings, 'publishDay' | 'publishHour' | 'publishMinute' | 'timezone'>,
): Date {
  const zone = einstellungen.timezone;
  const teile = teileIn(jetzt, zone);
  const heute = teile.wochentag === 0 ? 7 : teile.wochentag;
  const tageVoraus = (einstellungen.publishDay - heute + 7) % 7;

  const kandidat = ortszeitAlsUtc(
    zone,
    teile.jahr,
    teile.monat,
    teile.tag + tageVoraus,
    einstellungen.publishHour,
    einstellungen.publishMinute,
  );

  // Heute ist Zieltag, aber die Zeit ist durch: dann naechste Woche.
  return kandidat > jetzt
    ? kandidat
    : ortszeitAlsUtc(
        zone,
        teile.jahr,
        teile.monat,
        teile.tag + tageVoraus + 7,
        einstellungen.publishHour,
        einstellungen.publishMinute,
      );
}

/**
 * Welche Frage kommt als naechste?
 *
 * ## Die Regeln, in dieser Reihenfolge
 *
 * 1. **Ein zugewiesener Termin gewinnt.** Wer eine Frage von Hand auf diesen
 *    Termin geplant hat, hat entschieden - und zwar auch im Modus
 *    «automatisch». Die Automatik ist der Ersatz fuer fehlende Planung, nicht
 *    ihre Korrektur.
 * 2. **Nur freigegebene Fragen.** `READY`, nicht archiviert.
 * 3. **Keine unmittelbare Wiederholung.** Was zuletzt dran war, kommt zuletzt.
 * 4. **Eine andere Kategorie als letztes Mal**, wenn es eine gibt.
 * 5. **Bei Gleichstand die Kennung.** Damit zwei Durchgaenge dieselbe Frage
 *    waehlen - was sie muessen, weil sonst zwei verschiedene Fragen unter
 *    demselben Termin stehen koennten und die Bedingung in der Datenbank
 *    beide durchliesse.
 *
 * Punkt 5 ist der Grund, warum hier kein `Math.random()` steht. Eine
 * Zufallsauswahl wuerde sich nach einem Neustart anders entscheiden - und die
 * Absicherung gegen doppelte Veroeffentlichungen greift nur bei derselben
 * Frage.
 */
export async function waehleFrage(
  guildId: string,
  termin: Date,
  modus: FragtSettings['selectionMode'],
): Promise<FragtFrage | null> {
  /*
   * Zuerst: hat jemand etwas fuer diesen Termin geplant?
   *
   * Ein Zeitfenster um den Termin und nicht Gleichheit: der von Hand gesetzte
   * Termin kommt aus einem Formular und ist auf die Minute genau, der
   * gerechnete auf die Sekunde. Ein Fenster von zwoelf Stunden trifft die
   * Absicht («an diesem Tag») ohne die Frage der Vorwoche mitzunehmen.
   */
  const fenster = 12 * 60 * 60 * 1000;
  const geplant = await prisma.fragtFrage.findFirst({
    where: {
      guildId,
      status: 'SCHEDULED',
      archivedAt: null,
      geplantAt: { gte: new Date(termin.getTime() - fenster), lte: new Date(termin.getTime() + fenster) },
    },
    orderBy: [{ geplantAt: 'asc' }, { id: 'asc' }],
  });
  if (geplant) {
    return geplant;
  }

  if (modus === 'manuell') {
    // Nichts geplant, und die Automatik ist aus. Das ist kein Fehler - es
    // bedeutet, dass diese Woche keine Frage kommt.
    return null;
  }

  const zuletzt = await prisma.fragtAbstimmung.findFirst({
    where: { guildId },
    orderBy: { opensAt: 'desc' },
    include: { frage: { select: { kategorie: true, id: true } } },
  });

  const kandidaten = await prisma.fragtFrage.findMany({
    where: { guildId, status: 'READY', archivedAt: null },
    /*
     * Wer am laengsten nicht dran war, zuerst.
     *
     * `nulls: 'first'`: eine Frage, die noch nie gestellt wurde, hat kein
     * Datum - und sie soll vor der stehen, die vor einem Jahr dran war. Ohne
     * diese Angabe sortiert PostgreSQL NULL bei aufsteigender Ordnung ans
     * Ende, und neue Fragen kaemen nie zum Einsatz.
     */
    orderBy: [{ zuletztGestelltAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
    take: 50,
  });

  if (kandidaten.length === 0) {
    return null;
  }

  // Keine unmittelbare Wiederholung: dieselbe Frage nur, wenn es keine andere gibt.
  const ohneLetzte = kandidaten.filter((frage) => frage.id !== zuletzt?.frageId);
  const auswahl = ohneLetzte.length > 0 ? ohneLetzte : kandidaten;

  // Eine andere Kategorie als letztes Mal, wenn moeglich.
  const andereKategorie = auswahl.filter((frage) => frage.kategorie !== zuletzt?.frage.kategorie);
  const endgueltig = andereKategorie.length > 0 ? andereKategorie : auswahl;

  return endgueltig[0] ?? null;
}

/**
 * Eine Frage einem Termin zuweisen.
 *
 * Setzt `status = SCHEDULED`. Nur aus `READY` heraus: eine Frage zu planen, die
 * niemand geprueft hat, waere eine Veroeffentlichung durch die Hintertuer.
 */
export async function planeFrage(frageId: string, actor: Handelnder, termin: Date): Promise<FragtFrage> {
  const frage = await prisma.fragtFrage.findUnique({ where: { id: frageId } });
  if (!frage) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Frage gibt es nicht.' });
  }
  if (frage.archivedAt) {
    throw new AppError('CONFLICT', { userMessage: 'Diese Frage ist archiviert.' });
  }
  if (frage.status === 'ACTIVE') {
    throw new AppError('CONFLICT', { userMessage: 'Diese Frage läuft gerade.' });
  }
  if (frage.status === 'DRAFT') {
    throw new AppError('CONFLICT', {
      userMessage: 'Gib die Frage zuerst frei. Ein Entwurf soll nicht aus Versehen auf Discord landen.',
    });
  }
  if (termin.getTime() <= Date.now()) {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Der Termin liegt in der Vergangenheit.' });
  }

  const aktualisiert = await prisma.fragtFrage.update({
    where: { id: frageId },
    data: { status: 'SCHEDULED', geplantAt: termin },
  });

  await recordAudit({
    action: AUDIT_ACTIONS.FRAGT_QUESTION_SCHEDULED,
    module: FRAGT_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username ?? null,
    targetLabel: frage.text,
    metadata: { frageId, termin: termin.toISOString() },
  });

  return aktualisiert;
}

/** Die Planung einer Frage aufheben - zurueck auf freigegeben. */
export async function hebePlanungAuf(frageId: string, actor: Handelnder): Promise<FragtFrage> {
  const frage = await prisma.fragtFrage.findUnique({ where: { id: frageId } });
  if (!frage) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Frage gibt es nicht.' });
  }
  if (frage.status !== 'SCHEDULED') {
    throw new AppError('CONFLICT', { userMessage: 'Diese Frage ist nicht geplant.' });
  }

  const aktualisiert = await prisma.fragtFrage.update({
    where: { id: frageId },
    data: { status: 'READY', geplantAt: null },
  });

  await recordAudit({
    action: AUDIT_ACTIONS.FRAGT_QUESTION_SCHEDULED,
    module: FRAGT_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username ?? null,
    targetLabel: frage.text,
    metadata: { frageId, aufgehoben: true },
  });

  return aktualisiert;
}

/** Die geplanten Fragen, in Terminreihenfolge. */
export async function geplanteFragen(guildId: string): Promise<FragtFrage[]> {
  return prisma.fragtFrage.findMany({
    where: { guildId, status: 'SCHEDULED', archivedAt: null },
    orderBy: [{ geplantAt: 'asc' }],
  });
}
