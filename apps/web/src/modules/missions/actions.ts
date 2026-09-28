'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { resolveGuildId } from '@swisshub/discord';
import { missions } from '@swisshub/modules';
import { AppError, systemRoutes } from '@swisshub/shared';
import { defineAction } from '@/server/action';
import type { AuthContext } from '@swisshub/auth';

/**
 * Die Schreibvorgaenge der Missionsverwaltung.
 *
 * Jede Aktion geht durch `defineAction` und damit durch dieselbe Pruefung
 * wie jede andere im System: Berechtigung, CSRF, Ratenbegrenzung,
 * Protokoll. Keine Abkuerzung, keine eigene Pruefung - was hier steht, ist
 * die Uebersetzung von einem Formular auf den Modulkern, mehr nicht.
 *
 * Die Berechtigung steht an jeder Aktion einzeln und nicht nur an der
 * Seite. Eine Aktion ist ein eigener Einstieg; wer die Adresse kennt, ruft
 * sie auf, ohne die Seite je gesehen zu haben.
 */

const akteur = (ctx: AuthContext): missions.Akteur => ({
  discordId: ctx.user.discordId,
  username: ctx.user.username,
});

const neuLaden = (): void => {
  revalidatePath(systemRoutes.missionen());
  revalidatePath(systemRoutes.missionenVerwaltung());
  revalidatePath(systemRoutes.missionenVorlagen());
};

async function guild(): Promise<string> {
  const guildId = await resolveGuildId().catch(() => null);
  if (!guildId) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Der Discord-Server ist gerade nicht erreichbar. Versuch es gleich noch einmal.',
    });
  }
  return guildId;
}

const ART = z.enum(['WOCHE', 'CHALLENGE']);
const TYP = z.enum([
  'VOICE_MINUTEN',
  'NACHRICHTEN',
  'CLIP_EINGEREICHT',
  'TURNIER_TEILNAHME',
  'PROFIL_VOLLSTAENDIG',
  'LEVEL_ERREICHT',
]);

/**
 * Die Obergrenzen.
 *
 * Nicht, weil jemand sie brauchte, sondern weil eine vertippte Null sonst
 * eine Mission mit 50'000 XP Belohnung erzeugt - und die waere vergeben,
 * bevor es auffaellt.
 */
const missionsFelder = {
  titel: z.string().trim().min(1).max(120),
  beschreibung: z.string().trim().max(500).nullish(),
  ziel: z.coerce.number().int().min(1).max(1_000_000),
  mindestBeitrag: z.coerce.number().int().min(1).max(1_000_000).default(1),
  belohnungXp: z.coerce.number().int().min(0).max(10_000).default(0),
  belohnungPremiumTage: z.coerce.number().int().min(0).max(90).default(0),
  belohnungAuszeichnung: z.string().trim().max(80).nullish(),
};

export const missionErstellenAction = defineAction(
  {
    name: 'missions.create',
    module: missions.MISSIONS_MODULE_ID,
    permission: missions.MISSIONS_PERMISSIONS.manage,
    schema: z.object({
      art: ART,
      typ: TYP,
      ...missionsFelder,
      /*
       * Die Zeiten kommen als ISO-Zeichenkette aus dem Formular. `coerce.date`
       * statt eines eigenen Parsers: dieselbe Umwandlung wie ueberall sonst,
       * und ein ungueltiges Datum ist ein Eingabefehler, kein Absturz.
       */
      beginntAm: z.coerce.date(),
      endetAm: z.coerce.date(),
    }),
    rateLimit: 'missionenVerwalten',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const mission = await missions.erstelleMission(akteur(ctx), {
      guildId: await guild(),
      art: input.art,
      typ: input.typ,
      titel: input.titel,
      beschreibung: input.beschreibung ?? null,
      ziel: input.ziel,
      mindestBeitrag: input.mindestBeitrag,
      beginntAm: input.beginntAm,
      endetAm: input.endetAm,
      belohnungXp: input.belohnungXp,
      belohnungPremiumTage: input.belohnungPremiumTage,
      belohnungAuszeichnung: input.belohnungAuszeichnung ?? null,
    });
    neuLaden();
    return { missionId: mission.id };
  },
);

export const missionAusVorlageAction = defineAction(
  {
    name: 'missions.fromTemplate',
    module: missions.MISSIONS_MODULE_ID,
    permission: missions.MISSIONS_PERMISSIONS.manage,
    schema: z.object({ vorlageId: z.string().cuid() }),
    rateLimit: 'missionenVerwalten',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const einstellungen = await missions.einstellungen();
    const mission = await missions.ausVorlage(
      akteur(ctx),
      input.vorlageId,
      await guild(),
      einstellungen.wochenstartTag,
      einstellungen.wochenstartStunde,
    );
    neuLaden();
    return { missionId: mission.id };
  },
);

export const missionAendernAction = defineAction(
  {
    name: 'missions.update',
    module: missions.MISSIONS_MODULE_ID,
    permission: missions.MISSIONS_PERMISSIONS.manage,
    schema: z.object({
      missionId: z.string().cuid(),
      titel: missionsFelder.titel.optional(),
      beschreibung: missionsFelder.beschreibung,
      ziel: missionsFelder.ziel.optional(),
      mindestBeitrag: z.coerce.number().int().min(1).max(1_000_000).optional(),
      endetAm: z.coerce.date().optional(),
      belohnungXp: z.coerce.number().int().min(0).max(10_000).optional(),
      belohnungPremiumTage: z.coerce.number().int().min(0).max(90).optional(),
      belohnungAuszeichnung: missionsFelder.belohnungAuszeichnung,
    }),
    rateLimit: 'missionenVerwalten',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const { missionId, ...aenderung } = input;
    await missions.aendereMission(akteur(ctx), missionId, {
      ...aenderung,
      beschreibung: aenderung.beschreibung ?? undefined,
      belohnungAuszeichnung: aenderung.belohnungAuszeichnung ?? undefined,
    });
    neuLaden();
    return { geaendert: true };
  },
);

export const missionAbbrechenAction = defineAction(
  {
    name: 'missions.cancel',
    module: missions.MISSIONS_MODULE_ID,
    permission: missions.MISSIONS_PERMISSIONS.manage,
    schema: z.object({ missionId: z.string().cuid() }),
    rateLimit: 'missionenVerwalten',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const abgebrochen = await missions.brichAb(akteur(ctx), input.missionId);
    neuLaden();
    return { abgebrochen };
  },
);

export const vorlageSpeichernAction = defineAction(
  {
    name: 'missions.templateSave',
    module: missions.MISSIONS_MODULE_ID,
    permission: missions.MISSIONS_PERMISSIONS.manage,
    schema: z.object({
      id: z.string().cuid().nullish(),
      name: z.string().trim().min(1).max(80),
      art: ART,
      typ: TYP,
      ...missionsFelder,
    }),
    rateLimit: 'missionenVerwalten',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const vorlage = await missions.speichereVorlage(
      akteur(ctx),
      {
        name: input.name,
        art: input.art,
        typ: input.typ,
        titel: input.titel,
        beschreibung: input.beschreibung ?? null,
        ziel: input.ziel,
        mindestBeitrag: input.mindestBeitrag,
        belohnungXp: input.belohnungXp,
        belohnungPremiumTage: input.belohnungPremiumTage,
        belohnungAuszeichnung: input.belohnungAuszeichnung ?? null,
      },
      input.id ?? undefined,
    );
    neuLaden();
    return { vorlageId: vorlage.id };
  },
);

export const vorlageAusmusternAction = defineAction(
  {
    name: 'missions.templateRetire',
    module: missions.MISSIONS_MODULE_ID,
    permission: missions.MISSIONS_PERMISSIONS.manage,
    schema: z.object({ vorlageId: z.string().cuid() }),
    rateLimit: 'missionenVerwalten',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await missions.musterVorlageAus(akteur(ctx), input.vorlageId);
    neuLaden();
    return { ausgemustert: true };
  },
);
