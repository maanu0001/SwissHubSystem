import type { DokuSeite } from '../../typen';

export const moderation: DokuSeite = {
  slug: 'moderation',
  titel: 'Moderation',
  kurz: 'Massnahmen, Jail, Notizen und Verifikation - was es gibt und wer es darf.',
  aktualisiert: '2026-10-06',
  abschnitte: [
    {
      anker: 'massnahmen',
      titel: 'Welche Massnahmen es gibt',
      blocks: [
        {
          art: 'tabelle',
          kopf: ['Massnahme', 'Wirkung', 'Umkehrbar'],
          zeilen: [
            [
              'Timeout / Mute',
              'Die Person kann eine Zeit lang nicht schreiben oder sprechen.',
              'Ja, läuft von selbst ab',
            ],
            ['Kick', 'Die Person verlässt den Server und kann wieder beitreten.', 'Kein Zurücknehmen nötig'],
            ['Ban', 'Die Person kann nicht wieder beitreten.', 'Ja, über Entbannung'],
            [
              'Jail',
              'Die Person behält den Zugang, sieht aber nur noch den Jail-Bereich.',
              'Ja, mit Ende oder von Hand',
            ],
          ],
        },
        {
          art: 'hinweis',
          ton: 'wichtig',
          text: 'Jede Massnahme wird protokolliert: wer, wann, gegen wen, mit welcher Begründung. Das steht im Profil der Person und im Audit Log. Eine Massnahme ohne Begründung ist später für niemanden nachvollziehbar - auch nicht für dich.',
        },
      ],
    },
    {
      anker: 'jail',
      titel: 'Jail und Vote-Jail',
      blocks: [
        {
          art: 'absatz',
          text: 'Jail ist die mildere Form einer Sperre: die Person bleibt auf dem Server, sieht aber nur einen eigenen Bereich. Dauer und Grund werden festgehalten.',
        },
        {
          art: 'absatz',
          text: 'Beim **Vote-Jail** stimmt die Community ab. Das ist eine eigene Berechtigung - wer eine Abstimmung starten darf, muss nicht die Strafakte lesen dürfen.',
        },
      ],
    },
    {
      anker: 'notizen',
      titel: 'Notizen',
      blocks: [
        {
          art: 'liste',
          punkte: [
            'Notizen sind interne Vermerke am Profil. Die Person sieht sie nicht.',
            'Sie sind keine Massnahme - sie halten fest, was aufgefallen ist.',
            'Über den Discord-Befehl `/note` lässt sich eine Notiz direkt anlegen.',
          ],
        },
      ],
    },
    {
      anker: 'verifikation',
      titel: 'Verifikation',
      blocks: [
        {
          art: 'absatz',
          text: 'Neue Mitglieder gehen durch die Verifikation, bevor sie den Server benutzen. Das Team sieht die offenen Anträge, prüft und entscheidet. Nach der Entscheidung wird die Nachricht im Verifikationskanal aufgeräumt.',
        },
        {
          art: 'modulknopf',
          href: '/moderation',
          label: 'Moderation öffnen',
          permission: 'moderation.view',
        },
      ],
    },
    {
      anker: 'befehle',
      titel: 'Befehle in Discord',
      blocks: [
        {
          art: 'felder',
          eintraege: [
            { name: '/user', text: 'Zeigt die Infos zu einer Person als Embed - Rollen, Level, Massnahmen.' },
            { name: '/note', text: 'Legt eine Notiz an.' },
          ],
        },
        {
          art: 'hinweis',
          ton: 'info',
          text: 'Beide Befehle antworten nur dir sichtbar. Moderationsdaten gehören nicht in einen offenen Kanal.',
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
              name: '«Keine Berechtigung»',
              text: 'Moderation ausführen ist von Moderation ansehen getrennt. Lesen darfst du, handeln noch nicht.',
            },
            {
              name: 'Die Massnahme greift nicht',
              text: 'Der Bot braucht in Discord selbst die Rechte dafür - und seine Rolle muss über der der Person stehen. Unter System → Bot steht, was fehlt.',
            },
            {
              name: 'Jail wirkt nicht',
              text: 'Prüfen, ob die Jail-Rolle und der Jail-Kanal in den Einstellungen hinterlegt sind.',
            },
          ],
        },
      ],
    },
  ],
};

export const levelSystem: DokuSeite = {
  slug: 'level-system',
  titel: 'Level-System',
  kurz: 'XP, Level, Rangliste und die XP-Spiele - einschliesslich XP-Slot.',
  aktualisiert: '2026-10-06',
  abschnitte: [
    {
      anker: 'wofuer',
      titel: 'Wofür ist das Level-System?',
      blocks: [
        {
          art: 'absatz',
          text: 'Es belohnt Beteiligung. Wer schreibt und im Sprachkanal aktiv ist, sammelt XP und steigt im Level. Ab bestimmten Leveln gibt es Rollen und Profildesigns.',
        },
      ],
    },
    {
      anker: 'xp',
      titel: 'XP und Level',
      blocks: [
        {
          art: 'liste',
          punkte: [
            'XP kommen aus Nachrichten und Sprachzeit. Die Regeln dazu stehen in den Moduleinstellungen.',
            'Meilenstein-Rollen werden automatisch vergeben, wenn ein Level erreicht wird.',
            'Die **Rangliste** zeigt die Besten des Servers; sie ist auch öffentlich erreichbar.',
          ],
        },
      ],
    },
    {
      anker: 'spiele',
      titel: 'XP-Spiele',
      blocks: [
        {
          art: 'felder',
          eintraege: [
            {
              name: 'XP-Vier-Gewinnt',
              text: 'Zwei Personen spielen um einen Einsatz. Pro Zug gilt eine Frist - wer sie verstreichen lässt, verliert.',
            },
            {
              name: 'XP-Glücksrad',
              text: 'Eine Verlosung. Der Bereich erscheint in der Seitenleiste, solange eine läuft - und einen Tag danach.',
            },
            { name: 'XP-Slot', text: 'Ein Spielautomat. Siehe unten.' },
          ],
        },
        {
          art: 'modulknopf',
          href: '/level',
          label: 'Level-System öffnen',
          permission: 'level.view',
        },
      ],
    },
    {
      anker: 'xp-slot',
      titel: 'XP-Slot',
      blocks: [
        {
          art: 'absatz',
          text: 'Der Einsatz sind XP, der Gewinn sind XP. Das Ergebnis wird auf dem Server gezogen - die Animation zeigt nur, was schon entschieden ist. Ein Abbruch der Animation ändert nichts am Ergebnis.',
        },
      ],
      unter: [
        {
          anker: 'xp-slot-spielen',
          titel: 'Spielen',
          blocks: [
            {
              art: 'liste',
              punkte: [
                '**Einsatz wählen**, dann drehen. Zehn Gewinnlinien werden ausgewertet.',
                '**Freispiele** kommen aus dem Spiel oder werden vom Team vergeben.',
                '**Bonusrunde** bei genügend Scatter-Symbolen.',
                '**Gamble**: nach einem Gewinn kann man ihn riskieren. Das Rad entscheidet der Server.',
                '**Big Win / Mega Win / Jackpot** sind Einblendungen ab bestimmten Gewinnhöhen.',
                '**Premium-Symbol**: gewinnt Premium-Tage statt XP.',
              ],
            },
          ],
        },
        {
          anker: 'xp-slot-verwalten',
          titel: 'Verwalten',
          blocks: [
            {
              art: 'absatz',
              text: 'Die Verwaltung braucht eine eigene Berechtigung. Dort gibt es Reiter für Symbole, Auszahlungen, Freispiele, Design, Sounds, Statistik, Historie und Einstellungen.',
            },
            {
              art: 'felder',
              eintraege: [
                {
                  name: 'Symbole',
                  text: 'Name, Gewichtung, Auszahlungen und ein eigenes Bild. Ein Upload ist **sofort gespeichert** - es braucht keinen zweiten Klick.',
                },
                {
                  name: 'Sounds',
                  text: 'Je Klangslot eine eigene Datei. Ohne eigene Datei gilt der mitgelieferte Klang.',
                },
                {
                  name: 'Testmodus',
                  text: 'Spins ohne Folgen: kein XP, kein Eintrag in der Statistik. Zum Ausprobieren von Einstellungen.',
                },
                {
                  name: 'Wartungsmodus',
                  text: 'Der Automat ist für Mitglieder zu. Die Administration kommt weiter hinein.',
                },
                {
                  name: 'Geschenke',
                  text: 'Freispiele oder Bonusrunden an eine Person vergeben - gesucht wird über die Benutzersuche.',
                },
              ],
            },
            {
              art: 'hinweis',
              ton: 'achtung',
              text: 'Gewichtungen und Auszahlungen bestimmen, wie viel der Automat ausschüttet. Wird die Einstellung unspielbar, lehnt das Speichern ab und sagt, warum. Das ist kein Fehler, sondern der Schutz davor, den Automaten unbrauchbar zu machen.',
            },
            {
              art: 'modulknopf',
              href: '/level/xp-slot/verwaltung',
              label: 'XP-Slot Verwaltung öffnen',
              permission: 'level.xpslot.manage',
            },
          ],
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
              name: 'Ein Mitglied kann nicht spielen',
              text: 'Die Berechtigung «XP-Slot spielen» muss seiner Rolle zugewiesen sein. Unter Server → Berechtigungen.',
            },
            {
              name: 'Das neue Symbolbild erscheint nicht',
              text: 'Nach dem Upload die Seite neu laden. Erscheint es dann nicht, war die Datei kein gültiges PNG oder WEBP.',
            },
            {
              name: 'Kein Ton',
              text: 'Browser spielen Ton erst nach einer Interaktion. Einmal irgendwo klicken.',
            },
          ],
        },
      ],
    },
  ],
};

export const workspace: DokuSeite = {
  slug: 'workspace',
  titel: 'Workspace',
  kurz: 'Projekte und Aufgaben des Teams - mit dem Unterschied zwischen Beteiligten und Sichtbarkeit.',
  aktualisiert: '2026-10-06',
  abschnitte: [
    {
      anker: 'wofuer',
      titel: 'Wofür ist der Workspace?',
      blocks: [
        {
          art: 'absatz',
          text: 'Für die Arbeit des Teams: Projekte planen, Aufgaben verteilen, Fristen im Blick behalten. Nicht für die Community - der Workspace ist intern.',
        },
      ],
    },
    {
      anker: 'projekte',
      titel: 'Projekte',
      blocks: [
        {
          art: 'schritte',
          punkte: [
            {
              titel: 'Projekt erstellen',
              text: 'Name, Beschreibung, Status. Du bist danach automatisch Projektleitung.',
            },
            {
              titel: 'Beteiligte hinzufügen',
              text: 'Über die Personensuche. Beim Hinzufügen wählst du die Funktion: **Projektleitung** oder **Unterstützung**.',
            },
            { titel: 'Sichtbarkeit festlegen', text: 'Wer das Projekt sehen darf - siehe unten.' },
            { titel: 'Aufgaben anlegen', text: 'Innerhalb des Projekts.' },
          ],
        },
      ],
    },
    {
      anker: 'beteiligte-sichtbarkeit',
      titel: 'Beteiligte und Sichtbarkeit sind zwei Dinge',
      blocks: [
        {
          art: 'hinweis',
          ton: 'wichtig',
          text: '**Beteiligte** sagen, wer am Projekt arbeitet - Projektleitung oder Unterstützung. **Sichtbarkeit** sagt, wer das Projekt überhaupt sieht. Jemanden als Beteiligten einzutragen, gibt ihm **nicht** automatisch die Sichtbarkeit; und wer das Projekt sehen darf, ist damit nicht beteiligt.',
        },
        {
          art: 'absatz',
          text: 'Beides wird getrennt eingestellt, weil beides getrennt gebraucht wird: eine Projektleitung, die im Urlaub ist, bleibt eingetragen; ein Projekt für die ganze Administration braucht keine fünfzehn Beteiligten.',
        },
        {
          art: 'absatz',
          text: 'Administration und Moderation sehen **alle** Projekte und Aufgaben, unabhängig von Sichtbarkeit und Beteiligung. Sonst gäbe es Projekte, die niemand mehr aufräumen kann, wenn ihre Beteiligten den Server verlassen.',
        },
      ],
    },
    {
      anker: 'aufgaben',
      titel: 'Aufgaben',
      blocks: [
        {
          art: 'felder',
          eintraege: [
            {
              name: 'Verantwortliche',
              text: 'Alle Beteiligten einer Aufgabe sind verantwortlich - es gibt keine zweite Rolle darunter. Wer die Aufgabe erstellt, ist zuerst eingetragen.',
            },
            { name: 'Priorität', text: 'Steuert die Sortierung in «Meine Aufgaben» und auf dem Board.' },
            { name: 'Status', text: 'Von offen bis erledigt. Auf dem Board durch Verschieben änderbar.' },
            { name: 'Frist', text: 'Löst eine Erinnerung aus, bevor sie abläuft.' },
            { name: 'Kommentare', text: 'Mit Erwähnungen. Eine Erwähnung benachrichtigt die Person.' },
            { name: 'Checklisten, Links, Anhänge', text: 'An der Aufgabe, für alles, was dazugehört.' },
          ],
        },
      ],
    },
    {
      anker: 'ansichten',
      titel: 'Die Ansichten',
      blocks: [
        {
          art: 'felder',
          eintraege: [
            { name: 'Übersicht', text: 'Projekte und Kennzahlen.' },
            {
              name: 'Meine Aufgaben',
              text: 'Nur, wofür du eingetragen bist. Der Ort, an dem man morgens anfängt.',
            },
            { name: 'Board', text: 'Aufgaben in Spalten nach Status, zum Verschieben.' },
            { name: 'Planung', text: 'Zeitliche Sicht mit Meilensteinen.' },
            { name: 'Archiv', text: 'Abgeschlossene Projekte. Weg aus der Liste, aber nicht gelöscht.' },
          ],
        },
        { art: 'modulknopf', href: '/workspace', label: 'Workspace öffnen', permission: 'workspace.view' },
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
              name: '«Darf den Workspace nicht mehr öffnen»',
              text: 'Steht unter einem Beteiligten, der die Berechtigung tatsächlich nicht hat. Dann gehört ihm die Berechtigung gegeben - oder er gehört aus der Liste.',
            },
            {
              name: 'Ein Beteiligter wird nicht gefunden',
              text: 'Gesucht wird unter denen, die den Workspace öffnen dürfen. Wer das nicht darf, erscheint nicht - das ist Absicht: eine Aufgabe für jemanden, der sie nie sieht, ist keine Zuweisung.',
            },
            {
              name: 'Ein Projekt fehlt',
              text: 'Du hast keine Sichtbarkeit darauf. Die Projektleitung kann das ändern.',
            },
          ],
        },
      ],
    },
  ],
};

export const premium: DokuSeite = {
  slug: 'premium',
  titel: 'Premium',
  kurz: 'Was Premium bietet, wie die Administration es vergibt, und was mit Zahlungen zusammenhängt.',
  aktualisiert: '2026-10-06',
  abschnitte: [
    {
      anker: 'wofuer',
      titel: 'Wofür ist Premium?',
      blocks: [
        {
          art: 'absatz',
          text: 'Premium ist ein Status mit Vorteilen - zum Beispiel besondere Profildesigns und das Premium-Stübli. Es läuft über einen Zeitraum und endet, wenn er abläuft.',
        },
      ],
    },
    {
      anker: 'vergeben',
      titel: 'Premium vergeben',
      blocks: [
        {
          art: 'hinweis',
          ton: 'admin',
          text: 'Premium vergeben und entziehen darf nur, wer «Premium verwalten» hat.',
        },
        {
          art: 'schritte',
          punkte: [
            { titel: 'Vergeben öffnen', text: 'Unter Community → Premium, dann der Abschnitt «Vergeben».' },
            { titel: 'Person suchen', text: 'Über die Benutzersuche - nicht über die Discord-Kennung.' },
            { titel: 'Laufzeit wählen', text: 'In Tagen oder bis zu einem Datum.' },
            {
              titel: 'Begründung angeben',
              text: 'Sie steht später im Protokoll. Ohne sie weiss in drei Monaten niemand mehr, warum.',
            },
            {
              titel: 'Vergeben',
              text: 'Der Status gilt sofort; die Discord-Rolle folgt beim nächsten Abgleich.',
            },
          ],
        },
      ],
    },
    {
      anker: 'ablauf',
      titel: 'Laufzeit und Ablauf',
      blocks: [
        {
          art: 'liste',
          punkte: [
            'Läuft die Laufzeit ab, endet Premium von selbst. Es braucht keine Handlung.',
            'Eine zweite Vergabe verlängert, sie ersetzt nicht.',
            'Ein Entzug wirkt sofort und wird protokolliert.',
          ],
        },
      ],
    },
    {
      anker: 'zahlungen',
      titel: 'Zahlungen',
      blocks: [
        {
          art: 'absatz',
          text: 'Premium kann auch gekauft werden, wenn ein Zahlungsanbieter eingerichtet ist. Ist keiner eingerichtet, zeigt die Premium-Seite «Derzeit nicht buchbar» - das ist kein Fehler.',
        },
        {
          art: 'hinweis',
          ton: 'info',
          text: 'Die Einrichtung des Anbieters läuft über System → Integrationen und ist Sache der Administration. Es gibt einen Testmodus und einen Livemodus; im Testmodus wird kein echtes Geld bewegt.',
        },
        {
          art: 'modulknopf',
          href: '/premium/vergeben',
          label: 'Premium vergeben',
          permission: 'premium.grants.view',
        },
      ],
    },
  ],
};

export const socialMedia: DokuSeite = {
  slug: 'social-media',
  titel: 'Social Media',
  kurz: 'Beiträge erstellen und exportieren - Post Creator, SwissHub fragt, Clip of the Week, Wrapped.',
  aktualisiert: '2026-10-06',
  abschnitte: [
    {
      anker: 'wofuer',
      titel: 'Wofür ist dieser Bereich?',
      blocks: [
        {
          art: 'absatz',
          text: 'Er sammelt alles, was nach draussen geht. Exporte aus anderen Modulen landen hier, und im Post Creator entstehen eigene Beiträge.',
        },
      ],
    },
    {
      anker: 'post-creator',
      titel: 'Post Creator',
      blocks: [
        {
          art: 'schritte',
          punkte: [
            {
              titel: 'Typ wählen',
              text: 'Ankündigung, Termin, Ergebnis, Turnierbaum, Spotlight und weitere. Der Typ bestimmt, welche Felder es gibt.',
            },
            {
              titel: 'Design wählen',
              text: 'Sechs Designs. Sie ändern Aussehen, nicht Inhalt - ein Wechsel kostet keine Eingabe.',
            },
            {
              titel: 'Inhalte ausfüllen',
              text: 'Überschrift, Text, Datum, Sponsoren - je nach Typ. Die Vorschau zeigt sofort, wie es aussieht.',
            },
            { titel: 'Bilder und Logo', text: 'Hochladen. Was du hochlädst, ist sofort gespeichert.' },
            {
              titel: 'Speichern',
              text: 'Als Entwurf, oder als fertig markieren. Fertig geht nur, wenn alle nötigen Felder gefüllt sind.',
            },
            { titel: 'Exportieren', text: 'Als PNG in einem Format, oder als ZIP mit allen drei.' },
          ],
        },
        {
          art: 'hinweis',
          ton: 'tipp',
          text: 'Drei Formate: Quadrat, Story und Banner. Derselbe Entwurf trägt in allen drei - du musst nichts doppelt eingeben.',
        },
      ],
    },
    {
      anker: 'weitere',
      titel: 'Die anderen Quellen',
      blocks: [
        {
          art: 'felder',
          eintraege: [
            {
              name: 'SwissHub fragt',
              text: 'Eine Frage an die Community, mit Abstimmung. Das Ergebnis lässt sich als Bild exportieren - Überschrift, Untertitel, Logo und Farbe einstellbar, Stimmenzahl auf Wunsch ausgeblendet.',
            },
            {
              name: 'Clip of the Week',
              text: 'Der Clip-Wettbewerb. Gewinner und Hall of Fame lassen sich teilen.',
            },
            { name: 'SwissHub Wrapped', text: 'Der Jahres- bzw. Periodenrückblick, mit Share Cards.' },
            { name: 'Streamer Hub', text: 'Spotlight-Beiträge für Streamer des Servers.' },
          ],
        },
        {
          art: 'modulknopf',
          href: '/social-media',
          label: 'Social Media öffnen',
          permission: 'socialmedia.view',
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
            { name: '«Fertig» geht nicht', text: 'Es fehlen Pflichtfelder. Der Hinweis nennt sie.' },
            {
              name: 'Ein Bild wird abgelehnt',
              text: 'Nur PNG und WEBP, mit Mindest- und Höchstmass. Ein umbenanntes Bild hilft nicht - geprüft wird der Inhalt.',
            },
            {
              name: 'Der Export sieht anders aus als die Vorschau',
              text: 'Sollte nicht vorkommen - beide benutzen dieselbe Darstellung. Wenn doch, ist es ein Fehler und gehört gemeldet.',
            },
          ],
        },
      ],
    },
  ],
};

export const serverrollen: DokuSeite = {
  slug: 'serverrollen',
  titel: 'Serverrollen',
  kurz: 'Rollen in Gruppen erklären und zur Selbstvergabe freigeben.',
  aktualisiert: '2026-10-06',
  abschnitte: [
    {
      anker: 'wofuer',
      titel: 'Wofür ist dieser Bereich?',
      blocks: [
        {
          art: 'absatz',
          text: 'Damit Mitglieder verstehen, welche Rollen es gibt - und sich manche selbst geben können, ohne zu fragen.',
        },
      ],
    },
    {
      anker: 'gruppen',
      titel: 'Gruppen',
      blocks: [
        {
          art: 'schritte',
          punkte: [
            {
              titel: 'Gruppe anlegen',
              text: 'Name und Beschreibung, zum Beispiel «Spiele» oder «Benachrichtigungen».',
            },
            { titel: 'Spaltenzahl wählen', text: 'Wie breit die Gruppe auf der Seite dargestellt wird.' },
            {
              titel: 'Rollen zuordnen',
              text: 'Jeder Rolle eine Beschreibung geben - ohne sie ist eine Rollenliste nur eine Liste.',
            },
            { titel: 'Reihenfolge festlegen', text: 'Per Sortierung. Was oben steht, wird zuerst gelesen.' },
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
          text: 'Eine Gruppe kann so eingestellt werden, dass nur **eine** ihrer Rollen gleichzeitig gilt. Wer eine zweite wählt, verliert die erste automatisch.',
        },
        {
          art: 'hinweis',
          ton: 'tipp',
          text: 'Gedacht für Angaben, die sich ausschliessen - Geschlecht oder Altersgruppe. Bei «Spiele» wäre es falsch: dort will man mehrere.',
        },
      ],
    },
    {
      anker: 'selbstvergabe',
      titel: 'Selbstvergabe',
      blocks: [
        {
          art: 'liste',
          punkte: [
            'Eine Rolle muss ausdrücklich zur Selbstvergabe freigegeben werden. Das ist eine eigene Berechtigung.',
            'Freigegebene Rollen können Mitglieder auf der öffentlichen Serverrollen-Seite selbst wählen.',
            'In Discord geht es über ein Dropdown im Serverrollen-Embed.',
          ],
        },
      ],
    },
    {
      anker: 'embed',
      titel: 'Discord-Embed',
      blocks: [
        {
          art: 'absatz',
          text: 'Das Embed listet die Gruppen mit Rollen-Erwähnungen und Beschreibungen. Die Vorschau im Dashboard zeigt genau das, was in Discord ankommt.',
        },
        {
          art: 'modulknopf',
          href: '/server/serverrollen',
          label: 'Serverrollen öffnen',
          permission: 'serverrollen.view',
        },
      ],
    },
  ],
};

export const turniere: DokuSeite = {
  slug: 'turniere',
  titel: 'Turniere',
  kurz: 'Turnier anlegen, Anmeldung, Check-in, Brackets und Ergebnisse.',
  aktualisiert: '2026-10-06',
  abschnitte: [
    {
      anker: 'ablauf',
      titel: 'Der Ablauf',
      blocks: [
        {
          art: 'fluss',
          stationen: [
            { label: 'Anlegen', detail: 'Spiel, Modus, Termin' },
            { label: 'Anmeldung', detail: 'Teams oder Einzeln' },
            { label: 'Check-in', detail: 'vor dem Start' },
            { label: 'Bracket', detail: 'Begegnungen' },
            { label: 'Ergebnisse', detail: 'Runde für Runde' },
          ],
        },
      ],
    },
    {
      anker: 'anlegen',
      titel: 'Turnier anlegen',
      blocks: [
        {
          art: 'schritte',
          punkte: [
            { titel: 'Grunddaten', text: 'Name, Spiel, Termin, Modus, Teamgrösse.' },
            { titel: 'Anmeldefenster', text: 'Von wann bis wann angemeldet werden kann.' },
            {
              titel: 'Check-in',
              text: 'Zeitraum vor dem Start, in dem Teams ihre Teilnahme bestätigen. Wer fehlt, rückt nicht ins Bracket.',
            },
            { titel: 'Veröffentlichen', text: 'Erst danach ist das Turnier für die Community sichtbar.' },
          ],
        },
      ],
    },
    {
      anker: 'durchfuehren',
      titel: 'Durchführen',
      blocks: [
        {
          art: 'liste',
          punkte: [
            'Das Bracket entsteht aus den eingecheckten Teams.',
            'Ergebnisse werden je Begegnung eingetragen; die nächste Runde folgt daraus.',
            'Erinnerungen gehen automatisch an die Teilnehmer - vor Anmeldeschluss, vor Check-in und vor dem Start.',
            'Der Verlauf hält fest, wer was geändert hat.',
          ],
        },
        {
          art: 'modulknopf',
          href: '/turniere/uebersicht',
          label: 'Turniere öffnen',
          permission: 'tournaments.view',
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
              name: 'Niemand kann sich anmelden',
              text: 'Ist das Turnier veröffentlicht, und liegt das Anmeldefenster in der Zukunft?',
            },
            {
              name: 'Ein Team fehlt im Bracket',
              text: 'Es hat den Check-in nicht gemacht. Das ist der Zweck des Check-ins.',
            },
            {
              name: 'Das Ergebnis lässt sich nicht ändern',
              text: 'Spätere Runden hängen daran. Zuerst die abhängige Runde zurücksetzen.',
            },
          ],
        },
      ],
    },
  ],
};

export const tickets: DokuSeite = {
  slug: 'tickets',
  titel: 'Tickets',
  kurz: 'Anfragen der Community annehmen, bearbeiten und abschliessen.',
  aktualisiert: '2026-10-06',
  abschnitte: [
    {
      anker: 'wofuer',
      titel: 'Wofür sind Tickets?',
      blocks: [
        {
          art: 'absatz',
          text: 'Für Anfragen, die nicht in einem offenen Kanal stehen sollen. Ein Ticket ist ein Gespräch zwischen der Person und dem Team, mit Verlauf.',
        },
      ],
    },
    {
      anker: 'bearbeiten',
      titel: 'Ein Ticket bearbeiten',
      blocks: [
        {
          art: 'schritte',
          punkte: [
            {
              titel: 'Öffnen',
              text: 'Aus der Liste. Die Zahl in der Seitenleiste zeigt, wie viele offen sind.',
            },
            { titel: 'Übernehmen', text: 'Damit klar ist, wer dran ist.' },
            { titel: 'Antworten', text: 'Im Verlauf. Interne Vermerke sind von Antworten getrennt.' },
            { titel: 'Abschliessen', text: 'Mit Ergebnis. Das Ticket wandert ins Archiv.' },
          ],
        },
      ],
    },
    {
      anker: 'rechte',
      titel: 'Rechte',
      blocks: [
        {
          art: 'absatz',
          text: 'Tickets ansehen gibt es in drei Abstufungen: nur die **eigenen**, die **zugewiesenen**, oder **alle**. Wer nur zugewiesene sieht, sieht die Arbeit, die ihm gehört - und nicht jedes Gespräch auf dem Server.',
        },
        {
          art: 'modulknopf',
          href: '/tickets',
          label: 'Tickets öffnen',
          permission: 'tickets.viewOwn',
        },
      ],
    },
    {
      anker: 'anhaenge',
      titel: 'Anhänge',
      blocks: [
        {
          art: 'hinweis',
          ton: 'wichtig',
          text: 'Anhänge können persönliche Daten enthalten - Screenshots von Gesprächen zum Beispiel. Sie gehören ins Ticket und nirgends sonst hin.',
        },
      ],
    },
  ],
};

export const kommunikation: DokuSeite = {
  slug: 'kommunikation',
  titel: 'Kommunikation',
  kurz: 'Nachrichten, Embeds, Umfragen und Ankündigungen in Discord-Kanäle schicken.',
  aktualisiert: '2026-10-06',
  abschnitte: [
    {
      anker: 'wofuer',
      titel: 'Wofür ist dieser Bereich?',
      blocks: [
        {
          art: 'absatz',
          text: 'Um aus der WebApp heraus etwas in Discord zu veröffentlichen - als gestaltetes Embed statt als getippte Nachricht, mit Vorschau vor dem Absenden.',
        },
      ],
    },
    {
      anker: 'erstellen',
      titel: 'Eine Nachricht erstellen',
      blocks: [
        {
          art: 'schritte',
          punkte: [
            { titel: 'Art wählen', text: 'Nachricht, Embed, Umfrage oder Ankündigung.' },
            {
              titel: 'Inhalt verfassen',
              text: 'Überschrift, Text, Felder. Logo und Farbe lassen sich setzen.',
            },
            { titel: 'Zielkanal wählen', text: 'Aus den Kanälen, in die der Bot schreiben darf.' },
            { titel: 'Vorschau prüfen', text: 'Sie zeigt, was ankommt.' },
            {
              titel: 'Veröffentlichen',
              text: 'Danach steht die Nachricht in Discord. Änderungen gehen über Discord selbst.',
            },
          ],
        },
        {
          art: 'modulknopf',
          href: '/communication',
          label: 'Kommunikation öffnen',
          permission: 'communication.view',
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
              name: 'Ein Kanal fehlt in der Auswahl',
              text: 'Der Bot darf dort nicht schreiben. Das ist eine Discord-Einstellung.',
            },
            {
              name: 'Das Embed sieht anders aus',
              text: 'Discord kürzt zu lange Felder. Die Vorschau zeigt die Grenzen.',
            },
          ],
        },
      ],
    },
  ],
};

export const analytics: DokuSeite = {
  slug: 'analytics',
  titel: 'Analytics',
  kurz: 'Statistiken zu Nachrichten, Sprachzeit und Wachstum - und was dabei zu beachten ist.',
  aktualisiert: '2026-10-06',
  abschnitte: [
    {
      anker: 'wofuer',
      titel: 'Wofür ist Analytics?',
      blocks: [
        {
          art: 'absatz',
          text: 'Um zu sehen, wie sich der Server entwickelt: wie viel geschrieben wird, wie viel im Sprachkanal passiert, wie die Mitgliederzahl wächst.',
        },
        {
          art: 'absatz',
          text: 'Nachrichten und Sprachzeit werden **getrennt** ausgewiesen. Zusammengerechnet wäre die Zahl ohne Bedeutung - eine Stunde im Sprachkanal ist nicht dasselbe wie eine Nachricht.',
        },
      ],
    },
    {
      anker: 'zeitraum',
      titel: 'Zeiträume',
      blocks: [
        {
          art: 'absatz',
          text: 'Jede Ansicht hat einen Zeitfilter. Die Grenzen sind exakt: ein Zeitraum «letzte 7 Tage» endet jetzt und beginnt vor genau sieben Tagen - nicht am Tagesanfang.',
        },
        {
          art: 'modulknopf',
          href: '/analytics',
          label: 'Analytics öffnen',
          permission: 'analytics.view',
        },
      ],
    },
    {
      anker: 'datenschutz',
      titel: 'Hinweise zum Umgang',
      blocks: [
        {
          art: 'hinweis',
          ton: 'wichtig',
          text: 'Die Zahlen beschreiben das Verhalten echter Personen. Für die Arbeit des Teams sind sie da; für Vergleiche einzelner Mitglieder in einem offenen Kanal nicht.',
        },
        {
          art: 'absatz',
          text: 'Nachrichteninhalte sind von Ereignisdaten getrennt. Wer sehen darf, **dass** eine Nachricht gelöscht wurde, darf nicht automatisch ihren Text lesen - dafür gibt es eine eigene Berechtigung.',
        },
      ],
    },
  ],
};

export const musik: DokuSeite = {
  slug: 'musik',
  titel: 'Musik',
  kurz: 'Musik in einem Sprachkanal starten und steuern.',
  aktualisiert: '2026-10-06',
  abschnitte: [
    {
      anker: 'wofuer',
      titel: 'Wofür ist das Musikmodul?',
      blocks: [
        {
          art: 'absatz',
          text: 'Damit in einem Sprachkanal Musik läuft, gesteuert aus der WebApp oder per Befehl in Discord.',
        },
      ],
    },
    {
      anker: 'workerbots',
      titel: 'Workerbots',
      blocks: [
        {
          art: 'absatz',
          text: 'Die Musik spielt nicht der Hauptbot, sondern ein eigener Workerbot. Mehrere Workerbots können gleichzeitig in verschiedenen Kanälen spielen.',
        },
        {
          art: 'hinweis',
          ton: 'info',
          text: 'Ist kein Workerbot frei, muss gewartet werden, bis einer fertig ist. Die Anzahl richtet sich nach der Einrichtung unter System → Integrationen.',
        },
      ],
    },
    {
      anker: 'steuern',
      titel: 'Steuern',
      blocks: [
        {
          art: 'liste',
          punkte: [
            'Abspielen, Überspringen, Lautstärke, Wiederholung und Warteschlange.',
            'Jede Handlung hat ihre eigene Berechtigung - überspringen darf eine andere Rolle als die Sitzung beenden.',
            'Die Worker-Übersicht zeigt, welcher Bot wo ist.',
          ],
        },
        {
          art: 'modulknopf',
          href: '/musik',
          label: 'Musik öffnen',
          permission: 'music.view',
        },
      ],
    },
  ],
};

export const integrationen: DokuSeite = {
  slug: 'integrationen',
  titel: 'Integrationen',
  kurz: 'Verbindungen zu Diensten ausserhalb - und warum dort niemals ein Wert zu sehen ist.',
  aktualisiert: '2026-10-06',
  abschnitte: [
    {
      anker: 'wofuer',
      titel: 'Was sind Integrationen?',
      blocks: [
        {
          art: 'absatz',
          text: 'Zugänge zu Diensten, die nicht Teil von SwissHub System sind: Discord selbst, ein Zahlungsanbieter, ein AI-Anbieter, Twitch, YouTube, E-Mail-Versand.',
        },
        {
          art: 'hinweis',
          ton: 'admin',
          text: 'Nur die Administration. Ein falsch gesetzter Bot-Token nimmt den Bot vom Netz; ein gelöschtes OAuth-Geheimnis sperrt alle aus dem Dashboard aus.',
        },
      ],
    },
    {
      anker: 'werte',
      titel: 'Werte sieht niemand',
      blocks: [
        {
          art: 'hinweis',
          ton: 'wichtig',
          text: 'Ein Geheimnis lässt sich **setzen** und **löschen**, aber nicht lesen. Die Oberfläche zeigt «gesetzt» oder «nicht gesetzt» - auch der Administration. Das ist Absicht: ein Wert, den man anzeigen kann, kann man auch versehentlich weitergeben.',
        },
      ],
    },
    {
      anker: 'testen',
      titel: 'Verbindung testen',
      blocks: [
        {
          art: 'schritte',
          punkte: [
            { titel: 'Anbieter wählen', text: 'Jeder Dienst hat seinen eigenen Abschnitt.' },
            { titel: 'Felder ausfüllen', text: 'Nicht geheime Einstellungen und die Geheimnisse getrennt.' },
            {
              titel: 'Verbindung testen',
              text: 'Der Test sagt, ob die Zugangsdaten angenommen werden - ohne etwas zu verändern.',
            },
            {
              titel: 'Modus setzen',
              text: 'Bei Zahlungen: Testmodus oder Livemodus. Im Testmodus wird kein echtes Geld bewegt.',
            },
          ],
        },
        {
          art: 'modulknopf',
          href: '/system/integrationen',
          label: 'Integrationen öffnen',
          permission: 'integrations.view',
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
              name: 'Der Test schlägt fehl',
              text: 'Zugangsdaten vom Anbieter neu holen. Abgelaufene Schlüssel sehen gültig aus.',
            },
            {
              name: 'Premium ist nicht buchbar',
              text: 'Kein Zahlungsanbieter eingerichtet oder der Modus steht aus.',
            },
            {
              name: 'Nach dem Ändern wirkt nichts',
              text: 'Manche Zugangsdaten liest der Bot beim Start. Dann braucht er einen Neustart.',
            },
          ],
        },
      ],
    },
  ],
};
