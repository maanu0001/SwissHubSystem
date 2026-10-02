import { NextResponse } from 'next/server';
import { can } from '@swisshub/auth';
import { prisma } from '@swisshub/database';
import { branding as brandingModule, workspace } from '@swisshub/modules';
import { getActionAuthContext } from '@/server/auth';

/**
 * Liefert einen Anhang aus dem Workspace aus.
 *
 * ## Warum die Berechtigung hier noch einmal geprüft wird
 *
 * Weil diese Route ein eigener Endpunkt ist. Die Seite, auf der das Bild steht,
 * verlangt `workspace.view` - aber eine Adresse ist keine Seite: wer sie
 * weitergibt, gibt sonst den Anhang an jeden weiter, der angemeldet ist. Das
 * Modul ist intern, und intern heisst auch hier intern.
 *
 * ## Warum der Content-Type nicht aus der Datei kommt
 *
 * Er wird fest gesetzt, abgeleitet aus der Endung, die beim Speichern aus dem
 * **erkannten** Inhalt entstand. Eine hochgeladene Datei kann dadurch niemals
 * als HTML oder Skript ausgeliefert werden. `nosniff` sagt dem Browser, dass
 * er es auch nicht erraten soll, und `attachment`-freies `inline` gilt nur,
 * weil es sich um ein Bild handelt.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ anhangId: string }> },
): Promise<Response> {
  const context = await getActionAuthContext('cached');
  if (!context?.isMember) {
    return new NextResponse(null, { status: 401 });
  }
  if (!can(context, workspace.WORKSPACE_PERMISSIONS.view)) {
    return new NextResponse(null, { status: 403 });
  }

  const { anhangId } = await params;

  const anhang = await prisma.workspaceAttachment.findUnique({
    where: { id: anhangId },
    select: { fileName: true },
  });
  if (!anhang) {
    return new NextResponse(null, { status: 404 });
  }

  const datei = await brandingModule.readUpload(anhang.fileName);
  if (!datei) {
    return new NextResponse(null, { status: 404 });
  }

  return new NextResponse(new Uint8Array(datei.data), {
    headers: {
      'Content-Type': brandingModule.CONTENT_TYPE[datei.format],
      // Der Dateiname ist zufällig und wird nie wiederverwendet - der Inhalt
      // unter dieser Adresse ändert sich also nicht.
      'Cache-Control': 'private, max-age=31536000, immutable',
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
