import type { SpielwahlModus } from '@swisshub/database';
import { elimination } from './elimination';
import { roulette } from './roulette';
import { voting } from './voting';
import type { EntscheidungsModus } from './vertrag';

/**
 * Die Registry der Entscheidungsmodi.
 *
 * Ein neuer Modus ist eine Datei und eine Zeile hier - plus ein Wert im
 * Prisma-Enum und eine Buehne in der Oberflaeche. Nichts davon liegt in der
 * Session-Orchestrierung, und genau das war der Zweck der Trennung.
 */
export const MODI: Record<SpielwahlModus, EntscheidungsModus> = {
  ROULETTE: roulette,
  VOTING: voting,
  ELIMINATION: elimination,
};

export function modus(key: SpielwahlModus): EntscheidungsModus {
  const gefunden = MODI[key];
  if (!gefunden) {
    throw new Error(`spielwahl: unbekannter Modus ${key}`);
  }
  return gefunden;
}

export { DREHDAUER_MS } from './roulette';
export { aktuellesDuell, baueStufe, leseBaum, type Baum, type Paarung, type Stufe } from './elimination';
export { entscheide, raenge, type Rangfolge } from './voting';
export type * from './vertrag';
