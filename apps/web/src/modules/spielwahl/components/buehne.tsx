'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  ArrowLeft,
  CheckCircle2,
  Dices,
  DoorOpen,
  LogOut,
  Play,
  RefreshCw,
  RotateCcw,
  Swords,
  Vote,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import { Runde, Verbindungsanzeige } from './bausteine';
import { Lobby, Einladungsknopf } from './lobby';
import { Abstimmung } from './abstimmung';
import { Duell } from './duell';
import { Ergebnis } from './ergebnis';
import { aktuellesDuell } from '@swisshub/modules/spielwahl/baum';
import { Rad, RadRuhig, RadStand, type RadFeld } from './rad';
import { Regeln } from './regeln';
import {
  neuerSchluessel,
  useFrist,
  useRuhig,
  useSpielwahl,
  type Stand,
} from '@/modules/spielwahl/verbindung';
import {
  spielwahlAnnehmenAction,
  spielwahlBeitretenAction,
  spielwahlHierAction,
  spielwahlNeuLosenAction,
  spielwahlNochEineAction,
  spielwahlPhaseOeffnenAction,
  spielwahlPhaseSchliessenAction,
  spielwahlSchliessenAction,
  spielwahlStartenAction,
  spielwahlStimmeAction,
  spielwahlVerlassenAction,
} from '@/modules/spielwahl/aktionen';
import '@/modules/spielwahl/spielwahl.css';

/**
 * Die Bühne.
 *
 * ## Was diese Datei tut und was nicht
 *
 * Sie verteilt. Welche Szene dran ist, ergibt sich aus dem Zustand, den der
 * Server schickt - hier steht keine Regel darüber, wann eine Abstimmung
 * endet oder wer gewinnt. Diese Datei weiss nur, welche Knöpfe im welchem
 * Zustand angeboten werden, und selbst das ist bloss Höflichkeit: ob ein
 * Befehl durchgeht, entscheidet der Server noch einmal.
 *
 * ## Die Drehdauer
 *
 * Sie steht im Browser, weil sie eine Frage der Darstellung ist. Der
 * **Zeitpunkt**, an dem die Runde endet, steht im Server (`endsAt`) - und
 * beide sind absichtlich gleich lang. Liefe die Animation länger als die
 * Runde, stünde das Ergebnis da, bevor das Rad steht.
 */
const DREHDAUER_MS = 10_000;

/** Wie oft ein Lebenszeichen an den Server geht. */
const LEBENSZEICHEN_MS = 45_000;

export function Buehne({
  anfang,
  csrfToken,
  darfModerieren,
}: {
  anfang: Stand;
  csrfToken: string;
  darfModerieren: boolean;
}): React.JSX.Element {
  const { stand, verbunden } = useSpielwahl(anfang);
  const ruhig = useRuhig();
  const [laeuft, starteUebergang] = useTransition();
  const [abbruchOffen, setAbbruchOffen] = useState(false);

  const darfFuehren = stand.eigeneRolle === 'HOST' || stand.eigeneRolle === 'COHOST';
  const dabei = stand.eigeneRolle !== null;
  const rest = useFrist(stand.runde?.endsAt ?? null, stand.jetzt);

  /*
   * Lebenszeichen.
   *
   * Der Server braucht sie, um zu wissen, wer noch zusieht - unter anderem
   * dafür, die Führung an jemanden weiterzugeben, der tatsächlich da ist.
   * Bewusst selten: es ist kein Polling, sondern ein Handzeichen.
   */
  useEffect(() => {
    if (!dabei) {
      return;
    }
    const melden = (): void => {
      void spielwahlHierAction({ sessionId: stand.id });
    };
    const uhr = window.setInterval(melden, LEBENSZEICHEN_MS);
    return () => window.clearInterval(uhr);
  }, [dabei, stand.id]);

  const befehl = useCallback((arbeit: () => Promise<{ ok: boolean; error?: { message: string } }>) => {
    starteUebergang(async () => {
      const antwort = await arbeit();
      if (!antwort.ok) {
        toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
      }
    });
  }, []);

  const stimmen = useCallback(
    (candidateId: string, duell = 0) => {
      befehl(() => spielwahlStimmeAction({ sessionId: stand.id, candidateId, duell, csrfToken }));
    },
    [befehl, stand.id, csrfToken],
  );

  /**
   * Was die Zifferntasten treffen.
   *
   * Bei der Abstimmung die Kandidaten in der Reihenfolge des Bildschirms.
   * Bei der Ausscheidung **die beiden Seiten des laufenden Duells** - und
   * nicht die Kandidatenliste der Runde: die enthält alle vier Titel, von
   * denen im Duell nur zwei zur Wahl stehen. Die «1» wählte damit ein Spiel,
   * das gar nicht antritt, und der Server wies sie zu Recht ab.
   */
  const tastenZiele = useMemo(() => {
    const runde = stand.runde;
    if (!runde || stand.status !== 'ENTSCHEIDUNG' || stand.modus === 'ROULETTE') {
      return [];
    }
    if (stand.modus === 'ELIMINATION') {
      const paarung = runde.baum ? aktuellesDuell(runde.baum, runde.duellIndex) : undefined;
      if (!paarung?.b) {
        return [];
      }
      return [paarung.a, paarung.b];
    }
    return runde.kandidaten;
  }, [stand.runde, stand.status, stand.modus]);

  /*
   * Tastatur.
   *
   * Kein Zusatz für Fortgeschrittene: wer nicht zeigen kann, kommt sonst gar
   * nicht an die Abstimmung. Die Knöpfe selbst sind ohnehin Knöpfe und damit
   * über die Tabulatortaste erreichbar - die Ziffern sind der schnelle Weg,
   * wenn sechs Leute gleichzeitig wählen.
   */
  useEffect(() => {
    if (tastenZiele.length === 0) {
      return;
    }
    const duell = stand.runde?.duellIndex ?? 0;
    const taste = (ereignis: KeyboardEvent): void => {
      const ziel = ereignis.target as HTMLElement | null;
      if (ziel && (ziel.tagName === 'INPUT' || ziel.tagName === 'TEXTAREA' || ziel.isContentEditable)) {
        return;
      }
      if (ereignis.metaKey || ereignis.ctrlKey || ereignis.altKey) {
        return;
      }
      const ziffer = Number.parseInt(ereignis.key, 10);
      if (!Number.isInteger(ziffer) || ziffer < 1) {
        return;
      }
      const candidateId = tastenZiele[ziffer - 1];
      if (candidateId) {
        ereignis.preventDefault();
        stimmen(candidateId, duell);
      }
    };
    window.addEventListener('keydown', taste);
    return () => window.removeEventListener('keydown', taste);
  }, [tastenZiele, stand.runde?.duellIndex, stimmen]);

  const radFelder: RadFeld[] = useMemo(() => {
    const runde = stand.runde;
    if (!runde) {
      return [];
    }
    const gewichtet = stand.einstellungen.rouletteGewichtet;
    return runde.kandidaten.flatMap((id) => {
      const kandidat = stand.kandidaten.find((eintrag) => eintrag.id === id);
      if (!kandidat) {
        return [];
      }
      return [
        {
          candidateId: kandidat.id,
          name: kandidat.name,
          bannerUrl: kandidat.bannerUrl,
          gewicht: gewichtet ? Math.max(1, kandidat.unterstuetzer.length) : 1,
        },
      ];
    });
  }, [stand.runde, stand.kandidaten, stand.einstellungen.rouletteGewichtet]);

  const geschlossen = stand.status === 'ABGESCHLOSSEN' || stand.status === 'ABGEBROCHEN';

  return (
    <div className="spielwahl mx-auto w-full max-w-5xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/was-spielen-wir"
          className="inline-flex items-center gap-1.5 text-sm text-white/40 transition hover:text-white/70"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Alle Runden
        </Link>
        <div className="flex items-center gap-3">
          <Verbindungsanzeige verbunden={verbunden} />
          {!geschlossen ? <Einladungsknopf token={stand.inviteToken} /> : null}
        </div>
      </div>

      <div className="sp-buehne px-4 py-8 sm:px-8 sm:py-12">
        <div className="flex flex-col gap-8">
          <Runde
            teilnehmer={stand.teilnehmer}
            max={stand.einstellungen.maxTeilnehmer}
            zeigeStimmstand={stand.status === 'ENTSCHEIDUNG' && stand.modus !== 'ROULETTE'}
          />

          {!dabei && !geschlossen ? (
            <Beitreten sessionId={stand.id} csrfToken={csrfToken} befehl={befehl} laeuft={laeuft} />
          ) : null}

          {stand.status === 'LOBBY' || stand.status === 'BEREIT' ? (
            <Lobby stand={stand} csrfToken={csrfToken} darfFuehren={darfFuehren} />
          ) : null}

          {stand.status === 'ENTSCHEIDUNG' && stand.modus === 'ROULETTE' && stand.runde ? (
            <div className="flex flex-col items-center gap-8">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-white/35">
                {ruhig ? 'Die Ziehung läuft' : 'Das Rad läuft'}
              </p>
              {ruhig ? (
                <RadRuhig felder={radFelder} rest={rest} />
              ) : (
                <Rad
                  felder={radFelder}
                  runde={stand.runde}
                  serverJetzt={stand.jetzt}
                  dauerMs={DREHDAUER_MS}
                />
              )}
            </div>
          ) : null}

          {stand.status === 'ENTSCHEIDUNG' && stand.modus === 'VOTING' ? (
            <Abstimmung stand={stand} rest={rest} aufStimme={(id) => stimmen(id, 0)} beschaeftigt={laeuft} />
          ) : null}

          {stand.status === 'ENTSCHEIDUNG' && stand.modus === 'ELIMINATION' ? (
            <Duell stand={stand} rest={rest} aufStimme={stimmen} beschaeftigt={laeuft} />
          ) : null}

          {stand.status === 'ERGEBNIS' || stand.status === 'ABGESCHLOSSEN' ? (
            <>
              <Ergebnis stand={stand} />
              {stand.modus === 'ROULETTE' ? (
                <RadStand felder={radFelder} gewinnerId={stand.runde?.gewinnerCandidateId ?? null} />
              ) : null}
              {stand.modus === 'VOTING' ? (
                <Abstimmung stand={stand} rest={null} aufStimme={() => undefined} beschaeftigt />
              ) : null}
              {stand.modus === 'ELIMINATION' ? (
                <Duell stand={stand} rest={null} aufStimme={() => undefined} beschaeftigt />
              ) : null}
            </>
          ) : null}

          {stand.status === 'ABGEBROCHEN' ? (
            <div className="py-10 text-center">
              <XCircle className="mx-auto size-8 text-white/20" aria-hidden="true" />
              <p className="mt-3 text-lg font-semibold text-white/70">Diese Runde ist beendet.</p>
              <p className="mt-1 text-sm text-white/35">Macht eine neue auf - das dauert zwei Sekunden.</p>
            </div>
          ) : null}
        </div>
      </div>

      {!geschlossen ? (
        <Steuerung
          stand={stand}
          csrfToken={csrfToken}
          darfFuehren={darfFuehren}
          dabei={dabei}
          laeuft={laeuft}
          befehl={befehl}
          aufAbbruch={() => setAbbruchOffen(true)}
        />
      ) : null}

      {stand.status === 'LOBBY' || stand.status === 'BEREIT' ? (
        <Regeln stand={stand} csrfToken={csrfToken} darfFuehren={darfFuehren} />
      ) : null}

      <ConfirmationDialog
        open={abbruchOffen}
        onOpenChange={setAbbruchOffen}
        title="Runde beenden?"
        description={
          darfModerieren && !darfFuehren
            ? 'Du beendest eine fremde Runde. Das steht im Protokoll.'
            : 'Die Runde wird für alle geschlossen. Das lässt sich nicht rückgängig machen.'
        }
        confirmLabel="Beenden"
        destructive
        onConfirm={() => {
          befehl(() => spielwahlSchliessenAction({ sessionId: stand.id, csrfToken }));
          setAbbruchOffen(false);
        }}
      />
    </div>
  );
}

function Beitreten({
  sessionId,
  csrfToken,
  befehl,
  laeuft,
}: {
  sessionId: string;
  csrfToken: string;
  befehl: (arbeit: () => Promise<{ ok: boolean; error?: { message: string } }>) => void;
  laeuft: boolean;
}): React.JSX.Element {
  return (
    <div className="rounded-2xl border border-[hsl(var(--sp-rot-hell)/0.35)] bg-[hsl(var(--sp-rot)/0.12)] p-5 text-center">
      <p className="text-base font-semibold text-white">Du schaust nur zu.</p>
      <p className="mt-1 text-sm text-white/45">Tritt bei, um Spiele vorzuschlagen und mitzuentscheiden.</p>
      <Button
        type="button"
        disabled={laeuft}
        className="mt-4"
        onClick={() =>
          befehl(() => spielwahlBeitretenAction({ sessionId, schluessel: neuerSchluessel(), csrfToken }))
        }
      >
        <DoorOpen className="size-4" aria-hidden="true" />
        Mitmachen
      </Button>
    </div>
  );
}

const MODUS_SYMBOL = { ROULETTE: Dices, VOTING: Vote, ELIMINATION: Swords } as const;

/**
 * Die Steuerung.
 *
 * Genau ein Weg vorwärts je Zustand. Die vollständige Übergangstabelle steht
 * im Modul und entscheidet weiterhin; hier steht nur, was angeboten wird -
 * eine Leiste mit neun Möglichkeiten wäre keine Steuerung, sondern ein
 * Rätsel.
 */
function Steuerung({
  stand,
  csrfToken,
  darfFuehren,
  dabei,
  laeuft,
  befehl,
  aufAbbruch,
}: {
  stand: Stand;
  csrfToken: string;
  darfFuehren: boolean;
  dabei: boolean;
  laeuft: boolean;
  befehl: (arbeit: () => Promise<{ ok: boolean; error?: { message: string } }>) => void;
  aufAbbruch: () => void;
}): React.JSX.Element | null {
  const Symbol = MODUS_SYMBOL[stand.modus];
  const genug = stand.kandidaten.length >= 2;

  const knoepfe: React.ReactNode[] = [];

  if (darfFuehren && stand.status === 'LOBBY') {
    knoepfe.push(
      <Button
        key="close"
        type="button"
        size="lg"
        disabled={laeuft || !genug}
        onClick={() =>
          befehl(() =>
            spielwahlPhaseSchliessenAction({ sessionId: stand.id, schluessel: neuerSchluessel(), csrfToken }),
          )
        }
      >
        <CheckCircle2 className="size-4" aria-hidden="true" />
        {genug ? 'Auswahl schliessen' : 'Mindestens 2 Spiele'}
      </Button>,
    );
  }

  if (darfFuehren && stand.status === 'BEREIT') {
    knoepfe.push(
      <Button
        key="start"
        type="button"
        size="lg"
        disabled={laeuft}
        onClick={() =>
          befehl(() =>
            spielwahlStartenAction({ sessionId: stand.id, schluessel: neuerSchluessel(), csrfToken }),
          )
        }
      >
        <Symbol className="size-4" aria-hidden="true" />
        Los geht&apos;s
      </Button>,
      <Button
        key="reopen"
        type="button"
        variant="outline"
        disabled={laeuft}
        onClick={() =>
          befehl(() =>
            spielwahlPhaseOeffnenAction({ sessionId: stand.id, schluessel: neuerSchluessel(), csrfToken }),
          )
        }
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Zurück zu den Vorschlägen
      </Button>,
    );
  }

  if (darfFuehren && stand.status === 'ERGEBNIS') {
    knoepfe.push(
      <Button
        key="accept"
        type="button"
        size="lg"
        disabled={laeuft}
        onClick={() =>
          befehl(() =>
            spielwahlAnnehmenAction({ sessionId: stand.id, schluessel: neuerSchluessel(), csrfToken }),
          )
        }
      >
        <CheckCircle2 className="size-4" aria-hidden="true" />
        Passt - das spielen wir
      </Button>,
    );
    if (
      stand.modus === 'ROULETTE' &&
      stand.einstellungen.nachlosenErlaubt &&
      !stand.einstellungen.nachgelost
    ) {
      knoepfe.push(
        <Button
          key="reroll"
          type="button"
          variant="outline"
          disabled={laeuft}
          onClick={() =>
            befehl(() =>
              spielwahlNeuLosenAction({ sessionId: stand.id, schluessel: neuerSchluessel(), csrfToken }),
            )
          }
        >
          <RotateCcw className="size-4" aria-hidden="true" />
          Einmal neu auslosen
        </Button>,
      );
    }
    knoepfe.push(
      <Button
        key="again"
        type="button"
        variant="outline"
        disabled={laeuft}
        onClick={() =>
          befehl(() =>
            spielwahlNochEineAction({ sessionId: stand.id, schluessel: neuerSchluessel(), csrfToken }),
          )
        }
      >
        <RefreshCw className="size-4" aria-hidden="true" />
        Noch eine Runde
      </Button>,
    );
  }

  if (darfFuehren && stand.status === 'ENTSCHEIDUNG' && stand.modus !== 'ROULETTE') {
    knoepfe.push(
      <p key="hinweis" className="text-xs text-white/30">
        Der Server beendet die Runde, wenn die Zeit um ist oder alle gewählt haben.
      </p>,
    );
  }

  if (knoepfe.length === 0 && !dabei) {
    return null;
  }

  return (
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2">{knoepfe}</div>
      <div className="flex flex-wrap items-center gap-2">
        {dabei ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={laeuft}
            className="text-white/35 hover:text-white/70"
            onClick={() => befehl(() => spielwahlVerlassenAction({ sessionId: stand.id, csrfToken }))}
          >
            <LogOut className="size-4" aria-hidden="true" />
            Verlassen
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-white/35 hover:text-destructive"
          onClick={aufAbbruch}
        >
          <XCircle className="size-4" aria-hidden="true" />
          Runde beenden
        </Button>
      </div>
    </div>
  );
}

export { Play };
