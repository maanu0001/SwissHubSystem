import { EyeOff } from 'lucide-react';
import type { profile } from '@swisshub/modules';
import { NavIcon } from '@/components/layout/nav-icon';
import { ProfilVitrine } from '../profil-vitrine';
import { OeAbschnitt, OeAbzeichen, OeMerkmale } from './oe-bausteine';
import {
  OeGaming,
  OeHervorgehobene,
  OeLevel,
  OeLinkAbschnitt,
  OeSwissHub,
  OeTurniere,
} from './oe-abschnitte';
import { OeKopf } from './oe-kopf';
import '../../profil-themes.css';
import '../../profil-oeffentlich.css';

/**
 * Die oeffentliche Profilseite.
 *
 * ## Warum es diese Datei neben `profil-ansicht.tsx` gibt
 *
 * Weil es zwei verschiedene Auftritte sind. `ProfilAnsicht` ist die
 * **interne** Darstellung - sie lebt neben Mitgliederakte, Moderation und
 * Dashboard und soll dorthin passen. Diese Seite hier ist das, was ein
 * Besucher sieht, der einem geteilten Link gefolgt ist: kein Dashboard,
 * keine Seitenleiste, keine Karten mit Ueberschriftzeile. Eine eigene Buehne.
 *
 * Der Versuch, beides aus einer Komponente zu bedienen, endet bei einer
 * Komponente mit einem Schalter - und die kann dann beides halb.
 *
 * **Dieselben Daten.** Was hier steht, kommt aus `ladeOeffentlichesProfil`,
 * und das hat die Privatsphaere-Regeln bereits angewendet: was nicht
 * freigegeben ist, fehlt im Objekt. Hier wird nichts mehr geprueft und
 * nichts mehr ausgeblendet - es waere zu spaet, die Daten stuenden dann
 * schon im HTML.
 *
 * ## Woher die Gestalt kommt
 *
 * Aus der Theme-Registry, als fuenf Schluessel: Anordnung, Kantenform,
 * Avatarauftritt, Muster, typografische Haltung. Sie werden hier zu
 * Klassennamen; was ein Klassenname bedeutet, steht in
 * `profil-oeffentlich.css`. Aus der Datenbank kommt eine Theme-Kennung und
 * sonst nichts - aus einer Profilspalte kann damit nie ein Stylesheet
 * werden.
 *
 * ## Woher die Reihenfolge kommt
 *
 * Aus `profil.abschnitte` - der Liste, die das Mitglied im Editor sortiert
 * hat. `ordneAbschnitte` hat sie schon bereinigt: jeder Abschnitt kommt genau
 * einmal vor, unbekannte Schluessel sind weg, fehlende hinten dazu. Diese Datei
 * geht die Liste durch und zeichnet, was es zu zeichnen gibt.
 *
 * Das ist **keine** Builder-Engine. Die Menge der Abschnitte ist fest, ihr
 * Inhalt kommt aus dem Profil, und was ein Abschnitt zeigt, entscheidet seine
 * Komponente - nicht die gespeicherte Liste. Verschieben laesst sich die
 * Reihenfolge und sonst nichts.
 *
 * ## Warum Abschnitte verschwinden statt leer dazustehen
 *
 * Ein Profil ohne Spiele zeigt keinen Spielekasten mit «keine». Was nicht
 * da ist, ist nicht da. Auf einer Seite, die jemand teilt, ist eine Reihe
 * leerer Kaesten kein Hinweis, sondern eine Blamage. Jede Abschnittskomponente
 * gibt deshalb `null` zurueck, wenn ihr Inhalt fehlt - und diese Datei zaehlt
 * am Ende, ob ueberhaupt etwas uebrig blieb.
 */
export function OeffentlicheProfilseite({
  profil,
  streaming,
}: {
  profil: profile.OeffentlichesProfil;
  /**
   * Der Streaming-Abschnitt, fertig gebaut - oder nichts.
   *
   * Als Knoten und nicht als Daten: dann weiss diese Datei nichts ueber
   * Streams, Plattformen oder Kanaele, und das Streamer-Modul bringt seinen
   * Abschnitt selbst mit. Wer ihn liefert, entscheidet die Seite; wer ihn
   * sehen darf, hat `ladeProfilStreaming` entschieden - dort sitzt auch der
   * Sichtbarkeitsschalter dieses Abschnitts.
   *
   * Der Grund fuer diese Richtung ist ein Modulzyklus: das Streamer-Modul liest
   * das Mitgliedsprofil (Banner, Spiele, Sprachen). Wuerde das Profilmodul
   * umgekehrt den Streamer Hub laden, zeigten beide aufeinander.
   */
  streaming?: React.ReactNode;
}): React.JSX.Element {
  /*
   * `socials` wird hier nicht mehr gezeichnet.
   *
   * Die Konten stehen im Link-in-Bio-Abschnitt - mit eigenem Titel,
   * Reihenfolge und Hervorhebung. Im DTO bleiben sie daneben, weil die
   * **interne** Ansicht sie im Steckbrief zeigt und die Vitrine einen Platz
   * «Gaming-Konto» kennt. Eine Zeile «Twitch: swisshub» und ein Knopf «Mein
   * Stream» sind zwei Darstellungen derselben Zeile, nicht zwei Datensaetze.
   */
  const { gestaltung, angaben, auszeichnungen, vitrine } = profil;
  const buehne = gestaltung.buehne;

  /*
   * Der Abstand der Auftritte.
   *
   * Von oben nach unten, in Schritten von achtzig Millisekunden. Mehr als
   * eine halbe Sekunde insgesamt wuerde sich nach Warten anfuehlen statt
   * nach Ankommen; deshalb wird bei sechs Abschnitten nicht weitergezaehlt.
   *
   * `prefers-reduced-motion` schaltet den Auftritt in `profil-oeffentlich.css`
   * ganz ab - die Verzoegerung bleibt dann ohne Wirkung, statt dass hier eine
   * zweite Entscheidung darueber getroffen wird.
   */
  let stufe = 0;
  const verzug = (): number => Math.min((stufe += 1), 6) * 80;

  /*
   * Die Abschnitte, in der Reihenfolge des Mitglieds.
   *
   * Gebaut wird **vor** dem Zaehlen: `null`-Abschnitte fallen heraus, und erst
   * die uebrigen bekommen ihre Verzoegerung. Andernfalls haette ein Profil ohne
   * Spiele eine Luecke im Rhythmus - sichtbar als Abschnitt, der spaeter
   * erscheint als der darunter.
   */
  const gezeichnet = profil.abschnitte
    .map((schluessel) => ({ schluessel, knoten: baue(schluessel) }))
    .filter((eintrag) => Boolean(eintrag.knoten));

  function baue(schluessel: string): React.ReactNode {
    switch (schluessel) {
      case 'streaming':
        return streaming ?? null;

      case 'ueber-mich':
        return angaben?.bio ? (
          <OeAbschnitt key="ueber-mich" titel="Über mich" verzug={0} className="po-breit">
            <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{angaben.bio}</p>
          </OeAbschnitt>
        ) : null;

      case 'gaming':
        return <OeGaming key="gaming" profil={profil} verzug={0} />;

      case 'links':
        return <OeLinkAbschnitt key="links" links={profil.links ?? []} verzug={0} />;

      case 'auszeichnungen':
        return auszeichnungen.length > 0 ? (
          <OeAbschnitt
            key="auszeichnungen"
            titel="Auszeichnungen"
            notiz={`${auszeichnungen.length}`}
            verzug={0}
          >
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(11.5rem,1fr))] gap-2.5">
              {auszeichnungen.map((auszeichnung) => (
                <li
                  key={auszeichnung.key}
                  className="po-hebt flex items-center gap-2.5 rounded-lg border border-[hsl(var(--profil-rand))] bg-[hsl(var(--profil-flaeche)/0.6)] px-3 py-2.5"
                  title={auszeichnung.beschreibung}
                >
                  <span
                    className="grid size-8 shrink-0 place-items-center rounded-md [&_svg]:size-4"
                    style={{
                      backgroundColor: 'hsl(var(--profil-akzent) / 0.16)',
                      color: 'hsl(var(--profil-akzent))',
                    }}
                    aria-hidden="true"
                  >
                    <NavIcon name={auszeichnung.symbol} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium">{auszeichnung.label}</span>
                    <span className="block text-[0.65rem] uppercase tracking-wide text-muted-foreground">
                      {auszeichnung.stufe}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </OeAbschnitt>
        ) : null;

      case 'vitrine':
        return vitrine.length > 0 ? (
          <div key="vitrine" className="po-breit">
            <ProfilVitrine karten={vitrine} verzug={0} />
          </div>
        ) : null;

      case 'level':
        return profil.level ? <OeLevel key="level" level={profil.level} verzug={0} /> : null;

      case 'turniere':
        return profil.turniere ? <OeTurniere key="turniere" turniere={profil.turniere} verzug={0} /> : null;

      case 'steckbrief':
        return hatSteckbrief(angaben) ? (
          <OeAbschnitt key="steckbrief" titel="Steckbrief" verzug={0}>
            <div className="grid gap-4 sm:grid-cols-2">
              <OeMerkmale titel="Sprachen" werte={angaben?.sprachen} />
              <OeMerkmale titel="Plattformen" werte={angaben?.plattformen} />
              <OeMerkmale titel="Spielzeiten" werte={angaben?.spielzeiten} />
              <OeMerkmale titel="Spielart" werte={angaben ? [angaben.spielart] : undefined} />
            </div>
          </OeAbschnitt>
        ) : null;

      default:
        /*
         * Unbekannter Schluessel.
         *
         * Kann eigentlich nicht vorkommen - `ordneAbschnitte` hat sie entfernt.
         * Er steht hier trotzdem, weil «eigentlich nicht» in einem `switch`
         * ohne Zweig ein stiller Absturz waere.
         */
        return null;
    }
  }

  const hatInhalt = gezeichnet.length > 0 || profil.hervorgehobene.length > 0;

  return (
    <div
      className={[
        'po',
        `po-${buehne.komposition}-layout`,
        `po-${buehne.kante}`,
        `po-${buehne.muster}`,
        `po-${buehne.schrift}`,
      ].join(' ')}
      style={gestaltung.variablen as React.CSSProperties}
      data-theme={gestaltung.theme}
    >
      {/*
        Die Kulisse des Themes - dieselbe wie in der internen Ansicht.

        Drei leere Lagen; was sie zeigen und wie sie sich bewegen, steht in
        `profil-themes.css`, ausgewaehlt ueber den Klassennamen.
        `aria-hidden`, weil sie nichts erzaehlt.
      */}
      <div className={`pt-kulisse ${gestaltung.kulisse}`} aria-hidden="true">
        <div className="pt-lage pt-lage-1" />
        <div className="pt-lage pt-lage-2" />
        <div className="pt-lage pt-lage-3" />
      </div>

      <OeKopf profil={profil} />

      {hatInhalt ? (
        <div className="po-inhalt mt-6">
          {/*
            Die drei hervorgehobenen Auszeichnungen stehen fest oben.

            Sie sind nicht sortierbar, und das ist Absicht: sie gehoeren zum
            Kopf und nicht zu den Abschnitten - eine Auszeichnungsreihe in der
            Mitte der Seite waere keine Hervorhebung mehr.
          */}
          <OeHervorgehobene auszeichnungen={profil.hervorgehobene} verzug={verzug()} />

          {gezeichnet.map(({ schluessel, knoten }) => (
            <VerzugHuelle key={schluessel} verzug={verzug()}>
              {knoten}
            </VerzugHuelle>
          ))}
        </div>
      ) : (
        /*
         * Ein Profil, das noch nichts erzaehlt.
         *
         * Kein Vorwurf und keine Aufforderung: der Besucher kann nichts
         * dafuer, und die Besitzerin liest das hier nicht. Ein Satz, der
         * die Seite abschliesst, statt sie offen zu lassen.
         */
        <p className="mt-8 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <EyeOff className="size-4" aria-hidden="true" />
          Dieses Profil erzählt noch nichts.
        </p>
      )}

      <OeSwissHub />
    </div>
  );
}

/**
 * Die Verzoegerung von aussen setzen.
 *
 * Die Abschnittskomponenten bekommen `verzug={0}`, weil ihre Position erst
 * feststeht, wenn die leeren herausgefallen sind. Diese Huelle traegt die
 * CSS-Variable - dieselbe, die `OeAbschnitt` selbst setzen wuerde. `display:
 * contents` heisst: sie nimmt am Raster nicht teil, `po-breit` des Kindes wirkt
 * weiter.
 *
 * Der Umweg ist die Alternative dazu, jeder Komponente ihre Nummer zu
 * uebergeben - was sie an eine Reihenfolge binden wuerde, die sie nicht kennt.
 */
function VerzugHuelle({
  verzug,
  children,
}: {
  verzug: number;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="contents" style={{ '--po-verzug': `${verzug}ms` } as React.CSSProperties}>
      {children}
    </div>
  );
}

/** Steht im Steckbrief ueberhaupt etwas? */
function hatSteckbrief(angaben: profile.OeffentlichesProfil['angaben']): boolean {
  return (
    (angaben?.sprachen?.length ?? 0) > 0 ||
    (angaben?.plattformen?.length ?? 0) > 0 ||
    (angaben?.spielzeiten?.length ?? 0) > 0
  );
}

/** Nur exportiert, damit die Seite die Abzeichen nicht selbst bauen muss. */
export { OeAbzeichen };
