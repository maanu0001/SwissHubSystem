import { ImageResponse } from 'next/og';
import { NextResponse } from 'next/server';
import { appUrl } from '@swisshub/config';
import { can } from '@swisshub/auth';
import { prisma } from '@swisshub/database';
import { resolveGuildId } from '@swisshub/discord';
import { isModuleEnabled, wrapped } from '@swisshub/modules';
import { getActionAuthContext } from '@/server/auth';
import { enforceRateLimit } from '@/server/rate-limit';
import {
  dateiname,
  zeichneKarte,
  KARTEN_MASSE,
  type KartenFormat,
  type KartenSeite,
} from '@/modules/wrapped/share-karte';
import type { WrappedDaten } from '@swisshub/modules/wrapped/daten';

/**
 * Die eigene Karte zum Teilen.
 *
 * ## Wessen Karte
 *
 * Ausschliesslich die eigene. Die Kennung kommt aus der Anmeldung, nicht
 * aus der Adresse - es gibt keinen Weg, die Karte einer anderen Person zu
 * erzeugen, auch nicht mit Verwaltungsrechten. Wer die Adresse errät,
 * bekommt seine eigene Karte oder eine 404.
 *
 * ## Warum angemeldet und nicht offen
 *
 * Auf der Karte steht der Name eines Mitglieds. Eine offene Adresse waere
 * eine Veroeffentlichung dieses Namens unter einer erratbaren Adresse.
 * Wer die Karte weitergeben will, laedt sie herunter und verschickt das
 * Bild - dann ist es seine Entscheidung und nicht die der Anwendung.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FORMATE = new Set<KartenFormat>(['uebersicht', 'mates', 'archetyp']);
const SEITEN = new Set<KartenSeite>(['story', 'quadrat']);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
): Promise<Response> {
  const context = await getActionAuthContext('cached');
  if (!context?.isMember) {
    return new NextResponse(null, { status: 401 });
  }
  if (!can(context, wrapped.WRAPPED_PERMISSIONS.viewOwn)) {
    return new NextResponse(null, { status: 403 });
  }
  if (!(await isModuleEnabled(wrapped.WRAPPED_MODULE_ID))) {
    return new NextResponse(null, { status: 404 });
  }

  await enforceRateLimit('wrappedShare', context.user.discordId);

  const adresse = new URL(request.url);
  const format = adresse.searchParams.get('format') ?? 'uebersicht';
  const seite = adresse.searchParams.get('seite') ?? 'story';
  if (!FORMATE.has(format as KartenFormat) || !SEITEN.has(seite as KartenSeite)) {
    return new NextResponse(null, { status: 400 });
  }

  const { key } = await params;
  const guildId = await resolveGuildId();
  const campaign = await prisma.wrappedCampaign.findUnique({
    where: { guildId_key: { guildId, key: decodeURIComponent(key) } },
  });
  /*
   * Drei Bedingungen, und alle drei enden in einer 404.
   *
   * Nicht veroeffentlicht, Share Cards ausgeschaltet, keine eigene
   * Momentaufnahme - in allen drei Faellen gibt es diese Karte nicht. Ein
   * unterscheidender Fehlercode verriete, welcher Rueckblick wann existiert.
   */
  if (!campaign || campaign.status !== 'PUBLISHED' || !campaign.shareCardsEnabled) {
    return new NextResponse(null, { status: 404 });
  }

  const momentaufnahme = await prisma.wrappedSnapshot.findUnique({
    where: { campaignId_discordId: { campaignId: campaign.id, discordId: context.user.discordId } },
  });
  if (!momentaufnahme) {
    return new NextResponse(null, { status: 404 });
  }

  const daten = momentaufnahme.data as unknown as WrappedDaten;
  const mass = KARTEN_MASSE[seite as KartenSeite];
  const name = daten.person.displayName ?? daten.person.username ?? 'mitglied';

  const bild = new ImageResponse(
    zeichneKarte({
      daten,
      format: format as KartenFormat,
      seite: seite as KartenSeite,
      jahr: campaign.displayYear,
      host: new URL(appUrl('/')).host,
    }),
    { width: mass.breite, height: mass.hoehe },
  );

  const antwort = new NextResponse(bild.body, bild);
  antwort.headers.set(
    'content-disposition',
    `attachment; filename="${dateiname(campaign.displayYear, name, format as KartenFormat)}"`,
  );
  // Die Karte gehoert genau einer Person. Ein Zwischenspeicher, der sie
  // teilt, waere ein Datenleck - und ein oeffentlicher erst recht.
  antwort.headers.set('cache-control', 'private, no-store');
  return antwort;
}
