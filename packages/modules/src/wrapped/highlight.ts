import { formatSwissNumber } from '@swisshub/shared';
import type { WrappedDaten, WrappedHighlight } from './daten';

/**
 * Der eine Fakt, der es verdient, allein auf einem Bildschirm zu stehen.
 *
 * ## Warum ausgewaehlt und nicht aufgezaehlt
 *
 * Alles, was hier zur Wahl steht, koennte man auch nebeneinander zeigen -
 * und dann waere es eine Tabelle. Die Szene lebt davon, dass genau **eine**
 * Zahl kommt, und zwar die, die bei dieser Person ueberrascht. Bei dem
 * einen ist das eine Sprachsitzung von elf Stunden, bei der anderen eine
 * Serie von 94 Tagen.
 *
 * ## Wie ausgewaehlt wird
 *
 * Jeder Kandidat nennt eine Punktzahl. Sie sagt nicht «wie gross ist die
 * Zahl», sondern «wie bemerkenswert ist sie» - eine Serie von 12 Tagen ist
 * nichts, eine von 200 ist die Geschichte des Jahres. Ohne Kandidaten ueber
 * der Schwelle entfaellt die Szene; ein erzwungenes Highlight waere eine
 * Feier von Belanglosigkeiten.
 */

type Teildaten = Omit<WrappedDaten, 'highlight' | 'archetyp'>;

interface Kandidat {
  key: string;
  punkte: number;
  bauen(): WrappedHighlight;
}

const stunden = (sekunden: number): string => {
  const ganze = Math.floor(sekunden / 3600);
  const minuten = Math.round((sekunden % 3600) / 60);
  return ganze > 0 ? `${ganze}h ${String(minuten).padStart(2, '0')}m` : `${minuten} min`;
};

const MONATE = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
];

const datum = (schluessel: string): string => {
  const [jahr, monat, tag] = schluessel.split('-');
  return `${Number(tag)}. ${MONATE[Number(monat) - 1] ?? ''} ${jahr}`;
};

export function waehleHighlight(daten: Teildaten): WrappedHighlight | null {
  const kandidaten: Kandidat[] = [];

  /*
   * Die laengste Sprachsitzung.
   *
   * Ab vier Stunden wird es erzaehlenswert; ab zehn ist es eine kleine
   * Legende. Gemessen an der Sitzung, nicht am Abschnitt - wer zwischendurch
   * den Kanal wechselt, hat trotzdem durchgehend dagesessen.
   */
  if (daten.voice.longestSessionSeconds >= 4 * 3600) {
    kandidaten.push({
      key: 'longest_session',
      punkte: Math.min(1, daten.voice.longestSessionSeconds / (10 * 3600)),
      bauen: () => ({
        key: 'longest_session',
        value: stunden(daten.voice.longestSessionSeconds),
        label: 'am Stück im Voice',
        detail: daten.voice.longestSessionAt
          ? `Deine längste Session – ${datum(daten.voice.longestSessionAt.slice(0, 10))}.`
          : 'Deine längste Session.',
      }),
    });
  }

  if (daten.aktivitaet.longestStreak >= 14) {
    kandidaten.push({
      key: 'streak',
      punkte: Math.min(1, daten.aktivitaet.longestStreak / 120),
      bauen: () => ({
        key: 'streak',
        value: String(daten.aktivitaet.longestStreak),
        label: 'Tage am Stück',
        detail: 'Deine längste Serie ohne einen einzigen Tag Pause.',
      }),
    });
  }

  if (daten.messages.bestDay && daten.messages.bestDay.messages >= 50) {
    kandidaten.push({
      key: 'best_message_day',
      punkte: Math.min(1, daten.messages.bestDay.messages / 400),
      bauen: () => ({
        key: 'best_message_day',
        value: formatSwissNumber(daten.messages.bestDay?.messages ?? 0),
        label: 'Nachrichten an einem Tag',
        detail: daten.messages.bestDay ? `Am ${datum(daten.messages.bestDay.day)} war einiges los.` : null,
      }),
    });
  }

  if (daten.level?.bestDay && daten.level.bestDay.xp >= 500) {
    kandidaten.push({
      key: 'best_xp_day',
      punkte: Math.min(1, daten.level.bestDay.xp / 5000),
      bauen: () => ({
        key: 'best_xp_day',
        value: `+${formatSwissNumber(daten.level?.bestDay?.xp ?? 0)}`,
        label: 'XP an einem Tag',
        detail: daten.level?.bestDay ? `Dein stärkster Tag: ${datum(daten.level.bestDay.day)}.` : null,
      }),
    });
  }

  /*
   * Ein Turniersieg schlaegt fast alles.
   *
   * Feste, hohe Punktzahl statt einer Rechnung: einen Sieg gibt es oder
   * nicht, und wenn es ihn gibt, ist er das Highlight des Jahres.
   */
  if (daten.wettkampf.tournamentWins > 0) {
    kandidaten.push({
      key: 'tournament_win',
      punkte: 0.95,
      bauen: () => ({
        key: 'tournament_win',
        value: daten.wettkampf.tournamentWins === 1 ? '1×' : `${daten.wettkampf.tournamentWins}×`,
        label: daten.wettkampf.tournamentWins === 1 ? 'Turnier gewonnen' : 'Turniere gewonnen',
        detail: daten.wettkampf.tournamentTitles[0] ?? null,
      }),
    });
  }

  if (daten.clips.wins > 0) {
    kandidaten.push({
      key: 'clip_win',
      punkte: 0.9,
      bauen: () => ({
        key: 'clip_win',
        value: `${daten.clips.wins}×`,
        label: 'Clip of the Week',
        detail: daten.clips.best ? daten.clips.best.title : null,
      }),
    });
  }

  if (daten.voice.mates.length > 0 && (daten.voice.mates[0]?.sharedSecondsRounded ?? 0) >= 10 * 3600) {
    const mate = daten.voice.mates[0]!;
    kandidaten.push({
      key: 'top_mate',
      punkte: Math.min(0.85, mate.sharedSecondsRounded / (200 * 3600)),
      bauen: () => ({
        key: 'top_mate',
        value: `${Math.round(mate.sharedSecondsRounded / 3600)}h`,
        label: 'zusammen im Voice',
        detail: `Mit ${mate.displayName ?? mate.username ?? 'jemandem'} – niemand sonst kam da ran.`,
      }),
    });
  }

  if (kandidaten.length === 0) {
    return null;
  }

  // Bei Gleichstand gewinnt der zuerst genannte Kandidat - die Reihenfolge
  // oben ist damit Teil der Regel und nicht dem Zufall ueberlassen.
  const beste = kandidaten.reduce((sieger, kandidat) =>
    kandidat.punkte > sieger.punkte ? kandidat : sieger,
  );
  return beste.bauen();
}
