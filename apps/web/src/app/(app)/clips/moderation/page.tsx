import type { Metadata } from 'next';
import Link from 'next/link';
import { clips } from '@swisshub/modules';
import { systemRoutes } from '@swisshub/shared';
import { PageHeader } from '@/components/shared/page-header';
import { ErrorState } from '@/components/shared/states';
import { ClipAbschnittsNav } from '@/modules/clips/components/abschnitts-nav';
import {
  ModerationsListe,
  type ModerationsEintragMitEinbettung,
} from '@/modules/clips/components/moderations-liste';
import { requirePagePermission, csrfTokenFor } from '@/server/auth';
import { clipAbschnitte, ladeClipStand } from '@/server/clips';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Clip-Moderation' };
export const dynamic = 'force-dynamic';

const ANSICHTEN = [
  { key: 'offen', label: 'Offen' },
  { key: 'gemeldet', label: 'Gemeldet' },
  { key: 'alle', label: 'Alle' },
] as const;

type Ansicht = (typeof ANSICHTEN)[number]['key'];

export default async function ClipModerationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission(clips.CLIPS_PERMISSIONS.moderate);
  const params = await searchParams;
  const stand = await ladeClipStand(context);

  const ansicht: Ansicht =
    params.ansicht === 'gemeldet' || params.ansicht === 'alle' ? params.ansicht : 'offen';

  const offen = stand.runde ? await clips.offeneModeration(stand.runde.id) : 0;
  const nav = <ClipAbschnittsNav abschnitte={clipAbschnitte(context, offen)} />;

  if (!stand.aktiv || !stand.runde) {
    return (
      <div className="space-y-6">
        {nav}
        <ErrorState title="Keine Runde" description="Es gibt zurzeit keine Runde zu moderieren." />
      </div>
    );
  }

  const liste = await clips.moderationsListe(stand.runde.id, ansicht);
  const eintraege: ModerationsEintragMitEinbettung[] = liste.map((eintrag) => ({
    eintrag,
    einbettung: clips.einbettung(eintrag, stand.hostname),
  }));

  return (
    <div className="space-y-6">
      {nav}
      <PageHeader
        title="Moderation"
        description={`Runde #${stand.runde.number} · ${offen} ${offen === 1 ? 'Einreichung wartet' : 'Einreichungen warten'}`}
      />

      <div className="flex gap-2">
        {ANSICHTEN.map((eintrag) => (
          <Link
            key={eintrag.key}
            href={
              eintrag.key === 'offen'
                ? `${systemRoutes.clips()}/moderation`
                : `${systemRoutes.clips()}/moderation?ansicht=${eintrag.key}`
            }
            aria-current={ansicht === eintrag.key ? 'true' : undefined}
            className={cn(
              'rounded-full border px-3 py-1.5 text-sm transition',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              ansicht === eintrag.key
                ? 'border-primary bg-primary/10 text-foreground'
                : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground',
            )}
          >
            {eintrag.label}
          </Link>
        ))}
      </div>

      <ModerationsListe eintraege={eintraege} csrfToken={csrfTokenFor(context)} />
    </div>
  );
}
