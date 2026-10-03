import { prisma, type XpSlotSpin } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';

const log = createLogger('level:xpslot:premium');

/**
 * Der Premium-Gewinn und sein Weg ins Premium-System.
 *
 * ## Keine zweite Premium-Laufzeit
 *
 * Gutgeschrieben wird ueber `premium.schenkePremium` - dieselbe Funktion, mit
 * der der Clip der Woche Premium verschenkt. Es entsteht ein gewoehnliches
 * Abonnement, und damit greift alles, was es schon gibt: der Discord-Sync
 * holt die Rolle, `findExpiredSubscriptions` nimmt sie nach Ablauf wieder
 * weg, die Uebersicht zaehlt es mit. Ein eigener Ablaufpfad haette dieselbe
 * Arbeit zweimal gemacht - und beim ersten Umbau eines der beiden vergessen.
 *
 * ## Warum es eine Warteschlange gibt
 *
 * `schenkePremium` gibt `null` zurueck, wenn jemand bereits Premium hat: zwei
 * gleichzeitige Abonnements waeren eine zweite Wahrheit darueber, bis wann
 * jemand Premium hat. Fuer einen Preis aus dem Clip der Woche ist das in
 * Ordnung - dort gibt es XP statt einer zweiten Woche.
 *
 * Hier waere es nicht in Ordnung: der Gewinn stand auf den Walzen, und «du
 * hattest schon Premium» ist keine Antwort darauf. Die Zeile bleibt deshalb
 * als `QUEUED` stehen, und `holeVorgemerkteNach` schreibt sie gut, sobald das
 * laufende Premium abgelaufen ist. Das ist kein zweiter Premium-Lebenszyklus,
 * sondern ein Merkzettel.
 */

/** Schreibt den Premium-Gewinn eines Spins gut - oder merkt ihn vor. */
export async function gutschreibePremium(spin: XpSlotSpin): Promise<void> {
  if (spin.premiumDays <= 0) {
    return;
  }
  // Testlaeufe schreiben nichts gut. Der Testmodus soll jede Inszenierung
  // zeigen koennen, ohne dass jemand echtes Premium bekommt.
  if (spin.kind === 'TEST') {
    return;
  }

  const vorhanden = await prisma.xpSlotPremiumGrant.findFirst({ where: { spinId: spin.id } });
  if (vorhanden) {
    return;
  }

  const eintrag = await prisma.xpSlotPremiumGrant.create({
    data: { discordId: spin.discordId, spinId: spin.id, days: spin.premiumDays, state: 'QUEUED' },
  });

  await versuche(eintrag.id, spin.discordId, spin.premiumDays);
}

/**
 * Ein Versuch, eine vorgemerkte Gutschrift zu buchen.
 *
 * Bleibt sie vorgemerkt, ist das kein Fehler: der naechste Lauf versucht es
 * wieder.
 */
async function versuche(grantId: string, discordId: string, tage: number): Promise<boolean> {
  const { schenkePremium } = await import('../../premium/service');
  const abo = await schenkePremium({
    discordId,
    tage,
    quelle: 'xp-slot',
  });

  if (!abo) {
    log.info('Premium-Gewinn bleibt vorgemerkt', { grantId, discordId, tage });
    return false;
  }

  await prisma.xpSlotPremiumGrant.update({
    where: { id: grantId },
    data: { state: 'CREDITED', subscriptionId: abo.id, creditedAt: new Date(), note: null },
  });

  const { AUDIT_ACTIONS, recordAudit } = await import('@swisshub/database');
  const { LEVEL_MODULE_ID } = await import('../config');
  await recordAudit({
    action: AUDIT_ACTIONS.XP_SLOT_PREMIUM_GRANTED,
    module: LEVEL_MODULE_ID,
    actorDiscordId: null,
    actorUsername: null,
    targetDiscordId: discordId,
    targetLabel: `${tage} Tage Premium`,
    success: true,
    metadata: { grantId, subscriptionId: abo.id, tage },
  });
  return true;
}

/**
 * Holt vorgemerkte Gutschriften nach.
 *
 * Laeuft im Scheduler. Es gibt bewusst keine Frist, nach der ein Gewinn
 * verfaellt: wer ein Jahr Premium hat und dabei Premium gewinnt, bekommt es
 * danach. Ein Verfall waere ein stiller Entzug.
 */
export async function holeVorgemerkteNach(grenze = 25): Promise<{ gebucht: number; offen: number }> {
  const offene = await prisma.xpSlotPremiumGrant.findMany({
    where: { state: 'QUEUED' },
    orderBy: { createdAt: 'asc' },
    take: grenze,
  });

  let gebucht = 0;
  for (const eintrag of offene) {
    const ok = await versuche(eintrag.id, eintrag.discordId, eintrag.days).catch((error: unknown) => {
      log.warn('Vorgemerkte Premium-Gutschrift gescheitert', { grantId: eintrag.id, error });
      return false;
    });
    if (ok) {
      gebucht += 1;
    }
  }

  const offen = await prisma.xpSlotPremiumGrant.count({ where: { state: 'QUEUED' } });
  return { gebucht, offen };
}

/** Die Premium-Gewinne einer Person. */
export async function premiumGewinne(
  discordId: string,
): Promise<
  Array<{ id: string; tage: number; zustand: string; gutgeschrieben: Date | null; erstellt: Date }>
> {
  const zeilen = await prisma.xpSlotPremiumGrant.findMany({
    where: { discordId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return zeilen.map((zeile) => ({
    id: zeile.id,
    tage: zeile.days,
    zustand: zeile.state,
    gutgeschrieben: zeile.creditedAt,
    erstellt: zeile.createdAt,
  }));
}
