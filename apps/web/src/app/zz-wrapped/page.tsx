import { wrapped } from '@swisshub/modules';
import { WrappedStory } from '@/modules/wrapped/story';

/** Temporäre Messseite - wird nach der visuellen Abnahme entfernt. */
export const dynamic = 'force-dynamic';

export default async function Vorschau({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  const persona = wrapped.PERSONA_NACH_KEY.get(params.persona ?? 'allrounder');
  const daten = (persona ?? wrapped.WRAPPED_PERSONAS[0]!).bauen(2026);
  const keys = wrapped.baueGeschichte(
    daten,
    wrapped.WRAPPED_SZENEN.map((s) => ({ sceneKey: s.key, enabled: s.standardAktiv, position: s.position })),
  );
  const start = Number.parseInt(params.szene ?? '0', 10);

  return (
    <WrappedStory
      daten={daten}
      sceneKeys={keys}
      jahr={2026}
      zurueckHref="/"
      startIndex={Number.isFinite(start) ? start : 0}
      einzeln={params.einzeln === '1'}
      ruhig={params.ruhig === '1'}
      vorschau={{ label: `Entwurf · ${keys.length} Szenen` }}
    />
  );
}
