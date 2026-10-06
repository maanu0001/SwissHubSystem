import { createHmac, timingSafeEqual } from 'node:crypto';
import { createLogger } from '@swisshub/logger';
import { conflict } from '@swisshub/shared';
import { checkoutAdresse } from '../konfiguration';
import { normalisiereStatus } from '../katalog';
import type {
  CheckoutRequest,
  CheckoutSession,
  PaymentProvider,
  ProviderEvent,
  ProviderEventKind,
  ProviderSubscriptionView,
} from '../types';

const logger = createLogger('premium:generic-provider');

/**
 * Ein Anbieter, dessen Namen SwissHub nicht kennt (§16).
 *
 * ## Welches Problem er loest
 *
 * Die Wahl des Zahlungsanbieters ist offen. Fuer jeden Kandidaten einen
 * Adapter zu schreiben, ohne Zugangsdaten und ohne Entscheidung, hiesse acht
 * Dateien zu schreiben, von denen sieben nie laufen - und sie alle waeren
 * ungetestet gegen die echte Schnittstelle.
 *
 * Dieser Adapter nimmt stattdessen das kleinste Verhalten, das praktisch jeder
 * Anbieter zeigt: ein POST mit Betrag, Waehrung und Rueckkehradressen, Antwort
 * mit einer Weiterleitungsadresse; danach ein signierter Webhook. Damit laesst
 * sich ein neuer Anbieter oft ohne Code anbinden - und wo es nicht reicht,
 * bekommt er einen eigenen Adapter, ohne dass sich an Premium etwas aendert.
 *
 * ## Was er ausdruecklich nicht kann
 *
 * Erstattungen, Abonnementverwaltung und das Nachlesen eines Zahlungsstands.
 * Alles drei braeuchte Wissen ueber die Antwortform des Anbieters, und die
 * ist der Teil, der sich zwischen Anbietern am meisten unterscheidet. Die
 * Faehigkeiten im Katalog sagen das; die Oberflaeche zeigt entsprechend keine
 * Knoepfe, hinter denen nichts ist.
 *
 * ## Warum kein Feld fuer eigenen Code
 *
 * Weil ein Feld, in das man ein Skript schreibt, eine Fernsteuerung des
 * Servers ist - und der Weg dorthin waere ein Dashboard-Login. Die
 * Spezifikation schliesst das aus, und das ist richtig: Konfiguration ist
 * Daten, nicht Programm.
 */
export interface GenericKonfiguration {
  baseUrl: string;
  checkoutPath: string;
  apiKey: string;
  webhookSecret: string;
  merchantId: string | null;
  /** Testmodus - reist als Feld mit, damit der Anbieter nichts verrechnet. */
  testModus: boolean;
}

/** Die Antwort, die wir erwarten - alles andere wird abgelehnt. */
interface CheckoutAntwort {
  url?: unknown;
  redirectUrl?: unknown;
  checkoutUrl?: unknown;
  id?: unknown;
  sessionId?: unknown;
  customerId?: unknown;
}

const FRIST_MS = 10_000;

function ersteZeichenkette(...werte: unknown[]): string | null {
  for (const wert of werte) {
    if (typeof wert === 'string' && wert.trim() !== '') {
      return wert.trim();
    }
  }
  return null;
}

export class GenericProvider implements PaymentProvider {
  readonly name = 'generic';
  readonly productionReady = true;

  constructor(private readonly konfiguration: GenericKonfiguration) {}

  async createCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
    // Die Pruefung sitzt in `checkoutAdresse`: https, kein internes Netz,
    // keine Zugangsdaten in der Adresse, der Pfad bleibt ein Pfad.
    const ziel = checkoutAdresse(this.konfiguration.baseUrl, this.konfiguration.checkoutPath);

    const antwort = await fetch(ziel, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.konfiguration.apiKey}`,
        accept: 'application/json',
      },
      body: JSON.stringify({
        amount: request.product.priceMinor,
        currency: request.product.currency,
        reference: request.subscriptionId,
        description: request.product.name,
        successUrl: request.successUrl,
        cancelUrl: request.cancelUrl,
        merchantId: this.konfiguration.merchantId,
        testMode: this.konfiguration.testModus,
        /*
         * Keine personenbezogenen Daten ueber das Noetige hinaus.
         *
         * Die interne Kennung muss mitreisen, damit der Webhook zuordnen kann.
         * Der Discord-Name tut es nicht - ein Zahlungsanbieter braucht ihn
         * nicht, und was man nicht sendet, kann auch nicht verloren gehen.
         */
        metadata: { subscriptionId: request.subscriptionId, userId: request.userId },
      }),
      signal: AbortSignal.timeout(FRIST_MS),
    }).catch((fehler: unknown) => {
      logger.warn('Checkout beim eigenen Anbieter fehlgeschlagen', {
        fehler: fehler instanceof Error ? fehler.message : 'unbekannt',
      });
      throw conflict('Der Zahlungsanbieter hat nicht geantwortet.');
    });

    if (!antwort.ok) {
      /*
       * Der Rohtext des Anbieters geht nicht an den Browser.
       *
       * Er kann Teile der Anfrage enthalten - bei manchen Anbietern samt
       * Schluessel im Kopf der Fehlermeldung. Was der Benutzer sieht, ist der
       * Code; was wir sehen, steht im Protokoll, und dort redigiert der
       * Logger bekannte Geheimnisse.
       */
      logger.warn('Der eigene Anbieter hat den Checkout abgelehnt', { status: antwort.status });
      throw conflict(`Der Zahlungsanbieter hat den Kauf abgelehnt (HTTP ${antwort.status}).`);
    }

    const daten = (await antwort.json().catch(() => null)) as CheckoutAntwort | null;
    const url = ersteZeichenkette(daten?.url, daten?.redirectUrl, daten?.checkoutUrl);
    if (!url) {
      throw conflict('Der Zahlungsanbieter hat keine Weiterleitungsadresse geliefert.');
    }
    // Auch die Antwort wird geprueft: ein Anbieter, der auf `http://` oder in
    // ein internes Netz weiterleitet, bekommt den Browser nicht.
    const geprueft = new URL(url);
    if (geprueft.protocol !== 'https:') {
      throw conflict('Der Zahlungsanbieter hat eine unsichere Adresse geliefert.');
    }

    return {
      url: geprueft.toString(),
      providerSessionId: ersteZeichenkette(daten?.id, daten?.sessionId) ?? request.subscriptionId,
      providerCustomerId: ersteZeichenkette(daten?.customerId),
    };
  }

  async cancelSubscription(): Promise<void> {
    throw conflict(
      'Der eigene Anbieter kennt keine Abonnementverwaltung. Die Kündigung muss beim Anbieter selbst erfolgen.',
    );
  }

  async resumeSubscription(): Promise<void> {
    throw conflict('Der eigene Anbieter kennt keine Abonnementverwaltung.');
  }

  async getSubscription(): Promise<ProviderSubscriptionView | null> {
    // Ehrlich `null` statt eines erfundenen Stands: wer nichts weiss, soll
    // nicht so tun, als wisse er etwas.
    return null;
  }

  async refundPayment(): Promise<void> {
    throw conflict(
      'Erstattungen laufen beim eigenen Anbieter nicht über SwissHub. Sie müssen dort ausgelöst werden.',
    );
  }

  /**
   * Die Signatur pruefen und das Ereignis uebersetzen.
   *
   * HMAC-SHA256 ueber den **unveraenderten** Rohkoerper, verglichen in
   * konstanter Zeit. Das ist das Verfahren, das Stripe, Wallee und die
   * meisten anderen benutzen; wer es anders macht, braucht einen eigenen
   * Adapter.
   *
   * Eine fehlende oder falsche Signatur wirft - es wird nichts gespeichert und
   * nichts veraendert (§21).
   */
  async verifyWebhook(rawBody: string, signature: string): Promise<ProviderEvent> {
    const erwartet = createHmac('sha256', this.konfiguration.webhookSecret)
      .update(rawBody, 'utf8')
      .digest('hex');
    const geliefert = signature.trim().replace(/^sha256=/iu, '');

    const a = Buffer.from(erwartet, 'utf8');
    const b = Buffer.from(geliefert, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw conflict('Die Signatur des Webhooks stimmt nicht.');
    }

    const nutzlast = JSON.parse(rawBody) as Record<string, unknown>;
    const art = typeof nutzlast.type === 'string' ? nutzlast.type : 'unknown';
    const status = normalisiereStatus(
      typeof nutzlast.status === 'string' ? nutzlast.status : null,
    );

    /*
     * Die Abbildung auf die Ereignisarten, die das Modul versteht.
     *
     * Bewusst eng: was nicht eindeutig eine Zahlung oder ein Fehlschlag ist,
     * wird `unknown` und damit ignoriert statt geraten. Ein geratenes
     * `payment.succeeded` ist ein freigeschaltetes Premium ohne Geld.
     */
    const kind: ProviderEventKind =
      status === 'PAID'
        ? 'payment.succeeded'
        : status === 'FAILED'
          ? 'payment.failed'
          : status === 'CANCELLED'
            ? 'subscription.cancelled'
            : 'unknown';

    const id = ersteZeichenkette(nutzlast.id, nutzlast.eventId);
    if (!id) {
      // Ohne Ereignis-Kennung gibt es keine Idempotenz (§22) - und ohne
      // Idempotenz keine Verarbeitung.
      throw conflict('Dem Webhook fehlt eine Ereignis-Kennung.');
    }

    const metadaten = (nutzlast.metadata ?? {}) as Record<string, unknown>;

    return {
      id,
      type: art,
      kind,
      subscriptionId: ersteZeichenkette(metadaten.subscriptionId, nutzlast.reference),
      providerSubscriptionId: ersteZeichenkette(nutzlast.subscriptionId),
      providerCustomerId: ersteZeichenkette(nutzlast.customerId),
      providerPaymentId: ersteZeichenkette(nutzlast.paymentId, nutzlast.id),
      amountMinor: typeof nutzlast.amount === 'number' ? nutzlast.amount : null,
      currency: ersteZeichenkette(nutzlast.currency),
      periodStart: null,
      periodEnd: null,
      failureReason: ersteZeichenkette(nutzlast.failureReason, nutzlast.error),
      /*
       * Was abgelegt wird, ist bewusst wenig.
       *
       * Die Rohnutzlast eines Zahlungsanbieters kann Kartendetails,
       * Rechnungsadressen und Namen enthalten. Davon braucht SwissHub
       * nichts, und was nicht gespeichert wird, kann nicht auslaufen.
       */
      payload: { type: art, status, id },
    };
  }
}

/**
 * Ein Anbieter, der konfigurierbar ist, aber noch keinen Adapter hat.
 *
 * ## Warum es diese Klasse gibt
 *
 * Damit «vorbereitet» nicht «simuliert» heisst. Ein Profil ohne Adapter kann
 * im Dashboard gewaehlt und mit Zugangsdaten gefuellt werden - das ist der
 * Sinn der Vorbereitung. Was es nicht kann, ist eine Zahlung ausloesen, und
 * genau das sagt es dann auch, in einem Satz, den ein Admin versteht.
 *
 * Die Alternative waere gewesen, die sieben Profile stillschweigend auf den
 * generischen Adapter zu legen. Das haette funktioniert, bis es nicht
 * funktioniert - mitten in einem Kauf, mit einer Fehlermeldung ueber eine
 * Antwortform, die niemand erwartet hat.
 */
export class NichtAngeschlossenProvider implements PaymentProvider {
  readonly productionReady = false;

  constructor(
    readonly name: string,
    private readonly label: string,
  ) {}

  private nein(): never {
    throw conflict(
      `Für ${this.label} ist in SwissHub noch kein Adapter angeschlossen. Die Zugangsdaten lassen sich hinterlegen, Zahlungen laufen damit noch nicht.`,
    );
  }

  async createCheckout(): Promise<CheckoutSession> {
    this.nein();
  }
  async cancelSubscription(): Promise<void> {
    this.nein();
  }
  async resumeSubscription(): Promise<void> {
    this.nein();
  }
  async getSubscription(): Promise<ProviderSubscriptionView | null> {
    return null;
  }
  async refundPayment(): Promise<void> {
    this.nein();
  }
  async verifyWebhook(): Promise<ProviderEvent> {
    // Ein Webhook ohne Adapter wird **abgewiesen** und nicht durchgewunken:
    // ohne Signaturpruefung des jeweiligen Anbieters waere jedes Ereignis
    // echt, das jemand schickt.
    this.nein();
  }
}
