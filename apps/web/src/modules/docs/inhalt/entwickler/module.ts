import type { DokuSeite } from '../../typen';

export const moduleUebersicht: DokuSeite = {
  slug: 'module',
  titel: 'Module',
  kurz: 'Wie ein Modul aufgebaut ist, und welche 31 es tatsächlich gibt.',
  aktualisiert: '2026-10-06',
  abschnitte: [
    {
      anker: 'aufbau',
      titel: 'Wie ein Modul aufgebaut ist',
      blocks: [
        {
          art: 'absatz',
          text: 'Jedes Modul ist ein Verzeichnis unter `packages/modules/src/<modul>/` plus - wenn es eine Oberfläche hat - eines unter `apps/web/src/modules/<modul>/`.',
        },
        {
          art: 'felder',
          eintraege: [
            {
              name: 'config.ts',
              text: 'Die Moduldefinition: `registerModule({ … })` mit Berechtigungskatalog, Navigationseinträgen, Einstellungsfeldern und Gesundheitsprüfungen.',
            },
            {
              name: 'Logikdateien',
              text: 'Die Fachlogik, nach Thema geschnitten. Rein rechnende Teile getrennt von denen, die schreiben - das ist der Grund, aus dem Spiellogik ohne Datenbank testbar ist.',
            },
            {
              name: 'apps/web/.../actions.ts',
              text: 'Die Server Actions des Moduls, alle über `defineAction`.',
            },
            {
              name: 'apps/web/.../components/',
              text: 'Die Oberfläche. Server Components für Daten, Client Components für Interaktion.',
            },
          ],
        },
        {
          art: 'hinweis',
          ton: 'info',
          text: 'Aus der Registrierung entstehen Seitenleiste, Modulübersicht, Berechtigungsmatrix und Einstellungsmasken von selbst. Wer dort etwas von Hand nachträgt, hat die Registrierung unvollständig gemacht.',
        },
      ],
    },
    {
      anker: 'liste',
      titel: 'Die Module',
      blocks: [
        {
          art: 'absatz',
          text: 'Aus der Modulregistry gelesen. «Kern» bedeutet: nicht abschaltbar. Die Zahl nennt die Berechtigungen des Moduls.',
        },
        {
          art: 'tabelle',
          kopf: ['Modul', 'ID', 'Prefix', 'Rechte', 'Art'],
          zeilen: [
            ['Dashboard', '`dashboard`', '`dashboard`', '1', 'Kern'],
            ['Mitglieder', '`members`', '`members`', '27', 'Kern'],
            ['Moderation', '`moderation`', '`moderation`', '12', 'Kern'],
            ['Server', '`server`', '`settings`', '0', 'Kern'],
            ['Audit Log', '`audit`', '`audit`', '1', 'Kern'],
            ['Module', '`modules`', '`modules`', '1', 'Kern'],
            ['Einstellungen', '`settings`', '`settings`', '14', 'Kern'],
            ['Jail', '`jail`', '`jail`', '10', 'Modul'],
            ['Kommunikation', '`communication`', '`communication`', '11', 'Modul'],
            ['Premium', '`premium`', '`premium`', '12', 'Modul'],
            ['Musik', '`music`', '`music`', '15', 'Modul'],
            ['Tickets', '`tickets`', '`tickets`', '26', 'Modul'],
            ['Level-System', '`level`', '`level`', '34', 'Modul'],
            ['Turniere', '`tournaments`', '`tournaments`', '31', 'Modul'],
            ['Voice Hub', '`voiceHub`', '`voiceHub`', '12', 'Modul'],
            ['Analytics', '`analytics`', '`analytics`', '6', 'Modul'],
            ['Community-Kalender', '`calendar`', '`calendar`', '22', 'Modul'],
            ['Verifikation', '`verification`', '`verification`', '7', 'Modul'],
            ['Automationen', '`automation`', '`automations`', '11', 'Modul'],
            ['Migrate', '`migration`', '`migration`', '6', 'Modul'],
            ['Entbannungsanträge', '`appeals`', '`appeals`', '12', 'Modul'],
            ['Clip of the Week', '`clips`', '`clips`', '8', 'Modul'],
            ['Community Missions', '`missions`', '`missions`', '3', 'Modul'],
            ['SwissHub Wrapped', '`wrapped`', '`wrapped`', '11', 'Modul'],
            ['Was spielen wir?', '`spielwahl`', '`spielwahl`', '5', 'Modul'],
            ['SwissHub fragt', '`fragt`', '`fragt`', '10', 'Modul'],
            ['Emojis', '`emoji`', '`emoji`', '5', 'Modul'],
            ['Serverrollen', '`serverrollen`', '`serverrollen`', '3', 'Modul'],
            ['Social Media', '`socialmedia`', '`socialmedia`', '6', 'Modul'],
            ['Workspace', '`workspace`', '`workspace`', '9', 'Modul'],
            ['Streamer Hub', '`streamer`', '`streamer`', '8', 'Modul'],
          ],
        },
        {
          art: 'hinweis',
          ton: 'info',
          titel: 'Was hier nicht steht',
          text: 'Eine eigene Seite haben die fünf Module, die am meisten Eigenheiten tragen. Für die übrigen ist die genaueste Beschreibung der Quelltext selbst: jede Moduldatei trägt einen Kopfkommentar, der ihren Zweck und die Entscheidungen dahinter erklärt. Diese Doku wiederholt das nicht, sondern zeigt, wo es steht.',
        },
      ],
    },
    {
      anker: 'einzeln',
      titel: 'Module mit eigener Seite',
      blocks: [
        {
          art: 'liste',
          punkte: [
            '[XP-Slot](/system/docs/entwickler/module/xp-slot) - Spielengine, Assets, Performance-Regeln',
            '[Workspace](/system/docs/entwickler/module/workspace) - Beteiligte und Sichtbarkeit',
            '[Premium](/system/docs/entwickler/module/premium) - Entitlements und Zahlungsanbieter',
            '[Social Media](/system/docs/entwickler/module/social-media) - Post Creator und Render-Pipeline',
            '[Serverrollen](/system/docs/entwickler/module/serverrollen) - Gruppen, Selbstvergabe, Embed',
          ],
        },
      ],
    },
  ],
};

export const modulXpSlot: DokuSeite = {
  slug: 'module/xp-slot',
  titel: 'XP-Slot',
  kurz: 'Ein Spielautomat im Level-System: serverseitige Ergebnisse, feste Walzengeometrie, strenge Performance-Regeln.',
  bereich: 'Level-System',
  aktualisiert: '2026-10-06',
  abschnitte: [
    {
      anker: 'einordnung',
      titel: 'Einordnung',
      blocks: [
        {
          art: 'absatz',
          text: 'Der XP-Slot ist Teil des Level-Moduls und kein eigenes Modul. Der Einsatz sind XP, der Gewinn sind XP, und beides geht durch `applyXpWithin` - die einzige Stelle, an der sich ein XP-Stand ändert. Code: `packages/modules/src/level/xpslot/`.',
        },
        {
          art: 'felder',
          eintraege: [
            { name: 'regeln.ts', text: 'Spielfeld, Linien, Ziehung. Rein rechnend.' },
            { name: 'auswertung.ts', text: 'Wie aus einem Spielfeld ein Gewinn wird. Rein rechnend.' },
            { name: 'rtp.ts', text: 'Die Quote, exakt aufgezählt aus derselben Auswertung.' },
            { name: 'spin.ts', text: 'Der Ablauf eines Spins, in einer Transaktion.' },
            { name: 'bonus.ts', text: 'Bonusrunde und Risikoleiter (Gamble).' },
            { name: 'verwaltung.ts', text: 'Alles, was die Verwaltung ändern darf.' },
          ],
        },
      ],
    },
    {
      anker: 'serverseitig',
      titel: 'Das Ergebnis entsteht auf dem Server',
      blocks: [
        {
          art: 'hinweis',
          ton: 'wichtig',
          text: 'Der Browser erfährt das Ergebnis, er erzeugt es nicht. Walzenbild, Gewinnlinien, Freispiele und das Gamble-Rad werden serverseitig gezogen und als fertiger Spin geliefert. Die Animation stellt nur dar, was schon entschieden ist.',
        },
        {
          art: 'absatz',
          text: 'Alles andere wäre manipulierbar: eine Ziehung im Browser ist eine Ziehung, die der Spieler kontrolliert. Die Folge für die Oberfläche ist, dass sie keine Spiellogik enthält - und dass ein Abbruch der Animation («Skip») das Ergebnis nicht ändern kann.',
        },
      ],
    },
    {
      anker: 'spielelemente',
      titel: 'Die Spielelemente',
      blocks: [
        {
          art: 'felder',
          eintraege: [
            {
              name: 'Walzen & Paylines',
              text: 'Feste Geometrie, zehn Gewinnlinien. Die Linien werden aus der echten Geometrie berechnet, nicht aus festen Pixelwerten - sonst wandert das Label bei anderer Walzenbreite.',
            },
            {
              name: 'Wild',
              text: 'Ersetzt Symbole. Sticky Wilds bleiben über Freispiele stehen - serverseitig geführt, nicht nur visuell.',
            },
            { name: 'Scatter / Bonus', text: 'Löst die Bonusrunde aus, unabhängig von Linien.' },
            { name: 'Freispiele', text: 'Pakete mit eigener Zählung. Das Team kann sie vergeben.' },
            {
              name: 'Gamble',
              text: 'Risikoleiter nach einem Gewinn. Das Ergebnis des Rads kommt vom Server.',
            },
            { name: 'Big / Mega / Jackpot', text: 'Overlays ab konfigurierbaren Schwellen.' },
            {
              name: 'Premium-Symbol',
              text: 'Gewinnt Premium-Tage statt XP - der Weg dorthin läuft über das Premium-Modul.',
            },
          ],
        },
      ],
    },
    {
      anker: 'rtp',
      titel: 'RTP',
      blocks: [
        {
          art: 'absatz',
          text: 'Die Ausschüttungsquote wird nicht geschätzt, sondern aus derselben Auswertung exakt aufgezählt. Beim Speichern von Gewichten oder Auszahlungen prüft `speichereSymbol`, ob der Slot spielbar bleibt, und lehnt ab, wenn nicht.',
        },
        {
          art: 'hinweis',
          ton: 'info',
          text: 'Ein Symbolbild ändert die Quote nicht - deshalb prüft `setzeSymbolbild` die RTP absichtlich **nicht**. Sonst hinge ein neues Bild an einer Gewichtung, die jemand anders eingestellt hat.',
        },
      ],
    },
    {
      anker: 'assets',
      titel: 'Symbole und Klänge',
      blocks: [
        {
          art: 'absatz',
          text: 'Mitgelieferte Standard-Assets liegen im Auslieferungsverzeichnis und gelten, solange in der Datenbank keine eigene Referenz steht. Eigene Symbole und Klänge laufen durch die zentrale [Media-Pipeline](/system/docs/entwickler/media).',
        },
        {
          art: 'hinweis',
          ton: 'achtung',
          titel: 'Das Bild hat einen Schreiber',
          text: '`setzeSymbolbild` besitzt `imagePath` und `imageUrl` allein. `speichereSymbol` fasst sie nicht an - und darf es nicht. Zwei Oberflächen bearbeiten dieselbe Zeile (Symbolkarte und Premiumkarte); schickten beide den vollen Datensatz, schrieb die eine den Stand der anderen vom Seitenaufbau zurück.',
        },
        {
          art: 'absatz',
          text: 'Vorschau und Spiel benutzen denselben Auflöser `symbolBild()`. Es gibt keine Vorschau-eigene Quelle - sonst zeigt die Verwaltung etwas anderes als der Automat.',
        },
      ],
    },
    {
      anker: 'performance',
      titel: 'Performance-Regeln',
      blocks: [
        {
          art: 'hinweis',
          ton: 'achtung',
          text: 'Diese Regeln sind nicht Stilfragen. Sie sind das Ergebnis von Messungen auf vier Viewports; wer sie bricht, bringt das Ruckeln zurück.',
        },
        {
          art: 'liste',
          punkte: [
            '**Kein React-Render pro Frame.** Die Animation läuft über direkte Stil-Updates auf Refs, nicht über State.',
            '**Kein Asset-Laden während eines Spins.** Bilder und Klänge werden vorher geladen und dekodiert; ein Decode mitten im Spin ist ein Ruckler.',
            '**Reel Tracks statt Neuaufbau.** Die Walze ist eine lange Spur, die verschoben wird - nicht eine Liste, die neu gezeichnet wird.',
            '**Geometrie zwischenspeichern.** Positionen einmal messen, nicht je Frame.',
            '**Filter nicht auf bewegte Ebenen.** `filter` und `backdrop-filter` auf einem animierten Element kosten auf iOS Safari am meisten.',
            '**Audio über Web Audio mit AudioBuffers**, nicht über `<audio>`-Elemente pro Klang.',
          ],
        },
      ],
    },
    {
      anker: 'verwaltung',
      titel: 'Verwaltung',
      blocks: [
        {
          art: 'liste',
          punkte: [
            'Tabs für Symbole, Paytable, Freispiele, Design, Sounds, Statistik, Historie, Einstellungen und Befehl.',
            '**Testmodus:** Spins ohne Folgen - kein XP, kein Eintrag in der Statistik.',
            '**Wartungsmodus:** der Automat ist für Mitglieder zu, Administration kommt weiter hinein.',
            'Statistik und Historie zeigen Benutzernamen als Links auf das Mitgliederprofil.',
          ],
        },
      ],
    },
  ],
};

export const modulWorkspace: DokuSeite = {
  slug: 'module/workspace',
  titel: 'Workspace',
  kurz: 'Projekte und Aufgaben für das Team - mit der Unterscheidung, die am meisten Verwirrung gestiftet hat.',
  bereich: 'Workspace',
  aktualisiert: '2026-10-06',
  abschnitte: [
    {
      anker: 'modelle',
      titel: 'Modelle',
      blocks: [
        {
          art: 'felder',
          eintraege: [
            { name: 'WorkspaceProject', text: 'Ein Projekt mit Status, Sichtbarkeit und Beteiligten.' },
            {
              name: 'WorkspaceMember',
              text: 'Ein Beteiligter eines Projekts, mit Projektrolle (Projektleitung oder Unterstützung).',
            },
            {
              name: 'WorkspaceTask',
              text: 'Eine Aufgabe mit Priorität, Status, Frist und Verantwortlichen.',
            },
            { name: 'Weiteres', text: 'Kommentare, Checklisten, Links, Anhänge, Meilensteine, Vorlagen.' },
          ],
        },
      ],
    },
    {
      anker: 'beteiligte-sichtbarkeit',
      titel: 'Beteiligte ≠ Sichtbarkeit',
      blocks: [
        {
          art: 'hinweis',
          ton: 'wichtig',
          text: 'Zwei verschiedene Fragen. **Beteiligte** sind Metadaten: wer arbeitet daran, wer leitet, wer unterstützt. **Sichtbarkeit** entscheidet, wer das Projekt überhaupt sieht. Beteiligt zu sein macht niemanden automatisch sichtbarkeitsberechtigt, und wer sichtbarkeitsberechtigt ist, ist nicht beteiligt.',
        },
        {
          art: 'absatz',
          text: 'Die Sichtbarkeit steht am Projekt (`visibility`, bei `SELECTED_GROUPS` zusätzlich die Rollen). Die Filter dafür stehen gesammelt in `packages/modules/src/workspace/sichtbarkeit.ts` und werden von **jeder** Abfrage benutzt - Liste, Detail, Board, Planung, Kennzahlen.',
        },
      ],
    },
    {
      anker: 'zugang',
      titel: 'Zugang und Vollzugriff',
      blocks: [
        {
          art: 'code',
          sprache: 'ts',
          titel: 'apps/web/src/modules/workspace/daten.ts',
          inhalt: `export const WORKSPACE_VOLLZUGRIFF = [
  workspace.WORKSPACE_PERMISSIONS.settingsManage,
  moderation.MODERATION_PERMISSIONS.execute,
];

export const WORKSPACE_ZUGANG = [
  workspace.WORKSPACE_PERMISSIONS.view,
  ...WORKSPACE_VOLLZUGRIFF,
];`,
        },
        {
          art: 'absatz',
          text: '`darfAlles` entscheidet, **welche Zeilen** jemand sieht. `WORKSPACE_ZUGANG` entscheidet, **ob die Seite aufgeht**. Beide Fragen hängen an derselben Menge - hing der Riegel nur an `workspace.view`, kam ein Moderator mit Vollzugriff gar nicht erst hinein, und die Zusage «Moderatoren sehen alle Projekte» galt für eine Seite, die er nicht öffnen konnte.',
        },
      ],
    },
    {
      anker: 'beteiligten-zugang',
      titel: 'Der Zugang eines Beteiligten',
      blocks: [
        {
          art: 'absatz',
          text: 'Die Beteiligtenliste zeigt, wer das Modul öffnen darf. Die Antwort kommt aus `traegerPruefung(kennungen, WORKSPACE_ZUGANG)` - für genau die eingetragenen Kennungen, mit derselben Engine wie der Seitenriegel.',
        },
        {
          art: 'hinweis',
          ton: 'achtung',
          text: 'Nicht aus der Liste der **wählbaren** Personen schliessen. Diese Liste ist bei 200 gedeckelt und nach Anzeigename sortiert; wer dahinter liegt, nicht gespiegelt ist oder den Server verlassen hat, fehlt darin, ohne irgendein Recht verloren zu haben. Genau dieser Fehlschluss liess «darf den Workspace nicht mehr öffnen» unter Namen stehen, die ihn sehr wohl öffnen durften.',
        },
      ],
    },
    {
      anker: 'discord',
      titel: 'Discord-Anbindung',
      blocks: [
        {
          art: 'liste',
          punkte: [
            'Projektereignisse können in einen Projektkanal geschrieben werden - je Projekt einstellbar.',
            'Erwähnungen in Kommentaren lösen Benachrichtigungen aus.',
            'Fristen erinnern über einen Job der Bot-Schleife.',
          ],
        },
      ],
    },
  ],
};

export const modulPremium: DokuSeite = {
  slug: 'module/premium',
  titel: 'Premium',
  kurz: 'Entitlements, Admin-Vergabe und die Abstraktion über Zahlungsanbieter.',
  bereich: 'Premium',
  aktualisiert: '2026-10-06',
  abschnitte: [
    {
      anker: 'modell',
      titel: 'Das Modell',
      blocks: [
        {
          art: 'felder',
          eintraege: [
            {
              name: 'PremiumProduct',
              text: 'Ein buchbares Produkt mit Währung, Laufzeit und Anbieter-Produktkennung.',
            },
            {
              name: 'PremiumSubscription',
              text: 'Der Zustand einer Person: Zeitraum, Kündigung, Kulanzfrist, Discord-Synchronisation.',
            },
            {
              name: 'PremiumGrant',
              text: 'Eine **Handlung** - wer hat wann wem was gegeben oder entzogen. Kein zweites Berechtigungssystem.',
            },
            {
              name: 'PremiumPaymentEvent',
              text: 'Ein Ereignis des Zahlungsanbieters, zur Nachvollziehbarkeit und für Idempotenz.',
            },
          ],
        },
        {
          art: 'hinweis',
          ton: 'wichtig',
          text: 'Ein Bundle ist ein Produkt mit mehreren Ansprüchen - und kein eigener Mechanismus. `PremiumGrant` protokolliert die Vergabe; wer berechtigt ist, entscheidet immer die Subscription. Zwei Quellen für dieselbe Frage liefen beim ersten Sonderfall auseinander.',
        },
      ],
    },
    {
      anker: 'vergabe',
      titel: 'Admin-Vergabe',
      blocks: [
        {
          art: 'liste',
          punkte: [
            'Die Administration kann Premium direkt vergeben und entziehen, mit Laufzeit und Begründung.',
            'Jede Vergabe schreibt einen `PremiumGrant` **und** einen Audit-Eintrag.',
            'Die Person wird per Benutzersuche gewählt, nicht per Kennung - gesucht wird im Mitgliederspiegel.',
          ],
        },
      ],
    },
    {
      anker: 'zahlungen',
      titel: 'Zahlungsanbieter',
      blocks: [
        {
          art: 'absatz',
          text: 'Die Anbindung liegt hinter einer Abstraktion: `packages/modules/src/premium/payments/`. Ein Anbieter implementiert eine Schnittstelle; das Modul kennt keinen Anbieter beim Namen.',
        },
        {
          art: 'fluss',
          stationen: [
            { label: 'Checkout', detail: 'Pfad zum Anbieter' },
            { label: 'Anbieter', detail: 'Zahlung' },
            { label: 'Webhook', detail: 'Ereignis zurück' },
            { label: 'PremiumPaymentEvent', detail: 'Idempotenz' },
            { label: 'Subscription', detail: 'Zustand' },
          ],
        },
        {
          art: 'liste',
          punkte: [
            '**Idempotenz:** ein Ereignis wird an seiner Anbieter-Kennung erkannt. Derselbe Webhook zweimal ändert nichts zweimal - Anbieter liefern erneut, wenn sie keine Bestätigung sehen.',
            '**Testmodus und Livemodus** stehen in der Konfiguration. Ist kein Anbieter eingerichtet, zeigt `/premium` «Derzeit nicht buchbar» statt eines Knopfs, der ins Leere führt.',
            '**Das Geheimnis** des Webhooks und der API-Schlüssel liegen verschlüsselt - siehe [Secrets](/system/docs/entwickler/secrets#integrationen).',
          ],
        },
      ],
    },
  ],
};

export const modulSocialMedia: DokuSeite = {
  slug: 'module/social-media',
  titel: 'Social Media',
  kurz: 'Der Post Creator: eine Render-Quelle, dreizehn Typen, sechs Designs, drei Formate.',
  bereich: 'Social Media',
  aktualisiert: '2026-10-06',
  abschnitte: [
    {
      anker: 'einordnung',
      titel: 'Einordnung',
      blocks: [
        {
          art: 'absatz',
          text: 'Das Social-Media-Modul ist der Arbeitsplatz für Beiträge. Es sammelt die Exporte anderer Module - SwissHub fragt, Clip of the Week, Wrapped, Streamer - und hat im Post Creator einen eigenen Bereich.',
        },
        {
          art: 'hinweis',
          ton: 'info',
          text: 'Ursprünglich besass das Modul **nichts** und zeigte nur fremde Inhalte. Mit dem Post Creator hat es eine eigene Tabelle (`SocialPost`): ein freier Beitrag hat kein Herkunftsmodul, also braucht er einen eigenen Ort. Es bleibt dabei, dass das Modul keine fremden Tabellen schreibt.',
        },
      ],
    },
    {
      anker: 'render',
      titel: 'Eine Render-Quelle',
      blocks: [
        {
          art: 'absatz',
          text: '`post-folie.tsx` ist die einzige Stelle, die einen Beitrag zeichnet. Vorschau und Export laufen durch dieselbe Funktion `zeichnePost(auftrag)` - eine getrennte Export-Variante hiesse, dass die Vorschau etwas anderes zeigt als die Datei.',
        },
        {
          art: 'felder',
          eintraege: [
            { name: 'vorlagen.ts', text: 'Die Typen, Designs, Felder und Masse. Datengetrieben.' },
            {
              name: 'posts.ts',
              text: 'Die Prüfung der Inhalte - `normalisiereInhalt` ist das einzige Tor hinein.',
            },
            { name: 'post-folie.tsx', text: 'Das Zeichnen: Bühne je Format, Gerüst je Inhaltsart.' },
          ],
        },
      ],
    },
    {
      anker: 'pruefung',
      titel: 'Die Inhaltsprüfung',
      blocks: [
        {
          art: 'absatz',
          text: '`normalisiereInhalt(typId, roh)` nimmt die Rohdaten und gibt zurück, was gültig ist. Unbekannte Felder und Felder, die zu diesem Typ nicht gehören, fallen weg - nicht als Fehler, sondern lautlos: ein Typwechsel soll nicht die halbe Eingabe mitnehmen.',
        },
        {
          art: 'liste',
          punkte: [
            'Bildnamen müssen dem Muster der Media-Pipeline entsprechen - `blob:`, `data:` und externe Adressen fallen durch.',
            'Links nur `https`, auf Länge begrenzt.',
            'Datum und Zeit streng geprüft, Farben über die zentrale Farbprüfung.',
            'Ein Turnierbaum speichert nur die Turnierkennung. Die Daten werden beim Zeichnen gelesen, nie kopiert.',
          ],
        },
      ],
    },
    {
      anker: 'formate',
      titel: 'Formate und Export',
      blocks: [
        {
          art: 'liste',
          punkte: [
            'Drei Formate: Quadrat, Story und Banner. Die Masse stehen in `POST_MASSE`.',
            'Export als PNG je Format, oder als ZIP mit allen drei.',
            'Die Bühne skaliert; die Schriftgrössen leiten sich aus einer Grundgrösse ab - deshalb trägt derselbe Entwurf in allen drei Formaten.',
          ],
        },
      ],
    },
  ],
};

export const modulServerrollen: DokuSeite = {
  slug: 'module/serverrollen',
  titel: 'Serverrollen',
  kurz: 'Rollen in Gruppen erklären, zur Selbstvergabe freigeben und als Discord-Embed veröffentlichen.',
  bereich: 'Serverrollen',
  aktualisiert: '2026-10-06',
  abschnitte: [
    {
      anker: 'modelle',
      titel: 'Modelle',
      blocks: [
        {
          art: 'felder',
          eintraege: [
            {
              name: 'ServerRoleCategory',
              text: 'Eine Gruppe: Name, Beschreibung, Reihenfolge, Spaltenzahl - und ob sie exklusiv ist.',
            },
            {
              name: 'ServerRoleMeta',
              text: 'Die Zusatzangaben zu einer Discord-Rolle: Beschreibung, Gruppe, Selbstvergabe. **Kein** Fremdschlüssel auf den Rollen-Zwischenspeicher: der darf geleert und neu aufgebaut werden, ohne diese Angaben mitzunehmen.',
            },
          ],
        },
      ],
    },
    {
      anker: 'exklusiv',
      titel: 'Exklusive Gruppen',
      blocks: [
        {
          art: 'absatz',
          text: 'Eine Gruppe kann so eingestellt sein, dass nur **eine** ihrer Rollen gleichzeitig gilt - Geschlecht oder Altersgruppe zum Beispiel. Wer eine zweite wählt, verliert die erste.',
        },
        {
          art: 'hinweis',
          ton: 'info',
          text: 'Durchgesetzt wird das beim Vergeben, serverseitig. Die Oberfläche stellt es als Auswahl dar - aber die Regel steht im Modul, weil derselbe Weg über das Discord-Dropdown läuft.',
        },
      ],
    },
    {
      anker: 'berechtigungen',
      titel: 'Berechtigungen',
      blocks: [
        {
          art: 'tabelle',
          kopf: ['Schlüssel', 'Erlaubt'],
          zeilen: [
            ['`serverrollen.view`', 'Den Bereich im Dashboard sehen'],
            ['`serverrollen.manage`', 'Gruppen, Beschreibungen und Reihenfolge pflegen'],
            ['`serverrollen.selfservice.manage`', 'Eine Rolle zur Selbstvergabe freigeben'],
          ],
        },
      ],
    },
    {
      anker: 'oeffentlich',
      titel: 'Öffentliche Seite und Embed',
      blocks: [
        {
          art: 'liste',
          punkte: [
            '`/serverrollen` kann öffentlich erreichbar sein - eine Moduleinstellung, nicht hartkodiert.',
            'Das Discord-Embed listet die Gruppen mit Erwähnungen und Beschreibungen; ein Select-Menu erlaubt die Selbstvergabe direkt in Discord.',
            'Das Embed wird in der Modullogik gebaut. Dieselbe Vorschau zeigt das Dashboard - eine zweite Zusammenstellung liefe auseinander.',
          ],
        },
      ],
    },
  ],
};
