import 'server-only';
import { can } from '@swisshub/auth';
import { resolveGuildId } from '@swisshub/discord';
import { getModuleSettings, isModuleEnabled, wrapped } from '@swisshub/modules';
import { prisma } from '@swisshub/database';
import type { AuthContext } from '@swisshub/auth';
import type { WrappedCampaign } from '@swisshub/database';

/**
 * Der gemeinsame Zustand der Wrapped-Seiten.
 *
 * ## Warum hier und nicht in jeder Seite
 *
 * Studio, Kampagnenblatt, Vorschau und der Rueckblick selbst brauchen
 * dieselben vier Antworten: Ist das Modul an? Welche Guild? Was darf die
 * aufrufende Person? Und gibt es gerade etwas Veroeffentlichtes? Vier
 * Seiten, die das einzeln beantworten, geben frueher oder spaeter vier
 * verschiedene Antworten - und die falsche davon bestimmt, ob jemand einen
 * Knopf sieht, den er nicht druecken darf.
 */

export interface WrappedStand {
  aktiv: boolean;
  guildId: string;
  /** Die aktuell veroeffentlichte Kampagne - null, wenn keine laeuft. */
  veroeffentlicht: WrappedCampaign | null;
  darfAnsehen: boolean;
  darfStudio: boolean;
  darfBearbeiten: boolean;
  darfVorschau: boolean;
  darfErzeugen: boolean;
  darfVeroeffentlichen: boolean;
}

export async function ladeWrappedStand(context: AuthContext): Promise<WrappedStand> {
  const aktiv = await isModuleEnabled(wrapped.WRAPPED_MODULE_ID);
  const guildId = await resolveGuildId();

  return {
    aktiv,
    guildId,
    veroeffentlicht: aktiv ? await wrapped.aktuelleVeroeffentlichung(guildId) : null,
    darfAnsehen: can(context, wrapped.WRAPPED_PERMISSIONS.viewOwn),
    darfStudio: can(context, wrapped.WRAPPED_PERMISSIONS.studioView),
    darfBearbeiten: can(context, wrapped.WRAPPED_PERMISSIONS.studioEdit),
    darfVorschau: can(context, wrapped.WRAPPED_PERMISSIONS.preview),
    darfErzeugen: can(context, wrapped.WRAPPED_PERMISSIONS.generate),
    darfVeroeffentlichen: can(context, wrapped.WRAPPED_PERMISSIONS.publish),
  };
}

/**
 * Der Hinweis auf der Startseite - oder nichts.
 *
 * ## Warum das hier und nicht im Dashboard steht
 *
 * Weil drei Bedingungen zusammenkommen muessen: das Modul ist an, eine
 * Kampagne ist veroeffentlicht, und diese Person hat ueberhaupt eine
 * Momentaufnahme. Ein Hinweis auf einen Rueckblick, den es fuer diese
 * Person nicht gibt, waere die unfreundlichste Variante von allen.
 *
 * Gibt `null` zurueck, wenn eine davon nicht erfuellt ist.
 */
export async function ladeWrappedHinweis(context: AuthContext): Promise<{
  titel: string;
  schluessel: string;
  jahr: number;
  gesehen: boolean;
} | null> {
  if (!can(context, wrapped.WRAPPED_PERMISSIONS.viewOwn)) {
    return null;
  }
  if (!(await isModuleEnabled(wrapped.WRAPPED_MODULE_ID))) {
    return null;
  }

  const einstellungen = await getModuleSettings<wrapped.WrappedSettings>(wrapped.WRAPPED_MODULE_ID);
  if (!einstellungen.showDashboardTeaser) {
    return null;
  }

  const guildId = await resolveGuildId();
  const campaign = await wrapped.aktuelleVeroeffentlichung(guildId);
  if (!campaign) {
    return null;
  }

  const [momentaufnahme, gesehen] = await Promise.all([
    prisma.wrappedSnapshot.findUnique({
      where: { campaignId_discordId: { campaignId: campaign.id, discordId: context.user.discordId } },
      select: { id: true },
    }),
    prisma.wrappedView.findUnique({
      where: { campaignId_discordId: { campaignId: campaign.id, discordId: context.user.discordId } },
      select: { firstOpenedAt: true },
    }),
  ]);
  if (!momentaufnahme) {
    return null;
  }

  return {
    titel: campaign.title,
    schluessel: campaign.key,
    jahr: campaign.displayYear,
    gesehen: gesehen !== null,
  };
}

/** Der Handelnde fuer das Protokoll - ueberall dieselbe Form. */
export function wrappedHandelnder(context: AuthContext): wrapped.Handelnder {
  return { discordId: context.user.discordId, username: context.user.username };
}

/** Lesbarer Zustand einer Kampagne. */
export const WRAPPED_STATUS_TEXT: Record<string, string> = {
  DRAFT: 'Entwurf',
  PREPARING: 'Momentaufnahmen laufen',
  READY: 'Bereit',
  PUBLISHED: 'Veröffentlicht',
  ARCHIVED: 'Archiviert',
};

/** Die Farbe zum Zustand - dieselbe Zuordnung an jeder Stelle. */
export const WRAPPED_STATUS_FARBE: Record<
  string,
  'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'destructive'
> = {
  DRAFT: 'secondary',
  PREPARING: 'warning',
  READY: 'default',
  PUBLISHED: 'success',
  ARCHIVED: 'outline',
};

/** Datum und Uhrzeit, immer in Zürcher Zeit. */
export const wrappedZeit = (datum: Date): string =>
  datum.toLocaleString('de-CH', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Zurich',
  });

/** Nur das Datum - fuer Zeitraeume, bei denen die Uhrzeit nur stoert. */
export const wrappedTag = (datum: Date): string =>
  datum.toLocaleDateString('de-CH', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Europe/Zurich',
  });
