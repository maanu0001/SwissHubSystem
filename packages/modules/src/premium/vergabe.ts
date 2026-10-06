import { AUDIT_ACTIONS, prisma, safeRecordAudit } from '@swisshub/database';
import type { PremiumGrant, PremiumGrantMode, PremiumGrantUnit, PremiumProduct } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { conflict, notFound, teileIn, ortszeitAlsUtc } from '@swisshub/shared';
import { PREMIUM_MODULE_ID } from './config';
import { ENTITLEMENT_LABEL } from './entitlements';
import type { SubscriptionActor, SubscriptionWithProduct } from './service';

const logger = createLogger('premium:vergabe');

/**
 * Premium von Hand vergeben.
 *
 * ## Warum das kein zweites Premium-System ist
 *
 * Der **Anspruch** bleibt das Abonnement. Eine Vergabe legt ein gewoehnliches
 * `PremiumSubscription` an - oder verlaengert das bestehende - und damit
 * greift alles, was es schon gibt: der Discord-Sync holt die Rolle,
 * `findExpiredSubscriptions` raeumt nach Ablauf auf, das Stuebli entsteht
 * ueber dieselbe Provisionierung wie bei einer bezahlten Buchung, die
 * Uebersicht zaehlt es mit. Es gibt keinen zweiten Ablaufpfad und keine
 * zweite Stelle, die entscheidet, wer Premium hat.
 *
 * `PremiumGrant` ist deshalb kein Entitlement, sondern das Protokoll der
 * **Handlung**: wer hat wem was fuer wie lange gegeben, warum, und was ist
 * dabei mit einer bestehenden Laufzeit passiert.
 *
 * ## Verhaeltnis zu `schenkePremium`
 *
 * `schenkePremium` bleibt, wie es ist: es ist der Weg fuer **Automaten** -
 * der Clip der Woche vergibt sieben Tage, und wer schon Premium hat, bekommt
 * nichts (`null`), weil der Aufrufer dann XP vergibt. Diese Datei ist der Weg
 * fuer **Menschen**, und ein Mensch will bei einer bestehenden Laufzeit
 * entscheiden statt abgewiesen zu werden.
 */

export const ZEITZONE = 'Europe/Zurich';

export const GRANT_UNIT_LABEL: Record<PremiumGrantUnit, { eins: string; viele: string }> = {
  DAYS: { eins: 'Tag', viele: 'Tage' },
  WEEKS: { eins: 'Woche', viele: 'Wochen' },
  MONTHS: { eins: 'Monat', viele: 'Monate' },
};

export const GRANT_MODE_LABEL: Record<PremiumGrantMode, string> = {
  NEW: 'Neu vergeben',
  EXTEND: 'Verlängert',
  REPLACE: 'Ersetzt',
};

/** Die Obergrenze je Vergabe - gegen den verrutschten Finger. */
export const MAX_DAUER: Record<PremiumGrantUnit, number> = {
  DAYS: 730,
  WEEKS: 104,
  MONTHS: 24,
};

export function dauerText(amount: number, unit: PremiumGrantUnit): string {
  const label = GRANT_UNIT_LABEL[unit] ?? GRANT_UNIT_LABEL.DAYS;
  return `${amount} ${amount === 1 ? label.eins : label.viele}`;
}

/**
 * Das Ende einer Laufzeit ausrechnen.
 *
 * ## Warum nicht einfach Millisekunden
 *
 * Weil «3 Monate» keine Anzahl Millisekunden ist. Ein Monat hat 28 bis 31
 * Tage, und zwischen Maerz und Oktober liegt in der Schweiz eine Zeitumstellung
 * - `jetzt + 90 * 24h` landet im Sommer eine Stunde falsch und im Februar im
 * falschen Monat. Gerechnet wird darum in **Kalenderteilen** in
 * `Europe/Zurich`, mit derselben Funktion, die auch die Tagesgrenzen der
 * Statistik bestimmt.
 *
 * Die Uhrzeit bleibt erhalten: eine Vergabe um 14:30 fuer sieben Tage endet um
 * 14:30 und nicht um Mitternacht. Wer um 23:50 eine Woche vergibt, soll nicht
 * zehn Minuten verschenken.
 *
 * ## Monatsenden
 *
 * Der 31. Januar plus ein Monat ist der 28. Februar und nicht der 3. Maerz.
 * `Date.UTC` wuerde ueberlaufen, darum wird auf den letzten Tag des
 * Zielmonats gekuerzt - so rechnet jede Abrechnung, die man kennt.
 */
export function laufzeitEnde(start: Date, amount: number, unit: PremiumGrantUnit, zone = ZEITZONE): Date {
  const t = teileIn(start, zone);
  const tage = unit === 'DAYS' ? amount : unit === 'WEEKS' ? amount * 7 : 0;

  if (unit !== 'MONTHS') {
    // `ortszeitAlsUtc` normalisiert den Tagesueberlauf selbst: der 28. Februar
    // plus drei Tage ist der 3. Maerz, und der 31. Dezember plus einer ist der
    // 1. Januar des Folgejahres.
    return ortszeitAlsUtc(zone, t.jahr, t.monat, t.tag + tage, t.stunde, t.minute);
  }

  const zielMonatRoh = t.monat + amount;
  const zielJahr = t.jahr + Math.floor((zielMonatRoh - 1) / 12);
  const zielMonat = ((zielMonatRoh - 1) % 12) + 1;
  // Der letzte Tag des Zielmonats: Tag 0 des Folgemonats.
  const letzterTag = new Date(Date.UTC(zielJahr, zielMonat, 0)).getUTCDate();
  const tag = Math.min(t.tag, letzterTag);
  return ortszeitAlsUtc(zone, zielJahr, zielMonat, tag, t.stunde, t.minute);
}

/**
 * Die Zeitzone, in Teilen - fuer Anzeige und Tests.
 *
 * Duenne Huellen um `@swisshub/shared`, damit ein Test nicht die
 * Zonenfunktionen einzeln importieren muss, um die Rechnung zu pruefen, die
 * hier stattfindet. Die Logik liegt weiterhin dort.
 */
export function teileOrtszeit(zeitpunkt: Date, zone = ZEITZONE): ReturnType<typeof teileIn> {
  return teileIn(zeitpunkt, zone);
}

export function ortszeitZuerich(jahr: number, monat: number, tag: number, stunde = 0, minute = 0): Date {
  return ortszeitAlsUtc(ZEITZONE, jahr, monat, tag, stunde, minute);
}

export type VergabeModus = 'extend' | 'replace';

export interface VergabeEingabe {
  discordId: string;
  productId: string;
  amount: number;
  unit: PremiumGrantUnit;
  /**
   * Was mit einer bestehenden Laufzeit geschieht.
   *
   * Ohne bestehende Laufzeit ist beides dasselbe, und es wird `NEW`
   * protokolliert. Eine stille Entscheidung gibt es nicht (§5): wer eine
   * bestehende Laufzeit ueberschreibt, hat `replace` gewaehlt.
   */
  modus: VergabeModus;
  /** Ab wann. Vorgabe: sofort. */
  startsAt?: Date;
  reason?: string | null;
  actor: SubscriptionActor;
  jetzt?: Date;
}

export interface VergabeVorschau {
  product: PremiumProduct;
  /** Die Leistungen, die dieses Angebot gewaehrt - in Worten. */
  leistungen: string[];
  /** Die bestehende Laufzeit, falls es eine gibt. */
  bestehend: {
    subscriptionId: string;
    produktName: string;
    status: string;
    endsAt: Date | null;
    /** Gehoert die bestehende Laufzeit zu einer bezahlten Buchung? */
    bezahlt: boolean;
  } | null;
  startsAt: Date;
  endsAt: Date;
  mode: PremiumGrantMode;
  /** Was ein `replace` an Restlaufzeit kosten wuerde - in Tagen, abgerundet. */
  verworfeneTage: number;
}

function pruefeDauer(amount: number, unit: PremiumGrantUnit): void {
  if (!Number.isInteger(amount) || amount < 1) {
    throw conflict('Die Dauer muss mindestens 1 betragen.');
  }
  const grenze = MAX_DAUER[unit] ?? MAX_DAUER.DAYS;
  if (amount > grenze) {
    const label = GRANT_UNIT_LABEL[unit] ?? GRANT_UNIT_LABEL.DAYS;
    throw conflict(`Mehr als ${grenze} ${label.viele} auf einmal sind nicht vorgesehen.`);
  }
}

/**
 * Was eine Vergabe bewirken wuerde - ohne sie auszufuehren.
 *
 * Die Oberflaeche zeigt damit das **resultierende Enddatum** (§9) und, bei
 * einer bestehenden Laufzeit, wieviel ein Ersetzen verwerfen wuerde (§5). Ein
 * Admin, der «Ersetzen» waehlt, ohne zu sehen, dass er damit 42 Tage
 * wegwirft, hat nicht entschieden, sondern geraten.
 *
 * Bewusst dieselbe Rechnung wie `vergebePremium` und nicht eine zweite:
 * beide rufen `laufzeitEnde` und `bestimmeLage`.
 */
export async function vorschauVergabe(
  eingabe: Omit<VergabeEingabe, 'actor' | 'reason'>,
): Promise<VergabeVorschau> {
  pruefeDauer(eingabe.amount, eingabe.unit);
  const jetzt = eingabe.jetzt ?? new Date();
  const start = eingabe.startsAt ?? jetzt;

  const product = await prisma.premiumProduct.findUnique({ where: { id: eingabe.productId } });
  if (!product) {
    throw notFound('Dieses Angebot gibt es nicht.');
  }

  const benutzer = await prisma.user.findUnique({
    where: { discordId: eingabe.discordId },
    select: { id: true },
  });
  const offen = benutzer
    ? await prisma.premiumSubscription.findFirst({
        where: { userId: benutzer.id, activeUserKey: { not: null } },
        include: { product: true },
      })
    : null;

  const lage = bestimmeLage(offen, eingabe.modus, start, eingabe.amount, eingabe.unit, jetzt);

  return {
    product,
    leistungen: product.entitlements.map((anspruch) => ENTITLEMENT_LABEL[anspruch]),
    bestehend: offen
      ? {
          subscriptionId: offen.id,
          produktName: offen.product.name,
          status: offen.status,
          endsAt: offen.currentPeriodEnd,
          // Eine bezahlte Buchung hat eine Anbieter-Abonnementnummer; eine
          // Vergabe oder ein Geschenk hat keine.
          bezahlt: offen.providerSubscriptionId !== null,
        }
      : null,
    startsAt: lage.startsAt,
    endsAt: lage.endsAt,
    mode: lage.mode,
    verworfeneTage: lage.verworfeneTage,
  };
}

interface Lage {
  startsAt: Date;
  endsAt: Date;
  mode: PremiumGrantMode;
  verworfeneTage: number;
}

/**
 * Die eine Stelle, an der Start, Ende und Modus entstehen.
 *
 * Rein und ohne Datenbank, damit Vorschau und Ausfuehrung unmoeglich
 * auseinanderlaufen koennen - und damit die Grenzfaelle pruefbar sind, ohne
 * ein Abonnement anzulegen.
 */
function bestimmeLage(
  offen: { currentPeriodEnd: Date | null } | null,
  modus: VergabeModus,
  start: Date,
  amount: number,
  unit: PremiumGrantUnit,
  jetzt: Date,
): Lage {
  if (!offen) {
    return { startsAt: start, endsAt: laufzeitEnde(start, amount, unit), mode: 'NEW', verworfeneTage: 0 };
  }

  const bestehendesEnde = offen.currentPeriodEnd;
  const restMs = bestehendesEnde ? Math.max(0, bestehendesEnde.getTime() - jetzt.getTime()) : 0;

  if (modus === 'extend') {
    /*
     * Angehaengt wird an das spaetere von beiden: bestehendes Ende oder Start.
     *
     * `Math.max` und nicht blind das bestehende Ende: eine abgelaufene, aber
     * noch nicht aufgeraeumte Laufzeit (der Ablaufjob laeuft im Takt, nicht in
     * Echtzeit) wuerde die Vergabe sonst in die Vergangenheit haengen - der
     * Beschenkte haette dann weniger als nichts.
     */
    const anker = new Date(Math.max(bestehendesEnde?.getTime() ?? 0, start.getTime()));
    return {
      startsAt: start,
      endsAt: laufzeitEnde(anker, amount, unit),
      mode: 'EXTEND',
      verworfeneTage: 0,
    };
  }

  return {
    startsAt: start,
    endsAt: laufzeitEnde(start, amount, unit),
    mode: 'REPLACE',
    verworfeneTage: Math.floor(restMs / (24 * 60 * 60 * 1000)),
  };
}

export type VergabeErgebnis = {
  grant: PremiumGrant;
  subscription: SubscriptionWithProduct;
  mode: PremiumGrantMode;
};

/**
 * Premium vergeben, verlaengern oder ersetzen.
 *
 * Alles in einer Transaktion mit derselben Sperre wie der Checkout: gesperrt
 * wird der **Benutzer** und nicht das Abonnement, denn es gibt vielleicht noch
 * keines. Ohne diese Sperre koennten zwei Admins gleichzeitig vergeben und
 * beide ihre Pruefung fuer bestanden halten - der Teilindex `activeUserKey`
 * wuerde den zweiten abweisen, aber erst nach dem Schreiben des Protokolls.
 */
export async function vergebePremium(eingabe: VergabeEingabe): Promise<VergabeErgebnis> {
  pruefeDauer(eingabe.amount, eingabe.unit);
  const jetzt = eingabe.jetzt ?? new Date();
  const start = eingabe.startsAt ?? jetzt;

  if (start.getTime() < jetzt.getTime() - 60_000) {
    throw conflict('Der Start darf nicht in der Vergangenheit liegen.');
  }

  const ergebnis = await prisma.$transaction(async (tx) => {
    const benutzer = await tx.user.findUnique({
      where: { discordId: eingabe.discordId },
      select: { id: true },
    });
    if (!benutzer) {
      throw notFound('Diese Person hat sich noch nie an der WebApp angemeldet.');
    }

    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${benutzer.id} FOR UPDATE`;

    const product = await tx.premiumProduct.findUnique({ where: { id: eingabe.productId } });
    if (!product) {
      throw notFound('Dieses Angebot gibt es nicht.');
    }

    const offen = await tx.premiumSubscription.findFirst({
      where: { userId: benutzer.id, activeUserKey: { not: null } },
      include: { product: true },
    });

    const lage = bestimmeLage(offen, eingabe.modus, start, eingabe.amount, eingabe.unit, jetzt);

    /*
     * Eine bezahlte Buchung wird nicht angetastet.
     *
     * Ihr Ende gehoert dem Anbieter: er verlaengert sie mit der naechsten
     * Zahlung, und ein von Hand gesetztes Ende waere beim naechsten Webhook
     * wieder weg - oder schlimmer, es bliebe und die Person haette Premium,
     * ohne zu zahlen, bis jemand es merkt. Verlaengern ist hier also
     * ausdruecklich nicht moeglich; der richtige Weg ist Gutschrift oder
     * Kuendigung beim Anbieter.
     */
    if (offen && offen.providerSubscriptionId !== null) {
      throw conflict(
        'Diese Person hat ein bezahltes Abonnement beim Zahlungsanbieter. Es lässt sich von Hand nicht verlängern oder ersetzen - das gehört in die Abrechnung des Anbieters.',
      );
    }

    let subscription: SubscriptionWithProduct;

    if (!offen) {
      subscription = await tx.premiumSubscription.create({
        data: {
          userId: benutzer.id,
          discordId: eingabe.discordId,
          productId: product.id,
          status: 'ACTIVE',
          activeUserKey: benutzer.id,
          currentPeriodStart: lage.startsAt,
          currentPeriodEnd: lage.endsAt,
          // Die Quelle steht am Abonnement, damit man es spaeter ansieht und
          // weiss, dass nie Geld dafuer geflossen ist.
          provider: 'manual',
          discordSyncStatus: 'PENDING',
        },
        include: { product: true },
      });
    } else {
      subscription = await tx.premiumSubscription.update({
        where: { id: offen.id },
        data: {
          // Ein neues Angebot heisst neue Leistungen - der Sync holt sie nach.
          productId: product.id,
          status: 'ACTIVE',
          currentPeriodStart: lage.mode === 'REPLACE' ? lage.startsAt : offen.currentPeriodStart,
          currentPeriodEnd: lage.endsAt,
          // Eine Verlaengerung nimmt eine Kuendigung und eine Schonfrist zurueck:
          // die Laufzeit ist jetzt bezahlt, egal was vorher offen war.
          cancelledAt: null,
          graceUntil: null,
          endedAt: null,
          activeUserKey: benutzer.id,
          provider: offen.provider ?? 'manual',
          discordSyncStatus: 'PENDING',
        },
        include: { product: true },
      });
    }

    const grant = await tx.premiumGrant.create({
      data: {
        userId: benutzer.id,
        discordId: eingabe.discordId,
        productId: product.id,
        subscriptionId: subscription.id,
        amount: eingabe.amount,
        unit: eingabe.unit,
        startsAt: lage.startsAt,
        endsAt: lage.endsAt,
        mode: lage.mode,
        reason: eingabe.reason?.trim() ? eingabe.reason.trim() : null,
        grantedByDiscordId: eingabe.actor.discordId,
        grantedByUsername: eingabe.actor.username,
      },
    });

    return { grant, subscription, mode: lage.mode };
  });

  const { meldeEreignis } = await import('../automation/emit');
  await meldeEreignis(
    'premium.activated',
    {
      subscriptionId: ergebnis.subscription.id,
      discordId: ergebnis.subscription.discordId,
      produkt: ergebnis.subscription.product.slug,
      laeuftBis: ergebnis.subscription.currentPeriodEnd?.toISOString() ?? null,
    },
    { subjectId: ergebnis.subscription.discordId, entityId: ergebnis.subscription.id },
  );

  const AKTION: Record<PremiumGrantMode, string> = {
    NEW: AUDIT_ACTIONS.PREMIUM_GRANT_CREATED,
    EXTEND: AUDIT_ACTIONS.PREMIUM_GRANT_EXTENDED,
    REPLACE: AUDIT_ACTIONS.PREMIUM_GRANT_REPLACED,
  };

  await safeRecordAudit({
    action: AKTION[ergebnis.mode] ?? AUDIT_ACTIONS.PREMIUM_GRANT_CREATED,
    module: PREMIUM_MODULE_ID,
    actorDiscordId: eingabe.actor.discordId,
    actorUsername: eingabe.actor.username,
    targetDiscordId: eingabe.discordId,
    targetLabel: ergebnis.subscription.product.name,
    success: true,
    metadata: {
      grantId: ergebnis.grant.id,
      subscriptionId: ergebnis.subscription.id,
      dauer: dauerText(eingabe.amount, eingabe.unit),
      modus: ergebnis.mode,
      laeuftBis: ergebnis.grant.endsAt.toISOString(),
      leistungen: ergebnis.subscription.product.entitlements,
      grund: ergebnis.grant.reason,
    },
  });

  logger.info('Premium vergeben', {
    grantId: ergebnis.grant.id,
    modus: ergebnis.mode,
    dauer: dauerText(eingabe.amount, eingabe.unit),
  });
  return ergebnis;
}

/**
 * Eine Vergabe vorzeitig beenden.
 *
 * Die Deprovisionierung laeuft ueber `endSubscriptionAdministratively` - also
 * dieselbe Funktion, die eine gekuendigte Buchung beendet. Das Stuebli wird
 * dadurch vom bestehenden Sync abgebaut, die Rolle entfernt, der Schluessel
 * freigegeben. Es gibt keinen Vergabe-eigenen Abbauweg.
 *
 * Die Historie bleibt vollstaendig (§11): der Eintrag wird auf `REVOKED`
 * gesetzt und behaelt Dauer, Grund und Zeitpunkt. Geloescht wird nichts.
 */
export async function widerrufeVergabe(
  grantId: string,
  actor: SubscriptionActor,
  grund: string,
  jetzt = new Date(),
): Promise<PremiumGrant> {
  const grant = await prisma.premiumGrant.findUnique({
    where: { id: grantId },
    include: { product: true },
  });
  if (!grant) {
    throw notFound('Diese Vergabe gibt es nicht.');
  }
  if (grant.status !== 'ACTIVE') {
    throw conflict('Diese Vergabe ist bereits beendet.');
  }

  if (grant.subscriptionId) {
    const abo = await prisma.premiumSubscription.findUnique({
      where: { id: grant.subscriptionId },
      select: { activeUserKey: true },
    });
    /*
     * Nur ein noch offenes Abonnement wird beendet.
     *
     * Eine Vergabe, deren Abonnement inzwischen abgelaufen ist oder durch eine
     * spaetere Vergabe ersetzt wurde, hat nichts mehr zu widerrufen - der
     * Eintrag wird nur noch als widerrufen vermerkt. Sonst beendete ein
     * Widerruf der **alten** Vergabe die **neue** Laufzeit.
     */
    if (abo?.activeUserKey) {
      const { endSubscriptionAdministratively } = await import('./service');
      await endSubscriptionAdministratively(grant.subscriptionId, actor, grund, jetzt);
    }
  }

  const aktualisiert = await prisma.premiumGrant.update({
    where: { id: grant.id },
    data: {
      status: 'REVOKED',
      revokedAt: jetzt,
      revokedByDiscordId: actor.discordId,
      revokedReason: grund.trim() || null,
    },
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.PREMIUM_GRANT_REVOKED,
    module: PREMIUM_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetDiscordId: grant.discordId,
    targetLabel: grant.product.name,
    success: true,
    metadata: {
      grantId: grant.id,
      subscriptionId: grant.subscriptionId,
      grund: grund.trim() || null,
      waereGelaufenBis: grant.endsAt.toISOString(),
    },
  });

  logger.info('Vergabe widerrufen', { grantId: grant.id });
  return aktualisiert;
}

export interface HistorieFilter {
  discordId?: string;
  productId?: string;
  status?: 'ACTIVE' | 'REVOKED' | 'EXPIRED';
  grenze?: number;
}

export type GrantZeile = PremiumGrant & { product: PremiumProduct };

/**
 * Die Vergabe-Historie (§10).
 *
 * `EXPIRED` wird beim Lesen abgeleitet und nicht von einem Job nachgetragen:
 * eine Vergabe, deren Ende vorbei ist, **ist** abgelaufen, und ein zweiter
 * Zustand in der Datenbank waere eine zweite Wahrheit, die irgendwann
 * hinterherhinkt. Gefiltert wird darum ueber dasselbe Kriterium.
 */
export async function ladeHistorie(filter: HistorieFilter = {}): Promise<GrantZeile[]> {
  const jetzt = new Date();
  const zeilen = await prisma.premiumGrant.findMany({
    where: {
      ...(filter.discordId ? { discordId: filter.discordId } : {}),
      ...(filter.productId ? { productId: filter.productId } : {}),
      ...(filter.status === 'REVOKED' ? { status: 'REVOKED' } : {}),
      ...(filter.status === 'ACTIVE' ? { status: 'ACTIVE', endsAt: { gt: jetzt } } : {}),
      ...(filter.status === 'EXPIRED' ? { status: 'ACTIVE', endsAt: { lte: jetzt } } : {}),
    },
    include: { product: true },
    orderBy: { createdAt: 'desc' },
    take: Math.min(filter.grenze ?? 100, 300),
  });
  return zeilen;
}

/** Der angezeigte Zustand einer Vergabe - abgeleitet, siehe `ladeHistorie`. */
export function grantZustand(
  grant: Pick<PremiumGrant, 'status' | 'endsAt'>,
  jetzt = new Date(),
): 'ACTIVE' | 'REVOKED' | 'EXPIRED' {
  if (grant.status === 'REVOKED') {
    return 'REVOKED';
  }
  return grant.endsAt <= jetzt ? 'EXPIRED' : 'ACTIVE';
}
