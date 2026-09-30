import { prisma } from '@swisshub/database';
import { AppError } from '@swisshub/shared';
import { erkenneClip, einbettung, type ErkannterClip } from '../clips/provider';

/**
 * Die Vitrine eines freigegebenen Streamers.
 *
 * ## Was sie ist
 *
 * Bis zu drei eigene Clips und eine hervorgehobene Zeile, beides auf dem
 * **einen** oeffentlichen Profil unter `/u/<slug>`. Sie ist das, was jemand
 * sieht, der einem geteilten Link folgt und nicht gerade zufaellig im Moment
 * eines laufenden Streams vorbeikommt: ein Kanal ist die meiste Zeit offline,
 * und eine Seite, die dann nur «derzeit nicht live» sagt, verkauft niemanden.
 *
 * ## Nur fuer freigegebene Streamer
 *
 * `status: 'APPROVED'`, geprueft bei jedem Schreiben und bei jedem Lesen. Eine
 * offene Bewerbung hat noch keine oeffentliche Seite; eine pausierte hat keine
 * mehr. Dass die Pruefung an beiden Enden steht, ist Absicht - wer freigegeben
 * war, seine Vitrine gefuellt hat und dann pausiert wird, soll sie nicht
 * weiter zeigen.
 *
 * ## Die Clips: geteilte Logik, eigene Tabelle
 *
 * Erkennen, Hostliste, Normalisieren und die Einbettungsadresse kommen aus
 * `clips/provider.ts` - **dieselben** Funktionen wie bei Clip of the Week,
 * dieselbe Whitelist, dieselben Hosts in der Content Security Policy. Was in
 * `StreamerClip` steht, ist deren Ergebnis.
 *
 * Die Tabelle ist trotzdem eine eigene, und die Begruendung steht im Schema:
 * ein CotW-Clip ist eine Wettbewerbseinreichung mit Moderationszustand,
 * Stimmen und Platzierungen. Gemeinsam gehalten braeuchte jede CotW-Abfrage ab
 * sofort einen Filter, und die eine, die ihn vergisst, legt einem Moderator
 * fremde Links in die Warteschlange.
 *
 * ## Kein Upload
 *
 * Plattformlinks, sonst nichts. Eine zweite Stelle, die Videodateien annimmt,
 * waere ein zweiter Lebenszyklus fuer Dateien auf derselben Platte - und das
 * Aufraeumen von Clip of the Week kennt sie nicht.
 */

/**
 * Wie viele Clips eine Vitrine fasst.
 *
 * **Eine Zahl, eine Stelle.** Sie begrenzt die Plaetze, prueft die Eingabe und
 * beschriftet die Oberflaeche; drei Konstanten mit demselben Wert waeren drei
 * Gelegenheiten, dass eine davon vier sagt.
 */
export const MAX_VITRINE_CLIPS = 3;

/** Wie lang die hervorgehobene Zeile sein darf. */
export const MAX_CAPTION_LAENGE = 180;

/**
 * Was in der Zeile stehen darf.
 *
 * Eine **Erlaubnisliste**, keine Verbotsliste: Buchstaben (auch mit Zeichen
 * darueber), Ziffern, Leerzeichen und die Satzzeichen, die in einem Satz
 * vorkommen. Was damit ausgeschlossen ist, ohne dass es einzeln benannt werden
 * muesste:
 *
 *  - **HTML.** `<` und `>` stehen nicht in der Liste. React wuerde ein
 *    `<script>` ohnehin als Text ausgeben, aber die Zeile geht auch nach
 *    Discord und in einen Spotlight-Entwurf, und dort gilt React nicht.
 *  - **Markdown.** `*`, `_`, `~`, `` ` ``, `|`, `[`, `]` fehlen. Auf Discord
 *    waeren sie Formatierung; eine Zeile, die sich selbst fett macht, ist
 *    keine Angabe mehr, sondern eine Gestaltungsentscheidung, die jemand
 *    anders getroffen hat.
 *  - **Adressen.** Ohne `:` und `/` bleibt kein Link uebrig. Wer seinen Kanal
 *    nennen will, traegt ihn als Kanal ein - dafuer gibt es Felder, und die
 *    werden gegen die Plattform geprueft.
 *
 * Emoji sind erlaubt, und zwar ausdruecklich: eine Social-Media-Zeile ohne
 * Emoji ist eine Zeile, die niemand so schreibt.
 */
const CAPTION_MUSTER = /^[\p{L}\p{N}\p{Emoji_Presentation}\p{Extended_Pictographic} .,!?'"&()+\-–—]+$/u;

export interface VitrineClip {
  position: number;
  provider: string;
  canonicalUrl: string;
  /** Fertig zum Einbetten - bei Twitch mit unserem Hostnamen als `parent`. */
  einbettungsUrl: string;
  thumbnailUrl: string | null;
  titel: string | null;
}

export interface Vitrine {
  clips: VitrineClip[];
  caption: string | null;
}

/**
 * Das freigegebene Streamer-Profil einer Person - oder eine Absage.
 *
 * An einer Stelle, weil jede Schreibfunktion dieselbe Frage hat. Eine Kopie je
 * Funktion waere vier Gelegenheiten, `status` zu vergessen.
 */
async function verlangeFreigegeben(discordId: string): Promise<{ id: string }> {
  const profil = await prisma.streamerProfil.findFirst({
    where: { discordId, status: 'APPROVED' },
    select: { id: true },
  });
  if (!profil) {
    throw new AppError('FORBIDDEN', {
      userMessage: 'Die Vitrine gehört zu einem freigegebenen Streamer-Profil.',
      internalMessage: `streamer: ${discordId} ist nicht APPROVED`,
    });
  }
  return profil;
}

/**
 * Einen Clip auf einen Platz legen.
 *
 * Der Platz wird **ersetzt**, nicht angehängt: drei Plaetze, jeder einzeln
 * belegbar, und wer den zweiten neu fuellt, hat danach immer noch drei. Ein
 * Anhaengen mit Verschieben waere eine Liste, die sich unter dem Finger
 * bewegt.
 *
 * `erkenneClip` wirft mit einer Meldung, die weiterhilft - eine fremde Domain,
 * eine Adresse ohne Clip-Kennung, ein Upload-Dateiname. Hier wird zusaetzlich
 * `upload` abgewiesen: `erkenneClip` kann das gar nicht liefern, aber die
 * Zeile haelt fest, dass es so bleiben soll.
 */
export async function setzeVitrineClip(
  discordId: string,
  position: number,
  url: string,
  titel?: string | null,
): Promise<VitrineClip> {
  const profil = await verlangeFreigegeben(discordId);
  verlangePosition(position);

  const erkannt: ErkannterClip = erkenneClip(url);
  if (erkannt.provider === 'upload') {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Die Vitrine nimmt Links von Twitch, YouTube und Medal - keine hochgeladenen Dateien.',
    });
  }

  const beschriftung = titel ? sauberesTitelchen(titel) : null;

  /*
   * Erst den Platz raeumen, dann belegen - in einer Transaktion.
   *
   * Zwei Eindeutigkeiten greifen hier: ein Platz je Profil und ein Clip je
   * Profil. Legt jemand auf Platz 1 denselben Clip, der schon auf Platz 0
   * steht, soll er dort **verschwinden** und hier erscheinen - und nicht ein
   * Konflikt sein, den die Oberflaeche erklaeren muesste.
   */
  await prisma.$transaction([
    prisma.streamerClip.deleteMany({
      where: {
        profilId: profil.id,
        OR: [{ position }, { provider: erkannt.provider, externalId: erkannt.externalId }],
      },
    }),
    prisma.streamerClip.create({
      data: {
        profilId: profil.id,
        position,
        provider: erkannt.provider,
        externalId: erkannt.externalId,
        canonicalUrl: erkannt.canonicalUrl,
        embedUrl: erkannt.embedUrl,
        thumbnailUrl: erkannt.thumbnailUrl,
        titel: beschriftung,
      },
    }),
  ]);

  return {
    position,
    provider: erkannt.provider,
    canonicalUrl: erkannt.canonicalUrl,
    // Ohne Hostnamen - die Einbettungsadresse entsteht beim Ausliefern, wo der
    // Hostname bekannt ist. Siehe `ladeVitrine`.
    einbettungsUrl: erkannt.embedUrl,
    thumbnailUrl: erkannt.thumbnailUrl,
    titel: beschriftung,
  };
}

/** Einen Platz raeumen. Idempotent - ein leerer Platz bleibt leer. */
export async function entferneVitrineClip(discordId: string, position: number): Promise<void> {
  const profil = await verlangeFreigegeben(discordId);
  verlangePosition(position);
  await prisma.streamerClip.deleteMany({ where: { profilId: profil.id, position } });
}

/**
 * Die hervorgehobene Zeile setzen - oder loeschen.
 *
 * Ein leerer Text loescht sie. Das ist kein Sonderfall, sondern die einzige
 * Art, sie loszuwerden: ein zweiter Knopf «Zeile entfernen» waere derselbe
 * Vorgang mit einem anderen Namen.
 */
export async function setzeVitrineCaption(discordId: string, text: string | null): Promise<string | null> {
  const profil = await verlangeFreigegeben(discordId);
  const wert = text?.trim() ?? '';

  if (wert.length === 0) {
    await prisma.streamerProfil.update({ where: { id: profil.id }, data: { socialCaption: null } });
    return null;
  }
  if (wert.length > MAX_CAPTION_LAENGE) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: `Höchstens ${MAX_CAPTION_LAENGE} Zeichen.`,
    });
  }
  if (!CAPTION_MUSTER.test(wert)) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage:
        'Nur Klartext: Buchstaben, Ziffern, Emoji und einfache Satzzeichen. Adressen, Sternchen und spitze Klammern sind hier nicht vorgesehen - deinen Kanal trägst du oben als Kanal ein.',
    });
  }

  await prisma.streamerProfil.update({ where: { id: profil.id }, data: { socialCaption: wert } });
  return wert;
}

/**
 * Die Vitrine zum Anzeigen.
 *
 * `hostname` kommt von aussen - aus der zentralen Adresskonfiguration - und
 * geht in die Einbettungsadresse von Twitch. Nie aus einer Eingabe: der
 * `parent`-Parameter entscheidet, welche Seite den Player einbetten darf.
 *
 * Gibt eine **leere** Vitrine zurueck, wenn es nichts zu zeigen gibt - nicht
 * `null`. Der Aufrufer fragt dann `clips.length` und `caption`, statt zwei
 * Faelle zu unterscheiden, die dasselbe bedeuten.
 */
export async function ladeVitrine(discordId: string, hostname: string): Promise<Vitrine> {
  const profil = await prisma.streamerProfil.findFirst({
    where: { discordId, status: 'APPROVED' },
    select: {
      socialCaption: true,
      vitrine: {
        orderBy: { position: 'asc' },
        select: {
          position: true,
          provider: true,
          canonicalUrl: true,
          embedUrl: true,
          thumbnailUrl: true,
          titel: true,
        },
      },
    },
  });
  if (!profil) {
    return { clips: [], caption: null };
  }

  return {
    clips: profil.vitrine.map((clip) => ({
      position: clip.position,
      provider: clip.provider,
      canonicalUrl: clip.canonicalUrl,
      einbettungsUrl: einbettung(clip, hostname),
      thumbnailUrl: clip.thumbnailUrl,
      titel: clip.titel,
    })),
    caption: profil.socialCaption,
  };
}

/** Ein Platz ist 0 bis `MAX_VITRINE_CLIPS - 1`. */
function verlangePosition(position: number): void {
  if (!Number.isInteger(position) || position < 0 || position >= MAX_VITRINE_CLIPS) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: `Die Vitrine hat ${MAX_VITRINE_CLIPS} Plätze.`,
      internalMessage: `streamer: Platz ${position} liegt ausserhalb`,
    });
  }
}

/**
 * Der eigene Titel eines Clips.
 *
 * Dieselbe Erlaubnisliste wie bei der Zeile, nur kuerzer - es ist eine
 * Beschriftung und kein Satz. Abgerufen wird beim Anbieter nichts: ein Titel,
 * den wir von aussen holen, waere Text von einer fremden Seite auf unserer.
 */
function sauberesTitelchen(titel: string): string {
  const wert = titel.trim();
  if (wert.length === 0) {
    return '';
  }
  if (wert.length > 70) {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Der Titel ist zu lang - höchstens 70 Zeichen.' });
  }
  if (!CAPTION_MUSTER.test(wert)) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Im Titel nur Buchstaben, Ziffern, Emoji und einfache Satzzeichen.',
    });
  }
  return wert;
}

/**
 * Der Profil-Slug eines Streamers - fuer das Neuladen der oeffentlichen Seite.
 *
 * Nur weitergereicht, nicht selbst hergeleitet: `profile/slugVon` kennt die
 * vier Bedingungen, unter denen ein Slug oeffentlich gilt (vergeben, Profil
 * `PUBLIC`, nicht gesperrt, Mitglied vorhanden), und die sollen an genau einer
 * Stelle stehen.
 *
 * Er steht hier, weil der Streamer Hub ihn braucht und das Profilmodul nicht
 * wissen soll, dass es einen Streamer Hub gibt - dieselbe Richtung wie bei
 * `ladeProfilStreaming`.
 */
export async function slugFuerProfil(discordId: string): Promise<string | null> {
  const { slugVon } = await import('../profile/oeffentlich');
  return slugVon(discordId);
}
