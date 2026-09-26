import { ImageResponse } from 'next/og';
import { NextResponse } from 'next/server';
import { can } from '@swisshub/auth';
import { fragt, isModuleEnabled, wrapped } from '@swisshub/modules';
import { createLogger } from '@swisshub/logger';
import { getActionAuthContext } from '@/server/auth';
import { enforceRateLimit } from '@/server/rate-limit';
import {
  SOCIAL_MASSE,
  folienDateiname,
  zeichneSocialFolie,
  type SocialFormat,
} from '@/modules/fragt/social-folie';
import { socialDaten } from '@/modules/fragt/daten';

const log = createLogger('web:fragt-zip');

/**
 * Das ganze Carousel als ZIP.
 *
 * ## Warum ein Archiv und nicht vier Downloads
 *
 * Weil ein Carousel eine Reihenfolge hat. Vier einzeln geladene Dateien liegen
 * im Downloadordner in der Reihenfolge, in der sie ankamen - und beim Hochladen
 * auf Instagram entscheidet die Reihenfolge, was zuerst zu sehen ist. Die
 * Dateinamen im Archiv sind durchnummeriert.
 *
 * ## Warum der ZIP-Schreiber von Wrapped
 *
 * Weil er schon da ist (`wrapped/zip.ts`), keine Abhaengigkeit mitbringt und
 * genau das kann, was hier gebraucht wird: ein paar PNG ohne Kompression in
 * ein Archiv legen. PNG ist bereits komprimiert; es ein zweites Mal durch
 * Deflate zu schicken kostet Rechenzeit und spart Promille.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FORMATE = new Set<SocialFormat>(['story', 'feed', 'quadrat']);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ entwurfId: string }> },
): Promise<Response> {
  const context = await getActionAuthContext('cached');
  if (!context?.isMember) {
    return new NextResponse(null, { status: 401 });
  }
  if (!can(context, fragt.FRAGT_PERMISSIONS.studio)) {
    return new NextResponse(null, { status: 403 });
  }
  if (!(await isModuleEnabled(fragt.FRAGT_MODULE_ID))) {
    return new NextResponse(null, { status: 404 });
  }

  await enforceRateLimit('wrappedShare', context.user.discordId);

  const format = new URL(request.url).searchParams.get('format') ?? 'feed';
  if (!FORMATE.has(format as SocialFormat)) {
    return new NextResponse(null, { status: 400 });
  }

  const { entwurfId } = await params;
  const quelle = await fragt.holeEntwurfsDaten(entwurfId);
  if (!quelle) {
    return new NextResponse(null, { status: 404 });
  }
  const daten = socialDaten(quelle);
  if (!daten) {
    return new NextResponse(null, { status: 409 });
  }

  const aktive = quelle.folien
    .filter((folie) => folie.aktiv)
    .sort((links, rechts) => links.position - rechts.position);

  if (aktive.length === 0) {
    // Ein leeres Archiv waere eine Datei, die nichts enthaelt und trotzdem
    // aussieht wie ein Erfolg.
    return new NextResponse(null, { status: 409 });
  }

  const mass = SOCIAL_MASSE[format as SocialFormat];
  const eintraege: Array<{ name: string; daten: Uint8Array }> = [];

  for (const [index, folie] of aktive.entries()) {
    /*
     * Eine Folie nach der anderen.
     *
     * Nicht parallel: jede `ImageResponse` rendert in einem eigenen
     * WASM-Kontext, und vier gleichzeitig sind vier Kontexte im Speicher eines
     * Containers, der auch die WebApp bedient. Vier Bilder nacheinander
     * brauchen eine Sekunde - das ist kein Grund fuer Parallelitaet.
     */
    const bild = new ImageResponse(
      zeichneSocialFolie({ art: folie.art, format: format as SocialFormat, daten }),
      { width: mass.breite, height: mass.hoehe },
    );
    const inhalt = new Uint8Array(await bild.arrayBuffer());
    if (inhalt.byteLength === 0) {
      log.error('Leeres PNG beim ZIP-Export', { entwurfId, art: folie.art, format });
      return new NextResponse(null, { status: 500 });
    }
    eintraege.push({ name: folienDateiname(index, folie.art, format as SocialFormat), daten: inhalt });
  }

  const archiv = wrapped.baueZip(eintraege);
  const stempel = quelle.abstimmung.closedAt ?? quelle.abstimmung.opensAt;
  const dateiname = `swisshub-fragt-${stempel.toISOString().slice(0, 10)}-${format}.zip`;

  return new NextResponse(new Uint8Array(archiv), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${dateiname}"`,
      'Content-Length': String(archiv.byteLength),
      'Cache-Control': 'no-store',
    },
  });
}
