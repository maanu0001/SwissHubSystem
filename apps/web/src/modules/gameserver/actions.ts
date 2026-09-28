'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { AUDIT_ACTIONS, prisma, safeRecordAudit } from '@swisshub/database';
import { gameserver, tournaments } from '@swisshub/modules';
import { AppError } from '@swisshub/shared';
import { defineAction } from '@/server/action';
import type { AuthContext } from '@swisshub/auth';

/**
 * Die Schreibvorgänge der Gameserver-Verwaltung.
 *
 * ## Die Regel, die diese Datei zusammenhält
 *
 * **Keine dieser Aktionen gibt ein Geheimnis zurück.** Kein RCON-Passwort,
 * kein Agent-Token, keine Zugangsdaten des Anbieters. Nicht «wird maskiert»,
 * sondern: kommt nicht vor. Ein Test durchsucht diese Datei danach, und
 * `rconPasswort()` im Orchestrator heisst absichtlich so - wer sie aufruft,
 * tut es sichtbar.
 *
 * Es gibt auch keine Aktion, die ein RCON-Kommando oder einen Shell-Befehl
 * entgegennimmt. Die Match-Aktionen sind eine feste Aufzählung; was sie auf
 * dem Server bewirken, steht im Game Adapter.
 */

const P = tournaments.TOURNAMENT_PERMISSIONS;
const MODUL = tournaments.TOURNAMENTS_MODULE_ID;

const akteur = (ctx: AuthContext) => ({
  discordId: ctx.user.discordId,
  username: ctx.user.username,
});

const neuLaden = (): void => {
  revalidatePath('/turniere/gameserver');
  revalidatePath('/turniere/gameserver/server');
  revalidatePath('/turniere/gameserver/profile');
  revalidatePath('/turniere/gameserver/templates');
  revalidatePath('/turniere/gameserver/infrastruktur');
};

const GAME = z.enum(['CS2']);

// ---------------------------------------------------------------------------
// Infrastruktur
// ---------------------------------------------------------------------------

export const anbieterSpeichernAction = defineAction(
  {
    name: 'gameserver.providerSave',
    module: MODUL,
    permission: P.infrastructureManage,
    schema: z.object({
      id: z.string().cuid().nullish(),
      name: z.string().trim().min(1).max(80),
      driver: z.string().trim().min(1).max(60),
      region: z.string().trim().max(60).nullish(),
      enabled: z.boolean().default(false),
    }),
    rateLimit: 'gameserverVerwalten',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    if (!gameserver.anbieterTreiber(input.driver)) {
      /*
       * Ein Anbieter ohne Treiber liesse sich einschalten und würde beim
       * ersten Match scheitern - mitten im Turnier statt beim Einrichten.
       */
      throw new AppError('VALIDATION_FAILED', {
        userMessage: `Für «${input.driver}» gibt es keinen Treiber. Verfügbar: ${gameserver
          .listeAnbieterTreiber()
          .map((t) => t.key)
          .join(', ')}.`,
      });
    }

    const daten = {
      name: input.name,
      driver: input.driver,
      region: input.region || null,
      enabled: input.enabled,
    };
    const anbieter = input.id
      ? await prisma.gameServerProvider.update({ where: { id: input.id }, data: daten })
      : await prisma.gameServerProvider.create({ data: daten });

    await protokolliere(ctx, 'GAMESERVER_INFRASTRUCTURE_CHANGED', anbieter.name, {
      providerId: anbieter.id,
      driver: anbieter.driver,
      enabled: anbieter.enabled,
    });
    neuLaden();
    return { providerId: anbieter.id };
  },
);

export const anbieterPruefenAction = defineAction(
  {
    name: 'gameserver.providerCheck',
    module: MODUL,
    permission: P.infrastructureManage,
    schema: z.object({ providerId: z.string().cuid() }),
    rateLimit: 'gameserverVerwalten',
    freshness: 'critical',
  },
  async ({ input }) => {
    /*
     * Die Zugangsdaten werden hier **nicht** geladen.
     *
     * `pruefeAnbieter` macht die Prüfung im Orchestrator und gibt nur
     * `{ ok, meldung }` zurück. Diese Datei ist die Grenze zum Browser;
     * was sie nicht kennt, kann sie nicht versehentlich zurückgeben.
     */
    const ergebnis = await gameserver.pruefeAnbieter(input.providerId);
    neuLaden();
    return ergebnis;
  },
);

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export const templateSpeichernAction = defineAction(
  {
    name: 'gameserver.templateSave',
    module: MODUL,
    permission: P.templatesManage,
    schema: z.object({
      id: z.string().cuid().nullish(),
      providerId: z.string().cuid(),
      name: z.string().trim().min(1).max(80),
      game: GAME,
      imageRef: z.string().trim().min(1).max(200),
      region: z.string().trim().max(60).nullish(),
      cpuCores: z.coerce.number().int().min(1).max(64).default(4),
      memoryMb: z.coerce.number().int().min(512).max(262_144).default(8192),
      diskGb: z.coerce.number().int().min(10).max(2000).default(40),
      agentPort: z.coerce.number().int().min(1).max(65_535).default(9443),
      maxRuntimeMinutes: z.coerce.number().int().min(15).max(1440).default(240),
      cleanupDelayMinutes: z.coerce.number().int().min(0).max(1440).default(15),
      enabled: z.boolean().default(true),
    }),
    rateLimit: 'gameserverVerwalten',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const { id, ...daten } = input;
    const template = id
      ? await prisma.gameServerTemplate.update({
          where: { id },
          data: { ...daten, region: daten.region || null },
        })
      : await prisma.gameServerTemplate.create({ data: { ...daten, region: daten.region || null } });

    await protokolliere(ctx, 'GAMESERVER_TEMPLATE_CHANGED', template.name, { templateId: template.id });
    neuLaden();
    return { templateId: template.id };
  },
);

// ---------------------------------------------------------------------------
// Game Profiles
// ---------------------------------------------------------------------------

export const profilSpeichernAction = defineAction(
  {
    name: 'gameserver.profileSave',
    module: MODUL,
    permission: P.gameProfilesManage,
    schema: z.object({
      id: z.string().cuid().nullish(),
      name: z.string().trim().min(1).max(80),
      game: GAME,
      templateId: z.string().cuid().nullish(),
      region: z.string().trim().max(60).nullish(),
      mapPool: z.array(z.string().trim().min(1).max(60)).max(30),
      slots: z.coerce.number().int().min(2).max(64).default(12),
      overtime: z.boolean().default(true),
      knifeRound: z.boolean().default(true),
      tacticalPauses: z.coerce.number().int().min(0).max(20).default(4),
      technicalPauses: z.coerce.number().int().min(0).max(20).default(2),
      gotvEnabled: z.boolean().default(true),
      demoRecording: z.boolean().default(true),
      restoreSupport: z.boolean().default(true),
      warmupSeconds: z.coerce.number().int().min(0).max(3600).default(300),
      readyRule: z.enum(['CAPTAIN', 'ALL']).default('CAPTAIN'),
      passwordStrategy: z.enum(['RANDOM', 'NONE', 'FIXED']).default('RANDOM'),
      fixedPassword: z.string().trim().max(60).nullish(),
      enabled: z.boolean().default(true),
    }),
    rateLimit: 'gameserverVerwalten',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const adapter = gameserver.gameAdapter(input.game);
    if (!adapter) {
      throw new AppError('VALIDATION_FAILED', { userMessage: 'Für dieses Spiel gibt es keinen Adapter.' });
    }

    /*
     * Der Map-Pool muss für den längsten Ablauf reichen.
     *
     * Geprüft beim Speichern, nicht mitten im Veto: ein Pool mit sechs Maps
     * und ein BO3-Ablauf mit sieben Schritten enden sonst damit, dass zwei
     * Teams vor einer leeren Liste stehen - und niemand weiss, warum.
     */
    const laengster = Math.max(...[1, 3, 5].map((bo) => adapter.vetoAblauf(bo).length));
    const eindeutig = [...new Set(input.mapPool)];
    if (eindeutig.length !== input.mapPool.length) {
      throw new AppError('VALIDATION_FAILED', { userMessage: 'Eine Map steht doppelt im Pool.' });
    }
    if (eindeutig.length > 0 && eindeutig.length < laengster) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: `Für ein vollständiges Veto braucht es mindestens ${laengster} Maps im Pool - es sind ${eindeutig.length}.`,
      });
    }
    if (input.passwordStrategy === 'FIXED' && !input.fixedPassword?.trim()) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: 'Bei einem festen Passwort muss eines eingetragen sein.',
      });
    }

    const { id, ...daten } = input;
    const werte = {
      ...daten,
      mapPool: eindeutig,
      templateId: daten.templateId || null,
      region: daten.region || null,
      fixedPassword: daten.passwordStrategy === 'FIXED' ? (daten.fixedPassword ?? null) : null,
    };

    const profil = id
      ? await prisma.gameProfile.update({ where: { id }, data: werte })
      : await prisma.gameProfile.create({ data: werte });

    await protokolliere(ctx, 'GAMESERVER_PROFILE_CHANGED', profil.name, { profileId: profil.id });
    neuLaden();
    return { profileId: profil.id };
  },
);

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export const serverHaltenAction = defineAction(
  {
    name: 'gameserver.hold',
    module: MODUL,
    permission: P.serverHold,
    schema: z.object({ instanceId: z.string().cuid(), grund: z.string().trim().max(300).nullish() }),
    rateLimit: 'gameserverVerwalten',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await gameserver.haltServer(input.instanceId, akteur(ctx), input.grund ?? null);
    neuLaden();
    return { gehalten: true };
  },
);

export const serverFreigebenAction = defineAction(
  {
    name: 'gameserver.release',
    module: MODUL,
    permission: P.serverHold,
    schema: z.object({ instanceId: z.string().cuid() }),
    rateLimit: 'gameserverVerwalten',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await gameserver.gibServerFrei(input.instanceId, akteur(ctx));
    neuLaden();
    return { freigegeben: true };
  },
);

export const serverLoeschenAction = defineAction(
  {
    name: 'gameserver.delete',
    module: MODUL,
    permission: P.serverCleanup,
    schema: z.object({ instanceId: z.string().cuid() }),
    rateLimit: 'gameserverVerwalten',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await gameserver.loescheServerSofort(input.instanceId, akteur(ctx));
    neuLaden();
    return { geloescht: true };
  },
);

// ---------------------------------------------------------------------------
// Map-Veto
// ---------------------------------------------------------------------------

export const vetoSchrittAction = defineAction(
  {
    name: 'gameserver.vetoStep',
    module: MODUL,
    /*
     * `view`, nicht `manage`: den Schritt macht der Captain, nicht die
     * Turnierleitung. Wer wirklich handeln darf, entscheidet
     * `fuehreVetoSchritt` über `getMatchSlot` - serverseitig und je Schritt.
     */
    permission: P.view,
    schema: z.object({ assignmentId: z.string().cuid(), map: z.string().trim().min(1).max(60) }),
    rateLimit: 'gameserverVeto',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const stand = await gameserver.fuehreVetoSchritt({
      assignmentId: input.assignmentId,
      map: input.map,
      discordId: ctx.user.discordId,
      username: ctx.user.username,
      alsAdmin: false,
    });
    revalidatePath('/turniere/matches');
    return { fertig: stand.fertig };
  },
);

export const vetoUebersteuernAction = defineAction(
  {
    name: 'gameserver.vetoOverride',
    module: MODUL,
    permission: P.vetoOverride,
    schema: z.object({ assignmentId: z.string().cuid(), map: z.string().trim().min(1).max(60) }),
    rateLimit: 'gameserverVeto',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const stand = await gameserver.fuehreVetoSchritt({
      assignmentId: input.assignmentId,
      map: input.map,
      discordId: ctx.user.discordId,
      username: ctx.user.username,
      alsAdmin: true,
    });
    revalidatePath('/turniere/matches');
    return { fertig: stand.fertig };
  },
);

export const vetoAbschliessenAction = defineAction(
  {
    name: 'gameserver.vetoFinish',
    module: MODUL,
    permission: P.matchControl,
    schema: z.object({ assignmentId: z.string().cuid() }),
    rateLimit: 'gameserverVeto',
    freshness: 'critical',
  },
  async ({ input }) => {
    const stand = await gameserver.schliesseVetoAb(input.assignmentId);
    revalidatePath('/turniere/matches');
    return { maps: gameserver.mapsAusVeto(stand) };
  },
);

// ---------------------------------------------------------------------------
// Match Control
// ---------------------------------------------------------------------------

/**
 * Die Match-Aktionen.
 *
 * Eine **feste Aufzählung** - kein Feld, in das jemand ein Kommando tippt.
 * Was jede Aktion auf dem Server bewirkt, entscheidet der Game Adapter; hier
 * steht nur, welche es gibt.
 */
const MATCH_AKTION = z.enum(['START', 'PAUSE', 'UNPAUSE', 'RESTART', 'RESTORE', 'SERVER_RESTART']);

export const matchAktionAction = defineAction(
  {
    name: 'gameserver.matchAction',
    module: MODUL,
    permission: P.matchControl,
    schema: z.object({
      assignmentId: z.string().cuid(),
      aktion: MATCH_AKTION,
      /** Nur bei RESTORE. Eine Rundenzahl, keine Zeichenkette. */
      runde: z.coerce.number().int().min(1).max(60).nullish(),
    }),
    rateLimit: 'gameserverMatchControl',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const zuordnung = await prisma.matchServerAssignment.findUniqueOrThrow({
      where: { id: input.assignmentId },
      include: {
        profile: { select: { game: true } },
        match: { select: { matchNumber: true } },
      },
    });

    if (!zuordnung.instanceId || !zuordnung.profile) {
      throw new AppError('CONFLICT', { userMessage: 'Für dieses Match läuft gerade kein Server.' });
    }

    const adapter = gameserver.gameAdapter(zuordnung.profile.game);
    if (!adapter) {
      throw new AppError('VALIDATION_FAILED', { userMessage: 'Für dieses Spiel gibt es keinen Adapter.' });
    }

    const zugriff = await gameserver.zugriffAuf(zuordnung.instanceId);

    switch (input.aktion) {
      case 'START':
        await zugriff.gameStart();
        break;
      case 'PAUSE':
        await adapter.pausiere(zugriff);
        break;
      case 'UNPAUSE':
        await adapter.setzeFort(zugriff);
        break;
      case 'RESTART':
      case 'SERVER_RESTART':
        await zugriff.gameRestart();
        break;
      case 'RESTORE': {
        if (input.runde === null || input.runde === undefined) {
          throw new AppError('VALIDATION_FAILED', {
            userMessage: 'Zum Wiederherstellen braucht es die Runde, auf die zurückgesetzt werden soll.',
          });
        }
        await adapter.stelleWiederHer(zugriff, input.runde);
        break;
      }
    }

    await protokolliere(ctx, 'GAMESERVER_MATCH_ACTION', `Match ${zuordnung.match.matchNumber}`, {
      assignmentId: input.assignmentId,
      aktion: input.aktion,
      ...(input.runde === null || input.runde === undefined ? {} : { runde: input.runde }),
    });

    revalidatePath('/turniere/matches');
    return { ausgefuehrt: input.aktion };
  },
);

// ---------------------------------------------------------------------------

async function protokolliere(
  ctx: AuthContext,
  action: keyof typeof AUDIT_ACTIONS,
  label: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await safeRecordAudit({
    action: AUDIT_ACTIONS[action],
    module: MODUL,
    actorDiscordId: ctx.user.discordId,
    actorUsername: ctx.user.username,
    targetLabel: label,
    success: true,
    metadata,
  });
}
