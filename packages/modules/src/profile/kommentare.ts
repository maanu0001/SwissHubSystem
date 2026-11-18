import { z } from 'zod';
import { prisma } from '@swisshub/database';
import { AppError } from '@swisshub/shared';
import { discordIdZuSlug } from './oeffentlich';

/**
 * Kommentare unter einem oeffentlichen Profil.
 *
 * ## Wer was darf
 *
 * **Lesen** darf jeder, der das Profil sehen darf - also jeder, denn das
 * Profil ist oeffentlich. Die Kommentare stehen darunter und sind damit
 * genauso oeffentlich; alles andere waere eine Halbheit, die niemand
 * erwartet.
 *
 * **Schreiben** darf, wer angemeldet ist. Nicht anonym: ein Name steht
 * darunter, und zwar der aus dem Mitgliederspiegel zum Zeitpunkt des
 * Schreibens.
 *
 * **Loeschen** duerfen drei Parteien, und jede aus einem anderen Grund:
 *
 * - Wer ihn geschrieben hat - es sind seine Worte.
 * - Wem das Profil gehoert - es ist seine Seite.
 * - Die Moderation - es ist ihr Server.
 *
 * Geloescht wird weich. Die Begruendung steht am Datenmodell.
 *
 * ## Was es bewusst nicht gibt
 *
 * Kein Bearbeiten. Ein Kommentar, der sich nachtraeglich aendern laesst,
 * macht jede Antwort darauf unzuverlaessig - und die Loeschung steht ja
 * offen. Keine Antworten, keine Verschachtelung, keine Reaktionen: das ist
 * eine Pinnwand und kein Forum.
 */

/** Die laengste erlaubte Laenge eines Kommentars. */
export const KOMMENTAR_MAX_ZEICHEN = 500;

export const kommentarSchema = z.object({
  /** Der Slug des Profils - nicht dessen Kennung. */
  slug: z.string().min(1).max(64),
  text: z.string().trim().min(1).max(KOMMENTAR_MAX_ZEICHEN),
});

export type KommentarEingabe = z.infer<typeof kommentarSchema>;

export const kommentarLoeschenSchema = z.object({
  kommentarId: z.string().min(1).max(64),
});

export interface ProfilKommentar {
  id: string;
  autorDiscordId: string;
  autorName: string;
  text: string;
  geschriebenAm: Date;
  /** Darf der aktuelle Betrachter diesen Kommentar entfernen? */
  loeschbar: boolean;
}

/**
 * Die Kommentare eines Profils.
 *
 * `betrachter` ist die Kennung des Angemeldeten oder `null`. Daraus
 * entscheidet sich nur eines: ob neben einem Kommentar ein Loeschknopf
 * steht. Die Entscheidung faellt hier und nicht in der Ansicht - eine
 * Ansicht, die selbst rechnet, wer loeschen darf, waere eine zweite
 * Vorstellung davon.
 *
 * `darfModerieren` kommt vom Aufrufer, weil die Berechtigungspruefung in der
 * Anwendungsschicht sitzt; dieses Modul kennt keine Berechtigungen.
 */
export async function ladeKommentare(
  profilDiscordId: string,
  betrachter: { discordId: string | null; darfModerieren: boolean },
  grenze = 100,
): Promise<ProfilKommentar[]> {
  const zeilen = await prisma.memberProfileComment.findMany({
    where: { profileDiscordId: profilDiscordId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(grenze, 1), 200),
  });

  return zeilen.map((zeile) => ({
    id: zeile.id,
    autorDiscordId: zeile.authorDiscordId,
    autorName: zeile.authorName,
    text: zeile.body,
    geschriebenAm: zeile.createdAt,
    loeschbar:
      betrachter.discordId !== null &&
      (betrachter.darfModerieren ||
        betrachter.discordId === zeile.authorDiscordId ||
        betrachter.discordId === profilDiscordId),
  }));
}

/**
 * Einen Kommentar schreiben.
 *
 * Das Ziel kommt als **Slug** herein und nicht als Kennung. Das ist Absicht:
 * ein Slug zeigt nur auf ein veroeffentlichtes, nicht gesperrtes Profil, und
 * `ladeOeffentlichesProfil` prueft das. Mit einer Kennung liesse sich an ein
 * privates oder gesperrtes Profil schreiben, indem man sie errät - die Seite
 * zeigte den Kommentar nie an, in der Datenbank stuende er trotzdem.
 */
export async function schreibeKommentar(
  eingabe: KommentarEingabe,
  autor: { discordId: string; name: string },
): Promise<ProfilKommentar> {
  const profilDiscordId = await discordIdZuSlug(eingabe.slug);
  if (!profilDiscordId) {
    throw new AppError('NOT_FOUND', {
      userMessage: 'Dieses Profil gibt es nicht.',
      internalMessage: 'Kommentar an unbekannten, privaten oder gesperrten Slug.',
    });
  }

  /*
   * Kein zweiter gleicher Kommentar in kurzer Folge.
   *
   * Nicht als Spamschutz gedacht - dafuer gibt es die Ratengrenze -, sondern
   * gegen den Doppelklick und das zweite Abschicken nach einem langsamen
   * Netz. Ohne diese Pruefung steht derselbe Satz zweimal untereinander, und
   * das sieht nach einem Fehler aus, weil es einer ist.
   */
  const vorhanden = await prisma.memberProfileComment.findFirst({
    where: {
      profileDiscordId: profilDiscordId,
      authorDiscordId: autor.discordId,
      body: eingabe.text,
      deletedAt: null,
      createdAt: { gte: new Date(Date.now() - 60_000) },
    },
    select: { id: true },
  });
  if (vorhanden) {
    throw new AppError('CONFLICT', {
      userMessage: 'Diesen Kommentar hast du eben schon geschrieben.',
    });
  }

  const zeile = await prisma.memberProfileComment.create({
    data: {
      profileDiscordId: profilDiscordId,
      authorDiscordId: autor.discordId,
      authorName: autor.name,
      body: eingabe.text,
    },
  });

  return {
    id: zeile.id,
    autorDiscordId: zeile.authorDiscordId,
    autorName: zeile.authorName,
    text: zeile.body,
    geschriebenAm: zeile.createdAt,
    loeschbar: true,
  };
}

/**
 * Darf dieser Akteur diesen Kommentar entfernen - und welcher ist es?
 *
 * Getrennt vom Entfernen selbst, damit die Pruefung einen Namen hat. Der
 * Berechtigungswaechter in `tests/unit/action-authorization.test.ts` verlangt
 * von jeder Server Action eine feste Berechtigung oder eine benannte Pruefung
 * im Rumpf; hier steht sie erst zur Laufzeit fest, genau wie beim Kalender
 * mit `requireEventZugriff`.
 *
 * Die Pruefung steht hier und nicht in der Oberflaeche: wer loeschen darf,
 * ist eine Eigenschaft des Kommentars und nicht der Ansicht.
 *
 * `FORBIDDEN` und nicht `NOT_FOUND`, weil der Kommentar sichtbar auf einer
 * oeffentlichen Seite steht - dass es ihn gibt, ist kein Geheimnis.
 */
export async function pruefeKommentarZugriff(
  kommentarId: string,
  akteur: { discordId: string; darfModerieren: boolean },
): Promise<{ id: string }> {
  const zeile = await prisma.memberProfileComment.findUnique({
    where: { id: kommentarId },
    select: { id: true, profileDiscordId: true, authorDiscordId: true, deletedAt: true },
  });
  if (!zeile || zeile.deletedAt !== null) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diesen Kommentar gibt es nicht mehr.' });
  }

  const darf =
    akteur.darfModerieren ||
    akteur.discordId === zeile.authorDiscordId ||
    akteur.discordId === zeile.profileDiscordId;
  if (!darf) {
    throw new AppError('FORBIDDEN', {
      userMessage: 'Diesen Kommentar darfst du nicht entfernen.',
      internalMessage: 'Weder Verfasser noch Profilbesitzer noch Moderation.',
    });
  }

  return { id: zeile.id };
}

/**
 * Einen Kommentar entfernen - weich.
 *
 * Erwartet eine bereits bestandene `pruefeKommentarZugriff`. Die beiden sind
 * bewusst nicht zu einer Funktion verschmolzen: sonst muesste jeder Aufrufer,
 * der nur wissen will, ob er darf, bereits loeschen.
 *
 * Weich, weil eine Loeschung hier eine Moderationshandlung sein kann. Wer
 * spaeter fragt, warum ein Kommentar verschwunden ist, bekommt mit einer
 * harten Loeschung keine Antwort - mit `deletedAt` und `deletedByDiscordId`
 * schon.
 */
export async function entferneKommentar(kommentarId: string, durchDiscordId: string): Promise<void> {
  await prisma.memberProfileComment.update({
    where: { id: kommentarId },
    data: { deletedAt: new Date(), deletedByDiscordId: durchDiscordId },
  });
}
