'use client';

import { useEffect } from 'react';
import './globals.css';

/**
 * Die letzte Auffanglinie.
 *
 * ## Warum es diese Datei zusaetzlich zu `error.tsx` gibt
 *
 * `error.tsx` faengt alles, was **unterhalb** des Wurzel-Layouts schiefgeht -
 * und das ist fast alles. Zwei Faelle liegen darunter: ein Fehler im
 * Wurzel-Layout selbst und ein Fehler in `error.tsx`. Fuer die gab es bisher
 * nichts, und Next zeigt dann seine eigene Seite: im Betrieb eine weisse
 * Flaeche mit «Application error: a client-side exception has occurred».
 *
 * Das ist selten. Aber es ist genau der Moment, in dem jemand nicht weiss, ob
 * er etwas falsch gemacht hat, ob seine Daten weg sind oder ob die Anwendung
 * tot ist - und die weisse Seite sagt ihm keines davon.
 *
 * ## Warum sie so karg ist
 *
 * Weil sie `<html>` und `<body>` selbst mitbringen muss: an dieser Stelle hat
 * das Wurzel-Layout nicht funktioniert, und sich auf dessen Rahmen zu
 * verlassen hiesse, auf das zu bauen, was gerade kaputt ist. Aus demselben
 * Grund stehen hier keine Komponenten aus dem Designsystem - jede davon ist
 * ein weiterer Baustein, der scheitern kann. Die Stilangaben sind deshalb
 * unmittelbar und verwenden dieselben Farbvariablen wie alles andere; faellt
 * auch das Stylesheet aus, bleibt lesbarer Text auf dunklem Grund.
 *
 * Technische Einzelheiten erscheinen nicht - nur die Referenz, dieselbe
 * Regel wie in `error.tsx`. Mit ihr findet ein Administrator den
 * vollstaendigen Fehler im Serverprotokoll.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.JSX.Element {
  useEffect(() => {
    console.error('Unerwarteter Fehler im Wurzel-Layout', error.digest ?? '');
  }, [error]);

  return (
    <html lang="de-CH" className="dark">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          padding: '4rem 1rem',
          background: 'hsl(240 6% 7%)',
          color: 'hsl(0 0% 98%)',
          fontFamily: 'system-ui, sans-serif',
          textAlign: 'center',
        }}
      >
        <div style={{ maxWidth: '32rem' }}>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 600, margin: '0 0 0.75rem' }}>
            Die Seite konnte nicht geladen werden
          </h1>
          <p style={{ margin: '0 0 1.5rem', lineHeight: 1.6, color: 'hsl(0 0% 70%)' }}>
            Es ist ein unerwarteter Fehler aufgetreten, noch bevor die Oberfläche stand. Deine Daten sind
            davon nicht betroffen. Bitte lade die Seite neu – bleibt es dabei, wende dich an einen
            Administrator.
          </p>
          {error.digest ? (
            <p style={{ margin: '0 0 1.5rem', fontSize: '0.75rem', color: 'hsl(0 0% 55%)' }}>
              Referenz: <code style={{ fontFamily: 'ui-monospace, monospace' }}>{error.digest}</code>
            </p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            style={{
              padding: '0.55rem 1.1rem',
              borderRadius: '0.5rem',
              border: '1px solid hsl(0 0% 25%)',
              background: 'hsl(359 93% 27%)',
              color: 'hsl(0 0% 98%)',
              fontSize: '0.875rem',
              cursor: 'pointer',
            }}
          >
            Seite neu laden
          </button>
        </div>
      </body>
    </html>
  );
}
