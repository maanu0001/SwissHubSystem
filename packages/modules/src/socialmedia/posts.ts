import { prisma, type SocialPost, type SocialPostStatus } from '@swisshub/database';
import { conflict, normalisiereFarbe, notFound, sanitizeText, validationFailed } from '@swisshub/shared';
import { assertSafeFileName } from '../branding/storage';
import {
  POST_FELDER,
  postDesign,
  postTyp,
  typHatFeld,
  type PostFeld,
  type PostTypBeschreibung,
} from './vorlagen';

/**
 * Posts anlegen, lesen, speichern, ablegen (§42, §43).
 *
 * ## Warum die Pruefung hier steht und nicht im Formular
 *
 * Weil das Formular im Browser laeuft. Was dort geprueft wird, ist eine
 * Hilfe fuer den Benutzer; was hier geprueft wird, ist die Zusicherung fuer
 * alles, was danach kommt - die Zeichenquelle, der Export, die Bibliothek.
 *
 * ## Was `normalisiereInhalt` leistet
 *
 * Es ist die einzige Stelle, durch die Inhalt in die Datenbank kommt, und es
 * laesst nur durch, was es kennt:
 *
 * - Einen Schluessel, der nicht im Feldkatalog steht, oder einen, den der
 *   gewaehlte Typ nicht hat, gibt es danach nicht mehr. Ein Post traegt also
 *   keine Felder, die seine Vorlage nicht zeichnet - und beim Wechsel des Typs
 *   bleibt kein Rest aus dem alten liegen.
 * - Bilder sind **Dateinamen aus dem eigenen Upload-Verzeichnis**, geprueft
 *   mit derselben Funktion, die auch das Ausliefern prueft. Eine
 *   `blob:`-Adresse, eine `data:`-URI und eine fremde `https:`-Adresse fallen
 *   damit alle drei durch (§35): die erste existiert nur in dem Browser, der
 *   sie erzeugt hat, die zweite waere ein Megabyte Bild in einer JSON-Spalte,
 *   und die dritte waere ein Abruf, den jemand anderes bestimmt (§37).
 * - Farben gehen durch `normalisiereFarbe` und sind danach `#rrggbb` oder
 *   nicht vorhanden. Sie werden nicht bereinigt, sie werden umgewandelt.
 * - Text geht durch `sanitizeText` mit der Laengengrenze aus der Registry.
 * - Der Turnierbaum ist eine **Kennung**, nie eine Kopie der Paarungen (§45).
 *   Gelesen wird beim Zeichnen, aus dem Turnier selbst.
 */

// --- Der Inhalt eines Posts -------------------------------------------------

export interface Begegnung {
  a: string;
  b: string;
  /** Dateinamen im Upload-Verzeichnis - oder nichts. */
  logoA?: string;
  logoB?: string;
}

/** Eine Seite einer Begegnung im Turnierbaum. */
export interface BaumSeite {
  name: string;
  /** Punkte - oder nichts, wenn noch nicht gespielt wurde. */
  punkte?: number;
}

/** Eine Begegnung: zwei Seiten, und wer von beiden weiter ist. */
export interface BaumPaarung {
  a: BaumSeite;
  b: BaumSeite;
  /** `'a'`, `'b'` - oder nichts, solange nichts entschieden ist. */
  sieger?: 'a' | 'b';
}

/** Eine Runde: ein Name und ihre Begegnungen, in der gezeigten Reihenfolge. */
export interface BaumRunde {
  label: string;
  paarungen: BaumPaarung[];
}

/**
 * Der Turnierbaum eines Posts.
 *
 * Datengetrieben und ohne feste Teamzahl: vier, acht oder sechzehn Teams
 * sind einfach verschieden viele Paarungen in der ersten Runde. Es gibt hier
 * absichtlich keine Turnierlogik - kein Fortschreiben eines Siegers in die
 * naechste Runde, keine Pruefung auf Zweierpotenzen. Das ist ein Bild, kein
 * Wettbewerb; was darauf steht, bestimmt der Mensch, der es macht.
 */
export interface PostBaum {
  runden: BaumRunde[];
  /** Woher die Daten kamen - rein informativ, nie eine Leseanweisung. */
  tournamentId?: string;
}

export interface PostInhalt {
  titel?: string;
  untertitel?: string;
  text?: string;
  cta?: string;
  /** `jjjj-mm-tt`. Gezeichnet wird daraus Schweizer Schreibweise. */
  datum?: string;
  /** `hh:mm` in der Zone des Systems. */
  zeit?: string;
  ort?: string;
  link?: string;
  bild?: string;
  hintergrundbild?: string;
  logo?: string;
  akzentfarbe?: string;
  sponsoren?: string[];
  teams?: Begegnung;
  punkte?: { a: number; b: number };
  gewinner?: string;
  /** «1. Platz», «Sieger» - steht klein ueber dem Namen. */
  platzierung?: string;
  /**
   * Der Turnierbaum - als eigener Stand des Posts.
   *
   * ## Warum eine Kopie und nicht mehr nur eine Kennung
   *
   * Hier stand `{ tournamentId }`, und der Baum wurde beim Zeichnen aus dem
   * Turnier gelesen. Das klang sauber und war in der Praxis eine Sackgasse:
   * wer keinen Turniereintrag hatte, konnte den Typ gar nicht benutzen, und
   * wer einen hatte, konnte am Bild nichts aendern - kein Kuerzen eines
   * Teamnamens, keine Runde weglassen, kein Stand von gestern.
   *
   * Ein Post ist eine Aussage zu einem Zeitpunkt. Er traegt deshalb seinen
   * eigenen Stand. Was aus einem Turnier uebernommen wird, ist eine
   * **Startbefuellung**; danach gehoert sie dem Post, und ins Turnier
   * schreibt niemand zurueck.
   *
   * `tournamentId` bleibt daneben stehen - nur als Herkunftsvermerk, damit
   * man spaeter noch weiss, woher die Daten kamen.
   */
  bracket?: PostBaum;
  fusszeile?: string;
  branding?: boolean;
}

const MAX_SPONSOREN = 6;

/** Ein Dateiname aus unserem Upload-Verzeichnis - oder nichts. */
function bildname(wert: unknown): string | undefined {
  if (typeof wert !== 'string') {
    return undefined;
  }
  const sauber = wert.trim();
  if (sauber === '') {
    return undefined;
  }
  /*
   * Die eine Pruefung, und sie ist streng.
   *
   * `assertSafeFileName` wirft bei allem, was kein schlichter Dateiname mit
   * bekannter Endung ist. Damit faellt `blob:...` durch (Doppelpunkt),
   * `data:...` auch, jede Adresse ebenfalls, und `../` erst recht. Es gibt
   * hier bewusst keinen Reparaturversuch: ein Bild, das man zurechtbiegen
   * muesste, ist keines aus unserem Verzeichnis.
   */
  try {
    assertSafeFileName(sauber);
  } catch {
    throw validationFailed(
      { feld: 'bild' },
      'Bilder müssen zuerst hochgeladen werden - eine Adresse aus dem Browser lässt sich nicht speichern.',
    );
  }
  return sauber;
}

function text(wert: unknown, grenze: number): string | undefined {
  if (typeof wert !== 'string') {
    return undefined;
  }
  const sauber = sanitizeText(wert, grenze).trim();
  return sauber === '' ? undefined : sauber;
}

/**
 * Ein mehrzeiliges Feld - Zeilenumbrueche bleiben erhalten.
 *
 * ## Warum das eine eigene Funktion braucht
 *
 * `sanitizeText` faltet ohne `keepNewlines` jede Folge von Leerraum zu einem
 * Leerzeichen, Zeilenumbrueche eingeschlossen. Fuer eine Ueberschrift ist das
 * richtig. Fuer das Textfeld war es der Fehler: sein Hinweis sagt «Eine Zeile
 * je Punkt», die Zeichenquelle macht aus jeder Zeile einen Aufzaehlungspunkt -
 * und beim Speichern wurden alle Zeilen zu einer einzigen zusammengezogen.
 *
 * Zu sehen war das erst im fertigen Export, nicht im Editor: dort stand der
 * Text ja noch so da, wie er getippt wurde. Aufgefallen ist es beim Rendern
 * eines echten gespeicherten Posts.
 */
function mehrzeilig(wert: unknown, grenze: number): string | undefined {
  if (typeof wert !== 'string') {
    return undefined;
  }
  const sauber = sanitizeText(wert, grenze, { keepNewlines: true }).trim();
  return sauber === '' ? undefined : sauber;
}

/** `jjjj-mm-tt` oder nichts. Kein `Date`: ein Datum ohne Zeit ist keine Zeitangabe. */
function datum(wert: unknown): string | undefined {
  if (typeof wert !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(wert.trim())) {
    return undefined;
  }
  const sauber = wert.trim();
  // Ein Datum, das der Kalender nicht kennt (31.02.), faellt hier durch.
  const probe = new Date(`${sauber}T12:00:00Z`);
  return Number.isNaN(probe.getTime()) || !probe.toISOString().startsWith(sauber) ? undefined : sauber;
}

function zeit(wert: unknown): string | undefined {
  if (typeof wert !== 'string') {
    return undefined;
  }
  const treffer = /^(\d{1,2}):(\d{2})$/u.exec(wert.trim());
  if (!treffer) {
    return undefined;
  }
  const stunde = Number(treffer[1]);
  const minute = Number(treffer[2]);
  if (stunde > 23 || minute > 59) {
    return undefined;
  }
  return `${String(stunde).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * Ein Link - nur `https`, und nur als Text.
 *
 * Gezeichnet wird er als Zeichenkette auf einem Bild; ein Bild hat keine
 * anklickbaren Stellen. Geprueft wird er trotzdem (§36): was auf einem Post
 * steht, tippt jemand ab, und `javascript:` oder `http://` haben dort nichts
 * zu suchen.
 */
function link(wert: unknown): string | undefined {
  if (typeof wert !== 'string' || wert.trim() === '') {
    return undefined;
  }
  let adresse: URL;
  try {
    adresse = new URL(wert.trim());
  } catch {
    throw validationFailed({ feld: 'link' }, 'Der Link ist keine gültige Adresse.');
  }
  if (adresse.protocol !== 'https:') {
    throw validationFailed({ feld: 'link' }, 'Nur https-Links können auf einen Post.');
  }
  if (adresse.href.length > 200) {
    throw validationFailed({ feld: 'link' }, 'Der Link ist zu lang für ein Bild.');
  }
  return adresse.href;
}

function begegnung(wert: unknown): Begegnung | undefined {
  if (typeof wert !== 'object' || wert === null) {
    return undefined;
  }
  const roh = wert as Record<string, unknown>;
  const a = text(roh['a'], 40);
  const b = text(roh['b'], 40);
  if (a === undefined && b === undefined) {
    return undefined;
  }
  const logoA = bildname(roh['logoA']);
  const logoB = bildname(roh['logoB']);
  return {
    a: a ?? '',
    b: b ?? '',
    ...(logoA ? { logoA } : {}),
    ...(logoB ? { logoB } : {}),
  };
}

function punkte(wert: unknown): { a: number; b: number } | undefined {
  if (typeof wert !== 'object' || wert === null) {
    return undefined;
  }
  const roh = wert as Record<string, unknown>;
  const zahl = (eingabe: unknown): number | null => {
    const n = typeof eingabe === 'number' ? eingabe : Number.parseInt(String(eingabe ?? ''), 10);
    return Number.isInteger(n) && n >= 0 && n <= 999 ? n : null;
  };
  const a = zahl(roh['a']);
  const b = zahl(roh['b']);
  return a === null || b === null ? undefined : { a, b };
}

/** Grenzen fuer den Baum - gross genug fuer 16 Teams, klein genug fuers Bild. */
export const MAX_BAUM_RUNDEN = 6;
export const MAX_BAUM_PAARUNGEN = 16;

/**
 * Der Turnierbaum, gereinigt.
 *
 * Reine Funktion, kein Datenbankzugriff: ein Baum ist Text und Zahlen, und
 * genau so laesst er sich pruefen.
 *
 * Eine Runde ohne Paarung faellt weg, eine Paarung ohne beide Namen faellt
 * weg, ein Baum ohne Runde ist `undefined`. Das ist kein Streichen von
 * Eingaben, sondern die Abgrenzung von «leer» und «nicht gesetzt»: ein Baum
 * mit drei leeren Klammern sieht im Export aus wie ein Fehler.
 */
function baum(wert: unknown): PostBaum | undefined {
  if (typeof wert !== 'object' || wert === null) {
    return undefined;
  }
  const roh = wert as Record<string, unknown>;
  const rohRunden = Array.isArray(roh['runden']) ? roh['runden'] : [];

  const seite = (eingabe: unknown): BaumSeite => {
    const quelle = (typeof eingabe === 'object' && eingabe !== null ? eingabe : {}) as Record<
      string,
      unknown
    >;
    const name = text(quelle['name'], 40) ?? '';
    const roheZahl = quelle['punkte'];
    const zahl = typeof roheZahl === 'number' ? roheZahl : Number.parseInt(String(roheZahl ?? ''), 10);
    const punkte = Number.isInteger(zahl) && zahl >= 0 && zahl <= 999 ? zahl : undefined;
    return { name, ...(punkte === undefined ? {} : { punkte }) };
  };

  const runden: BaumRunde[] = [];
  for (const roheRunde of rohRunden.slice(0, MAX_BAUM_RUNDEN)) {
    const quelle = (typeof roheRunde === 'object' && roheRunde !== null ? roheRunde : {}) as Record<
      string,
      unknown
    >;
    const rohePaarungen = Array.isArray(quelle['paarungen']) ? quelle['paarungen'] : [];
    const paarungen: BaumPaarung[] = [];
    for (const rohePaarung of rohePaarungen.slice(0, MAX_BAUM_PAARUNGEN)) {
      const pQuelle = (typeof rohePaarung === 'object' && rohePaarung !== null ? rohePaarung : {}) as Record<
        string,
        unknown
      >;
      const a = seite(pQuelle['a']);
      const b = seite(pQuelle['b']);
      if (a.name === '' && b.name === '') {
        continue;
      }
      const roherSieger = pQuelle['sieger'];
      const sieger = roherSieger === 'a' || roherSieger === 'b' ? roherSieger : undefined;
      paarungen.push({ a, b, ...(sieger ? { sieger } : {}) });
    }
    if (paarungen.length === 0) {
      continue;
    }
    runden.push({ label: text(quelle['label'], 30) ?? `Runde ${runden.length + 1}`, paarungen });
  }

  if (runden.length === 0) {
    return undefined;
  }
  const herkunft = text(roh['tournamentId'], 40);
  return { runden, ...(herkunft ? { tournamentId: herkunft } : {}) };
}

/**
 * Der Inhalt, gereinigt und auf die Felder des Typs beschnitten.
 *
 * Reine Funktion - kein Datenbankzugriff, kein Dateizugriff. Deshalb laesst
 * sie sich pruefen, ohne eine Umgebung aufzubauen, und genau das tun die
 * Tests.
 */
export function normalisiereInhalt(typId: string, roh: unknown): PostInhalt {
  const typ = postTyp(typId);
  if (!typ) {
    throw validationFailed({ feld: 'postType' }, 'Diesen Post-Typ gibt es nicht.');
  }
  const quelle = (typeof roh === 'object' && roh !== null ? roh : {}) as Record<string, unknown>;
  const ergebnis: PostInhalt = {};

  const erlaubt = (feld: PostFeld): boolean => typ.felder.includes(feld);

  if (erlaubt('titel')) ergebnis.titel = text(quelle['titel'], 90);
  if (erlaubt('untertitel')) ergebnis.untertitel = text(quelle['untertitel'], 90);
  if (erlaubt('text')) ergebnis.text = mehrzeilig(quelle['text'], 420);
  if (erlaubt('cta')) ergebnis.cta = text(quelle['cta'], 48);
  if (erlaubt('datum')) ergebnis.datum = datum(quelle['datum']);
  if (erlaubt('zeit')) ergebnis.zeit = zeit(quelle['zeit']);
  if (erlaubt('ort')) ergebnis.ort = text(quelle['ort'], 60);
  if (erlaubt('link')) ergebnis.link = link(quelle['link']);
  if (erlaubt('bild')) ergebnis.bild = bildname(quelle['bild']);
  if (erlaubt('hintergrundbild')) ergebnis.hintergrundbild = bildname(quelle['hintergrundbild']);
  if (erlaubt('logo')) ergebnis.logo = bildname(quelle['logo']);
  if (erlaubt('akzentfarbe')) {
    ergebnis.akzentfarbe =
      normalisiereFarbe(typeof quelle['akzentfarbe'] === 'string' ? quelle['akzentfarbe'] : null) ??
      undefined;
  }
  if (erlaubt('sponsoren')) {
    const liste = Array.isArray(quelle['sponsoren']) ? quelle['sponsoren'] : [];
    const namen = liste
      .map((eintrag) => bildname(eintrag))
      .filter((eintrag): eintrag is string => eintrag !== undefined)
      .slice(0, MAX_SPONSOREN);
    ergebnis.sponsoren = namen.length > 0 ? namen : undefined;
  }
  if (erlaubt('teams')) ergebnis.teams = begegnung(quelle['teams']);
  if (erlaubt('punkte')) ergebnis.punkte = punkte(quelle['punkte']);
  if (erlaubt('gewinner')) ergebnis.gewinner = text(quelle['gewinner'], 60);
  if (erlaubt('platzierung')) ergebnis.platzierung = text(quelle['platzierung'], 40);
  if (erlaubt('bracket')) ergebnis.bracket = baum(quelle['bracket']);
  if (erlaubt('fusszeile')) ergebnis.fusszeile = text(quelle['fusszeile'], 80);
  if (erlaubt('branding')) {
    ergebnis.branding = quelle['branding'] === undefined ? true : quelle['branding'] !== false;
  }

  /*
   * Die `undefined` wieder heraus.
   *
   * `JSON.stringify` laesst sie fallen, Prisma aber speichert sie als `null` -
   * und dann steht in der Spalte `{"cta": null}` statt `{}`. Das ist kein
   * Schaden, aber es macht die Spalte mit jedem Speichern laenger und beim
   * Lesen muss jede Stelle zwei leere Faelle unterscheiden.
   */
  for (const schluessel of Object.keys(ergebnis) as Array<keyof PostInhalt>) {
    if (ergebnis[schluessel] === undefined) {
      delete ergebnis[schluessel];
    }
  }
  return ergebnis;
}

/** Der Inhalt einer Zeile - gelesen, nicht geraten. */
export function leseInhalt(post: Pick<SocialPost, 'postType' | 'renderConfig'>): PostInhalt {
  return normalisiereInhalt(post.postType, post.renderConfig);
}

/**
 * Fehlt etwas, um den Post «fertig» zu nennen?
 *
 * Die Antwort ist eine Liste von Feldbeschriftungen, keine Wahrheit - der
 * Editor zeigt sie an, und der Status `READY` setzt sie voraus. Ein Entwurf
 * darf unvollstaendig sein; das ist der Sinn eines Entwurfs.
 */
export function fehlendeFelder(typ: PostTypBeschreibung, inhalt: PostInhalt): PostFeld[] {
  return typ.pflicht.filter((feld) => {
    const wert = inhalt[feld as keyof PostInhalt];
    if (wert === undefined || wert === null) {
      return true;
    }
    if (feld === 'teams') {
      const paar = wert as Begegnung;
      return paar.a.trim() === '' || paar.b.trim() === '';
    }
    return typeof wert === 'string' ? wert.trim() === '' : false;
  });
}

// --- Lesen ------------------------------------------------------------------

export interface PostFilter {
  guildId: string;
  status?: SocialPostStatus | 'ALLE';
  postType?: string;
  /** Titelsuche - Teiltreffer, ohne Gross-/Kleinschreibung (§42). */
  suche?: string;
  limit?: number;
}

export async function ladePosts(filter: PostFilter): Promise<SocialPost[]> {
  const suche = filter.suche?.trim() ?? '';
  return prisma.socialPost.findMany({
    where: {
      guildId: filter.guildId,
      ...(filter.status && filter.status !== 'ALLE' ? { status: filter.status } : {}),
      ...(filter.postType ? { postType: filter.postType } : {}),
      ...(suche === '' ? {} : { title: { contains: suche, mode: 'insensitive' as const } }),
    },
    orderBy: { updatedAt: 'desc' },
    take: Math.min(filter.limit ?? 60, 200),
  });
}

export async function ladePost(postId: string, guildId: string): Promise<SocialPost | null> {
  const post = await prisma.socialPost.findUnique({ where: { id: postId } });
  // Die Gilde gehoert in die Pruefung und nicht in die Abfrage per `findFirst`:
  // so ist der Grund fuer «nicht gefunden» im Code sichtbar.
  return post && post.guildId === guildId ? post : null;
}

export async function zaehlePosts(guildId: string): Promise<Record<SocialPostStatus, number>> {
  const zeilen = await prisma.socialPost.groupBy({
    by: ['status'],
    where: { guildId },
    _count: { _all: true },
  });
  const summe: Record<SocialPostStatus, number> = { DRAFT: 0, READY: 0, ARCHIVED: 0 };
  for (const zeile of zeilen) {
    summe[zeile.status] = zeile._count._all;
  }
  return summe;
}

// --- Schreiben --------------------------------------------------------------

export interface PostAutor {
  userId: string;
  discordId: string;
  username: string;
}

export async function erstellePost(args: {
  guildId: string;
  title: string;
  postType: string;
  design: string;
  inhalt: unknown;
  autor: PostAutor;
}): Promise<SocialPost> {
  const typ = postTyp(args.postType);
  if (!typ) {
    throw validationFailed({ feld: 'postType' }, 'Diesen Post-Typ gibt es nicht.');
  }
  const titel = sanitizeText(args.title, 120).trim();
  if (titel === '') {
    throw validationFailed({ feld: 'title' }, 'Bitte einen Arbeitstitel angeben.');
  }

  return prisma.socialPost.create({
    data: {
      guildId: args.guildId,
      title: titel,
      postType: typ.id,
      design: postDesign(typ.id, args.design),
      renderConfig: normalisiereInhalt(typ.id, args.inhalt) as object,
      status: 'DRAFT',
      createdById: args.autor.userId,
      createdByDiscordId: args.autor.discordId,
      createdByUsername: args.autor.username,
      updatedByUsername: args.autor.username,
    },
  });
}

export async function speicherePost(args: {
  postId: string;
  guildId: string;
  title: string;
  postType: string;
  design: string;
  inhalt: unknown;
  status?: SocialPostStatus;
  autorUsername: string;
}): Promise<SocialPost> {
  const vorhanden = await ladePost(args.postId, args.guildId);
  if (!vorhanden) {
    throw notFound('socialPost', 'Diesen Post gibt es nicht mehr.');
  }
  if (vorhanden.status === 'ARCHIVED') {
    throw conflict('Dieser Post ist abgelegt. Hole ihn zurück, um ihn zu bearbeiten.');
  }

  const typ = postTyp(args.postType);
  if (!typ) {
    throw validationFailed({ feld: 'postType' }, 'Diesen Post-Typ gibt es nicht.');
  }
  const titel = sanitizeText(args.title, 120).trim();
  if (titel === '') {
    throw validationFailed({ feld: 'title' }, 'Bitte einen Arbeitstitel angeben.');
  }

  const inhalt = normalisiereInhalt(typ.id, args.inhalt);

  /*
   * «Fertig» verlangt Vollstaendigkeit, «Entwurf» nicht.
   *
   * Sonst waere der Status eine Behauptung: ein Post ohne Ueberschrift, der
   * «bereit zum Posten» heisst, ist genau der, den jemand ungeprueft
   * exportiert.
   */
  const status = args.status ?? vorhanden.status;
  if (status === 'READY') {
    const fehlt = fehlendeFelder(typ, inhalt);
    if (fehlt.length > 0) {
      throw conflict(
        `Zum Posten fehlt noch: ${fehlt.join(', ')}. Als Entwurf lässt sich der Post trotzdem speichern.`,
      );
    }
  }

  return prisma.socialPost.update({
    where: { id: vorhanden.id },
    data: {
      title: titel,
      postType: typ.id,
      design: postDesign(typ.id, args.design),
      renderConfig: inhalt as object,
      status,
      updatedByUsername: args.autorUsername,
    },
  });
}

/**
 * Einen Post verdoppeln (§42).
 *
 * Der neue ist immer ein Entwurf, auch wenn das Original fertig war: eine
 * Kopie, die «bereit zum Posten» heisst, waere ein zweiter fertiger Post mit
 * demselben Inhalt - und der wird versehentlich gepostet.
 */
export async function verdopplePost(postId: string, guildId: string, autor: PostAutor): Promise<SocialPost> {
  const vorlage = await ladePost(postId, guildId);
  if (!vorlage) {
    throw notFound('socialPost', 'Diesen Post gibt es nicht mehr.');
  }
  return prisma.socialPost.create({
    data: {
      guildId,
      title: sanitizeText(`${vorlage.title} (Kopie)`, 120),
      postType: vorlage.postType,
      design: vorlage.design,
      renderConfig: vorlage.renderConfig as object,
      status: 'DRAFT',
      createdById: autor.userId,
      createdByDiscordId: autor.discordId,
      createdByUsername: autor.username,
      updatedByUsername: autor.username,
    },
  });
}

/** Ablegen und zurueckholen - dasselbe Feld, zwei Richtungen. */
export async function setzeArchiv(
  postId: string,
  guildId: string,
  archiviert: boolean,
  autorUsername: string,
): Promise<SocialPost> {
  const vorhanden = await ladePost(postId, guildId);
  if (!vorhanden) {
    throw notFound('socialPost', 'Diesen Post gibt es nicht mehr.');
  }
  return prisma.socialPost.update({
    where: { id: vorhanden.id },
    data: {
      status: archiviert ? 'ARCHIVED' : 'DRAFT',
      archivedAt: archiviert ? new Date() : null,
      updatedByUsername: autorUsername,
    },
  });
}

export async function loeschePost(postId: string, guildId: string): Promise<SocialPost> {
  const vorhanden = await ladePost(postId, guildId);
  if (!vorhanden) {
    throw notFound('socialPost', 'Diesen Post gibt es nicht mehr.');
  }
  /*
   * Die hochgeladenen Bilder bleiben liegen.
   *
   * Absichtlich: dasselbe Bild kann in einer Kopie stecken, und eine Datei zu
   * loeschen, auf die noch etwas zeigt, macht aus einem Post ein Bild mit
   * Loch. Aufraeumen ist eine eigene Aufgabe mit einer eigenen Zaehlung - sie
   * gehoert nicht an das Loeschen eines einzelnen Posts.
   */
  return prisma.socialPost.delete({ where: { id: vorhanden.id } });
}

export const ALLE_FELDER: readonly PostFeld[] = POST_FELDER;
export { typHatFeld };
