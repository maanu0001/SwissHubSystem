import { AUDIT_ACTIONS, prisma, recordAudit } from '@swisshub/database';
import type { EmojiAntrag } from '@swisshub/database';
import { AppError } from '@swisshub/shared';
import { createLogger } from '@swisshub/logger';
import { getModuleSettings, isModuleEnabled } from '../module-state';
import { EMOJI_MODULE_ID, type EmojiSettings } from './config';
import { legeBeanspruchtenAntragAb } from './antrag';

const log = createLogger('emoji:abstimmung');

/**
 * Die Community-Abstimmung.
 *
 * ## Die Frist ist eine Spalte, kein Timer
 *
 * `abstimmungEndetAm` steht in der Datenbank. Ein `setTimeout` auf zehn Minuten
 * wäre nach einem Neustart weg - und eine Abstimmung, die nie endet, bleibt
 * ewig offen, ohne dass jemand merkt, warum. Der Scheduler-Job
 * `emoji-abstimmung` schaut nach, was abgelaufen ist; die Datenbank ist die
 * Wahrheit, nicht der Prozess.
 *
 * Die Frist wird ausserdem **bei jeder Stimme** geprüft. Zwischen dem Ablauf
 * und dem nächsten Durchgang des Jobs liegen Sekunden, und in denen soll keine
 * Stimme mehr zählen.
 *
 * ## Warum die zehnte Stimme eine Zeilensperre braucht
 *
 * Die naheliegende Umsetzung - Stimme einfügen, zählen, bei zehn annehmen -
 * ist unter `READ COMMITTED` falsch. Zwei Leute klicken gleichzeitig: beide
 * fügen ein, beide zählen, und keiner sieht die noch nicht festgeschriebene
 * Stimme des anderen. Beide sehen neun. Das Ziel wird erreicht und löst nichts
 * aus - der Vorschlag bleibt mit zehn Stimmen offen stehen, und niemand findet
 * den Grund, weil beim nächsten Versuch alles richtig aussieht.
 *
 * Deshalb sperrt jede Stimme zuerst die Antragszeile (`SELECT … FOR UPDATE`).
 * Alle Stimmen **zu demselben Vorschlag** laufen damit hintereinander; Stimmen
 * zu verschiedenen Vorschlägen stören sich nicht. Innerhalb der Sperre sind
 * Einfügen, Zählen und der Statuswechsel ein Vorgang.
 *
 * Der Statuswechsel selbst ist zusätzlich bedingt (`where: { status:
 * 'ABSTIMMUNG' }`): auch wenn ein Moderator in derselben Sekunde «Annehmen»
 * drückt, gewinnt genau einer, und nur der lädt hoch.
 *
 * ## Der Upload liegt ausserhalb der Transaktion
 *
 * Ein Discord-Aufruf in einer offenen Transaktion hält eine Zeilensperre, so
 * lange das Netz braucht - bei einem Rate-Limit sind das Sekunden, in denen
 * niemand sonst abstimmen kann. Die Transaktion beansprucht, der Aufruf danach
 * führt aus.
 */

export type StimmArt =
  | 'gezaehlt'
  | 'ziel_erreicht'
  | 'schon_gestimmt'
  | 'nicht_offen'
  | 'abgelaufen'
  | 'ausgeschaltet';

export interface StimmErgebnis {
  art: StimmArt;
  stimmen: number;
  ziel: number;
  /** Gesetzt, wenn diese Stimme den Vorschlag angenommen hat. */
  emojiId?: string;
  /** Warum der Upload nach der letzten Stimme nicht klappte. */
  grund?: string;
}

async function settingsOderFehler(): Promise<EmojiSettings> {
  if (!(await isModuleEnabled(EMOJI_MODULE_ID))) {
    throw new AppError('CONFLICT', { userMessage: 'Das Emoji-Modul ist derzeit ausgeschaltet.' });
  }
  return getModuleSettings<EmojiSettings>(EMOJI_MODULE_ID);
}

/**
 * Einen Vorschlag der Community vorlegen.
 *
 * Ziel und Frist werden **in den Vorschlag geschrieben** und nicht bei jeder
 * Stimme aus den Einstellungen gelesen: wer mitten in einer Abstimmung das
 * Ziel von zehn auf fünfzig stellt, soll die laufende nicht rückwirkend
 * verändern. Die Regeln einer Abstimmung stehen fest, sobald sie beginnt.
 */
export async function starteAbstimmung(
  antragId: string,
  akteurDiscordId: string,
): Promise<{ ok: boolean; grund?: string; antrag?: EmojiAntrag }> {
  const settings = await settingsOderFehler();
  if (!settings.abstimmungAktiv) {
    return { ok: false, grund: 'Die Community-Abstimmung ist ausgeschaltet.' };
  }

  const vorhanden = await prisma.emojiAntrag.findUnique({ where: { id: antragId } });
  if (!vorhanden) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diesen Vorschlag gibt es nicht.' });
  }

  const jetzt = new Date();
  const beansprucht = await prisma.emojiAntrag.updateMany({
    where: { id: antragId, status: 'OFFEN' },
    data: {
      status: 'ABSTIMMUNG',
      abstimmungStartetAm: jetzt,
      abstimmungEndetAm: new Date(jetzt.getTime() + settings.abstimmungMinuten * 60_000),
      stimmenZiel: settings.stimmenZiel,
    },
  });
  if (beansprucht.count !== 1) {
    return { ok: false, grund: 'Dieser Vorschlag ist nicht mehr offen.' };
  }

  const antrag = await prisma.emojiAntrag.findUniqueOrThrow({ where: { id: antragId } });
  await recordAudit({
    action: AUDIT_ACTIONS.EMOJI_VOTE_STARTED,
    module: EMOJI_MODULE_ID,
    actorDiscordId: akteurDiscordId,
    targetLabel: antrag.name,
    success: true,
    metadata: {
      antragId,
      stimmenZiel: antrag.stimmenZiel,
      endetAm: antrag.abstimmungEndetAm?.toISOString() ?? null,
    },
  });

  return { ok: true, antrag };
}

/**
 * Eine Stimme abgeben.
 *
 * Die Rückgabe sagt, was geschehen ist, und wirft nicht: «du hast schon
 * gestimmt» ist eine Antwort. Ein Knopf, der eine rote Störung erzeugt, weil
 * jemand zweimal geklickt hat, verliert das Vertrauen in alle anderen
 * Meldungen.
 */
export async function stimmeAb(antragId: string, discordId: string): Promise<StimmErgebnis> {
  const settings = await settingsOderFehler();
  if (!settings.abstimmungAktiv) {
    return { art: 'ausgeschaltet', stimmen: 0, ziel: settings.stimmenZiel };
  }

  const ergebnis = await prisma.$transaction(async (tx) => {
    /*
     * Die Zeilensperre.
     *
     * Sie ist der Grund, warum dieser Block eine Transaktion ist. Ohne sie
     * zählen zwei gleichzeitige Stimmen beide zu wenig - siehe oben.
     */
    await tx.$queryRaw`SELECT "id" FROM "EmojiAntrag" WHERE "id" = ${antragId} FOR UPDATE`;

    const antrag = await tx.emojiAntrag.findUnique({ where: { id: antragId } });
    if (!antrag) {
      return { art: 'nicht_offen' as StimmArt, stimmen: 0, ziel: settings.stimmenZiel };
    }
    const ziel = antrag.stimmenZiel ?? settings.stimmenZiel;

    if (antrag.status !== 'ABSTIMMUNG') {
      const stimmen = await tx.emojiStimme.count({ where: { antragId } });
      return { art: 'nicht_offen' as StimmArt, stimmen, ziel };
    }
    if (antrag.abstimmungEndetAm && antrag.abstimmungEndetAm.getTime() <= Date.now()) {
      // Die Frist ist um, der Job war noch nicht da. Diese Stimme zählt nicht.
      const stimmen = await tx.emojiStimme.count({ where: { antragId } });
      return { art: 'abgelaufen' as StimmArt, stimmen, ziel };
    }

    const schonGestimmt = await tx.emojiStimme.findUnique({
      where: { antragId_discordId: { antragId, discordId } },
    });
    if (schonGestimmt) {
      const stimmen = await tx.emojiStimme.count({ where: { antragId } });
      return { art: 'schon_gestimmt' as StimmArt, stimmen, ziel };
    }

    await tx.emojiStimme.create({ data: { antragId, discordId } });
    const stimmen = await tx.emojiStimme.count({ where: { antragId } });

    if (stimmen < ziel) {
      return { art: 'gezaehlt' as StimmArt, stimmen, ziel };
    }

    /*
     * Das Ziel ist erreicht - und genau einer darf es erreichen.
     *
     * Die Bedingung auf `status` fängt den Moderator ab, der in derselben
     * Sekunde «Annehmen» drückt: er oder diese Stimme gewinnt, nie beide.
     */
    const beansprucht = await tx.emojiAntrag.updateMany({
      where: { id: antragId, status: 'ABSTIMMUNG' },
      data: { status: 'ANGENOMMEN', entschiedenAm: new Date() },
    });
    return {
      art: (beansprucht.count === 1 ? 'ziel_erreicht' : 'nicht_offen') as StimmArt,
      stimmen,
      ziel,
    };
  });

  if (ergebnis.art !== 'ziel_erreicht') {
    return ergebnis;
  }

  /*
   * Erst jetzt zu Discord.
   *
   * Der Handelnde ist die Abstimmung und nicht die Person, die zufällig die
   * letzte Stimme gegeben hat - deshalb steht im Audit-Eintrag der
   * Antragsteller als Ziel und `discordId` nur als Auslöser.
   */
  const abgelegt = await legeBeanspruchtenAntragAb(antragId, discordId, 'ABSTIMMUNG');
  if (!abgelegt.ok) {
    log.warn('Abstimmung erreicht, Upload gescheitert', { antragId, grund: abgelegt.grund });
    return { ...ergebnis, art: 'ziel_erreicht', ...(abgelegt.grund ? { grund: abgelegt.grund } : {}) };
  }
  return { ...ergebnis, ...(abgelegt.emojiId ? { emojiId: abgelegt.emojiId } : {}) };
}

export interface AbstimmungsStand {
  antragId: string;
  stimmen: number;
  ziel: number;
  endetAm: Date | null;
  laeuft: boolean;
}

/** Der Stand einer Abstimmung - für die Anzeige, ohne etwas zu verändern. */
export async function abstimmungsStand(antragId: string): Promise<AbstimmungsStand | null> {
  const [antrag, stimmen] = await Promise.all([
    prisma.emojiAntrag.findUnique({ where: { id: antragId } }),
    prisma.emojiStimme.count({ where: { antragId } }),
  ]);
  if (!antrag) {
    return null;
  }
  const settings = await getModuleSettings<EmojiSettings>(EMOJI_MODULE_ID);
  return {
    antragId,
    stimmen,
    ziel: antrag.stimmenZiel ?? settings.stimmenZiel,
    endetAm: antrag.abstimmungEndetAm,
    laeuft:
      antrag.status === 'ABSTIMMUNG' &&
      (!antrag.abstimmungEndetAm || antrag.abstimmungEndetAm.getTime() > Date.now()),
  };
}

export interface AblaufBericht {
  geprueft: number;
  abgelaufen: number;
  /** Abstimmungen, die beim Nachsehen schon ihr Ziel hatten. */
  nachtraeglichAngenommen: number;
}

/**
 * Abgelaufene Abstimmungen beenden.
 *
 * Der Job hinter dieser Funktion läuft im bestehenden Scheduler des Bots -
 * kein eigener Wecker, keine Schleife mit `setTimeout`. Die Datenbank ist die
 * Quelle: ein Neustart verliert keine laufende Abstimmung, und ein verpasster
 * Durchgang holt beim nächsten alles nach.
 *
 * ## Warum hier noch einmal gezählt wird
 *
 * Weil der seltene Fall sonst falsch endete: die letzte Stimme kam an, der
 * Upload scheiterte an einem Discord-Ausfall, der Vorschlag ging zurück auf
 * `OFFEN` - und steht jetzt mit erreichtem Ziel da. Ihn als «abgelaufen» zu
 * schliessen wäre die falsche Auskunft. Erreicht das Ziel, wird er angenommen.
 */
export async function lasseAbstimmungenAblaufen(): Promise<AblaufBericht> {
  if (!(await isModuleEnabled(EMOJI_MODULE_ID))) {
    return { geprueft: 0, abgelaufen: 0, nachtraeglichAngenommen: 0 };
  }

  const faellig = await prisma.emojiAntrag.findMany({
    where: { status: 'ABSTIMMUNG', abstimmungEndetAm: { lte: new Date() } },
    select: { id: true, name: true, stimmenZiel: true, antragstellerId: true },
  });

  let abgelaufen = 0;
  let nachtraeglichAngenommen = 0;

  for (const antrag of faellig) {
    const stimmen = await prisma.emojiStimme.count({ where: { antragId: antrag.id } });
    const ziel = antrag.stimmenZiel ?? 10;

    if (stimmen >= ziel) {
      const beansprucht = await prisma.emojiAntrag.updateMany({
        where: { id: antrag.id, status: 'ABSTIMMUNG' },
        data: { status: 'ANGENOMMEN', entschiedenAm: new Date() },
      });
      if (beansprucht.count === 1) {
        // Handelnder ist das System: niemand hat geklickt.
        const abgelegt = await legeBeanspruchtenAntragAb(antrag.id, 'system', 'ABSTIMMUNG');
        if (abgelegt.ok) {
          nachtraeglichAngenommen += 1;
          continue;
        }
        log.warn('Nachträgliche Annahme gescheitert', { antragId: antrag.id, grund: abgelegt.grund });
      }
      continue;
    }

    const beendet = await prisma.emojiAntrag.updateMany({
      where: { id: antrag.id, status: 'ABSTIMMUNG' },
      data: { status: 'ABGELAUFEN', entschiedenAm: new Date() },
    });
    if (beendet.count !== 1) {
      continue;
    }
    abgelaufen += 1;

    await recordAudit({
      action: AUDIT_ACTIONS.EMOJI_VOTE_EXPIRED,
      module: EMOJI_MODULE_ID,
      actorDiscordId: null,
      targetDiscordId: antrag.antragstellerId,
      targetLabel: antrag.name,
      success: true,
      /*
       * «Abgelaufen» ist keine Ablehnung.
       *
       * Die Zahlen stehen im Eintrag, damit das Team sehen kann, ob das Ziel
       * knapp verfehlt wurde - dann ist die Antwort vielleicht, das Ziel zu
       * senken, und nicht den Vorschlag zu begraben.
       */
      metadata: { antragId: antrag.id, stimmen, ziel },
    });
  }

  if (abgelaufen > 0 || nachtraeglichAngenommen > 0) {
    log.info('Abstimmungen abgeschlossen', { abgelaufen, nachtraeglichAngenommen });
  }
  return { geprueft: faellig.length, abgelaufen, nachtraeglichAngenommen };
}
