'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { Teammitglied } from '@/modules/workspace/daten';

/**
 * Wer zustaendig ist - mit Gesicht und Suche.
 *
 * ## Warum eine Komponente und nicht zwei
 *
 * Diese Auswahl stand zweimal: einmal im Anlegen-Formular, einmal in der
 * Steuerung einer bestehenden Aufgabe. Zwei gleich aussehende Listen, die
 * getrennt gepflegt wurden - und entsprechend auseinandergelaufen sind: im
 * Formular war sie beim Bearbeiten gar nicht da, und Avatare hatte keine von
 * beiden. Jetzt gibt es eine.
 *
 * ## Warum Avatare
 *
 * Weil man Leute an Gesichtern erkennt und nicht an Namen, die sich aehneln.
 * `DiscordAvatar` ist die eine Avatar-Darstellung der Anwendung - sie liefert
 * immer ein Bild, auch ohne Hash.
 *
 * ## Warum die Suche erst ab einer gewissen Groesse
 *
 * Ein Suchfeld ueber fuenf Namen ist Moebel. Ab zwoelf ist das Scrollen die
 * Zumutung - dann erscheint es.
 */

const SUCHE_AB = 12;

export function ZustaendigWahl({
  team,
  gewaehlt,
  aufAendern,
  disabled = false,
  hinweis,
  beschriftung = 'Beteiligte',
}: {
  team: readonly Teammitglied[];
  gewaehlt: readonly string[];
  aufAendern: (discordId: string) => void;
  disabled?: boolean;
  hinweis?: string;
  /**
   * Die Ueberschrift der Auswahl.
   *
   * Vorgabe «Beteiligte» - dasselbe Wort wie im Projekt, damit es an beiden
   * Stellen dieselbe Sache bezeichnet. Hier stand «Zustaendig», und daneben
   * hiess es im Projekt «Beteiligte»; zwei Namen fuer eine Liste sind ein
   * Grund, zu glauben, es seien zwei Listen.
   */
  beschriftung?: string;
}): React.JSX.Element | null {
  const [suche, setSuche] = useState('');

  const gefiltert = useMemo(() => {
    const begriff = suche.trim().toLowerCase();
    if (begriff === '') {
      return team;
    }
    /*
     * Gewaehlte bleiben sichtbar, auch wenn sie nicht zum Suchbegriff passen.
     *
     * Sonst verschwindet, wen man schon ausgewaehlt hat, sobald man nach der
     * naechsten Person sucht - und man nimmt sie versehentlich wieder heraus,
     * weil man glaubt, sie sei nicht dabei.
     */
    return team.filter(
      (mitglied) =>
        gewaehlt.includes(mitglied.discordId) ||
        mitglied.name.toLowerCase().includes(begriff) ||
        // Auch der Benutzername: zwei «Max» auf einem Server sind keine
        // Seltenheit, und der Benutzername ist eindeutig.
        (mitglied.username ?? '').toLowerCase().includes(begriff),
    );
  }, [team, suche, gewaehlt]);

  if (team.length === 0) {
    return null;
  }

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{beschriftung}</legend>

      {team.length >= SUCHE_AB ? (
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={suche}
            onChange={(ereignis): void => setSuche(ereignis.target.value)}
            placeholder="Name oder Benutzername"
            aria-label={`${beschriftung} suchen`}
            className="pl-9"
            disabled={disabled}
          />
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {gefiltert.map((mitglied) => {
          const an = gewaehlt.includes(mitglied.discordId);
          return (
            <label
              key={mitglied.discordId}
              className={cn(
                'flex min-h-11 items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm transition-colors',
                disabled ? 'cursor-not-allowed' : 'cursor-pointer',
                an
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground',
                disabled && 'opacity-60',
              )}
            >
              <input
                type="checkbox"
                checked={an}
                disabled={disabled}
                onChange={(): void => aufAendern(mitglied.discordId)}
                className="sr-only"
              />
              <DiscordAvatar
                discordId={mitglied.discordId}
                avatarHash={mitglied.avatarHash}
                name={mitglied.name}
                size={28}
              />
              <span className="min-w-0 truncate">
                {mitglied.name}
                {/*
                  Der Benutzername nur, wenn er etwas hinzufuegt - und nur in
                  der Suche sichtbar klein. Eine Zeile mit «max · max» waere
                  dieselbe Auskunft zweimal.
                */}
                {mitglied.username && mitglied.username !== mitglied.name ? (
                  <span className="ml-1 text-[11px] text-muted-foreground">@{mitglied.username}</span>
                ) : null}
              </span>
            </label>
          );
        })}
        {gefiltert.length === 0 ? (
          <p className="text-xs text-muted-foreground">Niemand passt zu dieser Suche.</p>
        ) : null}
      </div>

      <p className="text-xs text-muted-foreground">
        {hinweis ??
          'Alle Beteiligten sind gleichwertig verantwortlich. Angeboten werden die, die den Workspace öffnen dürfen.'}
      </p>
    </fieldset>
  );
}
