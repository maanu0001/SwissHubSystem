import { AUDIT_ACTIONS, prisma, recordAudit } from '@swisshub/database';
import { AppError, sanitizeText } from '@swisshub/shared';
import { createLogger } from '@swisshub/logger';
import type { Prisma, StreamerKanal, StreamerPlattform, StreamerProfil } from '@swisshub/database';
import { STREAMER_MODULE_ID } from './config';
import { erkenneKanal, hatKanal, type BewerbungEingabe, type StreamerPlattformId } from './plattform';
import { holeKanaele, type Abruf } from './twitch';
import { holeKanal as holeYouTubeKanal } from './youtube';

/**
 * Die Bewerbung - und wem ein Kanal gehoert.
 *
 * ## Die Frage, die dieses Modul beantworten muss
 *
 * «Gehoert dieser Kanal der Person, die ihn eintraegt?» Ohne eine Antwort
 * darauf koennte jedes Mitglied den Kanal eines bekannten Streamers eintragen,
 * und SwissHub kuendigte fremde Streams als die eigenen an.
 *
 * Es gibt zwei Antworten, und sie sind **nicht** gleichwertig:
 *
 * | Weg          | Wer sagt es          | Gilt als        |
 * | ------------ | -------------------- | --------------- |
 * | Twitch-OAuth | Twitch               | **Beweis**      |
 * | manuell      | ein Mensch bei uns   | Entscheidung    |
 *
 * Bei Twitch fuehrt der OAuth-Weg dazu, dass **Twitch** uns sagt, wem das
 * Konto gehoert - eine Person kann sich nur mit ihrem eigenen Konto anmelden.
 * Bei YouTube gibt es diesen Weg in dieser Fassung nicht (er braeuchte einen
 * Google-OAuth-Consent-Screen mit Pruefung durch Google), also entscheidet ein
 * Mensch.
 *
 * Beides wird in `verifikation` unterschieden und in der Oberflaeche
 * unterschiedlich dargestellt. Eine Kennzeichnung, die beides gleich aussehen
 * laesst, waere schlimmer als keine - sie behauptete einen Beweis, den es
 * nicht gibt.
 *
 * ## Warum ein Kanal nur einmal vergeben wird
 *
 * `@@unique([plattform, externeId])` in der Datenbank. Wer einen Kanal
 * eintraegt, den ein anderes Profil schon hat, bekommt einen Konflikt von
 * PostgreSQL - nicht von einer Pruefung, die jemand vergessen kann.
 */

const log = createLogger('streamer:bewerbung');

export type BewerbungMitKanaelen = StreamerProfil & { kanaele: StreamerKanal[] };

const fehler = (text: string): never => {
  throw new AppError('VALIDATION_FAILED', { userMessage: text });
};

/** Die eigene Bewerbung, oder `null`. */
export async function meineBewerbung(discordId: string): Promise<BewerbungMitKanaelen | null> {
  return prisma.streamerProfil.findUnique({
    where: { discordId },
    include: { kanaele: { orderBy: { plattform: 'asc' } } },
  });
}

/**
 * Einen Kanal bei der Plattform nachschlagen.
 *
 * Erst hier entsteht die `externeId`. Vorher gab es nur eine Eingabe - und eine
 * Eingabe kann auf einen Kanal zeigen, den es nicht gibt. Ein Eintrag ohne
 * Nachschlagen waere ein Kanal, dessen Live-Abfrage fuer immer leer bliebe,
 * ohne dass jemand erfaehrt, warum.
 */
export interface AufgeloesterKanal {
  plattform: StreamerPlattformId;
  externeId: string;
  handle: string;
  anzeigename: string | null;
  /** Fuer die Anzeige in der Bewerbungspruefung. */
  profilbildUrl: string | null;
  /** Nur bei YouTube - der guenstige Weg der Live-Erkennung braucht sie. */
  uploadsPlaylistId?: string | null;
}

export async function loeseKanalAuf(
  plattformId: StreamerPlattformId,
  eingabe: string,
  abruf?: Abruf,
): Promise<AufgeloesterKanal> {
  const erkannt = erkenneKanal(plattformId, eingabe);

  if (erkannt.art === 'twitchLogin') {
    const ergebnis = await holeKanaele({ logins: [erkannt.wert] }, abruf);
    if (ergebnis.art === 'fehler') {
      fehler(`Twitch liess sich nicht abfragen: ${ergebnis.grund}`);
    }
    const kanal = ergebnis.art === 'ok' ? ergebnis.wert[0] : undefined;
    if (!kanal) {
      fehler(`Twitch kennt den Kanal «${erkannt.wert}» nicht.`);
      throw new Error('unerreichbar');
    }
    return {
      plattform: 'TWITCH',
      externeId: kanal.id,
      handle: kanal.login,
      anzeigename: kanal.anzeigename,
      profilbildUrl: kanal.profilbildUrl,
    };
  }

  const ergebnis = await holeYouTubeKanal(
    erkannt.art === 'youtubeKanalId' ? { kanalId: erkannt.wert } : { handle: erkannt.wert },
    abruf,
  );
  if (ergebnis.art === 'fehler') {
    fehler(`YouTube liess sich nicht abfragen: ${ergebnis.grund}`);
  }
  const kanal = ergebnis.art === 'ok' ? ergebnis.wert : null;
  if (!kanal) {
    fehler(`YouTube kennt den Kanal «${erkannt.wert}» nicht.`);
    throw new Error('unerreichbar');
  }
  return {
    plattform: 'YOUTUBE',
    externeId: kanal.id,
    handle: kanal.handle ?? kanal.id,
    anzeigename: kanal.titel,
    profilbildUrl: kanal.profilbildUrl,
    uploadsPlaylistId: kanal.uploadsPlaylistId,
  };
}

/**
 * Einen Kanal an ein Profil haengen.
 *
 * Gibt `art: 'vergeben'` zurueck, wenn der Kanal einem anderen Profil gehoert.
 * Das ist kein Fehler im Sinne eines Wurfs - es ist eine Auskunft, die die
 * Oberflaeche anzeigen muss, und zwar ohne zu verraten, **wem** er gehoert.
 * Sonst waere die Bewerbungsmaske ein Werkzeug, um herauszufinden, welche
 * Mitglieder welche Kanaele haben.
 */
export type KanalErgebnis =
  | { art: 'gesetzt'; kanal: StreamerKanal }
  | { art: 'vergeben' }
  | { art: 'unveraendert'; kanal: StreamerKanal };

export async function setzeKanal(profilId: string, aufgeloest: AufgeloesterKanal): Promise<KanalErgebnis> {
  const bestehend = await prisma.streamerKanal.findUnique({
    where: { plattform_externeId: { plattform: aufgeloest.plattform, externeId: aufgeloest.externeId } },
  });
  if (bestehend && bestehend.profilId !== profilId) {
    return { art: 'vergeben' };
  }
  if (bestehend && bestehend.profilId === profilId) {
    /*
     * Derselbe Kanal, derselbe Besitzer. Name und Anzeigename werden
     * nachgezogen - der Kanal darf umbenannt worden sein -, die Verifikation
     * bleibt unberuehrt. Sie gehoert der Kennung, nicht dem Namen.
     */
    const aktualisiert = await prisma.streamerKanal.update({
      where: { id: bestehend.id },
      data: { handle: aufgeloest.handle, anzeigename: aufgeloest.anzeigename },
    });
    return { art: 'unveraendert', kanal: aktualisiert };
  }

  try {
    const kanal = await prisma.streamerKanal.upsert({
      // Ein Profil hat je Plattform hoechstens einen Kanal. Wer seinen
      // Twitch-Kanal wechselt, ersetzt ihn - er sammelt keine zweiten.
      where: { profilId_plattform: { profilId, plattform: aufgeloest.plattform } },
      create: {
        profilId,
        plattform: aufgeloest.plattform,
        externeId: aufgeloest.externeId,
        handle: aufgeloest.handle,
        anzeigename: aufgeloest.anzeigename,
      },
      update: {
        externeId: aufgeloest.externeId,
        handle: aufgeloest.handle,
        anzeigename: aufgeloest.anzeigename,
        /*
         * Ein **anderer** Kanal - die Verifikation von vorher gilt nicht
         * weiter. Sie belegte die Inhaberschaft eines Kontos, nicht dieses.
         */
        verifikation: 'KEINE',
        verifiziertAm: null,
        verifiziertVon: null,
        aktiv: true,
        letzterFehler: null,
        letzterFehlerAm: null,
      },
    });
    return { art: 'gesetzt', kanal };
  } catch (ursache) {
    // Zwei gleichzeitige Bewerbungen auf denselben Kanal - die Bedingung in
    // der Datenbank entscheidet, nicht die Reihenfolge der Pruefungen.
    if ((ursache as Prisma.PrismaClientKnownRequestError)?.code === 'P2002') {
      return { art: 'vergeben' };
    }
    throw ursache;
  }
}

export interface BewerbungErgebnis {
  profil: BewerbungMitKanaelen;
  /** Kanaele, die jemand anders schon hat - je Plattform. */
  vergeben: StreamerPlattformId[];
}

/**
 * Die eigene Bewerbung anlegen oder aendern.
 *
 * Bleibt im Status `DRAFT`, bis `reicheEin` gerufen wird. Ein Formular, das
 * beim ersten Speichern schon einreicht, nimmt der Person die Moeglichkeit,
 * ihren Text noch einmal zu lesen.
 */
export async function speichereBewerbung(
  discordId: string,
  eingabe: BewerbungEingabe,
  abruf?: Abruf,
): Promise<BewerbungErgebnis> {
  if (!hatKanal(eingabe)) {
    fehler('Gib mindestens einen Twitch- oder YouTube-Kanal an.');
  }

  const bisher = await prisma.streamerProfil.findUnique({ where: { discordId } });
  if (bisher && (bisher.status === 'PENDING' || bisher.status === 'SUSPENDED')) {
    /*
     * Waehrend der Pruefung nicht aendern: sonst entscheidet ein Moderator
     * ueber einen Text, der beim Klick schon ein anderer ist. Pausiert
     * ebenfalls nicht - dort ist die Aenderung Sache der Moderation.
     */
    fehler(
      bisher.status === 'PENDING'
        ? 'Deine Bewerbung ist in Prüfung. Änderungen sind erst nach der Entscheidung möglich.'
        : 'Dein Streamer-Profil ist pausiert. Wende dich an das Team.',
    );
  }

  const profil = await prisma.streamerProfil.upsert({
    where: { discordId },
    create: {
      discordId,
      beschreibung: sauber(eingabe.beschreibung),
      sprachen: eingabe.sprachen,
      ankuendigungAktiv: eingabe.ankuendigungAktiv,
    },
    update: {
      beschreibung: sauber(eingabe.beschreibung),
      sprachen: eingabe.sprachen,
      ankuendigungAktiv: eingabe.ankuendigungAktiv,
      /*
       * Eine abgelehnte Bewerbung, die bearbeitet wird, ist wieder ein
       * Entwurf. Ohne das bliebe sie fuer immer abgelehnt und die Person
       * koennte sich nie korrigieren.
       */
      ...(bisher?.status === 'REJECTED' ? { status: 'DRAFT' as const, ablehnungsGrund: null } : {}),
    },
  });

  const vergeben: StreamerPlattformId[] = [];

  for (const [plattformId, wert] of [
    ['TWITCH', eingabe.twitch],
    ['YOUTUBE', eingabe.youtube],
  ] as const) {
    const getrimmt = wert.trim();
    if (getrimmt === '') {
      // Leer heisst: diesen Kanal gibt es nicht mehr. Entfernen, nicht
      // stehenlassen - sonst laesst sich ein Kanal nie wieder loswerden.
      await prisma.streamerKanal.deleteMany({ where: { profilId: profil.id, plattform: plattformId } });
      continue;
    }
    const aufgeloest = await loeseKanalAuf(plattformId, getrimmt, abruf);
    const ergebnis = await setzeKanal(profil.id, aufgeloest);
    if (ergebnis.art === 'vergeben') {
      vergeben.push(plattformId);
    }
  }

  const frisch = await meineBewerbung(discordId);
  if (!frisch) {
    throw new Error('Die Bewerbung wurde nicht gefunden, obwohl sie gerade gespeichert wurde.');
  }
  return { profil: frisch, vergeben };
}

function sauber(text: string): string | null {
  const bereinigt = sanitizeText(text).trim();
  return bereinigt === '' ? null : bereinigt;
}

/**
 * Die Bewerbung einreichen.
 *
 * Ab hier entscheidet das Team. Der Statuswechsel ist an `DRAFT` gebunden -
 * zweimal Einreichen erzeugt keine zweite Bewerbung, und ein Klick auf einer
 * veralteten Seite schiebt eine schon entschiedene nicht zurueck in die Liste.
 */
export async function reicheEin(discordId: string): Promise<{ eingereicht: boolean }> {
  const profil = await prisma.streamerProfil.findUnique({
    where: { discordId },
    include: { kanaele: true },
  });
  if (!profil) {
    fehler('Es gibt noch keine Bewerbung.');
    throw new Error('unerreichbar');
  }
  if (profil.kanaele.length === 0) {
    fehler('Ohne Kanal lässt sich die Bewerbung nicht einreichen.');
  }
  if (profil.sprachen.length === 0) {
    fehler('Wähle mindestens eine Streaming-Sprache.');
  }

  const geaendert = await prisma.streamerProfil.updateMany({
    where: { id: profil.id, status: { in: ['DRAFT', 'REJECTED'] } },
    data: { status: 'PENDING', eingereichtAm: new Date(), ablehnungsGrund: null },
  });
  if (geaendert.count === 0) {
    return { eingereicht: false };
  }

  await recordAudit({
    action: AUDIT_ACTIONS.STREAMER_APPLIED,
    module: STREAMER_MODULE_ID,
    actorDiscordId: discordId,
    targetDiscordId: discordId,
    success: true,
    metadata: {
      kanaele: profil.kanaele.map((kanal) => `${kanal.plattform}:${kanal.handle}`),
      sprachen: profil.sprachen,
    },
  });
  log.info('Streamer-Bewerbung eingereicht', { discordId });
  return { eingereicht: true };
}

/**
 * Einen Kanal als per OAuth bestaetigt vermerken.
 *
 * Wird ausschliesslich vom OAuth-Rueckweg gerufen, und zwar mit der Kennung,
 * die **Twitch** genannt hat. Der Aufrufer hat keine Gelegenheit, eine andere
 * einzusetzen: er bekommt sie aus `loeseCodeEin`.
 *
 * Gibt `false` zurueck, wenn der bestaetigte Kanal nicht der eingetragene ist -
 * jemand hat sich mit einem anderen Twitch-Konto angemeldet. Genau dafuer
 * steht `force_verify` in der Autorisierungsadresse.
 */
export async function bestaetigeKanal(
  discordId: string,
  plattform: StreamerPlattform,
  externeId: string,
  handle: string,
): Promise<{ bestaetigt: boolean; grund?: string }> {
  const profil = await prisma.streamerProfil.findUnique({
    where: { discordId },
    include: { kanaele: true },
  });
  if (!profil) {
    return { bestaetigt: false, grund: 'Es gibt keine Bewerbung, zu der dieser Kanal passt.' };
  }
  const kanal = profil.kanaele.find((eintrag) => eintrag.plattform === plattform);
  if (!kanal) {
    return { bestaetigt: false, grund: 'In der Bewerbung steht kein Kanal dieser Plattform.' };
  }
  if (kanal.externeId !== externeId) {
    return {
      bestaetigt: false,
      grund: `Angemeldet wurde mit «${handle}», eingetragen ist ein anderer Kanal. Trage den Kanal ein, mit dem du dich anmeldest.`,
    };
  }

  await prisma.streamerKanal.update({
    where: { id: kanal.id },
    data: {
      verifikation: 'OAUTH',
      verifiziertAm: new Date(),
      // Bei OAUTH war es die Plattform und kein Mensch.
      verifiziertVon: null,
      handle,
    },
  });
  await recordAudit({
    action: AUDIT_ACTIONS.STREAMER_CHANNEL_VERIFIED,
    module: STREAMER_MODULE_ID,
    actorDiscordId: discordId,
    targetDiscordId: discordId,
    success: true,
    metadata: { plattform, handle, weg: 'OAUTH' },
  });
  log.info('Kanal per OAuth bestätigt', { discordId, plattform, handle });
  return { bestaetigt: true };
}
