import { readLevelSettings } from './admin';
import { xpForLevel } from './curve';
import { getLeaderboard } from './stats';

/**
 * Die Rangliste fuer die oeffentliche Seite.
 *
 * ## Was das hier ist - und was nicht
 *
 * Kein zweites Ranking. Gerechnet wird ausschliesslich in `getLeaderboard`,
 * derselben Abfrage, aus der auch die Rangliste im Dashboard entsteht. Zwei
 * Ranglisten nebeneinander waeren zwei Gelegenheiten, auseinanderzulaufen -
 * und niemand merkte es, weil beide fuer sich plausibel aussaehen.
 *
 * Was hier steht, ist eine **Projektion**: aus der vollstaendigen Zeile wird
 * genau das, was oeffentlich sein darf.
 *
 * ## Warum die Projektion hier liegt und nicht in der Seite
 *
 * Damit der Server entscheidet, nicht die Anzeige. Bekaeme die Seite den
 * vollstaendigen Datensatz und zeigte davon fuenf Felder, staende der Rest
 * trotzdem in der Antwort - sichtbar fuer jeden, der die Netzwerkkonsole
 * oeffnet. Die Felder, die diese Datei nicht abbildet, verlassen den Server
 * gar nicht erst.
 *
 * Ausdruecklich **nicht** dabei: Nachrichten- und Sprachzahlen. Sie stehen im
 * Dashboard und sind dort am Platz; oeffentlich waeren sie ein
 * Aktivitaetsprofil je Person, das fuer eine Rangliste niemand braucht.
 */

export interface PublicLeaderboardEntry {
  rank: number;
  /** Fuer die Avatar-URL - dieselbe Kennung, die auf Discord ohnehin sichtbar ist. */
  discordId: string;
  displayName: string;
  avatarHash: string | null;
  level: number;
  xp: number;
  /** Fortschritt im aktuellen Level, 0..1. `null`, wenn das Maximum erreicht ist. */
  progress: number | null;
}

export interface PublicLeaderboard {
  entries: PublicLeaderboardEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** Hoechstens so viele Eintraege je Seite - auch wenn mehr verlangt werden. */
const MAX_PRO_SEITE = 100;

/**
 * Eine Seite der oeffentlichen Rangliste.
 *
 * Die Levelkurve kommt aus den Einstellungen des Moduls, genau wie im
 * Dashboard - eine geaenderte Kurve verschiebt beide Ansichten gemeinsam.
 */
export async function getPublicLeaderboard(
  optionen: { page?: number; pageSize?: number } = {},
): Promise<PublicLeaderboard> {
  const pageSize = Math.min(Math.max(optionen.pageSize ?? 50, 1), MAX_PRO_SEITE);
  const page = Math.max(optionen.page ?? 1, 1);

  // Dieselbe Kurve wie im Dashboard: eine geaenderte Einstellung verschiebt
  // beide Ansichten gemeinsam.
  const { maxLevelTotalXp } = await readLevelSettings();

  const { entries, total } = await getLeaderboard({
    limit: pageSize,
    offset: (page - 1) * pageSize,
    maxLevelTotalXp,
  });

  return {
    entries: entries.map((eintrag) => ({
      rank: eintrag.rank,
      discordId: eintrag.discordId,
      // Der Anzeigename, sonst der Benutzername - und wenn beides fehlt, ein
      // neutraler Platzhalter statt einer nackten Kennung.
      displayName: eintrag.displayName ?? eintrag.username ?? 'Unbekannt',
      avatarHash: eintrag.avatarHash,
      level: eintrag.level,
      xp: eintrag.xp,
      progress: fortschritt(eintrag.xp, eintrag.level, maxLevelTotalXp),
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/**
 * Wie weit ins aktuelle Level hinein, 0..1.
 *
 * Aus derselben Kurve wie das Level selbst. `null` am Maximum: dort gibt es
 * kein naechstes Level, und ein Balken, der nie voll wird, waere eine
 * Falschaussage.
 */
function fortschritt(xp: number, level: number, maxLevelTotalXp: number): number | null {
  if (xp >= maxLevelTotalXp) {
    return null;
  }
  const dieses = xpForLevel(level, maxLevelTotalXp);
  const naechstes = xpForLevel(level + 1, maxLevelTotalXp);
  const spanne = naechstes - dieses;
  if (spanne <= 0) {
    return null;
  }
  return Math.min(1, Math.max(0, (xp - dieses) / spanne));
}
