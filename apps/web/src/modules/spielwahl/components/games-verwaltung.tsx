'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Archive,
  ArchiveRestore,
  Gamepad2,
  ImageUp,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { PLATTFORMEN } from '@swisshub/modules/games/schemas';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import { EmptyState } from '@/components/shared/states';
import {
  gameAnlegenAction,
  gameArchivierenAction,
  gameBearbeitenAction,
  gameCoverEntfernenAction,
  gameZurueckholenAction,
} from '@/modules/spielwahl/games-aktionen';
import { cn } from '@/lib/utils';

/**
 * Der Spielekatalog, verwaltet.
 *
 * ## Warum Karten und keine Tabelle
 *
 * Ein Spiel erkennt man am Cover, nicht an seiner Zeile. Eine Tabelle waere
 * schneller gebaut und langsamer zu lesen - wer hier sucht, sucht ein Bild.
 * Die Angaben, die man trotzdem braucht (Plattform, Zustand, was daran
 * haengt), stehen auf der Karte, nicht in einer Spalte daneben.
 *
 * ## Die drei Zustaende
 *
 * Aktiv, abgeschaltet, archiviert. Der Unterschied zwischen den letzten
 * beiden ist wichtig genug fuer zwei getrennte Anzeigen: abgeschaltet heisst
 * «zurzeit nicht im Angebot» und bleibt in der Liste; archiviert heisst «aus
 * dem Katalog genommen» und verschwindet, bis man ausdruecklich danach fragt.
 *
 * Geloescht wird nichts. An einem Spiel haengen Turniere, Clips und
 * vergangene Runden - die sollen nicht unleserlich werden, weil jemand
 * aufgeraeumt hat.
 */

export interface GameZeile {
  id: string;
  name: string;
  shortName: string | null;
  description: string | null;
  genre: string | null;
  platforms: string[];
  coverSrc: string | null;
  coverUrl: string | null;
  hatUpload: boolean;
  maxPlayers: number | null;
  enabled: boolean;
  archiviert: boolean;
  nutzung: { turniere: number; clips: number; runden: number };
}

type Formular = {
  gameId?: string;
  name: string;
  shortName: string;
  description: string;
  genre: string;
  platforms: string[];
  coverUrl: string;
  maxPlayers: string;
  enabled: boolean;
};

const LEER: Formular = {
  name: '',
  shortName: '',
  description: '',
  genre: '',
  platforms: [],
  coverUrl: '',
  maxPlayers: '',
  enabled: true,
};

function ausZeile(zeile: GameZeile): Formular {
  return {
    gameId: zeile.id,
    name: zeile.name,
    shortName: zeile.shortName ?? '',
    description: zeile.description ?? '',
    genre: zeile.genre ?? '',
    platforms: zeile.platforms,
    coverUrl: zeile.coverUrl ?? '',
    maxPlayers: zeile.maxPlayers === null ? '' : String(zeile.maxPlayers),
    enabled: zeile.enabled,
  };
}

export function GamesVerwaltung({
  spiele,
  csrfToken,
  maxCoverBytes,
}: {
  spiele: GameZeile[];
  csrfToken: string;
  maxCoverBytes: number;
}): React.JSX.Element {
  const router = useRouter();
  const [suche, setSuche] = useState('');
  const [plattform, setPlattform] = useState<string | null>(null);
  const [zustand, setZustand] = useState<'alle' | 'aktiv' | 'inaktiv' | 'archiv'>('alle');
  const [formular, setFormular] = useState<Formular | null>(null);
  const [archivieren, setArchivieren] = useState<GameZeile | null>(null);
  const [laeuft, setLaeuft] = useState<string | null>(null);

  const gefiltert = useMemo(() => {
    const nadel = suche.trim().toLowerCase();
    return spiele.filter((spiel) => {
      if (zustand === 'aktiv' && (!spiel.enabled || spiel.archiviert)) return false;
      if (zustand === 'inaktiv' && (spiel.enabled || spiel.archiviert)) return false;
      if (zustand === 'archiv' && !spiel.archiviert) return false;
      // Ohne ausdrückliche Wahl bleibt das Archiv aussen vor - sonst stünde
      // die aufgeräumte Liste gleich wieder voll.
      if (zustand === 'alle' && spiel.archiviert) return false;
      if (plattform && !spiel.platforms.includes(plattform)) return false;
      if (nadel) {
        const heuhaufen = `${spiel.name} ${spiel.shortName ?? ''} ${spiel.genre ?? ''}`.toLowerCase();
        if (!heuhaufen.includes(nadel)) return false;
      }
      return true;
    });
  }, [spiele, suche, plattform, zustand]);

  const archivZahl = spiele.filter((spiel) => spiel.archiviert).length;

  async function speichern(): Promise<void> {
    if (!formular) return;
    setLaeuft('speichern');

    const eingabe = {
      csrfToken,
      name: formular.name,
      shortName: formular.shortName,
      description: formular.description,
      genre: formular.genre,
      platforms: formular.platforms as never,
      coverUrl: formular.coverUrl,
      maxPlayers: formular.maxPlayers === '' ? null : Number(formular.maxPlayers),
      enabled: formular.enabled,
    };

    const antwort = formular.gameId
      ? await gameBearbeitenAction({ ...eingabe, gameId: formular.gameId })
      : await gameAnlegenAction(eingabe);

    setLaeuft(null);
    if (!antwort.ok) {
      toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
      return;
    }
    toast.success(formular.gameId ? 'Gespeichert.' : `«${antwort.data.name}» ist im Katalog.`);
    setFormular(null);
    router.refresh();
  }

  async function archiviereJetzt(): Promise<void> {
    if (!archivieren) return;
    setLaeuft('archiv');
    const antwort = await gameArchivierenAction({ csrfToken, gameId: archivieren.id });
    setLaeuft(null);
    setArchivieren(null);
    if (!antwort.ok) {
      toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
      return;
    }
    toast.success('Archiviert. Alles, was darauf zeigt, bleibt lesbar.');
    router.refresh();
  }

  async function zurueckholen(spiel: GameZeile): Promise<void> {
    setLaeuft(spiel.id);
    const antwort = await gameZurueckholenAction({ csrfToken, gameId: spiel.id });
    setLaeuft(null);
    if (!antwort.ok) {
      toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
      return;
    }
    toast.success('Zurückgeholt. Aktiv schalten kannst du es beim Bearbeiten.');
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {/* --- Werkzeugleiste ------------------------------------------------ */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={suche}
            onChange={(ereignis) => setSuche(ereignis.target.value)}
            placeholder="Spiel suchen"
            aria-label="Spiel suchen"
            className="pl-9"
          />
        </div>

        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Zustand">
          {(
            [
              ['alle', 'Alle'],
              ['aktiv', 'Aktiv'],
              ['inaktiv', 'Abgeschaltet'],
              ['archiv', `Archiv${archivZahl > 0 ? ` (${archivZahl})` : ''}`],
            ] as const
          ).map(([wert, label]) => (
            <button
              key={wert}
              type="button"
              onClick={() => setZustand(wert)}
              aria-pressed={zustand === wert}
              className={cn(
                'rounded-lg border px-3 py-1.5 text-xs font-medium transition',
                zustand === wert
                  ? 'border-primary/50 bg-primary/15 text-primary-bright'
                  : 'border-border text-muted-foreground hover:border-primary/40',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <Button className="ml-auto" onClick={() => setFormular({ ...LEER })}>
          <Plus className="size-4" aria-hidden="true" />
          Spiel anlegen
        </Button>
      </div>

      {/* Plattformen als Filterzeile - nur die, die tatsächlich vorkommen. */}
      <Plattformfilter spiele={spiele} gewaehlt={plattform} onWahl={setPlattform} />

      {/* --- Das Raster ---------------------------------------------------- */}
      {gefiltert.length === 0 ? (
        <EmptyState
          title={spiele.length === 0 ? 'Noch kein Spiel im Katalog' : 'Nichts gefunden'}
          description={
            spiele.length === 0
              ? 'Leg das erste an - Turniere, Clips und die Runden schöpfen alle aus dieser Liste.'
              : 'Andere Suche oder anderer Filter.'
          }
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {gefiltert.map((spiel) => (
            /*
             * `min-w-0`: ein Rasterfeld ist standardmässig so breit wie sein
             * breitester unteilbarer Inhalt. Ohne diese Zeile zog die
             * Knopfreihe der Karte die ganze Spalte über die Bildschirmbreite
             * hinaus - auf einem Telefon messbar als seitlich scrollende Seite.
             */
            <li key={spiel.id} className="min-w-0">
              <Spielkarte
                spiel={spiel}
                laeuft={laeuft === spiel.id}
                onBearbeiten={() => setFormular(ausZeile(spiel))}
                onArchivieren={() => setArchivieren(spiel)}
                onZurueckholen={() => void zurueckholen(spiel)}
              />
            </li>
          ))}
        </ul>
      )}

      <GameFormular
        wert={formular}
        laeuft={laeuft === 'speichern'}
        csrfToken={csrfToken}
        maxCoverBytes={maxCoverBytes}
        onAendern={setFormular}
        onSpeichern={() => void speichern()}
        onSchliessen={() => setFormular(null)}
      />

      <ConfirmationDialog
        open={archivieren !== null}
        onOpenChange={(offen) => !offen && setArchivieren(null)}
        title={`«${archivieren?.name ?? ''}» archivieren?`}
        description={
          archivieren
            ? `Es verschwindet aus jeder Auswahl. ${beschreibeNutzung(archivieren.nutzung)} Nichts davon geht verloren - archiviert ist nicht gelöscht, und zurückholen kannst du es jederzeit.`
            : ''
        }
        confirmLabel="Archivieren"
        onConfirm={() => void archiviereJetzt()}
      />
    </div>
  );
}

/** Was an einem Spiel hängt, in einem Satz. */
function beschreibeNutzung(nutzung: GameZeile['nutzung']): string {
  /** «1 Runde», nicht «1 Runden». */
  const zaehle = (anzahl: number, einzahl: string, mehrzahl: string): string | null =>
    anzahl === 0 ? null : `${anzahl} ${anzahl === 1 ? einzahl : mehrzahl}`;

  const teile = [
    zaehle(nutzung.turniere, 'Turnier', 'Turniere'),
    zaehle(nutzung.clips, 'Clip', 'Clips'),
    zaehle(nutzung.runden, 'Runde', 'Runden'),
  ].filter(Boolean);

  if (teile.length === 0) {
    return 'Bisher hängt nichts daran.';
  }
  return `${teile.length === 1 ? 'Daran hängt' : 'Daran hängen'}: ${teile.join(', ')}.`;
}

function Plattformfilter({
  spiele,
  gewaehlt,
  onWahl,
}: {
  spiele: GameZeile[];
  gewaehlt: string | null;
  onWahl: (wert: string | null) => void;
}): React.JSX.Element | null {
  const vorhanden = useMemo(() => {
    const menge = new Set<string>();
    for (const spiel of spiele) {
      for (const plattform of spiel.platforms) {
        menge.add(plattform);
      }
    }
    return [...menge].sort();
  }, [spiele]);

  if (vorhanden.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">Plattform</span>
      {vorhanden.map((plattform) => (
        <button
          key={plattform}
          type="button"
          onClick={() => onWahl(gewaehlt === plattform ? null : plattform)}
          aria-pressed={gewaehlt === plattform}
          className={cn(
            'rounded-full border px-3 py-1 text-xs transition',
            gewaehlt === plattform
              ? 'border-primary/50 bg-primary/15 text-primary-bright'
              : 'border-border text-muted-foreground hover:border-primary/40',
          )}
        >
          {plattform}
        </button>
      ))}
      {gewaehlt ? (
        <button
          type="button"
          onClick={() => onWahl(null)}
          className="text-xs text-muted-foreground underline-offset-4 hover:underline"
        >
          Filter aufheben
        </button>
      ) : null}
    </div>
  );
}

/**
 * Das Cover einer Karte - oder das Zeichen, das dafür einsteht.
 *
 * ## Warum das eine eigene Komponente mit Zustand ist
 *
 * Ein Cover kann ins Leere zeigen: der Host ist weg, das Bild gelöscht, die
 * Adresse war von Anfang an falsch. Dann bliebe eine leere Fläche mit Rahmen
 * stehen, und die Karte sähe kaputt aus.
 *
 * Der naheliegende Weg - `onError` am `<img>` - reicht nicht. Das Bild steht
 * bereits im serverseitig ausgelieferten HTML; der Browser beginnt zu laden,
 * bevor React einen Handler hat. Scheitert es in dieser Lücke, ist das
 * Ereignis vorbei, bevor jemand zuhört.
 *
 * Deshalb wird das Bild erst nach dem Einhängen gesetzt. Dann gilt die
 * übliche Reihenfolge: Handler zuerst, Ladevorgang danach. Der Preis ist ein
 * Bildaufbau einen Wimpernschlag später; der Gewinn ist, dass ein kaputtes
 * Cover zuverlässig wie ein fehlendes aussieht statt wie ein Fehler.
 */
function Cover({ src }: { src: string | null }): React.JSX.Element {
  const [geladen, setGeladen] = useState(false);
  const [kaputt, setKaputt] = useState(false);

  useEffect(() => {
    setKaputt(false);
    setGeladen(true);
  }, [src]);

  return (
    <>
      {/* Liegt immer darunter und wird sichtbar, sobald darüber nichts steht. */}
      <div className="absolute inset-0 grid place-items-center">
        <Gamepad2 className="size-10 text-muted-foreground/40" aria-hidden="true" />
      </div>
      {src && geladen && !kaputt ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          className="relative size-full object-cover"
          loading="lazy"
          onError={() => setKaputt(true)}
        />
      ) : null}
    </>
  );
}

function Spielkarte({
  spiel,
  laeuft,
  onBearbeiten,
  onArchivieren,
  onZurueckholen,
}: {
  spiel: GameZeile;
  laeuft: boolean;
  onBearbeiten: () => void;
  onArchivieren: () => void;
  onZurueckholen: () => void;
}): React.JSX.Element {
  return (
    <article
      className={cn(
        'group flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card transition',
        spiel.archiviert ? 'opacity-60' : 'hover:border-primary/40',
      )}
    >
      <div className="relative aspect-[21/10] w-full overflow-hidden bg-background/60">
        <Cover src={spiel.coverSrc} />

        <div className="absolute right-2 top-2 flex gap-1.5">
          {spiel.archiviert ? (
            <Badge variant="outline">Archiviert</Badge>
          ) : spiel.enabled ? (
            <Badge variant="success">Aktiv</Badge>
          ) : (
            <Badge variant="warning">Abgeschaltet</Badge>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="min-w-0">
          {/* Lange Titel brechen um, statt die Karte zu sprengen. */}
          <h3 className="break-words text-sm font-semibold leading-snug">{spiel.name}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {[spiel.genre, spiel.maxPlayers ? `bis ${spiel.maxPlayers} Spieler` : null]
              .filter(Boolean)
              .join(' · ') || 'Ohne weitere Angaben'}
          </p>
        </div>

        {spiel.platforms.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {spiel.platforms.map((plattform) => (
              <Badge key={plattform} variant="outline">
                {plattform}
              </Badge>
            ))}
          </div>
        ) : null}

        <p className="mt-auto pt-2 text-xs text-muted-foreground">{beschreibeNutzung(spiel.nutzung)}</p>

        <div className="flex flex-wrap gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={onBearbeiten} disabled={laeuft}>
            <Pencil className="size-4" aria-hidden="true" />
            Bearbeiten
          </Button>
          {spiel.archiviert ? (
            <Button variant="outline" size="sm" onClick={onZurueckholen} disabled={laeuft}>
              {laeuft ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <ArchiveRestore className="size-4" aria-hidden="true" />
              )}
              Zurückholen
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={onArchivieren} disabled={laeuft}>
              <Archive className="size-4" aria-hidden="true" />
              Archivieren
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}

function GameFormular({
  wert,
  laeuft,
  csrfToken,
  maxCoverBytes,
  onAendern,
  onSpeichern,
  onSchliessen,
}: {
  wert: Formular | null;
  laeuft: boolean;
  csrfToken: string;
  maxCoverBytes: number;
  onAendern: (wert: Formular) => void;
  onSpeichern: () => void;
  onSchliessen: () => void;
}): React.JSX.Element {
  const router = useRouter();
  const dateiFeld = useRef<HTMLInputElement>(null);
  const [laedt, setLaedt] = useState(false);

  async function coverHochladen(datei: File): Promise<void> {
    if (!wert?.gameId) {
      return;
    }
    if (datei.size > maxCoverBytes) {
      toast.error(`Die Datei ist zu gross (maximal ${Math.round(maxCoverBytes / 1024 / 1024)} MB).`);
      return;
    }
    setLaedt(true);
    const form = new FormData();
    form.set('csrfToken', csrfToken);
    form.set('image', datei);
    const antwort = await fetch(`/api/games/${wert.gameId}/cover`, { method: 'POST', body: form });
    const daten = (await antwort.json()) as { ok: boolean; error?: { message: string } };
    setLaedt(false);
    if (!daten.ok) {
      toast.error(daten.error?.message ?? 'Das hat nicht geklappt.');
      return;
    }
    toast.success('Cover gespeichert.');
    router.refresh();
  }

  async function coverEntfernen(): Promise<void> {
    if (!wert?.gameId) return;
    setLaedt(true);
    const antwort = await gameCoverEntfernenAction({ csrfToken, gameId: wert.gameId });
    setLaedt(false);
    if (!antwort.ok) {
      toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
      return;
    }
    toast.success('Cover entfernt.');
    router.refresh();
  }

  const offen = wert !== null;

  return (
    <Dialog open={offen} onOpenChange={(auf) => !auf && onSchliessen()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{wert?.gameId ? 'Spiel bearbeiten' : 'Spiel anlegen'}</DialogTitle>
          <DialogDescription>
            Der Katalog gilt für alle Module - auch für Turniere und Clips. Pflicht ist nur der Name.
          </DialogDescription>
        </DialogHeader>

        {wert ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="game-name">Name</Label>
              <Input
                id="game-name"
                value={wert.name}
                onChange={(ereignis) => onAendern({ ...wert, name: ereignis.target.value })}
                maxLength={80}
                autoFocus
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="game-kurz">Kurzform</Label>
                <Input
                  id="game-kurz"
                  value={wert.shortName}
                  onChange={(ereignis) => onAendern({ ...wert, shortName: ereignis.target.value })}
                  maxLength={32}
                  placeholder="z.B. CS2"
                />
                <p className="text-xs text-muted-foreground">Für enge Stellen wie das Rad.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="game-genre">Genre</Label>
                <Input
                  id="game-genre"
                  value={wert.genre}
                  onChange={(ereignis) => onAendern({ ...wert, genre: ereignis.target.value })}
                  maxLength={40}
                  placeholder="z.B. Koop-Shooter"
                />
              </div>
            </div>

            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">Plattformen</legend>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {PLATTFORMEN.map((plattform) => {
                  const dabei = wert.platforms.includes(plattform);
                  return (
                    <button
                      key={plattform}
                      type="button"
                      aria-pressed={dabei}
                      onClick={() =>
                        onAendern({
                          ...wert,
                          platforms: dabei
                            ? wert.platforms.filter((eintrag) => eintrag !== plattform)
                            : [...wert.platforms, plattform],
                        })
                      }
                      className={cn(
                        'rounded-full border px-3 py-1 text-xs transition',
                        dabei
                          ? 'border-primary/50 bg-primary/15 text-primary-bright'
                          : 'border-border text-muted-foreground hover:border-primary/40',
                      )}
                    >
                      {plattform}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <div className="space-y-1.5">
              <Label htmlFor="game-cover">Cover-Adresse</Label>
              <Input
                id="game-cover"
                value={wert.coverUrl}
                onChange={(ereignis) => onAendern({ ...wert, coverUrl: ereignis.target.value })}
                placeholder="https://..."
                spellCheck={false}
              />
              {wert.gameId ? (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <input
                    ref={dateiFeld}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="sr-only"
                    onChange={(ereignis) => {
                      const datei = ereignis.target.files?.[0];
                      if (datei) {
                        void coverHochladen(datei);
                      }
                      ereignis.target.value = '';
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={laedt}
                    onClick={() => dateiFeld.current?.click()}
                  >
                    {laedt ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <ImageUp className="size-4" aria-hidden="true" />
                    )}
                    Bild hochladen
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={laedt}
                    onClick={() => void coverEntfernen()}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                    Hochgeladenes entfernen
                  </Button>
                  <p className="w-full text-xs text-muted-foreground">
                    Ein hochgeladenes Bild gilt vor der Adresse. Discord-Ankündigungen zeigen nur die Adresse
                    - ein Upload liegt hinter der Anmeldung.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Hochladen geht, sobald das Spiel angelegt ist.
                </p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="game-max">Übliche Gruppengrösse</Label>
                <Input
                  id="game-max"
                  type="number"
                  min={1}
                  max={100}
                  value={wert.maxPlayers}
                  onChange={(ereignis) => onAendern({ ...wert, maxPlayers: ereignis.target.value })}
                  placeholder="unbegrenzt"
                />
              </div>
              <div className="flex items-end pb-2">
                <label className="flex items-center gap-3 text-sm">
                  <Switch
                    checked={wert.enabled}
                    onCheckedChange={(an) => onAendern({ ...wert, enabled: an })}
                  />
                  <span>
                    Aktiv
                    <span className="block text-xs text-muted-foreground">
                      Steht in neuen Runden zur Auswahl.
                    </span>
                  </span>
                </label>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="game-beschreibung">Beschreibung</Label>
              <textarea
                id="game-beschreibung"
                value={wert.description}
                onChange={(ereignis) => onAendern({ ...wert, description: ereignis.target.value })}
                maxLength={500}
                rows={3}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:border-primary/60"
              />
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onSchliessen} disabled={laeuft}>
            <X className="size-4" aria-hidden="true" />
            Abbrechen
          </Button>
          <Button onClick={onSpeichern} disabled={laeuft || (wert?.name.trim().length ?? 0) < 2}>
            {laeuft ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
