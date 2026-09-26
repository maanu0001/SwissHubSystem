'use client';

import { Check, Lock, Sparkles, Trophy } from 'lucide-react';
import * as themes from '@swisshub/modules/profil/profil-themes';
import '../../profil-themes.css';

/**
 * Die Auswahl der Profil-Designs.
 *
 * ## Warum jede Kachel ihre echte Kulisse zeigt
 *
 * Eine Vorschau aus zwei Farbflecken waere keine Vorschau. Jede Kachel
 * traegt dieselben drei Lagen und denselben Klassennamen wie die
 * oeffentliche Profilseite - dieselbe CSS-Datei, dieselben Animationen. Was
 * hier laeuft, laeuft dort auch.
 *
 * Das kostet nichts Zusaetzliches: die Kulissen sind Verlaeufe auf
 * `transform` und `opacity`, keine Bilder und kein JavaScript. Sieben
 * Kacheln sind sieben Elemente mehr, nicht sieben Animationsschleifen im
 * Hauptthread.
 *
 * ## Warum gesperrte Themes trotzdem laufen
 *
 * Wer ueberlegt, ob sich Premium lohnt, soll sehen, was er bekaeme. Ein
 * graues Kaestchen mit einem Schloss darin verkauft nichts und erklaert
 * nichts. Aktivieren laesst sich ein gesperrtes Theme nicht - und zwar
 * nicht, weil dieser Knopf `disabled` ist, sondern weil der Dienst es
 * ablehnt.
 */
/**
 * Was ein Theme ausser der Farbe aendert - in einem Halbsatz.
 *
 * Er steht auf der Kachel, weil die Vorschau nur die Kulisse zeigt. Dass
 * sich mit dem Theme auch die **Anordnung** der oeffentlichen Seite
 * aendert, sieht man dort nicht; wer es nicht liest, waehlt nach Farbe und
 * wundert sich danach.
 */
const KOMPOSITION_TEXT: Record<string, string> = {
  saeule: 'Schmale Mittelsäule, alles untereinander',
  banner: 'Breites Banner, zweispaltig darunter',
  raster: 'Zweispaltiges Raster mit harten Kanten',
  strom: 'Schmale Spalte links, Inhalt rechts',
  weite: 'Grosszügig gesetzt, versetzt eingerückt',
  buehne: 'Zentriert, Abschnitte als volle Bänder',
  orbit: 'Wechselseitig versetzt um die Mitte',
};

export function ThemeGalerie({
  gewaehlt,
  darfPremium,
  level,
  zugang = 'keiner',
  onWaehlen,
}: {
  gewaehlt: string | null;
  darfPremium: boolean;
  /**
   * Das erspielte Level - fuer Designs, die daran haengen.
   *
   * Nicht optional: ein fehlender Wert wuerde als `undefined` durch den
   * Vergleich fallen und ein gesperrtes Design offen erscheinen lassen.
   */
  level: number;
  /** Woher das Recht kommt - fuer den Hinweis unter der Galerie. */
  zugang?: 'premium' | 'berechtigung' | 'keiner';
  onWaehlen: (id: string | null) => void;
}): React.JSX.Element {
  const alle = themes.alleProfilThemes();

  return (
    <div>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-3">
        {alle.map((theme) => {
          const aktiv = (gewaehlt ?? 'classic') === theme.id;
          /*
           * Zwei Gruende, gesperrt zu sein - und sie lesen sich anders.
           *
           * «Mit SwissHub Premium» waere beim Prestige-Design eine
           * Falschauskunft: es laesst sich damit gerade nicht freischalten.
           * Wer auf Level 12 steht, soll die fehlenden Level sehen und nicht
           * nach einem Abonnement suchen, das nichts aendert.
           */
          const fehltPremium = theme.premium && !darfPremium;
          const fehltLevel = theme.mindestLevel !== null && level < theme.mindestLevel;
          const gesperrt = fehltPremium || fehltLevel;

          return (
            <li key={theme.id}>
              <button
                type="button"
                aria-pressed={aktiv}
                /* Der Klick bleibt erlaubt: die Meldung des Dienstes sagt
                   mehr als ein toter Knopf. Ein `disabled`-Element ist für
                   Screenreader ausserdem gar nicht erst erreichbar. */
                onClick={() => onWaehlen(theme.id === 'classic' ? null : theme.id)}
                className={`group relative block w-full overflow-hidden rounded-xl border text-left transition-colors ${
                  aktiv ? 'border-primary-bright' : 'border-border hover:border-foreground/30'
                }`}
              >
                {/* Die Kulisse - absolut, damit der Text darüber liegt. Die
                    Lagen sind dieselben wie auf der Profilseite; `absolute`
                    statt `fixed` hält sie in der Kachel. */}
                <span
                  aria-hidden="true"
                  className={`pt-kulisse pt-kulisse--kachel ${theme.kulisse} !absolute !inset-0 !z-0 block h-28`}
                  style={
                    {
                      // Etwas heller als die Profilseite: auf 112 Pixel
                      // Höhe braucht die Kulisse mehr Grundton, sonst
                      // sieht jedes Theme gleich schwarz aus.
                      '--profil-flaeche': '240 6% 12%',
                      '--profil-akzent': '358 79% 52%',
                    } as React.CSSProperties
                  }
                >
                  <span className="pt-lage pt-lage-1" />
                  <span className="pt-lage pt-lage-2" />
                  <span className="pt-lage pt-lage-3" />
                </span>

                <span className="relative z-10 block h-28" />

                <span className="relative z-10 flex items-start gap-2 border-t border-border bg-card p-3">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-sm font-semibold">
                      {theme.label}
                      {theme.premium ? (
                        <Sparkles className="size-3.5 text-[#e0a83a]" aria-label="Premium-Design" />
                      ) : null}
                      {theme.mindestLevel !== null ? (
                        <Trophy
                          className="size-3.5 text-[#e0a83a]"
                          aria-label={`Ab Level ${theme.mindestLevel}`}
                        />
                      ) : null}
                    </span>
                    <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                      {theme.beschreibung}
                    </span>
                    <span className="mt-1 block text-[0.7rem] leading-snug text-muted-foreground/80">
                      {KOMPOSITION_TEXT[theme.komposition] ?? ''}
                    </span>
                    {gesperrt ? (
                      <span className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
                        <Lock className="size-3" aria-hidden="true" />
                        {fehltLevel ? `Freischaltbar ab Level ${theme.mindestLevel}` : 'Mit SwissHub Premium'}
                      </span>
                    ) : null}
                  </span>
                  {aktiv ? (
                    <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-primary-bright text-background">
                      <Check className="size-3.5" aria-hidden="true" />
                      <span className="sr-only">Ausgewählt</span>
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {zugang === 'berechtigung' ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Alle Designs stehen dir über deine Rolle offen - ohne Abonnement. Diese Freigabe gilt
          ausschliesslich für die Profildesigns; weitere Premium-Vorteile sind damit nicht verbunden.
        </p>
      ) : null}

      {!darfPremium ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Die Premium-Designs lassen sich ansehen und mit einem aktiven{' '}
          <a href="/premium" className="text-primary-bright underline-offset-4 hover:underline">
            SwissHub Premium
          </a>{' '}
          auswählen. Eine bereits getroffene Wahl bleibt gespeichert und wirkt wieder, sobald Premium aktiv
          ist.
        </p>
      ) : null}
    </div>
  );
}
