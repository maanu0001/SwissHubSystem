import type { fragt } from '@swisshub/modules';
import type { SocialDaten } from './social-folie';

/**
 * Die eine Stelle, an der Zahlen in eine Grafik kommen.
 *
 * ## Warum das eine eigene Datei ist
 *
 * Damit es genau einen Weg gibt. Die Zahlen stammen aus
 * `FragtAbstimmung.ergebnis` - dem Schnappschuss, der beim Schliessen
 * festgeschrieben wurde -, und sie gehen von hier unveraendert in die Vorlage.
 *
 * Aus dem Entwurf kommen nur Texte: Ueberschrift, Untertitel, Aufruf. Der
 * Entwurf hat kein Feld fuer eine Prozentzahl, und diese Funktion nimmt keines
 * an. Damit ist «echte Abstimmungszahlen dürfen nicht frei manipulierbar sein»
 * keine Pruefung, die jemand vergessen kann, sondern eine Struktur, in der der
 * manipulierte Wert keinen Platz hat.
 *
 * ## Warum der Fragetext aus der Abstimmung kommt
 *
 * Nicht aus der Frage in der Bibliothek: dort darf er sich aendern. Was auf der
 * Grafik steht, muss das sein, was die Leute gelesen haben, als sie abstimmten.
 * Die Ueberschrift daneben ist redaktionell und darf abweichen - sie ist fuer
 * den Fall, dass eine Frage auf Instagram anders klingen soll als auf Discord.
 */
export function socialDaten(quelle: fragt.EntwurfsDaten): SocialDaten | null {
  const { entwurf, abstimmung, ergebnis } = quelle;
  if (!ergebnis) {
    // Kein lesbarer Schnappschuss: keine Grafik. Eine mit geschaetzten Zahlen
    // waere schlimmer als keine.
    return null;
  }

  return {
    frageText: abstimmung.frageText,
    untertitel: entwurf.untertitel,
    ueberschrift: entwurf.ueberschrift,
    cta: entwurf.cta,
    zeilen: ergebnis.zeilen.map((zeile) => ({
      label: zeile.label,
      prozent: zeile.prozent,
      stimmen: zeile.stimmen,
      fuehrt: zeile.fuehrt,
    })),
    gesamt: ergebnis.gesamt,
    gewinner: ergebnis.gewinner
      ? {
          label: ergebnis.gewinner.label,
          prozent: ergebnis.gewinner.prozent,
          stimmen: ergebnis.gewinner.stimmen,
        }
      : null,
    gleichstand: ergebnis.gleichstand.map((zeile) => zeile.label),
  };
}
