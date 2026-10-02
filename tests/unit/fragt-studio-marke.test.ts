import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Die drei Markenfelder sind im Content Studio angekommen.
 *
 * ## Warum dieser Test existiert
 *
 * Weil die Aufgabe zweimal als erledigt gemeldet wurde und zweimal nicht
 * funktional war - und weil beide Male **dieselbe** Stelle fehlte: der Weg
 * zwischen Entwurf und Oberfläche. Farbe, Zeichen und Zusatztext waren als
 * Moduleinstellungen gebaut; es gab keine Spalte am Entwurf, kein Feld im
 * Studio und kein Attribut in der Ansicht.
 *
 * Ein Test über Verhalten hätte das nicht gefangen: `folienMarke` war grün,
 * die Export-Route lieferte ein Bild, alles tat etwas - nur nicht das
 * Verlangte. Deshalb prüft diese Datei die **Kette**, Station für Station,
 * gegen den Quelltext:
 *
 *     Spalte → Modulkern → Aktion → Seite → Editor → Export-Routen
 *
 * Fehlt eine Station, ist die Funktion aus Sicht des Nutzers nicht da. Genau
 * das soll hier auffallen und nicht in der dritten Rückmeldung.
 */

const FELDER = ['exportAkzentfarbe', 'exportLogo', 'exportZusatztext'] as const;

function quelle(datei: string): string {
  return readFileSync(join(process.cwd(), datei), 'utf8');
}

/** Ohne Kommentare - sonst zählt die Begründung als Treffer. */
function ohneKommentare(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');
}

describe('Content Studio: Farbe, Zeichen und Zusatztext je Export', () => {
  it.each(FELDER)('hat für %s eine Spalte am Entwurf', (feld) => {
    const schema = quelle('packages/database/prisma/schema.prisma');
    const modell = schema.slice(schema.indexOf('model FragtEntwurf {'));
    const ende = modell.indexOf('\n}\n');
    expect(ohneKommentare(modell.slice(0, ende))).toContain(feld);
  });

  it('hat eine Migration, die rein additiv ist', () => {
    const sql = quelle('packages/database/prisma/migrations/20261018080000_fragt_export_marke/migration.sql');
    for (const feld of FELDER) {
      expect(sql).toContain(`ADD COLUMN "${feld}"`);
    }
    /*
     * Keine zerstörenden Anweisungen. Eine Migration, die eine Spalte
     * umbenennt oder Werte setzt, würde bestehende Entwürfe verändern - und
     * «keine produktiven Daten verlieren» ist keine Hoffnung, sondern eine
     * Eigenschaft dieser Datei.
     */
    expect(sql).not.toMatch(/DROP|ALTER COLUMN|UPDATE |DELETE /u);
  });

  it.each(FELDER)('nimmt %s in der Eingabe des Modulkerns an', (feld) => {
    const kern = ohneKommentare(quelle('packages/modules/src/fragt/entwurf.ts'));
    // In der Schnittstelle **und** im Schreibvorgang. Nur in der
    // Schnittstelle wäre ein Feld, das stillschweigend verfällt.
    expect(kern).toContain(`${feld}?:`);
    expect(kern).toContain(`${feld}:`);
  });

  it('prüft die drei Werte beim Schreiben', () => {
    const kern = ohneKommentare(quelle('packages/modules/src/fragt/entwurf.ts'));
    // Die Farbe wird umgewandelt, nicht übernommen.
    expect(kern).toContain('normalisiereFarbe(eingabe.exportAkzentfarbe)');
    // Das Zeichen kommt aus einer Erlaubnisliste - nie ein freier Pfad.
    expect(kern).toContain('EXPORT_LOGO_WAHLEN');
    // Der Text wird bereinigt und begrenzt.
    expect(kern).toContain('sanitizeText(eingabe.exportZusatztext, 80)');
  });

  it.each(FELDER)('nimmt %s im Schema der Server Action an', (feld) => {
    const aktionen = ohneKommentare(quelle('apps/web/src/modules/fragt/actions.ts'));
    expect(aktionen).toMatch(new RegExp(`${feld}:\\s*z\\.`, 'u'));
  });

  it('lässt null durch die Aktion - zum Zurücksetzen', () => {
    /*
     * «Nicht übergeben» heisst unverändert, `null` heisst zurücksetzen. Ohne
     * `.nullable()` gäbe es keinen Weg zurück zur Moduleinstellung, und der
     * Knopf «Modul» im Studio wäre ein Knopf, der nichts tut.
     */
    const aktionen = ohneKommentare(quelle('apps/web/src/modules/fragt/actions.ts'));
    for (const feld of FELDER) {
      const stelle = aktionen.indexOf(`${feld}: z.`);
      expect(stelle, feld).toBeGreaterThan(0);
      expect(aktionen.slice(stelle, stelle + 160), feld).toContain('nullable()');
    }
  });

  it('trägt die drei Werte in die Ansicht des Studios', () => {
    const seite = ohneKommentare(quelle('apps/web/src/app/(app)/fragt/studio/[entwurfId]/page.tsx'));
    expect(seite).toContain('quelle.entwurf.exportAkzentfarbe');
    expect(seite).toContain('quelle.entwurf.exportLogo');
    expect(seite).toContain('quelle.entwurf.exportZusatztext');
    // Und die Vorgabe des Moduls, damit «wie im Modul» beschriftet werden kann.
    expect(seite).toContain('markenVorgabe()');
  });

  it('zeigt im Editor ein Bedienelement für jedes der drei', () => {
    const editor = ohneKommentare(quelle('apps/web/src/modules/fragt/components/studio-editor.tsx'));
    // Farbe: ein echtes Farbfeld und ein Hexfeld daneben.
    expect(editor).toContain('type="color"');
    expect(editor).toContain('studio-farbe');
    // Zeichen: die Auswahl samt «wie im Modul» als eigener Zustand.
    expect(editor).toContain('LOGO_LABEL');
    expect(editor).toMatch(/\[null, 'signet', 'serverlogo', 'keins'\]/u);
    // Zusatztext.
    expect(editor).toContain('studio-zusatz');
    // Und alle drei gehen beim Speichern mit.
    for (const feld of FELDER) {
      expect(editor, feld).toContain(`${feld}:`);
    }
  });

  it('gibt der Vorschau und beiden Exporten denselben Entwurf', () => {
    /*
     * Die Vorschau im Studio **ist** die Einzelbild-Route - derselbe Aufruf,
     * dasselbe Bild. Dass sie zusammenpassen, ist deshalb keine Zusage, die
     * eingehalten werden muss, sondern eine, die nicht zu brechen ist.
     *
     * Was zu brechen wäre: eine der beiden Routen, die `folienMarke()` ohne
     * Entwurf ruft. Genau so ging die Wahl im Studio verloren, und genau das
     * steht hier.
     */
    for (const datei of [
      'apps/web/src/app/api/fragt/grafik/[entwurfId]/route.tsx',
      'apps/web/src/app/api/fragt/grafik/[entwurfId]/zip/route.tsx',
    ]) {
      const text = ohneKommentare(quelle(datei));
      expect(text, datei).toContain('folienMarke(quelle.entwurf)');
      expect(text, datei).not.toContain('folienMarke()');
    }

    const editor = ohneKommentare(quelle('apps/web/src/modules/fragt/components/studio-editor.tsx'));
    expect(editor).toContain('/api/fragt/grafik/${ansicht.entwurfId}');
  });

  it('lässt dem Entwurf den Vortritt vor der Moduleinstellung', () => {
    const marke = ohneKommentare(quelle('apps/web/src/modules/fragt/marke.ts'));
    for (const feld of FELDER) {
      expect(marke, feld).toContain(`entwurf?.${feld} ??`);
    }
    /*
     * `??` und nicht `||`: ein leerer Zusatztext ist eine Aussage («keine
     * Fusszeile») und kein fehlender Wert. Mit `||` sähe der Nutzer seinen
     * gelöschten Text wieder auftauchen.
     */
    expect(marke).not.toMatch(/entwurf\?\.\w+ \|\|/u);
  });
});
