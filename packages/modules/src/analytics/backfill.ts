import { prisma } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { tag, stunde, tagesBeginn } from './zeit';
import { intern } from './zaehler';

const log = createLogger('analytics:backfill');

/**
 * Aggregate aus dem vorhandenen Ereignisprotokoll nachziehen.
 *
 * Was hier geht und was nicht, ist der wichtigste Teil:
 *
 * - **Beitritte und Austritte** stehen im Protokoll und lassen sich
 *   vollstaendig nachziehen.
 * - **Sprachzeit** laesst sich aus Betreten, Verlassen und Verschieben
 *   rekonstruieren - die Ereignisse tragen ihren Zeitpunkt.
 * - **Nachrichten nicht.** Eine geschriebene Nachricht war nie ein Ereignis;
 *   aufgezeichnet wurde nur Bearbeitung und Loeschung. Was nie erfasst wurde,
 *   laesst sich nicht nachtraeglich zaehlen, und eine Hochrechnung waere eine
 *   erfundene Vergangenheit.
 *
 * Der Lauf ist **wiederholbar**: er raeumt den bearbeiteten Bereich vorher
 * aus und schreibt ihn neu. Zweimal laufen lassen ergibt dieselben Zahlen,
 * nicht die doppelten.
 *
 * Er ist **fortsetzbar**: `backfilledUntil` haelt fest, wie weit er gekommen
 * ist, und ein Abbruch verliert hoechstens den letzten Stapel.
 *
 * ## Er endet, wo die Live-Aufzeichnung beginnt
 *
 * Das Wichtigste an diesem Lauf, und es fehlte:
 *
 * Wiederholbar ist er, weil er den bearbeiteten Bereich vorher **ausraeumt**
 * und neu schreibt. Das geht nur, solange dort ausschliesslich seine eigenen
 * Zahlen stehen. Greift er in einen Zeitraum, den die laufende Aufzeichnung
 * bereits gefuellt hat, loescht er deren Zahlen - und ersetzen kann er sie
 * nicht, denn im Ereignisprotokoll steht nur ein Bruchteil davon.
 *
 * Genau das geschah: der Job rief ihn alle fuenf Minuten mit `bis = jetzt`.
 * Ausgeraeumt wurde tageweise, nachgezogen nur das Fenster der letzten fuenf
 * Minuten. Damit stand die **gesamte Sprachzeit des Tages** alle fuenf
 * Minuten wieder auf null, und die laufenden Abschnitte waren geloescht.
 * Nachrichten blieben stehen - die werden hier nie angetastet -, und so sah
 * es aus, als wuerde nur die Sprachzeit nicht aufgezeichnet.
 *
 * Deshalb: der Lauf bearbeitet **nur Tage, die vor dem Beginn der
 * Live-Aufzeichnung abgeschlossen waren**. Danach gehoert der Zeitraum der
 * laufenden Aufzeichnung, und hier wird nichts mehr angefasst. Der
 * angebrochene Tag, an dem die Aufzeichnung begann, bleibt aussen vor - dort
 * stehen ohnehin die gemessenen Zahlen, und die sind besser als jede
 * Rekonstruktion.
 */

export interface BackfillErgebnis {
  ereignisse: number;
  beitritte: number;
  austritte: number;
  sprachAbschnitte: number;
  sprachSekunden: number;
  /** Nachrichten koennen nicht nachgezogen werden - hier steht, warum. */
  hinweis: string;
}

const STAPEL = 2000;

/**
 * Praefix der Sitzungskennungen, die dieser Lauf vergibt.
 *
 * Daran - und nur daran - ist ein rekonstruierter Abschnitt von einem
 * gemessenen zu unterscheiden.
 */
const BACKFILL_SITZUNG = 'backfill-';

/**
 * Ab wann die laufende Aufzeichnung zaehlt - oder `null`, wenn noch nie.
 *
 * `voiceSince`, `messagesSince` und `membersSince` werden beim allerersten
 * gemessenen Wert ihrer Art gesetzt und wandern danach nicht mehr. Der
 * fruehste der drei ist der Punkt, ab dem in den Aggregaten gemessene Zahlen
 * stehen.
 *
 * Alle drei, nicht nur einer: der Backfill raeumt Sprachzeit **und**
 * Mitgliederzahlen. Fehlte hier eine Art, raeumte er genau die weg, deren
 * Marke fehlt - auf einem Server, auf dem noch niemand geschrieben hat,
 * waeren das die Beitritte.
 */
function liveBeginn(
  stand: { voiceSince: Date | null; messagesSince: Date | null; membersSince: Date | null } | null,
): Date | null {
  const marken = [stand?.voiceSince, stand?.messagesSince, stand?.membersSince].filter((wert): wert is Date =>
    Boolean(wert),
  );
  if (marken.length === 0) {
    return null;
  }
  return marken.reduce((frueheste, wert) => (wert < frueheste ? wert : frueheste));
}

export async function backfill(
  guildId: string,
  optionen: { bis?: Date; maxStapel?: number } = {},
): Promise<BackfillErgebnis> {
  const stand = await prisma.analyticsTracking.findUnique({ where: { guildId } });
  const von = stand?.backfilledUntil ?? new Date(0);

  /*
   * Die Obergrenze: der Beginn des Tages, an dem die Live-Aufzeichnung
   * einsetzte. Alles davor ist abgeschlossene Vergangenheit und gehoert
   * diesem Lauf; alles danach gehoert der Aufzeichnung.
   */
  const gewuenscht = optionen.bis ?? new Date();
  const grenze = liveBeginn(stand);
  const bis = grenze ? new Date(Math.min(gewuenscht.getTime(), tagesBeginn(grenze).getTime())) : gewuenscht;

  const ergebnis: BackfillErgebnis = {
    ereignisse: 0,
    beitritte: 0,
    austritte: 0,
    sprachAbschnitte: 0,
    sprachSekunden: 0,
    hinweis:
      'Nachrichten lassen sich nicht nachziehen: eine geschriebene Nachricht war vor dieser Erweiterung kein Ereignis. Gezählt wird ab jetzt.',
  };

  /*
   * Nichts mehr nachzuziehen - und das heisst vor allem: nichts anfassen.
   *
   * Dieser Ausstieg steht **vor** dem Ausraeumen. Stuende er dahinter, waere
   * er wirkungslos: das Ausraeumen ist der Schaden, nicht das Nachziehen.
   */
  if (bis <= von) {
    return ergebnis;
  }

  // Bereits nachgezogene Werte im Zielbereich verwerfen, damit ein zweiter
  // Lauf nicht addiert. Die Zeilen entstehen neu.
  await raeumeAuf(guildId, von, bis);

  let cursor: string | undefined;
  const maxStapel = optionen.maxStapel ?? 500;

  for (let runde = 0; runde < maxStapel; runde += 1) {
    const zeilen = await prisma.discordEvent.findMany({
      where: {
        guildId,
        occurredAt: { gt: von, lte: bis },
        type: { in: ['MEMBER_JOIN', 'MEMBER_LEAVE', 'VOICE_JOIN', 'VOICE_LEAVE', 'VOICE_MOVE'] },
      },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      take: STAPEL,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    if (zeilen.length === 0) {
      break;
    }

    for (const zeile of zeilen) {
      ergebnis.ereignisse += 1;
      if (zeile.type === 'MEMBER_JOIN') {
        await nachziehenMitglied(guildId, zeile.subjectDiscordId, zeile.occurredAt, 'joins');
        ergebnis.beitritte += 1;
      } else if (zeile.type === 'MEMBER_LEAVE') {
        await nachziehenMitglied(guildId, zeile.subjectDiscordId, zeile.occurredAt, 'leaves');
        ergebnis.austritte += 1;
      }
    }

    cursor = zeilen.at(-1)?.id;
    // Fortschritt festhalten - ein Abbruch verliert hoechstens diesen Stapel.
    await prisma.analyticsTracking.upsert({
      where: { guildId },
      create: {
        guildId,
        startedAt: zeilen[0]?.occurredAt ?? bis,
        backfilledUntil: zeilen.at(-1)?.occurredAt,
      },
      update: { backfilledUntil: zeilen.at(-1)?.occurredAt },
    });

    if (zeilen.length < STAPEL) {
      break;
    }
  }

  const sprache = await sprachzeitNachziehen(guildId, von, bis);
  ergebnis.sprachAbschnitte = sprache.abschnitte;
  ergebnis.sprachSekunden = sprache.sekunden;

  await prisma.analyticsTracking.upsert({
    where: { guildId },
    create: { guildId, startedAt: bis, backfilledUntil: bis },
    update: { backfilledUntil: bis },
  });

  log.info('Backfill abgeschlossen', { ...ergebnis, hinweis: undefined });
  return ergebnis;
}

/**
 * Verwirft, was ein frueherer Lauf im selben Bereich geschrieben hat.
 *
 * Zwei Grenzen, und beide sind hier der ganze Punkt:
 *
 * 1. **`bis` ist ausschliessend.** Geraeumt wird bis zur letzten Sekunde
 *    davor. `bis` ist der Beginn des Tages, an dem die Aufzeichnung einsetzte
 *    - wuerde dieser Tag mitgeraeumt, waeren genau die gemessenen Zahlen weg,
 *    um die es geht.
 * 2. **Nur eigene Abschnitte.** Ein Sprachabschnitt aus dem laufenden Betrieb
 *    ist eine Messung; dieser Lauf hat ihn nicht geschrieben und loescht ihn
 *    nicht. Erkennbar ist das an der Sitzungskennung, die `sprachzeitNachziehen`
 *    vergibt. Ein offener Abschnitt gehoert ohnehin immer der Aufzeichnung.
 */
async function raeumeAuf(guildId: string, von: Date, bis: Date): Promise<void> {
  // Die letzte Sekunde vor `bis` - der Tag und die Stunde, in die `bis`
  // selbst faellt, bleiben unberuehrt.
  const letzte = new Date(bis.getTime() - 1);
  if (letzte < von) {
    return;
  }

  // Nur die nachziehbaren Groessen zuruecksetzen. Nachrichtenzahlen stammen
  // aus dem laufenden Betrieb und duerfen nicht angetastet werden.
  await prisma.analyticsDaily.updateMany({
    where: { guildId, day: { gte: tag(von), lte: tag(letzte) } },
    data: { joins: 0, leaves: 0, voiceSeconds: 0, voiceSessions: 0 },
  });
  await prisma.analyticsHourly.updateMany({
    where: { guildId, hourStart: { gte: stunde(von), lte: stunde(letzte) } },
    data: { joins: 0, leaves: 0, voiceSeconds: 0, voiceSessions: 0 },
  });
  await prisma.analyticsUserDaily.updateMany({
    where: { guildId, day: { gte: tag(von), lte: tag(letzte) } },
    data: { voiceSeconds: 0, voiceSessions: 0 },
  });
  await prisma.analyticsChannelDaily.updateMany({
    where: { guildId, kind: 'VOICE', day: { gte: tag(von), lte: tag(letzte) } },
    data: { voiceSeconds: 0 },
  });
  await prisma.analyticsVoiceSegment.deleteMany({
    where: {
      guildId,
      joinedAt: { gte: von, lte: letzte },
      sessionId: { startsWith: BACKFILL_SITZUNG },
      leftAt: { not: null },
    },
  });
}

async function nachziehenMitglied(
  guildId: string,
  discordId: string | null,
  at: Date,
  feld: 'joins' | 'leaves',
): Promise<void> {
  const tagesWert = tag(at);
  const stundenWert = stunde(at);

  await Promise.all([
    prisma.analyticsHourly.upsert({
      where: { guildId_hourStart: { guildId, hourStart: stundenWert } },
      create: { guildId, hourStart: stundenWert, [feld]: 1 },
      update: { [feld]: { increment: 1 } },
    }),
    prisma.analyticsDaily.upsert({
      where: { guildId_day: { guildId, day: tagesWert } },
      create: { guildId, day: tagesWert, [feld]: 1 },
      update: { [feld]: { increment: 1 } },
    }),
  ]);

  if (!discordId) {
    return;
  }
  await prisma.analyticsMemberProfile
    .upsert({
      where: { guildId_discordId: { guildId, discordId } },
      create: {
        guildId,
        discordId,
        ...(feld === 'joins' ? { joinedAt: at } : { leftAt: at }),
      },
      update: feld === 'joins' ? { joinedAt: at, leftAt: null } : { leftAt: at },
    })
    .catch(() => undefined);
}

/**
 * Sprachabschnitte aus den Ereignissen rekonstruieren.
 *
 * Je Person werden die Ereignisse der Reihe nach durchgegangen: Betreten
 * oeffnet einen Abschnitt, Verschieben schliesst ihn und oeffnet den
 * naechsten unter derselben Sitzung, Verlassen schliesst ihn.
 *
 * Ein Abschnitt ohne Ende - der Bot war weg, als die Person ging - wird
 * **verworfen** und nicht geschaetzt. Lieber eine fehlende Sitzung als eine
 * erfundene Dauer.
 */
async function sprachzeitNachziehen(
  guildId: string,
  von: Date,
  bis: Date,
): Promise<{ abschnitte: number; sekunden: number }> {
  const ereignisse = await prisma.discordEvent.findMany({
    where: {
      guildId,
      occurredAt: { gt: von, lte: bis },
      type: { in: ['VOICE_JOIN', 'VOICE_LEAVE', 'VOICE_MOVE'] },
    },
    orderBy: [{ subjectDiscordId: 'asc' }, { occurredAt: 'asc' }],
    select: {
      subjectDiscordId: true,
      type: true,
      channelId: true,
      channelName: true,
      occurredAt: true,
      metadata: true,
    },
    // Obergrenze gegen einen Lauf, der den Speicher sprengt. Wer mehr
    // Ereignisse hat, laesst den Backfill in mehreren Zeitfenstern laufen.
    take: 200_000,
  });

  let abschnitte = 0;
  let sekunden = 0;
  let offen: { channelId: string; channelName: string | null; von: Date } | null = null;
  let letztePerson: string | null = null;

  const schliessen = async (person: string, ende: Date): Promise<void> => {
    if (!offen || ende <= offen.von) {
      offen = null;
      return;
    }
    const dauer = Math.round((ende.getTime() - offen.von.getTime()) / 1000);
    await prisma.analyticsVoiceSegment.create({
      data: {
        guildId,
        sessionId: `${BACKFILL_SITZUNG}${person}-${offen.von.getTime()}`,
        discordId: person,
        channelId: offen.channelId,
        channelName: offen.channelName,
        joinedAt: offen.von,
        leftAt: ende,
        seconds: dauer,
      },
    });
    await intern.verbucheSprachSekunden({
      guildId,
      discordId: person,
      channelId: offen.channelId,
      channelName: offen.channelName,
      parentId: null,
      von: offen.von,
      bis: ende,
    });
    abschnitte += 1;
    sekunden += dauer;
    offen = null;
  };

  for (const ereignis of ereignisse) {
    const person = ereignis.subjectDiscordId;
    if (!person) {
      continue;
    }
    if (person !== letztePerson) {
      // Personenwechsel: ein noch offener Abschnitt der vorigen Person hat
      // kein Ende im Protokoll und wird verworfen.
      offen = null;
      letztePerson = person;
    }

    if (ereignis.type === 'VOICE_JOIN') {
      offen = {
        channelId: ereignis.channelId ?? 'unbekannt',
        channelName: ereignis.channelName,
        von: ereignis.occurredAt,
      };
      continue;
    }
    if (ereignis.type === 'VOICE_MOVE') {
      await schliessen(person, ereignis.occurredAt);
      offen = {
        channelId: ereignis.channelId ?? 'unbekannt',
        channelName: ereignis.channelName,
        von: ereignis.occurredAt,
      };
      continue;
    }
    await schliessen(person, ereignis.occurredAt);
  }

  return { abschnitte, sekunden };
}
