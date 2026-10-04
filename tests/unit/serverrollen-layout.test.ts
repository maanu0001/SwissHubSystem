import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Das Spaltenraster und die Berechtigungen - geprüft am Quelltext.
 *
 * ## Warum am Quelltext und nicht im Browser
 *
 * Weil die Aussagen hier **struktureller** Art sind: dass die Spaltenklassen
 * vier Fälle abdecken und nicht aus einer Zeichenkette zusammengesetzt werden,
 * dass das Telefon nie mehr als eine Spalte bekommt, dass nirgends ein
 * `transform: scale()` steht, und dass jede neue Aktion an einer Berechtigung
 * hängt. Das sind Aussagen darüber, was im Code steht und was **nicht** - und
 * dafür ist der Quelltext die Wahrheit.
 *
 * Die eine Sache, die man hier nicht sieht - wie es aussieht -, hängt an genau
 * diesen Klassen: Tailwind erzeugt nur, was im Quelltext steht.
 */

const lies = (pfad: string): string => readFileSync(pfad, 'utf8');
const ohneKommentare = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');

const SEITE = 'apps/web/src/app/serverrollen/page.tsx';
const VERWALTUNG = 'apps/web/src/modules/serverrollen/components/kategorien-verwaltung.tsx';
const ACTIONS = 'apps/web/src/modules/serverrollen/actions.ts';
const EMBED = 'packages/modules/src/serverrollen/embed.ts';
const DIENST = 'packages/modules/src/serverrollen/dienst.ts';
const BOT = 'apps/bot/src/serverrollen-interactions.ts';

describe('Spaltenraster der öffentlichen Seite', () => {
  const quelle = lies(SEITE);
  /*
   * Fuer die Verbote die kommentarfreie Fassung.
   *
   * Im Kommentar der Seite steht `grid-cols-${n}` als Gegenbeispiel - genau
   * das, was hier nicht vorkommen soll. Ein Test, der den Kommentar mitliest,
   * schlaegt an der Erklaerung an statt am Code.
   */
  const ohneTexte = ohneKommentare(quelle);

  it('kennt alle vier Spaltenzahlen als feste Klassen', () => {
    /*
     * Feste Klassen, kein Zusammensetzen.
     *
     * `grid-cols-${n}` steht nirgends im Quelltext und landet deshalb nicht im
     * erzeugten CSS - die Klasse existiert zur Laufzeit nicht, und das Raster
     * bliebe einspaltig. Dieser Test hält genau das fest.
     */
    expect(quelle).toContain('function spaltenKlasse');
    expect(ohneTexte).not.toMatch(/grid-cols-\$\{/u);
    expect(quelle).toContain("return 'md:grid-cols-2';");
    expect(quelle).toContain("return 'md:grid-cols-2 lg:grid-cols-3';");
    expect(quelle).toContain("return 'md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';");
    expect(quelle).toContain("return 'grid-cols-1';");
  });

  it('gibt dem Telefon immer genau eine Spalte', () => {
    const block = ohneTexte.slice(ohneTexte.indexOf('function spaltenKlasse'));
    /*
     * Jede Mehrspaltigkeit haengt an einem Breakpoint. Eine Klasse ohne
     * Praefix - `grid-cols-2` statt `md:grid-cols-2` - würde ab 0 Pixeln
     * gelten, und damit auf 390 Pixeln zwei Streifen von je 170 ergeben.
     */
    for (const treffer of block.matchAll(/grid-cols-([234])/gu)) {
      const davor = block.slice(Math.max(0, treffer.index - 4), treffer.index);
      expect(davor, treffer[0]).toMatch(/(md|lg|xl):$/u);
    }
  });

  it('deckelt das Tablet und bringt die vierte Spalte erst später', () => {
    // Vier Spalten auf einem 768er-Tablet wären wieder 170 Pixel je Karte.
    expect(ohneTexte).toContain('xl:grid-cols-4');
    expect(ohneTexte).not.toContain('md:grid-cols-4');
    expect(ohneTexte).not.toContain('lg:grid-cols-4');
  });

  it('skaliert nichts', () => {
    // Ausdrücklich nicht gewollt: unscharfer Text und verschobene Klickflächen.
    expect(ohneTexte).not.toContain('scale(');
    expect(ohneTexte).not.toContain('transform: scale');
  });

  it('nimmt die Spaltenzahl aus der Gruppe und nicht aus einem Breakpoint', () => {
    expect(quelle).toContain('spaltenKlasse(gruppe.spalten)');
  });

  it('behält an der Rollenkarte alles, was sie vorher zeigte', () => {
    /*
     * Ein Layoutwechsel darf keine Funktion kosten. Farbe, Name,
     * Beschreibung, der Knopf und der Stand des Mitglieds stehen weiter da.
     */
    expect(quelle).toContain('backgroundColor: rolle.farbe');
    expect(quelle).toContain('{rolle.name}');
    expect(quelle).toContain('{rolle.beschreibung}');
    expect(quelle).toContain('<RollenKnopf');
    expect(quelle).toContain('hatSie={meine.has(rolle.discordRoleId)}');
    expect(quelle).toContain('vergebbar={rolle.selbstVergebbar}');
    expect(quelle).toContain('entfernbar={rolle.selbstEntfernbar}');
  });

  it('stellt den Knopf nur in einer Spalte neben den Text', () => {
    // Ab zwei Spalten ist die Karte zu schmal dafür.
    expect(quelle).toContain("gruppe.spalten === 1 && 'sm:flex-row");
  });
});

describe('Spaltenwahl im Dashboard', () => {
  const quelle = lies(VERWALTUNG);

  it('bietet genau eins bis vier an', () => {
    expect(quelle).toContain('[1, 2, 3, 4].map');
    expect(quelle).toContain('spalten: Number.parseInt(wert, 10)');
  });

  it('hat je Gruppe einen Kasten für das Discord-Menü', () => {
    expect(quelle).toContain('function EmbedKasten');
    expect(quelle).toContain('<ChannelSelect');
    expect(quelle).toContain('sendeEmbedAction');
    expect(quelle).toContain('entferneEmbedAction');
    expect(quelle).toContain('speichereEmbedAction');
  });

  it('sagt im Klartext, ob das Menü steht, fehlt oder noch nicht veröffentlicht ist', () => {
    expect(quelle).toContain('Noch nicht veröffentlicht.');
    expect(quelle).toContain('nicht mehr da');
    expect(quelle).toContain('Zuletzt geschrieben');
    // Und wie viele Rollen im Menü stünden - sonst klickt man ins Leere.
    expect(quelle).toContain('gruppe.embedOptionen');
  });

  it('beschriftet den Knopf nach dem Zustand', () => {
    // «Veröffentlichen» auf einer Nachricht, die schon steht, wäre eine Lüge.
    expect(quelle).toContain("gruppe.embedMessageId ? 'Aktualisieren' : 'Veröffentlichen'");
  });
});

describe('Berechtigungen und Audit', () => {
  const actions = ohneKommentare(lies(ACTIONS));

  it('hängt jede Embed-Aktion an die Pflege-Berechtigung', () => {
    for (const name of [
      'serverrollen.embed.speichern',
      'serverrollen.embed.senden',
      'serverrollen.embed.entfernen',
    ]) {
      const stelle = actions.indexOf(`name: '${name}'`);
      expect(stelle, name).toBeGreaterThan(-1);
      const block = actions.slice(stelle, stelle + 400);
      expect(block, name).toContain('permission: serverrollen.SERVERROLLEN_PERMISSIONS.manage');
      expect(block, name).toContain('rateLimit:');
    }
  });

  it('lässt kein selfService an die Embed-Aktionen', () => {
    /*
     * `selfService: true` heisst «wirkt nur auf den Aufrufer und braucht
     * deshalb keine Berechtigung». Eine Nachricht in einem Kanal wirkt auf
     * alle - das wäre genau der falsche Schalter.
     */
    const embedTeil = actions.slice(actions.indexOf("name: 'serverrollen.embed.speichern'"));
    expect(embedTeil).not.toContain('selfService: true');
  });

  it('nennt keine festen Rollen- oder Benutzerkennungen', () => {
    for (const datei of [ACTIONS, EMBED, BOT]) {
      expect(ohneKommentare(lies(datei)), datei).not.toMatch(/\d{17,20}/u);
    }
  });

  it('schreibt die Adminvorgänge ins Audit und den Spaltenwechsel nicht', () => {
    const embed = lies(EMBED);
    expect(embed).toContain('AUDIT_ACTIONS.SERVERROLE_EMBED_PUBLISHED');
    expect(embed).toContain('AUDIT_ACTIONS.SERVERROLE_EMBED_UPDATED');
    expect(embed).toContain('AUDIT_ACTIONS.SERVERROLE_EMBED_REMOVED');
    /*
     * Die Spaltenzahl ändert die Breite einer Kachel und sonst nichts. Ein
     * Log, das jede Layoutschraube mitschreibt, verdeckt die Einträge, auf
     * die es ankommt.
     */
    const verwaltung = ohneKommentare(lies('packages/modules/src/serverrollen/verwaltung.ts'));
    expect(verwaltung).not.toContain('recordAudit');
  });
});

describe('Die Interaktion traut dem Client nichts', () => {
  const bot = ohneKommentare(lies(BOT));
  const dienst = ohneKommentare(lies(DIENST));

  it('nimmt aus der Kennung nur die Gruppe', () => {
    expect(bot).toContain('serverrollen.leseGruppenId(interaction.customId)');
    // Keine eigene Zerlegung der Kennung und keine Rolle daraus.
    expect(bot).not.toMatch(/customId\.split/u);
  });

  it('entscheidet im Bot nichts selbst', () => {
    expect(bot).toContain('serverrollen.setzeGruppenauswahl');
    // Keine zweite Sicherheitsprüfung und kein direkter Rollenzugriff.
    expect(bot).not.toContain('pruefeSelbstzuweisung');
    expect(bot).not.toContain('discord.roles');
    expect(bot).not.toContain('setRoles');
  });

  it('antwortet nur dem Aufrufer', () => {
    expect(bot).toContain('MessageFlags.Ephemeral');
  });

  it('prüft im Dienst die Zugehörigkeit zur Gruppe', () => {
    expect(dienst).toContain("grund: 'fremde_rolle'");
    expect(dienst).toContain('pruefeSelbstzuweisung');
    // Ein Schreibvorgang für den ganzen Tausch.
    expect(dienst).toContain('discord.members.setRoles(discordId, naechste');
  });

  it('sieht nach, ob die Änderung wirklich angekommen ist', () => {
    /*
     * `setRoles` wirft bei einem Fehler - aber es gibt den Fall dazwischen:
     * Discord nimmt den Aufruf an und eine Rolle fehlt doch, weil sich die
     * Hierarchie in derselben Sekunde verschoben hat.
     */
    expect(dienst).toContain('const danach = await discord.members.get(discordId)');
    expect(dienst).toContain('nicht vollständig übernommen');
  });
});
