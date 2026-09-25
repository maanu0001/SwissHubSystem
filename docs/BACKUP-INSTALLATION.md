# Installations- und Sicherheitsprüfung: `deploy/backup/install.sh`

Vollständige Analyse des Installationsskripts, **vor** der Ausführung auf dem
produktiven Server. Architektur: [BACKUP.md](BACKUP.md). Notfall:
[DISASTER-RECOVERY.md](DISASTER-RECOVERY.md).

> Das Skript wurde für diese Prüfung **nicht** auf dem produktiven Server
> ausgeführt. Die Analyse stammt aus dem Quelltext (292 Zeilen) und aus der
> Wegwerf-Installation der Katastrophenübung.

---

## 1. Was das Skript tut — und was nicht

Es erstellt einen Dienstbenutzer, kopiert Werkzeuge, legt Verzeichnisse an und
installiert systemd-Units.

**Es schaltet nichts ein.** Kein Timer wird aktiviert, kein Backup ausgeführt,
keine Datenbank angefasst. Am Ende steht eine Liste offener Punkte. Das ist
Absicht: ein Zeitplan auf einer leeren Konfiguration erzeugt stündlich einen
Fehlschlag und sonst nichts.

Es verlangt `root` (`id -u` = 0) und bricht sonst sofort ab. `set -euo pipefail`
— der erste Fehler beendet den Lauf.

## 2. Schritt für Schritt

### Schritt 1 — Werkzeuge prüfen

Verlangt `pgbackrest`, `restic`, `age`, `python3`, `curl` und das Python-Modul
`cryptography`. Fehlt eines, bricht das Skript **vor jeder Änderung** ab und
nennt die `apt`-Zeile. Kein halb installierter Zustand.

### Schritt 2 — Benutzer und Gruppen

| Änderung                                                                      | Wirkung                                                           |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `useradd --system --no-create-home --shell /usr/sbin/nologin swisshub-backup` | Dienstbenutzer ohne Anmeldung, ohne Heimatverzeichnis, ohne Shell |
| `swisshub-backup` → Gruppe `postgres`                                         | nur diese Gruppe kommt an das Datenverzeichnis                    |
| `swisshub-backup` → Gruppe `docker`                                           | nur bei `SWISSHUB_PG_MODE=docker` nötig                           |
| `postgres` → Gruppe `swisshub-backup`                                         | pgBackRest läuft als `postgres` und muss ins Repository schreiben |
| `swisshub` (WebApp) → Gruppe `swisshub-backup`                                | nur um in den Spool-Eingang zu schreiben                          |

> **Sicherheitsrelevant.** Wer in der Gruppe `docker` ist, kann auf diesem Host
> root werden — der Docker-Socket ist gleichbedeutend mit Root. Das Skript sagt
> das im Kommentar selbst. Entschärft wird es dadurch, dass dieser Benutzer
> keine Anmeldung, keine Shell und kein Heimatverzeichnis hat, und dass die
> WebApp **nicht** in diese Gruppe kommt — dafür gibt es den Controller.
>
> **Läuft PostgreSQL nicht in Docker (`SWISSHUB_PG_MODE=host`), ist die
> docker-Gruppe überflüssig.** Dann diese Zeile vor dem Lauf entfernen oder die
> Mitgliedschaft danach zurücknehmen:
> `sudo gpasswd -d swisshub-backup docker`

Nicht vorhandene Gruppen werden übersprungen, nicht angelegt.

### Schritt 3 — Werkzeuge kopieren

Nach `/usr/local/lib/swisshub-backup/{bin,lib,vorlagen}`, Modus 0755/0644.
Symlinks nach `/usr/local/sbin/` für sieben Werkzeuge.

Überschreibt eine frühere Installation. Kein Versionsabgleich, kein Backup der
alten Fassung — bei einem Upgrade ist der alte Stand nur noch im Git.

### Schritt 4 — Konfiguration

`/etc/swisshub-backup/` als `root:swisshub-backup`, Modus 0750.

**Eine bestehende `swisshub-backup.env` wird ausdrücklich NICHT überschrieben.**
Ein zweiter Lauf ist damit gefahrlos — die Passwörter bleiben stehen, und genau
die dürfen sich nie ändern.

Danach `setfacl -m u:postgres:rx` auf das Verzeichnis, damit pgBackRest (das als
`postgres` läuft) hineinsehen kann. **Fällt `setfacl` aus** (kein ACL-Support
im Dateisystem, `acl` nicht installiert), greift der Rückfall `chmod 0755` — das
Verzeichnis wird damit **für alle lesbar**. Die Dateien darin bleiben 0640, die
Geheimnisse sind also weiter geschützt; das Verzeichnislisting wird öffentlich.
Vertretbar, aber prüfenswert:

```bash
getfacl /etc/swisshub-backup        # soll user:postgres:r-x zeigen
stat -c '%a %U:%G' /etc/swisshub-backup   # 0750 ist gut, 0755 der Rückfall
```

### Schritt 5 — Verzeichnisse

Vierzehn Verzeichnisse unter `/var/lib/swisshub-backup/`, alle `2770`
(`swisshub-backup:swisshub-backup`). Das setgid-Bit ist nötig, weil hier zwei
Benutzer im selben Baum arbeiten — ohne es liefe der erste Lauf und der zweite
nicht mehr.

`pgbackrest/`, `spool-wal/` und `log/pgbackrest/` gehen an `postgres`, weil
pgBackRest dort Unterverzeichnisse anlegt und besitzen will.

Die beiden Spool-Verzeichnisse sind die Sicherheitsgrenze:

| Pfad             | Modus | Für die WebApp                          |
| ---------------- | ----- | --------------------------------------- |
| `spool/eingang`  | 2770  | **schreiben** — das einzige Verzeichnis |
| `spool/ergebnis` | 2750  | nur lesen                               |
| `state`          | 2770  | nur lesen (über den Docker-Mount `:ro`) |

Das Repository selbst sieht die WebApp nie.

### Schritt 6 — Das Deployment-Tor (sudoers)

Legt `/etc/sudoers.d/swisshub-backup-deploy` an, Modus 0440, mit **genau zwei
Zeilen**:

```
<deploy-user> ALL=(root) NOPASSWD: /usr/local/lib/swisshub-backup/bin/swisshub-backup vor-deployment
<deploy-user> ALL=(root) NOPASSWD: /usr/local/lib/swisshub-backup/bin/swisshub-backup vor-deployment --nur-pruefen
```

Vollständiger Pfad, fester Unterbefehl, kein `ALL`. Der Grund steht im Skript:
der SSH-Schlüssel dieses Benutzers liegt als GitHub-Secret, und wer ihn erlangt,
soll damit nicht root werden.

Die Datei wird mit `visudo -c` geprüft und **wieder entfernt**, wenn sie
ungültig ist. Eine fehlerhafte sudoers-Datei sperrt `sudo` sonst vollständig
aus.

> Ohne `SWISSHUB_DEPLOY_USER=<benutzer>` wird die Regel **nicht** angelegt.
> Dann scheitert das CI-Gate später an `sudo -n` — leise, mit einer Meldung
> über einen fehlenden Wiederherstellungspunkt. Also gleich mitgeben.

### Schritt 7 — systemd

Kopiert 13 Units nach `/etc/systemd/system/` und ruft `daemon-reload`.
**Aktiviert keine.** Die Zeitpläne:

| Timer                                | Wann                                                 |
| ------------------------------------ | ---------------------------------------------------- |
| `swisshub-backup-controller.path`    | auf Dateiereignis im Spool-Eingang                   |
| `swisshub-backup-controller.timer`   | jede Minute (Rückfall, falls `.path` etwas verpasst) |
| `swisshub-backup-stuendlich.timer`   | stündlich :20 (±5 min)                               |
| `swisshub-backup-taeglich.timer`     | täglich 03:17 (±10 min)                              |
| `swisshub-backup-woechentlich.timer` | sonntags 02:33 (±15 min)                             |
| `swisshub-backup-verify.timer`       | täglich 04:43 (±10 min)                              |
| `swisshub-restore-test.timer`        | mittwochs 01:37 (±20 min)                            |
| `swisshub-backup-monitor.timer`      | alle 15 Minuten (±2 min)                             |

Die krummen Zeiten sind Absicht — nichts soll mit anderen Cron-Jobs auf die
volle Stunde fallen.

### Schritt 8 und 9 — nur Text

Beide Schritte **ändern nichts**. Schritt 8 zeigt die nötigen Ergänzungen in
`docker-compose.prod.yml` (die musst du selbst eintragen), Schritt 9 listet die
sieben offenen Punkte auf.

## 3. Was das Skript **nicht** tut

Wichtig für die Risikoabschätzung:

- **Keine Firewall-Änderung.** Keine `ufw`-, `iptables`- oder `nftables`-Regel.
- **Kein Netzwerkzugriff.** Nichts wird heruntergeladen.
- **Keine Datenbankänderung.** Kein `psql`, kein Neustart von PostgreSQL, keine
  Änderung an `postgresql.conf` — `archive_mode` musst du selbst einschalten,
  und das verlangt einen Neustart.
- **Kein Backup.** Es legt keines an und löscht keines.
- **Keine Änderung an bestehenden Diensten.** `docker-compose.prod.yml` wird
  nicht angefasst.
- **Keine Geheimnisse.** Es erzeugt keine Passwörter und schreibt keine in eine
  Datei; die Vorlage enthält leere Felder.

Einzige Änderungen ausserhalb der eigenen Verzeichnisse: die
Gruppenmitgliedschaften (Schritt 2), die sudoers-Datei (Schritt 6), die Symlinks
in `/usr/local/sbin` und die Units in `/etc/systemd/system`.

## 4. Rückbau

Das Skript hat **keine Deinstallationsroutine** — das ist eine Lücke. Der
Rückbau von Hand, in dieser Reihenfolge:

```bash
# 1. Alles anhalten
sudo systemctl disable --now swisshub-backup-{stuendlich,taeglich,woechentlich}.timer \
                             swisshub-backup-{verify,monitor,controller}.timer \
                             swisshub-restore-test.timer \
                             swisshub-backup-controller.path

# 2. Units entfernen
sudo rm -f /etc/systemd/system/swisshub-backup*.{service,timer,path} \
           /etc/systemd/system/swisshub-restore-test.{service,timer}
sudo systemctl daemon-reload

# 3. Das Deployment-Tor
sudo rm -f /etc/sudoers.d/swisshub-backup-deploy
sudo visudo -c        # prüfen, dass sudo weiter funktioniert

# 4. Werkzeuge und Symlinks
sudo rm -rf /usr/local/lib/swisshub-backup
sudo rm -f /usr/local/sbin/swisshub-{backup,backup-verify,restore-test,recovery,secrets-seal,backup-monitor,backup-selbsttest}

# 5. Gruppenmitgliedschaften zurücknehmen
sudo gpasswd -d postgres swisshub-backup
sudo gpasswd -d swisshub swisshub-backup
sudo gpasswd -d swisshub-backup docker
sudo gpasswd -d swisshub-backup postgres

# 6. Dienstbenutzer
sudo userdel swisshub-backup
```

**Und die WAL-Archivierung in `postgresql.conf` zurücknehmen** — sonst schreibt
PostgreSQL weiter in ein `archive_command`, das es nicht mehr gibt, und
**staut WAL-Segmente auf, bis die Platte voll ist**:

```
archive_mode = off        # verlangt einen Neustart von PostgreSQL
```

Der gefährliche Teil zuletzt, **bewusst nicht oben**:

```bash
# VERNICHTET ALLE SICHERUNGEN. Nur, wenn sie wirklich weg sollen.
sudo rm -rf /var/lib/swisshub-backup
sudo rm -rf /etc/swisshub-backup     # enthält die Repository-Passwörter
```

> Solange `/etc/swisshub-backup/swisshub-backup.env` existiert, ist ein
> bestehendes Repository wieder lesbar. Ohne die Datei und ohne das
> Wiederherstellungspaket sind die Sicherungen **endgültig unlesbar** —
> die Verschlüsselungspasswörter stehen nirgends sonst.

## 5. Voraussetzungen — Checkliste

### BEREITS VORHANDEN

| Punkt                    | Nachweis                                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| PostgreSQL 16            | in der Übung gegen 16.13 geprüft; die Sicherung verlangt dieselbe **Hauptversion** beim Restore |
| Ein Server mit `systemd` | die 13 Units setzen ihn voraus                                                                  |
| Die Werkzeuge selbst     | Code liegt im Repository, wird mit dem Deploy ausgerollt                                        |
| Der Deploy-Benutzer      | existiert, sein SSH-Schlüssel liegt als GitHub-Secret                                           |
| Das Upload-Verzeichnis   | vorhanden, Pfad muss nur ermittelt werden                                                       |

### MUSS NOCH EINGERICHTET WERDEN (auf dem Server, kein externer Einkauf)

| Punkt                                                    | Wie                                                                                                                     |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Pakete `pgbackrest restic age python3-cryptography curl` | `apt install` — Schritt 1 prüft es                                                                                      |
| Die beiden Repository-Passwörter                         | `openssl rand -base64 48`, zweimal. **Nie wieder ändern**                                                               |
| Pfade in `swisshub-backup.env`                           | `SWISSHUB_PG_MODE`, `SWISSHUB_PG_DATA`, `SWISSHUB_UPLOAD_DIR`                                                           |
| WAL-Archivierung                                         | vier Zeilen in `postgresql.conf`, **Neustart nötig** für `wal_level`/`archive_mode`                                     |
| pgBackRest **im** Postgres-Container                     | nur bei `SWISSHUB_PG_MODE=docker` — ohne das kein physisches Backup                                                     |
| Drei Volume-Mounts für `web`                             | Eingang schreibend, `state` und `ergebnis` lesend                                                                       |
| Freier Plattenplatz                                      | mindestens `SWISSHUB_MIN_FREE_GB` (Vorgabe 1 GB) plus Platz für die Kette; `swisshub-backup status` zeigt eine Prognose |

### MUSS ICH MANUELL BEREITSTELLEN (extern, nicht auf dem Server erzeugbar)

| Punkt                                                          | Warum nicht automatisierbar                                                                                                                               |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`age`-Schlüsselpaar, mindestens zwei**                       | `age-keygen` auf einem **anderen** Rechner. Der private Teil darf nie auf diesen Server. Öffentliche Teile nach `SWISSHUB_RECOVERY_AGE_RECIPIENTS`        |
| **S3-kompatibler Objektspeicher** mit Object Lock (Compliance) | muss eingekauft werden; ohne ihn keine Sicherung gegen Serververlust                                                                                      |
| **Zwei getrennte S3-Zugangsdatenpaare**                        | schreibend auf den Server (`SWISSHUB_S3_WRITE_*`), lesend **nur** in den Passwortmanager. `SWISSHUB_S3_RESTORE_*` bleiben auf dem Server absichtlich leer |
| **Heartbeat-URL**                                              | Dead-man's switch; der einzige Weg, der einen Totalverlust melden kann                                                                                    |
| **Discord-Webhook** (`SWISSHUB_ALERT_DISCORD_WEBHOOK`)         | Alarm unabhängig vom Bot-Prozess                                                                                                                          |
| **SMTP-Konto** (`SWISSHUB_ALERT_SMTP_*`)                       | Alarm unabhängig von Discord                                                                                                                              |
| **Ein Testsystem**                                             | für den produktiven Restore-Nachweis                                                                                                                      |

> Keine dieser Angaben gehört in Git, in ein Log oder in eine unverschlüsselte
> Datei. Sie stehen ausschliesslich in `/etc/swisshub-backup/swisshub-backup.env`
> (Modus 0640, `root:swisshub-backup`). Die Protokollierung ersetzt jeden
> bekannten Geheimniswert durch seinen Namen, bevor eine Zeile geschrieben wird
> (`verdecke()` in `lib/gemeinsam.sh`).

## 6. Reihenfolge auf dem Server

```bash
# 1. Pakete
sudo apt update && sudo apt install -y pgbackrest restic age python3-cryptography curl

# 2. Installation - mit dem Deploy-Benutzer, sonst fehlt das CI-Tor
sudo SWISSHUB_DEPLOY_USER=<deploy-benutzer> bash deploy/backup/install.sh

# 3. Konfiguration ausfüllen (Passwörter, Pfade, age-Empfänger)
sudo nano /etc/swisshub-backup/swisshub-backup.env

# 4. Trockenlauf auf einem Wegwerf-Cluster - berührt die Produktion NICHT
sudo swisshub-backup-selbsttest

# 5. WAL-Archivierung einschalten (postgresql.conf), dann PostgreSQL neu starten

# 6. Einrichten und erstmalig sichern
sudo swisshub-backup konfiguration-schreiben
sudo swisshub-backup einrichten
sudo swisshub-backup db-voll
sudo swisshub-backup dateien
sudo swisshub-backup geheimnisse

# 7. Prüfen - siehe Abschnitt 7
sudo swisshub-backup-verify
sudo swisshub-restore-test

# 8. Erst wenn alles davon grün ist: die Timer
sudo systemctl enable --now swisshub-backup-{stuendlich,taeglich,woechentlich}.timer
sudo systemctl enable --now swisshub-backup-{verify,monitor}.timer
sudo systemctl enable --now swisshub-restore-test.timer
sudo systemctl enable --now swisshub-backup-controller.path swisshub-backup-controller.timer
```

Schritt 4 ist der, den man auslässt und später bereut. Er legt einen eigenen
Cluster an, spielt ihn zurück, prüft 41 Punkte samt vier Gegenproben und räumt
sich selbst auf — ohne die Produktion zu berühren.

## 7. Restore-Tests nach der Installation

Ein Backup, das nie zurückgespielt wurde, ist eine Annahme.

| #   | Test                                                  | Befehl                                                            | Erwartung                                                                          |
| --- | ----------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 1   | Selbsttest auf Wegwerf-Cluster                        | `swisshub-backup-selbsttest`                                      | 41 Prüfungen grün                                                                  |
| 2   | Stufen 1–4                                            | `swisshub-backup-verify`                                          | 1, 2, 4 grün. **Stufe 3 rot**, solange kein S3 eingerichtet ist — das ist richtig  |
| 3   | Stufen 5–6: echter Restore, isoliert                  | `swisshub-restore-test`                                           | Cluster startet, Tabellen und Migrationsstand stimmen, Geheimnisse entschlüsselbar |
| 4   | Paket mit dem **offline** verwahrten Schlüssel öffnen | `swisshub-recovery paket <p> <key>` auf einem **anderen** Rechner | Paket geht auf, `MASTER_ENCRYPTION_KEY` ist darin                                  |
| 5   | Preflight ohne Änderung                               | `swisshub-recovery pruefen`                                       | alle Punkte grün, nichts verändert                                                 |
| 6   | Einzelne Datei zurückholen                            | `swisshub-recovery datei <muster>`                                | Datei wird in den Snapshots gefunden                                               |
| 7   | Vollständige Übung auf einem **Testsystem**           | Totalverlust nachstellen                                          | RTO messen und notieren                                                            |

Test 4 ist der, der am ehesten vergessen wird und am meisten kostet. Ein
Schlüssel, der nie ausprobiert wurde, ist keine Sicherung — er ist eine Datei,
von der man hofft, dass sie der richtige Schlüssel ist.

Test 7 ist der einzige, der den produktiven RTO wirklich misst. Bis er gelaufen
ist, bleibt die Zahl in [BACKUP.md](BACKUP.md) ein Übungsergebnis.

**Keiner dieser Tests verändert produktive Daten.** Test 3 läuft mit eigenem
Verzeichnis, eigenem Port, `--network none` und `archive_mode = off`; kein
produktiver Discord-Bot startet dabei.
