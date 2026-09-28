/**
 * Was die Oberflaeche zu sehen bekommt.
 *
 * Fertig gerechnete Ansichten statt roher Zeilen: der Fortschritt in Prozent,
 * der Rest bis zum Ziel, die Zahl derer, die es geschafft haben. Alles
 * serverseitig - eine Mitgliederansicht, die den eigenen Fortschritt im
 * Browser errechnet, waere eine zweite Wahrheit ueber dieselbe Zahl.
 */
import { prisma } from '@swisshub/database';
import { MISSIONS_MODULE_ID, type MissionsSettings } from './config';
import { getModuleSettings } from '../module-state';
import { missionTyp } from './typen';

export interface MissionsAnsicht {
  id: string;
  art: 'WOCHE' | 'CHALLENGE';
  typ: string;
  /** Der Typ im Klartext - keine Kennung, kein Ereignisname. */
  typLabel: string;
  einheit: string;
  erklaerung: string;
  titel: string;
  beschreibung: string | null;
  ziel: number;
  mindestBeitrag: number;
  beginntAm: Date;
  endetAm: Date;
  status: string;
  belohnungXp: number;
  belohnungPremiumTage: number;
  belohnungAuszeichnung: string | null;
  /** Der eigene Stand - bei einer Challenge der eigene Beitrag. */
  eigenerWert: number;
  /** Bei einer Challenge der Stand des ganzen Servers, sonst der eigene. */
  stand: number;
  /** 0 bis 100, bereits gedeckelt. */
  prozent: number;
  erfuellt: boolean;
  /** Wie viele Mitglieder mitgemacht haben. */
  teilnehmende: number;
}

function prozentVon(stand: number, ziel: number): number {
  if (ziel <= 0) {
    return 100;
  }
  return Math.min(100, Math.round((stand / ziel) * 100));
}

/**
 * Die Missionen eines Servers, fertig fuer die Anzeige.
 *
 * `fuerDiscordId` entscheidet, wessen Fortschritt eingesetzt wird. Ohne
 * Angabe bleibt der eigene Wert null - das ist die Verwaltungssicht, in der
 * es keinen «eigenen» Fortschritt gibt.
 */
export async function ansicht(
  guildId: string,
  status: ('ENTWURF' | 'GEPLANT' | 'LAEUFT' | 'ABGESCHLOSSEN' | 'ABGEBROCHEN')[],
  fuerDiscordId?: string | null,
  grenze = 50,
): Promise<MissionsAnsicht[]> {
  const missionen = await prisma.mission.findMany({
    where: { guildId, status: { in: status } },
    orderBy: [{ endetAm: 'asc' }, { createdAt: 'desc' }],
    take: grenze,
  });
  if (missionen.length === 0) {
    return [];
  }

  const ids = missionen.map((mission) => mission.id);

  /*
   * Summe und Zahl der Teilnehmenden in einer Abfrage ueber alle Missionen,
   * nicht in einer je Mission: bei zwoelf Missionen waeren das zwoelf
   * Roundtrips fuer eine Seite, die jemand beim Laden ansieht.
   */
  const [summen, eigene] = await Promise.all([
    prisma.missionFortschritt.groupBy({
      by: ['missionId'],
      where: { missionId: { in: ids } },
      _sum: { wert: true },
      _count: { _all: true },
    }),
    fuerDiscordId
      ? prisma.missionFortschritt.findMany({
          where: { missionId: { in: ids }, discordId: fuerDiscordId },
          select: { missionId: true, wert: true },
        })
      : Promise.resolve([]),
  ]);

  const summeNach = new Map(summen.map((zeile) => [zeile.missionId, zeile._sum.wert ?? 0]));
  const anzahlNach = new Map(summen.map((zeile) => [zeile.missionId, zeile._count._all]));
  const eigenNach = new Map(eigene.map((zeile) => [zeile.missionId, zeile.wert]));

  return missionen.map((mission) => {
    const typ = missionTyp(mission.typ);
    const eigenerWert = eigenNach.get(mission.id) ?? 0;
    const stand = mission.art === 'CHALLENGE' ? (summeNach.get(mission.id) ?? 0) : eigenerWert;
    return {
      id: mission.id,
      art: mission.art,
      typ: mission.typ,
      // Fallback statt Kennung: ein Typ, den es nicht mehr gibt, soll in der
      // Oberflaeche nicht als `VOICE_MINUTEN` erscheinen.
      typLabel: typ?.label ?? 'Unbekannter Typ',
      einheit: typ?.einheit ?? '',
      erklaerung: typ?.erklaerung ?? '',
      titel: mission.titel,
      beschreibung: mission.beschreibung,
      ziel: mission.ziel,
      mindestBeitrag: mission.mindestBeitrag,
      beginntAm: mission.beginntAm,
      endetAm: mission.endetAm,
      status: mission.status,
      belohnungXp: mission.belohnungXp,
      belohnungPremiumTage: mission.belohnungPremiumTage,
      belohnungAuszeichnung: mission.belohnungAuszeichnung,
      eigenerWert,
      stand,
      prozent: prozentVon(stand, mission.ziel),
      erfuellt:
        mission.art === 'CHALLENGE'
          ? stand >= mission.ziel && eigenerWert >= Math.max(1, mission.mindestBeitrag)
          : eigenerWert >= mission.ziel,
      teilnehmende: anzahlNach.get(mission.id) ?? 0,
    };
  });
}

/** Die Zahlen fuer die Uebersicht der Verwaltung. */
export async function uebersicht(guildId: string): Promise<{
  laufend: number;
  geplant: number;
  abgeschlossen: number;
  belohnungenGesamt: number;
  xpGesamt: number;
}> {
  const [laufend, geplant, abgeschlossen, belohnungen] = await Promise.all([
    prisma.mission.count({ where: { guildId, status: 'LAEUFT' } }),
    prisma.mission.count({ where: { guildId, status: 'GEPLANT' } }),
    prisma.mission.count({ where: { guildId, status: 'ABGESCHLOSSEN' } }),
    prisma.missionBelohnung.aggregate({
      where: { mission: { guildId } },
      _count: { _all: true },
      _sum: { xp: true },
    }),
  ]);

  return {
    laufend,
    geplant,
    abgeschlossen,
    belohnungenGesamt: belohnungen._count._all,
    xpGesamt: belohnungen._sum.xp ?? 0,
  };
}

/** Die aktiven Vorlagen, fuer die Auswahl beim Anlegen. */
export async function aktiveVorlagen() {
  return prisma.missionVorlage.findMany({ where: { aktiv: true }, orderBy: { name: 'asc' } });
}

export async function alleVorlagen() {
  return prisma.missionVorlage.findMany({ orderBy: [{ aktiv: 'desc' }, { name: 'asc' }] });
}

/**
 * Die Bestenliste einer Mission.
 *
 * Nur fuer die Verwaltung und nur die obersten Zehn: eine vollstaendige
 * Rangliste aller Mitglieder waere eine Tabelle, die auf dem Telefon
 * niemand liest, und eine Rangliste im Mitgliederbereich machte aus einer
 * gemeinsamen Mission einen Wettbewerb.
 */
export async function bestenliste(missionId: string, grenze = 10) {
  return prisma.missionFortschritt.findMany({
    where: { missionId },
    orderBy: { wert: 'desc' },
    take: grenze,
  });
}

/** Die Einstellungen des Moduls - eine Zeile, damit jede Stelle dieselbe liest. */
export const einstellungen = (): Promise<MissionsSettings> =>
  getModuleSettings<MissionsSettings>(MISSIONS_MODULE_ID);
