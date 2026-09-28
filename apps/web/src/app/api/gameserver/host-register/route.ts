import { NextResponse, type NextRequest } from 'next/server';
import { createLogger } from '@swisshub/logger';
import { gameserver } from '@swisshub/modules';

export const dynamic = 'force-dynamic';

const log = createLogger('web:host-register');

/**
 * Wo ein Gameserver-Host sich einmalig anmeldet.
 *
 * ## Warum dieser Endpunkt oeffentlich ist
 *
 * Weil der Agent zu diesem Zeitpunkt noch keine Identitaet hat, mit der er
 * sich sonst ausweisen koennte. Das Registrierungs-Token **ist** hier die
 * ganze Berechtigung - und deshalb ist es einmalig, kurzlebig und in der
 * Datenbank nur als Hash vorhanden. Wer es hat, darf genau eines: einen
 * Host anmelden, der schon angelegt wurde.
 *
 * ## Was er nicht ist
 *
 * Kein Endpunkt, der einen Host **anlegt**. Der Host entsteht im Dashboard,
 * von einem Menschen mit der Berechtigung dafuer. Hier kann niemand einen
 * neuen erzeugen - es gibt keinen Zweig, der schreibt, wenn kein passendes
 * Token dasteht.
 *
 * ## Warum die Absage immer gleich klingt
 *
 * «Dieses Registrierungs-Token gilt nicht.» - egal ob es das Token nie gab,
 * ob es abgelaufen ist oder ob es schon verbraucht wurde. Drei
 * unterschiedliche Antworten waeren drei Auskuenfte an jemanden, der raet.
 */
export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  let roh: unknown;
  try {
    roh = await anfrage.json();
  } catch {
    return NextResponse.json({ error: 'Rumpf ist kein JSON.' }, { status: 400 });
  }

  const eingabe = (roh ?? {}) as Record<string, unknown>;
  const token = typeof eingabe.token === 'string' ? eingabe.token : '';

  const ergebnis = await gameserver
    .registriereHost(token, {
      agentVersion: typeof eingabe.agentVersion === 'string' ? eingabe.agentVersion : undefined,
      cpuCores: typeof eingabe.cpuCores === 'number' ? eingabe.cpuCores : undefined,
      memoryMb: typeof eingabe.memoryMb === 'number' ? eingabe.memoryMb : undefined,
      diskGb: typeof eingabe.diskGb === 'number' ? eingabe.diskGb : undefined,
      dockerAvailable: typeof eingabe.dockerAvailable === 'boolean' ? eingabe.dockerAvailable : undefined,
    })
    .catch((fehler: unknown) => {
      /*
       * Ein Fehler hier darf nicht als Stacktrace hinausgehen - der Aufrufer
       * ist per Definition nicht angemeldet. Er landet im Protokoll, und
       * nach aussen geht dieselbe Absage wie bei einem falschen Token.
       */
      log.warn('Registrierung fehlgeschlagen', { fehler });
      return { ok: false as const, grund: 'Dieses Registrierungs-Token gilt nicht.' };
    });

  if (!ergebnis.ok) {
    return NextResponse.json({ error: ergebnis.grund }, { status: 401, headers: NIE_ZWISCHENSPEICHERN });
  }

  return NextResponse.json(
    {
      // Das dauerhafte Token - **einmal**. Es steht danach nur noch
      // verschluesselt in der Datenbank und wird nie wieder ausgegeben.
      agentToken: ergebnis.agentToken,
      hostId: ergebnis.hostId,
      hostName: ergebnis.hostName,
    },
    { status: 200, headers: NIE_ZWISCHENSPEICHERN },
  );
}

const NIE_ZWISCHENSPEICHERN = { 'Cache-Control': 'no-store' } as const;
