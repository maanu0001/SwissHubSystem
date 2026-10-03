import {
  AUDIT_ACTIONS,
  prisma,
  recordAudit,
  type XpSlotSound,
  type XpSlotSoundPack,
  type XpSlotSoundPackKind,
} from '@swisshub/database';
import { conflict, notFound } from '@swisshub/shared';
import { LEVEL_MODULE_ID } from '../config';
import { istKlangSlot, KLANG_SLOTS, MUSIK_SLOTS } from './vorgaben';
import { loescheKlang } from './klang-speicher';

/**
 * Sound-Pakete.
 *
 * ## Warum Pakete und nicht einzelne Klaenge
 *
 * Weil ein Event nicht zwanzig Dateien austauscht, sondern eine Stimmung. Ein
 * Paket ist ein vollstaendiger Satz; umgeschaltet wird eines, nicht zwanzig.
 * Ein Event kann sein eigenes Paket mitbringen - danach gilt wieder das
 * eingestellte, ohne dass jemand etwas zuruecksetzt.
 *
 * ## Warum ein fehlender Klang kein Fehler ist
 *
 * Ein Paket muss nicht vollstaendig sein. Wer nur den Jackpot ersetzen will,
 * legt ein Paket mit einem Klang an; die uebrigen Slots bleiben still. Die
 * Oberflaeche prueft das bei jedem Abspielen: ein Slot ohne Datei spielt
 * nichts, und **kein** Tonproblem haelt je einen Spin auf. Das ist die
 * Anforderung aus dem Konzept, und sie steht hier, weil die Entscheidung
 * hierher gehoert - nicht in zwanzig Aufrufstellen.
 */

/** Ein Paket mit seinen Klaengen, wie die Verwaltung es sieht. */
export interface PaketAnsicht {
  id: string;
  name: string;
  art: XpSlotSoundPackKind;
  aktiv: boolean;
  belegt: number;
  klaenge: Array<{
    slot: string;
    label: string;
    gruppe: string;
    musik: boolean;
    dateiname: string | null;
    lautstaerke: number;
    an: boolean;
  }>;
}

export const PAKET_ARTEN: ReadonlyArray<{ key: XpSlotSoundPackKind; label: string }> = [
  { key: 'STANDARD', label: 'Standard' },
  { key: 'EVENT', label: 'Event' },
  { key: 'SPECIAL', label: 'Special' },
];

/** Alle Pakete, aufbereitet. */
export async function pakete(aktivId: string | null): Promise<PaketAnsicht[]> {
  const zeilen = await prisma.xpSlotSoundPack.findMany({
    orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    include: { sounds: true },
  });
  return zeilen.map((zeile) => alsAnsicht(zeile, zeile.sounds, zeile.id === aktivId));
}

function alsAnsicht(paket: XpSlotSoundPack, klaenge: readonly XpSlotSound[], aktiv: boolean): PaketAnsicht {
  const nachSlot = new Map(klaenge.map((eintrag) => [eintrag.slot, eintrag]));
  return {
    id: paket.id,
    name: paket.name,
    art: paket.kind,
    aktiv,
    belegt: klaenge.filter((eintrag) => eintrag.enabled).length,
    klaenge: KLANG_SLOTS.map((slot) => {
      const eintrag = nachSlot.get(slot.key);
      return {
        slot: slot.key,
        label: slot.label,
        gruppe: slot.gruppe,
        musik: MUSIK_SLOTS.includes(slot.key),
        dateiname: eintrag?.filePath ?? null,
        lautstaerke: eintrag?.volume ?? 80,
        an: eintrag?.enabled ?? true,
      };
    }),
  };
}

/**
 * Die Klaenge, die die Oberflaeche braucht.
 *
 * Nur die, die eingeschaltet sind und eine Datei haben - ein Slot ohne Datei
 * taucht gar nicht auf, und die Oberflaeche muss nicht unterscheiden
 * zwischen «nicht eingerichtet» und «abgeschaltet». Beides ist still.
 */
export async function klaengeDesPakets(
  packId: string | null,
): Promise<Array<{ slot: string; dateiname: string; lautstaerke: number; musik: boolean }>> {
  if (!packId) {
    return [];
  }
  const zeilen = await prisma.xpSlotSound.findMany({ where: { packId, enabled: true } });
  return zeilen
    .filter((zeile) => istKlangSlot(zeile.slot))
    .map((zeile) => ({
      slot: zeile.slot,
      dateiname: zeile.filePath,
      lautstaerke: zeile.volume,
      musik: MUSIK_SLOTS.includes(zeile.slot),
    }));
}

export interface KlangAkteur {
  discordId: string;
  username?: string | null;
}

export async function legePaketAn(
  name: string,
  art: XpSlotSoundPackKind,
  akteur: KlangAkteur,
): Promise<XpSlotSoundPack> {
  const sauber = name.trim();
  if (sauber.length < 2 || sauber.length > 80) {
    throw conflict('Der Name braucht zwischen 2 und 80 Zeichen.');
  }
  const paket = await prisma.xpSlotSoundPack.create({ data: { name: sauber, kind: art } });
  await recordAudit({
    action: AUDIT_ACTIONS.XP_SLOT_SOUNDPACK_CREATED,
    module: LEVEL_MODULE_ID,
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username ?? null,
    targetLabel: sauber,
    success: true,
    metadata: { packId: paket.id, art },
  });
  return paket;
}

export async function benennePaket(
  packId: string,
  name: string,
  art: XpSlotSoundPackKind,
  akteur: KlangAkteur,
): Promise<XpSlotSoundPack> {
  const sauber = name.trim();
  if (sauber.length < 2 || sauber.length > 80) {
    throw conflict('Der Name braucht zwischen 2 und 80 Zeichen.');
  }
  const paket = await prisma.xpSlotSoundPack
    .update({ where: { id: packId }, data: { name: sauber, kind: art } })
    .catch(() => null);
  if (!paket) {
    throw notFound('Dieses Sound-Paket gibt es nicht.');
  }
  await recordAudit({
    action: AUDIT_ACTIONS.XP_SLOT_SOUNDPACK_UPDATED,
    module: LEVEL_MODULE_ID,
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username ?? null,
    targetLabel: sauber,
    success: true,
    metadata: { packId, art },
  });
  return paket;
}

/**
 * Loescht ein Paket samt Dateien.
 *
 * Das aktive Paket laesst sich nicht loeschen: der Slot wuerde still, und
 * niemand wuesste warum. Erst umschalten, dann loeschen.
 */
export async function loeschePaket(packId: string, akteur: KlangAkteur): Promise<void> {
  const config = await prisma.xpSlotConfig.findUnique({ where: { id: 'default' } });
  if (config?.activeSoundPackId === packId) {
    throw conflict('Das aktive Sound-Paket lässt sich nicht löschen. Bitte zuerst ein anderes wählen.');
  }
  const verwendet = await prisma.xpSlotEvent.count({ where: { soundPackId: packId } });
  if (verwendet > 0) {
    throw conflict('Dieses Paket gehört zu einem Eventmodus. Bitte dort zuerst ein anderes wählen.');
  }

  const paket = await prisma.xpSlotSoundPack.findUnique({
    where: { id: packId },
    include: { sounds: true },
  });
  if (!paket) {
    throw notFound('Dieses Sound-Paket gibt es nicht.');
  }

  await prisma.xpSlotSoundPack.delete({ where: { id: packId } });
  // Erst die Zeilen, dann die Dateien: eine Datei ohne Zeile ist Muell, eine
  // Zeile ohne Datei waere ein Klang, der nicht spielt.
  for (const klang of paket.sounds) {
    await loescheKlang(klang.filePath);
  }

  await recordAudit({
    action: AUDIT_ACTIONS.XP_SLOT_SOUNDPACK_DELETED,
    module: LEVEL_MODULE_ID,
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username ?? null,
    targetLabel: paket.name,
    success: true,
    metadata: { packId, klaenge: paket.sounds.length },
  });
}

/** Legt einen Klang in einen Slot - und entfernt die bisherige Datei. */
export async function setzeKlang(
  packId: string,
  slot: string,
  dateiname: string,
  akteur: KlangAkteur,
): Promise<void> {
  if (!istKlangSlot(slot)) {
    throw conflict('Diesen Klangslot gibt es nicht.');
  }
  const paket = await prisma.xpSlotSoundPack.findUnique({ where: { id: packId } });
  if (!paket) {
    throw notFound('Dieses Sound-Paket gibt es nicht.');
  }

  const vorher = await prisma.xpSlotSound.findUnique({ where: { packId_slot: { packId, slot } } });
  await prisma.xpSlotSound.upsert({
    where: { packId_slot: { packId, slot } },
    create: { packId, slot, filePath: dateiname, volume: 80, enabled: true },
    update: { filePath: dateiname, enabled: true },
  });
  if (vorher && vorher.filePath !== dateiname) {
    await loescheKlang(vorher.filePath);
  }

  await recordAudit({
    action: AUDIT_ACTIONS.XP_SLOT_SOUND_REPLACED,
    module: LEVEL_MODULE_ID,
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username ?? null,
    targetLabel: `${paket.name} / ${slot}`,
    success: true,
    metadata: { packId, slot, ersetzt: Boolean(vorher) },
  });
}

/** Lautstaerke und Schalter eines Slots. */
export async function stelleKlang(
  packId: string,
  slot: string,
  werte: { lautstaerke?: number; an?: boolean },
): Promise<void> {
  if (!istKlangSlot(slot)) {
    throw conflict('Diesen Klangslot gibt es nicht.');
  }
  const vorhanden = await prisma.xpSlotSound.findUnique({ where: { packId_slot: { packId, slot } } });
  if (!vorhanden) {
    throw notFound('Für diesen Slot ist keine Datei hinterlegt.');
  }
  await prisma.xpSlotSound.update({
    where: { packId_slot: { packId, slot } },
    data: {
      volume:
        werte.lautstaerke === undefined
          ? undefined
          : Math.max(0, Math.min(100, Math.trunc(werte.lautstaerke))),
      enabled: werte.an,
    },
  });
}

/** Entfernt einen Klang aus einem Slot. */
export async function entferneKlang(packId: string, slot: string): Promise<void> {
  const vorhanden = await prisma.xpSlotSound.findUnique({ where: { packId_slot: { packId, slot } } });
  if (!vorhanden) {
    return;
  }
  await prisma.xpSlotSound.delete({ where: { id: vorhanden.id } });
  await loescheKlang(vorhanden.filePath);
}
