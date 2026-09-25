import { prisma } from '@swisshub/database';
import { bootstrapConfig } from '@swisshub/config';
import {
  MEMBER_PERMISSIONS,
  hasPermission,
  loadRoleConfiguration,
  resolvePermissions,
} from '@swisshub/permissions';
import { ENTITLEMENTS } from '../premium/entitlements';
import { hatAnspruch } from '../premium/queries';

/**
 * Wer die Premium-Profildesigns verwenden darf.
 *
 * ## Die eine Regel
 *
 * **Aktives Premium ODER die Berechtigung `members.profile.themes.premium`.**
 * Mehr steht hier nicht, und mehr soll hier nicht stehen: jede Stelle, die
 * ein Design zulaesst oder ablehnt - das Speichern, das Zeichnen, die
 * Galerie -, fragt genau diese Funktion. Zwei Stellen mit derselben Regel
 * waeren zwei Stellen, an denen sie irgendwann verschieden lautet, und
 * auffallen wuerde es an der, die niemand prueft.
 *
 * ## Warum kein Rollenname
 *
 * «Admin» und «Moderator» sind Rollennamen, und Rollennamen aendern sich.
 * Eine Abfrage darauf wuerde lautlos falsch, sobald jemand eine Rolle
 * umbenennt oder eine zweite Moderationsrolle einfuehrt. Was jemand darf,
 * steht unter Server -> Berechtigungen - hier wie im ganzen System.
 *
 * ## Was die Berechtigung nicht tut
 *
 * Sie ist **kein Premium**. Sie oeffnet die Designs der oeffentlichen
 * Profilseite und sonst nichts: keine Discord-Rolle, keine Abzeichen, kein
 * sonstiger Anspruch. Die bestehende Premium-Pruefung bleibt unveraendert
 * daneben stehen - diese Funktion fragt sie, sie ersetzt sie nicht.
 */

/**
 * Woher das Recht kommt.
 *
 * Fuer die Oberflaeche, damit sie den Unterschied benennen kann: «dein
 * Abonnement» ist eine andere Auskunft als «deine Rolle im Team». Und fuer
 * den Fall, dass beides zutrifft - dann zaehlt das Abonnement, weil es die
 * Person selbst bezahlt hat.
 */
export type ThemeZugang = 'premium' | 'berechtigung' | 'keiner';

/**
 * Hat diese Person die Berechtigung fuer alle Designs?
 *
 * Aufgeloest aus den Discord-Rollen des Spiegels und der
 * Rollenkonfiguration - derselbe Weg, den auch die Benachrichtigungen gehen.
 * Eine eigene Abfrage waere eine zweite Vorstellung davon, was eine
 * Berechtigung ist.
 */
async function hatThemeBerechtigung(discordId: string): Promise<boolean> {
  const [konfiguration, spiegel] = await Promise.all([
    loadRoleConfiguration(),
    prisma.discordMemberCache.findUnique({ where: { discordId }, select: { roleIds: true } }),
  ]);

  const aufloesung = resolvePermissions(
    {
      discordId,
      roleIds: spiegel?.roleIds ?? [],
      isOwner: bootstrapConfig.ownerDiscordId === discordId,
    },
    konfiguration.mappings,
  );
  return hasPermission(aufloesung, MEMBER_PERMISSIONS.themesPremium);
}

/**
 * Darf diese Person die Premium-Designs verwenden - und woher kommt das Recht?
 *
 * Die Reihenfolge ist Absicht: erst das Abonnement, dann die Berechtigung.
 * Wer bezahlt, soll das auch angezeigt bekommen, selbst wenn er nebenbei im
 * Team ist.
 */
export async function themeZugang(discordId: string): Promise<ThemeZugang> {
  if (await hatAnspruch(discordId, ENTITLEMENTS.premiumRole)) {
    return 'premium';
  }
  return (await hatThemeBerechtigung(discordId)) ? 'berechtigung' : 'keiner';
}

/** Die Ja-Nein-Antwort - fuer Aufrufer, denen die Herkunft egal ist. */
export async function darfPremiumThemes(discordId: string): Promise<boolean> {
  return (await themeZugang(discordId)) !== 'keiner';
}
