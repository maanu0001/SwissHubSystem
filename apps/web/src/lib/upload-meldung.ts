/**
 * Was man sagen kann, wenn ein Upload gar nicht erst angekommen ist.
 *
 * ## Der Fehler, den das behebt
 *
 * Eine PNG von 3,1 MB wurde abgelehnt, und die Oberflaeche sagte: «Die Datei
 * ist zu gross. Maximal erlaubt: 24 MB.» Beides stand da gleichzeitig, und
 * beides war aus Sicht der lesenden Person Unsinn - 3 ist kleiner als 24.
 *
 * Zustande kam das so: ein Reverse Proxy lehnt einen zu grossen Koerper mit
 * einem rohen `413` ab, bevor die Anwendung ihn ueberhaupt sieht. Die
 * Oberflaeche erkannte den Status richtig, setzte dann aber die Grenze ein,
 * die **sie** kennt. Die Schicht, die tatsaechlich abgelehnt hat, hat eine
 * andere - und die Anwendung kann sie nicht wissen: im `413` steht sie nicht,
 * und wer sie gesetzt hat, hat es in einer Konfigurationsdatei getan, die
 * dieser Code nie liest.
 *
 * Das kostete zwei Runden Fehlersuche an der falschen Stelle: bei den
 * Dateien, waehrend das Problem einen Sprung davor lag.
 *
 * ## Was hier stattdessen gesagt wird
 *
 * Erstens, wo es geklemmt hat: **vor** SwissHub. Das ist die Auskunft, die
 * zur naechsten Handlung fuehrt. Zweitens die eigene Grenze, aber als
 * Einordnung und nicht als Urteil ueber die Datei - liegt sie darunter, ist
 * bewiesen, dass die Ursache davor liegt.
 *
 * Eine Zahl, die man nicht kennt, nennt man nicht.
 */
export function meldungFuerFremdeAntwort(status: number, eigeneGrenzeMb?: number): string {
  if (status !== 413) {
    return `Der Server hat unerwartet geantwortet (${status}).`;
  }

  const einordnung =
    eigeneGrenzeMb === undefined
      ? ''
      : ` In SwissHub waeren ${eigeneGrenzeMb} MB erlaubt - die Grenze davor ist kleiner.`;

  return `Der Upload wurde abgewiesen, bevor SwissHub ihn gesehen hat.${einordnung} Das ist eine Einstellung des Servers davor und muss dort erhoeht werden.`;
}
