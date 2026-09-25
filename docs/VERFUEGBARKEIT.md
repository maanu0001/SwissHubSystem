# Ausfallsicherheit — Analyse, kein Versprechen

Was passiert, wenn etwas ausfällt, was das heute bedeutet, und was
Hochverfügbarkeit kosten würde.

Dieses Dokument behauptet **keine** Ausfallsicherheit. Es beschreibt den
heutigen Stand und die Stufen, die möglich wären — jede mit ihrem Preis und
ihrem Risiko. Der wichtigste Satz steht am Anfang:

> **SwissHub ist heute nicht hochverfügbar.** Ein Ausfall des Servers bedeutet
> Ausfallzeit, bis er wiederhergestellt ist. Die Backup-Anlage begrenzt den
> Datenverlust, nicht die Ausfallzeit.

---

## 1. Heutiger Stand

Ein Server. Darauf PostgreSQL, die WebApp, der Discord-Bot, die Musik-Laufzeit,
nginx — und nach [BESTANDSAUFNAHME.md](BESTANDSAUFNAHME.md) weitere
SwissHub-Dienste mit eigenen Datenbanken.

Jede einzelne dieser Komponenten ist ein Single Point of Failure, und der
Server selbst ist der grösste.

| Ausfall                       | Wirkung heute                                      | Wiederherstellung                                                                |
| ----------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------- |
| Bot-Prozess stürzt ab         | Discord-Funktionen aus, WebApp läuft               | `systemd` startet neu, Sekunden                                                  |
| WebApp stürzt ab              | Dashboard aus, Bot läuft                           | `systemd` startet neu, Sekunden                                                  |
| PostgreSQL stürzt ab          | alles aus                                          | `systemd` startet neu, Sekunden — **wenn** die Dateien intakt sind               |
| PostgreSQL-Dateien beschädigt | alles aus                                          | Restore, [DISASTER-RECOVERY.md §4](DISASTER-RECOVERY.md#4-datenbankschaden)      |
| Platte voll                   | Schreibvorgänge scheitern, WAL-Archivierung stockt | Platz schaffen; Monitoring warnt vorher                                          |
| Server weg                    | alles aus                                          | Neuaufsetzen plus Restore, [§3](DISASTER-RECOVERY.md#3-totalverlust-des-servers) |
| Rechenzentrum weg             | alles aus                                          | wie oben, an anderem Ort — braucht die auswärtige Kopie                          |

Der Neustart durch `systemd` ist die einzige Ausfallsicherheit, die heute
wirklich existiert. Sie deckt den häufigsten Fall (ein abgestürzter Prozess) und
keinen der teuren.

---

## 2. Was die Backup-Anlage daran ändert — und was nicht

**Sie ändert:** den Datenverlust. Vorher war der schlechteste Fall ein ganzer
Tag (der letzte nächtliche Dump), und ein Serververlust hätte auch diesen Dump
mitgenommen. Jetzt sind es fünf Minuten, und die Kopie liegt auswärts, sobald
ein Objektspeicher eingerichtet ist.

**Sie ändert nicht:** die Ausfallzeit. Ein Restore dauert, so schnell er auch
ist. Gemessen wurden auf einer Wegwerf-Installation 177 Sekunden für Datenbank
und Dateien — aber das Aufsetzen eines neuen Servers ist darin nicht enthalten,
und das ist der längere Teil.

Ein Backup ist keine Verfügbarkeit. Es ist die Garantie, dass es etwas gibt,
worauf man zurückkehren kann.

---

## 3. Die Stufen

### Stufe 0 — heute

Ein Server, `systemd` startet abgestürzte Dienste neu, Backups mit
Wiederherstellungspunkten.

- **Ausfallzeit bei Serververlust:** Stunden. Aufsetzen plus Restore.
- **Kosten:** keine zusätzlichen.
- **Risiko:** keines. Es ist der Stand.

### Stufe 1 — Überwachung, die vor dem Ausfall warnt

Nicht Verfügbarkeit, aber der billigste Gewinn. Ein Grossteil der Ausfälle
kündigt sich an: die Platte läuft voll, die WAL-Archivierung stockt, der
Heartbeat wird langsam.

- **Nötig:** eine externe Überwachung (`/api/health` ist vorhanden), die
  Heartbeat-URL aus [DISASTER-RECOVERY.md §10](DISASTER-RECOVERY.md#10-was-der-betreiber-bereitstellen-muss).
- **Kosten:** gering bis keine.
- **Gewinn:** Ausfälle, die nicht stattfinden.
- **Empfehlung: ja, als erstes.** Die Alarmierung dafür ist eingerichtet; es
  fehlen die externen Ziele.

### Stufe 2 — ein warmes Ersatzsystem

Ein zweiter Server, der die Sicherungen bereits liegen hat. Kein
Datenbank-Replikat: nur ein vorbereitetes System, auf dem der Restore nicht
beim Aufsetzen anfangen muss.

- **Ausfallzeit bei Serververlust:** von Stunden auf unter eine Stunde.
- **Kosten:** ein zweiter Server, überwiegend ungenutzt.
- **Risiko:** gering. Er wirkt nicht mit; im Normalbetrieb kann er nichts kaputt
  machen.
- **Empfehlung: die beste Stufe für den Preis**, wenn die Ausfallzeit stören
  soll. Sie verlangt keine Änderung am laufenden System.

### Stufe 3 — Streaming-Replikation, Umschaltung von Hand

Ein zweiter PostgreSQL-Server folgt dem ersten laufend (`streaming
replication`). Bei einem Ausfall entscheidet **ein Mensch**, dass umgeschaltet
wird.

- **Ausfallzeit:** Minuten.
- **Datenverlust:** nahe null statt fünf Minuten.
- **Kosten:** zweiter Server, dauerhaft aktiv.
- **Risiko:** überschaubar, **weil ein Mensch entscheidet**. Die teuren Fehler
  der Replikation entstehen beim automatischen Umschalten, nicht beim Folgen.
- **Nötig vorher:** ein geprüfter Ablauf für die Umschaltung, geübt, und die
  Sicherheit, dass der alte Primary danach **nicht** wieder als Primary
  hochkommt.

### Stufe 4 — automatisches Failover (Patroni, repmgr)

Ein Cluster entscheidet selbst, wer Primary ist.

- **Ausfallzeit:** Sekunden bis Minuten.
- **Kosten:** mindestens drei Knoten (ein Quorum braucht eine ungerade Zahl),
  ein verteilter Konfigurationsspeicher (etcd oder Consul), und dauerhafte
  Betriebsarbeit.
- **Risiko: hoch, und hier liegt der eigentliche Punkt dieses Dokuments.**

#### Warum Stufe 4 heute nicht eingeschaltet wird

Ein automatisches Failover, das nicht gründlich getestet ist, ist **gefährlicher
als kein Failover**:

- **Split-Brain.** Zwei Knoten halten sich für Primary. Beide nehmen Schreibungen
  an. Die Datenbestände laufen auseinander, und danach gibt es keinen richtigen
  Stand mehr — nur zwei falsche. Kein Backup nimmt das zurück, weil beide
  Zustände echt sind.
- **Ein Failover, das niemand wollte.** Eine Netzstörung von zwanzig Sekunden
  lässt den Cluster umschalten. Das Umschalten selbst verursacht dann den
  Ausfall, den es verhindern sollte.
- **Der Bot macht es schlimmer.** SwissHub wirkt nach aussen. Läuft der Bot nach
  einem Failover zweimal — einmal am alten, einmal am neuen Primary —, sind die
  Folgen doppelte Moderationsaktionen, doppelte Nachrichten und
  widersprüchliche Rollenänderungen auf Discord. Das ist nicht rückholbar. Ein
  Datenbank-Failover bei einem Dienst, der nur liest, ist ein anderes Problem
  als bei einem Dienst, der auf einer fremden Plattform handelt.

Deshalb: **kein ungetestetes automatisches Failover in Produktion.** Wenn Stufe
4 gewünscht ist, gehört davor ein Cluster, der auf einem Testsystem steht, bei
dem absichtlich Knoten abgeschossen und Netze getrennt wurden, und bei dem
nachgewiesen ist, dass der Bot dabei **nie** zweimal läuft.

---

## 4. Wo SwissHub schon heute nicht unnötig ausfällt

Damit die Analyse nicht schwärzer ist als die Lage:

- `systemd` startet abgestürzte Dienste neu — der häufigste Fall ist abgedeckt.
- WebApp und Bot sind getrennte Prozesse. Der Absturz des einen nimmt den
  anderen nicht mit.
- `/api/health` liefert die Teilzustände von WebApp, Datenbank und Bot einzeln.
  Eine externe Überwachung kann damit unterscheiden, was ausgefallen ist.
- Der Audit-Log ist eine Hash-Kette: ein Restore auf einen früheren Stand ist
  daran erkennbar und nicht stillschweigend.
- Die WAL-Archivierung läuft laufend, nicht nach Zeitplan. Der Datenverlust
  hängt nicht daran, wann ein Cron-Eintrag das nächste Mal fällig ist.
- Die Deployment-Pipeline erzwingt vor einer Migration, die Daten wegnehmen
  kann, einen Wiederherstellungspunkt. Der teuerste selbstverschuldete Ausfall
  ist damit umkehrbar.

---

## 5. Empfehlung

In dieser Reihenfolge, und keine Stufe vor der davor:

1. **Externe Überwachung und Heartbeat einrichten** (Stufe 1). Billig, und
   verhindert Ausfälle, statt sie zu verkürzen.
2. **Auswärtigen Objektspeicher einrichten.** Ohne ihn ist der teuerste Fall —
   Serververlust — nicht abgedeckt, und keine Verfügbarkeitsstufe hilft dagegen.
3. **Den Restore einmal auf einem Testsystem durchführen** und die Zeit
   notieren. Erst danach ist bekannt, ob die Ausfallzeit überhaupt stört.
4. **Wenn sie stört: warmes Ersatzsystem** (Stufe 2).
5. **Wenn Minuten nötig sind: Replikation mit Umschaltung von Hand** (Stufe 3).
6. **Automatisches Failover nur nach nachgewiesener Übung** (Stufe 4) — und
   dann mit einer Absicherung, die verhindert, dass der Bot zweimal läuft.

Die Schritte 1 bis 3 kosten fast nichts und bringen das meiste. Schritt 6 ist
der einzige, der die Lage verschlechtern kann, wenn er halb gemacht wird.

---

## 6. Was hier nicht behauptet wird

- Keine Verfügbarkeitszahl. Es gibt keine gemessene Verfügbarkeit, also wird
  keine genannt.
- Keine Ausfallsicherheit durch Backups. Backups begrenzen Datenverlust.
- Kein getestetes Failover. Es ist keines eingerichtet, und das ist Absicht.
- Keine Aussage über die anderen SwissHub-Dienste. Ihre Verfügbarkeit ist hier
  nicht bekannt und nicht geprüft.
