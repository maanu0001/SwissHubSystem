/**
 * Ist die Gameserver-Orchestrierung eingerichtet?
 *
 * ## Warum das eine eigene Datei ist
 *
 * Weil «nicht eingerichtet» der **Normalzustand** ist und kein Fehler. Ein
 * Turnier braucht keine Gameserver; die meisten werden nie welche haben. Die
 * Erweiterung muss deshalb genau eine Eigenschaft haben, und zwar ohne
 * Ausnahme: **sie darf nichts umbringen, wenn sie nicht konfiguriert ist.**
 *
 * Nicht die WebApp, nicht den Bot, nicht den Zeitplaner, nicht eine
 * bestehende Turnierseite. Eine fehlende Konfiguration ist eine Auskunft,
 * die in der Oberflaeche steht - kein Fehlerzustand, den jemand wegklicken
 * muss, und schon gar kein Absturz.
 *
 * ## Was sich mit den Hosts geaendert hat
 *
 * Frueher brauchte es einen Anbieter mit Zugangsdaten, denn jedes Match
 * bekam eine eigene Maschine. Heute braucht es einen **vorbereiteten Host**
 * - und der entsteht einmal von Hand. Die Compute-API des Datacenters ist
 * dafuer ausdruecklich **nicht** noetig; sie wird erst gebraucht, wenn
 * SwissHub selbst Hosts erzeugen soll, und das ist eine spaetere Ausbaustufe.
 *
 * Der Anbieter faellt deshalb aus dieser Pruefung heraus. Er bleibt im
 * System, aber er ist keine Voraussetzung mehr.
 *
 * ## Die Regel dieser Datei
 *
 * `konfigurationsStand()` wirft **nie**. Jede Abfrage darin ist einzeln
 * abgesichert; faellt die Datenbank aus, faellt der Geheimnisspeicher aus,
 * fehlt der Hauptschluessel - das Ergebnis ist immer ein lesbarer Stand und
 * niemals eine Ausnahme. Ein Test ruft sie gegen eine leere Datenbank auf
 * und prueft genau das.
 *
 * Das ist keine Bequemlichkeit. Diese Funktion wird von der Uebersicht, vom
 * Durchgang und von der Matchansicht aufgerufen - also auch von Stellen, an
 * denen Gameserver gar nicht das Thema sind. Wuerfe sie, naehme sie eine
 * Seite mit, die mit Gameservern nichts zu tun hat.
 */
import { prisma } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { hasMasterKey } from '@swisshub/secrets';
import { getModuleSettings, isModuleEnabled } from '../module-state';
import { TOURNAMENTS_MODULE_ID, type TournamentSettings } from '../tournaments/config';
import { hostGesundheit } from './hosts';

const log = createLogger('gameserver:bereitschaft');

/** Was fehlt, damit Matches automatisch einen Server bekommen. */
export type Luecke =
  | 'MODUL_AUS'
  | 'FUNKTION_AUS'
  | 'KEIN_HOST'
  | 'KEIN_HOST_BEREIT'
  | 'KEIN_ABBILD'
  | 'KEIN_PROFIL'
  | 'PROFIL_OHNE_ABBILD'
  | 'KEIN_SCHLUESSEL';

export interface KonfigurationsStand {
  /** Laeuft die Bereitstellung? Nur dann entstehen Instanzen. */
  bereit: boolean;
  /**
   * Alles, was fehlt - nicht nur das Erste.
   *
   * Wer eine Liste bekommt, richtet in einem Durchgang ein. Wer immer nur
   * den naechsten Mangel erfaehrt, braucht fuenf Anlaeufe.
   */
  luecken: Luecke[];
  /** Wie viele Hosts es gibt und wie viele davon Matches annehmen koennen. */
  hosts: number;
  hostsBereit: number;
  /**
   * Konnte der Stand ueberhaupt ermittelt werden?
   *
   * `false` heisst: die Datenbank war nicht erreichbar. Dann steht in der
   * Oberflaeche «unbekannt» und nicht «nicht eingerichtet» - das sind
   * verschiedene Dinge, und eines davon waere gelogen.
   */
  ermittelt: boolean;
}

const UNBEKANNT: KonfigurationsStand = {
  bereit: false,
  luecken: [],
  hosts: 0,
  hostsBereit: 0,
  ermittelt: false,
};

/**
 * Der Stand - ohne je zu werfen.
 *
 * Fail closed: was sich nicht ermitteln laesst, gilt als nicht bereit. Eine
 * Bereitstellung, die auf einer Vermutung anlaeuft, kostet Kapazitaet.
 */
export async function konfigurationsStand(jetzt = new Date()): Promise<KonfigurationsStand> {
  try {
    if (!(await isModuleEnabled(TOURNAMENTS_MODULE_ID))) {
      return { bereit: false, luecken: ['MODUL_AUS'], hosts: 0, hostsBereit: 0, ermittelt: true };
    }

    const settings = await getModuleSettings<TournamentSettings>(TOURNAMENTS_MODULE_ID);
    const luecken: Luecke[] = [];

    if (!settings.gameserverEnabled) {
      luecken.push('FUNKTION_AUS');
    }

    /*
     * Der Hauptschluessel zuerst, weil ohne ihn zwei Dinge nicht gehen:
     * die Identitaet eines Hosts laesst sich nicht lesen, und das
     * RCON-Passwort einer neuen Instanz nicht schreiben. Beides scheitert
     * sonst erst mitten in der Bereitstellung.
     */
    if (!hasMasterKey()) {
      luecken.push('KEIN_SCHLUESSEL');
    }

    const hosts = await prisma.gameServerHost.findMany({
      select: {
        id: true,
        status: true,
        registeredAt: true,
        lastHeartbeatAt: true,
        dockerAvailable: true,
        diskFreeMb: true,
        minFreeDiskGb: true,
        lastError: true,
        allowedGames: true,
      },
    });

    const bereiteHosts = hosts.filter(
      (host) => host.status === 'ACTIVE' && hostGesundheit(host, jetzt).wert === 'HEALTHY',
    );

    if (hosts.length === 0) {
      luecken.push('KEIN_HOST');
    } else if (bereiteHosts.length === 0) {
      luecken.push('KEIN_HOST_BEREIT');
    }

    const [abbilder, profile, profileMitAbbild] = await Promise.all([
      prisma.gameRuntimeImage.count({ where: { enabled: true } }),
      prisma.gameProfile.count({ where: { enabled: true } }),
      prisma.gameProfile.count({ where: { enabled: true, runtimeImageId: { not: null } } }),
    ]);

    if (abbilder === 0) {
      luecken.push('KEIN_ABBILD');
    }
    if (profile === 0) {
      luecken.push('KEIN_PROFIL');
    } else if (profileMitAbbild === 0) {
      luecken.push('PROFIL_OHNE_ABBILD');
    }

    return {
      bereit: luecken.length === 0,
      luecken,
      hosts: hosts.length,
      hostsBereit: bereiteHosts.length,
      ermittelt: true,
    };
  } catch (fehler) {
    /*
     * Hier endet jeder Fehler.
     *
     * `debug` und nicht `warn`: diese Funktion laeuft im Minutentakt, und
     * eine nicht erreichbare Datenbank meldet sich bereits an zehn anderen
     * Stellen. Eine elfte Warnung je Minute hilft niemandem.
     */
    log.debug('Konfigurationsstand nicht ermittelbar', { fehler });
    return UNBEKANNT;
  }
}

/** Was eine Luecke im Klartext heisst - und wo man sie schliesst. */
export const LUECKEN_TEXT: Record<Luecke, { text: string; wo: string }> = {
  MODUL_AUS: { text: 'Das Turniermodul ist ausgeschaltet.', wo: 'System → Module → Turniere' },
  FUNKTION_AUS: {
    text: 'Die Gameserver-Funktion ist ausgeschaltet.',
    wo: 'System → Module → Turniere',
  },
  KEIN_HOST: {
    text: 'Es ist noch kein Gameserver-Host eingerichtet.',
    wo: 'Turniere → Gameserver → Hosts',
  },
  KEIN_HOST_BEREIT: {
    text: 'Kein Host ist aktiv und erreichbar.',
    wo: 'Turniere → Gameserver → Hosts',
  },
  KEIN_ABBILD: {
    text: 'Es gibt kein aktives Runtime-Image.',
    wo: 'Turniere → Gameserver → Runtime-Images',
  },
  KEIN_PROFIL: { text: 'Es gibt kein aktives Game Profile.', wo: 'Turniere → Gameserver → Game Profiles' },
  PROFIL_OHNE_ABBILD: {
    text: 'Keinem aktiven Game Profile ist ein Runtime-Image zugeordnet.',
    wo: 'Turniere → Gameserver → Game Profiles',
  },
  KEIN_SCHLUESSEL: {
    text: 'MASTER_ENCRYPTION_KEY fehlt - ohne ihn lassen sich Host-Identität und RCON-Passwort nicht verarbeiten.',
    wo: 'Umgebung des Servers',
  },
};
