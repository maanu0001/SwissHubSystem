import { prisma } from '@swisshub/database';
import { systemRoutes } from '@swisshub/shared';
import { coverSrc, kurzname } from '../games/katalog';
import { levelProgress } from '../level/curve';
import { getProfile as getLevelProfile, getRank } from '../level/service';
import * as angaben from './angaben';
import * as auszeichnungen from './auszeichnungen';
import * as gestaltung from './gestaltung';
import * as karriere from './karriere';
import * as showcase from './showcase';
import * as socials from './socials';
import { zeigeFelder, type AngezeigtesFeld } from './spielfelder';

/**
 * Das Profil eines Mitglieds - lesen.
 *
 * ## Die Regel dieser Datei
 *
 * **Was der Betrachter nicht sehen darf, wird nicht geladen.** Nicht
 * geladen und hinterher entfernt, sondern gar nicht erst abgefragt. Ein
 * nachtraegliches Filtern haette dieselbe Abfrage ausgeloest, dieselbe Zeile
 * in einem Fehlerprotokoll erzeugt und waere beim naechsten neuen Feld
 * vergessen worden.
 *
 * Was hier herauskommt, ist das vollstaendige oeffentliche Profil-DTO. Es
 * enthaelt keine Tickets, keine Jails, keine Moderationsnotizen, keine
 * Verifikationsdetails, keine Rollenrechte und keine Tokens - nicht weil
 * sie herausgefiltert werden, sondern weil diese Datei sie nie anfasst. Die
 * Mitgliedsakte unter `members/` ist der Ort dafuer, und sie prueft ihre
 * eigenen Berechtigungen.
 *
 * ## Sichtbarkeit
 *
 * Zwei Stufen, mehr braucht es nicht: `MEMBERS` heisst «alle angemeldeten
 * Mitglieder dieses Servers», `PRIVATE` heisst «nur ich». Ein drittes
 * «Freunde» haette ein Freundesystem noetig gemacht, das es nicht gibt und
 * das fuer eine Profilseite auch niemand braucht.
 *
 * Das eigene Profil ist immer vollstaendig sichtbar - `PRIVATE` verbirgt
 * etwas vor anderen, nicht vor einem selbst.
 */

/** Ein Profil ohne gespeicherte Zeile - jedes Mitglied hat eines. */
const STANDARD = {
  displayName: null,
  tagline: null,
  bio: null,
  languages: [] as string[],
  platforms: [] as string[],
  playtimes: [] as string[],
  comms: [] as string[],
  playStyle: 'BOTH' as const,
  availability: 'UNSET' as const,
  bannerPath: null,
  bannerPreset: null,
  theme: 'swisshub',
  accent: 'rot',
  visibilityProfile: 'MEMBERS' as const,
  visibilityGames: 'MEMBERS' as const,
  visibilitySocials: 'PRIVATE' as const,
  visibilityCareer: 'MEMBERS' as const,
  visibilityActivity: 'MEMBERS' as const,
  discoverable: true,
};

export type Abschnitt = 'profil' | 'games' | 'socials' | 'karriere' | 'aktivitaet';

export interface ProfilIdentitaet {
  discordId: string;
  /** Der Discord-Anzeigename. Kommt aus dem Spiegel, nie aus dem Profil. */
  discordName: string;
  /** Der selbst gewaehlte Zusatzname - ersetzt den Discord-Namen nicht. */
  profilname: string | null;
  avatarHash: string | null;
  mitgliedSeit: Date | null;
  /** Hat den Server verlassen - das Profil bleibt lesbar, sagt es aber. */
  verlassen: boolean;
  boostet: boolean;
}

export interface ProfilGestaltung {
  thema: string;
  akzent: string;
  /** Fertige CSS-Variablen aus der Registry - nie aus der Datenbank. */
  variablen: Record<string, string>;
  /** Hochgeladenes Banner, falls vorhanden - gilt vor der Vorlage. */
  bannerBild: string | null;
  bannerVerlauf: string;
}

export interface ProfilAngaben {
  tagline: string | null;
  bio: string | null;
  sprachen: string[];
  plattformen: string[];
  spielzeiten: string[];
  absprache: string[];
  spielart: string;
  verfuegbarkeit: { key: string; label: string };
}

export interface ProfilSpiel {
  id: string;
  gameId: string;
  name: string;
  kurz: string;
  cover: string | null;
  plattform: string | null;
  notiz: string | null;
  favorit: boolean;
  felder: AngezeigtesFeld[];
  /** Aus dem Katalog genommen - bleibt lesbar, wird aber leiser dargestellt. */
  archiviert: boolean;
}

export interface ProfilLevel {
  level: number;
  xp: number;
  /** 0 bis 1. */
  fortschritt: number;
  naechstesLevelXp: number;
  fehlendeXp: number;
  hoechstlevel: boolean;
  rang: number | null;
}

export interface ProfilTurniere {
  /** Bestaetigt teilgenommen - keine blossen Anmeldungen. */
  teilnahmen: number;
  podeste: number;
  siege: number;
  letzte: Array<{
    id: string;
    slug: string;
    name: string;
    gameName: string;
    startsAt: Date | null;
    platz: number | null;
  }>;
}

export interface ProfilAnsicht {
  identitaet: ProfilIdentitaet;
  gestaltung: ProfilGestaltung;
  /** Fehlt, wenn der Betrachter den Abschnitt nicht sehen darf. */
  angaben?: ProfilAngaben;
  level: ProfilLevel | null;
  spiele?: ProfilSpiel[];
  socials?: socials.SocialAnzeige[];
  vitrine: showcase.ShowcaseKarte[];
  auszeichnungen: auszeichnungen.Auszeichnung[];
  karriere?: karriere.Meilenstein[];
  turniere?: ProfilTurniere;
  /** Sieht der Betrachter sein eigenes Profil? */
  eigenes: boolean;
  /** Abschnitte, die dieses Mitglied vor anderen verbirgt. */
  verborgen: Abschnitt[];
}

function sichtbar(stufe: string, eigenes: boolean): boolean {
  return eigenes || stufe === 'MEMBERS';
}

/**
 * Das gespeicherte Profil - oder die Standardwerte.
 *
 * Kein Anlegen beim Lesen: ein Aufruf «wer ist das?» soll nichts schreiben.
 * Die Zeile entsteht beim ersten Speichern (`bearbeiten.ts`).
 */
export async function ladeProfilZeile(discordId: string) {
  const zeile = await prisma.memberProfile.findUnique({ where: { discordId } });
  return zeile ?? { id: null, discordId, ...STANDARD };
}

/**
 * Alles, was ein Profil anzeigt.
 *
 * `betrachterId` entscheidet ueber die Sichtbarkeit und kommt aus der
 * Sitzung, nie aus der Adresszeile. Gibt `null` zurueck, wenn es die Person
 * im Discord-Spiegel nicht gibt - ohne Spiegeleintrag gibt es keinen Namen
 * und kein Profil.
 */
export async function ladeProfil(discordId: string, betrachterId: string): Promise<ProfilAnsicht | null> {
  const eigenes = discordId === betrachterId;

  const [spiegel, zeile] = await Promise.all([
    prisma.discordMemberCache.findUnique({ where: { discordId } }),
    prisma.memberProfile.findUnique({ where: { discordId } }),
  ]);

  if (!spiegel || spiegel.isBot) {
    return null;
  }

  const profil = zeile ?? { id: null, discordId, ...STANDARD };

  const zeigeAngaben = sichtbar(profil.visibilityProfile, eigenes);
  const zeigeSpiele = sichtbar(profil.visibilityGames, eigenes);
  const zeigeSocials = sichtbar(profil.visibilitySocials, eigenes);
  const zeigeKarriere = sichtbar(profil.visibilityCareer, eigenes);
  const zeigeAktivitaet = sichtbar(profil.visibilityActivity, eigenes);

  /*
   * Was geladen wird, haengt an der Sichtbarkeit - siehe oben. Was immer
   * geladen wird: Level und Auszeichnungen. Beide stehen im Profilkopf und
   * sind ohnehin oeffentlich (das Leaderboard zeigt jedes Level), und die
   * Vitrine braucht sie.
   */
  const [level, spiele, socialZeilen, vitrineZeilen, turniere, clipBilanz, events] = await Promise.all([
    ladeLevel(discordId),
    profil.id && zeigeSpiele ? ladeSpiele(profil.id) : Promise.resolve([]),
    profil.id && zeigeSocials
      ? prisma.memberSocialLink.findMany({
          where: { profileId: profil.id },
          orderBy: { sortOrder: 'asc' },
        })
      : Promise.resolve([]),
    profil.id
      ? prisma.memberShowcase.findMany({ where: { profileId: profil.id }, orderBy: { slot: 'asc' } })
      : Promise.resolve([]),
    ladeTurniere(discordId),
    ladeClipBilanz(discordId),
    prisma.calendarRegistration.count({ where: { discordId, status: 'CONFIRMED' } }),
  ]);

  const grundlage: auszeichnungen.Grundlage = {
    beitrittAm: spiegel.joinedAt,
    level: level?.level ?? 1,
    hoechstlevel: level?.hoechstlevel ?? false,
    turniere: {
      teilgenommen: turniere.teilnahmen,
      podeste: turniere.podeste,
      siege: turniere.siege,
    },
    clips: clipBilanz,
    events,
    spielprofile: spiele.length,
    boostet: spiegel.boosting,
    jetzt: new Date(),
  };

  const erreichte = auszeichnungen.erreichte(grundlage);
  const socialAnzeigen = socialZeilen
    .map((zeile) => socials.zeigeSocial(zeile.platform, zeile.handle, zeile.verified))
    .filter((eintrag): eintrag is socials.SocialAnzeige => eintrag !== null);

  const vitrine = baueVitrine(vitrineZeilen, {
    spiele,
    socials: socialAnzeigen,
    auszeichnungen: erreichte,
    turniere,
    level,
    clipSieg: clipBilanz.letzterSieg,
  });

  /*
   * «Teile dieses Profils sind privat» - aber nur, wenn jemand das auch
   * entschieden hat.
   *
   * Ohne gespeicherte Zeile gelten die Standardwerte, und darunter ist
   * `visibilitySocials` auf `PRIVATE`. Ein nagelneues Profil haette sonst
   * einen Hinweis auf verborgene Inhalte getragen, die es gar nicht gibt -
   * eine Auskunft ueber eine Entscheidung, die nie jemand getroffen hat.
   */
  const verborgen: Abschnitt[] = [];
  if (zeile) {
    if (profil.visibilityProfile === 'PRIVATE') verborgen.push('profil');
    if (profil.visibilityGames === 'PRIVATE') verborgen.push('games');
    if (profil.visibilitySocials === 'PRIVATE') verborgen.push('socials');
    if (profil.visibilityCareer === 'PRIVATE') verborgen.push('karriere');
    if (profil.visibilityActivity === 'PRIVATE') verborgen.push('aktivitaet');
  }

  const vorlage = gestaltung.bannervorlage(profil.bannerPreset);

  return {
    identitaet: {
      discordId,
      discordName: spiegel.displayName,
      profilname: zeigeAngaben ? profil.displayName : null,
      avatarHash: spiegel.avatarHash,
      mitgliedSeit: spiegel.joinedAt,
      verlassen: spiegel.leftAt !== null,
      boostet: spiegel.boosting,
    },
    gestaltung: {
      thema: gestaltung.thema(profil.theme).key,
      akzent: gestaltung.akzent(profil.accent).key,
      variablen: gestaltung.gestaltungsVariablen(profil.theme, profil.accent),
      bannerBild: profil.bannerPath ? bannerQuelle(discordId, profil.bannerPath) : null,
      bannerVerlauf: vorlage.verlauf,
    },
    ...(zeigeAngaben
      ? {
          angaben: {
            tagline: profil.tagline,
            bio: profil.bio,
            sprachen: angaben.labels('sprachen', profil.languages),
            plattformen: angaben.labels('plattformen', profil.platforms),
            spielzeiten: angaben.labels('spielzeiten', profil.playtimes),
            absprache: angaben.labels('absprache', profil.comms),
            spielart: angaben.label('spielart', profil.playStyle) ?? 'Beides',
            verfuegbarkeit: {
              key: profil.availability,
              label: angaben.label('verfuegbarkeit', profil.availability) ?? 'Keine Angabe',
            },
          },
        }
      : {}),
    level,
    ...(zeigeSpiele ? { spiele } : {}),
    ...(zeigeSocials ? { socials: socialAnzeigen } : {}),
    vitrine,
    auszeichnungen: eigenes ? auszeichnungen.bewerte(grundlage) : erreichte,
    ...(zeigeKarriere
      ? {
          karriere: baueKarriere({
            beitrittAm: spiegel.joinedAt,
            turniere,
            level,
            clipSieg: clipBilanz.letzterSieg,
          }),
        }
      : {}),
    ...(zeigeAktivitaet ? { turniere } : {}),
    eigenes,
    verborgen,
  };
}

/** Die Adresse des Profilbanners - ueber eine Route, nicht als Dateipfad. */
export function bannerQuelle(discordId: string, bannerPath: string): string {
  return `/api/profil/${discordId}/banner?v=${bannerPath.slice(-12)}`;
}

async function ladeLevel(discordId: string): Promise<ProfilLevel | null> {
  const profil = await getLevelProfile(discordId);
  if (!profil) {
    return null;
  }
  // Gerechnet wird im bestehenden Levelsystem. Hier steht keine zweite
  // Kurve und keine zweite Schwelle.
  const fortschritt = levelProgress(profil.xp);
  return {
    level: fortschritt.level,
    xp: profil.xp,
    fortschritt: fortschritt.progress,
    naechstesLevelXp: fortschritt.nextLevelXp,
    fehlendeXp: fortschritt.remainingXp,
    hoechstlevel: fortschritt.isMaxLevel,
    rang: await getRank(discordId),
  };
}

async function ladeSpiele(profileId: string): Promise<ProfilSpiel[]> {
  const zeilen = await prisma.memberGameProfile.findMany({
    where: { profileId },
    include: { game: true },
    // Favoriten zuerst, dann die eigene Reihenfolge - so wie im Editor
    // gezogen.
    orderBy: [{ favorite: 'desc' }, { sortOrder: 'asc' }],
  });

  return zeilen.map((zeile) => ({
    id: zeile.id,
    gameId: zeile.gameId,
    name: zeile.game.name,
    kurz: kurzname(zeile.game),
    cover: coverSrc(zeile.game),
    plattform: zeile.platform,
    notiz: zeile.note,
    favorit: zeile.favorite,
    // Was die Registry heute nicht mehr kennt, faellt hier weg. Gespeichert
    // bleibt es - eine Version spaeter kann es wieder auftauchen.
    felder: zeigeFelder(zeile.game.name, zeile.fields),
    archiviert: zeile.game.archivedAt !== null,
  }));
}

async function ladeTurniere(discordId: string): Promise<ProfilTurniere> {
  const { getMemberHistory } = await import('../tournaments/queries');
  const verlauf = await getMemberHistory(discordId);
  return {
    teilnahmen: verlauf.gesamt,
    podeste: verlauf.podeste,
    siege: verlauf.siege,
    letzte: verlauf.teilnahmen.slice(0, 6).map((eintrag) => ({
      id: eintrag.tournament.id,
      slug: eintrag.tournament.slug,
      name: eintrag.tournament.name,
      gameName: eintrag.tournament.gameName,
      startsAt: eintrag.tournament.startsAt,
      platz: eintrag.placement,
    })),
  };
}

async function ladeClipBilanz(discordId: string): Promise<
  auszeichnungen.Grundlage['clips'] & {
    letzterSieg: { key: string; nummer: number; titel: string } | null;
  }
> {
  const { resolveGuildId } = await import('@swisshub/discord');
  const { bilanz } = await import('../clips/abfragen');
  try {
    const guildId = await resolveGuildId();
    const werte = await bilanz(guildId, discordId);
    return {
      eingereicht: werte.eingereicht,
      treppchen: werte.treppchen,
      siege: werte.siege,
      erhalteneStimmen: werte.erhalteneStimmen,
      letzterSieg: werte.letzterSieg
        ? { key: werte.letzterSieg.key, nummer: werte.letzterSieg.nummer, titel: werte.letzterSieg.titel }
        : null,
    };
  } catch {
    // Ohne verbundene Guild gibt es keine Clip-Runden. Ein Profil deshalb
    // gar nicht anzuzeigen waere die falsche Antwort - der Block fehlt.
    return { eingereicht: 0, treppchen: 0, siege: 0, erhalteneStimmen: 0, letzterSieg: null };
  }
}

interface VitrinenQuellen {
  spiele: ProfilSpiel[];
  socials: socials.SocialAnzeige[];
  auszeichnungen: auszeichnungen.Auszeichnung[];
  turniere: ProfilTurniere;
  level: ProfilLevel | null;
  clipSieg: { key: string; nummer: number; titel: string } | null;
}

/**
 * Die Vitrine zusammensetzen.
 *
 * **Ein Platz, dessen Verweis ins Leere geht, wird uebersprungen.** Kein
 * Fehler, kein leerer Rahmen, kein «nicht mehr verfuegbar» - der Platz ist
 * einfach nicht da. Deshalb steht hier auch keine einzige Abfrage: alles,
 * worauf ein Platz zeigen kann, ist oben schon geladen. Ein Turnier, das
 * archiviert wurde, steht weiterhin im Verlauf und bleibt damit in der
 * Vitrine - archiviert ist nicht geloescht.
 */
function baueVitrine(
  zeilen: ReadonlyArray<{ slot: number; kind: string; refId: string | null }>,
  quellen: VitrinenQuellen,
): showcase.ShowcaseKarte[] {
  const karten: showcase.ShowcaseKarte[] = [];

  for (const zeile of zeilen) {
    if (!showcase.istGueltigerPlatz(zeile.slot, zeile.kind, zeile.refId)) {
      continue;
    }
    const art = showcase.showcaseArt(zeile.kind);
    if (!art) {
      continue;
    }
    const karte = loeseVitrinenplatz(zeile, art, quellen);
    if (karte) {
      karten.push(karte);
    }
  }

  return karten.sort((a, b) => a.slot - b.slot);
}

function loeseVitrinenplatz(
  zeile: { slot: number; kind: string; refId: string | null },
  art: showcase.ShowcaseArt,
  quellen: VitrinenQuellen,
): showcase.ShowcaseKarte | null {
  const grund = { slot: zeile.slot, kind: art.key, symbol: art.symbol, art: art.label };

  switch (art.key) {
    case 'game': {
      const spiel = quellen.spiele.find((eintrag) => eintrag.gameId === zeile.refId);
      if (!spiel) {
        return null;
      }
      const hervor = spiel.felder.find((feld) => feld.hervorgehoben);
      return {
        ...grund,
        titel: spiel.name,
        untertitel: spiel.plattform,
        auszeichnung: hervor ? hervor.wert : null,
        bild: spiel.cover,
        link: null,
      };
    }
    case 'tournament': {
      const turnier = quellen.turniere.letzte.find((eintrag) => eintrag.id === zeile.refId);
      if (!turnier) {
        return null;
      }
      return {
        ...grund,
        titel: turnier.name,
        untertitel: turnier.gameName,
        auszeichnung: turnier.platz ? `${turnier.platz}. Platz` : null,
        bild: null,
        link: systemRoutes.turnier(turnier.slug),
      };
    }
    case 'achievement': {
      const eintrag = quellen.auszeichnungen.find((a) => a.key === zeile.refId && a.erreicht);
      if (!eintrag) {
        return null;
      }
      return {
        ...grund,
        symbol: eintrag.symbol,
        titel: eintrag.label,
        untertitel: eintrag.beschreibung,
        auszeichnung: null,
        bild: null,
        link: null,
      };
    }
    case 'level': {
      if (!quellen.level) {
        return null;
      }
      return {
        ...grund,
        titel: `Level ${quellen.level.level}`,
        untertitel: quellen.level.rang ? `Rang ${quellen.level.rang} im Server` : null,
        auszeichnung: quellen.level.hoechstlevel ? 'Höchstlevel' : `${quellen.level.xp} XP`,
        bild: null,
        link: null,
      };
    }
    case 'clip': {
      if (!quellen.clipSieg || quellen.clipSieg.key !== zeile.refId) {
        return null;
      }
      return {
        ...grund,
        titel: quellen.clipSieg.titel,
        untertitel: `Runde ${quellen.clipSieg.nummer}`,
        auszeichnung: 'Clip der Woche',
        bild: null,
        link: systemRoutes.clipRunde(quellen.clipSieg.key),
      };
    }
    case 'social': {
      const eintrag = quellen.socials.find((s) => s.plattform === zeile.refId);
      if (!eintrag) {
        return null;
      }
      return {
        ...grund,
        titel: eintrag.label,
        untertitel: eintrag.handle,
        auszeichnung: null,
        bild: null,
        link: eintrag.adresse,
      };
    }
    default:
      // Eine Art, die die Registry kennt, hier aber nicht aufgeloest wird.
      // Ueberspringen statt raten.
      return null;
  }
}

/**
 * Die Zeitleiste.
 *
 * Nur Belegtes - siehe `karriere.ts`. Eine leere Leiste ist ein gueltiges
 * Ergebnis; die Ansicht zeigt dann nichts statt eines Platzhalters.
 */
function baueKarriere(quellen: {
  beitrittAm: Date | null;
  turniere: ProfilTurniere;
  level: ProfilLevel | null;
  clipSieg: { key: string; nummer: number; titel: string } | null;
}): karriere.Meilenstein[] {
  const eintraege: karriere.Meilenstein[] = [];

  if (quellen.beitrittAm) {
    eintraege.push({
      key: 'beitritt',
      art: 'beitritt',
      am: quellen.beitrittAm,
      titel: 'Auf den SwissHub gekommen',
      beschreibung: null,
      symbol: 'DoorOpen',
      link: null,
      hervorgehoben: false,
    });
  }

  for (const turnier of quellen.turniere.letzte) {
    const sieg = turnier.platz === 1;
    eintraege.push({
      key: `turnier:${turnier.id}`,
      art: sieg ? 'turnier-sieg' : 'turnier',
      am: turnier.startsAt,
      titel: sieg ? `${turnier.name} gewonnen` : turnier.name,
      beschreibung: turnier.platz && !sieg ? `${turnier.platz}. Platz` : turnier.gameName,
      symbol: sieg ? 'Trophy' : 'Swords',
      link: systemRoutes.turnier(turnier.slug),
      hervorgehoben: turnier.platz !== null && turnier.platz <= 3,
    });
  }

  if (quellen.clipSieg) {
    eintraege.push({
      key: `clip:${quellen.clipSieg.key}`,
      art: 'clip-sieg',
      // Die Runde hat ein Datum, die Bilanz gibt es nicht heraus. Lieber
      // ohne Datum ans Ende als mit einem geratenen nach vorne.
      am: null,
      titel: 'Clip der Woche gewonnen',
      beschreibung: quellen.clipSieg.titel,
      symbol: 'Clapperboard',
      link: systemRoutes.clipRunde(quellen.clipSieg.key),
      hervorgehoben: true,
    });
  }

  if (quellen.level && quellen.level.level > 1) {
    eintraege.push({
      key: 'level',
      art: 'level',
      // Ohne Datum: wann welche Schwelle fiel, ist nirgends gespeichert.
      am: null,
      titel: quellen.level.hoechstlevel ? 'Höchstlevel erreicht' : `Level ${quellen.level.level}`,
      beschreibung: `${quellen.level.xp} XP`,
      symbol: quellen.level.hoechstlevel ? 'Crown' : 'Sparkles',
      link: null,
      hervorgehoben: quellen.level.hoechstlevel,
    });
  }

  return karriere.sortiere(eintraege);
}

/** Was der Editor zum Bearbeiten braucht - immer das eigene Profil. */
export interface EditorDaten {
  allgemein: {
    displayName: string | null;
    tagline: string | null;
    bio: string | null;
    languages: string[];
    platforms: string[];
    playtimes: string[];
    comms: string[];
    playStyle: string;
    availability: string;
  };
  gestaltung: {
    theme: string;
    accent: string;
    bannerPreset: string | null;
    bannerBild: string | null;
  };
  privatsphaere: {
    visibilityProfile: string;
    visibilityGames: string;
    visibilitySocials: string;
    visibilityCareer: string;
    visibilityActivity: string;
    discoverable: boolean;
  };
  spiele: Array<{
    gameId: string;
    name: string;
    cover: string | null;
    platform: string | null;
    note: string | null;
    favorite: boolean;
    /** Rohwerte - der Editor braucht sie zum Vorbelegen, nicht die Anzeige. */
    felder: Record<string, unknown>;
  }>;
  /** Der zentrale Katalog, ohne die schon eingetragenen Spiele. */
  katalog: Array<{ id: string; name: string; cover: string | null; platforms: string[] }>;
  socials: Array<{ platform: string; handle: string }>;
  vitrine: Array<{ slot: number; kind: string; refId: string | null }>;
  /** Was in die Vitrine gestellt werden darf - je Typ. */
  auswahl: Record<string, Array<{ id: string; label: string }>>;
}

export async function ladeEditor(discordId: string): Promise<EditorDaten> {
  const { listGames } = await import('../games/katalog');

  const profil = await prisma.memberProfile.findUnique({ where: { discordId } });
  const profileId = profil?.id ?? null;

  const [spielZeilen, socialZeilen, vitrineZeilen, katalog, turniere, clipSiege, events] = await Promise.all([
    profileId
      ? prisma.memberGameProfile.findMany({
          where: { profileId },
          include: { game: true },
          orderBy: [{ favorite: 'desc' }, { sortOrder: 'asc' }],
        })
      : Promise.resolve([]),
    profileId
      ? prisma.memberSocialLink.findMany({ where: { profileId }, orderBy: { sortOrder: 'asc' } })
      : Promise.resolve([]),
    profileId
      ? prisma.memberShowcase.findMany({ where: { profileId }, orderBy: { slot: 'asc' } })
      : Promise.resolve([]),
    listGames({}),
    ladeTurniere(discordId),
    ladeClipSiege(discordId),
    prisma.calendarRegistration.findMany({
      where: { discordId, status: 'CONFIRMED' },
      include: { event: { select: { id: true, title: true, startAt: true } } },
      orderBy: { registeredAt: 'desc' },
      take: 20,
    }),
  ]);

  const eigene = new Set(spielZeilen.map((zeile) => zeile.gameId));
  const werte = profil ?? { id: null, discordId, ...STANDARD };

  // Die Auszeichnungen fuer die Vitrine: alle, die es gibt. Ob sie erreicht
  // sind, entscheidet die Anzeige - eine nicht erreichte faellt dort still
  // weg, statt hier eine Auswahl zu verbieten, die morgen zutrifft.
  const { alleAuszeichnungsArten } = await import('./auszeichnungen');

  return {
    allgemein: {
      displayName: werte.displayName,
      tagline: werte.tagline,
      bio: werte.bio,
      languages: werte.languages,
      platforms: werte.platforms,
      playtimes: werte.playtimes,
      comms: werte.comms,
      playStyle: werte.playStyle,
      availability: werte.availability,
    },
    gestaltung: {
      theme: werte.theme,
      accent: werte.accent,
      bannerPreset: werte.bannerPreset,
      bannerBild: werte.bannerPath ? bannerQuelle(discordId, werte.bannerPath) : null,
    },
    privatsphaere: {
      visibilityProfile: werte.visibilityProfile,
      visibilityGames: werte.visibilityGames,
      visibilitySocials: werte.visibilitySocials,
      visibilityCareer: werte.visibilityCareer,
      visibilityActivity: werte.visibilityActivity,
      discoverable: werte.discoverable,
    },
    spiele: spielZeilen.map((zeile) => ({
      gameId: zeile.gameId,
      name: zeile.game.name,
      cover: coverSrc(zeile.game),
      platform: zeile.platform,
      note: zeile.note,
      favorite: zeile.favorite,
      felder:
        zeile.fields && typeof zeile.fields === 'object' && !Array.isArray(zeile.fields)
          ? (zeile.fields as Record<string, unknown>)
          : {},
    })),
    katalog: katalog
      .filter((spiel) => !eigene.has(spiel.id))
      .map((spiel) => ({
        id: spiel.id,
        name: spiel.name,
        cover: coverSrc(spiel),
        platforms: spiel.platforms,
      })),
    socials: socialZeilen.map((zeile) => ({ platform: zeile.platform, handle: zeile.handle })),
    vitrine: vitrineZeilen.map((zeile) => ({
      slot: zeile.slot,
      kind: zeile.kind,
      refId: zeile.refId,
    })),
    auswahl: {
      game: spielZeilen.map((zeile) => ({ id: zeile.gameId, label: zeile.game.name })),
      tournament: turniere.letzte.map((turnier) => ({
        id: turnier.id,
        label: turnier.platz ? `${turnier.name} (${turnier.platz}. Platz)` : turnier.name,
      })),
      achievement: alleAuszeichnungsArten().map((art) => ({ id: art.key, label: art.label })),
      clip: clipSiege,
      event: events.map((anmeldung) => ({
        id: anmeldung.event.id,
        label: anmeldung.event.title,
      })),
      social: socialZeilen.map((zeile) => ({ id: zeile.platform, label: zeile.platform })),
    },
  };
}

/**
 * Die gewonnenen Clip-Runden - fuer die Vitrinenauswahl.
 *
 * Nur abgeschlossene Runden mit Platz 1. Eine laufende Runde hat noch keine
 * Plaetze; sie anzubieten hiesse, einen Sieg zur Auswahl zu stellen, den es
 * noch nicht gibt.
 */
async function ladeClipSiege(discordId: string): Promise<Array<{ id: string; label: string }>> {
  const eintraege = await prisma.clipCompetitionEntry.findMany({
    where: { submittedByDiscordId: discordId, finalRank: 1, competition: { status: 'COMPLETED' } },
    include: { clip: { select: { title: true } }, competition: { select: { key: true, number: true } } },
    orderBy: { competition: { number: 'desc' } },
    take: 20,
  });

  return eintraege.map((eintrag) => ({
    id: eintrag.competition.key,
    label: `Runde ${eintrag.competition.number}: ${eintrag.clip.title}`,
  }));
}
