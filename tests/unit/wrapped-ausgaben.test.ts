import { describe, expect, it } from 'vitest';
import {
  istAbgeschlossen,
  jahresSchluessel,
  letzterAbgeschlossenerMonat,
  letztesAbgeschlossenesJahr,
  monateEines,
  monatsName,
  monatsSchluessel,
  periodeVon,
  periodenLabel,
} from '@swisshub/modules/wrapped/perioden';
import {
  editorialSchema,
  istVariante,
  istVorlage,
  lieseVorlagenDaten,
  varianteFuer,
  VORLAGEN_SCHEMA,
} from '@swisshub/modules/wrapped/vorlagen';

/**
 * Perioden und Vorlagen der periodischen Ausgaben.
 *
 * Beides ist rein - keine Datenbank, keine Uhr ausser der hereingereichten.
 * Geprueft wird vor allem die Zeitrechnung: sie ist die eine Stelle, an der
 * ein Fehler still bleibt und trotzdem jede Zahl verschiebt.
 */

describe('Zeitraeume', () => {
  it('schneidet Monate an Zuercher Mitternacht, nicht an UTC', () => {
    // September 2026 liegt in der Sommerzeit: Zuerich ist UTC+2.
    const september = periodeVon('MONTHLY', '2026-09');
    expect(september?.start.toISOString()).toBe('2026-08-31T22:00:00.000Z');
    expect(september?.end.toISOString()).toBe('2026-09-30T22:00:00.000Z');
  });

  it('gibt dem Oktober 745 Stunden und dem Maerz 743', () => {
    /*
     * Der eigentliche Beweis, dass die Zeitzone stimmt.
     *
     * Am 25.10.2026 wird die Uhr zurueckgestellt, am 29.03.2026 vor. Wer mit
     * einem festen Versatz rechnet, bekommt beide Male 744 - und verliert
     * oder verdoppelt damit eine Stunde Sprachzeit.
     */
    const stunden = (key: string): number => {
      const periode = periodeVon('MONTHLY', key);
      return (periode!.end.getTime() - periode!.start.getTime()) / 3_600_000;
    };
    expect(stunden('2026-10')).toBe(745);
    expect(stunden('2026-03')).toBe(743);
    expect(stunden('2026-09')).toBe(720);
  });

  it('laesst das Jahr im Dezember in den Januar laufen', () => {
    const dezember = periodeVon('MONTHLY', '2026-12');
    const naechstesJahr = periodeVon('YEARLY', '2027');
    expect(dezember?.end.toISOString()).toBe(naechstesJahr?.start.toISOString());
  });

  it('macht aus zwoelf Monaten genau ein Jahr', () => {
    const jahr = periodeVon('YEARLY', '2026')!;
    const monate = monateEines(2026);
    expect(monate[0]?.start.toISOString()).toBe(jahr.start.toISOString());
    expect(monate[11]?.end.toISOString()).toBe(jahr.end.toISOString());
    // Lueckenlos und ueberschneidungsfrei.
    for (let i = 1; i < 12; i += 1) {
      expect(monate[i]?.start.toISOString()).toBe(monate[i - 1]?.end.toISOString());
    }
  });

  it('kennt den zuletzt abgeschlossenen Monat auf die Minute', () => {
    // 01.10.2026 00:01 Zuercher Zeit = 30.09. 22:01 UTC.
    expect(letzterAbgeschlossenerMonat(new Date('2026-09-30T22:01:00Z')).key).toBe('2026-09');
    // Eine Minute vorher laeuft der September noch.
    expect(letzterAbgeschlossenerMonat(new Date('2026-09-30T21:59:00Z')).key).toBe('2026-08');
  });

  it('kommt ueber den Jahreswechsel', () => {
    expect(letzterAbgeschlossenerMonat(new Date('2025-12-31T23:30:00Z')).key).toBe('2025-12');
    expect(letztesAbgeschlossenesJahr(new Date('2025-12-31T23:30:00Z')).key).toBe('2025');
    expect(letztesAbgeschlossenesJahr(new Date('2026-06-01T10:00:00Z')).key).toBe('2025');
  });

  it('lehnt ab, was kein Zeitraum ist', () => {
    expect(periodeVon('MONTHLY', '2026-13')).toBeNull();
    expect(periodeVon('MONTHLY', '2026-00')).toBeNull();
    expect(periodeVon('MONTHLY', '2026-9')).toBeNull();
    expect(periodeVon('MONTHLY', '2026')).toBeNull();
    expect(periodeVon('YEARLY', '2026-09')).toBeNull();
    expect(periodeVon('YEARLY', 'abcd')).toBeNull();
    expect(periodeVon('YEARLY', "2026'; DROP TABLE")).toBeNull();
  });

  it('nennt den Zeitraum so, wie er auf der Folie steht', () => {
    expect(periodenLabel(periodeVon('MONTHLY', '2026-09')!)).toBe('September 2026');
    expect(periodenLabel(periodeVon('YEARLY', '2026')!)).toBe('2026');
    expect(monatsName(3)).toBe('März');
  });

  it('liest Schluessel in Zuercher Zeit ab', () => {
    // 31.08.2026 23:00 UTC ist in Zuerich bereits der 1. September.
    expect(monatsSchluessel(new Date('2026-08-31T23:00:00Z'))).toBe('2026-09');
    expect(jahresSchluessel(new Date('2025-12-31T23:30:00Z'))).toBe('2026');
  });

  it('erklaert einen Zeitraum erst nach seinem Ende fuer abgeschlossen', () => {
    const september = periodeVon('MONTHLY', '2026-09')!;
    expect(istAbgeschlossen(september, new Date('2026-09-30T21:59:00Z'))).toBe(false);
    expect(istAbgeschlossen(september, new Date('2026-09-30T22:00:00Z'))).toBe(true);
  });
});

describe('Vorlagen', () => {
  it('lehnt ein Feld ab, das die Vorlage nicht kennt', () => {
    const gut = VORLAGEN_SCHEMA.HERO_NUMBER.safeParse({
      wert: '2’846',
      label: 'Voice-Stunden',
      zusatz: null,
    });
    expect(gut.success).toBe(true);

    const schlecht = VORLAGEN_SCHEMA.HERO_NUMBER.safeParse({
      wert: '2’846',
      label: 'Voice-Stunden',
      zusatz: null,
      heimlich: '<script>',
    });
    expect(schlecht.success).toBe(false);
  });

  it('ueberspringt eine Folie, die nicht mehr zu ihrer Vorlage passt', () => {
    // Der Fall nach einer Schemaaenderung: gespeichert ist ein Aufbau von
    // gestern. Lieber keine Folie als eine halb gezeichnete.
    expect(lieseVorlagenDaten('HERO_NUMBER', { wert: '1' })).toBeNull();
    expect(lieseVorlagenDaten('GIBTSNICHT', { wert: '1' })).toBeNull();
    expect(lieseVorlagenDaten('OUTRO', { periode: 'August 2026' })).not.toBeNull();
  });

  it('haelt die Rangliste bei fuenf Zeilen', () => {
    const eintraege = Array.from({ length: 6 }, (_, i) => ({ name: `Spiel ${i}`, wert: '1' }));
    expect(VORLAGEN_SCHEMA.RANKING.safeParse({ kategorie: 'Top', eintraege }).success).toBe(false);
    expect(
      VORLAGEN_SCHEMA.RANKING.safeParse({ kategorie: 'Top', eintraege: eintraege.slice(0, 5) }).success,
    ).toBe(true);
  });

  it('verlangt fuer den Jahresverlauf genau zwoelf Monate', () => {
    const monat = { name: 'Jan', wert: 1, anzeige: '1' };
    const basis = { kategorie: 'Voice', einheit: 'Stunden', bester: null };
    expect(
      VORLAGEN_SCHEMA.MONTH_OVERVIEW.safeParse({ ...basis, monate: Array(11).fill(monat) }).success,
    ).toBe(false);
    expect(
      VORLAGEN_SCHEMA.MONTH_OVERVIEW.safeParse({ ...basis, monate: Array(12).fill(monat) }).success,
    ).toBe(true);
  });

  it('haelt den redaktionellen Teil von den Zahlen getrennt', () => {
    /*
     * Die wichtigste Zusage des Editors: ueber das Textfeld kommt man nicht
     * an die Statistik. `strict()` sorgt dafuer, dass ein mitgeschickter
     * «wert» nicht einfach durchrutscht.
     */
    const geprueft = editorialSchema.safeParse({
      ueberschrift: 'Im Voice',
      text: 'Ihr habt zu viel geredet.',
      wert: '999999',
    });
    expect(geprueft.success).toBe(false);
  });

  it('kennt die Vorlagen und die Varianten', () => {
    expect(istVorlage('HERO_NUMBER')).toBe(true);
    expect(istVorlage('BALKENDIAGRAMM')).toBe(false);
    expect(istVariante('raster')).toBe(true);
    expect(istVariante('regenbogen')).toBe(false);
  });

  it('waehlt die Variante deterministisch aus dem Zeitraum', () => {
    // Beim zweiten Zeichnen dasselbe Bild - sonst passten die Folien eines
    // Karussells nicht mehr zusammen.
    expect(varianteFuer('2026-09')).toBe(varianteFuer('2026-09'));
    expect(istVariante(varianteFuer('2026-09'))).toBe(true);
    // Und nicht jeder Monat derselbe.
    const varianten = new Set(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05'].map(varianteFuer));
    expect(varianten.size).toBeGreaterThan(1);
  });
});
