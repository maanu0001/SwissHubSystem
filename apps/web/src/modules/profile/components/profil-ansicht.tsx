import Link from 'next/link';
import { ArrowRight, EyeOff, Trophy } from 'lucide-react';
import { systemRoutes } from '@swisshub/shared';
import type { profile } from '@swisshub/modules';
import { Abschnitt } from './abschnitt';
import { ProfilAuszeichnungen } from './profil-auszeichnungen';
import { ProfilHero } from './profil-hero';
import { ProfilKarriere } from './profil-karriere';
import { ProfilSpiele } from './profil-spiele';
import { ProfilSteckbrief, hatSteckbrief } from './profil-steckbrief';
import { ProfilVitrine } from './profil-vitrine';

/**
 * Die ganze Profilseite.
 *
 * ## Warum Abschnitte verschwinden statt leer dazustehen
 *
 * Ein Profil ohne Turniere zeigt keinen Turnierkasten mit «0». Was nicht da
 * ist, ist nicht da - dieselbe Ueberlegung wie bei der Clip-Bilanz: vier
 * Nullen sagen «hier ist etwas, woran du gescheitert bist».
 *
 * Genau eine Ausnahme: im **eigenen** frischen Profil steht statt der
 * Abschnitte eine Einladung, es einzurichten. Ohne die waere die Seite
 * korrekt, aber eine Sackgasse.
 *
 * ## Warum die Gestaltung als CSS-Variablen hereinkommt
 *
 * `style` traegt vier Variablen, die aus der Registry stammen. Alles
 * darunter greift auf `--profil-akzent` zu, statt eine Farbe zu kennen.
 * Damit gibt es genau eine Stelle, an der eine Wahl zu einer Farbe wird -
 * und sie liest eine Liste, keine Eingabe.
 */
export function ProfilAnsicht({ ansicht }: { ansicht: profile.ProfilAnsicht }): React.JSX.Element {
  const leer =
    (ansicht.spiele?.length ?? 0) === 0 &&
    ansicht.vitrine.length === 0 &&
    !ansicht.angaben?.bio &&
    (ansicht.socials?.length ?? 0) === 0;

  return (
    <div className="space-y-6" style={ansicht.gestaltung.variablen as React.CSSProperties}>
      <ProfilHero ansicht={ansicht} />

      {leer && ansicht.eigenes ? <Einladung /> : null}

      <ProfilVitrine karten={ansicht.vitrine} verzug={60} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {ansicht.spiele ? (
            <Abschnitt
              titel="Spiele"
              verzug={120}
              notiz={ansicht.spiele.length > 0 ? `${ansicht.spiele.length} im Profil` : null}
            >
              <ProfilSpiele spiele={ansicht.spiele} />
            </Abschnitt>
          ) : null}

          {ansicht.karriere && ansicht.karriere.length > 0 ? (
            <Abschnitt titel="SwissHub-Karriere" verzug={180}>
              <div className="rounded-xl border border-[hsl(var(--profil-rand))] bg-[hsl(var(--profil-flaeche))] p-4 sm:p-5">
                <ProfilKarriere meilensteine={ansicht.karriere} />
              </div>
            </Abschnitt>
          ) : null}
        </div>

        <div className="space-y-6">
          {hatSteckbrief(ansicht.angaben, ansicht.socials) ? (
            <Abschnitt titel="Über" verzug={140}>
              <ProfilSteckbrief angaben={ansicht.angaben} socials={ansicht.socials} />
            </Abschnitt>
          ) : null}

          {ansicht.turniere && ansicht.turniere.teilnahmen > 0 ? (
            <Abschnitt titel="Turniere" verzug={200}>
              <TurnierBilanz turniere={ansicht.turniere} />
            </Abschnitt>
          ) : null}

          {ansicht.auszeichnungen.length > 0 ? (
            <Abschnitt
              titel="Auszeichnungen"
              verzug={240}
              notiz={
                ansicht.eigenes
                  ? `${ansicht.auszeichnungen.filter((a) => a.erreicht).length} von ${ansicht.auszeichnungen.length}`
                  : null
              }
            >
              <ProfilAuszeichnungen auszeichnungen={ansicht.auszeichnungen} />
            </Abschnitt>
          ) : null}
        </div>
      </div>

      {!ansicht.eigenes && ansicht.verborgen.length > 0 ? (
        <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <EyeOff className="size-3.5" aria-hidden="true" />
          Teile dieses Profils sind privat.
        </p>
      ) : null}
    </div>
  );
}

function Einladung(): React.JSX.Element {
  return (
    <div
      className="pr-auftritt rounded-xl border border-[hsl(var(--profil-akzent)/0.35)] p-5 sm:p-6"
      style={
        {
          background:
            'radial-gradient(120% 140% at 0% 0%, hsl(var(--profil-akzent) / 0.14) 0%, transparent 60%)',
          '--pr-verzug': '80ms',
        } as React.CSSProperties
      }
    >
      <h2 className="text-lg font-semibold">Dein Profil steht - jetzt fehlt noch der Inhalt.</h2>
      <p className="mt-1.5 max-w-prose text-sm text-muted-foreground">
        Trag ein, was du spielst, wann du unterwegs bist und worauf du stolz bist. Andere Mitglieder finden
        dich darüber unter «Mitglieder entdecken».
      </p>
      <Link
        href={systemRoutes.profilBearbeiten()}
        className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[hsl(var(--profil-akzent))] px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
      >
        Profil einrichten
        <ArrowRight className="size-4" aria-hidden="true" />
      </Link>
    </div>
  );
}

/**
 * Die Turnierbilanz.
 *
 * «Teilgenommen» meint bestaetigt teilgenommen - eine blosse Anmeldung
 * zaehlt hier nicht mit, und ein Platz erscheint nur, wenn das Turnier
 * tatsaechlich einen vergeben hat.
 */
function TurnierBilanz({ turniere }: { turniere: profile.ProfilTurniere }): React.JSX.Element {
  return (
    <div className="space-y-3 rounded-xl border border-[hsl(var(--profil-rand))] bg-[hsl(var(--profil-flaeche))] p-4 sm:p-5">
      <dl className="grid grid-cols-3 gap-3 text-center">
        {[
          { label: 'Teilgenommen', wert: turniere.teilnahmen },
          { label: 'Podeste', wert: turniere.podeste },
          { label: 'Siege', wert: turniere.siege },
        ].map((eintrag) => (
          <div key={eintrag.label}>
            <dd
              className={`text-2xl font-bold tabular-nums leading-none ${
                eintrag.label === 'Siege' && eintrag.wert > 0 ? 'text-[hsl(45_92%_58%)]' : ''
              }`}
            >
              {eintrag.wert}
            </dd>
            <dt className="mt-1 text-[0.65rem] uppercase tracking-wider text-muted-foreground">
              {eintrag.label}
            </dt>
          </div>
        ))}
      </dl>

      {turniere.letzte.length > 0 ? (
        <ul className="space-y-1.5 border-t border-[hsl(var(--profil-rand))] pt-3">
          {turniere.letzte.slice(0, 4).map((turnier) => (
            <li key={turnier.id} className="flex items-center gap-2 text-xs">
              {turnier.platz && turnier.platz <= 3 ? (
                <Trophy
                  className={`size-3.5 shrink-0 ${turnier.platz === 1 ? 'text-[hsl(45_92%_58%)]' : 'text-muted-foreground'}`}
                  aria-hidden="true"
                />
              ) : (
                <span className="size-3.5 shrink-0" aria-hidden="true" />
              )}
              <Link
                href={systemRoutes.turnier(turnier.slug)}
                className="min-w-0 flex-1 truncate underline-offset-4 hover:underline"
              >
                {turnier.name}
              </Link>
              {turnier.platz ? (
                <span className="shrink-0 tabular-nums text-muted-foreground">{turnier.platz}.</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
