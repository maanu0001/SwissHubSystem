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
import { GAMESERVER_INTEGRATION_ID, hasSecret } from '@swisshub/secrets';
import { getModuleSettings, isModuleEnabled } from '../module-state';
import { TOURNAMENTS_MODULE_ID, type TournamentSettings } from '../tournaments/config';
import { anbieterTreiber } from './anbieter';
import { SIMULATION_TREIBER } from './anbieter-simulation';

const log = createLogger('gameserver:bereitschaft');

/** Was fehlt, damit Matches automatisch einen Server bekommen. */
export type Luecke =
  | 'MODUL_AUS'
  | 'FUNKTION_AUS'
  | 'KEIN_ANBIETER'
  | 'ANBIETER_AUS'
  | 'TREIBER_FEHLT'
  | 'KEINE_ZUGANGSDATEN'
  | 'KEIN_TEMPLATE'
  | 'KEIN_PROFIL';

export interface KonfigurationsStand {
  /** Laeuft die Bereitstellung? Nur dann entstehen Maschinen. */
  bereit: boolean;
  /**
   * Alles, was fehlt - nicht nur das Erste.
   *
   * Wer eine Liste bekommt, richtet in einem Durchgang ein. Wer immer nur
   * den naechsten Mangel erfaehrt, braucht fuenf Anlaeufe.
   */
  luecken: Luecke[];
  /** Arbeitet nur ein Simulationstreiber? Dann entstehen keine echten Maschinen. */
  nurSimulation: boolean;
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
  nurSimulation: false,
  ermittelt: false,
};

/**
 * Der Stand - ohne je zu werfen.
 *
 * Fail closed: was sich nicht ermitteln laesst, gilt als nicht bereit. Eine
 * Bereitstellung, die auf einer Vermutung anlaeuft, kostet Maschinen.
 */
export async function konfigurationsStand(): Promise<KonfigurationsStand> {
  try {
    if (!(await isModuleEnabled(TOURNAMENTS_MODULE_ID))) {
      return { bereit: false, luecken: ['MODUL_AUS'], nurSimulation: false, ermittelt: true };
    }

    const settings = await getModuleSettings<TournamentSettings>(TOURNAMENTS_MODULE_ID);
    const luecken: Luecke[] = [];

    if (!settings.gameserverEnabled) {
      luecken.push('FUNKTION_AUS');
    }

    const anbieter = await prisma.gameServerProvider.findMany({
      select: { id: true, driver: true, enabled: true },
    });

    if (anbieter.length === 0) {
      luecken.push('KEIN_ANBIETER');
    } else {
      const aktive = anbieter.filter((eintrag) => eintrag.enabled);
      if (aktive.length === 0) {
        luecken.push('ANBIETER_AUS');
      }
      const mitTreiber = aktive.filter((eintrag) => anbieterTreiber(eintrag.driver) !== undefined);
      if (aktive.length > 0 && mitTreiber.length === 0) {
        luecken.push('TREIBER_FEHLT');
      }
    }

    /*
     * Zugangsdaten braucht nur, wer einen echten Anbieter betreibt.
     *
     * Der Simulationstreiber spricht kein Datacenter an - von ihm
     * Zugangsdaten zu verlangen hiesse, beim Einrichten eine Huerde
     * aufzubauen, die nichts absichert.
     */
    const echteAktive = anbieter.filter(
      (eintrag) => eintrag.enabled && eintrag.driver !== SIMULATION_TREIBER,
    );
    const nurSimulation = anbieter.length > 0 && echteAktive.length === 0;

    if (echteAktive.length > 0 && !(await hasSecret(GAMESERVER_INTEGRATION_ID, 'secret'))) {
      luecken.push('KEINE_ZUGANGSDATEN');
    }

    const [templates, profile] = await Promise.all([
      prisma.gameServerTemplate.count({ where: { enabled: true } }),
      prisma.gameProfile.count({ where: { enabled: true } }),
    ]);
    if (templates === 0) {
      luecken.push('KEIN_TEMPLATE');
    }
    if (profile === 0) {
      luecken.push('KEIN_PROFIL');
    }

    return { bereit: luecken.length === 0, luecken, nurSimulation, ermittelt: true };
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
  KEIN_ANBIETER: { text: 'Es ist kein Anbieter eingerichtet.', wo: 'Turniere → Gameserver → Infrastruktur' },
  ANBIETER_AUS: { text: 'Kein Anbieter ist aktiv.', wo: 'Turniere → Gameserver → Infrastruktur' },
  TREIBER_FEHLT: {
    text: 'Für den eingetragenen Anbieter gibt es keinen Treiber.',
    wo: 'Turniere → Gameserver → Infrastruktur',
  },
  KEINE_ZUGANGSDATEN: {
    text: 'Für das Datacenter sind keine Zugangsdaten hinterlegt.',
    wo: 'System → Integrationen → Virtual Datacenter',
  },
  KEIN_TEMPLATE: { text: 'Es gibt kein aktives Server-Template.', wo: 'Turniere → Gameserver → Templates' },
  KEIN_PROFIL: { text: 'Es gibt kein aktives Game Profile.', wo: 'Turniere → Gameserver → Game Profiles' },
};
