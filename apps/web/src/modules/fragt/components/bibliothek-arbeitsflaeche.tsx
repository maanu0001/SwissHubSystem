'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check, Copy, Loader2, Plus, Radio, Save, Send, Trash2, X } from 'lucide-react';
/*
 * Der schmale Einstieg, nicht `@swisshub/modules`.
 *
 * Der Haupteinstieg zieht die Modul-Registry mitsamt Prisma und dem
 * Umgebungs-Schema in das Browser-Bundle. `fragt/typen` ist reine Kenntnis -
 * welcher Fragetyp wie viele Antworten erlaubt - und importiert selbst nur
 * einen Typ, also zur Laufzeit nichts.
 */
import { FRAGETYPEN, KATEGORIE_VORSCHLAEGE, fragetyp } from '@swisshub/modules/fragt/typen';
import type { FragetypAngaben } from '@swisshub/modules/fragt/typen';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/shared/states';
import {
  fragtFrageBearbeitenAction,
  fragtFrageDuplizierenAction,
  fragtFrageErstellenAction,
  fragtFrageStatusAction,
  fragtSeedEinspielenAction,
  fragtVeroeffentlichenAction,
} from '@/modules/fragt/actions';
import { cn } from '@/lib/utils';

/**
 * Die Fragenbibliothek als Arbeitsflaeche.
 *
 * ## Warum Liste und Formular auf einer Seite
 *
 * Weil das Schreiben von Fragen eine Serie ist. Wer zehn Fragen vorbereitet,
 * will nicht zehnmal auf eine Unterseite und zurueck - er will links sehen, was
 * schon da ist, und rechts die naechste tippen.
 *
 * ## Was die Oberflaeche nicht entscheidet
 *
 * Ob eine Frage genug Antworten hat, ob sie bearbeitet werden darf, ob sie
 * veroeffentlicht werden kann: alles serverseitig. Die Knoepfe hier
 * verschwinden, wo sie keinen Sinn ergeben - aber wer das umgeht, bekommt
 * dieselbe Ablehnung.
 */

export interface FrageAnsicht {
  id: string;
  text: string;
  untertitel: string | null;
  kategorie: string;
  typ: FragetypAngaben['typ'];
  status: string;
  antworten: string[];
  dauerStunden: number;
  zuletztGestellt: string | null;
  /** Wurde sie schon einmal gestellt? Dann sind die Antworten festgeschrieben. */
  gestellt: boolean;
}

const STATUS_TEXT: Record<string, { label: string; ton: string }> = {
  DRAFT: { label: 'Entwurf', ton: 'bg-muted text-muted-foreground' },
  READY: { label: 'Freigegeben', ton: 'bg-emerald-500/15 text-emerald-400' },
  SCHEDULED: { label: 'Geplant', ton: 'bg-sky-500/15 text-sky-400' },
  ACTIVE: { label: 'Läuft', ton: 'bg-primary/20 text-primary' },
  CLOSED: { label: 'Abgeschlossen', ton: 'bg-muted text-muted-foreground' },
  ARCHIVED: { label: 'Archiviert', ton: 'bg-muted text-muted-foreground/70' },
};

export function BibliothekArbeitsflaeche({
  csrfToken,
  fragen,
  kategorien,
  darfVeroeffentlichen,
  laufendeAbstimmung,
}: {
  /**
   * Der CSRF-Token der Sitzung.
   *
   * Jede Server Action prueft ihn vor allem anderen ausser der Anmeldung. Ohne
   * ihn antwortet sie mit «Sicherheitspruefung fehlgeschlagen» - und zwar erst
   * im Browser, nicht beim Uebersetzen.
   */
  csrfToken: string;
  fragen: FrageAnsicht[];
  kategorien: string[];
  darfVeroeffentlichen: boolean;
  /** Laeuft schon eine? Dann kann nichts veroeffentlicht werden. */
  laufendeAbstimmung: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [suche, setSuche] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('alle');
  const [bearbeitet, setBearbeitet] = useState<FrageAnsicht | null>(null);
  const [formularOffen, setFormularOffen] = useState(false);
  const [laeuft, setLaeuft] = useState<string | null>(null);

  const gefiltert = useMemo(() => {
    const begriff = suche.trim().toLocaleLowerCase('de-CH');
    return fragen.filter((frage) => {
      if (statusFilter !== 'alle' && frage.status !== statusFilter) {
        return false;
      }
      if (!begriff) {
        return true;
      }
      return (
        frage.text.toLocaleLowerCase('de-CH').includes(begriff) ||
        frage.kategorie.toLocaleLowerCase('de-CH').includes(begriff) ||
        frage.antworten.some((antwort) => antwort.toLocaleLowerCase('de-CH').includes(begriff))
      );
    });
  }, [fragen, statusFilter, suche]);

  async function fuehreAus(schluessel: string, arbeit: () => Promise<{ ok: boolean; fehler?: string }>) {
    setLaeuft(schluessel);
    const ausgang = await arbeit();
    setLaeuft(null);
    if (!ausgang.ok) {
      toast.error(ausgang.fehler ?? 'Das hat nicht geklappt.');
      return false;
    }
    router.refresh();
    return true;
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={suche}
            onChange={(ereignis) => setSuche(ereignis.target.value)}
            placeholder="Fragen durchsuchen ..."
            className="h-9 max-w-xs"
          />
          <select
            value={statusFilter}
            onChange={(ereignis) => setStatusFilter(ereignis.target.value)}
            className="h-9 rounded-md border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="alle">Alle Status</option>
            {Object.entries(STATUS_TEXT).map(([wert, angaben]) => (
              <option key={wert} value={wert}>
                {angaben.label}
              </option>
            ))}
          </select>
          <span className="text-sm text-muted-foreground">
            {gefiltert.length} von {fragen.length}
          </span>
        </div>

        {gefiltert.length === 0 ? (
          <EmptyState
            title={fragen.length === 0 ? 'Noch keine Fragen' : 'Nichts gefunden'}
            description={
              fragen.length === 0
                ? 'Schreibe rechts die erste Frage - oder spiele die zehn vorbereiteten ein. Sie entstehen als Entwurf und landen nicht von selbst auf Discord.'
                : 'Andere Suche oder anderer Status.'
            }
            action={
              fragen.length === 0 ? (
                <Button
                  variant="outline"
                  disabled={laeuft === 'seed'}
                  onClick={() =>
                    void fuehreAus('seed', async () => {
                      const antwort = await fragtSeedEinspielenAction({ csrfToken });
                      if (antwort.ok) {
                        toast.success(
                          antwort.data.neu === 0
                            ? 'Die vorbereiteten Fragen sind schon da.'
                            : `${antwort.data.neu} Fragen als Entwurf angelegt.`,
                        );
                      }
                      return { ok: antwort.ok, fehler: antwort.ok ? undefined : antwort.error.message };
                    })
                  }
                >
                  {laeuft === 'seed' ? <Loader2 className="size-4 animate-spin" /> : null}
                  Vorbereitete Fragen einspielen
                </Button>
              ) : null
            }
          />
        ) : (
          <ul className="space-y-2">
            {gefiltert.map((frage) => {
              const status = STATUS_TEXT[frage.status] ?? STATUS_TEXT.DRAFT!;
              return (
                <li key={frage.id} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', status.ton)}>
                          {status.label}
                        </span>
                        <Badge variant="outline">{fragetyp(frage.typ).label}</Badge>
                        <Badge variant="outline">{frage.kategorie}</Badge>
                      </div>
                      <p className="mt-2 break-words font-semibold leading-tight">{frage.text}</p>
                      <p className="mt-1 break-words text-sm text-muted-foreground">
                        {frage.antworten.join('  ·  ')}
                      </p>
                      {frage.zuletztGestellt ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Zuletzt gestellt: {frage.zuletztGestellt}
                        </p>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      {frage.status === 'DRAFT' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={laeuft === frage.id}
                          onClick={() =>
                            void fuehreAus(frage.id, async () => {
                              const antwort = await fragtFrageStatusAction({
                                csrfToken,
                                frageId: frage.id,
                                status: 'READY',
                              });
                              if (antwort.ok) {
                                toast.success('Freigegeben - die Automatik darf sie jetzt wählen.');
                              }
                              return {
                                ok: antwort.ok,
                                fehler: antwort.ok ? undefined : antwort.error.message,
                              };
                            })
                          }
                        >
                          <Check className="size-4" />
                          Freigeben
                        </Button>
                      ) : null}

                      {frage.status === 'READY' ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={laeuft === frage.id}
                          onClick={() =>
                            void fuehreAus(frage.id, async () => {
                              const antwort = await fragtFrageStatusAction({
                                csrfToken,
                                frageId: frage.id,
                                status: 'DRAFT',
                              });
                              return {
                                ok: antwort.ok,
                                fehler: antwort.ok ? undefined : antwort.error.message,
                              };
                            })
                          }
                        >
                          <X className="size-4" />
                          Zurücknehmen
                        </Button>
                      ) : null}

                      {darfVeroeffentlichen && (frage.status === 'READY' || frage.status === 'SCHEDULED') ? (
                        <Button
                          size="sm"
                          disabled={laeuft === frage.id || laufendeAbstimmung}
                          title={
                            laufendeAbstimmung
                              ? 'Es läuft bereits eine Abstimmung.'
                              : 'Jetzt auf Discord stellen'
                          }
                          onClick={() =>
                            void fuehreAus(frage.id, async () => {
                              const antwort = await fragtVeroeffentlichenAction({
                                csrfToken,
                                frageId: frage.id,
                              });
                              if (antwort.ok) {
                                toast.success('Die Frage steht auf Discord.');
                              }
                              return {
                                ok: antwort.ok,
                                fehler: antwort.ok ? undefined : antwort.error.message,
                              };
                            })
                          }
                        >
                          {laeuft === frage.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Send className="size-4" />
                          )}
                          Jetzt stellen
                        </Button>
                      ) : null}

                      <Button
                        size="sm"
                        variant="ghost"
                        title="Duplizieren"
                        disabled={laeuft === frage.id}
                        onClick={() =>
                          void fuehreAus(frage.id, async () => {
                            const antwort = await fragtFrageDuplizierenAction({
                              csrfToken,
                              frageId: frage.id,
                            });
                            if (antwort.ok) {
                              toast.success('Kopie als Entwurf angelegt.');
                            }
                            return { ok: antwort.ok, fehler: antwort.ok ? undefined : antwort.error.message };
                          })
                        }
                      >
                        <Copy className="size-4" />
                      </Button>

                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setBearbeitet(frage);
                          setFormularOffen(true);
                        }}
                      >
                        Bearbeiten
                      </Button>

                      {frage.status !== 'ARCHIVED' && frage.status !== 'ACTIVE' ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Archivieren"
                          disabled={laeuft === frage.id}
                          onClick={() =>
                            void fuehreAus(frage.id, async () => {
                              const antwort = await fragtFrageStatusAction({
                                csrfToken,
                                frageId: frage.id,
                                status: 'ARCHIVED',
                              });
                              return {
                                ok: antwort.ok,
                                fehler: antwort.ok ? undefined : antwort.error.message,
                              };
                            })
                          }
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  {frage.gestellt ? (
                    <p className="mt-3 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                      Diese Frage stand schon auf Discord. Der Text lässt sich ändern, die
                      Antwortmöglichkeiten nicht - sonst wären die abgegebenen Stimmen einer anderen Antwort
                      zugeordnet. Für eine andere Auswahl: duplizieren.
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="lg:sticky lg:top-4 lg:self-start">
        {formularOffen || bearbeitet ? (
          <FrageFormular
            key={bearbeitet?.id ?? 'neu'}
            csrfToken={csrfToken}
            frage={bearbeitet}
            kategorien={kategorien}
            aufFertig={() => {
              setBearbeitet(null);
              setFormularOffen(false);
              router.refresh();
            }}
            aufAbbruch={() => {
              setBearbeitet(null);
              setFormularOffen(false);
            }}
          />
        ) : (
          <div className="space-y-3 rounded-xl border border-border bg-card p-5">
            <h3 className="font-semibold">Neue Frage</h3>
            <p className="text-sm text-muted-foreground">
              Vier Typen: Entweder-oder, klassische Umfrage, Community-Favorit und Hot Take. Jede Frage
              entsteht als Entwurf.
            </p>
            <Button className="w-full" onClick={() => setFormularOffen(true)}>
              <Plus className="size-4" />
              Frage schreiben
            </Button>
            <Button
              variant="outline"
              className="w-full"
              disabled={laeuft === 'seed'}
              onClick={() =>
                void fuehreAus('seed', async () => {
                  const antwort = await fragtSeedEinspielenAction({ csrfToken });
                  if (antwort.ok) {
                    toast.success(
                      antwort.data.neu === 0
                        ? 'Die vorbereiteten Fragen sind schon da.'
                        : `${antwort.data.neu} Fragen als Entwurf angelegt.`,
                    );
                  }
                  return { ok: antwort.ok, fehler: antwort.ok ? undefined : antwort.error.message };
                })
              }
            >
              {laeuft === 'seed' ? <Loader2 className="size-4 animate-spin" /> : null}
              Vorbereitete Fragen einspielen
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Das Formular.
 *
 * Der Fragetyp bestimmt, wie viele Antwortfelder es gibt - die Regeln stehen in
 * `FRAGETYPEN` und werden hier nur gelesen. Bei Hot Take verschwinden die
 * Felder ganz: die Antworten sind dort immer «Stimme zu» und «Stimme nicht zu»,
 * und ein Feld, das man ausfuellen kann, ohne dass es wirkt, ist eine Falle.
 */
function FrageFormular({
  csrfToken,
  frage,
  kategorien,
  aufFertig,
  aufAbbruch,
}: {
  csrfToken: string;
  frage: FrageAnsicht | null;
  kategorien: string[];
  aufFertig: () => void;
  aufAbbruch: () => void;
}): React.JSX.Element {
  const [text, setText] = useState(frage?.text ?? '');
  const [untertitel, setUntertitel] = useState(frage?.untertitel ?? '');
  const [kategorie, setKategorie] = useState(frage?.kategorie ?? 'Games');
  const [typ, setTyp] = useState<FrageAnsicht['typ']>(frage?.typ ?? 'UMFRAGE');
  const [antworten, setAntworten] = useState<string[]>(
    frage?.antworten.length ? [...frage.antworten] : ['', ''],
  );
  const [dauer, setDauer] = useState(frage?.dauerStunden ?? 48);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  const angaben = fragetyp(typ);
  const festeAntworten = Boolean(angaben.festeOptionen);
  const antwortenGesperrt = Boolean(frage?.gestellt);

  function setzeTyp(neu: FrageAnsicht['typ']): void {
    setTyp(neu);
    const regeln = fragetyp(neu);
    if (regeln.festeOptionen) {
      setAntworten([...regeln.festeOptionen]);
      return;
    }
    // Auf die Mindestzahl auffuellen oder auf das Maximum kuerzen, damit das
    // Formular nie einen Zustand zeigt, den der Server ablehnen wuerde.
    setAntworten((vorher) => {
      const gefiltert = vorher.filter((antwort) => antwort.trim().length > 0);
      while (gefiltert.length < regeln.minOptionen) {
        gefiltert.push('');
      }
      return gefiltert.slice(0, regeln.maxOptionen);
    });
  }

  async function speichern(): Promise<void> {
    setLaeuft(true);
    setFehler(null);

    const nutzbar = festeAntworten ? [] : antworten.map((antwort) => antwort.trim()).filter(Boolean);

    const antwort = frage
      ? await fragtFrageBearbeitenAction({
          csrfToken,
          frageId: frage.id,
          text: text.trim(),
          untertitel: untertitel.trim() || null,
          kategorie: kategorie.trim(),
          dauerStunden: dauer,
          // Antworten nur mitschicken, wenn sie geaendert werden duerfen -
          // sonst lehnt der Server zu Recht ab.
          ...(antwortenGesperrt ? {} : { typ, antworten: nutzbar }),
        })
      : await fragtFrageErstellenAction({
          csrfToken,
          text: text.trim(),
          untertitel: untertitel.trim() || undefined,
          kategorie: kategorie.trim(),
          typ,
          antworten: nutzbar,
          dauerStunden: dauer,
        });

    setLaeuft(false);
    if (!antwort.ok) {
      setFehler(antwort.error.message);
      return;
    }
    toast.success(frage ? 'Gespeichert.' : 'Frage angelegt - als Entwurf.');
    aufFertig();
  }

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{frage ? 'Frage bearbeiten' : 'Neue Frage'}</h3>
        <Button variant="ghost" size="sm" onClick={aufAbbruch}>
          <X className="size-4" />
        </Button>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="fragt-text">Frage</Label>
        <Input
          id="fragt-text"
          value={text}
          maxLength={240}
          placeholder="Welches Game verdient ein Remake?"
          onChange={(ereignis) => setText(ereignis.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="fragt-untertitel">Untertitel (optional)</Label>
        <Input
          id="fragt-untertitel"
          value={untertitel}
          maxLength={240}
          placeholder="Ein Satz Kontext"
          onChange={(ereignis) => setUntertitel(ereignis.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="fragt-typ">Fragetyp</Label>
          <select
            id="fragt-typ"
            value={typ}
            disabled={antwortenGesperrt}
            onChange={(ereignis) => setzeTyp(ereignis.target.value as FrageAnsicht['typ'])}
            className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            {FRAGETYPEN.map((eintrag) => (
              <option key={eintrag.typ} value={eintrag.typ}>
                {eintrag.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fragt-kategorie">Kategorie</Label>
          <Input
            id="fragt-kategorie"
            value={kategorie}
            list="fragt-kategorien"
            maxLength={40}
            onChange={(ereignis) => setKategorie(ereignis.target.value)}
          />
          <datalist id="fragt-kategorien">
            {[...new Set([...kategorien, ...KATEGORIE_VORSCHLAEGE])].map((eintrag) => (
              <option key={eintrag} value={eintrag} />
            ))}
          </datalist>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">{angaben.beschreibung}</p>

      {festeAntworten ? (
        <div className="rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          Die Antworten stehen fest: {angaben.festeOptionen?.join(' · ')}. So bleiben Hot Takes untereinander
          vergleichbar.
        </div>
      ) : (
        <div className="space-y-2">
          <Label>
            Antworten ({angaben.minOptionen}–{angaben.maxOptionen})
          </Label>
          {antworten.map((antwort, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                value={antwort}
                maxLength={80}
                disabled={antwortenGesperrt}
                placeholder={`Antwort ${index + 1}`}
                onChange={(ereignis) =>
                  setAntworten((vorher) =>
                    vorher.map((wert, stelle) => (stelle === index ? ereignis.target.value : wert)),
                  )
                }
              />
              {!antwortenGesperrt && antworten.length > angaben.minOptionen ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setAntworten((vorher) => vorher.filter((_, stelle) => stelle !== index))}
                >
                  <X className="size-4" />
                </Button>
              ) : null}
            </div>
          ))}
          {!antwortenGesperrt && antworten.length < angaben.maxOptionen ? (
            <Button variant="outline" size="sm" onClick={() => setAntworten((vorher) => [...vorher, ''])}>
              <Plus className="size-4" />
              Antwort hinzufügen
            </Button>
          ) : null}
          {antwortenGesperrt ? (
            <p className="text-xs text-muted-foreground">
              Festgeschrieben, weil diese Frage schon gestellt wurde.
            </p>
          ) : null}
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="fragt-dauer">Abstimmungsdauer (Stunden)</Label>
        <Input
          id="fragt-dauer"
          type="number"
          min={1}
          max={336}
          value={dauer}
          onChange={(ereignis) => setDauer(Number(ereignis.target.value) || 48)}
        />
      </div>

      {fehler ? (
        <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {fehler}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button
          className="flex-1"
          disabled={laeuft || text.trim().length < 5}
          onClick={() => void speichern()}
        >
          {laeuft ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {frage ? 'Speichern' : 'Anlegen'}
        </Button>
        <Button variant="outline" onClick={aufAbbruch}>
          Abbrechen
        </Button>
      </div>

      {!frage ? (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Radio className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          Neue Fragen entstehen als Entwurf. Erst nach dem Freigeben darf die Automatik sie wählen.
        </p>
      ) : null}
    </div>
  );
}
