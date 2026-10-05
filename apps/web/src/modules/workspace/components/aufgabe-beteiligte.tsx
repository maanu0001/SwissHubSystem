'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { UserMinus, UserPlus } from 'lucide-react';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Personensuche } from './personensuche';
import { workspaceZustaendigeSetzenAction } from '../actions';
import type { Teammitglied } from '../daten';

/**
 * Die Beteiligten einer Aufgabe.
 *
 * ## Warum eine eigene Kachel
 *
 * Weil es eine eigene Frage ist. Die Auswahl stand bisher in «Ändern», neben
 * Status, Priorität und dem Löschknopf - also neben Dingen, die man
 * gelegentlich tut, während «wer macht das» die Frage ist, die man an einer
 * Aufgabe als erstes stellt. Eine Kachel mit demselben Namen wie im Projekt
 * macht aus zwei Listen eine Gewohnheit.
 *
 * ## Beteiligt heisst hier verantwortlich
 *
 * Und zwar alle gleichwertig. An einer Aufgabe gibt es keine Projektleitung
 * und keine Unterstützung - diese Unterscheidung gehört ins Projekt, wo
 * jemand entscheidet, und nicht an die Aufgabe, wo jemand arbeitet. Wer hier
 * steht, ist zuständig; stehen drei Leute da, sind drei Leute zuständig.
 * Darum zeigt die Liste auch keine Funktion an: es gibt keine.
 *
 * ## Die Ordnung der Kachel
 *
 * Wie im Projekt, nur ohne die Rolle:
 *
 *   1. ein Suchfeld für **eine** Person,
 *   2. daneben «Hinzufügen»,
 *   3. darunter alle Beteiligten mit Gesicht, Name und einem
 *      Entfernen-Knopf je Zeile.
 *
 * Auf einem Telefon steht der Knopf unter dem Suchfeld, beide auf voller
 * Breite.
 *
 * ## Warum der Speicherknopf weg ist
 *
 * Hier stand eine Wolke aus Häkchen und darunter «Beteiligte speichern». Das
 * hatte einen Grund - bei «A raus, B rein» entstand sonst zwischendurch eine
 * Aufgabe ohne Beteiligte - und einen Preis: wer den Knopf vergass, hatte
 * nichts geändert, und das merkte er erst später.
 *
 * Mit je einer Handlung pro Klick stellt sich die Frage nicht mehr: ein
 * Hinzufügen fügt hinzu, ein Entfernen entfernt, und beides ist sofort
 * gespeichert. Der Zwischenzustand «niemand zuständig» entsteht dabei nur,
 * wenn jemand ihn ausdrücklich herstellt - und das darf er.
 */
export function AufgabeBeteiligte({
  csrfToken,
  taskId,
  beteiligte,
  team,
  darfBearbeiten,
}: {
  csrfToken: string;
  taskId: string;
  beteiligte: readonly string[];
  team: Teammitglied[];
  darfBearbeiten: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [laeuft, starte] = useTransition();
  /**
   * Der Stand liegt lokal, damit die Liste sofort stimmt.
   *
   * Die Antwort des Servers ist die Wahrheit, und `router.refresh()` holt
   * sie - aber das dauert einen Moment, und in diesem Moment soll die Zeile
   * schon weg sein. Scheitert die Handlung, wird der lokale Stand
   * zurückgesetzt.
   */
  const [stand, setStand] = useState<string[]>([...beteiligte]);
  /**
   * Wer als nächstes dazukommt - die ganze Person, nicht nur ihre Kennung.
   *
   * Gesucht wird serverseitig im Mitgliederspiegel, und wer dort gefunden
   * wird, steht nicht zwangsläufig in `team` - sonst hätte die Zeile nach
   * dem Hinzufügen keinen Namen.
   */
  const [gewaehlt, setGewaehlt] = useState<Teammitglied | null>(null);
  /** Zähler, der die Suche nach dem Hinzufügen zurücksetzt. */
  const [runde, setRunde] = useState(0);
  /** Wer in dieser Sitzung dazukam - bis `router.refresh()` durch ist. */
  const [dazu, setDazu] = useState<Record<string, Teammitglied>>({});

  const nachKennung = useMemo(() => {
    const karte = new Map(team.map((eintrag) => [eintrag.discordId, eintrag]));
    for (const [discordId, person] of Object.entries(dazu)) {
      karte.set(discordId, person);
    }
    return karte;
  }, [dazu, team]);

  const speichere = (naechster: string[], meldung: string): void => {
    const vorher = stand;
    setStand(naechster);
    starte(async () => {
      const antwort = await workspaceZustaendigeSetzenAction({
        csrfToken,
        taskId,
        discordIds: naechster,
      });
      if (!antwort.ok) {
        setStand(vorher);
        toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
        return;
      }
      toast.success(meldung);
      router.refresh();
    });
  };

  const hinzufuegen = (): void => {
    if (!gewaehlt) {
      toast.error('Wähle zuerst eine Person aus.');
      return;
    }
    if (stand.includes(gewaehlt.discordId)) {
      return;
    }
    const person = gewaehlt;
    setDazu((vorher) => ({ ...vorher, [person.discordId]: person }));
    setGewaehlt(null);
    setRunde((vorher) => vorher + 1);
    speichere([...stand, person.discordId], `${person.name} ist jetzt beteiligt.`);
  };

  const entfernen = (discordId: string): void => {
    const name = nachKennung.get(discordId)?.name ?? 'Die Person';
    speichere(
      stand.filter((eintrag) => eintrag !== discordId),
      `${name} ist nicht mehr beteiligt.`,
    );
  };

  /** Die Liste - mit oder ohne Entfernen-Knopf. */
  const liste = (
    <ul className="min-w-0 space-y-2">
      {stand.map((discordId) => {
        const person = nachKennung.get(discordId);
        return (
          <li key={discordId} className="flex min-w-0 items-center gap-2">
            <DiscordAvatar
              discordId={discordId}
              avatarHash={person?.avatarHash ?? null}
              name={person?.name ?? discordId}
              size={32}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{person?.name ?? discordId}</span>
              {person?.username && person.username !== person.name ? (
                <span className="block truncate text-[11px] text-muted-foreground">@{person.username}</span>
              ) : null}
              {!person ? (
                <span className="block truncate text-[11px] text-warning">
                  darf den Workspace nicht mehr öffnen
                </span>
              ) : null}
            </span>
            {darfBearbeiten ? (
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 text-muted-foreground hover:text-destructive"
                title="Von der Aufgabe entfernen"
                onClick={(): void => entfernen(discordId)}
              >
                <UserMinus aria-hidden="true" className="size-4" />
                <span className="sr-only">{person?.name ?? discordId} von der Aufgabe entfernen</span>
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );

  if (!darfBearbeiten) {
    /*
     * Ohne Berechtigung bleibt die Liste sichtbar, nur unveränderlich.
     *
     * Wer nicht zuweisen darf, will trotzdem wissen, wen er fragen muss -
     * eine leere Kachel wäre die schlechtere Auskunft.
     */
    return (
      <div className="min-w-0 space-y-2">
        {stand.length === 0 ? <p className="text-xs text-muted-foreground">Niemand beteiligt.</p> : liste}
        <p className="text-[11px] text-muted-foreground">
          Zum Ändern der Beteiligten fehlt dir die Berechtigung.
        </p>
      </div>
    );
  }

  return (
    <div className={cn('min-w-0 space-y-4', laeuft && 'pointer-events-none opacity-70')}>
      {/* ---------- 1. Hinzufügen: Person, Knopf ---------- */}
      <div className="min-w-0 space-y-2">
        <Personensuche
          key={runde}
          csrfToken={csrfToken}
          ausgeschlossen={stand}
          wert={gewaehlt}
          aufWahl={setGewaehlt}
          beschriftung="Person für die Aufgabe suchen"
          leerText="Niemand passt zu dieser Suche - oder die Treffer sind schon beteiligt."
        />
        {/*
          Auf dem Telefon über die ganze Breite, ab `sm` so breit wie sein
          Text. Eine feste Breite wäre an beiden Stellen falsch.
        */}
        <Button type="button" size="sm" className="w-full sm:w-auto" onClick={hinzufuegen}>
          <UserPlus aria-hidden="true" className="size-4" />
          Hinzufügen
        </Button>
      </div>

      {/* ---------- 2. Wer dabei ist ---------- */}
      <div className="min-w-0 space-y-2 border-t border-border pt-3">
        <p className="text-xs font-medium">Beteiligte</p>
        {stand.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Niemand beteiligt. Diese Aufgabe liegt damit bei niemandem - und steht bei niemandem unter «Meine
            Aufgaben».
          </p>
        ) : (
          liste
        )}
        <p className="text-[11px] text-muted-foreground">
          Alle Beteiligten sind gleichwertig verantwortlich - an einer Aufgabe gibt es keine Funktionen. Die
          Aufgabe erscheint bei jedem von ihnen unter «Meine Aufgaben».
        </p>
      </div>
    </div>
  );
}
