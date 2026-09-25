# Backup, Wiederherstellung und Ausfallsicherheit

Was gesichert wird, wie, wohin, und woran man erkennt, dass es stimmt.

Der Notfallablauf steht getrennt in [DISASTER-RECOVERY.md](DISASTER-RECOVERY.md) —
dort und nicht hier schaut jemand um drei Uhr nachts nach. Was an Infrastruktur
tatsächlich vorhanden ist und was nicht, steht in
[BESTANDSAUFNAHME.md](BESTANDSAUFNAHME.md). Die Analyse zur Hochverfügbarkeit
steht in [VERFUEGBARKEIT.md](VERFUEGBARKEIT.md).

---

## 1. Ziele und was davon gemessen ist

| Grösse        | Zielwert | Woran er hängt                                  |
| ------------- | -------- | ----------------------------------------------- |
| RPO Datenbank | ~5 min   | `archive_timeout = 300` in `postgresql.conf`    |
| RTO Datenbank | ≤ 2 h    | Grösse der Datenbank, Bandbreite zum Repository |
| RPO Dateien   | ≤ 1 h    | Stündlicher Restic-Lauf                         |

**Das sind technische Zielwerte und keine Zusicherungen.** Sie gelten für den
Fall, für den die Anlage gebaut ist: Verlust des Servers oder der Datenbank bei
intaktem Backup-Speicher. Sie gelten nicht für jeden denkbaren Schaden — ein
beschädigtes Repository, ein verlorener Schlüssel oder ein Rechenzentrum ohne
Netz sind andere Fälle, und für zwei davon gibt es die zweite Kopie.

Das Dashboard unter **System → Backup & Recovery** zeigt die **gemessenen**
Werte, nicht die gewünschten: das Alter des jüngsten archivierten
WAL-Segments als tatsächlichen RPO, und die Laufzeit des letzten
Wiederherstellungstests als tatsächlichen RTO-Anhaltspunkt. Solange kein Test
gelaufen ist, steht dort «nicht gemessen» und keine Zahl.

### Was in der Übung gemessen wurde

Eine vollständige Katastrophenübung auf einer Wegwerf-Installation
(PostgreSQL 16, Datenbank rund 20 MB, 20 Tabellen, 3 Upload-Dateien),
zweimal durchgeführt. Zerstört wurden Datenverzeichnis, Upload-Verzeichnis,
Projektverzeichnis samt `.env` und `/etc/swisshub-backup`, mit `kill -9` und
ohne sauberes Herunterfahren. Übrig blieben nur der Backup-Speicher und der
private `age`-Schlüssel.

| Schritt                                | Gemessen  |
| -------------------------------------- | --------- |
| Paket öffnen, Konfiguration einspielen | 1 s       |
| Datenbank physisch wiederherstellen    | 126 s     |
| Uploads wiederherstellen               | 2 s       |
| **Gesamt, ohne Aufsetzen des Servers** | **177 s** |

Ergebnis des Vergleichs vorher/nachher:

- Alle Zeilen bis zum letzten archivierten WAL-Segment waren wieder da.
- Die absichtlich **nicht** archivierte Änderung (7 Zeilen, zwei Sekunden vor
  dem Ausfall) war weg. Das ist der RPO, sichtbar gemacht: verloren geht, was
  im offenen WAL-Segment stand.
- Die Upload-Dateien waren byteweise identisch (Sammel-MD5 gleich).
- Ein mit `MASTER_ENCRYPTION_KEY` verschlüsselter Datensatz war byteweise
  identisch und mit dem Schlüssel aus dem versiegelten Paket wieder lesbar.

**Diese 177 Sekunden sind nicht der produktive RTO.** Die produktive Datenbank
ist grösser, das Repository liegt teils auswärts, und das Aufsetzen eines neuen
Servers ist nicht mitgemessen. Die Zahl belegt, dass der Ablauf funktioniert
und wo die Zeit hingeht — nicht, wie lange es in der Produktion dauert. Was
dort gilt, sagt erst ein Test dort.

In der Übung stand `archive_timeout = 15`, damit sie in Minuten statt in
Stunden läuft. Produktiv sind es 300 Sekunden, und damit ist der
schlechtestmögliche Datenverlust fünf Minuten.

---

## 2. Womit gesichert wird

Nicht mit einer selbst geschriebenen Backup-Engine. Eine eigene Engine wäre
genau die Komponente, die man unmöglich so gründlich prüfen kann wie ein
Werkzeug, das täglich in Tausenden Installationen läuft — und sie fällt genau
dann auf, wenn man sie am nötigsten braucht.

| Werkzeug       | Wofür                                                                                                           |
| -------------- | --------------------------------------------------------------------------------------------------------------- |
| **pgBackRest** | Physische Basis-Backups, WAL-Archivierung, Point-in-Time-Recovery, Prüfsummen, Verschlüsselung des Repositories |
| **Restic**     | Dateien: Uploads, Konfigurationsstand, versiegelte Pakete. Deduplizierend                                       |
| **age**        | Versiegeln des Wiederherstellungspakets, asymmetrisch                                                           |
| **PostgreSQL** | `pg_dumpall --globals-only` für Rollen, logischer Dump als zweiter Weg                                          |

Der eigene Code darüber orchestriert, prüft und meldet. Er sichert nicht selbst.

---

## 3. Was gesichert wird

| Gegenstand                  | Werkzeug                    | Rhythmus                       | Aufbewahrung                 |
| --------------------------- | --------------------------- | ------------------------------ | ---------------------------- |
| Datenbank, physisch (voll)  | pgBackRest                  | wöchentlich                    | 2 voll (lokal), 4 (auswärts) |
| Datenbank, physisch (diff)  | pgBackRest                  | täglich                        | 4                            |
| Datenbank, physisch (inkr.) | pgBackRest                  | stündlich                      | an der Kette                 |
| WAL-Segmente                | pgBackRest                  | laufend, spätestens alle 300 s | so weit die Kette reicht     |
| Datenbank, logisch          | `pg_dump`                   | täglich                        | 7                            |
| Rollen und Rechte           | `pg_dumpall --globals-only` | täglich                        | 7                            |
| Uploads                     | Restic                      | stündlich                      | 24 h / 14 d / 8 w / 12 m     |
| Konfigurationsstand         | Restic                      | täglich                        | 30                           |
| Releasestand                | Restic                      | pro Deployment                 | 30                           |
| Versiegeltes Paket          | age + Restic                | täglich                        | 12                           |

Der logische Dump ist Absicht und keine Doppelspurigkeit: er ist der zweite,
unabhängige Weg. Ein physisches Backup setzt dieselbe PostgreSQL-Hauptversion
voraus und ist auf Dateiebene verwundbar; ein logischer Dump lässt sich in eine
frische, auch neuere Installation einspielen. Der eine Weg fällt anders aus als
der andere — das ist der Zweck.

---

## 4. 3-2-1-1-0

| Regel               | Umsetzung                                              | Zustand                        |
| ------------------- | ------------------------------------------------------ | ------------------------------ |
| **3** Kopien        | Produktion, lokales Repository, auswärtiges Repository | die dritte hängt an S3         |
| **2** Medien        | Server-Platte, Objektspeicher                          | dito                           |
| **1** auswärts      | S3-kompatibler Speicher                                | **muss bereitgestellt werden** |
| **1** unveränderbar | S3 Object Lock, Compliance-Modus                       | dito                           |
| **0** Fehler        | `swisshub-backup-verify` und `swisshub-restore-test`   | eingerichtet, läuft            |

Die letzten drei Zeilen hängen an einem Objektspeicher, der **nicht** als
vorhanden angenommen wird. Ohne ihn läuft die Anlage — und sichert dann gegen
Datenbankschäden, aber nicht gegen den Verlust des Servers. Das Dashboard sagt
das ausdrücklich, und die Recovery-CLI warnt bei jedem Zugriff auf die lokale
Kopie. Was der Betreiber bereitstellen muss, steht in
[DISASTER-RECOVERY.md](DISASTER-RECOVERY.md#was-der-betreiber-bereitstellen-muss).

### Unveränderbarkeit ist eine Rechtefrage

Object Lock im Compliance-Modus heisst: ein Objekt lässt sich vor Ablauf seiner
Schutzfrist von niemandem löschen, auch nicht vom Kontoinhaber. Das wirkt nur,
wenn der produktive Server das Recht dazu nicht hat. Darum zwei getrennte
Zugangsdatenpaare:

- **schreibend** — auf dem Server, darf `PutObject`, nicht `DeleteObject`,
  nicht `PutLifecycleConfiguration`, nicht `PutObjectRetention` mit kürzerer
  Frist.
- **lesend** — nicht auf dem Server, sondern im Passwortmanager, für die
  Wiederherstellung.

Deshalb bleiben `SWISSHUB_S3_RESTORE_*` in der Konfiguration auf dem
Produktionsserver absichtlich leer. Ein Angreifer, der den Server übernimmt,
findet dort keine Zugangsdaten, mit denen er die Sicherungen löschen könnte.
Die fertigen Richtlinien stehen in
[`deploy/backup/vorlagen/s3-richtlinien.md`](../deploy/backup/vorlagen/s3-richtlinien.md).

---

## 5. Point-in-Time-Recovery — was es wirklich ist

Ein physischer Restore stellt **den ganzen Cluster** auf einen Zeitpunkt
zurück. Nicht eine Tabelle, nicht eine Zeile, nicht ein Modul: alles, was in
dieser PostgreSQL-Instanz liegt, gemeinsam.

Wer um 14:30 einen Zeitpunkt von 14:00 wählt, verliert **jede** Änderung
zwischen 14:00 und 14:30 — in allen Tabellen, auch denen, die nichts mit dem
Problem zu tun hatten. Bei SwissHub sind das unter anderem neue Tickets,
Moderationseinträge, XP-Stände und der Audit-Log.

Wer eine einzelne gelöschte Zeile zurückholen will, darf das deshalb **nicht**
mit einem PITR auf der Produktion tun. Der Weg dafür steht in
[DISASTER-RECOVERY.md](DISASTER-RECOVERY.md#einen-einzelnen-datensatz-zurückholen):
Wiederherstellung in eine **isolierte** Instanz, gezielt auslesen, in der
Produktion einfügen. Die Recovery-CLI macht diesen Unterschied sichtbar und
bietet für die Produktion gar keinen Weg, der anders aussieht.

---

## 6. Der Schlüssel und das Henne-Ei-Problem

`MASTER_ENCRYPTION_KEY` verschlüsselt die Integrations-Zugangsdaten in der
Datenbank (AES-256-GCM, Umschlagformat `v1.<keyId>.<iv>.<tag>.<ciphertext>`).
Ohne ihn ist eine wiederhergestellte Datenbank unvollständig: die Zeilen sind
da, ihr Inhalt ist verloren.

Also muss der Schlüssel mitgesichert werden. Läge er verschlüsselt **im**
Backup, wäre das Backup von einem Schlüssel abhängig, der nur darin liegt —
und damit wertlos. Läge er unverschlüsselt daneben, wäre die Verschlüsselung
sinnlos.

Der Ausweg ist Asymmetrie. `swisshub-secrets-seal` legt ein Paket an und
verschlüsselt es mit `age` auf einen **öffentlichen** Empfängerschlüssel. Der
Server besitzt nur diesen öffentlichen Teil: er kann das Paket schreiben und
**nicht wieder öffnen**. Der private Schlüssel liegt nicht auf dem Server,
sondern im Passwortmanager und auf einem Medium im Safe.

Das Paket enthält `MASTER_ENCRYPTION_KEY`, `AUTH_SECRET`, die Datenbank- und
Repository-Passwörter, die Konfiguration, den Releasestand, Fingerabdrücke und
eine Anleitung. Es wird gebaut, ohne dass der Klartext je auf die Platte kommt
(`tar | age --encrypt`).

Damit gilt: wer den Server übernimmt, bekommt die laufenden Geheimnisse — aber
er kann die Pakete früherer Tage nicht öffnen, und er kann die unveränderbaren
Sicherungen nicht löschen.

### Was ein Administrator sieht

Im Dashboard steht, **ob** die benötigten Schlüssel gesichert sind, und nie
ihr Wert. Kein Secret erscheint im Klartext, kein Master Key in einem
GitHub-Actions-Protokoll, kein Recovery-Schlüssel im Repository. Sichtbar sind
Kennungen (die ersten acht Hex-Zeichen eines SHA-256 über den Schlüssel), das
Alter des Pakets und die Anzahl der Empfänger. Eine Kennung sagt, ob der
Schlüssel in der Datenbank derselbe ist wie der gesicherte — und verrät ihn
nicht.

Auch die Protokolle sind darauf ausgelegt: `verdecke()` ersetzt jeden bekannten
Geheimniswert durch seinen Namen, bevor eine Zeile geschrieben wird.

---

## 7. Aufbewahrung, die nicht die letzte Kette löscht

Retention ist die Stelle, an der ein Backup-System Daten vernichtet. Darum
gelten drei Regeln, und alle drei sind im Code durchgesetzt:

1. **Erst prüfen, dann löschen.** `swisshub-backup aufraeumen` löscht nichts,
   solange nicht mehr als ein Wiederherstellungspunkt existiert und
   `restic check` fehlerfrei durchläuft.
2. **Nie die letzte Kette.** `repo-retention-archive-type=full` hält die
   WAL-Segmente so lange, wie das zugehörige Vollbackup lebt. Eine Kette wird
   nicht in der Mitte gekappt.
3. **Auswärts löscht der Server nicht.** Im auswärtigen Repository räumt die
   Aufbewahrungsregel des Objektspeichers auf, nicht dieses Skript. Der Server
   hat das Recht dazu nicht.

---

## 8. Verifikation — sechs Stufen

Ein Backup, das nie zurückgespielt wurde, ist eine Annahme.

| Stufe | Was geprüft wird                                                    | Wann        | Werkzeug                 |
| ----- | ------------------------------------------------------------------- | ----------- | ------------------------ |
| 1     | Existenz und Alter der Sicherungen                                  | stündlich   | `swisshub-backup-verify` |
| 2     | Prüfsummen im Repository (`pgbackrest verify`, `restic check`)      | täglich     | dito                     |
| 3     | Unveränderbarkeit: ein Löschversuch **muss** scheitern              | täglich     | dito                     |
| 4     | WAL-Kette lückenlos                                                 | täglich     | dito                     |
| 5     | Restore in eine isolierte Instanz, Cluster startet                  | wöchentlich | `swisshub-restore-test`  |
| 6     | Inhaltliche Prüfung: Tabellen, Migrationsstand, Entschlüsselbarkeit | wöchentlich | dito                     |

Stufe 3 ist ein Gegenbeweis: das Skript versucht, ein geschütztes Objekt zu
löschen, und wertet **Erfolg als Fehler**. Eine Unveränderbarkeit, die man
nicht gegen sich selbst getestet hat, ist eine Vermutung über eine
Bucket-Einstellung.

Die WAL-Kette in Stufe 4 wird nach `database.id` gruppiert, nicht nach
Zeitlinie. Nach einem PITR beginnt eine neue Zeitlinie; wer danach Segmente
über Zeitlinien hinweg zählt, meldet eine gebrochene Kette, die intakt ist.

### Restore-Tests laufen nie auf der Produktion

`swisshub-restore-test` arbeitet in einem eigenen Verzeichnis, auf einem eigenen
Port, mit `--network none`, `archive_mode = off` und ohne jede Anwendung. Das
Aufräumen hängt an einem `trap` und läuft auch bei Abbruch.

`archive_mode = off` ist keine Kosmetik: eine Testinstanz, die archiviert,
schreibt in das Repository der Produktion.

**Kein produktiver Discord-Bot startet in einer Testumgebung.** Ein Bot mit
echtem Token wirkt nach aussen — er schreibt in echte Kanäle, vergibt echte
Rollen, verschickt echte Nachrichten. Zwei gleichzeitig laufende Instanzen
desselben Bots richten auf Discord Schaden an, den kein Backup zurücknimmt.
Die Testumgebung startet deshalb nur PostgreSQL, und die Recovery-CLI startet
Bot und Musik-Laufzeit erst auf einen ausdrücklichen, getippten Befehl
(`swisshub-recovery freigeben`), nach bestandener Validierung.

---

## 9. Das Dashboard darf nicht alles

Die WebApp bekommt **kein** Root. Sie führt keine Shell-Befehle aus, und sie
kann keine produktive Wiederherstellung auslösen — diese Operation existiert
im Dashboard gar nicht.

Der Weg geht über ein Spool-Verzeichnis:

```
WebApp  ──schreibt JSON──▶  /var/lib/swisshub-backup/spool/<id>.json
                                      │
                            swisshub-backup-controller (privilegiert, Python)
                                      │  prüft gegen eine feste Liste
                                      ▼
                            swisshub-backup <fester Unterbefehl>
```

Der Controller kennt eine geschlossene Liste erlaubter Operationen mit **fest
verdrahteten Argumentlisten**. Aus der Anfrage übernimmt er einen einzigen
Wert, den Zeitpunkt, und auch den nur nach Prüfung gegen einen regulären
Ausdruck. Die Kennung kommt aus dem Dateinamen, nicht aus dem Inhalt.
Ausgeführt wird ohne Shell (`shell=False`), mit einer Umgebung, die nur um
`SWISSHUB_CONFIG_FILE` ergänzt ist.

Eine Anfrage, die eine unbekannte Operation nennt, wird abgewiesen und
protokolliert. Es gibt keinen Weg, einen beliebigen Befehl einzuschmuggeln,
weil kein Wert aus der Anfrage jemals zu einem Befehl wird.

### Rechte

Sieben Berechtigungen in der bestehenden Permission Engine:

| Berechtigung             | Erlaubt                               |
| ------------------------ | ------------------------------------- |
| `backup.view`            | Zustand ansehen                       |
| `backup.run`             | Eine Sicherung auslösen               |
| `backup.settings`        | Einstellungen ändern                  |
| `backup.points`          | Wiederherstellungspunkte ansehen      |
| `backup.test`            | Einen Restore-Test auslösen           |
| `backup.restore.request` | Eine Wiederherstellung **beantragen** |
| `backup.restore.approve` | Einen Antrag **freigeben**            |

Eine Berechtigung «Wiederherstellung ausführen» gibt es nicht, und das ist der
Punkt.

### Vier Augen

Die Permission Engine kann ausdrücken, wer etwas darf. Sie kann nicht
ausdrücken, dass **zwei verschiedene Personen** zustimmen müssen. Dafür gibt es
das Modell `RestoreFreigabe`: ein Antrag wird gestellt, eine zweite Person gibt
frei, und `gebeRestoreFrei` weist es ab, wenn Antragsteller und Freigeber
dieselbe Person sind. Beides landet im Audit-Log.

---

## 10. Das CI/CD-Netz

Vor einer Migration, die Daten wegnehmen kann, muss ein Wiederherstellungspunkt
existieren. `scripts/migrationen-pruefen.ts` klassifiziert die neu
hinzugekommenen Migrationen:

- `DROP TABLE`, `DROP COLUMN`, `DROP INDEX` (kann eine Eindeutigkeit entfernen),
  `TRUNCATE`, `ALTER COLUMN ... TYPE`, `^UPDATE`, `^DELETE`,
  `INSERT ... SELECT`, `ADD COLUMN ... NOT NULL` ohne `DEFAULT` → **kritisch**
- reines `CREATE TABLE`, `ADD COLUMN` mit Vorgabe, neuer Index → unkritisch
- **unbekannt → wie kritisch behandelt**

Nur bei einer kritischen Migration erzwingt der Workflow einen
Wiederherstellungspunkt (`sudo -n swisshub-backup vor-deployment`). Ein reines
Frontend-Deployment tut das nicht — ein Zwang, der jedes Mal greift, wird
abgeschaltet, und dann greift er nie.

`vor-deployment` prüft Alter der WAL-Archivierung und des Basis-Backups, setzt
dann `pg_create_restore_point('vor_deploy_<stamp>')` und legt ein
differentielles Backup sowie eine Dateisicherung an. Scheitert es, wird
**nicht** ausgerollt. Der Ausweg heisst
`SWISSHUB_DEPLOY_OHNE_NETZ=ich-weiss-was-ich-tue` — kein Schalter, den man
versehentlich setzt.

**Ein Git-Rollback stellt kein altes Datenbankschema wieder her.** Wer eine
Migration zurücknehmen will, braucht den Wiederherstellungspunkt; der alte Code
allein läuft auf dem neuen Schema nicht.

---

## 11. Alarmierung

Ein Alarm über den eigenen Discord-Bot meldet keinen Ausfall des eigenen
Discord-Bots. Darum drei Wege, absichtlich verschieden:

1. **Discord-Webhook** — unabhängig vom Bot-Prozess, nur von Discord abhängig.
2. **SMTP** — unabhängig von Discord.
3. **Dead-man's switch** — der Server ruft regelmässig eine externe URL. Bleibt
   der Ruf aus, alarmiert der externe Dienst.

Der dritte ist der einzige, der einen **Totalverlust** des Servers meldet. Die
ersten beiden setzen voraus, dass noch etwas läuft, das alarmieren kann.

---

## 12. Bedienung

```bash
# Zustand
swisshub-backup status
swisshub-backup punkte

# Sichern
swisshub-backup db-voll | db-diff | db-inkrementell | db-logisch
swisshub-backup dateien | konfiguration | geheimnisse | extern

# Prüfen
swisshub-backup-verify              # Stufen 1-4
swisshub-restore-test               # Stufen 5-6
swisshub-backup-selbsttest          # Wegwerf-Cluster, 41 Prüfungen

# Aufräumen (löscht nur bei geprüftem Ersatz)
swisshub-backup aufraeumen
```

Wiederherstellen: siehe [DISASTER-RECOVERY.md](DISASTER-RECOVERY.md).

---

## 13. Was diese Anlage nicht leistet

Damit niemand mehr erwartet, als da ist:

- **Sie macht SwissHub nicht hochverfügbar.** Ein Ausfall bedeutet Ausfallzeit.
  Was Hochverfügbarkeit kosten würde, steht in
  [VERFUEGBARKEIT.md](VERFUEGBARKEIT.md).
- **Sie sichert keine anderen SwissHub-Dienste.** SwissHubGG und
  SwissHubSponsoring haben eigene Datenbanken und eigene Volumes. Diese Anlage
  greift nicht auf sie zu, weil weder Zugriff noch Zuständigkeit geklärt sind.
  Siehe [BESTANDSAUFNAHME.md](BESTANDSAUFNAHME.md).
- **Sie ersetzt keine Übung.** Der Ablauf ist zweimal auf einer
  Wegwerf-Installation durchgespielt worden, nicht auf der Produktion. Bis das
  einmal dort geschehen ist, ist der produktive RTO eine Schätzung.
- **Sie funktioniert nicht ohne den privaten Schlüssel.** Wer ihn verliert,
  verliert die Geheimnisse. Das Backup der Datenbank bleibt lesbar, die
  verschlüsselten Zugangsdaten darin nicht.
