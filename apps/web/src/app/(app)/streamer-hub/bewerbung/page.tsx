import type { Metadata } from 'next';
import { TWITCH_INTEGRATION_ID, hasSecret } from '@swisshub/secrets';
import { streamer } from '@swisshub/modules';
import { PageHeader } from '@/components/shared/page-header';
import { ModulNavigation } from '@/components/shared/modul-navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { hostnameDerApp } from '@/server/hostname';
import { streamerNavigation } from '@/modules/streamer/navigation';
import { BewerbungsFormular } from '@/modules/streamer/components/bewerbungs-formular';
import { VitrineEditor } from '@/modules/streamer/components/vitrine-editor';

export const metadata: Metadata = { title: 'Meine Bewerbung' };
export const dynamic = 'force-dynamic';

/**
 * «Streamer werden» - die eigene Bewerbung.
 *
 * ## Warum hier keine fremde Bewerbung zu sehen ist
 *
 * Weil es keinen Parameter gibt, mit dem man eine andere waehlen koennte.
 * `meineBewerbung(context.user.discordId)` - die Kennung kommt aus der
 * Sitzung, und derselbe Weg gilt in der Server Action. Eine fremde Bewerbung zu
 * bearbeiten ist damit keine Frage der Berechtigung, sondern unmoeglich.
 *
 * ## Die Rueckmeldung aus dem OAuth-Rueckweg
 *
 * Twitch schickt den Browser hierher zurueck, mit einem Vermerk in der Adresse.
 * Die Meldungen sind kurz und benannt - kein durchgereichter Fehlertext von
 * Twitch, den niemand deuten kann.
 */
const TWITCH_MELDUNG: Record<string, { art: 'gut' | 'schlecht'; text: string }> = {
  bestaetigt: {
    art: 'gut',
    text: 'Dein Twitch-Kanal ist bestätigt - Twitch hat uns gesagt, dass er dir gehört.',
  },
  abgebrochen: { art: 'schlecht', text: 'Du hast die Anmeldung bei Twitch abgebrochen.' },
  'sitzung-abgelaufen': {
    art: 'schlecht',
    text: 'Die Prüfung ist abgelaufen oder passte nicht zu deiner Sitzung. Versuche es noch einmal.',
  },
  'kein-code': { art: 'schlecht', text: 'Twitch hat keinen Bestätigungscode geschickt.' },
  'twitch-nicht-erreichbar': {
    art: 'schlecht',
    text: 'Twitch war gerade nicht erreichbar. Versuche es später noch einmal.',
  },
  'nicht-eingerichtet': {
    art: 'schlecht',
    text: 'Die Twitch-Bestätigung ist auf diesem Server nicht eingerichtet. Das Team gibt deinen Kanal von Hand frei.',
  },
};

export default async function MeineBewerbungSeite({
  searchParams,
}: {
  searchParams: Promise<{ twitch?: string }>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission(streamer.STREAMER_PERMISSIONS.apply);
  const csrfToken = csrfTokenFor(context);
  const { twitch } = await searchParams;

  const [bewerbung, twitchEingerichtet, vitrine] = await Promise.all([
    streamer.meineBewerbung(context.user.discordId),
    hasSecret(TWITCH_INTEGRATION_ID, 'clientSecret').catch(() => false),
    /*
     * Die Vitrine - nur fuer einen freigegebenen Streamer gefuellt.
     *
     * `ladeVitrine` entscheidet das selbst und gibt sonst eine leere zurueck.
     * Der Hostname geht mit, weil der Twitch-Player ihn braucht; hier wird er
     * nicht gebraucht, aber eine zweite Ladefunktion ohne ihn waere eine
     * zweite Stelle, an der die Vitrine gelesen wird.
     */
    streamer.ladeVitrine(context.user.discordId, hostnameDerApp()),
  ]);

  const meldung = twitch
    ? (TWITCH_MELDUNG[twitch] ?? {
        art: 'schlecht' as const,
        // Der Grund der Kanalabweichung steht hinter einem Doppelpunkt - er ist
        // die einzige Meldung, die etwas Eigenes zu sagen hat.
        text: twitch.startsWith('nicht-bestaetigt:')
          ? twitch.slice('nicht-bestaetigt:'.length)
          : 'Die Bestätigung hat nicht geklappt.',
      })
    : null;

  return (
    <div className="flex flex-col gap-6">
      <ModulNavigation
        eintraege={streamerNavigation(context)}
        aktiv="bewerbung"
        label="Bereiche im Streamer Hub"
      />
      <PageHeader
        title="Meine Bewerbung"
        description="Deine Kanäle bei SwissHub eintragen - damit die Community dich findet."
      />

      {meldung ? (
        <Card className={meldung.art === 'gut' ? 'border-success/40' : 'border-destructive/40'}>
          <CardHeader>
            <CardTitle className={meldung.art === 'gut' ? 'text-success' : 'text-destructive'}>
              {meldung.art === 'gut' ? 'Kanal bestätigt' : 'Bestätigung nicht abgeschlossen'}
            </CardTitle>
            <CardDescription>{meldung.text}</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {bewerbung?.status === 'APPROVED' ? (
        <Card className="border-success/30">
          <CardHeader>
            <CardTitle className="text-success">Du bist freigegeben</CardTitle>
            <CardDescription>
              Du erscheinst auf der öffentlichen Streamer-Seite. Änderungen an Beschreibung, Sprachen und
              Ankündigungen wirken sofort.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Damit deine Seite erreichbar ist, muss dein SwissHub-Profil öffentlich stehen - sonst gibt es
            keine Adresse, auf die eine Karte verweisen könnte.
          </CardContent>
        </Card>
      ) : null}

      {/*
        Die Vitrine - nur für Freigegebene.

        Nicht aus Strenge, sondern weil es sonst ein Formular wäre, das auf
        eine Seite einzahlt, die es noch nicht gibt. `setzeVitrineClip` weist
        eine offene Bewerbung ohnehin ab; das hier ist die Höflichkeit dazu.
      */}
      {bewerbung?.status === 'APPROVED' ? (
        <VitrineEditor
          csrfToken={csrfToken}
          plaetze={streamer.MAX_VITRINE_CLIPS}
          maxCaptionLaenge={streamer.MAX_CAPTION_LAENGE}
          caption={vitrine.caption ?? ''}
          belegt={vitrine.clips.map((clip) => ({
            position: clip.position,
            provider: clip.provider,
            canonicalUrl: clip.canonicalUrl,
            titel: clip.titel,
          }))}
        />
      ) : null}

      <BewerbungsFormular
        csrfToken={csrfToken}
        status={bewerbung?.status ?? 'KEINE'}
        beschreibung={bewerbung?.beschreibung ?? ''}
        sprachen={bewerbung?.sprachen ?? []}
        ankuendigungAktiv={bewerbung?.ankuendigungAktiv ?? true}
        ablehnungsGrund={bewerbung?.ablehnungsGrund ?? null}
        twitchEingerichtet={twitchEingerichtet}
        kanaele={(bewerbung?.kanaele ?? []).map((kanal) => ({
          plattform: kanal.plattform,
          handle: kanal.handle,
          verifikation: kanal.verifikation,
        }))}
      />
    </div>
  );
}
