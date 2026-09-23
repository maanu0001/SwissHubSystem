import { ImageResponse } from 'next/og';
import { appUrl } from '@swisshub/config';
import { NextResponse } from 'next/server';
import { can } from '@swisshub/auth';
import { resolveGuildId } from '@swisshub/discord';
import { clips, isModuleEnabled } from '@swisshub/modules';
import { getActionAuthContext } from '@/server/auth';
import { enforceRateLimit } from '@/server/rate-limit';

/**
 * Die Karte zum Teilen.
 *
 * ## Warum sie der Server zeichnet
 *
 * Ein Screenshot ist bei jedem anders - andere Schrift, anderer Ausschnitt,
 * Browserleiste mittendrin. Eine gezeichnete Karte sieht ueberall gleich aus
 * und traegt die Marke, statt sie zufaellig zu streifen.
 *
 * ## Was darauf steht und was nicht
 *
 * Titel, Name, Woche, Stimmen. Kein Vorschaubild des Clips: es kaeme von
 * einem fremden Server, und `ImageResponse` muesste es dafuer abrufen. Genau
 * das soll dieser Dienst nicht tun - er holt keine Adresse, die ein Mitglied
 * eingegeben hat. Die Karte ist deshalb aus Farbe und Schrift gebaut.
 *
 * ## Zugang
 *
 * Wie jede andere Seite des Moduls: angemeldet, Mitglied, Leserecht. Sie
 * offen zugaenglich zu machen hiesse, den Namen eines Mitglieds unter einer
 * Adresse zu veroeffentlichen, die jeder erraten kann.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string }> },
): Promise<Response> {
  const context = await getActionAuthContext('cached');
  if (!context?.isMember) {
    return new NextResponse(null, { status: 401 });
  }
  if (!can(context, clips.CLIPS_PERMISSIONS.view)) {
    return new NextResponse(null, { status: 403 });
  }
  if (!(await isModuleEnabled(clips.CLIPS_MODULE_ID))) {
    return new NextResponse(null, { status: 404 });
  }

  await enforceRateLimit('clipShare', context.user.discordId);

  const { key } = await params;
  const guildId = await resolveGuildId();
  const runde = await clips.rundeNachSchluessel(guildId, decodeURIComponent(key));
  if (!runde || runde.status !== 'COMPLETED') {
    return new NextResponse(null, { status: 404 });
  }

  const [gewinner] = await clips.siegertreppchen(runde.id, 1);
  if (!gewinner) {
    return new NextResponse(null, { status: 404 });
  }

  const { jahr, woche } = clips.ausSchluessel(runde.key);
  // Die Adresse der Installation, nicht eine hier eingetragene: wer die
  // Anwendung unter einem anderen Namen betreibt, bekommt seinen eigenen.
  const adresse = new URL(appUrl('/')).host;
  const name = gewinner.einreicher.displayName ?? gewinner.einreicher.username ?? 'Unbekannt';
  const stimmen = gewinner.stimmen ?? 0;

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: 72,
        background: 'linear-gradient(135deg, #12090a 0%, #1c0c0e 55%, #2a0d11 100%)',
        color: '#f5f1f1',
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ width: 14, height: 14, borderRadius: 999, background: '#83060a' }} />
        <div style={{ fontSize: 26, letterSpacing: 4, textTransform: 'uppercase', color: '#c9b9ba' }}>
          SwissHub · Clip of the Week
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div style={{ fontSize: 30, color: '#e0a83a' }}>
          Woche {woche}/{jahr} · Runde #{runde.number}
        </div>
        <div style={{ fontSize: 68, lineHeight: 1.1, fontWeight: 700 }}>{kuerze(gewinner.titel, 70)}</div>
        <div style={{ fontSize: 38, color: '#c9b9ba' }}>von {kuerze(name, 40)}</div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '14px 28px',
            borderRadius: 999,
            background: '#83060a',
            fontSize: 32,
            fontWeight: 600,
          }}
        >
          {stimmen} {stimmen === 1 ? 'Stimme' : 'Stimmen'}
        </div>
        <div style={{ fontSize: 26, color: '#8d7f80' }}>{adresse}</div>
      </div>
    </div>,
    { width: 1200, height: 630 },
  );
}

/** Lange Titel enden mit einem Auslassungszeichen statt ausserhalb des Bildes. */
function kuerze(text: string, laenge: number): string {
  return text.length <= laenge ? text : `${text.slice(0, laenge - 1).trimEnd()}…`;
}
