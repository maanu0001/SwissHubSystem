import { prisma } from '@swisshub/database';
import { getModuleSettings } from '../module-state';
import { ANALYTICS_MODULE_ID, type AnalyticsSettings } from './config';
import {
  laufendeSprachzeit,
  leereSprachzeit,
  sprachzeitFenster,
  type LaufendeSprachzeit,
} from './sprachzeit';
import { tag, tagesBeginn, tagesSchluessel, zuercherTeile } from './zeit';
import { tageZwischen, vergleiche, type Veraenderung, type Zeitraum } from './zeitraum';
import { trackingStand } from './zaehler';

/**
 * Die Statistik.
 *
 * Die Zahlen kommen aus den Aggregaten - nie aus der Ereignistabelle. Das ist
 * der Grund, warum die Seite auch bei zehn Millionen Ereignissen in
 * Sekundenbruchteilen antwortet: die teure Arbeit ist beim Aufzeichnen schon
 * geschehen.
 *
 * **Mit einer Ausnahme, und die ist Absicht: die Sprachzeit.** Ein Aggregat
 * bekommt seine Sekunden erst, wenn ein Abschnitt endet. Wer seit
 * anderthalb Stunden im Sprachkanal sitzt, stuende darin mit null - und
 * genau so sah die Statistik bis hierher aus. Zu jeder Sprachzahl kommt
 * deshalb der laufende Anteil dazu, gerechnet aus `joinedAt` gegen die
 * Serverzeit. Beides zusammen ist der Stand von jetzt.
 *
 * Doppelt gezaehlt werden kann dabei nichts: `schliesseOffene` setzt `leftAt`
 * und verbucht die Sekunden in derselben Aktualisierung. Ein Abschnitt ist
 * entweder offen oder im Aggregat, nie in beidem.
 *
 * Die zweite Ausnahme von «einfach summieren» sind die aktiven Mitglieder.
 * Eindeutige Personen ueber einen Monat sind **nicht** die Summe der
 * Tageswerte - wer an zwanzig Tagen schreibt, ist eine Person und nicht
 * zwanzig. Dafuer gibt es die Zeile je Person und Tag, und dafuer steht hier
 * ueberall `distinct` statt `sum`.
 */

/** Wann gilt jemand als aktiv - einmal definiert, nirgends neu erfunden. */
const AKTIV_BEDINGUNG = { OR: [{ messages: { gt: 0 } }, { voiceSeconds: { gt: 0 } }] };

export interface StatistikScope {
  guildId: string;
  zeitraum: Zeitraum;
  /** Bots mitzaehlen. Standard: nein. */
  mitBots?: boolean;
  /**
   * Die Serverzeit, gegen die laufende Sitzungen gerechnet werden.
   *
   * Nur fuer Tests gedacht. Im Betrieb ist es «jetzt», und zwar die Uhr des
   * Servers - nicht die des Browsers, sonst verschoebe eine falsch gestellte
   * Uhr am anderen Ende die Statistik.
   */
  jetzt?: Date;
}

async function botFilter(mitBots: boolean | undefined, guildId: string): Promise<string[]> {
  if (mitBots) {
    return [];
  }
  const bots = await prisma.analyticsMemberProfile.findMany({
    where: { guildId, isBot: true },
    select: { discordId: true },
  });
  return bots.map((eintrag) => eintrag.discordId);
}

// --- Kennzahlen -------------------------------------------------------------

export interface Kennzahlen {
  mitglieder: number | null;
  nachrichten: Veraenderung;
  sprachSekunden: Veraenderung;
  neueMitglieder: Veraenderung;
  austritte: Veraenderung;
  nettoWachstum: Veraenderung;
  aktiveMitglieder: Veraenderung;
  /** Anteil aktiver an allen Mitgliedern. `null` ohne bekannte Mitgliederzahl. */
  aktivenAnteil: number | null;
  sprachSitzungen: Veraenderung;
  /** Durchschnitte im gewaehlten Zeitraum. */
  nachrichtenProAktivem: number | null;
  sprachSekundenProAktivem: number | null;
  nachrichtenProTag: number | null;
  sprachSekundenProTag: number | null;
  /** Verhaeltnis Beitritte zu Austritten - `null` bei zu duenner Grundlage. */
  beitrittsVerhaeltnis: number | null;
  /** Serverzeit, auf die sich der laufende Sprachanteil bezieht. */
  asOf: Date;
  /**
   * Wie viele Sitzungen die Sprachzeit dieses Zeitraums gerade wachsen
   * lassen - je Sitzung eine Sekunde je Sekunde. Die Oberflaeche rechnet
   * damit zwischen zwei Abgleichen weiter.
   */
  wachsend: number;
}

/**
 * Die Summen eines Zeitraums - Aggregate plus laufender Anteil.
 *
 * `laufend` wird hereingereicht und nicht hier geholt: eine Seite fragt
 * mehrere Kennzahlen ab, und die laufende Sprachzeit soll dafuer einmal
 * gelesen werden und nicht fuenfmal. Wer sie nicht braucht - etwa fuer einen
 * Vergleichszeitraum, in dem nichts mehr waechst - laesst sie weg.
 */
async function summen(guildId: string, von: Date, bis: Date, laufend?: LaufendeSprachzeit) {
  const werte = await prisma.analyticsDaily.aggregate({
    where: { guildId, day: { gte: tag(von), lte: tag(bis) } },
    _sum: { messages: true, voiceSeconds: true, voiceSessions: true, joins: true, leaves: true },
  });
  return {
    messages: werte._sum.messages ?? 0,
    voiceSeconds: (werte._sum.voiceSeconds ?? 0) + (laufend?.sekunden ?? 0),
    voiceSessions: werte._sum.voiceSessions ?? 0,
    joins: werte._sum.joins ?? 0,
    leaves: werte._sum.leaves ?? 0,
  };
}

/**
 * Der laufende Anteil eines Zeitraums.
 *
 * Fuer einen Vergleichszeitraum, der in der Vergangenheit endet, liefert
 * dieselbe Rechnung von selbst den richtigen Wert: eine Sitzung, die vor
 * drei Tagen begann und immer noch laeuft, zaehlt dort mit dem Teil, der in
 * den Zeitraum faellt - und nicht mit dem, was seither dazugekommen ist.
 */
async function laufendFuer(scope: StatistikScope, zeitraum: Pick<Zeitraum, 'von' | 'bis'>) {
  return laufendeSprachzeit(scope.guildId, sprachzeitFenster(zeitraum), {
    mitBots: scope.mitBots,
    jetzt: scope.jetzt,
  });
}

/**
 * Eindeutige aktive Mitglieder in einem Zeitraum.
 *
 * `distinct` und nicht `count`: Wer an zwanzig Tagen aktiv war, hat zwanzig
 * Zeilen und ist trotzdem eine Person.
 */
async function aktiveMitglieder(
  guildId: string,
  von: Date,
  bis: Date,
  ausgeschlossen: string[],
  laufend?: LaufendeSprachzeit,
): Promise<number> {
  const zeilen = await prisma.analyticsUserDaily.findMany({
    where: {
      guildId,
      day: { gte: tag(von), lte: tag(bis) },
      ...AKTIV_BEDINGUNG,
      ...(ausgeschlossen.length > 0 ? { discordId: { notIn: ausgeschlossen } } : {}),
    },
    select: { discordId: true },
    distinct: ['discordId'],
  });

  /*
   * Wer gerade spricht, ist aktiv.
   *
   * Sonst stuende auf derselben Seite «Sprachzeit heute: 0.5 h» und «Aktiv
   * heute: 0» - dieselbe Person, zwei Kacheln, und eine davon behauptet, es
   * sei niemand da. Die Bedingung selbst bleibt unveraendert; hier kommt nur
   * dazu, was noch in keinem Aggregat stehen kann.
   */
  const menge = new Set(zeilen.map((zeile) => zeile.discordId));
  for (const discordId of laufend?.mitglieder ?? []) {
    if (!ausgeschlossen.includes(discordId)) {
      menge.add(discordId);
    }
  }
  return menge.size;
}

export async function kennzahlen(scope: StatistikScope): Promise<Kennzahlen> {
  const { guildId, zeitraum } = scope;
  const bots = await botFilter(scope.mitBots, guildId);

  const vergleich =
    zeitraum.vergleichVon && zeitraum.vergleichBis
      ? { von: zeitraum.vergleichVon, bis: zeitraum.vergleichBis }
      : null;

  const [laufend, laufendVorher] = await Promise.all([
    laufendFuer(scope, zeitraum),
    vergleich ? laufendFuer(scope, vergleich) : Promise.resolve(null),
  ]);

  const [jetztWerte, vorherWerte, aktivJetzt, aktivVorher, mitglieder] = await Promise.all([
    summen(guildId, zeitraum.von, zeitraum.bis, laufend),
    vergleich
      ? summen(guildId, vergleich.von, vergleich.bis, laufendVorher ?? undefined)
      : Promise.resolve(null),
    aktiveMitglieder(guildId, zeitraum.von, zeitraum.bis, bots, laufend),
    vergleich
      ? aktiveMitglieder(guildId, vergleich.von, vergleich.bis, bots, laufendVorher ?? undefined)
      : Promise.resolve(null),
    // Die letzte bekannte Mitgliederzahl - eine Momentaufnahme, kein Mittel.
    prisma.analyticsDaily.findFirst({
      where: { guildId, memberCount: { not: null } },
      orderBy: { day: 'desc' },
      select: { memberCount: true },
    }),
  ]);

  const tageImZeitraum = Math.max(
    1,
    Math.round((zeitraum.bis.getTime() - zeitraum.von.getTime()) / 86_400_000),
  );
  const netto = jetztWerte.joins - jetztWerte.leaves;
  const nettoVorher = vorherWerte ? vorherWerte.joins - vorherWerte.leaves : null;

  return {
    mitglieder: mitglieder?.memberCount ?? null,
    nachrichten: vergleiche(jetztWerte.messages, vorherWerte?.messages ?? null),
    sprachSekunden: vergleiche(jetztWerte.voiceSeconds, vorherWerte?.voiceSeconds ?? null),
    neueMitglieder: vergleiche(jetztWerte.joins, vorherWerte?.joins ?? null),
    austritte: vergleiche(jetztWerte.leaves, vorherWerte?.leaves ?? null),
    nettoWachstum: vergleiche(netto, nettoVorher),
    aktiveMitglieder: vergleiche(aktivJetzt, aktivVorher),
    aktivenAnteil:
      mitglieder?.memberCount && mitglieder.memberCount > 0
        ? Math.round((aktivJetzt / mitglieder.memberCount) * 1000) / 10
        : null,
    sprachSitzungen: vergleiche(jetztWerte.voiceSessions, vorherWerte?.voiceSessions ?? null),
    nachrichtenProAktivem: aktivJetzt > 0 ? Math.round(jetztWerte.messages / aktivJetzt) : null,
    sprachSekundenProAktivem: aktivJetzt > 0 ? Math.round(jetztWerte.voiceSeconds / aktivJetzt) : null,
    nachrichtenProTag: Math.round(jetztWerte.messages / tageImZeitraum),
    sprachSekundenProTag: Math.round(jetztWerte.voiceSeconds / tageImZeitraum),
    // Unter zehn Austritten sagt ein Verhaeltnis mehr ueber den Zufall als
    // ueber die Gemeinschaft.
    beitrittsVerhaeltnis:
      jetztWerte.leaves >= 10 ? Math.round((jetztWerte.joins / jetztWerte.leaves) * 10) / 10 : null,
    asOf: laufend.asOf,
    wachsend: laufend.wachsend,
  };
}

// --- Verläufe ---------------------------------------------------------------

export interface VerlaufPunkt {
  /** ISO-Zeitpunkt des Intervallbeginns. */
  zeit: string;
  /** Beschriftung fuer die Achse. */
  label: string;
  nachrichten: number;
  sprachSekunden: number;
  beitritte: number;
  austritte: number;
  mitglieder: number | null;
  aktive: number | null;
}

/**
 * Die Kennzahlen ueber die Zeit.
 *
 * Die Aufloesung richtet sich nach der Laenge des Zeitraums, nicht nach dem,
 * was gerade zur Hand ist: 8760 Stundenpunkte fuer ein Jahr sind nicht
 * genauer, sondern nur mehr.
 */
export async function verlauf(scope: StatistikScope): Promise<VerlaufPunkt[]> {
  const { guildId, zeitraum } = scope;
  const [bots, laufend] = await Promise.all([
    botFilter(scope.mitBots, guildId),
    laufendFuer(scope, zeitraum),
  ]);

  if (zeitraum.granularitaet === 'hour') {
    const zeilen = await prisma.analyticsHourly.findMany({
      where: { guildId, hourStart: { gte: zeitraum.von, lte: zeitraum.bis } },
      orderBy: { hourStart: 'asc' },
    });
    // Die laufende Stunde hat oft noch gar keine Zeile - dann entsteht sie
    // hier, sonst fehlte der letzte Punkt der Kurve.
    const offen = new Map(laufend.jeStunde);
    const punkteJeStunde = zeilen.map((zeile) => {
      const schluessel = zeile.hourStart.getTime();
      const dazu = offen.get(schluessel) ?? 0;
      offen.delete(schluessel);
      return {
        zeit: zeile.hourStart,
        nachrichten: zeile.messages,
        sprachSekunden: zeile.voiceSeconds + dazu,
        beitritte: zeile.joins,
        austritte: zeile.leaves,
      };
    });
    for (const [schluessel, sekunden] of offen) {
      punkteJeStunde.push({
        zeit: new Date(schluessel),
        nachrichten: 0,
        sprachSekunden: sekunden,
        beitritte: 0,
        austritte: 0,
      });
    }

    return punkteJeStunde
      .sort((a, b) => a.zeit.getTime() - b.zeit.getTime())
      .map((punkt) => {
        const teile = zuercherTeile(punkt.zeit);
        return {
          zeit: punkt.zeit.toISOString(),
          label: `${String(teile.stunde).padStart(2, '0')}:00`,
          nachrichten: punkt.nachrichten,
          sprachSekunden: punkt.sprachSekunden,
          beitritte: punkt.beitritte,
          austritte: punkt.austritte,
          mitglieder: null,
          // Aktive je Stunde waeren eine eigene Aggregation - hier bewusst
          // nicht behauptet statt geschaetzt.
          aktive: null,
        };
      });
  }

  const tage = await prisma.analyticsDaily.findMany({
    where: { guildId, day: { gte: tag(zeitraum.von), lte: tag(zeitraum.bis) } },
    orderBy: { day: 'asc' },
  });

  // Aktive je Tag: eine Abfrage fuer alle Tage, dann im Speicher gruppiert -
  // eine Abfrage je Tag waeren bei einem Jahr 365 Rundreisen.
  const aktiveZeilen = await prisma.analyticsUserDaily.findMany({
    where: {
      guildId,
      day: { gte: tag(zeitraum.von), lte: tag(zeitraum.bis) },
      ...AKTIV_BEDINGUNG,
      ...(bots.length > 0 ? { discordId: { notIn: bots } } : {}),
    },
    select: { day: true, discordId: true },
  });
  const aktiveProTag = new Map<string, Set<string>>();
  for (const zeile of aktiveZeilen) {
    const schluessel = zeile.day.toISOString().slice(0, 10);
    const menge = aktiveProTag.get(schluessel) ?? new Set<string>();
    menge.add(zeile.discordId);
    aktiveProTag.set(schluessel, menge);
  }

  const punkte = tage.map((zeile) => {
    const schluessel = zeile.day.toISOString().slice(0, 10);
    return {
      zeit: zeile.day.toISOString(),
      label: schluessel.slice(8, 10) + '.' + schluessel.slice(5, 7) + '.',
      nachrichten: zeile.messages,
      sprachSekunden: zeile.voiceSeconds + (laufend.jeTag.get(schluessel) ?? 0),
      beitritte: zeile.joins,
      austritte: zeile.leaves,
      mitglieder: zeile.memberCount,
      aktive: aktiveProTag.get(schluessel)?.size ?? 0,
    };
  });

  if (zeitraum.granularitaet !== 'week') {
    return punkte;
  }

  // Wochenweise zusammenfassen. Aktive lassen sich dabei **nicht** addieren -
  // dieselbe Person kann an mehreren Tagen der Woche aktiv gewesen sein.
  // Deshalb wird sie hier ueber die Kennungen neu bestimmt.
  const wochen = new Map<string, VerlaufPunkt & { aktiveMenge: Set<string> }>();
  for (const zeile of tage) {
    const schluessel = wochenSchluessel(zeile.day);
    const vorhanden = wochen.get(schluessel) ?? {
      zeit: zeile.day.toISOString(),
      label: schluessel,
      nachrichten: 0,
      sprachSekunden: 0,
      beitritte: 0,
      austritte: 0,
      mitglieder: null as number | null,
      aktive: 0,
      aktiveMenge: new Set<string>(),
    };
    vorhanden.nachrichten += zeile.messages;
    vorhanden.sprachSekunden +=
      zeile.voiceSeconds + (laufend.jeTag.get(zeile.day.toISOString().slice(0, 10)) ?? 0);
    vorhanden.beitritte += zeile.joins;
    vorhanden.austritte += zeile.leaves;
    // Mitgliederzahl: der letzte bekannte Stand der Woche, keine Summe.
    vorhanden.mitglieder = zeile.memberCount ?? vorhanden.mitglieder;
    wochen.set(schluessel, vorhanden);
  }
  for (const zeile of aktiveZeilen) {
    const schluessel = wochenSchluessel(zeile.day);
    wochen.get(schluessel)?.aktiveMenge.add(zeile.discordId);
  }

  return [...wochen.values()].map(({ aktiveMenge, ...punkt }) => ({
    ...punkt,
    aktive: aktiveMenge.size,
  }));
}

/** Kalenderwoche als `KW 34 / 2026`. */
function wochenSchluessel(datum: Date): string {
  const kopie = new Date(Date.UTC(datum.getUTCFullYear(), datum.getUTCMonth(), datum.getUTCDate()));
  const wochentag = kopie.getUTCDay() || 7;
  kopie.setUTCDate(kopie.getUTCDate() + 4 - wochentag);
  const jahresBeginn = new Date(Date.UTC(kopie.getUTCFullYear(), 0, 1));
  const woche = Math.ceil(((kopie.getTime() - jahresBeginn.getTime()) / 86_400_000 + 1) / 7);
  return `KW ${woche} / ${kopie.getUTCFullYear()}`;
}

// --- Ranglisten -------------------------------------------------------------

export interface RanglisteEintrag {
  discordId: string;
  username: string | null;
  displayName: string | null;
  avatarHash: string | null;
  nachrichten: number;
  sprachSekunden: number;
  sprachSitzungen: number;
  /** Anteil an der Gesamtsumme des Zeitraums, in Prozent. */
  anteil: number;
}

/**
 * Die aktivsten Mitglieder.
 *
 * `groupBy` ueber die Tageszeilen statt ueber Ereignisse: das sind bei einem
 * Jahr und tausend aktiven Personen ein paar hunderttausend Zeilen statt
 * Millionen, und der Index traegt sie.
 */
export async function topMitglieder(
  scope: StatistikScope,
  nach: 'messages' | 'voice',
  limit = 10,
): Promise<RanglisteEintrag[]> {
  const { guildId, zeitraum } = scope;
  const [bots, laufend] = await Promise.all([
    botFilter(scope.mitBots, guildId),
    nach === 'voice' ? laufendFuer(scope, zeitraum) : Promise.resolve(leereSprachzeit()),
  ]);

  const tageFilter = { gte: tag(zeitraum.von), lte: tag(zeitraum.bis) };
  const ohneBots = bots.length > 0 ? { discordId: { notIn: bots } } : {};
  const aufteilung = { messages: true, voiceSeconds: true, voiceSessions: true } as const;

  /*
   * Wer gerade spricht, steht noch in keinem Aggregat.
   *
   * Die Rangliste kaeme sonst ohne ihn aus - und jemand, der seit zwei
   * Stunden im Kanal sitzt, fehlte ausgerechnet in «Top Sprachzeit». Er
   * kaeme erst dazu, wenn er geht.
   *
   * Deshalb zwei Abfragen: die uebliche Bestenliste, und dazu die Zeilen
   * genau der Leute, die gerade eine laufende Sitzung haben. Das sind ein
   * paar Dutzend, und sie koennen durch ihren laufenden Anteil in die Liste
   * rutschen - sortiert wird darum erst nach dem Zusammenfuehren.
   */
  const laufendeIds = [...laufend.jeMitglied.keys()].filter((id) => !bots.includes(id));

  const [zeilen, laufendeZeilen] = await Promise.all([
    prisma.analyticsUserDaily.groupBy({
      by: ['discordId'],
      where: {
        guildId,
        day: tageFilter,
        ...ohneBots,
        ...(nach === 'messages' ? { messages: { gt: 0 } } : { voiceSeconds: { gt: 0 } }),
      },
      _sum: aufteilung,
      orderBy: nach === 'messages' ? { _sum: { messages: 'desc' } } : { _sum: { voiceSeconds: 'desc' } },
      take: Math.min(limit, 50) + laufendeIds.length,
    }),
    laufendeIds.length > 0
      ? prisma.analyticsUserDaily.groupBy({
          by: ['discordId'],
          where: { guildId, day: tageFilter, discordId: { in: laufendeIds } },
          _sum: aufteilung,
        })
      : Promise.resolve([]),
  ]);

  const gesammelt = new Map<string, { messages: number; voiceSeconds: number; voiceSessions: number }>();
  for (const zeile of [...zeilen, ...laufendeZeilen]) {
    gesammelt.set(zeile.discordId, {
      messages: zeile._sum.messages ?? 0,
      voiceSeconds: zeile._sum.voiceSeconds ?? 0,
      voiceSessions: zeile._sum.voiceSessions ?? 0,
    });
  }
  for (const discordId of laufendeIds) {
    if (!gesammelt.has(discordId)) {
      gesammelt.set(discordId, { messages: 0, voiceSeconds: 0, voiceSessions: 0 });
    }
  }

  const kandidaten = [...gesammelt.entries()]
    .map(([discordId, werte]) => ({
      discordId,
      ...werte,
      voiceSeconds: werte.voiceSeconds + (laufend.jeMitglied.get(discordId) ?? 0),
    }))
    .filter((eintrag) => (nach === 'messages' ? eintrag.messages > 0 : eintrag.voiceSeconds > 0))
    .sort((a, b) => (nach === 'messages' ? b.messages - a.messages : b.voiceSeconds - a.voiceSeconds))
    .slice(0, Math.min(limit, 50));

  const [gesamt, profile] = await Promise.all([
    summen(guildId, zeitraum.von, zeitraum.bis, nach === 'voice' ? laufend : undefined),
    // Namen in einer Abfrage statt einer je Zeile.
    prisma.analyticsMemberProfile.findMany({
      where: { guildId, discordId: { in: kandidaten.map((eintrag) => eintrag.discordId) } },
      select: { discordId: true, username: true, displayName: true, avatarHash: true },
    }),
  ]);
  const nachId = new Map(profile.map((eintrag) => [eintrag.discordId, eintrag]));
  const nenner = nach === 'messages' ? gesamt.messages : gesamt.voiceSeconds;

  return kandidaten.map((eintrag) => {
    const wert = nach === 'messages' ? eintrag.messages : eintrag.voiceSeconds;
    const person = nachId.get(eintrag.discordId);
    return {
      discordId: eintrag.discordId,
      username: person?.username ?? null,
      displayName: person?.displayName ?? null,
      avatarHash: person?.avatarHash ?? null,
      nachrichten: eintrag.messages,
      sprachSekunden: eintrag.voiceSeconds,
      sprachSitzungen: eintrag.voiceSessions,
      anteil: nenner > 0 ? Math.round((wert / nenner) * 1000) / 10 : 0,
    };
  });
}

export interface KanalEintrag {
  channelId: string;
  channelName: string | null;
  parentId: string | null;
  nachrichten: number;
  sprachSekunden: number;
  anteil: number;
  /** Veraenderung gegenueber dem Vergleichszeitraum. */
  veraenderung: Veraenderung;
}

export async function topKanaele(
  scope: StatistikScope,
  kind: 'TEXT' | 'VOICE',
  limit = 10,
): Promise<KanalEintrag[]> {
  const { guildId, zeitraum } = scope;
  const feld = kind === 'TEXT' ? 'messages' : 'voiceSeconds';
  const laufend = kind === 'VOICE' ? await laufendFuer(scope, zeitraum) : leereSprachzeit(scope.jetzt);

  const [zeilen, vorherZeilen, gesamt] = await Promise.all([
    prisma.analyticsChannelDaily.groupBy({
      by: ['channelId'],
      where: { guildId, kind, day: { gte: tag(zeitraum.von), lte: tag(zeitraum.bis) } },
      _sum: { messages: true, voiceSeconds: true },
      orderBy: { _sum: { [feld]: 'desc' } },
      // Ein Kanal, in dem gerade jemand sitzt, kann durch seinen laufenden
      // Anteil in die Liste rutschen - deshalb etwas grosszuegiger holen und
      // erst nach dem Zusammenfuehren abschneiden.
      take: Math.min(limit, 50) + laufend.jeKanal.size,
    }),
    zeitraum.vergleichVon && zeitraum.vergleichBis
      ? prisma.analyticsChannelDaily.groupBy({
          by: ['channelId'],
          where: {
            guildId,
            kind,
            day: { gte: tag(zeitraum.vergleichVon), lte: tag(zeitraum.vergleichBis) },
          },
          _sum: { messages: true, voiceSeconds: true },
        })
      : Promise.resolve([]),
    summen(guildId, zeitraum.von, zeitraum.bis, kind === 'VOICE' ? laufend : undefined),
  ]);

  // Aggregat und laufender Anteil zusammenfuehren; ein Kanal, in dem gerade
  // erst jemand sitzt, hat noch gar keine Zeile.
  const summiert = new Map<string, { messages: number; voiceSeconds: number }>();
  for (const zeile of zeilen) {
    summiert.set(zeile.channelId, {
      messages: zeile._sum.messages ?? 0,
      voiceSeconds: zeile._sum.voiceSeconds ?? 0,
    });
  }
  for (const [channelId, anteil] of laufend.jeKanal) {
    const vorhanden = summiert.get(channelId) ?? { messages: 0, voiceSeconds: 0 };
    vorhanden.voiceSeconds += anteil.sekunden;
    summiert.set(channelId, vorhanden);
  }

  const sortiert = [...summiert.entries()]
    .map(([channelId, werte]) => ({ channelId, ...werte }))
    .filter((eintrag) => (kind === 'TEXT' ? eintrag.messages > 0 : eintrag.voiceSeconds > 0))
    .sort((a, b) => (kind === 'TEXT' ? b.messages - a.messages : b.voiceSeconds - a.voiceSeconds))
    .slice(0, Math.min(limit, 50));

  // Namen kommen aus der juengsten Zeile - ein umbenannter Kanal soll unter
  // seinem heutigen Namen erscheinen.
  const namen = await prisma.analyticsChannelDaily.findMany({
    where: { guildId, channelId: { in: sortiert.map((eintrag) => eintrag.channelId) } },
    orderBy: { day: 'desc' },
    select: { channelId: true, channelName: true, parentId: true },
    distinct: ['channelId'],
  });
  const namenNach = new Map(namen.map((eintrag) => [eintrag.channelId, eintrag]));
  const vorherNach = new Map(
    vorherZeilen.map((zeile) => [
      zeile.channelId,
      kind === 'TEXT' ? (zeile._sum.messages ?? 0) : (zeile._sum.voiceSeconds ?? 0),
    ]),
  );

  const nenner = kind === 'TEXT' ? gesamt.messages : gesamt.voiceSeconds;

  return sortiert.map((eintrag) => {
    const wert = kind === 'TEXT' ? eintrag.messages : eintrag.voiceSeconds;
    const laufenderKanal = laufend.jeKanal.get(eintrag.channelId);
    return {
      channelId: eintrag.channelId,
      channelName: namenNach.get(eintrag.channelId)?.channelName ?? laufenderKanal?.channelName ?? null,
      parentId: namenNach.get(eintrag.channelId)?.parentId ?? laufenderKanal?.parentId ?? null,
      nachrichten: eintrag.messages,
      sprachSekunden: eintrag.voiceSeconds,
      anteil: nenner > 0 ? Math.round((wert / nenner) * 1000) / 10 : 0,
      veraenderung: vergleiche(wert, vorherNach.get(eintrag.channelId) ?? null, 50),
    };
  });
}

// --- Aktivitätszeiten -------------------------------------------------------

export interface HeatmapZelle {
  /** 0 = Sonntag ... 6 = Samstag. */
  wochentag: number;
  stunde: number;
  nachrichten: number;
  sprachSekunden: number;
}

export interface Heatmap {
  zellen: HeatmapZelle[];
  /** Spitzenwerte fuer die Faerbung. */
  maxNachrichten: number;
  maxSprachSekunden: number;
  /** Aktivster Wochentag und aktivste Stunde - `null` ohne Daten. */
  spitzeNachrichten: { wochentag: number; stunde: number } | null;
  spitzeSprache: { wochentag: number; stunde: number } | null;
}

/**
 * Wann ist auf dem Server am meisten los?
 *
 * Wochentag und Stunde werden in Zuercher Zeit bestimmt. In UTC laege der
 * Feierabend im Sommer eine Stunde anders als im Winter, und die Spitze
 * verteilte sich auf zwei Balken.
 */
export async function heatmap(scope: StatistikScope): Promise<Heatmap> {
  const [zeilen, laufend] = await Promise.all([
    prisma.analyticsHourly.findMany({
      where: { guildId: scope.guildId, hourStart: { gte: scope.zeitraum.von, lte: scope.zeitraum.bis } },
      select: { hourStart: true, messages: true, voiceSeconds: true },
    }),
    laufendFuer(scope, scope.zeitraum),
  ]);

  const raster = new Map<string, HeatmapZelle>();
  for (let wochentag = 0; wochentag < 7; wochentag += 1) {
    for (let stunde = 0; stunde < 24; stunde += 1) {
      raster.set(`${wochentag}-${stunde}`, { wochentag, stunde, nachrichten: 0, sprachSekunden: 0 });
    }
  }

  const einsortieren = (zeitpunkt: Date, nachrichten: number, sprachSekunden: number): void => {
    const teile = zuercherTeile(zeitpunkt);
    const zelle = raster.get(`${teile.wochentag}-${teile.stunde}`);
    if (zelle) {
      zelle.nachrichten += nachrichten;
      zelle.sprachSekunden += sprachSekunden;
    }
  };

  for (const zeile of zeilen) {
    einsortieren(zeile.hourStart, zeile.messages, zeile.voiceSeconds);
  }
  // Die laufende Stunde gehoert in die Karte, sonst bliebe genau das Feld
  // leer, in dem gerade etwas los ist.
  for (const [schluessel, sekunden] of laufend.jeStunde) {
    einsortieren(new Date(schluessel), 0, sekunden);
  }

  const zellen = [...raster.values()];
  const spitze = (feld: 'nachrichten' | 'sprachSekunden') => {
    const beste = zellen.reduce((a, b) => (b[feld] > a[feld] ? b : a), zellen[0]!);
    return beste[feld] > 0 ? { wochentag: beste.wochentag, stunde: beste.stunde } : null;
  };

  return {
    zellen,
    maxNachrichten: Math.max(0, ...zellen.map((zelle) => zelle.nachrichten)),
    maxSprachSekunden: Math.max(0, ...zellen.map((zelle) => zelle.sprachSekunden)),
    spitzeNachrichten: spitze('nachrichten'),
    spitzeSprache: spitze('sprachSekunden'),
  };
}

// --- Nutzungsart ------------------------------------------------------------

export interface Nutzungsart {
  nurText: number;
  nurSprache: number;
  beides: number;
  /** Mitglieder ohne Aktivitaet - `null` ohne bekannte Mitgliederzahl. */
  inaktiv: number | null;
}

/** Schreiben, sprechen oder beides - wie wird der Server benutzt? */
export async function nutzungsart(scope: StatistikScope): Promise<Nutzungsart> {
  const { guildId, zeitraum } = scope;
  const [bots, laufend] = await Promise.all([
    botFilter(scope.mitBots, guildId),
    laufendFuer(scope, zeitraum),
  ]);

  const zeilen = await prisma.analyticsUserDaily.groupBy({
    by: ['discordId'],
    where: {
      guildId,
      day: { gte: tag(zeitraum.von), lte: tag(zeitraum.bis) },
      ...AKTIV_BEDINGUNG,
      ...(bots.length > 0 ? { discordId: { notIn: bots } } : {}),
    },
    _sum: { messages: true, voiceSeconds: true },
  });

  // Wer gerade spricht, benutzt den Server - auch wenn noch kein Aggregat
  // davon weiss.
  const sprachsekunden = new Map<string, number>();
  const nachrichten = new Map<string, number>();
  for (const zeile of zeilen) {
    sprachsekunden.set(zeile.discordId, zeile._sum.voiceSeconds ?? 0);
    nachrichten.set(zeile.discordId, zeile._sum.messages ?? 0);
  }
  for (const [discordId, sekunden] of laufend.jeMitglied) {
    if (bots.includes(discordId)) {
      continue;
    }
    sprachsekunden.set(discordId, (sprachsekunden.get(discordId) ?? 0) + sekunden);
  }

  let nurText = 0;
  let nurSprache = 0;
  let beides = 0;
  for (const discordId of new Set([...sprachsekunden.keys(), ...nachrichten.keys()])) {
    const hatText = (nachrichten.get(discordId) ?? 0) > 0;
    const hatSprache = (sprachsekunden.get(discordId) ?? 0) > 0;
    if (hatText && hatSprache) {
      beides += 1;
    } else if (hatText) {
      nurText += 1;
    } else if (hatSprache) {
      nurSprache += 1;
    }
  }

  const mitglieder = await prisma.analyticsDaily.findFirst({
    where: { guildId, memberCount: { not: null } },
    orderBy: { day: 'desc' },
    select: { memberCount: true },
  });
  const gesamt = mitglieder?.memberCount ?? null;

  return {
    nurText,
    nurSprache,
    beides,
    inaktiv: gesamt === null ? null : Math.max(0, gesamt - (nurText + nurSprache + beides)),
  };
}

// --- Neue Mitglieder --------------------------------------------------------

export interface NeuMitglieder {
  /** Beigetretene im Zeitraum. */
  beigetreten: number;
  /** Davon innerhalb von sieben Tagen aktiv geworden. */
  aktiviert: number;
  aktivierungsQuote: number | null;
  /** Mittlere Zeit bis zur ersten Aeusserung, in Sekunden. */
  zeitBisAktivitaet: number | null;
  /** Anteil der vor 7/30/90 Tagen Beigetretenen, die noch da sind. */
  bindung: Array<{ tage: number; kohorte: number; geblieben: number; quote: number | null }>;
}

/**
 * Wie gut kommen neue Mitglieder an?
 *
 * Alle drei Zahlen brauchen einen bekannten Beitritt. Wer schon vor Beginn
 * der Aufzeichnung da war, hat keinen - und faellt deshalb heraus, statt die
 * Quote mit einem geratenen Datum zu verfaelschen.
 */
export async function neueMitglieder(scope: StatistikScope): Promise<NeuMitglieder> {
  const { guildId, zeitraum } = scope;
  const AKTIVIERUNGS_FENSTER_MS = 7 * 86_400_000;

  const kohorte = await prisma.analyticsMemberProfile.findMany({
    where: {
      guildId,
      isBot: false,
      joinedAt: { gte: zeitraum.von, lte: zeitraum.bis },
    },
    select: { joinedAt: true, firstActivityAt: true },
  });

  const mitAktivitaet = kohorte.filter(
    (eintrag) =>
      eintrag.joinedAt &&
      eintrag.firstActivityAt &&
      eintrag.firstActivityAt.getTime() - eintrag.joinedAt.getTime() <= AKTIVIERUNGS_FENSTER_MS,
  );
  const abstaende = mitAktivitaet.map((eintrag) =>
    Math.max(0, (eintrag.firstActivityAt as Date).getTime() - (eintrag.joinedAt as Date).getTime()),
  );

  /**
   * Bindung als echte Kohorte.
   *
   * Die Frage lautet: «Von denen, die vor N Tagen beigetreten sind - wie
   * viele waren N Tage spaeter noch da?» Entscheidend ist das **jeweils
   * eigene** N-Tage-Datum jedes Mitglieds, nicht der heutige Stichtag. Wer
   * nur zaehlt, wer heute noch da ist, misst fuer die 7- und die 90-Tage-
   * Marke fast dieselbe Gruppe und bekommt drei Zahlen, die alle dasselbe
   * sagen.
   *
   * In die Kohorte kommt nur, wer die Marke ueberhaupt erreichen konnte -
   * wer gestern beigetreten ist, hat noch keine 30-Tage-Bindung.
   */
  const bindung = await Promise.all(
    [7, 30, 90].map(async (tage) => {
      const spaetestensBeigetreten = new Date(Date.now() - tage * 86_400_000);
      const kohorteZeilen = await prisma.analyticsMemberProfile.findMany({
        where: {
          guildId,
          isBot: false,
          joinedAt: { lte: spaetestensBeigetreten, not: null },
        },
        select: { joinedAt: true, leftAt: true },
      });

      const geblieben = kohorteZeilen.filter((eintrag) => {
        const marke = (eintrag.joinedAt as Date).getTime() + tage * 86_400_000;
        // Noch da, oder erst nach der Marke gegangen.
        return !eintrag.leftAt || eintrag.leftAt.getTime() > marke;
      }).length;

      return {
        tage,
        kohorte: kohorteZeilen.length,
        geblieben,
        // Unter zwanzig Personen sagt eine Quote mehr ueber den Zufall aus.
        quote: kohorteZeilen.length >= 20 ? Math.round((geblieben / kohorteZeilen.length) * 1000) / 10 : null,
      };
    }),
  );

  return {
    beigetreten: kohorte.length,
    aktiviert: mitAktivitaet.length,
    aktivierungsQuote:
      kohorte.length >= 10 ? Math.round((mitAktivitaet.length / kohorte.length) * 1000) / 10 : null,
    zeitBisAktivitaet:
      abstaende.length >= 5
        ? Math.round(abstaende.reduce((a, b) => a + b, 0) / abstaende.length / 1000)
        : null,
    bindung,
  };
}

// --- Wiederkehrende ---------------------------------------------------------

export interface Wiederkehrende {
  aktiv: number;
  wiederkehrend: number;
  neuAktiv: number;
  quote: number | null;
}

/** Wie viele der Aktiven waren auch im Zeitraum davor schon aktiv? */
export async function wiederkehrende(scope: StatistikScope): Promise<Wiederkehrende | null> {
  const { guildId, zeitraum } = scope;
  if (!zeitraum.vergleichVon || !zeitraum.vergleichBis) {
    return null;
  }
  const bots = await botFilter(scope.mitBots, guildId);

  const lade = async (von: Date, bis: Date): Promise<Set<string>> => {
    const zeilen = await prisma.analyticsUserDaily.findMany({
      where: {
        guildId,
        day: { gte: tag(von), lte: tag(bis) },
        ...AKTIV_BEDINGUNG,
        ...(bots.length > 0 ? { discordId: { notIn: bots } } : {}),
      },
      select: { discordId: true },
      distinct: ['discordId'],
    });
    return new Set(zeilen.map((zeile) => zeile.discordId));
  };

  const [jetzt, vorher] = await Promise.all([
    lade(zeitraum.von, zeitraum.bis),
    lade(zeitraum.vergleichVon, zeitraum.vergleichBis),
  ]);

  const wiederkehrendeAnzahl = [...jetzt].filter((id) => vorher.has(id)).length;
  return {
    aktiv: jetzt.size,
    wiederkehrend: wiederkehrendeAnzahl,
    neuAktiv: jetzt.size - wiederkehrendeAnzahl,
    quote: jetzt.size >= 10 ? Math.round((wiederkehrendeAnzahl / jetzt.size) * 1000) / 10 : null,
  };
}

// --- Datenlage --------------------------------------------------------------

export interface Datenlage {
  /** Beginn der Aufzeichnung insgesamt. */
  seit: Date | null;
  nachrichtenSeit: Date | null;
  spracheSeit: Date | null;
  /** Liegt der gewaehlte Zeitraum teilweise vor dem Beginn? */
  unvollstaendig: boolean;
  /** Ab wann im gewaehlten Zeitraum es Daten gibt. */
  abgedeckenAb: Date | null;
  /** Gibt es ueberhaupt schon Zahlen? */
  leer: boolean;
}

/**
 * Was die Zahlen ueberhaupt abdecken koennen.
 *
 * Die wichtigste Auskunft der ganzen Seite. Ohne sie sieht eine Null fuer den
 * letzten Januar aus wie «es war nichts los» - dabei heisst sie «wir haben
 * damals noch nicht gezaehlt». Die Statistik erfindet keine Vergangenheit.
 */
export async function datenlage(guildId: string, zeitraum: Zeitraum): Promise<Datenlage> {
  const [stand, ersterTag] = await Promise.all([
    trackingStand(guildId),
    prisma.analyticsDaily.findFirst({
      where: { guildId },
      orderBy: { day: 'asc' },
      select: { day: true },
    }),
  ]);

  const seit = stand?.startedAt ?? ersterTag?.day ?? null;
  const unvollstaendig = Boolean(seit && zeitraum.von < seit);

  return {
    seit,
    nachrichtenSeit: stand?.messagesSince ?? null,
    spracheSeit: stand?.voiceSince ?? null,
    unvollstaendig,
    abgedeckenAb: unvollstaendig ? seit : zeitraum.von,
    leer: !ersterTag,
  };
}

// --- Laufende Werte ---------------------------------------------------------

export interface HeuteWerte {
  nachrichten: number;
  sprachSekunden: number;
  beitritte: number;
  austritte: number;
  /** Wer gerade im Sprachkanal sitzt. */
  imSprachkanal: number;
  aktive: number;
  /** Serverzeit, auf die sich die laufenden Anteile beziehen. */
  asOf: Date;
  /** Wie viele Sitzungen die Sprachzeit gerade wachsen lassen. */
  wachsend: number;
}

/**
 * Die Zahlen des laufenden Tages.
 *
 * Getrennt von den Zeitraumkennzahlen, weil sie sich staendig aendern und
 * deshalb kuerzer zwischengespeichert werden duerfen als ein abgeschlossener
 * Monat.
 *
 * «Heute» beginnt um Mitternacht **Zuercher Zeit**, nicht UTC - im Sommer
 * laegen dazwischen zwei Stunden, und der Abend gehoerte zum falschen Tag.
 * Wer um 23:30 betritt und um 00:30 noch da ist, hat fuer heute eine halbe
 * Stunde: die Haelfte vor Mitternacht gehoert zu gestern.
 */
export async function heute(guildId: string, mitBots = false, jetzt = new Date()): Promise<HeuteWerte> {
  const heuteWert = tag(jetzt);
  const bots = await botFilter(mitBots, guildId);

  const [zeile, aktive, imKanal, laufend] = await Promise.all([
    prisma.analyticsDaily.findUnique({ where: { guildId_day: { guildId, day: heuteWert } } }),
    prisma.analyticsUserDaily.findMany({
      where: {
        guildId,
        day: heuteWert,
        ...AKTIV_BEDINGUNG,
        ...(bots.length > 0 ? { discordId: { notIn: bots } } : {}),
      },
      select: { discordId: true },
      distinct: ['discordId'],
    }),
    /*
     * «Gerade im Sprachkanal» - die offenen Abschnitte.
     *
     * Dieselbe Quelle wie die laufende Sprachzeit, damit die beiden Kacheln
     * nicht verschiedene Wahrheiten erzaehlen. Dass hier keine Karteileichen
     * mitzaehlen, entscheidet sich frueher: beim Start gleicht der Bot die
     * offenen Abschnitte gegen die tatsaechlichen Sprachzustaende ab, und
     * beim Herunterfahren schliesst er alles. Ein Abschnitt, den niemand
     * mehr belegt, ueberlebt den naechsten Start nicht.
     *
     * Der AFK-Kanal zaehlt hier mit: dort sitzt jemand, auch wenn seine Zeit
     * keine Aktivitaet ist.
     */
    prisma.analyticsVoiceSegment.findMany({
      where: { guildId, leftAt: null, ...(mitBots ? {} : { isBot: false }) },
      select: { discordId: true },
      distinct: ['discordId'],
    }),
    laufendeSprachzeit(guildId, { von: tagesBeginn(jetzt), bis: jetzt }, { mitBots, jetzt }),
  ]);

  const aktiveMenge = new Set(aktive.map((eintrag) => eintrag.discordId));
  for (const discordId of laufend.mitglieder) {
    if (!bots.includes(discordId)) {
      aktiveMenge.add(discordId);
    }
  }

  return {
    nachrichten: zeile?.messages ?? 0,
    sprachSekunden: (zeile?.voiceSeconds ?? 0) + laufend.sekunden,
    beitritte: zeile?.joins ?? 0,
    austritte: zeile?.leaves ?? 0,
    imSprachkanal: imKanal.length,
    aktive: aktiveMenge.size,
    asOf: laufend.asOf,
    wachsend: laufend.wachsend,
  };
}

/** Die Einstellungen, soweit die Statistik sie braucht. */
export async function statistikEinstellungen(): Promise<{ mitBots: boolean }> {
  const settings = await getModuleSettings<AnalyticsSettings>(ANALYTICS_MODULE_ID);
  return { mitBots: settings.logBots };
}

export { tagesSchluessel, tageZwischen };
