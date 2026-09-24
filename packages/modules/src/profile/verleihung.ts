/**
 * Auszeichnungen von Hand verleihen und entziehen.
 *
 * ## Was hier nicht geht
 *
 * Eine abgeleitete Auszeichnung vergeben. `verleihbareArt` nimmt nur
 * Schluessel aus `VERLEIHBARE`, und die Liste ueberschneidet sich nicht mit
 * den gerechneten - ein Test prueft das. «Turniersieger» laesst sich
 * deshalb nicht von Hand setzen, und zwar nicht, weil eine Pruefung es
 * abfaengt, sondern weil es den Schluessel hier nicht gibt.
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
import { verleihbareArt } from './auszeichnungen';

/** Wer verleiht - fuer das Protokoll. */
export interface Verleiher {
  discordId: string;
  username: string;
}

export interface VerleihEingabe {
  /** Wem. */
  discordId: string;
  /** Welche - ein Schluessel aus `VERLEIHBARE`. */
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
  const art = verleihbareArt(eingabe.key);
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
  const art = verleihbareArt(key);
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
