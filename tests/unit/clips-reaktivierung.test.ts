import { describe, expect, it } from 'vitest';
import { reaktivierungsLage } from '@swisshub/modules/clips';
import type { ClipCompetitionStatus } from '@swisshub/database';

/**
 * Wann eine abgebrochene Runde zurueckgeholt werden darf.
 *
 * Die Entscheidung ist eine reine Funktion, und deshalb steht sie hier und
 * nicht in einem Integrationstest: geprueft wird die Regel, nicht die
 * Datenbank. Der Zustandswechsel selbst - atomar, idempotent, mit
 * Protokolleintrag - steht in `tests/integration/clips-reaktivierung.test.ts`.
 *
 * ## Die Woche 2026-W39
 *
 * Montag, 21.09.2026, bis Sonntag, 27.09.2026, Zuercher Zeit. Einreichen bis
 * Freitag 20:00, Voting bis Sonntag 20:00 - so wie die Voreinstellung es
 * vorsieht. Alle Zeitpunkte unten sind UTC; im September gilt Sommerzeit,
 * Zuerich liegt also zwei Stunden vor UTC.
 */
const WOCHE = '2026-W39';

/** Freitag 20:00 und Sonntag 20:00 Zuercher Zeit, in UTC. */
const SUBMISSION_START = new Date('2026-09-20T22:00:00Z'); // Mo 00:00 Zürich
const VOTING_START = new Date('2026-09-25T18:00:00Z'); // Fr 20:00 Zürich
const VOTING_ENDE = new Date('2026-09-27T18:00:00Z'); // So 20:00 Zürich

interface RundenTeile {
  key?: string;
  status?: ClipCompetitionStatus;
  cancelledAt?: Date | null;
  finalizedAt?: Date | null;
  winnerEntryId?: string | null;
  submissionStartsAt?: Date;
  votingStartsAt?: Date;
  votingEndsAt?: Date;
}

function runde(teile: RundenTeile = {}): Parameters<typeof reaktivierungsLage>[0] {
  return {
    key: WOCHE,
    status: 'CANCELLED',
    cancelledAt: new Date('2026-09-23T10:00:00Z'),
    finalizedAt: null,
    winnerEntryId: null,
    submissionStartsAt: SUBMISSION_START,
    votingStartsAt: VOTING_START,
    votingEndsAt: VOTING_ENDE,
    ...teile,
  };
}

describe('Nur ausdrücklich abgebrochene Runden', () => {
  it('lässt eine abgebrochene Runde zurück', () => {
    const lage = reaktivierungsLage(runde(), new Date('2026-09-23T12:00:00Z'));
    expect(lage.moeglich).toBe(true);
  });

  it.each<[string, RundenTeile]>([
    ['DRAFT', { status: 'DRAFT', cancelledAt: null }],
    ['SUBMISSION', { status: 'SUBMISSION', cancelledAt: null }],
    ['VOTING', { status: 'VOTING', cancelledAt: null }],
    ['FINALIZING', { status: 'FINALIZING', cancelledAt: null }],
  ])('rührt eine laufende Runde (%s) nicht an', (_name, teile) => {
    const lage = reaktivierungsLage(runde(teile), new Date('2026-09-23T12:00:00Z'));
    expect(lage).toEqual({ moeglich: false, hindernis: 'NICHT_ABGEBROCHEN' });
  });

  it('öffnet eine normal beendete Runde unter keinen Umständen', () => {
    /*
     * Der wichtigste Fall. Eine abgeschlossene Runde hat einen Gewinner, und
     * der ist auf Discord angekuendigt. Sie wieder zu oeffnen hiesse, ein
     * Ergebnis zurueckzunehmen, das oeffentlich feststeht.
     */
    const lage = reaktivierungsLage(
      runde({
        status: 'COMPLETED',
        cancelledAt: null,
        finalizedAt: new Date('2026-09-27T18:00:00Z'),
        winnerEntryId: 'eintrag-1',
      }),
      new Date('2026-09-27T18:30:00Z'),
    );
    expect(lage).toEqual({ moeglich: false, hindernis: 'NICHT_ABGEBROCHEN' });
  });

  it('verlangt den Abbruchvermerk und nicht nur das Statuslabel', () => {
    // Ein `CANCELLED` ohne `cancelledAt` ist kein Abbruch, den jemand
    // veranlasst hat - es ist eine Zeile, die so nicht entstehen sollte.
    const lage = reaktivierungsLage(runde({ cancelledAt: null }), new Date('2026-09-23T12:00:00Z'));
    expect(lage).toEqual({ moeglich: false, hindernis: 'NICHT_ABGEBROCHEN' });
  });

  it('lässt eine abgebrochene Runde mit Gewinner oder Abschluss nicht durch', () => {
    // Beide Felder wären in Kombination mit CANCELLED ein Widerspruch. Kommt
    // er trotzdem vor, entscheidet die vorsichtigere Lesart.
    for (const teile of [{ finalizedAt: new Date() }, { winnerEntryId: 'eintrag-1' }]) {
      const lage = reaktivierungsLage(runde(teile), new Date('2026-09-23T12:00:00Z'));
      expect(lage.moeglich).toBe(false);
    }
  });
});

describe('Nur innerhalb der ursprünglichen Woche', () => {
  it.each([
    ['Montag früh', '2026-09-21T04:00:00Z'],
    ['Mitte der Woche', '2026-09-23T12:00:00Z'],
    ['Sonntag kurz vor Schluss', '2026-09-27T17:59:00Z'],
  ])('erlaubt es am %s', (_name, zeitpunkt) => {
    expect(reaktivierungsLage(runde(), new Date(zeitpunkt)).moeglich).toBe(true);
  });

  it.each([
    // Sonntag 23:00 Zürich ist noch W39 - aber alle Fristen sind vorbei.
    ['Montag der Folgewoche', '2026-09-28T06:00:00Z', 'ANDERE_WOCHE'],
    ['Woche davor', '2026-09-16T12:00:00Z', 'ANDERE_WOCHE'],
    ['ein Jahr später', '2027-09-22T12:00:00Z', 'ANDERE_WOCHE'],
  ])('verweigert es am %s', (_name, zeitpunkt, hindernis) => {
    expect(reaktivierungsLage(runde(), new Date(zeitpunkt)).hindernis).toBe(hindernis);
  });

  it('unterscheidet die Woche 39 zweier Jahre', () => {
    /*
     * Der Schluessel traegt das ISO-Jahr, und genau deshalb. Ohne Jahr waere
     * eine Runde aus dem Vorjahr jedes Jahr in derselben Woche wieder
     * aktivierbar - mit Fristen, die laengst verstrichen sind.
     */
    const alt = runde({ key: '2025-W39' });
    expect(reaktivierungsLage(alt, new Date('2026-09-23T12:00:00Z')).hindernis).toBe('ANDERE_WOCHE');
  });

  it('rechnet den Jahreswechsel nach ISO', () => {
    /*
     * Der 31.12.2025 ist ein Mittwoch; sein Donnerstag liegt 2026, die Woche
     * heisst also `2026-W01`. Eine Runde mit diesem Schluessel ist an diesem
     * Tag in ihrer eigenen Woche - obwohl das Kalenderjahr noch 2025 ist.
     */
    const silvester = runde({
      key: '2026-W01',
      submissionStartsAt: new Date('2025-12-28T23:00:00Z'), // Mo 29.12. 00:00 Zürich
      votingStartsAt: new Date('2026-01-02T19:00:00Z'), // Fr 02.01. 20:00 Zürich
      votingEndsAt: new Date('2026-01-04T19:00:00Z'), // So 04.01. 20:00 Zürich
    });
    const lage = reaktivierungsLage(silvester, new Date('2025-12-31T12:00:00Z'));
    expect(lage.moeglich).toBe(true);
    expect(lage.ziel).toBe('SUBMISSION');
  });

  it('bleibt über die Winterzeit hinweg bei der Zürcher Wanduhr', () => {
    /*
     * Die Woche 2026-W44 enthaelt die Umstellung auf Winterzeit in der Nacht
     * vom 24. auf den 25. Oktober. Danach liegt Zuerich eine Stunde vor UTC
     * statt zwei - «Freitag 20:00» ist dann 19:00 UTC. Die Grenzen unten
     * sind entsprechend gesetzt, und die Woche muss trotzdem stimmen.
     */
    const umstellung = runde({
      key: '2026-W44',
      submissionStartsAt: new Date('2026-10-25T23:00:00Z'), // Mo 26.10. 00:00 Zürich (MEZ)
      votingStartsAt: new Date('2026-10-30T19:00:00Z'), // Fr 30.10. 20:00 Zürich
      votingEndsAt: new Date('2026-11-01T19:00:00Z'), // So 01.11. 20:00 Zürich
    });
    expect(reaktivierungsLage(umstellung, new Date('2026-10-28T12:00:00Z')).moeglich).toBe(true);
    // Sonntag 01.11. um 20:30 Zürich: noch W44, aber alle Fristen vorbei.
    expect(reaktivierungsLage(umstellung, new Date('2026-11-01T19:30:00Z')).hindernis).toBe(
      'FRISTEN_ABGELAUFEN',
    );
  });
});

describe('Das Ziel ergibt sich aus dem ursprünglichen Zeitplan', () => {
  it('kehrt vor dem Start in die Vorbereitung zurück', () => {
    // Sonntagabend der Vorwoche wäre eine andere Woche; geprüft wird deshalb
    // eine Runde, deren Einreichungen erst am Dienstag öffnen.
    const spaeter = runde({});
    const lage = reaktivierungsLage(
      { ...spaeter, submissionStartsAt: new Date('2026-09-24T10:00:00Z') },
      new Date('2026-09-23T12:00:00Z'),
    );
    expect(lage.ziel).toBe('DRAFT');
    expect(lage.phaseEndetAm).toEqual(new Date('2026-09-24T10:00:00Z'));
  });

  it('kehrt während der Einreichungsfrist in die Einreichungsphase zurück', () => {
    const lage = reaktivierungsLage(runde(), new Date('2026-09-23T12:00:00Z'));
    expect(lage.ziel).toBe('SUBMISSION');
    expect(lage.phaseEndetAm).toEqual(VOTING_START);
  });

  it('kehrt während des Votings in die Votingphase zurück', () => {
    const lage = reaktivierungsLage(runde(), new Date('2026-09-26T12:00:00Z'));
    expect(lage.ziel).toBe('VOTING');
    expect(lage.phaseEndetAm).toEqual(VOTING_ENDE);
  });

  it('verschiebt keine Frist', () => {
    /*
     * Der Kern der Zusage: eine am Samstag zurueckgeholte Runde endet am
     * Sonntag um 20:00 - so wie sie es ohne den Abbruch getan haette. Die
     * verbleibende Zeit wird kuerzer, nicht die Woche laenger.
     */
    const frueh = reaktivierungsLage(runde(), new Date('2026-09-25T19:00:00Z'));
    const spaet = reaktivierungsLage(runde(), new Date('2026-09-27T17:00:00Z'));
    expect(frueh.phaseEndetAm).toEqual(VOTING_ENDE);
    expect(spaet.phaseEndetAm).toEqual(VOTING_ENDE);
  });

  it('startet keine Phase, für die es keine Frist mehr gibt', () => {
    /*
     * Sonntag 20:30 Zuercher Zeit: noch dieselbe Woche, aber das Voting ist
     * vorbei. Die Runde jetzt als Einreichungsphase zu oeffnen hiesse, eine
     * Frist zu erfinden; sie ins Voting zu schieben, hiesse einen Gewinner
     * aus einem abgesagten Wettbewerb zu kueren.
     */
    const lage = reaktivierungsLage(runde(), new Date('2026-09-27T18:30:00Z'));
    expect(lage).toEqual({ moeglich: false, hindernis: 'FRISTEN_ABGELAUFEN' });
  });

  it('gilt exakt bis zur Sekunde des Fristendes', () => {
    expect(reaktivierungsLage(runde(), new Date(VOTING_ENDE.getTime() - 1)).ziel).toBe('VOTING');
    expect(reaktivierungsLage(runde(), VOTING_ENDE).hindernis).toBe('FRISTEN_ABGELAUFEN');
    expect(reaktivierungsLage(runde(), new Date(VOTING_START.getTime() - 1)).ziel).toBe('SUBMISSION');
    expect(reaktivierungsLage(runde(), VOTING_START).ziel).toBe('VOTING');
  });
});
