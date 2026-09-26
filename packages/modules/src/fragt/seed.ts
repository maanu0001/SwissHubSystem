import { prisma } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import type { FragtFragetyp } from '@swisshub/database';

const log = createLogger('fragt:seed');

/**
 * Zehn vorbereitete Fragen.
 *
 * ## Warum sie als Entwurf entstehen
 *
 * Weil niemand sie geprueft hat. `DRAFT` und nicht `READY`: die Automatik
 * waehlt nur freigegebene Fragen, also kann keine dieser Fragen von selbst in
 * einem produktiven Kanal landen. Jemand muss sie ansehen und freigeben - und
 * genau das verlangt die Aufgabe.
 *
 * ## Warum das nicht beim Start passiert
 *
 * Es gibt keinen Migrations-Seed und keinen Aufruf beim Modulstart. Das
 * Einspielen ist ein Knopf im Dashboard: eine Anwendung, die beim Hochfahren
 * Inhalte in die Datenbank schreibt, tut es irgendwann auf einem Server, auf
 * dem jemand sie schon geloescht hatte.
 *
 * ## Warum kein zweites Mal
 *
 * `spieleSeedEin` legt nur an, was nach Fragetext noch nicht da ist. Zweimal
 * geklickt ergibt keine zwanzig Fragen.
 */

interface SeedFrage {
  text: string;
  untertitel?: string;
  kategorie: string;
  typ: FragtFragetyp;
  antworten: string[];
}

export const SEED_FRAGEN: readonly SeedFrage[] = [
  {
    text: 'Welches Game verdient ein Remake?',
    kategorie: 'Nostalgie',
    typ: 'UMFRAGE',
    antworten: ['Half-Life', 'Need for Speed Underground', 'Battlefield 3', 'Morrowind'],
  },
  {
    text: 'Controller oder Maus & Tastatur?',
    untertitel: 'Die Frage, die keine Freundschaft überlebt.',
    kategorie: 'Hardware',
    typ: 'ENTWEDER_ODER',
    antworten: ['Controller', 'Maus & Tastatur'],
  },
  {
    text: 'Welches Spiel hat den besten Soundtrack?',
    kategorie: 'Games',
    typ: 'FAVORIT',
    antworten: ['NieR: Automata', 'DOOM Eternal', 'Hollow Knight', 'The Witcher 3', 'Minecraft'],
  },
  {
    text: 'Welches Game hat euch die meisten Spielstunden gekostet?',
    kategorie: 'Games',
    typ: 'UMFRAGE',
    antworten: ['Minecraft', 'Counter-Strike 2', 'League of Legends', 'World of Warcraft'],
  },
  {
    text: 'Singleplayer oder Multiplayer?',
    kategorie: 'Meinung',
    typ: 'ENTWEDER_ODER',
    antworten: ['Singleplayer', 'Multiplayer'],
  },
  {
    text: 'Welches Gaming-Genre ist euer Favorit?',
    kategorie: 'Games',
    typ: 'FAVORIT',
    antworten: ['Shooter', 'RPG', 'Strategie', 'Survival', 'Racing'],
  },
  {
    text: 'Welche Gaming-Reihe sollte zurückkehren?',
    kategorie: 'Nostalgie',
    typ: 'UMFRAGE',
    antworten: ['Splinter Cell', 'Tony Hawk', 'Burnout', 'Dead Space'],
  },
  {
    text: 'Was spielt ihr am liebsten mit Freunden?',
    kategorie: 'Community',
    typ: 'UMFRAGE',
    antworten: ['Etwas Kompetitives', 'Etwas Kooperatives', 'Party-Games', 'Hauptsache Voice'],
  },
  {
    text: 'Ein Spiel unter 20 Stunden ist zu kurz.',
    untertitel: 'Hot Take. Stimme zu oder nicht.',
    kategorie: 'Meinung',
    typ: 'HOT_TAKE',
    antworten: [],
  },
  {
    text: 'Welche Art von Gaming-Event wünscht ihr euch bei SwissHub?',
    kategorie: 'SwissHub',
    typ: 'UMFRAGE',
    antworten: ['Turnier', 'Community-Abend', 'Movie Night', 'Speedrun-Challenge'],
  },
] as const;

/**
 * Die vorbereiteten Fragen einspielen.
 *
 * Gibt zurueck, wie viele neu entstanden sind. Vorhandene bleiben unberuehrt -
 * auch dann, wenn jemand ihren Text inzwischen geaendert hat: verglichen wird
 * der Text, und ein geaenderter Text ist eine andere Frage.
 */
export async function spieleSeedEin(guildId: string, createdByDiscordId: string): Promise<number> {
  const vorhanden = new Set(
    (
      await prisma.fragtFrage.findMany({
        where: { guildId, text: { in: SEED_FRAGEN.map((frage) => frage.text) } },
        select: { text: true },
      })
    ).map((zeile) => zeile.text),
  );

  const fehlende = SEED_FRAGEN.filter((frage) => !vorhanden.has(frage.text));
  if (fehlende.length === 0) {
    return 0;
  }

  for (const frage of fehlende) {
    /*
     * Hot Take bekommt seine festen Antworten hier, nicht aus der Liste oben.
     *
     * Dort steht bewusst ein leeres Array: die Antworten eines Hot Take sind
     * immer dieselben, und sie an zwei Stellen zu pflegen hiesse, dass eine
     * davon irgendwann «Ja / Nein» sagt.
     */
    const antworten = frage.typ === 'HOT_TAKE' ? ['Stimme zu', 'Stimme nicht zu'] : [...frage.antworten];

    await prisma.fragtFrage.create({
      data: {
        guildId,
        text: frage.text,
        untertitel: frage.untertitel ?? null,
        kategorie: frage.kategorie,
        typ: frage.typ,
        // Entwurf. Niemand hat das geprueft.
        status: 'DRAFT',
        tags: ['vorbereitet'],
        createdByDiscordId,
        optionen: { create: antworten.map((label, index) => ({ label, position: index })) },
      },
    });
  }

  log.info('Vorbereitete Fragen eingespielt', { guildId, neu: fehlende.length });
  return fehlende.length;
}
