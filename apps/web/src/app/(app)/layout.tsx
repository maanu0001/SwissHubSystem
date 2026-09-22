import { branding } from '@swisshub/config/client';
import { guildIconUrl, guildLink } from '@swisshub/discord/cdn';
import {
  branding as brandingModule,
  buildNavigation,
  resolveNavigationSignals,
  moduleViewPermission,
  enabledModuleIds,
  getGuildConfig,
  groupNavigation,
  premium as premiumModule,
  readBotStatus,
  tickets as ticketsModule,
} from '@swisshub/modules';
import { dashboardRoleLabel, loadRoleConfiguration } from '@swisshub/permissions';
import { can } from '@swisshub/auth';
import { AppShell } from '@/components/layout/app-shell';
import { currentGuild } from '@/server/guild';
import { csrfTokenFor, hasSetupAccess, requireMember } from '@/server/auth';
import { glockeFuer } from '@/server/notifications';
import { PREVIEW_PERMISSIONS } from '@/server/preview';
import { ticketViewer } from '@/server/tickets';

const APP_ROLE_LABEL: Record<string, string> = {
  OWNER: 'Owner',
  ADMIN: 'Administrator',
  MODERATOR: 'Moderator',
  TEAM: 'Team',
  USER: 'Mitglied',
};

/**
 * Geschütztes Grundlayout.
 *
 * Der Zugriff wird hier serverseitig geprüft; Navigation, Seitentitel und
 * Modulzähler entstehen aus der Module Registry und den effektiven
 * Berechtigungen. Fällt Discord aus, bleibt die Oberfläche bedienbar.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.JSX.Element> {
  const context = await requireMember();

  const [moduleIds, bot, guild, guildConfig, logoUrl] = await Promise.all([
    enabledModuleIds(),
    readBotStatus(),
    currentGuild(),
    getGuildConfig(),
    brandingModule.currentLogoUrl(),
  ]);

  /**
   * Offene Tickets fuer die Zahl neben dem Eintrag.
   *
   * Nur, wenn das Modul laeuft, und faellt die Abfrage aus, bleibt die Zahl
   * weg: eine Seitenleiste, die an einer Zaehlung scheitert, waere ein teurer
   * Preis fuer eine Nebensaechlichkeit.
   */
  const offeneTickets = moduleIds.has(ticketsModule.TICKETS_MODULE_ID)
    ? await ticketsModule.countOpenTickets(ticketViewer(context)).catch(() => null)
    : null;

  /**
   * Zustand für die Hinweiskarte in der Seitenleiste.
   *
   * Ist Premium eingeschaltet, führt die Karte auf `/premium`; wer bereits
   * abonniert hat, sieht dort sein Angebot statt einer Werbung. Ist das Modul
   * aus, bleibt die Karte unverändert.
   */
  const premiumKarte = moduleIds.has(premiumModule.PREMIUM_MODULE_ID)
    ? await premiumModule
        .getActiveSubscription(context.user.id)
        .then((abo) => ({
          planName: abo && premiumModule.grantsEntitlements(abo.status) ? `${abo.product.name} aktiv` : null,
        }))
        .catch(() => ({ planName: null }))
    : null;

  // Der verbundene Server steht in der Datenbank; Discord liefert nur die
  // aktuellen Anzeigedaten und darf ausfallen.
  const guildId = guild?.id ?? guildConfig.guildId;

  /**
   * Während der Einrichtung besitzt ein Discord-Administrator noch keine
   * Dashboard-Berechtigungen. Damit die Seitenleiste nicht leer bleibt, werden
   * für die Navigation die Konfigurationsbereiche ergänzt. Das ist reine
   * Darstellung - jede Seite und jede Aktion prüft weiterhin serverseitig.
   */
  const setupAccess = await hasSetupAccess();
  const dashboardLabel = await dashboardRoleLabel(context.roleIds).catch(() => null);
  const navigationKeys = setupAccess
    ? [
        ...new Set([
          ...context.permissionKeys,
          'settings.view',
          'permissions.manage',
          'modules.manage',
          // Ohne «Modul sehen» blieben die Konfigurationsbereiche trotz der
          // Ergaenzung oben unsichtbar - und die Einrichtung liesse sich
          // nicht abschliessen.
          moduleViewPermission('settings'),
          moduleViewPermission('modules'),
        ]),
      ]
    : context.permissionKeys;

  /*
   * Die Laufzeit-Kennzeichen der Navigation.
   *
   * Manche Bereiche gibt es nur zeitweise - das XP-Gluecksrad steht in der
   * Seitenleiste, solange eine Verlosung laeuft und einen Tag danach. Welche
   * Bedingung das ist, weiss allein das jeweilige Modul; hier wird sie einmal
   * aufgeloest und an die Navigation gereicht.
   *
   * Einmal, nicht dreimal: Seitenleiste, mobile Navigation und
   * Schnellnavigation bekommen alle dieselbe fertige Liste. Ein Bereich, der
   * auf dem Telefon steht und am Rechner fehlt, kann so gar nicht entstehen.
   */
  /*
   * Die Glocke - immer die des **echten** Kontos.
   *
   * In einer Vorschau wird sie gar nicht erst geladen: persönliche
   * Benachrichtigungen einer anderen Person sind ihr Posteingang, nicht ihre
   * Oberfläche. Die eigenen zu zeigen wäre ebenso falsch - die Vorschau
   * behauptete dann etwas, das die Person so nie sähe. Die Glocke bleibt
   * deshalb stumm und sagt im Titel, warum.
   */
  const benachrichtigungen = context.preview
    ? { eintraege: [], ungelesen: 0 }
    : await glockeFuer(context).catch(() => ({ eintraege: [], ungelesen: 0 }));

  /*
   * Wer eine Vorschau starten darf - und mit welchen Rollen.
   *
   * `can()` fragt in einer laufenden Vorschau die Schnittmenge ab. Das ist
   * hier genau richtig: der Eintrag «Ansicht als …» verschwindet, solange
   * eine Vorschau läuft, und der Weg zurück führt über den Banner. Zwei
   * ineinander verschachtelte Vorschauen wären ein Zustand, den niemand mehr
   * überblickt.
   */
  const darfVorschau = can(context, PREVIEW_PERMISSIONS.use) && !context.preview;
  const vorschauRollen =
    darfVorschau && can(context, PREVIEW_PERMISSIONS.role)
      ? await loadRoleConfiguration()
          // Die verwalteten Rollen stehen bereits in der Rollenkonfiguration,
          // die die Permission Engine ohnehin laedt - und sie ist zwischen-
          // gespeichert. Eine eigene Abfrage waere eine zweite Quelle
          // derselben Liste.
          .then((konfiguration) =>
            [...konfiguration.roleLabels.entries()]
              .map(([id, name]) => ({ id, name }))
              .sort((a, b) => a.name.localeCompare(b.name)),
          )
          .catch(() => [])
      : [];

  const signals = await resolveNavigationSignals();
  const navigation = buildNavigation(navigationKeys, moduleIds, signals);
  const groups = groupNavigation(navigation).map((group) => ({
    id: group.id,
    collapsible: group.collapsible,
    label: group.label,
    items: group.items.map((item) => ({
      href: item.href,
      label: item.label,
      icon: item.icon,
      moduleId: item.moduleId,
      group: item.group,
      badge: item.badge,
      count: item.counter === 'openTickets' ? (offeneTickets ?? undefined) : undefined,
    })),
  }));

  const titles = navigation.flatMap((item) => [
    { href: item.href, label: item.label, description: item.description },
    // Ein Modul kann einen weiteren Pfad beanspruchen (siehe `titlePrefix`).
    // Die Kopfzeile nimmt den laengsten Treffer, der genauere Eintrag oben
    // gewinnt also weiterhin.
    ...(item.titlePrefix
      ? [{ href: item.titlePrefix, label: item.label, description: item.description }]
      : []),
  ]);

  return (
    <AppShell
      groups={groups}
      titles={titles}
      benachrichtigungen={{
        eintraege: benachrichtigungen.eintraege.map((eintrag) => ({
          ...eintrag,
          createdAt: eintrag.createdAt.toISOString(),
        })),
        ungelesen: benachrichtigungen.ungelesen,
        csrfToken: csrfTokenFor(context),
        vorschauAktiv: context.preview !== undefined,
      }}
      vorschau={context.preview ? { kind: context.preview.kind, label: context.preview.label } : null}
      permissions={context.permissionKeys}
      bot={{ online: bot.online, wsPingMs: bot.wsPingMs }}
      discordUrl={guildId ? guildLink(guildId) : guildLink('@me')}
      logoUrl={logoUrl}
      premium={premiumKarte}
      server={{
        name: guild?.name ?? guildConfig.name ?? branding.name,
        iconUrl: guildId ? guildIconUrl(guildId, guild?.iconHash ?? guildConfig.iconHash, 64) : null,
        memberCount: guild?.approximateMemberCount ?? guildConfig.memberCount ?? bot.guildMemberCount,
        botOnline: bot.online,
      }}
      user={{
        discordId: context.user.discordId,
        displayName: context.user.displayName,
        username: context.user.username,
        avatarHash: context.user.avatarHash,
        // Die «Bezeichnung im Dashboard» aus dem Berechtigungsmodul - dort
        // wird sie gepflegt, hier nur gelesen. Fehlt sie, bleibt es bei der
        // groben Einordnung.
        primaryRole: dashboardLabel ?? APP_ROLE_LABEL[context.user.appRole] ?? 'Mitglied',
        csrfToken: csrfTokenFor(context),
        guildId: guildId ?? '',
        vorschau: darfVorschau
          ? {
              darfBenutzer: can(context, PREVIEW_PERMISSIONS.user),
              darfRolle: can(context, PREVIEW_PERMISSIONS.role),
              rollen: vorschauRollen,
            }
          : null,
      }}
    >
      {children}
    </AppShell>
  );
}
