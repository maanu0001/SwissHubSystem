import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { branding } from '@swisshub/modules';

/**
 * Die Upload-Grenzen - über alle Schichten hinweg.
 *
 * ## Der Fehler, den diese Datei festnagelt
 *
 * Eine Bilddatei von 11,4 MB kam mit «Aktion konnte nicht ausgeführt werden.
 * Bitte versuche es später erneut.» zurück - gemessen am gebauten Server,
 * während eine von 4,1 MB durchging. Die Grenze in `storeLogoUpload` lag bei
 * 8 MB und hätte das sagen können; sie sah die Datei nie.
 *
 * Die Ursache lag eine Schicht höher. Sobald eine Middleware existiert, klont
 * Next den Anfragekörper, damit die Middleware ihn lesen und die Route ihn
 * danach noch einmal bekommen kann. Dieser Klon hat eine Vorgabe von 10 MB,
 * und darüber wird er nicht abgelehnt, sondern **abgeschnitten**: die Route
 * erhält ein halbes Multipart, `request.formData()` wirft «Failed to parse
 * body as FormData», und daraus wird ein INTERNAL.
 *
 * Betroffen war nicht nur der Post Creator. Der Clip-Upload (bis 500 MB), der
 * Level-Import (64 MB) und der Jail-Import (32 MB) erlauben seit je mehr als
 * 10 MB und konnten es nie halten.
 *
 * ## Die Zusicherung
 *
 * Jede Route, die ein Formular mit Dateien liest, muss **entweder** unter der
 * Klongrenze bleiben **oder** von der Middleware ausgenommen sein. Das ist
 * eine Eigenschaft von drei Dateien zusammen, und genau deshalb steht sie
 * hier und nicht in einer von ihnen.
 */

const WURZEL = process.cwd();
const API = join(WURZEL, 'apps/web/src/app/api');

const NEXT_CONFIG = readFileSync(join(WURZEL, 'apps/web/next.config.ts'), 'utf8');
const MIDDLEWARE = readFileSync(join(WURZEL, 'apps/web/src/middleware.ts'), 'utf8');

/** Die Klongrenze aus `next.config.ts`, in Bytes. */
function klongrenze(): number {
  const treffer = /middlewareClientMaxBodySize:\s*'(\d+)mb'/u.exec(NEXT_CONFIG);
  expect(treffer, 'middlewareClientMaxBodySize fehlt in next.config.ts').not.toBeNull();
  return Number(treffer?.[1]) * 1024 * 1024;
}

/** Alle Route Handler, die ein Formular lesen - samt ihrem URL-Pfad. */
function formularRouten(): Array<{ pfad: string; quelle: string }> {
  const gefunden: Array<{ pfad: string; quelle: string }> = [];
  const lauf = (verzeichnis: string): void => {
    for (const eintrag of readdirSync(verzeichnis)) {
      const voll = join(verzeichnis, eintrag);
      if (statSync(voll).isDirectory()) {
        lauf(voll);
        continue;
      }
      if (eintrag !== 'route.ts' && eintrag !== 'route.tsx') {
        continue;
      }
      const quelle = readFileSync(voll, 'utf8');
      // `formData()` direkt oder über den gemeinsamen Helfer.
      if (!/\.formData\(\)|leseFormular\(/u.test(quelle)) {
        continue;
      }
      const pfad = `/api/${relative(API, verzeichnis).split('\\').join('/')}`;
      gefunden.push({ pfad, quelle });
    }
  };
  lauf(API);
  return gefunden;
}

/**
 * Was jede Formular-Route höchstens entgegennimmt - abgelesen, nicht geraten.
 *
 * ## Warum eine Tabelle und keine Erkennung
 *
 * Weil die Grenze nicht überall im Route Handler steht: `games/cover` ruft
 * `setzeCover` auf, das intern `storeLogoUpload` benutzt, und die Clipgrenze
 * kommt aus den Moduleinstellungen. Eine Erkennung, die das aus dem Quelltext
 * herausliest, wäre zu klug und bei der nächsten Umbenennung still falsch.
 *
 * Diese Tabelle ist stattdessen die Prüfliste selbst: eine neue Route, die
 * ein Formular liest, fehlt hier und lässt den Test fallen. Dann muss jemand
 * eine Zahl eintragen - und genau dabei fällt auf, ob sie über der Klongrenze
 * liegt.
 *
 * `'ausgenommen'` heisst: diese Route geht die Middleware gar nicht erst an.
 */
const ROUTEN_GRENZE: Record<string, number | 'ausgenommen' | 'ohne Datei'> = {
  '/api/auth/logout': 'ohne Datei',
  '/api/level/env': 'ohne Datei',
  '/api/branding/upload': branding.UPLOAD_GRENZEN.logo.maxBytes,
  '/api/games/[gameId]/cover': branding.UPLOAD_GRENZEN.gamecover.maxBytes,
  '/api/kalender/[slug]/twint-qr': branding.UPLOAD_GRENZEN.twintqr.maxBytes,
  '/api/level/card-banner': branding.UPLOAD_GRENZEN.levelcard.maxBytes,
  '/api/level/custom-card': branding.UPLOAD_GRENZEN.usercard.maxBytes,
  '/api/profil/[discordId]/banner': branding.UPLOAD_GRENZEN.profilbanner.maxBytes,
  '/api/workspace/upload': branding.UPLOAD_GRENZEN.workspace.maxBytes,
  '/api/wrapped/moment/[momentId]': branding.UPLOAD_GRENZEN.wrappedmoment.maxBytes,
  '/api/social-media/upload': branding.UPLOAD_GRENZEN.socialpost.maxBytes,
  // Bild und Klang zugleich - die grössere der beiden Grenzen zählt.
  '/api/level/xp-slot/upload': branding.UPLOAD_GRENZEN.slotsymbol.maxBytes,
  // Die drei grossen: bis 500 MB, 64 MB und 32 MB.
  '/api/clips/upload': 'ausgenommen',
  '/api/level/import': 'ausgenommen',
  '/api/jail/import': 'ausgenommen',
};

describe('Upload-Grenzen: eine Tabelle, keine verstreuten Zahlen', () => {
  it('nennt für jeden Namensraum eine Grenze', () => {
    for (const kind of branding.UPLOAD_KINDS) {
      const grenze = branding.UPLOAD_GRENZEN[kind];
      expect(grenze, kind).toBeDefined();
      expect(grenze.maxBytes).toBeGreaterThan(0);
      expect(grenze.maxSize).toBeGreaterThan(grenze.minSize);
    }
  });

  it('lehnt normale hochwertige Bilder nicht mehr ab', () => {
    /*
     * Die eigentliche Beschwerde: «normale Bilddateien sind bereits zu gross».
     * Ein Bild aus einem Grafikprogramm hat heute mehrere tausend Pixel
     * Kantenlänge und als PNG mit Transparenz zweistellige Megabyte. Zwei
     * Megabyte lehnen damit nicht den Missbrauch ab, sondern den Normalfall.
     */
    const bilder = ['socialpost', 'slotsymbol', 'levelcard', 'usercard', 'gamecover'] as const;
    for (const kind of bilder) {
      expect(branding.UPLOAD_GRENZEN[kind].maxBytes, kind).toBeGreaterThanOrEqual(12 * 1024 * 1024);
      expect(branding.UPLOAD_GRENZEN[kind].maxSize, kind).toBeGreaterThanOrEqual(4096);
    }
  });

  it('gibt dem Post Creator die grösste Grenze - er exportiert in 1080 × 1920', () => {
    expect(branding.UPLOAD_GRENZEN.socialpost.maxBytes).toBe(branding.GROESSTE_BILDGRENZE);
    expect(branding.UPLOAD_GRENZEN.socialpost.maxBytes).toBeGreaterThanOrEqual(20 * 1024 * 1024);
  });

  it('erlaubt trotzdem nicht überall dasselbe', () => {
    // «Bis 100 MB für alles» sagt nichts darüber, was ein Namensraum ist.
    // Ein QR-Code braucht keine zwanzig Megabyte.
    expect(branding.UPLOAD_GRENZEN.twintqr.maxBytes).toBeLessThan(
      branding.UPLOAD_GRENZEN.socialpost.maxBytes,
    );
    const werte = new Set(Object.values(branding.UPLOAD_GRENZEN).map((g) => g.maxBytes));
    expect(werte.size).toBeGreaterThan(1);
  });
});

describe('Upload-Grenzen: alle Schichten passen zusammen', () => {
  it('lässt die Middleware mehr durch als die grösste Bildgrenze', () => {
    expect(klongrenze()).toBeGreaterThan(branding.GROESSTE_BILDGRENZE);
  });

  it('kennt jede Route, die ein Formular liest', () => {
    const routen = formularRouten().map(({ pfad }) => pfad);
    // Wenn hier nichts gefunden wird, prüft der Test nichts - dann stimmt der
    // Sucher nicht mehr, und das wäre die stillste Art zu scheitern.
    expect(routen.length).toBeGreaterThanOrEqual(10);
    const unbekannt = routen.filter((pfad) => !(pfad in ROUTEN_GRENZE));
    expect(unbekannt, 'neue Formular-Route ohne Eintrag in ROUTEN_GRENZE').toEqual([]);
  });

  it('hält jede Formular-Route entweder unter der Klongrenze oder draussen', () => {
    const grenze = klongrenze();
    const verletzungen = formularRouten()
      .map(({ pfad }) => ({ pfad, erlaubt: ROUTEN_GRENZE[pfad] }))
      .filter(({ pfad, erlaubt }) => {
        if (erlaubt === 'ausgenommen') {
          // Ausgenommen heisst: muss wirklich im Matcher stehen.
          return !MIDDLEWARE.includes(pfad);
        }
        if (erlaubt === 'ohne Datei') {
          return false;
        }
        return typeof erlaubt !== 'number' || erlaubt > grenze;
      })
      .map(({ pfad }) => pfad);

    expect(verletzungen, 'Routen, deren Körper die Middleware abschneiden würde').toEqual([]);
  });

  it('nimmt genau die drei grossen Übertragungen aus', () => {
    // Je weniger Ausnahmen, desto weniger lässt sich vergessen. Diese drei
    // sind die einzigen, die über der Klongrenze liegen dürfen.
    for (const pfad of ['/api/clips/upload', '/api/level/import', '/api/jail/import']) {
      expect(MIDDLEWARE, pfad).toContain(pfad);
      // Einmal in der Liste, einmal im Matcher - sonst greift die Ausnahme nicht.
      expect(MIDDLEWARE).toContain(pfad.slice(1));
    }
  });

  it('bleibt unter dem Dach des Reverse Proxy', () => {
    const nginx = readFileSync(join(WURZEL, 'deploy/nginx/system.swisshub.gg.conf'), 'utf8');
    const global = /client_max_body_size\s+(\d+)m;/u.exec(nginx);
    expect(global, 'client_max_body_size fehlt').not.toBeNull();
    // nginx bricht sonst mit 413 ab, bevor die Anwendung die Datei sieht -
    // und dann kommt nicht einmal eine Meldung aus dieser Anwendung.
    expect(Number(global?.[1]) * 1024 * 1024).toBeGreaterThan(branding.GROESSTE_BILDGRENZE);
  });
});

describe('Upload-Fehler: die Meldung nennt die Grösse', () => {
  it('übersetzt ein gescheitertes Formular in eine Grössenmeldung', () => {
    const helfer = readFileSync(join(WURZEL, 'apps/web/src/server/upload.ts'), 'utf8');
    expect(helfer).toContain('Die Datei ist zu gross. Maximal erlaubt:');
    // VALIDATION_FAILED und nicht INTERNAL: nur so kommt der Text überhaupt
    // bis zur Person - ein INTERNAL wird durch einen Sammeltext ersetzt.
    expect(helfer).toContain("AppError('VALIDATION_FAILED'");
  });

  it('wird von den beiden Bild-Uploads benutzt', () => {
    for (const datei of [
      'apps/web/src/app/api/social-media/upload/route.ts',
      'apps/web/src/app/api/level/xp-slot/upload/route.ts',
    ]) {
      const quelle = readFileSync(join(WURZEL, datei), 'utf8');
      expect(quelle, datei).toContain('leseFormular(request');
      expect(quelle, datei).not.toContain('await request.formData()');
    }
  });

  it('nennt dieselbe Zahl wie die Konfiguration', () => {
    // Der XP-Slot-Upload führt Bild und Klang mit verschiedenen Grenzen, also
    // nennt seine Meldung die Schicht darüber. Dass die Zahl stimmt, lässt
    // sich nur hier prüfen - die Konfiguration ist kein Modul der Anwendung.
    const quelle = readFileSync(join(WURZEL, 'apps/web/src/app/api/level/xp-slot/upload/route.ts'), 'utf8');
    const genannt = /leseFormular\(request,\s*(\d+)\)/u.exec(quelle)?.[1];
    expect(Number(genannt) * 1024 * 1024).toBe(klongrenze());
  });

  it('meldet die Grenze des Namensraums beim Post Creator', () => {
    const quelle = readFileSync(join(WURZEL, 'apps/web/src/app/api/social-media/upload/route.ts'), 'utf8');
    expect(quelle).toContain('UPLOAD_GRENZEN.socialpost.maxBytes');
  });
});
