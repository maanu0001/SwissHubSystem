import Link from 'next/link';
import { ArrowRight, EyeOff, FileText, UserSearch } from 'lucide-react';
import { systemRoutes } from '@swisshub/shared';
import type { profile } from '@swisshub/modules';
import { Abschnitt } from './abschnitt';
import { ProfilAuszeichnungen } from './profil-auszeichnungen';
import { ProfilHero } from './profil-hero';
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
  const seitenspalte = hatSteckbrief(ansicht.angaben, ansicht.socials) || ansicht.auszeichnungen.length > 0;

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

      {/*
       * Die Seitenspalte bekommt nur Platz, wenn sie etwas trägt.
       *
       * Sonst blieb der linke Teil bei zwei Dritteln stehen und rechts
       * daneben lag ein Drittel Leere - ein leeres Profil sah dadurch nicht
       * schlicht aus, sondern kaputt.
       */}
      <div className={`grid gap-6 ${seitenspalte ? 'lg:grid-cols-3' : ''}`}>
        <div className={`space-y-6 ${seitenspalte ? 'lg:col-span-2' : ''}`}>
          {ansicht.spiele ? (
            <Abschnitt
              titel="Spiele"
              verzug={120}
              notiz={ansicht.spiele.length > 0 ? `${ansicht.spiele.length} im Profil` : null}
            >
              <ProfilSpiele spiele={ansicht.spiele} />
            </Abschnitt>
          ) : null}
        </div>

        <div className={`space-y-6 ${seitenspalte ? '' : 'hidden'}`}>
          {hatSteckbrief(ansicht.angaben, ansicht.socials) ? (
            <Abschnitt titel="Über" verzug={140}>
              <ProfilSteckbrief angaben={ansicht.angaben} socials={ansicht.socials} />
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

      {ansicht.eigenes ? <EigeneWege /> : null}
    </div>
  );
}

/**
 * Die beiden Seiten, die neben dem Profil liegen.
 *
 * Sie standen frueher als eigene Eintraege in der Seitenleiste - drei
 * Profil-Eintraege nebeneinander fuer eine Person, von denen man zwei im
 * Jahr einmal oeffnet. Hier stehen sie richtig: die Suchliste dort, wo man
 * einstellt, ob man in ihr auftaucht, und die Selbstauskunft dort, wo man
 * ohnehin nach den eigenen Daten sieht.
 *
 * Nur im eigenen Profil - im fremden waeren es zwei Verweise auf Seiten
 * ueber jemand anderen.
 */
function EigeneWege(): React.JSX.Element {
  return (
    <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 border-t border-[hsl(var(--profil-rand))] pt-5 text-sm">
      <Link
        href={systemRoutes.entdecken()}
        className="inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
      >
        <UserSearch className="size-4" aria-hidden="true" />
        Mitglieder entdecken
      </Link>
      <Link
        href={systemRoutes.meineDaten()}
        className="inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
      >
        <FileText className="size-4" aria-hidden="true" />
        Meine Daten
      </Link>
    </nav>
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
