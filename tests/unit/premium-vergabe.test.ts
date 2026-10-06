import { describe, expect, it } from 'vitest';
import { premium } from '@swisshub/modules';

/**
 * Die Dauerrechnung einer manuellen Vergabe (§3).
 *
 * ## Warum das ein eigener Test ist
 *
 * Weil «3 Monate» keine Zahl von Millisekunden ist und die Grenzfaelle genau
 * dort liegen, wo man sie beim Programmieren nicht sieht: am Monatsende, an
 * der Zeitumstellung und am Jahreswechsel. Eine Vergabe, die einen Tag zu
 * kurz ist, merkt niemand - bis sich jemand beschwert, dass sein Premium
 * schon weg ist.
 *
 * Gerechnet wird in `Europe/Zurich`, weil die Anzeige dort rechnet. Die
 * Erwartungen stehen darum als Ortszeit da und werden zum Vergleich wieder in
 * Ortszeit zerlegt - ein Vergleich in UTC haette im Sommer eine Stunde
 * Abweichung und waere im Winter zufaellig richtig.
 */
const ZONE = 'Europe/Zurich';

/** Ortszeit als lesbarer Text - das, was im Dashboard steht. */
function ortszeit(wert: Date): string {
  const t = premium.teileOrtszeit(wert);
  const zwei = (zahl: number): string => String(zahl).padStart(2, '0');
  return `${t.jahr}-${zwei(t.monat)}-${zwei(t.tag)} ${zwei(t.stunde)}:${zwei(t.minute)}`;
}

/** Ein Zeitpunkt als Ortszeit in Zürich. */
function start(text: string): Date {
  const treffer = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/u.exec(text);
  if (!treffer) {
    throw new Error(`Kein Zeitpunkt: ${text}`);
  }
  const [, jahr, monat, tag, stunde, minute] = treffer;
  return premium.ortszeitZuerich(Number(jahr), Number(monat), Number(tag), Number(stunde), Number(minute));
}

describe('Premium-Vergabe: die Laufzeit', () => {
  it('rechnet Tage', () => {
    // Die drei Beispiele aus der Spezifikation.
    expect(ortszeit(premium.laufzeitEnde(start('2026-10-06 14:30'), 7, 'DAYS', ZONE))).toBe(
      '2026-10-13 14:30',
    );
  });

  it('rechnet Wochen als sieben Tage', () => {
    expect(ortszeit(premium.laufzeitEnde(start('2026-10-06 14:30'), 4, 'WEEKS', ZONE))).toBe(
      '2026-11-03 14:30',
    );
  });

  it('rechnet Monate im Kalender', () => {
    expect(ortszeit(premium.laufzeitEnde(start('2026-10-06 14:30'), 3, 'MONTHS', ZONE))).toBe(
      '2027-01-06 14:30',
    );
  });

  it('behält die Uhrzeit', () => {
    /*
     * Wer um 23:50 eine Woche vergibt, soll nicht zehn Minuten verschenken.
     * Eine Rechnung ueber Tagesgrenzen (`tageSpaeter`) wuerde auf Mitternacht
     * springen und genau das tun.
     */
    expect(ortszeit(premium.laufzeitEnde(start('2026-10-06 23:50'), 1, 'WEEKS', ZONE))).toBe(
      '2026-10-13 23:50',
    );
  });

  it('kürzt auf den letzten Tag des Zielmonats', () => {
    // 31. Januar plus ein Monat ist der 28. Februar - nicht der 3. März.
    expect(ortszeit(premium.laufzeitEnde(start('2027-01-31 10:00'), 1, 'MONTHS', ZONE))).toBe(
      '2027-02-28 10:00',
    );
    // Und im Schaltjahr der 29.
    expect(ortszeit(premium.laufzeitEnde(start('2028-01-31 10:00'), 1, 'MONTHS', ZONE))).toBe(
      '2028-02-29 10:00',
    );
  });

  it('geht über den Jahreswechsel', () => {
    expect(ortszeit(premium.laufzeitEnde(start('2026-12-20 09:00'), 3, 'MONTHS', ZONE))).toBe(
      '2027-03-20 09:00',
    );
    expect(ortszeit(premium.laufzeitEnde(start('2026-12-28 09:00'), 7, 'DAYS', ZONE))).toBe(
      '2027-01-04 09:00',
    );
  });

  it('übersteht die Zeitumstellung mit derselben Uhrzeit', () => {
    /*
     * Die Umstellung auf Sommerzeit faellt 2027 auf den 28. Maerz.
     *
     * Ueber Millisekunden gerechnet (`+ 14 * 24h`) landete das Ende eine
     * Stunde zu frueh - und zwar unsichtbar: 13:00 statt 14:00 sieht nach
     * einem Tippfehler aus, nicht nach einem Rechenfehler. In Kalenderteilen
     * gerechnet bleibt die Uhrzeit, und genau das erwartet jeder.
     */
    const ende = premium.laufzeitEnde(start('2027-03-20 14:00'), 2, 'WEEKS', ZONE);
    expect(ortszeit(ende)).toBe('2027-04-03 14:00');

    // Und in die andere Richtung, über die Rückstellung Ende Oktober.
    const zurueck = premium.laufzeitEnde(start('2026-10-20 14:00'), 2, 'WEEKS', ZONE);
    expect(ortszeit(zurueck)).toBe('2026-11-03 14:00');
  });

  it('nennt die Dauer in Worten, Einzahl und Mehrzahl', () => {
    expect(premium.dauerText(1, 'DAYS')).toBe('1 Tag');
    expect(premium.dauerText(7, 'DAYS')).toBe('7 Tage');
    expect(premium.dauerText(1, 'MONTHS')).toBe('1 Monat');
    expect(premium.dauerText(3, 'MONTHS')).toBe('3 Monate');
    expect(premium.dauerText(4, 'WEEKS')).toBe('4 Wochen');
  });
});

describe('Premium-Vergabe: der abgeleitete Zustand', () => {
  const jetzt = new Date('2026-10-06T12:00:00Z');

  it('nennt eine laufende Vergabe laufend', () => {
    expect(premium.grantZustand({ status: 'ACTIVE', endsAt: new Date('2026-10-20T12:00:00Z') }, jetzt)).toBe(
      'ACTIVE',
    );
  });

  it('leitet «abgelaufen» aus dem Enddatum ab und nicht aus einer Spalte', () => {
    /*
     * Ein zweiter Zustand in der Datenbank haette hinterhergehinkt: der
     * Ablaufjob laeuft im Takt, nicht in Echtzeit, und zwischen Ablauf und
     * Job stuende in der Historie «laufend» fuer etwas, das vorbei ist.
     */
    expect(premium.grantZustand({ status: 'ACTIVE', endsAt: new Date('2026-10-05T12:00:00Z') }, jetzt)).toBe(
      'EXPIRED',
    );
  });

  it('lässt einen Widerruf einen Widerruf bleiben', () => {
    // Auch wenn das Ende längst vorbei ist: widerrufen ist die Aussage über
    // das, was passiert ist, und nicht über die Uhr.
    expect(premium.grantZustand({ status: 'REVOKED', endsAt: new Date('2026-10-01T12:00:00Z') }, jetzt)).toBe(
      'REVOKED',
    );
    expect(premium.grantZustand({ status: 'REVOKED', endsAt: new Date('2026-11-01T12:00:00Z') }, jetzt)).toBe(
      'REVOKED',
    );
  });
});
