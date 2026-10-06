import { describe, expect, it } from 'vitest';
import { premium } from '@swisshub/modules';

/**
 * Die Zahlungsanbieter-Abstraktion (§55).
 *
 * ## Was hier geprueft wird und was ausdruecklich nicht
 *
 * Geprueft wird alles, was ohne Netz entscheidbar ist: welche Faehigkeiten ein
 * Anbieter hat, wie Anbieterstati auf unsere abgebildet werden, welche
 * Adressen der eigene Anbieter annimmt und welche nicht, und wie ein Pfad an
 * eine Basis gehaengt wird.
 *
 * **Keine echten Zahlungsanfragen.** Kein Test in dieser Datei spricht mit
 * Stripe, PayPal oder irgendeinem Anbieter - die Spezifikation verlangt das,
 * und es ist ohnehin richtig: ein Test, der Geld bewegen koennte, gehoert
 * nicht in eine Testsuite, die bei jedem Commit laeuft.
 */

describe('Zahlungsanbieter: der Katalog', () => {
  it('kennt die vorbereiteten Anbieter', () => {
    for (const id of [
      'stripe',
      'paypal',
      'mollie',
      'sumup',
      'wallee',
      'datatrans',
      'saferpay',
      'generic',
      'mock',
    ]) {
      expect(premium.providerProfil(id), id).not.toBeNull();
    }
  });

  it('behauptet nicht, dass alle dasselbe können', () => {
    /*
     * Der Kern von §15. Wuerden alle Profile dieselben Haken tragen, waere
     * das Capability-Modell Zierde - und die Oberflaeche zeigte Knoepfe,
     * hinter denen nichts ist.
     */
    const sumup = premium.providerCapabilities('sumup');
    const stripe = premium.providerCapabilities('stripe');

    // SumUp kennt keine wiederkehrende Buchung, Stripe schon.
    expect(sumup.subscriptions).toBe(false);
    expect(stripe.subscriptions).toBe(true);

    // Mollie signiert seine Webhooks nicht - das ist eine andere
    // Sicherheitsannahme und steht als solche im Profil.
    expect(premium.providerCapabilities('mollie').webhooks).toBe(false);

    // Der eigene Anbieter kann keinen Zahlungsstand nachlesen.
    expect(premium.providerCapabilities('generic').paymentStatus).toBe(false);
    expect(premium.providerCapabilities('generic').refund).toBe(false);
  });

  it('gibt für einen unbekannten Anbieter keine Fähigkeiten', () => {
    // Die vorsichtige Richtung: wer nicht im Katalog steht, kann nichts.
    const nichts = premium.providerCapabilities('erfundenerAnbieter');
    expect(Object.values(nichts).every((wert) => wert === false)).toBe(true);
    expect(premium.providerCapabilities(null).checkout).toBe(false);
  });

  it('sagt ehrlich, für wen ein Adapter existiert', () => {
    /*
     * «Vorbereitet» heisst nicht «simuliert». Drei Anbieter haben einen
     * Adapter mit echten Aufrufen; die uebrigen sind Profile, und das Feld
     * sagt es.
     */
    expect(premium.providerProfil('stripe')?.adapter).toBe(true);
    expect(premium.providerProfil('generic')?.adapter).toBe(true);
    expect(premium.providerProfil('mock')?.adapter).toBe(true);
    for (const id of ['paypal', 'mollie', 'sumup', 'wallee', 'datatrans', 'saferpay']) {
      expect(premium.providerProfil(id)?.adapter, id).toBe(false);
    }
  });

  it('lässt den Mock nicht in Production', () => {
    expect(premium.providerProfil('mock')?.produktionstauglich).toBe(false);
    expect(premium.providerProfil('stripe')?.produktionstauglich).toBe(true);
  });

  it('nennt für jeden Anbieter seine Pflichtfelder', () => {
    // Ein Anbieter ohne Pflichtfeld waere einer, der ohne Zugangsdaten
    // kassiert - es gibt keinen solchen.
    for (const profil of premium.PROVIDER_PROFILE) {
      expect(profil.pflicht.length, profil.id).toBeGreaterThan(0);
    }
  });
});

describe('Zahlungsanbieter: normalisierte Stati (§23)', () => {
  it('bildet die Erfolgsmeldungen der Anbieter auf PAID ab', () => {
    // Stripe, PayPal, Datatrans und Wallee nennen dasselbe verschieden.
    expect(premium.normalisiereStatus('succeeded')).toBe('PAID');
    expect(premium.normalisiereStatus('COMPLETED')).toBe('PAID');
    expect(premium.normalisiereStatus('settled')).toBe('PAID');
    expect(premium.normalisiereStatus('FULFILL')).toBe('PAID');
  });

  it('erkennt Fehlschlag, Abbruch, Verfall und Erstattung', () => {
    expect(premium.normalisiereStatus('failed')).toBe('FAILED');
    expect(premium.normalisiereStatus('DECLINED')).toBe('FAILED');
    expect(premium.normalisiereStatus('canceled')).toBe('CANCELLED');
    expect(premium.normalisiereStatus('VOIDED')).toBe('CANCELLED');
    expect(premium.normalisiereStatus('expired')).toBe('EXPIRED');
    expect(premium.normalisiereStatus('refunded')).toBe('REFUNDED');
  });

  it('nimmt einen unbekannten Status als PENDING und nicht als PAID', () => {
    /*
     * Die vorsichtige Richtung, und sie ist hier die wichtige: ein zu frueh
     * freigeschaltetes Premium ist schwerer zu korrigieren als ein zu spaet
     * freigeschaltetes - im ersten Fall hat jemand etwas bekommen, wofuer er
     * nicht bezahlt hat.
     */
    expect(premium.normalisiereStatus('irgendwas_neues')).toBe('PENDING');
    expect(premium.normalisiereStatus(null)).toBe('PENDING');
    expect(premium.normalisiereStatus('')).toBe('PENDING');
  });
});

describe('Eigener Anbieter: die Adressprüfung (§16, §59)', () => {
  it('nimmt eine gewöhnliche https-Adresse', () => {
    expect(premium.pruefeAnbieterUrl('https://api.example.com')).toContain('api.example.com');
    expect(premium.pruefeAnbieterUrl('https://pay.example.com/v2/')).toContain('pay.example.com');
  });

  it('lehnt http ab', () => {
    // Zugangsdaten eines Zahlungsanbieters gehören nicht unverschlüsselt ins Netz.
    expect(() => premium.pruefeAnbieterUrl('http://api.example.com')).toThrow();
  });

  it('lehnt die exotischen Schemata ab', () => {
    for (const adresse of ['file:///etc/passwd', 'gopher://example.com', 'ftp://example.com']) {
      expect(() => premium.pruefeAnbieterUrl(adresse), adresse).toThrow();
    }
  });

  it('lehnt das eigene Netz ab', () => {
    /*
     * Der eigentliche SSRF-Riegel. `169.254.169.254` ist der Metadatendienst
     * jeder Cloud - wer ihn erreichen kann, liest die Zugangsdaten der
     * Maschine.
     */
    for (const adresse of [
      'https://localhost/x',
      'https://127.0.0.1/x',
      'https://10.1.2.3/x',
      'https://192.168.1.1/x',
      'https://172.16.0.1/x',
      'https://169.254.169.254/latest/meta-data/',
      'https://[::1]/x',
      'https://dienst.internal/x',
      'https://postgres.local/x',
    ]) {
      expect(() => premium.pruefeAnbieterUrl(adresse), adresse).toThrow();
    }
  });

  it('lehnt einen Namen ohne Punkt ab', () => {
    // Im Containernetz sind das die Nachbardienste: `postgres`, `bot`, `web`.
    for (const name of ['https://postgres/x', 'https://bot', 'https://web/api']) {
      expect(() => premium.pruefeAnbieterUrl(name), name).toThrow();
    }
  });

  it('lehnt Zugangsdaten in der Adresse ab', () => {
    expect(() => premium.pruefeAnbieterUrl('https://user:geheim@api.example.com')).toThrow();
  });

  it('lehnt Leerzeichen und Unsinn ab', () => {
    expect(() => premium.pruefeAnbieterUrl('')).toThrow();
    expect(() => premium.pruefeAnbieterUrl('   ')).toThrow();
    expect(() => premium.pruefeAnbieterUrl('kein link')).toThrow();
    expect(() => premium.pruefeAnbieterUrl(`https://api.example.com/${'x'.repeat(600)}`)).toThrow();
  });
});

describe('Eigener Anbieter: Basis und Pfad zusammensetzen', () => {
  it('hängt den Pfad an die Basis', () => {
    expect(premium.checkoutAdresse('https://api.example.com', 'v1/checkout')).toBe(
      'https://api.example.com/v1/checkout',
    );
    // Mit und ohne führenden Schrägstrich dasselbe Ergebnis.
    expect(premium.checkoutAdresse('https://api.example.com/', '/v1/checkout')).toBe(
      'https://api.example.com/v1/checkout',
    );
  });

  it('lässt den Pfad keinen neuen Host werden', () => {
    /*
     * Der Umweg, den die Prüfung der Basis sonst nicht sieht: `new URL` liest
     * `//intern.example.com/x` als neuen Host und würde die Basis
     * verwerfen - samt ihrer SSRF-Prüfung.
     */
    expect(() => premium.checkoutAdresse('https://api.example.com', '//169.254.169.254/latest')).toThrow();
    expect(() =>
      premium.checkoutAdresse('https://api.example.com', 'https://intern.example.com/x'),
    ).toThrow();
  });

  it('lehnt Sonderzeichen im Pfad ab', () => {
    for (const pfad of ['v1/checkout?x=1', 'v1/check out', 'v1/<script>']) {
      expect(() => premium.checkoutAdresse('https://api.example.com', pfad), pfad).toThrow();
    }
  });

  it('prüft die Basis auch hier', () => {
    expect(() => premium.checkoutAdresse('https://127.0.0.1', 'v1/checkout')).toThrow();
    expect(() => premium.checkoutAdresse('http://api.example.com', 'v1/checkout')).toThrow();
  });
});
