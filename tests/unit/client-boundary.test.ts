import { describe, expect, it } from 'vitest';

/**
 * Die Grenze zwischen Server und Browser.
 *
 * Was eine Client-Komponente als Wert importiert, landet im Browser-Bundle -
 * samt allem, was das importierte Modul seinerseits mitbringt. Ein einziger
 * Import aus `@swisshub/discord` hat auf diesem Weg das komplette
 * Umgebungs-Schema aus `@swisshub/config` in die ausgelieferten Dateien
 * gezogen: Namen und Validierungsregeln von `DISCORD_BOT_TOKEN`,
 * `AUTH_SECRET` und `DATABASE_URL`. Die Werte selbst waren nicht dabei - aber
 * dort gehört nichts davon hin.
 *
 * Erlaubt sind deshalb nur die ausdrücklich client-sicheren Einstiegspunkte.
 * Reine Typ-Importe (`import type`) bleiben ohne Bedeutung: TypeScript
 * entfernt sie beim Übersetzen vollständig.
 */
const { existsSync, globSync, readFileSync } = await import('node:fs');
const { join } = await import('node:path');

/** Einstiegspunkte ohne Server-Abhängigkeiten. */
const CLIENT_SAFE = [
  '@swisshub/config/client',
  '@swisshub/discord/cdn',
  '@swisshub/shared',
  // Die Permission Engine ohne Store und Registry-Anbindung an die Datenbank.
  // Die Berechtigungsmatrix bewertet damit im Browser nach genau derselben
  // Regel wie der Server - eine zweite Regel im Browser waere die Stelle, an
  // der Anzeige und Wirkung auseinanderlaufen.
  '@swisshub/permissions/engine',
  /*
   * Die reinen Teile des Wrapped-Moduls.
   *
   * Szenenliste, Texte, Archetyp, Highlight, Platzhalter, Testpersonen und
   * die Typen der Daten. Alles davon ist Rechnung und Text - kein Prisma,
   * kein Discord, keine Umgebung. Die Szenen im Browser brauchen genau
   * diese Regeln, und zwar dieselben, nach denen der Server die
   * Momentaufnahme gebaut hat.
   *
   * `@swisshub/modules` selbst steht **nicht** hier: der Haupteinstieg
   * zieht die Modul-Registry mitsamt Datenbank herein.
   */
  '@swisshub/modules/wrapped/daten',
  '@swisshub/modules/wrapped/texte',
  '@swisshub/modules/wrapped/archetyp',
  '@swisshub/modules/wrapped/highlight',
  '@swisshub/modules/wrapped/vorlage',
  '@swisshub/modules/wrapped/szenen',
  '@swisshub/modules/wrapped/fixtures',
  /*
   * Die reinen Teile der periodischen Ausgaben.
   *
   * `perioden` rechnet Monate und Jahre aus, `vorlagen` beschreibt, wie eine
   * Folie aussieht - beides ohne Datenbank. Der Editor und der Zeichner
   * brauchen sie im Browser, und zwar dieselben: eine zweite Liste erlaubter
   * Vorlagen im Browser waere die Stelle, an der Vorschau und Export
   * auseinanderlaufen.
   */
  '@swisshub/modules/wrapped/perioden',
  '@swisshub/modules/wrapped/vorlagen',
  /*
   * Die Form des Turnierbaums.
   *
   * Die Buehne von «Was spielen wir?» zeichnet ihn und muss dafuer wissen,
   * welches Duell gerade laeuft - dieselbe Antwort, die auch der Server
   * gibt. Eine zweite Fassung davon waere die Stelle, an der die Anzeige auf
   * ein anderes Duell zeigt als die Abstimmung.
   *
   * Die Datei importiert nichts. Dass das so bleibt, prueft der Test unten.
   */
  '@swisshub/modules/spielwahl/baum',
  /*
   * Der Bauplan der Levelkarte.
   *
   * Die Vorschau im Browser soll nicht *aehnlich* aussehen wie die Karte auf
   * Discord, sondern dieselbe sein. Sie entsteht deshalb aus derselben
   * Funktion, die der Bot vor dem Rastern aufruft - eine nachgebaute
   * Vorschau in CSS waere die Stelle, an der gewaehlte Farbe und
   * ausgelieferte Karte auseinanderlaufen.
   *
   * Der Baum darunter ist Rechnung: die XP-Kurve, die Schriftmasse von
   * DejaVu Sans und die Farbpruefung. Kein Prisma, kein Discord, keine
   * Umgebung.
   */
  '@swisshub/modules/level/karte',
  /*
   * Die Form eines Katalogeintrags.
   *
   * Das Formular im Browser prueft dieselben Grenzen wie der Server - die
   * Plattformliste, die Laengen, was eine Cover-Adresse sein darf. Eine
   * zweite Fassung davon waere die Stelle, an der die Oberflaeche etwas
   * zulaesst, das die Aktion danach zurueckweist.
   *
   * Die Datei importiert nur `zod`. Dass das so bleibt, prueft der Test
   * unten.
   */
  '@swisshub/modules/games/schemas',
  /*
   * Die reinen Teile der Mitgliederprofile.
   *
   * Registries und Eingabepruefungen - Listen, Muster und Zod-Schemas, sonst
   * nichts. Der Profil-Editor braucht sie im Browser, und zwar genau
   * dieselben, nach denen der Server danach prueft. Eine zweite Liste
   * erlaubter Akzentfarben im Browser waere die Stelle, an der Auswahl und
   * Wirkung auseinanderlaufen.
   *
   * `profile/service`, `profile/bearbeiten` und `profile/entdecken` stehen
   * bewusst **nicht** hier: die lesen und schreiben.
   */
  '@swisshub/modules/voice/naming',
  '@swisshub/modules/profil/angaben',
  '@swisshub/modules/profil/auszeichnungen',
  '@swisshub/modules/profil/gestaltung',
  '@swisshub/modules/profil/schemas',
  '@swisshub/modules/profil/showcase',
  '@swisshub/modules/profil/socials',
  '@swisshub/modules/profil/spielfelder',
];

/**
 * Womit ein Einstiegspunkt sich selbst disqualifiziert.
 *
 * Nicht die Liste der Suenden, sondern die Wurzeln: `@swisshub/database`
 * bringt Prisma, `@swisshub/config` das Umgebungs-Schema, `@swisshub/discord`
 * den Gateway-Client. `server-only` wirft im Browser von sich aus, und
 * `node:`-Module gibt es dort nicht.
 */
const SERVERGEBUNDEN = [
  '@swisshub/database',
  '@swisshub/auth',
  '@swisshub/secrets',
  '@swisshub/automation',
  '@swisshub/logger',
  'server-only',
  '@prisma/client',
];

const CLIENT_FILES = globSync('apps/web/src/**/*.{ts,tsx}', { cwd: process.cwd() })
  .filter((file) => {
    const source = readFileSync(join(process.cwd(), file), 'utf8');
    return /^\s*['"]use client['"]/m.test(source);
  })
  .sort();

/** Wert-Importe (keine Typ-Importe) aus `@swisshub/*`. */
function valueImports(file: string): string[] {
  const source = readFileSync(join(process.cwd(), file), 'utf8');
  const specs: string[] = [];
  const pattern = /^import\s+(type\s+)?(?:[\w*{][^'"]*?\s+from\s+)?['"](@swisshub\/[^'"]+)['"]/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    if (match[1]) {
      continue; // `import type` - wird beim Übersetzen entfernt
    }
    if (match[2]) {
      specs.push(match[2]);
    }
  }
  return specs;
}

/**
 * Die Erlaubnisliste prueft sich selbst.
 *
 * Ein Eintrag oben ist eine Behauptung: «dieser Einstiegspunkt bringt
 * nichts Serverseitiges mit». Ohne Pruefung bleibt sie eine Behauptung -
 * und sie altert, sobald jemand in einer der beteiligten Dateien eine
 * Kleinigkeit ergaenzt. Deshalb wird der Importbaum jedes Eintrags
 * verfolgt, quer durch die Pakete, und auf die Wurzeln oben abgeklopft.
 */
const EXPORTE: Record<string, string> = {
  '@swisshub/config/client': 'packages/config/src/client.ts',
  '@swisshub/discord/cdn': 'packages/discord/src/cdn.ts',
  '@swisshub/shared': 'packages/shared/src/index.ts',
  '@swisshub/permissions/engine': 'packages/permissions/src/engine.ts',
  '@swisshub/modules/wrapped/daten': 'packages/modules/src/wrapped/daten.ts',
  '@swisshub/modules/wrapped/texte': 'packages/modules/src/wrapped/texte.ts',
  '@swisshub/modules/wrapped/archetyp': 'packages/modules/src/wrapped/archetyp.ts',
  '@swisshub/modules/wrapped/highlight': 'packages/modules/src/wrapped/highlight.ts',
  '@swisshub/modules/wrapped/vorlage': 'packages/modules/src/wrapped/vorlage.ts',
  '@swisshub/modules/wrapped/szenen': 'packages/modules/src/wrapped/szenen.ts',
  '@swisshub/modules/wrapped/fixtures': 'packages/modules/src/wrapped/fixtures.ts',
  '@swisshub/modules/wrapped/perioden': 'packages/modules/src/wrapped/perioden.ts',
  '@swisshub/modules/wrapped/vorlagen': 'packages/modules/src/wrapped/vorlagen.ts',
  '@swisshub/modules/spielwahl/baum': 'packages/modules/src/spielwahl/baum.ts',
  '@swisshub/modules/level/karte': 'packages/modules/src/level/card.ts',
  '@swisshub/modules/games/schemas': 'packages/modules/src/games/schemas.ts',
  '@swisshub/modules/voice/naming': 'packages/modules/src/voice/naming.ts',
  '@swisshub/modules/profil/angaben': 'packages/modules/src/profile/angaben.ts',
  '@swisshub/modules/profil/auszeichnungen': 'packages/modules/src/profile/auszeichnungen.ts',
  '@swisshub/modules/profil/gestaltung': 'packages/modules/src/profile/gestaltung.ts',
  '@swisshub/modules/profil/schemas': 'packages/modules/src/profile/schemas.ts',
  '@swisshub/modules/profil/showcase': 'packages/modules/src/profile/showcase.ts',
  '@swisshub/modules/profil/socials': 'packages/modules/src/profile/socials.ts',
  '@swisshub/modules/profil/spielfelder': 'packages/modules/src/profile/spielfelder.ts',
};

/** Alle Wert-Importe einer Datei - auch die relativen. */
function alleImporte(datei: string): string[] {
  const quelle = readFileSync(join(process.cwd(), datei), 'utf8');
  const treffer: string[] = [];
  const muster = /^import\s+(type\s+)?(?:[\w*{][^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gm;
  let gefunden: RegExpExecArray | null;
  while ((gefunden = muster.exec(quelle)) !== null) {
    if (gefunden[1]) {
      continue;
    }
    if (gefunden[2]) {
      treffer.push(gefunden[2]);
    }
  }
  return treffer;
}

/** Aus einem relativen Verweis die Datei machen - `.ts` oder `/index.ts`. */
function relativZuDatei(vonDatei: string, spezifikator: string): string | null {
  const basis = join(process.cwd(), vonDatei, '..', spezifikator);
  for (const kandidat of [`${basis}.ts`, `${basis}.tsx`, join(basis, 'index.ts')]) {
    if (existsSync(kandidat)) {
      return kandidat.slice(process.cwd().length + 1);
    }
  }
  return null;
}

/** Jede Datei, die an einem Einstiegspunkt haengt - mitsamt dem, was sie zieht. */
function baum(start: string): { dateien: Set<string>; pakete: Set<string> } {
  const dateien = new Set<string>();
  const pakete = new Set<string>();
  const offen = [start];

  while (offen.length > 0) {
    const datei = offen.pop()!;
    if (dateien.has(datei)) {
      continue;
    }
    dateien.add(datei);

    for (const spezifikator of alleImporte(datei)) {
      if (spezifikator.startsWith('.')) {
        const ziel = relativZuDatei(datei, spezifikator);
        if (ziel) {
          offen.push(ziel);
        }
        continue;
      }
      pakete.add(spezifikator);
      const eigenes = EXPORTE[spezifikator];
      if (eigenes) {
        offen.push(eigenes);
      }
    }
  }
  return { dateien, pakete };
}

describe('Erlaubte Einstiegspunkte', () => {
  it('sind vollständig zugeordnet', () => {
    // Ein neuer Eintrag in CLIENT_SAFE ohne Datei hier wäre eine
    // Erlaubnis, die niemand geprüft hat.
    for (const eintrag of CLIENT_SAFE) {
      expect(EXPORTE[eintrag], `${eintrag} fehlt in EXPORTE`).toBeTypeOf('string');
    }
  });

  it.each(CLIENT_SAFE)('%s bringt nichts Serverseitiges mit', (eintrag) => {
    const start = EXPORTE[eintrag];
    expect(start).toBeTypeOf('string');
    const { pakete } = baum(start!);

    const verboten = [...pakete].filter(
      (spezifikator) =>
        SERVERGEBUNDEN.includes(spezifikator) ||
        spezifikator.startsWith('node:') ||
        // `@swisshub/config` ja, `@swisshub/config/client` nein.
        spezifikator === '@swisshub/config' ||
        spezifikator === '@swisshub/discord' ||
        spezifikator === '@swisshub/modules',
    );
    expect(verboten, `${eintrag} zieht ${verboten.join(', ')} mit`).toEqual([]);
  });
});

describe('Client-Bundle', () => {
  it('findet die Client-Komponenten', () => {
    expect(CLIENT_FILES.length).toBeGreaterThan(20);
  });

  it.each(CLIENT_FILES)('%s importiert nur client-sichere Pakete', (file) => {
    const verboten = valueImports(file).filter((spec) => !CLIENT_SAFE.includes(spec));
    expect(
      verboten,
      `${file}: ${verboten.join(', ')} zieht Server-Code ins Browser-Bundle. ` +
        `Erlaubt sind ${CLIENT_SAFE.join(', ')} - oder ein reiner Typ-Import.`,
    ).toEqual([]);
  });
});

/**
 * Server-Code ruft keine Funktion aus einer Client-Datei auf.
 *
 * Next.js macht aus jedem Export einer `'use client'`-Datei einen Verweis auf
 * das Browser-Bundle. Eine Komponente laesst sich damit rendern, eine
 * gewoehnliche Funktion aber nicht aufrufen: der Aufruf bricht zur Laufzeit
 * ab. Der Uebersetzer sieht das nicht, denn der Typ stimmt - und `next build`
 * auch nicht, weil die Seite erst beim Aufruf gerendert wird.
 *
 * Gemeint ist der Aufruf, nicht der Import: eine Konstante aus einer
 * Client-Datei an eine Client-Komponente weiterzureichen geht - Next gibt sie
 * ueber die Grenze weiter. Erst `name(...)` im Servercode bricht.
 *
 * Wer eine Funktion auf beiden Seiten braucht, legt sie in ein Modul ohne
 * `'use client'`.
 */
describe('Server-Dateien', () => {
  const CLIENT_MODULES = new Set(
    CLIENT_FILES.map((file) => file.replace(/\.tsx?$/u, '').replace(/\/index$/u, '')),
  );

  /** Aus welcher Datei kommt ein `@/`-Import? */
  function aufgeloest(spezifikator: string): string | null {
    if (!spezifikator.startsWith('@/')) {
      return null;
    }
    return `apps/web/src/${spezifikator.slice(2)}`;
  }

  const SERVER_FILES = globSync('apps/web/src/**/*.{ts,tsx}', { cwd: process.cwd() })
    .filter((file) => !/^\s*['"]use client['"]/m.test(readFileSync(join(process.cwd(), file), 'utf8')))
    .sort();

  it.each(SERVER_FILES.map((file) => [file, file] as const))(
    '%s ruft nichts aus einer Client-Datei auf',
    (_name, file) => {
      const source = readFileSync(join(process.cwd(), file), 'utf8');
      const muster = /^import\s+(type\s+)?\{([^}]*)\}\s+from\s+['"](@\/[^'"]+)['"]/gm;
      let treffer: RegExpExecArray | null;

      while ((treffer = muster.exec(source)) !== null) {
        if (treffer[1]) {
          continue; // `import type` verschwindet beim Uebersetzen.
        }
        const ziel = aufgeloest(treffer[3] ?? '');
        if (!ziel || !CLIENT_MODULES.has(ziel)) {
          continue;
        }
        const namen = (treffer[2] ?? '')
          .split(',')
          .map((eintrag) => eintrag.trim())
          .filter((eintrag) => eintrag !== '' && !eintrag.startsWith('type '))
          .map((eintrag) => (eintrag.split(/\s+as\s+/u).pop() ?? '').trim())
          .filter((eintrag) => eintrag !== '');

        for (const name of namen) {
          // Nur der Aufruf ist das Problem. Weitergereicht wird eine
          // Konstante aus einer Client-Datei ohne Weiteres.
          const wirdAufgerufen = new RegExp(`(?<![\\w.])${name}\\s*\\(`, 'u').test(source);
          expect(
            wirdAufgerufen,
            `${file}: ruft "${name}" auf - die Funktion kommt aus der Client-Datei ${ziel} und bricht zur Laufzeit ab`,
          ).toBe(false);
        }
      }
    },
  );
});

/**
 * Ein client-sicherer Einstiegspunkt muss es auch bleiben.
 *
 * Die Liste oben ist eine Behauptung. Reicht ein Modul dieser Kette spaeter
 * einen Datenbank- oder Konfigurationsimport nach, waere die Behauptung falsch
 * und niemand merkte es - der Test oben wuerde den Import ja gerade erlauben.
 * Deshalb hier die Gegenprobe an der Kette selbst.
 */
describe('Client-sichere Einstiegspunkte', () => {
  const VERBOTEN = ['@swisshub/database', '@swisshub/config', '@swisshub/secrets', 'node:', '@prisma/'];

  /** Alle Dateien, die von einem Einstiegspunkt aus erreichbar sind. */
  function kette(start: string): string[] {
    const gesehen = new Set<string>();
    const offen = [start];
    while (offen.length > 0) {
      const datei = offen.pop()!;
      if (gesehen.has(datei)) {
        continue;
      }
      gesehen.add(datei);
      const quelle = readFileSync(join(process.cwd(), datei), 'utf8');
      for (const treffer of quelle.matchAll(/from\s+['"](\.[^'"]+)['"]/gu)) {
        const ziel = treffer[1]!;
        const ordner = datei.slice(0, datei.lastIndexOf('/'));
        const pfad = join(ordner, ziel).replace(/\\/gu, '/');
        offen.push(pfad.endsWith('.ts') ? pfad : `${pfad}.ts`);
      }
    }
    return [...gesehen];
  }

  it('zieht über die Permission Engine keinen Server-Code nach', () => {
    const dateien = kette('packages/permissions/src/engine.ts');
    expect(dateien.length).toBeGreaterThan(1);

    for (const datei of dateien) {
      const quelle = readFileSync(join(process.cwd(), datei), 'utf8');
      for (const spezifikator of VERBOTEN) {
        expect(quelle.includes(`from '${spezifikator}`), `${datei} -> ${spezifikator}`).toBe(false);
      }
    }
  });
});
