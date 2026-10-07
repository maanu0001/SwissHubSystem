'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { hervorhebe, type TokenArt } from './hervorhebung';
import type { CodeSprache } from '../typen';

/**
 * Ein Codeblock mit Hervorhebung und Kopierknopf.
 *
 * ## Warum er nicht ueberlaeuft
 *
 * `min-w-0` am Container und `overflow-x-auto` am `<pre>`: lange Zeilen
 * scrollen **im Block** und nicht die Seite. Ohne das `min-w-0` gewinnt der
 * Inhalt im Grid-Kind und schiebt die ganze Seite breit - auf dem Telefon der
 * Unterschied zwischen lesbar und kaputt.
 *
 * `whitespace-pre` statt Umbruch: umgebrochener Code ist falsch dargestellter
 * Code, und wer eine Zeile kopiert, will sie so, wie sie im Repository steht.
 */
const FARBE: Record<TokenArt, string> = {
  klar: '',
  // Aus den Design-Tokens, damit beide Themes tragen.
  kommentar: 'text-muted-foreground italic',
  text: 'text-success',
  zahl: 'text-warning',
  schluessel: 'text-primary-bright font-medium',
};

export function CodeBlock({
  inhalt,
  sprache,
  titel,
}: {
  inhalt: string;
  sprache: CodeSprache;
  titel?: string;
}): React.JSX.Element {
  const [kopiert, setKopiert] = useState(false);
  const token = hervorhebe(inhalt, sprache);

  const kopieren = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(inhalt);
      setKopiert(true);
      window.setTimeout(() => setKopiert(false), 1500);
    } catch {
      /*
       * `navigator.clipboard` gibt es nicht ohne HTTPS und nicht in jedem
       * eingebetteten Browser. Dann bleibt der Knopf stumm - der Code steht
       * ja da und laesst sich auswaehlen. Eine Fehlermeldung waere hier
       * lauter als der Nutzen.
       */
    }
  };

  return (
    <div className="w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-border/60 bg-muted/30">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
          {titel ?? sprache}
        </span>
        <button
          type="button"
          onClick={() => void kopieren()}
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Code kopieren"
        >
          {kopiert ? (
            <Check className="size-3.5 text-success" aria-hidden="true" />
          ) : (
            <Copy className="size-3.5" aria-hidden="true" />
          )}
          {kopiert ? 'Kopiert' : 'Kopieren'}
        </button>
      </div>
      <pre className="max-w-full overflow-x-auto px-2.5 py-2.5 text-[11.5px] leading-relaxed sm:px-3 sm:py-3 sm:text-[12.5px]">
        <code className="whitespace-pre font-mono">
          {token.map((stueck, index) => (
            <span key={index} className={cn(FARBE[stueck.art])}>
              {stueck.wert}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

/**
 * Ein einzelner Befehl - `/xp-slot`, `npm run check`.
 *
 * Eine Zeile braucht keine Kopfzeile mit Sprachangabe; sie braucht den Knopf
 * und sonst nichts.
 */
export function BefehlZeile({ befehl }: { befehl: string }): React.JSX.Element {
  const [kopiert, setKopiert] = useState(false);
  return (
    <div className="flex w-full min-w-0 max-w-full items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-2.5 py-2 sm:px-3">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre font-mono text-[11.5px] sm:text-[12.5px]">
        {befehl}
      </code>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard
            ?.writeText(befehl)
            .then(() => {
              setKopiert(true);
              window.setTimeout(() => setKopiert(false), 1500);
            })
            .catch(() => undefined);
        }}
        className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
        aria-label={`${befehl} kopieren`}
      >
        {kopiert ? (
          <Check className="size-3.5 text-success" aria-hidden="true" />
        ) : (
          <Copy className="size-3.5" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
