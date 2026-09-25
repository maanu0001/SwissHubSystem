# Notfall — Wiederherstellung

Dieses Dokument ist für den Ernstfall geschrieben, nicht zum Lernen. Wie die
Anlage gebaut ist, steht in [BACKUP.md](BACKUP.md).

**Wenn gerade etwas kaputt ist, fang bei Abschnitt 1 an.**

---

## 0. Was du brauchst, bevor du anfängst

| Nötig                                            | Wo es liegt                                                                               |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Das versiegelte Wiederherstellungspaket          | `recovery/` im Backup-Speicher, oder im auswärtigen Repository unter der Marke `recovery` |
| Der private `age`-Schlüssel                      | Passwortmanager und Medium im Safe — **nicht auf einem Server**                           |
| Die **lesenden** S3-Zugangsdaten                 | Passwortmanager — auf dem Produktionsserver stehen sie absichtlich nicht                  |
| Ein Server mit derselben PostgreSQL-Hauptversion | siehe `systemstand.txt` im Paket                                                          |

Ohne den privaten Schlüssel geht es nicht weiter. Wenn er weg ist, springe zu
[Abschnitt 8](#8-wenn-der-schlüssel-weg-ist).

Die Recovery-CLI braucht **nichts** von SwissHub: kein Node, kein Prisma, keine
laufende WebApp, kein Netz zum alten Server. Nur `bash`, `pgbackrest`,
`restic`, `age`, `python3` und `tar`.

---

## 1. Erst feststellen, was überhaupt passiert ist

Nicht wiederherstellen, bevor das klar ist. Ein Restore auf den falschen
Zeitpunkt vernichtet Daten, die noch da waren.

```bash
sudo swisshub-recovery notfall
```

Das ist der geführte Ablauf. Er stellt nichts wieder her, ohne dass du ein Wort
tippst. Wenn du lieber selbst steuerst, sind es diese Fragen:

**Läuft die Datenbank noch?**

```bash
sudo -u postgres pg_isready
sudo systemctl status postgresql
```

**Ist das Datenverzeichnis noch da und plausibel?**

```bash
sudo ls -la /var/lib/postgresql/16/main/ | head
```

Danach ordne den Fall ein:

| Symptom                                         | Fall                 | Weiter bei                                               |
| ----------------------------------------------- | -------------------- | -------------------------------------------------------- |
| Server weg, neu aufgesetzt oder neu gemietet    | Totalverlust         | [Abschnitt 3](#3-totalverlust-des-servers)               |
| Datenbank startet nicht, Dateien beschädigt     | Datenbankschaden     | [Abschnitt 4](#4-datenbankschaden)                       |
| Eine Migration hat Daten weggenommen            | fehlerhafte Änderung | [Abschnitt 5](#5-eine-fehlerhafte-änderung-zurücknehmen) |
| Ein Datensatz wurde gelöscht, sonst läuft alles | Einzelfall           | [Abschnitt 6](#6-einen-einzelnen-datensatz-zurückholen)  |
| Eine Datei fehlt, Datenbank ist in Ordnung      | Einzelfall           | [Abschnitt 7](#7-eine-einzelne-datei-zurückholen)        |

---

## 2. Die drei Regeln

1. **Zuerst ansehen, dann wiederherstellen.** `swisshub-recovery pruefen` und
   `swisshub-recovery probelauf` verändern nichts.
2. **Nie direkt über die Produktion schreiben.** Jeder Weg hier legt zuerst
   daneben ab. Wer den falschen Zeitpunkt gewählt hat, soll den zweiten Fehler
   noch korrigieren können.
3. **Der Bot bleibt aus, bis die Daten geprüft sind.** Er wirkt nach aussen. Auf
   fehlerhaften Daten richtet er auf Discord Schaden an, den kein Backup
   zurücknimmt. `swisshub-recovery freigeben` ist ein eigener, letzter Schritt.

---

## 3. Totalverlust des Servers

Gemessen in der Übung: **rund 3 Minuten** für Datenbank und Dateien bei einer
20-MB-Datenbank auf derselben Maschine — ohne das Aufsetzen des Servers. Für
die Produktion ist die Zeit grösser und nicht gemessen. Rechne mit dem
Aufsetzen des Servers als dem längsten Teil.

### 3.1 Server aufsetzen

Betriebssystem, Docker und PostreSQL in der Version aus `systemstand.txt`.
Dann dieses Repository klonen:

```bash
git clone <repository> /opt/swisshub
cd /opt/swisshub
sudo ./deploy/backup/install.sh
```

Wenn GitHub nicht erreichbar ist, liegt der Releasestand auch im Paket
(`release.json`) und der Konfigurationsstand im Restic-Repository unter der
Marke `konfiguration`. Das Verfahren hängt nicht allein an GitHub.

### 3.2 Werkzeuge prüfen

```bash
sudo swisshub-recovery vorbereiten
```

Sagt, was fehlt, und wie es zu installieren ist.

### 3.3 Das Paket öffnen

```bash
sudo swisshub-recovery paket /pfad/zu/swisshub-recovery-<stamp>.tar.age /pfad/zum/recovery.key
```

Es liegen bis zu zwölf Pakete. Wenn eines nicht aufgeht, nimm ein anderes.
Wurde auf mehrere Empfänger versiegelt, öffnet **jeder** private Schlüssel das
Paket allein.

Darin:

| Datei                 | Inhalt                                                                       |
| --------------------- | ---------------------------------------------------------------------------- |
| `schluessel.txt`      | `MASTER_ENCRYPTION_KEY`, `AUTH_SECRET`, Datenbank- und Repository-Passwörter |
| `swisshub.env`        | die `.env` der Anwendung                                                     |
| `swisshub-backup.env` | die Konfiguration der Backup-Anlage                                          |
| `release.json`        | Commit, Abbild-Digests, Migrationsstand                                      |
| `fingerabdruecke.txt` | Kennungen zum Abgleich                                                       |
| `ANLEITUNG.txt`       | dieser Ablauf, im Paket                                                      |

### 3.4 Konfiguration einspielen

```bash
sudo install -d -m 0750 /etc/swisshub-backup
sudo install -m 0640 /var/lib/swisshub-recovery/entpackt/paket/swisshub-backup.env \
                     /etc/swisshub-backup/swisshub-backup.env
sudo install -m 0600 -o root -g root /var/lib/swisshub-recovery/entpackt/paket/swisshub.env \
                     /opt/swisshub/.env
```

Dann in `/etc/swisshub-backup/swisshub-backup.env` die **lesenden**
S3-Zugangsdaten eintragen. Die schreibenden aus dem Paket stammen vom
verlorenen Server: sie sind möglicherweise kompromittiert und gehören
**gesperrt, nicht weiterbenutzt**.

`pgbackrest.conf` musst du nicht anlegen. Sie ist aus der Konfiguration
herleitbar, liegt deshalb absichtlich nicht im Paket, und die Recovery-CLI
erzeugt sie beim ersten Aufruf selbst.

### 3.5 Ansehen, was zur Auswahl steht

```bash
sudo swisshub-recovery punkte
sudo swisshub-recovery pruefen
```

`punkte` zeigt die Basis-Backups, den ansteuerbaren Zeitraum und die
Dateisicherungen daneben. `pruefen` ist der Preflight: Lesbarkeit des
Repositories, Prüfsummen, PostgreSQL-Version, Vorhandensein des
Hauptschlüssels, freier Platz, kein laufender Cluster am Zielort.

Ohne `--zeit` wird der jüngstmögliche Stand hergestellt. Bei einem
Serververlust ist das richtig: der jüngste Stand ist der mit dem geringsten
Datenverlust.

### 3.6 Probelauf, dann Wiederherstellung

```bash
sudo swisshub-recovery probelauf          # verändert nichts
sudo swisshub-recovery wiederherstellen   # fragt nach dem Wort WIEDERHERSTELLEN
sudo swisshub-recovery dateien            # Uploads
sudo swisshub-recovery konfiguration      # nginx, Zertifikatsstand, Releasestand
```

Die Konfiguration wird **ausgepackt und nicht eingespielt**. Eine
nginx-Konfiguration, die auf alte Hostnamen und alte Zertifikatspfade zeigt,
legt den neuen Server lahm. Sie gehört angesehen.

### 3.7 Prüfen

```bash
sudo swisshub-recovery validieren
```

Geprüft wird: PostgreSQL antwortet, die Datenbank ist beschreibbar (die
Wiederherstellung ist also abgeschlossen und nicht mitten im Recovery), Anzahl
Tabellen, Kerntabellen, Migrationsstand, Konfigurationsdaten, und — der
wichtigste Punkt — ob die verschlüsselten Zugangsdaten mit dem vorhandenen
Hauptschlüssel **wirklich lesbar** sind. Dazu die Upload-Dateien und die
Verweise aus der Datenbank darauf.

Sieh dir die Zahlen an und vergleiche sie mit dem, was du erwartest.

### 3.8 Erst jetzt nach aussen

```bash
sudo swisshub-recovery freigeben     # fragt nach dem Wort FREIGEBEN
```

Startet Bot und Musik-Laufzeit. Ab diesem Moment wirkt SwissHub wieder auf
Discord.

**Vorher sicherstellen, dass der alte Bot nicht mehr läuft.** Zwei Instanzen
desselben Bots gleichzeitig führen zu doppelten Antworten, doppelten
Moderationsaktionen und widersprüchlichen Rollenänderungen. Wenn der alte
Server noch erreichbar ist, dort erst `systemctl stop` — und wenn er nicht
erreichbar ist, den Bot-Token in Discord neu erzeugen, damit der alte
endgültig nicht mehr wirken kann.

### 3.9 Weitere SwissHub-Dienste

**Diese Anlage sichert sie nicht.** Auf demselben Server laufen nach
[BESTANDSAUFNAHME.md](BESTANDSAUFNAHME.md) weitere Dienste mit eigenen
PostgreSQL-Instanzen und eigenen Volumes:

| Dienst             | Adresse                | Eigene Datenbank | Von dieser Anlage gesichert |
| ------------------ | ---------------------- | ---------------- | --------------------------- |
| SwissHubGG         | swisshub.gg            | ja               | **nein**                    |
| SwissHubSponsoring | sponsoring.swisshub.gg | ja               | **nein**                    |

Nach einem Totalverlust sind diese Dienste **nicht** wiederhergestellt. Sie
brauchen ihre eigene Sicherung, und ob eine existiert, ist hier nicht bekannt.
Das ist keine Auslassung aus Bequemlichkeit: ohne geklärte Zuständigkeit und
geprüften Zugriff wird an fremden Projekten nichts verändert.

Wenn diese Anlage sie mitsichern soll, ist das eine bewusste Erweiterung —
dieselben Werkzeuge können mehrere Stanzas bedienen. Nötig sind vorher: die
Zuständigkeit, der Zugriff auf die Volumes, und die Bestätigung, dass ein
Restore dieser Dienste nicht mit einer anderen bestehenden Sicherung kollidiert.

### 3.10 Reihenfolge im Überblick

1. Server aufsetzen, PostgreSQL in der richtigen Hauptversion
2. Repository klonen, `install.sh`
3. `vorbereiten`
4. Paket öffnen
5. Konfiguration einspielen, **lesende** S3-Zugangsdaten eintragen
6. `punkte`, `pruefen`
7. `probelauf`
8. `wiederherstellen`
9. `dateien`, `konfiguration`
10. `validieren`
11. Alten Bot sicher stillgelegt, Token gegebenenfalls neu
12. `freigeben`

---

## 4. Datenbankschaden

Der Server läuft, die Datenbank nicht.

```bash
sudo systemctl stop swisshub-bot swisshub-web    # was nach aussen wirkt, zuerst aus
sudo swisshub-recovery punkte
sudo swisshub-recovery pruefen
sudo swisshub-recovery probelauf
sudo swisshub-recovery wiederherstellen
sudo swisshub-recovery validieren
sudo swisshub-recovery freigeben
```

Der Preflight weist ab, wenn am Zielort noch ein Cluster läuft. Das ist
Absicht: ein Restore über ein laufendes Datenverzeichnis zerstört beides.

---

## 5. Eine fehlerhafte Änderung zurücknehmen

Eine Migration hat eine Spalte entfernt, ein Skript hat zu viel gelöscht.

**Hier ist der jüngste Stand der falsche.** Nötig ist ein Zeitpunkt
**unmittelbar davor**.

```bash
sudo swisshub-recovery punkte    # nennt auch die Wiederherstellungspunkte
                                 # vor_deploy_<stamp> aus dem Deployment
sudo swisshub-recovery pruefen --zeit '2026-09-25 14:31:00+02'
sudo swisshub-recovery probelauf --zeit '2026-09-25 14:31:00+02'
sudo swisshub-recovery wiederherstellen --zeit '2026-09-25 14:31:00+02'
```

**Was du dabei verlierst:** alles, was zwischen dem gewählten Zeitpunkt und
jetzt geschah — in **allen** Tabellen. Neue Tickets, Moderationseinträge,
XP-Stände, Audit-Log-Einträge. Ein PITR ist nicht die Rücknahme einer einzelnen
Änderung, sondern der Rücklauf des ganzen Clusters.

Wenn du das nicht willst, ist [Abschnitt 6](#6-einen-einzelnen-datensatz-zurückholen)
der Weg.

**Ein Git-Rollback genügt nicht.** Der alte Code stellt das alte Schema nicht
wieder her; er läuft auf dem neuen Schema nur nicht mehr.

---

## 6. Einen einzelnen Datensatz zurückholen

Ohne die Änderungen danach zu verlieren. Drei Schritte, und der erste ist der
wichtigste: **nicht auf der Produktion**.

### 6.1 In eine isolierte Instanz wiederherstellen

```bash
sudo swisshub-restore-test --zeit '2026-09-25 14:31:00+02' --behalten
```

Eigenes Verzeichnis, eigener Port, `--network none`, `archive_mode = off`, keine
Anwendung. `--behalten` lässt die Instanz nach dem Test stehen, damit du darin
lesen kannst.

### 6.2 Gezielt auslesen

```bash
sudo -u postgres psql -p <testport> -d swisshub \
  -c "\copy (select * from \"Ticket\" where id = '<id>') to '/tmp/zeile.csv' csv header"
```

Nur die betroffenen Zeilen. Fremdschlüssel bedenken: eine Zeile allein nützt
nichts, wenn die Zeile, auf die sie verweist, auch gelöscht wurde.

### 6.3 In die Produktion einfügen

```bash
sudo -u postgres psql -d swisshub \
  -c "\copy \"Ticket\" from '/tmp/zeile.csv' csv header"
```

Sieh dir davor an, was du einfügst. Und räume die Testinstanz auf:

```bash
sudo swisshub-restore-test --aufraeumen
```

---

## 7. Eine einzelne Datei zurückholen

```bash
sudo swisshub-recovery datei <teil-des-namens>
```

Zeigt, in welchen Snapshots die Datei liegt, und nennt den Befehl zum
Zurückholen — in ein Nebenverzeichnis, nicht über die Produktion.

Die Suche unterscheidet Gross- und Kleinschreibung, und die Dateinamen sind
serverseitig erzeugt. Der Name aus dem Browser kommt darin nicht vor; er steht
in der Datenbank.

Das ganze Verzeichnis:

```bash
sudo swisshub-recovery verzeichnis --zeit '<T>'
```

Der bisherige Stand wird beiseitegelegt und nicht gelöscht.

---

## 8. Wenn der Schlüssel weg ist

Ohne den privaten `age`-Schlüssel lässt sich kein Paket öffnen. Dann gilt:

- Die **Datenbank** ist wiederherstellbar, solange das
  Repository-Verschlüsselungspasswort noch bekannt ist (es steht in
  `swisshub-backup.env` auf dem Server — wenn der weg ist, nur im Paket).
- Die **verschlüsselten Integrations-Zugangsdaten** sind verloren. Die Zeilen
  sind da, ihr Inhalt nicht. Jede Integration muss neu eingerichtet werden.
- `AUTH_SECRET` ist verloren: alle Sitzungen sind ungültig, alle müssen sich
  neu anmelden. Das ist unangenehm und kein Datenverlust.

Deshalb: **mehrere Empfänger**. `swisshub-secrets-seal` versiegelt auf beliebig
viele öffentliche Schlüssel, und jeder private öffnet das Paket allein. Zwei
Personen mit je einem Schlüssel an zwei Orten kosten nichts und lösen diesen
Fall.

---

## 9. Wenn das Repository beschädigt ist

```bash
sudo swisshub-backup-verify          # meldet, welche Stufe scheitert
```

Ist das lokale Repository beschädigt, nimm das auswärtige:

```bash
sudo swisshub-recovery punkte --repo 2
sudo swisshub-recovery pruefen --repo 2
sudo swisshub-recovery wiederherstellen --repo 2
```

Umgekehrt ebenso mit `--repo 1`. Die Vorgabe ist das auswärtige Repository —
wer dieses Werkzeug braucht, hat meist den Server verloren. Ist gar kein
auswärtiges eingerichtet, weicht die CLI auf die lokale Kopie aus und sagt
dabei ausdrücklich, dass diese einen Serververlust nicht überlebt.

Ist die WAL-Kette lückenhaft, ist der jüngste erreichbare Zeitpunkt der letzte
vor der Lücke. `punkte` zeigt den ansteuerbaren Zeitraum; ein Zeitpunkt
dahinter ist keiner.

---

## 10. Was der Betreiber bereitstellen muss

Nichts davon wird als vorhanden angenommen. Solange es fehlt, läuft die Anlage
mit **einer** Kopie auf **einem** Server — und schützt damit gegen
Datenbankschäden, nicht gegen den Verlust des Servers.

| Nötig                                                                | Wofür                                | Ohne das                                                 |
| -------------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------- |
| **S3-kompatibler Objektspeicher** mit Object Lock (Compliance-Modus) | Kopie auswärts, Unveränderbarkeit    | keine Sicherung gegen Serververlust und gegen Ransomware |
| **Zwei getrennte Zugangsdatenpaare** (schreibend, lesend)            | der Server darf nicht löschen können | ein übernommener Server kann die Sicherungen löschen     |
| **Kosten** für Speicher und Transfer                                 | —                                    | —                                                        |
| **Ein `age`-Schlüsselpaar**, privater Teil offline und mehrfach      | Geheimnisse wiederherstellen         | Integrationen nach einem Restore neu einrichten          |
| **Eine Heartbeat-URL** (Dead-man's switch)                           | Totalverlust melden                  | ein Totalausfall alarmiert nicht                         |
| **Ein SMTP-Konto**                                                   | Alarm unabhängig von Discord         | Alarme nur über Discord                                  |
| **Ein Testsystem** für den produktiven Restore-Nachweis              | RTO wirklich messen                  | der produktive RTO bleibt geschätzt                      |

Anlegen der Zugangsdaten und Richtlinien:
[`deploy/backup/vorlagen/s3-richtlinien.md`](../deploy/backup/vorlagen/s3-richtlinien.md).

---

## 11. Testplan

Ein Backup-System, das nicht regelmässig geprüft wird, verfällt still.

| Rhythmus            | Was                                                                    | Wie                                   |
| ------------------- | ---------------------------------------------------------------------- | ------------------------------------- |
| **täglich**         | Existenz, Alter, Prüfsummen, Unveränderbarkeit, WAL-Kette              | automatisch, `swisshub-backup-verify` |
| **wöchentlich**     | Restore in eine isolierte Instanz, inhaltliche Prüfung                 | automatisch, `swisshub-restore-test`  |
| **monatlich**       | Paket mit dem **offline** verwahrten Schlüssel wirklich öffnen         | von Hand                              |
| **vierteljährlich** | Vollständige Übung: Totalverlust auf einem Testsystem, Zeiten notieren | von Hand                              |

Die monatliche Prüfung ist die, die am ehesten vergessen wird und am meisten
kostet. Ein Schlüssel, der nie ausprobiert wurde, ist keine Sicherung — er ist
eine Datei, von der man hofft, dass sie der richtige Schlüssel ist.

Das Dashboard zeigt keine Testergebnisse, die es nicht gibt. Steht dort «nicht
gemessen», dann ist es nicht gemessen.

---

## 12. Kurzreferenz

```bash
swisshub-recovery notfall              # geführt, empfohlen
swisshub-recovery vorbereiten          # Werkzeuge prüfen
swisshub-recovery paket <p> <key>      # versiegeltes Paket öffnen
swisshub-recovery punkte               # was zur Auswahl steht
swisshub-recovery pruefen [--zeit T]   # Preflight, ändert nichts
swisshub-recovery probelauf [--zeit T] # Trockenlauf, ändert nichts
swisshub-recovery wiederherstellen [--zeit T]
swisshub-recovery dateien              # Uploads
swisshub-recovery verzeichnis [--zeit T]
swisshub-recovery datei <muster>       # eine einzelne suchen
swisshub-recovery konfiguration        # nginx, Zertifikate, Release
swisshub-recovery validieren           # nach dem Restore prüfen
swisshub-recovery freigeben            # Bot starten - letzter Schritt

# überall zusätzlich:
  --repo 1    lokale Kopie
  --repo 2    auswärtige Kopie (Vorgabe)
```
