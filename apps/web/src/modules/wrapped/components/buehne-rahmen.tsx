'use client';

import { useEffect } from 'react';
import { WrappedStory } from '@/modules/wrapped/story';
import type { StoryProps } from '@/modules/wrapped/story';

/**
 * Die Buehne im Rahmen - mit einer Meldung nach draussen.
 *
 * Das Studio zeigt neben dem Rahmen an, welche Szene gerade laeuft. Der
 * Rahmen ist ein eigenes Dokument, also geht die Meldung ueber
 * `postMessage` - und zwar ausdruecklich nur an dasselbe Herkunftsfeld.
 * Ein `'*'` als Ziel waere hier bequem und falsch: die Nachricht ginge an
 * jede Seite, die dieses Dokument einbettet, und das koennte irgendwann
 * eine fremde sein.
 *
 * Nur eine Richtung. Der Rahmen nimmt nichts entgegen - was er zeigt, steht
 * in seiner Adresse, und das ist die ganze Schnittstelle.
 */
export const WRAPPED_BUEHNE_MELDUNG = 'wrapped:szene';

export function BuehneRahmen(props: StoryProps & { hilfslinien?: boolean }): React.JSX.Element {
  const { hilfslinien = false, ...rest } = props;

  useEffect(() => {
    if (window.parent === window) {
      return;
    }
    window.parent.postMessage(
      { typ: WRAPPED_BUEHNE_MELDUNG, bereit: true, gesamt: rest.sceneKeys.length },
      window.location.origin,
    );
  }, [rest.sceneKeys.length]);

  return (
    <WrappedStory
      {...rest}
      aufSzene={(info) => {
        if (window.parent === window) {
          return;
        }
        window.parent.postMessage({ typ: WRAPPED_BUEHNE_MELDUNG, ...info }, window.location.origin);
      }}
      overlay={hilfslinien ? <Hilfslinien /> : rest.overlay}
    />
  );
}

/**
 * Sichere Raender und Mittelachsen.
 *
 * Nur in der Vorschau, nie im echten Rueckblick. Sie zeigen genau das, was
 * beim Betrachten am haeufigsten danebengeht: dass etwas zu nah am Rand
 * steht oder eine Komposition nur zufaellig mittig aussieht.
 */
function Hilfslinien(): React.JSX.Element {
  return (
    <div className="pointer-events-none absolute inset-0 z-30" aria-hidden="true">
      <div className="absolute inset-y-0 left-6 border-l border-dashed border-cyan-400/50" />
      <div className="absolute inset-y-0 right-6 border-r border-dashed border-cyan-400/50" />
      <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-cyan-400/30" />
      <div className="absolute inset-y-0 left-1/2 border-l border-dashed border-cyan-400/30" />
      <div className="absolute inset-x-0 top-0 h-[max(3.5rem,env(safe-area-inset-top))] bg-cyan-400/10" />
      <div className="absolute inset-x-0 bottom-0 h-[max(3.5rem,env(safe-area-inset-bottom))] bg-cyan-400/10" />
    </div>
  );
}
