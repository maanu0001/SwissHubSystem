import Link from 'next/link';
import { ArrowUpRight, BadgeCheck, CalendarDays, ExternalLink, Trophy } from 'lucide-react';
import { branding } from '@swisshub/config/client';
import { formatDate } from '@swisshub/shared';
import type { profile } from '@swisshub/modules';
import { NavIcon } from '@/components/layout/nav-icon';
import { ProfilSpiele } from '../profil-spiele';
import { StufenMarke, stufe } from '../../auszeichnungs-stufe';
import { OeAbschnitt, OeMerkmale } from './oe-bausteine';

/**
 * Die Abschnitte der oeffentlichen Profilseite.
 *
 * ## Warum sie in einer Datei stehen
 *
 * Weil sie zusammen ein Layout bilden. Jeder ist ein `OeAbschnitt` mit
 * derselben Kante, derselben Flaeche und demselben Auftritt - was sie
 * unterscheidet, ist ihr Inhalt. Sieben Dateien mit je zwanzig Zeilen waeren
 * sieben Gelegenheiten, dass eine davon ihre Karte selbst baut und in fuenf von
 * sieben Themes falsch aussieht.
 *
 * ## Was sie alle nicht tun
 *
 * Sie pruefen nichts. Was hier ankommt, hat `ladeProfilFuer('oeffentlich')`
 * freigegeben; ein Abschnitt, der selbst filtert, hat die Daten schon im HTML.
 * Fehlt ein Feld, gibt die Komponente `null` zurueck - kein leerer Kasten mit
 * «keine Angabe». Auf einer Seite, die jemand teilt, ist eine Reihe leerer
 * Kaesten kein Hinweis, sondern eine Blamage.
 */

type Profil = profile.OeffentlichesProfil;

/**
 * Die hervorgehobenen Links als grosse Knoepfe.
 *
 * ## Warum sie zweimal vorkommen koennen
 *
 * Diese Reihe steht im Kopf, direkt unter dem Namen - dort, wo jemand nach dem
 * Stream oder dem Steam-Profil sucht. Der Abschnitt «Links» weiter unten zeigt
 * **alle**, auch die hervorgehobenen. Das ist Absicht: wer die Seite von oben
 * liest, soll nicht scrollen muessen, und wer sie durchliest, soll keine Luecke
 * finden.
 *
 * `rel="noopener noreferrer"`: die Zielseite muss nicht erfahren, von welchem
 * Profil jemand kam.
 */
export function OeHauptlinks({ links }: { links: profile.AngezeigterLink[] }): React.JSX.Element | null {
  const wichtig = links.filter((eintrag) => eintrag.hervorgehoben);
  if (wichtig.length === 0) {
    return null;
  }

  return (
    <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {wichtig.map((eintrag) => (
        <a
          key={eintrag.key}
          href={eintrag.url}
          target="_blank"
          rel="noopener noreferrer"
          className="po-hebt group flex min-h-12 items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold"
          style={{
            backgroundColor: 'hsl(var(--profil-akzent) / 0.16)',
            border: '1px solid hsl(var(--profil-akzent) / 0.45)',
            color: 'hsl(var(--profil-akzent))',
          }}
        >
          <span className="[&_svg]:size-4" aria-hidden="true">
            <NavIcon name={eintrag.symbol} />
          </span>
          <span className="min-w-0 flex-1 truncate">{eintrag.label}</span>
          <ArrowUpRight className="size-4 shrink-0 opacity-70" aria-hidden="true" />
        </a>
      ))}
    </div>
  );
}

/**
 * Der Link-in-Bio-Abschnitt.
 *
 * Die hervorgehobenen zuerst und optisch anders: das ist der ganze Zweck der
 * Hervorhebung. Darunter die uebrigen als kompakte Zeile.
 */
export function OeLinkAbschnitt({
  links,
  verzug,
}: {
  links: profile.AngezeigterLink[];
  verzug: number;
}): React.JSX.Element | null {
  if (links.length === 0) {
    return null;
  }
  const wichtig = links.filter((eintrag) => eintrag.hervorgehoben);
  const weitere = links.filter((eintrag) => !eintrag.hervorgehoben);

  return (
    <OeAbschnitt titel="Links" notiz={`${links.length}`} verzug={verzug} className="po-breit">
      {wichtig.length > 0 ? <OeHauptlinks links={wichtig} /> : null}

      {weitere.length > 0 ? (
        <ul className={`flex flex-wrap gap-2 ${wichtig.length > 0 ? 'mt-3' : ''}`}>
          {weitere.map((eintrag) => (
            <li key={eintrag.key}>
              <a
                href={eintrag.url}
                target="_blank"
                rel="noopener noreferrer"
                className="po-hebt inline-flex min-h-11 items-center gap-2 rounded-lg border border-[hsl(var(--profil-rand))] px-3 py-2 text-sm"
              >
                <span className="text-[hsl(var(--profil-akzent))] [&_svg]:size-3.5" aria-hidden="true">
                  <NavIcon name={eintrag.symbol} />
                </span>
                <span className="text-muted-foreground">{eintrag.label}</span>
                {eintrag.handle ? <span className="font-medium">{eintrag.handle}</span> : null}
                {/*
                  Der Haken nur dort, wo er etwas bedeutet.

                  Belegt heisst: die Plattform selbst hat die Inhaberschaft
                  bestaetigt - heute nur ueber den OAuth-Weg des Streamer Hubs.
                  Ein selbst eingetippter Name ist kein Nachweis, und ein freier
                  Link kann grundsaetzlich keinen haben.
                */}
                {eintrag.verifiziert ? (
                  <BadgeCheck
                    className="size-3.5 text-[hsl(var(--profil-akzent))]"
                    aria-label="Von der Plattform bestätigt"
                  />
                ) : null}
                <ExternalLink className="size-3 opacity-50" aria-hidden="true" />
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </OeAbschnitt>
  );
}

/**
 * «Meine Gaming-Welt» - Spiele, Plattformen, Sprachen, Spielzeiten.
 *
 * Ein Abschnitt und nicht vier: fuer einen Besucher ist das **eine** Frage -
 * was spielt diese Person, und passt das zu mir. Vier Kaesten mit je zwei
 * Angaben waeren dieselbe Antwort, nur zerstreut.
 *
 * Die Spiele kommen aus dem zentralen Katalog; hier steht keine zweite Liste.
 */
export function OeGaming({ profil, verzug }: { profil: Profil; verzug: number }): React.JSX.Element | null {
  const spiele = profil.spiele ?? [];
  const angaben = profil.angaben;
  const hatMerkmale =
    (angaben?.sprachen?.length ?? 0) > 0 ||
    (angaben?.plattformen?.length ?? 0) > 0 ||
    (angaben?.spielzeiten?.length ?? 0) > 0 ||
    (angaben?.absprache?.length ?? 0) > 0;

  if (spiele.length === 0 && !hatMerkmale) {
    return null;
  }

  return (
    <OeAbschnitt
      titel="Meine Gaming-Welt"
      notiz={spiele.length > 0 ? `${spiele.length} ${spiele.length === 1 ? 'Spiel' : 'Spiele'}` : null}
      verzug={verzug}
      className="po-breit"
    >
      {spiele.length > 0 ? <ProfilSpiele spiele={spiele} /> : null}

      {hatMerkmale ? (
        <div className={`grid gap-4 sm:grid-cols-2 ${spiele.length > 0 ? 'mt-5' : ''}`}>
          <OeMerkmale titel="Sprachen" werte={angaben?.sprachen} />
          <OeMerkmale titel="Plattformen" werte={angaben?.plattformen} />
          <OeMerkmale titel="Spielzeiten" werte={angaben?.spielzeiten} />
          <OeMerkmale titel="Absprache" werte={angaben?.absprache} />
        </div>
      ) : null}
    </OeAbschnitt>
  );
}

/**
 * Die Turniererfolge.
 *
 * ## Woher die Zahlen kommen
 *
 * Aus dem bestehenden Turniermodul, ueber `getMemberHistory` - derselbe
 * Verlauf, den die Mitgliedsakte zeigt. Hier liegt keine Kopie: eine
 * nachgetragene Korrektur an einem Ergebnis wirkt sofort, und eine Platzierung,
 * die es nicht gab, kann nicht entstehen.
 *
 * ## Warum ohne Platzierung trotzdem etwas dasteht
 *
 * Eine Teilnahme ist eine Teilnahme. Ein Turnier ohne `platz` - noch laufend,
 * kein Endergebnis, ausgeschieden ohne Rang - bekommt keine erfundene Zahl,
 * sondern nur Name und Spiel.
 */
export function OeTurniere({
  turniere,
  verzug,
}: {
  turniere: NonNullable<Profil['turniere']>;
  verzug: number;
}): React.JSX.Element | null {
  if (turniere.teilnahmen === 0 && turniere.letzte.length === 0) {
    return null;
  }

  return (
    <OeAbschnitt titel="Turniererfolge" notiz={`${turniere.teilnahmen}`} verzug={verzug}>
      <div className="mb-4 flex flex-wrap gap-4 text-sm">
        <Kennzahl wert={turniere.teilnahmen} label="Teilnahmen" />
        {turniere.podeste > 0 ? <Kennzahl wert={turniere.podeste} label="Podestplätze" /> : null}
        {turniere.siege > 0 ? <Kennzahl wert={turniere.siege} label="Siege" betont /> : null}
      </div>

      {turniere.letzte.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {turniere.letzte.map((turnier) => (
            <li
              key={turnier.id}
              className="flex items-center gap-3 rounded-lg border border-[hsl(var(--profil-rand))] px-3 py-2.5"
            >
              <span
                className="grid size-8 shrink-0 place-items-center rounded-md"
                style={{
                  backgroundColor: 'hsl(var(--profil-akzent) / 0.16)',
                  color: 'hsl(var(--profil-akzent))',
                }}
                aria-hidden="true"
              >
                <Trophy className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{turnier.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {turnier.gameName}
                  {turnier.startsAt ? ` · ${formatDate(turnier.startsAt)}` : ''}
                </span>
              </span>
              {turnier.platz ? (
                <span
                  className="shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold"
                  style={{
                    backgroundColor: 'hsl(var(--profil-akzent) / 0.18)',
                    color: 'hsl(var(--profil-akzent))',
                  }}
                >
                  {turnier.platz}. Platz
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </OeAbschnitt>
  );
}

function Kennzahl({
  wert,
  label,
  betont,
}: {
  wert: number;
  label: string;
  betont?: boolean;
}): React.JSX.Element {
  return (
    <span className="flex flex-col">
      <span
        className="text-2xl font-semibold tabular-nums"
        style={betont ? { color: 'hsl(var(--profil-akzent))' } : undefined}
      >
        {wert}
      </span>
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
    </span>
  );
}

/**
 * Level und Fortschritt.
 *
 * Gerechnet wird nichts: `level` kommt aus dem bestehenden XP-System, ueber
 * dieselbe Kurve wie die Levelkarte und die Rangliste. Hier steht eine
 * Fortschrittsleiste und sonst nichts - und wer das Hoechstlevel hat, sieht
 * keine Leiste bei 100 Prozent, sondern dass er dort ist.
 */
export function OeLevel({
  level,
  verzug,
}: {
  level: NonNullable<Profil['level']>;
  verzug: number;
}): React.JSX.Element {
  const prozent = Math.round(Math.min(Math.max(level.fortschritt, 0), 1) * 100);

  return (
    <OeAbschnitt titel="Level" verzug={verzug}>
      <div className="flex items-end justify-between gap-3">
        <span className="flex items-baseline gap-2">
          <span
            className="text-4xl font-bold leading-none tabular-nums"
            style={{ color: 'hsl(var(--profil-akzent))' }}
          >
            {level.level}
          </span>
          {level.hoechstlevel ? (
            <span className="text-sm font-medium text-muted-foreground">Höchstlevel</span>
          ) : null}
        </span>
        {level.rang ? (
          <span className="text-xs text-muted-foreground">Rang {level.rang} im Server</span>
        ) : null}
      </div>

      {level.hoechstlevel ? null : (
        <>
          <div
            className="mt-4 h-2 overflow-hidden rounded-full"
            style={{ backgroundColor: 'hsl(var(--profil-rand))' }}
            role="progressbar"
            aria-valuenow={prozent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Fortschritt zu Level ${level.level + 1}`}
          >
            <div
              className="h-full rounded-full"
              style={{ width: `${prozent}%`, backgroundColor: 'hsl(var(--profil-akzent))' }}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {level.fehlendeXp.toLocaleString('de-CH')} XP bis Level {level.level + 1}
          </p>
        </>
      )}
    </OeAbschnitt>
  );
}

/**
 * Die hervorgehobenen Auszeichnungen - hoechstens drei, gross.
 *
 * ## Warum das neben der vollen Liste steht
 *
 * Weil drei etwas anderes sind als vierzig. Die Liste sagt, was jemand erreicht
 * hat; diese drei sagen, worauf er stolz ist. Sie sind eine **Auswahl** aus
 * derselben Liste - was hier steht, steht auch dort, und was jemand nicht
 * erreicht hat, kann an keiner der beiden Stellen erscheinen.
 *
 * ## Warum die Stufe hier jetzt anders aussieht
 *
 * Sie stand als Kleintext unter dem Namen - «gold», grau, in Versalien - auf
 * einer Karte, die in der Akzentfarbe des Profildesigns gehalten war. Drei
 * Auszeichnungen nebeneinander sahen damit identisch aus, und ausgerechnet
 * hier, auf der Seite, die man verlinkt und teilt, war Gold von Bronze nicht
 * zu unterscheiden.
 *
 * Jetzt traegt die Karte selbst die Stufe: Rahmengeometrie, Materialstruktur
 * und Symbolfeld kommen aus `auszeichnungs-stufe` - demselben Satz Angaben,
 * aus dem die Auszeichnungsliste im Dashboard und die Gamer Card schoepfen.
 * Die Akzentfarbe des Designs bleibt dem Rest der Seite; eine Medaille hat
 * ihre eigene Farbe, und zwar eine, die nicht verhandelbar ist.
 */
export function OeHervorgehobene({
  auszeichnungen,
  verzug,
}: {
  auszeichnungen: Profil['hervorgehobene'];
  verzug: number;
}): React.JSX.Element | null {
  if (auszeichnungen.length === 0) {
    return null;
  }

  return (
    <div
      className="po-auftritt po-breit grid gap-2.5 sm:grid-cols-3"
      style={{ '--po-verzug': `${verzug}ms` } as React.CSSProperties}
    >
      {auszeichnungen.map((eintrag) => (
        <div
          key={eintrag.key}
          className={`po-hebt flex items-center gap-3 p-4 ${stufe(eintrag.stufe).karte}`}
          title={eintrag.beschreibung}
        >
          <span className="az-feld size-11 shrink-0 [&_svg]:size-5" aria-hidden="true">
            <NavIcon name={eintrag.symbol} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-foreground">{eintrag.label}</span>
            {/*
              Stufe und - wo es zutrifft - «verliehen».

              Das Wort bleibt neben der Karte stehen, obwohl die Karte die
              Stufe schon zeigt: es ist das, was ein Vorleseprogramm ausgibt,
              und das, was jemand liest, der diese Seite zum ersten Mal sieht
              und die Formensprache noch nicht kennt.

              Ein Freischaltdatum steht hier **nicht**, und zwar weil es keines
              gibt: gerechnete Auszeichnungen liegen in keiner Tabelle, sie
              entstehen bei jeder Anzeige neu aus Turnieren, Clips und dem
              Level. Ein Datum dafuer waere erfunden. Verliehene haetten eines,
              und nur bei der Haelfte eines zu zeigen saehe nach einem Fehler
              aus - also bei keiner.
            */}
            <span className="block text-[0.65rem] uppercase tracking-wide opacity-90">
              {stufe(eintrag.stufe).label}
              {eintrag.verliehen ? ' · verliehen' : ''}
            </span>
          </span>
          <StufenMarke wert={eintrag.stufe} className="shrink-0" />
        </div>
      ))}
    </div>
  );
}

/**
 * Der Fussbereich: SwissHub als Plattform, dezent.
 *
 * ## Warum kein Einladungslink in den Code gehoert
 *
 * Discord-Einladungen laufen ab. Ein hartcodierter Link ist deshalb ein Link,
 * der irgendwann ins Leere fuehrt - und niemand merkt es, weil niemand die
 * Fussleiste eines fremden Profils anklickt. Verlinkt wird die eigene
 * Startseite; sie bleibt, und die aktuelle Einladung steht dort. Ist unter
 * `branding.links.discordInvite` eine gepflegte Adresse konfiguriert, gilt die.
 *
 * ## Warum das so klein ist
 *
 * Weil die Person im Vordergrund steht. Ein Besucher ist wegen ihr hier, nicht
 * wegen uns - ein Werbeblock in der Mitte der Seite waere ein Grund, sie nicht
 * zu teilen.
 */
export function OeSwissHub(): React.JSX.Element {
  const einladung = branding.links.discordInvite;

  return (
    <footer className="mt-10 flex flex-col items-center gap-3 border-t border-[hsl(var(--profil-rand))] pt-6 text-center">
      <p className="text-xs text-muted-foreground">
        Dieses Profil läuft auf <span className="font-medium text-foreground">{branding.name}</span> — der
        Schweizer Gaming-Community.
      </p>
      {einladung ? (
        <a
          href={einladung}
          target="_blank"
          rel="noopener noreferrer"
          className="po-hebt inline-flex min-h-10 items-center gap-2 rounded-lg border border-[hsl(var(--profil-rand))] px-4 text-sm font-medium"
        >
          {branding.name} beitreten
          <ArrowUpRight className="size-3.5" aria-hidden="true" />
        </a>
      ) : (
        <Link
          href="/"
          className="po-hebt inline-flex min-h-10 items-center gap-2 rounded-lg border border-[hsl(var(--profil-rand))] px-4 text-sm font-medium"
        >
          {branding.name} entdecken
          <ArrowUpRight className="size-3.5" aria-hidden="true" />
        </Link>
      )}
    </footer>
  );
}

/**
 * Der Mitspieler-Status.
 *
 * ## Warum hier kein Kontaktweg steht
 *
 * Weil es keinen gibt, den wir oeffentlich anbieten duerfen. Die Spielersuche
 * ist ein internes Modul und verlangt eine Anmeldung; eine Discord-Kennung
 * herauszugeben, damit jemand von aussen schreiben kann, waere eine private
 * Angabe. Was bleibt, ist die Auskunft «diese Person sucht gerade Mitspieler»
 * und der Weg in die Community - dort findet man sie.
 *
 * `UNSET` ergibt nichts: «keine Angabe» ist keine Angabe.
 */
export function OeStatus({ angaben }: { angaben: Profil['angaben'] }): React.JSX.Element | null {
  const schluessel = angaben?.verfuegbarkeit.key;
  if (!schluessel || schluessel === 'UNSET') {
    return null;
  }
  const sucht = schluessel === 'LOOKING';

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
      style={
        sucht
          ? {
              backgroundColor: 'hsl(var(--profil-akzent) / 0.18)',
              color: 'hsl(var(--profil-akzent))',
            }
          : {
              border: '1px solid hsl(var(--profil-rand))',
              backgroundColor: 'hsl(var(--profil-flaeche) / 0.9)',
            }
      }
    >
      <CalendarDays className="size-3.5" aria-hidden="true" />
      {angaben.verfuegbarkeit.label}
    </span>
  );
}
