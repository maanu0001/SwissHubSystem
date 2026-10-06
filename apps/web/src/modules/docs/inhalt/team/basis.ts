import type { DokuSeite } from '../../typen';

/**
 * Team-Dokumentation: Grundlagen und Community-Bereiche.
 *
 * Sprache: Deutsch, ohne Fachbegriffe aus dem Code. Wer diese Seiten liest,
 * will wissen, wie er etwas erledigt - nicht, wie es gebaut ist. Jede
 * Modulseite folgt derselben Gliederung: wofür, wer darf, so benutzt du es,
 * häufige Aufgaben, Hinweise, häufige Fehler.
 */

export const ersteSchritte: DokuSeite = {
  slug: 'erste-schritte',
  titel: 'Erste Schritte',
  kurz: 'Wie du dich anmeldest, was du siehst und wie du dich zurechtfindest.',
  aktualisiert: '2026-10-06',
  abschnitte: [
    {
      anker: 'anmelden',
      titel: 'Anmelden',
      blocks: [
        {
          art: 'absatz',
          text: 'Die Anmeldung läuft über Discord. Es gibt kein eigenes Passwort. Du klickst «Mit Discord anmelden», bestätigst in Discord, und bist drin.',
        },
        {
          art: 'hinweis',
          ton: 'info',
          text: 'Was du sehen und tun darfst, hängt an deinen **Discord-Rollen**. Ändert sich deine Rolle, ändert sich auch, was dir SwissHub System zeigt - meistens sofort, spätestens nach einer Neuanmeldung.',
        },
      ],
    },
    {
      anker: 'zurechtfinden',
      titel: 'Sich zurechtfinden',
      blocks: [
        {
          art: 'felder',
          eintraege: [
            {
              name: 'Seitenleiste links',
              text: 'Alle Bereiche, nach Gruppen geordnet: Community, Support & Moderation, Server, System. Du siehst nur, was du öffnen darfst.',
            },
            {
              name: 'Kopfzeile',
              text: 'Titel des Bereichs, die Glocke für Benachrichtigungen und dein Konto.',
            },
            {
              name: 'Schnellnavigation',
              text: 'Ein Suchfeld über alle Bereiche. Schneller als Klicken, wenn du weisst, wohin du willst.',
            },
            { name: 'Auf dem Telefon', text: 'Die Seitenleiste wird zum Menü oben links.' },
          ],
        },
      ],
    },
    {
      anker: 'nicht-sichtbar',
      titel: 'Ein Bereich fehlt dir?',
      blocks: [
        {
          art: 'liste',
          punkte: [
            'Du hast die Berechtigung nicht. Frag die Administration - sie kann sie deiner Rolle geben.',
            'Das Modul ist abgeschaltet. Dann sieht es niemand.',
            'Das Modul läuft im Testmodus. Dann sehen es nur Teammitglieder mit der entsprechenden Berechtigung.',
          ],
        },
        {
          art: 'hinweis',
          ton: 'tipp',
          text: 'Wenn du einen Link bekommst, den du nicht öffnen darfst, siehst du eine Hinweisseite statt eines Fehlers. Das ist kein Defekt - dir fehlt die Berechtigung dafür.',
        },
      ],
    },
  ],
};

export const dashboard: DokuSeite = {
  slug: 'dashboard',
  titel: 'Dashboard',
  kurz: 'Die Startseite: Zustand des Servers, offene Arbeit, Schnellaktionen.',
  aktualisiert: '2026-10-06',
  abschnitte: [
    {
      anker: 'wofuer',
      titel: 'Wofür ist das Dashboard?',
      blocks: [
        {
          art: 'absatz',
          text: 'Es beantwortet eine Frage: gibt es gerade etwas zu tun? Darum stehen dort Zahlen, die eine Handlung auslösen können - offene Tickets, laufende Massnahmen, der Zustand des Bots - und nicht Zahlen, die nur interessant sind.',
        },
      ],
    },
    {
      anker: 'wer',
      titel: 'Wer kann es benutzen?',
      blocks: [
        {
          art: 'absatz',
          text: 'Jede Rolle mit der Berechtigung «Dashboard ansehen». Die Kacheln selbst richten sich nach deinen weiteren Berechtigungen: wer keine Tickets sehen darf, sieht die Ticket-Kachel nicht.',
        },
      ],
    },
    {
      anker: 'benutzen',
      titel: 'So benutzt du es',
      blocks: [
        {
          art: 'liste',
          punkte: [
            'Kacheln sind anklickbar und führen in den jeweiligen Bereich.',
            'Zahlen neben einem Bereich in der Seitenleiste zeigen offene Arbeit - zum Beispiel die Anzahl offener Tickets.',
            'Die Glocke in der Kopfzeile zeigt, was dich persönlich betrifft: Erwähnungen, zugewiesene Aufgaben, Fristen.',
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
              name: 'Eine Kachel fehlt',
              text: 'Dir fehlt die Berechtigung für den Bereich dahinter. Das Dashboard zeigt nur, was du öffnen darfst.',
            },
            {
              name: 'Der Bot steht auf «offline»',
              text: 'Dann meldet sich der Bot nicht mehr. Das ist etwas für die Administration - unter System → Bot steht mehr dazu.',
            },
            {
              name: 'Eine Zahl stimmt nicht',
              text: 'Zahlen werden beim Aufruf der Seite gelesen. Ein Neuladen holt den aktuellen Stand.',
            },
          ],
        },
      ],
    },
  ],
};

export const mitglieder: DokuSeite = {
  slug: 'mitglieder',
  titel: 'Mitglieder',
  kurz: 'Mitglieder finden, Profile lesen, Rollen und Aktivität sehen.',
  aktualisiert: '2026-10-06',
  abschnitte: [
    {
      anker: 'wofuer',
      titel: 'Wofür ist dieser Bereich?',
      blocks: [
        {
          art: 'absatz',
          text: 'Um eine Person zu finden und zu sehen, was über sie bekannt ist: Rollen, Level, Aktivität, Premium, Tickets, Moderationseinträge. Ein Ort statt sechs.',
        },
      ],
    },
    {
      anker: 'wer',
      titel: 'Wer kann es benutzen?',
      blocks: [
        {
          art: 'absatz',
          text: 'Der Bereich braucht «Mitglieder ansehen». **Was** du im Profil siehst, ist aber fein abgestuft: für jeden Abschnitt gibt es eine eigene Berechtigung.',
        },
        {
          art: 'tabelle',
          kopf: ['Abschnitt', 'Du siehst ihn, wenn du darfst'],
          zeilen: [
            ['Grunddaten', 'Mitglieder ansehen'],
            ['Rollen', 'Rollen eines Mitglieds ansehen'],
            ['Level & XP', 'Level eines Mitglieds ansehen'],
            ['Aktivität', 'Aktivität ansehen'],
            ['Tickets', 'Tickets ansehen (eigene, zugewiesene oder alle)'],
            ['Moderation', 'Moderationshistorie ansehen'],
            ['Premium', 'Premium-Stand ansehen'],
            ['Notizen', 'Notizen ansehen'],
          ],
        },
        {
          art: 'hinweis',
          ton: 'info',
          text: 'Manche Berechtigungen gibt es in drei Abstufungen: nur die **eigenen** Daten, die **zugewiesenen**, oder **alle**. Das ist Absicht - ein Moderator braucht nicht alles zu sehen, um seine Arbeit zu tun.',
        },
      ],
    },
    {
      anker: 'benutzen',
      titel: 'So benutzt du es',
      blocks: [
        {
          art: 'schritte',
          punkte: [
            { titel: 'Mitglieder öffnen', text: 'In der Seitenleiste unter «Support & Moderation».' },
            {
              titel: 'Suchen',
              text: 'Name, Benutzername oder Discord-Kennung. Die Suche findet auch Mitglieder, die sich hier nie angemeldet haben.',
            },
            { titel: 'Profil öffnen', text: 'Ein Klick auf den Namen. Die Abschnitte stehen untereinander.' },
          ],
        },
      ],
    },
    {
      anker: 'aufgaben',
      titel: 'Häufige Aufgaben',
      blocks: [
        {
          art: 'felder',
          eintraege: [
            { name: 'Jemanden suchen', text: 'Suchfeld oben. Zwei Zeichen genügen.' },
            {
              name: 'Rollen prüfen',
              text: 'Im Profil unter «Rollen». Geändert werden sie in Discord oder unter Serverrollen.',
            },
            {
              name: 'Notiz hinterlassen',
              text: 'Im Profil, wenn du «Notizen erstellen» darfst. Notizen sieht nur das Team.',
            },
            {
              name: 'Zum Discord-Profil',
              text: 'Der Knopf im Profilkopf. Daneben lässt sich die Kennung kopieren.',
            },
          ],
        },
      ],
    },
    {
      anker: 'datenschutz',
      titel: 'Hinweise',
      blocks: [
        {
          art: 'hinweis',
          ton: 'wichtig',
          text: 'Was du hier siehst, sind Daten echter Personen. Sie gehören in die Arbeit des Teams und nicht in ein Gespräch ausserhalb. Besonders: Moderationseinträge, Notizen und Aktivitätsdaten.',
        },
        {
          art: 'modulknopf',
          href: '/members',
          label: 'Mitglieder öffnen',
          permission: 'members.view',
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
              name: 'Ein Abschnitt fehlt',
              text: 'Dir fehlt die Berechtigung dafür. Das Profil zeigt nur, was du sehen darfst.',
            },
            {
              name: 'Jemand wird nicht gefunden',
              text: 'Hat die Person den Server verlassen? Ausgetretene Mitglieder erscheinen nicht in der Liste.',
            },
            {
              name: 'Veraltete Rollen',
              text: 'Der Abgleich mit Discord läuft regelmässig. Unter System → Discord-Sync lässt er sich anstossen.',
            },
          ],
        },
      ],
    },
  ],
};
