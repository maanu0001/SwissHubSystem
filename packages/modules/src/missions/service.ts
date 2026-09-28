/**
 * Missionen und Vorlagen anlegen, aendern, abbrechen.
 *
 * ## Was hier nicht steht
 *
 * Keine Regelmaschine. Eine Mission ist ein Typ, eine Zahl und ein Zeitraum -
 * mehr braucht sie nicht, und mehr laesst sich in unter einer Minute auch
 * nicht eingeben. Wer spaeter «mindestens 3 Clips ODER 200 Nachrichten»
 * braucht, legt zwei Missionen an.
 */
import { AUDIT_ACTIONS, prisma, safeRecordAudit, type Prisma } from '@swisshub/database';
import { AppError } from '@swisshub/shared';
import { MISSIONS_MODULE_ID } from './config';
import { missionTyp, type MissionTypKey } from './typen';
import { missionswoche } from './woche';

export type MissionArtKey = 'WOCHE' | 'CHALLENGE';

export interface MissionEingabe {
  guildId: string;
  art: MissionArtKey;
  typ: MissionTypKey;
  titel: string;
  beschreibung?: string | null;
  ziel: number;
  mindestBeitrag: number;
  beginntAm: Date;
  endetAm: Date;
  belohnungXp: number;
  belohnungPremiumTage: number;
  belohnungAuszeichnung?: string | null;
  vorlageId?: string | null;
}

export interface Akteur {
  discordId: string | null;
  username: string | null;
}

/**
 * Die Grenzen der Eingabe - an einer Stelle, serverseitig.
 *
 * Nicht im Formular: das Formular ist die Bequemlichkeit, diese Funktion ist
 * die Regel. Eine Anfrage, die am Formular vorbeigeht, kommt hier nicht
 * weiter als eine ordentliche.
 */
export function pruefeEingabe(eingabe: MissionEingabe): void {
  const typ = missionTyp(eingabe.typ);
  if (!typ) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Dieser Missionstyp ist nicht bekannt.',
      internalMessage: `Unbekannter Missionstyp ${eingabe.typ}`,
    });
  }

  if (eingabe.art === 'CHALLENGE' && !typ.summierbar) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: `«${typ.label}» lässt sich nicht als Community Challenge zusammenzählen. Nimm dafür eine Wochenmission.`,
    });
  }

  if (!eingabe.titel.trim()) {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Die Mission braucht einen Titel.' });
  }

  if (!Number.isInteger(eingabe.ziel) || eingabe.ziel < 1) {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Das Ziel muss mindestens 1 sein.' });
  }

  if (eingabe.art === 'CHALLENGE' && eingabe.mindestBeitrag < 1) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage:
        'Der Mindestbeitrag muss mindestens 1 sein - sonst wird belohnt, wer nichts beigetragen hat.',
    });
  }

  if (eingabe.endetAm.getTime() <= eingabe.beginntAm.getTime()) {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Das Ende muss nach dem Beginn liegen.' });
  }

  if (eingabe.belohnungXp < 0 || eingabe.belohnungPremiumTage < 0) {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Eine Belohnung kann nicht negativ sein.' });
  }
}

/** Eine Mission anlegen. Geplant oder sofort laufend, je nach Beginn. */
export async function erstelleMission(akteur: Akteur, eingabe: MissionEingabe, jetzt = new Date()) {
  pruefeEingabe(eingabe);

  const mission = await prisma.mission.create({
    data: {
      guildId: eingabe.guildId,
      art: eingabe.art,
      typ: eingabe.typ,
      titel: eingabe.titel.trim(),
      beschreibung: eingabe.beschreibung?.trim() || null,
      ziel: eingabe.ziel,
      mindestBeitrag: eingabe.art === 'CHALLENGE' ? eingabe.mindestBeitrag : 1,
      beginntAm: eingabe.beginntAm,
      endetAm: eingabe.endetAm,
      status: eingabe.beginntAm.getTime() <= jetzt.getTime() ? 'LAEUFT' : 'GEPLANT',
      belohnungXp: eingabe.belohnungXp,
      belohnungPremiumTage: eingabe.belohnungPremiumTage,
      belohnungAuszeichnung: eingabe.belohnungAuszeichnung || null,
      vorlageId: eingabe.vorlageId || null,
      erstelltVonDiscordId: akteur.discordId,
    },
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.MISSION_ERSTELLT,
    module: MISSIONS_MODULE_ID,
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username,
    targetLabel: mission.titel,
    success: true,
    metadata: { missionId: mission.id, art: mission.art, typ: mission.typ, ziel: mission.ziel },
  });

  return mission;
}

/**
 * Eine Mission aendern.
 *
 * Nur solange sie nicht abgeschlossen ist. Eine abgeschlossene Mission ist
 * Geschichte: ihre Belohnungen sind vergeben, und ein nachtraeglich
 * gesenktes Ziel wuerde eine Liste von Gewinnern erzeugen, die es nie gab.
 */
export async function aendereMission(
  akteur: Akteur,
  missionId: string,
  aenderung: Partial<
    Pick<
      MissionEingabe,
      | 'titel'
      | 'beschreibung'
      | 'ziel'
      | 'mindestBeitrag'
      | 'endetAm'
      | 'belohnungXp'
      | 'belohnungPremiumTage'
      | 'belohnungAuszeichnung'
    >
  >,
) {
  const vorher = await prisma.mission.findUnique({ where: { id: missionId } });
  if (!vorher) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Mission gibt es nicht.' });
  }
  if (vorher.status === 'ABGESCHLOSSEN' || vorher.status === 'ABGEBROCHEN') {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Diese Mission ist beendet und lässt sich nicht mehr ändern.',
    });
  }

  const daten: Prisma.MissionUpdateInput = {};
  if (aenderung.titel !== undefined) {
    if (!aenderung.titel.trim()) {
      throw new AppError('VALIDATION_FAILED', { userMessage: 'Die Mission braucht einen Titel.' });
    }
    daten.titel = aenderung.titel.trim();
  }
  if (aenderung.beschreibung !== undefined) {
    daten.beschreibung = aenderung.beschreibung?.trim() || null;
  }
  if (aenderung.ziel !== undefined) {
    if (!Number.isInteger(aenderung.ziel) || aenderung.ziel < 1) {
      throw new AppError('VALIDATION_FAILED', { userMessage: 'Das Ziel muss mindestens 1 sein.' });
    }
    daten.ziel = aenderung.ziel;
  }
  if (aenderung.mindestBeitrag !== undefined) {
    daten.mindestBeitrag = Math.max(1, aenderung.mindestBeitrag);
  }
  if (aenderung.endetAm !== undefined) {
    if (aenderung.endetAm.getTime() <= vorher.beginntAm.getTime()) {
      throw new AppError('VALIDATION_FAILED', { userMessage: 'Das Ende muss nach dem Beginn liegen.' });
    }
    daten.endetAm = aenderung.endetAm;
  }
  if (aenderung.belohnungXp !== undefined) {
    daten.belohnungXp = Math.max(0, aenderung.belohnungXp);
  }
  if (aenderung.belohnungPremiumTage !== undefined) {
    daten.belohnungPremiumTage = Math.max(0, aenderung.belohnungPremiumTage);
  }
  if (aenderung.belohnungAuszeichnung !== undefined) {
    daten.belohnungAuszeichnung = aenderung.belohnungAuszeichnung || null;
  }

  const mission = await prisma.mission.update({ where: { id: missionId }, data: daten });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.MISSION_GEAENDERT,
    module: MISSIONS_MODULE_ID,
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username,
    targetLabel: mission.titel,
    success: true,
    metadata: { missionId, geaendert: Object.keys(daten) },
  });

  return mission;
}

/**
 * Eine Mission abbrechen.
 *
 * ABGEBROCHEN ist bewusst etwas anderes als ABGESCHLOSSEN: es wird nichts
 * belohnt. Der Fortschritt bleibt stehen, damit nachvollziehbar ist, wie
 * weit die Community war, als jemand den Stecker zog.
 */
export async function brichAb(akteur: Akteur, missionId: string, jetzt = new Date()): Promise<boolean> {
  /*
   * Bedingt, aus demselben Grund wie beim Abschluss: eine laufende Mission
   * darf nicht abgebrochen werden, waehrend ein Durchgang sie gerade
   * abschliesst. Wer den Statuswechsel gewinnt, hat entschieden.
   */
  const geaendert = await prisma.mission.updateMany({
    where: { id: missionId, status: { in: ['ENTWURF', 'GEPLANT', 'LAEUFT'] } },
    data: { status: 'ABGEBROCHEN', abgeschlossenAm: jetzt },
  });
  if (geaendert.count !== 1) {
    return false;
  }

  const mission = await prisma.mission.findUnique({ where: { id: missionId } });
  await safeRecordAudit({
    action: AUDIT_ACTIONS.MISSION_ABGEBROCHEN,
    module: MISSIONS_MODULE_ID,
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username,
    targetLabel: mission?.titel ?? missionId,
    success: true,
    metadata: { missionId },
  });
  return true;
}

// ---------------------------------------------------------------------------
// Vorlagen
// ---------------------------------------------------------------------------

export interface VorlagenEingabe {
  name: string;
  art: MissionArtKey;
  typ: MissionTypKey;
  titel: string;
  beschreibung?: string | null;
  ziel: number;
  mindestBeitrag: number;
  belohnungXp: number;
  belohnungPremiumTage: number;
  belohnungAuszeichnung?: string | null;
}

export async function speichereVorlage(akteur: Akteur, eingabe: VorlagenEingabe, id?: string) {
  const typ = missionTyp(eingabe.typ);
  if (!typ) {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Dieser Missionstyp ist nicht bekannt.' });
  }
  if (eingabe.art === 'CHALLENGE' && !typ.summierbar) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: `«${typ.label}» lässt sich nicht als Community Challenge zusammenzählen.`,
    });
  }
  if (!eingabe.name.trim() || !eingabe.titel.trim()) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Die Vorlage braucht einen Namen und einen Titel.',
    });
  }
  if (!Number.isInteger(eingabe.ziel) || eingabe.ziel < 1) {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Das Ziel muss mindestens 1 sein.' });
  }

  const daten = {
    name: eingabe.name.trim(),
    art: eingabe.art,
    typ: eingabe.typ,
    titel: eingabe.titel.trim(),
    beschreibung: eingabe.beschreibung?.trim() || null,
    ziel: eingabe.ziel,
    mindestBeitrag: Math.max(1, eingabe.mindestBeitrag),
    belohnungXp: Math.max(0, eingabe.belohnungXp),
    belohnungPremiumTage: Math.max(0, eingabe.belohnungPremiumTage),
    belohnungAuszeichnung: eingabe.belohnungAuszeichnung || null,
  };

  const vorlage = id
    ? await prisma.missionVorlage.update({ where: { id }, data: daten })
    : await prisma.missionVorlage.create({ data: daten });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.MISSION_VORLAGE_GESPEICHERT,
    module: MISSIONS_MODULE_ID,
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username,
    targetLabel: vorlage.name,
    success: true,
    metadata: { vorlageId: vorlage.id, neu: !id },
  });

  return vorlage;
}

/**
 * Eine Vorlage ausmustern.
 *
 * Nicht loeschen: Missionen zeigen auf ihre Vorlage, und eine geloeschte
 * Vorlage naehme ihnen die Herkunft. `aktiv: false` nimmt sie aus der
 * Auswahl, mehr braucht es nicht.
 */
export async function musterVorlageAus(akteur: Akteur, id: string): Promise<void> {
  const vorlage = await prisma.missionVorlage.update({ where: { id }, data: { aktiv: false } });
  await safeRecordAudit({
    action: AUDIT_ACTIONS.MISSION_VORLAGE_ENTFERNT,
    module: MISSIONS_MODULE_ID,
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username,
    targetLabel: vorlage.name,
    success: true,
    metadata: { vorlageId: id },
  });
}

/**
 * Aus einer Vorlage eine Mission fuer die laufende Missionswoche machen.
 *
 * Das ist der Weg, der «unter einer Minute» moeglich machen soll: Vorlage
 * waehlen, fertig. Beginn und Ende kommen aus dem eingestellten
 * Wochenrhythmus, nicht aus einem Formular.
 */
export async function ausVorlage(
  akteur: Akteur,
  vorlageId: string,
  guildId: string,
  wochenstartTag: number,
  wochenstartStunde: number,
  jetzt = new Date(),
) {
  const vorlage = await prisma.missionVorlage.findUnique({ where: { id: vorlageId } });
  if (!vorlage) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Vorlage gibt es nicht.' });
  }

  const woche = missionswoche(jetzt, wochenstartTag, wochenstartStunde);

  return erstelleMission(
    akteur,
    {
      guildId,
      art: vorlage.art,
      typ: vorlage.typ as MissionTypKey,
      titel: vorlage.titel,
      beschreibung: vorlage.beschreibung,
      ziel: vorlage.ziel,
      mindestBeitrag: vorlage.mindestBeitrag,
      beginntAm: woche.beginn,
      endetAm: woche.ende,
      belohnungXp: vorlage.belohnungXp,
      belohnungPremiumTage: vorlage.belohnungPremiumTage,
      belohnungAuszeichnung: vorlage.belohnungAuszeichnung,
      vorlageId: vorlage.id,
    },
    jetzt,
  );
}
