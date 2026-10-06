/**
 * Die Zahlungsanbieter, die SwissHub kennt - und was jeder davon kann.
 *
 * ## Warum ein Katalog und keine Reihe von `if`-Zweigen
 *
 * Weil die Antwort auf «koennen wir eine Zahlung zurueckerstatten» vom
 * Anbieter abhaengt und an genau einer Stelle stehen soll. Steht sie verteilt,
 * zeigt die Oberflaeche irgendwann einen Knopf, hinter dem nichts ist - und
 * jemand drueckt ihn, waehrend ein Kunde am Telefon wartet.
 *
 * ## Warum die Faehigkeiten nicht gleich aussehen
 *
 * Weil sie es nicht sind (§15). Stripe fuehrt Abonnements selbst; SumUp
 * kennt nur Einzelzahlungen. Datatrans erstattet ueber eine eigene
 * Schnittstelle, PayPal ueber dieselbe wie die Zahlung. Zu behaupten, alle
 * seien gleich, waere bequem und unwahr - und die Unwahrheit faellt erst
 * auf, wenn Geld im Spiel ist.
 *
 * ## Was «vorbereitet» heisst
 *
 * Die meisten Eintraege hier sind **Profile** und kein Code: sie sagen, wie
 * der Anbieter heisst, welche Felder er braucht, was er kann und wo seine
 * Dokumentation steht. Einen Adapter mit echten HTTP-Aufrufen gibt es fuer
 * Stripe (gewachsen, in Betrieb), fuer den Mock (Entwicklung) und fuer den
 * generischen Anbieter (§16). Die uebrigen melden offen, dass ihr Adapter
 * fehlt, statt eine Zahlung zu simulieren, die nie stattfand.
 *
 * Das ist ausdruecklich die Vorgabe aus der Spezifikation: keine realen
 * Zahlungen, solange kein Anbieter produktiv aktiviert und vollstaendig
 * konfiguriert ist.
 */

/** Was ein Anbieter leisten kann. */
export interface ProviderCapabilities {
  /** Eine Kaufsitzung eroeffnen - das Minimum, ohne das er nutzlos waere. */
  checkout: boolean;
  /** Den Stand einer Zahlung abfragen, ohne auf ein Ereignis zu warten. */
  paymentStatus: boolean;
  /** Zurueckerstatten. */
  refund: boolean;
  /** Wiederkehrende Zahlungen fuehrt der Anbieter selbst. */
  subscriptions: boolean;
  /** Ein laufendes Abonnement beim Anbieter kuendigen. */
  cancelSubscription: boolean;
  /** Den Stand eines Abonnements beim Anbieter nachlesen. */
  syncSubscription: boolean;
  /** Signierte Ereignisse, die wir pruefen koennen. */
  webhooks: boolean;
  /** Ein Testmodus, der von den Echtdaten getrennt ist. */
  testMode: boolean;
}

/** Welche Felder ein Anbieter braucht - jenseits der gemeinsamen. */
export type ProviderFeldSchluessel =
  | 'apiKey'
  | 'apiSecret'
  | 'webhookSecret'
  | 'merchantId'
  | 'baseUrl'
  | 'checkoutPath';

export interface ProviderProfil {
  id: string;
  label: string;
  /** Ein Satz dazu, wofuer man ihn nimmt. */
  beschreibung: string;
  /** Wo die Zugangsdaten herkommen - fuer die Oberflaeche. */
  dokumentation: string | null;
  capabilities: ProviderCapabilities;
  /** Pflichtfelder. Ohne sie ist die Konfiguration unvollstaendig. */
  pflicht: readonly ProviderFeldSchluessel[];
  /** Felder, die er kennt, aber nicht braucht. */
  optional: readonly ProviderFeldSchluessel[];
  /**
   * Gibt es einen Adapter mit echten Aufrufen?
   *
   * `false` heisst: konfigurierbar, aber noch nicht angeschlossen. Die
   * Oberflaeche sagt das, und der Checkout bleibt zu. Eine Konfiguration, die
   * nach «fertig» aussieht und dann nichts tut, waere schlimmer als eine, die
   * offen sagt, was fehlt.
   */
  adapter: boolean;
  /** Darf in Production laufen? Der Mock ausdruecklich nicht. */
  produktionstauglich: boolean;
  /** Waehrungen, von denen wir wissen, dass er sie nimmt. Leer = unbekannt. */
  waehrungen: readonly string[];
}

const NICHTS: ProviderCapabilities = {
  checkout: false,
  paymentStatus: false,
  refund: false,
  subscriptions: false,
  cancelSubscription: false,
  syncSubscription: false,
  webhooks: false,
  testMode: false,
};

/**
 * Die Profile.
 *
 * Die Faehigkeiten stehen hier so, wie der jeweilige Anbieter sie laut seiner
 * oeffentlichen Dokumentation hat - nicht so, wie es bequem waere. Wo ein
 * Anbieter etwas kann, der Adapter es aber nicht nutzt, sagt `adapter: false`
 * die Wahrheit ueber unseren Stand, und die Faehigkeit sagt die Wahrheit ueber
 * seinen.
 */
export const PROVIDER_PROFILE: readonly ProviderProfil[] = [
  {
    id: 'stripe',
    label: 'Stripe',
    beschreibung:
      'Abonnements, Einzelzahlungen, Erstattungen und signierte Webhooks. Der einzige Anbieter mit einem gewachsenen Adapter in SwissHub.',
    dokumentation: 'https://dashboard.stripe.com/apikeys',
    capabilities: {
      checkout: true,
      paymentStatus: true,
      refund: true,
      subscriptions: true,
      cancelSubscription: true,
      syncSubscription: true,
      webhooks: true,
      testMode: true,
    },
    pflicht: ['apiKey', 'webhookSecret'],
    optional: [],
    adapter: true,
    produktionstauglich: true,
    waehrungen: ['CHF', 'EUR', 'USD'],
  },
  {
    id: 'paypal',
    label: 'PayPal',
    beschreibung:
      'Weit verbreitet, fuehrt Abonnements selbst. Erstattungen ueber dieselbe Schnittstelle wie die Zahlung.',
    dokumentation: 'https://developer.paypal.com/dashboard/applications',
    capabilities: {
      checkout: true,
      paymentStatus: true,
      refund: true,
      subscriptions: true,
      cancelSubscription: true,
      syncSubscription: true,
      webhooks: true,
      testMode: true,
    },
    // Client ID und Secret - bei PayPal heissen sie so, hier `apiKey`/`apiSecret`.
    pflicht: ['apiKey', 'apiSecret', 'webhookSecret'],
    optional: [],
    adapter: false,
    produktionstauglich: true,
    waehrungen: ['CHF', 'EUR', 'USD'],
  },
  {
    id: 'mollie',
    label: 'Mollie',
    beschreibung:
      'Europaeischer Anbieter mit TWINT, Karten und Lastschrift. Abonnements ueber eigene Subscriptions-Schnittstelle.',
    dokumentation: 'https://my.mollie.com/dashboard/developers/api-keys',
    capabilities: {
      checkout: true,
      paymentStatus: true,
      refund: true,
      subscriptions: true,
      cancelSubscription: true,
      syncSubscription: true,
      // Mollie signiert nicht, sondern schickt nur eine Zahlungs-ID und
      // erwartet, dass man den Stand selbst abfragt. Das ist eine andere
      // Sicherheitsannahme als eine Signatur - und sie steht hier, damit die
      // Webhook-Pruefung weiss, dass sie nachfragen muss.
      webhooks: false,
      testMode: true,
    },
    pflicht: ['apiKey'],
    optional: ['webhookSecret'],
    adapter: false,
    produktionstauglich: true,
    waehrungen: ['CHF', 'EUR'],
  },
  {
    id: 'sumup',
    label: 'SumUp',
    beschreibung:
      'Schweizer Kartenzahlung, stark im Ladengeschaeft. Einzelzahlungen - keine Abonnements.',
    dokumentation: 'https://developer.sumup.com/api-keys',
    capabilities: {
      checkout: true,
      paymentStatus: true,
      refund: true,
      // Ausdruecklich nicht: SumUp kennt keine wiederkehrende Buchung. Ein
      // Monatsabo muesste SwissHub selbst takten - und das ist eine
      // Entscheidung, nicht ein Haken.
      subscriptions: false,
      cancelSubscription: false,
      syncSubscription: false,
      webhooks: true,
      testMode: true,
    },
    pflicht: ['apiKey', 'merchantId'],
    optional: ['webhookSecret'],
    adapter: false,
    produktionstauglich: true,
    waehrungen: ['CHF', 'EUR'],
  },
  {
    id: 'wallee',
    label: 'Wallee',
    beschreibung:
      'Schweizer Zahlungsplattform mit TWINT und Karten. Abonnements ueber Subscription-Dienst.',
    dokumentation: 'https://app-wallee.com/space/select?target=/application-user/list',
    capabilities: {
      checkout: true,
      paymentStatus: true,
      refund: true,
      subscriptions: true,
      cancelSubscription: true,
      syncSubscription: true,
      webhooks: true,
      testMode: true,
    },
    // Space ID als `merchantId`, Application User ID als `apiKey`, der
    // geheime Schluessel als `apiSecret`.
    pflicht: ['apiKey', 'apiSecret', 'merchantId'],
    optional: ['webhookSecret'],
    adapter: false,
    produktionstauglich: true,
    waehrungen: ['CHF', 'EUR'],
  },
  {
    id: 'datatrans',
    label: 'Datatrans',
    beschreibung:
      'Schweizer Zahlungsdienstleister, TWINT und Karten. Erstattungen ueber eine eigene Schnittstelle.',
    dokumentation: 'https://admin.sandbox.datatrans.com',
    capabilities: {
      checkout: true,
      paymentStatus: true,
      refund: true,
      // Datatrans kennt Registrierungen fuer Folgezahlungen, aber kein
      // Abonnement, das er selbst taktet.
      subscriptions: false,
      cancelSubscription: false,
      syncSubscription: false,
      webhooks: true,
      testMode: true,
    },
    pflicht: ['merchantId', 'apiSecret'],
    optional: ['webhookSecret'],
    adapter: false,
    produktionstauglich: true,
    waehrungen: ['CHF', 'EUR'],
  },
  {
    id: 'saferpay',
    label: 'Worldline / Saferpay',
    beschreibung:
      'Worldline Saferpay - Karten, TWINT, PostFinance. Abonnements ueber Secure Card Data und eigene Taktung.',
    dokumentation: 'https://docs.saferpay.com',
    capabilities: {
      checkout: true,
      paymentStatus: true,
      refund: true,
      subscriptions: false,
      cancelSubscription: false,
      syncSubscription: false,
      webhooks: true,
      testMode: true,
    },
    // Customer ID und Terminal ID, dazu JSON-API-Benutzer und -Passwort.
    pflicht: ['merchantId', 'apiKey', 'apiSecret'],
    optional: ['webhookSecret'],
    adapter: false,
    produktionstauglich: true,
    waehrungen: ['CHF', 'EUR'],
  },
  {
    id: 'generic',
    label: 'Eigener Anbieter',
    beschreibung:
      'Fuer einen Anbieter, den SwissHub noch nicht kennt: Adresse, Schluessel und ein Endpunkt fuer die Kaufsitzung. Nur signierte Webhooks.',
    dokumentation: null,
    capabilities: {
      checkout: true,
      // Ohne zu wissen, wie seine Antwort aussieht, laesst sich ein Stand
      // nicht lesen. Der Weg ist der Webhook.
      paymentStatus: false,
      refund: false,
      subscriptions: false,
      cancelSubscription: false,
      syncSubscription: false,
      webhooks: true,
      testMode: true,
    },
    pflicht: ['baseUrl', 'checkoutPath', 'apiKey', 'webhookSecret'],
    optional: ['merchantId'],
    adapter: true,
    produktionstauglich: true,
    waehrungen: [],
  },
  {
    id: 'mock',
    label: 'Mock (nur Entwicklung)',
    beschreibung:
      'Ein Anbieter, bei dem kein Geld fliesst. Fuer die Entwicklung - in Production ausdruecklich verboten.',
    dokumentation: null,
    capabilities: {
      checkout: true,
      paymentStatus: true,
      refund: true,
      subscriptions: true,
      cancelSubscription: true,
      syncSubscription: true,
      webhooks: true,
      testMode: true,
    },
    pflicht: ['webhookSecret'],
    optional: [],
    adapter: true,
    produktionstauglich: false,
    waehrungen: ['CHF'],
  },
];

export const PROVIDER_IDS: readonly string[] = PROVIDER_PROFILE.map((profil) => profil.id);

export function providerProfil(id: string): ProviderProfil | null {
  return PROVIDER_PROFILE.find((profil) => profil.id === id) ?? null;
}

/** Die Faehigkeiten eines Anbieters - oder gar keine, wenn es ihn nicht gibt. */
export function providerCapabilities(id: string | null | undefined): ProviderCapabilities {
  if (!id) {
    return NICHTS;
  }
  return providerProfil(id)?.capabilities ?? NICHTS;
}

export const CAPABILITY_LABEL: Record<keyof ProviderCapabilities, string> = {
  checkout: 'Kaufsitzung',
  paymentStatus: 'Zahlungsstand abfragen',
  refund: 'Erstattung',
  subscriptions: 'Abonnements',
  cancelSubscription: 'Abo kündigen',
  syncSubscription: 'Abo abgleichen',
  webhooks: 'Signierte Webhooks',
  testMode: 'Testmodus',
};

export const FELD_LABEL: Record<ProviderFeldSchluessel, string> = {
  apiKey: 'API Key / Benutzer',
  apiSecret: 'API Secret / Passwort',
  webhookSecret: 'Webhook Secret',
  merchantId: 'Merchant / Space ID',
  baseUrl: 'Base URL',
  checkoutPath: 'Checkout Endpoint',
};

/** Der Betriebsmodus einer Zahlungsintegration (§19). */
export type PaymentModus = 'TEST' | 'LIVE';

/**
 * Normalisierte Zahlungsstati (§23).
 *
 * Dieselben Werte wie `PremiumPaymentStatus` in der Datenbank - hier als
 * Typ, damit ein Adapter ihn nennen kann, ohne das Datenbankpaket zu
 * importieren.
 */
export type NormalisierterStatus =
  | 'PENDING'
  | 'PAID'
  | 'FAILED'
  | 'CANCELLED'
  | 'REFUNDED'
  | 'EXPIRED';

/**
 * Anbieterstati auf unsere abbilden.
 *
 * Eine Tabelle und keine Kette von `includes`: so steht fuer jeden Anbieter
 * an einer Stelle, was «gut» heisst, und ein unbekannter Status wird
 * `PENDING` statt versehentlich `PAID`. Die vorsichtige Richtung ist hier die
 * richtige - ein zu frueh freigeschaltetes Premium ist schwerer zu
 * korrigieren als ein zu spaet freigeschaltetes.
 */
const STATUS_TABELLE: Readonly<Record<string, NormalisierterStatus>> = {
  // Stripe
  succeeded: 'PAID',
  paid: 'PAID',
  complete: 'PAID',
  requires_payment_method: 'FAILED',
  canceled: 'CANCELLED',
  // PayPal
  COMPLETED: 'PAID',
  APPROVED: 'PENDING',
  DECLINED: 'FAILED',
  VOIDED: 'CANCELLED',
  // Mollie
  open: 'PENDING',
  pending: 'PENDING',
  authorized: 'PENDING',
  expired: 'EXPIRED',
  failed: 'FAILED',
  canceled_mollie: 'CANCELLED',
  // Datatrans / Saferpay / Wallee
  settled: 'PAID',
  transmitted: 'PAID',
  authorized_datatrans: 'PENDING',
  AUTHORIZED: 'PENDING',
  CAPTURED: 'PAID',
  FULFILL: 'PAID',
  // Erstattungen, ueberall aehnlich benannt
  refunded: 'REFUNDED',
  REFUNDED: 'REFUNDED',
  partially_refunded: 'REFUNDED',
};

export function normalisiereStatus(roh: string | null | undefined): NormalisierterStatus {
  if (!roh) {
    return 'PENDING';
  }
  const direkt = STATUS_TABELLE[roh];
  if (direkt) {
    return direkt;
  }
  const klein = STATUS_TABELLE[roh.toLowerCase()];
  if (klein) {
    return klein;
  }
  const gross = STATUS_TABELLE[roh.toUpperCase()];
  return gross ?? 'PENDING';
}
