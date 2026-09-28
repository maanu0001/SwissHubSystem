'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { Check, Download, ExternalLink, Info, Loader2, QrCode } from 'lucide-react';
import * as slug from '@swisshub/modules/profil/slug';
import type { profile } from '@swisshub/modules';
import { systemRoutes } from '@swisshub/shared';
import { GAMER_CARD_FORMATE, GAMER_CARD_MASSE, type GamerCardFormat } from '@/modules/profile/gamer-card';
import { slugAendernAction, slugPruefenAction } from '@/modules/profile/profil-aktionen';

/**
 * Abschnitt «Profilkarte» - Adresse, QR-Code und Gamer Card.
 *
 * ## Warum die drei zusammen stehen
 *
 * Weil sie eine Aufgabe sind: das eigene Profil nach aussen tragen. Die Adresse
 * ist der Link, der QR-Code derselbe Link fuer Papier, die Gamer Card dasselbe
 * Profil als Bild. Wer eines davon sucht, sucht meistens alle drei.
 *
 * ## Warum die Vorschau die Exportroute selbst ist
 *
 * Die Karte im Kasten unten ist ein `<img>` auf `/api/profil/gamer-card/<slug>` -
 * dieselbe Adresse, die der Download-Knopf liefert. Es gibt keinen zweiten
 * Zeichenweg, der abweichen koennte. Eine im Browser nachgebaute Vorschau waere
 * genau die Stelle, an der «sieht gut aus» und «Datei ist leer» auseinanderfallen.
 *
 * ## Warum der Teilen-Knopf hier nicht vorkommt
 *
 * Er steht unveraendert in der Mitgliedsakte und tut dort genau eine Sache: die
 * Adresse in die Zwischenablage kopieren. §14 verlangt ausdruecklich, dass er so
 * bleibt - kein Menue, kein Dialog. Hier steht die Ausfuhr, dort das Kopieren.
 */
export function AbschnittKarte({
  csrfToken,
  adresse,
  hatOeffentlichesProfil,
}: {
  csrfToken: string;
  adresse: profile.EditorDaten['adresse'];
  /** Ohne oeffentliches Profil gibt es keine Adresse - und nichts zu exportieren. */
  hatOeffentlichesProfil: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [wunsch, setWunsch] = useState(adresse.slug ?? '');
  const [laeuft, setLaeuft] = useState(false);
  const [pruefung, setPruefung] = useState<{ frei: boolean; grund: string | null } | null>(null);
  const [format, setFormat] = useState<GamerCardFormat>('story');
  /*
   * Ein Zaehler, der die Vorschau erneuert.
   *
   * Das Bild liegt unter derselben Adresse wie vorher; der Browser wuerde es
   * deshalb aus seinem Zwischenspeicher nehmen. Der Parameter erzwingt einen
   * neuen Abruf, nachdem sich etwas geaendert hat.
   */
  const [stand, setStand] = useState(0);

  if (!hatOeffentlichesProfil || !adresse.slug) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Deine Profilkarte und dein QR-Code entstehen aus deinem öffentlichen Profil. Solange es nicht
          öffentlich steht, gibt es keine Adresse, auf die sie zeigen könnten.
        </p>
        <p className="text-sm">
          Unter <span className="font-medium">Sichtbarkeit</span> kannst du dein Profil öffentlich stellen –
          dabei entsteht auch deine persönliche Adresse.
        </p>
      </div>
    );
  }

  const basis = `/api/profil/gamer-card/${encodeURIComponent(adresse.slug)}`;
  const vorschau = `${basis}?format=${format}&v=${stand}`;
  const mass = GAMER_CARD_MASSE[format];

  const beanstandung = slug.slugBeanstandung(wunsch);
  const geaendert = slug.normalisiereSlug(wunsch) !== adresse.slug;

  const pruefen = async (): Promise<void> => {
    setLaeuft(true);
    const antwort = await slugPruefenAction({ csrfToken, slug: wunsch });
    setLaeuft(false);
    if (!antwort.ok) {
      toast.error(antwort.error.message);
      return;
    }
    setPruefung({ frei: antwort.data.frei, grund: antwort.data.grund });
  };

  const uebernehmen = async (): Promise<void> => {
    setLaeuft(true);
    const antwort = await slugAendernAction({ csrfToken, slug: wunsch });
    setLaeuft(false);
    if (!antwort.ok) {
      toast.error(antwort.error.message);
      return;
    }
    toast.success('Deine Adresse ist geändert. Der alte Link leitet weiter.');
    setPruefung(null);
    setStand((wert) => wert + 1);
    router.refresh();
  };

  return (
    <div className="space-y-6">
      {/* --- Die Adresse --- */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Deine Profiladresse</h3>
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background/40 p-3">
          <span className="text-sm text-muted-foreground">/u/</span>
          <input
            type="text"
            value={wunsch}
            onChange={(ereignis) => {
              setWunsch(ereignis.target.value);
              setPruefung(null);
            }}
            maxLength={slug.SLUG_MAX_LAENGE}
            aria-label="Profiladresse"
            className="min-h-11 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-sm"
          />
          <button
            type="button"
            onClick={() => void pruefen()}
            disabled={laeuft || Boolean(beanstandung) || !geaendert}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 text-sm transition-colors hover:border-primary/50 disabled:opacity-40"
          >
            {laeuft ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            Prüfen
          </button>
          <button
            type="button"
            onClick={() => void uebernehmen()}
            disabled={laeuft || Boolean(beanstandung) || !geaendert || pruefung?.frei !== true}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary-bright px-3 text-sm font-semibold text-white transition-opacity disabled:opacity-40"
          >
            Übernehmen
          </button>
        </div>

        {beanstandung ? <p className="text-xs text-destructive">{beanstandung}</p> : null}
        {pruefung ? (
          <p
            className={`flex items-center gap-1.5 text-xs ${pruefung.frei ? 'text-success' : 'text-destructive'}`}
          >
            {pruefung.frei ? <Check className="size-3.5" aria-hidden="true" /> : null}
            {pruefung.frei ? 'Diese Adresse ist frei.' : pruefung.grund}
          </p>
        ) : null}

        <p className="flex items-start gap-2 rounded-lg border border-border/70 bg-muted/30 p-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            Wenn du deine Adresse änderst, leitet die alte weiter – ein Link in deiner Twitch-Bio oder auf
            einer gedruckten Karte funktioniert also weiter. Die alte Adresse bleibt dauerhaft für dich
            reserviert und kann von niemandem übernommen werden.
          </span>
        </p>

        {adresse.aliasse.length > 0 ? (
          <div className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Leitet ebenfalls hierher:</span>{' '}
            {adresse.aliasse.map((alt) => systemRoutes.oeffentlichesProfil(alt)).join(', ')}
          </div>
        ) : null}

        <Link
          href={systemRoutes.oeffentlichesProfil(adresse.slug)}
          target="_blank"
          className="inline-flex items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline"
        >
          Öffentliche Vorschau ansehen
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </Link>
      </section>

      {/* --- Gamer Card --- */}
      <section className="space-y-3 border-t border-border pt-5">
        <h3 className="text-sm font-semibold">Profilkarte exportieren</h3>
        <p className="text-sm text-muted-foreground">
          Ein echtes PNG in Instagram-Massen, mit deinem Design, deinen Spielen und deinem QR-Code. Die
          Vorschau unten ist die Datei selbst.
        </p>

        <div className="flex flex-wrap gap-2" role="group" aria-label="Format">
          {GAMER_CARD_FORMATE.map((eintrag) => (
            <button
              key={eintrag}
              type="button"
              onClick={() => setFormat(eintrag)}
              aria-pressed={format === eintrag}
              className={`inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm transition-colors ${
                format === eintrag
                  ? 'border-primary/60 bg-primary/10 font-medium'
                  : 'border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              {BESCHRIFTUNG[eintrag]}
              <span className="text-xs tabular-nums opacity-70">
                {GAMER_CARD_MASSE[eintrag].breite}×{GAMER_CARD_MASSE[eintrag].hoehe}
              </span>
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div
            className="overflow-hidden rounded-xl border border-border bg-background/40"
            style={{ width: 260, maxWidth: '100%' }}
          >
            {/*
              Die Vorschau ist die Exportroute.

              `next/image` wuerde das Bild ueber den Optimierer ziehen - und das
              Ergebnis waere nicht mehr byteweise die Datei, die der Download
              liefert. Genau das soll es aber sein.
            */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={vorschau}
              alt={`Vorschau der Profilkarte im Format ${BESCHRIFTUNG[format]}`}
              width={260}
              height={Math.round((260 / mass.breite) * mass.hoehe)}
              style={{ width: '100%', height: 'auto', display: 'block' }}
            />
          </div>

          <div className="flex flex-col gap-2">
            <a
              href={`${basis}?format=${format}`}
              download
              className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary-bright px-4 text-sm font-semibold text-white"
            >
              <Download className="size-4" aria-hidden="true" />
              PNG herunterladen
            </a>
            <a
              href={`${basis}?format=${format}&qr=0`}
              download
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-4 text-sm"
            >
              <Download className="size-4" aria-hidden="true" />
              Ohne QR-Code
            </a>
            <a
              href={`/api/profil/qr/${encodeURIComponent(adresse.slug)}?download=1`}
              download
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-4 text-sm"
            >
              <QrCode className="size-4" aria-hidden="true" />
              Nur QR-Code (SVG)
            </a>
            <p className="max-w-56 text-xs text-muted-foreground">
              Das SVG lässt sich beliebig gross drucken, ohne unscharf zu werden – für Flyer, Sticker und
              Aufsteller.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

const BESCHRIFTUNG: Record<GamerCardFormat, string> = {
  story: 'Story',
  quadrat: 'Quadratisch',
  feed: 'Feed',
};
