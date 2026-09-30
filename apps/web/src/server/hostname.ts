import 'server-only';
import { appUrl } from '@swisshub/config';

/**
 * Der Hostname dieser Installation.
 *
 * ## Wofuer
 *
 * Der Twitch-Player verlangt ihn als `parent`-Parameter: er entscheidet,
 * welche Seite den Player einbetten darf. Ohne ihn bleibt der Rahmen leer.
 *
 * ## Warum aus der Konfiguration und nie aus der Anfrage
 *
 * Weil ein `Host`-Header aus der Anfrage kommt und damit vom Aufrufer
 * gesetzt wird. Ein praeparierter Header waere ein `parent`, das wir selbst
 * in unsere Seite schreiben - und damit die Erlaubnis, sie irgendwo einzu-
 * betten.
 *
 * ## Warum hier und nicht je Modul
 *
 * Die Antwort auf «wie heisst dieser Server» ist eine, und sie stand in zwei
 * Dateien: einmal in `server/clips.ts` aus `appUrl`, einmal in der
 * Streamer-Profilseite aus `process.env.NEXT_PUBLIC_APP_URL` mit einem
 * eigenen Rueckfall. Zwei Herleitungen derselben Zeichenkette sind zwei
 * Gelegenheiten, dass eine davon `localhost` sagt, waehrend die andere es
 * richtig macht.
 */
export function hostnameDerApp(): string {
  try {
    return new URL(appUrl('/')).hostname;
  } catch {
    // Kein `NEXT_PUBLIC_APP_URL` - in der Entwicklung, und dort stimmt das.
    return 'localhost';
  }
}
