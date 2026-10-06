'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Download, FileArchive, Loader2, Save, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { postSpeichernAction, turnierVorschlagAction } from '@/modules/socialmedia/actions';
import { cn } from '@/lib/utils';

/**
 * Der Editor (§29, §38, §43).
 *
 * ## Die Vorschau ist der Export
 *
 * Sie ist ein `<img>` auf `/api/social-media/post/<id>?format=…`, und das ist
 * genau die Adresse, die auch die Datei liefert. Es gibt keine zweite
 * Vorschau-Implementierung - also auch keinen Weg, auf dem sich beide
 * auseinanderentwickeln koennten (§38).
 *
 * Daraus folgt, wann die Vorschau sich aendert: **nach dem Speichern**. Die
 * Route liest den gespeicherten Datensatz; etwas anderes kennt sie nicht. Das
 * ist kein Umweg, sondern der Preis derselben Quelle - und er ist niedrig,
 * weil gespeichert wird, ohne dass man es anstossen muss.
 *
 * ## Autosave mit Entprellung, und trotzdem ein Speicherknopf
 *
 * Die Vorgabe erlaubt beides; hier ist es beides. Nach 900 Millisekunden Ruhe
 * wird gespeichert, und die Vorschau zieht nach. Der Knopf bleibt, weil er
 * sagt, dass gerade ungesicherte Aenderungen da sind - und weil man ihn
 * druecken will, bevor man den Browser zumacht.
 *
 * `beforeunload` haelt die letzte Luecke: zwischen Tastendruck und Autosave
 * liegen bis zu 900 Millisekunden, und wer in dieser Zeit das Fenster
 * schliesst, hat ohne diese Warnung lautlos etwas verloren (§43).
 *
 * ## Warum Bilder vor dem Speichern hochgeladen werden
 *
 * Weil der Post einen Dateinamen speichert, keine Bytes. Ein `blob:`-Verweis
 * aus dem Browser existiert nur in diesem einen Browser und waere nach einem
 * Neuladen ein Bild mit Loch - die Pruefung im Modulkern laesst ihn deshalb
 * nicht durch (§35). Der Upload laeuft sofort bei der Auswahl, und was
 * zurueckkommt, ist der Name.
 */

export interface PostAnsicht {
  postId: string;
  title: string;
  postType: string;
  design: string;
  status: 'DRAFT' | 'READY' | 'ARCHIVED';
  inhalt: Record<string, unknown>;
  stand: number;
}

export interface EditorVorlagen {
  typen: Array<{
    id: string;
    label: string;
    felder: string[];
    pflicht: string[];
    designs: string[];
    quelle: string;
  }>;
  designs: Array<{ id: string; label: string; aufbau: string }>;
  felder: Record<string, { art: string; label: string; hinweis: string }>;
  formate: Array<{ id: string; label: string }>;
  turniere: Array<{ id: string; name: string; spiel: string }>;
}

type Werte = Record<string, unknown>;

const ENTPRELLUNG_MS = 900;

const bildAdresse = (dateiname: string): string => `/api/social-media/asset/${encodeURIComponent(dateiname)}`;

export function PostEditor({
  ansicht,
  vorlagen,
  csrfToken,
  darfBearbeiten,
  darfExportieren,
}: {
  ansicht: PostAnsicht;
  vorlagen: EditorVorlagen;
  csrfToken: string;
  darfBearbeiten: boolean;
  darfExportieren: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [titel, setTitel] = useState(ansicht.title);
  const [typId, setTypId] = useState(ansicht.postType);
  const [design, setDesign] = useState(ansicht.design);
  const [werte, setWerte] = useState<Werte>(ansicht.inhalt);
  const [format, setFormat] = useState<string>('quadrat');

  /** Der Stand, den die Vorschauadresse traegt - sonst greift der Browsercache. */
  const [stand, setStand] = useState(ansicht.stand);
  const [schmutzig, setSchmutzig] = useState(false);
  const [speichert, setSpeichert] = useState(false);
  const [laedt, setLaedt] = useState<string | null>(null);

  const typ = useMemo(
    () => vorlagen.typen.find((eintrag) => eintrag.id === typId) ?? vorlagen.typen[0],
    [typId, vorlagen.typen],
  );

  /** Die Designs dieses Typs - und nie eines, das er nicht kennt. */
  const designs = useMemo(
    () => vorlagen.designs.filter((eintrag) => typ?.designs.includes(eintrag.id)),
    [typ, vorlagen.designs],
  );

  /*
   * Ein Design, das der neue Typ nicht hat, wird ersetzt.
   *
   * Sonst stuende im Waehler ein Eintrag, den die Liste nicht enthaelt - und
   * die Registry wuerde beim Zeichnen still auf das erste zurueckfallen. Der
   * Editor zeigte dann ein anderes Design als das Bild.
   */
  useEffect(() => {
    if (typ && !typ.designs.includes(design)) {
      setDesign(typ.designs[0] ?? 'clean');
      setSchmutzig(true);
    }
  }, [typ, design]);

  const speichern = useCallback(
    async (status?: 'DRAFT' | 'READY'): Promise<boolean> => {
      setSpeichert(true);
      const antwort = await postSpeichernAction({
        csrfToken,
        postId: ansicht.postId,
        title: titel.trim() === '' ? 'Ohne Titel' : titel.trim(),
        postType: typId,
        design,
        inhalt: werte,
        ...(status ? { status } : {}),
      });
      setSpeichert(false);
      if (!antwort.ok) {
        toast.error(antwort.error.message);
        return false;
      }
      setStand(antwort.data.stand);
      setSchmutzig(false);
      return true;
    },
    [ansicht.postId, csrfToken, design, titel, typId, werte],
  );

  /*
   * Autosave.
   *
   * Der Zeitgeber wird bei jeder Aenderung neu gesetzt - es wird also nicht
   * im Takt gespeichert, sondern wenn jemand aufhoert zu tippen. `schmutzig`
   * ist die Bedingung, damit ein Statuswechsel oder ein fremder Rerender
   * nicht ohne Grund schreibt.
   *
   * `speichern` steht bewusst **nicht** in der Abhaengigkeitsliste, sondern in
   * einer Referenz: es aendert sich bei jedem Tastendruck, und der Effekt
   * wuerde sonst ohnehin neu starten - nur eben auch dann, wenn sich sonst
   * nichts getan hat.
   */
  const speichernRef = useRef(speichern);
  speichernRef.current = speichern;
  useEffect(() => {
    if (!schmutzig || !darfBearbeiten || ansicht.status === 'ARCHIVED') {
      return;
    }
    const zeitgeber = setTimeout(() => {
      void speichernRef.current();
    }, ENTPRELLUNG_MS);
    return () => clearTimeout(zeitgeber);
  }, [schmutzig, werte, titel, typId, design, darfBearbeiten, ansicht.status]);

  /* Die letzte Luecke: zwischen Tastendruck und Autosave. */
  useEffect(() => {
    if (!schmutzig) {
      return;
    }
    const warnen = (ereignis: BeforeUnloadEvent): void => {
      ereignis.preventDefault();
      ereignis.returnValue = '';
    };
    window.addEventListener('beforeunload', warnen);
    return () => window.removeEventListener('beforeunload', warnen);
  }, [schmutzig]);

  function setzeFeld(feld: string, wert: unknown): void {
    setWerte((vorher) => ({ ...vorher, [feld]: wert }));
    setSchmutzig(true);
  }

  async function bildHochladen(feld: string, datei: File, stelle?: number): Promise<void> {
    setLaedt(`${feld}-${stelle ?? 0}`);
    const form = new FormData();
    form.set('csrfToken', csrfToken);
    form.set('datei', datei);
    const antwort = await fetch('/api/social-media/upload', { method: 'POST', body: form });
    const ergebnis = (await antwort.json()) as
      { ok: true; data: { dateiname: string } } | { ok: false; error: { message: string } };
    setLaedt(null);
    if (!ergebnis.ok) {
      toast.error(ergebnis.error.message);
      return;
    }
    if (feld === 'sponsoren') {
      const bisher = Array.isArray(werte['sponsoren']) ? (werte['sponsoren'] as string[]) : [];
      setzeFeld('sponsoren', [...bisher, ergebnis.data.dateiname].slice(0, 6));
    } else if (feld === 'logoA' || feld === 'logoB') {
      const paar = (werte['teams'] as Record<string, unknown> | undefined) ?? {};
      setzeFeld('teams', { ...paar, [feld]: ergebnis.data.dateiname });
    } else {
      setzeFeld(feld, ergebnis.data.dateiname);
    }
  }

  async function turnierUebernehmen(tournamentId: string): Promise<void> {
    const antwort = await turnierVorschlagAction({ csrfToken, tournamentId });
    if (!antwort.ok) {
      toast.error(antwort.error.message);
      return;
    }
    setWerte((vorher) => ({
      ...vorher,
      ...(typ?.felder.includes('bracket') ? { bracket: { tournamentId } } : {}),
      ...(typ?.felder.includes('titel') ? { titel: antwort.data.titel } : {}),
      ...(typ?.felder.includes('untertitel') ? { untertitel: antwort.data.untertitel } : {}),
      ...(typ?.felder.includes('datum') && antwort.data.datum ? { datum: antwort.data.datum } : {}),
      ...(typ?.felder.includes('gewinner') && antwort.data.sieger ? { gewinner: antwort.data.sieger } : {}),
    }));
    setSchmutzig(true);
    toast.success('Aus dem Turnier übernommen - du kannst alles noch ändern.');
  }

  const vorschauAdresse = `/api/social-media/post/${ansicht.postId}?format=${format}&v=${stand}`;
  const gesperrt = !darfBearbeiten || ansicht.status === 'ARCHIVED';

  return (
    <div className="grid gap-5 lg:grid-cols-[420px_minmax(0,1fr)]">
      {/* --- Links: die Felder --- */}
      <div className="space-y-4">
        {ansicht.status === 'ARCHIVED' ? (
          <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
            Dieser Post ist abgelegt. Hole ihn in der Bibliothek zurück, um ihn zu bearbeiten.
          </p>
        ) : null}

        <div className="space-y-2">
          <Label htmlFor="post-titel">Arbeitstitel</Label>
          <Input
            id="post-titel"
            value={titel}
            disabled={gesperrt}
            onChange={(e) => {
              setTitel(e.target.value);
              setSchmutzig(true);
            }}
          />
          <p className="text-xs text-muted-foreground">
            Nur für die Bibliothek - auf dem Bild steht die Überschrift.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="post-typ">Post-Typ</Label>
            <Select
              value={typId}
              disabled={gesperrt}
              onValueChange={(wert) => {
                setTypId(wert);
                setSchmutzig(true);
              }}
            >
              <SelectTrigger id="post-typ">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {vorlagen.typen.map((eintrag) => (
                  <SelectItem key={eintrag.id} value={eintrag.id}>
                    {eintrag.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="post-design">Design</Label>
            <Select
              value={design}
              disabled={gesperrt}
              onValueChange={(wert) => {
                setDesign(wert);
                setSchmutzig(true);
              }}
            >
              <SelectTrigger id="post-design">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {designs.map((eintrag) => (
                  <SelectItem key={eintrag.id} value={eintrag.id}>
                    {eintrag.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {designs.find((eintrag) => eintrag.id === design)?.aufbau ?? ''}
        </p>

        {/* Turnierdaten - nur bei den Typen, die daraus leben (§45). */}
        {typ?.quelle === 'turnier' && vorlagen.turniere.length > 0 ? (
          <div className="space-y-2 rounded-lg border border-border p-3">
            <Label htmlFor="post-turnier">Aus einem Turnier übernehmen</Label>
            <Select disabled={gesperrt} onValueChange={(wert) => void turnierUebernehmen(wert)}>
              <SelectTrigger id="post-turnier">
                <SelectValue placeholder="Turnier wählen" />
              </SelectTrigger>
              <SelectContent>
                {vorlagen.turniere.map((turnier) => (
                  <SelectItem key={turnier.id} value={turnier.id}>
                    {turnier.name} · {turnier.spiel}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Füllt die Felder als Vorschlag. Der Turnierbaum wird beim Export frisch aus dem Turnier gelesen
              - er ist also immer aktuell.
            </p>
          </div>
        ) : null}

        {/* Die Felder dieses Typs - und nur die (§33). */}
        {(typ?.felder ?? [])
          .filter((feld) => feld !== 'bracket')
          .map((feld) => (
            <Feld
              key={feld}
              feld={feld}
              beschreibung={vorlagen.felder[feld]}
              pflicht={typ?.pflicht.includes(feld) ?? false}
              wert={werte[feld]}
              gesperrt={gesperrt}
              laedt={laedt}
              onChange={(wert) => setzeFeld(feld, wert)}
              onUpload={(datei, stelle) => void bildHochladen(feld, datei, stelle)}
              onTeamUpload={(seite, datei) => void bildHochladen(seite, datei)}
            />
          ))}

        <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
          <Button onClick={() => void speichern()} disabled={gesperrt || speichert || !schmutzig}>
            {speichert ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <Save aria-hidden="true" />
            )}
            Speichern
          </Button>
          <Button
            variant="outline"
            disabled={gesperrt || speichert}
            onClick={async () => {
              if (await speichern('READY')) {
                toast.success('Als fertig markiert.');
                router.refresh();
              }
            }}
          >
            Als fertig markieren
          </Button>
          {schmutzig ? (
            <Badge variant="outline" className="border-amber-500/50 text-amber-500">
              Ungespeicherte Änderungen
            </Badge>
          ) : (
            <Badge variant="secondary">Gespeichert</Badge>
          )}
        </div>
      </div>

      {/* --- Rechts: Vorschau und Export --- */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {vorlagen.formate.map((eintrag) => (
            <Button
              key={eintrag.id}
              size="sm"
              variant={format === eintrag.id ? 'default' : 'outline'}
              onClick={() => setFormat(eintrag.id)}
            >
              {eintrag.label}
            </Button>
          ))}
        </div>

        <div className="flex items-start justify-center rounded-xl border border-border bg-muted/30 p-4">
          {/*
            Die Vorschau.

            `max-h` begrenzt die Hoehe, nicht die Breite: eine Story ist 1920
            Pixel hoch, und ohne Begrenzung muesste man scrollen, um das Bild
            zu sehen, das man gerade baut. `object-contain` haelt dabei das
            Seitenverhaeltnis - verzerrt waere die Vorschau eine Luege ueber
            das Ergebnis.
          */}
          {/* eslint-disable-next-line @next/next/no-img-element -- die Route
              liefert ein PNG in fester Groesse; next/image wuerde es
              nachbearbeiten und damit genau den Vergleich verfaelschen,
              um den es hier geht. */}
          <img
            src={vorschauAdresse}
            alt="Vorschau des Posts"
            className={cn(
              'max-h-[70vh] w-auto rounded-lg border border-border/60 object-contain',
              speichert && 'opacity-60',
            )}
          />
        </div>

        {darfExportieren ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <a href={`${vorschauAdresse}&download=1`} download>
                <Download aria-hidden="true" />
                Dieses Format
              </a>
            </Button>
            <Button asChild size="sm">
              <a href={`/api/social-media/post/${ansicht.postId}/zip`} download>
                <FileArchive aria-hidden="true" />
                Alle Formate exportieren
              </a>
            </Button>
            <span className="text-xs text-muted-foreground">
              PNG in exakter Pixelgrösse - dasselbe Bild wie oben.
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Ein Feld - die Art entscheidet, welche Eingabe.
 *
 * Die Zuordnung steht in der Registry, nicht hier: `art` kommt von dort, und
 * dieser Schalter uebersetzt sie in ein Eingabefeld. Ein neues Feld in der
 * Registry braucht deshalb hier nur dann eine Aenderung, wenn es eine **neue
 * Art** mitbringt.
 */
function Feld({
  feld,
  beschreibung,
  pflicht,
  wert,
  gesperrt,
  laedt,
  onChange,
  onUpload,
  onTeamUpload,
}: {
  feld: string;
  beschreibung: { art: string; label: string; hinweis: string } | undefined;
  pflicht: boolean;
  wert: unknown;
  gesperrt: boolean;
  laedt: string | null;
  onChange: (wert: unknown) => void;
  onUpload: (datei: File, stelle?: number) => void;
  onTeamUpload: (seite: 'logoA' | 'logoB', datei: File) => void;
}): React.JSX.Element | null {
  if (!beschreibung) {
    return null;
  }
  const id = `feld-${feld}`;
  const kopf = (
    <Label htmlFor={id}>
      {beschreibung.label}
      {pflicht ? <span className="ml-1 text-destructive">*</span> : null}
    </Label>
  );
  const fuss = <p className="text-xs text-muted-foreground">{beschreibung.hinweis}</p>;

  if (beschreibung.art === 'mehrzeilig') {
    return (
      <div className="space-y-2">
        {kopf}
        <textarea
          id={id}
          rows={5}
          disabled={gesperrt}
          value={typeof wert === 'string' ? wert : ''}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-border bg-card/70 p-3 text-sm outline-none focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring/50"
        />
        {fuss}
      </div>
    );
  }

  if (beschreibung.art === 'schalter') {
    return (
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          disabled={gesperrt}
          checked={wert !== false}
          onChange={(e) => onChange(e.target.checked)}
          className="size-4 rounded border-border"
        />
        {beschreibung.label}
      </label>
    );
  }

  if (beschreibung.art === 'farbe') {
    return (
      <div className="space-y-2">
        {kopf}
        <div className="flex items-center gap-2">
          <input
            id={id}
            type="color"
            disabled={gesperrt}
            value={typeof wert === 'string' ? wert : '#83060a'}
            onChange={(e) => onChange(e.target.value)}
            className="size-10 cursor-pointer rounded border border-border bg-transparent"
          />
          <Button variant="ghost" size="sm" disabled={gesperrt} onClick={() => onChange(undefined)}>
            Zurücksetzen
          </Button>
        </div>
        {fuss}
      </div>
    );
  }

  if (beschreibung.art === 'bild') {
    const name = typeof wert === 'string' ? wert : null;
    return (
      <div className="space-y-2">
        {kopf}
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <label className="cursor-pointer">
              {laedt === `${feld}-0` ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <Upload aria-hidden="true" />
              )}
              Bild wählen
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                disabled={gesperrt}
                onChange={(e) => {
                  const datei = e.target.files?.[0];
                  if (datei) {
                    onUpload(datei);
                  }
                  e.target.value = '';
                }}
              />
            </label>
          </Button>
          {name ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- ein
                  Vorschaubild von 48 Pixeln aus einer berechtigungsgeprueften
                  Route; next/image braeuchte dafuer eine eigene
                  Loader-Konfiguration. */}
              <img
                src={bildAdresse(name)}
                alt=""
                className="size-12 rounded border border-border object-contain"
              />
              <Button variant="ghost" size="sm" disabled={gesperrt} onClick={() => onChange(undefined)}>
                <X aria-hidden="true" />
                Entfernen
              </Button>
            </>
          ) : null}
        </div>
        {fuss}
      </div>
    );
  }

  if (beschreibung.art === 'liste') {
    const liste = Array.isArray(wert) ? (wert as string[]) : [];
    return (
      <div className="space-y-2">
        {kopf}
        <div className="flex flex-wrap items-center gap-2">
          {liste.map((name, index) => (
            <span key={name} className="flex items-center gap-1 rounded border border-border p-1">
              {/* eslint-disable-next-line @next/next/no-img-element -- siehe oben. */}
              <img src={bildAdresse(name)} alt="" className="size-10 object-contain" />
              <Button
                variant="ghost"
                size="sm"
                disabled={gesperrt}
                onClick={() => onChange(liste.filter((_, stelle) => stelle !== index))}
              >
                <X aria-hidden="true" />
              </Button>
            </span>
          ))}
          {liste.length < 6 ? (
            <Button asChild variant="outline" size="sm">
              <label className="cursor-pointer">
                <Upload aria-hidden="true" />
                Hinzufügen
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  disabled={gesperrt}
                  onChange={(e) => {
                    const datei = e.target.files?.[0];
                    if (datei) {
                      onUpload(datei, liste.length);
                    }
                    e.target.value = '';
                  }}
                />
              </label>
            </Button>
          ) : null}
        </div>
        {fuss}
      </div>
    );
  }

  if (beschreibung.art === 'begegnung') {
    const paar = (wert as Record<string, unknown> | undefined) ?? {};
    const istPunkte = feld === 'punkte';
    return (
      <div className="space-y-2 rounded-lg border border-border p-3">
        {kopf}
        <div className="grid gap-3 sm:grid-cols-2">
          {(['a', 'b'] as const).map((seite) => (
            <div key={seite} className="space-y-2">
              <Label htmlFor={`${id}-${seite}`}>{seite === 'a' ? 'Links' : 'Rechts'}</Label>
              <Input
                id={`${id}-${seite}`}
                type={istPunkte ? 'number' : 'text'}
                disabled={gesperrt}
                value={
                  typeof paar[seite] === 'string' || typeof paar[seite] === 'number'
                    ? String(paar[seite])
                    : ''
                }
                onChange={(e) =>
                  onChange({
                    ...paar,
                    [seite]: istPunkte ? Number(e.target.value) : e.target.value,
                  })
                }
              />
              {istPunkte ? null : (
                <Button asChild variant="ghost" size="sm">
                  <label className="cursor-pointer text-xs">
                    <Upload aria-hidden="true" />
                    Zeichen
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      disabled={gesperrt}
                      onChange={(e) => {
                        const datei = e.target.files?.[0];
                        if (datei) {
                          onTeamUpload(seite === 'a' ? 'logoA' : 'logoB', datei);
                        }
                        e.target.value = '';
                      }}
                    />
                  </label>
                </Button>
              )}
            </div>
          ))}
        </div>
        {fuss}
      </div>
    );
  }

  const typAttribut = beschreibung.art === 'datum' ? 'date' : beschreibung.art === 'zeit' ? 'time' : 'text';
  return (
    <div className="space-y-2">
      {kopf}
      <Input
        id={id}
        type={typAttribut}
        disabled={gesperrt}
        placeholder={beschreibung.art === 'url' ? 'https://…' : undefined}
        value={typeof wert === 'string' ? wert : ''}
        onChange={(e) => onChange(e.target.value)}
      />
      {fuss}
    </div>
  );
}
