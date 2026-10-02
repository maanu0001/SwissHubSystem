import { registerModule, type ModuleDefinition } from '../registry';

/**
 * Social Media.
 *
 * ## Was das Modul loest
 *
 * Es gab vier Stellen, an denen SwissHub Grafiken fuer Instagram erzeugt, und
 * keine davon wusste von den anderen: das Content Studio von «SwissHub fragt»,
 * das Wrapped Studio unter System, das Spotlight-Studio im Streamer Hub und
 * die Teilen-Karte einer abgeschlossenen Clip-Runde. Wer am Sonntagabend etwas
 * posten wollte, musste wissen, dass es sie alle gibt und wo sie liegen.
 *
 * Dieses Modul ist der eine Ort, an dem man danach sucht. Es sagt, was gerade
 * zum Posten bereit ist, und fuehrt dorthin.
 *
 * ## Was es ausdruecklich **nicht** ist
 *
 * Es ist kein neues Exportsystem. Es zeichnet keine Grafik, es speichert keinen
 * Entwurf, es haelt keine Kopie einer Frage, eines Clips oder eines
 * Rueckblicks. Die fachliche Logik bleibt, wo sie hingehoert - in dem Modul,
 * dem die Daten gehoeren und das ihre Berechtigungen kennt. Dieses Modul liest
 * und verlinkt.
 *
 * Das ist nicht Bescheidenheit, sondern die Lehre aus der Alternative: ein
 * zweiter Ort, der Entwuerfe kennt, waere ein zweiter Ort, an dem ein Entwurf
 * anders aussieht als im Studio - und am Ende zwei Wahrheiten darueber, was
 * gepostet wurde.
 *
 * ## Warum ein Modul und nicht nur eine Seite
 *
 * Weil es abschaltbar sein soll. Ein Server, der nichts postet, braucht den
 * Bereich nicht - und soll ihn nicht in der Seitenleiste haben. Das ist genau
 * das, was das Modulsystem leistet, und ein hartcodierter Eintrag haette es
 * nicht.
 *
 * ## Berechtigungen
 *
 * Nur eine: den Bereich sehen. Alles, was man dort **tun** kann, liegt
 * woanders, und dort gelten weiterhin die Rechte des jeweiligen Moduls - das
 * Studio von «SwissHub fragt» verlangt `fragt.studio`, das Wrapped Studio
 * `wrapped.studio.view`. Dieser Bereich zeigt deshalb nur, was die jeweilige
 * Person auch oeffnen darf. Sichtbar ist nicht erlaubt, und umgekehrt: ein
 * Reiter, der auf 403 fuehrt, ist ein Versprechen, das die naechste Seite
 * bricht.
 */

export const SOCIAL_MEDIA_MODULE_ID = 'socialmedia';

export const SOCIAL_MEDIA_PERMISSIONS = {
  view: 'socialmedia.view',
} as const;

export const socialMediaModule: ModuleDefinition = registerModule({
  id: SOCIAL_MEDIA_MODULE_ID,
  name: 'Social Media',
  description:
    'Der zentrale Ort für alles, was auf Instagram landet: Fragen, Clips und Jahresrückblicke - gebündelt, aber dort bearbeitet, wo die Daten liegen.',
  icon: 'Megaphone',
  permissionPrefix: 'socialmedia',
  /*
   * Eingeschaltet, sobald es die anderen Module gibt.
   *
   * Anders als bei einem Modul mit eigenen Daten entsteht hier nichts, was man
   * erst einrichten muesste: der Bereich zeigt, was in den Ursprungsmodulen
   * ohnehin steht, und ist leer, solange dort nichts ist. Ein Schalter, den man
   * erst suchen muss, um eine Uebersicht zu sehen, waere die Umkehrung des
   * Zwecks.
   */
  defaultEnabled: true,
  permissions: [
    {
      key: SOCIAL_MEDIA_PERMISSIONS.view,
      label: 'Social Media ansehen',
      description:
        'Den Social-Media-Bereich öffnen. Was dort bearbeitet werden darf, entscheiden weiterhin die Rechte des jeweiligen Moduls.',
      module: SOCIAL_MEDIA_MODULE_ID,
    },
  ],
  navigation: [
    {
      href: '/social-media',
      label: 'Social Media',
      description: 'Fragen, Clips und Rückblicke zum Posten - an einem Ort',
      permission: SOCIAL_MEDIA_PERMISSIONS.view,
      icon: 'Megaphone',
      group: 'modules',
      /*
       * Direkt nach «SwissHub fragt» (26) und vor den uebrigen Modulen.
       *
       * Nicht bei System: es ist keine Verwaltung des Servers, sondern
       * woechentliche Arbeit - und sie liegt neben den Modulen, aus denen sie
       * sich speist.
       */
      order: 27,
      /*
       * Die Unterseiten gehoeren zur Kopfzeile dieses Eintrags.
       *
       * Ohne das stuende auf `/social-media/wrapped` kein Titel - der
       * laengste passende Praefix waere keiner.
       */
      titlePrefix: '/social-media',
    },
  ],
});
