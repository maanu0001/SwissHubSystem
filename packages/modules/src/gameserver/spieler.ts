/**
 * Wer auf den Server darf - und wer nicht.
 *
 * ## Woher die Spielerkennungen kommen
 *
 * Aus dem Mitgliederprofil. Ein Mitglied traegt sein Steam-Konto unter
 * «Mein Profil → Verbundene Konten» ein; dieselbe Angabe wird hier gelesen.
 * Es gibt **keine** zweite Stelle, an der Turnierteilnehmer ihre SteamID
 * eintragen - sonst haetten wir zwei Wahrheiten ueber dasselbe Konto, und
 * die eine waere immer die veraltete.
 *
 * ## Warum nicht «verifiziert» verlangt wird
 *
 * Weil es keine Verifikation gibt. `MemberSocialLink.verified` ist im
 * ganzen System `false` - das Feld steht dort, um spaeter zwischen beidem
 * unterscheiden zu koennen, nicht weil heute etwas geprueft waere. Wer hier
 * `verified: true` verlangte, liesse niemanden auf den Server.
 *
 * Die tatsaechliche Pruefung passiert auf dem Server: wer mit einer
 * SteamID verbindet, die nicht in der Aufstellung steht, kommt nicht ins
 * Team. Eine falsch eingetragene Kennung faellt damit beim Verbinden auf -
 * frueh genug, und ohne dass SwissHub etwas behaupten muesste, das es nicht
 * wissen kann.
 *
 * ## Der Notausgang
 *
 * Die Turnierleitung kann jederzeit jemanden von Hand hinzufuegen. Ein
 * Turnier, in dem ein Ersatzspieler nicht spielen darf, weil sein Profil
 * unvollstaendig ist, ist kein gut abgesichertes Turnier - es ist ein
 * abgebrochenes.
 */
import { prisma } from '@swisshub/database';
import { gameAdapter } from './adapter';
import type { AdapterGast, AdapterSpieler } from './adapter';
import type { GameServerGame } from '@swisshub/database';

export interface AufstellungsProblem {
  discordId: string;
  name: string;
  slot: 'A' | 'B';
  grund: 'FEHLT' | 'UNGUELTIG';
  /** Was eingetragen war, falls etwas eingetragen war. */
  wert?: string;
}

export interface Aufstellung {
  spieler: AdapterSpieler[];
  gaeste: AdapterGast[];
  /** Wer nicht zugeordnet werden konnte - fuer die Anzeige, nicht als Sperre. */
  probleme: AufstellungsProblem[];
}

/**
 * Die Aufstellung eines Matches.
 *
 * Liest die Teams aus dem bestehenden Turniermodul und ergaenzt sie um die
 * Spielerkennungen. Fehlt eine, steht das Mitglied in `probleme` - und die
 * Oberflaeche sagt, wem was fehlt, statt nur «Konfiguration fehlgeschlagen».
 */
export async function ladeAufstellung(matchId: string, game: GameServerGame): Promise<Aufstellung> {
  const adapter = gameAdapter(game);
  if (!adapter) {
    // Ohne Adapter gibt es keine Aufstellung - und keine Vermutung darueber,
    // wo die Spielerkennungen stehen koennten.
    return { spieler: [], gaeste: [], probleme: [] };
  }
  const plattform = adapter.profilPlattform;

  const match = await prisma.tournamentMatch.findUnique({
    where: { id: matchId },
    select: {
      participantA: { select: { discordId: true, username: true, teamId: true } },
      participantB: { select: { discordId: true, username: true, teamId: true } },
    },
  });
  if (!match) {
    return { spieler: [], gaeste: [], probleme: [] };
  }

  const seiten = [
    { slot: 'A' as const, teilnehmer: match.participantA },
    { slot: 'B' as const, teilnehmer: match.participantB },
  ];

  /** discordId → {name, slot, substitute} */
  const kandidaten = new Map<string, { name: string; slot: 'A' | 'B'; substitute: boolean }>();

  for (const seite of seiten) {
    const teilnehmer = seite.teilnehmer;
    if (!teilnehmer) {
      continue;
    }
    if (teilnehmer.teamId) {
      const mitglieder = await prisma.tournamentTeamMember.findMany({
        where: { teamId: teilnehmer.teamId, removedAt: null },
        select: { discordId: true, username: true, role: true },
      });
      for (const mitglied of mitglieder) {
        if (mitglied.role === 'COACH') {
          // Ein Coach spielt nicht. Er kommt als Gast hinein, nicht als
          // Spieler - sonst zaehlt der Server ihn zur Aufstellung.
          continue;
        }
        kandidaten.set(mitglied.discordId, {
          name: mitglied.username,
          slot: seite.slot,
          substitute: mitglied.role === 'SUBSTITUTE',
        });
      }
    } else if (teilnehmer.discordId) {
      kandidaten.set(teilnehmer.discordId, {
        name: teilnehmer.username ?? teilnehmer.discordId,
        slot: seite.slot,
        substitute: false,
      });
    }
  }

  if (kandidaten.size === 0) {
    return { spieler: [], gaeste: [], probleme: [] };
  }

  /*
   * Eine Abfrage fuer alle - nicht eine je Spieler. Bei zwei Teams mit je
   * fuenf Spielern und zwei Ersatzleuten waeren das vierzehn Roundtrips fuer
   * eine Konfiguration, die im Minutentakt neu gebaut werden kann.
   */
  const konten = await prisma.memberSocialLink.findMany({
    where: {
      platform: plattform,
      profile: { discordId: { in: [...kandidaten.keys()] } },
    },
    select: { handle: true, profile: { select: { discordId: true } } },
  });

  const handleJeDiscordId = new Map(konten.map((k) => [k.profile.discordId, k.handle]));

  const spieler: AdapterSpieler[] = [];
  const probleme: AufstellungsProblem[] = [];

  for (const [discordId, eintrag] of kandidaten) {
    const handle = handleJeDiscordId.get(discordId)?.trim();
    if (!handle) {
      probleme.push({ discordId, name: eintrag.name, slot: eintrag.slot, grund: 'FEHLT' });
      continue;
    }
    if (!adapter.pruefeSpielerKennung(handle)) {
      probleme.push({
        discordId,
        name: eintrag.name,
        slot: eintrag.slot,
        grund: 'UNGUELTIG',
        wert: handle,
      });
      continue;
    }
    spieler.push({ gameId: handle, name: eintrag.name, slot: eintrag.slot, substitute: eintrag.substitute });
  }

  const gaeste = await ladeGaeste(matchId, plattform, adapter.pruefeSpielerKennung);

  return { spieler, gaeste, probleme };
}

/**
 * Wer ausser den Spielern hineindarf.
 *
 * Die eingetragenen Caster des Matches. Die Turnierleitung kommt ueber die
 * Adminfunktionen des Plugins hinein und steht deshalb nicht in dieser
 * Liste - wer sie hier eintruege, muesste die Steam-Konten des ganzen Teams
 * kennen und pflegen.
 */
async function ladeGaeste(
  matchId: string,
  plattform: string,
  pruefe: ((wert: string) => boolean) | undefined,
): Promise<AdapterGast[]> {
  const caster = await prisma.tournamentMatchCaster.findMany({
    where: { matchId },
    select: { discordId: true, username: true },
  });
  if (caster.length === 0) {
    return [];
  }

  const konten = await prisma.memberSocialLink.findMany({
    where: { platform: plattform, profile: { discordId: { in: caster.map((c) => c.discordId) } } },
    select: { handle: true, profile: { select: { discordId: true } } },
  });
  const handleJeDiscordId = new Map(konten.map((k) => [k.profile.discordId, k.handle]));

  return caster.flatMap((eintrag): AdapterGast[] => {
    const handle = handleJeDiscordId.get(eintrag.discordId)?.trim();
    if (!handle || (pruefe && !pruefe(handle))) {
      // Ein Caster ohne gueltige Kennung faellt weg - stillschweigend. Er ist
      // kein Spieler; ein fehlender Caster haelt kein Match auf.
      return [];
    }
    return [{ gameId: handle, name: eintrag.username, rolle: 'CASTER' }];
  });
}
