'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check, Download, Send } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import {
  bearbeiteSpotlightAction,
  finalisiereSpotlightAction,
  veroeffentlicheSpotlightAction,
} from '@/modules/streamer/actions';
import { SPOTLIGHT_FORMATE, SPOTLIGHT_MASSE, type SpotlightFormat } from '@/modules/streamer/social-folie';

/**
 * Der Editor eines Streamer Spotlights.
 *
 * ## Warum die Vorschau das Exportbild selbst ist
 *
 * Sie zeigt `/api/streamer/spotlight/<id>?format=...` in einem `<img>` - also
 * genau die Datei, die beim Herunterladen entsteht. Nicht eine Nachbildung
 * davon, nicht dieselbe Komponente im Browser: **dieselben Bytes**.
 *
 * Damit ist die Frage aus §10.4 nicht durch Disziplin beantwortet, sondern
 * durch Konstruktion. Eine HTML-Vorschau daneben wuerde bei der ersten
 * Schrift, die der Browser anders bricht als Satori, etwas anderes zeigen - und
 * auffallen wuerde es auf Instagram.
 *
 * Der Preis: jedes Speichern kostet ein neu gezeichnetes PNG. Das ist der
 * guenstigere Handel.
 *
 * ## Was hier nicht editierbar ist
 *
 * Name, Spiele, Plattform und Kanaladresse. Sie kommen beim Zeichnen aus dem
 * oeffentlichen Profil, und es gibt kein Feld, mit dem man sie uebersteuern
 * koennte - genauso wie die Abstimmungszahlen in «SwissHub fragt». Was nicht
 * eingegeben werden kann, kann nicht falsch sein.
 */
export function SpotlightEditor({
  csrfToken,
  spotlightId,
  streamerName,
  ueberschrift,
  beschreibung,
  cta,
  status,
  veroeffentlichtAm,
  darfVeroeffentlichen,
  spotlightKanalGesetzt,
}: {
  csrfToken: string;
  spotlightId: string;
  streamerName: string;
  ueberschrift: string;
  beschreibung: string;
  cta: string;
  status: 'DRAFT' | 'FINAL' | 'VEROEFFENTLICHT';
  veroeffentlichtAm: string | null;
  darfVeroeffentlichen: boolean;
  spotlightKanalGesetzt: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [laeuft, starte] = useTransition();
  const [format, setFormat] = useState<SpotlightFormat>('story');
  const [texte, setTexte] = useState({ ueberschrift, beschreibung, cta });
  /**
   * Der Schluessel der Vorschau.
   *
   * Er wechselt bei jedem Speichern und haengt in der Bildadresse. Ohne ihn
   * zeigte der Browser das PNG von vorhin - und die Vorschau waere genau das,
   * was sie nicht sein soll: eine aeltere Fassung.
   */
  const [stand, setStand] = useState(() => Date.now());
  const [veroeffentlichenOffen, setVeroeffentlichen] = useState(false);

  const gesperrt = status === 'VEROEFFENTLICHT';
  const bildAdresse = `/api/streamer/spotlight/${spotlightId}?format=${format}&v=${stand}`;
  const masse = SPOTLIGHT_MASSE[format];

  const speichern = (): void => {
    starte(async () => {
      const antwort = await bearbeiteSpotlightAction({ csrfToken, spotlightId, ...texte });
      if (!antwort.ok) {
        toast.error(antwort.error.message);
        return;
      }
      setStand(Date.now());
      toast.success('Gespeichert.');
      router.refresh();
    });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
      {/* --- Vorschau ---------------------------------------------------------- */}
      <Card className="order-2 lg:order-1">
        <CardHeader className="flex-row items-center justify-between gap-3">
          <div>
            <CardTitle>Vorschau</CardTitle>
            <CardDescription>
              Das ist die Datei, die beim Export entsteht - kein Abbild davon.
            </CardDescription>
          </div>
          <div className="flex gap-1.5">
            {SPOTLIGHT_FORMATE.map((eintrag) => (
              <Button
                key={eintrag}
                size="sm"
                variant={format === eintrag ? 'default' : 'outline'}
                onClick={() => setFormat(eintrag)}
              >
                {eintrag === 'story' ? 'Story' : eintrag === 'feed' ? 'Feed' : 'Quadrat'}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          <span className="text-xs text-muted-foreground">
            {masse.breite} × {masse.hoehe}
          </span>
          {/*
            Die Hoehe begrenzt, die Breite folgt dem Format: eine Story ist
            1920 Pixel hoch und wuerde die Seite sonst sprengen.
          */}
          {/* eslint-disable-next-line @next/next/no-img-element -- dieselbe Route,
              die auch den Export liefert; `next/image` würde sie optimieren und
              damit genau die Gleichheit brechen, um die es hier geht. */}
          <img
            key={bildAdresse}
            src={bildAdresse}
            alt={`Spotlight für ${streamerName}, Format ${format}`}
            className="max-h-[560px] w-auto rounded-xl border border-border bg-muted"
          />
          <div className="flex flex-wrap justify-center gap-2">
            {SPOTLIGHT_FORMATE.map((eintrag) => (
              <a
                key={eintrag}
                href={`/api/streamer/spotlight/${spotlightId}?format=${eintrag}&v=${stand}`}
                download
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm transition-colors hover:border-primary/50"
              >
                <Download className="size-4" aria-hidden="true" />
                {SPOTLIGHT_MASSE[eintrag].breite} × {SPOTLIGHT_MASSE[eintrag].hoehe}
              </a>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* --- Texte ------------------------------------------------------------- */}
      <div className="order-1 flex flex-col gap-4 lg:order-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Texte
              {status === 'VEROEFFENTLICHT' ? (
                <Badge variant="success">
                  Veröffentlicht{veroeffentlichtAm ? ` ${veroeffentlichtAm}` : ''}
                </Badge>
              ) : status === 'FINAL' ? (
                <Badge variant="outline">Abgeschlossen</Badge>
              ) : (
                <Badge variant="secondary">Entwurf</Badge>
              )}
            </CardTitle>
            <CardDescription>
              Redaktioneller Text. Name, Spiele und Kanal kommen aus dem öffentlichen Profil von{' '}
              {streamerName} und lassen sich hier nicht ändern.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="ueberschrift">Überschrift</Label>
              <Input
                id="ueberschrift"
                value={texte.ueberschrift}
                maxLength={60}
                disabled={gesperrt}
                onChange={(ereignis) =>
                  setTexte((bisher) => ({ ...bisher, ueberschrift: ereignis.target.value }))
                }
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="beschreibung">Beschreibung</Label>
              <textarea
                id="beschreibung"
                value={texte.beschreibung}
                maxLength={280}
                rows={4}
                disabled={gesperrt}
                onChange={(ereignis) =>
                  setTexte((bisher) => ({ ...bisher, beschreibung: ereignis.target.value }))
                }
                className="rounded-md border border-border bg-background p-3 text-sm"
              />
              <span className="text-xs text-muted-foreground">{texte.beschreibung.length} / 280</span>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="cta">Handlungsaufruf</Label>
              <Input
                id="cta"
                value={texte.cta}
                maxLength={80}
                disabled={gesperrt}
                onChange={(ereignis) => setTexte((bisher) => ({ ...bisher, cta: ereignis.target.value }))}
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={speichern} disabled={laeuft || gesperrt}>
                Speichern &amp; Vorschau erneuern
              </Button>
              {status === 'DRAFT' ? (
                <Button
                  variant="outline"
                  disabled={laeuft}
                  onClick={() =>
                    starte(async () => {
                      const antwort = await finalisiereSpotlightAction({ csrfToken, spotlightId });
                      if (!antwort.ok) {
                        toast.error(antwort.error.message);
                        return;
                      }
                      toast.success('Abgeschlossen.');
                      router.refresh();
                    })
                  }
                >
                  <Check className="size-4" aria-hidden="true" />
                  Abschliessen
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>

        {/* --- Auf Discord ----------------------------------------------------- */}
        {darfVeroeffentlichen ? (
          <Card>
            <CardHeader>
              <CardTitle>Auf Discord vorstellen</CardTitle>
              <CardDescription>
                Optional und höchstens einmal. Geht nicht von selbst - und nach Instagram geht nichts von
                hier: dafür lädst du die Grafik herunter.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!spotlightKanalGesetzt ? (
                <p className="text-sm text-warning">
                  Es ist kein Spotlight-Kanal eingestellt. System → Module → Streamer Hub.
                </p>
              ) : status === 'VEROEFFENTLICHT' ? (
                <p className="text-sm text-muted-foreground">
                  Dieser Spotlight wurde schon gesendet. Ein zweites Mal ist nicht möglich.
                </p>
              ) : (
                <Button variant="outline" disabled={laeuft} onClick={() => setVeroeffentlichen(true)}>
                  <Send className="size-4" aria-hidden="true" />
                  Auf Discord senden
                </Button>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>

      <ConfirmationDialog
        open={veroeffentlichenOffen}
        onOpenChange={setVeroeffentlichen}
        title="Spotlight auf Discord senden?"
        description={`Der Spotlight für ${streamerName} erscheint im eingestellten Kanal. Danach lässt sich der Text nicht mehr ändern - sonst zeigte die Nachricht etwas anderes als der Entwurf. Ein zweites Senden ist nicht möglich.`}
        confirmLabel="Senden"
        onConfirm={async () => {
          const antwort = await veroeffentlicheSpotlightAction({ csrfToken, spotlightId });
          if (!antwort.ok) {
            toast.error(antwort.error.message);
            return;
          }
          toast[antwort.data.gesendet ? 'success' : 'error'](
            antwort.data.gesendet ? 'Gesendet.' : (antwort.data.grund ?? 'Nicht gesendet.'),
          );
          router.refresh();
        }}
      />
    </div>
  );
}
