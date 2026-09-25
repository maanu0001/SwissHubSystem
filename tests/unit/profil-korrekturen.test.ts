import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Drei Kleinigkeiten, die in der Oberflaeche gross wirkten.
 *
 * Alle drei haben gemeinsam, dass sie sich nicht an einem Dienst pruefen
 * lassen: sie stehen in Komponenten. Geprueft wird deshalb der Quelltext -
 * eng genug, dass die Zusage haelt, und weit genug, dass eine Umformulierung
 * nicht gleich rot wird.
 */

const WURZEL = join(process.cwd(), 'apps/web/src');
const lies = (pfad: string): string => readFileSync(join(WURZEL, pfad), 'utf8');

describe('Mein Profil: keine Turnier-Kachel', () => {
  const akte = lies('modules/members/components/mitglieds-akte.tsx');

  it('haengt die Kachel an dieselbe Regel wie den Reiter', () => {
    /*
     * Der Reiter «Turniere» war im eigenen Profil bereits weg, die Kachel in
     * der Uebersicht blieb stehen - eine Zahl, die auf einen Abschnitt zeigt,
     * den es hier gar nicht gibt.
     *
     * Beide aus derselben Menge zu speisen ist die eigentliche Zusage: zwei
     * getrennte Listen fuer dieselbe Frage laufen irgendwann auseinander, und
     * auffallen wuerde es erst an der Stelle, an der es niemand prueft.
     */
    expect(akte).toContain(
      "profil.tournaments && !(selbst && NICHT_IM_EIGENEN_PROFIL.has('tournaments'))",
    );
    expect(akte).toContain("const NICHT_IM_EIGENEN_PROFIL: ReadonlySet<string> = new Set(['tournaments', 'roles'])");
  });

  it('reicht durch, ob es das eigene Profil ist', () => {
    expect(akte).toContain('<Uebersicht profil={profil} selbst={selbst} />');
  });

  it('zeigt die Kachel in einer fremden Akte weiterhin', () => {
    // Die Bedingung ist auf `selbst` eingeschraenkt und nicht auf die Kachel
    // selbst - in der Akte eines anderen Mitglieds steht sie also weiter.
    expect(akte).toContain("kacheln.push({ label: 'Turniere', wert: String(profil.tournaments.gesamt) })");
  });
});

describe('Profil bearbeiten: Avatar und Ring', () => {
  const editor = lies('modules/profile/components/editor/profil-editor.tsx');
  const hero = lies('modules/profile/components/profil-hero.tsx');
  const avatar = lies('components/shared/discord-avatar.tsx');

  it('schaltet den inneren Rand des Avatars ab', () => {
    /*
     * Die Ursache des schief wirkenden Rings: zwei Ringe ineinander.
     * `DiscordAvatar` zeichnet von sich aus einen duennen Rand, und der
     * Vorschaukopf legte den Akzentring darum. Der oeffentliche Profilkopf
     * schaltet den inneren seit jeher ab - die Vorschau hatte es nie getan.
     */
    const vorschau = editor.slice(editor.indexOf('ring-[hsl(var(--profil-akzent)/0.65)]'));
    expect(vorschau).toMatch(/<DiscordAvatar[\s\S]{0,400}?ring=\{false\}/u);
    expect(hero).toMatch(/<DiscordAvatar[\s\S]{0,400}?ring=\{false\}/u);
  });

  it('gibt Avatar und Ring eine feste quadratische Grundlage', () => {
    /*
     * Der Kasten war ein `span` mit `p-1`, dessen Hoehe sich aus dem
     * Zeilenkasten seines Inhalts ergab - die uebliche Quelle fuer einen
     * Kreis, der zur Ellipse wird. Eine gesetzte Kantenlaenge und ein Raster
     * ohne Zeilenkasten nehmen der Geometrie jede Abhaengigkeit vom Inhalt.
     */
    expect(editor).toContain(
      'grid size-14 shrink-0 place-items-center rounded-full ring-2 ring-[hsl(var(--profil-akzent)/0.65)]',
    );
    expect(editor).not.toContain('rounded-full p-1 ring-2 ring-[hsl(var(--profil-akzent)/0.65)]');
  });

  it('haelt die Avatargroesse unabhaengig vom Bildformat', () => {
    // `object-cover` auf einem quadratischen Kasten: ein querformatiges Bild
    // wird beschnitten, nicht verzerrt - und der Kasten bleibt quadratisch.
    expect(avatar).toContain('className="size-full object-cover"');
    expect(avatar).toContain('size-[var(--avatar-size,var(--avatar-eigen))]');
  });
});

describe('Profil teilen: nur kopieren', () => {
  const knopf = lies('modules/profile/components/teilen-knopf.tsx');

  it('oeffnet kein Teilen-Menue des Systems mehr', () => {
    /*
     * Ein Knopf, zwei Verhalten je nach Geraet - das war eines zu viel. Auf
     * dem Telefon sprang ein Systemblatt auf, am Schreibtisch geschah etwas
     * anderes, und wer die Adresse nur in eine Nachricht setzen wollte,
     * musste durch ein Menue, das er nicht bestellt hatte.
     */
    expect(knopf).not.toContain('navigator.share');
  });

  it('oeffnet auch sonst nichts', () => {
    expect(knopf).not.toContain('window.open');
    expect(knopf).not.toContain('target="_blank"');
  });

  it('kopiert und bestaetigt kurz', () => {
    expect(knopf).toContain('inDieZwischenablage(adresse)');
    expect(knopf).toContain("toast.success('Profil-Link kopiert!')");
  });

  it('zeigt die Adresse, wenn die Zwischenablage fehlt', () => {
    /*
     * `navigator.clipboard` gibt es nur in sicheren Kontexten. Fehlt es,
     * traegt der alte Weg ueber ein Textfeld - und traegt auch der nicht,
     * steht die Adresse wenigstens da und laesst sich markieren. Eine
     * Meldung, die nur sagt, es habe nicht geklappt, hilft niemandem.
     */
    expect(knopf).toContain("document.execCommand('copy')");
    expect(knopf).toContain('Die Adresse lautet:');
  });

  it('baut die Adresse aus der Herkunft des Browsers', () => {
    expect(knopf).toContain('`${window.location.origin}/u/${slug}`');
  });
});
