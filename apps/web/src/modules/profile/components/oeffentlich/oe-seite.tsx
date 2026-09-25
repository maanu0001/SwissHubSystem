import { EyeOff, Link2 } from 'lucide-react';
import type { profile } from '@swisshub/modules';
import { NavIcon } from '@/components/layout/nav-icon';
import { ProfilSpiele } from '../profil-spiele';
import { ProfilVitrine } from '../profil-vitrine';
import { OeAbschnitt, OeAbzeichen, OeMerkmale } from './oe-bausteine';
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
 * ## Warum Abschnitte verschwinden statt leer dazustehen
 *
 * Ein Profil ohne Spiele zeigt keinen Spielekasten mit «keine». Was nicht
 * da ist, ist nicht da. Auf einer Seite, die jemand teilt, ist eine Reihe
 * leerer Kaesten kein Hinweis, sondern eine Blamage.
 */
export function OeffentlicheProfilseite({
  profil,
}: {
  profil: profile.OeffentlichesProfil;
}): React.JSX.Element {
  const { gestaltung, angaben, spiele, socials, auszeichnungen, vitrine } = profil;
  const buehne = gestaltung.buehne;

  const hatBio = Boolean(angaben?.bio);
  const hatMerkmale =
    (angaben?.sprachen?.length ?? 0) > 0 ||
    (angaben?.plattformen?.length ?? 0) > 0 ||
    (angaben?.spielzeiten?.length ?? 0) > 0;
  const hatSpiele = (spiele?.length ?? 0) > 0;
  const hatSocials = (socials?.length ?? 0) > 0;
  const hatAuszeichnungen = auszeichnungen.length > 0;

  /*
   * Ob ueberhaupt etwas unter dem Kopf steht.
   *
   * Ein Profil, das nur aus Name und Avatar besteht, bekommt keinen leeren
   * Inhaltsbereich mit Abstand darunter, sondern nur den Kopf. Das sieht
   * nach Absicht aus statt nach Fehler.
   */
  const hatInhalt = hatBio || hatMerkmale || hatSpiele || hatSocials || hatAuszeichnungen;

  /*
   * Der Abstand der Auftritte.
   *
   * Von oben nach unten, in Schritten von achtzig Millisekunden. Mehr als
   * eine halbe Sekunde insgesamt wuerde sich nach Warten anfuehlen statt
   * nach Ankommen; deshalb wird bei sechs Abschnitten nicht weitergezaehlt.
   */
  let stufe = 0;
  const verzug = (): number => Math.min((stufe += 1), 6) * 80;

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
          {hatBio ? (
            <OeAbschnitt titel="Über mich" verzug={verzug()} className="po-breit">
              <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                {angaben?.bio}
              </p>
            </OeAbschnitt>
          ) : null}

          {hatSpiele ? (
            <OeAbschnitt
              titel="Lieblingsspiele"
              notiz={`${spiele?.length ?? 0}`}
              verzug={verzug()}
              className="po-breit"
            >
              <ProfilSpiele spiele={spiele ?? []} />
            </OeAbschnitt>
          ) : null}

          {hatAuszeichnungen ? (
            <OeAbschnitt titel="Auszeichnungen" notiz={`${auszeichnungen.length}`} verzug={verzug()}>
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
          ) : null}

          {hatMerkmale ? (
            <OeAbschnitt titel="Steckbrief" verzug={verzug()}>
              <div className="grid gap-4 sm:grid-cols-2">
                <OeMerkmale titel="Sprachen" werte={angaben?.sprachen} />
                <OeMerkmale titel="Plattformen" werte={angaben?.plattformen} />
                <OeMerkmale titel="Spielzeiten" werte={angaben?.spielzeiten} />
              </div>
            </OeAbschnitt>
          ) : null}

          {hatSocials ? (
            <OeAbschnitt titel="Socials" verzug={verzug()}>
              <ul className="flex flex-wrap gap-2">
                {(socials ?? []).map((social) => (
                  <li key={`${social.plattform}-${social.handle}`}>
                    {social.adresse ? (
                      /*
                       * Fremde Adresse, fremdes Fenster.
                       *
                       * `noreferrer` zusaetzlich zu `noopener`: die
                       * Zielseite muss nicht erfahren, von welchem Profil
                       * jemand kam.
                       */
                      <a
                        href={social.adresse}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="po-hebt inline-flex items-center gap-2 rounded-lg border border-[hsl(var(--profil-rand))] px-3 py-2 text-sm"
                      >
                        <Link2 className="size-3.5 text-[hsl(var(--profil-akzent))]" aria-hidden="true" />
                        <span className="text-muted-foreground">{social.label}</span>
                        <span className="font-medium">{social.handle}</span>
                      </a>
                    ) : (
                      <span className="inline-flex items-center gap-2 rounded-lg border border-[hsl(var(--profil-rand))] px-3 py-2 text-sm">
                        <span className="text-muted-foreground">{social.label}</span>
                        <span className="font-medium">{social.handle}</span>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </OeAbschnitt>
          ) : null}

          {vitrine.length > 0 ? (
            <div className="po-breit">
              <ProfilVitrine karten={vitrine} verzug={verzug()} />
            </div>
          ) : null}
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
    </div>
  );
}

/** Nur exportiert, damit die Seite die Abzeichen nicht selbst bauen muss. */
export { OeAbzeichen };
