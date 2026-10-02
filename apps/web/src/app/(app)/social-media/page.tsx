import type { Metadata } from 'next';
import Link from 'next/link';
import { Clapperboard, Gift, MessageCircleQuestion, Send } from 'lucide-react';
import { resolveGuildId } from '@swisshub/discord';
import { socialmedia } from '@swisshub/modules';
import { StatCard } from '@/components/shared/stat-card';
import { Badge } from '@/components/ui/badge';
import { EmptyState, ErrorState } from '@/components/shared/states';
import { ModulNavigation } from '@/components/shared/modul-navigation';
import { requirePagePermission } from '@/server/auth';
import {
  ladeExportKarten,
  ladeSocialMediaStand,
  ladeSocialMediaZahlen,
  socialMediaBereiche,
} from '@/server/socialmedia';

export const metadata: Metadata = { title: 'Social Media' };
export const dynamic = 'force-dynamic';

/**
 * Die Uebersicht des Social-Media-Bereichs.
 *
 * ## Welche Frage sie beantwortet
 *
 * «Was poste ich heute?» - und zwar ohne vorher zu wissen, in welchem Modul die
 * Antwort liegt. Vorher gab es vier Exportflaechen an vier Stellen, und man
 * musste sie alle kennen.
 *
 * ## Warum hier nichts bearbeitet wird
 *
 * Jede Zeile fuehrt in das Modul, dem die Daten gehoeren. Dort gelten dessen
 * Rechte, dort steht dessen Verlauf, dort entsteht die Grafik. Diese Seite
 * besitzt nichts - sie weiss nur, wo etwas liegt.
 */
export default async function SocialMediaPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(socialmedia.SOCIAL_MEDIA_PERMISSIONS.view);
  const guildId = await resolveGuildId();
  const stand = await ladeSocialMediaStand(context, guildId);

  if (!stand.aktiv) {
    return (
      <ErrorState
        title="Modul deaktiviert"
        description="Social Media ist derzeit ausgeschaltet. In den Moduleinstellungen lässt es sich einschalten."
      />
    );
  }

  const [zahlen, karten] = await Promise.all([ladeSocialMediaZahlen(stand), ladeExportKarten(stand)]);
  const offene = karten.filter((karte) => karte.offen);

  return (
    <div className="space-y-6">
      {/* Keine eigene Hauptueberschrift: «Social Media» steht schon in der
          Kopfzeile der Anwendung. */}
      <ModulNavigation
        eintraege={socialMediaBereiche(stand)}
        aktiv="uebersicht"
        label="Bereiche in Social Media"
      />

      {stand.fragtOffen || stand.clipsOffen || stand.wrappedOffen ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Wartet auf einen Post"
            value={offene.length}
            icon={<Send aria-hidden="true" />}
            hint={offene.length === 1 ? 'eine Sache' : 'über alle Quellen'}
          />
          {stand.fragtOffen ? (
            <StatCard
              label="Ergebnisse ohne Post"
              value={zahlen.fragtOffeneExporte}
              icon={<MessageCircleQuestion aria-hidden="true" />}
              hint={`${zahlen.fragtGepostet} schon gepostet`}
            />
          ) : null}
          {stand.clipsOffen ? (
            <StatCard
              label="Clip-Runden"
              value={zahlen.clipsRunden}
              icon={<Clapperboard aria-hidden="true" />}
              hint="mit Teilen-Karte"
            />
          ) : null}
          {stand.wrappedOffen ? (
            <StatCard
              label="Rückblicke"
              value={zahlen.wrappedVeroeffentlicht}
              icon={<Gift aria-hidden="true" />}
              hint={`von ${zahlen.wrappedGesamt} angelegt`}
            />
          ) : null}
        </div>
      ) : null}

      {karten.length === 0 ? (
        <EmptyState
          title="Noch nichts zu posten"
          description={
            stand.fragtOffen || stand.clipsOffen || stand.wrappedOffen
              ? 'Sobald eine Abstimmung schliesst, eine Clip-Runde endet oder ein Rückblick entsteht, steht es hier.'
              : 'Es ist kein Modul eingeschaltet, das Grafiken erzeugt - oder du hast für keines davon die Rechte. SwissHub fragt, Clip of the Week und Wrapped speisen diesen Bereich.'
          }
        />
      ) : (
        <ul className="grid gap-3">
          {karten.map((karte) => (
            <li key={`${karte.quelle}-${karte.href}`}>
              <Link
                href={karte.href}
                className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 transition hover:border-primary/40 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{QUELLE_TEXT[karte.quelle]}</Badge>
                    {karte.offen ? <Badge variant="default">Offen</Badge> : null}
                  </div>
                  <p className="truncate text-sm font-medium">{karte.titel}</p>
                </div>
                <p className="shrink-0 text-xs text-muted-foreground">{karte.hinweis}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const QUELLE_TEXT: Record<'fragt' | 'clips' | 'wrapped', string> = {
  fragt: 'SwissHub fragt',
  clips: 'Clip of the Week',
  wrapped: 'Wrapped',
};
