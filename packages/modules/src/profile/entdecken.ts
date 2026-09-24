import { Prisma, prisma } from '@swisshub/database';
import { coverSrc, kurzname } from '../games/katalog';
import * as angaben from './angaben';
import { akzent } from './gestaltung';
import type { EntdeckenEingabe } from './schemas';

/**
 * Mitglieder entdecken.
 *
 * ## Warum eine Abfrage und nicht eine Liste im Speicher
 *
 * Gesucht, gefiltert, sortiert und geteilt wird in Postgres - ueber den
 * **vollstaendigen** Mitgliederbestand, nicht ueber die gerade geladene
 * Seite. Bei mehreren tausend Mitgliedern ist der Unterschied nicht Tempo,
 * sondern Richtigkeit: wer im Speicher filtert, filtert die ersten fuenfzig
 * und nennt das Ergebnis «keine Treffer».
 *
 * ## Warum roh und nicht ueber den Query Builder
 *
 * Der Discord-Spiegel und die Profiltabelle haben keine Prisma-Relation -
 * bewusst: ein Fremdschluessel vom Profil auf den Spiegel wuerde das Profil
 * mitloeschen, sobald jemand aus dem Spiegel faellt, und ein Profil soll
 * einen Serveraustritt ueberleben. Ein `LEFT JOIN` ueber die Discord-Kennung
 * leistet dasselbe ohne diese Kopplung. Alle Werte gehen als Parameter
 * hinein; zusammengesetzt wird nur aus `Prisma.sql`-Bausteinen dieser Datei.
 *
 * ## Was hier nicht herauskommt
 *
 * Keine Rollen, keine Jails, keine Tickets, keine Moderationsdaten. Diese
 * Datei fragt die Tabellen nicht an, in denen so etwas steht. Die
 * Mitgliederverwaltung ist ein anderer Ort mit einer anderen Berechtigung.
 */

export const SEITENGROESSE = 24;

export interface EntdeckenKarte {
  discordId: string;
  discordName: string;
  profilname: string | null;
  avatarHash: string | null;
  tagline: string | null;
  verfuegbarkeit: { key: string; label: string } | null;
  spielart: string | null;
  sprachen: string[];
  plattformen: string[];
  akzentHsl: string;
  level: number | null;
  spiele: Array<{ gameId: string; name: string; cover: string | null }>;
}

export interface EntdeckenSeite {
  karten: EntdeckenKarte[];
  gesamt: number;
  seite: number;
  seiten: number;
}

interface Rohzeile {
  discordId: string;
  displayName: string;
  avatarHash: string | null;
  profilname: string | null;
  tagline: string | null;
  availability: string | null;
  playStyle: string | null;
  accent: string | null;
  languages: string[] | null;
  platforms: string[] | null;
  profileId: string | null;
  xp: number | null;
}

/**
 * Die Bedingungen.
 *
 * Getrennt von der Abfrage, weil Zaehlung und Seite dieselben brauchen -
 * zwei Kopien waeren zwei Gelegenheiten, eine Bedingung zu vergessen, und
 * die Zahl unter der Liste stimmte dann nicht mit der Liste ueberein.
 */
function bedingungen(filter: EntdeckenEingabe): Prisma.Sql[] {
  const teile: Prisma.Sql[] = [
    Prisma.sql`c."leftAt" IS NULL`,
    Prisma.sql`c."isBot" = false`,
    /*
     * Wer sich abmeldet, ist weg - und wer sein Profil auf privat stellt
     * ebenso. Das zweite ist kein Ueberschuss: ohne diese Zeile koennte man
     * ueber den Sprachfilter herausfinden, welche Sprache jemand angegeben
     * hat, dessen Profil niemand sehen darf.
     */
    Prisma.sql`(p."id" IS NULL OR (p."discoverable" = true AND p."visibilityProfile" = 'MEMBERS'))`,
  ];

  if (filter.suche.length > 0) {
    // Dieselbe Spalte, die auch die Mitgliederliste durchsucht - ein
    // zweiter Suchindex waere eine zweite Wahrheit ueber Namen.
    teile.push(Prisma.sql`c."searchText" LIKE ${`%${filter.suche.toLowerCase()}%`}`);
  }
  if (filter.sprache) {
    teile.push(Prisma.sql`p."languages" @> ARRAY[${filter.sprache}]::text[]`);
  }
  if (filter.plattform) {
    teile.push(Prisma.sql`p."platforms" @> ARRAY[${filter.plattform}]::text[]`);
  }
  if (filter.spielzeit) {
    teile.push(Prisma.sql`p."playtimes" @> ARRAY[${filter.spielzeit}]::text[]`);
  }
  if (filter.absprache) {
    teile.push(Prisma.sql`p."comms" @> ARRAY[${filter.absprache}]::text[]`);
  }
  if (filter.spielart) {
    // «Beides» trifft auch, wer nach Casual oder Competitive sucht - sonst
    // faende der Competitive-Filter die Haelfte der Competitive-Spieler nicht.
    teile.push(
      filter.spielart === 'BOTH'
        ? Prisma.sql`p."playStyle" = 'BOTH'`
        : Prisma.sql`p."playStyle" IN (${filter.spielart}::"PlayStyle", 'BOTH')`,
    );
  }
  if (filter.verfuegbarkeit) {
    teile.push(Prisma.sql`p."availability" = ${filter.verfuegbarkeit}::"Availability"`);
  }
  if (filter.gameId) {
    teile.push(Prisma.sql`
      p."visibilityGames" = 'MEMBERS'
      AND EXISTS (
        SELECT 1 FROM "MemberGameProfile" g
        WHERE g."profileId" = p."id" AND g."gameId" = ${filter.gameId}
      )`);
  }

  return teile;
}

export async function entdecke(filter: EntdeckenEingabe): Promise<EntdeckenSeite> {
  const where = Prisma.join(bedingungen(filter), ' AND ');
  /*
   * Der Levelstand haengt als dritter Join dran - auch in der Zaehlung, damit
   * `COUNT(*)` und die Seite ueber genau dieselbe Menge laufen. Ein
   * `LEFT JOIN` kann keine Zeile vervielfachen: `discordId` ist in
   * `LevelProfile` eindeutig.
   */
  const von = Prisma.sql`
    FROM "DiscordMemberCache" c
    LEFT JOIN "MemberProfile" p ON p."discordId" = c."discordId"
    LEFT JOIN "LevelProfile" l ON l."discordId" = c."discordId"
    WHERE ${where}`;

  const zaehlung = await prisma.$queryRaw<Array<{ anzahl: bigint }>>`
    SELECT COUNT(*)::bigint AS anzahl ${von}`;

  const gesamt = Number(zaehlung[0]?.anzahl ?? 0);
  const seiten = Math.max(1, Math.ceil(gesamt / SEITENGROESSE));
  const seite = Math.min(filter.seite, seiten);

  const zeilen = await prisma.$queryRaw<Rohzeile[]>`
    SELECT
      c."discordId",
      c."displayName",
      c."avatarHash",
      p."displayName" AS "profilname",
      p."tagline",
      p."availability"::text AS "availability",
      p."playStyle"::text    AS "playStyle",
      p."accent",
      p."languages",
      p."platforms",
      p."id" AS "profileId",
      l."xp"
    ${von}
    ORDER BY
      -- Gepflegte Profile zuerst: eine Entdeckungsseite, die mit tausend
      -- leeren Karten beginnt, entdeckt nichts.
      (p."id" IS NOT NULL) DESC,
      (p."availability" = 'LOOKING') DESC,
      c."displayName" ASC
    LIMIT ${SEITENGROESSE} OFFSET ${(seite - 1) * SEITENGROESSE}`;

  return {
    karten: await ergaenzeSpiele(zeilen),
    gesamt,
    seite,
    seiten,
  };
}

/**
 * Die Lieblingsspiele nachtragen.
 *
 * Eine Abfrage fuer die ganze Seite, nicht eine je Karte. Bei 24 Karten ist
 * das der Unterschied zwischen zwei Abfragen und fuenfundzwanzig.
 */
async function ergaenzeSpiele(zeilen: readonly Rohzeile[]): Promise<EntdeckenKarte[]> {
  const { levelFromXp } = await import('../level/curve');

  const profilIds = zeilen.map((z) => z.profileId).filter((id): id is string => id !== null);

  const spiele = profilIds.length
    ? await prisma.memberGameProfile.findMany({
        where: { profileId: { in: profilIds } },
        include: {
          game: { select: { id: true, name: true, shortName: true, coverPath: true, coverUrl: true } },
        },
        orderBy: [{ favorite: 'desc' }, { sortOrder: 'asc' }],
      })
    : [];

  const jeProfil = new Map<string, EntdeckenKarte['spiele']>();
  for (const eintrag of spiele) {
    const liste = jeProfil.get(eintrag.profileId) ?? [];
    if (liste.length < 3) {
      liste.push({
        gameId: eintrag.gameId,
        name: kurzname(eintrag.game),
        cover: coverSrc(eintrag.game),
      });
    }
    jeProfil.set(eintrag.profileId, liste);
  }

  return zeilen.map((zeile) => ({
    discordId: zeile.discordId,
    discordName: zeile.displayName,
    profilname: zeile.profilname,
    avatarHash: zeile.avatarHash,
    tagline: zeile.tagline,
    verfuegbarkeit:
      zeile.availability && zeile.availability !== 'UNSET'
        ? {
            key: zeile.availability,
            label: angaben.label('verfuegbarkeit', zeile.availability) ?? 'Keine Angabe',
          }
        : null,
    spielart: zeile.playStyle ? angaben.label('spielart', zeile.playStyle) : null,
    sprachen: angaben.labels('sprachen', zeile.languages ?? []),
    plattformen: angaben.labels('plattformen', zeile.platforms ?? []),
    akzentHsl: akzent(zeile.accent).hsl,
    level: zeile.xp === null ? null : levelFromXp(zeile.xp),
    spiele: (zeile.profileId && jeProfil.get(zeile.profileId)) || [],
  }));
}

/**
 * Die Spiele, nach denen sich filtern laesst.
 *
 * Nur solche, die wirklich in einem Profil stehen - eine Auswahlliste mit
 * zweihundert Spielen, von denen drei jemand spielt, ist keine Hilfe.
 */
export async function filterbareSpiele(): Promise<Array<{ id: string; name: string; anzahl: number }>> {
  const gruppen = await prisma.memberGameProfile.groupBy({
    by: ['gameId'],
    _count: { _all: true },
    orderBy: { _count: { gameId: 'desc' } },
    take: 40,
  });

  if (gruppen.length === 0) {
    return [];
  }

  const spiele = await prisma.game.findMany({
    where: { id: { in: gruppen.map((g) => g.gameId) } },
    select: { id: true, name: true, shortName: true },
  });
  const nachId = new Map(spiele.map((s) => [s.id, s]));

  return gruppen
    .map((gruppe) => {
      const spiel = nachId.get(gruppe.gameId);
      return spiel ? { id: spiel.id, name: kurzname(spiel), anzahl: gruppe._count._all } : null;
    })
    .filter((eintrag): eintrag is { id: string; name: string; anzahl: number } => eintrag !== null);
}
