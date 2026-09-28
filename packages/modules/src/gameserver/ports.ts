/**
 * Wer welchen Port auf welchem Host bekommt.
 *
 * ## Warum das in der Datenbank steht und nicht im Speicher
 *
 * Weil eine Portvergabe im Arbeitsspeicher drei Dinge nicht kann, die hier
 * alle drei vorkommen:
 *
 *   - **Zwei Worker.** Der Bot laeuft einmal, die WebApp kann mehrfach
 *     laufen, und beide duerfen provisionieren. Zwei Prozesse, die je eine
 *     eigene Liste fuehren, vergeben irgendwann denselben Port - und der
 *     zweite Container startet nicht, mitten in einem Turnier.
 *   - **Ein Neustart.** Nach einem Deployment waere die Liste leer, die
 *     Container aber nicht. Der naechste Start kollidiert mit einem
 *     laufenden Match.
 *   - **Ein Absturz mitten im Erstellen.** Die Reservierung steht dann noch
 *     da und wird beim Aufraeumen freigegeben - statt fuer immer verloren zu
 *     sein, weil niemand mehr weiss, dass es sie gab.
 *
 * ## Wie reserviert wird
 *
 * Dieselbe Bauart wie ueberall in diesem Repository: **die Zeile ist der
 * Riegel.** `HostPortReservation` traegt `@@unique([hostId, port])`. Eine
 * Reservierung ist ein `create`; kommt P2002 zurueck, hat jemand anderes den
 * Port, und der naechste Kandidat ist dran. Es gibt keine Pruefung «ist der
 * Port frei?», der ein `create` folgt - dazwischen passt ein anderer
 * Prozess.
 */
import { prisma, type HostPortKind, type Prisma } from '@swisshub/database';
import { AppError } from '@swisshub/shared';

/** Welche Ports eine Instanz braucht. Der Spielport immer, der Rest je Spiel. */
export interface PortBedarf {
  query: boolean;
  tv: boolean;
}

export interface ReserviertePorts {
  game: number;
  query: number | null;
  tv: number | null;
}

/** Die Bereiche eines Hosts, so wie sie in seiner Zeile stehen. */
export interface PortBereiche {
  gamePortFrom: number;
  gamePortTo: number;
  queryPortFrom: number;
  queryPortTo: number;
  tvPortFrom: number;
  tvPortTo: number;
}

/**
 * Wie viele Ports es in einem Bereich ueberhaupt gibt.
 *
 * Eine eigene Funktion, weil der Scheduler sie braucht, **bevor** er
 * reserviert: ein Host, dessen Spielportbereich erschoepft ist, soll gar
 * nicht erst ausgewaehlt werden.
 */
export function bereichsGroesse(von: number, bis: number): number {
  return Math.max(0, bis - von + 1);
}

/**
 * Ports fuer eine Instanz reservieren.
 *
 * Alles oder nichts: klappt einer der drei nicht, werden die schon
 * vergebenen wieder freigegeben. Ein Container mit Spielport, aber ohne
 * GOTV-Port waere eine halbe Instanz, und halbe Instanzen sind schlimmer
 * als keine.
 */
export async function reservierePorts(
  hostId: string,
  instanceId: string,
  bereiche: PortBereiche,
  bedarf: PortBedarf,
): Promise<ReserviertePorts> {
  const vergeben: number[] = [];

  try {
    const game = await reserviereEinen(
      hostId,
      instanceId,
      'GAME',
      bereiche.gamePortFrom,
      bereiche.gamePortTo,
    );
    vergeben.push(game);

    const query = bedarf.query
      ? await reserviereEinen(hostId, instanceId, 'QUERY', bereiche.queryPortFrom, bereiche.queryPortTo)
      : null;
    if (query !== null) {
      vergeben.push(query);
    }

    const tv = bedarf.tv
      ? await reserviereEinen(hostId, instanceId, 'TV', bereiche.tvPortFrom, bereiche.tvPortTo)
      : null;
    if (tv !== null) {
      vergeben.push(tv);
    }

    return { game, query, tv };
  } catch (fehler) {
    // Was schon vergeben ist, geht zurueck. Sonst waere ein erschoepfter
    // GOTV-Bereich ein dauerhaft verlorener Spielport.
    if (vergeben.length > 0) {
      await prisma.hostPortReservation
        .deleteMany({ where: { hostId, port: { in: vergeben } } })
        .catch(() => undefined);
    }
    throw fehler;
  }
}

/**
 * Einen einzelnen Port ziehen.
 *
 * Nicht der niedrigste freie, sondern von einer zufaelligen Stelle aus
 * aufsteigend. Der Grund ist praktisch: ein Port, der gerade freigegeben
 * wurde, wird sonst sofort wieder vergeben - und ein Spielclient, der die
 * alte Verbindung noch haelt, landet im neuen Match.
 */
async function reserviereEinen(
  hostId: string,
  instanceId: string,
  kind: HostPortKind,
  von: number,
  bis: number,
): Promise<number> {
  const groesse = bereichsGroesse(von, bis);
  if (groesse === 0) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: `Für ${kind} ist auf diesem Host kein Portbereich eingetragen.`,
      internalMessage: `Leerer Portbereich ${String(von)}-${String(bis)} auf Host ${hostId}`,
    });
  }

  const belegt = new Set(
    (
      await prisma.hostPortReservation.findMany({
        where: { hostId, port: { gte: von, lte: bis } },
        select: { port: true },
      })
    ).map((zeile) => zeile.port),
  );

  if (belegt.size >= groesse) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: `Auf diesem Host ist der ${kind}-Portbereich erschöpft (${String(von)}–${String(bis)}).`,
      internalMessage: `Portbereich erschoepft: Host ${hostId}, ${kind}`,
    });
  }

  const start = Math.floor(Math.random() * groesse);

  for (let versatz = 0; versatz < groesse; versatz += 1) {
    const port = von + ((start + versatz) % groesse);
    if (belegt.has(port)) {
      continue;
    }
    try {
      await prisma.hostPortReservation.create({ data: { hostId, port, kind, instanceId } });
      return port;
    } catch (fehler) {
      if (!istEindeutigkeitsfehler(fehler)) {
        throw fehler;
      }
      /*
       * Jemand war schneller. Kein Fehler, sondern der Normalfall bei zwei
       * gleichzeitigen Matches - der naechste Kandidat ist dran.
       */
      belegt.add(port);
    }
  }

  throw new AppError('VALIDATION_FAILED', {
    userMessage: `Auf diesem Host ist der ${kind}-Portbereich erschöpft (${String(von)}–${String(bis)}).`,
    internalMessage: `Portbereich erschoepft nach Durchlauf: Host ${hostId}, ${kind}`,
  });
}

/**
 * Die Ports einer Instanz freigeben.
 *
 * Gibt zurueck, wie viele es waren. Null ist kein Fehler: ein zweiter
 * Aufruf nach einem Retry soll nichts tun und nicht werfen.
 */
export async function gibPortsFrei(instanceId: string): Promise<number> {
  const { count } = await prisma.hostPortReservation.deleteMany({ where: { instanceId } });
  return count;
}

/** Was auf einem Host gerade belegt ist - fuer die Detailseite. */
export async function portBelegung(
  hostId: string,
): Promise<{ gesamt: number; jeArt: Record<HostPortKind, number> }> {
  const zeilen = await prisma.hostPortReservation.groupBy({
    by: ['kind'],
    where: { hostId },
    _count: { _all: true },
  });

  const jeArt: Record<HostPortKind, number> = { GAME: 0, QUERY: 0, TV: 0 };
  let gesamt = 0;
  for (const zeile of zeilen) {
    jeArt[zeile.kind] = zeile._count._all;
    gesamt += zeile._count._all;
  }
  return { gesamt, jeArt };
}

/**
 * Reservierungen ohne Instanz aufraeumen.
 *
 * Entstehen, wenn ein Prozess zwischen Reservierung und Instanzzeile
 * abstuerzt. Sie haben keinen Besitzer und wuerden den Bereich sonst
 * langsam auffressen. Erst nach einer Schonfrist - eine Reservierung, die
 * zehn Sekunden alt ist, gehoert vermutlich einem Vorgang, der gerade laeuft.
 */
export async function raeumeVerwaisteReservierungen(
  jetzt = new Date(),
  schonfristMinuten = 15,
): Promise<number> {
  const grenze = new Date(jetzt.getTime() - schonfristMinuten * 60_000);
  const { count } = await prisma.hostPortReservation.deleteMany({
    where: { instanceId: null, createdAt: { lt: grenze } },
  });
  return count;
}

function istEindeutigkeitsfehler(fehler: unknown): boolean {
  return (
    typeof fehler === 'object' &&
    fehler !== null &&
    'code' in fehler &&
    (fehler as Prisma.PrismaClientKnownRequestError).code === 'P2002'
  );
}
