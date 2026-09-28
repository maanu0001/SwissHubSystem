import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_modul_testmodus');

/**
 * Der Testmodus gegen eine echte Datenbank.
 *
 * ## Was hier geprueft wird und was nicht
 *
 * Nicht die Regel - die steht in `tests/unit/modul-testmodus.test.ts` und
 * braucht keine Datenbank. Hier geht es um den Weg **dorthin**: dass der
 * Status wirklich gespeichert wird, dass er die drei Zustaende sauber
 * unterscheidet, und dass die Umschaltung nichts mitnimmt, was sie nicht
 * anfassen soll.
 *
 * ## Die Zugriffsmatrix
 *
 * Sie steht am Ende dieser Datei als Tabelle. Jede Zeile ist ein Fall aus
 * §40, und jede wird einzeln durchgerechnet - nicht, weil die Regel
 * kompliziert waere, sondern weil «Admin sieht es, Mitglied nicht» die Art
 * Aussage ist, bei der ein Vorzeichenfehler niemandem auffaellt, bis das
 * halbfertige Modul in der Seitenleiste der Community steht.
 */
const { prisma } = await import('@swisshub/database');
const {
  getModulStatus,
  listModuleStatus,
  setModulStatus,
  setModuleEnabled,
  setModuleTestMode,
  isModuleEnabled,
  enabledModuleIds,
  testModusModulIds,
  darfStatusOeffnen,
  verborgeneTestModule,
  listModuleDefinitions,
  getModuleDefinition,
} = await import('@swisshub/modules');

/** Ein beliebiges nicht-Kern-Modul aus der echten Registry. */
function pruefModul(): string {
  const treffer = listModuleDefinitions().find((definition) => !definition.core);
  if (!treffer) {
    throw new Error('Kein umschaltbares Modul in der Registry gefunden.');
  }
  return treffer.id;
}

describeWithDatabase('Modul-Testmodus', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.moduleState.deleteMany();
  });

  it('beginnt ohne Zeile beim Vorgabewert - und nie im Testmodus', async () => {
    /*
     * Der Zustand nach der Migration. Jedes bestehende Modul hat entweder
     * eine Zeile ohne `testMode` oder gar keine; beides muss «wie bisher»
     * heissen. Waere die Vorgabe `true`, haette die Migration am Tag ihres
     * Einspielens jedes Modul vor der Community versteckt.
     */
    const modul = pruefModul();
    const definition = getModuleDefinition(modul);
    expect(await getModulStatus(modul)).toBe(definition?.defaultEnabled ? 'AKTIV' : 'DEAKTIVIERT');
    expect(await testModusModulIds()).toEqual(new Set());
  });

  it('speichert die drei Zustaende und liest sie wieder', async () => {
    const modul = pruefModul();

    await setModulStatus(modul, 'TESTMODUS', 'test');
    expect(await getModulStatus(modul)).toBe('TESTMODUS');

    await setModulStatus(modul, 'AKTIV', 'test');
    expect(await getModulStatus(modul)).toBe('AKTIV');

    await setModulStatus(modul, 'DEAKTIVIERT', 'test');
    expect(await getModulStatus(modul)).toBe('DEAKTIVIERT');
  });

  it('laesst ein Modul im Testmodus laufen', async () => {
    /*
     * Der Kern der Entscheidung, den Testmodus **neben** `enabled` zu legen
     * und nicht hinein. Ein Modul im Testmodus ist eingeschaltet: seine Jobs
     * laufen, `isModuleEnabled` sagt ja, und die hundert Stellen, die das
     * fragen, mussten nicht angefasst werden.
     */
    const modul = pruefModul();
    await setModulStatus(modul, 'TESTMODUS', 'test');

    expect(await isModuleEnabled(modul)).toBe(true);
    expect(await enabledModuleIds()).toContain(modul);
    expect(await testModusModulIds()).toContain(modul);
  });

  it('nimmt beim Deaktivieren den Testmodus mit', async () => {
    /*
     * Sonst landete ein Modul beim naechsten Einschalten unversehens im
     * Testmodus - ein Zustand, den niemand gewaehlt hat, und die Community
     * saehe ein Modul nicht, von dem der Admin denkt, er habe es gerade
     * freigegeben.
     */
    const modul = pruefModul();
    await setModulStatus(modul, 'TESTMODUS', 'test');
    await setModulStatus(modul, 'DEAKTIVIERT', 'test');

    const zeile = await prisma.moduleState.findUnique({ where: { moduleId: modul } });
    expect(zeile?.enabled).toBe(false);
    expect(zeile?.testMode).toBe(false);

    await setModulStatus(modul, 'AKTIV', 'test');
    expect(await getModulStatus(modul)).toBe('AKTIV');
  });

  it('haelt den Testmodus, wenn nur ein- und ausgeschaltet wird', async () => {
    /*
     * Die Gegenrichtung: `setModuleEnabled` gibt es weiterhin, und es soll
     * genau das tun, was es immer tat. Ein Modul im Testmodus, das jemand
     * ueber den alten Weg abschaltet und wieder einschaltet, bleibt im
     * Testmodus - alles andere waere eine stille Freigabe.
     */
    const modul = pruefModul();
    await setModuleTestMode(modul, true, 'test');
    await setModuleEnabled(modul, false, 'test');
    await setModuleEnabled(modul, true, 'test');

    expect(await getModulStatus(modul)).toBe('TESTMODUS');
  });

  it('kennt fuer Kernbereiche keinen Testmodus', async () => {
    const kern = listModuleDefinitions().find((definition) => definition.core);
    expect(kern, 'Kein Kernbereich in der Registry').toBeDefined();
    await expect(setModulStatus(kern!.id, 'TESTMODUS', 'test')).rejects.toThrow();
    expect(await getModulStatus(kern!.id)).toBe('AKTIV');
  });

  it('meldet ein unbekanntes Modul als deaktiviert statt zu werfen', async () => {
    // Fail closed: was es nicht gibt, gibt es auch nicht zu sehen.
    expect(await getModulStatus('gibt-es-nicht')).toBe('DEAKTIVIERT');
  });

  it('fuehrt den Status in der Uebersicht der Modulverwaltung mit', async () => {
    const modul = pruefModul();
    await setModulStatus(modul, 'TESTMODUS', 'test');

    const eintrag = (await listModuleStatus()).find((zeile) => zeile.definition.id === modul);
    expect(eintrag?.status).toBe('TESTMODUS');
    expect(eintrag?.enabled).toBe(true);
    expect(eintrag?.testMode).toBe(true);
  });
});

describeWithDatabase('Die Zugriffsmatrix', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.moduleState.deleteMany();
  });

  /**
   * Die Faelle aus §40, Zeile fuer Zeile.
   *
   * `modulberechtigt` steht fuer «hat die Berechtigung des Moduls» - die
   * prueft die Anwendung vorher und unveraendert. `schluessel` ist
   * `modules.testmode.use`. `erwartet` ist, was am Ende herauskommen muss.
   */
  const FAELLE: {
    was: string;
    status: 'AKTIV' | 'TESTMODUS' | 'DEAKTIVIERT';
    modulberechtigt: boolean;
    schluessel: boolean;
    erwartet: boolean;
  }[] = [
    {
      was: 'Admin am Testmodul',
      status: 'TESTMODUS',
      modulberechtigt: true,
      schluessel: true,
      erwartet: true,
    },
    {
      was: 'Moderator mit Berechtigung am Testmodul',
      status: 'TESTMODUS',
      modulberechtigt: true,
      schluessel: true,
      erwartet: true,
    },
    {
      was: 'Moderator ohne Berechtigung am Testmodul',
      status: 'TESTMODUS',
      modulberechtigt: false,
      schluessel: true,
      erwartet: false,
    },
    {
      was: 'Mitglied am Testmodul - auch mit Modulberechtigung',
      status: 'TESTMODUS',
      modulberechtigt: true,
      schluessel: false,
      erwartet: false,
    },
    {
      was: 'Mitglied am aktiven Modul',
      status: 'AKTIV',
      modulberechtigt: true,
      schluessel: false,
      erwartet: true,
    },
    {
      was: 'Mitglied ohne Berechtigung am aktiven Modul',
      status: 'AKTIV',
      modulberechtigt: false,
      schluessel: false,
      erwartet: false,
    },
  ];

  for (const fall of FAELLE) {
    it(`entscheidet richtig: ${fall.was}`, async () => {
      const modul = pruefModul();
      await setModulStatus(modul, fall.status, 'test');

      /*
       * Beide Bedingungen, in derselben Reihenfolge wie in
       * `requirePagePermission`: zuerst die Berechtigung, dann der Riegel.
       */
      const status = await getModulStatus(modul);
      const zugang = fall.modulberechtigt && darfStatusOeffnen(status, fall.schluessel);

      expect(zugang).toBe(fall.erwartet);
    });
  }

  it('verbirgt Testmodule in der Seitenleiste - aber nur fuer die Community', async () => {
    const modul = pruefModul();
    await setModulStatus(modul, 'TESTMODUS', 'test');

    expect(await verborgeneTestModule(false)).toContain(modul);
    expect(await verborgeneTestModule(true)).toEqual(new Set());
  });

  it('verbirgt ein aktives Modul vor niemandem', async () => {
    const modul = pruefModul();
    await setModulStatus(modul, 'AKTIV', 'test');
    expect(await verborgeneTestModule(false)).toEqual(new Set());
  });
});
