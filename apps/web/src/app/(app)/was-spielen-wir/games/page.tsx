import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { games, isModuleEnabled, spielwahl } from '@swisshub/modules';
import { systemRoutes } from '@swisshub/shared';
import { PageHeader } from '@/components/shared/page-header';
import { ErrorState } from '@/components/shared/states';
import { GamesVerwaltung, type GameZeile } from '@/modules/spielwahl/components/games-verwaltung';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';

export const metadata: Metadata = {
  title: 'Spielekatalog',
  description: 'Die Spiele pflegen, aus denen alle Module auswählen.',
};
export const dynamic = 'force-dynamic';

/**
 * Der Spielekatalog.
 *
 * ## Warum er hier steht
 *
 * Irgendwo muss die Liste gepflegt werden, und «Was spielen wir?» ist der
 * Ort, an dem man sie am haeufigsten braucht: wer eine Runde eroeffnet und
 * ein Spiel vermisst, ist zwei Klicks entfernt. Turniere und Clips lesen
 * dieselbe Liste - sie haben nur keinen Grund, sie zu bearbeiten.
 *
 * Die Zustaendigkeit liegt damit hier; der Katalogdienst selbst
 * (`packages/modules/src/games`) kennt die Spielwahl nicht.
 *
 * ## Berechtigung
 *
 * `spielwahl.games.manage`. `requirePagePermission` verlangt damit auch
 * `spielwahl.module.view` - wer das Modul gar nicht sieht, soll nicht ueber
 * eine Adresse in seiner Verwaltung landen. Geprueft wird ausserdem im
 * Dienst, bei jeder einzelnen Aenderung.
 */
export default async function SpielekatalogPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(spielwahl.SPIELWAHL_PERMISSIONS.gamesManage);

  if (!(await isModuleEnabled(spielwahl.SPIELWAHL_MODULE_ID))) {
    return <ErrorState title="Nicht verfügbar" description="«Was spielen wir?» ist derzeit ausgeschaltet." />;
  }

  // Die Verwaltung sieht alles - auch Abgeschaltetes und Archiviertes. Was
  // davon angezeigt wird, entscheidet der Filter in der Oberflaeche.
  const [spiele, nutzung] = await Promise.all([
    games.listGames({ includeDisabled: true, includeArchived: true }),
    games.nutzungJeGame(),
  ]);

  const zeilen: GameZeile[] = spiele.map((spiel) => ({
    id: spiel.id,
    name: spiel.name,
    shortName: spiel.shortName,
    description: spiel.description,
    genre: spiel.genre,
    platforms: spiel.platforms,
    coverSrc: games.coverSrc(spiel),
    coverUrl: spiel.coverUrl,
    hatUpload: spiel.coverPath !== null,
    maxPlayers: spiel.maxPlayers,
    enabled: spiel.enabled,
    archiviert: spiel.archivedAt !== null,
    nutzung: nutzung.get(spiel.id) ?? { turniere: 0, clips: 0, runden: 0 },
  }));

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <Link
        href={systemRoutes.spielwahl()}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Zurück zu «Was spielen wir?»
      </Link>

      <PageHeader
        title="Spielekatalog"
        description="Eine Liste für alle: Runden, Turniere und Clips wählen aus denselben Spielen."
      />

      <GamesVerwaltung
        spiele={zeilen}
        csrfToken={csrfTokenFor(context)}
        maxCoverBytes={games.MAX_COVER_BYTES}
      />
    </div>
  );
}
