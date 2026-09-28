/**
 * Wie ein Host einmalig zu seiner Identitaet kommt.
 *
 * ## Der Ablauf
 *
 *   1. Ein Admin legt den Host im SwissHub-Dashboard an und oeffnet die
 *      Registrierung. SwissHub zeigt ein Token - **einmal**.
 *   2. Das Token kommt als `SWISSHUB_REGISTRATION_TOKEN` in die Umgebung
 *      des Agenten, zusammen mit `SWISSHUB_URL`.
 *   3. Beim ersten Start meldet sich der Agent damit und bekommt ein
 *      dauerhaftes Token. Es landet in einer Datei mit Rechten 0600.
 *   4. Danach wird das Registrierungs-Token nicht mehr gebraucht und kann
 *      aus der Umgebung verschwinden - es gilt ohnehin nicht mehr.
 *
 * ## Warum der Agent die Datei selbst schreibt
 *
 * Damit das dauerhafte Token nirgends sonst liegt. Es steht nicht in der
 * Unit-Datei, nicht in einer Umgebungsdatei, die jemand in ein Repository
 * legt, und nicht in einem Protokoll. Ein Token, das an drei Stellen liegt,
 * ist an drei Stellen zu widerrufen.
 */
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface RegistrierungsUmgebung {
  /** Die Basisadresse von SwissHub, etwa `https://system.swisshub.gg`. */
  swisshubUrl: string;
  /** Wo das dauerhafte Token liegt. */
  tokenDatei: string;
  registrierungsToken: string | null;
  /** Was der Agent ueber sich meldet. */
  meldung: {
    agentVersion: string;
    cpuCores: number;
    memoryMb: number;
    diskGb: number;
    dockerAvailable: boolean;
  };
}

/** Der Pfad, unter dem SwissHub die Registrierung entgegennimmt. */
export const REGISTRIER_PFAD = '/api/gameserver/host-register';

export type Registrierung =
  { ok: true; token: string; hostId: string; hostName: string; neu: boolean } | { ok: false; grund: string };

/**
 * Das dauerhafte Token besorgen - aus der Datei oder durch Registrierung.
 *
 * Ohne Token startet der Agent nicht. Ein Agent ohne Token waere ein
 * offener Dienst auf einer Maschine mit einer oeffentlichen Adresse.
 */
export async function besorgeIdentitaet(
  umgebung: RegistrierungsUmgebung,
  holen: typeof fetch = fetch,
): Promise<Registrierung> {
  const vorhanden = await readFile(umgebung.tokenDatei, 'utf8').catch(() => null);
  if (vorhanden && vorhanden.trim().length >= 16) {
    return {
      ok: true,
      token: vorhanden.trim(),
      hostId: '',
      hostName: '',
      neu: false,
    };
  }

  if (!umgebung.registrierungsToken) {
    return {
      ok: false,
      grund:
        'Dieser Host ist nicht registriert und es liegt kein Registrierungs-Token vor. ' +
        'Im Dashboard unter Turniere → Gameserver → Hosts eines erzeugen und als ' +
        'SWISSHUB_REGISTRATION_TOKEN setzen.',
    };
  }

  const ziel = new URL(REGISTRIER_PFAD, umgebung.swisshubUrl).toString();

  let antwort: Awaited<ReturnType<typeof fetch>>;
  try {
    antwort = await holen(ziel, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: umgebung.registrierungsToken, ...umgebung.meldung }),
    });
  } catch (fehler) {
    return {
      ok: false,
      grund: `SwissHub ist unter ${umgebung.swisshubUrl} nicht erreichbar: ${
        fehler instanceof Error ? fehler.message : 'unbekannter Fehler'
      }`,
    };
  }

  const text = await antwort.text();
  if (antwort.status !== 200) {
    return { ok: false, grund: `SwissHub hat die Registrierung abgelehnt (${String(antwort.status)}).` };
  }

  let gelesen: { agentToken?: unknown; hostId?: unknown; hostName?: unknown };
  try {
    gelesen = JSON.parse(text) as typeof gelesen;
  } catch {
    return { ok: false, grund: 'SwissHub hat keine lesbare Antwort geschickt.' };
  }

  if (typeof gelesen.agentToken !== 'string' || gelesen.agentToken.length < 16) {
    return { ok: false, grund: 'SwissHub hat kein Token geschickt.' };
  }

  await mkdir(dirname(umgebung.tokenDatei), { recursive: true });
  await writeFile(umgebung.tokenDatei, `${gelesen.agentToken}\n`, 'utf8');
  // Erst schreiben, dann die Rechte enger ziehen - `writeFile` legt die
  // Datei mit der Standardmaske an, und die ist auf manchen Systemen 0644.
  await chmod(umgebung.tokenDatei, 0o600);

  return {
    ok: true,
    token: gelesen.agentToken,
    hostId: typeof gelesen.hostId === 'string' ? gelesen.hostId : '',
    hostName: typeof gelesen.hostName === 'string' ? gelesen.hostName : '',
    neu: true,
  };
}
