import type { DokuSeite } from '../../typen';

export const kalender: DokuSeite = {
  slug: 'kalender',
  titel: 'Community-Kalender',
  kurz: 'Termine anlegen, Anmeldungen führen und Tickets verkaufen.',
  aktualisiert: '2026-10-06',
  abschnitte: [
    {
      anker: 'wofuer',
      titel: 'Wofür ist der Kalender?',
      blocks: [
        {
          art: 'absatz',
          text: 'Für alles mit einem Datum: Spieleabende, Turniervorbereitungen, Treffen. Ein Termin kann offen sein oder eine Anmeldung verlangen - und er kann Geld kosten.',
        },
      ],
    },
    {
      anker: 'anlegen',
      titel: 'Einen Termin anlegen',
      blocks: [
        {
          art: 'schritte',
          punkte: [
            { titel: 'Grunddaten', text: 'Titel, Beschreibung, Kategorie, Beginn und Ende.' },
            { titel: 'Kapazität', text: 'Wie viele Plätze es gibt. Ohne Angabe ist der Termin unbegrenzt.' },
            { titel: 'Anmeldung', text: 'Ob und bis wann sich angemeldet werden kann.' },
            {
              titel: 'Preis',
              text: 'Leer lassen für kostenlos. Mit Preis braucht es einen eingerichteten Zahlungsanbieter.',
            },
            {
              titel: 'Veröffentlichen',
              text: 'Erst danach erscheint der Termin im Kalender und als Discord-Embed.',
            },
          ],
        },
      ],
    },
    {
      anker: 'tickets',
      titel: 'Tickets',
      blocks: [
        {
          art: 'absatz',
          text: 'Bei einem Termin mit Anmeldung bekommt jede Anmeldung ein Ticket. Eine Person kann mehrere nachbestellen - jedes Ticket hat seinen eigenen Zahlungsstand.',
        },
        {
          art: 'liste',
          punkte: [
            '**Definitiv** ist nur, wer ein bezahltes Ticket hat. Die Kapazität zählt die definitiven.',
            'Jedes Ticket trägt einen QR-Code zum Einlass.',
            'Die Teilnehmerliste zeigt die Tickets gruppiert je Person.',
          ],
        },
        {
          art: 'hinweis',
          ton: 'wichtig',
          text: 'Der QR-Code eines Tickets gehört der Person, die es hat. Ein weitergegebener Code lässt jemand anderen hinein - Screenshots gehören deshalb nicht in offene Kanäle.',
        },
      ],
    },
    {
      anker: 'knopf',
      titel: 'Kalender öffnen',
      blocks: [
        {
          art: 'modulknopf',
          href: '/kalender',
          label: 'Community-Kalender öffnen',
          permission: 'calendar.view',
        },
      ],
    },
  ],
};

export const berechtigungen: DokuSeite = {
  slug: 'berechtigungen',
  titel: 'Berechtigungen',
  kurz: 'Wie das Team Rechte an Discord-Rollen vergibt - und was dabei schiefgehen kann.',
  aktualisiert: '2026-10-06',
  abschnitte: [
    {
      anker: 'prinzip',
      titel: 'Das Prinzip',
      blocks: [
        {
          art: 'absatz',
          text: 'Rechte hängen an **Discord-Rollen**, nicht an Personen. Wer eine Rolle hat, hat deren Rechte - wer sie verliert, verliert sie. Niemand wird einzeln eingetragen.',
        },
        {
          art: 'fluss',
          stationen: [
            { label: 'Person', detail: 'in Discord' },
            { label: 'Rolle', detail: 'z. B. Moderator' },
            { label: 'Berechtigungen', detail: 'der Rolle zugewiesen' },
            { label: 'Zugang', detail: 'in der WebApp' },
          ],
        },
      ],
    },
    {
      anker: 'matrix',
      titel: 'Die Matrix',
      blocks: [
        {
          art: 'absatz',
          text: 'Unter Server → Berechtigungen stehen alle Rechte, nach Modul gruppiert. Je Rolle lässt sich jedes Recht auf **erlaubt**, **verweigert** oder **nicht gesetzt** stellen.',
        },
        {
          art: 'tabelle',
          kopf: ['Stand', 'Bedeutung'],
          zeilen: [
            ['erlaubt', 'Die Rolle darf es.'],
            [
              'verweigert',
              'Die Rolle darf es nicht - und zwar auch dann nicht, wenn eine andere ihrer Rollen es erlaubt.',
            ],
            ['nicht gesetzt', 'Diese Rolle sagt nichts dazu. Eine andere Rolle kann es erlauben.'],
          ],
        },
        {
          art: 'hinweis',
          ton: 'achtung',
          text: '**Verweigern schlägt Erlauben.** Ein «verweigert» an einer einzigen Rolle gewinnt gegen jedes «erlaubt» an allen anderen. Das ist Absicht - eine Sperre, die durch eine zweite Rolle umgangen werden kann, wäre keine.',
        },
      ],
    },
    {
      anker: 'speichern',
      titel: 'Speichern',
      blocks: [
        {
          art: 'liste',
          punkte: [
            'Geändert wird eine Rolle, gespeichert wird einmal. Bis dahin ist nichts wirksam.',
            'Dasselbe Recht gleichzeitig erlauben **und** verweigern lehnt das Speichern ab.',
            'Sich selbst den Zugang zur Berechtigungsverwaltung zu nehmen, lehnt das Speichern ebenfalls ab - sonst käme niemand mehr hinein.',
            'Jede Änderung steht danach im Audit Log, mit Vorher und Nachher.',
          ],
        },
      ],
    },
    {
      anker: 'altlasten',
      titel: 'Alte Berechtigungen',
      blocks: [
        {
          art: 'absatz',
          text: 'Wird ein Modul entfernt, bleiben seine Rechte manchmal an Rollen hängen. Beim Speichern werden solche Reste erkannt und still weggelassen; die Konfiguration wird deswegen nicht abgelehnt. Im Protokoll steht, was entfernt wurde.',
        },
      ],
    },
    {
      anker: 'knopf',
      titel: 'Berechtigungen öffnen',
      blocks: [
        {
          art: 'modulknopf',
          href: '/server/permissions',
          label: 'Berechtigungen öffnen',
          permission: 'permissions.manage',
        },
      ],
    },
    {
      anker: 'fehler',
      titel: 'Häufige Fehler',
      blocks: [
        {
          art: 'felder',
          eintraege: [
            {
              name: 'Jemand sieht etwas nicht, obwohl das Recht gesetzt ist',
              text: 'Eine seiner anderen Rollen verweigert es. Die Matrix zeigt pro Rolle - der Konflikt wird erst im Zusammenspiel sichtbar.',
            },
            {
              name: 'Die Änderung wirkt nicht sofort',
              text: 'Die Rollenkonfiguration wird kurz zwischengespeichert. Nach wenigen Sekunden greift sie.',
            },
            {
              name: 'Die Rolle fehlt in der Liste',
              text: 'Sie ist in Discord neu. Der Rollenabgleich unter System → Discord-Sync holt sie.',
            },
          ],
        },
      ],
    },
  ],
};

export const systembereich: DokuSeite = {
  slug: 'system',
  titel: 'Systembereich',
  kurz: 'Was unter «System» liegt, wer dort hingehört und was man dort besser nicht anklickt.',
  aktualisiert: '2026-10-06',
  abschnitte: [
    {
      anker: 'wofuer',
      titel: 'Wofür ist der Systembereich?',
      blocks: [
        {
          art: 'absatz',
          text: 'Für die Teile, die den Betrieb betreffen statt die Community: Einstellungen, Bot, Integrationen, Audit Log, Backup, Automationen.',
        },
        {
          art: 'hinweis',
          ton: 'admin',
          text: 'Fast alles hier ist Sache der Administration. Eine Einstellung im Systembereich wirkt auf den ganzen Server, nicht nur auf ein Modul.',
        },
      ],
    },
    {
      anker: 'seiten',
      titel: 'Die Seiten',
      blocks: [
        {
          art: 'felder',
          eintraege: [
            {
              name: 'Einstellungen',
              text: 'Grundeinstellungen des Servers; darunter Branding - Logo und Farben der WebApp.',
            },
            {
              name: 'Module',
              text: 'Module ein- und ausschalten. Ein ausgeschaltetes Modul verschwindet aus der Navigation, seine Daten bleiben.',
            },
            { name: 'Bot', text: 'Steht der Bot? Welche Rechte fehlen ihm in Discord? Hier steht es.' },
            { name: 'Discord-Sync', text: 'Rollen, Kanäle und Mitglieder aus Discord neu einlesen.' },
            { name: 'Integrationen', text: 'Zugänge zu Diensten ausserhalb. Siehe die eigene Seite dazu.' },
            { name: 'Audit Log', text: 'Wer hat was geändert. Siehe unten.' },
            { name: 'Automationen', text: 'Regeln, die bei einem Ereignis von selbst etwas tun.' },
            {
              name: 'Backup & Recovery',
              text: 'Sicherungen und ihr Zustand. Wiederherstellen ist kein Knopf für den Alltag.',
            },
            { name: 'Log-Kanäle', text: 'In welchen Discord-Kanal welche Ereignisse geschrieben werden.' },
          ],
        },
      ],
    },
    {
      anker: 'audit',
      titel: 'Audit Log',
      blocks: [
        {
          art: 'absatz',
          text: 'Jede Änderung mit Folgen steht dort: wer, wann, was, und bei Konfigurationen Vorher und Nachher. Gefiltert wird nach Zeitraum, Person und Bereich.',
        },
        {
          art: 'hinweis',
          ton: 'wichtig',
          text: 'Das Audit Log ist eine Protokollierung über echte Personen - auch über die eigenen Kolleginnen und Kollegen. Es dient dazu, eine Änderung nachvollziehen zu können, nicht dazu, jemandem nachzugehen.',
        },
      ],
    },
    {
      anker: 'vorsicht',
      titel: 'Was man nicht nebenbei macht',
      blocks: [
        {
          art: 'liste',
          punkte: [
            'Ein **Integrationswert ändern** kann den Bot vom Netz nehmen.',
            'Ein **Modul ausschalten** nimmt es allen gleichzeitig weg.',
            'Eine **Wiederherstellung** setzt Daten auf einen früheren Stand zurück. Was danach kam, ist weg.',
            'Eine **Berechtigung bei sich selbst entziehen** kann den eigenen Zugang kosten - gegen den schlimmsten Fall wehrt sich das System, gegen alle nicht.',
          ],
        },
      ],
    },
  ],
};
