/**
 * Welcher Host bekommt dieses Match?
 *
 * ## Zwei Schritte, und der zweite ist der wichtige
 *
 * **Auswaehlen** ist eine Meinung: welcher Host passt am besten, hat genug
 * Luft, unterstuetzt das Spiel, steht in der richtigen Region. Diese Frage
 * beantwortet `waehleHosts()`, und sie schreibt nichts.
 *
 * **Reservieren** ist eine Tatsache. Zwei Matches, die in derselben
 * Millisekunde denselben Host aussuchen, duerfen nicht beide «genug Luft»
 * sehen. `reserviereAufHost()` nimmt deshalb eine **Zeilensperre auf den
 * Host** (`SELECT … FOR UPDATE`) und zaehlt erst danach - genau wie das
 * Turniermodul es beim Eintragen eines Resultats macht. Wer die Sperre
 * haelt, rechnet mit Zahlen, die sich unter ihm nicht mehr aendern.
 *
 * Ohne diese Sperre waere jede Grenze eine Empfehlung: zwanzig gleichzeitige
 * Anforderungen saehen alle dieselben «noch drei Plaetze frei».
 *
 * ## Kein Spiel in dieser Datei
 *
 * Hier steht kein `CS2`. Welche Ports ein Spiel braucht, sagt sein Adapter;
 * welcher Host es darf, steht am Host. Ein Test haelt das fest.
 */
import { prisma, type GameServerGame, type GameServerHost, type Prisma } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import {
  BELEGENDE_INSTANZ_ZUSTAENDE,
  STARTENDE_INSTANZ_ZUSTAENDE,
  hostGesundheit,
  hostKannSpiel,
} from './hosts';
import { bereichsGroesse } from './ports';

const log = createLogger('gameserver:scheduler');

/** Was ein Match vom Host verlangt. */
export interface HostAnforderung {
  game: GameServerGame;
  /** Was die Instanz an CPU und Speicher bekommen soll. */
  cpu: number;
  memoryMb: number;
  /** Welche Hostgruppe bevorzugt wird. */
  bevorzugteGruppeId?: string | null;
  region?: string | null;
  /**
   * Ein bestimmter Host.
   *
   * Der manuelle Override der Turnierleitung. Er ueberspringt die Auswahl,
   * **nicht** die Pruefungen: ein Host, der das Spiel nicht kann, in Wartung
   * steht oder voll ist, wird auch von Hand nicht genommen.
   */
  erzwungenerHostId?: string | null;
}

/** Warum ein Host nicht in Frage kam. */
export interface HostAbsage {
  hostId: string;
  hostName: string;
  grund: string;
}

export interface HostKandidat {
  host: GameServerHost;
  /** Je hoeher, desto besser. Nur zum Sortieren. */
  punkte: number;
  cpuFrei: number;
  memoryFreiMb: number;
  plaetzeFrei: number;
}

export interface AuswahlErgebnis {
  kandidaten: HostKandidat[];
  /** Wer nicht in Frage kam und warum - im Klartext, fuer das Dashboard. */
  abgelehnt: HostAbsage[];
}

/**
 * Die Hosts, die dieses Match nehmen koennten - der beste zuerst.
 *
 * Gibt eine **Liste** zurueck, keinen einzelnen Host. Der Grund steht in
 * `reserviereAufHost`: zwischen Auswahl und Reservierung kann ein anderer
 * Vorgang den Platz genommen haben. Wer nur einen Kandidaten hat, muss dann
 * von vorn anfangen; wer drei hat, nimmt den naechsten.
 */
export async function waehleHosts(
  anforderung: HostAnforderung,
  jetzt = new Date(),
): Promise<AuswahlErgebnis> {
  const hosts = anforderung.erzwungenerHostId
    ? await prisma.gameServerHost.findMany({ where: { id: anforderung.erzwungenerHostId } })
    : await prisma.gameServerHost.findMany({ orderBy: { name: 'asc' } });

  const kandidaten: HostKandidat[] = [];
  const abgelehnt: HostAbsage[] = [];

  for (const host of hosts) {
    const absage = (grund: string) => abgelehnt.push({ hostId: host.id, hostName: host.name, grund });

    if (host.status !== 'ACTIVE') {
      absage(
        host.status === 'DRAINING'
          ? 'Der Host nimmt keine neuen Matches mehr an.'
          : host.status === 'MAINTENANCE'
            ? 'Der Host steht in Wartung.'
            : 'Der Host ist abgeschaltet.',
      );
      continue;
    }

    if (!hostKannSpiel(host, anforderung.game)) {
      absage(
        host.allowedGames.length === 0
          ? 'Für diesen Host ist kein Spiel freigegeben.'
          : `Dieser Host ist nicht für ${anforderung.game} freigegeben.`,
      );
      continue;
    }

    const gesundheit = hostGesundheit(host, jetzt);
    if (gesundheit.wert !== 'HEALTHY') {
      absage(gesundheit.grund);
      continue;
    }

    const kapazitaet = await kapazitaetImHost(host);

    if (kapazitaet.instanzen >= host.maxInstances) {
      absage(`Der Host ist voll (${String(kapazitaet.instanzen)} von ${String(host.maxInstances)}).`);
      continue;
    }
    if (kapazitaet.startend >= host.maxParallelStarts) {
      absage(
        `Auf dem Host starten bereits ${String(kapazitaet.startend)} Instanzen - mehr als ${String(host.maxParallelStarts)} gleichzeitig sind nicht eingestellt.`,
      );
      continue;
    }
    if (kapazitaet.cpuFrei < anforderung.cpu) {
      absage(
        `Es sind nur noch ${kapazitaet.cpuFrei.toFixed(1)} Kerne frei, gebraucht werden ${anforderung.cpu.toFixed(1)}.`,
      );
      continue;
    }
    if (kapazitaet.memoryFreiMb < anforderung.memoryMb) {
      absage(
        `Es sind nur noch ${String(Math.round(kapazitaet.memoryFreiMb / 1024))} GB Arbeitsspeicher frei, gebraucht werden ${String(Math.round(anforderung.memoryMb / 1024))} GB.`,
      );
      continue;
    }
    if (kapazitaet.gamePortsFrei <= 0) {
      absage('Der Spielport-Bereich dieses Hosts ist erschöpft.');
      continue;
    }

    kandidaten.push({
      host,
      punkte: punkte(host, anforderung, kapazitaet),
      cpuFrei: kapazitaet.cpuFrei,
      memoryFreiMb: kapazitaet.memoryFreiMb,
      plaetzeFrei: host.maxInstances - kapazitaet.instanzen,
    });
  }

  kandidaten.sort((a, b) => b.punkte - a.punkte);
  return { kandidaten, abgelehnt };
}

/**
 * Wie gut ein Host passt.
 *
 * Die bevorzugte Gruppe wiegt am schwersten, dann die Region - beide sind
 * Wuensche und keine Bedingungen: ein Match wartet nicht auf eine Region,
 * es spielt lieber anderswo.
 *
 * Darunter entscheidet die **freie** Kapazitaet, und zwar absichtlich zu
 * Gunsten des leereren Hosts. Zwei Spielserver auf einer Maschine, die
 * beide an ihrer Grenze laufen, halten ihre Tickrate nicht - und eine
 * schwankende Tickrate merkt man im Spiel sofort.
 */
function punkte(host: GameServerHost, anforderung: HostAnforderung, kapazitaet: KapazitaetImHost): number {
  let wert = 0;
  if (anforderung.bevorzugteGruppeId && host.groupId === anforderung.bevorzugteGruppeId) {
    wert += 1000;
  }
  if (anforderung.region && host.region === anforderung.region) {
    wert += 500;
  }
  wert += kapazitaet.cpuFrei * 10;
  wert += kapazitaet.memoryFreiMb / 1024;
  return wert;
}

interface KapazitaetImHost {
  instanzen: number;
  startend: number;
  cpuFrei: number;
  memoryFreiMb: number;
  gamePortsFrei: number;
}

/**
 * Die Kapazitaet eines Hosts - wahlweise innerhalb einer Transaktion.
 *
 * Derselbe Code fuer die Auswahl und fuer die Reservierung. Zwei
 * Berechnungen, die dasselbe meinen, waeren irgendwann zwei verschiedene
 * Zahlen, und die Reservierung wuerde Hosts ablehnen, die die Auswahl
 * gerade noch vorgeschlagen hat.
 */
async function kapazitaetImHost(
  host: GameServerHost,
  tx: Prisma.TransactionClient = prisma,
): Promise<KapazitaetImHost> {
  const [instanzen, startend, summen, belegtePorts] = await Promise.all([
    tx.gameServerInstance.count({
      where: { hostId: host.id, status: { in: [...BELEGENDE_INSTANZ_ZUSTAENDE] } },
    }),
    tx.gameServerInstance.count({
      where: { hostId: host.id, status: { in: [...STARTENDE_INSTANZ_ZUSTAENDE] } },
    }),
    tx.gameServerInstance.aggregate({
      where: { hostId: host.id, status: { in: [...BELEGENDE_INSTANZ_ZUSTAENDE] } },
      _sum: { cpuLimit: true, memoryLimitMb: true },
    }),
    tx.hostPortReservation.count({ where: { hostId: host.id, kind: 'GAME' } }),
  ]);

  return {
    instanzen,
    startend,
    cpuFrei: Math.max(0, host.cpuCores - host.reservedCpuCores - (summen._sum.cpuLimit ?? 0)),
    memoryFreiMb: Math.max(0, host.memoryMb - host.reservedMemoryMb - (summen._sum.memoryLimitMb ?? 0)),
    gamePortsFrei: Math.max(0, bereichsGroesse(host.gamePortFrom, host.gamePortTo) - belegtePorts),
  };
}

// ---------------------------------------------------------------------------
// Die Reservierung
// ---------------------------------------------------------------------------

/** Was beim Reservieren in die Instanzzeile geschrieben wird. */
export interface InstanzEntwurf {
  name: string;
  game: GameServerGame;
  profileId: string | null;
  runtimeImageId: string | null;
  imageTag: string | null;
  region: string | null;
  tournamentId: string | null;
  cpuLimit: number;
  memoryLimitMb: number;
  diskLimitMb: number;
  maxRuntimeMinutes: number;
  profileSnapshot: Prisma.InputJsonValue;
  rconPasswordEnc: string | null;
  serverPassword: string | null;
}

export type ReservierErgebnis = { ok: true; instanceId: string } | { ok: false; grund: string };

/**
 * Kapazitaet auf einem Host belegen und die Instanzzeile anlegen.
 *
 * **Die Zeilensperre ist die Zusage.** `SELECT … FOR UPDATE` auf den Host
 * serialisiert alle, die denselben Host wollen; erst danach wird gezaehlt,
 * und die Zahlen koennen sich bis zum Schreiben nicht mehr aendern.
 *
 * Es werden hier **keine Ports** reserviert. Die haben ihren eigenen Riegel
 * (`@@unique([hostId, port])`) und brauchen die Hostsperre nicht - sie
 * innerhalb der Transaktion zu ziehen, wuerde die Sperre nur laenger halten
 * und damit jeden anderen Start ausbremsen.
 */
export async function reserviereAufHost(
  hostId: string,
  anforderung: HostAnforderung,
  entwurf: InstanzEntwurf,
): Promise<ReservierErgebnis> {
  try {
    return await prisma.$transaction(async (tx) => {
      /*
       * Die Sperre. `FOR UPDATE` auf genau diese eine Zeile - nicht auf die
       * Tabelle. Zwei Matches auf verschiedenen Hosts behindern sich nicht.
       */
      const gesperrt = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "GameServerHost" WHERE "id" = ${hostId} FOR UPDATE
      `;
      if (gesperrt.length === 0) {
        return { ok: false as const, grund: 'Diesen Host gibt es nicht mehr.' };
      }

      const host = await tx.gameServerHost.findUniqueOrThrow({ where: { id: hostId } });

      if (host.status !== 'ACTIVE') {
        return { ok: false as const, grund: 'Der Host nimmt keine neuen Matches mehr an.' };
      }
      if (!hostKannSpiel(host, anforderung.game)) {
        return { ok: false as const, grund: `Dieser Host ist nicht für ${anforderung.game} freigegeben.` };
      }

      const kapazitaet = await kapazitaetImHost(host, tx);

      if (kapazitaet.instanzen >= host.maxInstances) {
        return { ok: false as const, grund: 'Der Host ist inzwischen voll.' };
      }
      if (kapazitaet.startend >= host.maxParallelStarts) {
        return { ok: false as const, grund: 'Auf dem Host starten gerade zu viele Instanzen.' };
      }
      if (kapazitaet.cpuFrei < anforderung.cpu) {
        return { ok: false as const, grund: 'Auf dem Host ist inzwischen zu wenig CPU frei.' };
      }
      if (kapazitaet.memoryFreiMb < anforderung.memoryMb) {
        return { ok: false as const, grund: 'Auf dem Host ist inzwischen zu wenig Speicher frei.' };
      }

      const instanz = await tx.gameServerInstance.create({
        data: {
          hostId,
          name: entwurf.name,
          game: entwurf.game,
          profileId: entwurf.profileId,
          runtimeImageId: entwurf.runtimeImageId,
          imageTag: entwurf.imageTag,
          region: entwurf.region ?? host.region,
          tournamentId: entwurf.tournamentId,
          status: 'RESERVED',
          publicHost: host.hostname,
          cpuLimit: entwurf.cpuLimit,
          memoryLimitMb: entwurf.memoryLimitMb,
          diskLimitMb: entwurf.diskLimitMb,
          maxRuntimeMinutes: entwurf.maxRuntimeMinutes,
          profileSnapshot: entwurf.profileSnapshot,
          rconPasswordEnc: entwurf.rconPasswordEnc,
          serverPassword: entwurf.serverPassword,
          provisionStartedAt: new Date(),
        },
        select: { id: true },
      });

      return { ok: true as const, instanceId: instanz.id };
    });
  } catch (fehler) {
    log.warn('Reservierung auf Host fehlgeschlagen', { hostId, fehler });
    return {
      ok: false,
      grund: fehler instanceof Error ? fehler.message.slice(0, 300) : 'Unbekannter Fehler',
    };
  }
}
