import {
  AUDIT_ACTIONS,
  prisma,
  recordAudit,
  type Prisma,
  type XpSlotBonusGrant,
  type XpSlotBonusRound,
  type XpSlotFreespinPackage,
} from '@swisshub/database';
import { conflict, notFound } from '@swisshub/shared';
import { LEVEL_MODULE_ID } from '../config';
import { leseKonfiguration, type SlotKonfiguration } from './konfiguration';
import { bonusStand, offeneBonusrunde, type BonusStand } from './spin';
import type { Akteur } from './freispiele';

/**
 * Geschenke des Teams - und was der Slot darueber erzaehlt.
 *
 * ## Zwei Arten von Geschenk
 *
 * **Freispiele** sind n Spins zu einem festen Einsatz. **Ein Bonusspiel** ist
 * die Risikoleiter: acht nehmen oder auf zwoelf gamblen, bei Gewinn auf
 * sechzehn weiter, bei Verlust nichts. Das zweite ist kein Sonderfall des
 * ersten, und darum steht es in einer eigenen Zeile.
 *
 * ## Warum ein geschenkter Bonus keine eigene Spiellogik hat
 *
 * Weil es dasselbe Spiel ist. Das Geschenk ist nur der **Anlass**: beim
 * Starten entsteht daraus eine gewoehnliche `XpSlotBonusRound` auf
 * `LADDER_1`, und von da an laeuft alles durch `nimmFreispiele`, `riskiere`
 * und `dreheSpin` - dieselbe Leiter, dieselben Chancen, dieselben Sticky
 * Wilds. Ein geschenkter Bonus, der sich anders verhaelt, waere ein zweites
 * Spiel mit zweiter Quote.
 *
 * ## Warum hier gezaehlt wird und nicht im Browser
 *
 * «Was haben mir diese zehn Freispiele gebracht» ist eine Summe ueber genau
 * die Spins eines Pakets. Im Browser aufzusummieren hiesse, einer Zahl zu
 * glauben, die ein Neuladen zuruecksetzt - und die jeder aendern kann. Sie
 * steht deshalb in `packageWin` und wird in derselben Transaktion
 * hochgezaehlt, die das Freispiel verbraucht.
 */

// ===========================================================================
// Freispielpakete: Start- und Abschlussmeldung
// ===========================================================================

/** Was die Startmeldung eines Pakets braucht. */
export interface FreispielIntro {
  paketId: string;
  anzahl: number;
  einsatz: number;
  grund: string | null;
}

/** Was die Abschlussmeldung eines Pakets braucht. */
export interface FreispielAbschluss {
  paketId: string;
  gespielt: number;
  gewinn: number;
  einsatz: number;
  grund: string | null;
}

/**
 * Das Paket, dessen Startmeldung noch aussteht.
 *
 * Das **aelteste** zuerst: wer zwei Geschenke bekommen hat, soll sie in der
 * Reihenfolge erfahren, in der sie gedacht waren. Mehr als eine Meldung auf
 * einmal gibt es nicht - zwei Overlays uebereinander sind keine Feier.
 */
export async function offeneFreispielMeldung(discordId: string): Promise<FreispielIntro | null> {
  const paket = await prisma.xpSlotFreespinPackage.findFirst({
    where: {
      discordId,
      introSeenAt: null,
      status: 'ACTIVE',
      remaining: { gt: 0 },
      // Ein abgelaufenes Geschenk anzukuendigen waere eine Einladung zu
      // etwas, das es nicht mehr gibt.
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    orderBy: { createdAt: 'asc' },
  });
  if (!paket) {
    return null;
  }
  return {
    paketId: paket.id,
    anzahl: paket.remaining,
    einsatz: paket.bet,
    grund: paket.reason,
  };
}

/**
 * Das Paket, dessen Abschlussmeldung noch aussteht.
 *
 * Nur verbrauchte Pakete: ein entzogenes oder abgelaufenes hat keinen
 * Abschluss zu feiern, und «deine Freispiele sind abgelaufen» ist eine
 * andere Nachricht als «du hast damit 4250 XP gewonnen».
 */
export async function offenerFreispielAbschluss(discordId: string): Promise<FreispielAbschluss | null> {
  const paket = await prisma.xpSlotFreespinPackage.findFirst({
    where: { discordId, status: 'USED', outroSeenAt: null },
    orderBy: { updatedAt: 'asc' },
  });
  return paket ? paketAbschluss(paket) : null;
}

/**
 * Die Abschlusswerte einer Paketzeile.
 *
 * Eine Funktion und nicht zweimal dasselbe Objekt: dieselben Zahlen kommen
 * aus zwei Richtungen - aus dem Spin, der das letzte Freispiel verbraucht
 * hat, und aus der Ansicht beim Oeffnen der Seite, falls die Meldung noch
 * aussteht. Zwei Stellen, die dieselbe Meldung bauen, laufen auseinander.
 */
export function paketAbschluss(paket: XpSlotFreespinPackage): FreispielAbschluss {
  return {
    paketId: paket.id,
    gespielt: paket.used,
    gewinn: paket.packageWin,
    einsatz: paket.bet,
    grund: paket.reason,
  };
}

/**
 * Eine Meldung als gesehen vermerken.
 *
 * Gesetzt wird nur, was noch leer ist. Zwei Tabs, die beide «gesehen» melden,
 * sollen nicht den Zeitpunkt des zweiten schreiben - und vor allem soll der
 * zweite Aufruf nicht scheitern.
 */
export async function merkeFreispielMeldung(
  discordId: string,
  paketId: string,
  art: 'intro' | 'abschluss',
): Promise<void> {
  await prisma.xpSlotFreespinPackage.updateMany({
    where: {
      id: paketId,
      discordId,
      ...(art === 'intro' ? { introSeenAt: null } : { outroSeenAt: null }),
    },
    data: art === 'intro' ? { introSeenAt: new Date() } : { outroSeenAt: new Date() },
  });
}

// ===========================================================================
// Geschenkte Bonusspiele
// ===========================================================================

export interface BonusGeschenk {
  id: string;
  discordId: string;
  einsatz: number;
  grund: string | null;
  status: XpSlotBonusGrant['status'];
  laeuftAb: Date | null;
  gewaehrtVon: string | null;
  erstellt: Date;
  gestartet: Date | null;
}

export function alsGeschenk(zeile: XpSlotBonusGrant): BonusGeschenk {
  return {
    id: zeile.id,
    discordId: zeile.discordId,
    einsatz: zeile.bet,
    grund: zeile.reason,
    status: zeile.status,
    laeuftAb: zeile.expiresAt,
    gewaehrtVon: zeile.grantedByDiscordId,
    erstellt: zeile.createdAt,
    gestartet: zeile.startedAt,
  };
}

/** Die Zustaende, in denen ein Geschenk noch etwas wert ist. */
const OFFEN: ReadonlyArray<XpSlotBonusGrant['status']> = ['PENDING', 'STARTED'];

export interface BonusSchenkenEingabe {
  discordId: string;
  einsatz: number;
  grund?: string | null;
  laeuftAb?: Date | null;
}

/**
 * Schenkt ein Bonusspiel.
 *
 * ## Warum hoechstens eines
 *
 * Weil ein Bonusspiel eine laufende Entscheidung ist. Zwei gleichzeitig
 * hiesse zwei Leitern, zwei Freispielvorraete und die Frage, welcher Spin zu
 * welcher Runde gehoert - und der Slot kennt genau eine offene Bonusrunde je
 * Person. Die Grenze ist also keine Vorsicht, sondern die Form des Spiels.
 *
 * Geprueft wird in derselben Transaktion, in der geschrieben wird: zwei
 * Admins, die im selben Moment schenken, wuerden sonst beide ein «es ist
 * keines offen» sehen.
 */
export async function schenkeBonus(
  eingabe: BonusSchenkenEingabe,
  erlaubteEinsaetze: readonly number[],
  akteur: Akteur,
): Promise<BonusGeschenk> {
  if (!erlaubteEinsaetze.includes(eingabe.einsatz)) {
    throw conflict(
      `Der Einsatz ${eingabe.einsatz} XP ist nicht spielbar. Möglich sind: ${erlaubteEinsaetze.join(', ')} XP.`,
    );
  }
  if (eingabe.laeuftAb && eingabe.laeuftAb.getTime() <= Date.now()) {
    throw conflict('Das Ablaufdatum liegt in der Vergangenheit.');
  }

  const zeile = await prisma.$transaction(async (tx) => {
    /*
     * Ein abgelaufenes Geschenk blockiert nicht.
     *
     * Die Frist zaehlt, nicht der Status: ein `PENDING`, dessen Datum vorbei
     * ist, laesst sich nicht mehr starten - und darf deshalb auch kein
     * neues verhindern. Die Pflege im Bot setzt es irgendwann auf `EXPIRED`;
     * bis dahin stuende hier sonst eine Sperre ohne Grund, und die haette
     * niemand verstanden.
     */
    const offen = await tx.xpSlotBonusGrant.findFirst({
      where: {
        discordId: eingabe.discordId,
        status: { in: [...OFFEN] },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
    if (offen) {
      throw conflict(
        offen.status === 'STARTED'
          ? 'Diese Person spielt gerade ein geschenktes Bonusspiel. Warte, bis es durch ist.'
          : 'Diese Person hat noch ein geschenktes Bonusspiel offen.',
      );
    }
    return tx.xpSlotBonusGrant.create({
      data: {
        discordId: eingabe.discordId,
        bet: eingabe.einsatz,
        reason: eingabe.grund?.trim() || null,
        expiresAt: eingabe.laeuftAb ?? null,
        grantedByDiscordId: akteur.discordId,
      },
    });
  });

  await recordAudit({
    action: AUDIT_ACTIONS.XP_SLOT_BONUS_GRANTED,
    module: LEVEL_MODULE_ID,
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username ?? null,
    targetDiscordId: eingabe.discordId,
    targetLabel: `Bonusspiel zu ${eingabe.einsatz} XP`,
    success: true,
    metadata: {
      grantId: zeile.id,
      einsatz: eingabe.einsatz,
      grund: zeile.reason,
      laeuftAb: zeile.expiresAt?.toISOString() ?? null,
    },
  });

  return alsGeschenk(zeile);
}

/** Nimmt ein noch nicht gestartetes Geschenk zurueck. */
export async function entzieheBonus(grantId: string, akteur: Akteur): Promise<BonusGeschenk> {
  const vorhanden = await prisma.xpSlotBonusGrant.findUnique({ where: { id: grantId } });
  if (!vorhanden) {
    throw notFound('Dieses Bonusgeschenk gibt es nicht.');
  }
  if (vorhanden.status !== 'PENDING') {
    /*
     * Ein gestartetes Geschenk wird nicht entzogen.
     *
     * Dann laeuft eine Bonusrunde, und die abzubrechen hiesse, eine
     * Entscheidung wegzunehmen, die jemand gerade trifft - samt den
     * Freispielen, die daran haengen. Wer eingreifen muss, nimmt die
     * Freispiele.
     */
    throw conflict('Dieses Bonusgeschenk ist nicht mehr offen.');
  }

  const zeile = await prisma.xpSlotBonusGrant.update({
    where: { id: grantId },
    data: { status: 'REVOKED', revokedByDiscordId: akteur.discordId, revokedAt: new Date() },
  });

  await recordAudit({
    action: AUDIT_ACTIONS.XP_SLOT_BONUS_REVOKED,
    module: LEVEL_MODULE_ID,
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username ?? null,
    targetDiscordId: vorhanden.discordId,
    targetLabel: `Bonusspiel zu ${vorhanden.bet} XP`,
    success: true,
    metadata: { grantId },
  });

  return alsGeschenk(zeile);
}

/** Das offene Geschenk einer Person - oder keines. */
export async function offenesBonusGeschenk(discordId: string): Promise<XpSlotBonusGrant | null> {
  return prisma.xpSlotBonusGrant.findFirst({
    where: {
      discordId,
      status: 'PENDING',
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    orderBy: { createdAt: 'asc' },
  });
}

export interface BonusIntro {
  grantId: string;
  einsatz: number;
  grund: string | null;
  /** Wie viele Freispiele die erste Stufe bringt - fuer den Text. */
  freispiele: number;
}

/** Das Geschenk, dessen Startmeldung noch aussteht. */
export async function offeneBonusMeldung(
  discordId: string,
  konfiguration?: SlotKonfiguration,
): Promise<BonusIntro | null> {
  const geschenk = await offenesBonusGeschenk(discordId);
  if (!geschenk || geschenk.introSeenAt !== null) {
    return null;
  }
  const k = konfiguration ?? (await leseKonfiguration());
  return {
    grantId: geschenk.id,
    einsatz: geschenk.bet,
    grund: geschenk.reason,
    freispiele: k.wirksam.bonusFreispiele,
  };
}

/** Die Startmeldung als gesehen vermerken. */
export async function merkeBonusMeldung(discordId: string, grantId: string): Promise<void> {
  await prisma.xpSlotBonusGrant.updateMany({
    where: { id: grantId, discordId, introSeenAt: null },
    data: { introSeenAt: new Date() },
  });
}

/**
 * Startet ein geschenktes Bonusspiel.
 *
 * Danach gibt es nichts Geschenktes mehr: es laeuft eine gewoehnliche
 * Bonusrunde auf `LADDER_1`, und jede weitere Entscheidung geht durch
 * `nimmFreispiele` oder `riskiere`. Das Geschenk steht nur noch als Herkunft
 * daran.
 *
 * Wirft, wenn schon eine Runde laeuft: zwei offene Bonusrunden kennt der Slot
 * nicht, und ein Geschenk darf eine laufende Runde nicht verdraengen.
 */
export async function starteGeschenktenBonus(
  discordId: string,
  grantId: string,
): Promise<{ bonus: BonusStand }> {
  const konfiguration = await leseKonfiguration();

  const runde = await prisma.$transaction(async (tx) => {
    const geschenk = await tx.xpSlotBonusGrant.findUnique({ where: { id: grantId } });
    if (!geschenk || geschenk.discordId !== discordId) {
      // `notFound` und nicht «verboten»: eine fremde Kennung bekommt keine
      // Bestaetigung, dass sie existiert.
      throw notFound('Dieses Bonusgeschenk gibt es nicht.');
    }
    if (geschenk.status !== 'PENDING') {
      throw conflict('Dieses Bonusspiel ist schon gestartet oder nicht mehr offen.');
    }
    if (geschenk.expiresAt && geschenk.expiresAt.getTime() <= Date.now()) {
      throw conflict('Dieses Bonusgeschenk ist abgelaufen.');
    }

    const laufende = await offeneBonusrunde(discordId, tx);
    if (laufende) {
      throw conflict('Du hast noch eine Bonusrunde offen. Spiel die zuerst fertig.');
    }

    const neu = await tx.xpSlotBonusRound.create({
      data: {
        discordId,
        grantId: geschenk.id,
        stage: 'LADDER_1',
        bet: geschenk.bet,
      },
    });
    await tx.xpSlotBonusGrant.update({
      where: { id: geschenk.id },
      data: {
        status: 'STARTED',
        startedAt: new Date(),
        // Wer startet, hat die Ankuendigung gesehen. Der Haken gehoert hier
        // hin und nicht in einen zweiten Aufruf der Oberflaeche: ein Start
        // ohne Haken waere eine Zeile, die behauptet, niemand habe die
        // Meldung gesehen - und die naechste Abfrage glaubt ihr.
        introSeenAt: geschenk.introSeenAt ?? new Date(),
      },
    });
    return neu;
  });

  return { bonus: bonusStand(runde, konfiguration) };
}

/**
 * Die Bonusgeschenke fuer die Verwaltung.
 *
 * Nur die offenen - angekuendigte und gerade laufende. Genau die, die gegen
 * die Regel «hoechstens ein aktives Bonusgeschenk je Person» zaehlen, und
 * genau die, die man noch entziehen kann. Abgelaufene, entzogene und
 * durchgespielte Geschenke stehen im Audit; eine Liste, die alles zeigt,
 * waere nach einem Monat eine Liste von Dingen, zu denen es nichts mehr zu
 * entscheiden gibt.
 */
export interface BonusGeschenkZeile {
  id: string;
  discordId: string;
  einsatz: number;
  grund: string | null;
  /** `PENDING` heisst angekuendigt, `STARTED` heisst: laeuft gerade. */
  laufend: boolean;
  laeuftAb: Date | null;
  gestartetAm: Date | null;
  vergebenVon: string | null;
  erstelltAm: Date;
}

export async function bonusGeschenke(grenze = 200): Promise<BonusGeschenkZeile[]> {
  const zeilen = await prisma.xpSlotBonusGrant.findMany({
    where: { status: { in: [...OFFEN] } },
    orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    take: grenze,
  });
  return zeilen.map((zeile) => ({
    id: zeile.id,
    discordId: zeile.discordId,
    einsatz: zeile.bet,
    grund: zeile.reason,
    laufend: zeile.status === 'STARTED',
    laeuftAb: zeile.expiresAt,
    gestartetAm: zeile.startedAt,
    vergebenVon: zeile.grantedByDiscordId,
    erstelltAm: zeile.createdAt,
  }));
}

// ===========================================================================
// Der Abschluss einer Bonusrunde
// ===========================================================================

export interface BonusAbschluss {
  rundeId: string;
  /** Was die ganze Runde gebracht hat - serverseitig gezaehlt. */
  gewinn: number;
  /** Wie viele Freispiele gespielt wurden. */
  gespielt: number;
  /** Wie viele zugesagt waren. */
  zugesagt: number;
  retriggers: number;
  /** Ist die Runde an der Leiter gescheitert? */
  verloren: boolean;
  /** War es ein Geschenk des Teams? */
  geschenkt: boolean;
  einsatz: number;
}

/** Die Abschlusswerte einer Runde - aus der Zeile, nicht aus dem Browser. */
export function bonusAbschluss(runde: XpSlotBonusRound): BonusAbschluss {
  return {
    rundeId: runde.id,
    gewinn: runde.totalWin,
    gespielt: runde.played,
    zugesagt: runde.awarded,
    retriggers: runde.retriggers,
    verloren: runde.stage === 'LOST',
    geschenkt: runde.grantId !== null,
    einsatz: runde.bet,
  };
}

/** Ist diese Runde durch? */
export function istDurch(runde: Pick<XpSlotBonusRound, 'stage'>): boolean {
  return runde.stage === 'LOST' || runde.stage === 'FINISHED';
}

/**
 * Die Runde, deren Abschlussmeldung noch aussteht.
 *
 * Fuer den Fall, dass jemand den letzten Freispielspin macht und die Seite
 * neu laedt, bevor das Overlay kam. Die Meldung selbst kommt normalerweise
 * aus der Antwort des Spins - unmittelbar und ohne zweite Abfrage.
 */
export async function offenerBonusAbschluss(discordId: string): Promise<BonusAbschluss | null> {
  const runde = await prisma.xpSlotBonusRound.findFirst({
    where: { discordId, stage: { in: ['LOST', 'FINISHED'] }, outroSeenAt: null },
    orderBy: { finishedAt: 'desc' },
  });
  return runde ? bonusAbschluss(runde) : null;
}

/** Die Abschlussmeldung als gesehen vermerken. */
export async function merkeBonusAbschluss(discordId: string, rundeId: string): Promise<void> {
  await prisma.xpSlotBonusRound.updateMany({
    where: { id: rundeId, discordId, outroSeenAt: null },
    data: { outroSeenAt: new Date() },
  });
}

/**
 * Schliesst das Geschenk ab, wenn seine Runde durch ist.
 *
 * Laeuft am Ende eines Spins und nach einer Leiterentscheidung. Ohne diesen
 * Schritt stuende das Geschenk auf `STARTED`, und der naechste Versuch, der
 * Person etwas zu schenken, waere blockiert von einer Runde, die laengst
 * vorbei ist.
 */
export async function schliesseGeschenkAb(
  tx: Prisma.TransactionClient,
  runde: Pick<XpSlotBonusRound, 'grantId' | 'stage'>,
): Promise<void> {
  if (!runde.grantId || !istDurch(runde)) {
    return;
  }
  await tx.xpSlotBonusGrant.updateMany({
    where: { id: runde.grantId, status: 'STARTED' },
    data: { status: 'FINISHED' },
  });
}

/**
 * Zaehlt den Gewinn eines Freispiels auf sein Paket.
 *
 * In derselben Transaktion wie der Spin: eine Summe, die nachtraeglich
 * gebildet wird, kann einen Spin verpassen.
 */
export async function zaehleAufPaket(
  tx: Prisma.TransactionClient,
  paket: Pick<XpSlotFreespinPackage, 'id'>,
  gewinn: number,
): Promise<void> {
  if (gewinn <= 0) {
    return;
  }
  await tx.xpSlotFreespinPackage.update({
    where: { id: paket.id },
    data: { packageWin: { increment: gewinn } },
  });
}

/** Markiert abgelaufene Bonusgeschenke - fuer die Anzeige, wie bei den Paketen. */
export async function markiereAbgelaufeneGeschenke(jetzt = new Date()): Promise<number> {
  const ergebnis = await prisma.xpSlotBonusGrant.updateMany({
    where: { status: 'PENDING', expiresAt: { not: null, lte: jetzt } },
    data: { status: 'EXPIRED' },
  });
  return ergebnis.count;
}
