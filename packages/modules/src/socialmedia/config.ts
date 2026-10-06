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
  /*
   * Die Rechte des Post Creators (§50).
   *
   * Getrennt und nicht eines: wer Posts gestalten darf, darf deshalb nicht
   * auch loeschen, und wer exportiert, muss nicht bearbeiten duerfen. Das ist
   * der Unterschied zwischen «darf mitarbeiten» und «darf aufraeumen».
   *
   * `postExport` ist ausdruecklich eigenes Recht: ein Export verlaesst das
   * System als Datei und ist der Schritt, nach dem etwas oeffentlich wird.
   */
  postView: 'socialmedia.posts.view',
  postCreate: 'socialmedia.posts.create',
  postEdit: 'socialmedia.posts.edit',
  postExport: 'socialmedia.posts.export',
  postDelete: 'socialmedia.posts.delete',
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
    {
      key: SOCIAL_MEDIA_PERMISSIONS.postView,
      label: 'Posts ansehen',
      description: 'Die Bibliothek des Post Creators öffnen und Posts anschauen.',
      module: SOCIAL_MEDIA_MODULE_ID,
    },
    {
      key: SOCIAL_MEDIA_PERMISSIONS.postCreate,
      label: 'Posts erstellen',
      description: 'Neue Posts aus einer Vorlage anlegen.',
      module: SOCIAL_MEDIA_MODULE_ID,
    },
    {
      key: SOCIAL_MEDIA_PERMISSIONS.postEdit,
      label: 'Posts bearbeiten',
      description: 'Bestehende Posts ändern, duplizieren und als fertig markieren.',
      module: SOCIAL_MEDIA_MODULE_ID,
    },
    {
      key: SOCIAL_MEDIA_PERMISSIONS.postExport,
      label: 'Posts exportieren',
      description: 'Posts als PNG herunterladen - der Schritt, nach dem eine Grafik das System verlässt.',
      module: SOCIAL_MEDIA_MODULE_ID,
    },
    {
      key: SOCIAL_MEDIA_PERMISSIONS.postDelete,
      label: 'Posts ablegen und löschen',
      description: 'Posts archivieren, zurückholen und endgültig löschen.',
      module: SOCIAL_MEDIA_MODULE_ID,
      critical: true,
    },
  ],
  navigation: [
    {
      href: '/social-media',
      label: 'Social Media',
      description: 'Fragen, Clips und Rückblicke zum Posten - an einem Ort',
      permission: SOCIAL_MEDIA_PERMISSIONS.view,
      icon: 'Megaphone',
      group: 'system',
      /*
       * Unter «System», vor «Wrapped» (28) und vor den Verwaltungseintraegen
       * (78 und mehr).
       *
       * Es lag zuerst bei der «Community», weil es sich aus deren Modulen
       * speist. Das war der falsche Schluss: unter Community steht, was die
       * Gemeinschaft *benutzt*. Diesen Bereich benutzt niemand aus der
       * Gemeinschaft - hier arbeitet das Team an dem, was nach draussen geht.
       * Dass die Daten aus Community-Modulen kommen, macht den Arbeitsplatz
       * nicht zu einem Angebot an die Mitglieder.
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
