import type { DokuSeite } from '../../typen';

/**
 * Architektur, Stack, Abläufe, Routing.
 *
 * Die Inhalte beschreiben den Stand des Repositories und keine Absicht. Wo
 * etwas nur teilweise umgesetzt ist, steht das dort - eine Doku, die mehr
 * verspricht als der Code hält, kostet mehr Zeit als keine.
 */

export const architektur: DokuSeite = {
  slug: 'architektur',
  titel: 'Architektur',
  kurz: 'Wie SwissHub System aufgebaut ist: vier Anwendungen, zehn Pakete, eine Datenbank.',
  aktualisiert: '2026-10-06',
  abschnitte: [
    {
      anker: 'ueberblick',
      titel: 'Überblick',
      blocks: [
        {
          art: 'absatz',
          text: 'SwissHub System ist ein npm-Monorepo. Vier Anwendungen unter `apps/`, zehn gemeinsame Pakete unter `packages/`, eine PostgreSQL-Datenbank. Die Anwendungen teilen sich den Modulkern und die Datenbank; sie reden nicht direkt miteinander.',
        },
        {
          art: 'hinweis',
          ton: 'wichtig',
          text: 'Die Fachlogik liegt in `packages/modules` und **nicht** in den Anwendungen. WebApp und Bot sind zwei Oberflächen auf dieselbe Logik. Wer eine Regel in einer Server Action implementiert, hat sie dem Bot vorenthalten.',
        },
      ],
    },
    {
      anker: 'anwendungen',
      titel: 'Die vier Anwendungen',
      blocks: [
        {
          art: 'felder',
          eintraege: [
            {
              name: 'apps/web',
              text: 'Die WebApp. Next.js App Router, React Server Components, Server Actions. Einstieg: `apps/web/src/app`. Die Seiten liegen in der Route Group `(app)` hinter der Anmeldung; öffentliche Seiten daneben.',
            },
            {
              name: 'apps/bot',
              text: 'Der Discord Bot. discord.js, Slash Commands, Interaktionen, die Job-Schleife. Einstieg: `apps/bot/src/index.ts`, die Jobs in `apps/bot/src/jobs.ts`.',
            },
            {
              name: 'apps/music-runtime',
              text: 'Die Laufzeit der Musik-Workerbots. Eigener Prozess, damit ein abgestürzter Audio-Stream nicht den Bot mitnimmt.',
            },
            {
              name: 'apps/game-agent',
              text: 'Der Agent auf den Gameserver-Hosts. Startet und überwacht Match-Container; spricht über eine eigene Schnittstelle mit dem Turniermodul.',
            },
          ],
        },
      ],
    },
    {
      anker: 'pakete',
      titel: 'Die gemeinsamen Pakete',
      blocks: [
        {
          art: 'felder',
          eintraege: [
            {
              name: '@swisshub/modules',
              text: 'Der Modulkern. Jedes Fachmodul hat hier ein Verzeichnis: Logik, Konfiguration, Berechtigungen, Navigationseinträge. Das grösste Paket und der Ort, an dem Fachliches hingehört.',
            },
            {
              name: '@swisshub/database',
              text: 'Prisma Schema, Migrationen, der geteilte Client und `recordAudit`. Die einzige Stelle, die SQL kennt.',
            },
            {
              name: '@swisshub/permissions',
              text: 'Die Permission Engine: Registry, Auflösung, Presets, Aussperrschutz, Altlasten. Kennt keine Datenbank - sie bekommt Rollen und Zuordnungen und rechnet.',
            },
            {
              name: '@swisshub/auth',
              text: 'Discord OAuth, Sitzungen, CSRF, `can()` und die Zusicherungen für Server Actions.',
            },
            {
              name: '@swisshub/discord',
              text: 'Der Zugang zu Discord: Gateway, REST, Rollen- und Kanalabfragen. Hinter einer Schnittstelle, damit Tests ohne Discord laufen.',
            },
            {
              name: '@swisshub/automation',
              text: 'Die Automation Engine. Kennt kein SwissHub-Modul - sie weiss, wie aus einem Ereignis eine Aktion wird, und bekommt beides von aussen.',
            },
            {
              name: '@swisshub/secrets',
              text: 'Der Katalog der Zugangsdaten und ihre Verschlüsselung. Siehe [Secrets & Environment](/system/docs/entwickler/secrets).',
            },
            {
              name: '@swisshub/config',
              text: 'Umgebungsvariablen, geprüft beim Start, plus die Intervalle der Jobs.',
            },
            {
              name: '@swisshub/logger',
              text: "Strukturiertes Logging mit Namensraum je Bereich: `createLogger('bot:jobs')`.",
            },
            {
              name: '@swisshub/shared',
              text: 'Was überall gebraucht wird: Fehlerklassen (`AppError`), Formatierung, Routen-Hilfen, Textsäuberung.',
            },
          ],
        },
      ],
    },
    {
      anker: 'abhaengigkeiten',
      titel: 'Welche Richtung die Abhängigkeiten laufen',
      blocks: [
        {
          art: 'fluss',
          stationen: [
            { label: 'apps/*', detail: 'Oberflächen' },
            { label: '@swisshub/modules', detail: 'Fachlogik' },
            { label: 'database · permissions · discord', detail: 'Infrastruktur' },
            { label: 'shared · config · logger', detail: 'Basis' },
          ],
        },
        {
          art: 'absatz',
          text: 'Nur nach rechts. Ein Paket der Basis importiert nie aus dem Modulkern, und der Modulkern importiert nie aus einer Anwendung. Das ist der Grund, aus dem der Bot dieselbe Logik benutzen kann wie die WebApp - und der Grund für die Regel auf der Seite [Bot-Runtime](/system/docs/entwickler/bot-runtime).',
        },
      ],
    },
  ],
};

export const techStack: DokuSeite = {
  slug: 'tech-stack',
  titel: 'Tech Stack',
  kurz: 'Welche Technologien tatsächlich im Einsatz sind - mit den Versionen aus dem Repository.',
  aktualisiert: '2026-10-06',
  abschnitte: [
    {
      anker: 'laufzeit',
      titel: 'Laufzeit und Sprache',
      blocks: [
        {
          art: 'tabelle',
          kopf: ['Technologie', 'Version', 'Wofür'],
          zeilen: [
            ['Node.js', '>= 20.11', 'Laufzeit aller vier Anwendungen'],
            ['TypeScript', '5.9', 'Durchgehend, `strict`'],
            ['Next.js', '15.5', 'WebApp: App Router, Server Components, Server Actions'],
            ['React', '19.2', 'Oberfläche'],
            ['Tailwind CSS', '3.4', 'Design-Tokens und Layout'],
            ['Prisma', '6.19', 'Schema, Migrationen, Datenbankzugriff'],
            ['PostgreSQL', '16', 'Die Datenbank'],
            ['discord.js', '14.27', 'Gateway und REST gegenüber Discord'],
            ['Zod', '3.25', 'Eingabeprüfung in Actions, APIs und Konfiguration'],
            ['Vitest', '3.2', 'Unit- und Integrationstests'],
            ['ESLint', '9.39', 'Linting, Flat Config'],
          ],
        },
      ],
    },
    {
      anker: 'betrieb',
      titel: 'Betrieb',
      blocks: [
        {
          art: 'liste',
          punkte: [
            '**Docker Compose** - `docker-compose.prod.yml` beschreibt die Dienste in Produktion.',
            '**GitHub Actions** - `.github/workflows/deploy.yml`, zwei Jobs: `validate` und `deploy`.',
            '**Nginx** - Reverse Proxy, Konfiguration unter `deploy/nginx/`.',
            '**systemd** - Timer für die Datensicherung, unter `deploy/systemd/`.',
          ],
        },
        {
          art: 'hinweis',
          ton: 'info',
          text: 'Es gibt keine Suchmaschine, keinen Message Broker und keinen Cache-Server. Was zwischengespeichert wird, liegt im Prozess oder in der Datenbank - siehe [Permission Engine](/system/docs/entwickler/permissions#cache).',
        },
      ],
    },
  ],
};

export const ablaeufe: DokuSeite = {
  slug: 'ablaeufe',
  titel: 'Abläufe',
  kurz: 'Was zwischen einem Klick und einer Datenbankzeile passiert - und dasselbe für Discord.',
  aktualisiert: '2026-10-06',
  abschnitte: [
    {
      anker: 'web-request',
      titel: 'Ein Web-Request',
      blocks: [
        {
          art: 'fluss',
          stationen: [
            { label: 'Browser', detail: 'Klick oder Formular' },
            { label: 'Next.js Route', detail: 'Server Component' },
            { label: 'requirePagePermission', detail: 'Riegel vor der Seite' },
            { label: 'Modullogik', detail: '@swisshub/modules' },
            { label: 'Prisma', detail: 'eine Transaktion' },
            { label: 'PostgreSQL', detail: '' },
          ],
        },
        {
          art: 'absatz',
          text: 'Eine Seite prüft ihre Berechtigung als Erstes und lädt danach. Der Riegel ist `requirePagePermission` aus `apps/web/src/server/auth.ts`; er wirft, und die Seite rendert gar nicht erst.',
        },
        {
          art: 'code',
          sprache: 'tsx',
          titel: 'apps/web/src/app/(app)/… /page.tsx',
          inhalt: `export default async function Seite(): Promise<React.JSX.Element> {
  // Wirft, wenn die Berechtigung fehlt - vor jedem Laden.
  const context = await requirePagePermission(WORKSPACE_ZUGANG);
  const betrachter = workspaceBetrachter(context);

  const daten = await workspace.ladeAufgaben(guildId, betrachter, { grenze: 50 });
  return <Ansicht daten={daten} csrfToken={csrfTokenFor(context)} />;
}`,
        },
      ],
    },
    {
      anker: 'server-action',
      titel: 'Eine Server Action',
      blocks: [
        {
          art: 'absatz',
          text: 'Schreibende Vorgänge laufen über `defineAction`. Es bündelt, was jede Aktion braucht: Sitzung, Mitgliedschaft, CSRF, Rate Limit, Berechtigung, Eingabeprüfung per Zod. Eine Aktion, die das selbst zusammenbaut, lässt irgendwann einen Schritt weg.',
        },
        {
          art: 'code',
          sprache: 'ts',
          titel: 'Das Muster',
          inhalt: `export const beispielAction = defineAction(
  {
    name: 'modul.aktion',
    module: MODULE_ID,
    permission: P.manage,
    schema: eingabeSchema,
    rateLimit: 'settingsWrite',
    freshness: 'critical',
  },
  async ({ ctx, input, metadata }) => {
    const ergebnis = await modul.tueEtwas(input, {
      discordId: ctx.user.discordId,
      username: ctx.user.username,
    });
    revalidatePath('/modul');
    return { ergebnis };
  },
);`,
        },
        {
          art: 'hinweis',
          ton: 'achtung',
          text: "`freshness: 'critical'` bedeutet: die Rollen werden vor der Aktion frisch von Discord geprüft, nicht aus der Sitzung gelesen. Für alles, was Rechte vergibt oder Geld betrifft, ist das Pflicht.",
        },
      ],
    },
    {
      anker: 'discord-interaktion',
      titel: 'Eine Discord-Interaktion',
      blocks: [
        {
          art: 'fluss',
          stationen: [
            { label: 'Discord', detail: 'Slash Command, Button' },
            { label: 'Interaction Router', detail: 'apps/bot/src' },
            { label: 'Berechtigung', detail: 'dieselbe Engine' },
            { label: 'Modullogik', detail: 'dieselbe Funktion' },
            { label: 'Antwort', detail: 'Embed oder Nachricht' },
          ],
        },
        {
          art: 'absatz',
          text: 'Die dritte und vierte Station sind dieselben wie im Web. Das ist der Punkt: eine Regel steht einmal, und beide Wege kommen daran vorbei. Mehr dazu auf der Seite [Discord Bot](/system/docs/entwickler/bot).',
        },
      ],
    },
  ],
};

export const webRouting: DokuSeite = {
  slug: 'web-routing',
  titel: 'Web & Routing',
  kurz: 'Route Groups, Layouts, API Routes, Server Actions - und die Falle mit dynamischen Segmenten.',
  aktualisiert: '2026-10-06',
  abschnitte: [
    {
      anker: 'struktur',
      titel: 'Struktur',
      blocks: [
        {
          art: 'felder',
          eintraege: [
            {
              name: 'app/(app)/…',
              text: 'Alles hinter der Anmeldung. Das Layout dieser Gruppe baut Seitenleiste, Kopfzeile und Navigation - deshalb hat jede Seite darunter sie, ohne etwas zu tun.',
            },
            {
              name: 'app/api/…',
              text: 'Route Handler. Für alles, was keine Server Action sein kann: Dateiuploads, Bildausgabe, SSE-Ströme, der Gesundheitscheck.',
            },
            {
              name: 'Server Actions',
              text: 'In `apps/web/src/modules/<modul>/actions.ts`, immer über `defineAction`.',
            },
            {
              name: 'middleware.ts',
              text: 'Läuft vor jeder Anfrage. Sicherheitskopfzeilen und die Weiterleitung nicht angemeldeter Zugriffe.',
            },
          ],
        },
      ],
    },
    {
      anker: 'dynamische-segmente',
      titel: 'Konkurrierende dynamische Segmente',
      blocks: [
        {
          art: 'hinweis',
          ton: 'achtung',
          titel: 'Baut nicht',
          text: 'Zwei dynamische Segmente unter demselben Pfad - etwa `[eventId]` und `[slug]` direkt nebeneinander - sind in Next.js ein Fehler beim Bauen. Es gibt keine Regel, nach der sich entscheiden liesse, welches greift.',
        },
        {
          art: 'absatz',
          text: 'Die Lösung ist ein zusätzliches Segment, das die Bedeutung trägt: `…/event/[eventId]` und `…/slug/[slug]`. Oder ein Catch-all `[...pfad]`, das selbst entscheidet - so macht es diese Dokumentation.',
        },
      ],
    },
    {
      anker: 'uebergabe',
      titel: 'Was vom Server zum Browser geht',
      blocks: [
        {
          art: 'liste',
          punkte: [
            'Nur Daten, keine Funktionen und keine React-Elemente. Symbole reisen als **Name** und werden im Browser nachgeschlagen - siehe `nav-icon.tsx`.',
            'Filter, Suche und Seitenzahl stehen in der Adresse, nicht in einem globalen Zustand. Zurück, Vorwärts und Neuladen erledigen sich damit von selbst.',
            'Der CSRF-Token kommt über `csrfTokenFor(context)` als Prop in jede Komponente, die eine Aktion aufruft.',
          ],
        },
      ],
    },
  ],
};
