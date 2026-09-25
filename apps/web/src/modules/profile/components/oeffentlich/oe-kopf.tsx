import { CalendarDays, Rocket } from 'lucide-react';
import type { profile } from '@swisshub/modules';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { OeAbzeichen } from './oe-bausteine';

/**
 * Der Kopf der oeffentlichen Profilseite.
 *
 * ## Was ihn vom internen Kopf unterscheidet
 *
 * Alles ausser den Daten. Der interne Kopf ist eine Karte in einem
 * Dashboard: fester Rand, feste Hoehe, Levelring rechts. Dieser hier ist
 * eine **Buehne** - das Banner fuellt die Breite, der Avatar liegt darin
 * statt darunter, und der Name steht gross davor.
 *
 * Zwei Komponenten statt einer, weil es zwei Fragen sind: «zeige mir diese
 * Akte» und «zeige diese Person». Eine Komponente mit einem Schalter
 * dazwischen waere ein Kopf, der beides halb kann.
 *
 * ## Warum der Discord-Name immer dasteht
 *
 * Der selbst gewaehlte Profilname steht **neben** ihm, nie an seiner
 * Stelle. Sonst koennte sich jemand hier «SwissHub Admin» nennen und in
 * einem fremden Profil als jemand anders auftreten.
 *
 * ## Mobil
 *
 * Keine verkleinerte Desktop-Fassung. Auf dem Telefon steht der Avatar
 * ueber dem Namen und das Banner ist niedriger; ab `sm` liegen sie
 * nebeneinander. Die Schriftgroesse des Namens folgt `clamp` und braucht
 * dafuer keinen Haltepunkt.
 */
export function OeKopf({ profil }: { profil: profile.OeffentlichesProfil }): React.JSX.Element {
  const { identitaet, gestaltung, angaben, level } = profil;
  const jahr = identitaet.mitgliedSeit?.getFullYear() ?? null;

  return (
    <header className="po-kopf po-auftritt">
      {/*
        Das Banner.

        Der Verlauf steht sofort, das Bild legt sich darueber - so blitzt
        beim Laden keine graue Flaeche auf. Ein hochgeladenes Bild gewinnt
        immer: es ist eine Entscheidung, der Verlauf nur eine Vorgabe.
      */}
      <div className="po-banner" style={{ backgroundImage: gestaltung.bannerVerlauf }}>
        {gestaltung.bannerBild ? (
          /*
           * Die Route liefert das Bild selbst aus; `next/image` zoege es
           * ueber den Optimierer und verlöre dabei die Sitzung.
           */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={gestaltung.bannerBild}
            alt=""
            className="absolute inset-0 size-full object-cover"
            fetchPriority="high"
          />
        ) : null}
      </div>

      {/*
        Der Kopfblock ragt in das Banner hinein.

        `-mt-16` auf dem Telefon, `-mt-20` ab `sm` - so viel, dass der Avatar
        zur Haelfte im Banner liegt und der Name knapp darunter beginnt.
        `relative` ist noetig, weil das Banner darueber positioniert ist und
        sonst ueber den Namen gezeichnet wuerde.
      */}
      <div className="relative -mt-16 px-5 pb-6 sm:-mt-20 sm:px-8 sm:pb-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:gap-6">
          <div className={`po-avatar po-avatar-${gestaltung.buehne.avatar}`}>
            <DiscordAvatar
              discordId={identitaet.discordId}
              avatarHash={identitaet.avatarHash}
              name={identitaet.name}
              size={96}
              ring={false}
            />
          </div>

          <div className="min-w-0 flex-1 sm:pb-2">
            {angaben?.tagline ? <p className="po-titel mb-1.5">{angaben.tagline}</p> : null}
            <h1 className="po-name break-words">{identitaet.profilname ?? identitaet.name}</h1>
            {identitaet.profilname ? (
              <p className="mt-1 text-sm text-muted-foreground">@{identitaet.name}</p>
            ) : null}
          </div>
        </div>

        {/*
          Die Abzeichenzeile.

          Nur, was tatsaechlich da ist: kein «Level -», kein «Mitglied seit
          unbekannt». Eine Zeile, die Platzhalter zeigt, ist schlimmer als
          eine, die fehlt.
        */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {level ? (
            <OeAbzeichen symbol="Sparkles" betont>
              Level {level.level}
            </OeAbzeichen>
          ) : null}
          {jahr ? (
            <OeAbzeichen>
              <CalendarDays className="size-3.5" aria-hidden="true" />
              Dabei seit {jahr}
            </OeAbzeichen>
          ) : null}
          {identitaet.boostet ? (
            <OeAbzeichen>
              <Rocket className="size-3.5" aria-hidden="true" />
              Server-Booster
            </OeAbzeichen>
          ) : null}
          {(angaben?.plattformen ?? []).slice(0, 3).map((plattform) => (
            <OeAbzeichen key={plattform}>{plattform}</OeAbzeichen>
          ))}
        </div>
      </div>
    </header>
  );
}
