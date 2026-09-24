'use client';

import { useState } from 'react';
import Link from 'next/link';
import * as angaben from '@swisshub/modules/profil/angaben';
import * as gestaltung from '@swisshub/modules/profil/gestaltung';
import { systemRoutes } from '@swisshub/shared';
import type { profile } from '@swisshub/modules';
import { ArrowLeft, TriangleAlert } from 'lucide-react';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { AbschnittAllgemein } from './abschnitt-allgemein';
import { AbschnittDesign } from './abschnitt-design';
import { AbschnittGames } from './abschnitt-games';
import { AbschnittPrivatsphaere } from './abschnitt-privatsphaere';
import { AbschnittShowcase } from './abschnitt-showcase';
import { AbschnittSocials } from './abschnitt-socials';
import { useSchliessSchutz } from './felder';

/**
 * Der Profil-Editor.
 *
 * ## Warum sechs Abschnitte und kein langes Formular
 *
 * Alles auf einer Seite waeren gut fuenfzig Felder. Niemand fuellt fuenfzig
 * Felder aus; die meisten scrollen einmal durch und schliessen den Tab. Sechs
 * Abschnitte sind sechs ueberschaubare Aufgaben, und jede speichert fuer
 * sich - wer nur sein Motto aendern will, aendert sein Motto.
 *
 * ## Warum der Wechsel gebremst wird
 *
 * Eine Navigation innerhalb der Anwendung loest kein `beforeunload` aus. Ein
 * unbedachter Klick auf «Design» wuerde einen halb getippten Text sonst
 * spurlos verschlucken. Der Wechsel fragt deshalb nach - und `beforeunload`
 * deckt daneben das Schliessen des Tabs ab.
 *
 * ## Warum die Vorschau oben klebt
 *
 * Damit die Wirkung einer Wahl sichtbar ist, waehrend man sie trifft. Sie
 * zeigt dieselben Werte, die gespeichert wuerden - kein nachgebauter
 * Beispielkopf.
 */
const ABSCHNITTE = [
  { key: 'allgemein', label: 'Allgemein' },
  { key: 'games', label: 'Meine Games' },
  { key: 'socials', label: 'Socials' },
  { key: 'design', label: 'Design' },
  { key: 'showcase', label: 'Showcase' },
  { key: 'privatsphaere', label: 'Privatsphäre' },
] as const;

type AbschnittKey = (typeof ABSCHNITTE)[number]['key'];

export function ProfilEditor({
  csrfToken,
  daten,
  identitaet,
}: {
  csrfToken: string;
  daten: profile.EditorDaten;
  identitaet: { discordId: string; discordName: string; avatarHash: string | null };
}): React.JSX.Element {
  const [offen, setOffen] = useState<AbschnittKey>('allgemein');
  const [schmutzig, setSchmutzig] = useState<Partial<Record<AbschnittKey, boolean>>>({});
  const [allgemein, setAllgemein] = useState(daten.allgemein);
  const [design, setDesign] = useState(daten.gestaltung);

  const offeneAenderungen = Object.values(schmutzig).some(Boolean);
  useSchliessSchutz(offeneAenderungen);

  const merke =
    (key: AbschnittKey) =>
    (wert: boolean): void =>
      setSchmutzig((vorher) => ({ ...vorher, [key]: wert }));

  const wechseln = (key: AbschnittKey): void => {
    if (
      schmutzig[offen] &&
      !window.confirm('In diesem Abschnitt gibt es ungespeicherte Änderungen. Trotzdem wechseln?')
    ) {
      return;
    }
    setSchmutzig((vorher) => ({ ...vorher, [offen]: false }));
    setOffen(key);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={systemRoutes.profil()}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Zurück zum Profil
        </Link>
        {offeneAenderungen ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-warning">
            <TriangleAlert className="size-3.5" aria-hidden="true" />
            Ungespeicherte Änderungen
          </span>
        ) : null}
      </div>

      <VorschauKopf allgemein={allgemein} design={design} identitaet={identitaet} />

      {/* Die Abschnittsleiste scrollt seitlich statt umzubrechen: auf 320 px
          passen sechs Beschriftungen nicht nebeneinander, und drei Zeilen
          Reiter sind schlimmer als ein Wisch. */}
      <div className="relative -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div
          className="flex min-w-max gap-1 border-b border-border"
          role="tablist"
          aria-label="Profilabschnitte"
        >
          {ABSCHNITTE.map((abschnitt) => (
            <button
              key={abschnitt.key}
              type="button"
              role="tab"
              aria-selected={offen === abschnitt.key}
              onClick={() => wechseln(abschnitt.key)}
              className={`relative min-h-11 whitespace-nowrap px-3 text-sm transition-colors ${
                offen === abschnitt.key
                  ? 'font-semibold text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {abschnitt.label}
              {schmutzig[abschnitt.key] ? (
                <span
                  className="absolute right-1 top-2 size-1.5 rounded-full bg-warning"
                  aria-label="ungespeichert"
                />
              ) : null}
              {offen === abschnitt.key ? (
                <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary-bright" />
              ) : null}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
        {offen === 'allgemein' ? (
          <AbschnittAllgemein
            csrfToken={csrfToken}
            start={daten.allgemein}
            onEntwurf={setAllgemein}
            onSchmutzig={merke('allgemein')}
          />
        ) : null}
        {offen === 'games' ? (
          <AbschnittGames csrfToken={csrfToken} start={daten.spiele} katalog={daten.katalog} />
        ) : null}
        {offen === 'socials' ? (
          <AbschnittSocials csrfToken={csrfToken} start={daten.socials} onSchmutzig={merke('socials')} />
        ) : null}
        {offen === 'design' ? (
          <AbschnittDesign
            csrfToken={csrfToken}
            start={daten.gestaltung}
            onEntwurf={setDesign}
            onSchmutzig={merke('design')}
          />
        ) : null}
        {offen === 'showcase' ? (
          <AbschnittShowcase
            csrfToken={csrfToken}
            start={daten.vitrine}
            auswahl={daten.auswahl}
            onSchmutzig={merke('showcase')}
          />
        ) : null}
        {offen === 'privatsphaere' ? (
          <AbschnittPrivatsphaere
            csrfToken={csrfToken}
            start={daten.privatsphaere}
            onSchmutzig={merke('privatsphaere')}
          />
        ) : null}
      </div>
    </div>
  );
}

/** Die Vorschau des Profilkopfs - mit den Werten, die gerade im Editor stehen. */
function VorschauKopf({
  allgemein,
  design,
  identitaet,
}: {
  allgemein: profile.EditorDaten['allgemein'];
  design: profile.EditorDaten['gestaltung'];
  identitaet: { discordId: string; discordName: string; avatarHash: string | null };
}): React.JSX.Element {
  const vorlage = gestaltung.bannervorlage(design.bannerPreset);
  const verfuegbar =
    allgemein.availability !== 'UNSET' ? angaben.label('verfuegbarkeit', allgemein.availability) : null;

  return (
    <div
      className="overflow-hidden rounded-xl border border-[hsl(var(--profil-rand))] bg-[hsl(var(--profil-flaeche))]"
      style={gestaltung.gestaltungsVariablen(design.theme, design.accent) as React.CSSProperties}
    >
      <div className="relative h-20 w-full" style={{ backgroundImage: vorlage.verlauf }}>
        {design.bannerBild ? (
          /* Die Route prueft die Berechtigung; der Optimierer verlöre die Sitzung. */
          // eslint-disable-next-line @next/next/no-img-element
          <img src={design.bannerBild} alt="" className="absolute inset-0 size-full object-cover" />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-[hsl(var(--profil-flaeche))] to-transparent" />
      </div>

      {/* `relative` aus demselben Grund wie im Profilkopf: der Bannerkasten
          darüber ist positioniert und würde sonst über den Namen gezeichnet,
          den der negative Rand dort hineinzieht. */}
      <div className="relative -mt-7 flex items-end gap-3 px-4 pb-4">
        <span
          className="rounded-full p-1 ring-2 ring-[hsl(var(--profil-akzent)/0.65)]"
          style={{ backgroundColor: 'hsl(var(--profil-flaeche))' }}
        >
          <DiscordAvatar
            discordId={identitaet.discordId}
            avatarHash={identitaet.avatarHash}
            name={identitaet.discordName}
            size={48}
          />
        </span>
        <div className="min-w-0 flex-1 pb-0.5">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="truncate text-base font-bold">{identitaet.discordName}</span>
            {allgemein.displayName ? (
              <span className="truncate text-xs text-muted-foreground">«{allgemein.displayName}»</span>
            ) : null}
          </p>
          {allgemein.tagline ? (
            <p className="truncate text-xs text-[hsl(var(--profil-akzent))]">{allgemein.tagline}</p>
          ) : null}
        </div>
        {verfuegbar ? (
          <span className="shrink-0 rounded-full bg-[hsl(var(--profil-akzent)/0.14)] px-2.5 py-1 text-[0.65rem] font-medium text-[hsl(var(--profil-akzent))]">
            {verfuegbar}
          </span>
        ) : null}
      </div>
    </div>
  );
}
