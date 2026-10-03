import {
  AUDIT_ACTIONS,
  prisma,
  recordAudit,
  type Prisma,
  type XpSlotFreespinPackage,
} from '@swisshub/database';
import { conflict, notFound } from '@swisshub/shared';
import { LEVEL_MODULE_ID } from '../config';

/**
 * Freispielpakete - das Geschenk des Teams.
 *
 * ## Warum der Einsatz im Paket steht
 *
 * Weil ein Freispiel sonst kein bestimmter Wert waere. «Zehn Freispiele» ist
 * ohne Einsatz keine Zusage: zum kleinsten Einsatz sind es zehn Spins zu 10
 * XP, zum groessten zehn zu 500. Der Einsatz steht deshalb im Paket, wird
 * beim Gewaehren festgelegt und laesst sich von der Person **nicht** aendern.
 * Die Oberflaeche zeigt ihn an und sperrt die Einsatzwahl, solange Freispiele
 * offen sind - und der Dienst nimmt den Einsatz ohnehin aus dem Paket und
 * nicht aus der Anfrage.
 *
 * ## Warum mehrere Pakete nebeneinander
 *
 * Weil zwei Anlaesse zwei Geschenke sind. Verbraucht wird das Paket, das
 * **zuerst ablaeuft**; ohne Ablauf das aelteste. Sonst verfiele ein Paket mit
 * Frist, waehrend ein unbefristetes zuerst aufgebraucht wird.
 *
 * ## Warum nichts geloescht wird
 *
 * Ein entzogenes Paket bleibt als `REVOKED` stehen, ein abgelaufenes als
 * `EXPIRED`. Beides ist eine Auskunft darueber, was jemand hatte - und sie
 * wird genau dann gebraucht, wenn jemand fragt, wo seine Freispiele hin sind.
 */

/** Ein Paket, wie die Oberflaeche es sieht. */
export interface FreispielPaket {
  id: string;
  discordId: string;
  gewaehrt: number;
  offen: number;
  verbraucht: number;
  einsatz: number;
  status: XpSlotFreespinPackage['status'];
  laeuftAb: Date | null;
  grund: string | null;
  gewaehrtVon: string | null;
  erstellt: Date;
  entzogenVon: string | null;
  entzogenAm: Date | null;
}

export function alsPaket(zeile: XpSlotFreespinPackage): FreispielPaket {
  return {
    id: zeile.id,
    discordId: zeile.discordId,
    gewaehrt: zeile.granted,
    offen: zeile.remaining,
    verbraucht: zeile.used,
    einsatz: zeile.bet,
    status: zeile.status,
    laeuftAb: zeile.expiresAt,
    grund: zeile.reason,
    gewaehrtVon: zeile.grantedByDiscordId,
    erstellt: zeile.createdAt,
    entzogenVon: zeile.revokedByDiscordId,
    entzogenAm: zeile.revokedAt,
  };
}

export interface GewaehrenEingabe {
  discordId: string;
  anzahl: number;
  einsatz: number;
  laeuftAb?: Date | null;
  grund?: string | null;
}

export interface Akteur {
  discordId: string;
  username?: string | null;
}

/**
 * Gewaehrt ein Paket.
 *
 * Der Einsatz wird gegen die spielbaren Einsaetze geprueft: ein Paket zu 42
 * XP waere ein Paket, mit dem sich nicht spielen laesst, weil der Slot nur
 * die eingestellten Einsaetze annimmt.
 */
export async function gewaehreFreispiele(
  eingabe: GewaehrenEingabe,
  erlaubteEinsaetze: readonly number[],
  akteur: Akteur,
): Promise<FreispielPaket> {
  const anzahl = Math.trunc(eingabe.anzahl);
  if (!Number.isFinite(anzahl) || anzahl < 1 || anzahl > 500) {
    throw conflict('Zwischen 1 und 500 Freispielen.');
  }
  if (!erlaubteEinsaetze.includes(eingabe.einsatz)) {
    throw conflict(
      `Der Einsatz ${eingabe.einsatz} XP ist nicht spielbar. Möglich sind: ${erlaubteEinsaetze.join(', ')} XP.`,
    );
  }
  if (eingabe.laeuftAb && eingabe.laeuftAb.getTime() <= Date.now()) {
    throw conflict('Das Ablaufdatum liegt in der Vergangenheit.');
  }

  const zeile = await prisma.xpSlotFreespinPackage.create({
    data: {
      discordId: eingabe.discordId,
      granted: anzahl,
      remaining: anzahl,
      used: 0,
      bet: eingabe.einsatz,
      status: 'ACTIVE',
      expiresAt: eingabe.laeuftAb ?? null,
      reason: eingabe.grund?.trim() || null,
      grantedByDiscordId: akteur.discordId,
    },
  });

  await recordAudit({
    action: AUDIT_ACTIONS.XP_SLOT_FREESPINS_GRANTED,
    module: LEVEL_MODULE_ID,
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username ?? null,
    targetDiscordId: eingabe.discordId,
    targetLabel: `${anzahl} Freispiele zu ${eingabe.einsatz} XP`,
    success: true,
    metadata: {
      packageId: zeile.id,
      anzahl,
      einsatz: eingabe.einsatz,
      laeuftAb: zeile.expiresAt?.toISOString() ?? null,
      grund: zeile.reason,
    },
  });

  return alsPaket(zeile);
}

/**
 * Entzieht ein Paket.
 *
 * Nur die **offenen** Freispiele verschwinden. Was gespielt wurde, wurde
 * gespielt; ein Gewinn daraus bleibt gebucht. Ein Entzug, der Gewinne
 * zurueckholt, waere eine XP-Buchung ohne Anlass.
 */
export async function entzieheFreispiele(packageId: string, akteur: Akteur): Promise<FreispielPaket> {
  const vorhanden = await prisma.xpSlotFreespinPackage.findUnique({ where: { id: packageId } });
  if (!vorhanden) {
    throw notFound('Dieses Freispielpaket gibt es nicht.');
  }
  if (vorhanden.status !== 'ACTIVE') {
    throw conflict('Dieses Paket ist nicht mehr offen.');
  }

  const zeile = await prisma.xpSlotFreespinPackage.update({
    where: { id: packageId },
    data: {
      status: 'REVOKED',
      remaining: 0,
      revokedByDiscordId: akteur.discordId,
      revokedAt: new Date(),
    },
  });

  await recordAudit({
    action: AUDIT_ACTIONS.XP_SLOT_FREESPINS_REVOKED,
    module: LEVEL_MODULE_ID,
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username ?? null,
    targetDiscordId: vorhanden.discordId,
    targetLabel: `${vorhanden.remaining} offene Freispiele`,
    success: true,
    metadata: { packageId, offenWaren: vorhanden.remaining, einsatz: vorhanden.bet },
  });

  return alsPaket(zeile);
}

/** Verschiebt oder entfernt die Frist eines Pakets. */
export async function aendereFrist(
  packageId: string,
  laeuftAb: Date | null,
  akteur: Akteur,
): Promise<FreispielPaket> {
  const vorhanden = await prisma.xpSlotFreespinPackage.findUnique({ where: { id: packageId } });
  if (!vorhanden) {
    throw notFound('Dieses Freispielpaket gibt es nicht.');
  }
  if (vorhanden.status === 'REVOKED' || vorhanden.status === 'USED') {
    throw conflict('Bei einem verbrauchten oder entzogenen Paket gibt es keine Frist mehr zu ändern.');
  }
  if (laeuftAb && laeuftAb.getTime() <= Date.now()) {
    throw conflict('Das Ablaufdatum liegt in der Vergangenheit.');
  }

  const zeile = await prisma.xpSlotFreespinPackage.update({
    where: { id: packageId },
    data: {
      expiresAt: laeuftAb,
      // Eine verlaengerte Frist holt ein abgelaufenes Paket zurueck - das ist
      // der Sinn der Verlaengerung.
      status: vorhanden.remaining > 0 ? 'ACTIVE' : vorhanden.status,
    },
  });

  await recordAudit({
    action: AUDIT_ACTIONS.XP_SLOT_FREESPINS_UPDATED,
    module: LEVEL_MODULE_ID,
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username ?? null,
    targetDiscordId: vorhanden.discordId,
    targetLabel: laeuftAb ? laeuftAb.toISOString().slice(0, 10) : 'ohne Frist',
    success: true,
    metadata: { packageId, vorher: vorhanden.expiresAt?.toISOString() ?? null },
  });

  return alsPaket(zeile);
}

/**
 * Das Paket, das als naechstes verbraucht wird.
 *
 * Innerhalb einer Transaktion und mit Zeilensperre: zwei gleichzeitige Spins
 * duerfen nicht dasselbe letzte Freispiel verbrauchen.
 */
export async function naechstesPaket(
  tx: Prisma.TransactionClient,
  discordId: string,
  jetzt: Date,
): Promise<XpSlotFreespinPackage | null> {
  const gesperrt = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "XpSlotFreespinPackage"
    WHERE "discordId" = ${discordId}
      AND "status" = 'ACTIVE'
      AND "remaining" > 0
      AND ("expiresAt" IS NULL OR "expiresAt" > ${jetzt})
    ORDER BY "expiresAt" ASC NULLS LAST, "createdAt" ASC
    LIMIT 1
    FOR UPDATE
  `;
  const id = gesperrt[0]?.id;
  if (!id) {
    return null;
  }
  return tx.xpSlotFreespinPackage.findUnique({ where: { id } });
}

/** Verbraucht ein Freispiel aus einem Paket. */
export async function verbraucheFreispiel(
  tx: Prisma.TransactionClient,
  paket: XpSlotFreespinPackage,
): Promise<void> {
  const offen = paket.remaining - 1;
  await tx.xpSlotFreespinPackage.update({
    where: { id: paket.id },
    data: {
      remaining: offen,
      used: { increment: 1 },
      status: offen <= 0 ? 'USED' : 'ACTIVE',
    },
  });
}

/** Alle offenen Freispiele einer Person, zusammengefasst. */
export async function offeneFreispiele(
  discordId: string,
  jetzt = new Date(),
): Promise<{ anzahl: number; einsatz: number | null; pakete: FreispielPaket[] }> {
  const zeilen = await prisma.xpSlotFreespinPackage.findMany({
    where: {
      discordId,
      status: 'ACTIVE',
      remaining: { gt: 0 },
      OR: [{ expiresAt: null }, { expiresAt: { gt: jetzt } }],
    },
    orderBy: [{ expiresAt: 'asc' }, { createdAt: 'asc' }],
  });
  return {
    anzahl: zeilen.reduce((wert, zeile) => wert + zeile.remaining, 0),
    // Der Einsatz des naechsten Pakets - das ist der, mit dem gespielt wird.
    einsatz: zeilen[0]?.bet ?? null,
    pakete: zeilen.map(alsPaket),
  };
}

/**
 * Markiert abgelaufene Pakete.
 *
 * Laeuft im Scheduler. Der Slot braucht das nicht - `naechstesPaket` filtert
 * die Frist selbst, ein abgelaufenes Paket wird also nie verbraucht. Diese
 * Funktion ist fuer die **Anzeige**: ohne sie stuende in der Verwaltung
 * dauerhaft «offen» an einem Paket, das niemand mehr nutzen kann.
 */
export async function markiereAbgelaufene(jetzt = new Date()): Promise<number> {
  const ergebnis = await prisma.xpSlotFreespinPackage.updateMany({
    where: { status: 'ACTIVE', expiresAt: { not: null, lte: jetzt } },
    data: { status: 'EXPIRED' },
  });
  return ergebnis.count;
}
