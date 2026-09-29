import { prisma } from '@swisshub/database';
import { discord as defaultDiscord, type DiscordGateway } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { sendeErinnerung } from './erinnerung';
import { loescheFaelligeBegruessungen } from './nachricht-frist';
import { verificationSettings } from './service';

const logger = createLogger('verification:worker');

/**
 * Zeitsteuerung der Verifikation.
 *
 * Drei Aufgaben, alle idempotent und alle gegen die Datenbank statt gegen
 * Zeitgeber im Arbeitsspeicher: faellige Erinnerungen senden, faellige
 * Begruessungen entfernen und alte Nachrichtentexte loeschen.
 *
 * Die ersten beiden sind ausdruecklich voneinander unabhaengig. Eine
 * Erinnerung ist ein Anstupser an eine Person; das Entfernen der Begruessung
 * ist Ordnung im Kanal. Wer beides koppelte, koennte «erinnere taeglich, aber
 * raeume nach drei Tagen auf» nicht einstellen - und genau das ist der Fall,
 * den ein Server mit Zulauf braucht.
 *
 * ## Was hier nicht mehr steht
 *
 * Die Frist. Frueher lief ein Vorgang ohne Nachricht nach einer
 * Viertelstunde ab, und wer bis dahin nichts geschrieben hatte, wurde vom
 * Server geworfen. Sie ist ersatzlos entfallen: wer nicht antwortet, bleibt
 * unverifiziert, und es geschieht zunaechst gar nichts. Was an ihre Stelle
 * tritt, wirft niemanden hinaus - es erinnert.
 */

export interface VerificationTickResult {
  /** Wie viele Erinnerungen tatsaechlich rausgingen. */
  erinnert: number;
  /** Wie viele Reihen in diesem Durchgang geendet haben. */
  beendet: number;
  /** Wie viele Begruessungen nach Ablauf ihrer Frist entfernt wurden. */
  begruessungenEntfernt: number;
  bereinigt: number;
}

/** Hoechstens so viele Vorgaenge je Durchgang - der Rest folgt im naechsten. */
const JE_DURCHGANG = 50;

/**
 * Wie oft die Aufbewahrung tatsaechlich geprueft wird.
 *
 * Der Durchgang laeuft im Minutentakt, weil eine faellige Erinnerung zuegig
 * rausgehen soll. Die Aufbewahrung rechnet in Tagen; sie jede Minute zu
 * pruefen waere eine Abfrage, die neunundfuenfzig Mal nichts findet. Ein
 * Richtwert, keine Zusage: nach einem Neustart laeuft sie einmal zusaetzlich,
 * und das ist folgenlos.
 */
const AUFBEWAHRUNG_ABSTAND_MS = 3600_000;
let aufbewahrungZuletzt = 0;

export async function runVerificationTick(
  now = new Date(),
  gateway: DiscordGateway = defaultDiscord,
): Promise<VerificationTickResult> {
  const settings = await verificationSettings();
  let erinnert = 0;
  let beendet = 0;

  /*
   * Faellige Erinnerungen.
   *
   * Auch dann abgefragt, wenn die Erinnerungen abgeschaltet sind: die
   * offenen Termine sollen in dem Fall aufgeraeumt und nicht bloss
   * ignoriert werden, sonst prasselten sie beim Wiedereinschalten auf einen
   * Schlag los. `sendeErinnerung` beendet sie dann einzeln und sauber.
   *
   * Nur `WAITING_FOR_MESSAGE`: wer geschrieben hat, wartet auf die
   * Moderation und nicht auf einen Anstupser.
   */
  const faellig = await prisma.verificationRequest.findMany({
    where: {
      status: 'WAITING_FOR_MESSAGE',
      decidedAt: null,
      nextReminderAt: { lte: now },
    },
    select: { id: true },
    orderBy: { nextReminderAt: 'asc' },
    take: JE_DURCHGANG,
  });

  for (const eintrag of faellig) {
    const ergebnis = await sendeErinnerung(eintrag.id, settings, { gateway, jetzt: now }).catch(
      (error: unknown) => {
        // Ein einzelner Vorgang darf den Durchgang nicht anhalten - sonst
        // bliebe der Rest der Warteschlange stehen.
        logger.warn('verification.reminder.failed', { requestId: eintrag.id, error });
        return null;
      },
    );
    if (!ergebnis) {
      continue;
    }
    if (ergebnis.gesendet) {
      erinnert += 1;
    }
    if (ergebnis.ende) {
      beendet += 1;
    }
  }

  /*
   * Faellige Begruessungen.
   *
   * Unabhaengig von den Erinnerungen und unabhaengig vom Zustand des
   * Vorgangs: geloescht wird eine Nachricht, deren Frist abgelaufen ist, und
   * sonst geschieht nichts. Der Vorgang bleibt offen, die Rolle bleibt, die
   * Person bleibt. Ist das Auto-Delete abgeschaltet, gibt es schlicht keine
   * Zeile mit einem Termin - die Abfrage kostet dann nichts und findet nichts.
   */
  const frist = await loescheFaelligeBegruessungen(now, gateway).catch((error: unknown) => {
    logger.warn('verification.greeting.auto_delete_round_failed', { error });
    return { geloescht: 0, schonWeg: 0, fehlgeschlagen: 0 };
  });
  const begruessungenEntfernt = frist.geloescht;

  const bereinigt = await raeumeAlteTexte(now, settings.retentionDays);

  if (erinnert > 0 || beendet > 0 || begruessungenEntfernt > 0 || bereinigt > 0) {
    logger.info('Verifikation fortgeschrieben', {
      erinnert,
      beendet,
      begruessungenEntfernt,
      bereinigt,
    });
  }
  return { erinnert, beendet, begruessungenEntfernt, bereinigt };
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
