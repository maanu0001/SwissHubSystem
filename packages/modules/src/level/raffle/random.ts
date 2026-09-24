/**
 * Die Ziehung - inzwischen allgemein.
 *
 * Der Inhalt dieser Datei ist nach `modules/zufall.ts` gewandert, weil nicht
 * mehr nur das XP-Gluecksrad zieht: «Was spielen wir?» lost mit denselben
 * Regeln aus, und zwei Ziehungen mit zwei Vorstellungen von Fairness waeren
 * eine zu viel.
 *
 * Der Weg hierher bleibt bestehen - `level.raffle.drawWeighted` ist in
 * Aufrufern und Tests benannt, und eine Umbenennung waere Arbeit ohne Ertrag.
 */
export {
  drawWeighted,
  secureRandom,
  type DrawSelection,
  type RandomSource,
  type WeightedTicket,
} from '../../zufall';
