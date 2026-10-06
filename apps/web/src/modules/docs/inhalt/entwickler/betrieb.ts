import type { DokuSeite } from '../../typen';

export const scheduler: DokuSeite = {
  slug: 'scheduler',
  titel: 'Scheduler & Jobs',
  kurz: 'Die Job-Schleife des Bots, die persistierten Automations-Jobs und wie man einen Job hinzufügt.',
  aktualisiert: '2026-10-06',
  abschnitte: [
    {
      anker: 'zwei-arten',
      titel: 'Zwei Arten von Jobs',
      blocks: [
        {
          art: 'absatz',
          text: 'Es gibt zwei Mechanismen, und sie lösen verschiedene Probleme. Wer sie verwechselt, baut entweder eine Zeitbombe oder unnötige Komplexität.',
        },
        {
          art: 'tabelle',
          kopf: ['', 'Job-Schleife des Bots', 'Automations-Jobs'],
          zeilen: [
            ['Wo', '`apps/bot/src/jobs.ts`', '`packages/automation`, Tabelle `AutomationJob`'],
            ['Auslöser', 'Zeitintervall', 'Ein Ereignis plus eine Verzögerung'],
            ['Nach Neustart', 'Intervall beginnt neu', 'Offene Jobs stehen in der Datenbank und laufen nach'],
            [
              'Wofür',
              'Wiederkehrendes Aufräumen, Abgleich, Erinnerungen',
              'Eine Aktion zu einem bestimmten Zeitpunkt für einen bestimmten Fall',
            ],
          ],
        },
      ],
    },
    {
      anker: 'schleife',
      titel: 'Die Job-Schleife',
      blocks: [
        {
          art: 'absatz',
          text: 'Jeder Job hat einen Namen, ein Intervall und optional `runOnStart`. Ein Wächter verhindert Überlappung: läuft ein Durchgang noch, wird der nächste Takt übersprungen statt parallel gestartet.',
        },
        {
          art: 'code',
          sprache: 'ts',
          titel: 'apps/bot/src/jobs.ts',
          inhalt: `{
  name: 'beispiel-aufraeumen',
  intervalMs: jobConfig.reconcileIntervalMs,
  runOnStart: false,
  async run() {
    const weg = await modul.raeumeAuf();
    if (weg > 0) {
      log.info('Aufgeräumt', { weg });
    }
  },
}`,
        },
        {
          art: 'hinweis',
          ton: 'wichtig',
          titel: 'Idempotent',
          text: 'Ein Job muss mehrfach laufen können, ohne Schaden anzurichten. Das Intervall beginnt nach einem Neustart neu, ein Durchgang kann mitten drin abbrechen, und zwei Deploys hintereinander bedeuten zwei Starts. «Hat es schon?» gehört in die Abfrage, nicht in eine Annahme.',
        },
        {
          art: 'liste',
          punkte: [
            'Ein Fehler in einem Job beendet nicht die Schleife - er wird protokolliert, der nächste Takt läuft.',
            'Die Timer laufen bewusst **ohne** `unref()`: die Jobs sind die eigentliche Arbeit des Bots und müssen den Prozess am Leben halten.',
            'Ein Lebenszeichen je Durchgang schreibt der Bot in eine Datei und als Herzschlag in die Datenbank. Daran erkennt Docker, ob sich die Schleife noch dreht - «der Prozess läuft» wäre auch nach abgerissener Discord-Verbindung noch wahr.',
          ],
        },
      ],
    },
    {
      anker: 'neuer-job',
      titel: 'Einen Job hinzufügen',
      blocks: [
        {
          art: 'schritte',
          punkte: [
            {
              titel: 'Die Arbeit ins Modul',
              text: 'Der Job ruft eine Funktion aus `@swisshub/modules` auf und enthält selbst keine Fachlogik.',
            },
            {
              titel: 'Intervall in @swisshub/config',
              text: 'Keine Zahl im Quelltext der Schleife - sonst ist sie nicht einstellbar und steht an zwei Orten.',
            },
            { titel: 'In die Liste in jobs.ts', text: 'Mit Namen, Intervall und `runOnStart`.' },
            {
              titel: 'Idempotenz prüfen',
              text: 'Ein Test, der die Funktion zweimal aufruft und das Ergebnis beim zweiten Mal unverändert erwartet.',
            },
            {
              titel: 'bot:startup-test',
              text: 'Der Bot wird dabei geladen - siehe [Bot-Runtime](/system/docs/entwickler/bot-runtime).',
            },
          ],
        },
      ],
    },
  ],
};

export const audit: DokuSeite = {
  slug: 'audit',
  titel: 'Audit & Logging',
  kurz: 'Drei Protokolle mit drei Zwecken - und was in keinem davon stehen darf.',
  aktualisiert: '2026-10-06',
  abschnitte: [
    {
      anker: 'drei',
      titel: 'Drei Protokolle',
      blocks: [
        {
          art: 'felder',
          eintraege: [
            {
              name: 'AuditLog',
              text: 'Wer hat wann was getan. Für Menschen lesbar, in der WebApp unter Audit Log einsehbar, mit `audit.view` als Berechtigung. Geschrieben über `recordAudit` bzw. `safeRecordAudit`.',
            },
            {
              name: 'SecurityEvent',
              text: 'Sicherheitsrelevante Vorfälle: fehlgeschlagene CSRF-Prüfung, verweigerte Berechtigung, Rate-Limit-Treffer. Mit Schweregrad.',
            },
            {
              name: 'Technische Logs',
              text: "Über `createLogger('bereich:unterbereich')` nach stdout. Für die Fehlersuche im Betrieb, nicht für die Oberfläche.",
            },
          ],
        },
      ],
    },
    {
      anker: 'audit-schreiben',
      titel: 'Einen Audit-Eintrag schreiben',
      blocks: [
        {
          art: 'code',
          sprache: 'ts',
          inhalt: `await recordAudit({
  action: AUDIT_ACTIONS.BEISPIEL_GEAENDERT,
  module: MODULE_ID,
  actorDiscordId: akteur.discordId,
  actorUsername: akteur.username ?? null,
  targetLabel: \`\${objekt.name} (\${objekt.key})\`,
  success: true,
  metadata: { vorher: alt, nachher: neu },
});`,
        },
        {
          art: 'liste',
          punkte: [
            'Jede Aktion braucht einen Schlüssel in `AUDIT_ACTIONS` **und** ein deutsches Label in `apps/web/src/modules/audit/labels.ts`. Ohne Label steht im Audit Log der technische Schlüssel.',
            '`safeRecordAudit` schluckt Fehler beim Schreiben - für Stellen, an denen ein fehlendes Protokoll den Vorgang nicht scheitern lassen soll.',
            '`metadata` beschreibt den **Zustand**, nicht die Eingabe. Siehe [Secrets](/system/docs/entwickler/secrets#nie-loggen).',
          ],
        },
      ],
    },
    {
      anker: 'verboten',
      titel: 'Was nicht ins Protokoll gehört',
      blocks: [
        {
          art: 'hinweis',
          ton: 'achtung',
          text: 'Secrets und Tokens. Nachrichteninhalte, soweit sie nicht ausdrücklich Gegenstand der Massnahme sind. Vollständige Personendaten, wo eine Kennung genügt. Ein Protokoll ist dauerhaft - was einmal darin steht, steht auch im nächsten Backup.',
        },
      ],
    },
  ],
};

export const bot: DokuSeite = {
  slug: 'bot',
  titel: 'Discord Bot',
  kurz: 'Startup, Command Registry, Interaktionen, Embeds - und wie ein neuer Slash Command dazukommt.',
  aktualisiert: '2026-10-06',
  abschnitte: [
    {
      anker: 'startup',
      titel: 'Startup',
      blocks: [
        {
          art: 'fluss',
          stationen: [
            { label: 'Konfiguration prüfen', detail: '@swisshub/config' },
            { label: 'Gateway verbinden', detail: 'discord.js' },
            { label: 'Commands anmelden', detail: 'bei Discord registrieren' },
            { label: 'Job-Schleife starten', detail: 'jobs.ts' },
          ],
        },
        {
          art: 'absatz',
          text: 'Einstieg ist `apps/bot/src/index.ts`. Fehlt eine nötige Umgebungsvariable, bricht der Start ab, statt halb zu laufen - ein Bot ohne Token, der trotzdem eine Schleife dreht, ist schwerer zu erkennen als einer, der nicht startet.',
        },
      ],
    },
    {
      anker: 'interaktionen',
      titel: 'Interaktionen',
      blocks: [
        {
          art: 'absatz',
          text: 'Discord schickt Slash Commands, Buttons, Select Menus und Modals über dieselbe Gateway-Verbindung. Der Router verteilt sie anhand ihres Namens bzw. ihrer `customId`.',
        },
        {
          art: 'liste',
          punkte: [
            'Die `customId` eines Buttons trägt, was er braucht - meist `bereich:aktion:id`. Es gibt keinen Zustand zwischen zwei Interaktionen.',
            'Berechtigungen werden über dieselbe Engine geprüft wie im Web. Die Discord-Rollen der Person kommen aus der Interaktion.',
            'Eine Antwort muss innerhalb von drei Sekunden kommen. Dauert die Arbeit länger, wird erst bestätigt (`deferReply`) und dann nachgeliefert.',
            'Embeds werden in der Modullogik gebaut, nicht im Bot - dieselbe Vorschau zeigt die WebApp.',
          ],
        },
      ],
    },
    {
      anker: 'neuer-command',
      titel: 'Einen Slash Command hinzufügen',
      blocks: [
        {
          art: 'schritte',
          punkte: [
            {
              titel: 'Logik ins Modul',
              text: 'Die Funktion gehört in `packages/modules/src/<modul>/`. Der Command ruft sie auf.',
            },
            {
              titel: 'Command definieren',
              text: 'Name, Beschreibung und Optionen nach dem Muster der bestehenden Commands in `apps/bot/src`.',
            },
            {
              titel: 'Berechtigung prüfen',
              text: 'Vor der Arbeit, mit der zentralen Engine. Discords eigene Command-Berechtigungen sind eine Bequemlichkeit, kein Riegel.',
            },
            {
              titel: 'Eingaben prüfen',
              text: 'Auch Discord-Optionen durch Zod oder die Prüffunktion des Moduls - Zeichenketten aus einer Interaktion sind Benutzereingaben.',
            },
            {
              titel: 'Antwort wählen',
              text: 'Sichtbar oder `ephemeral`. Alles, was Moderationsdaten zeigt, ist `ephemeral`.',
            },
            { titel: 'Audit', text: 'Ändert der Command etwas, gehört ein Eintrag ins Audit Log.' },
            {
              titel: 'bot:startup-test',
              text: '`npm run bot:startup-test` lädt alle Bot-Dateien einzeln und startet den Modulgraph.',
            },
          ],
        },
      ],
    },
  ],
};

export const botRuntime: DokuSeite = {
  slug: 'bot-runtime',
  titel: 'Bot-Runtime: server-only',
  kurz: 'Die Regel, an der sich entscheidet, ob der Bot startet - und warum ein grüner Build sie nicht findet.',
  aktualisiert: '2026-10-06',
  abschnitte: [
    {
      anker: 'regel',
      titel: 'Die Regel',
      blocks: [
        {
          art: 'hinweis',
          ton: 'achtung',
          titel: 'Kein server-only im Bot-Pfad',
          text: "Die Node-Laufzeit des Bots darf **nichts** importieren, was `import 'server-only'` enthält - auch nicht mittelbar über drei Ebenen.",
        },
        {
          art: 'absatz',
          text: '`server-only` ist ein Marker von Next.js. Das Paket wirft beim Laden, wenn es ausserhalb einer Server-Umgebung von Next landet. Der Bot ist aber ein gewöhnlicher Node-Prozess: für ihn wirft es immer.',
        },
      ],
    },
    {
      anker: 'warum-build-gruen',
      titel: 'Warum der Build das nicht findet',
      blocks: [
        {
          art: 'absatz',
          text: 'Weil es kein Typfehler ist. `tsc` prüft Typen, und die stimmen; der Fehler entsteht erst, wenn das Modul **ausgeführt** wird. `npm run build` baut die WebApp und typecheckt den Bot - er lädt ihn nicht.',
        },
        {
          art: 'absatz',
          text: 'Genau diese Lücke schliesst `npm run bot:startup-test`: er lädt jede Datei unter `apps/bot/src` einzeln und startet danach den Modulgraph über `index.ts` bis zu den Laufzeitprüfungen. Ein `server-only` irgendwo im Graph fällt dort auf - in CI und nicht im Betrieb.',
        },
        {
          art: 'code',
          sprache: 'bash',
          inhalt: 'npm run bot:startup-test',
        },
      ],
    },
    {
      anker: 'aufbau',
      titel: 'Wie gemeinsame Module gebaut sein müssen',
      blocks: [
        {
          art: 'liste',
          punkte: [
            '`packages/modules`, `packages/database`, `packages/permissions` und die übrigen gemeinsamen Pakete sind **frei** von `server-only`. Sie sind der geteilte Boden.',
            '`server-only` gehört in `apps/web/src/server/*` und in Dateien, die ausschliesslich die WebApp benutzt - etwa `apps/web/src/modules/workspace/daten.ts`.',
            'Braucht der Bot etwas aus einer solchen Datei, wird die Funktion nach unten verschoben: in den Modulkern, wo beide sie erreichen.',
            'Wird ein gemeinsames Paket angefasst, läuft `bot:startup-test` mit - deshalb steht er im Quality Gate.',
          ],
        },
      ],
    },
  ],
};

export const deployment: DokuSeite = {
  slug: 'deployment',
  titel: 'Deployment',
  kurz: 'Vom Push auf production bis zum Gesundheitscheck - zwei Jobs, eine Reihenfolge.',
  aktualisiert: '2026-10-06',
  abschnitte: [
    {
      anker: 'ablauf',
      titel: 'Der Ablauf',
      blocks: [
        {
          art: 'fluss',
          stationen: [
            { label: 'Push auf production', detail: 'Fast-Forward' },
            { label: 'Job: validate', detail: 'Lint, Typecheck, Tests, Build' },
            { label: 'Job: deploy', detail: 'nur bei grünem validate' },
            { label: 'Gesundheitscheck', detail: '/api/health' },
          ],
        },
        {
          art: 'absatz',
          text: '`.github/workflows/deploy.yml` reagiert auf einen Push auf `production`. Der zweite Job läuft nur, wenn der erste grün ist - ein fehlgeschlagener Test heisst: es wird nichts ausgerollt.',
        },
      ],
    },
    {
      anker: 'validate',
      titel: 'Was validate prüft',
      blocks: [
        {
          art: 'liste',
          geordnet: true,
          punkte: [
            'Abhängigkeiten installieren, Prisma-Client erzeugen',
            'Migrationen gegen eine frische Datenbank anwenden',
            'Lint und Typecheck',
            'Die vollständige Testsuite',
            '`bot:startup-test`',
            'Game-Agent bauen, Music-Runtime testen',
            'Production Build der WebApp',
          ],
        },
        {
          art: 'hinweis',
          ton: 'tipp',
          text: 'Derselbe Umfang lässt sich lokal fahren: `npm run check` deckt Format, Lint, Typecheck und Tests ab, `npm run build` den Rest. Wer das vorher laufen lässt, bekommt die Antwort in Minuten statt in einem roten Deploy.',
        },
      ],
    },
    {
      anker: 'produktion',
      titel: 'In Produktion',
      blocks: [
        {
          art: 'liste',
          punkte: [
            'Docker Compose: `docker-compose.prod.yml` beschreibt WebApp, Bot, Datenbank und Proxy.',
            'Migrationen laufen beim Deploy über `prisma migrate deploy` - additiv, siehe [Datenbank](/system/docs/entwickler/datenbank#migrationen).',
            'Nginx liegt davor; die Konfiguration steht unter `deploy/nginx/`.',
            'Die Datensicherung läuft über einen systemd-Timer auf dem Server, nicht aus der WebApp. Der Grund: die WebApp läuft als unprivilegierter Benutzer in einem Container ohne Docker-Socket - und dabei soll es bleiben.',
          ],
        },
        {
          art: 'hinweis',
          ton: 'wichtig',
          text: '`production` wird vorwärts geschoben (Fast-Forward), nicht überschrieben. Ein Force-Push würde die Historie der ausgerollten Stände zerreissen - und damit die Antwort auf «was lief gestern?».',
        },
      ],
    },
    {
      anker: 'health',
      titel: 'Gesundheitscheck',
      blocks: [
        {
          art: 'code',
          sprache: 'json',
          titel: 'GET /api/health',
          inhalt: `{
  "status": "ok",
  "checks": { "web": "ok", "database": "ok", "bot": "offline" },
  "timestamp": "2026-10-06T12:52:44.932Z"
}`,
        },
        {
          art: 'absatz',
          text: '`bot` steht auf `offline`, wenn der Herzschlag älter als drei Takte ist. Das ist eine Aussage über den Bot und nicht über die WebApp - beide laufen in eigenen Containern.',
        },
      ],
    },
  ],
};

export const testing: DokuSeite = {
  slug: 'testing',
  titel: 'Tests & Quality Gates',
  kurz: 'Welcher Test wann nötig ist - und welcher nur Zeit kostet.',
  aktualisiert: '2026-10-06',
  abschnitte: [
    {
      anker: 'gates',
      titel: 'Die Gates',
      blocks: [
        {
          art: 'tabelle',
          kopf: ['Befehl', 'Wann', 'Dauer'],
          zeilen: [
            ['`npm run check`', 'Immer vor einem Commit. Format, Lint, Typecheck, alle Tests.', '~12-14 min'],
            ['`npm run build`', 'Wenn die WebApp oder der Bot verändert wurde.', '~3 min'],
            [
              '`npm run bot:startup-test`',
              'Wenn gemeinsame Pakete oder `apps/bot` verändert wurden.',
              'Sekunden',
            ],
            ['`npm run db:deploy` auf frischer DB', 'Nur wenn das Schema geändert wurde.', 'Sekunden'],
            [
              '`next start`-Smoke',
              'Wenn die Web-Laufzeit betroffen ist: bauen, starten, Seiten abfragen.',
              '~1 min',
            ],
          ],
        },
        {
          art: 'hinweis',
          ton: 'tipp',
          text: 'Während der Umsetzung gezielt testen - einzelne Dateien mit `npx vitest run tests/…`. Der vollständige Gate-Lauf gehört ans Ende, nicht zwischen jeden Schritt.',
        },
      ],
    },
    {
      anker: 'arten',
      titel: 'Welche Testarten es gibt',
      blocks: [
        {
          art: 'felder',
          eintraege: [
            {
              name: 'tests/unit/',
              text: 'Reine Logik und Quelltextwächter. Laufen ohne Datenbank, in Millisekunden.',
            },
            {
              name: 'tests/integration/',
              text: 'Gegen ein echtes PostgreSQL, je Datei ein eigenes Schema über `useTestSchema`.',
            },
            {
              name: 'Quelltextwächter',
              text: 'Tests, die eine Datei lesen und eine Zusicherung über ihren Aufbau prüfen - etwa dass `speichereSymbol` das Bildfeld nicht anfasst. Sie halten Architekturentscheidungen fest, die kein Typ ausdrücken kann.',
            },
          ],
        },
      ],
    },
    {
      anker: 'guter-test',
      titel: 'Was einen Test tragfähig macht',
      blocks: [
        {
          art: 'liste',
          punkte: [
            '**Er fällt auf dem alten Code um.** Ein Regressionstest, der auch vor der Reparatur grün ist, prüft nichts. Einmal gegenprobieren.',
            '**Er stellt seine Vorbedingung her.** `pushSchema` lässt Zeilen stehen; was der Test annimmt, muss er in `beforeAll` setzen.',
            '**Er bringt seine Umgebung mit.** Ein Test, der auf `/var/lib/...` schreibt, läuft auf einem Rechner und nicht auf dem CI-Runner. Temporäres Verzeichnis anlegen, Umgebungsvariable setzen, danach aufräumen.',
            '**Er hängt nicht am Würfel.** Zufällige Werte in Zusicherungen blockieren irgendwann einen Lauf, der nichts damit zu tun hat.',
          ],
        },
        {
          art: 'hinweis',
          ton: 'achtung',
          text: 'Keine Tests abschalten und keine Zusicherungen abschwächen, um ein Gate grün zu bekommen. Ein übersprungener Test ist eine Lücke mit grünem Haken.',
        },
      ],
    },
  ],
};

export const troubleshooting: DokuSeite = {
  slug: 'troubleshooting',
  titel: 'Troubleshooting',
  kurz: 'Neun Fehlerbilder, ihre tatsächliche Ursache und der erste Griff.',
  aktualisiert: '2026-10-06',
  abschnitte: [
    {
      anker: 'build-gruen-runtime-kaputt',
      titel: 'Build grün, Laufzeit kaputt',
      blocks: [
        {
          art: 'absatz',
          text: 'Häufigste Ursache: ein `server-only`-Import im Bot-Pfad. `tsc` sieht das nicht, weil es kein Typfehler ist. Zweithäufigste: ein React-Element, das als Prop vom Server zum Browser gehen sollte.',
        },
        { art: 'code', sprache: 'bash', inhalt: 'npm run bot:startup-test' },
        {
          art: 'absatz',
          text: 'Mehr dazu auf [Bot-Runtime](/system/docs/entwickler/bot-runtime).',
        },
      ],
    },
    {
      anker: 'bot-startet-nicht',
      titel: 'Der Bot startet nicht',
      blocks: [
        {
          art: 'liste',
          geordnet: true,
          punkte: [
            'Container-Log ansehen: fehlt eine Umgebungsvariable, sagt der Start das und bricht ab.',
            '`npm run bot:startup-test` lokal - findet Importfehler ohne Discord-Token.',
            'Steht der Prozess, dreht aber keine Schleife? Dann ist das Lebenszeichen alt und `/api/health` zeigt `bot: offline`.',
          ],
        },
      ],
    },
    {
      anker: 'migration',
      titel: 'Prisma-Migration schlägt fehl',
      blocks: [
        {
          art: 'liste',
          punkte: [
            '**In CI, nicht lokal:** meistens ein nicht-additiver Schritt. Die CI-Datenbank ist frisch, die lokale hat Geschichte.',
            '**«already exists»:** die Migration ist nicht idempotent oder lief schon teilweise.',
            '**Drift:** Schema und Migrationen auseinander. `npm run db:generate` und prüfen, ob eine Migration fehlt.',
          ],
        },
        {
          art: 'code',
          sprache: 'bash',
          titel: 'Gegen eine frische Datenbank prüfen',
          inhalt: 'npm run db:deploy',
        },
      ],
    },
    {
      anker: 'unbekannte-permission',
      titel: '«Unbekannte Berechtigung: …»',
      blocks: [
        {
          art: 'absatz',
          text: 'Ein Schlüssel kam an, den die Registry nicht kennt. Zwei Fälle, und sie sind verschieden.',
        },
        {
          art: 'liste',
          punkte: [
            '**Ein Tippfehler oder ein neuer Schlüssel ohne Eintrag** - dann in die Registry eintragen. Das ist der Fehler, den die Meldung finden soll.',
            '**Eine Altlast aus einem entfernten Modul** - dann gehört der Schlüssel in `ENTFERNTE_PERMISSIONS` und seine Zeilen in eine Aufräum-Migration. Der Kasten «Alte Berechtigungen in den Rollendaten» auf der Berechtigungsseite zeigt, was in der Datenbank steht und in der Registry fehlt.',
          ],
        },
      ],
    },
    {
      anker: 'upload-verschwindet',
      titel: 'Ein Upload wird nicht persistiert',
      blocks: [
        {
          art: 'liste',
          geordnet: true,
          punkte: [
            'Liegt die Datei im Upload-Verzeichnis? Wenn nicht, scheiterte das Schreiben - Rechte auf `SWISSHUB_UPLOAD_DIR` prüfen.',
            'Steht die Referenz in der Datenbank? Wenn nicht, hat der Upload sie nur in den Formularzustand geschrieben.',
            'Verschwindet sie nach dem Speichern **an einer anderen Stelle**? Dann schreibt dort ein veraltetes Formular das Feld zurück. Ein Medienfeld braucht genau einen Schreiber - siehe [Media](/system/docs/entwickler/media#referenzen).',
          ],
        },
      ],
    },
    {
      anker: 'command-fehlt',
      titel: 'Ein Discord Command erscheint nicht',
      blocks: [
        {
          art: 'liste',
          punkte: [
            'Commands werden beim Start angemeldet. Ohne Neustart des Bots gibt es den neuen Command nicht.',
            'Discord cacht Command-Listen je Client. Ein Neuladen des Discord-Clients hilft.',
            'Fehlt die Berechtigung des Bots in der Gilde, kann er nichts anmelden - sichtbar unter System → Bot.',
          ],
        },
      ],
    },
    {
      anker: 'alte-config',
      titel: 'Alte Konfiguration wirkt weiter',
      blocks: [
        {
          art: 'liste',
          punkte: [
            '**Rollen/Berechtigungen:** 15 Sekunden Cache. `invalidateRoleConfiguration()` nach jedem Schreiben - fehlt der Aufruf, wirkt die alte Zuordnung weiter.',
            '**Seiteninhalt:** `revalidatePath()` in der Action. Ohne das zeigt die Seite den Stand von vorher.',
            '**Moduleinstellungen:** werden je Abfrage gelesen, aber die Seite muss neu rendern.',
          ],
        },
      ],
    },
    {
      anker: 'deploy-rot',
      titel: 'GitHub Actions schlägt fehl',
      blocks: [
        {
          art: 'liste',
          geordnet: true,
          punkte: [
            'Welcher **Schritt**? `validate` und `deploy` sind zwei Jobs; scheitert `validate`, wurde nichts ausgerollt.',
            'Bei «Tests»: die Zusammenfassung von vitest nennt Datei und Zeile. Lokal gezielt nachfahren.',
            'Lokal grün, in CI rot? Dann unterscheidet sich die Umgebung - frische Datenbank, andere Rechte, kein `/var/lib`. Die Ursache liegt meist im Test, nicht im Code.',
          ],
        },
      ],
    },
    {
      anker: 'health-rot',
      titel: 'Der Gesundheitscheck meldet einen Fehler',
      blocks: [
        {
          art: 'felder',
          eintraege: [
            {
              name: 'database',
              text: 'Keine Verbindung oder keine Berechtigung. `DATABASE_URL` und der Zustand des Datenbank-Containers.',
            },
            {
              name: 'bot',
              text: 'Herzschlag zu alt. Der Bot-Container läuft nicht oder seine Job-Schleife steht.',
            },
            {
              name: 'web',
              text: 'Kommt die Antwort überhaupt, ist die WebApp an sich erreichbar - dann liegt es am Proxy davor.',
            },
          ],
        },
      ],
    },
  ],
};

export const neuesFeature: DokuSeite = {
  slug: 'neues-feature',
  titel: 'Ein neues Feature hinzufügen',
  kurz: 'Elf Schritte in der Reihenfolge, in der sie am wenigsten Arbeit machen.',
  aktualisiert: '2026-10-06',
  abschnitte: [
    {
      anker: 'reihenfolge',
      titel: 'Die Reihenfolge',
      blocks: [
        {
          art: 'absatz',
          text: 'Die Reihenfolge ist nicht beliebig. Wer mit der Oberfläche anfängt, baut sie zweimal: einmal gegen die vermutete Logik und einmal gegen die tatsächliche.',
        },
        {
          art: 'schritte',
          punkte: [
            {
              titel: 'Scope festlegen',
              text: 'Was gehört dazu, was nicht. Welches Modul ist zuständig - oder ist es ein neues?',
            },
            {
              titel: 'Berechtigung',
              text: 'Welcher Schlüssel, welcher Scope. Siehe [Permission Engine](/system/docs/entwickler/permissions#neue-permission).',
            },
            {
              titel: 'Datenmodell',
              text: 'Nur wenn nötig. Additive Migration, Vorgabewerte für bestehende Zeilen.',
            },
            {
              titel: 'Modullogik',
              text: 'In `packages/modules/src/<modul>/`. Hier steht die Regel - und nur hier.',
            },
            {
              titel: 'Action oder API',
              text: '`defineAction` für Schreibvorgänge, Route Handler für Dateien und Ströme.',
            },
            {
              titel: 'Oberfläche',
              text: 'Server Component für Daten, Client Component nur für Interaktion. Bestehende Bausteine benutzen.',
            },
            { titel: 'Audit', text: 'Ändert es etwas, gehört ein Eintrag ins Audit Log - samt Label.' },
            { titel: 'Scheduler', text: 'Nur falls etwas zeitgesteuert passieren soll. Idempotent.' },
            {
              titel: 'Tests',
              text: 'Logik als Unit-Test, Datenwege als Integrationstest, Berechtigungen in beide Richtungen.',
            },
            {
              titel: 'Gate',
              text: '`npm run check`, dann `npm run build`. Dazu `bot:startup-test`, falls gemeinsame Pakete betroffen sind.',
            },
            {
              titel: 'Deploy',
              text: 'Commit, Fast-Forward auf `production`, Actions-Lauf verfolgen, Gesundheitscheck.',
            },
          ],
        },
      ],
    },
    {
      anker: 'neues-modul',
      titel: 'Wenn es ein neues Modul ist',
      blocks: [
        {
          art: 'liste',
          punkte: [
            'Verzeichnis unter `packages/modules/src/<modul>/` mit `config.ts` für Definition, Berechtigungen und Navigationseinträge.',
            '`registerModule({ … })` aufrufen - Navigation, Einstellungen und die Berechtigungsmatrix entstehen daraus von selbst.',
            'Die Navigationseinträge brauchen `group` und `order`. Innerhalb einer Gruppe entscheidet `order` über die Reihenfolge.',
            'Modulspezifische Einstellungen über `getModuleSettings` / `writeModuleSettings` - keine eigene Konfigurationstabelle.',
          ],
        },
        {
          art: 'hinweis',
          ton: 'tipp',
          text: 'Ein Modul, das sich korrekt anmeldet, erscheint ohne weitere Änderung in Seitenleiste, Modulübersicht und Berechtigungsmatrix. Wer dort etwas von Hand ergänzen muss, hat die Registrierung nicht vollständig gemacht.',
        },
      ],
    },
  ],
};
