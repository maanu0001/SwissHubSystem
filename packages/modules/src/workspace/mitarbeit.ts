import { prisma } from '@swisshub/database';
import type {
  WorkspaceAttachment,
  WorkspaceChecklistItem,
  WorkspaceComment,
  WorkspaceLink,
} from '@swisshub/database';
import { meldeImProjektkanal } from './kanalmeldung';
import { AppError, sanitizeText } from '@swisshub/shared';
import { MAX_UPLOAD_BYTES, storeLogoUpload } from '../branding/storage';
import { meldeEreignis } from '../automation/emit';
import { sichereAufgabenSicht, sichereProjektSicht, type WorkspaceBetrachter } from './sichtbarkeit';
import { vermerke } from './verlauf';

/**
 * Was an einer Aufgabe mitgeschrieben wird: Kommentare, Erwähnungen,
 * Checklisten, Links und Anhänge.
 *
 * ## Warum Kommentare hier und keine Chatplattform
 *
 * Weil die Frage, die sie beantworten, eine andere ist. Discord beantwortet
 * «was reden wir gerade»; ein Kommentar an einer Aufgabe beantwortet «warum
 * steht das so, wie es steht» - und zwar in drei Wochen noch, wenn der
 * Discord-Verlauf längst weitergescrollt ist. Deshalb hängt er an der
 * Aufgabe und nicht in einem Kanal, und deshalb gibt es hier keine
 * Lesebestätigungen, keine Reaktionen und kein Tippen-Anzeigen.
 *
 * ## Warum eine Erwähnung aus dem Rumpf gelesen wird
 *
 * Weil sie dort steht. Der Rumpf ist die Quelle: wer `<@123>` schreibt, meint
 * diese Person, und eine getrennt mitgeschickte Liste könnte davon abweichen -
 * entweder weil die Oberfläche sich verzählt, oder weil jemand sie von Hand
 * schickt. Gespeichert wird die Liste trotzdem, aber **abgeleitet**: so steht
 * in `mentions` genau das, was im Text steht.
 */

const KOMMENTAR_MAX = 4000;
const CHECKLISTE_MAX = 200;
const LINK_TITEL_MAX = 120;
const LINK_URL_MAX = 2000;
const ANHANG_NAME_MAX = 120;

/** Die Form, in der eine Erwähnung im Text steht - Discords eigene. */
const ERWAEHNUNG = /<@!?(\d{16,20})>/gu;

/**
 * Die erwähnten Kennungen aus einem Text.
 *
 * Höchstens zehn: ein Kommentar, der zwanzig Leute anpingt, ist kein
 * Kommentar, sondern eine Durchsage - und zwanzig Meldungen daraus sind der
 * Grund, warum danach niemand mehr auf die Glocke schaut.
 */
export function erwaehnungenAus(text: string): string[] {
  const gefunden = new Set<string>();
  for (const treffer of text.matchAll(ERWAEHNUNG)) {
    const kennung = treffer[1];
    if (kennung) {
      gefunden.add(kennung);
    }
    if (gefunden.size >= 10) {
      break;
    }
  }
  return [...gefunden];
}

async function holeAufgabe(taskId: string): Promise<{
  id: string;
  guildId: string;
  title: string;
  projectId: string | null;
}> {
  const aufgabe = await prisma.workspaceTask.findUnique({
    where: { id: taskId },
    select: { id: true, guildId: true, title: true, projectId: true },
  });
  if (!aufgabe) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Aufgabe gibt es nicht.' });
  }
  return aufgabe;
}

// --- Kommentare -------------------------------------------------------------

export async function schreibeKommentar(
  taskId: string,
  autorDiscordId: string,
  text: string,
): Promise<WorkspaceComment> {
  const aufgabe = await holeAufgabe(taskId);
  const rumpf = sanitizeText(text, KOMMENTAR_MAX).trim();
  if (rumpf === '') {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Der Kommentar ist leer.' });
  }

  const erwaehnt = erwaehnungenAus(rumpf);
  const kommentar = await prisma.workspaceComment.create({
    data: { taskId, authorDiscordId: autorDiscordId, body: rumpf, mentions: erwaehnt },
  });

  await vermerke({
    guildId: aufgabe.guildId,
    art: 'task.comment',
    actorDiscordId: autorDiscordId,
    projectId: aufgabe.projectId,
    taskId,
  });

  /*
   * Der Kommentar geht auch in den Projektkanal - wenn das Projekt es will.
   *
   * Nur der Anfang: ein Kanal ist kein zweiter Kommentarverlauf. Wer mehr
   * lesen will, klickt auf den Knopf. Standardmaessig ist diese Art
   * abgeschaltet, denn ein Projekt mit lebhafter Diskussion fuellte den Kanal
   * sonst mit Halbsaetzen.
   */
  await meldeImProjektkanal(aufgabe.projectId, {
    ereignis: 'task.comment',
    titel: aufgabe.title,
    beschreibung: rumpf.slice(0, 300),
    pfad: `/workspace/aufgaben/${taskId}`,
    akteurDiscordId: autorDiscordId,
  });

  for (const discordId of erwaehnt) {
    // Niemand erwähnt sich selbst mit Absicht auf eine Meldung hin.
    if (discordId === autorDiscordId) {
      continue;
    }
    await meldeEreignis(
      'workspace.mention',
      {
        taskId,
        titel: aufgabe.title,
        discordId,
        // Der Anfang des Kommentars als Vorschau - ganze vier Kilobyte in eine
        // Meldung zu legen hiesse, sie unlesbar zu machen.
        auszug: rumpf.slice(0, 160),
      },
      {
        guildId: aufgabe.guildId,
        actorId: autorDiscordId,
        subjectId: discordId,
        entityId: taskId,
      },
    );
  }

  return kommentar;
}

/**
 * Einen Kommentar löschen.
 *
 * Nur der eigene, und das ist keine Bequemlichkeit: ein fremder Kommentar ist
 * die Begründung einer anderen Person für eine Entscheidung. Wer ihn
 * wegräumen darf, räumt die Begründung weg. Die Moderation fremder Beiträge
 * gehört in ein Supportwerkzeug, nicht in ein Aufgabenbrett.
 */
export async function loescheKommentar(kommentarId: string, akteurDiscordId: string): Promise<void> {
  const kommentar = await prisma.workspaceComment.findUnique({ where: { id: kommentarId } });
  if (!kommentar) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diesen Kommentar gibt es nicht.' });
  }
  if (kommentar.authorDiscordId !== akteurDiscordId) {
    throw new AppError('FORBIDDEN', {
      userMessage: 'Fremde Kommentare lassen sich nicht löschen.',
    });
  }
  await prisma.workspaceComment.delete({ where: { id: kommentarId } });
}

export async function ladeKommentare(
  taskId: string,
  betrachter: WorkspaceBetrachter,
  grenze = 100,
): Promise<WorkspaceComment[]> {
  await sichereAufgabenSicht(taskId, betrachter);
  return prisma.workspaceComment.findMany({
    where: { taskId },
    orderBy: { createdAt: 'asc' },
    take: Math.min(Math.max(grenze, 1), 200),
  });
}

// --- Checkliste -------------------------------------------------------------

/**
 * Einen Punkt anhängen.
 *
 * Die Position wird serverseitig vergeben und nicht aus dem Formular
 * übernommen: zwei Leute, die gleichzeitig etwas anhängen, hätten sonst
 * dieselbe Zahl, und die Reihenfolge der Liste wäre danach Zufall.
 */
export async function ergaenzeChecklistenpunkt(
  taskId: string,
  akteurDiscordId: string,
  text: string,
): Promise<WorkspaceChecklistItem> {
  const aufgabe = await holeAufgabe(taskId);
  const inhalt = sanitizeText(text, CHECKLISTE_MAX).trim();
  if (inhalt === '') {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Der Punkt braucht einen Text.' });
  }

  const punkt = await prisma.$transaction(async (tx) => {
    const letzte = await tx.workspaceChecklistItem.findFirst({
      where: { taskId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    return tx.workspaceChecklistItem.create({
      data: { taskId, text: inhalt, position: (letzte?.position ?? -1) + 1 },
    });
  });

  await vermerke({
    guildId: aufgabe.guildId,
    art: 'task.checklist',
    actorDiscordId: akteurDiscordId,
    projectId: aufgabe.projectId,
    taskId,
    detail: inhalt,
  });

  return punkt;
}

/**
 * Einen Punkt abhaken oder wieder öffnen.
 *
 * Kein Verlaufseintrag: eine Checkliste wird im Minutentakt angefasst, und
 * vierzig Zeilen «Checkliste geändert» verdecken die drei Einträge, auf die es
 * ankommt. Der Stand steht an der Aufgabe und ist dort vollständig.
 */
export async function hakeAb(punktId: string, erledigt: boolean): Promise<WorkspaceChecklistItem> {
  const punkt = await prisma.workspaceChecklistItem.findUnique({ where: { id: punktId } });
  if (!punkt) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diesen Punkt gibt es nicht.' });
  }
  return prisma.workspaceChecklistItem.update({ where: { id: punktId }, data: { erledigt } });
}

export async function loescheChecklistenpunkt(punktId: string): Promise<void> {
  const punkt = await prisma.workspaceChecklistItem.findUnique({ where: { id: punktId } });
  if (!punkt) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diesen Punkt gibt es nicht.' });
  }
  await prisma.workspaceChecklistItem.delete({ where: { id: punktId } });
}

export async function ladeCheckliste(
  taskId: string,
  betrachter: WorkspaceBetrachter,
): Promise<WorkspaceChecklistItem[]> {
  await sichereAufgabenSicht(taskId, betrachter);
  return prisma.workspaceChecklistItem.findMany({
    where: { taskId },
    orderBy: { position: 'asc' },
    take: 100,
  });
}

// --- Links ------------------------------------------------------------------

/**
 * Eine Adresse prüfen.
 *
 * ## Warum serverseitig, und warum so streng
 *
 * Weil die Adresse später als `href` in der Seite steht. `javascript:` wäre
 * dort ausführbarer Code, `data:` eine Seite im Kleid der eigenen, und
 * `file:` ein Griff auf die Platte des Betrachters. Geprüft wird deshalb nicht
 * «sieht gefährlich aus», sondern umgekehrt: nur `http` und `https` kommen
 * durch, alles andere wird abgelehnt.
 *
 * Zurückgegeben wird die **normalisierte** Adresse aus dem Parser und nicht
 * die Eingabe: damit landet in der Datenbank nie etwas, das der Parser anders
 * gelesen hat als der Browser es tun würde.
 */
export function pruefeUrl(eingabe: string): string {
  const rohwert = eingabe.trim();
  if (rohwert === '' || rohwert.length > LINK_URL_MAX) {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Die Adresse ist leer oder zu lang.' });
  }

  let adresse: URL;
  try {
    adresse = new URL(rohwert);
  } catch {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Das ist keine gültige Adresse. Sie muss mit https:// beginnen.',
    });
  }

  if (adresse.protocol !== 'http:' && adresse.protocol !== 'https:') {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Nur http und https sind erlaubt.',
    });
  }
  if (adresse.hostname === '') {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Der Adresse fehlt der Host.' });
  }
  /*
   * Zugangsdaten in der Adresse.
   *
   * `https://user:pass@example.com` ist gültiges URL-Format und gehört
   * trotzdem nicht in eine geteilte Liste: das Passwort stünde danach für
   * jeden im Team lesbar da. Abgelehnt statt stillschweigend entfernt - wer
   * so etwas einträgt, soll es merken.
   */
  if (adresse.username !== '' || adresse.password !== '') {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Die Adresse enthält Zugangsdaten. Bitte ohne Benutzername und Passwort.',
    });
  }

  return adresse.toString();
}

export async function ergaenzeLink(
  bezug: { taskId: string } | { projectId: string },
  akteurDiscordId: string,
  titel: string,
  url: string,
): Promise<WorkspaceLink> {
  const geprueft = pruefeUrl(url);
  const name = sanitizeText(titel, LINK_TITEL_MAX).trim();

  if ('taskId' in bezug) {
    await holeAufgabe(bezug.taskId);
  } else {
    const projekt = await prisma.workspaceProject.findUnique({
      where: { id: bezug.projectId },
      select: { id: true },
    });
    if (!projekt) {
      throw new AppError('NOT_FOUND', { userMessage: 'Dieses Projekt gibt es nicht.' });
    }
  }

  return prisma.workspaceLink.create({
    data: {
      ...bezug,
      // Ohne Titel die Adresse selbst - besser als ein leerer Verweis, der
      // aussieht wie ein Darstellungsfehler.
      title: name === '' ? geprueft : name,
      url: geprueft,
      createdByDiscordId: akteurDiscordId,
    },
  });
}

export async function loescheLink(linkId: string): Promise<void> {
  const link = await prisma.workspaceLink.findUnique({ where: { id: linkId } });
  if (!link) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diesen Link gibt es nicht.' });
  }
  await prisma.workspaceLink.delete({ where: { id: linkId } });
}

export async function ladeLinks(
  bezug: { taskId: string } | { projectId: string },
  betrachter: WorkspaceBetrachter,
): Promise<WorkspaceLink[]> {
  await sichereBezug(bezug, betrachter);
  return prisma.workspaceLink.findMany({ where: bezug, orderBy: { createdAt: 'asc' }, take: 50 });
}

/**
 * Der Bezug - Aufgabe oder Projekt - durch dieselbe Pruefung.
 *
 * Links und Anhaenge haengen an einem von beiden, und beide Wege muessen
 * gleich eng sein: ein Anhang an einer Aufgabe eines privaten Projekts waere
 * sonst ueber die Anhangliste erreichbar, obwohl die Aufgabe es nicht ist.
 */
async function sichereBezug(
  bezug: { taskId: string } | { projectId: string },
  betrachter: WorkspaceBetrachter,
): Promise<void> {
  if ('taskId' in bezug) {
    await sichereAufgabenSicht(bezug.taskId, betrachter);
    return;
  }
  await sichereProjektSicht(bezug.projectId, betrachter);
}

// --- Anhänge ----------------------------------------------------------------

/** Die zentrale Obergrenze - nicht eine eigene. */
export const ANHANG_MAX_BYTES = MAX_UPLOAD_BYTES;

/**
 * Einen Anhang speichern.
 *
 * Über **dieselbe** Upload-Infrastruktur wie jedes andere Bild im System:
 * `storeLogoUpload` liest die Magic Bytes, vergleicht sie mit dem gemeldeten
 * Typ, prüft Grösse und Abmessungen und erzeugt einen zufälligen Dateinamen
 * mit der Endung aus dem **erkannten** Inhalt. Der Name aus dem Browser wird
 * nie verwendet - damit sind Pfadmanipulation und ausführbare Endungen
 * ausgeschlossen, ohne dass etwas bereinigt werden müsste.
 *
 * Der Anzeigename ist deshalb etwas anderes als der Dateiname: er ist Text für
 * Menschen und steht nie in einem Pfad.
 *
 * Dass damit nur Bilder gehen, ist Absicht und kein Versehen: eine zweite
 * Upload-Strecke für beliebige Dateien wäre eine zweite Stelle, an der
 * entschieden wird, was hereindarf. Für ein Dokument gibt es den Link.
 */
export async function ergaenzeAnhang(
  bezug: { taskId: string } | { projectId: string },
  akteurDiscordId: string,
  datei: { bytes: Uint8Array; mimeTyp: string | null; name: string },
): Promise<WorkspaceAttachment> {
  if ('taskId' in bezug) {
    await holeAufgabe(bezug.taskId);
  } else {
    const projekt = await prisma.workspaceProject.findUnique({
      where: { id: bezug.projectId },
      select: { id: true },
    });
    if (!projekt) {
      throw new AppError('NOT_FOUND', { userMessage: 'Dieses Projekt gibt es nicht.' });
    }
  }

  const gespeichert = await storeLogoUpload(datei.bytes, datei.mimeTyp, 'workspace');
  const anzeige = sanitizeText(datei.name, ANHANG_NAME_MAX).trim();

  return prisma.workspaceAttachment.create({
    data: {
      ...bezug,
      fileName: gespeichert.fileName,
      anzeigeName: anzeige === '' ? gespeichert.fileName : anzeige,
      mimeTyp: `image/${gespeichert.format}`,
      bytes: gespeichert.bytes,
      uploadedByDiscordId: akteurDiscordId,
    },
  });
}

/**
 * Einen Anhang aus der Liste nehmen.
 *
 * Die Datei bleibt auf der Platte. Das ist kein Versäumnis: dieselbe Datei
 * kann an mehreren Stellen hängen, und ein Löschen, das die Platte anfasst,
 * wäre ein Löschen, das fremde Einträge kaputtmachen kann. Das Aufräumen
 * ungenutzter Dateien gehört in einen Aufräumjob, der alle Verweise kennt -
 * nicht in diesen Aufruf, der genau einen kennt.
 */
export async function loescheAnhang(anhangId: string): Promise<void> {
  const anhang = await prisma.workspaceAttachment.findUnique({ where: { id: anhangId } });
  if (!anhang) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diesen Anhang gibt es nicht.' });
  }
  await prisma.workspaceAttachment.delete({ where: { id: anhangId } });
}

export async function ladeAnhaenge(
  bezug: { taskId: string } | { projectId: string },
  betrachter: WorkspaceBetrachter,
): Promise<WorkspaceAttachment[]> {
  await sichereBezug(bezug, betrachter);
  return prisma.workspaceAttachment.findMany({
    where: bezug,
    orderBy: { createdAt: 'asc' },
    take: 50,
  });
}
