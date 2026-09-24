'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ChevronDown, GripVertical, Plus, Star, Trash2 } from 'lucide-react';
import type { profile } from '@swisshub/modules';
import {
  spielEntfernenAction,
  spielSpeichernAction,
  spieleOrdnenAction,
} from '@/modules/profile/profil-aktionen';
import { Feldgruppe, TextFeld } from './felder';
import { SpielFelder } from './spiel-felder';

type Spiel = profile.EditorDaten['spiele'][number];

/**
 * Abschnitt «Meine Games».
 *
 * ## Warum jedes Spiel fuer sich speichert
 *
 * Ein Abschnitt mit fuenf Spielen und einem Speicherknopf haette bei einem
 * Fehler in einem Spiel alle fuenf offen gelassen. Hier ist jede Kachel eine
 * Einheit: aufklappen, aendern, speichern, zuklappen.
 *
 * ## Warum die Reihenfolge mit Zeigerereignissen arbeitet
 *
 * Die HTML5-Drag-Schnittstelle gibt es auf Telefonen nicht - `dragstart`
 * feuert dort schlicht nie. Zeigerereignisse decken Maus, Stift und Finger
 * mit demselben Code ab. Daneben stehen zwei Pfeilknoepfe: Ziehen ist
 * bequem, aber mit der Tastatur nicht zu bedienen, und eine Reihenfolge, die
 * sich nur ziehen laesst, ist fuer manche gar nicht zu aendern.
 */
export function AbschnittGames({
  csrfToken,
  start,
  katalog,
}: {
  csrfToken: string;
  start: Spiel[];
  katalog: profile.EditorDaten['katalog'];
}): React.JSX.Element {
  const router = useRouter();
  const [spiele, setSpiele] = useState(start);
  const [offen, setOffen] = useState<string | null>(null);
  const [hinzufuegen, setHinzufuegen] = useState(false);
  const [suche, setSuche] = useState('');

  const ziehen = useReihenfolge(spiele, async (neu) => {
    setSpiele(neu);
    const antwort = await spieleOrdnenAction({ csrfToken, gameIds: neu.map((s) => s.gameId) });
    if (!antwort.ok) {
      toast.error(antwort.error?.message ?? 'Die Reihenfolge konnte nicht gespeichert werden.');
      router.refresh();
    }
  });

  const entfernen = async (gameId: string): Promise<void> => {
    const antwort = await spielEntfernenAction({ csrfToken, gameId });
    if (!antwort.ok) {
      toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
      return;
    }
    setSpiele((vorher) => vorher.filter((spiel) => spiel.gameId !== gameId));
    toast.success('Spiel entfernt.');
    router.refresh();
  };

  const treffer = katalog.filter((spiel) => spiel.name.toLowerCase().includes(suche.trim().toLowerCase()));

  return (
    <div className="space-y-4">
      <ul ref={ziehen.liste} className="space-y-2">
        {spiele.map((spiel, index) => (
          <li
            key={spiel.gameId}
            data-index={index}
            className={`overflow-hidden rounded-xl border bg-card transition-shadow ${
              ziehen.aktiv === index ? 'border-primary-bright shadow-lg' : 'border-border'
            }`}
            style={ziehen.stil(index)}
          >
            <div className="flex items-center gap-2 p-3">
              <button
                type="button"
                aria-label={`${spiel.name} verschieben`}
                onPointerDown={(event) => ziehen.starten(event, index)}
                className="flex size-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground active:cursor-grabbing"
              >
                <GripVertical className="size-4" aria-hidden="true" />
              </button>

              <button
                type="button"
                onClick={() => setOffen(offen === spiel.gameId ? null : spiel.gameId)}
                aria-expanded={offen === spiel.gameId}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{spiel.name}</span>
                  {spiel.platform ? (
                    <span className="block truncate text-xs text-muted-foreground">{spiel.platform}</span>
                  ) : null}
                </span>
                {spiel.favorite ? (
                  <Star
                    className="size-4 shrink-0 fill-[hsl(45_92%_58%)] text-[hsl(45_92%_58%)]"
                    aria-label="Lieblingsspiel"
                  />
                ) : null}
                <ChevronDown
                  className={`size-4 shrink-0 text-muted-foreground transition-transform ${
                    offen === spiel.gameId ? 'rotate-180' : ''
                  }`}
                  aria-hidden="true"
                />
              </button>

              <div className="flex shrink-0">
                <button
                  type="button"
                  aria-label="Nach oben"
                  disabled={index === 0}
                  onClick={() => void ziehen.tauschen(index, index - 1)}
                  className="size-11 rounded-lg text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label="Nach unten"
                  disabled={index === spiele.length - 1}
                  onClick={() => void ziehen.tauschen(index, index + 1)}
                  className="size-11 rounded-lg text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                >
                  ↓
                </button>
              </div>
            </div>

            {offen === spiel.gameId ? (
              <SpielFormular
                csrfToken={csrfToken}
                spiel={spiel}
                onGespeichert={(neu) => {
                  setSpiele((vorher) =>
                    vorher.map((eintrag) => (eintrag.gameId === neu.gameId ? neu : eintrag)),
                  );
                  router.refresh();
                }}
                onEntfernen={() => void entfernen(spiel.gameId)}
              />
            ) : null}
          </li>
        ))}
      </ul>

      {spiele.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          Noch kein Spiel im Profil. Such dir unten eines aus.
        </p>
      ) : null}

      {hinzufuegen ? (
        <div className="space-y-3 rounded-xl border border-border bg-card p-3">
          <TextFeld
            label="Spiel suchen"
            wert={suche}
            onChange={setSuche}
            maxLaenge={60}
            platzhalter="Spiel suchen …"
          />
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {treffer.slice(0, 40).map((spiel) => (
              <li key={spiel.id}>
                <button
                  type="button"
                  onClick={async () => {
                    const antwort = await spielSpeichernAction({
                      csrfToken,
                      gameId: spiel.id,
                      platform: null,
                      note: null,
                      favorite: false,
                      fields: {},
                    });
                    if (!antwort.ok) {
                      toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
                      return;
                    }
                    setSpiele((vorher) => [
                      ...vorher,
                      {
                        gameId: spiel.id,
                        name: spiel.name,
                        cover: spiel.cover,
                        platform: null,
                        note: null,
                        favorite: false,
                        felder: {},
                      },
                    ]);
                    setOffen(spiel.id);
                    setHinzufuegen(false);
                    setSuche('');
                    router.refresh();
                  }}
                  className="min-h-11 w-full rounded-lg px-3 text-left text-sm transition-colors hover:bg-accent"
                >
                  {spiel.name}
                </button>
              </li>
            ))}
            {treffer.length === 0 ? (
              <li className="px-3 py-2 text-sm text-muted-foreground">
                Kein Spiel gefunden. Der Katalog wird unter «Was spielen wir?» gepflegt.
              </li>
            ) : null}
          </ul>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setHinzufuegen(true)}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-dashed border-border px-4 text-sm transition-colors hover:border-foreground/30"
        >
          <Plus className="size-4" aria-hidden="true" />
          Spiel hinzufügen
        </button>
      )}
    </div>
  );
}

/** Das aufgeklappte Formular eines Spiels. */
function SpielFormular({
  csrfToken,
  spiel,
  onGespeichert,
  onEntfernen,
}: {
  csrfToken: string;
  spiel: Spiel;
  onGespeichert: (spiel: Spiel) => void;
  onEntfernen: () => void;
}): React.JSX.Element {
  const [entwurf, setEntwurf] = useState(spiel);
  const [laeuft, setLaeuft] = useState(false);

  const speichern = async (): Promise<void> => {
    setLaeuft(true);
    const antwort = await spielSpeichernAction({
      csrfToken,
      gameId: entwurf.gameId,
      platform: entwurf.platform ?? '',
      note: entwurf.note ?? '',
      favorite: entwurf.favorite,
      fields: entwurf.felder,
    });
    setLaeuft(false);
    if (!antwort.ok) {
      toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
      return;
    }
    toast.success(`${entwurf.name} gespeichert.`);
    onGespeichert(entwurf);
  };

  return (
    <div className="space-y-4 border-t border-border p-4">
      <button
        type="button"
        onClick={() => setEntwurf({ ...entwurf, favorite: !entwurf.favorite })}
        aria-pressed={entwurf.favorite}
        className={`inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm transition-colors ${
          entwurf.favorite
            ? 'border-[hsl(45_92%_58%/0.5)] bg-[hsl(45_92%_58%/0.1)] text-[hsl(45_92%_62%)]'
            : 'border-border text-muted-foreground hover:border-foreground/30'
        }`}
      >
        <Star className={`size-4 ${entwurf.favorite ? 'fill-current' : ''}`} aria-hidden="true" />
        Lieblingsspiel
      </button>

      <Feldgruppe titel="Plattform" hinweis="Worauf du dieses Spiel spielst.">
        <TextFeld
          label="Plattform"
          wert={entwurf.platform ?? ''}
          onChange={(wert) => setEntwurf({ ...entwurf, platform: wert })}
          maxLaenge={32}
          platzhalter="z.B. PC"
        />
      </Feldgruppe>

      <SpielFelder
        spielName={entwurf.name}
        werte={entwurf.felder}
        onChange={(felder) => setEntwurf({ ...entwurf, felder })}
      />

      <Feldgruppe titel="Notiz">
        <TextFeld
          label="Notiz"
          wert={entwurf.note ?? ''}
          onChange={(wert) => setEntwurf({ ...entwurf, note: wert })}
          maxLaenge={200}
          platzhalter="Optional"
        />
      </Feldgruppe>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={onEntfernen}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:text-destructive"
        >
          <Trash2 className="size-4" aria-hidden="true" />
          Aus dem Profil nehmen
        </button>
        <button
          type="button"
          onClick={() => void speichern()}
          disabled={laeuft}
          className="min-h-11 rounded-lg bg-primary-bright px-4 text-sm font-semibold text-white transition-opacity disabled:opacity-40"
        >
          Speichern
        </button>
      </div>
    </div>
  );
}

/**
 * Reihenfolge per Zeiger.
 *
 * Gemessen wird an den tatsaechlichen Kastenmassen, nicht an einer
 * angenommenen Zeilenhoehe: aufgeklappte Kacheln sind hoeher als
 * zugeklappte, und eine feste Hoehe liesse den Einfuegepunkt verrutschen.
 */
function useReihenfolge(
  spiele: Spiel[],
  onFertig: (neu: Spiel[]) => Promise<void>,
): {
  liste: React.RefObject<HTMLUListElement | null>;
  aktiv: number | null;
  starten: (event: React.PointerEvent, index: number) => void;
  stil: (index: number) => React.CSSProperties | undefined;
  tauschen: (von: number, nach: number) => Promise<void>;
} {
  const liste = useRef<HTMLUListElement | null>(null);
  const [aktiv, setAktiv] = useState<number | null>(null);
  const [versatz, setVersatz] = useState(0);
  const ziel = useRef<number | null>(null);

  const tauschen = async (von: number, nach: number): Promise<void> => {
    if (nach < 0 || nach >= spiele.length || von === nach) {
      return;
    }
    const neu = [...spiele];
    const [eintrag] = neu.splice(von, 1);
    if (eintrag) {
      neu.splice(nach, 0, eintrag);
      await onFertig(neu);
    }
  };

  const starten = (event: React.PointerEvent, index: number): void => {
    event.preventDefault();
    const knopf = event.currentTarget as HTMLElement;
    knopf.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    setAktiv(index);
    ziel.current = index;

    const mitten = (): number[] =>
      [...(liste.current?.children ?? [])].map((kind) => {
        const kasten = kind.getBoundingClientRect();
        return kasten.top + kasten.height / 2;
      });

    const bewegen = (bewegung: PointerEvent): void => {
      const delta = bewegung.clientY - startY;
      setVersatz(delta);
      const punkte = mitten();
      const eigene = punkte[index];
      if (eigene === undefined) {
        return;
      }
      const jetzt = eigene + delta;
      let neuerIndex = index;
      for (let i = 0; i < punkte.length; i += 1) {
        const punkt = punkte[i];
        if (punkt === undefined || i === index) {
          continue;
        }
        if ((i < index && jetzt < punkt) || (i > index && jetzt > punkt)) {
          neuerIndex = i;
        }
      }
      ziel.current = neuerIndex;
    };

    const loslassen = (): void => {
      knopf.removeEventListener('pointermove', bewegen);
      knopf.removeEventListener('pointerup', loslassen);
      knopf.removeEventListener('pointercancel', loslassen);
      setAktiv(null);
      setVersatz(0);
      const nach = ziel.current;
      ziel.current = null;
      if (nach !== null && nach !== index) {
        void tauschen(index, nach);
      }
    };

    knopf.addEventListener('pointermove', bewegen);
    knopf.addEventListener('pointerup', loslassen);
    knopf.addEventListener('pointercancel', loslassen);
  };

  return {
    liste,
    aktiv,
    starten,
    tauschen,
    stil: (index) =>
      aktiv === index
        ? // Nur `transform`: die uebrigen Kacheln bleiben, wo sie sind, und
          // es wird kein Layout neu gerechnet.
          { transform: `translate3d(0, ${versatz}px, 0)`, zIndex: 10, position: 'relative' }
        : undefined,
  };
}
