import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SLUG_MAX_LAENGE,
  SLUG_MIN_LAENGE,
  findeFreienSlug,
  gesperrteSlugs,
  istGueltigerSlug,
  normalisiereSlug,
  slugBeanstandung,
  slugVorschlag,
} from '../../packages/modules/src/profile/slug';

/**
 * Die oeffentliche Profiladresse.
 *
 * ## Was hier tatsaechlich schiefgehen kann
 *
 * - **Ein Mitglied belegt einen Systemnamen.** `/u/api` oder `/u/admin` sind
 *   keine Profile, und wer `swisshub` heisst, kann sich als die Plattform
 *   ausgeben.
 * - **Ein frueherer Slug wird neu vergeben.** Dann fuehrt ein Link in einer
 *   Twitch-Bio auf ein fremdes Profil - der schlimmste der Faelle, weil
 *   niemand es merkt.
 * - **Eine Adresse, die keine ist.** Grossbuchstaben, Leerzeichen, ein
 *   Bindestrich am Anfang: alles davon kommt aus Eingaben und muss abgelehnt
 *   werden, nicht stillschweigend zurechtgebogen.
 */
describe('Profil-URL: was ein Slug sein darf', () => {
  it('nimmt eine gewoehnliche Adresse an', () => {
    for (const wert of ['manu', 'manu-2', 'a1', 'x'.repeat(SLUG_MAX_LAENGE), 'lea-aus-bern']) {
      expect(istGueltigerSlug(wert), wert).toBe(true);
      expect(slugBeanstandung(wert), wert).toBeNull();
    }
  });

  it('lehnt ab, was keine Adresse ist - und sagt warum', () => {
    const faelle: Array<[string, RegExp]> = [
      ['', /Gib eine Adresse an/u],
      ['a', /mindestens/u],
      ['x'.repeat(SLUG_MAX_LAENGE + 1), /höchstens/u],
      ['-manu', /Kleinbuchstaben/u],
      ['manu-', /Kleinbuchstaben/u],
      ['manu müller', /Kleinbuchstaben/u],
      ['manu_mueller', /Kleinbuchstaben/u],
      ['manu.mueller', /Kleinbuchstaben/u],
      ['manu/api', /Kleinbuchstaben/u],
      ['../etc/passwd', /Kleinbuchstaben/u],
    ];
    for (const [wert, muster] of faelle) {
      expect(slugBeanstandung(wert), wert).toMatch(muster);
      expect(istGueltigerSlug(wert), wert).toBe(false);
    }
  });

  it('nimmt Grossschreibung an und schreibt sie klein', () => {
    /*
     * Die einzige Zurechtbiegung, die stattfindet - und sie ist keine
     * Umdeutung: `Manu` und `manu` sind dieselbe Adresse, Slugs sind
     * kleingeschrieben. Alles andere wird beanstandet statt geraten.
     */
    expect(slugBeanstandung('Manu')).toBeNull();
    expect(normalisiereSlug('Manu')).toBe('manu');
  });

  it('biegt eine Eingabe nicht zurecht, sondern beanstandet sie', () => {
    /*
     * `normalisiereSlug` macht genau zwei Dinge: Rand-Leerzeichen weg und
     * klein schreiben. Es raet nicht. Wer «Manu Müller» eintippt, soll eine
     * Meldung lesen - eine Adresse, die man nicht selbst gewaehlt hat,
     * ueberrascht beim ersten Teilen.
     */
    expect(normalisiereSlug('  Manu  ')).toBe('manu');
    expect(normalisiereSlug('Manu Müller')).toBe('manu müller');
    expect(slugBeanstandung('Manu Müller')).not.toBeNull();
  });

  it('sperrt jeden oeffentlichen Bereich der Anwendung', () => {
    /*
     * Die Gegenprobe zur Liste im Modul: was neben `/u/` liegt, ist eine
     * Adresse, und ein Mitglied darf sie nicht belegen. Ein neuer
     * oeffentlicher Bereich faellt damit hier auf, statt still von jemandem
     * uebernommen zu sein, der sich frueh einen guten Namen genommen hat.
     */
    const APP = join(process.cwd(), 'apps/web/src/app');
    const oberste = readdirSync(APP).filter(
      (name) => statSync(join(APP, name)).isDirectory() && !name.startsWith('('),
    );
    expect(oberste.length).toBeGreaterThan(5);

    const gesperrt = new Set(gesperrteSlugs());
    for (const ordner of oberste) {
      expect(gesperrt.has(ordner), `«${ordner}» liegt neben (app) und ist nicht gesperrt`).toBe(true);
    }
  });

  it('sperrt Namen, unter denen sich jemand als SwissHub ausgeben koennte', () => {
    for (const wert of ['swisshub', 'admin', 'administrator', 'moderator', 'team', 'support', 'official']) {
      expect(istGueltigerSlug(wert), wert).toBe(false);
      expect(slugBeanstandung(wert), wert).toMatch(/reserviert/u);
    }
  });

  it('sperrt die Namen, unter denen Next selbst antwortet', () => {
    // `/robots.txt` und `/sitemap.xml` liegen nicht in einem Ordner, sondern
    // entstehen aus `robots.ts` und `sitemap.ts`. Ein Profil `robots` waere
    // keine Kollision, aber eine Verwechslung - und sie kostet nichts.
    for (const wert of ['robots', 'sitemap']) {
      expect(istGueltigerSlug(wert), wert).toBe(false);
    }
  });
});

describe('Profil-URL: Vorschlag aus dem Namen', () => {
  it('schreibt Umlaute aus statt sie wegzuwerfen', () => {
    expect(slugVorschlag('Müller')).toBe('mueller');
    expect(slugVorschlag('Grüezi Wohl')).toBe('grueezi-wohl');
    expect(slugVorschlag('Jörg Ärmel')).toBe('joerg-aermel');
  });

  it('macht aus Akzenten den Grundbuchstaben', () => {
    expect(slugVorschlag('Céline')).toBe('celine');
    expect(slugVorschlag('Renée Dupont')).toBe('renee-dupont');
  });

  it('gibt null, wenn nichts Brauchbares uebrig bleibt', () => {
    /*
     * Ein Name aus Emoji ergibt keine Adresse. Hier etwas zu erfinden hiesse,
     * jemandem eine Adresse zu geben, die mit seinem Namen nichts zu tun hat -
     * der Aufrufer nimmt stattdessen `mitglied-<zufall>`.
     */
    for (const name of ['🎮🎮🎮', '...', '   ', '日本', 'a']) {
      expect(slugVorschlag(name), name).toBeNull();
    }
  });

  it('macht aus einem gesperrten Namen keinen Slug', () => {
    expect(slugVorschlag('Admin')).toBeNull();
    expect(slugVorschlag('SwissHub')).toBeNull();
  });

  it('haelt die Laenge auch mit angehaengter Zahl ein', async () => {
    const lang = 'a'.repeat(SLUG_MAX_LAENGE);
    const belegt = new Set([lang]);
    const frei = await findeFreienSlug(lang, async (kandidat) => !belegt.has(kandidat));
    expect(frei).not.toBeNull();
    expect(frei!.length).toBeLessThanOrEqual(SLUG_MAX_LAENGE);
    expect(frei).toBe(`${'a'.repeat(SLUG_MAX_LAENGE - 2)}-2`);
  });

  it('gibt auf, statt endlos zu zaehlen', async () => {
    // Zwanzig Versuche. Wer dann nichts gefunden hat, laeuft gegen etwas
    // anderes als Zufall - und eine Schleife ohne Ende waere die schlechtere
    // Antwort.
    let gefragt = 0;
    const ergebnis = await findeFreienSlug('manu', async () => {
      gefragt += 1;
      return false;
    });
    expect(ergebnis).toBeNull();
    expect(gefragt).toBeLessThanOrEqual(21);
  });

  it('sagt nein, wenn schon der Ausgangspunkt ungueltig ist', async () => {
    expect(await findeFreienSlug('admin', async () => true)).toBeNull();
    expect(await findeFreienSlug('-nope', async () => true)).toBeNull();
  });

  it('kennt dieselben Grenzen, die die Oberflaeche nennt', () => {
    expect(SLUG_MIN_LAENGE).toBe(2);
    expect(SLUG_MAX_LAENGE).toBe(32);
  });
});
