/**
 * Auszeichnungen von Hand verleihen und entziehen.
 *
 * ## Was hier nicht geht
 *
 * Eine abgeleitete Auszeichnung vergeben. `vergebbareArt` liest die
 * Definitionen aus `AwardDefinition`, und dort kann kein gerechneter
 * Schluessel stehen: `erstelleAuszeichnungsArt` weist jeden ab, den
 * `auszeichnungsArt` kennt. «Turniersieger» laesst sich deshalb nicht von
 * Hand setzen, und zwar nicht, weil hier eine Pruefung greift, sondern
 * weil es den Schluessel gar nicht erst gibt.
 *
 * ## Und was eine abgeschaltete Art bedeutet
 *
 * Nicht mehr vergeben, aber weiterhin gueltig. Wer «Event-Held» schon hat,
 * behaelt ihn, auch wenn die Art archiviert wurde - `entziehe` kommt
 * deshalb ohne Definition aus, `verleihe` nicht.
 *
 * ## Und was hier nicht entschieden wird
 *
 * Wer verleihen darf. Das prueft die Aktion in der WebApp mit der
 * bestehenden Permission Engine, bevor sie hierherkommt. Diese Datei kennt
 * keine Berechtigungen - sie wuerde sonst eine zweite Stelle mit derselben
 * Regel.
 */
import { AUDIT_ACTIONS, prisma, safeRecordAudit, type Prisma } from '@swisshub/database';
import { AppError } from '@swisshub/shared';
import { auszeichnungsArt } from './auszeichnungen';
import { vergebbareArt } from './auszeichnungs-arten';

/** Wer verleiht - fuer das Protokoll. */
export interface Verleiher {
  discordId: string;
  username: string;
}

export interface VerleihEingabe {
  /** Wem. */
  discordId: string;
  /** Welche - der Schluessel einer aktiven `AwardDefinition`. */
  key: string;
  /** Warum. Freiwillig. */
  notiz?: string | null;
}

/** Die Schluessel, die jemand verliehen bekommen hat. */
export async function verliehenAn(discordId: string): Promise<string[]> {
  const zeilen = await prisma.memberAward.findMany({
    where: { discordId },
    select: { key: true },
    orderBy: { grantedAt: 'asc' },
  });
  return zeilen.map((zeile) => zeile.key);
}

/** Die Verleihungen mit Datum und Begruendung - fuer die Verwaltung. */
export async function verleihungenVon(discordId: string) {
  return prisma.memberAward.findMany({
    where: { discordId },
    orderBy: { grantedAt: 'desc' },
  });
}

/**
 * Verleihen.
 *
 * Gibt `false` zurueck, wenn die Person sie schon hat - kein Fehler, das
 * ist der zweite Klick auf denselben Knopf. Die Eindeutigkeit in der
 * Datenbank ist dabei der eigentliche Riegel: zwei gleichzeitige Anfragen
 * sehen beide «hat sie noch nicht», und eine davon laeuft in P2002.
 */
export async function verleihe(akteur: Verleiher, eingabe: VerleihEingabe): Promise<boolean> {
  /*
   * Der ausdrueckliche Riegel gegen gerechnete Auszeichnungen.
   *
   * Strukturell gab es ihn schon: in `AwardDefinition` kann kein gerechneter
   * Schluessel stehen, weil `erstelleAuszeichnungsArt` jeden abweist, den
   * `auszeichnungsArt` kennt. Das ist eine Pruefung beim **Anlegen** - und
   * sie greift nicht rueckwirkend. Kaeme eine neue gerechnete Auszeichnung
   * mit einem Schluessel dazu, den es als verleihbare Art laengst gibt,
   * waere «Turniersieger» ploetzlich von Hand vergebbar.
   *
   * Deshalb hier noch einmal, beim **Vergeben**: kennt die Registry den
   * Schluessel, ist Schluss. Eine manipulierte Anfrage kommt damit nicht
   * weiter als eine ordentliche, und das ist der ganze Sinn.
   */
  if (auszeichnungsArt(eingabe.key)) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage:
        'Diese Auszeichnung wird gerechnet und lässt sich nicht von Hand vergeben. Sie entsteht aus Turnieren, Clips und dem Level.',
      internalMessage: `Versuch, die gerechnete Auszeichnung ${eingabe.key} zu verleihen`,
    });
  }

  const art = await vergebbareArt(eingabe.key);
  if (!art) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Diese Auszeichnung lässt sich nicht von Hand vergeben.',
    });
  }

  try {
    await prisma.memberAward.create({
      data: {
        discordId: eingabe.discordId,
        key: art.key,
        grantedByDiscordId: akteur.discordId,
        note: eingabe.notiz?.trim() || null,
      },
    });
  } catch (error) {
    if (istEindeutigkeitsfehler(error)) {
      return false;
    }
    throw error;
  }

  await safeRecordAudit({
    action: AUDIT_ACTIONS.PROFILE_AWARD_GRANTED,
    module: 'members',
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username,
    targetDiscordId: eingabe.discordId,
    targetLabel: art.label,
    success: true,
    metadata: { key: art.key, ...(eingabe.notiz ? { notiz: eingabe.notiz } : {}) },
  });
  return true;
}

/**
 * Entziehen.
 *
 * `deleteMany` und nicht `delete`: wer zweimal auf «Entziehen» klickt, soll
 * beim zweiten Mal keinen Fehler sehen. `false` heisst schlicht, dass es
 * nichts zu entziehen gab.
 */
export async function entziehe(akteur: Verleiher, discordId: string, key: string): Promise<boolean> {
  // Absichtlich ohne `vergebbareArt`: eine archivierte Art muss sich
  // entziehen lassen. Der Name dient nur dem Protokoll - fehlt er, steht
  // dort der Schluessel.
  const art = await prisma.awardDefinition.findUnique({ where: { key } });
  const { count } = await prisma.memberAward.deleteMany({ where: { discordId, key } });
  if (count === 0) {
    return false;
  }

  await safeRecordAudit({
    action: AUDIT_ACTIONS.PROFILE_AWARD_REVOKED,
    module: 'members',
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username,
    targetDiscordId: discordId,
    targetLabel: art?.label ?? key,
    success: true,
    metadata: { key },
  });
  return true;
}

function istEindeutigkeitsfehler(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as Prisma.PrismaClientKnownRequestError).code === 'P2002'
  );
}
