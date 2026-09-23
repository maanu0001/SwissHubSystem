'use client';

import { FinaleSzene, IntroSzene } from './intro';
import { PrimeTimeSzene, VoiceGesamtSzene, VoiceKanalSzene, VoiceMatesSzene } from './voice';
import { AktiveTageSzene, EventsSzene, LevelSzene, NachrichtenSzene, SpieleSzene } from './aktivitaet';
import { ArchetypSzene, ClipSzene, HighlightSzene } from './hoehepunkte';
import type { WrappedDaten } from '@swisshub/modules/wrapped/daten';

/**
 * Welche Komponente zu welchem Szenenschluessel gehoert.
 *
 * ## Warum das hier steht und nicht in `packages/modules`
 *
 * Die fachliche Registry - wann eine Szene etwas zu sagen hat, in welcher
 * Reihenfolge sie kommt - laeuft auch im Bot. Der braucht keine
 * React-Komponenten und soll sie nicht laden. Was eine Szene *aussieht*,
 * gehoert deshalb in die Oberflaeche; hier werden beide Haelften
 * zusammengefuehrt.
 *
 * Ein Schluessel ohne Komponente wird beim Anzeigen still uebersprungen -
 * eine alte Momentaufnahme mit einer inzwischen entfernten Szene soll die
 * Geschichte nicht sprengen.
 */

export interface SzenenProps {
  daten: WrappedDaten;
  jahr: number;
  /** Reduzierte Bewegung - Zahlen stehen sofort, nichts laeuft hoch. */
  stillstand: boolean;
}

export type SzenenKomponente = (props: SzenenProps) => React.JSX.Element;

export const SZENEN_KOMPONENTEN: Record<string, SzenenKomponente> = {
  intro: IntroSzene,
  voice_total: VoiceGesamtSzene,
  voice_channel: VoiceKanalSzene,
  voice_mates: VoiceMatesSzene,
  messages: NachrichtenSzene,
  prime_time: PrimeTimeSzene,
  games: SpieleSzene,
  level: LevelSzene,
  clips: ClipSzene,
  events: EventsSzene,
  active_days: AktiveTageSzene,
  highlight: HighlightSzene,
  archetype: ArchetypSzene,
  finale: FinaleSzene,
};

/**
 * Wie lange eine Szene steht, bevor automatisch weitergeblaettert wird.
 *
 * ## Warum nicht ueberall gleich
 *
 * Eine Szene mit einer Zahl, die 1,7 Sekunden hochlaeuft, braucht laenger
 * als eine mit drei Zeilen Text. Die Zeiten sind so gewaehlt, dass nach dem
 * Ende der Animation noch etwa zwei Sekunden Ruhe bleiben - lange genug zum
 * Lesen, kurz genug, dass niemand ungeduldig wird.
 *
 * Das Intro steht am laengsten: dort laeuft die Geschichte erst an, und ein
 * Rueckblick, der sofort losrast, wirkt gehetzt.
 */
export const SZENEN_DAUER: Record<string, number> = {
  intro: 7000,
  voice_total: 8000,
  voice_channel: 7000,
  voice_mates: 7500,
  messages: 7500,
  prime_time: 8000,
  games: 6500,
  level: 7500,
  clips: 8000,
  events: 6500,
  active_days: 7500,
  highlight: 6500,
  archetype: 7000,
  // Das Finale laeuft nicht automatisch weiter - es ist das Ende. Die Zahl
  // ist trotzdem gesetzt, damit der Fortschrittsbalken nicht stehenbleibt.
  finale: 30000,
};
