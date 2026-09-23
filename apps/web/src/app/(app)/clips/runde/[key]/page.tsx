import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Trophy } from 'lucide-react';
import { clips } from '@swisshub/modules';
import { systemRoutes } from '@swisshub/shared';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { EmptyState } from '@/components/shared/states';
import { ZurueckLink } from '@/components/shared/zurueck-link';
import { Galerie, type GalerieEintrag } from '@/modules/clips/components/galerie';
import { GewinnerBuehne } from '@/modules/clips/components/gewinner-buehne';
import { requirePagePermission, csrfTokenFor } from '@/server/auth';
import { ladeClipStand } from '@/server/clips';

export const metadata: Metadata = { title: 'Clip of the Week' };
export const dynamic = 'force-dynamic';

const RANG_STIL: Record<number, string> = {
  2: 'bg-[hsl(0_0%_78%)] text-black',
  3: 'bg-[hsl(28_60%_48%)] text-white',
};

/**
 * Das Ergebnis einer Woche.
 *
 * Erst der Gewinner - gross, mit Player -, dann die Plaetze zwei und drei,
 * dann alles uebrige. Die Reihenfolge ist die Nachricht: eine Rangliste, die
 * mit Platz eins in Zeile eins einer Tabelle beginnt, feiert niemanden.
 */
export default async function ClipRundePage({
  params,
}: {
  params: Promise<{ key: string }>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission(clips.CLIPS_PERMISSIONS.view);
  const { key } = await params;
  const stand = await ladeClipStand(context);

  const runde = await clips.rundeNachSchluessel(stand.guildId, decodeURIComponent(key));
  if (!runde) {
    notFound();
  }

  const [treppchen, galerie, zahlen] = await Promise.all([
    clips.siegertreppchen(runde.id, 3),
    clips.galerie({
      competitionId: runde.id,
      betrachterDiscordId: context.user.discordId,
      sortierung: 'stimmen',
      proSeite: 60,
    }),
    clips.rundenZahlen(runde.id),
  ]);

  const gewinner = treppchen[0] ?? null;
  const weitere = galerie.karten.filter((karte) => karte.entryId !== gewinner?.entryId);
  const eintraege: GalerieEintrag[] = weitere.map((karte) => ({
    karte,
    einbettung: clips.einbettung(karte, stand.hostname),
  }));

  return (
    <div className="space-y-8">
      <ZurueckLink fallback={systemRoutes.hallOfFame()} fallbackLabel="Hall of Fame" />

      {gewinner ? (
        <GewinnerBuehne
          karte={gewinner}
          einbettung={clips.einbettung(gewinner, stand.hostname)}
          nummer={runde.number}
          teilnehmer={zahlen.freigegeben}
          stimmen={zahlen.stimmen}
          shareUrl={`/api/clips/share/${encodeURIComponent(runde.key)}`}
          dateiname={`swisshub-clip-of-the-week-${runde.number}.png`}
        />
      ) : (
        <EmptyState
          title="Diese Runde hat keinen Gewinner"
          description={
            runde.status === 'CANCELLED'
              ? 'Die Runde wurde abgebrochen.'
              : 'Es wurde kein Clip freigegeben oder es ging keine Stimme ein.'
          }
        />
      )}

      {treppchen.length > 1 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Auch vorne dabei</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {treppchen.slice(1).map((karte) => {
              const name = karte.einreicher.displayName ?? karte.einreicher.username ?? 'Unbekannt';
              return (
                <li
                  key={karte.entryId}
                  className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3"
                >
                  <span
                    className={`grid size-9 shrink-0 place-items-center rounded-full text-sm font-semibold ${
                      RANG_STIL[karte.rang ?? 0] ?? 'bg-secondary'
                    }`}
                  >
                    {karte.rang}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium leading-tight">{karte.titel}</p>
                    <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <DiscordAvatar
                        discordId={karte.einreicher.discordId}
                        avatarHash={karte.einreicher.avatarHash}
                        name={name}
                        size={20}
                      />
                      <span className="truncate">{name}</span>
                    </span>
                  </div>
                  <span className="flex shrink-0 items-center gap-1 text-sm tabular-nums text-muted-foreground">
                    <Trophy className="size-3.5" aria-hidden="true" />
                    {karte.stimmen ?? 0}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {eintraege.length > 0 ? (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Alle Clips dieser Woche</h2>
          <Galerie
            eintraege={eintraege}
            csrfToken={csrfTokenFor(context)}
            // Eine abgeschlossene Runde nimmt keine Stimmen mehr an - und der
            // Knopf sagt das, statt es erst nach dem Klick zu tun.
            abstimmbar={false}
            verbleibendeStimmen={0}
            selbstwahlErlaubt={runde.allowSelfVote}
          />
        </section>
      ) : null}
    </div>
  );
}
