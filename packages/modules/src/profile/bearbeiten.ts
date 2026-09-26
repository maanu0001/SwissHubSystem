import { AUDIT_ACTIONS, prisma, safeRecordAudit, type Prisma } from '@swisshub/database';
import { AppError } from '@swisshub/shared';
import { CONTENT_TYPE, deleteUpload, readUpload, storeLogoUpload } from '../branding/storage';
import { getGame } from '../games/katalog';
import { SHOWCASE_PLAETZE, showcaseArt } from './showcase';
import {
  spielSchema,
  type AllgemeinEingabe,
  type GestaltungEingabe,
  type PrivatsphaereEingabe,
  type ShowcaseEingabe,
  type SocialsEingabe,
} from './schemas';
import { profilTheme, themeFreigeschaltet } from './profil-themes';
import { themeVoraussetzungen } from './theme-zugang';
import { SPIELFELDER_VERSION } from './spielfelder';
import { findeFreienSlug, slugVorschlag } from './slug';

/**
 * Das eigene Profil aendern.
 *
 * ## Warum keine dieser Funktionen eine fremde Kennung annimmt
 *
 * Jede nimmt genau eine `discordId` - die des Eigentuemers - und aendert
 * ausschliesslich dessen Zeilen. Es gibt hier keinen Parameter «wessen
 * Profil», der sich vertauschen liesse, und keine Verzweigung «ausser der
 * Aufrufer ist Administrator». Damit ist «ein Mitglied darf nur sein eigenes
 * Profil bearbeiten» keine Pruefung, die man vergessen kann, sondern die
 * Form der Schnittstelle.
 *
 * Die Server Actions reichen dafuer `ctx.user.discordId` herein - den Wert
 * aus der Sitzung, nie einen aus der Eingabe. Ein manipuliertes Request
 * kann daher nichts erreichen, was die Oberflaeche nicht auch koennte.
 *
 * ## Warum die Zeile erst beim Speichern entsteht
 *
 * Ein Profil anzusehen schreibt nichts. Wer nie etwas eintraegt, hat keine
 * Zeile - und bei mehreren tausend Mitgliedern ist das der Unterschied
 * zwischen einer Tabelle mit ein paar hundert gepflegten Profilen und einer
 * mit tausenden leeren.
 */

/** Die Profilzeile - angelegt, falls es noch keine gibt. */
async function zeile(discordId: string): Promise<{ id: string }> {
  return prisma.memberProfile.upsert({
    where: { discordId },
    create: { discordId },
    update: {},
    select: { id: true },
  });
}

export async function speichereAllgemein(discordId: string, eingabe: AllgemeinEingabe): Promise<void> {
  await prisma.memberProfile.upsert({
    where: { discordId },
    create: { discordId, ...eingabe },
    update: eingabe,
  });
}

/**
 * Gestaltung speichern - samt Premium-Pruefung.
 *
 * ## Warum die Pruefung hier steht und nicht nur in der Aktion
 *
 * Weil sie sonst an der Oberflaeche haengt. Die Server Action prueft
 * ebenfalls - aber dieser Dienst hat mehr als einen Aufrufer, und jeder
 * von ihnen darf sich darauf verlassen, dass ein Premium-Theme ohne
 * Abonnement hier nicht durchkommt. Ein Schema kann das nicht leisten: es
 * kennt Schluessel, keine Abonnements.
 *
 * Abgewiesen wird nur der **Wechsel** auf ein Premium-Theme. Wer eines
 * gespeichert hat und sein Abonnement verliert, darf weiterhin speichern -
 * seine Wahl bleibt stehen und wirkt einfach nicht mehr. Das ist die
 * Gegenseite von `wirksamesTheme`: nichts wird geloescht, nur nichts
 * angezeigt.
 */
export async function speichereGestaltung(discordId: string, eingabe: GestaltungEingabe): Promise<void> {
  const gewaehlt = profilTheme(eingabe.premiumTheme);

  const vorher = await prisma.memberProfile.findUnique({
    where: { discordId },
    select: { premiumTheme: true },
  });

  /*
   * Geprueft wird nur bei einer AENDERUNG auf ein forderndes Design.
   *
   * Wer sein Design behaelt, soll nicht bei jedem Speichern eines
   * Spielenamens erneut geprueft werden. Und wer die Voraussetzung verloren
   * hat, behaelt die gespeicherte Wahl - sie wirkt nur nicht mehr, und das
   * entscheidet `wirksamesTheme` beim Zeichnen.
   */
  const fordertEtwas = gewaehlt.premium || gewaehlt.mindestLevel !== null;
  if (fordertEtwas && vorher?.premiumTheme !== eingabe.premiumTheme) {
    const mitbringen = await themeVoraussetzungen(discordId);
    if (!themeFreigeschaltet(gewaehlt, mitbringen)) {
      /*
       * Die Meldung nennt den Grund, der wirklich vorliegt.
       *
       * «Es laesst sich mit einem aktiven Premium auswaehlen» waere beim
       * Prestige-Design eine Falschauskunft - es laesst sich damit gerade
       * NICHT auswaehlen. Wer auf Level 12 steht, soll erfahren, dass 31
       * fehlen, und nicht nach einem Abonnement suchen, das nichts aendert.
       */
      const grund =
        gewaehlt.mindestLevel !== null && mitbringen.level < gewaehlt.mindestLevel
          ? `«${gewaehlt.label}» wird ab Level ${gewaehlt.mindestLevel} freigeschaltet. Du bist auf Level ${mitbringen.level} - das lässt sich nicht kaufen, nur erspielen.`
          : `«${gewaehlt.label}» ist ein Premium-Design. Es lässt sich mit einem aktiven SwissHub Premium auswählen.`;
      throw new AppError('FORBIDDEN', {
        userMessage: grund,
        internalMessage: `Profil-Theme ${gewaehlt.id} abgelehnt: premium=${mitbringen.hatPremium}, level=${mitbringen.level}, mindestLevel=${gewaehlt.mindestLevel ?? '-'}`,
      });
    }
  }

  await prisma.memberProfile.upsert({
    where: { discordId },
    create: { discordId, ...eingabe },
    update: eingabe,
  });

  /*
   * Nur der Wechsel des Themes wird protokolliert, nicht jede
   * Farbaenderung. Ein Protokoll, in dem jede Akzentwahl steht, ist eines,
   * in dem man nichts mehr findet.
   */
  if ((vorher?.premiumTheme ?? null) !== (eingabe.premiumTheme ?? null)) {
    await safeRecordAudit({
      action: AUDIT_ACTIONS.PROFILE_THEME_CHANGED,
      module: 'members',
      actorDiscordId: discordId,
      targetDiscordId: discordId,
      targetLabel: gewaehlt.label,
      success: true,
      metadata: { vorher: vorher?.premiumTheme ?? null, nachher: eingabe.premiumTheme ?? null },
    });
  }
}

/**
 * Die Sichtbarkeit speichern - und beim ersten Mal die oeffentliche Adresse
 * vergeben.
 *
 * Der Slug entsteht hier und nicht in einer Migration: erst wenn jemand
 * sein Profil oeffentlich stellt, ist klar, dass er eine oeffentliche
 * Adresse will. Ein in der Migration geratener Slug waere eine Adresse, die
 * niemand gewaehlt hat - fuer Profile, die gar nicht oeffentlich sind.
 *
 * Einmal vergeben, bleibt er stehen. Auch wenn jemand sein Profil wieder
 * auf «Mitglieder» stellt und spaeter zurueck: ein Link, den er in der
 * Zwischenzeit verteilt hat, soll danach wieder auf ihn zeigen und nicht
 * auf jemanden, der sich den frei gewordenen Slug genommen hat.
 */
export async function speicherePrivatsphaere(
  discordId: string,
  eingabe: PrivatsphaereEingabe,
): Promise<void> {
  const wirdOeffentlich = eingabe.visibilityProfile === 'PUBLIC';

  const vorhanden = await prisma.memberProfile.findUnique({
    where: { discordId },
    select: { publicSlug: true },
  });

  let slug: string | null = vorhanden?.publicSlug ?? null;
  if (wirdOeffentlich && !slug) {
    slug = await vergebeSlug(discordId);
  }

  const daten = { ...eingabe, ...(slug && !vorhanden?.publicSlug ? { publicSlug: slug } : {}) };

  await prisma.memberProfile.upsert({
    where: { discordId },
    create: { discordId, ...daten },
    update: daten,
  });
}

/**
 * Eine freie oeffentliche Adresse finden.
 *
 * Ausgangspunkt ist der selbst gewaehlte Profilname, sonst der
 * Discord-Name. Taugt keiner von beiden - ein Name aus lauter Zeichen, die
 * keine Adresse ergeben -, steht am Ende `mitglied-<zufall>`: keine schoene
 * Adresse, aber eine, und besser als ein Profil, das sich nicht oeffentlich
 * stellen laesst, weil der Name aus Emoji besteht.
 */
async function vergebeSlug(discordId: string): Promise<string | null> {
  const [zeile, spiegel] = await Promise.all([
    prisma.memberProfile.findUnique({ where: { discordId }, select: { displayName: true } }),
    prisma.discordMemberCache.findUnique({ where: { discordId }, select: { displayName: true } }),
  ]);

  const istFrei = async (kandidat: string): Promise<boolean> =>
    (await prisma.memberProfile.count({ where: { publicSlug: kandidat } })) === 0;

  for (const name of [zeile?.displayName, spiegel?.displayName]) {
    const vorschlag = name ? slugVorschlag(name) : null;
    if (vorschlag) {
      const frei = await findeFreienSlug(vorschlag, istFrei);
      if (frei) {
        return frei;
      }
    }
  }

  // Der Rueckfall. `slice(-6)` der Kennung waere vorhersagbar und liesse
  // sich durchprobieren - Zufall nicht.
  for (let versuch = 0; versuch < 5; versuch += 1) {
    const kandidat = `mitglied-${Math.random().toString(36).slice(2, 8)}`;
    if (await istFrei(kandidat)) {
      return kandidat;
    }
  }
  return null;
}

/**
 * Die Kontenliste ersetzen.
 *
 * Ersetzen und nicht zusammenfuehren: der Editor zeigt die ganze Liste, und
 * was dort geloescht wurde, soll geloescht sein. `verified` kommt in der
 * Eingabe nicht vor und wird hier auch nicht gesetzt - eine selbst
 * eingetragene Kennung ist keine geprüfte Verknuepfung.
 */
export async function speichereSocials(discordId: string, eingabe: SocialsEingabe): Promise<void> {
  const { id } = await zeile(discordId);

  await prisma.$transaction([
    prisma.memberSocialLink.deleteMany({
      where: { profileId: id, platform: { notIn: eingabe.eintraege.map((e) => e.platform) } },
    }),
    ...eingabe.eintraege.map((eintrag, index) =>
      prisma.memberSocialLink.upsert({
        where: { profileId_platform: { profileId: id, platform: eintrag.platform } },
        create: { profileId: id, platform: eintrag.platform, handle: eintrag.handle, sortOrder: index },
        update: { handle: eintrag.handle, sortOrder: index },
      }),
    ),
  ]);
}

/**
 * Ein Spiel ins Profil legen oder aendern.
 *
 * Die spielabhaengigen Felder werden gegen die Registry geprueft - `strict`,
 * also faellt ein unbekanntes Feld durch, statt still gespeichert zu werden.
 * Geprueft wird gegen den Namen des Spiels aus dem zentralen Katalog; einen
 * zweiten Katalog gibt es nicht.
 */
export async function speichereSpiel(
  discordId: string,
  eingabe: {
    gameId: string;
    platform?: string | null;
    note?: string | null;
    favorite?: boolean;
    fields?: unknown;
  },
): Promise<void> {
  const spiel = await getGame(eingabe.gameId);
  if (!spiel || spiel.archivedAt !== null) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Dieses Spiel steht nicht (mehr) zur Auswahl.',
      internalMessage: `Spiel ${eingabe.gameId} fehlt oder ist archiviert`,
    });
  }

  const geprueft = spielSchema(spiel.name).parse({
    gameId: eingabe.gameId,
    platform: eingabe.platform ?? null,
    note: eingabe.note ?? null,
    favorite: eingabe.favorite ?? false,
    fields: eingabe.fields ?? {},
  });

  const { id } = await zeile(discordId);

  // Neue Spiele hinten anstellen - `sortOrder` zaehlt weiter, statt bei 0 zu
  // beginnen und zwei Eintraege auf denselben Platz zu setzen.
  const letzte = await prisma.memberGameProfile.findFirst({
    where: { profileId: id },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  });

  await prisma.memberGameProfile.upsert({
    where: { profileId_gameId: { profileId: id, gameId: geprueft.gameId } },
    create: {
      profileId: id,
      gameId: geprueft.gameId,
      platform: geprueft.platform,
      note: geprueft.note,
      favorite: geprueft.favorite,
      fields: geprueft.fields as Prisma.InputJsonObject,
      fieldsVersion: SPIELFELDER_VERSION,
      sortOrder: (letzte?.sortOrder ?? -1) + 1,
    },
    update: {
      platform: geprueft.platform,
      note: geprueft.note,
      favorite: geprueft.favorite,
      fields: geprueft.fields as Prisma.InputJsonObject,
      fieldsVersion: SPIELFELDER_VERSION,
    },
  });
}

export async function entferneSpiel(discordId: string, gameId: string): Promise<void> {
  const profil = await prisma.memberProfile.findUnique({ where: { discordId }, select: { id: true } });
  if (!profil) {
    return;
  }
  // `deleteMany` statt `delete`: ohne Treffer ist das ein No-op statt einer
  // Ausnahme. Zweimal auf «entfernen» zu klicken ist kein Fehler.
  await prisma.memberGameProfile.deleteMany({ where: { profileId: profil.id, gameId } });
}

/** Die Reihenfolge der Spiele - so, wie sie gezogen wurde. */
export async function ordneSpiele(discordId: string, gameIds: readonly string[]): Promise<void> {
  const profil = await prisma.memberProfile.findUnique({ where: { discordId }, select: { id: true } });
  if (!profil) {
    return;
  }
  await prisma.$transaction(
    gameIds.map((gameId, index) =>
      // `updateMany` mit der Profilkennung in der Bedingung: eine fremde
      // Spielkennung trifft dann schlicht keine Zeile, statt eine fremde zu
      // veraendern.
      prisma.memberGameProfile.updateMany({
        where: { profileId: profil.id, gameId },
        data: { sortOrder: index },
      }),
    ),
  );
}

/**
 * Die Vitrine speichern.
 *
 * Geprueft wird beim Speichern, ob der Verweis heute auf etwas zeigt - wer
 * ein Turnier auswaehlt, an dem er nie teilgenommen hat, bekommt eine
 * Meldung. Ob er spaeter noch zeigt, prueft die Anzeige, und die
 * ueberspringt ihn dann still (siehe `service.ts`).
 */
export async function speichereShowcase(discordId: string, eingabe: ShowcaseEingabe): Promise<void> {
  const { id } = await zeile(discordId);

  for (const platz of eingabe.plaetze) {
    const art = showcaseArt(platz.kind);
    if (art?.brauchtVerweis && !(await verweisGueltig(discordId, id, platz.kind, platz.refId))) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: 'Diese Auswahl gehört nicht zu deinem Profil.',
        internalMessage: `Vitrinen-Verweis ${platz.kind}:${platz.refId} nicht belegbar`,
      });
    }
  }

  await prisma.$transaction([
    prisma.memberShowcase.deleteMany({
      where: { profileId: id, slot: { notIn: eingabe.plaetze.map((p) => p.slot) } },
    }),
    ...eingabe.plaetze.map((platz) =>
      prisma.memberShowcase.upsert({
        where: { profileId_slot: { profileId: id, slot: platz.slot } },
        create: { profileId: id, slot: platz.slot, kind: platz.kind, refId: platz.refId },
        update: { kind: platz.kind, refId: platz.refId },
      }),
    ),
  ]);
}

/**
 * Gehoert dieser Verweis zu dieser Person?
 *
 * Die Frage ist nicht «gibt es das», sondern «hat diese Person das». Sonst
 * koennte jemand einen fremden Turniersieg in die eigene Vitrine stellen.
 */
async function verweisGueltig(
  discordId: string,
  profileId: string,
  kind: string,
  refId: string | null,
): Promise<boolean> {
  if (!refId) {
    return false;
  }

  switch (kind) {
    case 'game':
      return (await prisma.memberGameProfile.count({ where: { profileId, gameId: refId } })) > 0;
    case 'social':
      return (await prisma.memberSocialLink.count({ where: { profileId, platform: refId } })) > 0;
    case 'tournament': {
      const { getMemberHistory } = await import('../tournaments/queries');
      const verlauf = await getMemberHistory(discordId);
      return verlauf.teilnahmen.some((eintrag) => eintrag.tournament.id === refId);
    }
    case 'achievement': {
      const { auszeichnungsArt } = await import('./auszeichnungen');
      // Ob sie erreicht ist, entscheidet die Anzeige - sie faellt sonst
      // still weg. Hier genuegt, dass es die Auszeichnung gibt.
      return auszeichnungsArt(refId) !== undefined;
    }
    case 'clip': {
      const treffer = await prisma.clipCompetitionEntry.count({
        where: {
          submittedByDiscordId: discordId,
          finalRank: 1,
          competition: { key: refId, status: 'COMPLETED' },
        },
      });
      return treffer > 0;
    }
    case 'event':
      return (
        (await prisma.calendarRegistration.count({
          where: { discordId, eventId: refId, status: 'CONFIRMED' },
        })) > 0
      );
    default:
      return false;
  }
}

/** Hoechstens 4 MB und mindestens Bannergroesse - ein 40x40-Bild ist kein Banner. */
const BANNER_GRENZEN = { maxBytes: 4 * 1024 * 1024, minSize: 400, maxSize: 4000 };

export async function speichereBanner(
  discordId: string,
  daten: Uint8Array,
  mimeType: string | null,
): Promise<void> {
  const gespeichert = await storeLogoUpload(daten, mimeType, 'profilbanner', BANNER_GRENZEN);

  const vorher = await prisma.memberProfile.findUnique({
    where: { discordId },
    select: { bannerPath: true },
  });

  await prisma.memberProfile.upsert({
    where: { discordId },
    create: { discordId, bannerPath: gespeichert.fileName },
    update: { bannerPath: gespeichert.fileName },
  });

  // Erst nach dem erfolgreichen Schreiben: bricht der Upsert ab, zeigt die
  // Zeile weiterhin auf eine Datei, die es noch gibt.
  if (vorher?.bannerPath) {
    await deleteUpload(vorher.bannerPath).catch(() => undefined);
  }
}

export async function entferneBanner(discordId: string): Promise<void> {
  const vorher = await prisma.memberProfile.findUnique({
    where: { discordId },
    select: { bannerPath: true },
  });
  if (!vorher?.bannerPath) {
    return;
  }
  await prisma.memberProfile.update({ where: { discordId }, data: { bannerPath: null } });
  await deleteUpload(vorher.bannerPath).catch(() => undefined);
}

/**
 * Das Banner ausliefern.
 *
 * Ueber eine Route und nicht als Datei im statisch bedienten Bereich: der
 * Content-Type wird dort fest gesetzt, damit ein Upload nie als HTML oder
 * Skript ankommt. Zeigt der Eintrag ins Leere - etwa nach einem neuen
 * Upload-Volume -, faellt die Ansicht auf die Bannervorlage zurueck, statt
 * ein kaputtes Bild zu zeigen.
 */
export async function leseBanner(discordId: string): Promise<{ data: Buffer; contentType: string } | null> {
  const profil = await prisma.memberProfile.findUnique({
    where: { discordId },
    select: { bannerPath: true },
  });
  if (!profil?.bannerPath) {
    return null;
  }
  const datei = await readUpload(profil.bannerPath);
  return datei ? { data: datei.data, contentType: CONTENT_TYPE[datei.format] } : null;
}

export const MAX_BANNER_BYTES = BANNER_GRENZEN.maxBytes;

export { SHOWCASE_PLAETZE };
