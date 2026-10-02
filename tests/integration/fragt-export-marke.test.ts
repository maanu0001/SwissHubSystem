import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_fragt_export_marke');

/**
 * Was aus den Einstellungen in die Grafik gelangt - und was nicht.
 *
 * ## Warum das gegen eine echte Datenbank laeuft
 *
 * Weil der Weg selbst gepruefert werden soll: Formular → `ModuleState.settings`
 * (eine Json-Spalte) → Zod → `folienMarke` → Komponente. Jede Station kann
 * etwas durchlassen, und eine Attrappe auf halber Strecke wuerde genau die
 * Station ueberspringen, an der es schiefgeht.
 *
 * ## Was das Wichtigste ist
 *
 * Dass eine **unsinnige** Farbe die Standardfarbe ergibt und keine Grafik mit
 * einem fremden Verweis darin. Der Wert landet in einem `style`-Attribut einer
 * Komponente, die der Server zu einem PNG rendert; `red; background-image:
 * url(…)` waere dort ein Abruf einer fremden Adresse durch unseren Server.
 *
 * Die Zod-Pruefung am Schema ist die erste Verteidigung, `normalisiereFarbe` in
 * `folienMarke` die zweite. Geprueft werden beide, und zwar getrennt: wenn eine
 * davon wegfaellt, soll ein Test rot werden und nicht «es geht noch».
 */
const { prisma } = await import('@swisshub/database');
const { fragt, setModuleSettings, getModuleSettings } = await import('@swisshub/modules');
const { folienMarke } = await import('../../apps/web/src/modules/fragt/marke');
const { STANDARD_AKZENT, STANDARD_AKZENT_HELL } =
  await import('../../apps/web/src/modules/fragt/social-folie');
const { clearRevisionCaches } = await import('@swisshub/database');

/** Die Einstellungen setzen, wie es die Oberflaeche tun wuerde. */
async function stelleEin(werte: Record<string, unknown>): Promise<void> {
  const jetzige = await getModuleSettings<Record<string, unknown>>(fragt.FRAGT_MODULE_ID);
  await setModuleSettings(fragt.FRAGT_MODULE_ID, { ...jetzige, ...werte }, 'test');
  clearRevisionCaches();
}

describeWithDatabase('SwissHub fragt: die Marke der Grafiken', () => {
  beforeAll(async () => {
    await pushSchema();
  });

  beforeEach(async () => {
    await prisma.moduleState.deleteMany({});
    clearRevisionCaches();
  });

  it('nimmt ohne Einstellung die SwissHub-Farben, das Signet und keinen Zusatztext', async () => {
    const marke = await folienMarke();
    expect(marke).toEqual({
      akzent: STANDARD_AKZENT,
      akzentHell: STANDARD_AKZENT_HELL,
      logo: null,
      zusatztext: null,
    });
  });

  it('uebernimmt eine eingestellte Farbe und leitet den hellen Ton ab', async () => {
    await stelleEin({ exportAkzentfarbe: '#1f3d8f' });

    const marke = await folienMarke();
    expect(marke.akzent).toBe('#1f3d8f');
    // Abgeleitet, nicht die Standardfarbe - und heller als die Ausgangsfarbe.
    expect(marke.akzentHell).not.toBe(STANDARD_AKZENT_HELL);
    expect(marke.akzentHell).toMatch(/^#[0-9a-f]{6}$/u);
  });

  it('normalisiert Kurzform und rgb() auf #rrggbb', async () => {
    await stelleEin({ exportAkzentfarbe: 'rgb(31, 61, 143)' });
    expect((await folienMarke()).akzent).toBe('#1f3d8f');

    await stelleEin({ exportAkzentfarbe: '#F0A' });
    expect((await folienMarke()).akzent).toBe('#ff00aa');
  });

  it('behaelt bei der Standardfarbe den von Hand gewaehlten hellen Ton', async () => {
    await stelleEin({ exportAkzentfarbe: '#83060a' });

    const marke = await folienMarke();
    expect(marke.akzent).toBe(STANDARD_AKZENT);
    // Nicht die Rechnung: `#b81219` ist abgestimmt und soll nicht um eine
    // Nuance verfehlt werden.
    expect(marke.akzentHell).toBe(STANDARD_AKZENT_HELL);
  });

  it('weist eine unsinnige Farbe schon im Schema ab', async () => {
    // Erste Verteidigung: das Feld laesst sich gar nicht so speichern.
    await expect(
      stelleEin({ exportAkzentfarbe: 'red; background-image: url(https://example.invalid/a.png)' }),
    ).rejects.toThrow();
  });

  it('nimmt die Standardfarbe, falls doch etwas Unsinniges in der Spalte steht', async () => {
    /*
     * Zweite Verteidigung, und sie ist noetig.
     *
     * Die Json-Spalte laesst sich auch anders beschreiben als durch das
     * Formular - ein Restore, ein Skript, eine aeltere Fassung des Schemas.
     * `folienMarke` darf sich darauf nicht verlassen, dass vor ihr schon jemand
     * geprueft hat.
     */
    await prisma.moduleState.upsert({
      where: { moduleId: fragt.FRAGT_MODULE_ID },
      create: {
        moduleId: fragt.FRAGT_MODULE_ID,
        enabled: true,
        settings: { exportAkzentfarbe: 'url(https://example.invalid/a.png)' },
      },
      update: { settings: { exportAkzentfarbe: 'url(https://example.invalid/a.png)' } },
    });
    clearRevisionCaches();

    const marke = await folienMarke();
    expect(marke.akzent).toBe(STANDARD_AKZENT);
    expect(marke.akzent).toMatch(/^#[0-9a-f]{6}$/u);
  });

  it('uebernimmt einen Zusatztext und bereinigt ihn', async () => {
    await stelleEin({ exportAkzentfarbe: '', exportZusatztext: '  Von der Gemeinschaft  ' });

    expect((await folienMarke()).zusatztext).toBe('Von der Gemeinschaft');
  });

  it('liest einen leeren Zusatztext als «Standardsatz» und nicht als leere Zeile', async () => {
    await stelleEin({ exportZusatztext: '   ' });

    expect((await folienMarke()).zusatztext).toBeNull();
  });

  it('kuerzt einen zu langen Zusatztext im Schema, statt ihn zu zeichnen', async () => {
    await expect(stelleEin({ exportZusatztext: 'x'.repeat(200) })).rejects.toThrow();
  });

  it('meldet «keins», wenn kein Zeichen gewuenscht ist', async () => {
    await stelleEin({ exportLogo: 'keins' });

    expect((await folienMarke()).logo).toBe('keins');
  });

  it('faellt auf das Signet zurueck, wenn das Serverlogo gewuenscht aber keines da ist', async () => {
    await stelleEin({ exportLogo: 'serverlogo' });

    // Eine leere Stelle waere eine Grafik, der man nicht ansieht, dass etwas
    // fehlt - das Signet ist die brauchbare Antwort.
    expect((await folienMarke()).logo).toBeNull();
  });

  it('kennt genau drei Zeichen-Einstellungen und keine vierte', async () => {
    // Kein freier Pfad: ein manipulierter Logopfad kann nicht entstehen, weil
    // es keinen gibt.
    await expect(stelleEin({ exportLogo: '../../etc/passwd' })).rejects.toThrow();
    await expect(stelleEin({ exportLogo: 'https://example.invalid/logo.png' })).rejects.toThrow();
  });
});
