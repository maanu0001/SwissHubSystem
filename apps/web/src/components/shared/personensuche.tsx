'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, Loader2, Search, X } from 'lucide-react';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Eine Person suchen und auswaehlen - genau eine.
 *
 * ## Warum sie hier steht und nicht im Workspace
 *
 * Weil dieselbe Frage an mehreren Stellen gestellt wird. Der Workspace fragt
 * «wen nehme ich ins Projekt», die XP-Slot-Verwaltung «wem schenke ich
 * Freispiele» - und bevor es diese Komponente gab, beantwortete die
 * Verwaltung sie mit einem Textfeld fuer die Discord-Kennung. Eine Kennung
 * ist achtzehn Ziffern; niemand kennt die eigene, geschweige denn die eines
 * anderen.
 *
 * Woher die Treffer kommen, entscheidet der Aufrufer: er gibt `suchen` mit,
 * eine Server Action mit seiner eigenen Berechtigungspruefung. Diese
 * Komponente weiss nichts ueber Projekte oder Freispiele - sie tippt, fragt,
 * zeigt und meldet die Wahl.
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
 * ## Warum serverseitig gesucht wird und nicht in einer uebergebenen Liste
 *
 * Hier stand ein Filter ueber eine Liste, die die Seite mitgeliefert hatte -
 * `ladeTeam()`, also die **angemeldeten** Benutzer mit `workspace.view`. Im
 * Betrieb hiess das: das Feld nahm Eingaben an, filterte und zeigte nichts.
 * Nicht weil der Filter kaputt war, sondern weil die Liste leer war. Auf
 * einem Server, dessen Mitglieder die WebApp kaum oeffnen, hat sich kaum
 * jemand je angemeldet; gemessen waren es 14 von 35 Mitgliedern, und zu
 * «manuel» passten 21 Leute, von denen **keiner** in der Liste stand.
 *
 * Gesucht wird deshalb dort, wo alle Mitglieder stehen: im Mitgliederspiegel,
 * durch `workspaceTeamSuchenAction`. Die Berechtigung bleibt die gleiche -
 * sie wird serverseitig an den Rollen geprueft und nicht mehr an der Frage,
 * ob sich jemand schon einmal eingeloggt hat.
 *
 * ## Warum die Trefferliste im Fluss steht und kein Popover ist
 *
 * Weil ein Popover genau die Fehler hat, die hier nicht auftreten sollen: es
 * wird von `overflow: hidden` der Kachel abgeschnitten, es landet hinter dem
 * naechsten Element, wenn eine z-index-Stufe fehlt, und auf einem Telefon
 * steht es ueber dem Feld, in das man gerade tippt. Eine Liste im Fluss
 * schiebt die Kachel auf und ist damit immer vollstaendig sichtbar - auf 390
 * und auf 360 Pixeln genauso wie auf dem Schreibtisch.
 *
 * ## Warum keine freie Texteingabe
 *
 * Das Feld sucht, es benennt nicht. Was nicht in der Liste steht, laesst
 * sich nicht waehlen - und `wert` ist eine Person aus dem Mitgliederspiegel
 * oder `null`. Ein Name, den jemand eintippt, kann kein Beteiligter werden;
 * es gibt keinen Weg, auf dem er einer wuerde.
 */

/**
 * Was von einer Person gebraucht wird, um sie zu zeigen.
 *
 * Absichtlich das Minimum: Kennung, Name, Benutzername, Avatar. Der Workspace
 * gibt `Teammitglied` herein, die Verwaltung ihre eigene Zeile - beide passen,
 * weil beide diese vier Felder haben. Ein gemeinsamer Typ waere eine
 * Abhaengigkeit zwischen zwei Modulen, die einander nichts zu sagen haben.
 */
export interface Personentreffer {
  discordId: string;
  name: string;
  username: string | null;
  avatarHash: string | null;
}

/**
 * Die Suche selbst - eine Server Action des Aufrufers.
 *
 * Sie traegt die Berechtigungspruefung: wer im Workspace sucht, braucht
 * `workspace.view`, wer in der Slot-Verwaltung sucht, die Verwaltung des
 * Moduls. Beides steht dort, wo es hingehoert, und nicht hier.
 */
export type Personensucher<T extends Personentreffer> = (
  begriff: string,
) => Promise<{ ok: true; data: { treffer: T[] } } | { ok: false; error?: { message?: string } }>;

/** Ab wie vielen Zeichen gesucht wird. */
const AB_ZEICHEN = 1;

/**
 * Wie lange nach dem letzten Tastendruck gewartet wird.
 *
 * Kurz genug, dass es sich wie Tippen anfuehlt, lang genug, dass «manuel»
 * eine Abfrage ist und nicht sechs.
 */
const ENTPRELLUNG_MS = 220;

export function Personensuche<T extends Personentreffer>({
  suchen,
  ausgeschlossen,
  wert,
  aufWahl,
  beschriftung = 'Person suchen',
  platzhalter = 'Name oder Benutzername',
  leerText = 'Niemand passt zu dieser Suche.',
  disabled = false,
}: {
  suchen: Personensucher<T>;
  /**
   * Wer nicht mehr in Frage kommt - die bereits Beteiligten.
   *
   * Sie werden aus den Treffern genommen und nicht vor der Abfrage
   * abgezogen: der Server weiss nicht, wer in dieser Kachel schon dabei ist,
   * und soll es auch nicht wissen muessen.
   */
  ausgeschlossen: readonly string[];
  /** Die gewaehlte Person - oder `null`. */
  wert: T | null;
  aufWahl: (person: T | null) => void;
  beschriftung?: string;
  platzhalter?: string;
  leerText?: string;
  disabled?: boolean;
}): React.JSX.Element {
  const [suche, setSuche] = useState('');
  const [treffer, setTreffer] = useState<readonly T[]>([]);
  const [laeuft, setLaeuft] = useState(false);
  /** Zu welchem Begriff die Treffer gehoeren - fuer «keine Ergebnisse». */
  const [beantwortet, setBeantwortet] = useState('');
  const [fehler, setFehler] = useState<string | null>(null);
  const feldId = useId();

  /*
   * Welche Antwort noch zaehlt.
   *
   * Zwei Abfragen koennen in anderer Reihenfolge zurueckkommen als sie
   * losgingen - «man» nach «manuel». Ohne diesen Zaehler stehen dann die
   * Treffer zum kuerzeren Begriff unter dem laengeren, und die Liste sieht
   * aus wie ein Zufall. Jede Antwort, die nicht zum letzten Lauf gehoert,
   * wird verworfen.
   */
  const laufRef = useRef(0);

  useEffect(() => {
    const begriff = suche.trim();
    if (begriff.length < AB_ZEICHEN) {
      laufRef.current += 1;
      setTreffer([]);
      setBeantwortet('');
      setLaeuft(false);
      setFehler(null);
      return;
    }

    const lauf = (laufRef.current += 1);
    setLaeuft(true);
    const uhr = setTimeout(() => {
      void (async () => {
        const antwort = await suchen(begriff);
        if (laufRef.current !== lauf) {
          return;
        }
        setLaeuft(false);
        if (!antwort.ok) {
          setFehler(antwort.error?.message ?? 'Die Suche hat nicht geklappt.');
          return;
        }
        setFehler(null);
        setTreffer(antwort.data.treffer);
        setBeantwortet(begriff);
      })();
    }, ENTPRELLUNG_MS);

    return (): void => {
      clearTimeout(uhr);
    };
  }, [suche, suchen]);

  /*
   * Bereits Beteiligte heraus - und die gewaehlte Person hinein.
   *
   * Das zweite ist der Grund, warum hier nicht nur gefiltert wird: wer
   * gewaehlt ist und dann weitertippt, verschwindet sonst aus der Liste, und
   * die Auswahl ist nur noch ein Zustand ohne Bild. Sie steht deshalb oben,
   * auch wenn sie zum aktuellen Begriff nicht passt.
   */
  const sichtbar = useMemo(() => {
    const draussen = new Set(ausgeschlossen);
    const liste = treffer.filter((person) => !draussen.has(person.discordId));
    if (wert && !liste.some((person) => person.discordId === wert.discordId)) {
      return [wert, ...liste];
    }
    return liste;
  }, [ausgeschlossen, treffer, wert]);

  const waehlen = useCallback(
    (person: T): void => {
      // Ein zweiter Klick auf die gewaehlte Person nimmt die Wahl zurueck -
      // sonst gibt es keinen Weg zurueck ausser einer anderen Wahl.
      aufWahl(wert?.discordId === person.discordId ? null : person);
    },
    [aufWahl, wert],
  );

  const begriff = suche.trim();
  const zuKurz = begriff.length < AB_ZEICHEN;
  const leer = !laeuft && !zuKurz && sichtbar.length === 0 && beantwortet === begriff;

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
          className="w-full min-w-0 pl-9 pr-9"
          disabled={disabled}
          autoComplete="off"
          role="combobox"
          aria-expanded={sichtbar.length > 0}
          aria-controls={`${feldId}-treffer`}
        />
        {laeuft ? (
          <Loader2
            className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
            aria-hidden="true"
          />
        ) : null}
      </div>

      {/*
        Die gewaehlte Person als Zeile ueber der Liste.

        Sie ist die Antwort auf «ist meine Auswahl noch da?» - und sie bleibt
        es, auch wenn der Begriff danach ein anderer ist.
      */}
      {wert ? (
        <div className="flex min-w-0 items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 p-2">
          <DiscordAvatar discordId={wert.discordId} avatarHash={wert.avatarHash} name={wert.name} size={28} />
          <span className="min-w-0 flex-1 truncate text-sm">{wert.name}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            onClick={(): void => aufWahl(null)}
            disabled={disabled}
            aria-label={`${wert.name} nicht auswählen`}
          >
            <X aria-hidden="true" className="size-4" />
          </Button>
        </div>
      ) : null}

      {zuKurz ? (
        <p className="text-xs text-muted-foreground">
          Tippe einen Namen oder Benutzernamen, um Personen zu finden.
        </p>
      ) : null}
      {fehler ? <p className="text-xs text-destructive">{fehler}</p> : null}
      {leer && !fehler ? <p className="text-xs text-muted-foreground">{leerText}</p> : null}

      {sichtbar.length > 0 ? (
        <ul
          id={`${feldId}-treffer`}
          className="max-h-52 space-y-1 overflow-y-auto"
          role="listbox"
          aria-label={beschriftung}
        >
          {sichtbar.map((person) => {
            const an = wert?.discordId === person.discordId;
            return (
              <li key={person.discordId}>
                <button
                  type="button"
                  role="option"
                  aria-selected={an}
                  disabled={disabled}
                  onClick={(): void => waehlen(person)}
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
      ) : null}
    </div>
  );
}
