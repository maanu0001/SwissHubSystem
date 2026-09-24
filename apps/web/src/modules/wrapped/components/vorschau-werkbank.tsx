'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Bug, ExternalLink, Loader2, Monitor, RefreshCw, Smartphone, Tablet } from 'lucide-react';
import { WRAPPED_SZENEN } from '@swisshub/modules/wrapped/szenen';
import { systemRoutes } from '@swisshub/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { WRAPPED_BUEHNE_MELDUNG } from '@/modules/wrapped/components/buehne-rahmen';
import { KARTEN_FORMATE, type KartenFormat, type KartenSeite } from '@/modules/wrapped/share-karte';
import { wrappedVorschauAction } from '@/modules/wrapped/aktionen';
import type { SzenenBefund } from '@swisshub/modules/wrapped/szenen';
import type { WrappedDaten } from '@swisshub/modules/wrapped/daten';

/**
 * Die Werkbank.
 *
 * ## Wozu es sie gibt
 *
 * Damit niemand einen Rueckblick veroeffentlichen muss, um zu sehen, wie er
 * aussieht. Hier laesst sich jede Szene mit echten oder erfundenen Zahlen
 * ansehen, in jeder Bildschirmgroesse, mit und ohne Bewegung - und zwar
 * **genau derselbe Code**, den ein Mitglied spaeter zu sehen bekommt. Eine
 * vereinfachte Vorschau waere eine Vorschau auf etwas anderes.
 *
 * ## Was dabei niemals passiert
 *
 * Nichts. Die Vorschau ruft eine einzige, lesende Aktion. Keine
 * Momentaufnahme, kein XP, keine Benachrichtigung, kein Discord-Beitrag,
 * kein «angesehen»-Vermerk bei der Testperson. Die Story bekommt
 * `vorschau` gesetzt und meldet deshalb auch keinen Fortschritt.
 *
 * ## Warum die Buehne in einem iframe steckt
 *
 * Die erste Fassung spannte einen Kasten von 390 Pixeln im laufenden
 * Dokument auf und verkleinerte ihn. Das Ergebnis sah aus wie ein Telefon
 * und war keines: `vw`, `dvh` und die Breakpoints beziehen sich auf das
 * **Fenster**, nicht auf einen Kasten darin. Die Schrift kam also in
 * Desktop-Groesse, `sm:`-Regeln griffen - eine Komposition, die es auf
 * keinem Geraet gibt, und damit eine Vorschau, die nichts prueft.
 *
 * In einem eigenen Dokument ist das Fenster 390 Pixel breit. Was man sieht,
 * ist das, was auch ein Telefon zeigt. Die Verkleinerung von aussen aendert
 * daran nichts - sie faellt erst hinter dem Layout an.
 *
 * Der Preis ist ein zweites Dokument und ein Seitenaufruf je Aenderung.
 * Fuer ein Werkzeug, das die Gestaltung beurteilen soll, ist das der
 * richtige Tausch.
 */

const GERAETE = [
  { key: 'desktop', label: 'Desktop', breite: 1440, hoehe: 900, Symbol: Monitor },
  { key: 'tablet', label: 'Tablet', breite: 768, hoehe: 1024, Symbol: Tablet },
  { key: 'phone', label: 'Telefon', breite: 390, hoehe: 844, Symbol: Smartphone },
  { key: 'phone-klein', label: 'Klein', breite: 375, hoehe: 667, Symbol: Smartphone },
] as const;

type GeraetKey = (typeof GERAETE)[number]['key'];

const BEFUND_TEXT: Record<SzenenBefund, string> = {
  aktiv: 'erscheint',
  ausgeschaltet: 'ausgeschaltet',
  'keine-quelle': 'Quelle fehlt',
  'zu-wenig-daten': 'zu wenig Daten',
};

const BEFUND_FARBE: Record<SzenenBefund, 'success' | 'secondary' | 'warning' | 'outline'> = {
  aktiv: 'success',
  ausgeschaltet: 'secondary',
  'keine-quelle': 'warning',
  'zu-wenig-daten': 'outline',
};

export interface Persona {
  key: string;
  label: string;
  beschreibung: string;
}

export interface Testperson {
  discordId: string;
  name: string;
  tage: number;
}

export interface VorschauNutzdaten {
  daten: WrappedDaten;
  sceneKeys: string[];
  abdeckung: Array<{ sceneKey: string; label: string; befund: SzenenBefund }>;
  herkunft: 'live' | 'fixture';
}

export function VorschauWerkbank({
  campaignId,
  personas,
  testpersonen,
  anfang,
  csrfToken,
}: {
  campaignId: string;
  personas: Persona[];
  testpersonen: Testperson[];
  anfang: VorschauNutzdaten;
  csrfToken: string;
}): React.JSX.Element {
  const [nutzdaten, setNutzdaten] = useState(anfang);
  const [laeuft, setLaeuft] = useState(false);

  const [quelle, setQuelle] = useState<'fixture' | 'person'>(
    anfang.herkunft === 'live' ? 'person' : 'fixture',
  );
  const [persona, setPersona] = useState(personas[0]?.key ?? 'allrounder');
  const [discordId, setDiscordId] = useState(testpersonen[0]?.discordId ?? '');
  const [werte, setWerte] = useState<Record<string, string>>({});

  const [geraet, setGeraet] = useState<GeraetKey>('phone');
  const [ruhig, setRuhig] = useState(false);
  const [debug, setDebug] = useState(false);
  const [einzeln, setEinzeln] = useState(false);
  const [szene, setSzene] = useState(0);
  const [stand, setStand] = useState<{ index: number; key: string; gesamt: number } | null>(null);
  const [karte, setKarte] = useState<KartenFormat>('uebersicht');
  const [kartenSeite, setKartenSeite] = useState<KartenSeite>('story');

  const geraetDaten = GERAETE.find((eintrag) => eintrag.key === geraet) ?? GERAETE[2];

  const laden = useCallback(async (): Promise<void> => {
    setLaeuft(true);
    const ueberschreibung = zahlenAus(werte);
    const antwort = await wrappedVorschauAction({
      csrfToken,
      campaignId,
      quelle,
      discordId: quelle === 'person' ? discordId.trim() : null,
      persona: quelle === 'fixture' ? persona : null,
      ...(quelle === 'fixture' && Object.keys(ueberschreibung).length > 0 ? { ueberschreibung } : {}),
    });
    setLaeuft(false);

    if (!antwort.ok) {
      toast.error(antwort.error?.message ?? 'Die Vorschau liess sich nicht bauen.');
      return;
    }
    setNutzdaten({
      daten: antwort.data.daten,
      sceneKeys: antwort.data.sceneKeys,
      abdeckung: antwort.data.abdeckung.map((eintrag) => ({
        sceneKey: eintrag.szene.key,
        label: eintrag.szene.label,
        befund: eintrag.befund,
      })),
      herkunft: antwort.data.herkunft,
    });
    setSzene(0);
  }, [campaignId, csrfToken, discordId, persona, quelle, werte]);

  /*
   * Die Adresse des Rahmens.
   *
   * Sie ist die ganze Schnittstelle zum zweiten Dokument: aendert sich ein
   * Schalter, aendert sich die Adresse, und der Rahmen laedt neu. Kein
   * geteilter Zustand, keine Nachricht hinein - nur eine Adresse.
   */
  const buehneAdresse = adresse(campaignId, {
    quelle,
    persona,
    discordId,
    werte,
    einzeln,
    szene,
    ruhig,
    debug,
  });

  /*
   * Der Massstab.
   *
   * Nur verkleinern, nie vergroessern: ein Telefon auf einem breiten
   * Schirm soll ein Telefon bleiben und nicht aufgeblasen werden.
   */
  const messpunkt = useRef<HTMLDivElement | null>(null);
  const [faktor, setFaktor] = useState(1);
  useEffect(() => {
    const element = messpunkt.current;
    if (!element) {
      return;
    }
    const passe = (): void => setFaktor(Math.min(1, element.clientWidth / geraetDaten.breite));
    passe();
    const beobachter = new ResizeObserver(passe);
    beobachter.observe(element);
    return () => beobachter.disconnect();
  }, [geraetDaten.breite]);

  const karteAdresse = kartenLink(campaignId, {
    quelle,
    persona,
    discordId,
    werte,
    format: karte,
    seite: kartenSeite,
  });

  // Der Rahmen meldet, welche Szene gerade laeuft.
  useEffect(() => {
    const hoeren = (ereignis: MessageEvent): void => {
      if (ereignis.origin !== window.location.origin) {
        return;
      }
      const nachricht = ereignis.data as { typ?: string; index?: number; key?: string; gesamt?: number };
      if (nachricht?.typ !== WRAPPED_BUEHNE_MELDUNG || typeof nachricht.index !== 'number') {
        return;
      }
      setStand({ index: nachricht.index, key: nachricht.key ?? '', gesamt: nachricht.gesamt ?? 0 });
    };
    window.addEventListener('message', hoeren);
    return () => window.removeEventListener('message', hoeren);
  }, []);

  // Springt der Einzelschritt hinter das Ende, wird auf die letzte Szene
  // zurueckgesetzt: eine Person mit vier Szenen hat keine zwoelfte.
  useEffect(() => {
    if (szene >= nutzdaten.sceneKeys.length) {
      setSzene(Math.max(0, nutzdaten.sceneKeys.length - 1));
    }
  }, [szene, nutzdaten.sceneKeys.length]);

  /*
   * Zwei Spalten schon ab Tablet.
   *
   * Bei `lg` stand auf einem Tablet die ganze Bedienung ueber der Buehne -
   * man stellte etwas ein und musste scrollen, um die Wirkung zu sehen.
   * Genau das soll eine Werkbank nicht verlangen. 22rem fuer die Bedienung
   * lassen bei 768 Pixeln noch rund 360 fuer die Buehne; ein Telefon wird
   * darin leicht verkleinert, aber es bleibt daneben.
   */
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-[22rem_minmax(0,1fr)]">
      <div className="space-y-5">
        <section className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h3 className="text-sm font-semibold">Wessen Zahlen</h3>

          <div className="flex gap-2" role="radiogroup" aria-label="Datenquelle der Vorschau">
            <Button
              size="sm"
              variant={quelle === 'fixture' ? 'default' : 'outline'}
              onClick={() => setQuelle('fixture')}
              role="radio"
              aria-checked={quelle === 'fixture'}
            >
              Testperson
            </Button>
            <Button
              size="sm"
              variant={quelle === 'person' ? 'default' : 'outline'}
              onClick={() => setQuelle('person')}
              role="radio"
              aria-checked={quelle === 'person'}
            >
              Echtes Mitglied
            </Button>
          </div>

          {quelle === 'fixture' ? (
            <div className="space-y-1.5">
              <Label htmlFor="v-persona">Testperson</Label>
              <select
                id="v-persona"
                value={persona}
                onChange={(ereignis) => setPersona(ereignis.target.value)}
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
              >
                {personas.map((eintrag) => (
                  <option key={eintrag.key} value={eintrag.key}>
                    {eintrag.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                {personas.find((eintrag) => eintrag.key === persona)?.beschreibung}
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="v-person">Discord ID</Label>
              <Input
                id="v-person"
                value={discordId}
                onChange={(ereignis) => setDiscordId(ereignis.target.value)}
                inputMode="numeric"
                placeholder="123456789012345678"
              />
              {testpersonen.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {testpersonen.map((eintrag) => (
                    <button
                      key={eintrag.discordId}
                      type="button"
                      onClick={() => setDiscordId(eintrag.discordId)}
                      className="rounded-full border border-border px-2.5 py-1 text-xs transition hover:border-primary/50"
                    >
                      {eintrag.name}
                      <span className="ml-1 text-muted-foreground">{eintrag.tage}d</span>
                    </button>
                  ))}
                </div>
              ) : null}
              <p className="text-xs text-muted-foreground">
                Echte Zahlen, nur gelesen. Für diese Person passiert dabei nichts - kein Eintrag, keine
                Benachrichtigung, kein «angesehen».
              </p>
            </div>
          )}
        </section>

        {quelle === 'fixture' ? (
          <section className="space-y-3 rounded-xl border border-border bg-card p-4">
            <h3 className="text-sm font-semibold">Eigene Werte</h3>
            <p className="text-xs text-muted-foreground">
              Leer lassen heisst: Wert der Testperson. Damit lassen sich Extreme prüfen, ohne die Daten zu
              verbiegen.
            </p>
            <div className="grid grid-cols-2 gap-3">
              {FELDER.map((feld) => (
                <div key={feld.key} className="space-y-1">
                  <Label htmlFor={`v-${feld.key}`} className="text-xs">
                    {feld.label}
                  </Label>
                  <Input
                    id={`v-${feld.key}`}
                    inputMode="numeric"
                    value={werte[feld.key] ?? ''}
                    placeholder={feld.platzhalter}
                    onChange={(ereignis) =>
                      setWerte((alt) => ({ ...alt, [feld.key]: ereignis.target.value }))
                    }
                    className="h-8"
                  />
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <Button onClick={() => void laden()} disabled={laeuft} className="w-full">
          {laeuft ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="size-4" aria-hidden="true" />
          )}
          Vorschau neu bauen
        </Button>

        <section className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h3 className="text-sm font-semibold">Darstellung</h3>

          <div className="flex flex-wrap gap-1.5">
            {GERAETE.map((eintrag) => (
              <Button
                key={eintrag.key}
                size="sm"
                variant={geraet === eintrag.key ? 'default' : 'outline'}
                onClick={() => setGeraet(eintrag.key)}
              >
                <eintrag.Symbol className="size-3.5" aria-hidden="true" />
                {eintrag.label}
              </Button>
            ))}
          </div>

          <label className="flex items-center justify-between gap-3 text-sm">
            <span>
              Reduzierte Bewegung
              <span className="block text-xs text-muted-foreground">
                Zeigt sofort das Endbild jeder Szene.
              </span>
            </span>
            <Switch checked={ruhig} onCheckedChange={setRuhig} />
          </label>

          <label className="flex items-center justify-between gap-3 text-sm">
            <span>
              Einzelne Szene
              <span className="block text-xs text-muted-foreground">Hält an, statt weiterzulaufen.</span>
            </span>
            <Switch checked={einzeln} onCheckedChange={setEinzeln} />
          </label>

          <label className="flex items-center justify-between gap-3 text-sm">
            <span>
              Hilfslinien
              <span className="block text-xs text-muted-foreground">Sichere Ränder und Mittelachse.</span>
            </span>
            <Switch checked={debug} onCheckedChange={setDebug} />
          </label>

          {einzeln ? (
            <div className="space-y-1.5">
              <Label htmlFor="v-szene">Szene</Label>
              <select
                id="v-szene"
                value={szene}
                onChange={(ereignis) => setSzene(Number(ereignis.target.value))}
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
              >
                {nutzdaten.sceneKeys.map((key, index) => (
                  <option key={key} value={index}>
                    {index + 1}. {beschriftung(key)}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </section>

        <section className="space-y-3 rounded-xl border border-border bg-card p-4">
          <div>
            <h3 className="text-sm font-semibold">Karte zum Teilen</h3>
            <p className="text-xs text-muted-foreground">
              Dieselbe Karte, die ein Mitglied am Ende herunterlädt.
            </p>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {KARTEN_FORMATE.map((eintrag) => (
              <Button
                key={eintrag.key}
                size="sm"
                variant={karte === eintrag.key ? 'default' : 'outline'}
                onClick={() => setKarte(eintrag.key)}
              >
                {eintrag.label}
              </Button>
            ))}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setKartenSeite((alt) => (alt === 'story' ? 'quadrat' : 'story'))}
            >
              {kartenSeite === 'story' ? '9:16' : '1:1'}
            </Button>
          </div>

          {/*
            Ein `img` und kein eingebauter Bildbaustein: das Bild entsteht
            erst beim Abruf, hat keine bekannte Adresse zum Vorausladen und
            soll auch nicht zwischengespeichert werden.
          */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={karteAdresse}
            alt={`Vorschau der Karte «${KARTEN_FORMATE.find((eintrag) => eintrag.key === karte)?.label}»`}
            className="w-full rounded-lg border border-border bg-black"
          />
        </section>

        <section className="space-y-2 rounded-xl border border-border bg-card p-4">
          <h3 className="text-sm font-semibold">Welche Szenen erscheinen</h3>
          <ul className="space-y-1">
            {nutzdaten.abdeckung.map((eintrag) => (
              <li key={eintrag.sceneKey} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate">{eintrag.label}</span>
                <Badge variant={BEFUND_FARBE[eintrag.befund]} className="shrink-0">
                  {BEFUND_TEXT[eintrag.befund]}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {geraetDaten.breite} × {geraetDaten.hoehe}
            {stand ? ` · Szene ${stand.index + 1}/${stand.gesamt} · ${stand.key}` : ''}
          </span>
          <span className="flex items-center gap-3">
            <a
              href={buehneAdresse}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 underline underline-offset-2"
            >
              <ExternalLink className="size-3.5" aria-hidden="true" />
              In eigenem Tab
            </a>
            <span className="flex items-center gap-1.5">
              <Bug className="size-3.5" aria-hidden="true" />
              {nutzdaten.herkunft === 'live' ? 'Echte Zahlen (nur gelesen)' : 'Erfundene Zahlen'}
            </span>
          </span>
        </div>

        {/*
          Ein eigenes Dokument in Zielgroesse, als Ganzes verkleinert.

          Der Rahmen ist so breit und hoch wie das gewaehlte Geraet - damit
          sind `vw`, `dvh` und die Breakpoints darin die des Geraets. Die
          Verkleinerung geschieht von aussen und aendert daran nichts: das
          Dokument haelt seine 390 Pixel, nur das Bild wird kleiner.

          Drei Ebenen, und jede hat einen Grund:

            1. der Messpunkt - immer so breit wie die Spalte,
            2. der sichtbare Rahmen - so gross wie das verkleinerte Bild,
            3. das `iframe` - absolut gesetzt, in voller Geraetegroesse.

          Die dritte Ebene muss aus dem Fluss heraus. `transform: scale()`
          aendert nichts an der Groesse, die das Layout einnimmt: ein
          `iframe` von 390 Pixeln blieb im Fluss 390 Pixel breit und zog auf
          einem Telefon die ganze Seite mit sich - die Bedienelemente daneben
          wurden zu breit, und die Seite liess sich seitlich schieben.
        */}
        <div ref={messpunkt} className="w-full">
          {/*
            `max-w-full` fuer das erste Bild.

            Der Massstab steht erst fest, wenn die Spalte gemessen ist - beim
            ersten Zeichnen ist er 1, und der Rahmen waere auf einem Telefon
            breiter als der Schirm. Das `iframe` darin liegt absolut und
            schiebt ohnehin nichts; der Rahmen wird also nur beschnitten,
            bis die Messung da ist, statt die Seite zu verschieben.
          */}
          <div
            className="relative mx-auto max-w-full overflow-hidden rounded-2xl border border-border bg-black"
            style={{ width: geraetDaten.breite * faktor, height: geraetDaten.hoehe * faktor }}
          >
            <iframe
              key={buehneAdresse}
              title="Vorschau der Bühne"
              src={buehneAdresse}
              width={geraetDaten.breite}
              height={geraetDaten.hoehe}
              className="absolute left-0 top-0 origin-top-left border-0"
              style={{ transform: `scale(${faktor})` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

const FELDER = [
  { key: 'voiceSeconds', label: 'Sprachzeit (s)', platzhalter: '673200' },
  { key: 'messages', label: 'Nachrichten', platzhalter: '4821' },
  { key: 'activeDays', label: 'Aktive Tage', platzhalter: '286' },
  { key: 'levelEnd', label: 'Level am Ende', platzhalter: '38' },
  { key: 'clipWins', label: 'Clip-Siege', platzhalter: '2' },
  { key: 'primeTimeStunde', label: 'Prime Time (0-23)', platzhalter: '21' },
] as const;

/** Leere Felder fallen heraus; alles andere wird zur Zahl. */
function zahlenAus(werte: Record<string, string>): Record<string, number> {
  const ergebnis: Record<string, number> = {};
  for (const feld of FELDER) {
    const roh = werte[feld.key]?.trim();
    if (!roh) {
      continue;
    }
    const zahl = Number(roh);
    if (Number.isFinite(zahl) && zahl >= 0) {
      ergebnis[feld.key] = Math.round(zahl);
    }
  }
  return ergebnis;
}

const beschriftung = (key: string): string => WRAPPED_SZENEN.find((szene) => szene.key === key)?.label ?? key;

/**
 * Die Adresse der Buehne aus dem eingestellten Zustand.
 *
 * Nur gesetzte Werte landen in der Adresse. Ein `voiceSeconds=` ohne Wert
 * waere kein leeres Feld, sondern eine Null - und damit eine stille
 * Behauptung ueber die Testperson.
 */
function adresse(
  campaignId: string,
  zustand: {
    quelle: 'fixture' | 'person';
    persona: string;
    discordId: string;
    werte: Record<string, string>;
    einzeln: boolean;
    szene: number;
    ruhig: boolean;
    debug: boolean;
  },
): string {
  const suche = new URLSearchParams({ quelle: zustand.quelle });
  if (zustand.quelle === 'fixture') {
    suche.set('persona', zustand.persona);
    for (const [feld, wert] of Object.entries(zahlenAus(zustand.werte))) {
      suche.set(feld, String(wert));
    }
  } else if (zustand.discordId.trim()) {
    suche.set('discordId', zustand.discordId.trim());
  }
  if (zustand.einzeln) {
    suche.set('einzeln', '1');
    suche.set('szene', String(zustand.szene));
  }
  if (zustand.ruhig) {
    suche.set('ruhig', '1');
  }
  if (zustand.debug) {
    suche.set('hilfslinien', '1');
  }
  return `${systemRoutes.wrappedBuehne(campaignId)}?${suche.toString()}`;
}

/**
 * Die Adresse der Kartenvorschau.
 *
 * Dieselben Angaben wie fuer die Buehne, nur um Format und Seitenverhaeltnis
 * erweitert. Ein Stueck Zustand mehr waere ein Stueck Zustand, das
 * auseinanderlaufen kann.
 */
function kartenLink(
  campaignId: string,
  zustand: {
    quelle: 'fixture' | 'person';
    persona: string;
    discordId: string;
    werte: Record<string, string>;
    format: KartenFormat;
    seite: KartenSeite;
  },
): string {
  const suche = new URLSearchParams({
    quelle: zustand.quelle,
    format: zustand.format,
    seite: zustand.seite,
  });
  if (zustand.quelle === 'fixture') {
    suche.set('persona', zustand.persona);
    for (const [feld, wert] of Object.entries(zahlenAus(zustand.werte))) {
      suche.set(feld, String(wert));
    }
  } else if (zustand.discordId.trim()) {
    suche.set('discordId', zustand.discordId.trim());
  }
  return `/api/wrapped/karte-vorschau/${campaignId}?${suche.toString()}`;
}
