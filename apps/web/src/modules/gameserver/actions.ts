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
      /** Aus welchem Abbild die Match-Container entstehen. */
      runtimeImageId: z.string().cuid().nullish(),
      /** Welche Hostgruppe bevorzugt wird. Ein Wunsch, keine Bedingung. */
      preferredGroupId: z.string().cuid().nullish(),
      region: z.string().trim().max(60).nullish(),
      mapPool: z.array(z.string().trim().min(1).max(60)).max(30),

      // --- Was eine Match-Instanz bekommt ---------------------------------
      cpuLimit: z.coerce.number().min(0.5).max(64).default(2),
      cpuReservation: z.coerce.number().min(0.25).max(64).default(1),
      memoryLimitMb: z.coerce.number().int().min(512).max(262144).default(4096),
      memoryReservationMb: z.coerce.number().int().min(256).max(262144).default(2048),
      diskLimitMb: z.coerce.number().int().min(1024).max(1048576).default(20480),
      maxRuntimeMinutes: z.coerce.number().int().min(10).max(1440).default(240),

      // --- Matchregeln im Einzelnen ---------------------------------------
      serverNameTemplate: z
        .string()
        .trim()
        .min(1)
        .max(120)
        .default('SwissHub | {tournament} | Match {match}'),
      defaultBestOf: z.coerce.number().int().min(1).max(9).default(1),
      pauseSeconds: z.coerce.number().int().min(10).max(900).default(60),
      techPauseSeconds: z.coerce.number().int().min(30).max(1800).default(300),
      overtimeMaxRounds: z.coerce.number().int().min(0).max(30).default(6),
      overtimeStartMoney: z.coerce.number().int().min(0).max(100000).default(16000),
      restoreMaxRounds: z.coerce.number().int().min(1).max(120).default(60),
      gotvDelaySeconds: z.coerce.number().int().min(0).max(600).default(105),
      coachSlots: z.coerce.number().int().min(0).max(10).default(2),
      casterSlots: z.coerce.number().int().min(0).max(10).default(2),
      matchPlugin: z
        .string()
        .trim()
        .min(1)
        .max(40)
        // Ein Pluginname ist eine Kennung, kein Text: er wird vom Adapter
        // in eine Konfiguration geschrieben, und was dort steht, soll nicht
        // von einem Formular abhaengen.
        .regex(/^[a-z0-9][a-z0-9_-]*$/u, 'Nur Kleinbuchstaben, Ziffern, Bindestrich, Unterstrich.')
        .default('get5'),
      tickrate: z.coerce.number().int().min(32).max(128).default(64),
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
    if (daten.cpuReservation > daten.cpuLimit) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: 'Die CPU-Reservierung darf nicht über dem Limit liegen.',
      });
    }
    if (daten.memoryReservationMb > daten.memoryLimitMb) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: 'Die Speicher-Reservierung darf nicht über dem Limit liegen.',
      });
    }

    const werte = {
      ...daten,
      mapPool: eindeutig,
      templateId: daten.templateId || null,
      runtimeImageId: daten.runtimeImageId || null,
      preferredGroupId: daten.preferredGroupId || null,
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
const MATCH_AKTION = z.enum([
  'START',
  'PAUSE',
  'UNPAUSE',
  'RESTART',
  'RESTORE',
  'SERVER_RESTART',
  'INSTANCE_STOP',
  'INSTANCE_RECREATE',
]);

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
      case 'INSTANCE_STOP':
        await zugriff.gameStop();
        break;
      case 'INSTANCE_RECREATE': {
        /*
         * Der Fall aus der Betriebspraxis: der Container ist kaputt, das
         * Match nicht. Es entsteht ein neuer Container - mit derselben
         * Turnier-Match-Kennung, derselben Zuordnung und demselben Veto.
         */
        const einstellungen = gameserver.leseEinstellungen(await tournaments.einstellungen());
        const neu = await gameserver.erstelleInstanzNeu(input.assignmentId, einstellungen, akteur(ctx));
        if (!neu.ok) {
          throw new AppError('CONFLICT', {
            userMessage: neu.grund ?? 'Die Instanz liess sich nicht neu erstellen.',
          });
        }
        break;
      }
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

// ---------------------------------------------------------------------------
// Hosts
// ---------------------------------------------------------------------------

const hostsNeuLaden = (hostId?: string): void => {
  revalidatePath('/turniere/gameserver/hosts');
  revalidatePath('/turniere/gameserver/infrastruktur');
  revalidatePath('/turniere/gameserver');
  if (hostId) {
    revalidatePath(`/turniere/gameserver/hosts/${hostId}`);
  }
};

/**
 * Die Plausibilitätsprüfung eines Hosts.
 *
 * Steht als eigene Funktion da und nicht als Rückruf im Schema: eine Datei
 * mit `'use server'` darf in ihren exportierten Deklarationen keine
 * synchronen Funktionsausdrücke tragen - Next hält sie sonst für Server
 * Actions. Ein Name statt eines Ausdrucks löst das, und lesbarer ist es
 * ohnehin.
 */
function pruefeHostGrenzen(
  wert: {
    gamePortFrom: number;
    gamePortTo: number;
    queryPortFrom: number;
    queryPortTo: number;
    tvPortFrom: number;
    tvPortTo: number;
    memoryMb: number;
    reservedMemoryMb: number;
    cpuCores: number;
    reservedCpuCores: number;
  },
  ctx: z.RefinementCtx,
): void {
  const bereiche = [
    ['Spielports', wert.gamePortFrom, wert.gamePortTo],
    ['Query-Ports', wert.queryPortFrom, wert.queryPortTo],
    ['GOTV-Ports', wert.tvPortFrom, wert.tvPortTo],
  ] as const;

  for (const [label, von, bis] of bereiche) {
    if (bis < von) {
      ctx.addIssue({ code: 'custom', message: `${label}: das Ende liegt vor dem Anfang.` });
    }
  }

  for (let i = 0; i < bereiche.length; i += 1) {
    for (let j = i + 1; j < bereiche.length; j += 1) {
      const [labelA, vonA, bisA] = bereiche[i] as readonly [string, number, number];
      const [labelB, vonB, bisB] = bereiche[j] as readonly [string, number, number];
      if (vonA <= bisB && vonB <= bisA) {
        /*
         * Überschneidende Bereiche sind kein technischer Fehler - der
         * Allocator kommt damit klar, weil die Eindeutigkeit auf
         * (Host, Port) liegt. Sie sind ein Betriebsfehler: der GOTV-Bereich
         * frisst dann Spielports, und irgendwann nimmt der Host kein Match
         * mehr an, obwohl «noch Ports frei» sind.
         */
        ctx.addIssue({ code: 'custom', message: `${labelA} und ${labelB} überschneiden sich.` });
      }
    }
  }

  if (wert.reservedMemoryMb > wert.memoryMb && wert.memoryMb > 0) {
    ctx.addIssue({ code: 'custom', message: 'Die Speicherreserve ist grösser als der Speicher.' });
  }
  if (wert.reservedCpuCores > wert.cpuCores && wert.cpuCores > 0) {
    ctx.addIssue({ code: 'custom', message: 'Die CPU-Reserve ist grösser als die Kernzahl.' });
  }
}

/**
 * Einen Host anlegen oder ändern.
 *
 * Die Portbereiche werden hier geprüft, nicht erst beim ersten Match: ein
 * Bereich, der rückwärts läuft oder sich mit einem anderen überschneidet,
 * fällt sonst mitten im Turnierabend auf.
 */
export const hostSpeichernAction = defineAction(
  {
    name: 'gameserver.hostSave',
    module: MODUL,
    permission: P.hostsManage,
    schema: z
      .object({
        id: z.string().cuid().nullish(),
        name: z.string().trim().min(2).max(80),
        description: z.string().trim().max(300).nullish(),
        hostname: z
          .string()
          .trim()
          .min(1)
          .max(253)
          // Name oder IP - kein Schema, kein Pfad, kein Port. Der Port steht
          // in einem eigenen Feld, weil er eine Zahl ist.
          .regex(/^[A-Za-z0-9.:_-]+$/u, 'Nur Name oder IP-Adresse, ohne https:// und ohne Pfad.'),
        agentPort: z.coerce.number().int().min(1).max(65535).default(9443),
        region: z.string().trim().max(60).nullish(),
        groupId: z.string().cuid().nullish(),
        allowedGames: z.array(GAME).max(10).default([]),
        cpuCores: z.coerce.number().int().min(0).max(512).default(0),
        memoryMb: z.coerce.number().int().min(0).max(4194304).default(0),
        diskGb: z.coerce.number().int().min(0).max(1048576).default(0),
        reservedCpuCores: z.coerce.number().min(0).max(512).default(1),
        reservedMemoryMb: z.coerce.number().int().min(0).max(1048576).default(2048),
        minFreeDiskGb: z.coerce.number().int().min(0).max(100000).default(10),
        maxInstances: z.coerce.number().int().min(0).max(200).default(6),
        maxParallelStarts: z.coerce.number().int().min(1).max(50).default(2),
        gamePortFrom: z.coerce.number().int().min(1024).max(65535),
        gamePortTo: z.coerce.number().int().min(1024).max(65535),
        queryPortFrom: z.coerce.number().int().min(1024).max(65535),
        queryPortTo: z.coerce.number().int().min(1024).max(65535),
        tvPortFrom: z.coerce.number().int().min(1024).max(65535),
        tvPortTo: z.coerce.number().int().min(1024).max(65535),
      })
      .superRefine(pruefeHostGrenzen),
    rateLimit: 'gameserverVerwalten',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const { id, ...daten } = input;

    const host = id
      ? await prisma.gameServerHost.update({ where: { id }, data: daten })
      : await prisma.gameServerHost.create({ data: daten });

    await safeRecordAudit({
      action: id ? AUDIT_ACTIONS.GAMESERVER_HOST_UPDATED : AUDIT_ACTIONS.GAMESERVER_HOST_CREATED,
      module: MODUL,
      actorDiscordId: ctx.user.discordId,
      actorUsername: ctx.user.username,
      targetLabel: host.name,
      success: true,
      metadata: { hostId: host.id },
    });

    hostsNeuLaden(host.id);
    return { hostId: host.id };
  },
);

/**
 * Ein Registrierungs-Token erzeugen.
 *
 * Gibt das Token **einmal** zurück - danach steht in der Datenbank nur noch
 * sein Hash. Das ist die einzige Aktion in dieser Datei, die überhaupt ein
 * Geheimnis zurückgibt, und sie tut es, weil ein Registrierungs-Token nur
 * dann etwas nützt, wenn ein Mensch es lesen kann.
 *
 * Es öffnet genau eine Tür: einen bereits angelegten Host anmelden. Es gibt
 * keinen Zugriff auf Daten, keine Berechtigung in der WebApp und keine
 * Möglichkeit, einen weiteren Host zu erzeugen.
 */
export const hostRegistrierungOeffnenAction = defineAction(
  {
    name: 'gameserver.hostRegister',
    module: MODUL,
    permission: P.hostsManage,
    schema: z.object({
      hostId: z.string().cuid(),
      gueltigMinuten: z.coerce.number().int().min(5).max(1440).default(60),
    }),
    rateLimit: 'gameserverVerwalten',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const angebot = await gameserver.oeffneRegistrierung(input.hostId, akteur(ctx), input.gueltigMinuten);
    hostsNeuLaden(input.hostId);
    return { token: angebot.token, ablauf: angebot.ablauf.toISOString() };
  },
);

/** Einen Host aktivieren, leerlaufen lassen, in Wartung schicken oder abschalten. */
export const hostStatusAction = defineAction(
  {
    name: 'gameserver.hostStatus',
    module: MODUL,
    permission: P.hostsManage,
    schema: z.object({
      hostId: z.string().cuid(),
      status: z.enum(['ACTIVE', 'DRAINING', 'MAINTENANCE', 'DISABLED']),
    }),
    rateLimit: 'gameserverVerwalten',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const ergebnis = await gameserver.setzeHostStatus(input.hostId, input.status, akteur(ctx));
    hostsNeuLaden(input.hostId);
    return ergebnis;
  },
);

/** Einen Host entfernen - geht nur, wenn nichts mehr darauf läuft. */
export const hostLoeschenAction = defineAction(
  {
    name: 'gameserver.hostDelete',
    module: MODUL,
    permission: P.hostsManage,
    schema: z.object({ hostId: z.string().cuid() }),
    rateLimit: 'gameserverVerwalten',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await gameserver.loescheHost(input.hostId, akteur(ctx));
    hostsNeuLaden();
    return { ok: true };
  },
);

/**
 * Die Verbindung zu einem Host prüfen.
 *
 * Gibt `{ ok, meldung }` zurück und **kein** Token. Die Entschlüsselung
 * passiert im Modul, nicht hier - eine Action, die das Token kennt, ist
 * eine Zeile `return { token }` von einem Geheimnis im Browser entfernt.
 */
export const hostVerbindungTestenAction = defineAction(
  {
    name: 'gameserver.hostCheck',
    module: MODUL,
    permission: P.hostsManage,
    schema: z.object({ hostId: z.string().cuid() }),
    rateLimit: 'gameserverVerwalten',
    freshness: 'critical',
  },
  async ({ input }) => {
    const ergebnis = await gameserver.pruefeHost(input.hostId);
    hostsNeuLaden(input.hostId);
    return ergebnis;
  },
);

/** Die Abbilder eines Hosts mit dem Katalog abgleichen. */
export const hostAbbilderSynchronisierenAction = defineAction(
  {
    name: 'gameserver.hostImageSync',
    module: MODUL,
    permission: P.runtimeImagesManage,
    schema: z.object({ hostId: z.string().cuid(), laden: z.boolean().default(false) }),
    rateLimit: 'gameserverVerwalten',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const ergebnis = await gameserver.synchronisiereAbbilder(input.hostId, input.laden, akteur(ctx));
    hostsNeuLaden(input.hostId);
    return ergebnis;
  },
);

// ---------------------------------------------------------------------------
// Runtime-Images
// ---------------------------------------------------------------------------

/**
 * Ein Runtime-Image eintragen oder ändern.
 *
 * Jedes Feld einzeln und geprüft. Es gibt bewusst **kein** Feld für
 * zusätzliche Docker-Argumente: das wäre die Docker-CLI im Browser, nur mit
 * mehr Schritten. Das Startkommando ist eine Liste von Argumenten, keine
 * Zeile - eine Zeile müsste jemand zerlegen, und wer zerlegt, interpretiert.
 */
export const abbildSpeichernAction = defineAction(
  {
    name: 'gameserver.imageSave',
    module: MODUL,
    permission: P.runtimeImagesManage,
    schema: z.object({
      id: z.string().cuid().nullish(),
      name: z.string().trim().min(2).max(80),
      game: GAME,
      image: z
        .string()
        .trim()
        .min(1)
        .max(200)
        .regex(
          /^[a-z0-9][a-z0-9._-]*(?::\d{1,5})?(?:\/[a-z0-9][a-z0-9._-]*)*$/u,
          'Kein gültiger Abbildname.',
        ),
      tag: z
        .string()
        .trim()
        .min(1)
        .max(128)
        .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u, 'Kein gültiger Tag.'),
      command: z.array(z.string().trim().min(1).max(256)).max(32).default([]),
      dataMountPath: z
        .string()
        .trim()
        // Dasselbe Muster wie in der Laufzeitpruefung - und kein zweites,
        // lockereres. Was hier durchkommt, muss dort auch durchkommen.
        .regex(
          /^\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+$/u,
          'Absoluter Pfad mit mindestens zwei Ebenen, etwa /swisshub/data.',
        )
        .default('/swisshub/data'),
      configMountPath: z
        .string()
        .trim()
        // Dasselbe Muster wie in der Laufzeitpruefung - und kein zweites,
        // lockereres. Was hier durchkommt, muss dort auch durchkommen.
        .regex(
          /^\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+$/u,
          'Absoluter Pfad mit mindestens zwei Ebenen, etwa /swisshub/data.',
        )
        .default('/swisshub/config'),
      gamePortInContainer: z.coerce.number().int().min(1).max(65535).default(27015),
      queryPortInContainer: z.coerce.number().int().min(1).max(65535).nullish(),
      tvPortInContainer: z.coerce.number().int().min(1).max(65535).nullish(),
      healthTimeoutSeconds: z.coerce.number().int().min(10).max(900).default(120),
      enabled: z.boolean().default(true),
    }),
    rateLimit: 'gameserverVerwalten',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const { id, ...daten } = input;

    if (daten.dataMountPath === daten.configMountPath) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: 'Daten- und Konfigurationsverzeichnis dürfen nicht dasselbe sein.',
      });
    }

    const abbild = id
      ? await prisma.gameRuntimeImage.update({ where: { id }, data: daten })
      : await prisma.gameRuntimeImage.create({ data: daten });

    await safeRecordAudit({
      action: AUDIT_ACTIONS.GAMESERVER_RUNTIME_IMAGE_CHANGED,
      module: MODUL,
      actorDiscordId: ctx.user.discordId,
      actorUsername: ctx.user.username,
      targetLabel: abbild.name,
      success: true,
      metadata: { imageId: abbild.id, image: `${abbild.image}:${abbild.tag}`, neu: !id },
    });

    revalidatePath('/turniere/gameserver/images');
    hostsNeuLaden();
    return { imageId: abbild.id };
  },
);

/**
 * Einem Match einen bestimmten Host vorgeben.
 *
 * Der manuelle Override aus der Turnierleitung. Er überspringt die
 * **Auswahl**, nicht die Prüfungen: ein Host, der das Spiel nicht kann, in
 * Wartung steht oder voll ist, wird auch von Hand nicht genommen - der
 * Scheduler prüft ihn genauso wie jeden anderen.
 *
 * `null` gibt die Wahl wieder an SwissHub zurück.
 */
export const matchHostSetzenAction = defineAction(
  {
    name: 'gameserver.matchHost',
    module: MODUL,
    permission: P.gameserverManage,
    schema: z.object({
      assignmentId: z.string().cuid(),
      hostId: z.string().cuid().nullable(),
    }),
    rateLimit: 'gameserverVerwalten',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const zuordnung = await prisma.matchServerAssignment.update({
      where: { id: input.assignmentId },
      data: { forcedHostId: input.hostId },
      include: { match: { select: { matchNumber: true } } },
    });

    await protokolliere(ctx, 'GAMESERVER_MATCH_ACTION', `Match ${String(zuordnung.match.matchNumber)}`, {
      assignmentId: input.assignmentId,
      aktion: 'HOST_OVERRIDE',
      hostId: input.hostId,
    });

    neuLaden();
    return { ok: true };
  },
);
