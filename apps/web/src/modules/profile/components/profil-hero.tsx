import { CalendarDays, Rocket, Sparkles } from 'lucide-react';
import type { profile } from '@swisshub/modules';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { LevelRing } from './level-ring';

/**
 * Der Profilkopf.
 *
 * ## Warum er ohne eigenes Banner nicht aermer aussieht
 *
 * Es gibt keinen «leeren» Zustand: fehlt ein hochgeladenes Bild, traegt eine
 * Bannervorlage die Flaeche - acht Verlaeufe, die fuer sich stehen und nicht
 * wie ein Platzhalter wirken. Ein graues Rechteck mit «kein Banner» waere
 * die naheliegende und die falsche Loesung.
 *
 * ## Warum der Discord-Name immer dasteht
 *
 * Der selbst gewaehlte Profilname steht **neben** ihm, nie an seiner Stelle.
 * Sonst koennte sich jemand hier «SwissHub Admin» nennen und in einem
 * fremden Profil als jemand anders auftreten.
 *
 * ## Mobil
 *
 * Keine verkleinerte Desktop-Fassung: auf dem Telefon liegt der Avatar ueber
 * dem Namen, der Levelring wandert neben den Namen statt an den rechten
 * Rand, und die Angaben darunter brechen um. Ab `sm` steht alles
 * nebeneinander.
 */
export function ProfilHero({ ansicht }: { ansicht: profile.ProfilAnsicht }): React.JSX.Element {
  const { identitaet, gestaltung, angaben, level } = ansicht;

  return (
    <header className="pr-auftritt overflow-hidden rounded-2xl border border-[hsl(var(--profil-rand))] bg-[hsl(var(--profil-flaeche))]">
      {/* Banner. Das Bild liegt als Ebene darueber, damit der Verlauf beim
          Laden bereits steht und keine graue Flaeche aufblitzt. */}
      <div
        className="relative h-28 w-full sm:h-40 lg:h-52"
        style={{ backgroundImage: gestaltung.bannerVerlauf }}
      >
        {gestaltung.bannerBild ? (
          /*
           * Die Route liefert das Bild mit Berechtigungspruefung aus;
           * `next/image` zoege es ueber den Optimierer und verlöre dabei die
           * Sitzung.
           */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={gestaltung.bannerBild}
            alt=""
            className="absolute inset-0 size-full object-cover"
            loading="lazy"
          />
        ) : null}
        {/* Nach unten abdunkeln: der Name darunter bleibt lesbar, egal wie
            hell das Bild an dieser Stelle ist. */}
        <div className="absolute inset-0 bg-gradient-to-t from-[hsl(var(--profil-flaeche))] via-[hsl(var(--profil-flaeche)/0.35)] to-transparent" />
        {/*
         * Hier stand eine Akzentlinie an der Bannerkante. Sie ist weg: der
         * Name ragt durch den negativen Rand genau dorthin, und die Linie lief
         * mitten durch die Schrift wie ein Durchstreichen. Der Verlauf des
         * Banners blendet ohnehin in die Fläche darunter über - die Kante
         * braucht keine zweite Markierung.
         */}
      </div>

      {/*
       * `relative` ist hier keine Kosmetik, sondern Malreihenfolge.
       *
       * Der Bannerkasten darüber ist positioniert und wird deshalb *nach*
       * allen nicht positionierten Geschwistern gezeichnet. Ohne `relative`
       * verschwindet genau der Teil des Namens hinter dem Banner, den der
       * negative Rand dort hineinzieht - und weil der Avatar intern selbst
       * positioniert ist, blieb er sichtbar und der Fehler sah nach einem
       * fehlenden Namen aus.
       */}
      <div className="relative px-4 pb-5 sm:px-6 sm:pb-6">
        <div className="-mt-10 flex flex-col gap-4 sm:-mt-14 sm:flex-row sm:items-end sm:gap-5">
          <div className="flex items-end gap-4">
            {/*
             * Avatar und Ring in einem Kasten.
             *
             * `flex` und nicht `block`: der Avatar ist ein Inline-Element,
             * und in einem Blockkasten entstuende unter ihm die Luecke fuer
             * die Grundlinie. Der Kasten waere dann hoeher als breit, und
             * `rounded-full` machte daraus ein Oval.
             *
             * Die Groesse steht als Variable und nicht als `size-20
             * sm:size-24`. Die Klassen verloren gegen das `style` im Avatar,
             * lautlos: auf dem Handy war er 96 Pixel gross, obwohl dort 80
             * gemeint waren - auf jedem Bildschirm derselbe Wert.
             */}
            <div
              className="flex rounded-full p-1 ring-2 ring-[hsl(var(--profil-akzent)/0.65)] [--avatar-size:80px] sm:[--avatar-size:96px]"
              style={{ backgroundColor: 'hsl(var(--profil-flaeche))' }}
            >
              <DiscordAvatar
                discordId={identitaet.discordId}
                avatarHash={identitaet.avatarHash}
                name={identitaet.discordName}
                size={96}
                ring={false}
              />
            </div>
            {level ? (
              <div className="sm:hidden">
                <LevelRing
                  level={level.level}
                  fortschritt={level.fortschritt}
                  hoechstlevel={level.hoechstlevel}
                  groesse={64}
                />
              </div>
            ) : null}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              {/* `h2` und nicht `h1`: das einzige `h1` der Anwendung steht in
                  `AppHeader`. Ein zweites wäre für Screenreader ein Fehler. */}
              {/*
               * Bis `text-3xl` und nicht weiter: ein Discord-Name darf 32
               * Zeichen haben, und bei `text-4xl` bricht er auf zwei Zeilen,
               * von denen die zweite aus einem einzelnen Buchstaben besteht.
               * Zwei Zeilen sind die Obergrenze - was danach käme, schöbe den
               * Kopf immer weiter ins Banner hinein.
               */}
              <h2 className="line-clamp-2 min-w-0 break-words text-2xl font-bold leading-tight sm:text-3xl">
                {identitaet.discordName}
              </h2>
              {identitaet.profilname ? (
                <span className="text-sm text-muted-foreground sm:text-base">«{identitaet.profilname}»</span>
              ) : null}
            </div>

            {angaben?.tagline ? (
              <p className="mt-1.5 max-w-prose break-words text-sm text-[hsl(var(--profil-akzent))] sm:text-base">
                {angaben.tagline}
              </p>
            ) : null}

            <ProfilMerkmale ansicht={ansicht} />
          </div>

          <div className="flex items-center gap-4 sm:flex-col sm:items-end sm:gap-3">
            {level ? (
              <div className="hidden sm:block">
                <LevelRing
                  level={level.level}
                  fortschritt={level.fortschritt}
                  hoechstlevel={level.hoechstlevel}
                />
              </div>
            ) : null}
            {/*
             * Hier standen «Profil teilen» und «Profil bearbeiten».
             *
             * Beide gab es nur im eigenen Profil - und das eigene Profil
             * wird intern nicht mehr mit dieser Komponente gezeichnet,
             * sondern als Mitgliedsakte. Uebrig blieben zwei Knoepfe, die
             * nie erschienen, und eine zweite Stelle, an der «Teilen»
             * haette richtig stehen muessen.
             *
             * Sie stehen jetzt in der Akte, wo man sein Profil nachschlaegt.
             * Diese Komponente zeichnet nur noch fremde und oeffentliche
             * Profile und braucht keine eigenen Aktionen mehr.
             */}
          </div>
        </div>
      </div>
    </header>
  );
}

/** Die Zeile unter dem Namen: Verfuegbarkeit, Spielart, Dabei-seit, Boost. */
function ProfilMerkmale({ ansicht }: { ansicht: profile.ProfilAnsicht }): React.JSX.Element {
  const { identitaet, angaben, level } = ansicht;

  const verfuegbar = angaben?.verfuegbarkeit.key !== 'UNSET' ? angaben?.verfuegbarkeit : null;

  return (
    <ul className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs sm:text-sm">
      {verfuegbar ? (
        <li className="inline-flex items-center gap-1.5 rounded-full bg-[hsl(var(--profil-akzent)/0.14)] px-2.5 py-1 font-medium text-[hsl(var(--profil-akzent))]">
          <span className="size-1.5 rounded-full bg-[hsl(var(--profil-akzent))]" aria-hidden="true" />
          {verfuegbar.label}
        </li>
      ) : null}
      {angaben?.spielart ? (
        <li className="rounded-full border border-[hsl(var(--profil-rand))] px-2.5 py-1 text-muted-foreground">
          {angaben.spielart}
        </li>
      ) : null}
      {identitaet.mitgliedSeit ? (
        <li className="inline-flex items-center gap-1.5 text-muted-foreground">
          <CalendarDays className="size-3.5" aria-hidden="true" />
          Dabei seit {identitaet.mitgliedSeit.toLocaleDateString('de-CH', { month: 'long', year: 'numeric' })}
        </li>
      ) : null}
      {identitaet.boostet ? (
        <li className="inline-flex items-center gap-1.5 text-[hsl(330_78%_68%)]">
          <Rocket className="size-3.5" aria-hidden="true" />
          Booster
        </li>
      ) : null}
      {level?.rang ? (
        <li className="inline-flex items-center gap-1.5 text-muted-foreground">
          <Sparkles className="size-3.5" aria-hidden="true" />
          Rang {level.rang}
        </li>
      ) : null}
      {identitaet.verlassen ? (
        <li className="rounded-full bg-muted px-2.5 py-1 text-muted-foreground">Nicht mehr auf dem Server</li>
      ) : null}
    </ul>
  );
}
