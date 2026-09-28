/**
 * Was eine erfuellte Mission einbringt - und warum genau einmal.
 *
 * ## Der Riegel
 *
 * Derselbe wie bei Clip of the Week, und aus demselben Grund: eine Pruefung
 * «hat diese Person schon etwas bekommen?» in der Anwendung reicht nicht.
 * Zwei gleichzeitige Durchgaenge lesen beide «nein», bevor einer schreibt.
 *
 * Deshalb ist die Zeile selbst der Riegel. `MissionBelohnung` traegt
 * `@@unique([missionId, discordId])`, und sie wird **zuerst** geschrieben -
 * vor den XP, vor dem Premium, vor der Auszeichnung. Wer sie nicht anlegen
 * kann, hat verloren und vergibt nichts. Die Datenbank entscheidet, nicht
 * die Reihenfolge der Abfragen.
 *
 * Dass die Zeile vorne steht, heisst auch: geht das Verschenken danach
 * schief, steht eine Belohnung mit einer Begruendung da. Das ist die
 * ehrlichere Haelfte des Tauschs - lieber eine nachvollziehbar nicht
 * vergebene Belohnung als eine, die beim naechsten Lauf ein zweites Mal
 * versucht wird.
 *
 * ## Keine neue Waehrung
 *
 * Vergeben wird ausschliesslich, was es schon gibt: XP ueber `applyXp`,
 * Premium ueber `schenkePremium`, Auszeichnungen ueber `MemberAward`. Kein
 * eigener Punktestand, kein Shop, keine zweite Belohnungsmaschine.
 */
import { prisma, type Prisma } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { applyXp } from '../level/service';
import { schenkePremium } from '../premium/service';

const log = createLogger('missions:belohnung');

export interface BelohnungsVorgabe {
  xp: number;
  premiumTage: number;
  auszeichnung: string | null;
}

export interface VergabeErgebnis {
  discordId: string;
  /** Traf dieser Lauf auf eine bereits vergebene Belohnung? */
  schonVergeben: boolean;
  xp: number;
  premiumTage: number;
  auszeichnung: string | null;
  /** Was tatsaechlich ankam, im Klartext. */
  ergebnis: string;
}

/**
 * Eine Mission belohnen - je Mitglied genau einmal.
 *
 * Der Titel geht nur in den Grund der XP-Buchung ein, damit im Journal
 * «Wochenmission: 100 Minuten im Voice» steht und nicht eine Kennung.
 */
export async function belohne(
  missionId: string,
  missionTitel: string,
  discordId: string,
  vorgabe: BelohnungsVorgabe,
  jetzt = new Date(),
): Promise<VergabeErgebnis> {
  /*
   * Zuerst den Platz belegen. `create` und nicht `upsert`: ein `upsert`
   * wuerde die vorhandene Zeile ueberschreiben und damit genau das
   * erlauben, was hier verhindert werden soll.
   */
  try {
    await prisma.missionBelohnung.create({
      data: {
        missionId,
        discordId,
        xp: 0,
        premiumTage: 0,
        auszeichnung: null,
        ergebnis: 'wird vergeben',
        vergebenAm: jetzt,
      },
    });
  } catch (error) {
    if (!istEindeutigkeitsfehler(error)) {
      throw error;
    }
    const vorhanden = await prisma.missionBelohnung.findUnique({
      where: { missionId_discordId: { missionId, discordId } },
    });
    return {
      discordId,
      schonVergeben: true,
      xp: vorhanden?.xp ?? 0,
      premiumTage: vorhanden?.premiumTage ?? 0,
      auszeichnung: vorhanden?.auszeichnung ?? null,
      ergebnis: vorhanden?.ergebnis ?? 'bereits vergeben',
    };
  }

  const teile: string[] = [];
  let xp = 0;
  let premiumTage = 0;
  let auszeichnung: string | null = null;

  if (vorgabe.xp > 0) {
    const buchung = await applyXp({
      discordId,
      username: null,
      displayName: null,
      delta: vorgabe.xp,
      source: 'ADMIN',
      reason: `Mission erfüllt: ${missionTitel}`,
      actorDiscordId: null,
      /*
       * Der zweite Riegel, dort wo die XP entstehen. Die Belohnungszeile
       * schuetzt diesen Ablauf; der Schluessel schuetzt die Buchung auch
       * dann, wenn spaeter jemand einen anderen Weg hierher baut - das
       * XP-Journal nimmt denselben Schluessel kein zweites Mal an.
       */
      idempotencyKey: `mission:${missionId}:${discordId}`,
    }).catch((error: unknown) => {
      log.warn('XP-Belohnung fehlgeschlagen', { missionId, discordId, error });
      return null;
    });
    if (buchung) {
      xp = buchung.delta;
      teile.push(`${buchung.delta} XP`);
    } else {
      teile.push('XP-Buchung fehlgeschlagen');
    }
  }

  if (vorgabe.premiumTage > 0) {
    const abo = await schenkePremium({
      discordId,
      tage: vorgabe.premiumTage,
      quelle: `mission:${missionId}`,
      jetzt,
    }).catch((error: unknown) => {
      log.warn('Premium-Belohnung fehlgeschlagen', { missionId, discordId, error });
      return null;
    });
    if (abo) {
      premiumTage = vorgabe.premiumTage;
      teile.push(`${vorgabe.premiumTage} Tage Premium`);
    } else {
      /*
       * `schenkePremium` gibt `null` zurueck, wenn schon ein Abo laeuft.
       * Kein Fehler - aber auch kein Grund, ein zweites zu erfinden.
       */
      teile.push('Premium läuft bereits');
    }
  }

  if (vorgabe.auszeichnung) {
    const vergeben = await vergibAuszeichnung(discordId, vorgabe.auszeichnung);
    if (vergeben) {
      auszeichnung = vorgabe.auszeichnung;
      teile.push('Auszeichnung');
    } else {
      teile.push('Auszeichnung hatte das Mitglied schon');
    }
  }

  const ergebnis = teile.length > 0 ? teile.join(', ') : 'keine Belohnung eingestellt';

  await prisma.missionBelohnung.update({
    where: { missionId_discordId: { missionId, discordId } },
    data: { xp, premiumTage, auszeichnung, ergebnis },
  });

  return { discordId, schonVergeben: false, xp, premiumTage, auszeichnung, ergebnis };
}

/**
 * Eine Auszeichnung verleihen.
 *
 * Direkt auf der Tabelle und nicht ueber `verleihe`: jene Funktion ist die
 * **Handvergabe** durch ein Teammitglied und verlangt deshalb einen Akteur,
 * den es hier nicht gibt. Der Riegel ist derselbe - `@@unique` auf
 * `(discordId, key)`, und der doppelte Schluessel ist die Antwort auf den
 * zweiten Versuch.
 */
async function vergibAuszeichnung(discordId: string, key: string): Promise<boolean> {
  try {
    await prisma.memberAward.create({
      /*
       * `grantedByDiscordId` ist nicht optional - eine Auszeichnung weiss
       * immer, wer sie vergeben hat. Hier war es niemand, sondern der
       * Abschluss einer Mission; `system` ist die Kennung, die im Protokoll
       * auch sonst fuer Hintergrundvorgaenge steht.
       */
      data: { discordId, key, grantedByDiscordId: 'system', note: 'Aus einer Community Mission' },
    });
    return true;
  } catch (error) {
    if (istEindeutigkeitsfehler(error)) {
      return false;
    }
    log.warn('Auszeichnung konnte nicht vergeben werden', { discordId, key, error });
    return false;
  }
}

function istEindeutigkeitsfehler(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as Prisma.PrismaClientKnownRequestError).code === 'P2002'
  );
}
