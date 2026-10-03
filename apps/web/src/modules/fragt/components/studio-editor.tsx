'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Download,
  Loader2,
  Lock,
  Package,
  RotateCcw,
  Trash2,
  Unlock,
} from 'lucide-react';
import type { fragt } from '@swisshub/modules';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import {
  fragtEntwurfBearbeitenAction,
  fragtEntwurfFinalisierenAction,
  fragtEntwurfFreigebenAction,
  fragtEntwurfGepostetAction,
  fragtEntwurfLoeschenAction,
} from '@/modules/fragt/actions';
import { cn } from '@/lib/utils';

/**
 * Das Content Studio.
 *
 * ## Was hier bearbeitet werden kann
 *
 * Ueberschrift, Untertitel, Aufruf, Vorlage, Format, welche Folien mitkommen
 * und in welcher Reihenfolge - und **Farbe, Zeichen und Zusatztext dieses
 * Exports**.
 *
 * Die drei gab es bisher nur unter «Einstellungen -> Module -> SwissHub
 * fragt», gueltig fuer jeden Export. Verlangt waren sie hier, je Export. Sie
 * wirken auf **alle** Folien dieses Entwurfs - die Frage-Folie wie die
 * Ergebnis-Folien -, weil es eine Marke je Export ist und nicht eine je
 * Folie: ein Carousel, dessen erste Folie anders aussieht als die zweite, ist
 * kein Carousel.
 *
 * «Wie im Modul» ist bei allen drei die Voreinstellung und ein eigener
 * Zustand - nicht dasselbe wie «leer». Daneben steht, was das Modul gerade
 * vorgibt; eine Auswahl «wie im Modul» ohne diese Angabe waere eine Wahl ins
 * Ungewisse.
 *
 * ## Was nicht
 *
 * Die Zahlen. Sie stehen in keinem Feld dieses Formulars, weil sie in keiner
 * Spalte des Entwurfs stehen: der Renderer holt sie aus dem Ergebnis, das beim
 * Schliessen festgeschrieben wurde. Es gibt also keinen Weg, eine 42 in eine 68
 * zu aendern - nicht weil es verboten waere, sondern weil das Feld fehlt.
 *
 * ## Warum die Vorschau ein Bild ist und kein HTML
 *
 * Weil sie sonst luege. Eine mit CSS nachgebaute Vorschau saehe im Browser
 * anders aus als das PNG, das Satori erzeugt - und der Unterschied faellt erst
 * auf Instagram auf. Hier laedt dieselbe Route, die auch der Export benutzt.
 */

export interface StudioAnsicht {
  entwurfId: string;
  status: string;
  vorlage: fragt.Vorlage;
  format: fragt.Format;
  ueberschrift: string;
  untertitel: string;
  cta: string;
  folien: Array<{ art: fragt.FolienArt; aktiv: boolean; position: number }>;
  frageText: string;
  /** Steht die absolute Stimmenzahl auf der Grafik? Prozente immer. */
  stimmenZeigen: boolean;
  /**
   * Farbe, Zeichen und Zusatztext dieses Exports.
   *
   * `null` heisst bei jedem der drei «wie im Modul» - ein eigener Zustand und
   * nicht dasselbe wie «leer»: fuer «kein Zeichen» gibt es `keins`, fuer
   * «keine Fusszeile» die leere Zeichenkette.
   */
  marke: {
    akzentfarbe: string | null;
    logo: fragt.ExportLogoWahl | null;
    zusatztext: string | null;
  };
  /** Was das Modul vorgibt - zur Beschriftung von «wie im Modul». */
  vorgabe: {
    akzent: string;
    logo: fragt.ExportLogoWahl;
    zusatztext: string;
    /** Ob ueberhaupt ein Serverlogo hochgeladen ist - sonst zeichnet «Serverlogo» das Signet. */
    serverlogoVorhanden: boolean;
  };
  /** Nur zur Anzeige - unveraenderlich. */
  zahlen: { gesamt: number; gewinner: string | null; prozent: number | null };
}

const LOGO_LABEL: Record<fragt.ExportLogoWahl, string> = {
  signet: 'Signet',
  serverlogo: 'Serverlogo',
  keins: 'Kein Zeichen',
};

const VORLAGEN: Array<{ wert: fragt.Vorlage; label: string; hinweis: string }> = [
  { wert: 'winner', label: 'The Winner', hinweis: 'Eine Zahl, gross. Fokus auf die Gewinnerantwort.' },
  { wert: 'results', label: 'The Results', hinweis: 'Alle Antworten mit ihrer Verteilung.' },
  { wert: 'duel', label: 'The Duel', hinweis: 'Geteilte Fläche - nur für zwei Antworten sinnvoll.' },
];

const FORMATE: Array<{ wert: fragt.Format; label: string; masse: string }> = [
  { wert: 'story', label: 'Story', masse: '1080 × 1920' },
  { wert: 'feed', label: 'Feed / Carousel', masse: '1080 × 1350' },
  { wert: 'quadrat', label: 'Quadratisch', masse: '1080 × 1080' },
];

const FOLIEN_LABEL: Record<fragt.FolienArt, string> = {
  frage: 'Die Frage',
  gewinner: 'Der Gewinner',
  verteilung: 'Die Verteilung',
  duell: 'Das Duell',
  cta: 'Der Aufruf',
};

/**
 * Die Folien in der Reihenfolge des Carousels - fuer den Vorschauwaehler.
 *
 * Hier und nicht aus `fragt.FOLIEN_ARTEN`: dieses Modul ist nur als `import
 * type` eingebunden, damit die Modulschicht mit ihrer Datenbankanbindung
 * nicht ins Client-Bundle geraet. Der `Record` darueber erzwingt die
 * Vollstaendigkeit des Typs, und `satisfies` erzwingt sie fuer diese Liste -
 * eine sechste Folienart bricht hier die Uebersetzung, statt still zu fehlen.
 */
const FOLIEN_REIHE = ['frage', 'gewinner', 'verteilung', 'duell', 'cta'] satisfies fragt.FolienArt[];

export function StudioEditor({
  csrfToken,
  ansicht,
  darfLoeschen = false,
}: {
  /** Der CSRF-Token der Sitzung - jede Server Action verlangt ihn. */
  csrfToken: string;
  ansicht: StudioAnsicht;
  /**
   * Darf diese Person Entwürfe löschen?
   *
   * `fragt.delete`, serverseitig geprüft - hier steht nur, ob der Knopf
   * erscheint. Ein Knopf, der immer eine Absage bringt, ist kein Knopf.
   */
  darfLoeschen?: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [vorlage, setVorlage] = useState(ansicht.vorlage);
  const [format, setFormat] = useState(ansicht.format);
  const [ueberschrift, setUeberschrift] = useState(ansicht.ueberschrift);
  const [untertitel, setUntertitel] = useState(ansicht.untertitel);
  const [cta, setCta] = useState(ansicht.cta);
  const [folien, setFolien] = useState(ansicht.folien);
  const [stimmenZeigen, setStimmenZeigen] = useState(ansicht.stimmenZeigen);
  /*
   * Die drei Markenfelder, je mit `null` fuer «wie im Modul».
   *
   * Bewusst `string | null` und nicht «leerer String = Modul»: der Nutzer
   * soll den Zusatztext auch leeren koennen, und das ist eine andere Aussage
   * als «nimm den aus dem Modul». Siehe `StudioAnsicht.marke`.
   */
  const [akzentfarbe, setAkzentfarbe] = useState<string | null>(ansicht.marke.akzentfarbe);
  const [logo, setLogo] = useState<fragt.ExportLogoWahl | null>(ansicht.marke.logo);
  const [zusatztext, setZusatztext] = useState<string | null>(ansicht.marke.zusatztext);
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const [loeschenOffen, setLoeschenOffen] = useState(false);
  /*
   * Die Vorschau muss sich nach dem Speichern neu laden.
   *
   * Sie ist ein `<img>` auf eine Route; der Browser wuerde dieselbe Adresse
   * aus seinem Cache bedienen. Ein Zaehler im Query-String macht daraus bei
   * jeder Aenderung eine neue Adresse.
   */
  const [stand, setStand] = useState(0);
  /*
   * Welche Folie die Vorschau zeigt.
   *
   * `null` heisst «die des Einzelbildes» - die Route leitet sie dann aus der
   * Vorlage ab (`winner` wird `gewinner` und so weiter). Genau das war der
   * Fehler, den man als «mein Untertitel erscheint nicht» erlebt hat: der
   * Untertitel steht **nur** auf der Frage-Folie, der Aufruf **nur** auf der
   * Aufruf-Folie, und die Vorschau zeigte keine von beiden. Man bearbeitete
   * also Text fuer Folien, die nicht im Bild waren, und sah ihn nie.
   *
   * Mit dem Waehler darunter laesst sich jede Folie ansehen. Beim Wechsel des
   * Feldes springt die Vorschau von selbst auf die Folie, auf der das Feld
   * steht - sonst muesste man wissen, wo was erscheint, um zu sehen, dass es
   * erscheint.
   */
  const [vorschauFolie, setVorschauFolie] = useState<fragt.FolienArt | null>(null);

  const gesperrt = ansicht.status !== 'OFFEN';
  const gepostet = ansicht.status === 'VEROEFFENTLICHT';

  const vorschauAdresse = (art?: fragt.FolienArt | null): string =>
    `/api/fragt/grafik/${ansicht.entwurfId}?format=${format}${art ? `&art=${art}` : ''}&v=${stand}`;

  async function speichern(): Promise<void> {
    setLaeuft('speichern');
    const antwort = await fragtEntwurfBearbeitenAction({
      csrfToken,
      entwurfId: ansicht.entwurfId,
      vorlage,
      format,
      ueberschrift: ueberschrift.trim(),
      untertitel: untertitel.trim() || null,
      cta: cta.trim(),
      folien,
      stimmenZeigen,
      /*
       * `null` geht ausdruecklich mit.
       *
       * Die Aktion unterscheidet «nicht uebergeben» (unveraendert) von `null`
       * (zuruecksetzen auf das Modul). Diese drei Felder sind immer gesetzt -
       * der Editor kennt ihren Zustand und schickt ihn, statt ihn weglassen
       * zu muessen.
       */
      exportAkzentfarbe: akzentfarbe,
      exportLogo: logo,
      exportZusatztext: zusatztext,
    });
    setLaeuft(null);
    if (!antwort.ok) {
      toast.error(antwort.error.message);
      return;
    }
    toast.success('Gespeichert.');
    setStand((wert) => wert + 1);
    router.refresh();
  }

  function verschiebe(index: number, richtung: -1 | 1): void {
    setFolien((vorher) => {
      const ziel = index + richtung;
      if (ziel < 0 || ziel >= vorher.length) {
        return vorher;
      }
      const kopie = [...vorher];
      const [heraus] = kopie.splice(index, 1);
      kopie.splice(ziel, 0, heraus!);
      return kopie.map((folie, stelle) => ({ ...folie, position: stelle }));
    });
  }

  const aktiveFolien = folien.filter((folie) => folie.aktiv);

  return (
    <div className="grid gap-5 lg:grid-cols-[400px_minmax(0,1fr)]">
      <div className="space-y-4">
        {gesperrt ? (
          <div
            className={cn(
              'flex items-start gap-3 rounded-xl border p-4 text-sm',
              gepostet ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-sky-500/40 bg-sky-500/5',
            )}
          >
            <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <div className="space-y-2">
              <p>
                {gepostet
                  ? 'Dieser Entwurf ist als veröffentlicht markiert. Was auf Instagram steht, lässt sich hier nicht mehr ändern.'
                  : 'Dieser Entwurf ist abgeschlossen. Gib ihn frei, um Texte zu ändern.'}
              </p>
              {!gepostet ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={laeuft === 'freigeben'}
                  onClick={async () => {
                    setLaeuft('freigeben');
                    const antwort = await fragtEntwurfFreigebenAction({
                      csrfToken,
                      entwurfId: ansicht.entwurfId,
                    });
                    setLaeuft(null);
                    if (!antwort.ok) {
                      toast.error(antwort.error.message);
                      return;
                    }
                    router.refresh();
                  }}
                >
                  <Unlock className="size-4" />
                  Wieder freigeben
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="space-y-4 rounded-xl border border-border bg-card p-5">
          <h3 className="font-semibold">Vorlage</h3>
          <div className="space-y-2">
            {VORLAGEN.map((eintrag) => (
              <button
                key={eintrag.wert}
                type="button"
                disabled={gesperrt}
                onClick={() => setVorlage(eintrag.wert)}
                className={cn(
                  'w-full rounded-lg border p-3 text-left transition disabled:opacity-50',
                  vorlage === eintrag.wert
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/40',
                )}
              >
                <span className="block text-sm font-medium">{eintrag.label}</span>
                <span className="block text-xs text-muted-foreground">{eintrag.hinweis}</span>
              </button>
            ))}
          </div>

          <h3 className="pt-2 font-semibold">Format</h3>
          <div className="grid grid-cols-3 gap-2">
            {FORMATE.map((eintrag) => (
              <button
                key={eintrag.wert}
                type="button"
                disabled={gesperrt}
                onClick={() => setFormat(eintrag.wert)}
                className={cn(
                  'rounded-lg border p-2 text-center transition disabled:opacity-50',
                  format === eintrag.wert
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/40',
                )}
              >
                <span className="block text-xs font-medium">{eintrag.label}</span>
                <span className="block text-[0.65rem] tabular-nums text-muted-foreground">
                  {eintrag.masse}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-4 rounded-xl border border-border bg-card p-5">
          <h3 className="font-semibold">Texte</h3>
          <div className="space-y-1.5">
            <Label htmlFor="studio-ueberschrift">Überschrift</Label>
            <Input
              id="studio-ueberschrift"
              value={ueberschrift}
              maxLength={240}
              disabled={gesperrt}
              onChange={(ereignis) => setUeberschrift(ereignis.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {ueberschrift.trim() === ''
                ? 'Leer: auf jeder Folie steht der Wortlaut der Frage.'
                : 'Ersetzt die Schlagzeile auf allen Folien - der Wortlaut der Frage bleibt in der Abstimmung.'}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="studio-untertitel">Untertitel</Label>
            <Input
              id="studio-untertitel"
              value={untertitel}
              maxLength={240}
              disabled={gesperrt}
              /*
               * Die Vorschau springt auf die Folie, auf der das Feld steht.
               *
               * Der Untertitel erscheint nur auf der Frage-Folie. Ohne diesen
               * Sprung muesste man wissen, wo er auftaucht, um zu sehen, dass
               * er auftaucht - und genau daran ist es vorher gescheitert.
               */
              onFocus={(): void => setVorschauFolie('frage')}
              onChange={(ereignis) => setUntertitel(ereignis.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Steht auf der Frage-Folie, unter der Schlagzeile. Leer: kein Untertitel.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="studio-cta">Aufruf</Label>
            <Input
              id="studio-cta"
              value={cta}
              maxLength={200}
              disabled={gesperrt}
              onFocus={(): void => setVorschauFolie('cta')}
              onChange={(ereignis) => setCta(ereignis.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {cta.trim() === ''
                ? 'Leer: die Aufruf-Folie bleibt ohne Text - schalte sie dann besser ab.'
                : 'Steht auf der Aufruf-Folie, der letzten im Carousel.'}
            </p>
          </div>

          {/* Die Zahlen - zur Ansicht, nicht zur Bearbeitung. */}
          <div className="rounded-lg bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Aus der Abstimmung</p>
            <p className="mt-1">
              {ansicht.zahlen.gesamt} {ansicht.zahlen.gesamt === 1 ? 'Stimme' : 'Stimmen'}
              {ansicht.zahlen.gewinner
                ? ` · ${ansicht.zahlen.gewinner} mit ${ansicht.zahlen.prozent} %`
                : ' · kein eindeutiger Gewinner'}
            </p>
            <p className="mt-1.5">
              Diese Werte lassen sich nicht bearbeiten. Sie stammen aus dem Ergebnis, das beim Schliessen
              festgeschrieben wurde.
            </p>
          </div>

          {/*
            Der Schalter steht bewusst direkt unter den Zahlen.

            Er gehört zu ihnen und nicht zu den Texten darüber: er ändert
            keinen Wert, er lässt die absolute Zahl weg. Was er nicht kann,
            steht daneben - die Prozente bleiben, sonst wäre es kein Ergebnis
            mehr.
          */}
          <div className="flex items-start justify-between gap-4 rounded-lg border border-border px-3 py-2.5">
            <div className="min-w-0">
              <Label htmlFor="studio-stimmen" className="cursor-pointer">
                Anzahl Stimmen anzeigen
              </Label>
              <p className="mt-1 text-xs text-muted-foreground">
                {stimmenZeigen
                  ? `Auf der Grafik steht «${ansicht.zahlen.gesamt} ${ansicht.zahlen.gesamt === 1 ? 'Stimme' : 'Stimmen'}».`
                  : 'Auf der Grafik stehen nur die Prozente.'}
              </p>
            </div>
            <Switch
              id="studio-stimmen"
              checked={stimmenZeigen}
              disabled={gesperrt}
              onCheckedChange={setStimmenZeigen}
            />
          </div>
        </div>

        {/*
          Marke dieses Exports.

          Steht zwischen den Texten und den Folien, weil es dazwischen
          gehoert: es ist keine Serverkonfiguration (die liegt in den
          Moduleinstellungen) und kein Text, sondern das Aussehen dieser einen
          Veroeffentlichung. Wirkt auf jede Folie des Entwurfs - Frage wie
          Ergebnis.
        */}
        <div className="space-y-4 rounded-xl border border-border bg-card p-5">
          <div>
            <h3 className="font-semibold">Farbe, Zeichen und Zusatztext</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Gilt für diesen Export - für die Frage-Folie wie für die Ergebnis-Folien. Ohne eigene Angabe
              gilt, was unter Einstellungen → Module → SwissHub fragt steht.
            </p>
          </div>

          {/* --- Farbe ------------------------------------------------- */}
          <div className="space-y-1.5">
            <Label htmlFor="studio-farbe">Akzentfarbe</Label>
            <div className="flex items-center gap-2">
              <input
                id="studio-farbe"
                type="color"
                value={akzentfarbe ?? ansicht.vorgabe.akzent}
                disabled={gesperrt}
                onChange={(ereignis) => setAkzentfarbe(ereignis.target.value)}
                className="h-9 w-12 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0.5 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Akzentfarbe wählen"
              />
              <Input
                value={akzentfarbe ?? ''}
                placeholder={`wie im Modul (${ansicht.vorgabe.akzent})`}
                maxLength={32}
                disabled={gesperrt}
                onChange={(ereignis) => setAkzentfarbe(ereignis.target.value.trim() || null)}
                className="font-mono text-xs"
                aria-label="Akzentfarbe als Hexwert"
              />
              {akzentfarbe === null ? null : (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={gesperrt}
                  onClick={() => setAkzentfarbe(null)}
                  aria-label="Auf die Modulfarbe zurücksetzen"
                >
                  <RotateCcw className="size-3.5" />
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {akzentfarbe === null
                ? `Keine eigene Farbe - es gilt ${ansicht.vorgabe.akzent} aus dem Modul.`
                : 'Eigene Farbe für diesen Export.'}
            </p>
          </div>

          {/* --- Zeichen ----------------------------------------------- */}
          <div className="space-y-1.5">
            <Label>Zeichen oben links</Label>
            <div className="grid grid-cols-2 gap-2">
              {([null, 'signet', 'serverlogo', 'keins'] as Array<fragt.ExportLogoWahl | null>).map((wahl) => (
                <button
                  key={wahl ?? 'modul'}
                  type="button"
                  disabled={gesperrt}
                  aria-pressed={logo === wahl}
                  onClick={() => setLogo(wahl)}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-left text-xs transition disabled:opacity-50',
                    logo === wahl ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40',
                  )}
                >
                  {wahl === null ? `Wie im Modul (${LOGO_LABEL[ansicht.vorgabe.logo]})` : LOGO_LABEL[wahl]}
                  {wahl === 'serverlogo' && !ansicht.vorgabe.serverlogoVorhanden ? (
                    <span className="mt-0.5 block text-[0.7rem] text-muted-foreground">
                      keins hochgeladen
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
            {/*
              Warum sich nichts aendert, wenn nichts da ist.

              «Serverlogo» ohne hochgeladene Datei zeichnet das Signet - das
              ist die bessere Grafik, aber ohne diesen Satz sieht es aus, als
              waere die Auswahl kaputt. Der Link geht an die Stelle, an der das
              Logo hochgeladen wird; eine zweite Upload-Flaeche hier waere eine
              zweite Wahrheit ueber dasselbe Bild.
            */}
            {logo === 'serverlogo' && !ansicht.vorgabe.serverlogoVorhanden ? (
              <p className="text-xs text-muted-foreground">
                Es ist kein Serverlogo hochgeladen - der Export zeigt darum das Signet. Unter Einstellungen →
                Branding lässt sich eines hinterlegen; es gilt dann überall.
              </p>
            ) : null}
          </div>

          {/* --- Zusatztext -------------------------------------------- */}
          <div className="space-y-1.5">
            <Label htmlFor="studio-zusatz">Zusatztext in der Fusszeile</Label>
            <Input
              id="studio-zusatz"
              value={zusatztext ?? ''}
              placeholder={
                ansicht.vorgabe.zusatztext === ''
                  ? 'wie im Modul (keiner)'
                  : `wie im Modul (${ansicht.vorgabe.zusatztext})`
              }
              maxLength={80}
              disabled={gesperrt}
              onChange={(ereignis) => setZusatztext(ereignis.target.value)}
            />
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {zusatztext === null
                  ? 'Keine eigene Angabe - es gilt der Text aus dem Modul.'
                  : zusatztext.trim() === ''
                    ? 'Leer: auf dieser Grafik steht keine Fusszeile.'
                    : 'Eigener Text für diesen Export.'}
              </p>
              {zusatztext === null ? null : (
                <Button size="sm" variant="ghost" disabled={gesperrt} onClick={() => setZusatztext(null)}>
                  <RotateCcw className="size-3.5" />
                  Modul
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-3 rounded-xl border border-border bg-card p-5">
          <h3 className="font-semibold">Folien im Carousel</h3>
          <ul className="space-y-1.5">
            {folien.map((folie, index) => (
              <li
                key={folie.art}
                className="flex items-center gap-2 rounded-lg border border-border px-3 py-2"
              >
                <input
                  type="checkbox"
                  checked={folie.aktiv}
                  disabled={gesperrt}
                  aria-label={`${FOLIEN_LABEL[folie.art]} mitexportieren`}
                  onChange={(ereignis) =>
                    setFolien((vorher) =>
                      vorher.map((eintrag, stelle) =>
                        stelle === index ? { ...eintrag, aktiv: ereignis.target.checked } : eintrag,
                      ),
                    )
                  }
                  className="size-4 accent-[hsl(var(--primary))]"
                />
                <span className={cn('flex-1 text-sm', !folie.aktiv && 'text-muted-foreground line-through')}>
                  {index + 1}. {FOLIEN_LABEL[folie.art]}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={gesperrt || index === 0}
                  onClick={() => verschiebe(index, -1)}
                  aria-label="Nach oben"
                >
                  <ArrowUp className="size-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={gesperrt || index === folien.length - 1}
                  onClick={() => verschiebe(index, 1)}
                  aria-label="Nach unten"
                >
                  <ArrowDown className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            {aktiveFolien.length} {aktiveFolien.length === 1 ? 'Folie' : 'Folien'} im ZIP-Export.
          </p>
        </div>

        {!gesperrt ? (
          <Button className="w-full" disabled={laeuft === 'speichern'} onClick={() => void speichern()}>
            {laeuft === 'speichern' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Check className="size-4" />
            )}
            Speichern und Vorschau aktualisieren
          </Button>
        ) : null}
      </div>

      <div className="space-y-4">
        <div className="space-y-3 rounded-xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">Vorschau</h3>
            <span className="text-xs text-muted-foreground">
              {FORMATE.find((eintrag) => eintrag.wert === format)?.masse}
            </span>
          </div>

          {/*
            Welche Folie zu sehen ist.

            Vorher zeigte die Vorschau immer nur das Einzelbild der Vorlage -
            und damit nie die Frage-Folie und nie die Aufruf-Folie. Untertitel
            und Aufruf stehen aber genau dort. Wer sie bearbeitete, sah nichts
            und musste glauben, das Feld sei kaputt.
          */}
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={(): void => setVorschauFolie(null)}
              aria-pressed={vorschauFolie === null}
              className={cn(
                'min-h-9 rounded-full border px-3 text-xs transition-colors',
                vorschauFolie === null
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              Einzelbild
            </button>
            {FOLIEN_REIHE.map((art) => (
              <button
                key={art}
                type="button"
                onClick={(): void => setVorschauFolie(art)}
                aria-pressed={vorschauFolie === art}
                className={cn(
                  'min-h-9 rounded-full border px-3 text-xs transition-colors',
                  vorschauFolie === art
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                {FOLIEN_LABEL[art]}
              </button>
            ))}
          </div>
          {/*
            Dasselbe Bild wie der Export.

            `img` und nicht `next/image`: die Route liefert das PNG dynamisch
            und mit `no-store`, eine Optimierungsschicht davor brächte nur einen
            zweiten Cache, der die Änderung verschluckt.
          */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={vorschauAdresse(vorschauFolie)}
            alt={`Vorschau: ${ueberschrift || 'Folie'}`}
            className="mx-auto w-full max-w-sm rounded-lg border border-border bg-black"
          />
        </div>

        <div className="space-y-3 rounded-xl border border-border bg-card p-5">
          <h3 className="font-semibold">Export</h3>
          <div className="flex flex-wrap gap-2">
            {FORMATE.map((eintrag) => (
              <a
                key={eintrag.wert}
                href={`/api/fragt/grafik/${ansicht.entwurfId}?format=${eintrag.wert}`}
                download
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
              >
                <Download className="size-4" />
                {eintrag.label} PNG
              </a>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {FORMATE.map((eintrag) => (
              <a
                key={eintrag.wert}
                href={`/api/fragt/grafik/${ansicht.entwurfId}/zip?format=${eintrag.wert}`}
                download
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
              >
                <Package className="size-4" />
                Carousel-ZIP ({eintrag.label})
              </a>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Das ZIP enthält die aktivierten Folien in ihrer Reihenfolge, durchnummeriert - beim Hochladen
            entscheidet sie, was zuerst zu sehen ist.
          </p>
        </div>

        <div className="space-y-3 rounded-xl border border-border bg-card p-5">
          <h3 className="font-semibold">Status</h3>
          <p className="text-sm text-muted-foreground">
            SwissHub postet nicht selbst auf Instagram - es gibt dafür keine Zugangsdaten und keinen Endpunkt.
            Wenn du die Grafiken von Hand gepostet hast, halte es hier fest.
          </p>
          <div className="flex flex-wrap gap-2">
            {ansicht.status === 'OFFEN' ? (
              <Button
                variant="outline"
                disabled={laeuft === 'final'}
                onClick={async () => {
                  setLaeuft('final');
                  const antwort = await fragtEntwurfFinalisierenAction({
                    csrfToken,
                    entwurfId: ansicht.entwurfId,
                  });
                  setLaeuft(null);
                  if (!antwort.ok) {
                    toast.error(antwort.error.message);
                    return;
                  }
                  toast.success('Abgeschlossen - bereit zum Posten.');
                  router.refresh();
                }}
              >
                <Lock className="size-4" />
                Entwurf abschliessen
              </Button>
            ) : null}
            {!gepostet ? (
              <Button
                disabled={laeuft === 'gepostet'}
                onClick={async () => {
                  setLaeuft('gepostet');
                  const antwort = await fragtEntwurfGepostetAction({
                    csrfToken,
                    entwurfId: ansicht.entwurfId,
                  });
                  setLaeuft(null);
                  if (!antwort.ok) {
                    toast.error(antwort.error.message);
                    return;
                  }
                  toast.success('Als veröffentlicht markiert.');
                  router.refresh();
                }}
              >
                <Check className="size-4" />
                Als gepostet markieren
              </Button>
            ) : (
              <p className="text-sm text-emerald-400">Als gepostet markiert.</p>
            )}
          </div>
        </div>

        {/*
          Löschen - ganz unten und in eigener Umgebung.

          Nicht neben «Speichern»: der eine Knopf behält Arbeit, der andere
          wirft sie weg, und zwei Knöpfe mit entgegengesetzter Folge gehören
          nicht nebeneinander. Er erscheint nur mit `fragt.delete`, und was
          geschieht, entscheidet die Server Action.
        */}
        {darfLoeschen ? (
          <div className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-5">
            <h3 className="font-semibold">Entwurf löschen</h3>
            <p className="text-sm text-muted-foreground">
              Entfernt diesen Entwurf samt seinen Texten, Folien und Farben. Das Ergebnis der Abstimmung
              bleibt - aus ihm entsteht auf Wunsch ein neuer Entwurf.
            </p>
            <Button
              variant="outline"
              className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={laeuft === 'loeschen'}
              onClick={() => setLoeschenOffen(true)}
            >
              <Trash2 className="size-4" />
              Entwurf löschen
            </Button>
          </div>
        ) : null}
      </div>

      <ConfirmationDialog
        open={loeschenOffen}
        onOpenChange={setLoeschenOffen}
        title="Entwurf löschen?"
        description="Texte, Folienreihenfolge, Farbe, Zeichen und Zusatztext dieses Entwurfs sind danach weg. Das Ergebnis der Abstimmung bleibt bestehen. Das lässt sich nicht rückgängig machen."
        confirmLabel="Löschen"
        destructive
        onConfirm={async () => {
          setLaeuft('loeschen');
          const antwort = await fragtEntwurfLoeschenAction({
            csrfToken,
            entwurfId: ansicht.entwurfId,
          });
          setLaeuft(null);
          if (!antwort.ok) {
            toast.error(antwort.error.message);
            return;
          }
          setLoeschenOffen(false);
          toast.success('Entwurf gelöscht.');
          /*
           * Weg von dieser Seite, nicht nur neu laden.
           *
           * Die Kennung im Pfad zeigt auf einen Entwurf, den es nicht mehr
           * gibt - ein `router.refresh()` liesse den Nutzer auf einer
           * «gibt es nicht»-Seite sitzen, zu der er selbst navigiert hat.
           */
          router.push('/fragt/ergebnisse');
        }}
      />
    </div>
  );
}
