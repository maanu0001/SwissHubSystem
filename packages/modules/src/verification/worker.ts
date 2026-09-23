import { prisma } from '@swisshub/database';
import { discord as defaultDiscord, type DiscordGateway } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { verificationSettings } from './service';
import { behandleZeitueberschreitung } from './zeitueberschreitung';

const logger = createLogger('verification:worker');

/**
 * Zeitsteuerung der Verifikation.
 *
 * Zwei Aufgaben, beide idempotent und beide gegen die Datenbank statt gegen
 * Zeitgeber im Arbeitsspeicher: Vorgaenge ablaufen lassen und alte
 * Nachrichtentexte loeschen.
 *
 * **Die Frist gilt der Person, nicht der Moderation.** Faellig ist
 * ausschliesslich, was noch auf eine Nachricht wartet - `WAITING_FOR_MESSAGE`
 * und nichts sonst. Wer geschrieben hat, wartet auf uns, nicht umgekehrt,
 * und ein Moderator, der sich Zeit laesst, darf niemanden den Platz kosten.
 *
 * Ablaufen heisst nicht bannen. Wer nichts geschrieben hat, hat nichts
 * getan - er bekommt vorher eine Nachricht mit dem Grund und dem Weg
 * zurueck.
 */

export interface VerificationTickResult {
  abgelaufen: number;
  gekickt: number;
  bereinigt: number;
}

/** Hoechstens so viele Vorgaenge je Durchgang - der Rest folgt im naechsten. */
const JE_DURCHGANG = 50;

/**
 * Wie oft die Aufbewahrung tatsaechlich geprueft wird.
 *
 * Der Durchgang laeuft im Minutentakt, weil die Frist in Minuten gilt. Die
 * Aufbewahrung rechnet in Tagen; sie jede Minute zu pruefen waere eine
 * Abfrage, die neunundfuenfzig Mal nichts findet. Ein Richtwert, keine
 * Zusage: nach einem Neustart laeuft sie einmal zusaetzlich, und das ist
 * folgenlos.
 */
const AUFBEWAHRUNG_ABSTAND_MS = 3600_000;
let aufbewahrungZuletzt = 0;

export async function runVerificationTick(
  now = new Date(),
  gateway: DiscordGateway = defaultDiscord,
): Promise<VerificationTickResult> {
  const settings = await verificationSettings();
  let abgelaufen = 0;
  let gekickt = 0;

  if (settings.expireEnabled) {
    const grenze = new Date(now.getTime() - settings.expireAfterMinutes * 60_000);
    const faellig = await prisma.verificationRequest.findMany({
      /*
       * Nur wer nie geschrieben hat.
       *
       * Der Zustand ist hier die ganze Pruefung: schreibt jemand in der
       * letzten Sekunde, wechselt sein Vorgang noch in derselben nach
       * `WAITING_FOR_REVIEW` und ist fuer diese Abfrage nicht mehr da.
       * Laeuft der Durchgang trotzdem gleichzeitig los, scheitert er am
       * Riegel in `entscheide`.
       */
      where: { status: 'WAITING_FOR_MESSAGE', joinedAt: { lt: grenze } },
      select: { id: true, discordId: true, username: true, displayName: true },
      orderBy: { joinedAt: 'asc' },
      take: JE_DURCHGANG,
    });

    for (const eintrag of faellig) {
      const ergebnis = await behandleZeitueberschreitung(eintrag, settings, { gateway, now }).catch(
        (error: unknown) => {
          // Ein einzelner Vorgang darf den Durchgang nicht anhalten - sonst
          // bliebe der Rest der Warteschlange stehen.
          logger.warn('verification.timeout.failed', { requestId: eintrag.id, error });
          return null;
        },
      );
      if (!ergebnis) {
        continue;
      }
      abgelaufen += 1;
      if (ergebnis.gekickt) {
        gekickt += 1;
      }
    }
  }

  const bereinigt = await raeumeAlteTexte(now, settings.retentionDays);

  if (abgelaufen > 0 || bereinigt > 0) {
    logger.info('Verifikation fortgeschrieben', { abgelaufen, gekickt, bereinigt });
  }
  return { abgelaufen, gekickt, bereinigt };
}

/**
 * Aufbewahrung: der Nachrichtentext verschwindet, der Vorgang bleibt.
 *
 * Ohne den Vorgang waere nicht mehr nachvollziehbar, wer wann wie entschieden
 * hat - und genau das ist der Zweck der Aufbewahrung.
 */
async function raeumeAlteTexte(now: Date, retentionDays: number): Promise<number> {
  if (now.getTime() - aufbewahrungZuletzt < AUFBEWAHRUNG_ABSTAND_MS) {
    return 0;
  }
  aufbewahrungZuletzt = now.getTime();

  const textGrenze = new Date(now.getTime() - retentionDays * 24 * 3600_000);
  const [nachrichten, vorgaenge] = await Promise.all([
    prisma.verificationMessage.deleteMany({ where: { createdAt: { lt: textGrenze } } }),
    prisma.verificationRequest.updateMany({
      where: { latestMessage: { not: null }, decidedAt: { lt: textGrenze } },
      data: { latestMessage: null },
    }),
  ]);
  return nachrichten.count + vorgaenge.count;
}

/** Nur fuer Tests: den Abstand der Aufbewahrungspruefung zuruecksetzen. */
export function _setzeAufbewahrungZurueck(): void {
  aufbewahrungZuletzt = 0;
}
