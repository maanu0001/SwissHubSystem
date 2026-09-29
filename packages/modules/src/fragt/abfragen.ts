import { prisma } from '@swisshub/database';
import type { FragtAbstimmung, FragtEntwurf, FragtFrage } from '@swisshub/database';
import { FRAGT_MODULE_ID, type FragtSettings } from './config';
import { getModuleSettings } from '../module-state';
import { ausSnapshot, type Ergebnis } from './ergebnis';
import { naechsterTermin } from './planung';
import { zaehleStimmen } from './abstimmung';

/**
 * Was das Dashboard braucht - und nur das.
 *
 * Lesende Abfragen, gebuendelt. Getrennt von den Diensten, damit eine Seite
 * nicht sechs einzelne Aufrufe macht, die einander nicht kennen - und damit
 * klar bleibt, welche Zahl woher kommt.
 */

export const einstellungen = (): Promise<FragtSettings> => getModuleSettings<FragtSettings>(FRAGT_MODULE_ID);

export interface LaufendeAnsicht {
  abstimmung: FragtAbstimmung;
  /**
   * Der Stand jetzt.
   *
   * Fuer das Dashboard immer, unabhaengig von `zwischenstandSichtbar`: die
   * Einstellung regelt, was **oeffentlich** im Kanal steht. Wer das Modul
   * verwaltet, soll sehen, ob die Frage laeuft.
   */
  stand: Ergebnis;
}

export interface AbgeschlosseneAnsicht {
  abstimmung: FragtAbstimmung;
  /** Aus dem Schnappschuss - `null`, wenn er nicht lesbar ist. */
  ergebnis: Ergebnis | null;
  entwurf: FragtEntwurf | null;
}

export interface Uebersicht {
  laufend: LaufendeAnsicht | null;
  naechsteGeplant: { frage: FragtFrage; termin: Date } | null;
  /** Der naechste Termin aus der Automatik - unabhaengig davon, ob etwas geplant ist. */
  naechsterAutomatikTermin: Date | null;
  letzte: AbgeschlosseneAnsicht | null;
  zahlen: {
    entwuerfe: number;
    freigegeben: number;
    geplant: number;
    veroeffentlichteFragen: number;
    /** Abgeschlossene Abstimmungen, deren Entwurf noch nicht als gepostet gilt. */
    nichtExportiert: number;
    stimmenGesamt: number;
  };
}

export async function ladeUebersicht(guildId: string, jetzt = new Date()): Promise<Uebersicht> {
  const konfiguration = await einstellungen();

  const [laufendeZeile, geplanteZeile, letzteZeile, entwuerfe, freigegeben, geplant, abstimmungen] =
    await Promise.all([
      prisma.fragtAbstimmung.findFirst({
        where: { guildId, status: 'ACTIVE' },
        orderBy: { opensAt: 'desc' },
      }),
      prisma.fragtFrage.findFirst({
        where: { guildId, status: 'SCHEDULED', archivedAt: null, geplantAt: { not: null } },
        orderBy: { geplantAt: 'asc' },
      }),
      prisma.fragtAbstimmung.findFirst({
        where: { guildId, status: 'CLOSED' },
        orderBy: { closedAt: 'desc' },
        include: { entwuerfe: true },
      }),
      prisma.fragtFrage.count({ where: { guildId, status: 'DRAFT', archivedAt: null } }),
      prisma.fragtFrage.count({ where: { guildId, status: 'READY', archivedAt: null } }),
      prisma.fragtFrage.count({ where: { guildId, status: 'SCHEDULED', archivedAt: null } }),
      prisma.fragtAbstimmung.findMany({
        where: { guildId },
        select: { id: true, status: true, finalVotes: true },
      }),
    ]);

  /*
   * Nicht exportiert: abgeschlossen, aber kein Entwurf mit Status
   * VEROEFFENTLICHT.
   *
   * Als eigene Abfrage und nicht aus `abstimmungen` gerechnet: die Bedingung
   * ist eine Verneinung ueber eine Beziehung, und die gehoert in die Datenbank.
   */
  const nichtExportiert = await prisma.fragtAbstimmung.count({
    where: {
      guildId,
      status: 'CLOSED',
      NOT: { entwuerfe: { some: { status: 'VEROEFFENTLICHT' } } },
    },
  });

  const stimmenGesamt = abstimmungen
    .filter((zeile) => zeile.status === 'CLOSED')
    .reduce((summe, zeile) => summe + zeile.finalVotes, 0);

  return {
    laufend: laufendeZeile
      ? { abstimmung: laufendeZeile, stand: await zaehleStimmen(laufendeZeile.id) }
      : null,
    naechsteGeplant:
      geplanteZeile && geplanteZeile.geplantAt
        ? { frage: geplanteZeile, termin: geplanteZeile.geplantAt }
        : null,
    // Ohne Automatik gibt es keinen naechsten Termin - eine Zahl anzuzeigen,
    // an der nichts passiert, waere eine Zusage, die das Modul nicht einhaelt.
    naechsterAutomatikTermin: konfiguration.autoPublish ? naechsterTermin(jetzt, konfiguration) : null,
    letzte: letzteZeile
      ? {
          abstimmung: letzteZeile,
          ergebnis: ausSnapshot(letzteZeile.ergebnis),
          entwurf: letzteZeile.entwuerfe[0] ?? null,
        }
      : null,
    zahlen: {
      entwuerfe,
      freigegeben,
      geplant,
      veroeffentlichteFragen: abstimmungen.length,
      nichtExportiert,
      stimmenGesamt,
    },
  };
}

export async function ladeAbgeschlossene(guildId: string, grenze = 50): Promise<AbgeschlosseneAnsicht[]> {
  const zeilen = await prisma.fragtAbstimmung.findMany({
    where: { guildId, status: 'CLOSED' },
    orderBy: { closedAt: 'desc' },
    take: Math.min(grenze, 200),
    include: { entwuerfe: true },
  });

  return zeilen.map((zeile) => ({
    abstimmung: zeile,
    ergebnis: ausSnapshot(zeile.ergebnis),
    entwurf: zeile.entwuerfe[0] ?? null,
  }));
}

export async function ladeAbstimmung(abstimmungId: string): Promise<AbgeschlosseneAnsicht | null> {
  const zeile = await prisma.fragtAbstimmung.findUnique({
    where: { id: abstimmungId },
    include: { entwuerfe: true },
  });
  if (!zeile) {
    return null;
  }
  return {
    abstimmung: zeile,
    // Laeuft sie noch, gibt es keinen Schnappschuss - dann wird gezaehlt.
    ergebnis: zeile.status === 'CLOSED' ? ausSnapshot(zeile.ergebnis) : await zaehleStimmen(zeile.id),
    entwurf: zeile.entwuerfe[0] ?? null,
  };
}

export interface Beteiligung {
  /** Je Abstimmung, aelteste zuerst - fuer die Entwicklung ueber die Zeit. */
  reihe: Array<{ frageText: string; geschlossenAm: Date | null; stimmen: number }>;
  /** Der Schnitt ueber alle abgeschlossenen Abstimmungen. */
  schnitt: number;
  /** Die Fragen mit den meisten Stimmen. */
  spitze: Array<{ frageText: string; stimmen: number }>;
  /** Welche Kategorien am meisten Stimmen bekommen haben. */
  kategorien: Array<{ kategorie: string; abstimmungen: number; stimmen: number }>;
}

/**
 * Beteiligung ueber die Zeit.
 *
 * ## Was hier ausdruecklich nicht entsteht
 *
 * Kein Profil darueber, wer wie abstimmt. Die Zahlen unten sind Summen je
 * Frage und je Kategorie; die `voterDiscordId` kommt in keiner davon vor.
 *
 * Das ist keine Vorsicht, sondern der Zweck: eine Auswertung «Anna stimmt
 * immer fuer Minecraft» beantwortet keine Frage, die jemand stellt, und sie
 * waere eine Liste, die es nicht geben sollte.
 */
export async function ladeBeteiligung(guildId: string, grenze = 30): Promise<Beteiligung> {
  const zeilen = await prisma.fragtAbstimmung.findMany({
    where: { guildId, status: 'CLOSED' },
    orderBy: { closedAt: 'asc' },
    take: Math.min(grenze, 200),
    select: {
      frageText: true,
      closedAt: true,
      finalVotes: true,
      frage: { select: { kategorie: true } },
    },
  });

  const reihe = zeilen.map((zeile) => ({
    frageText: zeile.frageText,
    geschlossenAm: zeile.closedAt,
    stimmen: zeile.finalVotes,
  }));

  const summe = reihe.reduce((wert, zeile) => wert + zeile.stimmen, 0);

  const nachKategorie = new Map<string, { abstimmungen: number; stimmen: number }>();
  for (const zeile of zeilen) {
    const eintrag = nachKategorie.get(zeile.frage.kategorie) ?? { abstimmungen: 0, stimmen: 0 };
    eintrag.abstimmungen += 1;
    eintrag.stimmen += zeile.finalVotes;
    nachKategorie.set(zeile.frage.kategorie, eintrag);
  }

  return {
    reihe,
    // Ganzzahlig gerundet: «12.4 Stimmen» ist keine Auskunft, die jemand braucht.
    schnitt: reihe.length > 0 ? Math.round(summe / reihe.length) : 0,
    spitze: [...reihe]
      .sort((links, rechts) => rechts.stimmen - links.stimmen)
      .slice(0, 5)
      .map((zeile) => ({ frageText: zeile.frageText, stimmen: zeile.stimmen })),
    kategorien: [...nachKategorie.entries()]
      .map(([kategorie, werte]) => ({ kategorie, ...werte }))
      .sort((links, rechts) => rechts.stimmen - links.stimmen),
  };
}

/**
 * Die eigene Stimme eines Mitglieds - fuer die private Bestaetigung.
 *
 * Die einzige Stelle, an der eine `voterDiscordId` abgefragt wird, und sie
 * antwortet nur ueber die Person, die selbst fragt.
 */
export async function eigeneStimme(
  abstimmungId: string,
  discordId: string,
): Promise<{ optionId: string; label: string } | null> {
  const stimme = await prisma.fragtStimme.findUnique({
    where: { abstimmungId_voterDiscordId: { abstimmungId, voterDiscordId: discordId } },
    include: { option: true },
  });
  return stimme ? { optionId: stimme.optionId, label: stimme.option.label } : null;
}

/**
 * Welche Fragen schon einmal gestellt wurden.
 *
 * Eine Abfrage fuer alle, nicht eine je Frage: die Bibliothek zeigt bis zu
 * zweihundert Eintraege, und die Auskunft ist je Eintrag ein Ja oder Nein.
 *
 * Davon haengt ab, ob die Antwortmoeglichkeiten noch geaendert werden duerfen -
 * die Oberflaeche zeigt es an, der Dienst setzt es durch.
 */
export async function gestellteFrageIds(guildId: string): Promise<Set<string>> {
  const zeilen = await prisma.fragtAbstimmung.findMany({
    where: { guildId },
    select: { frageId: true },
    distinct: ['frageId'],
  });
  return new Set(zeilen.map((zeile) => zeile.frageId));
}

// ---------------------------------------------------------------------------
// Stimmen im Detail - ausdruecklich getrennt von allem darueber
// ---------------------------------------------------------------------------

/** Eine einzelne Stimme, wie eine berechtigte Person sie sieht. */
export interface StimmenDetailZeile {
  optionId: string;
  /** Die Antwort, wie sie im Embed stand. */
  antwort: string;
  position: number;
  discordId: string;
  /**
   * Der Anzeigename aus dem Mitglieder-Abgleich.
   *
   * `null`, wenn die Person nicht mehr im Abgleich steht - ausgetreten,
   * gebannt, oder der Abgleich lief noch nie. Die Stimme bleibt trotzdem
   * stehen: sie ist gezaehlt worden, und eine Auswertung, aus der Stimmen
   * verschwinden, sobald jemand geht, waere keine.
   */
  name: string | null;
  abgegebenAm: Date;
  /** Wurde die Stimme spaeter geaendert? */
  geaendert: boolean;
}

export interface StimmenDetail {
  zeilen: StimmenDetailZeile[];
  /** Je Antwort die Zahl - dieselbe wie im aggregierten Ergebnis. */
  proAntwort: Array<{ optionId: string; antwort: string; position: number; stimmen: number }>;
}

/**
 * Wer fuer welche Antwort gestimmt hat.
 *
 * ## Warum das eine eigene Funktion ist und nicht ein Feld an `ladeAbstimmung`
 *
 * Weil der Unterschied zwischen «oeffentlich» und «nur fuer Berechtigte»
 * nicht in der Oberflaeche entschieden werden darf. Haenge ich die Namen als
 * optionales Feld an das Ergebnis, dann steht irgendwann eine Seite, die es
 * mitlaedt und «nur nicht anzeigt» - und damit stehen die Namen im HTML,
 * das jeder Besucher bekommt. Die Trennung ist deshalb eine Trennung der
 * **Abfragen**: wer hier nichts aufruft, hat die Daten nicht.
 *
 * `ladeAbstimmung`, `ladeAbgeschlossene`, `ladeUebersicht` und
 * `ladeBeteiligung` fassen `voterDiscordId` weiterhin nicht an. Die einzige
 * andere Stelle, die es tut, ist `eigeneStimme` - und die antwortet nur ueber
 * die Person, die selbst fragt.
 *
 * ## Warum hier keine Berechtigung geprueft wird
 *
 * Weil dieses Paket keine Sitzung kennt. Die Pruefung sitzt an der Stelle,
 * die eine hat - die Seite, die `fragt.votes.detail` verlangt, ehe sie diese
 * Funktion ueberhaupt aufruft. Ein Test haelt fest, dass keine andere
 * Abfrage des Moduls `voterDiscordId` herausgibt.
 */
export async function ladeStimmenDetail(
  abstimmungId: string,
  optionen: { optionId?: string; suche?: string } = {},
): Promise<StimmenDetail> {
  /*
   * Immer alle Stimmen dieser Abstimmung.
   *
   * Antwortfilter und Suche greifen erst weiter unten, in JavaScript - und
   * zwar nur auf die Liste, nicht auf die Zahlen. Filterte die Abfrage
   * selbst, zeigte die Suche nach «Anna» eine Antwort mit einer Stimme, und
   * jemand laese daraus ein Ergebnis, das es nicht gibt.
   *
   * Es geht um die Stimmen einer Frage, also um Dutzende bis wenige
   * Hunderte. Das ist eine Abfrage und keine Last.
   */
  const stimmen = await prisma.fragtStimme.findMany({
    where: { abstimmungId },
    orderBy: { createdAt: 'asc' },
    select: {
      optionId: true,
      voterDiscordId: true,
      createdAt: true,
      updatedAt: true,
      option: { select: { label: true, position: true } },
    },
  });

  /*
   * Die Namen kommen aus dem bestehenden Mitglieder-Abgleich.
   *
   * Eine Abfrage fuer alle statt einer je Stimme: bei zweihundert Stimmen
   * waeren das zweihundert Abfragen fuer eine Auskunft, die eine beantwortet.
   * Und keine eigene Namenstabelle - `FragtStimme` speichert bewusst nur die
   * Kennung, damit eine Umbenennung nicht in jeder alten Abstimmung
   * nachgezogen werden muss.
   */
  const kennungen = [...new Set(stimmen.map((stimme) => stimme.voterDiscordId))];
  const mitglieder =
    kennungen.length > 0
      ? await prisma.discordMemberCache.findMany({
          where: { discordId: { in: kennungen } },
          select: { discordId: true, displayName: true },
        })
      : [];
  const namen = new Map(mitglieder.map((eintrag) => [eintrag.discordId, eintrag.displayName]));

  const suche = optionen.suche?.trim().toLowerCase() ?? '';
  const zeilen: StimmenDetailZeile[] = stimmen
    .map((stimme) => ({
      optionId: stimme.optionId,
      antwort: stimme.option.label,
      position: stimme.option.position,
      discordId: stimme.voterDiscordId,
      name: namen.get(stimme.voterDiscordId) ?? null,
      abgegebenAm: stimme.createdAt,
      /*
       * Eine geaenderte Meinung ist eine Auskunft.
       *
       * Eine Stimme zu aendern ist ein `update` derselben Zeile - deshalb
       * liegt der Unterschied zwischen `createdAt` und `updatedAt` und nicht
       * in einer zweiten Zeile. Die Sekunde Toleranz faengt den Fall ab, dass
       * beide Zeitstempel beim Anlegen minimal auseinanderliegen.
       */
      geaendert: stimme.updatedAt.getTime() - stimme.createdAt.getTime() > 1000,
    }))
    .filter((zeile) => {
      if (optionen.optionId && zeile.optionId !== optionen.optionId) {
        return false;
      }
      if (!suche) {
        return true;
      }
      return (zeile.name ?? '').toLowerCase().includes(suche) || zeile.discordId.includes(suche);
    });

  // Die Zahlen je Antwort ueber ALLE Stimmen - siehe oben.
  const proAntwort = new Map<
    string,
    { optionId: string; antwort: string; position: number; stimmen: number }
  >();
  for (const stimme of stimmen) {
    const eintrag = proAntwort.get(stimme.optionId) ?? {
      optionId: stimme.optionId,
      antwort: stimme.option.label,
      position: stimme.option.position,
      stimmen: 0,
    };
    eintrag.stimmen += 1;
    proAntwort.set(stimme.optionId, eintrag);
  }

  return {
    zeilen,
    proAntwort: [...proAntwort.values()].sort((links, rechts) => links.position - rechts.position),
  };
}
