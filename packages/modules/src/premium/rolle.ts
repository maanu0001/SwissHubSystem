import { prisma } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { getModuleSettings } from '../module-state';
import { LEVEL_MODULE_ID, type LevelSettings } from '../level/config';
import { PREMIUM_MODULE_ID, type PremiumSettings } from './config';
import { ENTITLEMENTS } from './entitlements';
import { hatAnspruch } from './queries';

const log = createLogger('premium:rolle');

/**
 * Premium, das nicht ueber SwissHub laeuft.
 *
 * ## Warum es das braucht
 *
 * Die Premium-Rolle wird heute von MEE6 vergeben, nicht von SwissHub. Wer sie
 * traegt, hat Premium - auch wenn in `PremiumSubscription` nichts dazu steht,
 * weil dort nur steht, was ueber SwissHub bezahlt wurde. Ein Mitglied mit der
 * Rolle sah deshalb «Es laesst sich mit einem aktiven SwissHub Premium
 * auswaehlen» und hatte keinen Weg dorthin.
 *
 * ## Die zwei Fehler, die das vorher verhindert haben
 *
 * Es gab bereits eine Rollenpruefung. Sie konnte nicht greifen:
 *
 * 1. **Sie verlangte ein eingeschaltetes Premium-Modul.** Genau das ist auf
 *    einem Server, der Premium ueber MEE6 fuehrt, abgeschaltet - SwissHub
 *    verkauft dort nichts. Die Frage «traegt diese Person die Rolle» hat
 *    damit aber nichts zu tun.
 * 2. **Sie las die Rollenkennung nur aus den Premium-Einstellungen.** Die
 *    sind auf so einem Server leer. Gefuellt ist die des **Level-Moduls**:
 *    dort steht die Premium-Rolle seit jeher, weil sie den XP-Multiplikator
 *    und den kuerzeren Cooldown traegt - und `env-reader.ts` hat sie beim
 *    Umzug vom alten Bot genau dorthin uebernommen (`PREMIUM_ROLE_ID`).
 *
 * Beides zusammen hiess: die Pruefung lief, gab immer `false` zurueck, und
 * niemandem fiel es auf, weil kein Test sie je mit einer Rolle gesehen hat.
 *
 * ## Was hier bewusst nicht steht
 *
 * Kein Rollenname. «Premium» ist ein Name, und Namen aendern sich -
 * eine Abfrage darauf wuerde lautlos falsch, sobald jemand die Rolle
 * umbenennt. Gefragt wird nach der konfigurierten Kennung, so wie ueberall
 * sonst im System.
 */

/**
 * Die Kennungen, unter denen die Premium-Rolle konfiguriert sein kann.
 *
 * **Zwei Stellen, und beide zaehlen.** Das ist keine Nachlaessigkeit,
 * sondern der Zustand: `level.premiumRoleId` gibt es laenger und sie ist auf
 * bestehenden Installationen gefuellt; `premium.premiumRoleId` kam mit dem
 * Verkauf ueber SwissHub dazu und ist dort leer, wo nicht verkauft wird. Nur
 * eine davon zu lesen hiesse, die Haelfte der Installationen nicht zu
 * bedienen - und zwar lautlos.
 *
 * Doppelte und leere Werte fallen heraus. Stehen beide und sind sie
 * verschieden, zaehlen beide: zwei eingetragene Rollen sind zwei Rollen, die
 * jemand ausdruecklich eingetragen hat.
 *
 * Ein zweiter Grund fuer beide Quellen steht in den Einstellungsfeldern
 * selbst: das Feld im Premium-Modul traegt `mustBeManageable` und bietet
 * deshalb nur Rollen an, die **unter** der Bot-Rolle stehen. Eine Rolle, die
 * MEE6 vergibt, steht oft darueber - sie ist dort gar nicht auswaehlbar. Im
 * Level-Modul ist sie es.
 *
 * Kein `isModuleEnabled`: `getModuleSettings` liest die Einstellungen eines
 * Moduls unabhaengig davon, ob es laeuft. Genau darauf kommt es an.
 */
export async function premiumRollenIds(): Promise<string[]> {
  const [ausPremium, ausLevel] = await Promise.all([
    getModuleSettings<PremiumSettings>(PREMIUM_MODULE_ID).catch((fehler: unknown) => {
      log.warn('Premium-Einstellungen nicht lesbar', { fehler });
      return null;
    }),
    getModuleSettings<LevelSettings>(LEVEL_MODULE_ID).catch((fehler: unknown) => {
      log.warn('Level-Einstellungen nicht lesbar', { fehler });
      return null;
    }),
  ]);

  const gesammelt = [ausPremium?.premiumRoleId, ausLevel?.premiumRoleId];
  return [...new Set(gesammelt.filter((wert): wert is string => typeof wert === 'string' && wert !== ''))];
}

/**
 * Die Discord-Rollen eines Mitglieds - aus beiden Spiegeln.
 *
 * Der Mitgliederspiegel (`DiscordMemberCache`) wird vom Sync-Dienst gepflegt
 * und kann ein paar Minuten hinterherhinken. Der Identitaetsspiegel
 * (`DiscordIdentityCache`) wird bei jeder Anmeldung und vor jeder
 * schreibenden Aktion aufgefrischt - er ist fuer die Person, die gerade
 * etwas tut, der frischere der beiden.
 *
 * Beide zusammen, weil keiner von beiden allein genuegt: der eine kennt auch
 * Mitglieder, die sich nie angemeldet haben, der andere kennt die Rolle, die
 * vor einer Minute vergeben wurde. Eine Rolle, die in einem der beiden
 * steht, ist vergeben.
 */
async function rollenVon(discordId: string): Promise<Set<string>> {
  const [spiegel, identitaet] = await Promise.all([
    prisma.discordMemberCache.findUnique({ where: { discordId }, select: { roleIds: true } }),
    prisma.discordIdentityCache.findUnique({ where: { discordId }, select: { roleIds: true } }),
  ]);
  return new Set([...(spiegel?.roleIds ?? []), ...(identitaet?.roleIds ?? [])]);
}

/** Traegt dieses Mitglied die konfigurierte Premium-Rolle auf Discord? */
export async function traegtPremiumRolle(discordId: string): Promise<boolean> {
  const konfiguriert = await premiumRollenIds();
  if (konfiguriert.length === 0) {
    return false;
  }
  const rollen = await rollenVon(discordId);
  return konfiguriert.some((rolle) => rollen.has(rolle));
}

/**
 * Darf dieses Mitglied die Premium-Vorteile nutzen?
 *
 * **Die eine Frage, die jede Vorteilspruefung stellt.** Zwei Wege fuehren zu
 * «ja», und sie stehen gleichberechtigt nebeneinander:
 *
 * - ein laufendes Abonnement ueber SwissHub, oder
 * - die Premium-Rolle auf Discord.
 *
 * Der zweite Weg ist nicht der Notnagel, sondern auf diesem Server der
 * Normalfall. Wer eine neue Premium-Leistung baut, fragt diese Funktion -
 * nicht `hatAnspruch`. `hatAnspruch` beantwortet eine andere Frage, naemlich
 * «was hat diese Person ueber SwissHub bezahlt», und die gehoert in die
 * Abrechnung und in den Rollenabgleich, nicht vor eine Leistung.
 *
 * Das Abonnement wird zuerst gefragt: es ist die guenstigere Abfrage und auf
 * einem Server, der selbst verkauft, der haeufigere Fall.
 */
export async function darfPremiumVorteile(discordId: string): Promise<boolean> {
  if (await hatAnspruch(discordId, ENTITLEMENTS.premiumRole)) {
    return true;
  }
  return traegtPremiumRolle(discordId);
}
