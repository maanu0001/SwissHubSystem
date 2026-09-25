# Abschlussbericht — Backup, Disaster Recovery und Ausfallsicherheit

Stand: 25. September 2026 · Commit `47178cf` · Branch
`claude/swisshub-bot-webapp-rmljzl`

Jeder Punkt ist einer von vier Kategorien zugeordnet:

| Kürzel              | Bedeutung                                                         |
| ------------------- | ----------------------------------------------------------------- |
| **[GETESTET]**      | Vollständig implementiert und getestet                            |
| **[UNVERIFIZIERT]** | Implementiert, aber noch nicht produktiv verifiziert              |
| **[EXTERN]**        | Abhängig von externer Infrastruktur, die nicht bereitgestellt ist |
| **[OFFEN]**         | Noch nicht implementiert                                          |

Gemessene Werte stammen aus einer Katastrophenübung auf einer
**Wegwerf-Installation**, nicht aus der Produktion. Wo eine Zahl steht, steht
dabei, wo sie gemessen wurde.

---

## 1. Vollständige Infrastruktur-Bestandsaufnahme — [GETESTET]

Erhoben mit `scripts/bestandsaufnahme.sh` (nur lesend; gibt von
`.env`-Variablen ausschliesslich Namen und Längen aus, niemals Werte).
Ergebnis in [BESTANDSAUFNAHME.md](BESTANDSAUFNAHME.md).

Festgestellt:

- **SwissHubSystem** ist kein zweites Projekt, sondern ein zweites Remote
  desselben Repositories — byte-identisch bei Commit `31f1874`.
- **SwissHubGG** (swisshub.gg) und **SwissHubSponsoring**
  (sponsoring.swisshub.gg) sind eigene Dienste mit **eigenen PostgreSQL-16-
  Instanzen und eigenen Volumes**.
- An diesen beiden wurde **nichts verändert**. Weder Zuständigkeit noch Zugriff
  sind geklärt, und ohne beides wird an fremden Projekten nicht gearbeitet.
- Es wurde **keine** Infrastruktur als vorhanden angenommen, die nicht
  nachweisbar da war.

## 2. Festgestellte Backup- und Recovery-Risiken — [GETESTET]

Vorheriger Stand: `deploy/backup.sh`, ein `pg_dump` pro Nacht nach
`/var/backups/swisshub` auf derselben Maschine. Zehn Lücken, tabellarisch in
[BESTANDSAUFNAHME.md](BESTANDSAUFNAHME.md); die schwerwiegendsten:

1. Datenverlust bis zu 24 Stunden, kein Zeitpunkt dazwischen erreichbar.
2. Die Sicherung lag auf der Platte, die sie sichern sollte — kein Schutz gegen
   Serververlust, den häufigsten Ernstfall.
3. Keine Sicherung der Upload-Dateien (Ticket-Transkripte, Bilder).
4. Keine Sicherung des `MASTER_ENCRYPTION_KEY`. Ein Restore hätte eine
   Datenbank ergeben, deren verschlüsselte Integrations-Zugangsdaten unlesbar
   sind.
5. Keine Prüfung, ob ein Dump zurückspielbar ist.
6. Keine Unveränderbarkeit — Ransomware hätte Datenbank und Sicherung gemeinsam
   erreicht.

Zusätzlich zwei **falsche Aussagen** in der Dokumentation, beide korrigiert:

- `docs/DEPLOYMENT.md`: «ein PostgreSQL-Dump genügt als vollständige
  Sicherung» — falsch. Der Satz stimmte für die Frage, ob Zustand nur im
  Arbeitsspeicher liegt, und wurde als Aussage über die Sicherung gelesen.
- `docs/SECURITY.md`: «Datenbank-Backups eingerichtet (`pg_dump` genügt)» —
  ebenso, plus die fehlende Unterscheidung zwischen _eingerichtet_ und
  _geprüft_.

## 3. Implementierte Backup-Architektur — [GETESTET]

Beschrieben in [BACKUP.md](BACKUP.md). Kern: keine eigene Backup-Engine,
sondern etablierte Werkzeuge, darüber Orchestrierung, Prüfung und Meldung.

Neu angelegt: `deploy/backup/` mit `bin/` (7 Werkzeuge), `lib/` (Shell-
Bibliothek und 9 Python-Hilfen), `systemd/` (13 Units), `vorlagen/` und
`install.sh`. `install.sh` **aktiviert nichts** — Timer werden ausdrücklich
eingeschaltet, nicht überraschend.

## 4. Gesicherte Dienste und Datenbanken — [GETESTET] / [OFFEN]

| Gegenstand                                      | Zustand                               |
| ----------------------------------------------- | ------------------------------------- |
| PostgreSQL `swisshub` (physisch, PITR)          | **[GETESTET]**                        |
| PostgreSQL `swisshub` (logisch, täglich)        | **[GETESTET]**                        |
| Rollen und Rechte (`pg_dumpall --globals-only`) | **[GETESTET]**                        |
| Upload-Verzeichnis                              | **[GETESTET]**                        |
| Konfigurations- und Releasestand                | **[GETESTET]**                        |
| Geheimnisse (versiegeltes Paket)                | **[GETESTET]**                        |
| **SwissHubGG-Datenbank**                        | **[OFFEN]** — bewusst nicht angefasst |
| **SwissHubSponsoring-Datenbank**                | **[OFFEN]** — bewusst nicht angefasst |

Die letzten zwei sind keine Auslassung aus Bequemlichkeit, sondern die Folge
der Vorgabe, an fremden Projekten ohne geklärte Zuständigkeit nichts zu ändern.
Nach einem Totalverlust sind diese Dienste **nicht** wiederhergestellt. Das
steht so in
[DISASTER-RECOVERY.md §3.9](DISASTER-RECOVERY.md#39-weitere-swisshub-dienste).

## 5. Verwendete Backup-Technologien — [GETESTET]

pgBackRest 2.50 (physisch, WAL, PITR, AES-256-CBC), Restic 0.16.4 (Dateien,
deduplizierend), age (X25519, asymmetrisches Versiegeln), PostgreSQL 16
(`pg_dump`, `pg_dumpall`). Alle vier sind im Selbsttest und in der Übung
wirklich gelaufen.

## 6. PostgreSQL-PITR-Konfiguration — [GETESTET] (Übung) / [UNVERIFIZIERT] (Produktion)

`wal_level = replica`, `archive_mode = on`, `archive_command` über pgBackRest,
`archive_timeout = 300`.

`archive_timeout` ist die Zeile, an der der RPO hängt: ohne sie wird ein
Segment erst archiviert, wenn es voll ist (16 MB) — auf einem ruhigen Server
kann das Stunden dauern.

In der Übung stand 15 Sekunden, damit sie in Minuten statt Stunden läuft. Die
**produktive** Einstellung von 300 Sekunden ist gesetzt, aber nicht produktiv
gemessen.

**PITR ist nie die Änderung einer einzelnen Tabelle.** Ein physischer Restore
stellt den ganzen Cluster zurück; wer 14:00 wählt, verliert alles bis jetzt, in
allen Tabellen. Die Werkzeuge sagen das an jeder Stelle, und für den Einzelfall
gibt es einen anderen Weg (Punkt 13).

## 7. Datei- und Konfigurationssicherung — [GETESTET]

Restic, stündlich für Uploads, täglich für den Konfigurationsstand, pro
Deployment für den Releasestand. Jeder Upload-Snapshot trägt die Marke der
zugehörigen Datenbank-Sicherung, damit Datenbank und Dateien konsistent
zusammenpassen — `swisshub-backup-verify` Stufe 4 prüft das.

Ein fester Pfad für den Konfigurationsstand statt eines `mktemp`-Pfads, weil
wechselnde Pfade die Deduplizierung von Restic aushebeln.

## 8. Secrets- und Schlüsselverwaltung — [GETESTET]

Das Henne-Ei-Problem ist gelöst, nicht umgangen: `swisshub-secrets-seal`
versiegelt asymmetrisch mit `age`. Der Server kennt nur den **öffentlichen**
Empfängerschlüssel — er kann das Paket schreiben und **nicht öffnen**. Der
private Teil liegt nicht auf einem Server.

Damit ist die Vorgabe erfüllt, dass der `MASTER_ENCRYPTION_KEY` unabhängig von
den mit ihm verschlüsselten Daten wiederherstellbar ist, und dass kein Backup
von einem Schlüssel abhängt, der nur darin liegt.

Nachgewiesen im Selbsttest **mit Gegenproben**: das Paket lässt sich mit dem
richtigen Schlüssel öffnen, mit einem fremden **nicht**, und ein falscher
Hauptschlüssel wird erkannt statt stillschweigend als Erfolg verbucht.

Kein Recovery-Schlüssel im Repository. Kein Master Key in GitHub-Actions-
Protokollen. Keine Secrets im Klartext im Dashboard — sichtbar sind nur
Kennungen (erste acht Hex-Zeichen eines SHA-256), Alter und Empfängerzahl.
`verdecke()` ersetzt in jeder Protokollzeile bekannte Geheimniswerte durch
ihren Namen. Ein Administrator erkennt, **ob** die Schlüssel gesichert sind,
ohne ihre Werte zu sehen.

## 9. Offsite-Backup-Status — [EXTERN]

Implementiert und ungetestet, weil kein Objektspeicher vorhanden ist. Der Code
für das zweite Repository (pgBackRest repo2, Restic S3) ist da, die
Konfiguration dafür ist vorgesehen, die Richtlinien sind geschrieben
([`s3-richtlinien.md`](../deploy/backup/vorlagen/s3-richtlinien.md)).

`swisshub-backup-verify` **Stufe 3 schlägt heute fehl** — richtig so:

> Es ist kein externes Ziel konfiguriert. Alle Kopien liegen auf dem Server,
> der gesichert wird. Gegen seinen Verlust — den häufigsten Ernstfall —
> schützt das nicht.

Es wird kein Objektspeicher, keine Zugangsdaten, keine Kosten und kein
zusätzlicher Server als vorhanden angenommen.

## 10. Immutable-Backup-Status — [EXTERN]

S3 Object Lock im Compliance-Modus, mit **zwei getrennten Zugangsdatenpaaren**:
schreibend auf dem Server (ohne `DeleteObject`, ohne
`PutLifecycleConfiguration`), lesend nur im Passwortmanager. Deshalb bleiben
`SWISSHUB_S3_RESTORE_*` auf dem Produktionsserver absichtlich leer.

Damit hat der produktive Server **keine Berechtigung**, bestehende
unveränderbare Sicherungen vor Ablauf ihrer Schutzfrist zu löschen.

Der Nachweis ist als Gegenbeweis gebaut: Stufe 3 **versucht zu löschen** und
wertet Erfolg als Fehler. Ausgeführt werden kann er erst mit einem echten
Bucket.

## 11. Backup-Intervalle und Retention — [GETESTET]

Intervalle und Aufbewahrung: Tabelle in [BACKUP.md §3](BACKUP.md).

Drei Schutzregeln, alle im Code durchgesetzt und im Selbsttest belegt:

1. `swisshub-backup aufraeumen` löscht **nichts**, solange nicht mehr als ein
   Wiederherstellungspunkt existiert **und** `restic check` fehlerfrei
   durchläuft.
2. `repo-retention-archive-type=full` hält WAL-Segmente so lange wie das
   zugehörige Vollbackup. Eine Kette wird nicht in der Mitte gekappt — die
   einzige noch wiederherstellbare Kette kann durch Retention nicht verloren
   gehen.
3. Im auswärtigen Repository löscht der Server nicht.

## 12. Recovery Center und Dashboard — [GETESTET] (Code) / [UNVERIFIZIERT] (Betrieb)

Modul **SYSTEM → BACKUP & RECOVERY**, sechs Abschnitte, dunkles Thema,
SwissHub-Branding, im bestehenden `registerModule`-Register.

Das Dashboard hat **kein Root**. Es führt keine Shell-Befehle aus. Der Weg geht
über ein Spool-Verzeichnis: die WebApp legt eine JSON-Anforderung ab, ein
privilegierter Python-Controller prüft sie gegen eine **geschlossene Liste** von
Operationen mit **fest verdrahteten Argumentlisten**, übernimmt aus der
Anforderung genau einen Wert (den Zeitpunkt, regulär geprüft), nimmt die
Kennung aus dem Dateinamen und führt ohne Shell aus (`shell=False`).

Es gibt im Dashboard **keine Operation für eine produktive Wiederherstellung**.

Sieben Berechtigungen in der bestehenden Permission Engine, darunter
`backup.restore.request` und `backup.restore.approve` — und bewusst **kein**
`backup.restore.execute`.

Vier-Augen: Die Permission Engine kann ausdrücken, wer etwas darf, aber nicht,
dass **zwei verschiedene Personen** zustimmen. Dafür `RestoreFreigabe`;
`gebeRestoreFrei` weist ab, wenn Antragsteller und Freigeber dieselbe Person
sind. Beides im bestehenden Audit-Log.

Das Dashboard zeigt die **gemessenen** Werte. Ohne Test steht dort «nicht
gemessen» und keine Zahl.

**Noch nicht produktiv verifiziert**: Der Controller und die Oberfläche sind
unit- und integrationsgetestet, aber im Zusammenspiel mit der produktiven
Permission Engine und echten Benutzern noch nicht gelaufen.

## 13. Eigenständiges Disaster-Recovery-Tool — [GETESTET]

`swisshub-recovery`, rund 1600 Zeilen. Braucht **nichts** von SwissHub: kein
Node, kein Prisma, keine WebApp, keine Datenbank, kein Netz zum alten Server.
Nur `bash`, `pgbackrest`, `restic`, `age`, `python3`, `tar`.

Das System hängt nicht allein an GitHub: Releasestand im Paket,
Konfigurationsstand im Restic-Repository.

**Doppelte Bots verhindert**: `freigeben` ist ein eigener, letzter Schritt und
verlangt ein getipptes Wort. Der Runbook-Schritt davor verlangt, den alten Bot
stillzulegen oder den Token neu zu erzeugen.

**Einen einzelnen Datensatz zurückholen ohne späteren Verlust** — implementiert
und im Selbsttest belegt: Wiederherstellung in eine **isolierte** Instanz
(`swisshub-restore-test --behalten`), gezielt auslesen, in der Produktion
einfügen. Kein Weg, der auf der Produktion so aussieht wie ein PITR.

## 14. CI/CD-Integration — [UNVERIFIZIERT]

`.github/workflows/deploy.yml`: `scripts/migrationen-pruefen.ts` klassifiziert
neu hinzugekommene Migrationen; **Unbekanntes gilt als kritisch**. Nur bei einer
kritischen Migration wird ein Wiederherstellungspunkt erzwungen
(`sudo -n swisshub-backup vor-deployment`, über eine enge sudoers-Regel, mit
`visudo -c` geprüft). Scheitert das, wird nicht ausgerollt.

**Kein Backup pro reinem Frontend-Deployment.** Ein Zwang, der jedes Mal
greift, wird abgeschaltet — und dann greift er nie.

Ausweg: `SWISSHUB_DEPLOY_OHNE_NETZ=ich-weiss-was-ich-tue`. Kein Schalter, den
man versehentlich setzt.

Dokumentiert, dass ein Git-Rollback kein altes Datenbankschema wiederherstellt.

**Nicht produktiv verifiziert**: Der Workflow ist nicht mit dieser Änderung
durch GitHub Actions gelaufen. Die Klassifizierung ist mit 41 Unit-Tests
abgedeckt, das Zusammenspiel mit dem echten Runner und dem echten `sudo` nicht.

## 15. Monitoring und Alarmierung — [GETESTET] (Code) / [EXTERN] (Ziele)

Drei absichtlich verschiedene Wege: Discord-**Webhook** (unabhängig vom
Bot-Prozess), **SMTP** (unabhängig von Discord), **Dead-man's switch** (der
einzige, der einen Totalverlust melden kann).

Damit ist die Vorgabe erfüllt, dass Alarme nicht ausschliesslich über den
eigenen Discord-Bot laufen.

Der Code ist gelaufen (die Übung hat einen echten Alarm ausgelöst: _«kritisch
verify: Die Prüfung der Sicherungen hat 1 Fehler gefunden»_). Webhook-URL,
SMTP-Konto und Heartbeat-URL sind **nicht bereitgestellt**.

## 16. Sicherheitsmassnahmen — [GETESTET]

Alle Vorgaben aus §22 sind eingehalten:

| Vorgabe                                                   | Umsetzung                                                                                                |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Keine ungesicherten Änderungen an produktiven Datenbanken | Es wurde keine produktive Datenbank angefasst. Alles lief auf einer Wegwerf-Installation                 |
| Keine produktiven Restores ohne ausdrückliche Bestätigung | Getipptes Wort `WIEDERHERSTELLEN`, kein `[j/N]`, **kein** Schalter zum Abschalten (durch Test erzwungen) |
| Keine Löschung von Backups ohne geprüften Ersatz          | `aufraeumen` prüft Anzahl und `restic check` zuerst                                                      |
| Keine Offenlegung von Secrets                             | `verdecke()`, Kennungen statt Werte, keine Ausgabe in CI                                                 |
| Keine ungetesteten Failover-Mechanismen                   | Keines eingerichtet — [VERFUEGBARKEIT.md](VERFUEGBARKEIT.md) sagt warum                                  |
| Keine produktiven Bots in Testumgebungen                  | Testumgebung startet nur PostgreSQL, `--network none`, keine Anwendung                                   |
| Keine neuen Root-Zugriffe für die WebApp                  | Spool plus Operationsliste, `shell=False`                                                                |
| Keine Änderungen an anderen SwissHub-Projekten            | Keine                                                                                                    |
| Keine angenommene externe Infrastruktur                   | Stufe 3 schlägt fehl, statt Erfolg zu behaupten                                                          |

Dazu: systemd-Härtung (`ProtectSystem=strict`, enge `ReadWritePaths`,
`IOWeight`), Verzeichnisse mit setgid 2770, `pgbackrest.conf` 0640 und der
Gruppe des ausführenden Benutzers.

Audit: das bestehende System mit Hash-Kette, ohne täglichen Spam. Keine Tokens,
Schlüssel oder unverschlüsselten Zugangsdaten in Protokollen.

## 17. Durchgeführte Restore-Tests — [GETESTET]

| Test                                           | Ergebnis                                            |
| ---------------------------------------------- | --------------------------------------------------- |
| `swisshub-backup-selbsttest` (Wegwerf-Cluster) | **41 Prüfungen bestanden**, davon **4 Gegenproben** |
| `swisshub-backup-verify` Stufen 1, 2, 4        | bestanden                                           |
| `swisshub-backup-verify` Stufe 3               | **fehlgeschlagen — richtig**, kein externes Ziel    |
| Katastrophenübung, Durchgang 1                 | Datenbank wiederhergestellt, 3 Fehler aufgedeckt    |
| Katastrophenübung, Durchgang 2                 | vollständig bestanden nach den Korrekturen          |

Die vier Gegenproben sind der Punkt: dass Daten **nach** dem Zielzeitpunkt
fehlen (der Zeitpunkt wurde getroffen, nicht bloss die Quelle abgefragt), dass
ein falscher Hauptschlüssel erkannt wird, dass ein fremder `age`-Schlüssel das
Paket **nicht** öffnet, und dass im verschlüsselten Repository kein Klartext
auffindbar ist.

**Keine fiktiven Restore-Tests werden als erfolgreich angezeigt.** Die Übung
hat genau das gezeigt: fünf Fehler, die durch 4101 Unit-Tests durchgekommen
waren, weil sie alle dieselbe Form haben — das Werkzeug endet mit einem Fehler
und einer Meldung, die in die falsche Richtung zeigt. Für jeden gibt es jetzt
einen Regressionstest.

## 18. Gemessenes RPO — [GETESTET] (Übung) / [UNVERIFIZIERT] (Produktion)

**Gemessen in der Übung:** Alle Zeilen bis zum letzten archivierten
WAL-Segment waren nach dem Totalverlust zurück. Die absichtlich **nicht**
archivierte Änderung (7 Zeilen, zwei Sekunden vor dem `kill -9`) war weg.

Das ist der RPO, sichtbar gemacht: verloren geht, was im offenen WAL-Segment
steht. Bei `archive_timeout = 300` ist das im schlechtesten Fall **fünf
Minuten**.

Die Übung lief mit `archive_timeout = 15`. Der produktive Wert ist 300 und
gesetzt, aber dort nicht gemessen. Das Dashboard zeigt das Alter des jüngsten
archivierten Segments als laufend gemessenen RPO.

**Das Ziel von ~5 Minuten ist realistisch** — es folgt direkt aus
`archive_timeout` und nicht aus einer Hoffnung. Es ist ein Zielwert und keine
Zusicherung.

## 19. Gemessenes RTO — [GETESTET] (Übung) / [UNVERIFIZIERT] (Produktion)

**Gemessen in der Übung** (PostgreSQL 16, ~20 MB, 20 Tabellen, 3 Upload-
Dateien, dieselbe Maschine, lokales Repository):

| Schritt                                | Zeit      |
| -------------------------------------- | --------- |
| Paket öffnen, Konfiguration einspielen | 1 s       |
| Datenbank physisch wiederherstellen    | 126 s     |
| Uploads wiederherstellen               | 2 s       |
| **Gesamt, ohne Aufsetzen des Servers** | **177 s** |

**Diese 177 Sekunden sind nicht der produktive RTO** und werden nicht als
solcher dargestellt. Die produktive Datenbank ist grösser, das Repository liegt
teils auswärts, und das Aufsetzen eines neuen Servers ist nicht mitgemessen —
es ist der längere Teil.

Das Ziel von ≤ 2 Stunden ist **plausibel und nicht nachgewiesen**. Nachgewiesen
ist, dass der Ablauf funktioniert und wo die Zeit hingeht.

## 20. Ergebnisse sämtlicher Quality Gates — [GETESTET]

```
npm run check
  prettier --check    ✓
  eslint              ✓
  tsc --noEmit        ✓
  vitest              ✓  4101 bestanden, 1560 übersprungen (235 Dateien)

npm run build         ✓  exit 0 (Next.js + Bot-Typecheck)
```

Die 1560 übersprungenen Tests verlangen Umgebungsvariablen, die in dieser
Umgebung nicht gesetzt sind (`DEV_MOCK_DISCORD` und weitere). Sie waren vor
diesen Änderungen ebenso übersprungen.

Neu hinzugekommen: 232 Tests in 7 Dateien —
`backup-geheimnis-pruefung` (9), `backup-migrationen-bewertung` (41),
`backup-controller-sicherheit` (35), `backup-darstellung` (39),
`backup-anlage` (90, davon 12 Regressionstests aus der Übung),
`backup-wal-kette` (16), `backup-freigabe` (15, Integration).

**Für destruktive Tests wurden keine produktiven Daten verwendet.** Alles lief
auf Wegwerf-Clustern mit erzeugten Daten.

## 21. Commit Hash — [GETESTET]

`47178cfb066cee3d3f5b58f00d756bb1e59f0934` (`47178cf`) auf
`claude/swisshub-bot-webapp-rmljzl`, gepusht.

Sechs Commits:

| Commit    | Inhalt                                              |
| --------- | --------------------------------------------------- |
| `f0b4ad1` | Bestandsaufnahme, Backup-Engine, PITR, Recovery-CLI |
| `029fb4f` | Neun Fehler, die nur ein echter Lauf findet         |
| `fd3c188` | Spool und Controller — die WebApp führt nichts aus  |
| `474f317` | Dashboard, Berechtigungen, Vier-Augen, Audit        |
| `9b8dd9c` | CI/CD-Netz und unabhängige Alarmierung              |
| `47178cf` | Katastrophenübung, fünf Fehler, Dokumentation       |

## 22. Deployment-Status — [OFFEN]

**Nicht ausgerollt.** Die Änderungen liegen auf dem Feature-Branch. Es wurde
kein Pull Request geöffnet und nichts auf die Produktion gebracht — beides war
nicht verlangt.

Was für die Inbetriebnahme nötig ist, steht in
[DEPLOYMENT.md](DEPLOYMENT.md#backups): `install.sh`, Konfiguration ausfüllen,
`swisshub-backup einrichten`, Timer einschalten.

## 23. Production-Smoke-Test — [OFFEN]

**Nicht durchgeführt**, weil nicht ausgerollt. Kein produktiver Server wurde
angefasst.

Was nach dem Ausrollen zu prüfen ist:
`swisshub-backup status`, `swisshub-backup-verify` (Stufe 3 wird fehlschlagen,
solange kein Objektspeicher da ist), ein `swisshub-restore-test`, und das
Dashboard unter System → Backup & Recovery.

## 24. Vollständiger Disaster-Recovery-Test — [GETESTET] (Wegwerf) / [OFFEN] (Produktion)

Zweimal vollständig durchgeführt auf einer Wegwerf-Installation. Zerstört:
Datenverzeichnis, Upload-Verzeichnis, Projektverzeichnis samt `.env`,
`/etc/swisshub-backup` — mit `kill -9`, ohne sauberes Herunterfahren. Übrig:
nur der Backup-Speicher und der private `age`-Schlüssel.

Ergebnis Durchgang 2:

| Prüfung                                             | Ergebnis                                  |
| --------------------------------------------------- | ----------------------------------------- |
| Audit-Log-Zeilen                                    | 40 → 40                                   |
| Datenzeilen                                         | alle bis zum letzten archivierten Segment |
| Tabellen                                            | 20 → 20                                   |
| Upload-Dateien                                      | 3 → 3, **Sammel-MD5 identisch**           |
| Verschlüsselter Umschlag                            | **byteweise identisch** (103 Zeichen)     |
| Entschlüsselbarkeit mit dem Schlüssel aus dem Paket | ja (Kennung `c8c93ce7`)                   |
| Nicht archivierte Änderung                          | verloren — **erwartet**, das ist der RPO  |

Durchgang 1 hat fünf Fehler aufgedeckt; alle sind behoben und mit
Regressionstests versehen. Der lehrreichste: `restic_repo_pfad` setzte das
Repository-Passwort und wurde in einer Befehlssubstitution aufgerufen — in der
Subshell ist jedes `export` beim Zurückkommen weg, also war das Passwort nie
gesetzt, wenn es gebraucht wurde, und die Meldung lautete nur «restic restore
ist gescheitert».

**Auf der Produktion ist dieser Test nicht gelaufen.** Bis dahin ist der
produktive RTO eine Schätzung.

## 25. Laufende Kosten und Ressourcenbedarf — [EXTERN]

Kosten werden **nicht** als vorhanden angenommen und hier nicht geschätzt, weil
jede Zahl vom Anbieter und vom Datenvolumen abhängt. Was anfällt:

| Posten                                  | Bedarf                                                                             |
| --------------------------------------- | ---------------------------------------------------------------------------------- |
| Objektspeicher                          | Volumen der Vollbackups × Aufbewahrung plus WAL-Segmente                           |
| Transfer                                | Auslastung beim Hochladen; `SWISSHUB_UPLOAD_LIMIT_KIB` begrenzt sie                |
| Lokaler Plattenplatz                    | `swisshub-backup status` zeigt eine Prognose; `SWISSHUB_MIN_FREE_GB` bremst vorher |
| CPU und E/A auf dem Server              | durch `IOWeight` und `Nice` in den systemd-Units gedämpft                          |
| Heartbeat-Dienst                        | oft kostenlos                                                                      |
| SMTP                                    | oft vorhanden                                                                      |
| Testsystem für den produktiven Nachweis | zeitweise, muss nicht dauerhaft laufen                                             |

Ein zweiter Server für eine Verfügbarkeitsstufe ist **nicht** eingeplant —
siehe [VERFUEGBARKEIT.md](VERFUEGBARKEIT.md).

## 26. Benötigte externe Zugangsdaten oder Infrastruktur — [EXTERN]

Vollständige Liste in
[DISASTER-RECOVERY.md §10](DISASTER-RECOVERY.md#10-was-der-betreiber-bereitstellen-muss).
Kurz:

1. **S3-kompatibler Objektspeicher** mit Object Lock (Compliance-Modus) —
   ohne ihn kein Schutz gegen Serververlust und gegen Ransomware.
2. **Zwei getrennte Zugangsdatenpaare**, schreibend und lesend.
3. **Ein `age`-Schlüsselpaar**, privater Teil offline und **mehrfach** verwahrt.
4. **Eine Heartbeat-URL** — der einzige Weg, der einen Totalverlust meldet.
5. **Ein Discord-Webhook** und **ein SMTP-Konto**.
6. **Ein Testsystem** für den produktiven Restore-Nachweis.

Punkt 3 ist der, dessen Verlust am teuersten ist und der nichts kostet.

## 27. Noch offene Risiken

| Risiko                                            | Kategorie       | Wirkung                                                                                                                             |
| ------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Kein auswärtiger Speicher**                     | [EXTERN]        | Alle Kopien auf dem Server, der gesichert wird. Der häufigste Ernstfall ist nicht abgedeckt. **Das grösste offene Risiko.**         |
| **Keine Unveränderbarkeit**                       | [EXTERN]        | Ransomware erreicht Datenbank und Sicherung gemeinsam                                                                               |
| **Restore nie auf der Produktion geprüft**        | [OFFEN]         | Der produktive RTO ist geschätzt. Produktionsgrösse, Bandbreite und Aufsetzzeit sind unbekannt                                      |
| **Andere SwissHub-Dienste ungesichert**           | [OFFEN]         | Nach einem Totalverlust sind swisshub.gg und sponsoring.swisshub.gg nicht wiederhergestellt                                         |
| **Keine Ausfallsicherheit**                       | [OFFEN]         | Ein Ausfall bedeutet Ausfallzeit. Bewusst so — [VERFUEGBARKEIT.md](VERFUEGBARKEIT.md)                                               |
| **Alarmziele fehlen**                             | [EXTERN]        | Ein Totalausfall alarmiert heute niemanden                                                                                          |
| **Privater Schlüssel einfach vorhanden**          | [EXTERN]        | Verlust bedeutet Verlust der Integrations-Zugangsdaten. Abhilfe: mehrere Empfänger, kostet nichts                                   |
| **Dashboard-Controller nicht produktiv gelaufen** | [UNVERIFIZIERT] | Zusammenspiel mit echten Benutzern und der produktiven Permission Engine ungeprüft                                                  |
| **CI-Gate nicht durch Actions gelaufen**          | [UNVERIFIZIERT] | `sudo -n` und der echte Runner sind ungeprüft                                                                                       |
| **Monatliche Schlüsselprüfung ist Handarbeit**    | [OFFEN]         | Ein nie ausprobierter Schlüssel ist keine Sicherung. Nicht automatisierbar — der private Schlüssel darf nicht auf dem Server liegen |

---

## Das wichtigste Ziel

> Die nachweisbare Fähigkeit, SwissHub auch nach einem vollständigen
> Serververlust sicher wiederherzustellen.

**Nachgewiesen** — auf einer Wegwerf-Installation, zweimal, mit vernichtetem
Datenverzeichnis, vernichteten Uploads, vernichteter `.env` und vernichteter
Konfiguration. Wiederhergestellt allein aus dem Backup-Speicher und einem
Offline-Schlüssel, in 177 Sekunden, mit byteweise identischen Dateien und
einem wieder entschlüsselbaren Geheimnis.

**Nicht nachgewiesen** — auf der Produktion, und mit einer auswärtigen Kopie.
Solange der Backup-Speicher auf demselben Server liegt, ist der Fall
«vollständiger Serververlust» geprobt, aber nicht abgedeckt: die Übung hatte
den Backup-Speicher noch. Ein echter Serververlust hätte ihn mitgenommen.

Der Weg vom geprobten zum abgedeckten Fall ist ein Objektspeicher. Alles
andere ist gebaut und wartet darauf.
