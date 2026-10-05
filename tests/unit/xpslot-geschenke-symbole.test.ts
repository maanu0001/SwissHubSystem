import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Geschenke per Suche, Symbolbilder mit einem Klick.
 *
 * Beides sind Zusagen über eine Bedienung, und beide waren vorher je eine
 * Zeile Formularzustand von der Erfüllung entfernt:
 *
 *  - Geschenke verlangten eine **Discord-Kennung** im Textfeld. Achtzehn
 *    Ziffern, ohne Rückmeldung, wer gemeint ist.
 *  - Der Symbol-Upload schrieb die Referenz nur in den Browser und wartete
 *    auf einen zweiten Klick, der im Betrieb ausblieb.
 *
 * Das Verhalten dahinter prüft `tests/integration/xpslot-symbolbild.test.ts`
 * gegen eine echte Datenbank.
 */
const lies = (pfad: string): string => readFileSync(pfad, 'utf8');
const verwaltung = lies('apps/web/src/modules/level/xpslot/components/verwaltung.tsx');
const aktionen = lies('apps/web/src/modules/level/xpslot-actions.ts');
const kern = lies('packages/modules/src/level/xpslot/verwaltung.ts');

describe('XP-Slot: Geschenke per Benutzersuche', () => {
  it('benutzt den zentralen Picker statt eines Kennungsfeldes', () => {
    expect(verwaltung).toContain("from '@/components/shared/personensuche'");
    expect([...verwaltung.matchAll(/<Personensuche<Personentreffer>/gu)]).toHaveLength(2);
    // Die alte Form - ein Textfeld mit einer Beispielkennung.
    expect(verwaltung).not.toContain('placeholder="123456789012345678"');
    expect(verwaltung).not.toContain('Discord-Kennung');
  });

  it('schickt weiterhin die Kennung an den Server', () => {
    // Innen bleibt alles wie vorher: die Aktion kennt nur Kennungen.
    expect(verwaltung).toContain("discordId: neuPerson?.discordId ?? ''");
    expect(verwaltung).toContain("discordId: bonusPerson?.discordId ?? ''");
    expect(aktionen).toContain('discordId: z.string().regex(/^\\d{17,20}$/u');
  });

  it('gibt den Knopf erst frei, wenn eine Person gewählt ist', () => {
    expect(verwaltung).toContain('disabled={laeuft || neuPerson === null}');
    expect(verwaltung).toContain('disabled={laeuft || bonusPerson === null}');
    // Und setzt sich danach zurück, damit niemand zweimal verschenkt.
    expect(verwaltung).toContain('setNeuPerson(null);');
    expect(verwaltung).toContain('setBonusPerson(null);');
  });

  it('sucht serverseitig unter den Spielberechtigten', () => {
    expect(aktionen).toContain('export const xpslotPersonSuchenAction');
    expect(aktionen).toContain('permission: P.xpslotFreespinsManage');
    expect(aktionen).toContain('traegerSuche(P.xpslotPlay, input.begriff');
    expect(aktionen).toContain("rateLimit: 'slotAdmin'");
  });

  it('zeigt im Treffer Gesicht, Name und Benutzername', () => {
    const picker = lies('apps/web/src/components/shared/personensuche.tsx');
    expect(picker).toContain('<DiscordAvatar');
    expect(picker).toContain('{person.name}');
    expect(picker).toContain('@{person.username}');
  });
});

describe('XP-Slot: Symbolbild persistiert sofort', () => {
  it('speichert direkt nach dem Upload', () => {
    expect(verwaltung).toContain('const gesetzt = await symbolBildAction({');
    expect(verwaltung).toContain("toast.success('Bild gespeichert.');");
    // Die alte Fussnote, die im Betrieb überlesen wurde.
    expect(verwaltung).not.toContain('Noch speichern');
  });

  it('hat dafür eine schmale Aktion, die nur das Bild anfasst', () => {
    expect(aktionen).toContain('export const symbolBildAction');
    expect(aktionen).toContain('schema: S.symbolBildSchema');
    expect(aktionen).toContain('permission: P.xpslotManage');
    expect(kern).toContain('export async function setzeSymbolbild');
    expect(kern).toContain('data: { imagePath: eingabe.bildPfad, imageUrl: eingabe.bildUrl }');
  });

  it('räumt die ersetzte Datei weg', () => {
    expect(kern).toContain('if (vorher.imagePath && vorher.imagePath !== symbol.imagePath)');
    expect(kern).toContain('await loescheSymbolbild(vorher.imagePath)');
  });

  it('lässt die Spielbarkeit aus dem Spiel', () => {
    /*
     * `speichereSymbol` prüft die RTP und lehnt ab, wenn der Slot unspielbar
     * würde - richtig für Gewichte und Auszahlungen. Ein Bild ändert davon
     * nichts, und eine Sperre dort hiesse: kein neues Symbol, solange jemand
     * anders eine Gewichtung verstellt hat.
     */
    const stelle = kern.indexOf('export async function setzeSymbolbild');
    const ende = kern.indexOf('/** Nur die Auszahlungen', stelle);
    const rumpf = kern.slice(stelle, ende);
    expect(rumpf).not.toContain('spielbar(');
    expect(rumpf).not.toContain('rtpVon(');
  });

  it('benutzt keine blob-URL als Quelle', () => {
    /*
     * Eine `blob:`-Adresse lebt genau so lange wie der Tab. Als Vorschau
     * waere sie bequem und als Persistenz der Fehler, den dieser Auftrag
     * behebt - gezeigt wird darum immer die ausgelieferte Datei.
     */
    expect(verwaltung).not.toContain('URL.createObjectURL');
    const adressen = lies('apps/web/src/modules/level/xpslot/adressen.ts');
    expect(adressen).not.toContain('blob:');
    expect(adressen).toContain('/api/level/xp-slot/datei/');
  });

  it('bekommt mit jeder neuen Datei eine neue Adresse', () => {
    /*
     * Der Dateiname ist zufaellig, der Inhalt unveraenderlich - deshalb darf
     * die Auslieferung `immutable` cachen, und ein neues Symbol ist trotzdem
     * sofort sichtbar: es hat eine andere Adresse.
     */
    const speicher = lies('packages/modules/src/branding/storage.ts');
    expect(speicher).toContain("return `${kind}-${randomBytes(16).toString('hex')}.${extension}`");
    const route = lies('apps/web/src/app/api/level/xp-slot/datei/[name]/route.ts');
    expect(route).toContain("'Cache-Control': 'private, max-age=31536000, immutable'");
  });
});
