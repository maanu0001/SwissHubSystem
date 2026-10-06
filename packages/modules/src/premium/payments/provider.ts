import { env, isProduction } from '@swisshub/config';
import { createLogger } from '@swisshub/logger';
import { conflict } from '@swisshub/shared';
import type { PaymentProvider } from './types';
import { MockProvider } from './providers/mock.provider';
import { StripeProvider } from './providers/stripe.provider';
import { GenericProvider, NichtAngeschlossenProvider } from './providers/generic.provider';
import { providerProfil, type ProviderCapabilities, providerCapabilities } from './katalog';
import { geheimnis, ladeKonfiguration, type ZahlungsKonfiguration } from './konfiguration';

const logger = createLogger('premium:payments');

/**
 * Der konfigurierte Zahlungsanbieter.
 *
 * ## Warum es zwei Wege hierher gibt
 *
 * `aufloeseAnbieter` liest die Konfiguration aus dem verschluesselten
 * Speicher - das ist der Weg, den das Dashboard steuert (§13, §17), und er ist
 * asynchron, weil Datenbank und Entschluesselung es sind.
 *
 * `resolvePaymentProvider` bleibt daneben bestehen und liest die Umgebung. Es
 * gibt drei Aufrufer, die synchron sind und seit der ersten Fassung von
 * Premium so arbeiten; sie umzubauen waere ein Umbau an Stellen, die diese
 * Aufgabe nicht betrifft. Beide Wege fuehren zu denselben Adapterklassen, und
 * `getSecret` zieht die Umgebung ohnehin als Rueckfall - eine Installation
 * mit `PAYMENT_*` in der Umgebung verhaelt sich also unveraendert, egal
 * welchen Weg der Aufrufer nimmt.
 */

let zwischengespeichert: PaymentProvider | null = null;

export function resolvePaymentProvider(): PaymentProvider {
  if (zwischengespeichert) {
    return zwischengespeichert;
  }

  const name = (env.PAYMENT_PROVIDER ?? 'mock').trim().toLowerCase();

  if (name === 'mock') {
    if (isProduction()) {
      throw new Error(
        'PAYMENT_PROVIDER=mock ist in Production nicht zulässig. Bitte einen echten Zahlungsanbieter konfigurieren.',
      );
    }
    logger.warn('Mock-Zahlungsanbieter aktiv - es fliesst kein Geld.');
    zwischengespeichert = new MockProvider(env.PAYMENT_WEBHOOK_SECRET ?? 'dev-webhook-secret');
    return zwischengespeichert;
  }

  if (name === 'stripe') {
    if (!env.PAYMENT_API_KEY || !env.PAYMENT_WEBHOOK_SECRET) {
      throw new Error('PAYMENT_API_KEY und PAYMENT_WEBHOOK_SECRET werden für Stripe benötigt.');
    }
    zwischengespeichert = new StripeProvider(env.PAYMENT_API_KEY, env.PAYMENT_WEBHOOK_SECRET);
    return zwischengespeichert;
  }

  /*
   * Ein Anbieter, der nur in der Datenbank konfiguriert ist.
   *
   * Dieser Weg kennt ihn nicht - er liest die Umgebung. Statt zu werfen
   * (was den Start abbrechen wuerde) wird hier nur gemeldet, dass der
   * synchrone Weg nichts findet; wer den Anbieter wirklich braucht, nimmt
   * `aufloeseAnbieter`.
   */
  throw new Error(
    `Der Zahlungsanbieter "${name}" ist über die Umgebung nicht auflösbar. Er wird unter System → Integrationen → Zahlungen konfiguriert.`,
  );
}

/** Nur fuer Tests: den gemerkten Anbieter vergessen. */
export function resetPaymentProvider(): void {
  zwischengespeichert = null;
}

export interface AufgeloesterAnbieter {
  provider: PaymentProvider;
  konfiguration: ZahlungsKonfiguration;
  capabilities: ProviderCapabilities;
}

/**
 * Den Anbieter aus der gespeicherten Konfiguration bauen.
 *
 * Wirft nicht, wenn nichts konfiguriert ist: der Aufrufer bekommt `null` und
 * entscheidet selbst, was das heisst. Fuer den Checkout heisst es «nicht
 * verfuegbar» (§27), fuer die Integrationsseite «noch einzurichten» - und
 * beides ist kein Fehlerzustand.
 */
export async function aufloeseAnbieter(): Promise<AufgeloesterAnbieter | null> {
  const konfiguration = await ladeKonfiguration();
  if (!konfiguration.providerId || !konfiguration.profil) {
    return null;
  }

  const profil = konfiguration.profil;
  const capabilities = providerCapabilities(profil.id);

  if (profil.id === 'mock') {
    if (isProduction()) {
      throw conflict('Der Mock-Anbieter ist in Production nicht zulässig.');
    }
    const secret = (await geheimnis('webhookSecret')) ?? 'dev-webhook-secret';
    return { provider: new MockProvider(secret), konfiguration, capabilities };
  }

  if (profil.id === 'stripe') {
    const apiKey = await geheimnis('apiKey');
    const webhookSecret = await geheimnis('webhookSecret');
    if (!apiKey || !webhookSecret) {
      throw conflict('Für Stripe fehlen API Key oder Webhook Secret.');
    }
    return { provider: new StripeProvider(apiKey, webhookSecret), konfiguration, capabilities };
  }

  if (profil.id === 'generic') {
    const [baseUrl, checkoutPath, apiKey, webhookSecret, merchantId] = await Promise.all([
      geheimnis('baseUrl'),
      geheimnis('checkoutPath'),
      geheimnis('apiKey'),
      geheimnis('webhookSecret'),
      geheimnis('merchantId'),
    ]);
    if (!baseUrl || !checkoutPath || !apiKey || !webhookSecret) {
      throw conflict('Für den eigenen Anbieter fehlen Adresse, Endpunkt, Schlüssel oder Secret.');
    }
    return {
      provider: new GenericProvider({
        baseUrl,
        checkoutPath,
        apiKey,
        webhookSecret,
        merchantId: merchantId ?? null,
        testModus: konfiguration.modus === 'TEST',
      }),
      konfiguration,
      capabilities,
    };
  }

  // Konfigurierbar, aber ohne Adapter - und das sagt er auch.
  return {
    provider: new NichtAngeschlossenProvider(profil.id, profil.label),
    konfiguration,
    capabilities,
  };
}

/**
 * Darf der Checkout angeboten werden? (§27)
 *
 * Eine eigene Funktion, weil die Antwort an mehreren Stellen gebraucht wird -
 * auf der oeffentlichen Angebotsseite, in der Server Action und in der
 * Verwaltungsuebersicht. Drei eigene Pruefungen wuerden irgendwann drei
 * verschiedene Antworten geben, und eine davon liesse jemanden auf einen
 * Kaufknopf druecken, hinter dem nichts ist.
 */
export async function checkoutVerfuegbar(): Promise<{ ok: boolean; grund: string | null }> {
  const konfiguration = await ladeKonfiguration();
  return { ok: konfiguration.bereit, grund: konfiguration.hinderungsgrund };
}

/**
 * Ist Premium betriebsbereit?
 *
 * Wird beim Start geprueft. Bewusst **nachsichtig** geworden: ein Server ohne
 * Zahlungsanbieter soll starten koennen. Premium funktioniert dann fuer
 * Admin-Vergaben, bestehende Anspruechen und die Angebotsseite - nur der
 * Checkout bleibt zu (§27). Vorher brach der Start ab, und das hiess: ohne
 * Zahlungsanbieter kein Premium, auch kein verschenktes.
 */
export async function assertPremiumPaymentsConfigured(): Promise<void> {
  const aufgeloest = await aufloeseAnbieter().catch((fehler: unknown) => {
    logger.warn('Zahlungsanbieter konnte nicht aufgelöst werden', {
      fehler: fehler instanceof Error ? fehler.message : 'unbekannt',
    });
    return null;
  });

  if (!aufgeloest) {
    logger.info('Kein Zahlungsanbieter konfiguriert - Checkout bleibt deaktiviert.');
    return;
  }
  if (isProduction() && !aufgeloest.provider.productionReady) {
    throw new Error(
      `Der Zahlungsanbieter "${aufgeloest.provider.name}" ist für Production nicht zugelassen.`,
    );
  }
}

export interface TestErgebnis {
  ok: boolean;
  detail: string;
}

/**
 * Die Verbindung pruefen (§20).
 *
 * ## Was dieser Test tut und was nicht
 *
 * Er prueft **Erreichbarkeit und Zugangsdaten** - nichts weiter. Keine
 * Zahlung, keine Kaufsitzung, kein Betrag. Bei Stripe ist das ein Aufruf auf
 * `/v1/balance`: er antwortet mit 200, wenn der Schluessel gilt, und mit 401,
 * wenn nicht, und bewegt dabei keinen Rappen.
 *
 * ## Warum kein Geheimnis in der Antwort landet
 *
 * Weil die Antwort in der Oberflaeche steht und ins Protokoll geht. Gemeldet
 * wird darum der **Code** und ein Satz dazu, nie der Rohtext des Anbieters:
 * manche Anbieter spiegeln den gesendeten Schluessel in ihrer Fehlermeldung
 * zurueck, und der stuende dann im Dashboard.
 */
export async function testeVerbindung(): Promise<TestErgebnis> {
  const konfiguration = await ladeKonfiguration();

  if (!konfiguration.providerId || !konfiguration.profil) {
    return { ok: false, detail: 'Es ist kein Zahlungsanbieter gewählt.' };
  }
  const profil = konfiguration.profil;

  if (konfiguration.fehlend.length > 0) {
    return {
      ok: false,
      detail: `Es fehlen Zugangsdaten: ${konfiguration.fehlend
        .map((feld) => String(feld))
        .join(', ')}.`,
    };
  }

  if (profil.id === 'mock') {
    return {
      ok: true,
      detail: 'Mock-Anbieter - es fliesst kein Geld. Für Production nicht zugelassen.',
    };
  }

  if (profil.id === 'stripe') {
    const apiKey = await geheimnis('apiKey');
    if (!apiKey) {
      return { ok: false, detail: 'Kein API Key hinterlegt.' };
    }
    /*
     * Der Modus wird am Schluessel selbst geprueft.
     *
     * Stripe-Testschluessel beginnen mit `sk_test_`, Livekeys mit `sk_live_`.
     * Ein Livekey bei Modus TEST waere die gefaehrlichere Verwechslung - da
     * flossen dann echte Zahlungen, waehrend das Dashboard «Test» anzeigt.
     */
    const istTestSchluessel = apiKey.startsWith('sk_test_') || apiKey.startsWith('rk_test_');
    if (konfiguration.modus === 'LIVE' && istTestSchluessel) {
      return { ok: false, detail: 'Der Modus steht auf LIVE, der Schlüssel ist aber ein Testkey.' };
    }
    if (konfiguration.modus === 'TEST' && !istTestSchluessel) {
      return {
        ok: false,
        detail: 'Der Modus steht auf TEST, der Schlüssel ist aber kein Testkey.',
      };
    }

    const antwort = await fetch('https://api.stripe.com/v1/balance', {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);

    if (!antwort) {
      return { ok: false, detail: 'Stripe war nicht erreichbar.' };
    }
    if (antwort.status === 401) {
      return { ok: false, detail: 'Stripe lehnt den Schlüssel ab (401).' };
    }
    if (!antwort.ok) {
      return { ok: false, detail: `Stripe antwortete mit HTTP ${antwort.status}.` };
    }
    return {
      ok: true,
      detail: `Stripe erreichbar, Schlüssel gültig (Modus ${konfiguration.modus}).`,
    };
  }

  if (profil.id === 'generic') {
    const baseUrl = await geheimnis('baseUrl');
    if (!baseUrl) {
      return { ok: false, detail: 'Keine Base URL hinterlegt.' };
    }
    /*
     * Ein `HEAD` auf die Basis - nicht auf den Checkout-Endpunkt.
     *
     * Ein POST auf den Checkout waere eine angefangene Kaufsitzung, und das
     * ist genau das, was ein Verbindungstest nicht tun soll. `HEAD` auf die
     * Basis beantwortet die Frage, die hier zaehlt: antwortet dieser Host
     * ueberhaupt, und ist seine Adresse erlaubt?
     */
    const { pruefeAnbieterUrl } = await import('./konfiguration');
    let geprueft: string;
    try {
      geprueft = pruefeAnbieterUrl(baseUrl, 'Base URL');
    } catch (fehler: unknown) {
      return {
        ok: false,
        detail: fehler instanceof Error ? fehler.message : 'Die Base URL ist nicht erlaubt.',
      };
    }

    const antwort = await fetch(geprueft, {
      method: 'HEAD',
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);

    if (!antwort) {
      return { ok: false, detail: 'Der Host war nicht erreichbar.' };
    }
    return {
      ok: antwort.status < 500,
      detail:
        antwort.status < 500
          ? `Der Host antwortet (HTTP ${antwort.status}). Ob der Checkout-Endpunkt stimmt, zeigt der erste Kauf.`
          : `Der Host antwortete mit HTTP ${antwort.status}.`,
    };
  }

  return {
    ok: false,
    detail: `Für ${profil.label} ist in SwissHub noch kein Adapter angeschlossen. Die Zugangsdaten sind hinterlegt, eine Verbindung lässt sich damit noch nicht prüfen.`,
  };
}

export { providerProfil };
