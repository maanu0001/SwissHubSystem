import type { Metadata } from 'next';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { can } from '@swisshub/auth';
import { bootstrapConfig } from '@swisshub/config';
import { prisma } from '@swisshub/database';
import {
  PERMISSION_PRESETS,
  aufloeseAltlasten,
  findPresetDrift,
  isRecoveryNeeded,
  listPermissions,
} from '@swisshub/permissions';
import { listModuleDefinitions } from '@swisshub/modules';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PermissionMatrix } from '@/modules/configuration/components/permission-matrix';
import { permissionGesundheit } from '@/modules/configuration/permission-gesundheit';
import { csrfTokenFor, hasSetupAccess, requirePagePermission } from '@/server/auth';
import { loadDiscordOptions } from '@/server/configuration';
import { DokuHinweis } from '@/modules/docs/components/doku-link';

export const metadata: Metadata = { title: 'Berechtigungen' };
export const dynamic = 'force-dynamic';

/**
 * Berechtigungsverwaltung.
 *
 * Ordnet Discord-Rollen die Berechtigungen des Dashboards zu. Die Anwendung
 * fragt nie nach Rollen-IDs, sondern immer nach Berechtigungen - hier wird die
 * Zuordnung gepflegt.
 */
export default async function ServerPermissionsPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission('permissions.manage', { allowDuringSetup: true });
  const csrfToken = csrfTokenFor(context);

  const [options, managedRoles, recoveryNeeded, setupAccess, gesundheit] = await Promise.all([
    loadDiscordOptions(),
    prisma.managedRole.findMany({
      orderBy: { moderationLevel: 'desc' },
      include: { permissions: { select: { permission: true, effect: true } } },
    }),
    isRecoveryNeeded(),
    hasSetupAccess(),
    permissionGesundheit(),
  ]);

  const moduleLabels: Record<string, string> = { core: 'Grundfunktionen' };
  for (const definition of listModuleDefinitions()) {
    moduleLabels[definition.id] = definition.name;
  }

  return (
    <>
      <DokuHinweis slug="berechtigungen" />

      {recoveryNeeded ? (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-5" aria-hidden="true" />
              Keine Rolle darf aktuell verwalten
            </CardTitle>
            <CardDescription>
              Solange keiner Rolle „Berechtigungen verwalten“ oder „Vollzugriff“ zugewiesen ist, kommt nach
              einer Abmeldung niemand mehr in diesen Bereich.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              {bootstrapConfig.ownerDiscordId
                ? 'Der Notzugang über SWISSHUB_OWNER_DISCORD_ID ist gesetzt - dieses Konto behält in jedem Fall Vollzugriff.'
                : 'Es ist kein Notzugang gesetzt. Bitte jetzt einer Rolle Vollzugriff geben.'}
            </p>
            <p className="text-xs text-muted-foreground">
              Alternativ auf dem Server: <code>npm run grant:admin -- &lt;ROLLEN_ID&gt;</code>
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/*
        Der Zustand der Rechtedaten - nur wenn es etwas zu sagen gibt.

        Eine Kachel, die «alles in Ordnung» meldet, liest nach drei Wochen
        niemand mehr. Darum steht hier nichts, solange nichts ist.
      */}
      {gesundheit.altlasten.length > 0 || gesundheit.unbenannt.length > 0 ? (
        <Card className={gesundheit.unbenannt.length > 0 ? 'border-warning/40' : undefined}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-warning" aria-hidden="true" />
              Alte Berechtigungen in den Rollendaten
            </CardTitle>
            <CardDescription>
              {gesundheit.registriert} Berechtigungen sind registriert, {gesundheit.zuordnungen} Zuordnungen
              gespeichert. Diese Schlüssel kennt die Registry nicht mehr - sie blockieren nichts und
              verschwinden, sobald die betroffene Rolle das nächste Mal gespeichert wird.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {gesundheit.altlasten.length > 0 ? (
              <ul className="space-y-1">
                {gesundheit.altlasten.map((eintrag) => (
                  <li key={eintrag.key} className="flex flex-wrap items-baseline gap-x-2">
                    <code className="text-xs">{eintrag.key}</code>
                    <span className="text-xs text-muted-foreground">
                      {eintrag.zeilen} {eintrag.zeilen === 1 ? 'Zeile' : 'Zeilen'} · {eintrag.grund}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            {gesundheit.unbenannt.length > 0 ? (
              <div className="space-y-1">
                <p className="text-xs font-medium text-warning">
                  Nicht benannt - weder registriert noch als entfernt vermerkt:
                </p>
                <ul className="space-y-1">
                  {gesundheit.unbenannt.map((eintrag) => (
                    <li key={eintrag.key} className="flex flex-wrap items-baseline gap-x-2">
                      <code className="text-xs">{eintrag.key}</code>
                      <span className="text-xs text-muted-foreground">
                        {eintrag.zeilen} {eintrag.zeilen === 1 ? 'Zeile' : 'Zeilen'}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  Entweder war ein Modul beim Nachsehen nicht geladen, oder etwas schreibt einen Namen, den es
                  nicht gibt.
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-primary" aria-hidden="true" />
            Rollen und Berechtigungen
          </CardTitle>
          <CardDescription>
            Discord-Rollen bestimmen, wer im Dashboard was darf. Die letzte verwaltende Rolle lässt sich nicht
            entwerten - dadurch kann sich niemand versehentlich aussperren.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PermissionMatrix
            csrfToken={csrfToken}
            canEdit={can(context, 'permissions.manage') || setupAccess}
            roles={options.roles}
            abweichungen={Object.fromEntries(
              managedRoles.flatMap((role) => {
                // Nur die Erlaubnisse gehoeren in den Vorlagenvergleich. Eine
                // ausdrueckliche Ausnahme ist bewusst gesetzt und darf nicht
                // als «fehlt gegenueber der Vorlage» wieder auftauchen.
                const drift = findPresetDrift(
                  role.permissions
                    .filter((entry) => entry.effect === 'ALLOW')
                    .map((entry) => entry.permission),
                );
                return drift
                  ? [
                      [
                        role.discordRoleId,
                        { presetLabel: drift.preset.label, fehlend: drift.fehlend },
                      ] as const,
                    ]
                  : [];
              }),
            )}
            managed={managedRoles.map((role) => ({
              discordRoleId: role.discordRoleId,
              label: role.label,
              /*
               * Was die Datenbank hergibt, aber nur das, was es noch gibt.
               *
               * Hier wurden die Zuordnungen einer Rolle unveraendert in die
               * Oberflaeche gegeben. Schluessel entfernter Module kamen mit,
               * hatten in der Matrix kein Haekchen - und fuhren beim
               * Speichern trotzdem mit zurueck zum Server, der die ganze
               * Konfiguration deshalb ablehnte. Sichtbar war nur die Folge:
               * «Unbekannte Berechtigung: members.view.spielersuche.own».
               *
               * `aufloeseAltlasten` ist dieselbe Funktion, die die
               * Server-Aktion benutzt. Dass hier und dort dasselbe entschieden
               * wird, ist der Grund, aus dem die Vorschau («29 von 366») und
               * das, was danach in der Datenbank steht, nicht auseinanderlaufen
               * koennen: beide zaehlen dieselbe Liste.
               */
              permissions: aufloeseAltlasten(
                role.permissions.filter((entry) => entry.effect === 'ALLOW').map((entry) => entry.permission),
              ).gueltig,
              deniedPermissions: aufloeseAltlasten(
                role.permissions.filter((entry) => entry.effect === 'DENY').map((entry) => entry.permission),
              ).gueltig,
              isProtected: role.isProtected,
              keepOnJail: role.keepOnJail,
              moderationLevel: role.moderationLevel,
            }))}
            permissions={listPermissions().map((permission) => ({
              key: permission.key,
              label: permission.label,
              description: permission.description,
              module: permission.module,
              critical: permission.critical,
            }))}
            presets={PERMISSION_PRESETS.map((preset) => ({
              id: preset.id,
              label: preset.label,
              description: preset.description,
              critical: preset.critical,
            }))}
            moduleLabels={moduleLabels}
          />
        </CardContent>
      </Card>
    </>
  );
}
