'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, Eye, EyeOff, Info, Plus, Star, Trash2 } from 'lucide-react';
import * as socials from '@swisshub/modules/profil/socials';
import * as linkRegistry from '@swisshub/modules/profil/links';
import type { profile } from '@swisshub/modules';
import { linksSpeichernAction } from '@/modules/profile/profil-aktionen';
import { SpeicherLeiste, unveraendert, useQuittung } from './felder';

/**
 * Abschnitt «Links» - der Link-in-Bio-Bereich.
 *
 * ## Zwei Arten in einer Liste
 *
 * **Plattformkonto:** eine Kennung auf einer bekannten Plattform. Die Adresse
 * baut der Server daraus; aus einer Eingabe kann hier kein fremdes Ziel werden.
 *
 * **Freier Link:** eine vollstaendige Adresse. Die braucht eine eigene
 * Pruefung - nur `https`, keine Zugangsdaten im Host, kein `javascript:` - und
 * die laeuft serverseitig. Was hier im Browser geprueft wird, ist dieselbe
 * Funktion; zwei Regeln waeren der Fehler.
 *
 * Beide stehen in **einer** Liste, weil sie auf der Profilseite eine sind. Die
 * Reihenfolge zaehlt ueber beide hinweg.
 *
 * ## Warum Pfeile und kein Drag-and-drop
 *
 * Weil Drag-and-drop auf einem Telefon schwierig und mit einer Tastatur kaum
 * bedienbar ist. Zwei Knoepfe je Zeile sind unspektakulaer, funktionieren
 * ueberall und brauchen keine Bibliothek. §17 verlangt ausdruecklich eine
 * Alternative; hier ist sie die einzige Bedienung, und damit gibt es keine
 * zweite, die schlechter gepflegt waere.
 *
 * ## Warum der Hinweis oben steht
 *
 * Damit niemand glaubt, hier entstehe eine geprueftes Kontoverknuepfung. Was
 * hier eingetippt wird, ist eine Behauptung - eine nuetzliche, aber eine
 * unbelegte. Ein Haken erscheint nur, wo die Plattform selbst bestaetigt hat,
 * und das tut heute allein der OAuth-Weg des Streamer Hubs.
 */

type Eintrag = profile.EditorDaten['links'][number];

const LEER: Eintrag = {
  art: 'frei',
  plattform: null,
  handle: null,
  url: '',
  label: '',
  verborgen: false,
  hervorgehoben: false,
};

export function AbschnittLinks({
  csrfToken,
  start,
  onSchmutzig,
}: {
  csrfToken: string;
  start: profile.EditorDaten['links'];
  onSchmutzig: (schmutzig: boolean) => void;
}): React.JSX.Element {
  const router = useRouter();
  const [gespeichert, setGespeichert] = useState(start);
  const [entwurf, setEntwurf] = useState(start);
  const [laeuft, setLaeuft] = useState(false);
  const [quittung, zeigeQuittung] = useQuittung();

  const schmutzig = !unveraendert(gespeichert, entwurf);

  const setze = (liste: Eintrag[]): void => {
    setEntwurf(liste);
    onSchmutzig(!unveraendert(gespeichert, liste));
  };

  const aendern = (index: number, teile: Partial<Eintrag>): void => {
    setze(entwurf.map((eintrag, i) => (i === index ? { ...eintrag, ...teile } : eintrag)));
  };

  const verschieben = (index: number, richtung: -1 | 1): void => {
    const ziel = index + richtung;
    if (ziel < 0 || ziel >= entwurf.length) {
      return;
    }
    const liste = [...entwurf];
    const a = liste[index]!;
    const b = liste[ziel]!;
    liste[index] = b;
    liste[ziel] = a;
    setze(liste);
  };

  const hervorgehoben = entwurf.filter((eintrag) => eintrag.hervorgehoben && !eintrag.verborgen).length;

  const speichern = async (): Promise<void> => {
    setLaeuft(true);
    const antwort = await linksSpeichernAction({
      csrfToken,
      eintraege: entwurf.map((eintrag) =>
        eintrag.art === 'plattform'
          ? {
              art: 'plattform' as const,
              plattform: eintrag.plattform ?? '',
              handle: eintrag.handle ?? '',
              label: eintrag.label,
              verborgen: eintrag.verborgen,
              hervorgehoben: eintrag.hervorgehoben,
            }
          : {
              art: 'frei' as const,
              url: eintrag.url ?? '',
              label: eintrag.label ?? '',
              verborgen: eintrag.verborgen,
              hervorgehoben: eintrag.hervorgehoben,
            },
      ),
    });
    setLaeuft(false);

    if (!antwort.ok) {
      toast.error(antwort.error.message);
      return;
    }
    setGespeichert(entwurf);
    onSchmutzig(false);
    zeigeQuittung();
    router.refresh();
  };

  return (
    <div className="space-y-4">
      <p className="flex items-start gap-2 rounded-lg border border-border/70 bg-muted/30 p-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>
          Was du hier einträgst, erscheint auf deinem öffentlichen Profil. Ein Häkchen bekommt nur ein Kanal,
          dessen Inhaberschaft die Plattform selbst bestätigt hat – heute geht das über den Streamer Hub. Eine
          eingetippte Kennung ist kein Nachweis.
        </span>
      </p>

      {entwurf.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Noch keine Links. Füge deine Kanäle hinzu – die wichtigsten erscheinen als grosse Knöpfe oben auf
          deinem Profil.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {entwurf.map((eintrag, index) => (
            <li
              key={`${eintrag.art}-${eintrag.plattform ?? eintrag.url ?? index}`}
              className="rounded-lg border border-border bg-background/40 p-3"
            >
              <div className="flex items-start gap-2">
                <div className="flex flex-col gap-1 pt-1">
                  <button
                    type="button"
                    onClick={() => verschieben(index, -1)}
                    disabled={index === 0}
                    aria-label="Nach oben"
                    className="grid size-7 place-items-center rounded text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                  >
                    <ArrowUp className="size-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => verschieben(index, 1)}
                    disabled={index === entwurf.length - 1}
                    aria-label="Nach unten"
                    className="grid size-7 place-items-center rounded text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                  >
                    <ArrowDown className="size-4" aria-hidden="true" />
                  </button>
                </div>

                <div className="min-w-0 flex-1 space-y-2">
                  {eintrag.art === 'plattform' ? (
                    <PlattformZeile eintrag={eintrag} onAendern={(teile) => aendern(index, teile)} />
                  ) : (
                    <FreieZeile eintrag={eintrag} onAendern={(teile) => aendern(index, teile)} />
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    <Schalter
                      an={eintrag.hervorgehoben}
                      symbol={<Star className="size-3.5" aria-hidden="true" />}
                      label="Hervorheben"
                      /*
                       * Die Obergrenze wird hier gebremst und serverseitig
                       * abgelehnt. Der Knopf auszugrauen ist die freundlichere
                       * Haelfte; die verbindliche steht im Dienst.
                       */
                      gesperrt={!eintrag.hervorgehoben && hervorgehoben >= linkRegistry.MAX_HERVORGEHOBEN}
                      onKlick={() => aendern(index, { hervorgehoben: !eintrag.hervorgehoben })}
                    />
                    <Schalter
                      an={!eintrag.verborgen}
                      symbol={
                        eintrag.verborgen ? (
                          <EyeOff className="size-3.5" aria-hidden="true" />
                        ) : (
                          <Eye className="size-3.5" aria-hidden="true" />
                        )
                      }
                      label={eintrag.verborgen ? 'Ausgeblendet' : 'Sichtbar'}
                      onKlick={() => aendern(index, { verborgen: !eintrag.verborgen })}
                    />
                    <button
                      type="button"
                      onClick={() => setze(entwurf.filter((_, i) => i !== index))}
                      className="ml-auto inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-xs text-muted-foreground transition-colors hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                      Entfernen
                    </button>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {entwurf.length < linkRegistry.MAX_LINKS ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setze([...entwurf, { ...LEER }])}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-dashed border-border px-3 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
          >
            <Plus className="size-4" aria-hidden="true" />
            Freien Link hinzufügen
          </button>
          <button
            type="button"
            onClick={() =>
              setze([
                ...entwurf,
                {
                  art: 'plattform',
                  plattform: naechsteFreiePlattform(entwurf),
                  handle: '',
                  url: null,
                  label: null,
                  verborgen: false,
                  hervorgehoben: false,
                },
              ])
            }
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-dashed border-border px-3 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
          >
            <Plus className="size-4" aria-hidden="true" />
            Gaming-Konto hinzufügen
          </button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Mehr als {linkRegistry.MAX_LINKS} Links werden unübersichtlich – das ist die Grenze.
        </p>
      )}

      <SpeicherLeiste
        schmutzig={schmutzig}
        laeuft={laeuft}
        gespeichert={quittung}
        onSpeichern={() => void speichern()}
        onVerwerfen={() => {
          setEntwurf(gespeichert);
          onSchmutzig(false);
        }}
      />
    </div>
  );
}

/** Eine Plattformzeile: Auswahl, Kennung, eigener Titel. */
function PlattformZeile({
  eintrag,
  onAendern,
}: {
  eintrag: Eintrag;
  onAendern: (teile: Partial<Eintrag>) => void;
}): React.JSX.Element {
  const definition = eintrag.plattform ? socials.socialPlattform(eintrag.plattform) : undefined;
  const beanstandung =
    eintrag.handle && definition && !socials.pruefeHandle(definition.key, eintrag.handle)
      ? `Das passt nicht zu einer ${definition.label}-Kennung.`
      : null;

  return (
    <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
      <select
        value={eintrag.plattform ?? ''}
        onChange={(ereignis) => onAendern({ plattform: ereignis.target.value })}
        aria-label="Plattform"
        className="min-h-11 rounded-lg border border-border bg-background px-3 text-sm"
      >
        {socials.alleSocialPlattformen().map((plattform) => (
          <option key={plattform.key} value={plattform.key}>
            {plattform.label}
          </option>
        ))}
      </select>
      <div className="space-y-1">
        <input
          type="text"
          value={eintrag.handle ?? ''}
          onChange={(ereignis) => onAendern({ handle: ereignis.target.value })}
          placeholder={definition?.platzhalter ?? ''}
          aria-label={definition?.eingabeLabel ?? 'Kennung'}
          maxLength={definition?.maxLaenge ?? 64}
          className="min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm"
        />
        <input
          type="text"
          value={eintrag.label ?? ''}
          onChange={(ereignis) => onAendern({ label: ereignis.target.value })}
          placeholder={`Eigener Titel (sonst «${definition?.label ?? 'Plattform'}»)`}
          aria-label="Eigener Titel"
          maxLength={linkRegistry.MAX_LABEL_LAENGE}
          className="min-h-11 w-full rounded-lg border border-border bg-background px-3 text-xs"
        />
        {beanstandung ? <p className="text-xs text-destructive">{beanstandung}</p> : null}
        {definition?.hilfe ? <p className="text-xs text-muted-foreground">{definition.hilfe}</p> : null}
      </div>
    </div>
  );
}

/** Ein freier Link: Adresse und Titel. */
function FreieZeile({
  eintrag,
  onAendern,
}: {
  eintrag: Eintrag;
  onAendern: (teile: Partial<Eintrag>) => void;
}): React.JSX.Element {
  /*
   * Dieselbe Pruefung wie auf dem Server - dieselbe Funktion.
   *
   * Gemeldet wird nur, nicht korrigiert: wer mitten im Tippen ist, soll nicht
   * gegen eine Eingabe kaempfen, die sich selbst umschreibt.
   */
  const geprueft = eintrag.url ? linkRegistry.pruefeLinkAdresse(eintrag.url) : null;
  const beanstandung = geprueft && !geprueft.ok ? geprueft.grund : null;

  return (
    <div className="space-y-1">
      <input
        type="url"
        value={eintrag.url ?? ''}
        onChange={(ereignis) => onAendern({ url: ereignis.target.value })}
        placeholder="https://example.com/meine-seite"
        aria-label="Adresse"
        maxLength={linkRegistry.MAX_URL_LAENGE}
        className="min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm"
      />
      <input
        type="text"
        value={eintrag.label ?? ''}
        onChange={(ereignis) => onAendern({ label: ereignis.target.value })}
        placeholder="Titel des Knopfes, z.B. «Mein Portfolio»"
        aria-label="Titel"
        maxLength={linkRegistry.MAX_LABEL_LAENGE}
        className="min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm"
      />
      {beanstandung ? <p className="text-xs text-destructive">{beanstandung}</p> : null}
    </div>
  );
}

function Schalter({
  an,
  symbol,
  label,
  gesperrt,
  onKlick,
}: {
  an: boolean;
  symbol: React.ReactNode;
  label: string;
  gesperrt?: boolean;
  onKlick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onKlick}
      disabled={gesperrt}
      aria-pressed={an}
      className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs transition-colors disabled:opacity-40 ${
        an
          ? 'border-primary/50 bg-primary/10 text-foreground'
          : 'border-border text-muted-foreground hover:text-foreground'
      }`}
    >
      {symbol}
      {label}
    </button>
  );
}

/**
 * Die erste Plattform, die noch nicht in der Liste steht.
 *
 * Ein neuer Eintrag mit einer schon vergebenen Plattform waere sofort ein
 * Fehler - `@@unique([profileId, platform])` laesst sie nur einmal zu. Sind alle
 * vergeben, gilt die erste; dann meldet der Server es, und das ist richtig, denn
 * dann gibt es nichts mehr hinzuzufuegen.
 */
function naechsteFreiePlattform(liste: Eintrag[]): string {
  const vergeben = new Set(liste.flatMap((eintrag) => (eintrag.plattform ? [eintrag.plattform] : [])));
  const frei = socials.alleSocialPlattformen().find((plattform) => !vergeben.has(plattform.key));
  return (frei ?? socials.alleSocialPlattformen()[0]!).key;
}
