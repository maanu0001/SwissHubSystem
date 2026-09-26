import { AUDIT_ACTIONS, prisma, recordAudit } from '@swisshub/database';
import { AppError, sanitizeText } from '@swisshub/shared';
import { createLogger } from '@swisshub/logger';
import type { StreamerPlattform } from '@swisshub/database';
import { STREAMER_MODULE_ID } from './config';

/**
 * Die Verwaltung: entscheiden, pausieren, trennen.
 *
 * ## Warum jeder Statuswechsel eine Bedingung traegt
 *
 * Jede Aenderung hier laeuft ueber `updateMany` mit einer Bedingung auf den
 * erwarteten Ausgangszustand, nicht ueber `update` auf die Kennung. Der
 * Unterschied zeigt sich, wenn zwei Moderatoren dieselbe Bewerbung offen haben:
 * der erste genehmigt, der zweite lehnt ab. Mit `update` gewinnt der zweite
 * Klick und ueberschreibt eine Entscheidung, die schon gefallen war. Mit einer
 * Bedingung greift der zweite ins Leere und bekommt es gesagt.
 *
 * ## Warum Gruende intern bleiben
 *
 * Ein Ablehnungsgrund ist eine Notiz zwischen Team und Bewerber. Die Person
 * selbst sieht ihn - eine Ablehnung ohne Begruendung ist keine Auskunft. Auf
 * der oeffentlichen Seite steht er nie: dort gibt es das Profil einfach nicht.
 * Das ist keine Filterregel, sondern eine Folge davon, wie
 * `oeffentlich.ts` baut - aufzaehlend aus benannten Feldern.
 */

const log = createLogger('streamer:verwaltung');

const fehler = (text: string): never => {
  throw new AppError('VALIDATION_FAILED', { userMessage: text });
};

const sauber = (text: string | null | undefined): string | null => {
  const bereinigt = sanitizeText(text ?? '').trim();
  return bereinigt === '' ? null : bereinigt;
};

export interface Entscheidung {
  geaendert: boolean;
  /** Warum nicht - wenn nicht. */
  grund?: string;
}

/**
 * Eine Bewerbung genehmigen.
 *
 * Ab jetzt ist der Streamer oeffentlich sichtbar und wird bei Livestreams
 * angekuendigt - beides Folgen, die ein Klick hat. Deshalb die Bedingung auf
 * `PENDING`: genehmigt wird eine Bewerbung, die zur Entscheidung steht, und
 * nicht ein Entwurf, den jemand noch schreibt.
 */
export async function genehmige(profilId: string, actorDiscordId: string): Promise<Entscheidung> {
  const profil = await prisma.streamerProfil.findUnique({
    where: { id: profilId },
    include: { kanaele: true },
  });
  if (!profil) {
    return { geaendert: false, grund: 'Diese Bewerbung gibt es nicht mehr.' };
  }
  if (profil.kanaele.length === 0) {
    fehler('Diese Bewerbung hat keinen Kanal - so lässt sie sich nicht freigeben.');
  }

  const ergebnis = await prisma.streamerProfil.updateMany({
    where: { id: profilId, status: 'PENDING' },
    data: {
      status: 'APPROVED',
      entschiedenAm: new Date(),
      entschiedenVon: actorDiscordId,
      ablehnungsGrund: null,
    },
  });
  if (ergebnis.count === 0) {
    return {
      geaendert: false,
      grund: 'Über diese Bewerbung wurde inzwischen entschieden. Lade die Seite neu.',
    };
  }

  await recordAudit({
    action: AUDIT_ACTIONS.STREAMER_APPROVED,
    module: STREAMER_MODULE_ID,
    actorDiscordId,
    targetDiscordId: profil.discordId,
    success: true,
    metadata: {
      kanaele: profil.kanaele.map((kanal) => `${kanal.plattform}:${kanal.handle}`),
      /*
       * Ob die Kanaele bewiesen oder von Hand freigegeben wurden, gehoert ins
       * Protokoll: es ist die Angabe, die spaeter jemand braucht, wenn sich
       * ein Kanal als fremd herausstellt.
       */
      verifikation: profil.kanaele.map((kanal) => `${kanal.plattform}:${kanal.verifikation}`),
    },
  });
  log.info('Streamer freigegeben', { profilId, discordId: profil.discordId });
  return { geaendert: true };
}

export async function lehneAb(
  profilId: string,
  grund: string,
  actorDiscordId: string,
): Promise<Entscheidung> {
  const bereinigt = sauber(grund);
  if (!bereinigt) {
    fehler('Eine Ablehnung braucht einen Grund - die Person soll wissen, was fehlt.');
  }
  const profil = await prisma.streamerProfil.findUnique({ where: { id: profilId } });
  if (!profil) {
    return { geaendert: false, grund: 'Diese Bewerbung gibt es nicht mehr.' };
  }

  const ergebnis = await prisma.streamerProfil.updateMany({
    where: { id: profilId, status: 'PENDING' },
    data: {
      status: 'REJECTED',
      entschiedenAm: new Date(),
      entschiedenVon: actorDiscordId,
      ablehnungsGrund: bereinigt,
    },
  });
  if (ergebnis.count === 0) {
    return {
      geaendert: false,
      grund: 'Über diese Bewerbung wurde inzwischen entschieden. Lade die Seite neu.',
    };
  }

  await recordAudit({
    action: AUDIT_ACTIONS.STREAMER_REJECTED,
    module: STREAMER_MODULE_ID,
    actorDiscordId,
    targetDiscordId: profil.discordId,
    success: true,
    // Der Grund steht im Protokoll, nicht nur am Profil: eine Ablehnung ist
    // eine Entscheidung ueber eine Person und soll nachvollziehbar bleiben,
    // auch wenn die Bewerbung spaeter neu eingereicht wird.
    metadata: { grund: bereinigt },
  });
  log.info('Streamer-Bewerbung abgelehnt', { profilId });
  return { geaendert: true };
}

/**
 * Einen freigegebenen Streamer pausieren.
 *
 * Pausiert heisst: nicht mehr oeffentlich, keine Ankuendigungen, keine
 * Live-Abfrage. Die Kanaele bleiben stehen - eine Pause ist keine Trennung,
 * und nach dem Wiederfreischalten soll niemand seine Kanaele neu eintragen
 * muessen.
 */
export async function pausiere(
  profilId: string,
  grund: string | null,
  actorDiscordId: string,
): Promise<Entscheidung> {
  const profil = await prisma.streamerProfil.findUnique({ where: { id: profilId } });
  if (!profil) {
    return { geaendert: false, grund: 'Dieses Streamer-Profil gibt es nicht mehr.' };
  }
  const ergebnis = await prisma.streamerProfil.updateMany({
    where: { id: profilId, status: 'APPROVED' },
    data: {
      status: 'SUSPENDED',
      pausiertAm: new Date(),
      pausiertVon: actorDiscordId,
      pausierungsGrund: sauber(grund),
    },
  });
  if (ergebnis.count === 0) {
    return { geaendert: false, grund: 'Nur ein freigegebener Streamer lässt sich pausieren.' };
  }

  /*
   * Laufende Sessions beenden.
   *
   * Nicht aus Ordnungsliebe: eine offene Session gilt als «jetzt live». Bleibt
   * sie stehen, waere der Streamer in jeder Live-Abfrage weiter live, obwohl
   * er nicht mehr abgefragt wird - und stuende in der oeffentlichen Uebersicht,
   * falls jemand die Pause wieder aufhebt, mit einem Stream von letzter Woche.
   */
  const beendet = await prisma.streamerSession.updateMany({
    where: { kanal: { profilId }, beendetAm: null },
    data: { beendetAm: new Date() },
  });

  await recordAudit({
    action: AUDIT_ACTIONS.STREAMER_SUSPENDED,
    module: STREAMER_MODULE_ID,
    actorDiscordId,
    targetDiscordId: profil.discordId,
    success: true,
    metadata: { grund: sauber(grund), laufendeSessionsBeendet: beendet.count },
  });
  log.info('Streamer pausiert', { profilId, sessionsBeendet: beendet.count });
  return { geaendert: true };
}

export async function schalteFrei(profilId: string, actorDiscordId: string): Promise<Entscheidung> {
  const profil = await prisma.streamerProfil.findUnique({ where: { id: profilId } });
  if (!profil) {
    return { geaendert: false, grund: 'Dieses Streamer-Profil gibt es nicht mehr.' };
  }
  const ergebnis = await prisma.streamerProfil.updateMany({
    where: { id: profilId, status: 'SUSPENDED' },
    data: { status: 'APPROVED', pausiertAm: null, pausiertVon: null, pausierungsGrund: null },
  });
  if (ergebnis.count === 0) {
    return { geaendert: false, grund: 'Nur ein pausierter Streamer lässt sich wieder freischalten.' };
  }
  await recordAudit({
    action: AUDIT_ACTIONS.STREAMER_REINSTATED,
    module: STREAMER_MODULE_ID,
    actorDiscordId,
    targetDiscordId: profil.discordId,
    success: true,
  });
  log.info('Streamer wieder freigeschaltet', { profilId });
  return { geaendert: true };
}

/**
 * Eine Kanalverbindung entfernen.
 *
 * ## Was dabei alles mitgeht
 *
 * Der Kanal, seine Sessions und die Ankuendigungen daran - ueber
 * `onDelete: Cascade`. Das ist Absicht und keine Nebenwirkung:
 *
 * - **Live-Erkennung beendet.** Ohne Kanal keine Abfrage.
 * - **Ausstehende Ankuendigung entwertet.** Eine Ankuendigungszeile ohne
 *   `messageId` ist ein belegter Platz, den der Job noch senden wuerde. Sie
 *   verschwindet mit der Session.
 * - **Oeffentliche Darstellung.** Der Kanal fehlt beim naechsten Aufbau der
 *   Seite; die aufrufende Action erneuert sie zusaetzlich.
 *
 * ## Und die Tokens?
 *
 * Es gibt keine. Der OAuth-Nachweis verbraucht ein einmaliges Benutzertoken
 * und widerruft es sofort bei Twitch (siehe `twitch.ts`, `loeseCodeEin`). Was
 * hier zu loeschen waere, wurde nie gespeichert - deshalb gibt es an dieser
 * Stelle auch keinen Aufruf, der es tun koennte.
 */
export async function entferneKanal(
  profilId: string,
  plattform: StreamerPlattform,
  actorDiscordId: string,
): Promise<Entscheidung> {
  const kanal = await prisma.streamerKanal.findUnique({
    where: { profilId_plattform: { profilId, plattform } },
    include: { profil: { select: { discordId: true } }, sessions: { select: { id: true } } },
  });
  if (!kanal) {
    return { geaendert: false, grund: 'Diesen Kanal gibt es nicht.' };
  }

  await prisma.streamerKanal.delete({ where: { id: kanal.id } });

  await recordAudit({
    action: AUDIT_ACTIONS.STREAMER_CHANNEL_REMOVED,
    module: STREAMER_MODULE_ID,
    actorDiscordId,
    targetDiscordId: kanal.profil.discordId,
    success: true,
    metadata: {
      plattform,
      handle: kanal.handle,
      verifikation: kanal.verifikation,
      entfernteSessions: kanal.sessions.length,
    },
  });
  log.info('Kanalverbindung entfernt', { profilId, plattform, sessions: kanal.sessions.length });
  return { geaendert: true };
}

/**
 * Einen Kanal von Hand als geprueft markieren.
 *
 * Fuer YouTube der einzige Weg, und fuer Twitch der Ausweg, wenn jemand den
 * OAuth-Schritt nicht gehen kann.
 *
 * `MANUELL` ist bewusst ein anderer Wert als `OAUTH` und wird ueberall anders
 * dargestellt. Was hier passiert, ist eine Entscheidung eines Menschen, kein
 * Beweis - und wer spaeter wissen will, worauf eine Freigabe beruhte, soll es
 * unterscheiden koennen.
 */
export async function bestaetigeVonHand(kanalId: string, actorDiscordId: string): Promise<Entscheidung> {
  const kanal = await prisma.streamerKanal.findUnique({
    where: { id: kanalId },
    include: { profil: { select: { discordId: true } } },
  });
  if (!kanal) {
    return { geaendert: false, grund: 'Diesen Kanal gibt es nicht.' };
  }
  if (kanal.verifikation === 'OAUTH') {
    /*
     * Einen bewiesenen Kanal nicht auf «manuell» zurueckstufen: das waere ein
     * Verlust an Auskunft, und zwar in die falsche Richtung.
     */
    return { geaendert: false, grund: 'Dieser Kanal ist bereits über die Plattform bestätigt.' };
  }
  await prisma.streamerKanal.update({
    where: { id: kanalId },
    data: { verifikation: 'MANUELL', verifiziertAm: new Date(), verifiziertVon: actorDiscordId },
  });
  await recordAudit({
    action: AUDIT_ACTIONS.STREAMER_CHANNEL_VERIFIED,
    module: STREAMER_MODULE_ID,
    actorDiscordId,
    targetDiscordId: kanal.profil.discordId,
    success: true,
    metadata: { plattform: kanal.plattform, handle: kanal.handle, weg: 'MANUELL' },
  });
  log.info('Kanal von Hand bestätigt', { kanalId, plattform: kanal.plattform });
  return { geaendert: true };
}

/**
 * Die Live-Ankuendigungen eines Streamers abschalten - von der Moderation aus.
 *
 * Getrennt vom Pausieren: ein Streamer kann oeffentlich sichtbar bleiben und
 * trotzdem nicht mehr angekuendigt werden. Das ist die mildere Massnahme, und
 * ohne sie waere Pausieren die einzige.
 */
export async function setzeAnkuendigung(
  profilId: string,
  aktiv: boolean,
  actorDiscordId: string,
): Promise<Entscheidung> {
  const profil = await prisma.streamerProfil.findUnique({ where: { id: profilId } });
  if (!profil) {
    return { geaendert: false, grund: 'Dieses Streamer-Profil gibt es nicht mehr.' };
  }
  if (profil.ankuendigungAktiv === aktiv) {
    return { geaendert: false, grund: 'Der Wert steht schon so.' };
  }
  await prisma.streamerProfil.update({ where: { id: profilId }, data: { ankuendigungAktiv: aktiv } });
  await recordAudit({
    action: AUDIT_ACTIONS.STREAMER_ANNOUNCE_SETTINGS_UPDATED,
    module: STREAMER_MODULE_ID,
    actorDiscordId,
    targetDiscordId: profil.discordId,
    success: true,
    metadata: { ankuendigungAktiv: aktiv },
  });
  return { geaendert: true };
}
