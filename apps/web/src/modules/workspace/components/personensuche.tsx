'use client';

import { useId, useMemo, useState } from 'react';
import { Check, Search } from 'lucide-react';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { Teammitglied } from '@/modules/workspace/daten';

/**
 * Eine Person suchen und auswaehlen - genau eine.
 *
 * ## Warum es diese Komponente gibt
 *
 * Weil Projekt und Aufgabe dieselbe Frage stellen («wen nehme ich dazu») und
 * sie bisher unterschiedlich beantworteten: das Projekt mit einer Liste von
 * Knoepfen, die beim Klick sofort speicherte, die Aufgabe mit einer Wolke von
 * Haekchen und einem Speicherknopf. Zwei Bedienmuster fuer eine Handlung sind
 * eine Gewohnheit, die man zweimal lernen muss.
 *
 * Jetzt beide gleich: tippen, eine Person waehlen, auf «Hinzufuegen»
 * klicken. Die Rolle kommt im Projekt dazwischen, an der Aufgabe gibt es
 * keine - das ist der einzige Unterschied, und er steht dort, wo er
 * hingehoert.
 *
 * ## Warum Auswahl und Hinzufuegen zwei Schritte sind
 *
 * Weil im Projekt zwischen beiden eine Entscheidung liegt: die Rolle. Ein
 * Klick, der sofort hinzufuegt, muesste sie vorher erraten - und hier stand
 * genau das, mit «Unterstuetzung» als Annahme. Wer eine zweite
 * Projektleitung wollte, fuegte hinzu und stufte um: zwei Schritte und zwei
 * Eintraege im Verlauf fuer eine Entscheidung.
 *
 * Fuer die Aufgabe waere ein Schritt genug. Trotzdem derselbe Weg, weil
 * dasselbe Aussehen an zwei Stellen mehr wert ist als ein gesparter Klick an
 * einer.
 *
 * ## Warum keine freie Texteingabe
 *
 * Das Feld sucht, es benennt nicht. Was nicht in der Liste steht, laesst
 * sich nicht waehlen - und `wert` ist die Kennung einer Person aus dem Team
 * oder `null`. Ein Name, den jemand eintippt, kann kein Beteiligter werden;
 * es gibt keinen Weg, auf dem er einer wuerde.
 */
export function Personensuche({
  team,
  wert,
  aufWahl,
  beschriftung = 'Person suchen',
  platzhalter = 'Name oder Benutzername',
  leerText = 'Niemand passt zu dieser Suche.',
  disabled = false,
}: {
  /** Wer in Frage kommt. Bereits Beteiligte gehoeren **nicht** hierher. */
  team: readonly Teammitglied[];
  /** Die gewaehlte Kennung - oder `null`. */
  wert: string | null;
  aufWahl: (discordId: string | null) => void;
  beschriftung?: string;
  platzhalter?: string;
  leerText?: string;
  disabled?: boolean;
}): React.JSX.Element {
  const [suche, setSuche] = useState('');
  const feldId = useId();

  const gefiltert = useMemo(() => {
    const begriff = suche.trim().toLowerCase();
    if (begriff === '') {
      return team;
    }
    return team.filter(
      (eintrag) =>
        eintrag.name.toLowerCase().includes(begriff) ||
        // Auch der Benutzername: zwei «Max» auf einem Server sind keine
        // Seltenheit, und der Benutzername ist eindeutig.
        (eintrag.username ?? '').toLowerCase().includes(begriff),
    );
  }, [team, suche]);

  return (
    <div className="min-w-0 space-y-2">
      <label htmlFor={feldId} className="sr-only">
        {beschriftung}
      </label>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          id={feldId}
          value={suche}
          onChange={(ereignis): void => setSuche(ereignis.target.value)}
          placeholder={platzhalter}
          /*
           * `w-full` plus `min-w-0`: ein Eingabefeld hat eine
           * Standardbreite aus seinem `size`-Attribut, und die ist breiter
           * als ein Telefon in einer zweispaltigen Zeile. Ohne das hier
           * druckt es die Zeile auf und die Seite laeuft ueber.
           */
          className="w-full min-w-0 pl-9"
          disabled={disabled}
          autoComplete="off"
        />
      </div>

      {gefiltert.length === 0 ? (
        <p className="text-xs text-muted-foreground">{leerText}</p>
      ) : (
        <ul className="max-h-52 space-y-1 overflow-y-auto" role="listbox" aria-label={beschriftung}>
          {gefiltert.map((person) => {
            const an = wert === person.discordId;
            return (
              <li key={person.discordId}>
                <button
                  type="button"
                  role="option"
                  aria-selected={an}
                  disabled={disabled}
                  // Ein zweiter Klick auf die gewaehlte Person nimmt die
                  // Wahl zurueck - sonst gibt es keinen Weg zurueck ausser
                  // einer anderen Wahl.
                  onClick={(): void => aufWahl(an ? null : person.discordId)}
                  className={cn(
                    'flex min-h-11 w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors',
                    an ? 'bg-primary/10 ring-1 ring-primary' : 'hover:bg-muted',
                    disabled && 'cursor-not-allowed opacity-60',
                  )}
                >
                  <DiscordAvatar
                    discordId={person.discordId}
                    avatarHash={person.avatarHash}
                    name={person.name}
                    size={28}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{person.name}</span>
                    {/*
                      Der Benutzername nur, wenn er etwas hinzufuegt.
                      «anna · anna» ist keine Auskunft.
                    */}
                    {person.username && person.username !== person.name ? (
                      <span className="block truncate text-[11px] text-muted-foreground">
                        @{person.username}
                      </span>
                    ) : null}
                  </span>
                  {an ? <Check aria-hidden="true" className="size-4 shrink-0 text-primary" /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
