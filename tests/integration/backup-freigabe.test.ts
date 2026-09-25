import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_backup_freigabe');

/**
 * Das Vier-Augen-Prinzip fuer produktive Wiederherstellungen.
 *
 * ==========================================================================
 * WARUM DIESE SCHICHT UEBERHAUPT EXISTIERT
 * ==========================================================================
 *
 * Die bestehende Permission Engine kann sehr fein vergeben -
 * `backup.restore_request` und `backup.restore_approve` sind zwei getrennte
 * Berechtigungen, und wer nur die erste hat, kann nicht freigeben.
 *
 * Was sie nicht kann: verlangen, dass ZWEI VERSCHIEDENE Personen zustimmen.
 * `can(context, permission)` ist eine Aussage ueber genau einen Handelnden -
 * ein Konto mit beiden Berechtigungen koennte beide Schritte allein gehen.
 *
 * Fuer die eine Operation, bei der ein einzelner Irrtum nicht ausreichen soll,
 * ist das zu wenig: ein produktiver Restore verwirft alles, was nach dem
 * Zielzeitpunkt geschehen ist. Jede Nachricht, jede Moderationsmassnahme,
 * jeden Ticketverlauf.
 *
 * Die Tests unten pruefen genau das, was die Engine nicht prueft.
 * ==========================================================================
 */
const { prisma } = await import('@swisshub/database');
const {
  RESTORE_UMFANG,
  fordereRestoreAn,
  gebeRestoreFrei,
  lehneRestoreAb,
  listeFreigaben,
  findeGueltigeFreigabe,
  GUELTIGKEIT_STUNDEN,
} = await import('../../packages/modules/src/backup/freigabe');

/**
 * Prueft die Meldung, die der Administrator SIEHT.
 *
 * `Error.message` ist bei `AppError` die interne Meldung - sie steht im
 * Protokoll und darf sich aendern, ohne dass sich fuer jemanden etwas aendert.
 * `userMessage` ist die Zusage an den Benutzer; sie festzuhalten ist der
 * sinnvollere Test.
 */
async function scheitertMit(versprechen: Promise<unknown>, muster: RegExp): Promise<void> {
  try {
    await versprechen;
  } catch (fehler) {
    const appError = fehler as { userMessage?: string; message?: string };
    const meldung = appError.userMessage ?? appError.message ?? '';
    expect(meldung, `Die Meldung war: ${meldung}`).toMatch(muster);
    return;
  }
  throw new Error('Der Aufruf haette scheitern muessen.');
}

const ANNA = '100000000000000001';
const BERNO = '100000000000000002';

const BEGRUENDUNG =
  'Die Migration von heute Morgen hat die Ticketverlaeufe geleert. Zurueck auf den Stand davor.';

describeWithDatabase('Vier-Augen-Prinzip beim produktiven Restore', () => {
  beforeAll(async () => {
    await pushSchema();
  });

  beforeEach(async () => {
    await prisma.restoreFreigabe.deleteMany({});
  });

  it('eine Anforderung loest nichts aus - sie wartet auf eine zweite Person', async () => {
    const zeile = await fordereRestoreAn({
      umfang: RESTORE_UMFANG.vollstaendig,
      zielZeitpunkt: new Date('2026-09-25T12:00:00Z'),
      begruendung: BEGRUENDUNG,
      angefordertVon: ANNA,
      angefordertVonName: 'anna',
    });

    expect(zeile.status).toBe('ANGEFORDERT');
    expect(zeile.freigegebenVon).toBeNull();
    // Und sie ist noch nicht einloesbar.
    expect(zeile.jetztGueltig).toBe(false);
    expect(await findeGueltigeFreigabe()).toBeNull();
  });

  it('verlangt eine Begruendung von mindestens 20 Zeichen', async () => {
    // Sie ist das, was in einem halben Jahr die Frage beantwortet, weshalb an
    // diesem Tag Daten verworfen wurden. Ein leeres Feld beantwortet sie nicht.
    await expect(
      fordereRestoreAn({
        umfang: RESTORE_UMFANG.datenbank,
        zielZeitpunkt: null,
        begruendung: 'kaputt',
        angefordertVon: ANNA,
        angefordertVonName: 'anna',
      }),
    ).rejects.toThrow();
  });

  it('LEHNT eine Selbstfreigabe AB', async () => {
    /*
     * Der Kern der ganzen Schicht.
     *
     * Anna fordert an und versucht, selbst freizugeben. Das muss scheitern -
     * sonst ist das Vier-Augen-Prinzip eine Beschriftung und keine Sperre.
     */
    const zeile = await fordereRestoreAn({
      umfang: RESTORE_UMFANG.vollstaendig,
      zielZeitpunkt: null,
      begruendung: BEGRUENDUNG,
      angefordertVon: ANNA,
      angefordertVonName: 'anna',
    });

    await scheitertMit(gebeRestoreFrei(zeile.id, ANNA, 'anna'), /nicht selbst freigeben/u);

    // Und der Zustand bleibt unveraendert - kein halber Uebergang.
    const danach = await prisma.restoreFreigabe.findUnique({ where: { id: zeile.id } });
    expect(danach?.status).toBe('ANGEFORDERT');
    expect(danach?.freigegebenVon).toBeNull();
  });

  it('nimmt die Freigabe einer anderen Person an', async () => {
    const zeile = await fordereRestoreAn({
      umfang: RESTORE_UMFANG.vollstaendig,
      zielZeitpunkt: new Date('2026-09-25T12:00:00Z'),
      begruendung: BEGRUENDUNG,
      angefordertVon: ANNA,
      angefordertVonName: 'anna',
    });

    const frei = await gebeRestoreFrei(zeile.id, BERNO, 'berno');
    expect(frei.status).toBe('FREIGEGEBEN');
    expect(frei.freigegebenVon).toBe(BERNO);
    expect(frei.jetztGueltig).toBe(true);

    // Erst jetzt gibt es eine einloesbare Freigabe - genau das fragt
    // `swisshub-recovery` ab, bevor es die Produktion anfasst.
    const gefunden = await findeGueltigeFreigabe();
    expect(gefunden?.id).toBe(zeile.id);
  });

  it('gibt eine Freigabe nicht zweimal', async () => {
    const zeile = await fordereRestoreAn({
      umfang: RESTORE_UMFANG.datenbank,
      zielZeitpunkt: null,
      begruendung: BEGRUENDUNG,
      angefordertVon: ANNA,
      angefordertVonName: 'anna',
    });
    await gebeRestoreFrei(zeile.id, BERNO, 'berno');
    await scheitertMit(gebeRestoreFrei(zeile.id, BERNO, 'berno'), /nicht mehr offen/u);
  });

  it('gilt nur befristet', async () => {
    /*
     * Eine Freigabe ohne Frist ist eine dauerhafte Befugnis.
     *
     * Vier Stunden sind genug fuer eine Wiederherstellung samt Vorbereitung und
     * zu kurz, um in einem halben Jahr noch zu wirken.
     */
    const zeile = await fordereRestoreAn({
      umfang: RESTORE_UMFANG.dateien,
      zielZeitpunkt: null,
      begruendung: BEGRUENDUNG,
      angefordertVon: ANNA,
      angefordertVonName: 'anna',
    });
    const spanne = zeile.gueltigBis.getTime() - zeile.angefordertAm.getTime();
    expect(Math.round(spanne / 3_600_000)).toBe(GUELTIGKEIT_STUNDEN);
  });

  it('laesst eine abgelaufene Anforderung nicht freigeben', async () => {
    const zeile = await fordereRestoreAn({
      umfang: RESTORE_UMFANG.datenbank,
      zielZeitpunkt: null,
      begruendung: BEGRUENDUNG,
      angefordertVon: ANNA,
      angefordertVonName: 'anna',
    });
    // Die Frist in die Vergangenheit legen.
    await prisma.restoreFreigabe.update({
      where: { id: zeile.id },
      data: { gueltigBis: new Date(Date.now() - 1000) },
    });

    await scheitertMit(gebeRestoreFrei(zeile.id, BERNO, 'berno'), /abgelaufen/u);
    const danach = await prisma.restoreFreigabe.findUnique({ where: { id: zeile.id } });
    expect(danach?.status).toBe('ABGELAUFEN');
  });

  it('findet eine abgelaufene Freigabe nicht mehr als gueltig', async () => {
    const zeile = await fordereRestoreAn({
      umfang: RESTORE_UMFANG.vollstaendig,
      zielZeitpunkt: null,
      begruendung: BEGRUENDUNG,
      angefordertVon: ANNA,
      angefordertVonName: 'anna',
    });
    await gebeRestoreFrei(zeile.id, BERNO, 'berno');
    await prisma.restoreFreigabe.update({
      where: { id: zeile.id },
      data: { gueltigBis: new Date(Date.now() - 1000) },
    });
    expect(await findeGueltigeFreigabe()).toBeNull();
  });

  it('traegt abgelaufene Anforderungen beim Lesen nach', async () => {
    // Ein Zeitpunkt in der Vergangenheit macht eine Freigabe ungueltig, und der
    // Status soll das sagen - statt dass die Oberflaeche es jedes Mal selbst
    // ausrechnet und eine Stelle es vergisst.
    const zeile = await fordereRestoreAn({
      umfang: RESTORE_UMFANG.datenbank,
      zielZeitpunkt: null,
      begruendung: BEGRUENDUNG,
      angefordertVon: ANNA,
      angefordertVonName: 'anna',
    });
    await prisma.restoreFreigabe.update({
      where: { id: zeile.id },
      data: { gueltigBis: new Date(Date.now() - 1000) },
    });

    const liste = await listeFreigaben();
    expect(liste.find((eintrag) => eintrag.id === zeile.id)?.status).toBe('ABGELAUFEN');
  });

  it('laesst keine zweite offene Anforderung derselben Person zu', async () => {
    // Die zweite waere ein Weg, die erste in der Liste untergehen zu lassen.
    await fordereRestoreAn({
      umfang: RESTORE_UMFANG.datenbank,
      zielZeitpunkt: null,
      begruendung: BEGRUENDUNG,
      angefordertVon: ANNA,
      angefordertVonName: 'anna',
    });
    await scheitertMit(
      fordereRestoreAn({
        umfang: RESTORE_UMFANG.dateien,
        zielZeitpunkt: null,
        begruendung: BEGRUENDUNG,
        angefordertVon: ANNA,
        angefordertVonName: 'anna',
      }),
      /bereits eine offene/u,
    );
  });

  it('erlaubt eine neue Anforderung, nachdem die alte zurueckgezogen wurde', async () => {
    const erste = await fordereRestoreAn({
      umfang: RESTORE_UMFANG.datenbank,
      zielZeitpunkt: null,
      begruendung: BEGRUENDUNG,
      angefordertVon: ANNA,
      angefordertVonName: 'anna',
    });
    await lehneRestoreAb(erste.id, ANNA, 'War doch nicht noetig.');

    const zweite = await fordereRestoreAn({
      umfang: RESTORE_UMFANG.dateien,
      zielZeitpunkt: null,
      begruendung: BEGRUENDUNG,
      angefordertVon: ANNA,
      angefordertVonName: 'anna',
    });
    expect(zweite.status).toBe('ANGEFORDERT');
  });

  it('haelt die Anforderungen zweier Personen auseinander', async () => {
    const annas = await fordereRestoreAn({
      umfang: RESTORE_UMFANG.datenbank,
      zielZeitpunkt: null,
      begruendung: BEGRUENDUNG,
      angefordertVon: ANNA,
      angefordertVonName: 'anna',
    });
    const bernos = await fordereRestoreAn({
      umfang: RESTORE_UMFANG.dateien,
      zielZeitpunkt: null,
      begruendung: BEGRUENDUNG,
      angefordertVon: BERNO,
      angefordertVonName: 'berno',
    });

    // Anna darf Bernos freigeben und Berno Annas - aber keiner die eigene.
    await expect(gebeRestoreFrei(annas.id, ANNA, 'anna')).rejects.toThrow();
    await expect(gebeRestoreFrei(bernos.id, BERNO, 'berno')).rejects.toThrow();

    const freiA = await gebeRestoreFrei(annas.id, BERNO, 'berno');
    const freiB = await gebeRestoreFrei(bernos.id, ANNA, 'anna');
    expect(freiA.status).toBe('FREIGEGEBEN');
    expect(freiB.status).toBe('FREIGEGEBEN');
  });

  it('haelt eine verwendete Freigabe fest', async () => {
    // Einmalig, weil eine wiederverwendbare Freigabe genau die ist, die man
    // beim zweiten Mal nicht mehr bemerkt.
    const zeile = await fordereRestoreAn({
      umfang: RESTORE_UMFANG.vollstaendig,
      zielZeitpunkt: null,
      begruendung: BEGRUENDUNG,
      angefordertVon: ANNA,
      angefordertVonName: 'anna',
    });
    await gebeRestoreFrei(zeile.id, BERNO, 'berno');
    await prisma.restoreFreigabe.update({
      where: { id: zeile.id },
      data: { status: 'VERWENDET', verwendetAm: new Date(), verwendetVon: BERNO },
    });

    expect(await findeGueltigeFreigabe()).toBeNull();
    await scheitertMit(lehneRestoreAb(zeile.id, ANNA, ''), /bereits verwendet/u);
  });

  it('behaelt den Zielzeitpunkt genau', async () => {
    // Er entscheidet, welche Daten verworfen werden. Eine Rundung hier waere
    // eine Stunde fremder Arbeit.
    const genau = new Date('2026-09-25T14:31:07.000Z');
    const zeile = await fordereRestoreAn({
      umfang: RESTORE_UMFANG.vollstaendig,
      zielZeitpunkt: genau,
      begruendung: BEGRUENDUNG,
      angefordertVon: ANNA,
      angefordertVonName: 'anna',
    });
    expect(zeile.zielZeitpunkt?.toISOString()).toBe(genau.toISOString());
  });

  it('nimmt «jungstmoeglicher Stand» als null an', async () => {
    const zeile = await fordereRestoreAn({
      umfang: RESTORE_UMFANG.vollstaendig,
      zielZeitpunkt: null,
      begruendung: BEGRUENDUNG,
      angefordertVon: ANNA,
      angefordertVonName: 'anna',
    });
    expect(zeile.zielZeitpunkt).toBeNull();
  });
});
