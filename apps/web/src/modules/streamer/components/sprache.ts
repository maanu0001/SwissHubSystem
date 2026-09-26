import { STREAMER_SPRACHEN } from '@swisshub/modules/streamer/typen';

/**
 * Der Name einer Sprache aus ihrem Kuerzel.
 *
 * Aus der **bestehenden** Liste des Mitgliedsprofils - es gibt keine zweite
 * Sprachliste im Streamer Hub. Ein unbekanntes Kuerzel wird gezeigt, wie es
 * ist: besser «xx» als ein leeres Feld, denn dann sieht man, dass etwas nicht
 * stimmt.
 */
const NACH_KEY = new Map(STREAMER_SPRACHEN.map((eintrag) => [eintrag.key, eintrag.label]));

export function spracheLabel(key: string): string {
  return NACH_KEY.get(key) ?? key;
}
