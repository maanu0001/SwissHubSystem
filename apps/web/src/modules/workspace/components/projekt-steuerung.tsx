'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Archive, UserMinus, UserPlus } from 'lucide-react';
import type { WorkspaceMemberRole } from '@swisshub/database';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { Personensuche } from './personensuche';
import { ROLLE_LABEL } from '../labels';
import {
  workspaceMitgliederSetzenAction,
  workspaceProjektArchivierenAction,
  workspaceProjektZurueckholenAction,
} from '../actions';
import type { Beteiligter, Teammitglied } from '../daten';

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
 * ## Die Ordnung der Kachel
 *
 * Oben das Hinzufuegen, darunter die Liste - in dieser Reihenfolge, weil die
 * Kachel eine Handlung anbietet und danach ihr Ergebnis zeigt:
 *
 *   1. ein Suchfeld fuer **eine** Person,
 *   2. daneben die Rolle, mit der sie hereinkommt,
 *   3. darunter «Hinzufuegen»,
 *   4. und dann alle Beteiligten mit Gesicht, Name, Funktion und einem
 *      Entfernen-Knopf je Zeile.
 *
 * Auf einem Telefon stehen Suchfeld, Rolle und Knopf untereinander, jeweils
 * auf voller Breite. Das ist nicht Kosmetik: bei 390 px passen drei
 * Bedienelemente nicht in eine Zeile, und der Versuch war messbar - die
 * Zeile schob die Seite um 116 px auf.
 *
 * Jede Handlung speichert sofort; einen Speicherknopf gibt es nicht.
 *
 * ## Warum die Leitung kein eigener Knopf ist
 *
 * Weil mindestens eine gebraucht wird. Ein «Leitung entfernen»-Knopf führte
 * zwangsläufig in den Zustand ohne Leitung - der Server lehnt ihn ab, und eine
 * Oberfläche, deren Knöpfe scheitern, ist schlechter als eine, die den Zustand
 * gar nicht anbietet. Darum bleibt die Rolle ein Auswahlfeld, und die letzte
 * Leitung lässt sich nicht herabstufen.
 */

export function Mitgliederverwaltung({
  csrfToken,
  projectId,
  mitglieder,
  beteiligtePersonen,
  team,
}: {
  csrfToken: string;
  projectId: string;
  mitglieder: ReadonlyArray<{ discordId: string; rolle: WorkspaceMemberRole }>;
  /**
   * Der Zugang der eingetragenen Beteiligten - serverseitig berechnet.
   *
   * ## Der Fehler, den das behebt
   *
   * Hier stand «darf den Workspace nicht mehr oeffnen» unter jedem Namen,
   * den die Komponente in `team` nicht fand. Das war ein Schluss aus einer
   * Abwesenheit und keine Auskunft: `team` ist die Liste der **waehlbaren**
   * Personen, bei 200 gedeckelt und nach Anzeigename sortiert. Wer dahinter
   * lag, nicht gespiegelt war oder den Server verlassen hatte, fehlte darin,
   * ohne irgendein Recht verloren zu haben.
   *
   * Jetzt kommt die Antwort aus `ladeBeteiligte`: an denselben Rollen und mit
   * derselben Engine geprueft wie der Riegel vor der Seite, und zwar fuer
   * genau diese Kennungen.
   */
  beteiligtePersonen: Beteiligter[];
  team: Teammitglied[];
}): React.JSX.Element {
  const router = useRouter();
  const [laeuft, starte] = useTransition();
  /**
   * Wer als naechstes dazukommt - genau eine Person, oder niemand.
   *
   * Die ganze Person und nicht nur ihre Kennung: gesucht wird serverseitig
   * im Mitgliederspiegel, und wer dort gefunden wird, steht nicht
   * zwangslaeufig in `team` - sonst haette die Zeile nach dem Hinzufuegen
   * keinen Namen.
   */
  const [gewaehlt, setGewaehlt] = useState<Teammitglied | null>(null);
  /**
   * Zaehler, der die Suche zuruecksetzt.
   *
   * Nach einem Hinzufuegen soll das Feld leer sein und die Trefferliste
   * verschwinden - sonst steht dort eine Person, die jetzt schon beteiligt
   * ist. Ein neuer `key` ist dafuer ehrlicher als ein Dutzend `setX(null)`
   * aus der Ferne.
   */
  const [runde, setRunde] = useState(0);
  /**
   * Wer in dieser Sitzung dazukam.
   *
   * `team` ist die Liste, die die Seite mitgebracht hat; eine Person aus der
   * Suche kann darin fehlen. Bis `router.refresh()` durch ist, kommt ihr
   * Name von hier.
   */
  const [dazu, setDazu] = useState<Record<string, Teammitglied>>({});
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

  const nachKennung = useMemo(() => {
    const karte = new Map<string, Teammitglied>(team.map((eintrag) => [eintrag.discordId, eintrag]));
    /*
     * Die Eingetragenen ueberschreiben `team`: ihr Name ist fuer diese Liste
     * aufgeloest worden und haengt nicht daran, dass sie auch waehlbar waeren.
     */
    for (const person of beteiligtePersonen) {
      karte.set(person.discordId, person);
    }
    for (const [discordId, person] of Object.entries(dazu)) {
      karte.set(discordId, person);
    }
    return karte;
  }, [beteiligtePersonen, dazu, team]);

  /** Wer das Modul nicht oeffnen darf - berechnet, nicht erschlossen. */
  const ohneZugang = useMemo(
    () =>
      new Set(beteiligtePersonen.filter((person) => !person.darfOeffnen).map((person) => person.discordId)),
    [beteiligtePersonen],
  );

  /**
   * Wer nicht mehr in Frage kommt.
   *
   * Das Suchen macht die Personensuche serverseitig; hier wird nur gesagt,
   * wer schon beteiligt ist. Das ist die Zusage «keine Duplikate», und sie
   * steht hier und nicht in einer Pruefung beim Hinzufuegen: was man nicht
   * waehlen kann, kann man nicht doppelt waehlen.
   */
  const beteiligte = useMemo(() => stand.map((eintrag) => eintrag.discordId), [stand]);

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

  const hinzufuegen = (): void => {
    if (!gewaehlt) {
      toast.error('Wähle zuerst eine Person aus.');
      return;
    }
    // Kein doppeltes Hinzufügen: wer dabei ist, steht nicht in den Treffern -
    // und hier noch einmal geprüft, weil zwei schnelle Klicks schneller sind
    // als ein Neuaufbau der Liste.
    if (stand.some((eintrag) => eintrag.discordId === gewaehlt.discordId)) {
      return;
    }
    const person = gewaehlt;
    setDazu((vorher) => ({ ...vorher, [person.discordId]: person }));
    setGewaehlt(null);
    setRunde((vorher) => vorher + 1);
    speichere(
      [...stand, { discordId: person.discordId, rolle: neueRolle }],
      `${person.name} ist jetzt beteiligt - als ${ROLLE_LABEL[neueRolle]}.`,
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
    <div className={cn('min-w-0 space-y-4', laeuft && 'pointer-events-none opacity-70')}>
      {/* ---------- 1. Hinzufuegen: Person, Rolle, Knopf ---------- */}
      <div className="min-w-0 space-y-2">
        {/*
          Zwei Spalten ab `sm`, eine darunter.

          `minmax(0,1fr)` fuer die Suchspalte ist der Punkt: ohne die Null als
          Minimum waechst die Spalte auf die min-content-Breite des
          Eingabefelds, und das ist breiter als ein Telefon. Mit `grid-cols-1`
          als Grundlage stehen Suche und Rolle darunter einfach
          untereinander - jede auf voller Breite, keine gequetschte Zeile.
        */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Personensuche
            key={runde}
            csrfToken={csrfToken}
            ausgeschlossen={beteiligte}
            wert={gewaehlt}
            aufWahl={setGewaehlt}
            beschriftung="Person für das Projekt suchen"
            leerText="Niemand passt zu dieser Suche - oder die Treffer sind schon beteiligt."
          />

          <div className="min-w-0 space-y-1 sm:w-44">
            <label htmlFor="ws-neue-rolle" className="block text-[11px] text-muted-foreground">
              Funktion
            </label>
            <Select
              value={neueRolle}
              onValueChange={(wert): void => setNeueRolle(wert as WorkspaceMemberRole)}
            >
              {/*
                `w-full` und kein `w-36`: eine feste Breite ist auf einem
                Telefon zu viel und auf dem Schreibtisch willkuerlich. Die
                Spalte gibt die Breite vor, ab `sm` ueber `sm:w-44`.
              */}
              <SelectTrigger id="ws-neue-rolle" className="h-9 w-full min-w-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="MEMBER">{ROLLE_LABEL.MEMBER}</SelectItem>
                <SelectItem value="LEAD">{ROLLE_LABEL.LEAD}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/*
          Der Knopf darunter, auf dem Telefon ueber die ganze Breite.

          Er ist absichtlich nicht deaktiviert, wenn niemand gewaehlt ist:
          ein Knopf, der nichts tut und nicht sagt warum, laesst einen
          raten. Geklickt ohne Auswahl sagt er es.
        */}
        <Button
          type="button"
          size="sm"
          className="w-full sm:w-auto"
          onClick={hinzufuegen}
          aria-disabled={gewaehlt === null}
        >
          <UserPlus aria-hidden="true" className="size-4" />
          Hinzufügen
        </Button>
      </div>

      {/* ---------- 2. Wer dabei ist ---------- */}
      <div className="min-w-0 space-y-2 border-t border-border pt-3">
        <p className="text-xs font-medium">Beteiligte</p>

        {stand.length === 0 ? (
          <p className="text-xs text-muted-foreground">Noch niemand beteiligt.</p>
        ) : (
          <ul className="min-w-0 space-y-2">
            {stand.map((eintrag) => {
              const person = nachKennung.get(eintrag.discordId);
              const letzteLeitung = eintrag.rolle === 'LEAD' && leitungen === 1;
              return (
                /*
                  Eine Zeile, die umbricht.

                  Vorher stand hier eine Zeile aus vier Dingen: Gesicht,
                  Name, ein Auswahlfeld mit `w-36 shrink-0` und ein Knopf.
                  Bei 390 px passte das nicht, und weil das Auswahlfeld
                  nicht schrumpfen durfte, schob es die Seite auf - gemessen
                  85 px ueber den Rand hinaus.

                  Jetzt zwei Zeilen auf dem Telefon: oben die Person, unten
                  Funktion und Entfernen. Ab `sm` wieder alles in einer.
                */
                <li
                  key={eintrag.discordId}
                  className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-border/60 p-2 sm:flex-nowrap sm:border-0 sm:p-0"
                >
                  <DiscordAvatar
                    discordId={eintrag.discordId}
                    avatarHash={person?.avatarHash ?? null}
                    name={person?.name ?? eintrag.discordId}
                    size={32}
                  />
                  <span className="min-w-0 flex-1 basis-40">
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
                    {ohneZugang.has(eintrag.discordId) ? (
                      <span className="block truncate text-[11px] text-warning">
                        darf den Workspace nicht mehr öffnen
                      </span>
                    ) : null}
                  </span>

                  <div className="flex min-w-0 flex-1 basis-full items-center gap-2 sm:flex-none sm:basis-auto">
                    <Select
                      value={eintrag.rolle}
                      onValueChange={(wert): void =>
                        rolleSetzen(eintrag.discordId, wert as WorkspaceMemberRole)
                      }
                    >
                      <SelectTrigger
                        className="h-9 min-w-0 flex-1 sm:w-40 sm:flex-none"
                        aria-label={`Funktion von ${person?.name ?? eintrag.discordId}`}
                      >
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
                  </div>
                </li>
              );
            })}
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
