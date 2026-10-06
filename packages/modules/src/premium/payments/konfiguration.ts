import { prisma } from '@swisshub/database';
import { getSecret, hasSecret, PAYMENT_INTEGRATION_ID } from '@swisshub/secrets';
import { conflict } from '@swisshub/shared';
import {
  providerProfil,
  type PaymentModus,
  type ProviderFeldSchluessel,
  type ProviderProfil,
} from './katalog';

/**
 * Die Konfiguration des Zahlungsanbieters - aus dem verschluesselten Speicher.
 *
 * ## Warum nicht mehr nur aus der Umgebung
 *
 * Bisher las `resolvePaymentProvider` ausschliesslich `PAYMENT_PROVIDER`,
 * `PAYMENT_API_KEY` und `PAYMENT_WEBHOOK_SECRET` aus der Prozessumgebung. Das
 * funktioniert, verlangt aber fuer jeden Wechsel ein Deployment - und die
 * Vorgabe ist, dass der Anbieter im Dashboard unter System → Integrationen
 * gewaehlt und konfiguriert wird (§13).
 *
 * `getSecret` loest genau das: Datenbank zuerst, Umgebung als Rueckfall.
 * Bestehende Installationen laufen damit unveraendert weiter - wer seine
 * Werte in der Umgebung hat, merkt nichts, und wer sie im Dashboard setzt,
 * gewinnt. Es gibt keinen Umstellungstag.
 *
 * ## Warum Geheimnisse hier nicht zurueckgegeben werden
 *
 * `ladeKonfiguration` liefert den **Zustand**: welcher Anbieter, welcher
 * Modus, welche Felder sind gesetzt. Die Werte selbst holt nur, wer sie
 * braucht - der Adapter, kurz vor dem Aufruf, ueber `geheimnis()`. Alles
 * andere bekommt `true`/`false`, und damit kann keine Oberflaeche und keine
 * Fehlermeldung ein Geheimnis ausgeben, das sie nie hatte (§18).
 */

export const PAYMENT_FELDER: readonly ProviderFeldSchluessel[] = [
  'apiKey',
  'apiSecret',
  'webhookSecret',
  'merchantId',
  'baseUrl',
  'checkoutPath',
];

export interface ZahlungsKonfiguration {
  /** Der gewaehlte Anbieter - `null`, solange niemand einen gewaehlt hat. */
  providerId: string | null;
  profil: ProviderProfil | null;
  aktiv: boolean;
  modus: PaymentModus;
  /** Welche Felder hinterlegt sind - nicht ihre Werte. */
  gesetzt: Readonly<Record<ProviderFeldSchluessel, boolean>>;
  /** Fehlende Pflichtfelder. Leer heisst: vollstaendig. */
  fehlend: readonly ProviderFeldSchluessel[];
  /**
   * Ist diese Integration betriebsbereit?
   *
   * Vier Bedingungen, und alle vier muessen stimmen: ein Anbieter ist
   * gewaehlt, er ist eingeschaltet, seine Pflichtfelder sind da, und es gibt
   * einen Adapter. Fehlt eines, bleibt der Checkout zu (§27) - und zwar
   * sauber, mit einer Erklaerung, nicht als Fehler.
   */
  bereit: boolean;
  /** Warum nicht bereit - ein Satz fuer die Oberflaeche. */
  hinderungsgrund: string | null;
}

const JA_WERTE = new Set(['true', '1', 'ja', 'on']);

async function fahne(key: string): Promise<boolean> {
  const wert = await getSecret(PAYMENT_INTEGRATION_ID, key);
  return wert !== null && JA_WERTE.has(wert.trim().toLowerCase());
}

/**
 * Der Zustand der Zahlungsintegration.
 *
 * Bewusst ohne Zwischenspeicher: `getSecret` hat selbst einen, und ein
 * zweiter darueber waere die Stelle, an der ein Admin eine Aenderung speichert
 * und sie nicht wirkt.
 */
export async function ladeKonfiguration(): Promise<ZahlungsKonfiguration> {
  const providerId = (await getSecret(PAYMENT_INTEGRATION_ID, 'provider'))?.trim() || null;
  const profil = providerId ? providerProfil(providerId) : null;
  const modusRoh = (await getSecret(PAYMENT_INTEGRATION_ID, 'mode'))?.trim().toUpperCase();
  // Vorsichtige Richtung: ohne ausdrueckliches LIVE gilt TEST. Ein
  // versehentlich scharfer Anbieter ist der schlimmere Fehler.
  const modus: PaymentModus = modusRoh === 'LIVE' ? 'LIVE' : 'TEST';
  const aktiv = await fahne('enabled');

  const gesetztPaare = await Promise.all(
    PAYMENT_FELDER.map(async (feld) => [feld, await hasSecret(PAYMENT_INTEGRATION_ID, feld)] as const),
  );
  const gesetzt = Object.fromEntries(gesetztPaare) as Record<ProviderFeldSchluessel, boolean>;

  const fehlend = profil ? profil.pflicht.filter((feld) => !gesetzt[feld]) : [];

  let hinderungsgrund: string | null = null;
  if (!providerId) {
    hinderungsgrund = 'Es ist kein Zahlungsanbieter gewählt.';
  } else if (!profil) {
    hinderungsgrund = `Der hinterlegte Anbieter «${providerId}» ist SwissHub nicht bekannt.`;
  } else if (!profil.adapter) {
    hinderungsgrund = `Für ${profil.label} ist in SwissHub noch kein Adapter angeschlossen - die Konfiguration lässt sich hinterlegen, Zahlungen laufen damit noch nicht.`;
  } else if (!aktiv) {
    hinderungsgrund = 'Die Zahlungsintegration ist ausgeschaltet.';
  } else if (fehlend.length > 0) {
    hinderungsgrund = `Es fehlen Zugangsdaten: ${fehlend.join(', ')}.`;
  }

  return {
    providerId,
    profil,
    aktiv,
    modus,
    gesetzt,
    fehlend,
    bereit: hinderungsgrund === null,
    hinderungsgrund,
  };
}

/**
 * Ein Geheimnis fuer einen Aufruf.
 *
 * Getrennt von `ladeKonfiguration`, damit der Klartext nur dort auftaucht, wo
 * er gebraucht wird - und nicht in einem Objekt, das durch halbe Anwendung
 * reist und irgendwann in einer Fehlermeldung landet.
 */
export async function geheimnis(feld: ProviderFeldSchluessel): Promise<string | null> {
  return getSecret(PAYMENT_INTEGRATION_ID, feld);
}

/** Dasselbe, aber mit Fehler statt `null` - fuer Pflichtfelder. */
export async function pflichtGeheimnis(feld: ProviderFeldSchluessel): Promise<string> {
  const wert = await geheimnis(feld);
  if (!wert) {
    throw conflict(`Die Zahlungsintegration ist unvollständig: ${feld} fehlt.`);
  }
  return wert;
}

/**
 * Darf gerade echtes Geld bewegt werden?
 *
 * Die Antwort ist nur dann ja, wenn die Integration bereit **und** auf LIVE
 * steht. Im Testmodus laeuft der Checkout gegen die Testumgebung des
 * Anbieters; dort fliesst nichts.
 */
export async function darfEchtKassieren(): Promise<boolean> {
  const konfiguration = await ladeKonfiguration();
  return konfiguration.bereit && konfiguration.modus === 'LIVE';
}

/**
 * Hosts, die niemals angesprochen werden - der SSRF-Riegel (§16, §59).
 *
 * ## Warum eine Sperrliste und keine Erlaubnisliste
 *
 * Weil der Sinn des generischen Anbieters ist, dass wir seinen Namen nicht
 * kennen. Eine Erlaubnisliste muesste jeder Admin selbst pflegen, und sie
 * waere im Zweifel «alles».
 *
 * Gesperrt wird darum, was in einem Rechenzentrum **innen** liegt: die
 * Loopback-Adresse, die privaten Netze, die Link-Local-Adressen (und damit
 * `169.254.169.254`, der Metadatendienst jeder Cloud), die eindeutig lokalen
 * IPv6-Adressen und Namen ohne Punkt - letztere sind im Containernetz die
 * Nachbardienste: `postgres`, `bot`, `web`.
 *
 * ## Warum das kein vollstaendiger Schutz ist
 *
 * Ein Name kann auf eine private Adresse zeigen, ohne danach auszusehen
 * (`intern.example.com` → `10.0.0.5`), und zwischen Pruefung und Aufruf kann
 * sich die Aufloesung aendern. Das vollstaendig zu schliessen hiesse, selbst
 * aufzuloesen und an die Adresse zu verbinden - ein eigener HTTP-Stapel.
 * Dagegen steht, dass dieses Feld nur ein Admin mit
 * `payment.secrets.manage` setzen kann: wer es missbraucht, hat ohnehin
 * Zugang zu den Zahlungsdaten. Die Pruefung ist der Riegel gegen den Irrtum
 * und gegen die halbe Rechteausweitung, nicht gegen den Administrator selbst.
 */
const VERBOTENE_MUSTER: readonly RegExp[] = [
  /^localhost$/iu,
  /^127\./u,
  /^0\./u,
  /^10\./u,
  /^192\.168\./u,
  /^172\.(1[6-9]|2\d|3[01])\./u,
  /^169\.254\./u,
  /^\[?::1\]?$/u,
  /^\[?f[cd][0-9a-f]{2}:/iu,
  /^\[?fe80:/iu,
  /\.internal$/iu,
  /\.local$/iu,
  /\.localdomain$/iu,
];

export function pruefeAnbieterUrl(eingabe: string, feld = 'Adresse'): string {
  const rohwert = eingabe.trim();
  if (rohwert === '') {
    throw conflict(`${feld}: leer.`);
  }
  if (rohwert.length > 500) {
    throw conflict(`${feld}: zu lang.`);
  }

  let adresse: URL;
  try {
    adresse = new URL(rohwert);
  } catch {
    throw conflict(`${feld}: keine gültige Adresse. Sie muss mit https:// beginnen.`);
  }

  /*
   * Nur `https`. Nicht `http`, und schon gar nicht `file:` oder `gopher:`.
   *
   * Zugangsdaten eines Zahlungsanbieters gehoeren nicht unverschluesselt ins
   * Netz - und die exotischen Schemata sind der klassische SSRF-Einstieg.
   */
  if (adresse.protocol !== 'https:') {
    throw conflict(`${feld}: nur https ist erlaubt.`);
  }
  if (adresse.username !== '' || adresse.password !== '') {
    throw conflict(`${feld}: Zugangsdaten gehören nicht in die Adresse.`);
  }
  const host = adresse.hostname.toLowerCase();
  if (host === '') {
    throw conflict(`${feld}: der Adresse fehlt der Host.`);
  }
  // Ein Name ohne Punkt ist im Containernetz ein Nachbardienst.
  if (!host.includes('.') && !host.startsWith('[')) {
    throw conflict(`${feld}: «${host}» ist kein öffentlicher Name.`);
  }
  if (VERBOTENE_MUSTER.some((muster) => muster.test(host))) {
    throw conflict(`${feld}: interne Adressen sind nicht erlaubt.`);
  }
  return adresse.toString();
}

/**
 * Den Checkout-Endpunkt an die Basis haengen.
 *
 * Getrennt gespeichert, damit die Basis geprueft werden kann (siehe oben) und
 * der Pfad kein Weg zurueck in ein anderes Netz ist: ein `checkoutPath` wie
 * `//intern.example.com/x` wuerde von `new URL` als neuer Host gelesen und
 * die Pruefung der Basis umgehen. Darum wird der Pfad als Pfad behandelt und
 * nie als Adresse.
 */
export function checkoutAdresse(baseUrl: string, pfad: string): string {
  const basis = pruefeAnbieterUrl(baseUrl, 'Base URL');
  const roh = pfad.trim();

  /*
   * Erst pruefen, dann kuerzen - in dieser Reihenfolge.
   *
   * Umgekehrt greift die Pruefung nie: `//169.254.169.254/latest` verliert
   * durch das Abschneiden der fuehrenden Schraegstriche genau das Merkmal,
   * an dem man es erkennt, und kommt als harmlos aussehender Pfad
   * `169.254.169.254/latest` durch. Dass das Ergebnis in diesem Fall
   * zufaellig unschaedlich waere, aendert nichts daran, dass die Pruefung
   * ins Leere lief - gefunden hat es der Test, nicht der Augenschein.
   */
  if (roh.includes('://') || roh.startsWith('//')) {
    throw conflict('Checkout Endpoint: nur ein Pfad, keine vollständige Adresse.');
  }

  const sauber = roh.replace(/^\/+/u, '');
  if (!/^[\w\-./]*$/u.test(sauber)) {
    throw conflict('Checkout Endpoint: nur Buchstaben, Zahlen, Punkt, Bindestrich und Schrägstrich.');
  }
  const mitSchraegstrich = basis.endsWith('/') ? basis : `${basis}/`;
  return `${mitSchraegstrich}${sauber}`;
}

/** Was von den Webhooks des Anbieters bisher angekommen ist (§18). */
export interface WebhookZustand {
  /** Ist ein Signaturgeheimnis hinterlegt? Ohne es wird nichts verarbeitet. */
  geheimnisGesetzt: boolean;
  /** Zugestellte Ereignisse insgesamt - fuer den gewaehlten Anbieter. */
  anzahl: number;
  /** Wann das letzte ankam. `null`: noch keines. */
  zuletzt: Date | null;
  /** Typ des letzten Ereignisses - eine Kennung des Anbieters, kein Inhalt. */
  zuletztTyp: string | null;
  /** Ereignisse, die mit einem Fehler endeten. */
  fehlerhaft: number;
}

/**
 * Der Webhook-Zustand.
 *
 * ## Warum gezaehlt und nicht gemeldet
 *
 * «Webhook eingerichtet» kann eine Oberflaeche nicht wissen - das weiss nur
 * der Anbieter. Was sie wissen kann, ist, ob je eines angekommen ist, und das
 * ist die ehrlichere Auskunft: ein hinterlegtes Geheimnis ohne ein einziges
 * zugestelltes Ereignis heisst meistens, dass die Adresse beim Anbieter
 * fehlt.
 *
 * Aus der Nutzlast kommt hier nichts - nur Zahlen, ein Zeitpunkt und der
 * Ereignistyp. In der Nutzlast stehen Kundendaten (§18).
 */
export async function webhookZustand(): Promise<WebhookZustand> {
  const providerId = (await getSecret(PAYMENT_INTEGRATION_ID, 'provider'))?.trim() || null;
  const geheimnisGesetzt = await hasSecret(PAYMENT_INTEGRATION_ID, 'webhookSecret');

  if (!providerId) {
    return { geheimnisGesetzt, anzahl: 0, zuletzt: null, zuletztTyp: null, fehlerhaft: 0 };
  }

  const [anzahl, fehlerhaft, letztes] = await Promise.all([
    prisma.premiumPaymentEvent.count({ where: { provider: providerId } }),
    prisma.premiumPaymentEvent.count({ where: { provider: providerId, processingStatus: 'FAILED' } }),
    prisma.premiumPaymentEvent.findFirst({
      where: { provider: providerId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, eventType: true },
    }),
  ]);

  return {
    geheimnisGesetzt,
    anzahl,
    fehlerhaft,
    zuletzt: letztes?.createdAt ?? null,
    zuletztTyp: letztes?.eventType ?? null,
  };
}
