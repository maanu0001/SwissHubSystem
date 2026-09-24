import { regeneriereAusgabe } from './ausgabe';
import type { WrappedPeriode } from './perioden';

/**
 * Eine gescheiterte Ausgabe noch einmal erheben.
 *
 * Eine eigene Datei, weil `ausgabe.ts` und `ausgabe-tick.ts` sich sonst
 * gegenseitig importierten - der Durchgang braucht das Fuellen, und das
 * Fuellen steht in derselben Datei wie das Erzeugen, das der Durchgang
 * ebenfalls braucht.
 *
 * Der Akteur ist hier das System: es war niemand. Ein erfundener
 * Benutzername im Protokoll waere schlimmer als gar keiner.
 */
export async function fuelleErneut(
  editionId: string,
  _guildId: string,
  _periode: WrappedPeriode,
): Promise<void> {
  await regeneriereAusgabe(editionId, {
    akteur: { discordId: 'system', username: null },
    // Beim Wiederholen gibt es noch keine Texte - die Erhebung war ja nie
    // erfolgreich. Behalten schadet trotzdem nicht.
    texteBehalten: true,
  });
}
