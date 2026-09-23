import { ImageResponse } from 'next/og';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { appUrl } from '@swisshub/config';
import { can } from '@swisshub/auth';
import { prisma } from '@swisshub/database';
import { resolveGuildId } from '@swisshub/discord';
import { isModuleEnabled, wrapped } from '@swisshub/modules';
import { getActionAuthContext } from '@/server/auth';
import { enforceRateLimit } from '@/server/rate-limit';
import { baueVorschau } from '@/server/wrapped-vorschau';
import {
  zeichneKarte,
  KARTEN_MASSE,
  type KartenFormat,
  type KartenSeite,
} from '@/modules/wrapped/share-karte';

/**
 * Die Karte zum Teilen - im Studio, vor der Veroeffentlichung.
 *
 * ## Warum eine zweite Adresse
 *
 * Die Karte eines Mitglieds gibt es erst, wenn der Rueckblick
 * veroeffentlicht und die Momentaufnahme geschrieben ist. Beurteilen muss
 * man sie aber **vorher** - genau dafuer gibt es das Studio. Diese Adresse
 * zeichnet dieselbe Karte aus derselben lesenden Vorschau-Maschine.
 *
 * Dasselbe Bauteil, dieselbe Gestaltung: eine zweite Zeichnung waere eine
 * Vorschau auf etwas, das es nicht gibt.
 *
 * ## Was hier nicht passiert
 *
 * Nichts Schreibendes. `baueVorschau` liest, und diese Adresse tut sonst
 * nichts. Ohne `attachment`-Kopf: hier wird angesehen, nicht geladen.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const zahl = z.coerce.number().int().min(0);

const parameter = z.object({
  format: z.enum(['uebersicht', 'mates', 'archetyp']).default('uebersicht'),
  seite: z.enum(['story', 'quadrat']).default('story'),
  quelle: z.enum(['person', 'fixture']).default('fixture'),
  persona: z.string().trim().max(40).optional(),
  discordId: z
    .string()
    .trim()
    .regex(/^[0-9]{5,25}$/)
    .optional(),
  voiceSeconds: zahl.max(40_000_000).optional(),
  messages: zahl.max(5_000_000).optional(),
  activeDays: zahl.max(366).optional(),
  levelEnd: zahl.max(999).optional(),
  clipWins: zahl.max(999).optional(),
  primeTimeStunde: zahl.max(23).optional(),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const context = await getActionAuthContext('cached');
  if (!context?.isMember) {
    return new NextResponse(null, { status: 401 });
  }
  if (!can(context, wrapped.WRAPPED_PERMISSIONS.preview)) {
    return new NextResponse(null, { status: 403 });
  }
  if (!(await isModuleEnabled(wrapped.WRAPPED_MODULE_ID))) {
    return new NextResponse(null, { status: 404 });
  }

  await enforceRateLimit('wrappedShare', context.user.discordId);

  const gelesen = parameter.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()));
  if (!gelesen.success) {
    return new NextResponse(null, { status: 400 });
  }
  const eingabe = gelesen.data;

  const { id } = await params;
  const guildId = await resolveGuildId();
  const campaign = await prisma.wrappedCampaign.findUnique({ where: { id } });
  if (!campaign || campaign.guildId !== guildId) {
    return new NextResponse(null, { status: 404 });
  }

  const ueberschreibung: wrapped.FixtureUeberschreibung = {};
  for (const feld of [
    'voiceSeconds',
    'messages',
    'activeDays',
    'levelEnd',
    'clipWins',
    'primeTimeStunde',
  ] as const) {
    const wert = eingabe[feld];
    if (wert !== undefined) {
      ueberschreibung[feld] = wert;
    }
  }

  const ergebnis = await baueVorschau(campaign, {
    quelle: eingabe.quelle,
    discordId: eingabe.discordId ?? null,
    persona: eingabe.persona ?? wrapped.WRAPPED_PERSONAS[0]?.key ?? null,
    ...(Object.keys(ueberschreibung).length > 0 ? { ueberschreibung } : {}),
  });

  const mass = KARTEN_MASSE[eingabe.seite as KartenSeite];
  const bild = new ImageResponse(
    zeichneKarte({
      daten: ergebnis.daten,
      format: eingabe.format as KartenFormat,
      seite: eingabe.seite as KartenSeite,
      jahr: campaign.displayYear,
      host: new URL(appUrl('/')).host,
    }),
    { width: mass.breite, height: mass.hoehe },
  );

  const antwort = new NextResponse(bild.body, bild);
  antwort.headers.set('cache-control', 'private, no-store');
  return antwort;
}
