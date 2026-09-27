import { ImageResponse } from 'next/og';
import { NextResponse } from 'next/server';
import { appUrl } from '@swisshub/config';
import { branding } from '@swisshub/config/client';
import { getDiscordAvatarUrl } from '@swisshub/discord/cdn';
import { profile } from '@swisshub/modules';
import { hslFarbe } from '@/modules/profile/gamer-card';

/**
 * Die Vorschaukarte des oeffentlichen Profils.
 *
 * Sie erscheint, wenn jemand den Profil-Link auf Discord, WhatsApp, Telegram
 * oder anderswo einfuegt. Gezeichnet und nicht fotografiert: ein Screenshot
 * saehe bei jedem anders aus.
 *
 * ## Warum sie ohne Anmeldung geht - und trotzdem nichts preisgibt
 *
 * Sie liegt unter derselben Adresse wie die Seite, und die ist oeffentlich.
 * Was darauf steht, kommt deshalb aus demselben
 * `ladeOeffentlichesProfilOderSperre`: gibt es kein oeffentliches Profil unter
 * diesem Slug, ist es privat oder von der Moderation gesperrt, gibt es auch
 * keine Karte. Eine zweite Datenquelle waere eine zweite Stelle, an der ein
 * privates Feld durchrutschen koennte.
 *
 * Die Sichtbarkeit je Abschnitt gilt hier mit: fehlt das Level im DTO, steht
 * keines auf der Karte. Hier wird nichts geprueft - es ist schon entschieden.
 *
 * ## Warum jetzt doch ein Profilbild darauf ist
 *
 * Es stand einmal nicht darauf, mit dem Argument, dass `ImageResponse` es dann
 * von Discords CDN holen muesse. Das Argument gilt weiter - deshalb wird es
 * **hier** geholt, mit Zeitlimit und Typpruefung, und als Daten-URI
 * hereingereicht. Satori macht waehrend des Zeichnens keinen Netzaufruf.
 *
 * Scheitert der Abruf, zeigt die Karte die Anfangsbuchstaben wie vorher. Ein
 * Vorschaubild ohne Gesicht ist die haeufigste Ursache dafuer, dass niemand auf
 * einen geteilten Link klickt; das war den Umweg wert.
 *
 * ## Warum sie zum Theme passt
 *
 * Die Farben kommen aus `gestaltung.variablen` - derselben Registry, aus der
 * die Seite ihre Werte nimmt. Wer sein Theme wechselt, hat damit auch eine
 * andere Vorschaukarte. Zwei Farbwelten fuer dieselbe Person waeren zwei
 * Auftritte.
 */
export const runtime = 'nodejs';
/**
 * Fuenf Minuten.
 *
 * Social-Media-Crawler holen die Karte einmal und behalten sie lange - gegen
 * deren Zwischenspeicher hilft kein Wert hier, sondern nur ein anderer
 * Parameter in der Adresse. Der Wert bremst die uebrigen Aufrufe: jede Karte
 * kostet ein Rastern in 1200 x 630.
 *
 * Nach einer Profilaenderung wird die Route ausdruecklich neu geladen -
 * `neuLaden` in `profil-aktionen.ts` nennt sie beim Namen.
 */
export const revalidate = 300;

const BILD_ZEITLIMIT_MS = 4000;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const antwort = await profile.ladeOeffentlichesProfilOderSperre(slug);
  if (antwort.art !== 'profil') {
    return new NextResponse(null, { status: 404 });
  }
  const oeffentlich = antwort.profil;

  const name = oeffentlich.identitaet.profilname ?? oeffentlich.identitaet.name;
  const zeile = oeffentlich.angaben?.tagline ?? null;
  const level = oeffentlich.level;
  const spiele = (oeffentlich.spiele ?? []).slice(0, 3).map((eintrag) => eintrag.name);
  const adresse = new URL(appUrl('/')).host;

  const akzent = hslFarbe(oeffentlich.gestaltung.variablen['--profil-akzent'], '#e63a41');
  const flaeche = hslFarbe(oeffentlich.gestaltung.variablen['--profil-flaeche'], '#15141a');
  const rand = hslFarbe(oeffentlich.gestaltung.variablen['--profil-rand'], '#2b2830');

  const bild = await holeBild(
    getDiscordAvatarUrl(oeffentlich.identitaet.discordId, oeffentlich.identitaet.avatarHash, 256),
  );

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: 72,
        backgroundColor: flaeche,
        backgroundImage: oeffentlich.gestaltung.bannerVerlauf,
        color: '#f5f1f1',
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ display: 'flex', width: 14, height: 14, borderRadius: 999, backgroundColor: akzent }} />
        {/* Grossschreibung in JavaScript - `text-transform` laesst Satori
              scheitern, und heraus kaeme eine leere Datei. */}
        <div style={{ display: 'flex', fontSize: 26, letterSpacing: 4, color: '#c9b9ba' }}>
          {`${branding.name} · Profil`.toUpperCase()}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 40 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 170,
            height: 170,
            borderRadius: 999,
            backgroundColor: rand,
            border: `5px solid ${akzent}`,
            overflow: 'hidden',
          }}
        >
          {bild ? (
            /* eslint-disable-next-line @next/next/no-img-element -- Satori
                 kennt `next/image` nicht; hier wird ein PNG gezeichnet. */
            <img
              src={bild}
              alt=""
              width={170}
              height={170}
              style={{ width: 170, height: 170, objectFit: 'cover' }}
            />
          ) : (
            <div style={{ display: 'flex', fontSize: 62, fontWeight: 700, color: '#c9b9ba' }}>
              {initialen(name)}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', fontSize: 66, lineHeight: 1.05, fontWeight: 700 }}>
            {kuerze(name, 22)}
          </div>
          {zeile ? (
            <div style={{ display: 'flex', fontSize: 32, color: '#c9b9ba' }}>{kuerze(zeile, 54)}</div>
          ) : null}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          {level ? (
            <div
              style={{
                display: 'flex',
                padding: '14px 28px',
                borderRadius: 999,
                backgroundColor: akzent,
                fontSize: 30,
                fontWeight: 600,
                color: '#0b0b0d',
              }}
            >
              {level.hoechstlevel ? `Prestige · ${level.level}` : `Level ${level.level}`}
            </div>
          ) : null}
          {spiele.length > 0 ? (
            <div style={{ display: 'flex', fontSize: 28, color: '#c9b9ba' }}>
              {kuerze(spiele.join(' · '), 46)}
            </div>
          ) : null}
        </div>
        <div style={{ display: 'flex', fontSize: 26, color: '#8d7f80' }}>
          {adresse}/u/{kuerze(slug, 18)}
        </div>
      </div>
    </div>,
    { width: 1200, height: 630 },
  );
}

/**
 * Ein Bild von Discords CDN als Daten-URI - oder `null`.
 *
 * Mit Zeitlimit und ohne Wurf: eine Karte ohne Profilbild ist eine Karte, eine
 * Ausnahme mitten im Rendern ist ein 500er in einer Discord-Vorschau. Geprueft
 * wird zusaetzlich der gemeldete Typ - was kein Bild ist, wird nicht eingebettet.
 */
async function holeBild(url: string): Promise<string | null> {
  try {
    const antwort = await fetch(url, { signal: AbortSignal.timeout(BILD_ZEITLIMIT_MS) });
    if (!antwort.ok) {
      return null;
    }
    const typ = antwort.headers.get('content-type') ?? '';
    if (!typ.startsWith('image/')) {
      return null;
    }
    const daten = Buffer.from(await antwort.arrayBuffer());
    return `data:${typ};base64,${daten.toString('base64')}`;
  } catch {
    return null;
  }
}

/** Satori bricht nicht um - zu lange Texte muessen vorher enden. */
function kuerze(wert: string, grenze: number): string {
  return wert.length <= grenze ? wert : `${wert.slice(0, grenze - 1)}…`;
}

/**
 * Die Anfangsbuchstaben eines Namens.
 *
 * `Array.from` und nicht `slice`: ein Name, der mit einem Emoji beginnt, besteht
 * aus mehreren Code-Einheiten, und `slice(0, 2)` schnitte mitten hinein.
 */
function initialen(name: string): string {
  return Array.from(name.trim()).slice(0, 2).join('').toUpperCase() || '?';
}
