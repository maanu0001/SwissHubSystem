import { prisma } from '@swisshub/database';
import { slugsVon } from './oeffentlich';

/**
 * Das Mitgliederverzeichnis.
 *
 * ## Was es ist, und was «Mitglieder entdecken» ist
 *
 * Zwei Listen derselben Menschen, mit zwei verschiedenen Fragen.
 *
 * «Entdecken» fragt: *mit wem koennte ich spielen.* Es sucht, filtert nach
 * Spielen und zeigt nur, wer sich dafuer eingetragen hat - und es steht
 * hinter `members.view`, weil es ein Werkzeug ist.
 *
 * Das Verzeichnis fragt: *wer ist hier eigentlich.* Es zeigt alle, in der
 * Ordnung des Servers, und jedes angemeldete Mitglied darf es sehen. Es ist
 * das Gegenstueck zur Mitgliederliste in Discord - nur mit den Profilen
 * daneben.
 *
 * ## Die Ordnung
 *
 * Nach der Discord-Rollenhierarchie, von oben nach unten. Die Position einer
 * Rolle steht im Spiegel (`DiscordRoleCache.position`) und wird vom
 * Sync-Dienst gepflegt - dieselbe Zahl, nach der Discord seine eigene
 * Mitgliederliste ordnet. Eine eigene Rangfolge zu pflegen hiesse, sie
 * auseinanderlaufen zu lassen, sobald jemand auf Discord eine Rolle
 * verschiebt.
 *
 * Bei gleicher Rolle entscheidet der Anzeigename. Ohne das waere die
 * Reihenfolge innerhalb einer Rolle beliebig und bei jedem Aufruf anders.
 *
 * ## Warum Bots fehlen
 *
 * Ein Bot hat kein Profil, keine XP und keine Vitrine. Er stuende in der
 * Liste als Zeile, die zu nichts fuehrt.
 */

export interface VerzeichnisRolle {
  id: string;
  name: string;
  /** Discords Farbe als Zahl; 0 heisst «keine eigene Farbe». */
  farbe: number;
  position: number;
}

export interface VerzeichnisEintrag {
  discordId: string;
  anzeigename: string;
  avatarHash: string | null;
  /** Die oeffentliche Adresse - `null`, wenn es kein sichtbares Profil gibt. */
  slug: string | null;
  /** Die hoechste Rolle mit eigener Farbe oder Position; `null` bei keiner. */
  hoechsteRolle: VerzeichnisRolle | null;
  boosting: boolean;
}

export interface Mitgliederverzeichnis {
  eintraege: VerzeichnisEintrag[];
  gesamt: number;
  seite: number;
  seitengroesse: number;
  seiten: number;
}

const MAX_PRO_SEITE = 120;

export async function ladeMitgliederverzeichnis(
  optionen: { seite?: number; seitengroesse?: number; suche?: string } = {},
): Promise<Mitgliederverzeichnis> {
  const seitengroesse = Math.min(Math.max(optionen.seitengroesse ?? 60, 1), MAX_PRO_SEITE);
  const seite = Math.max(optionen.seite ?? 1, 1);
  const suche = optionen.suche?.trim().toLowerCase() ?? '';

  /*
   * Die Rollen zuerst - sie entscheiden die Ordnung.
   *
   * Geloeschte Rollen stehen im Spiegel weiter, damit alte Eintraege ihren
   * Namen behalten; fuer die Ordnung taugen sie nicht mehr und bleiben hier
   * draussen.
   */
  const rollen = await prisma.discordRoleCache.findMany({
    where: { deletedAt: null },
    select: { roleId: true, name: true, color: true, position: true },
  });
  const nachId = new Map(rollen.map((rolle) => [rolle.roleId, rolle]));

  /*
   * Die Mitglieder.
   *
   * `leftAt: null` ist die Bedingung fuer «ist hier»; wer gegangen ist,
   * bleibt im Spiegel stehen, gehoert aber nicht ins Verzeichnis.
   *
   * Sortiert und geschnitten wird **nicht** in der Datenbank: die Ordnung
   * haengt an der hoechsten Rolle, und die steht in einer zweiten Tabelle.
   * Das in SQL zu fassen hiesse, die Rollenpositionen je Zeile
   * nachzuschlagen. Ein Discord-Server hat einige tausend Mitglieder - das
   * laesst sich tragen, und die Alternative waere eine gespiegelte
   * Positionsspalte, die bei jeder Rollenverschiebung neu zu schreiben
   * waere.
   */
  const mitglieder = await prisma.discordMemberCache.findMany({
    where: {
      leftAt: null,
      isBot: false,
      ...(suche ? { searchText: { contains: suche } } : {}),
    },
    select: {
      discordId: true,
      displayName: true,
      avatarHash: true,
      roleIds: true,
      boosting: true,
    },
  });

  const hoechste = (roleIds: readonly string[]): VerzeichnisRolle | null => {
    let treffer: VerzeichnisRolle | null = null;
    for (const id of roleIds) {
      const rolle = nachId.get(id);
      if (!rolle) {
        continue;
      }
      if (!treffer || rolle.position > treffer.position) {
        treffer = { id: rolle.roleId, name: rolle.name, farbe: rolle.color, position: rolle.position };
      }
    }
    return treffer;
  };

  const sortiert = mitglieder
    .map((mitglied) => ({ mitglied, rolle: hoechste(mitglied.roleIds) }))
    .sort((a, b) => {
      const links = a.rolle?.position ?? -1;
      const rechts = b.rolle?.position ?? -1;
      if (links !== rechts) {
        return rechts - links;
      }
      return a.mitglied.displayName.localeCompare(b.mitglied.displayName, 'de-CH');
    });

  const gesamt = sortiert.length;
  const ausschnitt = sortiert.slice((seite - 1) * seitengroesse, seite * seitengroesse);

  /*
   * Die oeffentlichen Adressen - nur fuer die Zeilen dieser Seite.
   *
   * `slugsVon` gibt einen Slug ausschliesslich fuer ein veroeffentlichtes,
   * nicht gesperrtes Profil heraus. Wer keines hat, steht hier ohne Link:
   * das Verzeichnis zeigt, wer da ist, und nicht, wer sich versteckt.
   */
  const slugs = await slugsVon(ausschnitt.map((eintrag) => eintrag.mitglied.discordId));

  return {
    eintraege: ausschnitt.map(({ mitglied, rolle }) => ({
      discordId: mitglied.discordId,
      anzeigename: mitglied.displayName,
      avatarHash: mitglied.avatarHash,
      slug: slugs.get(mitglied.discordId) ?? null,
      hoechsteRolle: rolle,
      boosting: mitglied.boosting,
    })),
    gesamt,
    seite,
    seitengroesse,
    seiten: Math.max(1, Math.ceil(gesamt / seitengroesse)),
  };
}
