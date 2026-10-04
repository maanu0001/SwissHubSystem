'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Archive, Plus, Search, UserMinus } from 'lucide-react';
import type { WorkspaceMemberRole } from '@swisshub/database';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { ROLLE_LABEL } from '../labels';
import {
  workspaceMitgliederSetzenAction,
  workspaceProjektArchivierenAction,
  workspaceProjektZurueckholenAction,
} from '../actions';
import type { Teammitglied } from '../daten';

/**
 * Mitglieder, Archivieren, Zurückholen.
 *
 * ## Warum Archivieren eine Bestätigung braucht und Zurückholen nicht
 *
 * Weil das eine das Projekt aus allen Ansichten nimmt und das andere es
 * wiederbringt. Ein versehentliches Zurückholen merkt man sofort und macht es
 * mit einem Klick rückgängig; ein versehentliches Archivieren merkt man
 * vielleicht in zwei Wochen, wenn jemand sein Projekt nicht mehr findet.
 *
 * ## Warum die Beteiligten eine Liste und ein Picker sind
 *
 * Hier stand einmal das ganze Team als Liste von Auswahlfeldern, jedes mit
 * «nicht beteiligt / Mitglied / Projektleitung», darunter ein Knopf
 * «Mitglieder speichern». Das hatte drei Probleme, und alle drei fielen erst
 * im Betrieb auf:
 *
 *  1. **Die Beteiligten waren nicht erkennbar.** Wer dabei ist, stand
 *     verteilt zwischen allen, die nicht dabei sind - bei dreissig
 *     Teammitgliedern eine Suchaufgabe.
 *  2. **Entfernen passierte stillschweigend.** Wer den Workspace nicht mehr
 *     öffnen durfte, fiel beim nächsten Speichern aus dem Projekt, weil er in
 *     der Liste gar nicht vorkam. Ein Hinweis stand dabei, aber die Handlung
 *     war ein Nebeneffekt des Speicherns.
 *  3. **Nichts war sofort da.** Jede Änderung brauchte den Knopf; wer ihn
 *     vergass, hatte nichts geändert.
 *
 * Jetzt oben die Beteiligten mit Gesicht, Namen, Benutzernamen und Rolle, je
 * Zeile ein Entfernen-Knopf - und darunter die Suche, die nur anbietet, wer
 * noch nicht dabei ist. Jede Handlung speichert sofort.
 *
 * ## Warum die Leitung kein eigener Knopf ist
 *
 * Weil mindestens eine gebraucht wird. Ein «Leitung entfernen»-Knopf führte
 * zwangsläufig in den Zustand ohne Leitung - der Server lehnt ihn ab, und eine
 * Oberfläche, deren Knöpfe scheitern, ist schlechter als eine, die den Zustand
 * gar nicht anbietet. Darum bleibt die Rolle ein Auswahlfeld, und die letzte
 * Leitung lässt sich nicht herabstufen.
 */

/** Ab wie vielen Kandidaten die Suche erscheint. Darunter ist sie Möbel. */
const SUCHE_AB = 8;

export function Mitgliederverwaltung({
  csrfToken,
  projectId,
  mitglieder,
  team,
}: {
  csrfToken: string;
  projectId: string;
  mitglieder: ReadonlyArray<{ discordId: string; rolle: WorkspaceMemberRole }>;
  team: Teammitglied[];
}): React.JSX.Element {
  const router = useRouter();
  const [laeuft, starte] = useTransition();
  const [suche, setSuche] = useState('');
  /**
   * Die Rolle, mit der die naechste Person dazukommt.
   *
   * ## Warum vor der Auswahl und nicht danach
   *
   * Hier kam jede neue Person als «Unterstuetzung» herein, und wer eine
   * zweite Projektleitung wollte, stufte sie danach um - zwei Schritte und
   * zwei Eintraege im Verlauf fuer eine Entscheidung, die man beim Klicken
   * schon getroffen hat. Jetzt steht die Rolle oben, gilt fuer die naechsten
   * Klicks und bleibt stehen: wer drei Unterstuetzungen dazunimmt, waehlt
   * einmal und klickt dreimal.
   *
   * «Unterstuetzung» ist die Vorgabe, weil es der haeufigere Fall ist und
   * weil eine versehentliche Leitung mehr Rechte im Projekt bedeutet als
   * eine versehentliche Unterstuetzung.
   */
  const [neueRolle, setNeueRolle] = useState<WorkspaceMemberRole>('MEMBER');

  /*
   * Der Stand liegt lokal, damit die Liste sofort stimmt.
   *
   * Die Antwort des Servers ist die Wahrheit, und `router.refresh()` holt sie
   * - aber das dauert einen Moment, und in diesem Moment soll die Zeile schon
   * weg sein. Scheitert die Handlung, wird der lokale Stand zurückgesetzt.
   */
  const [stand, setStand] = useState<Array<{ discordId: string; rolle: WorkspaceMemberRole }>>(() =>
    mitglieder.map((eintrag) => ({ ...eintrag })),
  );

  const nachKennung = useMemo(() => new Map(team.map((eintrag) => [eintrag.discordId, eintrag])), [team]);

  /** Wer noch nicht dabei ist - und zur Suche passt. */
  const kandidaten = useMemo(() => {
    const dabei = new Set(stand.map((eintrag) => eintrag.discordId));
    const begriff = suche.trim().toLowerCase();
    return team
      .filter((eintrag) => !dabei.has(eintrag.discordId))
      .filter(
        (eintrag) =>
          begriff === '' ||
          eintrag.name.toLowerCase().includes(begriff) ||
          (eintrag.username ?? '').toLowerCase().includes(begriff),
      );
  }, [stand, suche, team]);

  const leitungen = stand.filter((eintrag) => eintrag.rolle === 'LEAD').length;

  /**
   * Speichert einen neuen Stand.
   *
   * Die Action nimmt die ganze Liste, nicht einen Unterschied - das bleibt
   * so: eine Liste ist ein Zustand, und zwei gleichzeitige Änderungen können
   * sich dabei nicht halb überlagern. Der Unterschied daraus entsteht
   * serverseitig, und nur er landet im Verlauf.
   */
  const speichere = (
    naechster: Array<{ discordId: string; rolle: WorkspaceMemberRole }>,
    meldung: string,
  ): void => {
    if (!naechster.some((eintrag) => eintrag.rolle === 'LEAD')) {
      toast.error('Das Projekt braucht mindestens eine Projektleitung.');
      return;
    }
    const vorher = stand;
    setStand(naechster);
    starte(async () => {
      const antwort = await workspaceMitgliederSetzenAction({
        csrfToken,
        projectId,
        mitglieder: naechster,
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

  const hinzufuegen = (discordId: string): void => {
    // Kein doppeltes Hinzufügen: wer dabei ist, steht nicht in `kandidaten` -
    // und hier noch einmal geprüft, weil zwei schnelle Klicks schneller sind
    // als ein Neuaufbau der Liste.
    if (stand.some((eintrag) => eintrag.discordId === discordId)) {
      return;
    }
    const name = nachKennung.get(discordId)?.name ?? 'Die Person';
    speichere(
      [...stand, { discordId, rolle: neueRolle }],
      `${name} ist jetzt beteiligt - als ${ROLLE_LABEL[neueRolle]}.`,
    );
  };

  const entfernen = (discordId: string): void => {
    const name = nachKennung.get(discordId)?.name ?? 'Die Person';
    speichere(
      stand.filter((eintrag) => eintrag.discordId !== discordId),
      `${name} ist nicht mehr beteiligt.`,
    );
  };

  const rolleSetzen = (discordId: string, rolle: WorkspaceMemberRole): void => {
    speichere(
      stand.map((eintrag) => (eintrag.discordId === discordId ? { ...eintrag, rolle } : eintrag)),
      'Rolle gespeichert.',
    );
  };

  return (
    <div className={cn('space-y-4', laeuft && 'pointer-events-none opacity-70')}>
      {/* --- Wer dabei ist --- */}
      {stand.length === 0 ? (
        <p className="text-xs text-muted-foreground">Noch niemand beteiligt.</p>
      ) : (
        <ul className="space-y-2">
          {stand.map((eintrag) => {
            const person = nachKennung.get(eintrag.discordId);
            const letzteLeitung = eintrag.rolle === 'LEAD' && leitungen === 1;
            return (
              <li key={eintrag.discordId} className="flex items-center gap-2">
                <DiscordAvatar
                  discordId={eintrag.discordId}
                  avatarHash={person?.avatarHash ?? null}
                  name={person?.name ?? eintrag.discordId}
                  size={32}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{person?.name ?? eintrag.discordId}</span>
                  {/*
                    Der Benutzername nur, wenn er etwas hinzufügt. «anna ·
                    anna» ist keine Auskunft.
                  */}
                  {person?.username && person.username !== person.name ? (
                    <span className="block truncate text-[11px] text-muted-foreground">
                      @{person.username}
                    </span>
                  ) : null}
                  {!person ? (
                    <span className="block truncate text-[11px] text-warning">
                      darf den Workspace nicht mehr öffnen
                    </span>
                  ) : null}
                </span>
                <Select
                  value={eintrag.rolle}
                  onValueChange={(wert): void => rolleSetzen(eintrag.discordId, wert as WorkspaceMemberRole)}
                >
                  <SelectTrigger className="w-36 shrink-0" aria-label="Rolle im Projekt">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MEMBER">{ROLLE_LABEL.MEMBER}</SelectItem>
                    <SelectItem value="LEAD">{ROLLE_LABEL.LEAD}</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  disabled={letzteLeitung}
                  title={
                    letzteLeitung
                      ? 'Die letzte Projektleitung lässt sich nicht entfernen.'
                      : 'Aus dem Projekt entfernen'
                  }
                  onClick={(): void => entfernen(eintrag.discordId)}
                >
                  <UserMinus aria-hidden="true" className="size-4" />
                  <span className="sr-only">
                    {person?.name ?? eintrag.discordId} aus dem Projekt entfernen
                  </span>
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {/* --- Wer dazukommen kann --- */}
      <div className="space-y-2 border-t border-border pt-3">
        <p className="text-xs font-medium">Beteiligte hinzufügen</p>

        {/*
          Erst die Rolle, dann die Person.

          Die Reihenfolge ist Absicht: die Rolle gilt fuer jeden folgenden
          Klick, und wer sie oben sieht, bevor er in die Liste greift, waehlt
          nicht versehentlich falsch.
        */}
        <div className="space-y-1">
          <label htmlFor="ws-neue-rolle" className="text-[11px] text-muted-foreground">
            Rolle für neue Beteiligte
          </label>
          <Select value={neueRolle} onValueChange={(wert): void => setNeueRolle(wert as WorkspaceMemberRole)}>
            <SelectTrigger id="ws-neue-rolle" className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="MEMBER">{ROLLE_LABEL.MEMBER}</SelectItem>
              <SelectItem value="LEAD">{ROLLE_LABEL.LEAD}</SelectItem>
            </SelectContent>
          </Select>
        </div>

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
              aria-label="Teammitglied suchen"
              className="pl-9"
            />
          </div>
        ) : null}

        {kandidaten.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {suche.trim() === ''
              ? 'Alle, die den Workspace öffnen dürfen, sind beteiligt.'
              : 'Niemand passt zu dieser Suche.'}
          </p>
        ) : (
          <ul className="max-h-56 space-y-1 overflow-y-auto">
            {kandidaten.map((person) => (
              <li key={person.discordId}>
                <button
                  type="button"
                  onClick={(): void => hinzufuegen(person.discordId)}
                  className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-muted"
                >
                  <DiscordAvatar
                    discordId={person.discordId}
                    avatarHash={person.avatarHash}
                    name={person.name}
                    size={28}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{person.name}</span>
                    {person.username && person.username !== person.name ? (
                      <span className="block truncate text-[11px] text-muted-foreground">
                        @{person.username}
                      </span>
                    ) : null}
                  </span>
                  <Plus aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {/*
          Was die Liste ist - und was sie nicht ist.

          «Beteiligte» heisst: wer an diesem Projekt arbeitet. Es ist keine
          Berechtigungsliste; wer das Projekt sehen darf, steht in der
          Sichtbarkeit weiter unten und wird hier nicht angefasst. Die eine
          Ausnahme ist «privat»: dort **ist** die Beteiligtenliste die
          Zugangsliste, weil ein privates Projekt sonst niemanden hätte, der
          es öffnen kann. Das steht hier, weil der Unterschied sonst erst
          auffällt, wenn jemand versehentlich Zugang verteilt hat.
        */}
        <p className="text-[11px] text-muted-foreground">
          Angeboten werden die, die den Workspace öffnen dürfen. Diese Liste sagt, <em>wer mitarbeitet</em> -
          nicht, wer das Projekt sehen darf; das steht in der Sichtbarkeit. Nur bei «privat» ist beides
          dasselbe: dort sehen genau die Beteiligten das Projekt.
        </p>
        <p className="text-[11px] text-muted-foreground">
          «Projektleitung» und «Unterstützung» gelten nur in diesem Projekt. Es sind keine Discord-Rollen und
          keine Berechtigungen - eine Rolle hier ändert nichts daran, was jemand im System darf.
        </p>
      </div>
    </div>
  );
}

export function ArchivKnopf({
  csrfToken,
  projectId,
  archiviert,
  titel,
}: {
  csrfToken: string;
  projectId: string;
  archiviert: boolean;
  titel: string;
}): React.JSX.Element {
  const router = useRouter();
  const [laeuft, starte] = useTransition();
  const [bestaetigt, setBestaetigt] = useState(false);

  const ruf = (
    aufruf: () => Promise<{ ok: boolean; error?: { message: string } | null }>,
    erfolg: string,
  ): void => {
    starte(async () => {
      const antwort = await aufruf();
      if (!antwort.ok) {
        toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
        return;
      }
      setBestaetigt(false);
      toast.success(erfolg);
      router.refresh();
    });
  };

  if (archiviert) {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled={laeuft}
        onClick={(): void =>
          ruf(() => workspaceProjektZurueckholenAction({ csrfToken, projectId }), 'Projekt zurückgeholt.')
        }
      >
        Zurückholen
      </Button>
    );
  }

  if (!bestaetigt) {
    return (
      <Button variant="outline" size="sm" onClick={(): void => setBestaetigt(true)}>
        <Archive className="size-4" />
        Archivieren
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted-foreground">
        «{titel}» ins Archiv? Aufgaben und Verlauf bleiben, nur aus den Listen ist es weg.
      </span>
      <Button
        size="sm"
        disabled={laeuft}
        onClick={(): void =>
          ruf(() => workspaceProjektArchivierenAction({ csrfToken, projectId }), 'Projekt archiviert.')
        }
      >
        Ja, archivieren
      </Button>
      <Button variant="ghost" size="sm" onClick={(): void => setBestaetigt(false)}>
        Abbrechen
      </Button>
    </div>
  );
}
