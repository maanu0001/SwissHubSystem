/**
 * Was der Gewinner einer Clip-Runde bekommt.
 *
 * ## Der Riegel gegen die zweite Vergabe
 *
 * Ein Abschluss kann mehr als einmal laufen. `finalisiere` gibt eine
 * steckengebliebene Runde nach fuenf Minuten wieder frei - ein Neustart
 * mitten im Abschluss soll die Runde nicht fuer immer haengen lassen -, und
 * das Team kann von Hand nachfassen. Eine Pruefung «gab es schon eine
 * Belohnung?» in der Anwendung reichte dafuer nicht: zwei gleichzeitige
 * Durchgaenge lesen beide «nein», bevor einer schreibt.
 *
 * Deshalb ist die Zeile selbst der Riegel. `ClipCompetitionReward` traegt
 * `@@unique` auf der Runde, und sie wird **zuerst** geschrieben - vor dem
 * Premium, vor den XP. Wer sie nicht anlegen kann, hat verloren und vergibt
 * nichts. Die Datenbank entscheidet, nicht die Reihenfolge der Abfragen.
 *
 * Dass die Zeile vorne steht, heisst auch: geht das Verschenken danach
 * schief, steht eine Belohnung mit `kind: NONE` und einem Grund da. Das ist
 * die ehrlichere Haelfte des Tauschs - lieber eine nachvollziehbar nicht
 * vergebene Belohnung als eine, die beim naechsten Lauf ein zweites Mal
 * versucht wird.
 */
import { AUDIT_ACTIONS, prisma, safeRecordAudit, type Prisma } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { applyXp } from '../level/service';
import { schenkePremium } from '../premium/service';
import { CLIPS_MODULE_ID, type ClipsSettings } from './config';

const log = createLogger('clips:belohnung');

/** Sieben Tage. Steht hier und nicht in den Einstellungen - siehe unten. */
export const PREMIUM_TAGE = 7;

export interface BelohnungsErgebnis {
  art: 'PREMIUM' | 'XP' | 'NONE';
  xp?: number;
  subscriptionId?: string;
  grund?: string;
  /** Traf dieser Lauf auf eine bereits vergebene Belohnung? */
  schonVergeben: boolean;
}

export interface BelohneInput {
  competitionId: string;
  /** Fuer das Protokoll: «Clip of the Week #12». */
  rundenLabel: string;
  winnerDiscordId: string;
  einstellungen: Pick<ClipsSettings, 'winnerRewardXp'>;
  jetzt?: Date;
}

/**
 * Den Gewinner belohnen - genau einmal je Runde.
 *
 * Die Dauer steht im Code und nicht in den Einstellungen: «1 Woche Premium»
 * ist die Zusage des Wettbewerbs und keine Stellschraube. Was eingestellt
 * wird, ist der Ersatz fuer den Fall, dass jemand schon Premium hat - dort
 * gibt es keine natuerliche Zahl, und deshalb gehoert sie ins Dashboard.
 */
export async function belohneGewinner(input: BelohneInput): Promise<BelohnungsErgebnis> {
  const jetzt = input.jetzt ?? new Date();

  /*
   * Zuerst den Platz belegen.
   *
   * `create` und nicht `upsert`: ein `upsert` wuerde die vorhandene Zeile
   * ueberschreiben und damit genau das erlauben, was hier verhindert werden
   * soll. Der Fehler bei doppeltem Schluessel ist die Antwort.
   */
  try {
    await prisma.clipCompetitionReward.create({
      data: {
        competitionId: input.competitionId,
        winnerDiscordId: input.winnerDiscordId,
        kind: 'NONE',
        reason: 'wird vergeben',
        grantedAt: jetzt,
      },
    });
  } catch (error) {
    if (istEindeutigkeitsfehler(error)) {
      log.info('Belohnung war bereits vergeben', { competitionId: input.competitionId });
      const vorhanden = await prisma.clipCompetitionReward.findUnique({
        where: { competitionId: input.competitionId },
      });
      return {
        art: vorhanden?.kind ?? 'NONE',
        xp: vorhanden?.xpAmount ?? undefined,
        subscriptionId: vorhanden?.subscriptionId ?? undefined,
        grund: vorhanden?.reason ?? undefined,
        schonVergeben: true,
      };
    }
    throw error;
  }

  const ergebnis = await vergib(input, jetzt);

  await prisma.clipCompetitionReward.update({
    where: { competitionId: input.competitionId },
    data: {
      kind: ergebnis.art,
      xpAmount: ergebnis.xp ?? null,
      subscriptionId: ergebnis.subscriptionId ?? null,
      reason: ergebnis.grund ?? null,
    },
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.CLIP_WINNER_REWARDED,
    module: CLIPS_MODULE_ID,
    actorDiscordId: null,
    actorUsername: null,
    targetDiscordId: input.winnerDiscordId,
    targetLabel: input.rundenLabel,
    success: ergebnis.art !== 'NONE',
    metadata: {
      competitionId: input.competitionId,
      art: ergebnis.art,
      ...(ergebnis.xp === undefined ? {} : { xp: ergebnis.xp }),
      ...(ergebnis.grund === undefined ? {} : { grund: ergebnis.grund }),
    },
  });

  return ergebnis;
}

/** Premium, sonst XP, sonst nichts - mit Begruendung. */
async function vergib(input: BelohneInput, jetzt: Date): Promise<BelohnungsErgebnis> {
  /*
   * Ob jemand schon Premium hat, entscheidet der Premium-Dienst.
   *
   * Nicht die Discord-Rolle: die ist die Folge des Abonnements und kann
   * hinterherhinken - der Sync laeuft nicht im selben Atemzug. Wer nach
   * einem ausgefallenen Sync gefragt wuerde, bekaeme eine zweite Woche
   * geschenkt, obwohl die erste laeuft.
   */
  const abo = await schenkePremium({
    discordId: input.winnerDiscordId,
    tage: PREMIUM_TAGE,
    quelle: 'clip-of-the-week',
    jetzt,
  });

  if (abo) {
    return { art: 'PREMIUM', subscriptionId: abo.id, schonVergeben: false };
  }

  // Kein Premium vergeben - also XP. Wie viele, steht im Dashboard.
  const menge = input.einstellungen.winnerRewardXp;
  if (menge <= 0) {
    return { art: 'NONE', grund: 'Premium läuft bereits, XP-Ersatz steht auf 0.', schonVergeben: false };
  }

  const buchung = await applyXp({
    discordId: input.winnerDiscordId,
    username: null,
    displayName: null,
    delta: menge,
    source: 'ADMIN',
    reason: 'Clip der Woche gewonnen',
    actorDiscordId: null,
    /*
     * Der zweite Riegel, und zwar dort, wo die XP entstehen.
     *
     * Die Belohnungszeile allein schuetzt den Ablauf hier. Der Schluessel
     * schuetzt die Buchung auch dann, wenn spaeter jemand einen anderen Weg
     * zu dieser Stelle baut - das XP-Journal nimmt denselben Schluessel kein
     * zweites Mal an.
     */
    idempotencyKey: `clip-winner:${input.competitionId}`,
  }).catch((error: unknown) => {
    log.warn('XP-Belohnung fehlgeschlagen', { competitionId: input.competitionId, error });
    return null;
  });

  if (!buchung) {
    return { art: 'NONE', grund: 'Premium läuft bereits, die XP-Buchung schlug fehl.', schonVergeben: false };
  }

  return {
    art: 'XP',
    xp: buchung.delta,
    grund: 'Mitglied besitzt bereits Premium.',
    schonVergeben: false,
  };
}

function istEindeutigkeitsfehler(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as Prisma.PrismaClientKnownRequestError).code === 'P2002'
  );
}
