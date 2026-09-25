'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ImageUp, Loader2, Trash2 } from 'lucide-react';
import * as gestaltung from '@swisshub/modules/profil/gestaltung';
import * as themes from '@swisshub/modules/profil/profil-themes';
import type { profile } from '@swisshub/modules';
import { bannerEntfernenAction, gestaltungSpeichernAction } from '@/modules/profile/profil-aktionen';
import { Feldgruppe, SpeicherLeiste, unveraendert, useQuittung } from './felder';
import { ThemeGalerie } from './theme-galerie';

/**
 * Abschnitt «Design».
 *
 * ## Warum es hier kein Farbfeld gibt
 *
 * Gespeichert wird ein Schluessel aus einer Liste, nie eine Farbe. Ein
 * freies Farbfeld - oder gar ein Textfeld fuer CSS - waere der Weg, auf dem
 * beliebige Angaben in ein `style`-Attribut gelangen. Die Auswahl unten ist
 * die vollstaendige Auswahl; was nicht darin steht, gibt es nicht.
 *
 * ## Warum das Banner nicht mitgespeichert wird
 *
 * Ein Bild geht ueber eine eigene Route, weil es eine Datei ist - wie beim
 * Logo und beim Spielcover. Es wird sofort wirksam, nicht erst beim
 * Speichern der uebrigen Wahl; ein Hochladen, das auf einen zweiten Klick
 * wartet, verwirrt mehr als es hilft.
 */
export function AbschnittDesign({
  csrfToken,
  start,
  onEntwurf,
  onSchmutzig,
}: {
  csrfToken: string;
  start: profile.EditorDaten['gestaltung'];
  onEntwurf: (entwurf: profile.EditorDaten['gestaltung']) => void;
  onSchmutzig: (schmutzig: boolean) => void;
}): React.JSX.Element {
  const router = useRouter();
  const [gespeichert, setGespeichert] = useState(start);
  const [entwurf, setEntwurfIntern] = useState(start);
  const [laeuft, setLaeuft] = useState(false);
  const [laedt, setLaedt] = useState(false);
  const [quittung, zeigeQuittung] = useQuittung();
  const dateiFeld = useRef<HTMLInputElement>(null);

  const schmutzig = !unveraendert(gespeichert, entwurf);

  const aendern = (teil: Partial<profile.EditorDaten['gestaltung']>): void => {
    const neu = { ...entwurf, ...teil };
    setEntwurfIntern(neu);
    onEntwurf(neu);
    onSchmutzig(!unveraendert(gespeichert, neu));
  };

  const speichern = async (): Promise<void> => {
    setLaeuft(true);
    const antwort = await gestaltungSpeichernAction({
      csrfToken,
      theme: entwurf.theme,
      accent: entwurf.accent,
      bannerPreset: entwurf.bannerPreset,
      premiumTheme: entwurf.premiumTheme,
    });
    setLaeuft(false);
    if (!antwort.ok) {
      toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
      return;
    }
    setGespeichert(entwurf);
    onSchmutzig(false);
    zeigeQuittung();
    router.refresh();
  };

  const hochladen = async (datei: File): Promise<void> => {
    setLaedt(true);
    const formular = new FormData();
    formular.set('csrfToken', csrfToken);
    formular.set('image', datei);
    /*
     * «eigenes» statt einer Kennung, und das ist Absicht: die Route
     * schreibt beim POST immer das Profil der Sitzung und liest den
     * Adressteil gar nicht. Hier die eigene Kennung hinzuschreiben liesse
     * vermuten, eine andere waere auch moeglich.
     */
    const antwort = await fetch('/api/profil/eigenes/banner', { method: 'POST', body: formular });
    const ergebnis = (await antwort.json()) as { ok: boolean; error?: { message?: string } };
    setLaedt(false);

    if (!ergebnis.ok) {
      toast.error(ergebnis.error?.message ?? 'Das Bild konnte nicht gespeichert werden.');
      return;
    }
    toast.success('Banner gespeichert.');
    router.refresh();
  };

  const entfernen = async (): Promise<void> => {
    const antwort = await bannerEntfernenAction({ csrfToken });
    if (!antwort.ok) {
      toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
      return;
    }
    toast.success('Banner entfernt. Es gilt wieder die Vorlage.');
    router.refresh();
  };

  const themeGewaehlt = themes.profilTheme(entwurf.premiumTheme);

  return (
    <div className="space-y-6">
      <Feldgruppe
        titel="Profil-Design"
        hinweis="Bestimmt, wie deine öffentliche Profilseite aussieht - Farbwelt und Hintergrund. Intern und in der Mitgliederakte ändert sich nichts."
      >
        <ThemeGalerie
          gewaehlt={entwurf.premiumTheme}
          darfPremium={start.darfPremium}
          onWaehlen={(id) => aendern({ premiumTheme: id })}
        />
      </Feldgruppe>

      {/*
       * Akzent und Flächenton wirken nur im Classic-Design.
       *
       * Ein Premium-Theme bringt eine vollständige Farbwelt mit und
       * überschreibt beides. Die Auswahl darunter stehenzulassen, ohne das
       * zu sagen, wäre eine Einstellung, die nichts tut - und niemand
       * sucht den Grund dort, wo er ist.
       */}
      {themeGewaehlt.premium ? (
        <p className="rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
          «{themeGewaehlt.label}» bringt eine eigene Farbwelt mit. Akzent und Flächenton unten wirken dann nur
          noch dort, wo kein Theme gilt.
        </p>
      ) : null}

      <Feldgruppe
        titel="Banner"
        hinweis="Ein eigenes Bild gilt vor der Vorlage. Ohne Bild trägt die Vorlage den Kopf - beides sieht gut aus."
      >
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={dateiFeld}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(event) => {
              const datei = event.target.files?.[0];
              if (datei) {
                void hochladen(datei);
              }
              event.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => dateiFeld.current?.click()}
            disabled={laedt}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 text-sm transition-colors hover:border-foreground/30 disabled:opacity-50"
          >
            {laedt ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <ImageUp className="size-4" aria-hidden="true" />
            )}
            {start.bannerBild ? 'Bild austauschen' : 'Bild hochladen'}
          </button>
          {start.bannerBild ? (
            <button
              type="button"
              onClick={() => void entfernen()}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:text-destructive"
            >
              <Trash2 className="size-4" aria-hidden="true" />
              Entfernen
            </button>
          ) : null}
        </div>
      </Feldgruppe>

      <Feldgruppe titel="Bannervorlage">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {gestaltung.alleBannervorlagen().map((vorlage) => (
            <button
              key={vorlage.key}
              type="button"
              aria-pressed={entwurf.bannerPreset === vorlage.key}
              onClick={() => aendern({ bannerPreset: vorlage.key })}
              className={`overflow-hidden rounded-lg border text-left transition-colors ${
                entwurf.bannerPreset === vorlage.key
                  ? 'border-primary-bright'
                  : 'border-border hover:border-foreground/30'
              }`}
            >
              <span className="block h-12 w-full" style={{ backgroundImage: vorlage.verlauf }} />
              <span className="block px-2 py-1.5 text-xs">{vorlage.label}</span>
            </button>
          ))}
        </div>
      </Feldgruppe>

      <Feldgruppe titel="Akzentfarbe">
        <div className="flex flex-wrap gap-2">
          {gestaltung.alleAkzente().map((farbe) => (
            <button
              key={farbe.key}
              type="button"
              aria-pressed={entwurf.accent === farbe.key}
              aria-label={farbe.label}
              title={farbe.label}
              onClick={() => aendern({ accent: farbe.key })}
              className={`flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm transition-colors ${
                entwurf.accent === farbe.key
                  ? 'border-foreground/40'
                  : 'border-border hover:border-foreground/30'
              }`}
            >
              <span
                className="size-4 rounded-full"
                style={{ backgroundColor: `hsl(${farbe.hsl})` }}
                aria-hidden="true"
              />
              {farbe.label}
            </button>
          ))}
        </div>
      </Feldgruppe>

      <Feldgruppe titel="Thema">
        <div className="grid gap-2 sm:grid-cols-3">
          {gestaltung.alleThemen().map((thema) => (
            <button
              key={thema.key}
              type="button"
              aria-pressed={entwurf.theme === thema.key}
              onClick={() => aendern({ theme: thema.key })}
              className={`rounded-lg border p-3 text-left transition-colors ${
                entwurf.theme === thema.key
                  ? 'border-primary-bright'
                  : 'border-border hover:border-foreground/30'
              }`}
              style={{ backgroundColor: `hsl(${thema.hslFlaeche})` }}
            >
              <span className="block text-sm font-medium">{thema.label}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{thema.beschreibung}</span>
            </button>
          ))}
        </div>
      </Feldgruppe>

      <SpeicherLeiste
        schmutzig={schmutzig}
        laeuft={laeuft}
        gespeichert={quittung}
        onSpeichern={() => void speichern()}
        onVerwerfen={() => {
          setEntwurfIntern(gespeichert);
          onEntwurf(gespeichert);
          onSchmutzig(false);
        }}
      />
    </div>
  );
}
