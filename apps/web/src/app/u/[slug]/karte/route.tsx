import { ImageResponse } from 'next/og';
import { NextResponse } from 'next/server';
import { appUrl } from '@swisshub/config';
import { profile } from '@swisshub/modules';

/**
 * Die Vorschaukarte des oeffentlichen Profils.
 *
 * Sie erscheint, wenn jemand den Profil-Link auf Discord, WhatsApp oder
 * anderswo einfuegt. Gezeichnet und nicht fotografiert: ein Screenshot
 * saehe bei jedem anders aus.
 *
 * ## Warum sie ohne Anmeldung geht - und trotzdem nichts preisgibt
 *
 * Sie liegt unter derselben Adresse wie die Seite, und die ist oeffentlich.
 * Was darauf steht, kommt deshalb aus demselben `ladeOeffentlichesProfil`:
 * gibt es kein oeffentliches Profil unter diesem Slug, gibt es auch keine
 * Karte. Eine zweite Datenquelle waere eine zweite Stelle, an der ein
 * privates Feld durchrutschen koennte.
 *
 * Kein Avatarbild darauf: `ImageResponse` muesste es von Discords CDN
 * holen, und ein Dienst, der beim Rendern fremde Adressen abruft, ist eine
 * Angriffsflaeche, die eine huebschere Karte nicht wert ist. Stattdessen
 * die Anfangsbuchstaben - dieselbe Loesung wie im Avatar selbst.
 */
export const runtime = 'nodejs';
export const revalidate = 300;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const oeffentlich = await profile.ladeOeffentlichesProfil(slug);
  if (!oeffentlich) {
    return new NextResponse(null, { status: 404 });
  }

  const name = oeffentlich.identitaet.profilname ?? oeffentlich.identitaet.name;
  const zeile = oeffentlich.angaben?.tagline ?? null;
  const level = oeffentlich.level;
  const spiele = (oeffentlich.spiele ?? []).slice(0, 3).map((eintrag) => eintrag.name);
  const adresse = new URL(appUrl('/')).host;
  const initialen = name.trim().slice(0, 2).toUpperCase() || '?';

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: 72,
        background: 'linear-gradient(135deg, #0f0b0c 0%, #1a0c0e 55%, #280d11 100%)',
        color: '#f5f1f1',
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ width: 14, height: 14, borderRadius: 999, background: '#83060a' }} />
        <div style={{ fontSize: 26, letterSpacing: 4, textTransform: 'uppercase', color: '#c9b9ba' }}>
          SwissHub · Profil
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
            background: '#1e1517',
            border: '5px solid #83060a',
            fontSize: 62,
            fontWeight: 700,
            color: '#c9b9ba',
          }}
        >
          {initialen}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 66, lineHeight: 1.05, fontWeight: 700 }}>{kuerze(name, 22)}</div>
          {zeile ? <div style={{ fontSize: 32, color: '#c9b9ba' }}>{kuerze(zeile, 54)}</div> : null}
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
                background: '#83060a',
                fontSize: 30,
                fontWeight: 600,
              }}
            >
              Level {level.level}
            </div>
          ) : null}
          {spiele.length > 0 ? (
            <div style={{ display: 'flex', fontSize: 28, color: '#c9b9ba' }}>
              {kuerze(spiele.join(' · '), 46)}
            </div>
          ) : null}
        </div>
        <div style={{ fontSize: 26, color: '#8d7f80' }}>
          {adresse}/u/{kuerze(slug, 18)}
        </div>
      </div>
    </div>,
    { width: 1200, height: 630 },
  );
}

/** Satori bricht nicht um - zu lange Texte muessen vorher enden. */
function kuerze(wert: string, grenze: number): string {
  return wert.length <= grenze ? wert : `${wert.slice(0, grenze - 1)}…`;
}
