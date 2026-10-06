import type { DokuSeite } from '../../typen';

export const datenbank: DokuSeite = {
  slug: 'datenbank',
  titel: 'Datenbank',
  kurz: 'Prisma, Migrationen, die fachlichen Modellgruppen und warum Migrationen additiv sind.',
  aktualisiert: '2026-10-06',
  abschnitte: [
    {
      anker: 'schema',
      titel: 'Schema und Client',
      blocks: [
        {
          art: 'absatz',
          text: 'Ein Schema für alles: `packages/database/prisma/schema.prisma`. Der Client wird daraus erzeugt und von `@swisshub/database` als `prisma` exportiert - eine Instanz für den ganzen Prozess. Niemand erzeugt einen eigenen `PrismaClient`.',
        },
        {
          art: 'code',
          sprache: 'bash',
          inhalt: `npm run db:generate   # Client aus dem Schema erzeugen
npm run db:migrate    # Migration in der Entwicklung anlegen
npm run db:deploy     # Migrationen anwenden (Produktion, CI)
npm run db:studio     # Prisma Studio`,
        },
      ],
    },
    {
      anker: 'modellgruppen',
      titel: 'Die fachlichen Modellgruppen',
      blocks: [
        {
          art: 'absatz',
          text: 'Das Schema ist gross. Hilfreicher als eine Feldliste ist, nach welchen Gruppen es geordnet ist - jede davon gehört zu einem Modul und ist dort dokumentiert.',
        },
        {
          art: 'tabelle',
          kopf: ['Gruppe', 'Worum es geht', 'Beispiele'],
          zeilen: [
            ['Identität', 'Konten, Sitzungen, Mitgliederspiegel', '`User`, `Session`, `DiscordMemberCache`'],
            ['Berechtigungen', 'Verwaltete Rollen und ihre Zuordnungen', '`ManagedRole`, `RolePermission`'],
            ['Moderation', 'Massnahmen, Jail, Notizen, Anträge', '`ModerationAction`, `Jail`, `MemberNote`'],
            ['Level & Spiele', 'XP, Spiele, XP-Slot', '`LevelProfile`, `LevelGameMatch`, `XpSlotSymbol`'],
            [
              'Premium',
              'Abonnements, Vergaben, Zahlungen',
              '`PremiumSubscription`, `PremiumGrant`, `PremiumPaymentEvent`',
            ],
            [
              'Community',
              'Kalender, Turniere, Clips, Missionen',
              '`CalendarEvent`, `CalendarTicket`, `ClipVote`',
            ],
            ['Workspace', 'Projekte, Aufgaben, Beteiligte', '`WorkspaceProject`, `WorkspaceTask`'],
            [
              'Inhalte',
              'Social Posts, Wrapped, Serverrollen',
              '`SocialPost`, `WrappedEdition`, `ServerRole`',
            ],
            [
              'Betrieb',
              'Audit, Sicherheitsereignisse, Automationen',
              '`AuditLog`, `SecurityEvent`, `AutomationJob`',
            ],
          ],
        },
      ],
    },
    {
      anker: 'migrationen',
      titel: 'Migrationsstrategie',
      blocks: [
        {
          art: 'hinweis',
          ton: 'wichtig',
          titel: 'Additiv',
          text: 'Migrationen fügen hinzu. Eine Spalte kommt mit Vorgabewert dazu; eine Spalte, die weg soll, wird zuerst unbenutzt und erst in einer späteren Migration entfernt. Der Grund ist der Deploy: während er läuft, sind kurzzeitig alter und neuer Code gleichzeitig unterwegs.',
        },
        {
          art: 'liste',
          punkte: [
            'Keine zerstörenden Schritte auf produktiven Daten. Kein `TRUNCATE`, keine Löschung nach Muster.',
            'Eine reine Datenbereinigung ist erlaubt, wenn sie **namentlich** aufzählt, was sie anfasst - Beispiel: `20261027080000_spielersuche_rechte_aufraeumen`.',
            'Jede Migration muss zweimal laufen können. Migrationen laufen in Restore-Tests und auf Kopien.',
            'Vor dem Deploy auf einer frischen Datenbank prüfen: `npm run db:deploy` gegen ein leeres Schema.',
          ],
        },
      ],
    },
    {
      anker: 'tests',
      titel: 'Datenbank in Tests',
      blocks: [
        {
          art: 'absatz',
          text: "Integrationstests laufen gegen ein echtes PostgreSQL in einem eigenen Schema je Testdatei: `useTestSchema('test_xyz')` aus `tests/helpers/database.ts`.",
        },
        {
          art: 'hinweis',
          ton: 'achtung',
          text: '`pushSchema()` bringt das **Schema** auf den Stand, nicht die Zeilen. Die Daten des letzten Laufs bleiben stehen. Wer eine Vorbedingung braucht, muss sie in `beforeAll` herstellen - ein Test, der nur beim ersten Lauf grün ist, prüft den Lauf und nicht den Code.',
        },
      ],
    },
  ],
};

export const permissions: DokuSeite = {
  slug: 'permissions',
  titel: 'Permission Engine',
  kurz: 'Registry als Source of Truth, Auflösung, Scopes, Cache, Audit - und wie man eine Berechtigung hinzufügt.',
  bereich: 'Berechtigungen',
  aktualisiert: '2026-10-06',
  abschnitte: [
    {
      anker: 'registry',
      titel: 'Die Registry',
      blocks: [
        {
          art: 'absatz',
          text: 'Jede Berechtigung ist ein String `<prefix>.<aktion>` und steht in genau einer Registry: `packages/permissions/src/registry.ts`. Kernberechtigungen stehen dort als `CORE_PERMISSIONS`; Module bringen ihre eigenen mit und melden sie über `registerPermissions()` an.',
        },
        {
          art: 'code',
          sprache: 'ts',
          inhalt: `export interface PermissionDefinition {
  key: string;        // 'jail.create'
  label: string;      // Anzeigename in den Einstellungen
  description: string;
  module: string;     // Modul-ID oder 'core'
  critical?: boolean; // Warnhinweis in der Oberfläche
}`,
        },
        {
          art: 'hinweis',
          ton: 'wichtig',
          titel: 'Source of Truth',
          text: 'Was die Registry nicht kennt, gibt es nicht. Oberfläche, Seeds und Presets lesen aus ihr - es gibt **keine** zweite, hartkodierte Liste von Berechtigungen. Eine solche Liste läuft beim ersten neuen Schlüssel auseinander.',
        },
      ],
    },
    {
      anker: 'aufloesung',
      titel: 'Wie eine Berechtigung aufgelöst wird',
      blocks: [
        {
          art: 'fluss',
          stationen: [
            { label: 'Rollen der Person', detail: 'aus Discord' },
            { label: 'RolePermission', detail: 'ALLOW und DENY' },
            { label: 'resolvePermissions', detail: 'sammelt beide' },
            { label: 'hasPermission', detail: 'entscheidet' },
          ],
        },
        {
          art: 'liste',
          punkte: [
            '**DENY sticht ALLOW.** Eine ausdrückliche Ausnahme gewinnt gegen jede Erlaubnis - auch gegen `admin.full`.',
            '**`admin.full`** schliesst alle anderen Berechtigungen ein.',
            '**Wildcards** gelten je erstes Segment: `jail.*` deckt alles unter `jail.` ab.',
            '**Der Notzugang** (`SWISSHUB_OWNER_DISCORD_ID`) gewinnt vor allem anderen - auch vor einem DENY. Sonst liesse sich der letzte Weg hinein über die Oberfläche zunageln.',
          ],
        },
        {
          art: 'absatz',
          text: '`explainPermission()` gibt zurück, **warum** eine Antwort so ausfiel. Dieselbe Funktion benutzt die Berechtigungsmatrix in den Einstellungen - die Oberfläche erklärt damit nicht ihre eigene Vermutung, sondern das Ergebnis der Engine.',
        },
      ],
    },
    {
      anker: 'scopes',
      titel: 'Scopes: own, assigned, all',
      blocks: [
        {
          art: 'absatz',
          text: 'Manche Rechte hängen davon ab, **wessen** Daten gemeint sind. Das steht als Endung im Schlüssel und nicht als zusätzliche Spalte: `members.view.tickets.own`, `members.view.tickets.assigned`, `members.view.tickets.all`.',
        },
        {
          art: 'hinweis',
          ton: 'info',
          text: 'Absichtlich keine eigene Dimension. Ein Scope-Feld neben dem Schlüssel wäre eine zweite Engine mit eigener Auflösung, eigenem Cache und eigenen Fehlern. Als Endung ist ein Scope ein gewöhnlicher Schlüssel - und `hasAnyPermission` beantwortet «own oder all» in einer Zeile.',
        },
      ],
    },
    {
      anker: 'serverseitig',
      titel: 'Serverseitige Prüfungen',
      blocks: [
        {
          art: 'felder',
          eintraege: [
            {
              name: 'requirePagePermission(key)',
              text: 'Der Riegel vor einer Seite. Nimmt auch eine Liste - dann genügt eine davon.',
            },
            {
              name: 'defineAction({ permission })',
              text: 'Der Riegel vor einer Server Action. Prüft zusätzlich Sitzung, Mitgliedschaft, CSRF und Rate Limit.',
            },
            {
              name: 'assertPermission(ctx, key)',
              text: 'In Route Handlern, wo es keine Action gibt - zum Beispiel beim Dateiupload.',
            },
            {
              name: 'can(ctx, key)',
              text: 'Die Frage ohne Konsequenz: steuert, **ob etwas angezeigt wird**. Nie der einzige Schutz.',
            },
          ],
        },
        {
          art: 'hinweis',
          ton: 'achtung',
          titel: 'UI-Verstecken ist keine Sicherheit',
          text: 'Ein ausgeblendeter Knopf schützt nicht die Adresse dahinter. Jede Seite und jede Aktion prüft selbst. `can()` entscheidet über Sichtbarkeit, `requirePagePermission` und `defineAction` über Zugang.',
        },
      ],
    },
    {
      anker: 'cache',
      titel: 'Cache und Invalidierung',
      blocks: [
        {
          art: 'absatz',
          text: '`loadRoleConfiguration()` hält die Rollenzuordnungen 15 Sekunden im Prozess. Nach jeder Änderung an Rollen oder Berechtigungen ruft die schreibende Stelle `invalidateRoleConfiguration()` - sonst gilt die alte Zuordnung bis zu 15 Sekunden weiter.',
        },
        {
          art: 'absatz',
          text: "Die Rollen einer Person kommen aus ihrer Sitzung. `freshness: 'critical'` holt sie vor der Aktion frisch von Discord; das ist der Weg für alles, was Rechte oder Geld betrifft.",
        },
      ],
    },
    {
      anker: 'altlasten',
      titel: 'Altlasten: entfernte Schlüssel',
      blocks: [
        {
          art: 'absatz',
          text: 'Wird ein Modul entfernt, verschwinden seine Berechtigungen aus der Registry - die Zeilen in `RolePermission` aber nicht. Genau das hat einmal das Speichern jeder Rollen-Konfiguration blockiert.',
        },
        {
          art: 'absatz',
          text: '`packages/permissions/src/altlasten.ts` benennt solche Schlüssel. `aufloeseAltlasten()` trennt eine Liste in vier Gruppen: `gueltig`, `migriert`, `entfernt`, `unbekannt`. Dieselbe Funktion benutzen die Server Action, die Einstellungsseite und die Diagnose - deshalb können Vorschau und Persistenz nicht auseinanderlaufen.',
        },
        {
          art: 'hinweis',
          ton: 'wichtig',
          text: 'Ein **unbekannter** Schlüssel bleibt ein Fehler. Nur was in der Altlastenliste **benannt** ist, wird migriert oder weggeräumt. Alles still durchzulassen hiesse, dass ein Tippfehler wie `moderation.exectue` genauso ruhig angenommen wird wie der richtige Name - und niemand merkt, dass die Rolle das Recht nie bekam.',
        },
      ],
    },
    {
      anker: 'neue-permission',
      titel: 'Eine neue Berechtigung hinzufügen',
      blocks: [
        {
          art: 'schritte',
          punkte: [
            {
              titel: 'Schlüssel wählen',
              text: '`<modulprefix>.<aktion>`, klein, mit Punkten. Bei scope-abhängigen Rechten die Endung `.own` / `.assigned` / `.all` anhängen.',
            },
            {
              titel: 'In der Registry eintragen',
              text: 'Bei einem Modul in dessen `permissions`-Katalog (z.B. `packages/modules/src/<modul>/config.ts`); bei einer Kernberechtigung in `CORE_PERMISSIONS`. Mit `label`, `description` und - wenn die Handlung weh tut - `critical: true`.',
            },
            {
              titel: 'Server prüfen lassen',
              text: 'In `requirePagePermission` der Seite und in `permission` der Action. Ohne das ist die Berechtigung ein Häkchen ohne Wirkung.',
            },
            {
              titel: 'Oberfläche anpassen',
              text: 'Mit `can(context, key)` steuern, was angezeigt wird. Zusätzlich, nicht stattdessen.',
            },
            {
              titel: 'Preset prüfen',
              text: 'Soll eine Standardrolle das Recht bekommen, gehört es in `PERMISSION_PRESETS` in `presets.ts`.',
            },
            {
              titel: 'Testen',
              text: 'Ein Test mit dem Recht, einer ohne - und einer auf den direkten URL-Zugriff.',
            },
          ],
        },
        {
          art: 'hinweis',
          ton: 'achtung',
          titel: 'Niemals entfernen, ohne aufzuräumen',
          text: 'Wird ein Schlüssel aus der Registry genommen, während er in produktiven Rollendaten steht, entsteht eine Altlast. Dann gehört er in `ENTFERNTE_PERMISSIONS` **und** in eine Migration, die seine Zeilen namentlich wegräumt.',
        },
      ],
    },
    {
      anker: 'audit-berechtigungen',
      titel: 'Was protokolliert wird',
      blocks: [
        {
          art: 'absatz',
          text: 'Jede Änderung an einer Rollen-Konfiguration schreibt `ROLE_MAPPING_CHANGED` ins Audit Log, mit `before`, `after` und - falls die Auflösung etwas angefasst hat - `migriert` und `entfernt`. Eine stille Änderung an Rechtedaten gibt es nicht.',
        },
      ],
    },
  ],
};

export const auth: DokuSeite = {
  slug: 'auth',
  titel: 'Authentifizierung',
  kurz: 'Discord OAuth, Sitzungen, der Mitgliederspiegel und die Rollen-Synchronisation.',
  aktualisiert: '2026-10-06',
  abschnitte: [
    {
      anker: 'oauth',
      titel: 'Discord OAuth',
      blocks: [
        {
          art: 'absatz',
          text: 'Es gibt keine eigenen Passwörter. Angemeldet wird über Discord OAuth; `packages/auth` tauscht den Code gegen ein Token, liest Konto und Gildenmitgliedschaft und legt eine Sitzung an.',
        },
        {
          art: 'fluss',
          stationen: [
            { label: 'Discord OAuth', detail: 'Zustimmung' },
            { label: 'Code → Token', detail: 'serverseitig' },
            { label: 'Konto & Rollen', detail: 'aus der Gilde' },
            { label: 'Session', detail: 'Cookie, httpOnly' },
          ],
        },
      ],
    },
    {
      anker: 'session',
      titel: 'Sitzung und Kontext',
      blocks: [
        {
          art: 'liste',
          punkte: [
            'Die Sitzung liegt in der Datenbank (`Session`), im Browser nur eine Kennung als `httpOnly`-Cookie.',
            'Abgelaufene Sitzungen räumt ein Job des Bots weg (`purgeExpiredSessions`).',
            'Der `AuthContext` trägt Konto, aufgelöste Rollen-IDs und die daraus berechneten Berechtigungsschlüssel.',
            'CSRF: `csrfTokenFor(context)` gibt den Token, `defineAction` prüft ihn. Jede Komponente, die eine Aktion aufruft, bekommt ihn als Prop.',
          ],
        },
      ],
    },
    {
      anker: 'spiegel',
      titel: 'Der Mitgliederspiegel',
      blocks: [
        {
          art: 'absatz',
          text: '`DiscordMemberCache` ist die Abbildung der Servermitglieder: Anzeigename, Benutzername, Avatar, Rollen. Der Bot hält sie über den Discord-Abgleich aktuell.',
        },
        {
          art: 'hinweis',
          ton: 'info',
          text: 'Wichtig für Auswahlfelder: wer sich nie angemeldet hat, hat kein `User`-Konto, steht aber im Spiegel. Eine Suche nur über angemeldete Benutzer findet auf einem Server, dessen Mitglieder die WebApp kaum öffnen, fast niemanden. `traegerSuche` sucht deshalb im Spiegel und prüft die Berechtigung an den Rollen, die dort stehen.',
        },
        {
          art: 'felder',
          eintraege: [
            {
              name: 'traegerDerBerechtigung(key)',
              text: '«Wer alles darf das?» - Grundmenge sind die angemeldeten Benutzer, bei 200 gedeckelt.',
            },
            {
              name: 'traegerSuche(keys, suche)',
              text: '«Wer passt zu diesem Suchbegriff und darf das?» - Grundmenge ist der Mitgliederspiegel.',
            },
            {
              name: 'traegerPruefung(ids, keys)',
              text: '«Von diesen benannten Leuten - wer darf?» Für eine bekannte Liste, etwa die Beteiligten eines Projekts.',
            },
          ],
        },
      ],
    },
  ],
};

export const secrets: DokuSeite = {
  slug: 'secrets',
  titel: 'Secrets & Environment',
  kurz: 'Welche Kategorien von Umgebungsvariablen es gibt, wie Zugangsdaten verschlüsselt liegen - ohne Werte.',
  aktualisiert: '2026-10-06',
  abschnitte: [
    {
      anker: 'kategorien',
      titel: 'Kategorien',
      blocks: [
        {
          art: 'hinweis',
          ton: 'achtung',
          titel: 'Keine Werte',
          text: 'Diese Seite nennt Namen und Zweck. Werte stehen in der Umgebung des Servers und nirgends sonst - nicht in dieser Doku, nicht im Repository, nicht in einem Log.',
        },
        {
          art: 'tabelle',
          kopf: ['Kategorie', 'Beispiele (Namen)', 'Wofür'],
          zeilen: [
            ['Datenbank', '`DATABASE_URL`', 'Verbindung für Prisma'],
            [
              'Discord',
              '`DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`',
              'Gateway, REST, OAuth',
            ],
            [
              'Verschlüsselung',
              '`MASTER_ENCRYPTION_KEY`',
              'Schlüssel, mit dem Integrations-Secrets in der Datenbank verschlüsselt sind',
            ],
            ['Notzugang', '`SWISSHUB_OWNER_DISCORD_ID`', 'Das Konto, das in jedem Fall Vollzugriff behält'],
            ['Ablage', '`SWISSHUB_UPLOAD_DIR`', 'Verzeichnis für hochgeladene Dateien'],
            ['Betrieb', '`PORT`, Intervalle der Jobs', 'Laufzeitverhalten'],
          ],
        },
      ],
    },
    {
      anker: 'integrationen',
      titel: 'Verschlüsselte Integrations-Secrets',
      blocks: [
        {
          art: 'absatz',
          text: 'Zugangsdaten für Anbieter - Zahlungen, AI, Twitch, YouTube, SMTP - stehen nicht in der Umgebung, sondern verschlüsselt in der Datenbank. Der Katalog in `@swisshub/secrets` beschreibt jedes Feld und kennzeichnet, welches davon geheim ist.',
        },
        {
          art: 'liste',
          punkte: [
            'Verschlüsselt mit `MASTER_ENCRYPTION_KEY`. Ohne diesen Schlüssel sind die Werte in einem Backup wertlos - das ist der Zweck.',
            'Ein als `secret: true` gekennzeichnetes Feld wird **nie** zurückgelesen. Die Oberfläche zeigt «gesetzt» oder «nicht gesetzt», niemals den Wert.',
            'Der Katalog ist zugleich der Test: eine Liste in `integrations-security.test.ts` zählt alle Geheimnisse auf, damit kein neues unbemerkt als öffentlich durchrutscht.',
          ],
        },
      ],
    },
    {
      anker: 'nie-loggen',
      titel: 'Was niemals in ein Log gehört',
      blocks: [
        {
          art: 'hinweis',
          ton: 'achtung',
          text: 'Tokens, Schlüssel, Passwörter, OAuth-Codes, der Inhalt eines `secret`-Feldes. Auch nicht «nur zur Fehlersuche» und auch nicht abgekürzt.',
        },
        {
          art: 'absatz',
          text: 'Bei Integrationen wird deshalb der **Zustand** protokolliert und nicht die Eingabe: nach dem Schreiben wird die Konfiguration gelesen und daraus der Audit-Eintrag gebildet. Schriebe man den Eingabewert, stünde zwischen einem API-Schlüssel und dem Audit Log nur noch eine `if`-Abfrage auf den Feldnamen.',
        },
      ],
    },
  ],
};

export const media: DokuSeite = {
  slug: 'media',
  titel: 'Media & Uploads',
  kurz: 'Eine Pipeline für alle Uploads: Prüfung über Magic Bytes, serverseitiger Dateiname, persistentes Verzeichnis.',
  aktualisiert: '2026-10-06',
  abschnitte: [
    {
      anker: 'pipeline',
      titel: 'Die Pipeline',
      blocks: [
        {
          art: 'fluss',
          stationen: [
            { label: 'Route Handler', detail: 'Sitzung, CSRF, Limit, Recht' },
            { label: 'storeLogoUpload', detail: 'Format, Grösse, Maße' },
            { label: 'UPLOAD_DIR', detail: 'Datei mit erzeugtem Namen' },
            { label: 'Datenbank', detail: 'nur die Referenz' },
          ],
        },
        {
          art: 'absatz',
          text: 'Zentral in `packages/modules/src/branding/storage.ts`. Uploads laufen über Route Handler und nicht über Server Actions - es werden Dateien übertragen. Die Sicherheitskette bleibt dieselbe: Sitzung, Mitgliedschaft, CSRF, Rate Limit, Berechtigung.',
        },
      ],
    },
    {
      anker: 'pruefung',
      titel: 'Was geprüft wird',
      blocks: [
        {
          art: 'liste',
          punkte: [
            '**Magic Bytes**, nicht die Endung und nicht der gemeldete MIME-Typ. `detectImageFormat` liest die ersten Bytes - eine `.png`, die keine ist, fällt hier durch.',
            '**Grösse** und **Maße** gegen Grenzen je Upload-Art (`maxBytes`, `minSize`, `maxSize`).',
            '**Der Dateiname wird erzeugt**, nie übernommen: `<art>-<32 hex>.<ext>`. `assertSafeFileName` prüft ihn beim Ausliefern noch einmal gegen dasselbe Muster.',
          ],
        },
        {
          art: 'hinweis',
          ton: 'achtung',
          text: 'Niemals `/tmp`, keine Browser-Blobs, keine Container-Pfade als Ablage. `blob:`-Adressen leben so lange wie der Tab; als Vorschau sind sie bequem, als Persistenz sind sie ein Fehler.',
        },
      ],
    },
    {
      anker: 'referenzen',
      titel: 'Referenz, nicht Datei',
      blocks: [
        {
          art: 'absatz',
          text: 'In der Datenbank steht der Dateiname, nicht der Inhalt. Dasselbe Muster überall: Branding-Logo, XP-Slot-Symbole und -Klänge, Social-Media-Assets, Ticket-Anhänge.',
        },
        {
          art: 'hinweis',
          ton: 'wichtig',
          titel: 'Ein Feld, ein Schreiber',
          text: 'Ein Medienfeld darf nur **eine** Stelle schreiben. Beim XP-Slot schrieben zwei Oberflächen dieselbe Zeile; wer ein Symbol hochlud und danach anderswo speicherte, schrieb den Stand vom Seitenaufbau zurück - und weil die verdrängte Datei mitgelöscht wurde, war die neue weg. Jetzt besitzt `setzeSymbolbild` das Bild allein.',
        },
      ],
    },
    {
      anker: 'ausliefern',
      titel: 'Ausliefern und Cache',
      blocks: [
        {
          art: 'liste',
          punkte: [
            'Ein eigener Route Handler je Bereich liest die Datei, prüft den Namen und setzt den Inhaltstyp ausdrücklich plus `X-Content-Type-Options: nosniff`.',
            'Berechtigungen gelten auch hier: interne Assets hängen an der Leseberechtigung ihres Moduls.',
            'Der Cache braucht keinen Kunstgriff: der Dateiname enthält 32 zufällige Zeichen. Ein neues Bild heisst anders, ein alter Cache kann es nicht treffen.',
          ],
        },
      ],
    },
  ],
};
