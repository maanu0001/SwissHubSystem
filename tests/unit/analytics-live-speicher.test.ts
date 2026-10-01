import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { erzeugeLiveSpeicher, type LiveStand } from '../../apps/web/src/modules/analytics/live-speicher';

/**
 * Der Speicher hinter den Live-Kacheln der Statistik.
 *
 * ## Warum es diesen Test gibt
 *
 * Die Sprachzeit reagierte nicht auf den Zeitraumwechsel - und zwar zweimal
 * gemeldet, einmal scheinbar behoben. Der erste Anlauf reparierte die
 * Rechnung auf dem Server; die war aber nie kaputt, wie
 * `analytics-zeitraum-sprachzeit` schon vorher bewies. Kaputt war die
 * Anzeige.
 *
 * Die Statistikseite wechselt den Zeitraum mit `router.push`. Die
 * Live-Kachel bleibt dabei montiert, und der Speicher auf Modulebene behielt
 * die Antwort des vorigen Zeitraums. Weil er Vorrang vor dem frisch
 * gerenderten Serverwert hatte, stand nach dem Klick auf «1 Tag» weiter die
 * 30-Tage-Zahl - bis zum nächsten Abgleich dreissig Sekunden später. Wer die
 * drei Knöpfe durchklickte, sah jedes Mal den Wert der vorigen Auswahl.
 *
 * Am Quelltext war das nicht zu sehen: jede Zeile für sich war richtig. Der
 * Fehler lag darin, dass der Schlüssel des Zwischenspeichers den Zeitraum
 * nicht enthielt - und genau das prüft dieser Test.
 */

function stand(sekunden: number): LiveStand {
  return {
    asOf: Date.parse('2026-10-01T12:00:00.000Z'),
    zeitraum: { sekunden, wachsend: 0 },
    heute: { sekunden: 60, wachsend: 0 },
    imSprachkanal: 0,
    aktive: 3,
    sitzungen: 1,
  };
}

describe('Live-Speicher: der Zeitraum gehört zum Schlüssel', () => {
  it('gibt einen Stand nur für die Abfrage heraus, zu der er gehört', () => {
    const speicher = erzeugeLiveSpeicher();
    speicher.setzeAbfrage('?zeitraum=30d');
    speicher.uebernimm(stand(9000), '?zeitraum=30d');

    expect(speicher.standFuer('?zeitraum=30d')?.zeitraum.sekunden).toBe(9000);
    // Der Kern: für einen anderen Zeitraum gibt es diesen Stand nicht.
    expect(speicher.standFuer('?zeitraum=1d')).toBeNull();
    expect(speicher.standFuer('')).toBeNull();
  });

  it('verwirft den alten Stand beim Wechsel, statt ihn weiterzuzeigen', () => {
    const speicher = erzeugeLiveSpeicher();
    speicher.setzeAbfrage('?zeitraum=30d');
    speicher.uebernimm(stand(9000), '?zeitraum=30d');

    expect(speicher.setzeAbfrage('?zeitraum=1d')).toBe(true);

    /*
     * Jetzt gibt es gar keinen Stand mehr - auch nicht den alten unter einem
     * anderen Namen. Die Kachel fällt damit auf das zurück, was der Server
     * gerade mitgerendert hat, und das ist für den neuen Zeitraum richtig.
     */
    expect(speicher.lies().stand).toBeNull();
    expect(speicher.standFuer('?zeitraum=1d')).toBeNull();
    expect(speicher.standFuer('?zeitraum=30d')).toBeNull();
  });

  it('zeigt nach dem Wechsel die Zahl des neuen Zeitraums und nicht die alte', () => {
    const speicher = erzeugeLiveSpeicher();
    speicher.setzeAbfrage('?zeitraum=30d');
    speicher.uebernimm(stand(9000), '?zeitraum=30d');

    speicher.setzeAbfrage('?zeitraum=1d');
    speicher.uebernimm(stand(120), '?zeitraum=1d');

    expect(speicher.standFuer('?zeitraum=1d')?.zeitraum.sekunden).toBe(120);
    // Und die 30-Tage-Zahl ist weg - sie war der Fehler.
    expect(speicher.standFuer('?zeitraum=1d')?.zeitraum.sekunden).not.toBe(9000);
  });

  it('verwirft eine Antwort, die zu spät kommt', () => {
    /*
     * Wer schnell klickt, hat mehrere Abrufe unterwegs. Käme die langsamere
     * Antwort zuletzt an, überschriebe sie die richtige - unbemerkt, weil
     * beide für sich gültig aussehen.
     */
    const speicher = erzeugeLiveSpeicher();
    speicher.setzeAbfrage('?zeitraum=30d');
    speicher.setzeAbfrage('?zeitraum=1d');

    expect(speicher.uebernimm(stand(9000), '?zeitraum=30d')).toBe(false);
    expect(speicher.standFuer('?zeitraum=1d')).toBeNull();

    expect(speicher.uebernimm(stand(120), '?zeitraum=1d')).toBe(true);
    expect(speicher.standFuer('?zeitraum=1d')?.zeitraum.sekunden).toBe(120);
  });

  it('meldet den Zuhörern jeden Wechsel, damit React neu zeichnet', () => {
    const speicher = erzeugeLiveSpeicher();
    let gerufen = 0;
    const abmelden = speicher.abonniere(() => {
      gerufen += 1;
    });

    speicher.setzeAbfrage('?zeitraum=1d');
    expect(gerufen).toBe(1);
    speicher.uebernimm(stand(120), '?zeitraum=1d');
    expect(gerufen).toBe(2);
    // Auch ein Takt ohne neue Daten muss neu zeichnen - sonst steht die Zahl
    // still, obwohl die Zeit läuft.
    speicher.schlag();
    expect(gerufen).toBe(3);
    expect(speicher.lies().folge).toBe(3);

    abmelden();
    speicher.schlag();
    expect(gerufen).toBe(3);
  });

  it('meldet denselben Zeitraum nicht als Wechsel', () => {
    // Sonst würfe jedes Neuzeichnen den Stand weg und löste einen Abruf aus.
    const speicher = erzeugeLiveSpeicher();
    speicher.setzeAbfrage('?zeitraum=1d');
    speicher.uebernimm(stand(120), '?zeitraum=1d');

    expect(speicher.setzeAbfrage('?zeitraum=1d')).toBe(false);
    expect(speicher.standFuer('?zeitraum=1d')?.zeitraum.sekunden).toBe(120);
  });

  it('zählt vor der ersten Antwort hoch und danach nur, wenn etwas wächst', () => {
    const speicher = erzeugeLiveSpeicher();
    expect(speicher.waechst()).toBe(true);

    speicher.uebernimm(stand(120), '');
    expect(speicher.waechst()).toBe(false);

    const laufend = stand(120);
    laufend.zeitraum.wachsend = 2;
    speicher.uebernimm(laufend, '');
    expect(speicher.waechst()).toBe(true);
  });
});

describe('Live-Kachel: die Verdrahtung gibt den Schlüssel weiter', () => {
  /*
   * Die Komponente selbst lässt sich hier nicht rendern - die Testumgebung
   * ist `node`. Geprüft wird deshalb das eine, was den Speicher aushebeln
   * würde: eine Kachel, die den Stand ohne Schlüsselprüfung liest.
   */
  const quelle = readFileSync(
    join(process.cwd(), 'apps/web/src/modules/analytics/components/live-sprachzeit.tsx'),
    'utf8',
  );

  it('liest den Stand nur über die Schlüsselprüfung', () => {
    expect(quelle).toContain('momentaufnahme.schluessel === abfrage');
  });

  it('holt beim Wechsel sofort nach, statt auf den nächsten Abgleich zu warten', () => {
    expect(quelle).toContain('liveSpeicher.setzeAbfrage(abfrage)');
  });

  it('hält keinen zweiten Stand neben dem Speicher', () => {
    // Ein eigenes `let stand` in dieser Datei wäre der Speicher von vorher.
    expect(quelle).not.toMatch(/^let aktuell/mu);
  });
});

describe('Statistikseite: jede Live-Kachel bekommt den Zeitraum mit', () => {
  const seite = readFileSync(
    join(process.cwd(), 'apps/web/src/app/(app)/analytics/statistik/page.tsx'),
    'utf8',
  );

  it('reicht die Abfrage an jede Kachel weiter', () => {
    /*
     * Fünf Kacheln lesen den gemeinsamen Speicher. Vergässe eine davon den
     * Schlüssel, zeigte ausgerechnet sie wieder die Zahl des vorigen
     * Zeitraums - und niemand suchte dort, weil die anderen stimmen.
     */
    const kacheln = seite.match(/<Live(?:Sprachzeit|Zahl)\b/gu) ?? [];
    const mitAbfrage = seite.match(/abfrage=\{abfrage\}/gu) ?? [];
    expect(kacheln.length).toBeGreaterThanOrEqual(5);
    expect(mitAbfrage.length).toBe(kacheln.length);
  });

  it('baut die Abfrage aus demselben Zeitraum wie der Export', () => {
    // Zwei Rechnungen für dieselbe Zeitspanne wären die, die auseinanderläuft.
    expect(seite).toContain('zeitraumParameter()');
  });
});
