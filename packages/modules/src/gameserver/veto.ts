/**
 * Das Map-Veto.
 *
 * ## Warum jeder Schritt einzeln in der Datenbank steht
 *
 * Weil ein Veto zehn Minuten dauert und in dieser Zeit alles passieren kann:
 * ein Deploy, ein Bot-Neustart, ein zugeklapptes Notebook. Ein Veto-Stand im
 * Arbeitsspeicher waere danach weg, und zwei Teams muessten von vorn
 * anfangen - mit dem Wissen, was der Gegner beim ersten Mal gebannt hat.
 *
 * Jeder Schritt ist deshalb eine Zeile in `MatchVetoAction`, und die
 * Eindeutigkeit `(assignmentId, stepIndex)` ist der Riegel: zwei
 * gleichzeitige Klicks koennen nicht beide Schritt 3 belegen. Wer die Zeile
 * anlegen kann, hat gehandelt; der andere bekommt den aktuellen Stand und
 * sieht, dass er nicht mehr dran ist.
 *
 * ## Wer handeln darf
 *
 * Nur der Captain der Seite, die an der Reihe ist - geprueft mit
 * `getMatchSlot` aus dem bestehenden Turniermodul, nicht mit einer zweiten
 * Regel. Eine Match-Kennung aus dem Browser sagt nichts darueber aus, wen
 * sie etwas angeht.
 *
 * Die Turnierleitung darf uebersteuern. Das ist kein Schlupfloch, sondern
 * der Normalfall an einem LAN-Abend: ein Captain sitzt im Stau, und
 * fuenfzig Leute warten. Jede Uebersteuerung steht im Protokoll, mit Namen.
 */
import { AUDIT_ACTIONS, prisma, safeRecordAudit, type Prisma } from '@swisshub/database';
import { AppError } from '@swisshub/shared';
import { TOURNAMENTS_MODULE_ID } from '../tournaments/config';
import { getMatchSlot } from '../tournaments/access';
import { gameAdapter, type VetoSchritt } from './adapter';

export interface VetoStand {
  /** Der Ablauf, wie er fuer dieses Match gilt. */
  ablauf: VetoSchritt[];
  /** Was bereits passiert ist, in der Reihenfolge. */
  geschehen: Array<{
    stepIndex: number;
    kind: 'BAN' | 'PICK' | 'DECIDER';
    actor: 'A' | 'B' | 'SYSTEM';
    map: string;
    byAdmin: boolean;
  }>;
  /** Maps, die noch zur Wahl stehen. */
  verfuegbar: string[];
  gebannt: string[];
  /** Die gewaehlten Maps in Spielreihenfolge - das Ergebnis des Vetos. */
  gewaehlt: string[];
  /** Der naechste Schritt, oder `null` wenn das Veto durch ist. */
  naechster: (VetoSchritt & { stepIndex: number }) | null;
  fertig: boolean;
}

/**
 * Den Stand berechnen.
 *
 * Aus dem Ablauf und den gespeicherten Schritten - nicht aus einem
 * mitgefuehrten Zustand. So kann der Stand nicht von dem abweichen, was
 * tatsaechlich passiert ist.
 */
export async function vetoStand(assignmentId: string): Promise<VetoStand> {
  const zuordnung = await prisma.matchServerAssignment.findUnique({
    where: { id: assignmentId },
    include: {
      match: { select: { bestOf: true } },
      profile: { select: { game: true, mapPool: true } },
      vetoActions: { orderBy: { stepIndex: 'asc' } },
    },
  });

  if (!zuordnung?.profile) {
    throw new AppError('NOT_FOUND', { userMessage: 'Für dieses Match gibt es kein Map-Veto.' });
  }

  const adapter = gameAdapter(zuordnung.profile.game);
  if (!adapter) {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Für dieses Spiel gibt es keinen Adapter.' });
  }

  const ablauf = adapter.vetoAblauf(zuordnung.match.bestOf);
  const geschehen = zuordnung.vetoActions.map((aktion) => ({
    stepIndex: aktion.stepIndex,
    kind: aktion.kind,
    actor: aktion.actor,
    map: aktion.map,
    byAdmin: aktion.byAdmin,
  }));

  const benutzt = new Set(geschehen.map((g) => g.map));
  const verfuegbar = zuordnung.profile.mapPool.filter((map) => !benutzt.has(map));
  const gebannt = geschehen.filter((g) => g.kind === 'BAN').map((g) => g.map);
  const gewaehlt = geschehen.filter((g) => g.kind !== 'BAN').map((g) => g.map);

  const stepIndex = geschehen.length;
  const schritt = ablauf[stepIndex];

  return {
    ablauf,
    geschehen,
    verfuegbar,
    gebannt,
    gewaehlt,
    naechster: schritt ? { ...schritt, stepIndex } : null,
    fertig: stepIndex >= ablauf.length,
  };
}

/**
 * Reicht der Map-Pool fuer diesen Modus?
 *
 * Geprueft, bevor ein Veto beginnt - nicht mittendrin. Ein Pool mit sechs
 * Maps und ein BO3-Ablauf mit sieben Schritten enden sonst damit, dass
 * zwei Teams vor einer leeren Liste stehen.
 */
export function poolReicht(poolGroesse: number, ablauf: VetoSchritt[]): boolean {
  return poolGroesse >= ablauf.length;
}

export interface VetoEingabe {
  assignmentId: string;
  map: string;
  /** Wer klickt. */
  discordId: string;
  username: string;
  /**
   * Handelt hier die Turnierleitung anstelle eines Teams?
   *
   * Muss der Aufrufer entscheiden, nachdem er die Berechtigung geprueft hat -
   * diese Funktion prueft keine Berechtigungen, sie prueft die Spielregeln.
   */
  alsAdmin: boolean;
}

export interface VetoErgebnis {
  stand: VetoStand;
  /** Ist das Veto mit diesem Schritt fertig geworden? */
  fertig: boolean;
}

/**
 * Einen Veto-Schritt ausfuehren.
 *
 * Prueft in dieser Reihenfolge: gibt es den Schritt, ist die Map zu haben,
 * ist der Handelnde an der Reihe - und schreibt dann die Zeile, die der
 * Riegel ist.
 */
export async function fuehreVetoSchritt(eingabe: VetoEingabe): Promise<VetoErgebnis> {
  const stand = await vetoStand(eingabe.assignmentId);

  if (stand.fertig || !stand.naechster) {
    throw new AppError('CONFLICT', { userMessage: 'Das Map-Veto ist bereits abgeschlossen.' });
  }

  const schritt = stand.naechster;

  if (schritt.kind === 'DECIDER') {
    throw new AppError('CONFLICT', {
      userMessage: 'Der Decider wird nicht gewählt - er bleibt übrig. Schliess das Veto ab.',
    });
  }

  if (!stand.verfuegbar.includes(eingabe.map)) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Diese Map steht nicht mehr zur Wahl.',
    });
  }

  if (!eingabe.alsAdmin) {
    const zuordnung = await prisma.matchServerAssignment.findUniqueOrThrow({
      where: { id: eingabe.assignmentId },
      select: { matchId: true },
    });
    const slot = await getMatchSlot(zuordnung.matchId, eingabe.discordId);
    if (slot === null) {
      throw new AppError('FORBIDDEN', {
        userMessage: 'Nur die Captains der beiden Teams führen das Map-Veto durch.',
      });
    }
    if (slot !== schritt.actor) {
      throw new AppError('CONFLICT', {
        userMessage: 'Die andere Seite ist an der Reihe.',
      });
    }
  }

  try {
    await prisma.matchVetoAction.create({
      data: {
        assignmentId: eingabe.assignmentId,
        stepIndex: schritt.stepIndex,
        kind: schritt.kind,
        actor: schritt.actor,
        map: eingabe.map,
        byDiscordId: eingabe.discordId,
        byAdmin: eingabe.alsAdmin,
      },
    });
  } catch (fehler) {
    if (istEindeutigkeitsfehler(fehler)) {
      /*
       * Jemand war eine Zehntelsekunde schneller. Kein Fehler im Sinne von
       * «kaputt» - aber auch kein Erfolg: der Klick hat nichts bewirkt, und
       * das muss sichtbar sein, sonst waehlt jemand eine Map und sieht eine
       * andere.
       */
      throw new AppError('CONFLICT', {
        userMessage: 'Dieser Schritt wurde gerade eben schon gemacht. Sieh dir den neuen Stand an.',
      });
    }
    throw fehler;
  }

  if (eingabe.alsAdmin) {
    await safeRecordAudit({
      action: AUDIT_ACTIONS.GAMESERVER_VETO_OVERRIDE,
      module: TOURNAMENTS_MODULE_ID,
      actorDiscordId: eingabe.discordId,
      actorUsername: eingabe.username,
      targetLabel: eingabe.map,
      success: true,
      metadata: {
        assignmentId: eingabe.assignmentId,
        stepIndex: schritt.stepIndex,
        kind: schritt.kind,
        fuerSeite: schritt.actor,
      },
    });
  }

  const neu = await vetoStand(eingabe.assignmentId);
  return { stand: neu, fertig: neu.naechster?.kind === 'DECIDER' || neu.fertig };
}

/**
 * Das Veto abschliessen: der Decider bleibt uebrig.
 *
 * Eine eigene Funktion, weil niemand ihn waehlt. Sie legt den letzten
 * Schritt an - mit derselben Eindeutigkeit, also auch hier nur einmal.
 */
export async function schliesseVetoAb(assignmentId: string): Promise<VetoStand> {
  const stand = await vetoStand(assignmentId);

  if (stand.fertig) {
    return stand;
  }
  if (stand.naechster?.kind !== 'DECIDER') {
    throw new AppError('CONFLICT', {
      userMessage: 'Es sind noch Schritte offen - das Veto lässt sich noch nicht abschliessen.',
    });
  }
  if (stand.verfuegbar.length !== 1) {
    throw new AppError('CONFLICT', {
      userMessage: `Als Decider müsste genau eine Map übrig sein, es sind ${stand.verfuegbar.length}.`,
    });
  }

  const decider = stand.verfuegbar[0] as string;

  try {
    await prisma.matchVetoAction.create({
      data: {
        assignmentId,
        stepIndex: stand.naechster.stepIndex,
        kind: 'DECIDER',
        actor: 'SYSTEM',
        map: decider,
        byDiscordId: null,
        byAdmin: false,
      },
    });
  } catch (fehler) {
    if (!istEindeutigkeitsfehler(fehler)) {
      throw fehler;
    }
    // Ein anderer Durchgang hat abgeschlossen. Dasselbe Ergebnis.
  }

  return vetoStand(assignmentId);
}

/**
 * Die Maps in Spielreihenfolge.
 *
 * Das, was der Game Adapter als `maplist` bekommt. Bei BO1 ist es die eine
 * uebriggebliebene Map, sonst die Picks in der Reihenfolge ihrer Wahl, mit
 * dem Decider am Schluss.
 */
export function mapsAusVeto(stand: VetoStand): string[] {
  const picks = stand.geschehen.filter((g) => g.kind === 'PICK').map((g) => g.map);
  const decider = stand.geschehen.filter((g) => g.kind === 'DECIDER').map((g) => g.map);
  return [...picks, ...decider];
}

function istEindeutigkeitsfehler(fehler: unknown): boolean {
  return (
    typeof fehler === 'object' &&
    fehler !== null &&
    'code' in fehler &&
    (fehler as Prisma.PrismaClientKnownRequestError).code === 'P2002'
  );
}
